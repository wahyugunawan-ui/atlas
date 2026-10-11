/**
 * Uji scripts/backfill-dealer-city.js: mengisi dealers.city_code dan dealers.district_code
 * dari kolom "Kabupaten" dan "Kecamatan" Excel Dealer & POS, TANPA menyentuh kolom lain.
 *
 * Yang dijaga, semuanya gagal diam kalau salah:
 *
 * 1. Kota terisi menurut kolom Kabupaten, dan "Kab. Sleman" / "Kabupaten Sleman" sama-sama
 *    bertemu — sama seperti importer penuh.
 * 2. Nama, alamat, dan koordinat dealer TIDAK berubah. Itulah alasan skrip ini ada
 *    dibanding importer penuh (yang menimpa suntingan di Master Dealer).
 * 3. Yang tak terbaca dilaporkan DENGAN NAMANYA — kabupaten asing, kode Excel yang tak
 *    ada di DB, dan dealer yang masih tanpa kota — bukan dilewati diam-diam.
 * 4. Idempoten: jalan kedua tidak mengubah apa pun.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const store = require('../backend/server/db');
const backfillDealerCity = require('../scripts/backfill-dealer-city');
const { openTestDb, closeTestDb } = require('./helpers/db');

/** Berkas Excel dengan sheet "Dealer" (header di baris 2, seperti aslinya). */
async function tulisExcel(file, baris) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dealer');
  ws.addRow(['DAFTAR DEALER']);
  ws.addRow(['Kode Dealer', 'Nama Dealer System', 'Alamat', 'Kecamatan', 'Kabupaten', 'Koordinat', 'Koordinat']);
  baris.forEach((b) => ws.addRow([b.kode, b.nama, 'Alamat Excel', b.kec || '', b.kab, '', '']));
  await wb.xlsx.writeFile(file);
}

async function main() {
  const config = await openTestDb('backfilldealercity');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-bfcity-'));
  const file = path.join(dir, 'dealer.xlsx');
  try {
    const db = store.db();
    const desa = `INSERT INTO villages (village_code, village_name, district_code, district_name,
                    city_code, city_name, province_code) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    await store.run(db, desa, ['34.04.01.2001', 'Sendangadi', '34.04.01', 'Mlati', '34.04', 'Kabupaten Sleman', '34']);
    await store.run(db, desa, ['33.01.01.2001', 'Cilacap Kota', '33.01.01', 'Cilacap', '33.01', 'Kabupaten Cilacap', '33']);
    // 'Mlati' ada di DUA kabupaten: nama yang sama harus dipersempit ke kabupaten dealer.
    await store.run(db, desa, ['33.01.05.2001', 'Mlati Cilacap', '33.01.05', 'Mlati', '33.01', 'Kabupaten Cilacap', '33']);

    const dealer = `INSERT INTO dealers (dealer_code, dealer_name, address, lat, lng, legacy_code, city_code)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`;
    await store.run(db, dealer, ['SATU', 'DEALER SATU', 'Alamat Master', -7.7, 110.3, '9', null]);
    await store.run(db, dealer, ['DUA', 'DEALER DUA', 'Alamat Master', -7.7, 109.0, '77', null]);
    await store.run(db, dealer, ['TIGA', 'DEALER TIGA', 'Alamat Master', null, null, '55', '33.01']);
    await store.run(db, dealer, ['EMPAT', 'DEALER EMPAT', 'Alamat Master', null, null, '66', null]);
    await store.run(db, dealer, ['LIMA', 'DEALER LIMA', 'Alamat Master', null, null, null, null]);

    await tulisExcel(file, [
      { kode: '9', nama: 'DEALER SATU', kab: 'Kab. Sleman', kec: 'Mlati' },   // Mlati ambigu: dipersempit ke Sleman
      { kode: '77', nama: 'DEALER DUA', kab: 'Kabupaten Cilacap', kec: 'Mlati' }, // Mlati yang LAIN (Cilacap)
      { kode: '55', nama: 'DEALER TIGA', kab: 'Kab. Sleman', kec: 'Kecamatan Gaib' }, // kota beda dari DB; kecamatan asing
      { kode: '66', nama: 'DEALER EMPAT', kab: 'Kab. Entah Berantah' }, // kabupaten asing
      { kode: '404', nama: 'DEALER HANTU', kab: 'Kab. Sleman', kec: 'Mlati' },        // tak ada di DB
    ]);

    const log = console.log;
    console.log = () => {};   // laporan skrip tidak perlu ikut ke keluaran tes
    let hasil;
    try { hasil = await backfillDealerCity(config, file); } finally { console.log = log; }

    // 1. Kota terisi.
    await store.open(config);
    const kota = Object.fromEntries((await store.all(store.db(),
      'SELECT dealer_code, city_code FROM dealers')).map((r) => [r.dealer_code, r.city_code]));
    assert.deepStrictEqual(kota, {
      SATU: '34.04', DUA: '33.01', TIGA: '34.04', EMPAT: null, LIMA: null,
    }, '"Kab. Sleman"/"Kabupaten Cilacap" tidak bertemu, atau kota tidak diisi/diganti');

    // Kecamatan: nama 'Mlati' sama di Sleman DAN Cilacap, jadi harus jatuh ke kecamatan di
    // kabupaten dealernya masing-masing, bukan tertukar atau ditebak.
    const kec = Object.fromEntries((await store.all(store.db(),
      'SELECT dealer_code, district_code FROM dealers')).map((r) => [r.dealer_code, r.district_code]));
    assert.deepStrictEqual(kec, {
      SATU: '34.04.01', DUA: '33.01.05', TIGA: null, EMPAT: null, LIMA: null,
    }, 'kecamatan ambigu tidak dipersempit ke kabupaten dealer, atau kecamatan asing ditebak');

    // 2. Kolom lain tidak tersentuh.
    const satu = await store.one(store.db(),
      "SELECT dealer_name, address, lat, lng FROM dealers WHERE dealer_code = 'SATU'");
    assert.strictEqual(satu.address, 'Alamat Master', 'alamat dealer ditimpa dari Excel');
    assert.strictEqual(satu.dealer_name, 'DEALER SATU');
    assert.strictEqual(Number(satu.lat), -7.7, 'koordinat dealer ditimpa');

    // 3. Pelaporan.
    assert.strictEqual(hasil.dalamExcel, 5);
    assert.strictEqual(hasil.diisi, 3);
    assert.deepStrictEqual(hasil.berubah, ['DEALER TIGA (kota 33.01 -> 34.04)'],
      'kota yang diganti nilai berbeda tidak dilaporkan');
    assert.deepStrictEqual(hasil.tanpaKecamatan.sort(), ['DEALER EMPAT', 'DEALER TIGA (Kecamatan Gaib)'],
      'kecamatan yang tak terbaca/asing harus dilaporkan dengan nama dealernya');
    assert.deepStrictEqual(hasil.tanpaKota, ['DEALER EMPAT'],
      'kabupaten asing harus dilaporkan dengan nama dealernya');
    assert.deepStrictEqual(hasil.tidakDiDatabase, ['DEALER HANTU']);
    assert.deepStrictEqual(hasil.masihTanpaKota.sort(), ['DEALER EMPAT', 'DEALER LIMA'],
      'dealer yang masih tanpa kota harus terdaftar, termasuk yang tak ada di Excel');

    // 4. Idempoten.
    await store.close();
    console.log = () => {};
    let ulang;
    try { ulang = await backfillDealerCity(config, file); } finally { console.log = log; }
    assert.strictEqual(ulang.diisi, 0, 'jalan kedua mengubah sesuatu');
    // EMPAT (tak ada yang terbaca) tidak punya apa-apa untuk diubah, jadi ikut "sama".
    assert.strictEqual(ulang.sama, 4);
    assert.deepStrictEqual(ulang.tanpaKecamatan.sort(), ['DEALER EMPAT', 'DEALER TIGA (Kecamatan Gaib)']);
    assert.deepStrictEqual(ulang.berubah, []);

    // Store sudah ditutup skrip; closeTestDb menutup lagi (idempoten) dan membuang DB.
    console.log('OK backfill-dealer-city — kota dan kecamatan terisi dari kolom Kabupaten dan ' +
      'Kecamatan (nama kecamatan ambigu dipersempit ke kabupaten dealer), nama/alamat/koordinat dealer tidak tersentuh, yang tak terbaca dilaporkan ' +
      'dengan namanya, idempoten');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await closeTestDb(config);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
