/**
 * Panel Cakupan Sumber: checkbox pilih-sumber + pencarian.
 *
 * Diuji lewat handler yang SUNGGUHAN (`toggleSumberCakupan`, `cariCakupan`), bukan
 * lewat salinan logikanya — tes yang menguji salinan tidak menjaga apa pun, dan itu
 * sudah pernah terjadi di proyek ini (lihat CLAUDE.md, `test_halaman.js` versi lama).
 *
 * `fusion.js` bisa di-import di Node, tapi kedua handler itu menyentuh DOM lewat
 * `$()`. Jadi dipasang `document` tiruan seadanya: cukup untuk `getElementById`,
 * tidak lebih. Yang diperiksa tetap hasil akhirnya — teks HTML yang digambar.
 */
const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Nilai kotak cari yang dilihat `cariCakupan()`. Diubah tiap tes sebelum memanggilnya.
let nilaiKotakCari = '';

globalThis.document = {
  getElementById: (id) => (id === 'cs-cari' ? { value: nilaiKotakCari } : null),
};

const MODUL = pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'js', 'fusion.js')).href;

const DATA = {
  groupBy: 'kota',
  total: 5000,
  sumber: { ktp: 5000, servis: 300, kirim: 0 },
  rows: [
    { code: '34.04', name: 'Kabupaten Sleman', total: 2829, servis: 225, kirim: 0 },
    { code: '33.01', name: 'Kabupaten Cilacap', total: 2209, servis: 135, kirim: 0 },
    { code: '', name: null, total: 3, servis: 0, kirim: 0 },
  ],
};

/** Kembalikan centangan ke keadaan bawaan: KTP mati, servis dan kirim hidup. */
async function resetCentang(m) {
  const target = { ktp: false, servis: true, kirim: true };
  // Dibaca dari hasil gambarnya sendiri, bukan dari state internal — tesnya tidak
  // boleh tahu bentuk variabelnya.
  for (const kunci of ['ktp', 'servis', 'kirim']) {
    const label = { ktp: 'C · KTP', servis: 'B · Servis', kirim: 'A · Kirim' }[kunci];
    const adaSekarang = m.cakupanSumber(DATA).includes(label);
    if (adaSekarang !== target[kunci]) m.toggleSumberCakupan(kunci);
  }
  nilaiKotakCari = '';
  m.cariCakupan();
}

test('bawaan: bar Servis dan Kirim digambar, KTP tidak', async () => {
  const m = await import(MODUL);
  await resetCentang(m);
  const html = m.cakupanSumber(DATA);
  assert.ok(html.includes('B · Servis'), 'bar Servis harus ada');
  assert.ok(html.includes('A · Kirim'), 'bar Kirim harus ada');
  assert.ok(!html.includes('C · KTP'), 'bar KTP mati secara bawaan (selalu 100%)');
});

test('mencentang KTP memunculkan barnya beserta keterangan 100%', async () => {
  const m = await import(MODUL);
  await resetCentang(m);
  m.toggleSumberCakupan('ktp');
  const html = m.cakupanSumber(DATA);
  assert.ok(html.includes('C · KTP'), 'bar KTP harus muncul setelah dicentang');
  assert.match(html, /selalu 100%/,
    'kalau barnya penuh di semua baris, alasannya wajib dikatakan');
  await resetCentang(m);
});

test('semua centang dilepas: memberi tahu, bukan menampilkan daftar tanpa bar', async () => {
  const m = await import(MODUL);
  await resetCentang(m);
  m.toggleSumberCakupan('servis');
  m.toggleSumberCakupan('kirim');
  const html = m.cakupanSumber(DATA);
  assert.match(html, /Centang minimal satu sumber/);
  // 'Sleman', bukan 'Kabupaten Sleman': sejak displayCityName() (dom.js) memangkas
  // awalan "Kabupaten " dari tampilan, nama itu tidak pernah muncul apa adanya lagi —
  // memeriksa string lama akan selalu benar apa pun isi html-nya, bukan menjaga apa pun.
  assert.ok(!html.includes('Sleman'),
    'daftar nama tanpa satu pun bar terbaca seperti data yang hilang');
  await resetCentang(m);
});

test('pencarian benar-benar menyaring, dan cocoknya tidak peduli huruf besar-kecil', async () => {
  const m = await import(MODUL);
  await resetCentang(m);
  nilaiKotakCari = 'sleman';
  m.cariCakupan();
  const html = m.cakupanSumber(DATA);
  // Nama sumbernya di fixture DATA sengaja masih "Kabupaten Sleman" (bentuk mentah
  // dari database) — yang diperiksa di sini justru HASIL TAMPILANNYA sesudah
  // displayCityName() memangkas awalan itu, jadi dicari "Sleman" bukan "Kabupaten
  // Sleman". Pencariannya sendiri (cariCakupanTeks) tetap cocok tanpa peduli awalan
  // itu ada atau tidak, karena namaBaris() membandingkan versi yang SUDAH dipangkas.
  assert.ok(html.includes('Sleman'), 'yang cocok harus tetap tampil');
  assert.ok(!html.includes('Cilacap'), 'yang tidak cocok harus hilang');
  await resetCentang(m);
});

test('pencarian tanpa hasil mengatakan apa yang dicari', async () => {
  const m = await import(MODUL);
  await resetCentang(m);
  nilaiKotakCari = 'zzz tidak ada';
  m.cariCakupan();
  const html = m.cakupanSumber(DATA);
  assert.match(html, /Tidak ada yang cocok/);
  await resetCentang(m);
});

test('baris tanpa nama tetap bisa dicari lewat keterangannya', async () => {
  const m = await import(MODUL);
  await resetCentang(m);
  // Kota tanpa nama tampil sebagai "Kota tidak diketahui". Kalau pencarian memakai
  // r.name mentah, baris ini tidak akan pernah bisa ditemukan.
  nilaiKotakCari = 'tidak diketahui';
  m.cariCakupan();
  assert.match(m.cakupanSumber(DATA), /Kota tidak diketahui/);
  await resetCentang(m);
});

test('daftar dipotong 25, dan pemotongannya dikatakan', async () => {
  const m = await import(MODUL);
  await resetCentang(m);
  const banyak = {
    groupBy: 'kota',
    total: 3000,
    sumber: { ktp: 3000, servis: 100, kirim: 0 },
    rows: Array.from({ length: 30 }, (_, i) => ({
      code: `33.${i}`, name: `Kota ${i}`, total: 100 - i, servis: 5, kirim: 0,
    })),
  };
  const html = m.cakupanSumber(banyak);
  assert.match(html, /Menampilkan 25 teratas dari 30/,
    'daftar yang dipotong diam-diam membuat pembaca mengira itu seluruhnya');
  assert.ok(html.includes('Kota 0'), 'yang teratas harus ikut');
  assert.ok(!html.includes('Kota 29'), 'yang ke-30 tidak boleh ikut');
});

test('tanpa data sama sekali bukan error', async () => {
  const m = await import(MODUL);
  await resetCentang(m);
  assert.match(m.cakupanSumber({ rows: [], total: 0 }), /Belum ada data/);
  assert.match(m.cakupanSumber(null), /Belum ada data/);
});
