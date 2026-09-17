/**
 * Saringan halaman Confidence Fusion, dijalankan di PostgreSQL sungguhan.
 *
 * KENAPA TES INI ADA. Pada 2026-09-17 mengganti Kota, Dealer, atau Pos di halaman
 * Confidence Fusion menjawab "terjadi kesalahan di server". Sebabnya `fusionRows()`
 * meng-join `segment_rollup` dengan `villages` (punya `city_code` DAN `village_code`)
 * dan `dealers` (punya `dealer_code`), sedangkan penyusun WHERE-nya menyebut ketiga
 * kolom itu TANPA awalan tabel — Postgres menolak dengan "column reference ... is
 * ambiguous".
 *
 * Seluruh tes lain hijau sepanjang waktu, dan memang tidak bisa menangkapnya:
 * ambiguitas kolom hanya ada di database sungguhan, bukan di logika murni. Verifikasi
 * saya waktu itu memakai `fusionTotals()` (tanpa join) dan SQL yang saya tulis
 * sendiri — dua-duanya bagian yang memang bekerja. Tes ini menutup celah itu:
 * ia memanggil SEMUA fungsi fusion dengan SEMUA saringan, lewat jalur yang sama
 * dengan yang dipakai rute.
 *
 * Database uji sendiri, dibuang di akhir. Database PII sengaja TIDAK dibuat —
 * halaman ini harus jalan penuh tanpanya.
 */
const assert = require('assert');

const store = require('../backend/server/db');
const repo = require('../backend/server/repository');
const { openTestDb, closeTestDb } = require('./helpers/db');

const PERIOD = '2026-08';

const V1 = '34.04.01.2001';   // Sleman
const V2 = '33.01.01.2001';   // Cilacap

/**
 * Data sekecil mungkin yang tetap memancing ambiguitas.
 *
 * Dua kelurahan di dua kota, dua dealer, satu pos yang cakupannya HANYA kelurahan
 * pertama. Dengan itu tiap saringan punya jawaban yang berbeda dan bisa dibedakan —
 * kalau saringannya diam-diam tidak berlaku, angkanya jadi 15, bukan 10.
 */
async function seed() {
  const db = store.db();
  const desa = `
    INSERT INTO villages (village_code, village_name, district_code, district_name,
                          city_code, city_name, province_code, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  await store.run(db, desa,
    [V1, 'Sendangadi', '34.04.01', 'Mlati', '34.04', 'Sleman', '34', -7.75, 110.36]);
  await store.run(db, desa,
    [V2, 'Cilacap Kota', '33.01.01', 'Cilacap', '33.01', 'Cilacap', '33', -7.72, 109.01]);

  // legacy_code = kode numerik Excel; itulah yang tersimpan di rollup, sedangkan
  // dealer_code adalah kode turunan nama. Join lewat legacy_code, bukan dealer_code.
  await store.run(db,
    `INSERT INTO dealers (dealer_code, dealer_name, legacy_code) VALUES (?, ?, ?)`,
    ['DEALERSATU', 'DEALER SATU', '9']);
  await store.run(db,
    `INSERT INTO dealers (dealer_code, dealer_name, legacy_code) VALUES (?, ?, ?)`,
    ['DEALERDUA', 'DEALER DUA', '77']);

  await store.run(db,
    `INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name)
     VALUES ('O1', 'POS SATU', 'DEALERSATU', 'DEALER SATU')`);
  // Pos O1 hanya mencakup V1. Saringan Pos karena itu harus menyisakan 10, bukan 15.
  await store.run(db,
    `INSERT INTO coverage (radius_m, outlet_code, village_code, ratio)
     VALUES (1000, 'O1', ?, 1.0)`, [V1]);

  const rollup = `
    INSERT INTO segment_rollup
      (period, village_code, city_code, dealer_code, segment, customer_count, weight_sum)
    VALUES (?, ?, ?, ?, ?, ?, ?)`;
  await store.run(db, rollup, [PERIOD, V1, '34.04', '9', 'loyal_verified', 10, 10.0]);
  await store.run(db, rollup, [PERIOD, V2, '33.01', '77', 'registered_only', 5, 2.75]);

  const irisan = `
    INSERT INTO source_overlap
      (period, village_code, city_code, dealer_code, has_service, has_delivery,
       segment, customer_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  await store.run(db, irisan,
    [PERIOD, V1, '34.04', '9', true, false, 'loyal_verified', 10]);
  await store.run(db, irisan,
    [PERIOD, V2, '33.01', '77', false, false, 'registered_only', 5]);
}

/** Tiap saringan, dan berapa pelanggan yang seharusnya tersisa. */
const KASUS = [
  ['tanpa saringan', {}, 15],
  ['kota', { cityCode: '34.04' }, 10],
  ['dealer', { dealerCode: '9' }, 10],
  ['pos', { outletCode: 'O1' }, 10],
  ['kota + dealer + pos sekaligus', { cityCode: '34.04', dealerCode: '9', outletCode: 'O1' }, 10],
];

async function main() {
  const testConfig = await openTestDb('fusionsql');
  try {
    await seed();

    // 1. TIAP fungsi, TIAP saringan, harus berjalan tanpa galat SQL.
    //
    // Inilah yang dulu merah. Dijalankan untuk semuanya, bukan cuma yang dicurigai:
    // cacatnya muncul di fungsi yang kebetulan punya join, dan daftar fungsi yang
    // punya join bisa bertambah kapan saja tanpa ada yang ingat tes ini.
    const fungsi = [
      ['fusionTotals', (f) => repo.fusionTotals({ period: PERIOD, ...f })],
      ['fusionRows', (f) => repo.fusionRows({ period: PERIOD, ...f })],
      ['fusionByCity', (f) => repo.fusionByCity(PERIOD, f)],
      ['fusionByDealer', (f) => repo.fusionByDealer(PERIOD, f)],
      ['fusionMatrix', (f) => repo.fusionMatrix(PERIOD, f)],
      ['fusionOverlap', (f) => repo.fusionOverlap(PERIOD, f)],
      ['fusionSourceCoverage', (f) => repo.fusionSourceCoverage(PERIOD, f, 'kota')],
      ['fusionVillagePoints', (f) => repo.fusionVillagePoints(PERIOD, f)],
    ];

    for (const [namaKasus, filter] of KASUS) {
      for (const [nama, jalankan] of fungsi) {
        try {
          await jalankan(filter);
        } catch (error) {
          assert.fail(`${nama} gagal untuk saringan "${namaKasus}": ${error.message}`);
        }
      }
    }

    // 2. Saringannya benar-benar MENYARING, bukan sekadar tidak melempar galat.
    //
    // Tanpa pemeriksaan ini, penyusun WHERE yang diam-diam berhenti menambahkan
    // syarat akan tetap hijau — dan itu cacat yang jauh lebih sulit terlihat
    // daripada galat SQL, karena angkanya tetap tampil dan tetap masuk akal.
    for (const [namaKasus, filter, harap] of KASUS) {
      const totals = await repo.fusionTotals({ period: PERIOD, ...filter });
      assert.strictEqual(totals.total, harap,
        `fusionTotals untuk "${namaKasus}" seharusnya ${harap}, dapat ${totals.total}`);
    }

    // 3. Join dealer lewat legacy_code, bukan dealer_code.
    //
    // Rollup menyimpan '9'; dealers.dealer_code adalah 'DEALERSATU'. Kalau join-nya
    // salah kolom, namanya kosong di layar tanpa satu pun galat.
    const halaman = await repo.fusionRows({ period: PERIOD, cityCode: '34.04' });
    assert.strictEqual(halaman.rows.length, 1);
    assert.strictEqual(halaman.rows[0].dealerName, 'DEALER SATU',
      'nama dealer harus terisi lewat legacy_code');
    assert.strictEqual(halaman.rows[0].cityName, 'Sleman');
    assert.strictEqual(halaman.rows[0].villageName, 'Sendangadi');

    // 4. Saringan Pos diterjemahkan lewat tabel coverage, bukan kolom di rollup.
    const lewatPos = await repo.fusionRows({ period: PERIOD, outletCode: 'O1' });
    assert.strictEqual(lewatPos.rows.length, 1);
    assert.strictEqual(lewatPos.rows[0].villageCode, V1,
      'pos O1 hanya mencakup V1, jadi V2 tidak boleh ikut');

    // 5. Golongan ikut menyaring, dan tidak bertabrakan dengan saringan lain.
    const kosong = await repo.fusionTotals(
      { period: PERIOD, cityCode: '34.04', segment: 'registered_only' });
    assert.strictEqual(kosong.total, 0,
      'Sleman tidak punya registered_only; hasilnya harus nol, bukan diabaikan');

    console.log('OK fusion-filter-sql — 8 fungsi x 5 saringan jalan di Postgres, ' +
      'saringan benar-benar menyaring, join dealer lewat legacy_code, pos lewat coverage');
  } finally {
    await closeTestDb(testConfig);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
