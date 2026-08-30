/**
 * Uji backend/core/pos-diff.js — murni, tanpa database.
 *
 * Yang dijaga: field yang sama tidak ikut masuk `changed` (kalau tidak, pratinjau
 * penuh baris "berubah" padahal isinya identik), duplikat outlet_code di Excel
 * dilaporkan di `multiCandidate` bukan dipilih diam-diam, dan outlet_code yang belum
 * ada di database masuk `added` TANPA pernah ditulis ke mana pun — modul ini murni.
 */
const assert = require('assert');
const { diffOutletImport } = require('../backend/core/pos-diff');

function test() {
  const known = [
    { outletCode: 'O01', outletName: 'Pos Satu', address: 'Jl. Satu' },
    { outletCode: 'O02', outletName: 'Pos Dua', address: null },
    { outletCode: 'O03', outletName: 'Pos Tiga', address: 'Jl. Tiga' },
  ];

  // --- field yang sama tidak ikut changed ---
  const sama = diffOutletImport(
    [{ outletCode: 'O01', outletName: 'Pos Satu', address: 'Jl. Satu' }], known);
  assert.strictEqual(sama.changed.length, 0, 'baris identik ikut masuk changed');
  assert.strictEqual(sama.unchanged, 1);

  // --- satu field beda, satu sama: cuma yang beda yang dilaporkan ---
  const satuBeda = diffOutletImport(
    [{ outletCode: 'O01', outletName: 'Pos Satu Baru', address: 'Jl. Satu' }], known);
  assert.strictEqual(satuBeda.changed.length, 1,
    'field yang tidak berubah ikut dilaporkan, atau field yang berubah tidak terdeteksi');
  assert.strictEqual(satuBeda.changed[0].field, 'outletName');
  assert.strictEqual(satuBeda.changed[0].oldValue, 'Pos Satu');
  assert.strictEqual(satuBeda.changed[0].newValue, 'Pos Satu Baru');
  assert.strictEqual(satuBeda.unchanged, 0);

  // --- address null di database vs alamat baru di Excel juga terdeteksi ---
  const isiAlamat = diffOutletImport(
    [{ outletCode: 'O02', outletName: 'Pos Dua', address: 'Jl. Dua Sekarang Ada' }], known);
  assert.strictEqual(isiAlamat.changed.length, 1);
  assert.strictEqual(isiAlamat.changed[0].field, 'address');
  assert.strictEqual(isiAlamat.changed[0].oldValue, null);

  // --- duplikat outlet_code di Excel: dilaporkan, kandidat pertama yang dipakai ---
  const duplikat = diffOutletImport([
    { outletCode: 'O03', outletName: 'Pos Tiga Kandidat Satu', address: 'Jl. Tiga' },
    { outletCode: 'O03', outletName: 'Pos Tiga Kandidat Dua', address: 'Jl. Tiga Lain' },
  ], known);
  assert.strictEqual(duplikat.multiCandidate.length, 1,
    'outlet_code yang muncul dua kali di Excel tidak dilaporkan ke multiCandidate');
  assert.strictEqual(duplikat.multiCandidate[0].outletCode, 'O03');
  assert.strictEqual(duplikat.multiCandidate[0].count, 2);
  assert.strictEqual(duplikat.changed.length, 1,
    'kandidat yang dipakai harus yang PERTAMA muncul di Excel');
  assert.strictEqual(duplikat.changed[0].newValue, 'Pos Tiga Kandidat Satu');

  // --- baris tanpa outletCode atau outletName: invalid, tidak ikut dihitung apa pun ---
  const rusak = diffOutletImport([
    { outletCode: '', outletName: 'Tanpa Kode', address: '' },
    { outletCode: 'O99', outletName: '', address: '' },
  ], known);
  assert.strictEqual(rusak.invalid.length, 2, 'baris yang cacat tidak terdeteksi keduanya');
  assert.strictEqual(rusak.added.length, 0, 'baris invalid ikut masuk added');
  assert.strictEqual(rusak.changed.length, 0);

  // --- outlet_code baru: masuk added, database (known) tidak disentuh ---
  const knownSalinan = JSON.parse(JSON.stringify(known));
  const baru = diffOutletImport(
    [{ outletCode: 'O04', outletName: 'Pos Baru', address: 'Jl. Baru' }], known);
  assert.strictEqual(baru.added.length, 1);
  assert.strictEqual(baru.added[0].outletCode, 'O04');
  assert.strictEqual(baru.changed.length, 0, 'outlet baru seharusnya tidak masuk changed');
  assert.deepStrictEqual(known, knownSalinan, 'diffOutletImport() mengubah array known — modul ini harus murni');

  console.log('OK pos-diff — field sama tidak ikut changed, duplikat dilaporkan ' +
    '(kandidat pertama dipakai), baris cacat masuk invalid, outlet baru masuk added ' +
    'tanpa menyentuh known');
}

test();
