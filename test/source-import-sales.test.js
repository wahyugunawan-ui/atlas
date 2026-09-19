/**
 * Impor Data KTP ikut menulis baris penjualan (`sales`).
 *
 * KENAPA TES INI ADA. Sampai 2026-09-19 ada DUA impor bulanan untuk kejadian yang
 * sama: impor penjualan (menulis `sales`) dan impor Data KTP (menulis
 * `customer_ktp`). Template KTP ternyata versi LENGKAP dari template penjualan —
 * kolom wilayahnya sama, ke-78 kode posnya terbukti set yang identik, ditambah nomor
 * mesin yang tidak pernah dipunyai template penjualan. Impor penjualan dipensiunkan,
 * dan sejak itu SELURUH halaman Sales Analytics bergantung pada penurunan di sini.
 *
 * `runSourceImport()` sebelumnya TIDAK punya satu tes pun. Yang dijaga di sini sifat
 * yang kalau rusak tidak menimbulkan galat apa pun:
 *   - agregatnya benar per (kelurahan, pos), bukan per baris
 *   - idempoten: mengimpor berkas yang sama dua kali tidak menggandakan penjualan
 *   - baris tanpa kelurahan tidak masuk `sales` TAPI tetap dilaporkan
 *   - kode pos yang belum terdaftar ditolak dengan pesan yang MENYEBUT kodenya,
 *     sebelum satu baris pun tersimpan — bukan galat FOREIGN KEY mentah dari Postgres
 *
 * Database uji sendiri (utama + PII), dibuang di akhir.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const store = require('../backend/server/db');
const { runSourceImport } = require('../backend/server/source-import');
const { openTestDb, closeTestDb } = require('./helpers/db');

const PERIODE = '2026-08';
const HEADER = 'No Mesin,No Rangka,Nama,Alamat,Kel,Kec,Kode Kota,Kode Dealer,Tgl Mohon';

/** Satu baris Data KTP. Nama/alamat diisi sungguhan supaya kebocoran ketahuan. */
function baris(mesin, kel, kec, kota, pos) {
  return [mesin, 'RANGKA-' + mesin, 'Budi Santoso', 'Jl. Rahasia No. 1',
    kel, kec, kota, pos, '2026-08-01'].join(',');
}

function tulisCsv(dir, nama, rows) {
  const file = path.join(dir, nama);
  fs.writeFileSync(file, [HEADER].concat(rows).join('\n'));
  return file;
}

async function seed(db) {
  const desa = `
    INSERT INTO villages (village_code, village_name, district_code, district_name,
                          city_code, city_name, province_code, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  await store.run(db, desa, ['34.04.06.2003', 'Sinduadi', '34.04.06', 'Mlati', '34.04',
    'Kabupaten Sleman', '34', -7.75, 110.36]);
  await store.run(db, desa, ['34.04.06.2004', 'Sendangadi', '34.04.06', 'Mlati', '34.04',
    'Kabupaten Sleman', '34', -7.74, 110.35]);

  // outlets: FOREIGN KEY sales.outlet_code menunjuk ke sini.
  await store.run(db,
    `INSERT INTO dealers (dealer_code, dealer_name, legacy_code)
     VALUES ('DEALERUJI', 'Dealer Uji', '7348')`);
  for (const kode of ['7348', '9001']) {
    await store.run(db,
      `INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name)
       VALUES (?, ?, 'DEALERUJI', 'Dealer Uji')`, [kode, 'Pos ' + kode]);
  }
}

const salesRows = (db) => store.all(db,
  `SELECT village_code AS desa, outlet_code AS pos, quantity AS n
   FROM sales WHERE period = ? ORDER BY village_code, outlet_code`, [PERIODE]);

async function main() {
  const config = await openTestDb('ktpsales');
  try {
    const db = store.db();
    await seed(db);
    const dir = config.dataDir;

    // --- 1. agregat per (kelurahan, pos), bukan per baris ---------------------
    //
    // Tujuh baris: Sinduadi/7348 x3, Sinduadi/9001 x1, Sendangadi/7348 x2, dan satu
    // baris yang kelurahannya sengaja tidak dikenal.
    const file = tulisCsv(dir, 'ktp.csv', [
      baris('M1', 'Sinduadi', 'Mlati', '3404', '7348'),
      baris('M2', 'Sinduadi', 'Mlati', '3404', '7348'),
      baris('M3', 'Sinduadi', 'Mlati', '3404', '7348'),
      baris('M4', 'Sinduadi', 'Mlati', '3404', '9001'),
      baris('M5', 'Sendangadi', 'Mlati', '3404', '7348'),
      baris('M6', 'Sendangadi', 'Mlati', '3404', '7348'),
      baris('M7', 'Karangan Yang Tidak Ada', 'Mlati', '3404', '7348'),
    ]);

    const hasil = await runSourceImport({
      source: 'ktp', file, period: PERIODE, fileName: 'ktp.csv', ip: '127.0.0.1', config,
    });

    const sales = await salesRows(db);
    assert.deepStrictEqual(sales, [
      { desa: '34.04.06.2003', pos: '7348', n: 3 },
      { desa: '34.04.06.2003', pos: '9001', n: 1 },
      { desa: '34.04.06.2004', pos: '7348', n: 2 },
    ], 'agregat penjualan per (kelurahan, pos) salah — inilah yang mengisi seluruh ' +
       'halaman Sales Analytics');

    // --- 2. baris tanpa kelurahan: tidak masuk sales, TAPI dilaporkan ---------
    const totalUnit = sales.reduce((s, r) => s + r.n, 0);
    assert.strictEqual(totalUnit, 6,
      'baris yang kelurahannya tidak dikenal seharusnya tidak ikut dihitung di sales');
    assert.ok(hasil.rowsRead >= 7, 'jumlah baris terbaca salah');
    assert.strictEqual(hasil.status.unmatched, 1,
      'baris yang kelurahannya tidak dikenal WAJIB terhitung, bukan dibuang diam-diam');
    assert.strictEqual(hasil.unmatched.length, 1,
      'namanya WAJIB ikut dilaporkan supaya bisa diperbaiki, bukan cuma jumlahnya');
    assert.strictEqual(hasil.salesRows, 3,
      'jumlah baris penjualan yang diperbarui harus dikembalikan — tanpa itu orang ' +
      'tidak tahu Sales Analytics ikut terisi dari unggahan ini');

    // Pesan di tabel audit `imports` ikut menyebutnya: itu satu-satunya jejak yang
    // masih bisa dibaca berhari-hari kemudian, waktu ada yang bertanya "bulan ini
    // datanya dari unggahan yang mana".
    const audit = await store.one(db,
      `SELECT message FROM imports WHERE period = ? AND source = 'ktp'
       ORDER BY id DESC LIMIT 1`, [PERIODE]);
    assert.ok(/3 baris penjualan/.test(String(audit.message || '')),
      'catatan impor tidak menyebut baris penjualan yang diperbarui; yang tercatat: ' +
      audit.message);

    // --- 3. IDEMPOTEN: berkas yang sama dua kali tidak menggandakan -----------
    await runSourceImport({
      source: 'ktp', file, period: PERIODE, fileName: 'ktp.csv', ip: '127.0.0.1', config,
    });
    assert.deepStrictEqual(await salesRows(db), sales,
      'impor ulang periode yang sama menggandakan penjualan — angkanya jadi naik tiap ' +
      'kali orang mengunggah ulang berkas yang sama');

    // --- 4. kode pos yang BELUM TERDAFTAR ditolak sebelum menulis apa pun -----
    //
    // Tanpa penjagaan ini, FOREIGN KEY sales.outlet_code yang menolak — dengan pesan
    // Postgres yang tidak berarti apa-apa bagi pengguna non-IT, dan baris PII sudah
    // terlanjur masuk sehingga keadaannya setengah jadi.
    const fileAsing = tulisCsv(dir, 'ktp-asing.csv', [
      baris('N1', 'Sinduadi', 'Mlati', '3404', '7348'),
      baris('N2', 'Sinduadi', 'Mlati', '3404', '55555'),
    ]);
    let galat = null;
    try {
      await runSourceImport({
        source: 'ktp', file: fileAsing, period: '2026-09', fileName: 'x.csv', config,
      });
    } catch (e) { galat = e; }

    assert.ok(galat, 'kode pos yang belum terdaftar seharusnya menggagalkan impor');
    assert.ok(galat.message.includes('55555'),
      'pesannya harus MENYEBUT kode posnya supaya orang tahu apa yang harus ' +
      'didaftarkan; yang muncul: ' + galat.message);
    assert.ok(/Master Pos Dealer/i.test(galat.message),
      'pesannya harus menunjuk ke mana harus memperbaikinya');

    const sesudahGagal = await store.one(db,
      `SELECT COUNT(*)::int AS n FROM sales WHERE period = '2026-09'`);
    assert.strictEqual(sesudahGagal.n, 0,
      'impor yang gagal meninggalkan baris penjualan setengah jadi');
    const piiSesudahGagal = await store.one(store.customers(),
      `SELECT COUNT(*)::int AS n FROM customer_ktp WHERE period = '2026-09'`);
    assert.strictEqual(piiSesudahGagal.n, 0,
      'impor yang gagal meninggalkan baris PII setengah jadi — pemeriksaan pos ' +
      'harus terjadi SEBELUM penulisan, bukan sesudahnya');

    // Bulan yang sudah ada tidak ikut rusak oleh impor bulan lain yang gagal.
    assert.deepStrictEqual(await salesRows(db), sales,
      'impor bulan lain yang gagal ikut merusak bulan yang sudah tersimpan');

    console.log('OK source-import-sales — agregat per (kelurahan, pos) benar, idempoten, ' +
      'baris tanpa kelurahan dilaporkan bukan dibuang, dan pos tak terdaftar ditolak ' +
      'sebelum satu baris pun tersimpan');
  } finally {
    await closeTestDb(config);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
