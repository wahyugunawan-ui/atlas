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
import { $, bbox, esc, fillSelect, formatNumber, monthLabel, toast } from './dom.js';
import { activeRows, applyScope, scopeLabel } from './filters.js';
import {
  addLayers, fitToScope, invalidateSalePoints, paintChoropleth, redrawMap, setBasemap,
  setRadius, setupMap, toggleFullscreen,
} from './map.js';
import { closeSelectionInfo, drawMarkers, selectOutlet } from './outlets.js';
import { filterSelectOptions } from './select-search.js';
import {
  closeDealerCard, renderDealerCard, renderDealerLegend, renderKpi, renderLegend,
  renderPerformance, renderTreemap, selectEntity, setTreemapView,
} from './render.js';
import { S } from './state.js';
import {
  acceptMapPoint, closeOutletEditor, closeVillageDetail, jumpToVillage,
  customerPage, dealerChoiceChanged, openOutletEditor, openVillageDetail, pickFromMap,
  promptPin,
  renderCustomerTable,
  renderOutletTable, renderVillageTable, saveOutletEditor, searchCustomers, showOnMap,
  switchTab,
} from './tables.js';
import {
  dragLeave, dragOver, dropFile, fileChosen, finishImport, importPeriodChanged,
  importStep, pickFile, refreshImportTab, reimportPeriod, reviewImport, runUpload,
  setupImportTab,
} from './import.js';

const HANDLERS = {
  // filter dan peta
  onFilterChange, resetFilters, redrawMap, setBasemap, setRadius,
  mirrorFilter, applyScope, toggleFullscreen, fitToScope,
  // ringkasan
  setTreemapView, selectEntity, closeDealerCard,
  // sunting pos
  openOutletEditor, closeOutletEditor, pickFromMap, saveOutletEditor, dealerChoiceChanged,
  // peta dan outlet
  selectOutlet, closeSelectionInfo, openVillageDetail, closeVillageDetail,
  // tabel
  switchTab, renderOutletTable, renderVillageTable, showOnMap, jumpToVillage, promptPin,
  renderCustomerTable, searchCustomers, customerPage,
  // impor
  importStep, importPeriodChanged, pickFile, fileChosen, dropFile, dragOver, dragLeave,
  runUpload, reviewImport, finishImport, reimportPeriod, refreshImportTab,
  // pencarian di dalam dropdown; dengan 51 dealer dan 78 pos, menggulir daftar
  // sepanjang itu lebih lambat daripada mengetik tiga huruf
  filterSelectOptions,
  // dipanggil antar modul lewat window supaya tidak ada lingkaran import
  renderAll, reloadSummary,
};
Object.assign(window, HANDLERS);

/* ==========================================================================
   FILTER
   ========================================================================== */

let lastPeriod = null;

export function onFilterChange() {
  // Titik penjualan dibangun ulang HANYA kalau periodenya berganti. Filter lain tidak
  // mengubah titiknya — cuma warnanya — dan membangun ulang 18 ribu titik tiap kali
  // dropdown disentuh akan terasa berat tanpa alasan.
  const period = $('filter-periode').value;
  if (period !== lastPeriod) { invalidateSalePoints(); lastPeriod = period; }
  renderAll();
}

/** Pasangan dropdown layar penuh dan filter utama yang dicerminkannya. */
const FS_MIRROR = [
  ['fs-periode', 'filter-periode'], ['fs-kota', 'filter-kota'],
  ['fs-dealer', 'filter-dealer'], ['fs-pos', 'filter-pos'],
];

/** Dropdown saat layar penuh menyalin nilainya ke filter utama, lalu render ulang. */
export function mirrorFilter(id, el) {
  $(id).value = el.value;
  if (id === 'filter-pos') S.selectedOutlet = el.value === 'ALL' ? null : el.value;
  if (id === 'filter-periode') invalidateSalePoints();
  renderAll();
}

export function resetFilters() {
  ['filter-provinsi', 'filter-kota', 'filter-dealer', 'filter-pos']
    .forEach((id) => { $(id).value = 'ALL'; });
  S.selectedOutlet = null;
  closeVillageDetail();
  renderAll();
}

/* ==========================================================================
   RENDER
   ========================================================================== */

export function renderAll() {
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

  // Dropdown layar penuh cuma cermin; nilainya selalu mengikuti filter utama.
  FS_MIRROR.forEach(([mirror, main]) => {
    if ($(mirror)) $(mirror).value = $(main).value;
  });

  S.selectedOutlet = $('filter-pos').value === 'ALL' ? null : $('filter-pos').value;

  if (S.layersReady) {
    drawMarkers();
    redrawMap();
  }
  if (S.selectedVillage) openVillageDetail(S.selectedVillage);
}

/* ==========================================================================
   MUAT
   ========================================================================== */

function buildIndexes(data) {
  S.villages = data.villages;
  S.outlets = data.outlets;
  S.sales = data.sales;
  S.periods = data.periods;
  S.lastImport = data.lastImport;
  S.hasCustomers = data.hasCustomers;

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
  S.dealerNames = {};
  data.outlets.forEach((o) => {
    S.outletByCode[o.code] = o;
    S.dealerNames[o.dealerCode] = o.dealerName;
  });

  // Registry dibangun SEKALI dari seluruh penjualan, bukan dari hasil filter — kalau
  // tidak, dealer yang bertahan akan berganti warna tiap kali filter diubah.
  S.registry = buildColorRegistry(data.sales, S.dealerNames);
}

function fillFilters() {
  const periodPairs = S.periods.slice().reverse().map((p) => [p, monthLabel(p)]);
  fillSelect($('filter-periode'), periodPairs, 'Semua Periode');
  // Halaman Data Konsumen sengaja dibiarkan di "Semua Periode": dia untuk menelusuri
  // apa yang sudah masuk, bukan untuk menganalisis satu bulan.
  fillSelect($('mkon-filter-periode'), periodPairs, 'Semua Periode');
  if (S.periods.length) {
    $('filter-periode').value = S.periods[S.periods.length - 1];
    lastPeriod = $('filter-periode').value;
  }

  const provinces = [...new Set(S.villages.map((v) => v.provinceCode))].sort();
  const provincePairs = provinces.map((p) => [p, PROVINCE_NAMES[p] || 'Provinsi ' + p]);
  fillSelect($('filter-provinsi'), provincePairs, 'Semua Provinsi');
  fillSelect($('mkel-filter-provinsi'), provincePairs, 'Semua Provinsi');

  const cityPairs = Object.keys(S.cityNames)
    .sort((a, b) => S.cityNames[a].localeCompare(S.cityNames[b]))
    .map((c) => [c, S.cityNames[c]]);
  fillSelect($('filter-kota'), cityPairs, 'Semua Kota');
  fillSelect($('mkel-filter-kota'), cityPairs, 'Semua Kota');
  fillSelect($('mkon-filter-kota'), cityPairs, 'Semua Kota');

  const dealerPairs = S.registry.order
    .filter((code) => S.dealerNames[code])
    .map((code) => [code, S.dealerNames[code]]);
  fillSelect($('filter-dealer'), dealerPairs, 'Semua Dealer');
  fillSelect($('mpos-filter-dealer'), dealerPairs, 'Semua Dealer');
  fillSelect($('mkon-filter-dealer'), dealerPairs, 'Semua Dealer');

  fillSelect($('filter-pos'),
    S.outlets.slice().sort((a, b) => a.name.localeCompare(b.name))
      .map((o) => [o.code, o.name]), 'Semua Pos Dealer');

  // Dropdown layar penuh dibangun dari yang utama, supaya tidak ada dua daftar yang
  // bisa menyimpang.
  FS_MIRROR.forEach(([mirror, main]) => {
    if (!$(mirror)) return;
    $(mirror).innerHTML = $(main).innerHTML;
    $(mirror).value = $(main).value;
  });

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
  S.map.on('mouseleave', 'kel-isi', () => { S.map.getCanvas().style.cursor = ''; });
}

boot();
