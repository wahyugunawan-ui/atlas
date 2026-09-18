/**
 * fusionVillageCustomers(): daftar pelanggan satu kantong (kelurahan, dealer).
 *
 * KENAPA TES INI ADA. Ini bahan panel yang terbuka waktu orang mengklik — atau diam
 * 3 detik di atas — satu titik KTP/Servis/Pengiriman di peta. Titiknya sendiri anonim
 * (cuma membawa kelurahan + dealer), jadi seluruh jembatan dari "titik yang diklik" ke
 * "orang-orang ini" ada di fungsi ini. Kalau jembatannya salah, panelnya tetap terbuka
 * dan tetap berisi nama-nama — cuma nama yang SALAH, atau kosong tanpa sebab. Dua-duanya
 * tidak melempar galat apa pun.
 *
 * Dua kesalahan yang paling mudah terjadi, dan keduanya diuji langsung di sini:
 *
 * 1. KOSAKATA KODE DEALER. customer_fusion menyimpan kode numerik lama ('7348'),
 *    sedangkan titik peta membawa kode turunan nama ('NUSANTARASAKTIGEJAYAN').
 *    Menyaring pakai kode yang salah mengembalikan NOL baris — tanpa galat, tanpa
 *    petunjuk. Penerjemahnya legacyDealerCode(), diuji ikut di sini supaya jembatannya
 *    terbukti utuh ujung ke ujung, bukan cuma potongannya.
 *
 * 2. NAMA DARI BARIS KTP TERBARU. Satu mesin bisa punya beberapa baris customer_ktp
 *    (satu per periode), dan periode fusion tidak selalu sama dengan periode KTP
 *    terbarunya. Join naif `k.period = f.period` mengembalikan nama KOSONG untuk orang
 *    yang datanya justru lengkap. Itulah kenapa implementasinya memakai LEFT JOIN
 *    LATERAL ... ORDER BY period DESC LIMIT 1, sama seperti fusionEngineDetail().
 *
 * Database uji sendiri (utama + PII), dibuang di akhir.
 */
const assert = require('assert');

const store = require('../backend/server/db');
const repo = require('../backend/server/repository');
const { openTestDb, closeTestDb, dropCustomerDatabase } = require('./helpers/db');

const DESA = '34.04.01.2001';
const DESA_LAIN = '34.04.01.2002';
const LEGACY = '7348';
const LEGACY_LAIN = '9001';
const NAMA_DEALER = 'NUSANTARASAKTIGEJAYAN';

/** Satu baris customer_fusion; kolom yang tidak relevan diisi nilai netral. */
async function tulisFusion(pii, { engine, desa, dealer, period, segment, servis, kirim }) {
  await store.run(pii, `
    INSERT INTO customer_fusion
      (engine_no, period, village_code, city_code, dealer_code,
       service_count, delivery_count, segment, weight, kpi_radius_m)
    VALUES (?, ?, ?, '34.04', ?, ?, ?, ?, 1.00, 3000)`,
  [engine, period, desa, dealer, servis || 0, kirim || 0, segment || 'loyal_verified']);
}

// customer_ktp ber-PRIMARY KEY (period, row_no), jadi tiap baris dalam satu periode
// butuh nomor barisnya sendiri — di produksi itu nomor baris di berkas Excel-nya.
const nomorBaris = new Map();

async function tulisKtp(pii, { engine, period, nama, desa }) {
  const n = (nomorBaris.get(period) || 0) + 1;
  nomorBaris.set(period, n);
  await store.run(pii, `
    INSERT INTO customer_ktp
      (engine_no, period, name, address, village_code, resolve_status, row_no)
    VALUES (?, ?, ?, 'Alamat uji', ?, 'exact', ?)`,
  [engine, period, nama, desa || DESA, n]);
}

async function main() {
  const testConfig = await openTestDb('kantongtitik');
  try {
    await store.ensureCustomers(testConfig);
    const pii = store.customers();
    assert.ok(pii, 'database PII uji harus bisa dibuat');

    // Dealer di database UTAMA (bukan PII): di sinilah dua kosakata kode dipetakan.
    await store.run(store.db(),
      `INSERT INTO dealers (dealer_code, dealer_name, legacy_code)
       VALUES (?, 'Nusantara Sakti Gejayan', ?)`, [NAMA_DEALER, LEGACY]);

    await tulisFusion(pii, { engine: 'MSN-A', desa: DESA, dealer: LEGACY, period: '2026-08', segment: 'loyal_verified', servis: 2, kirim: 1 });
    await tulisFusion(pii, { engine: 'MSN-B', desa: DESA, dealer: LEGACY, period: '2026-08', segment: 'nomad' });
    await tulisFusion(pii, { engine: 'MSN-C', desa: DESA, dealer: LEGACY_LAIN, period: '2026-08' });
    await tulisFusion(pii, { engine: 'MSN-D', desa: DESA_LAIN, dealer: LEGACY, period: '2026-08' });
    await tulisFusion(pii, { engine: 'MSN-E', desa: DESA, dealer: LEGACY, period: '2026-07' });

    await tulisKtp(pii, { engine: 'MSN-A', period: '2026-08', nama: 'Ani' });
    await tulisKtp(pii, { engine: 'MSN-B', period: '2026-08', nama: 'Budi' });
    await tulisKtp(pii, { engine: 'MSN-C', period: '2026-08', nama: 'Cici' });
    await tulisKtp(pii, { engine: 'MSN-D', period: '2026-08', nama: 'Dedi' });
    // MSN-E: baris KTP-nya ada di periode BERBEDA dengan baris fusion-nya (fusion
    // 2026-07, KTP terbaru 2026-09). Join naif akan kehilangan namanya.
    await tulisKtp(pii, { engine: 'MSN-E', period: '2026-07', nama: 'Eka (lama)' });
    await tulisKtp(pii, { engine: 'MSN-E', period: '2026-09', nama: 'Eka Terbaru' });

    const nama = (rows) => rows.map((r) => r.name);

    // 1. Lingkup kelurahan: cuma kelurahan yang diminta.
    const satuDesa = await repo.fusionVillageCustomers(DESA, {});
    assert.ok(!nama(satuDesa).includes('Dedi'),
      'pelanggan di kelurahan LAIN tidak boleh ikut — panelnya mengaku menampilkan ' +
      'satu kelurahan, dan batas itulah satu-satunya pagar lingkupnya');
    assert.strictEqual(satuDesa.length, 4, 'empat baris fusion ada di kelurahan ini');

    // 2. Saringan dealer memakai kode NUMERIK LAMA.
    const perDealer = await repo.fusionVillageCustomers(DESA, { dealerCode: LEGACY });
    assert.ok(!nama(perDealer).includes('Cici'),
      'dealer lain di kelurahan yang sama tidak boleh ikut');
    assert.strictEqual(perDealer.length, 3, 'tiga baris dealer ini di kelurahan ini');

    // 3. JEMBATAN UJUNG KE UJUNG: kode turunan nama (yang dibawa titik peta)
    //    diterjemahkan legacyDealerCode() jadi kode numerik yang dipakai tabelnya.
    const diterjemahkan = await repo.legacyDealerCode(NAMA_DEALER);
    assert.strictEqual(diterjemahkan, LEGACY,
      'legacyDealerCode() harus menerjemahkan kode turunan nama jadi kode numerik — ' +
      'tanpa ini panel titik peta selalu kosong tanpa galat');
    const lewatNama = await repo.fusionVillageCustomers(DESA, { dealerCode: diterjemahkan });
    assert.deepStrictEqual(nama(lewatNama).sort(), nama(perDealer).sort(),
      'menyaring lewat kode turunan nama yang sudah diterjemahkan harus memberi hasil ' +
      'yang sama persis dengan menyaring lewat kode numerik langsung');

    // 4. Nama diambil dari baris KTP TERBARU, bukan yang periodenya kebetulan sama.
    const juli = await repo.fusionVillageCustomers(DESA, { dealerCode: LEGACY, period: '2026-07' });
    assert.strictEqual(juli.length, 1, 'satu baris fusion di periode Juli');
    assert.strictEqual(juli[0].name, 'Eka Terbaru',
      'nama harus dari baris KTP TERBARU (2026-09), bukan yang periodenya sama dengan ' +
      'baris fusion (2026-07) — join naif akan salah di sini, atau malah kosong');

    // 5. Saringan periode benar-benar menyaring.
    const agustus = await repo.fusionVillageCustomers(DESA, { dealerCode: LEGACY, period: '2026-08' });
    assert.strictEqual(agustus.length, 2, 'dua baris dealer ini di kelurahan ini pada Agustus');
    assert.ok(!nama(agustus).includes('Eka Terbaru'), 'baris periode lain tidak boleh ikut');

    // 6. Golongan dan hitungan jejak ikut terbawa — itu isi tiap baris panelnya.
    const ani = agustus.find((r) => r.name === 'Ani');
    assert.ok(ani, 'Ani harus ada di hasil Agustus');
    assert.strictEqual(ani.engineNo, 'MSN-A', 'nomor mesin wajib ikut — itu kunci ke rincian');
    assert.strictEqual(ani.segment, 'loyal_verified', 'golongan wajib ikut');
    assert.strictEqual(Number(ani.serviceCount), 2, 'hitungan servis wajib ikut');
    assert.strictEqual(Number(ani.deliveryCount), 1, 'hitungan pengiriman wajib ikut');

    // 7. Alias camelCase benar-benar camelCase. Postgres menurunkan huruf pengenal yang
    //    tidak dikutip, jadi tanpa kutip fieldnya jadi "engineno" dan pembacanya dapat
    //    undefined — tanpa error, kolomnya cuma kosong di layar.
    assert.ok(Object.prototype.hasOwnProperty.call(ani, 'engineNo'),
      'alias "engineNo" harus dikutip di SQL, kalau tidak jadi engineno');
    assert.ok(Object.prototype.hasOwnProperty.call(ani, 'serviceCount'),
      'alias "serviceCount" harus dikutip di SQL');

    // 8. Mesin tanpa baris KTP tetap muncul, namanya null — orangnya memang ada di
    //    hitungan peta, dan menghilangkannya dari daftar membuat jumlah di panel tidak
    //    cocok dengan jumlah di tooltip.
    await tulisFusion(pii, { engine: 'MSN-F', desa: DESA, dealer: LEGACY, period: '2026-08' });
    const denganTanpaKtp = await repo.fusionVillageCustomers(DESA, { dealerCode: LEGACY, period: '2026-08' });
    const tanpaKtp = denganTanpaKtp.find((r) => r.engineNo === 'MSN-F');
    assert.ok(tanpaKtp, 'mesin tanpa baris KTP tetap harus muncul di daftar');
    assert.strictEqual(tanpaKtp.name, null, 'namanya null, bukan barisnya yang hilang');

    // 9. Batas keras 200, tidak bisa dinaikkan dari pemanggil. Rute PII yang batasnya
    //    bisa diminta sendiri bukan batas.
    //
    //    250 baris sungguhan, di kelurahan TERPISAH supaya hitungan di atas tidak
    //    berubah. Versi pertama tes ini cuma memeriksa `<= 200` pada data enam baris —
    //    dan lolos juga waktu batasnya sengaja dirusak, karena datanya memang tidak
    //    pernah sampai 200. Ketahuan waktu uji mutasi: penjaga yang tidak pernah
    //    menyentuh batasnya tidak menjaga batas apa pun.
    const DESA_BANYAK = '34.04.01.2003';
    for (let i = 0; i < 250; i += 1) {
      await tulisFusion(pii, {
        engine: `MSN-BANYAK-${String(i).padStart(3, '0')}`,
        desa: DESA_BANYAK, dealer: LEGACY, period: '2026-08',
      });
    }
    const mintaBanyak = await repo.fusionVillageCustomers(DESA_BANYAK, { limit: 100000 });
    assert.strictEqual(mintaBanyak.length, 200,
      'batas 200 tidak boleh bisa dilewati pemanggil — 250 baris tersedia, 200 yang boleh keluar');

    // 10. DATABASE PII DICABUT — aturan proyek: DROP DATABASE astra_customers harus
    //     mematikan fiturnya dan meninggalkan sisanya jalan penuh, tanpa menyunting
    //     satu baris kode. Fungsi ini WAJIB mengembalikan null (bukan melempar galat,
    //     bukan daftar kosong yang terbaca seolah "kantong ini memang tidak ada
    //     orangnya"), supaya rutenya bisa menjawab 404 dengan jujur.
    //
    //     Dites paling akhir: langkah ini membuang datanya.
    await dropCustomerDatabase(testConfig);
    assert.strictEqual(store.customers(), null, 'database PII berhasil dicabut');
    assert.strictEqual(await repo.fusionVillageCustomers(DESA, {}), null,
      'tanpa database PII harus null — daftar kosong akan terbaca sebagai fakta ' +
      '"tidak ada pelanggan di sini", padahal yang benar "fiturnya tidak tersedia"');
    assert.ok(await store.one(store.db(), 'SELECT 1 AS n'),
      'database utama harus tetap jalan penuh setelah PII dicabut');

    console.log('OK fusion-village-customers — lingkup kelurahan, terjemahan kode dealer ' +
      'lama<->turunan nama, nama dari KTP terbaru, batas 200, dan baris tanpa KTP tetap utuh');
  } finally {
    await closeTestDb(testConfig);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
