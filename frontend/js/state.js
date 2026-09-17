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
    // Tiga halaman penyatuan tiga sumber (docs/FUSION.md). `fusion` yang dipakai
    // dashboard Confidence Fusion; `servis`/`kirim` dua sub-halaman Data yang baru.
    fusion: makeFilter(),
    servis: makeFilter(),
    kirim: makeFilter(),
    konsumen: makeFilter(),
  },

  // --- dari server ---
  villages: [],            // [{code, name, district, cityCode, cityName, provinceCode, lat, lng}]
  outlets: [],             // [{code, name, dealerCode, dealerName, address, lat, lng, synthetic}]
  // Katalog pos FISIK sungguhan saja — S.outlets bisa memuat baris "proxy" per
  // dealer (synthetic:true) yang menyambungkan penjualan level-dealer lama;
  // dipakai Master Pos Dealer, dropdown filter Pos, titik di peta. Diisi dari
  // S.outlets di buildIndexes(), lihat app.js.
  realOutlets: [],
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
  basemap: 'satelit',
  markers: [],
  dealerMarkers: [],       // titik HQ dealer, terpisah dari titik pos (S.markers)
  salePoints: null,        // dibangkitkan sekali, dipakai ulang
  // Hitungan titik tiga sumber per kelurahan (docs/FUSION.md 3.1). Diambil dari
  // server saat salah satu togglenya pertama dinyalakan, lalu dipakai ulang; dibuang
  // jadi null waktu filter berubah supaya tidak menampilkan angka periode lama.
  fusionPoints: null,      // {rows:[{villageCode, dealerCode, ktp, servis, kirim}]}
  fusionPointsLoading: false,
  // Ambang KPI Jarak (meter) untuk lingkaran radius di peta. null = belum diambil;
  // selama masih null lingkarannya TIDAK digambar, bukan digambar dengan tebakan.
  kpiRadiusM: null,
  kpiRadiusLoading: false,

  // --- pilihan ---
  // Pos yang sedang dipilih TIDAK disimpan di sini: dia bagian dari filter halaman,
  // dibaca lewat scopeValue('pos'). Menyimpannya lagi di sini berarti dua sumber
  // kebenaran untuk fakta yang sama, dan yang satu selalu bisa ketinggalan.
  selectedVillage: null,
  // Urutan daftar Analisis Performa Pos: 'asc' = persentase terkecil di atas.
  // Bawaannya yang terkecil, karena yang dicari orang di panel ini adalah pos yang
  // paling bermasalah — bukan yang paling baik.
  performanceSort: 'asc',
  // Kriteria sort blok Performa: 'percent' (dalam/luar coverage, bawaan) | 'units'
  // (total sales) | 'coverage' (peringkat %coverage tertentu, lihat performanceCoverageFocus).
  //
  // Sejak 2026-08-31 sore memakai coverage pos (1-8, kecamatan), bukan lagi ring
  // (ring pindah ke dealer) — lihat docs/DECISIONS.md.
  performanceCriteria: 'units',
  performanceCoverageFocus: 1, // 1..8 — dipakai waktu performanceCriteria==='coverage'
  performanceGroupFilter: null, // salah satu POSISI_LABEL, atau null = semua kelompok
  // Auto-loop SENDIRI begitu ada isinya (sama seperti liveWilayah di bawah) —
  // livePerformaPaused membedakan "belum pernah mulai" (biarkan auto-start jalan) dari
  // "user menekan Pause" (jangan auto-mulai lagi).
  livePerforma: null,      // id interval gulir otomatis; null berarti mati
  livePerformaPaused: false,
  // Blok Analisis Penjualan Wilayah (Bagian H): pola sama persis dengan livePerforma
  // di atas.
  liveWilayah: null,
  liveWilayahPaused: false,
  // Mode Live halaman Confidence Fusion (docs/FUSION.md 3.5) — pola penamaan sama
  // dengan dua di atas. BEDA sifatnya: dua yang di atas cuma menggulir piksel tiap
  // 40 ms, yang ini memindahkan filter Kota tiap ~3,5 detik dan tiap perpindahan
  // menembak lima permintaan ke server.
  liveFusion: null,
  liveFusionPaused: false,
  treemapView: 'dealer',
  // Sejak 2026-09-14: "Proporsi Penjualan" cuma popup (bukan lagi kartu inline +
  // versi "besar" modal terpisah) — satu chart, satu state, lihat renderTreemap()
  // di render.js.
  treemapChart: null,
  treemapCodes: [],
  villageTrendChart: null, // grafik tren bulanan di panel Blok 2 (Sales)
  // 'relative' (persentil, bawaan) | 'fixed' (interval tetap). Ditulis di sini dari
  // sekarang supaya panel ringkasan kota/dealer bisa menyebut mode aktif; belum
  // mengubah warna peta sungguhan sampai togglenya dipasang di bagian berikutnya.
  heatmapMode: 'relative',

  // --- ring dealer & coverage pos: dealerRings[dealerCode][districtCode] = 1|2|3,
  // posCoverage[outletCode][districtCode] = 1..8 ---
  // Sejak 2026-08-31 sore, ring pindah dari pos+kelurahan ke DEALER+KECAMATAN, dan pos
  // mendapat konsep baru coverage (1-8, kecamatan) — lihat docs/DECISIONS.md. Data ring
  // versi pos+kelurahan lama dihapus total, mulai dari kosong.
  dealerRings: {},
  posCoverage: {},
  districtNames: {},       // kode kecamatan -> nama, untuk menyebutnya di layar (Master Kelurahan)

  // --- jangkauan ---
  coverage: {},            // coverage[outletCode][villageCode] = rasio, radius aktif
  coverageAll: {},         // seluruh radius, dari server
  radiusM: 5000,
  radiiM: [5000],
  coverageReady: false,
  // Mode tampilan ring/coverage di peta (pengganti pilihan Radius jangkauan lama):
  // { mode: 'dealer-ring'|'pos-coverage'|'lokasi-dealer'|'lokasi-pos'|null, value: 1..8|null }.
  // Satu objek, bukan dua field terpisah, supaya "grup mana aktif" dan "slot yang mana"
  // tidak pernah tidak sinkron (mis. mode pos-coverage dengan value sisa dari ring 1-3).
  ringView: { mode: null, value: null },

  // --- mode dan suntingan ---
  fullscreen: false,
  editing: null,           // kode outlet yang sedang disunting
  editingDealer: null,     // kode dealer yang sedang disunting
  pickingOnMap: false,     // menunggu klik di peta untuk mengambil koordinat

  // --- konsumen kelurahan yang sedang dibuka; diambil per permintaan ---
  villageCustomers: null,
};
