/**
 * Impor Data KTP dan Data Servis (docs/FUSION.md Tahap C).
 *
 * Satu mekanisme, dua sumber. Bedanya cuma isi `SPECS` di backend/core/source-rows.js
 * — tabel tujuan, judul kolom yang dicari, dan apakah nomor mesin berulang itu wajar.
 * Dua importer terpisah yang 90% sama adalah dua tempat yang harus diperbaiki tiap
 * kali ada satu hal berubah.
 *
 * Yang dipakai ulang apa adanya dari impor penjualan yang sudah jalan:
 *   - `readTable()` (xlsx/csv) dari importer.js
 *   - kunci impor yang SAMA: tiga impor tidak boleh jalan bersamaan, karena ketiganya
 *     menghapus-lalu-menulis-ulang periode yang sama
 *   - baris audit di tabel `imports`, dibuka 'berjalan' dan ditutup 'ok'/'gagal'
 *   - pola idempoten: DELETE periode lalu tulis ulang, di dalam SATU transaksi
 *
 * SELURUH tulisan sumber ini masuk database `astra_customers`, bukan `astra`: KTP
 * membawa nama dan alamat, Servis membawa alamat. Lihat komentar di
 * customers-schema.sql.
 */
const store = require('./db');
const importLock = require('./import-lock');
const { readTable } = require('./importer');
const { toDottedCityCode, coreCityName, normalizeName } = require('../core/region');
const { buildVillageIndex, resolveVillage } = require('../core/village-resolver');
const { SPECS, findColumns, mapRows, markEngines } = require('../core/source-rows');
const { recalculate } = require('./fusion-store');

/** Sama dengan importer penjualan: 500 baris per INSERT, jauh di bawah batas 65.535 parameter. */
const BATCH = 500;

/** Berapa nama tak cocok yang dilaporkan balik ke layar. Sisanya cuma dihitung. */
const LAPOR_MAX = 30;

/**
 * @param {Object} options
 *   source    'ktp' | 'servis'
 *   file      path berkas yang sudah tersimpan di disk
 *   period    'YYYY-MM'
 *   fileName  nama asli, untuk dicatat
 *   ip        untuk dicatat
 *   config    dari config.js; dibutuhkan untuk membuka database PII
 */
async function runSourceImport(options) {
  const spec = SPECS[options.source];
  if (!spec) throw new Error(`Sumber tidak dikenal: ${options.source}`);
  if (!options.config) {
    throw new Error('Impor sumber ini butuh konfigurasi database konsumen.');
  }

  importLock.begin();

  const db = store.db();
  const logged = await store.one(db, `
    INSERT INTO imports (started_at, ip, file_name, period, source, result)
    VALUES (?, ?, ?, ?, ?, 'berjalan')
    RETURNING id`,
  [new Date().toISOString(), options.ip || null, options.fileName || null,
    options.period, options.source]);
  const importId = logged.id;

  try {
    const table = await readTable(options.file);
    if (table.length < 2) throw new Error('Berkasnya kosong atau cuma berisi judul.');

    const cols = findColumns(table[0], spec);
    const rows = mapRows(table.slice(1), cols, spec);
    markEngines(rows, spec);

    // Kode kota dinormalkan ke bentuk BPS bertitik SEBELUM disimpan.
    //
    // Excel menulisnya tanpa titik ('3404'); tabel `villages` memakai '34.04'. Tanpa
    // langkah ini nilainya tetap tersimpan apa adanya dan tidak pernah bisa
    // disambungkan — diukur pada data Agustus 2026: 0 dari 49 kode kota cocok, jadi
    // nama kota kosong di seluruh panel dan rute /v1/metrik/kota/:kota (yang
    // memvalidasi format bertitik) tidak akan pernah menemukan apa pun.
    // Sesudah dinormalkan: 37 dari 49 cocok — 12 sisanya memang di luar DIY+Jateng.
    //
    // Dinormalkan di sini, bukan waktu membaca, supaya `segment_rollup` yang
    // menyalin kolom ini dari `customer_ktp` ikut benar tanpa perubahan kedua.
    rows.forEach((r) => {
      if (r.cityCode) r.cityCode = toDottedCityCode(r.cityCode);
    });

    // --- indeks wilayah: DIBANGUN SEKALI untuk seluruh berkas ---
    //
    // Bukan sekali per baris. Berkas Astra belasan ribu baris, dan membaca 8.999 desa
    // untuk tiap barisnya adalah cara paling mudah membuat impor yang tadinya detik
    // jadi menit.
    const villages = await store.all(db, `
      SELECT village_code AS code, village_name AS name, district_name AS district,
             city_code AS "cityCode", city_name AS "cityName"
      FROM villages`);
    const daftarAlias = await store.all(db, `
      SELECT city_code AS "cityCode", district_name AS "districtName",
             village_name AS "villageName", village_code AS "villageCode"
      FROM village_aliases`);

    const index = buildVillageIndex(villages, daftarAlias);

    // Data Servis menyebut kabupaten sebagai TEKS ('Sleman'), bukan kode BPS. Kunci
    // pencocokan tiga tingkat butuh kodenya, jadi namanya dipetakan dulu — lewat
    // coreCityName() yang sudah menangani 'Kab.'/'Kabupaten'/'Kota' di kedua sisi.
    //
    // Satu nama bisa menunjuk LEBIH DARI SATU kode, dan ini bukan kemungkinan
    // teoretis: di Jateng ada empat pasang — Kabupaten/Kota Magelang, Pekalongan,
    // Semarang, dan Tegal. coreCityName() melucuti awalannya, jadi keduanya jadi
    // nama yang sama persis. Versi pertama kode ini menyimpan satu kode per nama,
    // jadi yang terakhir dibaca MENIMPA yang lain — dan seluruh desa di empat
    // KABUPATEN itu dicari di wilayah KOTA-nya, lalu gagal cocok. Diukur pada data
    // Servis Agustus 2026: 19.176 baris tak cocok, mayoritas desa Kabupaten
    // Magelang (Mertoyudan, Muntilan, Mungkid, Borobudur, ...).
    //
    // Karena itu: nama -> DAFTAR kode, dan tiap kandidat dicoba sampai ada yang
    // benar-benar cocok. Nama kecamatannya yang membedakan — kecamatan Kabupaten
    // Magelang tidak ada di Kota Magelang — jadi kunci tiga tingkat tetap yang
    // memutuskan, bukan tebakan.
    const cityByName = {};
    const perCity = {};
    villages.forEach((v) => {
      const kunci = coreCityName(v.cityName);
      const daftar = cityByName[kunci] || (cityByName[kunci] = []);
      if (!daftar.includes(v.cityCode)) daftar.push(v.cityCode);
      (perCity[v.cityCode] = perCity[v.cityCode] || []).push(v);
    });

    // --- resolusi wilayah, dengan cache per kombinasi unik ---
    //
    // Belasan ribu baris biasanya cuma menyentuh beberapa ratus desa. Menghitung
    // padanan ejaan untuk kombinasi yang sama berulang kali adalah kerja yang
    // hasilnya sudah diketahui.
    const cache = new Map();
    const hitung = {
      ok: 0, alias: 0, fuzzy: 0, unmatched: 0, no_engine: 0, duplicate: 0,
    };
    const belumCocok = new Map();

    rows.forEach((r) => {
      if (r.status) { hitung[r.status]++; return; }

      // Kandidat kode kota: satu kalau berkasnya memang membawa kode (Data KTP),
      // bisa dua kalau cuma namanya (Data Servis, lihat komentar di atas).
      const kandidat = r.cityCode
        ? [toDottedCityCode(r.cityCode)]
        : (cityByName[coreCityName(r.cityText)] || []);

      // Kunci cache dibangun dari MASUKAN mentahnya, bukan dari kode kota hasil
      // pemetaan — dua nama kota berbeda yang memetakan ke kandidat yang sama tetap
      // harus dihitung sendiri-sendiri.
      const kunci = (r.cityCode || r.cityText || '') + '|' +
        normalizeName(r.districtText) + '|' + normalizeName(r.villageText);
      let hasil = cache.get(kunci);
      if (!hasil) {
        // Berhenti di kandidat PERTAMA yang benar-benar menghasilkan kode desa.
        // Kalau tidak ada yang cocok, yang disimpan hasil percobaan terakhir —
        // lengkap dengan usulannya, supaya laporan "belum cocok" tetap berguna.
        for (const kk of (kandidat.length ? kandidat : [''])) {
          hasil = resolveVillage(
            { cityCode: kk, districtName: r.districtText, villageName: r.villageText },
            index, perCity[kk] || villages);
          if (hasil.villageCode) break;
        }
        cache.set(kunci, hasil);
      }

      r.villageCode = hasil.villageCode;
      r.status = hasil.status;
      hitung[hasil.status]++;

      if (hasil.status === 'unmatched') {
        const nama = `${r.districtText || '?'} / ${r.villageText || '?'}`;
        belumCocok.set(nama, (belumCocok.get(nama) || 0) + 1);
      }
    });

    // --- tulis ke database PII, idempoten per periode ---
    const pii = await store.ensureCustomers(options.config);
    const values = rows.map((r) => spec.toValues(r, options.period));

    // Nama tabel dan kolom datang dari SPECS (konstanta kode), tidak pernah dari
    // masukan pengguna — jadi interpolasinya aman. Nilainya tetap lewat parameter.
    await store.transaction(pii, async (conn) => {
      await conn.query(`DELETE FROM ${spec.table} WHERE period = ?`, [options.period]);
      for (let i = 0; i < values.length; i += BATCH) {
        const bulk = store.bulkValues(values.slice(i, i + BATCH));
        await conn.query(
          `INSERT INTO ${spec.table} (${spec.columns.join(', ')}) VALUES ${bulk.text}`,
          bulk.params);
      }
    });

    // Batch penggolongan langsung menyusul impor — jalur A di docs/FUSION.md 2.2.
    //
    // Kegagalannya TIDAK membatalkan impor: barisnya sudah masuk dan sudah benar, dan
    // penggolongan bisa dijalankan ulang kapan saja lewat rute recalculate. Yang tidak
    // boleh hilang adalah data yang sudah susah payah dibaca dari Excel.
    let fusi;
    try {
      fusi = await recalculate({ period: options.period, config: options.config });
    } catch (error) {
      fusi = { error: String(error.message).slice(0, 200) };
    }

    const terpakai = hitung.ok + hitung.alias + hitung.fuzzy;
    const pesan = `${terpakai} baris bertitik, ${hitung.unmatched} nama belum cocok, ` +
      `${hitung.duplicate} nomor mesin ganda, ${hitung.no_engine} tanpa nomor mesin`;

    await store.run(db, `
      UPDATE imports SET finished_at = ?, rows_read = ?, rows_used = ?,
        result = 'ok', message = ? WHERE id = ?`,
    [new Date().toISOString(), rows.length, terpakai, pesan, importId]);

    return {
      source: options.source,
      period: options.period,
      rowsRead: rows.length,
      rowsUsed: terpakai,
      status: hitung,
      unmatched: [...belumCocok.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, LAPOR_MAX)
        .map(([name, count]) => ({ name, count })),
      unmatchedNames: belumCocok.size,
    };
  } catch (error) {
    await store.run(db, `
      UPDATE imports SET finished_at = ?, result = 'gagal', message = ? WHERE id = ?`,
    [new Date().toISOString(), String(error.message).slice(0, 500), importId]);
    throw error;
  } finally {
    importLock.end();
  }
}

/**
 * Simpan satu ping pengiriman.
 *
 * SELALU disimpan lebih dulu, divalidasi belakangan. Ping yang nomor mesinnya belum
 * dikenal (KTP-nya belum diimpor) TETAP masuk — dia menunggu batch berikutnya, bukan
 * ditolak. Menolaknya berarti kehilangan satu-satunya bukti koordinat rumah yang
 * pernah lewat, dan bukti itu tidak datang dua kali.
 *
 * Append-only: satu baris per kedatangan, tidak pernah di-upsert.
 */
async function savePing(ping, config) {
  if (!config) throw new Error('Menyimpan ping butuh konfigurasi database konsumen.');
  const pii = await store.ensureCustomers(config);

  // Periode pembelian, kalau pengirimnya tidak menyebutkannya: dicari dari Data KTP
  // lewat nomor mesin. MIN(period) — periode KTP paling AWAL untuk mesin itu, yaitu
  // saat motornya pertama tercatat. Kalau nomor mesinnya belum dikenal, periodenya
  // NULL dan pingnya TETAP disimpan; ia menunggu Data KTP-nya masuk.
  //
  // TIDAK PERNAH diturunkan dari `sent_at`. Lihat alasannya di customers-schema.sql.
  let period = ping.period || null;
  if (!period && ping.engineNo) {
    const cocok = await store.one(pii,
      'SELECT MIN(period) AS period FROM customer_ktp WHERE engine_no = ?',
      [ping.engineNo]);
    period = (cocok && cocok.period) ? cocok.period : null;
  }

  const baris = await store.one(pii, `
    INSERT INTO delivery_ping
      (engine_no, period, sent_at, lat, lng, accuracy_m, location_text, photo_url,
       courier_name, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id`,
  [ping.engineNo || null, period, ping.sentAt, ping.lat, ping.lng,
    ping.accuracyM == null ? null : ping.accuracyM,
    ping.locationText || null, ping.photoUrl || null, ping.courierName || null,
    ping.note || null]);

  return baris.id;
}

module.exports = { runSourceImport, savePing, SPECS };
