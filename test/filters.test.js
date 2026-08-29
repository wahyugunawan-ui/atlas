/**
 * Uji aturan filter. Meng-import frontend/js/filters.js dan state.js langsung, jadi
 * yang diuji persis berkas yang dikirim ke browser — tidak ada salinan kedua yang bisa
 * menyimpang.
 *
 * Yang dijaga di sini tiga hal yang gagalnya diam:
 *
 * 1. **Saling eksklusif.** Kota, dealer, dan pos berbagi SATU slot. Kalau suatu hari
 *    slotnya dipecah kembali jadi tiga field, dua lingkup bisa aktif bersamaan dan
 *    hasilnya irisan yang tidak diminta siapa pun — panel kosong tanpa penjelasan.
 * 2. **Rentang periode.** Satu batas yang hilang berarti hasilnya melebar; pembanding
 *    yang bergeser satu langkah membuang bulan di ujung. Dua-duanya tetap terlihat
 *    "jalan" di layar.
 * 3. **Pemisahan per halaman.** Kalau keempat halaman diam-diam berbagi satu objek
 *    filter, memfilter di halaman Peta akan mengubah angka yang dilihat orang di
 *    Master Pos Dealer — persis kebocoran yang perombakan ini hendak menutup.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const url = (name) => pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'js', name)).href;

/** Kelurahan uji: dua kota di dua provinsi berbeda. */
const VILLAGES = {
  '33.01.01.1001': { code: '33.01.01.1001', cityCode: '33.01', provinceCode: '33' },
  '34.04.01.2001': { code: '34.04.01.2001', cityCode: '34.04', provinceCode: '34' },
  '34.04.02.2002': { code: '34.04.02.2002', cityCode: '34.04', provinceCode: '34' },
};

const SALES = [
  { period: '2026-07', village: '34.04.01.2001', outlet: 'O01', dealer: 'D1', units: 1 },
  { period: '2026-08', village: '34.04.01.2001', outlet: 'O01', dealer: 'D1', units: 2 },
  { period: '2026-08', village: '34.04.02.2002', outlet: 'O02', dealer: 'D2', units: 4 },
  { period: '2026-09', village: '33.01.01.1001', outlet: 'O03', dealer: 'D2', units: 8 },
];

/** Jumlah unit yang lolos filter — satu angka, gampang dibandingkan. */
const units = (rows) => rows.reduce((sum, r) => sum + r.units, 0);

async function test() {
  const { S, makeFilter } = await import(url('state.js'));
  const {
    activeRows, applyScope, clearScope, pageFilters, scopeValue, setPeriod, setProvince,
    setScope, scopeLabel,
  } = await import(url('filters.js'));

  // Dunia uji: tanpa DOM, tanpa peta, tanpa server.
  S.sales = SALES;
  S.villageByCode = VILLAGES;
  S.outletByCode = { O01: { code: 'O01', name: 'Pos Satu', dealerCode: 'D1' } };
  S.dealerNames = { D1: 'Dealer Satu', D2: 'Dealer Dua' };
  S.cityNames = { '34.04': 'Kebumen', '33.01': 'Cilacap' };
  S.map = null;

  // Nilainya dikembalikan DI TEMPAT, bukan dengan mengganti objeknya.
  //
  // Bedanya menentukan. Kalau reset menulis `S.filters[page] = makeFilter()`, keempat
  // halaman jadi punya objek sendiri karena RESET-nya, bukan karena state.js — dan
  // state.js yang diam-diam memberi satu objek yang sama untuk semuanya akan lolos
  // tanpa satu pun tes merah. Sudah dicoba: mutasinya hijau.
  const reset = () => {
    S.filterPage = 'peta';
    Object.keys(S.filters).forEach((page) => {
      Object.assign(S.filters[page], makeFilter());
    });
  };

  // applyScope memanggil window.renderAll(); di sini yang penting bukan gambarnya,
  // tapi bahwa slotnya berpindah dengan benar.
  let repaints = 0;
  global.window = { renderAll: () => { repaints++; } };

  /* ------------------------------------------------------------------
     1. SALING EKSKLUSIF — satu slot, bukan tiga field
     ------------------------------------------------------------------ */
  reset();

  setScope('kota', '34.04');
  assert.strictEqual(scopeValue('kota'), '34.04');

  setScope('dealer', 'D1');
  assert.strictEqual(scopeValue('dealer'), 'D1');
  assert.strictEqual(scopeValue('kota'), 'ALL',
    'memilih dealer tidak membuang kota — dua lingkup aktif bersamaan, dan hasilnya ' +
    'irisan yang tidak diminta siapa pun');

  setScope('pos', 'O01');
  assert.strictEqual(scopeValue('pos'), 'O01');
  assert.strictEqual(scopeValue('dealer'), 'ALL',
    'memilih pos tidak membuang dealer');

  // Klik yang sama dua kali mematikan — kecuali dipaksa.
  setScope('pos', 'O01');
  assert.strictEqual(scopeValue('pos'), 'ALL', 'memilih lagi yang sama tidak mematikan');
  setScope('pos', 'O01', true);
  setScope('pos', 'O01', true);
  assert.strictEqual(scopeValue('pos'), 'O01',
    'force masih ikut menoggle — "Lihat di peta" jadi mematikan pos yang diminta');

  // Jalur peta harus patuh pada aturan yang sama persis dengan jalur dropdown.
  reset();
  setScope('dealer', 'D2');
  applyScope('pos', 'O02');
  assert.strictEqual(scopeValue('pos'), 'O02', 'klik pos di peta tidak menyetel pos');
  assert.strictEqual(scopeValue('dealer'), 'ALL',
    'klik pos di peta tidak membuang dealer — jalur peta punya aturan sendiri, dan ' +
    'dua perilaku berbeda untuk hal yang sama tidak bisa dijelaskan ke pengguna');
  assert.ok(repaints > 0, 'applyScope tidak menggambar ulang apa pun');

  // Klik poligon kelurahan menyetel KOTA-nya, dan dipaksa: mengklik kelurahan kedua
  // di kabupaten yang sama tidak boleh mematikan kabupatennya.
  reset();
  applyScope('kelurahan', '34.04.01.2001');
  assert.strictEqual(scopeValue('kota'), '34.04');
  applyScope('kelurahan', '34.04.02.2002');
  assert.strictEqual(scopeValue('kota'), '34.04',
    'kelurahan kedua di kabupaten yang sama justru mematikan filter kabupatennya');

  /* ------------------------------------------------------------------
     2. PROVINSI MANDIRI — di luar slot, boleh bersamaan
     ------------------------------------------------------------------ */
  reset();
  setProvince('34');
  setScope('dealer', 'D2');
  assert.strictEqual(scopeValue('dealer'), 'D2');
  assert.strictEqual(pageFilters().province, '34',
    'provinsi ikut dilebur ke slot — padahal dia sengaja tetap filter mandiri');
  assert.strictEqual(units(activeRows()), 4,
    'provinsi dan dealer tidak di-AND-kan: hasilnya harus irisan keduanya, bukan ' +
    'salah satu saja');

  assert.match(scopeLabel(), /Dealer Dua/);
  assert.match(scopeLabel(), /Yogyakarta|Provinsi 34/);

  /* ------------------------------------------------------------------
     3. RENTANG PERIODE
     ------------------------------------------------------------------ */
  reset();
  assert.strictEqual(units(activeRows()), 15, 'tanpa batas periode harus semuanya');

  setPeriod('from', '2026-08');
  setPeriod('to', '2026-08');
  assert.strictEqual(units(activeRows()), 6,
    'rentang satu bulan tidak sama dengan bulan itu saja — pembandingnya bergeser');

  setPeriod('to', '2026-09');
  assert.strictEqual(units(activeRows()), 14,
    'Agustus sampai September tidak menjumlahkan keduanya, atau ikut membawa Juli');

  setPeriod('from', 'ALL');
  assert.strictEqual(units(activeRows()), 15, 'batas bawah dilepas tapi masih menyaring');

  setPeriod('to', '2026-07');
  assert.strictEqual(units(activeRows()), 1, 'batas atas sendirian tidak menyaring');

  // Ujung yang menyilang DISERET, bukan ditolak: pengguna non-IT tidak boleh dapat
  // jalan buntu dari dropdown.
  reset();
  setPeriod('from', '2026-07');
  setPeriod('to', '2026-09');
  setPeriod('from', '2026-09');
  assert.strictEqual(pageFilters().to, '2026-09',
    'menaikkan "dari" melewati "sampai" tidak menyeret ujung satunya');
  assert.ok(pageFilters().from <= pageFilters().to, 'rentangnya terbalik');

  setPeriod('to', '2026-07');
  assert.strictEqual(pageFilters().from, '2026-07',
    'menurunkan "sampai" melewati "dari" tidak menyeret ujung satunya');

  // Kotak bulan yang DIKOSONGKAN berarti "tanpa batas di sisi itu", bukan "batasi ke
  // nilai kosong". Bedanya besar: yang kedua akan mengosongkan seluruh layar, dan
  // penggunanya cuma melihat tabel kosong tanpa penjelasan.
  reset();
  setPeriod('from', '2026-08');
  setPeriod('to', '2026-08');
  assert.strictEqual(units(activeRows()), 6);
  setPeriod('from', '');
  assert.strictEqual(pageFilters().from, 'ALL',
    'kotak bulan yang dikosongkan tidak diperlakukan sebagai "tanpa batas"');
  assert.strictEqual(units(activeRows()), 7,
    'mengosongkan batas bawah harusnya MELEBAR jadi "semuanya sampai Agustus" ' +
    '(Juli ikut masuk), bukan mengosongkan layar');
  setPeriod('to', '');
  assert.strictEqual(units(activeRows()), 15,
    'kedua kotak kosong harusnya berarti seluruh periode');

  /* ------------------------------------------------------------------
     4. TERPISAH PER HALAMAN
     ------------------------------------------------------------------ */
  reset();
  S.filterPage = 'peta';
  setScope('dealer', 'D1');
  setProvince('34');
  setPeriod('from', '2026-08');

  assert.strictEqual(scopeValue('dealer', pageFilters('konsumen')), 'ALL',
    'memfilter di halaman Peta ikut mengubah filter halaman Data Konsumen — keempat ' +
    'halaman berbagi satu objek filter yang sama');
  assert.strictEqual(pageFilters('pos').province, 'ALL',
    'provinsi bocor ke halaman lain');
  assert.strictEqual(units(activeRows('konsumen')), 15,
    'activeRows halaman lain ikut terpengaruh filter halaman Peta');
  assert.strictEqual(units(activeRows()), 2, 'filter halaman Peta sendiri tidak berlaku');

  // Tanpa argumen, activeRows mengikuti halaman yang sedang aktif — inilah yang
  // membuat switchTab cukup menyetel S.filterPage.
  S.filterPage = 'konsumen';
  assert.strictEqual(units(activeRows()), 15,
    'activeRows tidak mengikuti S.filterPage — halaman aktif tidak menentukan apa pun');

  clearScope();
  assert.strictEqual(pageFilters('peta').scopeCode, 'D1',
    'clearScope mengosongkan lingkup halaman yang salah');

  console.log('OK filters — satu slot untuk kota/dealer/pos, provinsi mandiri, ' +
    'rentang periode berbatas dua sisi, filter terpisah per halaman');
}

test().catch((error) => {
  console.error(error);
  process.exit(1);
});
