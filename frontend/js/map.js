/**
 * Peta: basemap, lapisan choropleth, batas kabupaten, radius, dan titik penjualan.
 */
import {
  ATTRIBUTION, ATTRIBUTION_SATELLITE, BASEMAP_PMTILES, BASEMAP_SATELLITE,
} from './config.js';
import { classOf, dealerColor, percentileBreaks, RAMP, COLOR_EMPTY } from './colors.js';
import { $, bbox, sumBy, toast } from './dom.js';
import { fetchGeo } from './api.js';
import { activeRows, pageFilters, scopeValue } from './filters.js';
import { circle, EMPTY_COLLECTION } from './geo.js';
import { S } from './state.js';

/**
 * Id lapisan basemap lokal, diambil dari tema waktu peta dibuat.
 *
 * DITANGKAP, BUKAN DITEBAK. Sebelumnya daftarnya dicari ulang tiap kali basemap
 * diganti dengan menyaring `layer.source === 'protomaps'` — dan penyaring itu
 * MELEWATKAN satu lapisan: tema protomaps diawali lapisan bertipe `background`, dan
 * lapisan background di MapLibre memang TIDAK punya `source` sama sekali.
 *
 * Akibatnya lapisan itu tidak pernah ikut dimatikan. Dia berwarna #a3a3a3 pekat dan
 * duduk DI ATAS lapisan citra satelit, jadi menekan tombol Satelit menghasilkan layar
 * abu-abu rata: ubinnya diminta, dijawab 200, lalu tertutup rapat. Tidak ada error,
 * tidak ada ubin gagal — cuma satu lapisan yang lupa dimatikan.
 *
 * Karena tema ini yang membuat lapisannya, tema ini juga yang tahu daftarnya. Menyimpan
 * hasilnya menghapus tebakan sekaligus menghapus panggilan `getStyle()` yang
 * menserialisasi 66 lapisan tiap kali tombol ditekan.
 */
let basemapLayerIds = [];

export function setupMap() {
  // Protokol pmtiles harus terdaftar SEBELUM Map dibuat, kalau tidak MapLibre tidak
  // tahu cara membaca url 'pmtiles://' dan basemapnya kosong tanpa pesan apa pun.
  maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);

  // noLabels: jalan/air/tutupan lahan saja. Nama tempat bawaan dimatikan supaya tidak
  // berebut dengan label kelurahan.
  const basemapLayers = protomaps_themes_base.noLabels('protomaps', 'grayscale');
  basemapLayerIds = basemapLayers.map((l) => l.id);

  S.map = new maplibregl.Map({
    container: 'map',
    center: [109.9, -7.7],
    zoom: 7.6,
    style: {
      version: 8,
      glyphs: '/vendor/glyphs/{fontstack}/{range}.pbf',
      sources: {
        protomaps: { type: 'vector', url: 'pmtiles://' + BASEMAP_PMTILES,
          attribution: ATTRIBUTION },
        satelit: { type: 'raster', tiles: [BASEMAP_SATELLITE], tileSize: 256,
          maxzoom: 19, attribution: ATTRIBUTION_SATELLITE },
      },
      layers: [
        // `polos` di paling bawah dan TIDAK pernah dimatikan — dia latar terakhir
        // kalau semua basemap mati. Namanya sengaja beda dari lapisan `background`
        // milik tema supaya keduanya tidak pernah tertukar.
        { id: 'polos', type: 'background', paint: { 'background-color': '#eef1f6' } },
        { id: 'bm-satelit', type: 'raster', source: 'satelit',
          layout: { visibility: 'none' } },
        ...basemapLayers,
      ],
    },
  });

  S.map.addControl(new maplibregl.NavigationControl(), 'top-right');
  S.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }));

  // Citra satelit datang dari internet. Kalau jaringan kantor menutupnya, petanya
  // akan diam-diam kosong; lebih baik memberi tahu daripada membiarkan orang mengira
  // datanya yang hilang.
  S.map.on('error', (e) => {
    const url = (e && e.error && e.error.url) || '';
    if (S.basemap === 'satelit' && url.includes('arcgisonline')) {
      toast('Citra satelit tidak bisa diambil — jaringan ini sepertinya menutup akses keluar.',
        'error');
    }
  });

  // Tinggi kontainer datang dari CSS dan berubah waktu jendela diubah ukurannya.
  // MapLibre menyimpan ukuran kanvas saat dibuat dan tidak mengikutinya sendiri.
  let lastSize = '';
  new ResizeObserver((entries) => {
    const r = entries[0].contentRect;
    const key = Math.round(r.width) + 'x' + Math.round(r.height);
    if (key === lastSize || !r.width) return;
    lastSize = key;
    S.map.resize();
  }).observe($('map'));
}

export function setBasemap(which) {
  S.basemap = which;
  ['lokal', 'satelit', 'polos'].forEach((name) => {
    const button = $('bm-' + name);
    if (!button) return;
    button.className = 'flex-1 px-2 py-1.5 rounded-md ' +
      (name === which ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500');
  });

  basemapLayerIds.forEach((id) => {
    S.map.setLayoutProperty(id, 'visibility', which === 'lokal' ? 'visible' : 'none');
  });
  S.map.setLayoutProperty('bm-satelit', 'visibility',
    which === 'satelit' ? 'visible' : 'none');

  if (S.layersReady) redrawMap();
}

export function addLayers() {
  S.map.addSource('kel', { type: 'geojson', data: S.geo, promoteId: 'kode' });

  S.map.addLayer({
    id: 'kel-isi', type: 'fill', source: 'kel',
    paint: {
      'fill-color': ['coalesce', ['feature-state', 'warna'], COLOR_EMPTY],
      'fill-opacity': 0.85,
    },
  });
  S.map.addLayer({
    id: 'kel-garis', type: 'line', source: 'kel',
    paint: { 'line-color': '#ffffff', 'line-width': 0.5, 'line-opacity': 0.7 },
  });
  S.map.addLayer({
    id: 'kel-terpilih', type: 'line', source: 'kel',
    filter: ['==', ['get', 'kode'], ''],
    paint: { 'line-color': '#0b2f6b', 'line-width': 2.5 },
  });
  S.map.addLayer({
    id: 'kel-nama', type: 'symbol', source: 'kel', minzoom: 10.5,
    layout: {
      'text-field': ['get', 'nama'], 'text-font': ['Noto Sans Regular'],
      'text-size': 11, 'text-allow-overlap': false,
    },
    paint: { 'text-color': '#1e293b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
  });

  S.map.addSource('kota', { type: 'geojson', data: S.cityGeo });
  S.map.addLayer({
    id: 'kota-garis', type: 'line', source: 'kota',
    paint: { 'line-color': '#e2231a', 'line-width': 1.6, 'line-opacity': 0.85 },
  });

  S.map.addSource('radius', { type: 'geojson', data: EMPTY_COLLECTION });
  S.map.addLayer({
    id: 'radius-isi', type: 'fill', source: 'radius',
    paint: { 'fill-color': '#0b2f6b', 'fill-opacity': 0.05 },
  });
  S.map.addLayer({
    id: 'radius-garis', type: 'line', source: 'radius',
    paint: { 'line-color': '#0b2f6b', 'line-width': 1.6, 'line-dasharray': [2, 2] },
  });

  // Titik penjualan: lapisan circle, BUKAN marker DOM. Delapan belas ribu elemen DOM
  // akan membekukan halaman begitu petanya digeser.
  S.map.addSource('jual', { type: 'geojson', data: EMPTY_COLLECTION });
  S.map.addLayer({
    id: 'jual-titik', type: 'circle', source: 'jual',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 1.4, 11, 2.6, 14, 4.5],
      'circle-color': ['get', 'warna'],
      'circle-opacity': 0.75,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.5],
      'circle-stroke-color': '#ffffff',
    },
  });
}

/* ==========================================================================
   BATAS KECAMATAN — hanya untuk memilih ring
   ========================================================================== */

let kecamatanSiap = false;

export const districtsLoaded = () => kecamatanSiap;

/**
 * Muat dan pasang lapisan batas kecamatan.
 *
 * Dipanggil saat mode edit ring dinyalakan, BUKAN saat halaman dibuka. Berkasnya 3 MB
 * untuk 654 kecamatan, dan sebagian besar sesi tidak pernah menyunting ring sama
 * sekali — memuatnya di awal berarti semua orang membayar untuk yang dipakai sedikit.
 */
export async function addDistrictLayers() {
  if (kecamatanSiap) return;
  const geo = await fetchGeo('kecamatan.geojson');
  S.map.addSource('kec', { type: 'geojson', data: geo, promoteId: 'kode' });

  // Isi transparan dulu; setRingPaint() yang mewarnainya menurut ring. Lapisan isi
  // tetap ada walau semuanya bening supaya kliknya punya sasaran — garis saja terlalu
  // tipis untuk diklik orang yang sedang buru-buru.
  S.map.addLayer({
    id: 'kec-isi', type: 'fill', source: 'kec',
    paint: { 'fill-color': '#0b2f6b', 'fill-opacity': 0 },
  });
  S.map.addLayer({
    id: 'kec-garis', type: 'line', source: 'kec',
    paint: { 'line-color': '#334155', 'line-width': 1, 'line-opacity': 0.55 },
  });
  S.map.addLayer({
    id: 'kec-nama', type: 'symbol', source: 'kec', minzoom: 8.5,
    layout: {
      'text-field': ['get', 'nama'], 'text-font': ['Noto Sans Regular'],
      'text-size': 11, 'text-allow-overlap': false,
    },
    paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
  });

  S.map.on('click', 'kec-isi', (e) => {
    if (!window.ringEditing || !window.ringEditing()) return;
    const f = e.features && e.features[0];
    // Pemilih ringnya dibuka di titik klik. Urutannya sengaja "kecamatan dulu, baru
    // ringnya" — itu urutan yang dipikirkan orang waktu melihat peta.
    if (f) window.openRingChooser(f.properties.kode, e.originalEvent);
  });
  S.map.on('mouseenter', 'kec-isi', () => {
    if (window.ringEditing && window.ringEditing()) S.map.getCanvas().style.cursor = 'pointer';
  });
  S.map.on('mouseleave', 'kec-isi', () => { S.map.getCanvas().style.cursor = ''; });

  kecamatanSiap = true;
}

/**
 * Nyalakan atau matikan nama kecamatan sebagai lapisan biasa.
 *
 * Terpisah dari mode edit ring: orang perlu tahu nama kecamatan waktu MEMBACA peta,
 * bukan cuma waktu menyuntingnya. Berkas batasnya tetap dimuat saat diminta, jadi
 * yang tidak pernah menyalakannya tidak membayar 3 MB.
 */
export async function toggleDistrictNames() {
  const nyala = $('opt-kecamatan') && $('opt-kecamatan').checked;
  if (nyala && !kecamatanSiap) {
    try {
      await addDistrictLayers();
    } catch (error) {
      $('opt-kecamatan').checked = false;
      toast('Batas kecamatan tidak bisa dimuat: ' + error.message, 'error');
      return;
    }
  }
  redrawMap();
}

/**
 * Warnai kecamatan menurut ring, atau matikan lapisannya sama sekali.
 *
 * @param {Object|null} draft  {districtCode: 1|2|3}, atau null untuk keluar mode edit
 */
export function setRingPaint(draft) {
  if (!kecamatanSiap) return;
  // Keluar dari mode edit TIDAK otomatis mematikan lapisannya: kalau orang menyalakan
  // "Nama Kecamatan" sendiri di opsi peta, mematikannya di sini akan terasa seperti
  // sakelarnya rusak. redrawMap() yang memutuskan, dari sakelar dan mode edit sekaligus.
  redrawMap();
  if (!draft) return;

  // Ekspresi match dibangun dari daftar kode, bukan feature-state satu per satu:
  // 654 panggilan setFeatureState tiap klik terasa tersendat, dan yang berubah cuma
  // satu kecamatan.
  const warna = ['match', ['get', 'kode']];
  const opasitas = ['match', ['get', 'kode']];
  const RING_WARNA = { 1: '#0b2f6b', 2: '#3b6fc4', 3: '#93b4e6' };
  Object.entries(draft).forEach(([kode, ring]) => {
    warna.push(kode, RING_WARNA[ring] || '#94a3b8');
    opasitas.push(kode, 0.55);
  });
  warna.push('#94a3b8');
  opasitas.push(0.06);

  S.map.setPaintProperty('kec-isi', 'fill-color',
    Object.keys(draft).length ? warna : '#94a3b8');
  S.map.setPaintProperty('kec-isi', 'fill-opacity',
    Object.keys(draft).length ? opasitas : 0.06);
}

/** Warnai kelurahan menurut kelas persentil sebaran yang sedang tampil. */
export function paintChoropleth(rows) {
  const perVillage = sumBy(rows, 'village');
  const breaks = percentileBreaks(Object.values(perVillage));

  S.geo.features.forEach((f) => {
    const value = perVillage[f.properties.kode] || 0;
    const cls = classOf(value, breaks);
    S.map.setFeatureState({ source: 'kel', id: f.properties.kode },
      { warna: cls < 0 ? COLOR_EMPTY : RAMP[cls] });
  });

  return { perVillage, breaks };
}

export function redrawMap() {
  if (!S.layersReady) return;
  const on = (id) => ($(id) ? $(id).checked : false);

  S.map.setLayoutProperty('kel-garis', 'visibility', on('opt-batas') ? 'visible' : 'none');
  S.map.setLayoutProperty('kel-nama', 'visibility', on('opt-nama') ? 'visible' : 'none');
  S.map.setLayoutProperty('kota-garis', 'visibility', on('opt-kota') ? 'visible' : 'none');

  // Kecamatan tampil kalau sakelarnya dinyalakan ATAU sedang menyunting ring. Dua
  // sebab, satu tempat yang memutuskan — kalau masing-masing menyetel visibility
  // sendiri, keluar dari mode edit akan mematikan lapisan yang sengaja dinyalakan
  // orang lewat opsi peta.
  if (kecamatanSiap) {
    const sedangEdit = window.ringEditing && window.ringEditing();
    const tampilKec = on('opt-kecamatan') || sedangEdit;
    ['kec-isi', 'kec-garis', 'kec-nama'].forEach((id) => {
      if (S.map.getLayer(id)) {
        S.map.setLayoutProperty(id, 'visibility', tampilKec ? 'visible' : 'none');
      }
    });
    // Di luar mode edit, isinya tidak diwarnai sama sekali — yang diminta cuma nama
    // dan batasnya, dan isian abu di seluruh peta menutupi heatmap di bawahnya.
    if (!sedangEdit && S.map.getLayer('kec-isi')) {
      S.map.setPaintProperty('kec-isi', 'fill-opacity', 0);
    }
  }

  const showPoints = on('opt-jual');
  if (showPoints) S.map.getSource('jual').setData(buildSalePoints());
  S.map.setLayoutProperty('jual-titik', 'visibility', showPoints ? 'visible' : 'none');
  if ($('map-note')) $('map-note').classList.toggle('hidden', !showPoints);

  // Titik penjualan ikut ruang lingkup.
  //
  // Yang disaring lapisan MapLibre, bukan datanya. Membangun ulang belasan ribu titik
  // tiap kali dropdown disentuh terasa berat, dan titiknya akan melompat-lompat
  // sehingga orang mengira datanya berubah.
  if (showPoints) S.map.setFilter('jual-titik', salePointFilter());

  // Di atas citra satelit, isian pekat menutupi apa pun yang membuat satelit berguna.
  const satellite = S.basemap === 'satelit';
  S.map.setPaintProperty('kel-isi', 'fill-opacity', satellite ? 0.5 : 0.85);
  S.map.setPaintProperty('kel-garis', 'line-opacity', satellite ? 0.45 : 0.7);
  S.map.setPaintProperty('kel-nama', 'text-color', satellite ? '#ffffff' : '#1e293b');
  S.map.setPaintProperty('kel-nama', 'text-halo-color', satellite ? '#000000' : '#ffffff');

  const showMarkers = on('opt-titik');
  S.markers.forEach((m) => { m.getElement().style.display = showMarkers ? '' : 'none'; });

  // Lingkarannya memakai S.radiusM — radius yang SEDANG DIPILIH — bukan konstanta.
  //
  // Sebelumnya di sini terpasang RADIUS_METERS yang selalu 5.000. Menekan 3 km atau
  // 10 km mengubah seluruh persentase di layar, tapi lingkarannya diam di tempat.
  // Tidak ada yang error; yang terjadi cuma peta dan angka menceritakan dua hal
  // berbeda, dan lingkaran itu justru yang dipakai orang untuk mempercayai angkanya.
  const selected = scopeValue('pos');
  const outlet = selected === 'ALL' ? null : S.outletByCode[selected];
  S.map.getSource('radius').setData(
    outlet && outlet.lat != null && on('opt-radius')
      ? circle(outlet.lng, outlet.lat, S.radiusM) : EMPTY_COLLECTION);
}

/* ==========================================================================
   TITIK PENJUALAN
   ==========================================================================
   Alamat konsumen tidak punya koordinat, jadi titiknya disebar acak DI DALAM
   kelurahannya masing-masing. Yang ditunjukkan sebaran, bukan lokasi rumah — dan
   halaman menyebutkannya di sudut peta waktu lapisan ini menyala.
   ========================================================================== */

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Dibangkitkan sekali lalu dipakai ulang.
 *
 * Mengacak ulang tiap kali filter berubah akan membuat titiknya melompat-lompat, dan
 * orang akan mengira datanya yang berubah. Benihnya tetap, jadi titik yang sama selalu
 * muncul di tempat yang sama.
 */
export function buildSalePoints() {
  if (S.salePoints) return S.salePoints;

  // Titiknya dibangun untuk RENTANG periode yang aktif, bukan satu bulan. Perbandingan
  // teks aman karena 'YYYY-MM' lebar-tetap — alasan lengkapnya di filters.js.
  const { from, to } = pageFilters();
  const rows = S.sales.filter((r) =>
    (from === 'ALL' || r.period >= from) && (to === 'ALL' || r.period <= to));

  const byVillage = {};
  rows.forEach((r) => { (byVillage[r.village] ||= []).push(r); });

  const ringByVillage = {};
  S.geo.features.forEach((f) => {
    const rings = f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates[0]]
      : f.geometry.coordinates.map((p) => p[0]);
    ringByVillage[f.properties.kode] = rings.reduce((a, b) => (b.length > a.length ? b : a));
  });

  let seed = 991;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const features = [];
  Object.keys(byVillage).forEach((code) => {
    const ring = ringByVillage[code];
    if (!ring) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    ring.forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });

    byVillage[code].forEach((row) => {
      for (let i = 0; i < row.units; i++) {
        let lng = 0;
        let lat = 0;
        let ok = false;
        for (let tries = 0; tries < 24 && !ok; tries++) {
          lng = minX + rand() * (maxX - minX);
          lat = minY + rand() * (maxY - minY);
          ok = pointInRing(lng, lat, ring);
        }
        if (!ok) continue;               // poligon terlalu tipis: lewati saja
        const village = S.villageByCode[code] || {};
        features.push({
          type: 'Feature',
          properties: {
            warna: dealerColor(S.registry, row.dealer), dealer: row.dealer,
            outlet: row.outlet, village: code,
            kota: village.cityCode || '', prov: village.provinceCode || '',
          },
          geometry: { type: 'Point', coordinates: [lng, lat] },
        });
      }
    });
  });

  S.salePoints = { type: 'FeatureCollection', features };
  return S.salePoints;
}

/** Titik penjualan dibangun ulang kalau periodenya berganti. */
export function invalidateSalePoints() { S.salePoints = null; }

/** Ekspresi filter lapisan titik penjualan, mengikuti ruang lingkup aktif. */
function salePointFilter() {
  const clauses = ['all'];
  const f = pageFilters();

  // Kota, dealer, dan pos independen — semuanya di-AND-kan lewat 'all', bukan lagi
  // if/else-if satu slot.
  if (f.outletCode !== 'ALL') clauses.push(['==', ['get', 'outlet'], f.outletCode]);
  if (f.dealerCode !== 'ALL') clauses.push(['==', ['get', 'dealer'], f.dealerCode]);
  if (f.cityCode !== 'ALL') clauses.push(['==', ['get', 'kota'], f.cityCode]);

  if (f.province !== 'ALL') clauses.push(['==', ['get', 'prov'], f.province]);

  return clauses.length === 1 ? null : clauses;
}

/* ==========================================================================
   LAYAR PENUH DAN PAS-KAN
   ========================================================================== */

/**
 * Layar penuh dengan posisi tetap, bukan Fullscreen API browser.
 *
 * Hasilnya sama tapi tanpa banner browser yang muncul di tengah presentasi, dan panel
 * melayangnya tetap bisa diatur.
 */
/**
 * Bilah filter dipindah, bukan dicerminkan.
 *
 * Layar penuh itu position:fixed;inset:0, jadi dia menutupi bilah di atas halaman.
 * appendChild MEMINDAH node, bukan menyalinnya — nilai tiap <select> ikut utuh, dan
 * tidak ada set kedua yang harus disamakan terus-menerus.
 */
function moveFilterBar() {
  const bar = $('filter-bar');
  const host = S.fullscreen ? $('fs-filter-host') : $('filter-bar-slot');
  if (bar && host && bar.parentElement !== host) host.appendChild(bar);
}

export function toggleFullscreen(force) {
  S.fullscreen = force === undefined ? !S.fullscreen : Boolean(force);
  moveFilterBar();
  $('map-shell').classList.toggle('penuh', S.fullscreen);
  $('label-penuh').textContent = S.fullscreen ? 'Keluar' : 'Layar penuh';
  $('btn-penuh').querySelector('i').className =
    S.fullscreen ? 'ph-fill ph-arrows-in' : 'ph-fill ph-arrows-out';
  document.body.style.overflow = S.fullscreen ? 'hidden' : '';

  // MapLibre menyimpan ukuran kanvas saat dibuat dan tidak mengikutinya sendiri.
  // Tanpa resize() peta tergambar di ukuran lama sampai jendelanya digeser.
  setTimeout(() => S.map.resize(), 60);
  setTimeout(() => S.map.resize(), 400);
}

/**
 * Bawa peta ke data yang SEDANG TAMPIL, bukan selalu ke seluruh wilayah.
 *
 * Kalau satu pos dipilih, yang dipas-kan adalah pos itu beserta seluruh kelurahan yang
 * dilayaninya — sekali klik langsung kelihatan seberapa jauh pelanggannya menyebar, dan
 * itu justru pertanyaan pokoknya. Zoom ke titik posnya saja malah membuang yang di luar
 * radius keluar layar.
 */
export function fitToScope() {
  const points = [];
  const perVillage = sumBy(activeRows(), 'village');
  Object.keys(perVillage).forEach((code) => {
    const village = S.villageByCode[code];
    if (village && village.lat != null) points.push([village.lng, village.lat]);
  });

  const outlet = scopeValue('pos');
  const dealer = scopeValue('dealer');
  S.outlets.forEach((o) => {
    if (o.lat == null) return;
    const included = outlet !== 'ALL' ? o.code === outlet
      : dealer !== 'ALL' ? o.dealerCode === dealer : false;
    if (included) points.push([o.lng, o.lat]);
  });

  if (!points.length) {
    // Peta kosong yang di-zoom ke tempat entah di mana lebih membingungkan daripada
    // peta utuh.
    S.map.fitBounds(bbox(S.geo), { padding: 40, duration: 700 });
    toast('Tidak ada data pada filter ini — peta dikembalikan ke seluruh wilayah');
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach(([x, y]) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });

  // Satu kelurahan saja menghasilkan kotak seluas nol dan fitBounds akan memperbesar
  // sampai maksimum. Diberi kelonggaran ~2,5 km supaya tetap ada konteks.
  const minSpan = 0.022;
  if (maxX - minX < minSpan) { const c = (maxX + minX) / 2; minX = c - minSpan / 2; maxX = c + minSpan / 2; }
  if (maxY - minY < minSpan) { const c = (maxY + minY) / 2; minY = c - minSpan / 2; maxY = c + minSpan / 2; }

  S.map.fitBounds([[minX, minY], [maxX, maxY]],
    { padding: S.fullscreen ? 90 : 50, duration: 700, maxZoom: 13 });
}

/** Ganti radius jangkauan. Hanya nilai yang benar-benar dihitung server. */
export function setRadius(meters) {
  const m = Number(meters);
  if (!S.coverageAll[m]) return;
  S.radiusM = m;
  $('label-radius').textContent = (m / 1000).toFixed(0) + ' km';
  S.coverage = S.coverageAll[m];
  S.radiiM.forEach((r) => {
    const button = $('radius-' + r);
    if (button) {
      button.className = 'flex-1 px-2 py-1.5 rounded-md text-[11px] font-bold ' +
        (r === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500');
    }
  });
  window.renderAll();
}
