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
import { PROVINCE_NAMES } from './config.js';
import { $, bbox, esc, formatNumber, monthLabel, toast } from './dom.js';
import { chooseCombo, comboSearch, toggleCombo } from './combobox.js';
import {
  assignRing, cancelRingEdit, closeRingChooser, openRingChooser, ringEditing,
  saveRingEdit, startRingEdit,
} from './rings.js';
import { fillFilterBar, onPeriodChange, resetFilters, syncFilterBar } from './filter-bar.js';
import { activeRows, applyScope, scopeLabel, scopeValue } from './filters.js';
import {
  addLayers, fitToScope, invalidateSalePoints, paintChoropleth, redrawMap, setBasemap,
  toggleDistrictNames,
  setRadius, setupMap, toggleFullscreen,
} from './map.js';
import {
  closeSelectionInfo, drawMarkers, selectOutlet, showVillageTooltip,
} from './outlets.js';
import {
  closeDealerCard, renderDealerCard, renderDealerLegend, renderKpi, renderLegend,
  closePerformaFull, openPerformaFull, renderPerformance, renderTreemap, selectEntity,
  setTreemapView, togglePerformanceSort, toggleLivePerforma,
} from './render.js';
import { S } from './state.js';
import {
  acceptMapPoint, closeOutletEditor, closeVillageDetail, jumpToVillage,
  openDealerDetail, toggleDealerCity, jumpFromDealer,
  closeNewOutlet, closeMatchNames, confirmMatch, customerPage, dealerChoiceChanged,
  newOutletDealerChanged, openMatchNames, undoMatch,
  openNewOutlet, saveNewOutlet,
  askResetOutlets, closeResetOutlets, resetOutletsTyped, confirmResetOutlets,
  openOutletEditor, openVillageDetail, pickFromMap,
  promptPin,
  editRingFromTable,
  renderCustomerTable,
  renderOutletTable, renderVillageTable, saveOutletEditor, searchCustomers, showOnMap,
  switchTab,
  renderDealerTable, openNewDealer, closeNewDealer, saveNewDealer,
  openDealerEditor, closeDealerEditor, saveDealerEditor, deleteDealerConfirm,
} from './tables.js';
import {
  askDeletePeriod, closeDeletePeriod, confirmDeletePeriod, deletePeriodTyped,
  dragLeave, dragOver, dropFile, fileChosen, finishImport, importPeriodChanged,
  importStep, pickFile, refreshImportTab, reimportPeriod, reviewImport, runUpload,
  setupImportTab,
} from './import.js';

const HANDLERS = {
  // filter dan peta
  onPeriodChange, toggleCombo, comboSearch, chooseCombo, resetFilters,
  startRingEdit, cancelRingEdit, saveRingEdit, ringEditing,
  openRingChooser, closeRingChooser, assignRing,
  redrawMap, setBasemap, setRadius, applyScope, toggleFullscreen, fitToScope,
  toggleDistrictNames,
  // ringkasan
  setTreemapView, selectEntity, closeDealerCard, togglePerformanceSort,
  toggleLivePerforma, openPerformaFull, closePerformaFull,
  // sunting pos
  openOutletEditor, closeOutletEditor, pickFromMap, saveOutletEditor, dealerChoiceChanged,
  // peta dan outlet
  selectOutlet, closeSelectionInfo, openVillageDetail, closeVillageDetail,
  // tabel
  switchTab, renderOutletTable, renderVillageTable, showOnMap, jumpToVillage, promptPin,
  openDealerDetail, toggleDealerCity, jumpFromDealer,
  renderCustomerTable, searchCustomers, customerPage, editRingFromTable,
  openNewOutlet, closeNewOutlet, newOutletDealerChanged, saveNewOutlet,
  askResetOutlets, closeResetOutlets, resetOutletsTyped, confirmResetOutlets,
  renderDealerTable, openNewDealer, closeNewDealer, saveNewDealer,
  openDealerEditor, closeDealerEditor, saveDealerEditor, deleteDealerConfirm,
  openMatchNames, closeMatchNames, confirmMatch, undoMatch,
  // impor
  importStep, importPeriodChanged, pickFile, fileChosen, dropFile, dragOver, dragLeave,
  runUpload, reviewImport, finishImport, reimportPeriod, refreshImportTab,
  askDeletePeriod, closeDeletePeriod, deletePeriodTyped, confirmDeletePeriod,
  // dipanggil antar modul lewat window supaya tidak ada lingkaran import
  renderAll, reloadSummary,
};
Object.assign(window, HANDLERS);

/* ==========================================================================
   RENDER
   ========================================================================== */

/**
 * Gambar ulang halaman Insight & Peta.
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

  let perVillage;
  let breaks;
  if (S.layersReady) {
    ({ perVillage, breaks } = paintChoropleth(rows));
    renderLegend(perVillage, breaks);
  } else {
    perVillage = {};
    rows.forEach((r) => { perVillage[r.village] = (perVillage[r.village] || 0) + r.units; });
  }

  renderKpi(rows, perVillage);
  renderTreemap(rows);
  renderPerformance(rows);
  renderDealerCard();
  renderDealerLegend(rows);

  const scope = scopeLabel();
  $('scope-label').textContent = scope;
  $('scope-clear').classList.toggle('hidden', scope === 'seluruh penjualan');

  // Ring melekat pada POS, jadi tombolnya cuma masuk akal waktu satu pos yang dipilih.
  // Muncul untuk dealer akan menyesatkan: yang tersimpan bukan ring dealer.
  const adaPos = scopeValue('pos') !== 'ALL';
  $('btn-edit-ring').classList.toggle('hidden', !adaPos);
  $('btn-ring-peta').classList.toggle('hidden', !adaPos);

  // Jumlah nama yang menunggu dicocokkan, di tombolnya sendiri. Pekerjaan yang
  // menunggu harus terlihat tanpa ada yang membuka modalnya dulu.
  $('mkel-pending').textContent = S.pendingNames;
  $('mkel-pending').classList.toggle('hidden', !S.pendingNames);

  if (S.layersReady) {
    drawMarkers();
    redrawMap();
  }
  // Panel geser digambar ulang mengikuti ISINYA, bukan selalu dianggap kelurahan.
  // Sebelum ada panel dealer, baris ini cukup berbunyi "kalau ada kelurahan terpilih,
  // buka lagi" — dan begitu panel dealer ada, tiap filter disentuh panelnya akan
  // tertimpa jadi panel kelurahan tanpa ada yang meminta.
  if (S.panelView && S.panelView.kind === 'dealer') openDealerDetail(S.panelView.code);
  else if (S.selectedVillage) openVillageDetail(S.selectedVillage);
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

  S.rings = data.rings || {};
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

  $('pilihan-radius').innerHTML = S.radiiM.map((r) =>
    `<button id="radius-${r}" onclick="setRadius(${r})" ` +
    `class="flex-1 px-2 py-1.5 rounded-md text-[11px] font-bold ` +
    `${r === S.radiusM ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}">` +
    `${r / 1000} km</button>`).join('');
  $('label-radius').textContent = (S.radiusM / 1000).toFixed(0) + ' km';
}

function updateStatus() {
  const units = S.sales.reduce((sum, r) => sum + r.units, 0);
  $('sidebar-status').textContent =
    `${formatNumber(S.villages.length)} kelurahan · ${S.outlets.length} pos · ` +
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
