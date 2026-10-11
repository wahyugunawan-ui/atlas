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

/**
 * labelKota() — jalan keluar waktu nama kotanya memang tidak ada.
 *
 * Tabel wilayah cuma memuat Jateng + DIY, jadi pelanggan ber-KTP Jakarta/Tangerang/
 * Bandung yang membeli di wilayah cakupan muncul TANPA nama kota. Sampai 2026-09-18
 * baris itu tampil sebagai kode telanjang ("31.74") di Matriks dan Peringkat Kota,
 * dan terbaca seperti data rusak oleh pengguna non-IT.
 *
 * Yang dijaga di sini terutama dua hal yang gampang rusak diam-diam: kode TIDAK boleh
 * hilang dari kalimatnya (itu satu-satunya pegangan untuk menelusuri baris tersebut),
 * dan nama yang ADA tidak boleh ikut dibungkus "Luar cakupan" cuma karena kodenya
 * kebetulan ikut dioper.
 */
const { labelKota } = require('../frontend/js/dom.js');

assert.strictEqual(labelKota('Kabupaten Sleman', '34.04'), 'Sleman',
  'nama yang ada tetap menang, dan "Kabupaten " tetap dipangkas seperti biasa');
assert.strictEqual(labelKota('Kota Yogyakarta', '34.71'), 'Kota Yogyakarta',
  'nama yang ada TIDAK boleh berubah jadi "Luar cakupan" cuma karena kodenya dioper');
assert.strictEqual(labelKota(null, '31.74'), 'Luar cakupan (31.74)',
  'kota tanpa nama harus dijelaskan, bukan ditampilkan sebagai kode telanjang');
assert.strictEqual(labelKota('', '36.73'), 'Luar cakupan (36.73)',
  'nama string kosong sama saja dengan tidak ada nama');
assert.strictEqual(labelKota('   ', '35.22'), 'Luar cakupan (35.22)',
  'nama berisi spasi saja bukan nama');
assert.ok(labelKota(null, '31.74').includes('31.74'),
  'kodenya WAJIB ikut tersebut — tanpa itu baris tersebut tidak bisa ditelusuri lagi');
assert.strictEqual(labelKota(null, null), '—',
  'tanpa nama DAN tanpa kode, tanda hubung — bukan "Luar cakupan ()" yang menggantung');
assert.strictEqual(labelKota(undefined, undefined), '—',
  'undefined tidak boleh melempar galat');
assert.strictEqual(labelKota(null, '  '), '—',
  'kode berisi spasi saja bukan kode');

console.log('OK dom — labelKota menjelaskan kota luar cakupan dengan kodenya tetap ' +
  'tersebut, dan tidak menyentuh kota yang namanya memang ada');

/* --------------------------------------------------------------------------
   diAtasMarker — penangan peta mundur selama kursor di atas ikon pos/dealer
   --------------------------------------------------------------------------
   Tanpa ini penangan mousemove poligon kecamatan dan titik KTP/Servis menimpa tooltip
   ikon (nama pos/dealer) dengan ringkasan kecamatan atau kartu orang. Fungsinya kecil, tapi
   kalau salah, hover ikon tampak "tidak berfungsi" tanpa satu pun galat.
   -------------------------------------------------------------------------- */
const { diAtasMarker } = require('../frontend/js/dom.js');
const fakeEl = (cocok) => ({ closest: (sel) => (sel === '.marker-outlet' && cocok ? {} : null) });
assert.strictEqual(diAtasMarker({ target: fakeEl(true) }), true,
  'kursor di atas ikon (atau anaknya, mis. <i>) tidak dikenali sebagai marker');
assert.strictEqual(diAtasMarker({ target: fakeEl(false) }), false,
  'kursor di atas kanvas dikira di atas marker — tooltip kecamatan tidak akan pernah tampil');
assert.strictEqual(diAtasMarker(undefined), false, 'tanpa kejadian tidak boleh melempar galat');
assert.strictEqual(diAtasMarker({}), false, 'kejadian tanpa target tidak boleh melempar galat');
assert.strictEqual(diAtasMarker({ target: {} }), false, 'target tanpa closest() tidak boleh melempar galat');
console.log('OK dom — diAtasMarker mengenali kursor di atas ikon pos/dealer, aman terhadap masukan kosong');

/* --------------------------------------------------------------------------
   setTooltipJenis — tooltip pos/dealer biru MUDA, kecamatan biru tua, orang putih
   --------------------------------------------------------------------------
   Satu elemen #tooltip dipakai semua penangan hover. Kalau kelas jenis sebelumnya tidak
   dibuang, biru muda milik ikon menempel di tooltip kecamatan (dua jenis jadi sama, padahal
   perbedaan warna itu seluruh permintaannya) dan kartu putih titik orang menempel di
   tooltip nama (tulisan terang di atas putih tidak terbaca).
   -------------------------------------------------------------------------- */
const { setTooltipJenis } = require('../frontend/js/dom.js');
const fakeTip = () => {
  const kelas = new Set(['float-tooltip', 'show']);
  return { kelas, classList: { add: (k) => kelas.add(k), remove: (k) => kelas.delete(k) } };
};
const tip = fakeTip();
setTooltipJenis(tip, 'marker');
assert.deepStrictEqual([...tip.kelas].sort(), ['float-tooltip', 'kartu-marker', 'show'],
  'jenis marker harus memasang kartu-marker dan membiarkan kelas lain');
setTooltipJenis(tip, 'orang');
assert.ok(tip.kelas.has('kartu-orang') && !tip.kelas.has('kartu-marker'),
  'kartu-marker menempel waktu berganti ke kartu orang');
setTooltipJenis(tip, 'marker');
assert.ok(tip.kelas.has('kartu-marker') && !tip.kelas.has('kartu-orang'),
  'kartu-orang menempel di tooltip pos/dealer — tulisannya hilang di atas putih');
setTooltipJenis(tip, 'ringkasan');
assert.deepStrictEqual([...tip.kelas].sort(), ['float-tooltip', 'show'],
  'jenis ringkasan (kecamatan) harus polos: tanpa kelas jenis apa pun');
setTooltipJenis(null, 'marker');   // elemen tidak ada: tidak melempar galat
console.log('OK dom — setTooltipJenis memasang tepat satu jenis tooltip (marker biru muda / orang putih / ' +
  'ringkasan polos) dan membuang jenis sebelumnya');
