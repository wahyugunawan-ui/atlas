/**
 * Uji pembacaan Excel: hasilnya benar, dan tidak ada getter mahal di kondisi loop.
 *
 * KENAPA INI ADA. Impor 19.081 baris memakan 245–287 detik. Terlihat seperti "berkas
 * Excel-nya besar" — tapi berkas CSV dengan isi yang sama persis selesai 0 detik lewat
 * jalur lain, dan membaca berkas xlsx-nya sendiri cuma 1 detik.
 *
 * Sebabnya satu baris: `for (let i = 1; i <= sheet.columnCount; i++)`. `columnCount`
 * itu GETTER yang memindai ulang seluruh sheet tiap dibaca, bukan angka tersimpan.
 * Ditulis di kondisi loop, dia dievaluasi sekali per kolom per baris — 267 ribu
 * pemindaian penuh. Diukur pada berkas Astra sungguhan:
 *
 *     i <= sheet.columnCount   20.659 ms per 2.000 baris   (~197 detik)
 *     batas diangkat           2 ms per 2.000 baris        (~19 ms)
 *
 * Impor ujung ke ujung: 245 detik -> 5,7 detik.
 *
 * Yang dijaga di sini BUKAN kecepatannya. Tes waktu itu rapuh — dia merah di mesin
 * yang sedang sibuk dan hijau di mesin cepat meski kodenya salah. Yang dijaga:
 *   1. hasil bacanya benar, termasuk kolom kosong yang tidak boleh menggeser indeks
 *   2. POLA yang menyebabkannya tidak muncul lagi di kode
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readTable, checkHeader } = require('../backend/server/importer');

const ROOT = path.join(__dirname, '..');

/* ==========================================================================
   1. POLA: getter mahal di kondisi loop
   ========================================================================== */

// Getter exceljs yang memindai ulang sheet tiap dibaca. Ditulis di kondisi loop,
// semuanya berubah jadi kuadratik.
const GETTER_MAHAL = ['columnCount', 'rowCount', 'actualColumnCount', 'actualRowCount'];

const sumber = fs.readFileSync(path.join(ROOT, 'backend', 'server', 'importer.js'), 'utf8');
const pelanggaran = [];

sumber.split('\n').forEach((baris, i) => {
  // Cocokkan kondisi loop `for (...; x <= sesuatu.getter; ...)`, bukan penugasan
  // `const n = sheet.columnCount` yang justru cara yang benar.
  const m = /for\s*\([^)]*[<>]=?\s*[\w.]*\.(\w+)\s*;/.exec(baris);
  if (m && GETTER_MAHAL.includes(m[1])) {
    pelanggaran.push(`importer.js:${i + 1}  ${baris.trim()}`);
  }
});

assert.deepStrictEqual(pelanggaran, [],
  'getter exceljs yang memindai ulang sheet dipakai di kondisi loop — angkat dulu ke\n' +
  'variabel di luar loop. Ini yang dulu membuat impor makan 245 detik:\n  ' +
  pelanggaran.join('\n  '));

// Dan pastikan penjaga ini benar-benar bisa merah: pola yang sama, disuntikkan.
const contohBuruk = 'for (let i = 1; i <= sheet.columnCount; i++) {';
const ujiPola = /for\s*\([^)]*[<>]=?\s*[\w.]*\.(\w+)\s*;/.exec(contohBuruk);
assert.ok(ujiPola && GETTER_MAHAL.includes(ujiPola[1]),
  'pola pendeteksinya sendiri tidak cocok dengan contoh buruk — penjaganya tidak menjaga apa pun');

/* ==========================================================================
   2. HASIL: kolom kosong tidak boleh menggeser indeks
   ========================================================================== */

/**
 * Berkas xlsx kecil yang dibuat di tempat, dengan lubang di tengah.
 *
 * Lubangnya yang penting. `row.values` itu larik jarang — kolom yang tidak pernah diisi
 * tidak punya slot. Kalau dibaca dengan cara yang salah, kolom sesudah lubang bergeser
 * ke kiri, dan `COLUMN.outletCode` menunjuk data yang salah tanpa satu pun error.
 * Kode outlet yang bergeser jadi kode pos surat persis pernah terjadi di proyek ini.
 */
async function buatXlsx(dir) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(['A', 'B', 'C', 'D', 'E']);
  const baris = ws.addRow([]);
  baris.getCell(1).value = 'satu';
  // kolom 2 dan 3 sengaja DIBIARKAN kosong
  baris.getCell(4).value = 'empat';
  baris.getCell(5).value = 5;
  ws.addRow(['  spasi di ujung  ', '', '', '', '']);

  const file = path.join(dir, 'uji.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

async function test() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-xlsx-'));
  try {
    const rows = await readTable(await buatXlsx(dir));

    assert.strictEqual(rows.length, 3, 'jumlah baris salah');
    assert.deepStrictEqual(rows[0], ['A', 'B', 'C', 'D', 'E']);

    // Inti tesnya: 'empat' HARUS tetap di indeks 3 (kolom 4), bukan bergeser ke
    // indeks 1 karena dua kolom sebelumnya kosong.
    assert.deepStrictEqual(rows[1], ['satu', '', '', 'empat', '5'],
      'kolom kosong menggeser kolom sesudahnya — indeks COLUMN akan menunjuk data salah');

    // Spasi di ujung dibuang; itu yang membuat pencocokan nama kelurahan bekerja.
    assert.strictEqual(rows[2][0], 'spasi di ujung');

    // Berkas tanpa sheet dan format asing ditolak dengan pesan yang menyebut sebabnya.
    await assert.rejects(() => readTable(path.join(dir, 'x.pdf')),
      /format berkas tidak dikenal/i);

    // checkHeader tetap menolak berkas yang bukan laporan bulanan.
    assert.throws(() => checkHeader(['a', 'b']), /bukan laporan bulanan/i);

    console.log('OK xlsx — kolom kosong tidak menggeser indeks, spasi dibuang, ' +
      'nol getter mahal di kondisi loop');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test().catch((error) => { console.error(error); process.exit(1); });
