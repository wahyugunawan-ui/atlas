/**
 * Uji penerjemah placeholder dan pembangun VALUES borongan.
 *
 * Keduanya ada supaya ~60 titik query tidak perlu ditulis ulang waktu pindah dari
 * MySQL ke PostgreSQL. Itu menghemat banyak, tapi memindahkan risikonya ke satu
 * tempat: kalau penerjemahnya salah menomori, SEMUA query ikut salah, dan gejalanya
 * muncul jauh dari sebabnya.
 *
 * Yang paling berbahaya: tanda tanya di dalam string literal. `WHERE nama = 'apa?'`
 * bukan parameter, tapi penerjemah yang naif akan menomorinya dan menggeser semua
 * parameter sesudahnya — query tetap jalan, hasilnya cuma salah.
 */
const assert = require('assert');
const { toPositional, bulkValues } = require('../backend/server/db');

// --- penomoran dasar ---
assert.strictEqual(
  toPositional('SELECT * FROM sales WHERE period = ? AND outlet_code = ?'),
  'SELECT * FROM sales WHERE period = $1 AND outlet_code = $2');

// SQL tanpa tanda tanya dikembalikan apa adanya, termasuk yang sudah bergaya $n.
assert.strictEqual(toPositional('SELECT 1'), 'SELECT 1');
assert.strictEqual(
  toPositional('SELECT * FROM v WHERE code = $1'),
  'SELECT * FROM v WHERE code = $1');

// --- tanda tanya di dalam string literal TIDAK boleh dinomori ---
assert.strictEqual(
  toPositional("SELECT * FROM v WHERE name = 'apa?' AND code = ?"),
  "SELECT * FROM v WHERE name = 'apa?' AND code = $1",
  'tanda tanya di dalam kutip ikut dinomori — semua parameter sesudahnya bergeser');

// Kutip yang di-escape dengan menggandakan tidak boleh dikira penutup.
assert.strictEqual(
  toPositional("SELECT 'bukan '' penutup ?' , ?"),
  "SELECT 'bukan '' penutup ?' , $1");

// Nama berkutip ganda diperlakukan sama.
assert.strictEqual(
  toPositional('SELECT "kolom?" FROM t WHERE a = ?'),
  'SELECT "kolom?" FROM t WHERE a = $1');

// --- tanda tanya di dalam komentar ---
assert.strictEqual(
  toPositional('SELECT 1 -- benarkah?\nWHERE a = ?'),
  'SELECT 1 -- benarkah?\nWHERE a = $1');
assert.strictEqual(
  toPositional('SELECT /* kenapa? */ 1 WHERE a = ?'),
  'SELECT /* kenapa? */ 1 WHERE a = $1');

// --- VALUES borongan ---
const bulk = bulkValues([['a', 1], ['b', 2], ['c', 3]]);
assert.strictEqual(bulk.text, '($1,$2),($3,$4),($5,$6)');
assert.deepStrictEqual(bulk.params, ['a', 1, 'b', 2, 'c', 3]);

// Nomornya harus lanjut dari parameter yang sudah terpakai, bukan mulai dari 1 lagi.
const lanjut = bulkValues([['x']], 2);
assert.strictEqual(lanjut.text, '($3)');

// Jumlah placeholder harus persis sama dengan jumlah parameter. Kalau tidak, Postgres
// menolak dengan pesan yang tidak menyebut baris mana yang salah.
const besar = bulkValues(Array.from({ length: 40 }, (_, i) => [i, `n${i}`, i * 2]));
assert.strictEqual(besar.text.match(/\$/g).length, besar.params.length);
assert.strictEqual(besar.params.length, 120);

console.log('OK db — penerjemah melewati string dan komentar, VALUES borongan sinkron');
