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
 * Tiap halaman punya salinannya sendiri: memfilter di Sales Analytics tidak boleh
 * mengubah angka yang dilihat orang di Master Pos Dealer. Sebelumnya nilainya tinggal
 * di <select> — dan satu set <select> tidak bisa menyimpan empat halaman sekaligus.
 *
 * kares > cityCode > districtCode > dealerCode > outletCode BERJENJANG sejak 2026-10-11:
 * memilih yang kecil mengisi yang besar, memilih yang besar mempersempit yang kecil —
 * lihat setScope() di filters.js. Kota/kec/kares memilih KUMPULAN DEALER terdaftar,
 * bukan lokasi pelanggan.
 */
export function makeFilter() {
  return {
    from: 'ALL',        // batas bawah periode 'YYYY-MM', 'ALL' = sejak awal
    to: 'ALL',          // batas atas periode 'YYYY-MM', 'ALL' = sampai terbaru
    kares: 'ALL',       // tingkat terbesar
    cityCode: 'ALL',
    districtCode: 'ALL', // Kec — kecamatan ASAL dealer, di antara kota dan dealer
    dealerCode: 'ALL',
    outletCode: 'ALL',
  };
}

/**
 * SATU objek filter untuk SELURUH halaman.
 *
 * MEMBALIKKAN keputusan 2026-08-29 ("Nilai filter di objek per halaman") — permintaan
 * langsung tim 2026-09-17: memilih Kota di halaman Sales Analytics lalu membuka
 * Confidence Fusion harus memberi Kota yang sama. Filter yang diam-diam berbeda antar
 * halaman membuat dua layar menampilkan angka berbeda untuk pertanyaan yang sama, dan
 * tidak ada yang tahu mana yang benar.
 *
 * Yang TIDAK ikut berubah, dan itu inti keputusan lama: nilainya tetap di `S`, bukan di
 * `<select>`. Itulah yang membuat filters.js bebas DOM dan bisa diuji tanpa browser —
 * sifat itu datang dari "disimpan di objek", bukan dari "terpisah per halaman".
 *
 * Caranya sengaja satu objek yang DIRUJUK BERKALI-KALI, bukan `pageFilters()` yang
 * ditulis ulang: seluruh pemanggil (`setScope`, `activeRows`, `syncFilterBar`,
 * `fusionFilter`) terus bekerja apa adanya, tanpa satu pun call site berubah.
 *
 * Konsekuensi yang harus diingat: halaman Data Konsumen dulu sengaja tanpa batas
 * periode. Sekarang ia ikut periode yang aktif seperti halaman lain.
 */
const FILTER_BERSAMA = makeFilter();

export const S = {
  // --- filter, terpisah per halaman ---
  filterPage: 'peta',
  filters: {
    // Keempatnya berangkat sama; fillFilterBar() yang menyetel bulan terakhir untuk
    // peta, pos, dan kelurahan. Data Konsumen sengaja ditinggal tanpa batas periode —
    // alasannya ada di sana, di sebelah kode yang menyetelnya.
    // Ketujuhnya menunjuk OBJEK YANG SAMA — lihat FILTER_BERSAMA di atas. Slotnya
    // dipertahankan (bukan diganti satu field) supaya `pageFilters(halaman)` dan
    // seluruh pemanggilnya tidak perlu berubah sama sekali.
    peta: FILTER_BERSAMA,
    pos: FILTER_BERSAMA,
    kelurahan: FILTER_BERSAMA,
    fusion: FILTER_BERSAMA,
    servis: FILTER_BERSAMA,
    kirim: FILTER_BERSAMA,
    konsumen: FILTER_BERSAMA,
  },

  // --- dari server ---
  // SATUAN ANALISIS = kecamatan sejak 2026-10-10 (docs/DECISIONS.md). Yang punya
  // penjualan atau jangkauan saja; nama SELURUH kecamatan ada di districtNames.
  districts: [],           // [{code, name, cityCode, cityName, lat, lng, hasGeom}]
  outlets: [],             // [{code, name, dealerCode, dealerName, address, lat, lng, synthetic}]
  // Katalog pos FISIK sungguhan saja — S.outlets bisa memuat baris "proxy" per
  // dealer (synthetic:true) yang menyambungkan penjualan level-dealer lama;
  // dipakai Master Pos Dealer, dropdown filter Pos, titik di peta. Diisi dari
  // S.outlets di buildIndexes(), lihat app.js.
  realOutlets: [],
  dealers: [],             // [{code, name, address, lat, lng, outletCount}]
  // `district` kunci semua hitungan; `village` HANYA untuk menyebar titik penjualan
  // di desa asalnya (map.js buildSalePoints).
  sales: [],               // [{period, district, village, outlet, dealer, units}]
  periods: [],
  // Target penjualan per bulan per dealer, dalam unit: {'2026-09': {'D001': 1200}}. Dari
  // /api/summary; diubah di tempat oleh saveTargetInput() (targets.js) setelah server menyimpan.
  targets: {},
  lastImport: null,
  hasCustomers: false,
  pendingNames: 0,         // nama kelurahan yang menunggu dicocokkan manusia
  panelView: null,         // {kind:'dealer'|'city', code} — isi panel geser

  // --- indeks, dibangun sekali saat muat ---
  districtByCode: {},
  outletByCode: {},
  dealerByCode: {},
  dealerNames: {},
  cityNames: {},
  registry: null,          // warna dealer

  // --- geo ---
  geo: null,               // batas KECAMATAN — satuan analisis, diwarnai
  villageGeo: null,        // batas kelurahan — wadah sebaran titik + lapisan "Batas desa"
  cityGeo: null,           // batas kabupaten

  // --- peta ---
  map: null,
  layersReady: false,
  basemap: 'satelit',
  markers: [],
  dealerMarkers: [],       // titik HQ dealer, terpisah dari titik pos (S.markers)
  // Hitungan titik tiga sumber per kelurahan (docs/FUSION.md 3.1). Diambil dari
  // server saat salah satu togglenya pertama dinyalakan, lalu dipakai ulang; dibuang
  // jadi null waktu filter berubah supaya tidak menampilkan angka periode lama.
  fusionPoints: null,      // {rows:[{villageCode, districtCode, dealerCode, ktp, servis, kirim}]}
  fusionPointsLoading: false,

  // --- pilihan ---
  // Pos yang sedang dipilih TIDAK disimpan di sini: dia bagian dari filter halaman,
  // dibaca lewat scopeValue('pos'). Menyimpannya lagi di sini berarti dua sumber
  // kebenaran untuk fakta yang sama, dan yang satu selalu bisa ketinggalan.
  selectedDistrict: null,
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
  districtTrendChart: null, // grafik tren bulanan di panel kecamatan
  // Saklar "Status Kelompok Relatif" di Opsi Peta (nyala bawaan). Mati = peta diwarnai
  // menurut jumlah unit mutlak. Mode heatmap "Per Nilai Kontribusi" dihapus 2026-10-11.
  statusRelatif: true,
  // Kecamatan tempat tiap dealer berada beserta yang berbatasan langsung dengannya:
  // {dealerCode: [districtCode, ...]} dari server. Bahan kategori Others vs Pelanggaran Wilayah.
  dealerBorder: {},
  // SEMUA kecamatan (bukan hanya yang berpenjualan): kode -> {code, name, cityCode}.
  // Dibutuhkan filter Kec untuk tahu kota sebuah kecamatan.
  allDistrictByCode: {},

  // --- ring dealer & coverage pos: dealerRings[dealerCode][districtCode] = 1|2|3,
  // posCoverage[outletCode][districtCode] = 1..8 ---
  // Sejak 2026-08-31 sore, ring pindah dari pos+kelurahan ke DEALER+KECAMATAN, dan pos
  // mendapat konsep baru coverage (1-8, kecamatan) — lihat docs/DECISIONS.md. Data ring
  // versi pos+kelurahan lama dihapus total, mulai dari kosong.
  dealerRings: {},
  posCoverage: {},
  districtNames: {},       // kode kecamatan -> nama, untuk menyebutnya di layar (Master Kelurahan)

  // --- jangkauan ---
  coverage: {},            // coverage[outletCode][districtCode] = rasio, radius aktif
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

  // --- konsumen kecamatan yang sedang dibuka; diambil per permintaan ---
};
