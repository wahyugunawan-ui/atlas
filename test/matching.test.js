/**
 * Uji saran padanan nama kelurahan.
 *
 * Yang dijaga di sini bukan "levenshteinnya benar" — itu algoritma buku teks yang
 * gagalnya berisik. Yang dijaga adalah PERINGKATNYA, dan itu gagalnya diam: saran yang
 * salah urut tetap terlihat masuk akal di layar, dan orang yang mengeklik tombol
 * pertama akan menempelkan penjualan ke kelurahan yang salah tanpa satu pun gejala.
 *
 * Murni, jadi tidak butuh PostgreSQL.
 */
const assert = require('assert');
const { levenshtein, maxDistance, suggestVillages } = require('../backend/core/matching');

/* ==========================================================================
   1. jarak sunting
   ========================================================================== */

assert.strictEqual(levenshtein('', ''), 0);
assert.strictEqual(levenshtein('ABC', ''), 3);
assert.strictEqual(levenshtein('', 'ABC'), 3);
assert.strictEqual(levenshtein('ABC', 'ABC'), 0);
assert.strictEqual(levenshtein('ABC', 'ABD'), 1, 'ganti satu huruf');
assert.strictEqual(levenshtein('ABC', 'AC'), 1, 'hapus satu huruf');
assert.strictEqual(levenshtein('AC', 'ABC'), 1, 'sisip satu huruf');
assert.strictEqual(levenshtein('KITTEN', 'SITTING'), 3, 'contoh baku levenshtein');

// Simetris. Kalau tidak, urutan argumen jadi berarti dan hasilnya berubah tergantung
// siapa yang memanggil — bug yang cuma muncul di sebagian kandidat.
assert.strictEqual(levenshtein('TEGALREJO', 'TEGALREJA'),
  levenshtein('TEGALREJA', 'TEGALREJO'));

/* ==========================================================================
   2. batas kemiripan ikut panjang nama
   ========================================================================== */

// Batas tetap akan salah di salah satu ujungnya: jarak 3 pada kata 4 huruf berarti
// hampir seluruhnya berbeda, jarak 3 pada kata 12 huruf cuma beda ejaan.
assert.strictEqual(maxDistance(4), 2, 'nama pendek diberi kelonggaran minimal 2');
assert.strictEqual(maxDistance(9), 3);
assert.strictEqual(maxDistance(12), 4);

/* ==========================================================================
   3. peringkat saran
   ========================================================================== */

const KANDIDAT = [
  { code: '33.01.01.2001', name: 'Tambakreja', district: 'Kedungreja' },
  { code: '33.01.20.2004', name: 'Tambakreja', district: 'Cilacap Selatan' },
  { code: '33.01.01.2002', name: 'Tambakrejo', district: 'Kedungreja' },
  { code: '33.01.01.2003', name: 'Sidanegara', district: 'Kedungreja' },
];

// KECAMATAN MENANG ATAS JARAK. Cilacap sungguhan punya dua "Tambakreja" di kecamatan
// berbeda; keduanya berjarak 0 dari nama yang dicari, jadi jarak saja tidak bisa
// memisahkan mereka. Yang sekecamatan hampir pasti yang dimaksud.
const dua = suggestVillages('Tambakreja', 'Kedungreja', KANDIDAT, 5);
assert.strictEqual(dua[0].code, '33.01.01.2001',
  'kelurahan senama di kecamatan LAIN disarankan lebih dulu — penjualannya akan ' +
  'menempel ke kelurahan yang salah dan tidak ada gejala apa pun di layar');
assert.strictEqual(dua[0].sameDistrict, true);

// Dan yang sekecamatan tapi ejaannya agak beda tetap menang atas yang PERSIS SAMA
// namanya di kecamatan lain — jarak 1 sekecamatan mengalahkan jarak 0 di kecamatan lain.
const urut = dua.map((s) => s.code);
assert.ok(urut.includes('33.01.01.2002') && urut.includes('33.01.20.2004'),
  'prasyarat tes: kedua kandidat harus lolos batas kemiripan');
assert.ok(urut.indexOf('33.01.01.2002') < urut.indexOf('33.01.20.2004'),
  'kandidat di kecamatan lain menyalip kandidat sekecamatan');

// Yang jauh berbeda TIDAK ikut. Daftar panjang berisi tebakan asal membuat orang
// berhenti membaca dan langsung mengeklik yang teratas.
assert.ok(!dua.some((s) => s.code === '33.01.01.2003'),
  '"Sidanegara" disarankan untuk "Tambakreja" — batas kemiripannya tidak bekerja');

/* ==========================================================================
   4. normalisasi sama dengan yang dipakai impor
   ========================================================================== */

// Perbandingannya harus memakai normalizeName() yang sama dengan regionKey(). Kalau
// tidak, saran bisa menyebut padanan yang menurut impor tidak pernah cocok.
const spasi = suggestVillages('TIRTA RAHAYU', 'Galur',
  [{ code: '34.01.01.2001', name: 'Tirtorahayu', district: 'Galur' }], 5);
assert.strictEqual(spasi.length, 1, 'spasi dan besar-kecil huruf tidak dinormalkan');
assert.strictEqual(spasi[0].distance, 1);

// Nama kosong tidak menghasilkan saran apa pun. Tanpa penjagaan ini, jaraknya diukur
// dari teks kosong dan SEMUA kelurahan pendek terlihat mirip.
assert.deepStrictEqual(suggestVillages('', 'Galur', KANDIDAT, 5), []);
assert.deepStrictEqual(suggestVillages('   ', 'Galur', KANDIDAT, 5), []);

// Batas jumlah dipatuhi.
assert.ok(suggestVillages('Tambakreja', 'Kedungreja', KANDIDAT, 1).length === 1);

// Kandidat kosong bukan error — kabupaten luar provinsi memang tidak punya kandidat.
assert.deepStrictEqual(suggestVillages('Apa Saja', 'Entah', [], 5), []);

/* ==========================================================================
   5. varian ejaan sungguhan dari data Agustus 2026
   ========================================================================== */

// Enam ini diambil dari 165 baris yang belum cocok di data asli. Semuanya kelurahan
// yang SUDAH ada di database berpoligon, cuma beda ejaan di Excel.
[
  ['TEGALREJO', 'Tegalreja'],
  ['PABUARAN', 'Pabuwaran'],
  ['KEWAYUHAN', 'Kuwayuhan'],
  ['JATINEGORO', 'Jatinegara'],
  ['KEMANGGUHAN', 'Kemangguan'],
  ['TIRTA RAHAYU', 'Tirtorahayu'],
].forEach(([dariExcel, diDatabase]) => {
  const hasil = suggestVillages(dariExcel, 'Kecamatan X',
    [{ code: '33.99.99.9999', name: diDatabase, district: 'Kecamatan X' }], 5);
  assert.strictEqual(hasil.length, 1,
    `"${dariExcel}" tidak menyarankan "${diDatabase}" — batas kemiripannya terlalu ketat`);
});

console.log('OK matching — jarak sunting, batas ikut panjang, kecamatan menang atas jarak');
