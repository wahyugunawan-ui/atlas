/**
 * Uji scripts/fill-pos-coordinates.js.
 *
 * Yang dijaga: koordinat yang SUDAH ADA tidak pernah ditimpa, outlet_code dengan >1
 * baris POS memakai kandidat PERTAMA dan melaporkan sisanya (bukan diam-diam
 * memilih), baris LongLat yang rusak dilaporkan (bukan bikin proses berhenti), dan
 * kolom LongLat berupa formula ({formula,result}, bentuk asli berkas AHM) tetap
 * terbaca lewat `.result`.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const store = require('../backend/server/db');
const fillPosCoordinates = require('../scripts/fill-pos-coordinates');
const { openTestDb, closeTestDb } = require('./helpers/db');

/** Sheet POS kecil: header lengkap tidak perlu, cuma dua kolom yang dibaca skrip. */
async function buatPosXlsx(dir, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('POS');
  ws.addRow(['Kode AHM Dealer', 'Nama POS', 'LongLat']);
  rows.forEach((r) => {
    const row = ws.addRow([]);
    row.getCell(1).value = r.outletCode;
    row.getCell(2).value = r.namaPos || '';
    row.getCell(3).value = r.longLat;
  });
  const file = path.join(dir, 'uji-pos.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

async function seed(db) {
  await store.run(db, "INSERT INTO dealers (dealer_code, dealer_name) VALUES ('D1', 'DEALER SATU')");
  await store.run(db, `
    INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name, lat, lng)
    VALUES ('O01', 'Pos Satu', 'D1', 'DEALER SATU', NULL, NULL)`);
  await store.run(db, `
    INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name, lat, lng)
    VALUES ('O02', 'Pos Dua', 'D1', 'DEALER SATU', -7.1, 110.1)`); // SUDAH punya koordinat
  await store.run(db, `
    INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name, lat, lng)
    VALUES ('O03', 'Pos Tiga', 'D1', 'DEALER SATU', NULL, NULL)`);
  await store.run(db, `
    INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name, lat, lng)
    VALUES ('O04', 'Pos Empat Tanpa Sheet', 'D1', 'DEALER SATU', NULL, NULL)`);
}

async function test() {
  const config = await openTestDb('fill-pos-coordinates');
  const db = store.db();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-fillpos-'));
  await seed(db);

  try {
    const file = await buatPosXlsx(dir, [
      // O01: satu kandidat, formula {formula,result} -- bentuk asli berkas AHM
      { outletCode: 'O01', namaPos: 'O01 - A', longLat: { formula: 'X', result: '-7.80, 110.35' } },
      // O02: SUDAH punya koordinat di database -- tidak boleh disentuh meski ada di sheet
      { outletCode: 'O02', namaPos: 'O02 - A', longLat: '-9.99, 99.99' },
      // O03: DUA kandidat -- yang PERTAMA dipakai, kedua dilaporkan
      { outletCode: 'O03', namaPos: 'O03 - A', longLat: '-7.10, 110.10' },
      { outletCode: 'O03', namaPos: 'O03 - B', longLat: '-7.20, 110.20' },
      // baris rusak: diawali tanda baca liar, tapi masih punya pasangan angka valid
      { outletCode: 'O05-TIDAK-DI-DB', namaPos: 'X', longLat: ';-7.51, 109.29' },
      // baris benar-benar tidak bisa diparse
      { outletCode: 'O06-TIDAK-DI-DB', namaPos: 'Y', longLat: 'tanpa koordinat sama sekali' },
    ]);

    const baris = [];
    const asliLog = console.log;
    console.log = (...args) => { baris.push(args.join(' ')); };
    try {
      await fillPosCoordinates(config, file);
    } finally {
      console.log = asliLog;
    }
    const keluaran = baris.join('\n');

    // --- O01: terisi dari kandidat tunggal, termasuk dari sel formula ---
    const o01 = await store.one(db, 'SELECT lat, lng FROM outlets WHERE outlet_code = ?', ['O01']);
    assert.strictEqual(Number(o01.lat), -7.80, 'koordinat dari sel formula (.result) tidak terbaca');
    assert.strictEqual(Number(o01.lng), 110.35);

    // --- O02: TIDAK disentuh meski ada di sheet, karena sudah punya koordinat ---
    const o02 = await store.one(db, 'SELECT lat, lng FROM outlets WHERE outlet_code = ?', ['O02']);
    assert.strictEqual(Number(o02.lat), -7.1, 'koordinat yang SUDAH ADA ikut ditimpa');
    assert.strictEqual(Number(o02.lng), 110.1);

    // --- O03: kandidat PERTAMA yang dipakai ---
    const o03 = await store.one(db, 'SELECT lat, lng FROM outlets WHERE outlet_code = ?', ['O03']);
    assert.strictEqual(Number(o03.lat), -7.10, 'bukan kandidat pertama yang dipakai');
    assert.match(keluaran, /O03/, 'outlet_code dengan >1 kandidat tidak dilaporkan ke perlu verifikasi');
    assert.match(keluaran, /-7\.2, 110\.2/, 'kandidat yang DIBUANG tidak dilaporkan');

    // --- O04: tidak ketemu di sheet sama sekali ---
    const o04 = await store.one(db, 'SELECT lat FROM outlets WHERE outlet_code = ?', ['O04']);
    assert.strictEqual(o04.lat, null);
    assert.match(keluaran, /O04/, 'outlet yang tidak ketemu di sheet POS tidak dilaporkan');

    // --- baris gagal parse dilaporkan, tidak bikin skrip berhenti ---
    assert.match(keluaran, /gagal diparse\s*:\s*1/i,
      'jumlah baris gagal parse salah, atau baris yang sebenarnya bisa dibersihkan ikut dianggap gagal');
    assert.match(keluaran, /O06-TIDAK-DI-DB/, 'baris yang gagal parse tidak disebut di laporan');

    console.log('OK fill-pos-coordinates — koordinat yang ada tidak ditimpa, kandidat ' +
      'pertama dipakai dan sisanya dilaporkan, sel formula terbaca, baris rusak ' +
      'dilaporkan tanpa menghentikan proses');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await closeTestDb(config);
  }
}

test().catch((error) => {
  console.error(error);
  process.exit(1);
});
