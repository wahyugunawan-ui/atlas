/**
 * Uji pembagi dalam/luar jangkauan, khususnya kelurahan yang BELUM punya batas wilayah.
 *
 * KENAPA INI ADA. Kelurahan yang ditambah lewat aplikasi tidak punya poligon —
 * poligonnya datang dari pipeline geo, bukan dari ketikan. Tanpa poligon, rasio
 * jangkauannya selalu 0.
 *
 * Nol itu AMBIGU, dan di situlah bahayanya: "0% terjangkau" dan "belum bisa dihitung"
 * terlihat sama persis di layar. Kalau yang kedua ikut masuk penyebut, tiap kelurahan
 * baru yang ditambahkan MENURUNKAN persentase jangkauan — dan turunnya tampak seperti
 * temuan bisnis ("jangkauan kita memburuk") padahal cuma data yang belum lengkap.
 *
 * Yang dijaga di sini: penjualan di kelurahan tanpa batas dikeluarkan dari hitungan
 * DAN dilaporkan terpisah. Dua-duanya perlu — dikeluarkan tanpa dilaporkan berarti
 * datanya hilang diam-diam, yang sama buruknya.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/**
 * Muat splitByCoverage() dari modul frontend.
 *
 * Berkasnya modul ES yang mengimpor state; di sini badan fungsinya diambil dan
 * dijalankan dengan S palsu. Menyalin logikanya ke tes akan menguji salinan, bukan
 * kode yang benar-benar dipakai halaman.
 */
function loadSplit(S) {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'filters.js'), 'utf8');
  const mulai = src.indexOf('export function splitByCoverage');
  assert.ok(mulai >= 0, 'splitByCoverage tidak ditemukan di filters.js');
  const akhir = src.indexOf('\n}', mulai) + 2;
  const body = src.slice(mulai, akhir).replace('export function', 'function');

  const sandbox = { S, hasil: null };
  vm.createContext(sandbox);
  vm.runInContext(`${body}; hasil = splitByCoverage;`, sandbox);
  return sandbox.hasil;
}

/** Dua kelurahan: satu berpoligon, satu belum. Satu pos, jangkauan 50% di yang pertama. */
const S = {
  coverage: { O1: { 'ADA': 0.5 } },
  villageByCode: {
    ADA: { code: 'ADA', hasGeom: true },
    BELUM: { code: 'BELUM', hasGeom: false },
  },
};

const split = loadSplit(S);

// --- hanya kelurahan berpoligon ---
const a = split([{ outlet: 'O1', village: 'ADA', units: 100 }]);
assert.strictEqual(a.total, 100);
assert.strictEqual(a.inside, 50);
assert.strictEqual(a.outside, 50);
assert.strictEqual(a.noBoundary, 0);

// --- kelurahan tanpa batas TIDAK boleh mengubah persentase ---
//
// Ini inti tesnya. Menambah 900 unit di kelurahan tanpa batas ke data yang sama:
// persentasenya harus TETAP 50%, bukan turun jadi 5%.
const b = split([
  { outlet: 'O1', village: 'ADA', units: 100 },
  { outlet: 'O1', village: 'BELUM', units: 900 },
]);
assert.strictEqual(b.total, 100,
  'kelurahan tanpa batas ikut masuk penyebut — persentase turun tanpa sebab yang terlihat');
assert.strictEqual(b.inside, 50);
assert.strictEqual(b.outside, 50);
assert.strictEqual((b.inside / b.total) * 100, 50,
  'persentase berubah gara-gara kelurahan yang belum punya batas wilayah');

// --- tapi unitnya TIDAK boleh hilang begitu saja ---
assert.strictEqual(b.noBoundary, 900,
  'unit di kelurahan tanpa batas hilang tanpa dilaporkan — sama buruknya dengan salah hitung');

// --- kelurahan yang tidak dikenal sama sekali tetap dihitung apa adanya ---
//
// Beda dari "tahu belum punya batas": kelurahan yang tidak ada di villageByCode berarti
// datanya memang di luar cakupan, dan itu memang "di luar jangkauan" yang jujur.
const c = split([{ outlet: 'O1', village: 'ASING', units: 10 }]);
assert.strictEqual(c.total, 10, 'kelurahan tak dikenal seharusnya tetap masuk penyebut');
assert.strictEqual(c.inside, 0);
assert.strictEqual(c.noBoundary, 0);

// --- semuanya tanpa batas: jangan bagi nol ---
const d = split([{ outlet: 'O1', village: 'BELUM', units: 500 }]);
assert.strictEqual(d.total, 0);
assert.strictEqual(d.noBoundary, 500);
assert.ok(Number.isFinite(d.inside) && d.inside === 0, 'inside harus 0, bukan NaN');

console.log('OK coverage-split — kelurahan tanpa batas dikeluarkan dari persentase ' +
  'dan tetap dilaporkan, kelurahan tak dikenal tetap dihitung');
