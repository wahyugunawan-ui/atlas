/**
 * Filter dan ruang lingkup.
 *
 * activeRows() adalah satu-satunya jalan membaca data yang sedang tampil. Kalau ada
 * bagian lain yang menyaring S.sales sendiri, angkanya akan berbeda dari KPI dan tidak
 * ada yang tahu mana yang benar.
 *
 * Modul ini SENGAJA tidak menyentuh DOM. Nilai filter tinggal di S.filters[halaman] dan
 * <select> di bilah cuma cerminnya. Itu dua hal sekaligus: tiap halaman bisa punya
 * filter sendiri tanpa trik simpan-muat, dan aturannya bisa diuji tanpa browser.
 */
import { KARESIDENAN } from './config.js';
import { districtsInRingCategory } from './sales-stats.js';
import { S } from './state.js';

/** Nilai filter halaman yang sedang aktif, atau halaman yang disebut. */
export const pageFilters = (page) => S.filters[page || S.filterPage] || S.filters.peta;

/** 'kota' | 'kec' | 'dealer' | 'pos' -> nama field-nya di objek filter. */
const FIELD = { kota: 'cityCode', kec: 'districtCode', dealer: 'dealerCode', pos: 'outletCode' };
const KINDS = Object.keys(FIELD);

/**
 * Lima tingkat filter wilayah, dari yang terbesar ke terkecil:
 * karesidenan berisi kota, kota berisi kecamatan, kecamatan berisi dealer, dealer
 * berisi pos. (Kec ditambahkan 2026-10-11, permintaan tim.)
 */
const LEVELS = ['kares', 'cityCode', 'districtCode', 'dealerCode', 'outletCode'];
const IDX = Object.fromEntries(LEVELS.map((l, i) => [l, i]));

function navigationSnapshot() {
  return { filters: { ...pageFilters() }, selectedDistrict: S.selectedDistrict,
    panelView: S.panelView ? { ...S.panelView } : null,
    ringView: { ...S.ringView } };
}

/** Simpan pilihan, bukan data atau hasil render. Maksimum 50 langkah. */
export function rememberNavigation() {
  const snapshot = navigationSnapshot();
  const history = S.navigationHistory;
  if (JSON.stringify(history[history.length - 1]) !== JSON.stringify(snapshot)) {
    history.push(snapshot);
    if (history.length > 50) history.shift();
  }
}

export function undoNavigation() {
  const current = JSON.stringify(navigationSnapshot());
  let previous;
  while (S.navigationHistory.length) {
    const item = S.navigationHistory.pop();
    if (JSON.stringify(item) !== current) { previous = item; break; }
  }
  if (!previous) return false;
  Object.assign(pageFilters(), previous.filters);
  S.selectedDistrict = previous.selectedDistrict;
  S.panelView = previous.panelView;
  S.ringView = previous.ringView;
  return true;
}

/**
 * Klik kecamatan (poligon peta, tabel, kartu dealer) mengisi filter Kec. dan Kabupaten
 * sekaligus, jadi peta dan kedua filter selalu cocok. Kabupaten diambil dari letak
 * geografis kecamatan (cityOfDistrict), bukan dari dealer — kecamatan tanpa dealer tetap
 * mengisi keduanya. Dealer/pos yang tidak cocok dengan kabupaten baru dilepas, sama seperti
 * memilih Kabupaten lewat dropdown; ring yang sedang disorot dibatalkan.
 *
 * Dealer/pos terpilih DIPERTAHANKAN, juga bila kabupaten kecamatan itu bukan kabupaten
 * terdaftar dealer (kecamatan dalam ring dealer bisa lintas kabupaten): fokus produk ini
 * dealer, bukan wilayah. activeRows() membiarkan dealer terpilih menentukan dirinya sendiri.
 */
export function selectDistrictFromMap(code) {
  const value = code && code !== 'ALL' ? code : 'ALL';
  if (value !== 'ALL' && !S.districtByCode[value]) return;
  rememberNavigation();
  const f = pageFilters();
  f.districtCode = value;
  if (value !== 'ALL') {
    const kota = cityOfDistrict(value);
    if (kota) f.cityCode = kota;
    f.kares = f.cityCode !== 'ALL' ? (karesOfCity(f.cityCode) || 'ALL') : 'ALL';
    S.ringView = { mode: null, value: null };
  }
  S.selectedDistrict = value === 'ALL' ? null : value;
  S.panelView = value === 'ALL' ? null : { kind: 'district', code: value };
}

/**
 * Bahan klasifikasi Others / Pelanggaran Wilayah untuk satu dealer (lihat
 * dealerRingSplit() di sales-stats.js): kota terdaftarnya, pencari kota sebuah
 * kecamatan, dan kecamatan yang ditoleransi — kecamatan tempat dealer berada beserta yang
 * berbatasan langsung dengannya (S.dealerBorder, dihitung server dari poligon kecamatan).
 */
export function dealerRegionInfo(code) {
  return {
    cityCode: dealerCityOf(code),
    cityOfDistrict: (district) => (S.districtByCode[district] || {}).cityCode || null,
    // Kecamatan dealer sendiri selalu ikut, walau server belum punya poligonnya.
    tolerated: new Set([...(S.dealerBorder[code] || []), dealerDistrictOf(code)].filter(Boolean)),
  };
}

/**
 * Baris pada periode aktif saja, tanpa saringan wilayah/dealer/pos. Penyebut angka yang
 * membandingkan satu wilayah dengan wilayah di atasnya (kontribusi kabupaten ke karesidenan):
 * filter Kabupaten yang sedang aktif tidak boleh ikut mengecilkan penyebutnya.
 */
export function periodRows(page) {
  const f = pageFilters(page);
  return S.sales.filter((row) => (f.from === 'ALL' || row.period >= f.from)
    && (f.to === 'ALL' || row.period <= f.to) && Boolean(S.districtByCode[row.district]));
}

/**
 * Klik baris Detail ring (Ring 1/2/3, Others, Pelanggaran Wilayah): pilih dealer itu dan
 * sorot kecamatan kategori tersebut di peta. Kategori lain dari luar daftar diabaikan.
 */
export function focusDealerRing(dealerCode, category) {
  const value = ['1', '2', '3'].includes(String(category)) ? Number(category) : category;
  if (![1, 2, 3, 'others', 'violation'].includes(value) || !S.dealerByCode[dealerCode]) return;
  setScope('dealer', dealerCode, true);
  S.ringView = { mode: 'dealer-ring', value };
  if (window.syncGroupControls) window.syncGroupControls();
  if (window.renderAll) window.renderAll();
}

/** null = seluruh peta, himpunan kosong = tidak ada wilayah yang lolos. */
export function mapViewDistricts() {
  const f = pageFilters();
  let codes = null;
  const { mode, value } = S.ringView || {};
  if (mode === 'dealer-ring' && f.dealerCode !== 'ALL' && typeof value === 'number') {
    const rings = S.dealerRings[f.dealerCode] || {};
    codes = new Set(Object.keys(rings).filter((code) => rings[code] === value));
  }
  // Others / Pelanggaran Wilayah (klik baris Detail ring): kecamatan berpenjualan yang jatuh
  // ke kategori itu bagi dealer terpilih — aturan yang sama dengan persentasenya.
  if (mode === 'dealer-ring' && f.dealerCode !== 'ALL' && (value === 'others' || value === 'violation')) {
    codes = districtsInRingCategory(Object.keys(S.districtByCode), value,
      S.dealerRings[f.dealerCode] || {}, dealerRegionInfo(f.dealerCode));
  }
  // Kec. terpilih (dari dropdown maupun klik peta) = satu-satunya kecamatan yang tampil.
  if (f.districtCode && f.districtCode !== 'ALL') {
    const selected = f.districtCode;
    codes = new Set(!codes || codes.has(selected) ? [selected] : []);
  }
  return codes;
}

function clearMapSelection() {
  S.selectedDistrict = null;
  S.panelView = null;
  S.ringView = { mode: null, value: null };
}

/**
 * Kares, kota, kec, dealer, dan pos BERJENJANG (sejak 2026-10-11), bukan lagi saling
 * eksklusif. Dua arah:
 *
 * - Memilih yang KECIL mengisi yang besar: pilih dealer Astra Motor Center Yogyakarta
 *   -> kecamatannya (Mlati), kotanya (Sleman), dan karesidenannya (Yogyakarta) terisi.
 * - Memilih yang BESAR mempersempit yang kecil: pilih kota Sleman -> dealer/pos yang
 *   bukan dari Sleman dilepas, dan daftar dealer di dropdown tinggal dealer Sleman.
 *
 * Membuka ("Semua") satu tingkat ikut membuka semua tingkat di bawahnya.
 *
 * ARTI Kota/Kec/Kares: bukan lokasi pelanggan, tapi KUMPULAN DEALER yang terdaftar di
 * wilayah itu (dealers.city_code / dealers.district_code, dari kolom Kabupaten dan
 * Kecamatan Excel Dealer & POS). Semua penjualan dealer-dealer itu ikut, juga yang
 * pelanggannya tinggal di luar kota/karesidenan. Ini MEMBALIKKAN keputusan 2026-08-31 dan
 * 2026-09-17 (kota = tempat pelanggan); lihat docs/DECISIONS.md.
 */
export function scopeValue(kind, f) {
  const filters = f || pageFilters();
  return filters[FIELD[kind]] || 'ALL';
}

/** Kota ASAL (terdaftar) sebuah dealer, atau null kalau Excel tidak memuatnya. */
export function dealerCityOf(dealerCode) {
  const d = S.dealerByCode[dealerCode];
  return (d && d.cityCode) || null;
}

/** Kecamatan ASAL (terdaftar) sebuah dealer, atau null kalau Excel tidak memuatnya. */
export function dealerDistrictOf(dealerCode) {
  const d = S.dealerByCode[dealerCode];
  return (d && d.districtCode) || null;
}


/** Karesidenan yang memuat kota ini, atau null (kota di luar ketiga karesidenan). */
export function karesOfCity(cityCode) {
  return Object.keys(KARESIDENAN).find((k) => KARESIDENAN[k].cities.includes(cityCode)) || null;
}

/** Apakah kares/kota di `f` (kalau ada) memuat dealer ini — tanpa melihat Kec. */
function dealerInCityKares(dealerCode, f) {
  const city = dealerCityOf(dealerCode);
  if (f.cityCode !== 'ALL' && city !== f.cityCode) return false;
  if (f.kares !== 'ALL' && !(city && KARESIDENAN[f.kares].cities.includes(city))) return false;
  return true;
}

/**
 * Apakah kares/kota di `f` (kalau ada) memuat dealer ini. Kec. TIDAK ikut: sejak
 * 2026-11-04 Kec. adalah kecamatan LOKASI PENJUALAN (lihat activeRows()), bukan kecamatan
 * asal dealer, jadi tidak menyempitkan kumpulan dealer.
 */
function dealerInRegion(dealerCode, f) {
  return dealerInCityKares(dealerCode, f);
}

/**
 * Kabupaten GEOGRAFIS sebuah kecamatan (dari wilayah, bukan dari dealer), atau null kalau
 * kecamatannya tidak dikenal. Kec. berarti lokasi penjualan, jadi kabupatennya juga letak
 * kecamatan itu: Somagede selalu Banyumas, ada dealer di sana atau tidak.
 */
export function cityOfDistrict(districtCode) {
  const d = S.districtByCode[districtCode] || (S.allDistrictByCode || {})[districtCode];
  return (d && d.cityCode) || null;
}

/**
 * Kode dealer yang lolos filter Kares/Kota, atau null kalau keduanya "Semua".
 *
 * null berarti "tidak membatasi", BUKAN "kosong": daftar kosong (tidak ada dealer
 * terdaftar di wilayah itu) harus berarti tidak ada penjualan, dan keduanya tidak
 * boleh tertukar.
 */
export function regionDealerCodes(f) {
  const filters = f || pageFilters();
  if (filters.cityCode === 'ALL' && filters.kares === 'ALL') return null;
  return S.dealers.map((d) => d.code).filter((code) => dealerInRegion(code, filters));
}

/**
 * Apakah ada filter RUANG LINGKUP (Kares/Kota/Kec/Dealer/Pos) yang menyala. Periode sengaja
 * tidak dihitung: dia mengubah isi peta, bukan "siapa yang terkait".
 */
export function hasScopeFilter(f) {
  const filters = f || pageFilters();
  return ['kares', 'cityCode', 'districtCode', 'dealerCode', 'outletCode']
    .some((kunci) => filters[kunci] !== 'ALL');
}

/**
 * Himpunan dealer yang TERKAIT dengan filter ruang lingkup, atau null kalau tidak ada
 * filter sama sekali (semua dealer/pos tampil).
 *
 * - Pos terpilih -> dealer pemilik pos itu (jadi satu pos yang dianalisis tetap membawa
 *   titik dealernya dan semua pos dealer itu).
 * - Dealer terpilih -> dealer itu saja.
 * - Selain itu -> dealer yang TERDAFTAR di Kota/Kares terpilih (kumpulan dealer, bukan
 *   lokasi pelanggan; lihat regionDealerCodes()). Kec. tidak menyempitkan himpunan ini.
 *
 * Titik dealer dan pos di luar himpunan ini tidak digambar di peta (2026-10-11).
 * @returns {Set<string>|null}
 */
export function focusDealerSet(f) {
  const filters = f || pageFilters();
  const dealerCode = filters.outletCode !== 'ALL'
    ? (S.outletByCode[filters.outletCode] || {}).dealerCode : filters.dealerCode;
  if (dealerCode && dealerCode !== 'ALL') return new Set([dealerCode]);
  const wilayah = regionDealerCodes(filters);
  return wilayah ? new Set(wilayah) : null;
}

/**
 * Pilihan yang masih masuk akal di dropdown Kota/Kec/Dealer/Pos, mengikuti tingkat di
 * atasnya: karesidenan mempersempit kota, kota mempersempit kecamatan, kecamatan
 * mempersempit dealer, dealer mempersempit pos. Murni (tanpa DOM) supaya aturannya bisa
 * diuji.
 *
 * Kota yang ditawarkan = tempat ada dealer terdaftar. Kecamatan = kecamatan yang ADA
 * PENJUALANNYA (lokasi penjualan, bukan asal dealer): semuanya bila Kota/Kares "Semua",
 * selain itu hanya yang kabupaten geografisnya masuk Kota/Kares terpilih. Yang sedang
 * aktif selalu ikut, walau di luar tiga karesidenan atau di luar 14 kota dealer (hasil
 * klik peta), supaya pilnya tidak menampilkan "Semua" padahal filternya menyala.
 *
 * @returns {{cities: string[], districts: string[], dealers: Set<string>,
 *   outlets: Set<string>}}
 */
export function scopeOptions(f) {
  const filters = f || pageFilters();
  const allowed = filters.kares !== 'ALL' ? new Set(KARESIDENAN[filters.kares].cities) : null;

  const cities = [...new Set(S.dealers.map((d) => d.cityCode).filter(Boolean))]
    .filter((c) => !allowed || allowed.has(c) || c === filters.cityCode);
  if (filters.cityCode !== 'ALL' && !cities.includes(filters.cityCode)) cities.push(filters.cityCode);

  const districts = Object.values(S.districtByCode)
    .filter((d) => (filters.cityCode === 'ALL' || d.cityCode === filters.cityCode)
      && (!allowed || allowed.has(d.cityCode)))
    .map((d) => d.code);
  if (filters.districtCode !== 'ALL' && !districts.includes(filters.districtCode)) {
    districts.push(filters.districtCode);
  }

  const regionSet = (() => {
    const r = regionDealerCodes(filters);
    return r ? new Set(r) : null;
  })();
  const dealers = new Set(S.dealers.map((d) => d.code).filter((c) => !regionSet || regionSet.has(c)));
  if (filters.dealerCode !== 'ALL') dealers.add(filters.dealerCode);

  const outlets = new Set(S.realOutlets
    .filter((o) => dealers.has(o.dealerCode)
      && (filters.dealerCode === 'ALL' || o.dealerCode === filters.dealerCode))
    .map((o) => o.code));

  return { cities, districts, dealers, outlets };
}

/**
 * Kode kota ASAL DEALER yang sedang disaring (satu kota, atau seluruh kota anggota
 * karesidenan), atau null kalau keduanya "Semua". Untuk halaman yang menyaring di server.
 */
export function regionCityCodes(f) {
  const filters = f || pageFilters();
  if (filters.cityCode !== 'ALL') return [filters.cityCode];
  if (filters.kares !== 'ALL') return KARESIDENAN[filters.kares].cities.slice();
  return null;
}

/** Lepas tingkat di bawah `field` yang tidak lagi cocok dengan tingkat di atasnya. */
function trimBelow(f, field) {
  const i = IDX[field];

  if (i < IDX.cityCode && f.cityCode !== 'ALL' && f.kares !== 'ALL'
    && !KARESIDENAN[f.kares].cities.includes(f.cityCode)) f.cityCode = 'ALL';

  if (i < IDX.districtCode && f.districtCode !== 'ALL') {
    // Kecamatan bertahan selama kabupaten geografisnya masih masuk Kota/Kares terpilih.
    const kota = cityOfDistrict(f.districtCode);
    if (f.cityCode !== 'ALL' && kota !== f.cityCode) f.districtCode = 'ALL';
    else if (f.kares !== 'ALL' && !(kota && KARESIDENAN[f.kares].cities.includes(kota))) {
      f.districtCode = 'ALL';
    }
  }

  if (i < IDX.dealerCode && f.dealerCode !== 'ALL' && !dealerInRegion(f.dealerCode, f)) {
    f.dealerCode = 'ALL';
  }

  if (i < IDX.outletCode && f.outletCode !== 'ALL') {
    const outlet = S.outletByCode[f.outletCode];
    if (f.dealerCode === 'ALL' || !outlet || outlet.dealerCode !== f.dealerCode) f.outletCode = 'ALL';
  }
}

/**
 * Isi tingkat di ATAS `field` dari pilihan yang baru dibuat, lalu lepas yang di bawahnya
 * yang jadi tidak cocok. Dipanggil sesudah `field` diisi nilai sungguhan (bukan 'ALL').
 */
function reconcile(f, field) {
  if (field === 'outletCode') {
    const outlet = S.outletByCode[f.outletCode];
    f.dealerCode = outlet ? outlet.dealerCode : 'ALL';
  }
  if (field === 'outletCode' || field === 'dealerCode') {
    // Dealer/pos mengisi Kabupaten (kota terdaftar dealer) tapi TIDAK Kec.: Kec. adalah
    // lokasi penjualan, dan fokus dealer cukup ditunjukkan sorotan di peta (2026-11-04).
    f.districtCode = 'ALL';
    f.cityCode = f.dealerCode !== 'ALL' ? (dealerCityOf(f.dealerCode) || 'ALL') : f.cityCode;
  }
  if (field === 'districtCode') {
    // Kabupaten = letak geografis kecamatan; kalau tidak dikenal, kabupaten dibiarkan.
    const kota = cityOfDistrict(f.districtCode);
    if (kota) f.cityCode = kota;
  }
  if (field !== 'kares') {
    f.kares = f.cityCode !== 'ALL' ? (karesOfCity(f.cityCode) || 'ALL') : 'ALL';
  }
  trimBelow(f, field);
}

/**
 * @param {string} kind  'kota' | 'kec' | 'dealer' | 'pos'
 * @param {string} code  kode, atau 'ALL' untuk mengosongkan
 * @param {boolean} [force]  jangan toggle — dipakai "Lihat di peta" dari tabel, yang
 *   artinya "tampilkan ini", bukan "nyalakan atau matikan ini"
 */
export function setScope(kind, code, force) {
  rememberNavigation();
  clearMapSelection();
  const f = pageFilters();
  const field = FIELD[kind];
  const same = !force && f[field] === code;
  const value = (same || !code || code === 'ALL') ? 'ALL' : code;
  f[field] = value;

  if (value === 'ALL') {
    // Membuka satu tingkat membuka semua tingkat di bawahnya.
    LEVELS.slice(IDX[field] + 1).forEach((l) => { f[l] = 'ALL'; });
  } else {
    reconcile(f, field);
  }

  // Blok kontekstual Ring Dealer / Kec. Tercover tampil/hilang mengikuti scope
  // dealer/pos — dipanggil untuk SEMUA kind (dealer/pos bisa ikut berubah lewat jenjang di
  // atas, bukan cuma waktu dipanggil langsung). Lewat window supaya filters.js tidak perlu
  // mengimpor map.js (menghindari impor melingkar).
  if (window.syncGroupControls) window.syncGroupControls();
}

/** @param {string} [kind] tanpa argumen, kosongkan SEMUANYA kecuali Kares (tombol Reset). */
export function clearScope(kind) {
  rememberNavigation();
  clearMapSelection();
  const f = pageFilters();
  const kinds = kind ? [kind] : KINDS;
  kinds.forEach((k) => {
    f[FIELD[k]] = 'ALL';
    LEVELS.slice(IDX[FIELD[k]] + 1).forEach((l) => { f[l] = 'ALL'; });
  });
}

/** Tingkat terbesar. "Semua" membuka kota/kec/dealer/pos juga; sebuah pilihan mempersempitnya. */
export function setKares(code) {
  rememberNavigation();
  clearMapSelection();
  const f = pageFilters();
  if (code && KARESIDENAN[code]) {
    f.kares = code;
    reconcile(f, 'kares');
  } else {
    LEVELS.forEach((l) => { f[l] = 'ALL'; });
  }
}
/**
 * Ujung rentang yang menyilang DISERET, bukan ditolak.
 *
 * Penggunanya tim channel, bukan developer, dan dropdown yang menolak pilihan tidak
 * memberi tahu apa yang harus dilakukan. Menyeret ujung satunya selalu menghasilkan
 * rentang yang sah, dan yang terjadi terlihat langsung di layar.
 *
 * @param {string} which  'from' | 'to'
 */
export function setPeriod(which, value) {
  rememberNavigation();
  const f = pageFilters();
  f[which] = value || 'ALL';
  if (f.from !== 'ALL' && f.to !== 'ALL' && f.from > f.to) {
    if (which === 'from') f.to = f.from;
    else f.from = f.to;
  }
}

/**
 * Terjemahkan bilah filter jadi parameter API penyatuan tiga sumber.
 *
 * Dua hal yang sengaja BEDA dari halaman lain, dan keduanya kehilangan informasi:
 *
 * 1. Bilah memberi RENTANG periode (`from`..`to`), sedangkan `segment_rollup` disimpan
 *    per satu periode — penggolongan menilai keadaan satu bulan, bukan gabungan
 *    beberapa bulan. Yang dipakai karena itu `to` (bulan terakhir yang diminta), dan
 *    `from` diabaikan. Menjumlahkan dua bulan akan menghitung satu pelanggan dua kali.
 * 2. Karesidenan tidak ada di rollup sama sekali, dan petanya cuma hidup di frontend
 *    (`config.js`). Dilaporkan lewat `abaikan` supaya halaman bisa mengatakannya,
 *    bukan diam-diam menampilkan angka se-provinsi seolah itu angka yang disaring.
 *
 * Pos TETAP diterjemahkan di sini — fungsi ini bukan cuma dipakai kelima panel
 * Confidence Fusion (renderFusion(), fusion.js), tapi juga muatTitikFusi() di
 * map.js untuk titik tiga sumber di peta yang SAMA, yang tampil di halaman Sales
 * Analytics juga. Pos masih relevan menyaring peta di sana.
 *
 * Yang DIHAPUS sejak 2026-09-18 (permintaan tim) bukan penerjemahan pos di sini,
 * tapi PEMAKAIANNYA di kelima panel Confidence Fusion (Pelanggan Terfilter, CW
 * Sales, Confidence Ratio, Venn, Cakupan Sumber) — renderFusion() sengaja MEMBUANG
 * field `pos` dari hasil fungsi ini sebelum mengirimkannya ke lima fetch itu (lihat
 * komentar di sana). Sempat dipahami sejak 2026-09-17 (server menerjemahkannya jadi
 * daftar kelurahan lewat tabel `coverage`, lihat POS_FILTER di repository.js), tapi
 * satu pos hanya melayani sebagian kecil kelurahan satu kota — menyaring
 * penggolongan sesempit itu jarang berarti apa pun untuk KELIMA panel itu, dan
 * bilah filter Kota/Dealer/Kares sudah cukup.
 *
 * PERCOBAAN PERTAMA (giliran ini) membuang pos DI SINI langsung — salah: itu ikut
 * mematikan saringan Pos untuk titik tiga sumber di halaman Sales Analytics, yang
 * tidak pernah diminta berubah. Diperbaiki dengan memindahkan pembuangannya ke
 * renderFusion(), yang memang satu-satunya pemanggil yang perlu membuangnya.
 *
 * @returns {{periode: string|null, kota: string|null, dealer: string|null,
 *   pos: string|null, abaikan: string[]}} `null` berarti "tanpa saringan"; periode
 *   null = periode terbaru yang ada di server.
 */
export function fusionFilter(f) {
  const filters = f || pageFilters('fusion');
  const pakai = (nilai) => (nilai && nilai !== 'ALL' ? nilai : null);
  const periode = (nilai) => (/^\d{4}-\d{2}$/.test(String(nilai || '')) ? nilai : null);

  const kota = pakai(filters.cityCode);
  // Kec. di layar = kecamatan LOKASI penjualan sejak 2026-11-04, sedangkan `kec` di server
  // berarti kecamatan ASAL dealer (saringFusi, routes.js). Keduanya tidak boleh tertukar,
  // jadi Kec. layar tidak diteruskan; titik tiga sumber tetap disaring Kota/Dealer/Pos.
  const kec = null;
  const kares = pakai(filters.kares);

  // Karesidenan diterjemahkan jadi DAFTAR KODE KOTA di sini, bukan di server.
  //
  // Petanya punya satu pemilik tunggal (`KARESIDENAN` di config.js). Menyalinnya ke
  // server berarti dua salinan pemetaan yang sama, dan salinan ganda itu persis kelas
  // cacat yang sudah berkali-kali muncul di proyek ini — dua kosakata kode dealer.
  // Server tetap memvalidasi tiap kode dengan regex CITY, jadi daftar dari layar
  // tidak bisa menyelipkan apa pun.
  //
  // Kota yang dipilih EKSPLISIT lebih sempit daripada karesidenan, jadi ia menang.
  //
  // ARTI kota/kares di sini = DEALER yang terdaftar di sana (sejak 2026-10-11), bukan
  // kota tempat pelanggan tinggal. Penerjemahan ke daftar dealer dilakukan SERVER
  // (saringFusi di routes.js, lewat dealers.city_code); dealer atau pos yang dipilih
  // lebih sempit dan menang di sana.
  const kotaBanyak = (!kota && !kec && kares && KARESIDENAN[kares])
    ? KARESIDENAN[kares].cities.slice()
    : null;

  // Yang masih benar-benar dibuang: BATAS BAWAH periode. Rollup disimpan per satu
  // bulan, jadi rentang diciutkan ke bulan terakhir. Dulu hal ini cuma ditulis di
  // komentar — orang memilih Juni–Agustus, mendapat Agustus saja, dan tidak ada satu
  // kalimat pun yang mengatakannya.
  const dari = periode(filters.from);
  const sampai = periode(filters.to);
  const abaikan = [];
  if (dari && sampai && dari !== sampai) abaikan.push('rentang');

  return {
    periode: sampai,
    kota,
    kec,
    kotaBanyak,
    dealer: pakai(filters.dealerCode),
    pos: pakai(filters.outletCode),
    abaikan,
  };
}

/**
 * Saringan untuk TITIK TIGA SUMBER di peta, satu-satunya bentuk yang boleh dipakai
 * `muatTitikFusi()` dan `tandaSaringPeta()` (map.js).
 *
 * Bedanya dengan fusionFilter() apa adanya cuma satu: di halaman Confidence Fusion,
 * `pos` DIBUANG. Pil Pos disembunyikan di halaman itu (syncFilterBar(), filter-bar.js
 * — permintaan tim 2026-09-18), dan kendali yang tidak terlihat TAPI tetap menyaring
 * lebih membingungkan daripada tidak dihapus sama sekali: orang melihat titik yang
 * lebih sedikit tanpa satu pun petunjuk kenapa. Di Sales Analytics pilnya ada, jadi
 * pos tetap berlaku penuh di sana.
 *
 * WAJIB dipakai untuk KEDUANYA — tanda tangan cache maupun permintaannya. Kalau tanda
 * tangan dihitung dari objek yang berbeda dengan yang dikirim, pindah halaman tidak
 * menginvalidasi cache dan titiknya diam saja: bug yang sudah sekali terjadi di
 * proyek ini (lihat catatan "PERCOBAAN PERTAMA" di fusionFilter() di atas).
 */
export function fusionFilterPeta() {
  const f = fusionFilter(pageFilters('peta'));
  if (S.filterPage === 'fusion') f.pos = null;
  return f;
}

/**
 * Persentase kepemilikan sumber, dibulatkan untuk dibaca orang.
 *
 * Nol pembagi mengembalikan null, BUKAN 0: "0%" berarti "diukur, hasilnya nol",
 * sedangkan tidak ada pembagi berarti "belum ada yang bisa diukur". Dua keadaan yang
 * berbeda dan tidak boleh tampil sama.
 */
export function persenSumber(n, total) {
  const pembagi = Number(total) || 0;
  if (!pembagi) return null;
  return Math.round((Number(n) || 0) / pembagi * 100);
}

/**
 * Kota berikutnya dalam putaran mode Live.
 *
 * Daftarnya melingkar dan SELALU melewati 'ALL' sekali tiap putaran — permintaan
 * docs/FUSION.md 3.5 ("termasuk kembali ke Semua"). Tanpa itu layar wallboard tidak
 * pernah menampilkan angka keseluruhan, padahal itu justru angka yang paling sering
 * dicari orang yang lewat.
 *
 * Kota yang TIDAK ada di daftar (mis. tersisa dari filter manual sebelum Live
 * dinyalakan) diperlakukan sebagai awal putaran, bukan dibiarkan macet di tempat.
 */
export function kotaBerikutnya(sekarang, daftar) {
  const putaran = Array.isArray(daftar) && daftar.length ? daftar : ['ALL'];
  const posisi = putaran.indexOf(sekarang || 'ALL');
  return putaran[(posisi + 1) % putaran.length];
}

/**
 * Baris penjualan yang lolos filter halaman.
 *
 * `tanpaPos`: abaikan filter Pos. Dipakai seksi target penjualan — target milik DEALER, jadi
 * penjualan yang dibandingkan juga harus milik dealer utuh; kalau hanya satu pos yang
 * dihitung, persentasenya tampak rendah padahal yang kurang cuma pembilangnya.
 */
export function activeRows(page, { tanpaPos = false, tanpaKecamatan = false } = {}) {
  const f = pageFilters(page);
  // Kota/Karesidenan = KUMPULAN DEALER terdaftar di sana (dealers.city_code), BUKAN
  // kecamatan tempat penjualannya terjadi. Penjualan dealer-dealer itu ikut seluruhnya,
  // juga yang pelanggannya di luar kota/karesidenan. Dihitung sekali per panggilan
  // supaya satu baris tidak membayar pencarian dealer.
  const region = regionDealerCodes(f);
  const regionSet = region ? new Set(region) : null;

  return S.sales.filter((row) => {
    // Periode dibandingkan sebagai TEKS. Kolomnya lebar-tetap 'YYYY-MM' dengan bulan
    // ber-nol depan, jadi urutan leksikografisnya identik dengan urutan kronologis.
    // Ini hanya benar selama nol depannya ada — dijaga regex PERIOD di
    // backend/server/routes.js dan oleh importir, jadi '2026-9' tidak bisa masuk.
    if (f.from !== 'ALL' && row.period < f.from) return false;
    if (f.to !== 'ALL' && row.period > f.to) return false;
    if (f.dealerCode !== 'ALL' && row.dealer !== f.dealerCode) return false;
    if (!tanpaPos && f.outletCode !== 'ALL' && row.outlet !== f.outletCode) return false;
    // Dealer terpilih menentukan dirinya sendiri (lihat selectDistrictFromMap()).
    if (regionSet && f.dealerCode === 'ALL' && !regionSet.has(row.dealer)) return false;
    // Kec. = kecamatan tempat penjualan terjadi (bukan asal dealer). `tanpaKecamatan`
    // dipakai panel kecamatan: penyebut kontribusi/peringkat harus tetap seluruh kabupaten.
    if (!tanpaKecamatan && f.districtCode !== 'ALL' && row.district !== f.districtCode) return false;
    // Kecamatan yang tidak dikenal tetap tidak bisa digambar/dihitung per wilayah.
    return Boolean(S.districtByCode[row.district]);
  });
}

/**
 * Satu pintu untuk semua cara memilih ruang lingkup.
 *
 * Marker di peta, blok treemap, baris panel performa, chip kartu dealer, poligon
 * kecamatan, dan dropdown semuanya lewat sini. Itu yang membuat "klik di peta langsung
 * berpindah" otomatis benar: tidak ada jalur kedua yang bisa lupa diperbarui, dan titik
 * penjualan, KPI, heatmap, serta panel performa selalu berpindah bersamaan.
 *
 * Kares, kota, dealer, dan pos berjenjang sejak 2026-10-11 (lihat setScope()): mengklik
 * pos mengisi dealer, kota, dan karesidenannya sekaligus.
 */
export function applyScope(kind, code) {
  if (kind === 'kecamatan') {
    selectDistrictFromMap(code);
  } else {
    setScope(kind, code);
  }

  if (kind === 'pos' && scopeValue('pos') === code) {
    const outlet = S.outletByCode[code];
    if (outlet && outlet.lat != null && S.map) {
      S.map.flyTo({ center: [outlet.lng, outlet.lat], zoom: 10.5, duration: 700 });
    }
  }
  window.renderAll();
}

/**
 * Bagi penjualan jadi dalam dan luar radius jangkauan.
 *
 * Rasio jangkauan datang dari server, dihitung dari luas KECAMATAN yang beririsan
 * dengan lingkaran radius (sejak 2026-10-10; sebelumnya kelurahan). Alamat konsumen
 * tidak punya koordinat, jadi ini TIDAK bisa dihitung per orang — asumsinya konsumen
 * tersebar merata di dalam kecamatannya, dan asumsi itu ditulis di layar, bukan cuma
 * di sini.
 */
export function splitByCoverage(rows) {
  let inside = 0;
  let total = 0;
  let noBoundary = 0;

  rows.forEach((row) => {
    // Kecamatan yang belum punya batas wilayah DIKELUARKAN dari hitungan, bukan
    // dihitung sebagai "di luar jangkauan".
    //
    // Bedanya besar dan halus. Tanpa poligon, rasio jangkauannya selalu 0 — bukan
    // karena posnya jauh, tapi karena belum ada yang bisa dihitung. Memasukkannya ke
    // penyebut membuat persentase turun tiap kali ada wilayah baru ditambahkan,
    // dan turunnya terlihat seperti temuan padahal cuma data yang belum lengkap.
    //
    // Jumlahnya dilaporkan terpisah supaya yang belum lengkap TERLIHAT, bukan hilang.
    const district = S.districtByCode[row.district];
    if (district && district.hasGeom === false) {
      noBoundary += row.units;
      return;
    }
    inside += row.units * ((S.coverage[row.outlet] || {})[row.district] || 0);
    total += row.units;
  });

  return { inside, outside: total - inside, total, noBoundary };
}

/**
 * Sebaran penjualan satu dealer: kabupaten -> kecamatan.
 *
 * DUA TINGKAT, dan itu hasil pengukuran bukan selera (waktu satuannya masih kelurahan,
 * dealer terbesar menyentuh 1.157 kelurahan). Kabupaten memampatkannya jadi baris
 * yang terbaca sekali lihat, dan kecamatannya menyusul waktu diklik.
 *
 * Jangkauan tiap kecamatan dihitung lewat splitByCoverage() yang sama dengan seluruh
 * aplikasi, BUKAN disalin ulang di sini. Aturan "wilayah tanpa poligon dikeluarkan
 * dari persentase dan dilaporkan terpisah" itu halus dan sudah pernah salah; satu-
 * satunya cara memastikan dia tidak menyimpang adalah tidak punya salinan keduanya.
 *
 * @param {Array} rows  baris penjualan yang SUDAH disaring ke satu dealer
 * @return {Array} kabupaten urut unit terbanyak, kecamatan di dalamnya juga
 */
export function dealerBreakdown(rows) {
  const perKota = {};

  rows.forEach((row) => {
    const district = S.districtByCode[row.district];
    if (!district) return;
    const kota = perKota[district.cityCode] || (perKota[district.cityCode] = {
      cityCode: district.cityCode,
      cityName: district.cityName || district.cityCode,
      units: 0,
      byDistrict: {},
    });
    kota.units += row.units;
    (kota.byDistrict[row.district] || (kota.byDistrict[row.district] = [])).push(row);
  });

  return Object.values(perKota).map((kota) => {
    const districts = Object.entries(kota.byDistrict).map(([code, barisnya]) => {
      // splitByCoverage dipanggil dengan baris KECAMATAN INI saja. Memanggilnya dengan
      // seluruh baris dealer akan menghasilkan angka yang sama di tiap baris — masuk
      // akal dilihat sekilas, dan salah di semuanya.
      const split = splitByCoverage(barisnya);
      const district = S.districtByCode[code] || {};
      return {
        code,
        name: district.name || code,
        units: barisnya.reduce((sum, r) => sum + r.units, 0),
        inside: split.inside,
        covered: split.total,
        noBoundary: split.noBoundary,
      };
    }).sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));

    return {
      cityCode: kota.cityCode,
      cityName: kota.cityName,
      units: kota.units,
      // Dijumlahkan dari kecamatannya, bukan dihitung ulang dari baris kabupaten.
      // Kalau dihitung terpisah, dua angka di layar bisa tidak bersambung dan tidak
      // ada yang tahu mana yang benar.
      inside: districts.reduce((sum, v) => sum + v.inside, 0),
      covered: districts.reduce((sum, v) => sum + v.covered, 0),
      districts,
    };
  }).sort((a, b) => b.units - a.units || a.cityName.localeCompare(b.cityName));
}

/**
 * Kalimat yang menjelaskan 100%-nya siapa.
 *
 * Ada karena heatmapnya relatif: kelas warnanya dihitung ulang dari data yang lolos
 * filter. Tanpa keterangan ini, dua tangkapan layar dengan warna yang sama bisa
 * berarti hal yang sama sekali berbeda.
 *
 * Rentang periodenya sengaja TIDAK ikut disebut: rentangnya sekarang permanen terlihat
 * di bilah filter, dan menyalinnya ke sini cuma bikin dua tempat yang bisa menyimpang.
 */
export function scopeLabel() {
  const f = pageFilters();
  const parts = [];

  // Urutan jenjang, dari yang terbesar. Kota/Kares berarti "dealer terdaftar di sana",
  // jadi mereka disebut sebagai wilayah ASAL dealer, bukan tempat penjualan.
  if (f.kares !== 'ALL') parts.push(KARESIDENAN[f.kares].label);
  if (f.cityCode !== 'ALL') parts.push(S.cityNames[f.cityCode] || f.cityCode);
  if (f.districtCode !== 'ALL') {
    parts.push('Kec. ' + (S.districtNames[f.districtCode] || f.districtCode));
  }
  if (f.dealerCode !== 'ALL') {
    parts.push('Dealer ' + (S.dealerNames[f.dealerCode] || f.dealerCode));
  }
  if (f.outletCode !== 'ALL') {
    parts.push('Pos ' + ((S.outletByCode[f.outletCode] || {}).name || f.outletCode));
  }
  return parts.length ? parts.join(' · ') : 'seluruh penjualan';
}
