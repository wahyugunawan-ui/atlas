/**
 * Titik masuk halaman: muat data dari server, susun dropdown, render pertama.
 *
 * Juga mendaftarkan fungsi handler ke window. Markup memakai onclick="namaFungsi()",
 * dan fungsi di dalam modul ES tidak otomatis global. Daftarnya ditulis eksplisit di
 * bawah supaya sekali lihat ketahuan mana saja yang jadi permukaan halaman —
 * test/page.test.js memastikan tidak ada yang kurang dan tidak ada nama hantu.
 */
import { fetchGeo, fetchSummary } from './api.js';
import { buildColorRegistry } from './colors.js';
import { $, bbox, esc, formatNumber, monthLabel, toast } from './dom.js';
import { chooseCombo, comboSearch, toggleCombo } from './combobox.js';
import {
  anyGroupEditing, assignRing, cancelRingEdit, closeRingChooser,
  openRingChooser, ringEditing, coverageEditing, saveRingEdit, startRingEdit,
  startCoverageEdit, startGroupEdit,
} from './rings.js';
import { fillFilterBar, onPeriodChange, resetFilters, syncFilterBar } from './filter-bar.js';
import { activeRows, applyScope, scopeValue } from './filters.js';
import {
  addLayers, fitToScope, invalidateSalePoints, redrawMap, refreshMapVisual, setBasemap,
  setCoverageViewPos, setHeatmapMode, setRingViewDealer, syncGroupControls,
  syncHeatmapModeButtons, toggleDistrictNames, setupMap, toggleFullscreen,
  toggleFusionPoints,
} from './map.js';
import {
  closeSelectionInfo, selectOutlet, showVillageTooltip,
} from './outlets.js';
import {
  closeDealerCard, closeTreemapFull, renderDealerCard, renderDealerLegend, renderTopSummary,
  renderLegend, closePerformaFull, filterPerformanceGroup, openPerformaFull,
  openTreemapFull, renderPerformance, renderTreemap, renderWilayah, selectEntity,
  setPerformanceCriteria, setPerformanceCoverageFocus, setTreemapView, syncFullscreenPanels,
  togglePerformanceSort, toggleLivePerforma, toggleLiveWilayah,
} from './render.js';
import { S } from './state.js';
import {
  acceptMapPoint, closeOutletEditor, closeVillageDetail, jumpToVillage,
  openDealerDetail, openCitySummary, toggleDealerCity, jumpFromDealer,
  closeNewOutlet, closeMatchNames, confirmMatch, customerPage, dealerChoiceChanged,
  newOutletDealerChanged, openMatchNames, undoMatch,
  openNewOutlet, saveNewOutlet,
  askResetOutlets, closeResetOutlets, resetOutletsTyped, confirmResetOutlets,
  openOutletEditor, openVillageDetail, pickFromMap,
  promptPin,
  editDealerRingFromTable, editPosCoverageFromTable,
  renderCustomerTable,
  renderOutletTable, renderVillageTable, saveOutletEditor, searchCustomers, showOnMap,
  switchTab, toggleMasterMenu, toggleDataMenu, bukaBagianImport,
  renderDealerTable, openNewDealer, closeNewDealer, saveNewDealer,
  openDealerEditor, closeDealerEditor, saveDealerEditor, deleteDealerConfirm,
} from './tables.js';
import {
  bukaTelusurMesin, cariCakupan, kirimPage, renderDeliveryTable, renderFusion,
  renderServiceTable, servisPage, setKpiServis, setModeGolongan, toggleCakupanPanel,
  toggleLiveFusion,
  toggleSumberCakupan, tutupTelusurMesin,
} from './fusion.js';
import {
  askDeletePeriod, closeDeletePeriod, confirmDeletePeriod, deletePeriodTyped,
  dragLeave, dragOver, dropFile, fileChosen, finishImport, importPeriodChanged,
  importStep, pickFile, refreshImportTab, reimportPeriod, reviewImport, runUpload,
  togglePeriodeDetail, pilihSumber, unggahSumber, hapusSumber,
  setupImportTab,
} from './import.js';
import {
  applyPosImport, closePosImport, openPosImport, posImportFileChosen,
} from './pos-import.js';

const HANDLERS = {
  // filter dan peta
  onPeriodChange, toggleCombo, comboSearch, chooseCombo, resetFilters,
  startRingEdit, startCoverageEdit, startGroupEdit, cancelRingEdit, saveRingEdit, ringEditing,
  coverageEditing, anyGroupEditing,
  openRingChooser, closeRingChooser, assignRing,
  redrawMap, setBasemap, setRingViewDealer, setCoverageViewPos, setHeatmapMode,
  applyScope, toggleFullscreen, fitToScope, toggleDistrictNames, toggleFusionPoints,
  // ringkasan
  setTreemapView, selectEntity, closeDealerCard, togglePerformanceSort,
  toggleLivePerforma, openPerformaFull, closePerformaFull,
  setPerformanceCriteria, setPerformanceCoverageFocus, filterPerformanceGroup,
  openTreemapFull, closeTreemapFull, toggleLiveWilayah,
  // sunting pos
  openOutletEditor, closeOutletEditor, pickFromMap, saveOutletEditor, dealerChoiceChanged,
  // peta dan outlet
  selectOutlet, closeSelectionInfo, openVillageDetail, closeVillageDetail,
  // tabel
  switchTab, toggleMasterMenu, toggleDataMenu, bukaBagianImport, renderOutletTable, renderVillageTable, showOnMap, jumpToVillage, promptPin,
  openDealerDetail, openCitySummary, toggleDealerCity, jumpFromDealer,
  renderCustomerTable, searchCustomers, customerPage,
  // penyatuan tiga sumber (docs/FUSION.md Tahap F)
  renderFusion, renderServiceTable, renderDeliveryTable, servisPage, kirimPage,
  setKpiServis,
  toggleSumberCakupan, cariCakupan, bukaTelusurMesin, tutupTelusurMesin,
  setModeGolongan, toggleCakupanPanel, toggleLiveFusion,
  editDealerRingFromTable, editPosCoverageFromTable,
  openNewOutlet, closeNewOutlet, newOutletDealerChanged, saveNewOutlet,
  askResetOutlets, closeResetOutlets, resetOutletsTyped, confirmResetOutlets,
  renderDealerTable, openNewDealer, closeNewDealer, saveNewDealer,
  openDealerEditor, closeDealerEditor, saveDealerEditor, deleteDealerConfirm,
  openMatchNames, closeMatchNames, confirmMatch, undoMatch,
  applyPosImport, closePosImport, openPosImport, posImportFileChosen,
  // impor
  importStep, importPeriodChanged, pickFile, fileChosen, dropFile, dragOver, dragLeave,
  runUpload, reviewImport, finishImport, reimportPeriod, refreshImportTab,
  togglePeriodeDetail, pilihSumber, unggahSumber, hapusSumber,
  askDeletePeriod, closeDeletePeriod, deletePeriodTyped, confirmDeletePeriod,
  // dipanggil antar modul lewat window supaya tidak ada lingkaran import
  // syncFilterBar ikut didaftarkan sejak mode Live halaman Fusion: fusion.js
  // memanggilnya lewat window supaya tidak perlu meng-import filter-bar.js —
  // impor itu menarik combobox.js yang menyentuh `document` saat dimuat, dan
  // membuat fusion.js tidak bisa lagi di-import di Node oleh tesnya.
  renderAll, reloadSummary, syncHeatmapModeButtons, syncGroupControls, syncFilterBar,
};
Object.assign(window, HANDLERS);

/* ==========================================================================
   RENDER
   ========================================================================== */

/**
 * Gambar ulang halaman Sales Analytics.
 *
 * Namanya "semua" karena dia menggambar SELURUH halaman Peta sekaligus, bukan karena
 * dia menggambar seluruh aplikasi. Halaman lain punya penggambarnya sendiri dan
 * memakai filter halamannya sendiri — memanggil yang ini dari sana akan mewarnai peta
 * dengan filter milik halaman lain.
 */
export function renderAll() {
  if (S.filterPage !== 'peta') return;

  // Bilah filter ikut disamakan DI SINI, bukan cuma di penangan dropdown-nya.
  // Klik marker, blok treemap, baris performa, dan chip kartu dealer semuanya
  // mengubah lingkup lewat applyScope() tanpa menyentuh <select> sama sekali —
  // tanpa baris ini, peta sudah berpindah sementara bilahnya masih menunjukkan
  // filter yang lama, dan tidak ada yang tahu mana yang benar.
  syncFilterBar();

  const rows = activeRows();

  // Bagian VISUAL peta (heatmap, titik, marker) dipindah ke refreshMapVisual() di
  // map.js supaya halaman Confidence Fusion bisa memakai yang SAMA. Sebelum ini
  // satu-satunya yang menggambarnya adalah fungsi ini — dan fungsi ini berhenti di
  // baris pertama begitu halamannya bukan 'peta', jadi peta yang sedang menumpang di
  // halaman Fusion tidak pernah ikut berganti waktu filternya berpindah.
  //
  // Legendanya tetap digambar DI SINI, bukan ikut masuk refreshMapVisual(): `#legend`
  // adalah saudara `#map` di dalam `#map-shell`, jadi ia tidak ikut pindah ke halaman
  // Fusion dan tidak ada yang bisa membacanya di sana.
  //
  // Cabang `else` yang lama (menghitung perVillage waktu lapisan belum siap) DIBUANG:
  // nilainya tidak pernah dibaca satu baris pun sesudahnya — kode mati yang terbaca
  // seperti sedang menjaga sesuatu.
  const visual = refreshMapVisual();
  if (visual) renderLegend(visual.perVillage, visual.breaks);

  renderTopSummary(rows);
  renderTreemap(rows);
  renderPerformance(rows);
  renderWilayah(rows);
  syncFullscreenPanels();
  renderDealerCard();
  renderDealerLegend(rows);

  // Sejak 2026-08-31 sore: ring milik DEALER, coverage milik POS — tombolnya SATU
  // slot per lokasi, tapi label dan aksinya ikut scope yang sedang aktif. Dealer
  // scope menang kalau kebetulan keduanya aktif (tidak akan terjadi sejak scope
  // kota/dealer/pos saling eksklusif, tapi urutan pengecekan tetap eksplisit).
  const dealerScope = scopeValue('dealer') !== 'ALL';
  const posScope = scopeValue('pos') !== 'ALL';
  const bisaEditGroup = dealerScope || posScope;
  const labelGroup = dealerScope ? 'Edit ring' : 'Edit coverage';
  $('btn-ring-peta').classList.toggle('hidden', !bisaEditGroup);
  $('btn-ring-peta').querySelector('span').textContent = labelGroup;

  // Jumlah nama yang menunggu dicocokkan, di tombolnya sendiri. Pekerjaan yang
  // menunggu harus terlihat tanpa ada yang membuka modalnya dulu.
  $('mkel-pending').textContent = S.pendingNames;
  $('mkel-pending').classList.toggle('hidden', !S.pendingNames);

  // drawMarkers/drawDealerMarkers/redrawMap sekarang dijalankan refreshMapVisual() di
  // atas, satu paket dengan paintChoropleth. Urutannya jadi lebih awal daripada
  // sebelumnya, dan itu aman: ketiganya cuma membaca activeRows() dan S.outlets/S.map,
  // tidak satu pun bergantung pada panel yang digambar di antara keduanya.

  // Panel geser digambar ulang mengikuti ISINYA, bukan selalu dianggap kelurahan.
  // Dealer dan kota memakai S.panelView; keduanya cuma dibuka lewat aksi eksplisit
  // (tombol/dropdown), jadi menutupnya tetap "nempel" — tidak ada baris di sini yang
  // membuka ulang panel yang sengaja ditutup pengguna.
  if (S.panelView && S.panelView.kind === 'dealer') {
    openDealerDetail(S.panelView.code);
  } else if (S.panelView && S.panelView.kind === 'city') {
    openCitySummary(S.panelView.code);
  } else if (S.selectedVillage) {
    // Kalau kotanya sendiri berubah dan kelurahan yang sedang dibuka sudah tidak
    // termasuk kota aktif, panel diganti jadi ringkasan kota itu — bukan tetap
    // menampilkan kelurahan yang sudah di luar cakupan filter (aturan spek).
    const village = S.villageByCode[S.selectedVillage];
    const cityAktif = scopeValue('kota');
    if (village && cityAktif !== 'ALL' && village.cityCode !== cityAktif) {
      openCitySummary(cityAktif);
    } else {
      openVillageDetail(S.selectedVillage);
    }
  }

  // Sejak 2026-09-14: peta ikut "Fit" otomatis (auto=true — animasi 900ms yang
  // sengaja pelan, tanpa toast "tidak ada data") tiap kali renderAll() jalan — ini funnel bersama
  // reset filter, klik marker dealer/pos, dan semua pilihan dropdown Kota/Kares/
  // Dealer/Pos, jadi satu baris di sini sudah mencakup semuanya. Klik kelurahan di
  // peta funnel-nya beda (lewat openVillageDetail() langsung, TIDAK renderAll()) —
  // fitToScope(true) untuk jalur itu ditaruh di openVillageDetail() sendiri.
  if (S.layersReady) fitToScope(true);
}

/* ==========================================================================
   MUAT
   ========================================================================== */

function buildIndexes(data) {
  S.villages = data.villages;
  S.outlets = data.outlets;
  S.dealers = data.dealers || [];
  S.sales = data.sales;
  S.periods = data.periods;
  S.lastImport = data.lastImport;
  S.hasCustomers = data.hasCustomers;
  S.pendingNames = data.pendingNames || 0;
  // Acuan bisnis (Business Reference), bukan hasil statistik — lihat config.js.
  S.businessReferencePercent = data.businessReferencePercent;

  S.dealerRings = data.dealerRings || {};
  S.posCoverage = data.posCoverage || {};
  S.districtNames = {};
  (data.districts || []).forEach((d) => { S.districtNames[d.code] = d.name; });
  S.coverageAll = data.coverage || {};
  S.radiiM = data.radiiM || [data.radiusM || 5000];
  S.radiusM = data.radiusM || S.radiiM[0];
  S.coverage = S.coverageAll[S.radiusM] || {};
  S.coverageReady = Boolean(data.coverageReady);

  S.villageByCode = {};
  S.cityNames = {};
  data.villages.forEach((v) => {
    S.villageByCode[v.code] = v;
    S.cityNames[v.cityCode] = v.cityName;
  });

  S.outletByCode = {};
  data.outlets.forEach((o) => { S.outletByCode[o.code] = o; });

  // Baris "proxy" (S.outletByCode tetap memuatnya, perlu untuk resolusi nama
  // dealer di kolom "Pos Dealer" Data Konsumen dan tempat lain yang mencari lewat
  // kode) TAPI disaring dari sini — S.realOutlets dipakai KATALOG pos fisik
  // sungguhan: Master Pos Dealer, dropdown filter Pos, titik di peta. Lihat
  // schema.sql komentar outlets.is_dealer_proxy.
  S.realOutlets = data.outlets.filter((o) => !o.synthetic);

  // Dari dealers, bukan diturunkan dari outlets — dealer yang belum punya pos sama
  // sekali (baru dibuat di Master Dealer) harus tetap muncul di dropdown pos.
  S.dealerByCode = {};
  S.dealerNames = {};
  S.dealers.forEach((d) => {
    S.dealerByCode[d.code] = d;
    S.dealerNames[d.code] = d.name;
  });

  // Registry dibangun SEKALI dari seluruh penjualan, bukan dari hasil filter — kalau
  // tidak, dealer yang bertahan akan berganti warna tiap kali filter diubah.
  S.registry = buildColorRegistry(data.sales, S.dealerNames);
}

function fillFilters() {
  fillFilterBar();
  // Pemilih Radius jangkauan (#pilihan-radius/#label-radius) dihapus dari markup
  // sejak 2026-08-31 — diganti "Tampilkan Ring" (Bagian I, permintaan Pakbos).
  // S.radiusM tetap 5000 tetap (default), dipakai diam-diam oleh dealerCardHtml()
  // dan tooltip kelurahan yang masih memakai splitByCoverage().
}

function updateStatus() {
  const units = S.sales.reduce((sum, r) => sum + r.units, 0);
  $('sidebar-status').textContent =
    `${formatNumber(S.villages.length)} kelurahan · ${S.realOutlets.length} pos · ` +
    `${S.registry.order.length} dealer · ${formatNumber(units)} unit` +
    (S.hasCustomers ? '' : ' · tanpa data konsumen');
}

/** Muat ulang data setelah impor, tanpa memuat ulang seluruh halaman. */
export async function reloadSummary() {
  try {
    const data = await fetchSummary();
    buildIndexes(data);
    fillFilters();
    invalidateSalePoints();
    updateStatus();
    renderAll();
  } catch (error) {
    toast('Gagal memuat ulang data: ' + error.message, 'error');
  }
}

function showLoadError(error) {
  $('pageLoader').classList.add('hidden');
  $('sidebar-status').textContent = 'Gagal memuat data';
  $('mapError').innerHTML =
    '<div class="max-w-lg text-center">' +
    '<i class="ph-fill ph-warning-circle text-4xl" style="color: var(--astra-red)"></i>' +
    '<p class="mt-3 font-extrabold text-slate-800">Data tidak bisa dimuat</p>' +
    '<p class="mt-1 text-sm text-slate-500">' + esc(error.message) + '</p>' +
    '<p class="mt-3 text-xs text-slate-500">Kalau ini server yang baru dipasang, ' +
    'datanya memang belum ada. Buka tab <b>Import Data</b> untuk mengunggah berkas ' +
    'bulanan yang pertama.</p></div>';
  $('mapError').classList.remove('hidden');
}

async function boot() {
  setupImportTab();

  let data;
  try {
    data = await fetchSummary();
  } catch (error) {
    showLoadError(error);
    return;
  }

  buildIndexes(data);
  fillFilters();
  updateStatus();

  // Tanpa data penjualan sama sekali, peta tidak punya apa pun untuk digambar. Yang
  // berguna bukan peta kosong, tapi kalimat yang memberi tahu langkah berikutnya.
  if (!S.sales.length) {
    $('pageLoader').classList.add('hidden');
    showLoadError(new Error('Belum ada data penjualan di server ini.'));
    renderAll();
    return;
  }

  try {
    const [villageGeo, cityGeo] = await Promise.all([
      fetchGeo('kelurahan.geojson'), fetchGeo('kota.geojson'),
    ]);
    S.geo = villageGeo;
    S.cityGeo = cityGeo;
  } catch (error) {
    showLoadError(error);
    return;
  }

  setupMap();
  S.map.on('load', () => {
    addLayers();
    // Gaya awal peta menyalakan basemap 'lokal' — S.basemap default 'satelit' baru
    // diterapkan di sini, di belakang pageLoader, supaya tidak ada kedipan basemap
    // yang salah sebelum berpindah.
    setBasemap(S.basemap);
    S.layersReady = true;
    S.map.fitBounds(bbox(S.geo), { padding: 30, duration: 0 });
    S.map.resize();
    setTreemapView('dealer');
    renderAll();
    renderOutletTable();
    $('pageLoader').classList.add('hidden');
  });

  S.map.on('click', 'kel-isi', (e) => {
    // Sedang menunggu titik untuk menyunting pos: klik ini artinya koordinat, bukan
    // membuka kelurahan.
    if (S.pickingOnMap) { acceptMapPoint(e.lngLat); return; }
    if (e.features && e.features.length) {
      const code = e.features[0].properties.kode;
      S.map.setFilter('kel-terpilih', ['==', ['get', 'kode'], code]);
      openVillageDetail(code);
    }
  });
  S.map.on('mouseenter', 'kel-isi', () => { S.map.getCanvas().style.cursor = 'pointer'; });
  // Tooltip mengikuti kursor DI SEPANJANG poligon, bukan cuma muncul saat masuk.
  // Satu kelurahan bisa selebar layar di zoom rendah; tooltip yang diam di titik
  // masuk akan tertinggal jauh dari kursor dan terbaca seperti milik kelurahan
  // sebelah — salah baca yang tidak pernah terasa seperti bug.
  S.map.on('mousemove', 'kel-isi', (e) => {
    if (S.pickingOnMap) return;
    if (e.features && e.features.length) {
      showVillageTooltip(e.features[0].properties.kode, e.originalEvent);
    }
  });

  S.map.on('mouseleave', 'kel-isi', () => {
    S.map.getCanvas().style.cursor = '';
    $('tooltip').classList.remove('show');
  });
}

boot();
