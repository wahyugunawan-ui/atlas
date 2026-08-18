/**
 * State bersama satu halaman.
 *
 * Sengaja satu objek biasa, bukan store dengan subscriber. Yang dibutuhkan cuma
 * "semua modul melihat data yang sama", dan objek sudah melakukannya. Store baru
 * berguna kalau perubahan datang dari banyak sumber yang saling tidak tahu; di sini
 * perubahan selalu lewat satu jalur: filter berubah -> renderAll().
 */
export const S = {
  // --- dari server ---
  villages: [],            // [{code, name, district, cityCode, cityName, provinceCode, lat, lng}]
  outlets: [],             // [{code, name, dealerCode, dealerName, address, lat, lng}]
  sales: [],               // [{period, village, outlet, dealer, units}]
  periods: [],
  lastImport: null,
  hasCustomers: false,
  pendingNames: 0,         // nama kelurahan yang menunggu dicocokkan manusia
  panelView: null,         // {kind:'village'|'dealer', code} — isi panel geser

  // --- indeks, dibangun sekali saat muat ---
  villageByCode: {},
  outletByCode: {},
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
  selectedOutlet: null,
  selectedVillage: null,
  treemapView: 'dealer',
  treemapChart: null,
  treemapCodes: [],

  // --- jangkauan ---
  coverage: {},            // coverage[outletCode][villageCode] = rasio, radius aktif
  coverageAll: {},         // seluruh radius, dari server
  radiusM: 5000,
  radiiM: [5000],
  coverageReady: false,

  // --- mode dan suntingan ---
  fullscreen: false,
  editing: null,           // kode outlet yang sedang disunting
  pickingOnMap: false,     // menunggu klik di peta untuk mengambil koordinat

  // --- konsumen kelurahan yang sedang dibuka; diambil per permintaan ---
  villageCustomers: null,
};
