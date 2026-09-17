/**
 * Uji aturan filter. Meng-import frontend/js/filters.js dan state.js langsung, jadi
 * yang diuji persis berkas yang dikirim ke browser — tidak ada salinan kedua yang bisa
 * menyimpang.
 *
 * Yang dijaga di sini empat hal yang gagalnya diam:
 *
 * 1. **Eksklusif.** Kota, dealer, dan pos cuma boleh SATU yang aktif sejak 2026-08-31
 *    (permintaan Pakbos, membalikkan independensi 2026-08-30). Kalau salah satu
 *    diam-diam tidak membuang dua lainnya, filter "wajib cuma dua: periode + satu
 *    lainnya" jadi bohong dan angka yang tampil adalah irisan yang tidak diminta.
 * 2. **Rentang periode.** Satu batas yang hilang berarti hasilnya melebar; pembanding
 *    yang bergeser satu langkah membuang bulan di ujung. Dua-duanya tetap terlihat
 *    "jalan" di layar.
 * 3. **Pemisahan per halaman.** Kalau keempat halaman diam-diam berbagi satu objek
 *    filter, memfilter di halaman Peta akan mengubah angka yang dilihat orang di
 *    Master Pos Dealer — persis kebocoran yang perombakan ini hendak menutup.
 * 4. **clearScope(kind) tertarget.** Menutup kartu dealer atau info pos tidak boleh
 *    ikut membuang filter Kares yang sedang dipakai orang di halaman yang sama.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const url = (name) => pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'js', name)).href;

/**
 * Kelurahan uji: dua kota di dua Kares berbeda — '34.04' (Sleman) masuk
 * KARESIDENAN.yogyakarta, '33.01' (Cilacap) masuk KARESIDENAN.banyumas.
 */
const VILLAGES = {
  '33.01.01.1001': { code: '33.01.01.1001', cityCode: '33.01' },
  '34.04.01.2001': { code: '34.04.01.2001', cityCode: '34.04' },
  '34.04.02.2002': { code: '34.04.02.2002', cityCode: '34.04' },
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
    activeRows, applyScope, clearScope, pageFilters, scopeValue, setPeriod, setKares,
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
     1. EKSKLUSIF — cuma satu dari kota/dealer/pos yang boleh aktif
     ------------------------------------------------------------------
     Sejak 2026-08-31 (permintaan Pakbos), membalikkan independensi 2026-08-30.
     ------------------------------------------------------------------ */
  reset();

  setScope('kota', '34.04');
  assert.strictEqual(scopeValue('kota'), '34.04');

  setScope('dealer', 'D1');
  assert.strictEqual(scopeValue('dealer'), 'D1');
  assert.strictEqual(scopeValue('kota'), 'ALL',
    'memilih dealer TIDAK membuang kota — keduanya harus eksklusif, cuma satu boleh aktif');

  setScope('pos', 'O01');
  assert.strictEqual(scopeValue('pos'), 'O01');
  assert.strictEqual(scopeValue('dealer'), 'ALL', 'memilih pos tidak membuang dealer lama');
  assert.strictEqual(scopeValue('kota'), 'ALL', 'memilih pos tidak membuang kota lama');

  // Hasilnya cuma disaring oleh SATU slot yang aktif (pos), bukan irisan ketiganya —
  // O01 muncul di dua baris (Juli=1, Agustus=2).
  assert.strictEqual(units(activeRows()), 3,
    'pos yang aktif sendirian seharusnya menyaring persis baris pos itu');

  // Klik yang sama dua kali mematikan SLOT ITU SAJA — kecuali dipaksa.
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
    'klik pos di peta tidak membuang dealer — jalur peta harus eksklusif, sama seperti dropdown');
  assert.ok(repaints > 0, 'applyScope tidak menggambar ulang apa pun');

  // Klik poligon kelurahan menyetel KOTA-nya, dan dipaksa: mengklik kelurahan kedua
  // di kabupaten yang sama tidak boleh mematikan kabupatennya. Dealer yang sempat
  // aktif sebelumnya (baris di atas) harus ikut terbuang — eksklusif.
  setScope('dealer', 'D2');
  applyScope('kelurahan', '34.04.01.2001');
  assert.strictEqual(scopeValue('kota'), '34.04');
  assert.strictEqual(scopeValue('dealer'), 'ALL', 'klik kelurahan tidak membuang dealer aktif');
  applyScope('kelurahan', '34.04.02.2002');
  assert.strictEqual(scopeValue('kota'), '34.04',
    'kelurahan kedua di kabupaten yang sama justru mematikan filter kabupatennya');

  /* ------------------------------------------------------------------
     1b. clearScope(kind) TERTARGET, dan tidak menyentuh Kares
     ------------------------------------------------------------------
     Sejak eksklusivitas 2026-08-31, kota/dealer/pos tidak pernah aktif bertiga
     sekaligus lewat setScope() lagi — yang masih perlu dijaga di sini adalah
     clearScope(kind) tidak melebar ke Kares (slot mandiri, lihat bagian 2).
     ------------------------------------------------------------------ */
  reset();
  setKares('yogyakarta');
  setScope('pos', 'O01');

  clearScope('pos');
  assert.strictEqual(scopeValue('pos'), 'ALL');
  assert.strictEqual(pageFilters().kares, 'yogyakarta', 'clearScope("pos") ikut membuang Kares');

  setScope('dealer', 'D1');
  clearScope('dealer');
  assert.strictEqual(scopeValue('dealer'), 'ALL');
  assert.strictEqual(pageFilters().kares, 'yogyakarta', 'clearScope("dealer") ikut membuang Kares');

  // Tanpa argumen: kota/dealer/pos kosong (dipakai tombol Reset), Kares TIDAK ikut —
  // resetFilters() di filter-bar.js yang memanggil setKares('ALL') secara terpisah.
  setScope('kota', '34.04');
  clearScope();
  assert.strictEqual(scopeValue('kota'), 'ALL');
  assert.strictEqual(scopeValue('dealer'), 'ALL');
  assert.strictEqual(scopeValue('pos'), 'ALL', 'clearScope() tanpa argumen tidak mengosongkan semuanya');
  assert.strictEqual(pageFilters().kares, 'yogyakarta',
    'clearScope() tanpa argumen ikut membuang Kares — padahal dia slot mandiri');

  /* ------------------------------------------------------------------
     2. KARES MANDIRI — di luar slot kota/dealer/pos, boleh bersamaan
     ------------------------------------------------------------------ */
  reset();
  setKares('yogyakarta'); // cities: 34.04, 34.71, 34.02, 34.01, 34.03
  setScope('dealer', 'D2');
  assert.strictEqual(scopeValue('dealer'), 'D2');
  assert.strictEqual(pageFilters().kares, 'yogyakarta',
    'Kares ikut dilebur ke slot kota/dealer/pos — padahal dia sengaja tetap filter mandiri');
  assert.strictEqual(units(activeRows()), 4,
    'Kares dan dealer tidak di-AND-kan: hasilnya harus irisan keduanya, bukan ' +
    'salah satu saja');

  assert.match(scopeLabel(), /Dealer Dua/);
  assert.match(scopeLabel(), /Karesidenan Yogyakarta/);

  // Kode Kares yang tidak dikenal ditolak jadi 'ALL', bukan disimpan mentah — combo
  // Kota yang cascading (filter-bar.js) akan salah total kalau ini lolos.
  setKares('kares-ngasal');
  assert.strictEqual(pageFilters().kares, 'ALL', 'kode Kares asing seharusnya ditolak');

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
     4. SAMA DI SELURUH HALAMAN
     ------------------------------------------------------------------
     DIBALIK 2026-09-17 atas permintaan tim. Sampai hari itu bagian ini menjaga
     hal yang SEBALIKNYA — bahwa filter tiap halaman terpisah. Yang lama tidak
     dihapus diam-diam: pembalikannya dicatat di docs/DECISIONS.md, dan tes ini
     sekarang menjaga aturan barunya supaya tidak diam-diam kembali terpisah.

     Kenapa dijaga sama sekali: filter yang berbeda antar halaman membuat dua
     layar menampilkan angka berbeda untuk pertanyaan yang sama, tanpa ada yang
     tahu mana yang benar.
     ------------------------------------------------------------------ */
  reset();
  S.filterPage = 'peta';
  setScope('dealer', 'D1');
  setKares('yogyakarta');
  setPeriod('from', '2026-08');

  assert.strictEqual(scopeValue('dealer', pageFilters('konsumen')), 'D1',
    'memfilter di halaman Peta TIDAK ikut ke halaman lain — filternya seharusnya ' +
    'satu objek yang sama untuk seluruh halaman');
  assert.strictEqual(pageFilters('fusion').dealerCode, 'D1',
    'Confidence Fusion tidak mewarisi Dealer yang dipilih di halaman Peta');
  assert.strictEqual(pageFilters('pos').kares, 'yogyakarta',
    'Kares tidak ikut ke halaman lain');
  assert.strictEqual(pageFilters('kirim').from, '2026-08',
    'periode tidak ikut ke halaman lain');

  // Halaman mana pun yang aktif, angkanya sama — karena filternya memang satu.
  assert.strictEqual(units(activeRows('konsumen')), 2,
    'activeRows halaman lain tidak memakai filter yang sama');
  assert.strictEqual(units(activeRows()), 2, 'filter halaman aktif tidak berlaku');

  S.filterPage = 'konsumen';
  assert.strictEqual(units(activeRows()), 2,
    'berpindah halaman mengubah angkanya — filternya seharusnya tidak berpindah');

  // clearScope() berlaku untuk semuanya, karena memang tidak ada "milik halaman lain"
  // lagi. Ini kebalikan persis dari yang dijaga versi sebelumnya.
  clearScope();
  assert.strictEqual(pageFilters('peta').dealerCode, 'ALL',
    'clearScope() tidak membersihkan lingkup bersama');

  console.log('OK filters — kota/dealer/pos eksklusif, Kares mandiri, rentang ' +
    'periode berbatas dua sisi, filter SAMA di seluruh halaman');
}

test().catch((error) => {
  console.error(error);
  process.exit(1);
});
