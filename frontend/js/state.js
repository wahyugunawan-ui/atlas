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
 * cityCode/dealerCode/outletCode SALING EKSKLUSIF sejak [tanggal eksekusi] — permintaan
 * langsung Pakbos, membalikkan keputusan 2026-08-30 yang sempat membuat ketiganya
 * independen. Menyetel satu membuang dua lainnya — lihat setScope() di filters.js.
 * `kares` MANDIRI dari ketiganya, cuma mempersempit pilihan kota (lihat filter-bar.js).
 */
export function makeFilter() {
  return {
    from: 'ALL',        // batas bawah periode 'YYYY-MM', 'ALL' = sejak awal
    to: 'ALL',          // batas atas periode 'YYYY-MM', 'ALL' = sampai terbaru
    kares: 'ALL',       // MANDIRI — selalu boleh dipakai bersama tiga field di bawah
    cityCode: 'ALL',
    dealerCode: 'ALL',
    outletCode: 'ALL',
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
  businessReferencePercent: 1, // acuan bisnis default; ditimpa data.businessReferencePercent
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
  dealerMarkers: [],       // titik HQ dealer, terpisah dari titik pos (S.markers)
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
  // Kriteria sort blok Performa: 'percent' (dalam/luar ring, bawaan) | 'units' (total
  // sales) | 'ring' (peringkat %ring tertentu, lihat performanceRingFocus).
  performanceCriteria: 'units',
  performanceRingFocus: 1, // 1|2|3 — ring yang dipakai waktu performanceCriteria==='ring'
  performanceGroupFilter: null, // salah satu POSISI_LABEL, atau null = semua kelompok
  livePerforma: null,      // id interval gulir otomatis; null berarti mati
  // Blok Analisis Penjualan Wilayah (Bagian H): auto-loop SENDIRI begitu ada isinya,
  // beda dari livePerforma yang manual — liveWilayahPaused membedakan "belum pernah
  // mulai" (biarkan auto-start jalan) dari "user menekan Pause" (jangan auto-mulai lagi).
  liveWilayah: null,
  liveWilayahPaused: false,
  treemapView: 'dealer',
  treemapChart: null,
  treemapChartBesar: null, // popup treemap (Bagian C), null waktu modalnya tertutup
  treemapCodes: [],
  villageTrendChart: null, // grafik tren bulanan di panel Blok 2 (Sales)
  // 'relative' (persentil, bawaan) | 'fixed' (interval tetap). Ditulis di sini dari
  // sekarang supaya panel ringkasan kota/dealer bisa menyebut mode aktif; belum
  // mengubah warna peta sungguhan sampai togglenya dipasang di bagian berikutnya.
  heatmapMode: 'relative',

  // --- ring layanan: rings[outletCode][villageCode] = 1|2|3 ---
  // Sejak [tanggal eksekusi] per DESA/KELURAHAN, bukan lagi per kecamatan — permintaan
  // Pakbos. Data ring versi kecamatan lama dihapus total, mulai dari kosong.
  rings: {},
  districtNames: {},       // kode kecamatan -> nama, untuk menyebutnya di layar (Master Kelurahan)

  // --- jangkauan ---
  coverage: {},            // coverage[outletCode][villageCode] = rasio, radius aktif
  coverageAll: {},         // seluruh radius, dari server
  radiusM: 5000,
  radiiM: [5000],
  coverageReady: false,
  // Mode Tampilkan Ring (Bagian I, pengganti pilihan Radius jangkauan yang lama):
  // 1|2|3 kalau sedang menyorot ring itu untuk pos yang dipilih, null kalau mati.
  ringView: null,

  // --- mode dan suntingan ---
  fullscreen: false,
  editing: null,           // kode outlet yang sedang disunting
  editingDealer: null,     // kode dealer yang sedang disunting
  pickingOnMap: false,     // menunggu klik di peta untuk mengambil koordinat

  // --- konsumen kelurahan yang sedang dibuka; diambil per permintaan ---
  villageCustomers: null,
};
