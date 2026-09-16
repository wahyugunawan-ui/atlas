/**
 * fusionFilter(): bilah filter -> parameter API penyatuan tiga sumber.
 *
 * Yang dijaga di sini SIFATNYA, bukan bentuk kodenya: kalau suatu hari halaman fusion
 * diam-diam berhenti mengirim saringannya, angka yang tampil akan jadi angka
 * se-provinsi sementara dropdownnya menunjuk satu dealer — salah yang tidak kelihatan
 * salah. Itu persis keadaan yang diperbaiki hari ini.
 */
const assert = require('node:assert');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const MODUL = pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'js', 'filters.js')).href;

const filter = (patch) => Object.assign({
  from: 'ALL', to: 'ALL', kares: 'ALL',
  cityCode: 'ALL', dealerCode: 'ALL', outletCode: 'ALL',
}, patch);

test('ALL berarti tanpa saringan, bukan teks "ALL"', async () => {
  const { fusionFilter } = await import(MODUL);
  const hasil = fusionFilter(filter());
  assert.strictEqual(hasil.kota, null);
  assert.strictEqual(hasil.dealer, null);
  assert.strictEqual(hasil.periode, null);
  assert.deepStrictEqual(hasil.abaikan, []);
});

test('kota dan dealer yang dipilih ikut terkirim', async () => {
  const { fusionFilter } = await import(MODUL);
  const hasil = fusionFilter(filter({
    cityCode: '34.04', dealerCode: 'NUSANTARASAKTIGEJAYAN',
  }));
  assert.strictEqual(hasil.kota, '34.04');
  assert.strictEqual(hasil.dealer, 'NUSANTARASAKTIGEJAYAN');
});

test('rentang periode diciutkan ke batas ATAS, bukan batas bawah', async () => {
  const { fusionFilter } = await import(MODUL);
  // Rollup disimpan per satu periode. Memakai `from` akan menampilkan bulan yang
  // BUKAN bulan yang diminta orang, tanpa satu pun pesan.
  const hasil = fusionFilter(filter({ from: '2026-06', to: '2026-08' }));
  assert.strictEqual(hasil.periode, '2026-08');
});

test('periode yang belum lengkap tidak dikirim setengah jadi', async () => {
  const { fusionFilter } = await import(MODUL);
  // Bilah sempat bernilai '2026' saat orang baru memilih tahunnya. Mengirim itu
  // sebagai periode membuat server menjawab kosong; yang benar = periode terbaru.
  assert.strictEqual(fusionFilter(filter({ to: '2026' })).periode, null);
  assert.strictEqual(fusionFilter(filter({ to: '' })).periode, null);
});

test('pos dan karesidenan dilaporkan sebagai diabaikan, bukan didiamkan', async () => {
  const { fusionFilter } = await import(MODUL);
  // Keduanya tidak ada di segment_rollup. Halaman WAJIB bisa mengatakannya, kalau
  // tidak angka se-provinsi terbaca sebagai angka pos yang dipilih.
  const hasil = fusionFilter(filter({ outletCode: 'POS01', kares: 'KEDU' }));
  assert.deepStrictEqual(hasil.abaikan, ['pos', 'karesidenan']);
  assert.ok(!('outletCode' in hasil), 'pos tidak boleh diam-diam jadi saringan');
});

test('persenSumber membedakan "nol" dari "belum bisa diukur"', async () => {
  const { persenSumber } = await import(MODUL);
  // Bedanya penting di panel Cakupan Sumber: 0% berarti diukur dan hasilnya nol,
  // sedangkan tanpa pembagi berarti tidak ada yang bisa diukur sama sekali. Kalau
  // keduanya jadi 0, bar kosong terbaca sebagai fakta padahal belum ada datanya.
  assert.strictEqual(persenSumber(0, 100), 0);
  assert.strictEqual(persenSumber(5, 0), null);
  assert.strictEqual(persenSumber(0, 0), null);
});

test('persenSumber membulatkan, dan nilai kosong dihitung nol', async () => {
  const { persenSumber } = await import(MODUL);
  assert.strictEqual(persenSumber(50, 200), 25);
  assert.strictEqual(persenSumber(1, 3), 33);
  assert.strictEqual(persenSumber(2, 3), 67);
  // `kirim` datang dari SQL sebagai null waktu belum ada ping sama sekali.
  assert.strictEqual(persenSumber(null, 100), 0);
});
