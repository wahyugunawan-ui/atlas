/**
 * State bersama satu halaman.
 *
 * Sengaja satu objek biasa, bukan store dengan subscriber. Yang dibutuhkan cuma
 * "semua modul melihat data yang sama", dan objek sudah melakukannya. Store baru
 * berguna kalau perubahan datang dari banyak sumber yang saling tidak tahu; di sini
 * perubahan selalu lewat satu jalur: filter berubah -> renderAll().
 */

/**
 * Nilai filter satu halaman.
 *
 * Tiap halaman punya salinannya sendiri: memfilter di Insight & Peta tidak boleh
 * mengubah angka yang dilihat orang di Master Pos Dealer. Sebelumnya nilainya tinggal
 * di <select> — dan satu set <select> tidak bisa menyimpan empat halaman sekaligus.
 *
 * scopeKind/scopeCode itu SATU slot untuk kota, dealer, dan pos. Alasannya di
 * filters.js; yang penting di sini: dua lingkup aktif bersamaan tidak bisa ditulis.
 */
export function makeFilter() {
  return {
    from: 'ALL',        // batas bawah periode 'YYYY-MM', 'ALL' = sejak awal
    to: 'ALL',          // batas atas periode 'YYYY-MM', 'ALL' = sampai terbaru
    province: 'ALL',    // MANDIRI — selalu boleh dipakai bersama slot di bawah
    scopeKind: null,    // 'kota' | 'dealer' | 'pos' | null
    scopeCode: 'ALL',
  };
}

export const S = {
  // --- filter, terpisah per halaman ---
  filterPage: 'peta',
  filters: {
    // Keempatnya berangkat sama; fillFilterBar() yang menyetel bulan terakhir untuk
    // peta, pos, dan kelurahan. Data Konsumen sengaja ditinggal tanpa batas periode —
    // alasannya ada di sana, di sebelah kode yang menyetelnya.
    peta: makeFilter(),
    pos: makeFilter(),
    kelurahan: makeFilter(),
    konsumen: makeFilter(),
  },

  // --- dari server ---
  villages: [],            // [{code, name, district, cityCode, cityName, provinceCode, lat, lng}]
  outlets: [],             // [{code, name, dealerCode, dealerName, address, lat, lng}]
  dealers: [],             // [{code, name, address, lat, lng, outletCount}]
  sales: [],               // [{period, village, outlet, dealer, units}]
  periods: [],
  lastImport: null,
  hasCustomers: false,
  pendingNames: 0,         // nama kelurahan yang menunggu dicocokkan manusia
  panelView: null,         // {kind:'village'|'dealer', code} — isi panel geser

  // --- indeks, dibangun sekali saat muat ---
  villageByCode: {},
  outletByCode: {},
  dealerByCode: {},
  dealerNames: {},
  cityNames: {},
  registry: null,          // warna dealer

  // --- geo ---
  geo: null,               // batas kelurahan
  cityGeo: null,           // batas kabupaten

  // --- peta ---
  map: null,
  layersReady: false,
  basemap: 'lokal',
  markers: [],
  salePoints: null,        // dibangkitkan sekali, dipakai ulang

  // --- pilihan ---
  // Pos yang sedang dipilih TIDAK disimpan di sini: dia bagian dari filter halaman,
  // dibaca lewat scopeValue('pos'). Menyimpannya lagi di sini berarti dua sumber
  // kebenaran untuk fakta yang sama, dan yang satu selalu bisa ketinggalan.
  selectedVillage: null,
  // Urutan daftar Analisis Performa Pos: 'asc' = persentase terkecil di atas.
  // Bawaannya yang terkecil, karena yang dicari orang di panel ini adalah pos yang
  // paling bermasalah — bukan yang paling baik.
  performanceSort: 'asc',
  livePerforma: null,      // id interval gulir otomatis; null berarti mati
  treemapView: 'dealer',
  treemapChart: null,
  treemapCodes: [],

  // --- ring layanan: rings[outletCode][districtCode] = 1|2|3 ---
  rings: {},
  districtNames: {},       // kode kecamatan -> nama, untuk menyebutnya di layar

  // --- jangkauan ---
  coverage: {},            // coverage[outletCode][villageCode] = rasio, radius aktif
  coverageAll: {},         // seluruh radius, dari server
  radiusM: 5000,
  radiiM: [5000],
  coverageReady: false,

  // --- mode dan suntingan ---
  fullscreen: false,
  editing: null,           // kode outlet yang sedang disunting
  editingDealer: null,     // kode dealer yang sedang disunting
  pickingOnMap: false,     // menunggu klik di peta untuk mengambil koordinat

  // --- konsumen kelurahan yang sedang dibuka; diambil per permintaan ---
  villageCustomers: null,
};
