/**
 * Peta: basemap, lapisan choropleth, batas kabupaten, radius, dan titik penjualan.
 */
import {
  ATTRIBUTION, ATTRIBUTION_SATELLITE, BASEMAP_PMTILES, BASEMAP_SATELLITE, KARESIDENAN,
} from './config.js';
import { classOf, dealerColor, percentileBreaks, RAMP, COLOR_EMPTY } from './colors.js';
import { $, bbox, sumBy, toast } from './dom.js';
import { fetchGeo } from './api.js';
import { activeRows, pageFilters, scopeValue } from './filters.js';
import { EMPTY_COLLECTION } from './geo.js';
import { contributionsForRows, fixedContributionClass } from './sales-stats.js';
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
  S.map.addLayer({
    id: 'kota-nama', type: 'symbol', source: 'kota', minzoom: 8,
    layout: {
      'text-field': ['get', 'nama_kota'], 'text-font': ['Noto Sans Bold'],
      'text-size': 13, 'text-allow-overlap': false,
    },
    paint: { 'text-color': '#e2231a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
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
   BATAS KECAMATAN — referensi visual ("Batas dan Nama Kecamatan") + kec-isi
   ==========================================================================
   Dari pagi 2026-08-31 sampai sore itu juga, kecamatan sempat cuma jadi lapisan
   referensi murni (ring dipindah ke kelurahan). Sore itu juga ring pindah lagi ke
   DEALER+KECAMATAN dan pos mendapat coverage baru di kecamatan yang sama — jadi
   source `kec` di sini sekarang dipakai TIGA hal sekaligus: referensi visual
   (kec-garis/kec-nama, warna pink, toggle Opsi Peta sendiri), dan target klik +
   sorotan mode edit/lihat ring-dealer & coverage-pos (kec-isi, lihat blok EDIT & LIHAT
   di bawah).
   ========================================================================== */

let kecamatanSiap = false;
/** GeoJSON kecamatan yang sudah dimuat, dipakai districtAt() cari kecamatan dari titik. */
let kecGeo = null;

export const districtsLoaded = () => kecamatanSiap;

/**
 * Muat dan pasang lapisan batas kecamatan.
 *
 * Dipanggil saat togglenya dinyalakan, BUKAN saat halaman dibuka. Berkasnya 3 MB
 * untuk 654 kecamatan, dan sebagian besar sesi tidak pernah menyalakannya sama
 * sekali — memuatnya di awal berarti semua orang membayar untuk yang dipakai sedikit.
 */
export async function addDistrictLayers() {
  if (kecamatanSiap) return;
  const geo = await fetchGeo('kecamatan.geojson');
  kecGeo = geo;
  S.map.addSource('kec', { type: 'geojson', data: geo, promoteId: 'kode' });

  // Isi transparan dulu; setGroupPaint()/paintGroupView() (Bagian EDIT RING DEALER &
  // COVERAGE POS di bawah) yang mewarnainya. Lapisan isi tetap ada walau semuanya
  // bening supaya kliknya punya sasaran — garis saja terlalu tipis untuk diklik orang
  // yang sedang buru-buru. Ini SATU lapisan dipakai KEDUA editor (ring dealer, coverage
  // pos) — keduanya tidak pernah aktif bersamaan, sama seperti kel-ring-* dulu dipakai
  // bergantian antara mode lihat dan mode edit.
  S.map.addLayer({
    id: 'kec-isi', type: 'fill', source: 'kec',
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#0b2f6b', 'fill-opacity': 0 },
  });
  S.map.addLayer({
    id: 'kec-garis', type: 'line', source: 'kec',
    paint: { 'line-color': '#db2777', 'line-width': 1.2, 'line-opacity': 0.7 },
  });
  S.map.addLayer({
    id: 'kec-nama', type: 'symbol', source: 'kec', minzoom: 8.5,
    layout: {
      'text-field': ['get', 'nama'], 'text-font': ['Noto Sans Regular'],
      'text-size': 11, 'text-allow-overlap': false,
    },
    paint: { 'text-color': '#db2777', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
  });

  S.map.on('click', 'kec-isi', (e) => {
    if (!window.anyGroupEditing || !window.anyGroupEditing()) return;
    const f = e.features && e.features[0];
    // Pemilihnya dibuka di titik klik. Urutannya sengaja "kecamatan dulu, baru
    // kelompoknya" — itu urutan yang dipikirkan orang waktu melihat peta.
    if (f) window.openRingChooser(f.properties.kode, f.properties.nama, e.originalEvent);
  });
  S.map.on('mouseenter', 'kec-isi', () => {
    if (window.anyGroupEditing && window.anyGroupEditing()) S.map.getCanvas().style.cursor = 'pointer';
  });
  S.map.on('mouseleave', 'kec-isi', () => { S.map.getCanvas().style.cursor = ''; });

  kecamatanSiap = true;
}

/**
 * Nyalakan atau matikan batas dan nama kecamatan.
 *
 * Berkas batasnya tetap dimuat saat diminta, jadi yang tidak pernah menyalakannya
 * tidak membayar 3 MB.
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

/* ==========================================================================
   EDIT & LIHAT: RING DEALER (1-3) / COVERAGE POS (1-8)
   ==========================================================================
   Sejak 2026-08-31 sore, ring pindah dari POS+KELURAHAN ke DEALER+KECAMATAN, dan pos
   mendapat konsep baru coverage (1-8, juga kecamatan) — lihat docs/DECISIONS.md.
   Keduanya beroperasi di layer kec-isi yang SAMA (dibuat di addDistrictLayers() di
   atas, satu source untuk semua kebutuhan kecamatan), dipakai BERGANTIAN oleh: mode
   edit (rings.js, klik-pilih-simpan) dan mode lihat (Tampilan Ring Dealer / Tampilan
   Coverage POS) — tidak pernah dua-duanya aktif bersamaan, sama seperti kel-ring-*
   dulu dipakai bergantian antara mode lihat dan mode edit ring per kelurahan.
   ========================================================================== */

/** Warna tiap ring dealer — sama dengan RING_COLORS di rings.js. */
const RING_WARNA = { 1: '#0b2f6b', 2: '#3b6fc4', 3: '#93b4e6' };
/** Warna tiap coverage pos — sama dengan COVERAGE_COLORS di rings.js. */
const COVERAGE_WARNA = {
  1: '#0b2f6b', 2: '#1d4ed8', 3: '#3b6fc4', 4: '#0891b2',
  5: '#0d9488', 6: '#65a30d', 7: '#ca8a04', 8: '#c2410c',
};
/** Warna sorotan "Lokasi" — netral, beda dari kedua keluarga warna di atas. */
const LOKASI_WARNA = '#0f172a';

/**
 * Warnai kecamatan menurut draft, atau matikan sorotan sama sekali (draft null).
 * Dipakai KEDUA editor (rings.js) — bedanya cuma tabel warna yang dioper.
 *
 * @param {Object|null} draft  {districtCode: number}, atau null untuk keluar mode edit
 * @param {Object} colors      RING_COLORS atau COVERAGE_COLORS dari rings.js
 */
export function setGroupPaint(draft, colors) {
  if (!kecamatanSiap) return;

  S.map.setLayoutProperty('kec-isi', 'visibility', draft ? 'visible' : 'none');
  if (!draft) return;

  // Ekspresi match dibangun dari daftar kode, bukan feature-state satu per satu:
  // ribuan panggilan setFeatureState tiap klik terasa tersendat, dan yang berubah
  // cuma satu kecamatan.
  const warna = ['match', ['get', 'kode']];
  const opasitas = ['match', ['get', 'kode']];
  Object.entries(draft).forEach(([kode, grup]) => {
    warna.push(kode, colors[grup] || '#94a3b8');
    opasitas.push(kode, 0.55);
  });
  warna.push('#94a3b8');
  opasitas.push(0.06);

  S.map.setPaintProperty('kec-isi', 'fill-color',
    Object.keys(draft).length ? warna : '#94a3b8');
  S.map.setPaintProperty('kec-isi', 'fill-opacity',
    Object.keys(draft).length ? opasitas : 0.06);
}

/** Kode kecamatan yang memuat satu titik lat/lng, atau null kalau tidak ketemu/di luar. */
function districtAt(lat, lng) {
  if (!kecGeo || lat == null || lng == null) return null;
  for (const f of kecGeo.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      if (pointInRing(lng, lat, poly[0])) return f.properties.kode;
    }
  }
  return null;
}

/**
 * Sorotan mode LIHAT (Tampilan Ring Dealer / Tampilan Coverage POS) — dipanggil dari
 * redrawMap(), yang jalan tiap renderAll(). WAJIB tidak berbuat apa-apa selagi mode
 * edit aktif — setGroupPaint(draft, ...) yang berhak penuh atas kec-isi waktu itu;
 * kalau paintGroupView() ikut menulis di saat yang sama, draft yang sedang dikerjakan
 * bisa tertimpa/hilang tanpa disimpan.
 */
export function paintGroupView() {
  if (!kecamatanSiap || (window.anyGroupEditing && window.anyGroupEditing())) return;

  const { mode, value } = S.ringView || {};
  let kodeCocok = [];
  let warna = '#94a3b8';

  if (mode === 'dealer-ring' && scopeValue('dealer') !== 'ALL') {
    const dealer = S.dealerByCode[scopeValue('dealer')] || {};
    if (value === 'lokasi') {
      const kode = districtAt(dealer.lat, dealer.lng);
      kodeCocok = kode ? [kode] : [];
      warna = LOKASI_WARNA;
    } else if (typeof value === 'number') {
      const ringMap = S.dealerRings[scopeValue('dealer')] || {};
      kodeCocok = Object.keys(ringMap).filter((k) => ringMap[k] === value);
      warna = RING_WARNA[value] || '#94a3b8';
    }
  } else if (mode === 'pos-coverage' && scopeValue('pos') !== 'ALL') {
    const outlet = S.outletByCode[scopeValue('pos')] || {};
    if (value === 'lokasi') {
      const kode = districtAt(outlet.lat, outlet.lng);
      kodeCocok = kode ? [kode] : [];
      warna = LOKASI_WARNA;
    } else if (typeof value === 'number') {
      const coverMap = S.posCoverage[scopeValue('pos')] || {};
      kodeCocok = Object.keys(coverMap).filter((k) => coverMap[k] === value);
      warna = COVERAGE_WARNA[value] || '#94a3b8';
    }
  }

  const tampil = kodeCocok.length > 0;
  S.map.setLayoutProperty('kec-isi', 'visibility', tampil ? 'visible' : 'none');
  if (!tampil) return;

  S.map.setPaintProperty('kec-isi', 'fill-color', warna);
  S.map.setPaintProperty('kec-isi', 'fill-opacity',
    ['match', ['get', 'kode'], kodeCocok, 0.55, 0]);
}

/**
 * Nyalakan/matikan grup terpilih di kontrol "Tampilan Ring Dealer" atau "Tampilan
 * Coverage POS" (klik yang sudah aktif mematikannya — pola sama seperti setScope()).
 * Satu fungsi generik dipakai kedua tombol (Bagian OPSI PETA), dibedakan `mode` dan
 * daftar tombolnya. Lazy-load kec-isi kalau belum pernah dimuat sama sekali.
 *
 * @param {'dealer-ring'|'pos-coverage'} mode
 * @param {number|'lokasi'} value
 * @param {string[]} tombolIds  id tombol yang perlu diperbarui gayanya
 */
async function setGroupView(mode, value, tombolIds) {
  const sama = S.ringView && S.ringView.mode === mode && S.ringView.value === value;
  S.ringView = sama ? { mode: null, value: null } : { mode, value };

  tombolIds.forEach((id) => {
    const tombol = $(id);
    if (!tombol) return;
    const aktif = !sama && tombolMatches(id, S.ringView.value);
    tombol.classList.remove('bg-white', 'text-slate-800', 'shadow-sm', 'text-slate-500');
    tombol.classList.add(...(aktif ? ['bg-white', 'text-slate-800', 'shadow-sm'] : ['text-slate-500']));
  });

  if (S.ringView.mode && !kecamatanSiap) {
    try {
      await addDistrictLayers();
    } catch (error) {
      toast('Batas kecamatan tidak bisa dimuat: ' + error.message, 'error');
      S.ringView = { mode: null, value: null };
      return;
    }
  }
  paintGroupView();
}

/** Cocokkan id tombol ("rv-1", "rv-lokasi", "cv-8", ...) dengan value yang aktif. */
function tombolMatches(id, value) {
  const bagian = id.split('-').pop();
  return String(value) === bagian;
}

/** @param {number|'lokasi'} value */
export function setRingViewDealer(value) {
  return setGroupView('dealer-ring', value,
    ['rv-lokasi', 'rv-1', 'rv-2', 'rv-3']);
}

/** @param {number|'lokasi'} value */
export function setCoverageViewPos(value) {
  return setGroupView('pos-coverage', value,
    ['cv-lokasi', 'cv-1', 'cv-2', 'cv-3', 'cv-4', 'cv-5', 'cv-6', 'cv-7', 'cv-8']);
}

/**
 * Aktif/nonaktifkan kontrol "Tampilan Ring Dealer" dan "Tampilan Coverage POS"
 * menurut scope yang sedang dipilih (permintaan eksplisit: ring dealer hanya relevan
 * kalau dealer difilter, coverage pos hanya relevan kalau pos difilter). Dipanggil
 * dari filters.js setiap scope berubah.
 *
 * Kalau grup yang sedang disorot jadi tidak relevan untuk scope baru, matikan
 * sorotannya — highlight lama yang menggantung tanpa scope yang menjelaskannya
 * cuma membingungkan.
 */
export function syncGroupControls() {
  const dealerAktif = scopeValue('dealer') !== 'ALL';
  const posAktif = scopeValue('pos') !== 'ALL';

  const ringBox = $('pilihan-ring-dealer');
  const coverBox = $('pilihan-coverage-pos');
  if (ringBox) ringBox.classList.toggle('nonaktif', !dealerAktif);
  if (coverBox) coverBox.classList.toggle('nonaktif', !posAktif);

  if (S.ringView.mode === 'dealer-ring' && !dealerAktif) S.ringView = { mode: null, value: null };
  if (S.ringView.mode === 'pos-coverage' && !posAktif) S.ringView = { mode: null, value: null };
  paintGroupView();
}

/**
 * Warnai kelurahan menurut Kontribusi Penjualan (% terhadap total KOTANYA SENDIRI),
 * bukan lagi unit mentah — sejak 2026-08-30. Kelurahan kecil yang justru dominan di
 * kotanya sendiri sekarang terlihat gelap, bukan tenggelam di bawah kelurahan
 * bervolume besar dari kota lain yang kebetulan ikut tampil.
 *
 * Dua mode (S.heatmapMode, lihat setHeatmapMode()):
 * - 'relative' (bawaan): kelas persentil dari sebaran kontribusi yang sedang tampil —
 *   mesin yang sama dengan sebelumnya (percentileBreaks/classOf di colors.js), cuma
 *   input-nya sekarang kontribusi %.
 * - 'fixed': interval TETAP (sales-stats.js KONTRIBUSI_TETAP), sama di mana pun dan
 *   kapan pun — dua kelurahan dengan kontribusi yang sama persis SELALU warna sama,
 *   tidak bergantung siapa lagi yang sedang difilter.
 */
export function paintChoropleth(rows) {
  const kontribusi = contributionsForRows(rows, S.villageByCode);
  const perVillage = Object.fromEntries(kontribusi);
  const breaks = percentileBreaks([...kontribusi.values()]);
  const fixed = S.heatmapMode === 'fixed';

  S.geo.features.forEach((f) => {
    const value = kontribusi.get(f.properties.kode);
    let warna = COLOR_EMPTY;
    if (value != null) {
      if (fixed) {
        const cls = fixedContributionClass(value);
        warna = cls < 0 ? COLOR_EMPTY : RAMP[Math.min(cls, RAMP.length - 1)];
      } else {
        const cls = classOf(value, breaks);
        warna = cls < 0 ? COLOR_EMPTY : RAMP[cls];
      }
    }
    S.map.setFeatureState({ source: 'kel', id: f.properties.kode }, { warna });
  });

  return { perVillage, breaks };
}

/**
 * Sinkronkan tampilan tombol Dynamic/Static dengan S.heatmapMode.
 *
 * Terpisah dari setHeatmapMode() supaya titik auto-switch di filters.js (waktu filter
 * Kota berganti) bisa memakainya lewat window TANPA memicu window.renderAll() kedua —
 * setScope()/clearScope() di filters.js sudah berakhir di renderAll() sendiri.
 */
export function syncHeatmapModeButtons() {
  ['relative', 'fixed'].forEach((m) => {
    const button = $('hm-' + m);
    if (button) {
      button.className = 'flex-1 px-2 py-1.5 rounded-md text-[10px] font-bold ' +
        (m === S.heatmapMode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500');
    }
  });
}

/** @param {'relative'|'fixed'} mode */
export function setHeatmapMode(mode) {
  if (mode !== 'relative' && mode !== 'fixed') return;
  S.heatmapMode = mode;
  syncHeatmapModeButtons();
  window.renderAll();
}

export function redrawMap() {
  if (!S.layersReady) return;
  const on = (id) => ($(id) ? $(id).checked : false);

  // "Batas dan Nama Kelurahan/Desa" — satu toggle, dua lapisan (permintaan Pakbos,
  // sebelumnya dua sakelar terpisah).
  const tampilKel = on('opt-kelurahan');
  S.map.setLayoutProperty('kel-garis', 'visibility', tampilKel ? 'visible' : 'none');
  S.map.setLayoutProperty('kel-nama', 'visibility', tampilKel ? 'visible' : 'none');

  // "Batas dan Nama Kota" — satu toggle, batas + label kota sekaligus.
  const tampilKota = on('opt-kota');
  S.map.setLayoutProperty('kota-garis', 'visibility', tampilKota ? 'visible' : 'none');
  S.map.setLayoutProperty('kota-nama', 'visibility', tampilKota ? 'visible' : 'none');

  // "Batas dan Nama Kecamatan" — referensi visual (garis pink + label), toggle
  // sendiri lewat Opsi Peta. kec-isi (sorotan ring dealer/coverage pos) diatur
  // TERPISAH oleh setGroupPaint()/paintGroupView() di bawah — dua lapisan beda tujuan
  // di satu source yang sama.
  if (kecamatanSiap) {
    const tampilKec = on('opt-kecamatan');
    ['kec-garis', 'kec-nama'].forEach((id) => {
      if (S.map.getLayer(id)) {
        S.map.setLayoutProperty(id, 'visibility', tampilKec ? 'visible' : 'none');
      }
    });
  }

  // Kontrol + sorotan Tampilan Ring Dealer/Coverage POS ikut ruang lingkup —
  // dipanggil di sini supaya ganti dealer/pos otomatis memperbarui aktif/nonaktif
  // tombolnya dan sorotannya tanpa perlu klik ulang.
  syncGroupControls();

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

  // "Titik Dealer" dan "Titik Pos" — dua sakelar terpisah sejak 2026-08-31 (permintaan
  // Pakbos; sebelumnya satu sakelar untuk keduanya).
  const showPos = on('opt-titik-pos');
  S.markers.forEach((m) => { m.getElement().style.display = showPos ? '' : 'none'; });
  const showDealer = on('opt-titik-dealer');
  S.dealerMarkers.forEach((m) => { m.getElement().style.display = showDealer ? '' : 'none'; });
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
            kota: village.cityCode || '',
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

  if (f.kares !== 'ALL') {
    clauses.push(['in', ['get', 'kota'], ['literal', KARESIDENAN[f.kares].cities]]);
  }

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

