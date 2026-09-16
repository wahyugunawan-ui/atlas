/**
 * Menjalankan penggolongan Warlok atas data yang sudah masuk (docs/FUSION.md Tahap D).
 *
 * Pembagian kerjanya tegas: seluruh KEPUTUSAN ada di `backend/core/fusion.js` yang
 * murni dan bisa diuji tanpa database; berkas ini cuma membaca, memanggilnya, dan
 * menulis hasilnya. Tidak ada satu pun aturan golongan yang ditulis di sini.
 *
 * Melintasi DUA database, dan itu disengaja:
 *   `astra_customers`  sumber (KTP/Servis/Ping) dan hasil per nomor mesin — semuanya PII
 *   `astra`            ringkasannya tanpa identitas (`segment_rollup`), plus ambang
 *                      dan bobot di `app_config`
 *
 * Satu transaksi tidak bisa melintasi dua database, jadi keduanya ditulis terpisah.
 * Urutannya: hasil per mesin dulu, ringkasan menyusul — kalau langkah kedua gagal,
 * yang hilang cuma ringkasan yang bisa dihitung ulang kapan saja.
 */
const store = require('./db');
const { fuseEngine, SEGMENTS, DEFAULT_KPI_M } = require('../core/fusion');

const BATCH = 500;

/** Kolom `customer_fusion`, urutannya harus sama dengan nilai di `barisFusi()`. */
const KOLOM_FUSI = ['engine_no', 'period', 'village_code', 'city_code', 'dealer_code',
  'ktp_lat', 'ktp_lng', 'service_lat', 'service_lng', 'service_count',
  'delivery_lat', 'delivery_lng', 'delivery_count', 'dist_service_m',
  'dist_delivery_m', 'segment', 'weight', 'kpi_radius_m'];

/**
 * Ambang dan bobot yang BERLAKU, dibaca dari `app_config`.
 *
 * Kalau satu nilai hilang atau tidak bisa dibaca sebagai angka, yang dipakai bawaan
 * dari core/fusion.js — bukan nol. Bobot nol diam-diam akan membuat seluruh CW Sales
 * runtuh tanpa satu pun error.
 */
async function readSettings() {
  const rows = await store.all(store.db(), 'SELECT key, value FROM app_config');
  const map = {};
  rows.forEach((r) => { map[r.key] = r.value; });

  const angka = (key, bawaan) => {
    const n = Number(map[key]);
    return Number.isFinite(n) ? n : bawaan;
  };

  const weights = {};
  Object.keys(SEGMENTS).forEach((kode) => {
    const w = Number(map['weight_' + kode]);
    if (Number.isFinite(w)) weights[kode] = w;
  });

  return {
    kpiRadiusM: angka('kpi_jarak_m', DEFAULT_KPI_M),
    weights,
    // Ambang warna status, dipakai bersama oleh API dan (nanti) seluruh komponen
    // Tahap 3. Dibaca dari satu tempat supaya hijau di satu panel berarti hal yang
    // sama dengan hijau di panel lain.
    confidenceSolidMin: angka('confidence_solid_min', 0.65),
    confidenceRapuhMax: angka('confidence_rapuh_max', 0.50),
    retentionSehatMin: angka('retention_sehat_min', 0.50),
    retentionRisikoMax: angka('retention_risiko_max', 0.30),
  };
}

/** Label status dari sebuah rasio. null kalau rasionya memang belum ada. */
function statusRatio(ratio, min, max) {
  if (ratio == null) return null;
  if (ratio >= min) return 'solid';
  return ratio < max ? 'rapuh' : 'sedang';
}

/** Sama, dengan kosakata dealer: sehat / waspada / berisiko. */
function statusRetention(ratio, min, max) {
  if (ratio == null) return null;
  if (ratio >= min) return 'sehat';
  return ratio < max ? 'berisiko' : 'waspada';
}

/** Kode desa -> titik. Desa yang tidak dikenal jadi titik kosong = gagal tergeocode. */
function titikDesa(villageCode, peta) {
  const v = villageCode ? peta[villageCode] : null;
  return v ? { lat: v.lat, lng: v.lng } : { lat: null, lng: null };
}

function kunci(engineNo) {
  return String(engineNo || '').trim().toUpperCase();
}

/**
 * Hitung ulang golongan untuk satu periode.
 *
 * Cakupannya baris KTP periode itu — KTP-lah yang menentukan "satu pelanggan" ada,
 * dan titik acuan semua jaraknya. Servis dan ping dibaca LINTAS PERIODE: satu motor
 * bisa servis bulan ini atas pembelian bulan lalu, dan membatasi keduanya ke periode
 * yang sama akan membuang bukti yang justru paling berguna.
 *
 * @return ringkasan; `skipped` kalau database PII memang tidak ada (aplikasi harus
 *   tetap jalan tanpanya — aturan proyek)
 */
async function recalculate(options) {
  const period = options.period;
  const pii = store.customers() ||
    (options.config ? await store.ensureCustomers(options.config) : null);
  if (!pii) return { skipped: true, reason: 'database konsumen tidak ada' };

  const main = store.db();
  const { kpiRadiusM, weights } = await readSettings();

  const peta = {};
  (await store.all(main, 'SELECT village_code AS code, lat, lng FROM villages'))
    .forEach((v) => { peta[v.code] = { lat: v.lat, lng: v.lng }; });

  const ktpRows = await store.all(pii, `
    SELECT engine_no AS "engineNo", village_code AS "villageCode",
           city_code AS "cityCode", dealer_code AS "dealerCode"
    FROM customer_ktp
    WHERE period = ? AND engine_no IS NOT NULL
      AND resolve_status NOT IN ('no_engine', 'duplicate')`, [period]);

  if (!ktpRows.length) {
    return { period, engines: 0, written: 0, rollup: 0, counts: {} };
  }

  const dalamCakupan = new Set(ktpRows.map((r) => kunci(r.engineNo)));

  const servisPer = {};
  (await store.all(pii, `
    SELECT engine_no AS "engineNo", village_code AS "villageCode"
    FROM service_visit WHERE engine_no IS NOT NULL`)).forEach((r) => {
    const k = kunci(r.engineNo);
    if (!dalamCakupan.has(k)) return;
    (servisPer[k] = servisPer[k] || []).push(titikDesa(r.villageCode, peta));
  });

  const pingPer = {};
  (await store.all(pii, `
    SELECT engine_no AS "engineNo", lat, lng
    FROM delivery_ping WHERE engine_no IS NOT NULL`)).forEach((r) => {
    const k = kunci(r.engineNo);
    if (!dalamCakupan.has(k)) return;
    (pingPer[k] = pingPer[k] || []).push({ lat: r.lat, lng: r.lng });
  });

  // --- golongkan ---
  const nilaiFusi = [];
  const rollup = new Map();
  const irisan = new Map();
  const counts = {};

  ktpRows.forEach((r) => {
    const k = kunci(r.engineNo);
    const ktp = titikDesa(r.villageCode, peta);
    const hasil = fuseEngine({
      ktp,
      services: servisPer[k] || [],
      pings: pingPer[k] || [],
      kpiRadiusM,
      weights,
    });
    if (!hasil) return;

    nilaiFusi.push([r.engineNo, period, r.villageCode || null, r.cityCode || null,
      r.dealerCode || null, ktp.lat, ktp.lng, hasil.serviceLat, hasil.serviceLng,
      hasil.serviceCount, hasil.deliveryLat, hasil.deliveryLng, hasil.deliveryCount,
      hasil.distServiceM, hasil.distDeliveryM, hasil.segment, hasil.weight,
      hasil.kpiRadiusM]);

    counts[hasil.segment] = (counts[hasil.segment] || 0) + 1;

    // Desa kosong dipakai apa adanya ('' bukan NULL) — lihat komentar segment_rollup
    // di schema.sql. Pelanggan tak terverifikasi HARUS tetap terhitung.
    const desa = r.villageCode || '';
    const dealer = r.dealerCode || '';
    const kunciRollup = `${desa}|${dealer}|${hasil.segment}`;
    const sudah = rollup.get(kunciRollup) ||
      { desa, dealer, cityCode: r.cityCode || null, segment: hasil.segment, n: 0, bobot: 0 };
    sudah.n += 1;
    sudah.bobot += hasil.weight;
    rollup.set(kunciRollup, sudah);

    // Dimensi KEDUA: sumber apa saja yang dimiliki, bukan golongannya (schema.sql
    // source_overlap). Yang dicatat KEPEMILIKAN, bukan kedekatan — pelanggan yang
    // punya servis tapi jauh tetap "punya servis". Itulah yang membuat Venn bisa
    // memisah Migran jadi "kirim saja" dan "servis saja".
    //
    // city_code di tabel itu NOT NULL dan ikut primary key, jadi kota yang tidak
    // diketahui dipakai '' — sama seperti village_code di segment_rollup.
    const kota = r.cityCode || '';
    const punyaServis = hasil.serviceCount > 0;
    const punyaKirim = hasil.deliveryCount > 0;
    // Desa ikut jadi kunci sejak 2026-09-17: pemetaan pos -> wilayah satuannya
    // kelurahan, jadi tanpa ini filter Pos tidak bisa menyentuh Venn dan Cakupan
    // Sumber sama sekali. Kuncinya ikut bertambah panjang, dan primary key tabelnya
    // ikut berubah (schema.sql) — kalau tidak, dua kelurahan di kota yang sama saling
    // menimpa.
    const kunciIrisan =
      `${desa}|${kota}|${dealer}|${punyaServis}|${punyaKirim}|${hasil.segment}`;
    const irisanSudah = irisan.get(kunciIrisan) ||
      { desa, kota, dealer, punyaServis, punyaKirim, segment: hasil.segment, n: 0 };
    irisanSudah.n += 1;
    irisan.set(kunciIrisan, irisanSudah);
  });

  // --- tulis hasil per mesin (database PII) ---
  await store.transaction(pii, async (conn) => {
    await conn.query('DELETE FROM customer_fusion WHERE period = ?', [period]);
    for (let i = 0; i < nilaiFusi.length; i += BATCH) {
      const bulk = store.bulkValues(nilaiFusi.slice(i, i + BATCH));
      await conn.query(
        `INSERT INTO customer_fusion (${KOLOM_FUSI.join(', ')}) VALUES ${bulk.text}`,
        bulk.params);
    }
  });

  // --- tulis ringkasan tanpa identitas (database astra) ---
  const nilaiRollup = [...rollup.values()].map((x) =>
    [period, x.desa, x.cityCode, x.dealer, x.segment, x.n, Number(x.bobot.toFixed(2))]);

  const nilaiIrisan = [...irisan.values()].map((x) =>
    [period, x.desa, x.kota, x.dealer, x.punyaServis, x.punyaKirim, x.segment, x.n]);

  // Keduanya ditulis dalam SATU transaksi: segment_rollup dan source_overlap adalah
  // dua sudut pandang atas perhitungan yang sama, dan separuh diperbarui separuh
  // tidak akan membuat dua panel di layar yang sama saling bertentangan tanpa ada
  // yang error.
  await store.transaction(main, async (conn) => {
    await conn.query('DELETE FROM segment_rollup WHERE period = ?', [period]);
    for (let i = 0; i < nilaiRollup.length; i += BATCH) {
      const bulk = store.bulkValues(nilaiRollup.slice(i, i + BATCH));
      await conn.query(`
        INSERT INTO segment_rollup
          (period, village_code, city_code, dealer_code, segment, customer_count, weight_sum)
        VALUES ${bulk.text}`, bulk.params);
    }

    await conn.query('DELETE FROM source_overlap WHERE period = ?', [period]);
    for (let i = 0; i < nilaiIrisan.length; i += BATCH) {
      const bulk = store.bulkValues(nilaiIrisan.slice(i, i + BATCH));
      await conn.query(`
        INSERT INTO source_overlap
          (period, village_code, city_code, dealer_code, has_service, has_delivery,
           segment, customer_count)
        VALUES ${bulk.text}`, bulk.params);
    }
  });

  return {
    period,
    engines: ktpRows.length,
    written: nilaiFusi.length,
    rollup: nilaiRollup.length,
    overlap: nilaiIrisan.length,
    kpiRadiusM,
    counts,
  };
}

module.exports = { recalculate, readSettings, statusRatio, statusRetention };
