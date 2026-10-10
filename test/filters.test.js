/**
 * Uji aturan filter. Meng-import frontend/js/filters.js dan state.js langsung, jadi
 * yang diuji persis berkas yang dikirim ke browser — tidak ada salinan kedua yang bisa
 * menyimpang.
 *
 * Yang dijaga di sini empat hal yang gagalnya diam:
 *
 * 1. **Kota/Kares memilih DEALER, bukan lokasi pelanggan, dan jenjangnya dua arah.**
 *    Sejak 2026-10-11 (permintaan tim). Filter Kota = seluruh penjualan dealer yang
 *    TERDAFTAR di kota itu, juga yang pelanggannya di luar kota. Fixture sengaja
 *    memuat dealer Cilacap (D2) yang pelanggannya di Sleman: filter berbasis lokasi
 *    akan menghitungnya lain dan tes ini merah. Memilih yang kecil mengisi yang besar
 *    (pos -> dealer -> kota -> kares); memilih yang besar mempersempit yang kecil.
 *    (Sampai 2026-10-10 bagian ini menjaga yang SEBALIKNYA: eksklusif dan berbasis
 *    lokasi. Pembalikannya dicatat di docs/DECISIONS.md.)
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
 * Kecamatan uji (satuan analisis sejak 2026-10-10): dua kota di dua Kares berbeda —
 * '34.04' (Sleman) masuk KARESIDENAN.yogyakarta, '33.01' (Cilacap) masuk
 * KARESIDENAN.banyumas. Baris penjualan tetap membawa `village` (untuk sebaran titik),
 * tapi penyaringnya membaca `district`.
 */
const DISTRICTS = {
  '33.01.01': { code: '33.01.01', cityCode: '33.01' },
  '34.04.01': { code: '34.04.01', cityCode: '34.04' },
  '34.04.02': { code: '34.04.02', cityCode: '34.04' },
};

const SALES = [
  { period: '2026-07', district: '34.04.01', village: '34.04.01.2001', outlet: 'O01', dealer: 'D1', units: 1 },
  { period: '2026-08', district: '34.04.01', village: '34.04.01.2001', outlet: 'O01', dealer: 'D1', units: 2 },
  // D2 terdaftar di Cilacap (33.01), tapi pelanggan baris ini ada di Sleman (34.04.02).
  { period: '2026-08', district: '34.04.02', village: '34.04.02.2002', outlet: 'O02', dealer: 'D2', units: 4 },
  { period: '2026-09', district: '33.01.01', village: '33.01.01.1001', outlet: 'O03', dealer: 'D2', units: 8 },
];

/**
 * Kota ASAL dealer (dealers.city_code): D1 dan D3 di Sleman (Kares Yogyakarta), D2 di
 * Cilacap (Kares Banyumas), D4 tanpa kota tercatat. D3 dan D4 tidak punya penjualan.
 */
const DEALERS = [
  { code: 'D1', name: 'Dealer Satu', cityCode: '34.04' },
  { code: 'D2', name: 'Dealer Dua', cityCode: '33.01' },
  { code: 'D3', name: 'Dealer Tiga', cityCode: '34.04' },
  { code: 'D4', name: 'Dealer Empat', cityCode: null },
];
const OUTLETS = [
  { code: 'O01', name: 'Pos Satu', dealerCode: 'D1' },
  { code: 'O02', name: 'Pos Dua', dealerCode: 'D2' },
  { code: 'O03', name: 'Pos Tiga', dealerCode: 'D2' },
];

/** Jumlah unit yang lolos filter — satu angka, gampang dibandingkan. */
const units = (rows) => rows.reduce((sum, r) => sum + r.units, 0);

async function test() {
  const { S, makeFilter } = await import(url('state.js'));
  const {
    activeRows, applyScope, clearScope, pageFilters, scopeValue, setPeriod, setKares,
    setScope, scopeLabel, regionDealerCodes, scopeOptions, regionCityCodes,
  } = await import(url('filters.js'));

  // Dunia uji: tanpa DOM, tanpa peta, tanpa server.
  S.sales = SALES;
  S.districtByCode = DISTRICTS;
  S.dealers = DEALERS;
  S.dealerByCode = Object.fromEntries(DEALERS.map((d) => [d.code, d]));
  S.realOutlets = OUTLETS;
  S.outletByCode = Object.fromEntries(OUTLETS.map((o) => [o.code, o]));
  S.dealerNames = { D1: 'Dealer Satu', D2: 'Dealer Dua', D3: 'Dealer Tiga', D4: 'Dealer Empat' };
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
     1. KOTA/KARES = KUMPULAN DEALER TERDAFTAR, bukan lokasi pelanggan
     ------------------------------------------------------------------
     Sejak 2026-10-11 (permintaan tim). Bagian ini dulu menjaga eksklusivitas dan
     penyaringan menurut kecamatan tempat penjualan; keduanya dibalik dan dicatat
     di docs/DECISIONS.md.
     ------------------------------------------------------------------ */
  reset();
  assert.strictEqual(regionDealerCodes(), null,
    'tanpa filter wilayah harus null ("tidak membatasi"), bukan daftar');

  // Kota Sleman (34.04): dealer D1 dan D3. Hanya D1 yang punya penjualan (3 unit).
  setScope('kota', '34.04');
  assert.strictEqual(scopeValue('kota'), '34.04');
  assert.strictEqual(pageFilters().kares, 'yogyakarta', 'memilih kota tidak mengisi karesidenannya');
  assert.deepStrictEqual(regionDealerCodes().sort(), ['D1', 'D3']);
  assert.strictEqual(units(activeRows()), 3,
    'kota Sleman harus = penjualan dealer D1 (3 unit)');

  // INTI PERMINTAAN: Cilacap (33.01) = dealer D2 = 12 unit, TERMASUK 4 unit yang
  // pelanggannya di Sleman. Penyaring berbasis lokasi pelanggan memberi 8.
  setScope('kota', '33.01', true);
  assert.deepStrictEqual(regionDealerCodes(), ['D2']);
  assert.strictEqual(units(activeRows()), 12,
    'penjualan dealer Cilacap yang pelanggannya di luar Cilacap harus tetap ikut');
  assert.strictEqual(pageFilters().kares, 'banyumas');

  // Kota tanpa dealer terdaftar: KOSONG, bukan "tanpa saringan".
  setScope('kota', '99.99', true);
  assert.deepStrictEqual(regionDealerCodes(), []);
  assert.strictEqual(units(activeRows()), 0,
    'kota tanpa dealer terdaftar malah menampilkan semua penjualan');
  assert.strictEqual(pageFilters().kares, 'ALL', 'kota di luar tiga karesidenan mengisi kares');

  // Karesidenan = gabungan dealer di semua kotanya.
  reset();
  setKares('yogyakarta');
  assert.strictEqual(units(activeRows()), 3);
  setKares('banyumas');
  assert.strictEqual(units(activeRows()), 12);

  /* --- memilih yang KECIL mengisi yang BESAR --- */
  reset();
  setScope('pos', 'O02');
  assert.strictEqual(scopeValue('pos'), 'O02');
  assert.strictEqual(scopeValue('dealer'), 'D2', 'memilih pos tidak mengisi dealernya');
  assert.strictEqual(scopeValue('kota'), '33.01', 'memilih pos tidak mengisi kota dealernya');
  assert.strictEqual(pageFilters().kares, 'banyumas', 'memilih pos tidak mengisi karesidenannya');
  assert.strictEqual(units(activeRows()), 4, 'pos yang dipilih menyaring persis baris pos itu');

  setScope('dealer', 'D1', true);
  assert.strictEqual(scopeValue('pos'), 'ALL', 'pos milik dealer lain tidak dilepas');
  assert.strictEqual(scopeValue('kota'), '34.04', 'kota tidak mengikuti dealer yang baru');
  assert.strictEqual(pageFilters().kares, 'yogyakarta', 'kares tidak mengikuti dealer yang baru');
  assert.strictEqual(units(activeRows()), 3);

  // Dealer tanpa kota tercatat: kota dan kares DIKOSONGKAN, bukan sisa pilihan lama.
  setScope('dealer', 'D4', true);
  assert.strictEqual(scopeValue('kota'), 'ALL');
  assert.strictEqual(pageFilters().kares, 'ALL');

  /* --- memilih yang BESAR mempersempit yang KECIL --- */
  reset();
  setScope('pos', 'O03');
  setScope('kota', '34.04', true);
  assert.strictEqual(scopeValue('dealer'), 'ALL', 'dealer dari kota lain tidak dilepas');
  assert.strictEqual(scopeValue('pos'), 'ALL', 'pos dari kota lain tidak dilepas');

  setScope('dealer', 'D1', true);
  setScope('pos', 'O01', true);
  setKares('banyumas');
  assert.strictEqual(scopeValue('kota'), 'ALL', 'kota di luar karesidenan baru tidak dilepas');
  assert.strictEqual(scopeValue('dealer'), 'ALL');
  assert.strictEqual(scopeValue('pos'), 'ALL');

  // Pilihan yang masih cocok TIDAK dibuang.
  reset();
  setScope('pos', 'O02');
  setKares('banyumas');
  assert.strictEqual(scopeValue('pos'), 'O02', 'kares yang cocok malah membuang pos');
  assert.strictEqual(scopeValue('dealer'), 'D2');

  /* --- membuka ("Semua") satu tingkat membuka tingkat di bawahnya --- */
  reset();
  setScope('pos', 'O01');
  setScope('kota', 'ALL', true);
  assert.strictEqual(scopeValue('dealer'), 'ALL');
  assert.strictEqual(scopeValue('pos'), 'ALL');
  assert.strictEqual(pageFilters().kares, 'yogyakarta',
    'membuka kota ikut membuka karesidenan (tingkat DI ATASNYA)');
  setKares('ALL');
  assert.strictEqual(scopeValue('kota'), 'ALL');

  // Klik yang sama dua kali mematikan SLOT ITU SAJA — kecuali dipaksa.
  reset();
  setScope('pos', 'O01', true);
  setScope('pos', 'O01');
  assert.strictEqual(scopeValue('pos'), 'ALL', 'memilih lagi yang sama tidak mematikan');
  assert.strictEqual(scopeValue('dealer'), 'D1', 'mematikan pos ikut membuang dealernya');
  setScope('pos', 'O01', true);
  setScope('pos', 'O01', true);
  assert.strictEqual(scopeValue('pos'), 'O01',
    'force masih ikut menoggle — "Lihat di peta" jadi mematikan pos yang diminta');

  // Jalur peta harus patuh pada aturan yang sama persis dengan jalur dropdown.
  reset();
  setScope('dealer', 'D2');
  applyScope('pos', 'O02');
  assert.strictEqual(scopeValue('pos'), 'O02', 'klik pos di peta tidak menyetel pos');
  assert.strictEqual(scopeValue('dealer'), 'D2', 'klik pos di peta membuang dealer pemiliknya');
  assert.ok(repaints > 0, 'applyScope tidak menggambar ulang apa pun');

  // Klik poligon kecamatan menyetel KOTA-nya, dan dipaksa: mengklik kecamatan kedua
  // di kabupaten yang sama tidak boleh mematikan kabupatennya. Dealer D2 (Cilacap)
  // tidak ada di Sleman, jadi terlepas.
  setScope('dealer', 'D2');
  applyScope('kecamatan', '34.04.01');
  assert.strictEqual(scopeValue('kota'), '34.04');
  assert.strictEqual(scopeValue('dealer'), 'ALL', 'dealer dari kota lain tidak dilepas');
  applyScope('kecamatan', '34.04.02');
  assert.strictEqual(scopeValue('kota'), '34.04',
    'kecamatan kedua di kabupaten yang sama justru mematikan filter kabupatennya');

  /* --- pilihan di dropdown mengikuti tingkat di atasnya --- */
  reset();
  let o = scopeOptions();
  assert.deepStrictEqual(o.cities.sort(), ['33.01', '34.04'],
    'kota yang ditawarkan = kota tempat ada dealer terdaftar');
  assert.deepStrictEqual([...o.dealers].sort(), ['D1', 'D2', 'D3', 'D4']);
  assert.deepStrictEqual([...o.outlets].sort(), ['O01', 'O02', 'O03']);

  setKares('yogyakarta');
  o = scopeOptions();
  assert.deepStrictEqual(o.cities, ['34.04'], 'kares tidak mempersempit pilihan kota');
  assert.deepStrictEqual([...o.dealers].sort(), ['D1', 'D3'],
    'dealer D4 (tanpa kota) atau D2 (kota lain) ikut tertawar');
  assert.deepStrictEqual([...o.outlets], ['O01']);

  setScope('dealer', 'D1', true);
  assert.deepStrictEqual([...scopeOptions().outlets], ['O01']);
  reset();
  setScope('dealer', 'D2', true);
  assert.deepStrictEqual([...scopeOptions().outlets].sort(), ['O02', 'O03'],
    'dealer terpilih tidak mempersempit pos ke miliknya');

  // Untuk halaman yang menyaring di server (Data Konsumen).
  reset();
  assert.strictEqual(regionCityCodes(), null);
  setKares('yogyakarta');
  assert.deepStrictEqual(regionCityCodes(), ['34.04', '34.71', '34.02', '34.01', '34.03']);
  setScope('kota', '34.04', true);
  assert.deepStrictEqual(regionCityCodes(), ['34.04'], 'kota yang dipilih harus menang atas kares');

  /* ------------------------------------------------------------------
     1b. clearScope(kind) TERTARGET, dan tidak menyentuh Kares
     ------------------------------------------------------------------ */
  reset();
  setKares('yogyakarta');
  setScope('pos', 'O01');

  clearScope('pos');
  assert.strictEqual(scopeValue('pos'), 'ALL');
  assert.strictEqual(scopeValue('dealer'), 'D1', 'clearScope("pos") ikut membuang dealer di ATASNYA');
  assert.strictEqual(pageFilters().kares, 'yogyakarta', 'clearScope("pos") ikut membuang Kares');

  clearScope('dealer');
  assert.strictEqual(scopeValue('dealer'), 'ALL');
  assert.strictEqual(scopeValue('kota'), '34.04', 'clearScope("dealer") ikut membuang kota di atasnya');
  assert.strictEqual(pageFilters().kares, 'yogyakarta', 'clearScope("dealer") ikut membuang Kares');

  // Tanpa argumen: kota/dealer/pos kosong (dipakai tombol Reset), Kares TIDAK ikut —
  // resetFilters() di filter-bar.js yang memanggil setKares('ALL') secara terpisah.
  setScope('pos', 'O01');
  clearScope();
  assert.strictEqual(scopeValue('kota'), 'ALL');
  assert.strictEqual(scopeValue('dealer'), 'ALL');
  assert.strictEqual(scopeValue('pos'), 'ALL', 'clearScope() tanpa argumen tidak mengosongkan semuanya');
  assert.strictEqual(pageFilters().kares, 'yogyakarta',
    'clearScope() tanpa argumen ikut membuang Kares — padahal tombol Reset yang mengurusnya');

  /* ------------------------------------------------------------------
     2. KARES: tingkat terbesar, dan labelnya menyebut wilayah ASAL dealer
     ------------------------------------------------------------------ */
  reset();
  setKares('yogyakarta'); // cities: 34.04, 34.71, 34.02, 34.01, 34.03
  setScope('dealer', 'D2');
  assert.strictEqual(scopeValue('dealer'), 'D2');
  assert.strictEqual(pageFilters().kares, 'banyumas',
    'dealer D2 (Cilacap) tidak menggeser karesidenan ke Banyumas');
  assert.strictEqual(units(activeRows()), 12,
    'dealer D2 harus membawa SELURUH penjualannya, juga yang pelanggannya di Sleman');

  assert.match(scopeLabel(), /Dealer Dua/);
  assert.match(scopeLabel(), /Karesidenan Banyumas/);
  assert.ok(scopeLabel().indexOf('Karesidenan') < scopeLabel().indexOf('Dealer'),
    'label tidak berurut dari tingkat terbesar');

  // Kode Kares yang tidak dikenal ditolak jadi 'ALL' dan MEMBUKA semua tingkat — kalau
  // lolos mentah, combo Kota yang berjenjang (filter-bar.js) akan salah total.
  setKares('kares-ngasal');
  assert.strictEqual(pageFilters().kares, 'ALL', 'kode Kares asing seharusnya ditolak');
  assert.strictEqual(scopeValue('dealer'), 'ALL');

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

  console.log('OK filters — kota/kares memilih kumpulan DEALER terdaftar (bukan lokasi ' +
    'pelanggan), jenjang kares>kota>dealer>pos dua arah, rentang periode berbatas ' +
    'dua sisi, filter SAMA di seluruh halaman');
}

test().catch((error) => {
  console.error(error);
  process.exit(1);
});
