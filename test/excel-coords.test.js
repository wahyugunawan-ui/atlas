/**
 * Uji backend/core/excel-coords.js — pembuka sel ExcelJS dan parser koordinat.
 *
 * Yang dijaga: cellText() harus membuka DUA bentuk sel objek ExcelJS (formula
 * DAN rich-text), bukan cuma satu — cuma menangani satu bentuk itulah yang
 * pernah membuat kolom hasil VLOOKUP tertulis "[object Object]" ke database
 * (lihat backend/server/importer.js readXlsx(), docs/DECISIONS.md).
 */
const assert = require('assert');
const { cellText, parseLongLat } = require('../backend/core/excel-coords');

function test() {
  /* ------------------------------------------------------------------
     cellText()
     ------------------------------------------------------------------ */
  assert.strictEqual(cellText('polos'), 'polos', 'nilai polos tidak boleh berubah');
  assert.strictEqual(cellText(42), 42, 'angka polos tidak boleh berubah');
  assert.strictEqual(cellText(null), null);
  assert.strictEqual(cellText(undefined), undefined);

  // Sel formula: {formula, result} -> .result. Ini bentuk sel hasil VLOOKUP.
  assert.strictEqual(
    cellText({ formula: 'VLOOKUP(A1,Sheet1!A:B,2,FALSE)', result: 'NUSANTARA SAKTI' }),
    'NUSANTARA SAKTI',
    'sel formula tidak dibuka ke .result — inilah asal "[object Object]"');

  // Sel rich-text/hyperlink: {text, hyperlink} -> .text.
  assert.strictEqual(
    cellText({ text: 'ASTRA MOTOR', hyperlink: 'https://contoh' }),
    'ASTRA MOTOR',
    'sel rich-text/hyperlink tidak dibuka ke .text');

  // Objek TANPA .result maupun .text (bentuk tak dikenal) dikembalikan apa
  // adanya — pemanggil (readXlsx) yang membungkusnya dengan String(), bukan
  // cellText() menebak-nebak bentuk yang tidak dikenalnya.
  const asing = { entah: 'apa' };
  assert.strictEqual(cellText(asing), asing);

  /* ------------------------------------------------------------------
     parseLongLat()
     ------------------------------------------------------------------ */
  assert.deepStrictEqual(parseLongLat('-7.79558, 110.36949'), { lat: -7.79558, lng: 110.36949 });
  assert.deepStrictEqual(parseLongLat(';-7.51, 109.29'), { lat: -7.51, lng: 109.29 },
    'tanda baca liar di depan seharusnya tidak menggagalkan pengambilan pasangan angka');
  assert.strictEqual(parseLongLat('bukan koordinat'), null);
  assert.strictEqual(parseLongLat(''), null);
  assert.strictEqual(parseLongLat(null), null);

  console.log('OK excel-coords — cellText membuka sel formula DAN rich-text, ' +
    'parseLongLat toleran terhadap tanda baca liar');
}

test();
