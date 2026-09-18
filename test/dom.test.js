/**
 * displayCityName() — satu-satunya tempat kata "Kabupaten" dipangkas dari TAMPILAN.
 *
 * KENAPA TES INI ADA. Permintaan tim: kata "Kabupaten" hilang dari layar, tapi kata
 * itu tetap harus terbaca di data yang DIIMPOR (city_name di database, pencocokan
 * nama kelurahan). Fungsi ini murni tampilan — tidak disentuh oleh jalur impor sama
 * sekali — jadi yang perlu dijaga cuma perilakunya sebagai fungsi teks, bukan lokasi
 * pemanggilannya (itu urusan tiap berkas yang memanggilnya).
 *
 * "Kota " SENGAJA tidak ikut dibuang: dijaga eksplisit di sini karena kesalahan yang
 * paling mudah terjadi justru regex yang kebablasan memangkas KEDUA kata itu sekaligus
 * — dan itu membuat "Kota Yogyakarta" tidak lagi bisa dibedakan dari kabupaten lain di
 * karesidenan yang sama.
 */
const assert = require('assert');
const { displayCityName } = require('../frontend/js/dom.js');

assert.strictEqual(displayCityName('Kabupaten Sleman'), 'Sleman',
  'awalan "Kabupaten " harus hilang');
assert.strictEqual(displayCityName('Kota Yogyakarta'), 'Kota Yogyakarta',
  '"Kota " BUKAN "Kabupaten" — harus dibiarkan apa adanya, kalau tidak dua wilayah ' +
  'berbeda jadi terlihat sama');
assert.strictEqual(displayCityName('KABUPATEN GUNUNGKIDUL'), 'GUNUNGKIDUL',
  'harus tidak peka huruf besar/kecil — data Excel tidak selalu konsisten kapitalnya');
assert.strictEqual(displayCityName('kabupaten   bantul'), 'bantul',
  'spasi ganda setelah "kabupaten" tidak boleh lolos jadi bagian nama');
assert.strictEqual(displayCityName('  Kabupaten Sleman  '), 'Sleman',
  'spasi di ujung string harus ikut terpangkas, bukan cuma awalan katanya');
assert.strictEqual(displayCityName('Bantul'), 'Bantul',
  'nama tanpa awalan apa pun harus kembali apa adanya');
assert.strictEqual(displayCityName(''), '', 'string kosong tidak boleh melempar galat');
assert.strictEqual(displayCityName(null), '', 'null tidak boleh melempar galat');
assert.strictEqual(displayCityName(undefined), '', 'undefined tidak boleh melempar galat');
assert.strictEqual(displayCityName('Kabupatenanto'), 'Kabupatenanto',
  '"Kabupaten" harus diikuti BATAS KATA (spasi) — nama yang kebetulan berawalan mirip ' +
  'tidak boleh ikut terpotong');

console.log('OK dom — displayCityName memangkas "Kabupaten " apa adanya, membiarkan ' +
  '"Kota " dan nama tanpa awalan, tahan huruf besar/kecil dan spasi ganda');
