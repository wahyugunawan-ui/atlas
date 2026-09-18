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

test('pos TIDAK terkirim — dihapus dari halaman ini 2026-09-18', async () => {
  const { fusionFilter } = await import(MODUL);
  // Riwayatnya bolak-balik. Sampai 2026-09-17 pos masuk daftar `abaikan`; sehari
  // sesudahnya sempat DIKIRIM (server menerjemahkannya lewat tabel coverage); sekarang
  // dihapus lagi atas permintaan tim — satu pos cuma melayani sebagian kecil kelurahan
  // satu kota, jadi menyaring sesempit itu jarang berarti apa pun untuk penggolongan.
  // Bukan `abaikan` juga: itu daftar untuk saringan yang PERNAH dikirim tapi diabaikan
  // server; pos sekarang tidak pernah dikirim sama sekali dari fungsi ini.
  const hasil = fusionFilter(filter({ outletCode: 'POS01' }));
  assert.strictEqual(hasil.pos, undefined,
    'fusionFilter() tidak boleh lagi punya field pos sama sekali');
  assert.deepStrictEqual(hasil.abaikan, []);
});

test('karesidenan jadi DAFTAR kode kota, bukan diabaikan', async () => {
  const { fusionFilter } = await import(MODUL);
  // Sampai 2026-09-17 karesidenan masuk daftar `abaikan`. Sekarang ia diterjemahkan
  // di sini jadi daftar kode kota, dan server memvalidasi tiap kodenya.
  const hasil = fusionFilter(filter({ kares: 'kedu' }));
  assert.deepStrictEqual(hasil.kotaBanyak, ['33.08', '33.23', '33.06', '33.05', '33.07']);
  assert.deepStrictEqual(hasil.abaikan, []);
  assert.strictEqual(hasil.kota, null);
});

test('Kota yang dipilih eksplisit MENANG atas karesidenan', async () => {
  const { fusionFilter } = await import(MODUL);
  // Keduanya boleh menyala bersamaan (kares mandiri dari kota/dealer/pos). Kota
  // lebih sempit; mengirim keduanya akan melebarkan hasil, bukan mempersempitnya.
  const hasil = fusionFilter(filter({ kares: 'kedu', cityCode: '33.08' }));
  assert.strictEqual(hasil.kota, '33.08');
  assert.strictEqual(hasil.kotaBanyak, null);
});

test('karesidenan yang tidak dikenal tidak melahirkan daftar karangan', async () => {
  const { fusionFilter } = await import(MODUL);
  assert.strictEqual(fusionFilter(filter({ kares: 'tidak-ada' })).kotaBanyak, null);
});

test('rentang periode yang diciutkan DIKATAKAN, bukan didiamkan', async () => {
  const { fusionFilter } = await import(MODUL);
  // Orang memilih Juni–Agustus dan mendapat Agustus saja. Dulu itu cuma tertulis di
  // komentar kode; sekarang muncul di layar.
  const rentang = fusionFilter(filter({ from: '2026-06', to: '2026-08' }));
  assert.deepStrictEqual(rentang.abaikan, ['rentang']);
  assert.strictEqual(rentang.periode, '2026-08');

  // Satu bulan yang sama di kedua ujung bukan penciutan, jadi tidak ada yang perlu
  // dikatakan — pita kuning yang muncul tanpa sebab justru melatih orang mengabaikannya.
  assert.deepStrictEqual(
    fusionFilter(filter({ from: '2026-08', to: '2026-08' })).abaikan, []);
  assert.deepStrictEqual(fusionFilter(filter({ to: '2026-08' })).abaikan, []);
});

test('putaran Live melingkar dan selalu melewati "Semua"', async () => {
  const { kotaBerikutnya } = await import(MODUL);
  const daftar = ['ALL', '34.04', '33.01'];
  assert.strictEqual(kotaBerikutnya('ALL', daftar), '34.04');
  assert.strictEqual(kotaBerikutnya('34.04', daftar), '33.01');
  // Kembali ke 'ALL', bukan macet di kota terakhir. Wallboard yang tidak pernah
  // menampilkan angka keseluruhan kehilangan angka yang paling sering dicari.
  assert.strictEqual(kotaBerikutnya('33.01', daftar), 'ALL');
});

test('putaran Live: kota di luar daftar tidak membuat putaran macet', async () => {
  const { kotaBerikutnya } = await import(MODUL);
  const daftar = ['ALL', '34.04', '33.01'];
  // Bisa terjadi kalau orang menyaring manual ke kota di luar daftar lalu menyalakan
  // Live. indexOf mengembalikan -1; tanpa penanganan, -1 + 1 = 0 kebetulan benar,
  // tapi itu kebetulan yang pantas dijaga tes supaya tetap begitu.
  assert.strictEqual(kotaBerikutnya('99.99', daftar), 'ALL');
  assert.strictEqual(kotaBerikutnya(null, daftar), '34.04');
});

test('putaran Live: daftar kosong tidak melempar galat', async () => {
  const { kotaBerikutnya } = await import(MODUL);
  assert.strictEqual(kotaBerikutnya('ALL', []), 'ALL');
  assert.strictEqual(kotaBerikutnya('ALL', null), 'ALL');
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
