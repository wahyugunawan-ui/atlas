/**
 * Logika prototipe. Satu berkas, tanpa modul — hasilnya ditanam ke dalam index.html
 * dan harus jalan lewat protokol file:// juga, di mana modul ES ditolak browser.
 *
 * Semua data datang dari dua konstanta yang sudah tertanam: GEO dan DATA.
 * Tidak ada fetch(), tidak ada server, tidak ada login.
 */

/* ==========================================================================
   BANTU
   ========================================================================== */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n || 0).toLocaleString('id-ID');

function toast(message, kind) {
  const el = $('toast');
  el.textContent = message;
  el.style.background = kind === 'ok' ? '#10b981' : 'var(--astra-navy)';
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 2600);
}

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
  'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const PROVINCE_NAMES = { '33': 'Jawa Tengah', '34': 'DI Yogyakarta' };

const monthLabel = (period) => {
  const [y, m] = period.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

/* ==========================================================================
   STATE
   ========================================================================== */

const S = {
  map: null,
  layersReady: false,
  basemap: 'abu',
  treemapView: 'dealer',
  treemapChart: null,
  selectedOutlet: null,
  selectedVillage: null,
  markers: [],
  salePoints: null,        // dibangkitkan sekali, dipakai ulang
  radiusM: DATA.radiusM || 5000,
  coverage: (DATA.coverage || {})[DATA.radiusM || 5000] || {},
  fullscreen: false,
  editing: null,           // kode pos yang sedang disunting
  pickingOnMap: false,     // sedang menunggu klik di peta untuk ambil koordinat
};

/* ==========================================================================
   SUNTINGAN POS DI BROWSER
   ==========================================================================
   Prototipe tidak punya server, tapi memperbaiki pin yang melenceng saat demo lalu
   kehilangannya waktu halaman di-refresh itu menyebalkan. Disimpan di localStorage.
   ========================================================================== */

const SIMPANAN = 'astra-prototipe-pos';

function bacaSuntingan() {
  try { return JSON.parse(localStorage.getItem(SIMPANAN) || '{}'); } catch { return {}; }
}

function tulisSuntingan(map) {
  try { localStorage.setItem(SIMPANAN, JSON.stringify(map)); } catch { /* penuh */ }
}

// Indeks pencarian cepat
const villageByCode = {};
DATA.villages.forEach((v) => { villageByCode[v.kode] = v; });

const outletByCode = {};
DATA.outlets.forEach((o) => { outletByCode[o.kode_pos] = o; });

// Koordinat dan alamat bawaan disimpan supaya tombol "Kembalikan" punya sesuatu untuk
// dikembalikan, dan supaya pos yang sudah disunting bisa ditandai di tabel.
const BAWAAN = {};
DATA.outlets.forEach((o) => {
  BAWAAN[o.kode_pos] = { lat: o.lat, lng: o.lng, alamat: o.alamat };
});
Object.entries(bacaSuntingan()).forEach(([kode, patch]) => {
  const o = outletByCode[kode];
  if (!o) return;
  if (patch.lat != null) o.lat = patch.lat;
  if (patch.lng != null) o.lng = patch.lng;
  if (patch.alamat != null) o.alamat = patch.alamat;
});

const sudahDisunting = (kode) => Boolean(bacaSuntingan()[kode]);

/**
 * Bongkar baris fakta dari bentuk padat [periodeIndex, kelurahan, outlet, unit].
 *
 * Disimpan sebagai array di berkas karena nama field yang diulang 26 ribu kali
 * menambah megabyte tanpa menambah informasi.
 */
const FACTS = DATA.facts.map(([periodIndex, village, outlet, units]) => ({
  period: DATA.periods[periodIndex],
  village: village,
  outlet: outlet,
  dealer: (outletByCode[outlet] || {}).kode_dealer,
  units: units,
}));

/**
 * Konsumen dirakit di sini, bukan ditanam di berkas.
 *
 * 17 ribu konsumen lengkap dengan nama, alamat, dan nomor mesin menambah ±6 MB —
 * separuh ukuran berkas — untuk sesuatu yang bisa disusun ulang dari baris fakta yang
 * sudah ada. Benihnya tetap, jadi Budi Santoso di kelurahan yang sama akan selalu
 * Budi Santoso, berapa kali pun halaman ini dibuka.
 *
 * Semuanya karangan. Tidak ada nama atau alamat konsumen sungguhan di berkas ini.
 */
const CUSTOMERS = (() => {
  const w = DATA.words;
  const period = DATA.periods[DATA.periods.length - 1];
  let seed = 424242;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = (list) => list[Math.floor(rand() * list.length)];

  const out = [];
  let id = 1;
  FACTS.filter((f) => f.period === period).forEach((f) => {
    for (let i = 0; i < f.units; i++) {
      out.push({
        id: 'C' + String(id++).padStart(6, '0'),
        name: `${pick(w.firstNames)} ${pick(w.lastNames)}`,
        address: `${pick(w.streets)} No. ${1 + Math.floor(rand() * 120)}, RT ` +
          String(1 + Math.floor(rand() * 12)).padStart(2, '0'),
        engineNo: 'JM' + String(Math.floor(rand() * 9e7) + 1e7),
        type: pick(w.types),
        village: f.village,
        outlet: f.outlet,
        dealer: f.dealer,
        // Sebagian sengaja tanpa foto: aplikasi mobile-nya belum ada, dan kolomnya
        // harus terlihat apa adanya — bukan seolah semuanya sudah terkumpul.
        hasPhoto: rand() < 0.45,
      });
    }
  });
  return out;
})();

const dealerByCode = {};
DATA.dealers.forEach((d) => { dealerByCode[d.dealerCode] = d; });

const cityName = {};
DATA.villages.forEach((v) => { cityName[v.kode_kota] = v.nama_kota; });

const dealerColor = (code) => (dealerByCode[code] || {}).color || '#c3c2b7';
const dealerName = (code) => (dealerByCode[code] || {}).dealerName || code;

/* ==========================================================================
   FILTER
   ========================================================================== */

const filterValue = (id) => ($(id) ? $(id).value : 'ALL');

/**
 * Baris fakta yang lolos filter aktif.
 *
 * Satu-satunya jalan membaca data yang sedang tampil. Kalau ada bagian lain yang
 * menyaring DATA.facts sendiri, angkanya akan berbeda dari KPI dan tidak ada yang
 * tahu mana yang benar.
 */
function activeRows() {
  const period = filterValue('filter-periode');
  const prov = filterValue('filter-provinsi');
  const city = filterValue('filter-kota');
  const dealer = filterValue('filter-dealer');
  const outlet = filterValue('filter-pos');

  return FACTS.filter((f) => {
    if (period !== 'ALL' && f.period !== period) return false;
    if (dealer !== 'ALL' && f.dealer !== dealer) return false;
    if (outlet !== 'ALL' && f.outlet !== outlet) return false;
    const v = villageByCode[f.village];
    if (!v) return false;
    if (city !== 'ALL' && v.kode_kota !== city) return false;
    if (prov !== 'ALL' && v.kode_kota.slice(0, 2) !== prov) return false;
    return true;
  });
}

function sumBy(rows, key) {
  const out = {};
  rows.forEach((r) => { out[r[key]] = (out[r[key]] || 0) + r.units; });
  return out;
}

function onFilterChange() { renderAll(); }

/**
 * Satu pintu untuk semua cara memilih ruang lingkup.
 *
 * Marker di peta, blok treemap, baris panel performa, poligon kelurahan, dan dropdown
 * semuanya lewat sini. Itu yang membuat "klik di peta langsung berpindah" otomatis
 * benar: tidak ada jalur kedua yang bisa lupa diperbarui, dan titik penjualan, KPI,
 * heatmap, serta panel performa selalu berpindah bersamaan.
 */
function applyScope(jenis, kode) {
  if (jenis === 'kota') {
    $('filter-kota').value = kode;
    $('filter-pos').value = 'ALL';
    S.selectedOutlet = null;
  } else if (jenis === 'dealer') {
    const sama = filterValue('filter-dealer') === kode;
    $('filter-dealer').value = sama ? 'ALL' : kode;
    $('filter-pos').value = 'ALL';
    S.selectedOutlet = null;
  } else if (jenis === 'pos') {
    const sama = S.selectedOutlet === kode;
    S.selectedOutlet = sama ? null : kode;
    $('filter-pos').value = sama ? 'ALL' : kode;
    if (!sama) {
      const o = outletByCode[kode];
      if (o && o.lat != null) {
        S.map.flyTo({ center: [o.lng, o.lat], zoom: 10.5, duration: 700 });
      }
    }
  } else if (jenis === 'kelurahan') {
    const v = villageByCode[kode];
    // Klik kelurahan menyetel kotanya, bukan kelurahannya: filter kelurahan tidak ada,
    // dan menyempitkan ke satu kelurahan akan mengosongkan hampir semua panel.
    if (v) $('filter-kota').value = v.kode_kota;
  }
  renderAll();
}

/** Dropdown filter saat layar penuh menyalin nilainya ke filter utama. */
function mirrorFilter(id, el) {
  $(id).value = el.value;
  if (id === 'filter-pos') S.selectedOutlet = el.value === 'ALL' ? null : el.value;
  renderAll();
}

function resetFilters() {
  ['filter-provinsi', 'filter-kota', 'filter-dealer', 'filter-pos']
    .forEach((id) => { $(id).value = 'ALL'; });
  S.selectedOutlet = null;
  closeVillageDetail();
  renderAll();
}

/** Kalimat yang menjelaskan 100%-nya siapa. */
function scopeLabel() {
  const parts = [];
  const outlet = filterValue('filter-pos');
  const dealer = filterValue('filter-dealer');
  const city = filterValue('filter-kota');
  const prov = filterValue('filter-provinsi');
  if (outlet !== 'ALL') parts.push('Pos ' + (outletByCode[outlet] || {}).nama_pos);
  else if (dealer !== 'ALL') parts.push('Dealer ' + dealerName(dealer));
  if (city !== 'ALL') parts.push(cityName[city]);
  else if (prov !== 'ALL') parts.push(PROVINCE_NAMES[prov] || 'Provinsi ' + prov);
  return parts.length ? parts.join(' di ') : 'seluruh penjualan';
}

/* ==========================================================================
   WARNA HEATMAP — BERBASIS PERSENTIL
   ==========================================================================
   Diminta di meeting 12 Agustus: legendanya jangan "1 unit, 2 unit, 3 unit", tapi
   persentase, supaya tetap masuk akal waktu datanya bertambah banyak.

   Konsekuensinya yang lebih penting: batasnya dihitung ulang dari baris yang lolos
   filter. Jadi waktu memfilter satu dealer, kelurahan paling gelap adalah yang
   terbaik MENURUT DEALER ITU — bukan kelurahan terbaik secara keseluruhan yang
   kebetulan juga dilayani dia.

   Kelurahan tanpa penjualan tidak ikut dihitung persentilnya. Kalau ikut, dan 70%
   kelurahan bernilai nol, seluruh batas bawah akan jadi nol dan lima kelasnya
   menumpuk di satu titik.
   ========================================================================== */

const RAMP = ['#cde2fb', '#9ec5f4', '#5598e7', '#256abf', '#104281'];
const COLOR_EMPTY = '#e1e0d9';

function percentileBreaks(values) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return [0, 0, 0, 0];
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return [at(0.2), at(0.4), at(0.6), at(0.8)];
}

function classOf(value, breaks) {
  if (!value) return -1;
  for (let i = 0; i < breaks.length; i++) if (value <= breaks[i]) return i;
  return breaks.length;
}

/* ==========================================================================
   PETA
   ========================================================================== */

const BASEMAPS = {
  abu: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  satelit: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};

function setupMap() {
  S.map = new maplibregl.Map({
    container: 'map',
    center: [109.9, -7.7],
    zoom: 7.6,
    attributionControl: { compact: true },
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        abu: { type: 'raster', tiles: [BASEMAPS.abu], tileSize: 256, maxzoom: 19,
          attribution: '&copy; OpenStreetMap, &copy; CARTO' },
        satelit: { type: 'raster', tiles: [BASEMAPS.satelit], tileSize: 256, maxzoom: 19,
          attribution: 'Citra: Esri, Maxar, Earthstar Geographics' },
      },
      layers: [
        { id: 'polos', type: 'background', paint: { 'background-color': '#eef1f6' } },
        { id: 'bm-abu', type: 'raster', source: 'abu' },
        { id: 'bm-satelit', type: 'raster', source: 'satelit',
          layout: { visibility: 'none' } },
      ],
    },
  });
  S.map.addControl(new maplibregl.NavigationControl(), 'top-right');
  S.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }));

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

/**
 * Ganti radius jangkauan.
 *
 * Hanya nilai yang BENAR-BENAR dihitung saat build yang bisa dipilih. Versi pertama
 * memakai slider bebas dan menskalakan rasio 5 km menurut luas lingkaran — hasilnya
 * salah arah: penskalaan cuma bisa membesarkan rasio yang sudah ada, tidak pernah
 * menambahkan kelurahan yang tadinya di luar jangkauan. Pada 10 km angkanya keluar
 * 36,8% padahal seharusnya jauh lebih tinggi, dan angka yang terlalu rendah di layar
 * akan dibaca sebagai temuan.
 */
function ubahRadius(meter) {
  const m = Number(meter);
  if (!DATA.coverage[m]) return;
  S.radiusM = m;
  $('label-radius').textContent = (m / 1000).toFixed(0) + ' km';
  S.coverage = DATA.coverage[m];
  (DATA.radiiM || []).forEach((r) => {
    const b = $('radius-' + r);
    if (b) {
      b.className = 'flex-1 px-2 py-1.5 rounded-md text-[11px] font-bold ' +
        (r === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500');
    }
  });
  renderAll();
}


/** Bagi penjualan jadi dalam dan luar jangkauan. Sama persis dengan coverage.js. */
function splitByCoverage(rows) {
  let inside = 0;
  let total = 0;
  rows.forEach((r) => {
    inside += r.units * ((S.coverage[r.outlet] || {})[r.village] || 0);
    total += r.units;
  });
  return { inside, outside: total - inside, total };
}

function setBasemap(which) {
  S.basemap = which;
  ['abu', 'satelit', 'polos'].forEach((name) => {
    const btn = $('bm-' + name);
    const on = name === which;
    btn.className = 'flex-1 px-2 py-1.5 rounded-md ' +
      (on ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500');
  });
  S.map.setLayoutProperty('bm-abu', 'visibility', which === 'abu' ? 'visible' : 'none');
  S.map.setLayoutProperty('bm-satelit', 'visibility', which === 'satelit' ? 'visible' : 'none');
  if (S.layersReady) redrawMap();
}

function addLayers() {
  S.map.addSource('kel', { type: 'geojson', data: GEO, promoteId: 'kode' });

  S.map.addLayer({
    id: 'kel-isi', type: 'fill', source: 'kel',
    paint: { 'fill-color': ['coalesce', ['feature-state', 'warna'], COLOR_EMPTY],
      'fill-opacity': 0.85 },
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
    layout: { 'text-field': ['get', 'nama'], 'text-font': ['Noto Sans Regular'],
      'text-size': 11, 'text-allow-overlap': false },
    paint: { 'text-color': '#1e293b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
  });

  // Batas kabupaten/kota: dibangun dari gabungan garis kelurahan yang kode kotanya
  // berbeda dengan tetangganya terlalu mahal untuk prototipe; dipakai garis tebal
  // merah di atas semua kelurahan pada kota yang sama.
  S.map.addSource('kota', { type: 'geojson', data: DATA.cityLines });
  S.map.addLayer({
    id: 'kota-garis', type: 'line', source: 'kota',
    paint: { 'line-color': '#e2231a', 'line-width': 1.6, 'line-opacity': 0.85 },
  });

  S.map.addSource('radius', { type: 'geojson', data: emptyFC() });
  S.map.addLayer({
    id: 'radius-isi', type: 'fill', source: 'radius',
    paint: { 'fill-color': '#0b2f6b', 'fill-opacity': 0.05 },
  });
  S.map.addLayer({
    id: 'radius-garis', type: 'line', source: 'radius',
    paint: { 'line-color': '#0b2f6b', 'line-width': 1.6, 'line-dasharray': [2, 2] },
  });

  // Titik penjualan: lapisan circle, BUKAN marker DOM. 18 ribu elemen DOM akan
  // membekukan halaman begitu peta digeser.
  S.map.addSource('jual', { type: 'geojson', data: emptyFC() });
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

  S.map.on('click', 'kel-isi', (e) => {
    // Sedang menunggu titik untuk menyunting pos: klik ini artinya koordinat, bukan
    // membuka kelurahan.
    if (S.pickingOnMap) { terimaTitikPeta(e.lngLat); return; }
    if (e.features && e.features.length) openVillageDetail(e.features[0].properties.kode);
  });
  S.map.on('mouseenter', 'kel-isi', () => { S.map.getCanvas().style.cursor = 'pointer'; });
  S.map.on('mouseleave', 'kel-isi', () => { S.map.getCanvas().style.cursor = ''; });
}

function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

/* --- titik penjualan acak di dalam poligon --- */

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Sebar titik acak di dalam kelurahan, satu titik per unit terjual.
 *
 * Dibangkitkan sekali lalu dipakai ulang: mengacak ulang tiap kali filter berubah
 * akan membuat titik-titiknya melompat, dan orang akan mengira datanya berubah.
 */
function buildSalePoints() {
  if (S.salePoints) return S.salePoints;

  const period = DATA.periods[DATA.periods.length - 1];
  const perVillage = {};
  FACTS.filter((f) => f.period === period).forEach((f) => {
    (perVillage[f.village] ||= []).push(f);
  });

  const ringByVillage = {};
  GEO.features.forEach((f) => {
    const rings = f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0]);
    ringByVillage[f.properties.kode] = rings;
  });

  let seed = 991;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const features = [];
  Object.keys(perVillage).forEach((code) => {
    const rings = ringByVillage[code];
    if (!rings || !rings.length) return;
    const ring = rings.reduce((a, b) => (b.length > a.length ? b : a));

    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    ring.forEach(([x, y]) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    });

    perVillage[code].forEach((fact) => {
      for (let i = 0; i < fact.units; i++) {
        let lng = 0;
        let lat = 0;
        let ok = false;
        for (let tries = 0; tries < 24 && !ok; tries++) {
          lng = minX + rand() * (maxX - minX);
          lat = minY + rand() * (maxY - minY);
          ok = pointInRing(lng, lat, ring);
        }
        if (!ok) continue;                 // poligon terlalu tipis: lewati saja
        const v = villageByCode[code] || {};
        features.push({
          type: 'Feature',
          properties: { warna: dealerColor(fact.dealer), dealer: fact.dealer,
            outlet: fact.outlet, village: code,
            kota: v.kode_kota || '', prov: (v.kode_kota || '').slice(0, 2) },
          geometry: { type: 'Point', coordinates: [lng, lat] },
        });
      }
    });
  });

  S.salePoints = { type: 'FeatureCollection', features: features };
  return S.salePoints;
}

/** Ekspresi filter untuk lapisan titik penjualan, mengikuti ruang lingkup aktif. */
function filterTitik() {
  const syarat = ['all'];
  const pos = filterValue('filter-pos');
  const dealer = filterValue('filter-dealer');
  const kota = filterValue('filter-kota');
  const prov = filterValue('filter-provinsi');

  if (pos !== 'ALL') syarat.push(['==', ['get', 'outlet'], pos]);
  else if (dealer !== 'ALL') syarat.push(['==', ['get', 'dealer'], dealer]);

  if (kota !== 'ALL') syarat.push(['==', ['get', 'kota'], kota]);
  else if (prov !== 'ALL') syarat.push(['==', ['get', 'prov'], prov]);

  return syarat.length === 1 ? null : syarat;
}

function circlePolygon(lng, lat, meters) {
  const n = 64;
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  const points = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    points.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [points] } };
}

/* ==========================================================================
   RENDER PETA
   ========================================================================== */

function renderMap(rows) {
  const perVillage = sumBy(rows, 'village');
  const breaks = percentileBreaks(Object.values(perVillage));

  GEO.features.forEach((f) => {
    const value = perVillage[f.properties.kode] || 0;
    const cls = classOf(value, breaks);
    S.map.setFeatureState({ source: 'kel', id: f.properties.kode },
      { warna: cls < 0 ? COLOR_EMPTY : RAMP[cls] });
  });

  renderLegend(breaks, perVillage);
  return perVillage;
}

function renderLegend(breaks, perVillage) {
  const values = Object.values(perVillage).filter((v) => v > 0);
  const labels = ['20% terbawah', '20–40%', '40–60%', '60–80%', '20% teratas'];

  // Rentang tiap kelas diambil dari nilai yang BENAR-BENAR jatuh di kelas itu, bukan
  // dihitung dari batasnya.
  //
  // Waktu filternya sempit — misalnya satu pos — hampir semua kelurahan bernilai 1
  // atau 2, dan keempat batas persentil jatuh di angka yang sama. Menyusun label dari
  // batas menghasilkan rentang mustahil seperti "2–1", dan kelas yang memang kosong
  // tampak seolah punya isi.
  const inClass = RAMP.map(() => []);
  values.forEach((v) => {
    const c = classOf(v, breaks);
    if (c >= 0) inClass[Math.min(c, RAMP.length - 1)].push(v);
  });

  const rangeOf = (list) => {
    if (!list.length) return '—';
    const lo = Math.min(...list);
    const hi = Math.max(...list);
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  };

  const used = inClass.filter((list) => list.length).length;

  $('legend').innerHTML =
    `<div class="flex items-center gap-2 text-[11px] text-slate-500">` +
    `<span class="w-3.5 h-3.5 rounded shrink-0" style="background:${COLOR_EMPTY}"></span>` +
    `<span class="flex-1">tidak ada penjualan</span>` +
    `<span class="mono text-slate-400">${esc(num(DATA.villages.length - values.length))}</span></div>` +
    RAMP.map((color, i) =>
      `<div class="flex items-center gap-2 text-[11px] ${inClass[i].length ? 'text-slate-600' : 'text-slate-300'}">` +
      `<span class="w-3.5 h-3.5 rounded shrink-0" style="background:${color}"></span>` +
      `<span class="flex-1">${labels[i]}</span>` +
      `<span class="mono ${inClass[i].length ? 'text-slate-400' : 'text-slate-300'}">${rangeOf(inClass[i])}</span></div>`).join('') +
    `<p class="text-[10px] text-slate-400 pt-1.5 leading-snug">` +
    (used < RAMP.length && values.length
      ? `Sebarannya terlalu sempit untuk lima kelas — ${used} kelas terpakai. `
      : '') +
    `Kelas dihitung dari sebaran yang sedang tampil, jadi ikut berubah waktu filternya diganti.</p>`;
}

function renderDealerLegend(rows) {
  const per = sumBy(rows, 'dealer');
  const order = Object.keys(per).sort((a, b) => per[b] - per[a]);
  $('legend-dealer').innerHTML = order.length ? order.map((code) =>
    `<div class="flex items-center gap-2 text-[11px]">` +
    `<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${esc(dealerColor(code))}"></span>` +
    `<span class="flex-1 truncate text-slate-600">${esc(dealerName(code))}</span>` +
    `<span class="mono text-slate-400">${esc(num(per[code]))}</span></div>`).join('')
    : '<p class="text-[11px] text-slate-400">Tidak ada dealer pada filter ini.</p>';
}

function redrawMap() {
  if (!S.layersReady) return;
  const on = (id) => $(id).checked;

  S.map.setLayoutProperty('kel-garis', 'visibility', on('opt-batas') ? 'visible' : 'none');
  S.map.setLayoutProperty('kel-nama', 'visibility', on('opt-nama') ? 'visible' : 'none');
  S.map.setLayoutProperty('kota-garis', 'visibility', on('opt-kota') ? 'visible' : 'none');

  const showPoints = on('opt-jual');
  if (showPoints && S.map.getSource('jual')) {
    S.map.getSource('jual').setData(buildSalePoints());
  }
  S.map.setLayoutProperty('jual-titik', 'visibility', showPoints ? 'visible' : 'none');
  $('map-note').classList.toggle('hidden', !showPoints);

  // Titik penjualan ikut filter.
  //
  // Yang disaring lapisan MapLibre, bukan datanya. Membangun ulang 19 ribu titik tiap
  // kali dropdown disentuh terasa berat, dan titiknya akan melompat-lompat sehingga
  // orang mengira datanya berubah.
  if (showPoints) S.map.setFilter('jual-titik', filterTitik());

  // Di atas citra satelit, isian pekat menutupi apa pun yang membuat satelit berguna.
  const satellite = S.basemap === 'satelit';
  S.map.setPaintProperty('kel-isi', 'fill-opacity', satellite ? 0.5 : 0.85);
  S.map.setPaintProperty('kel-garis', 'line-color', satellite ? '#ffffff' : '#ffffff');
  S.map.setPaintProperty('kel-garis', 'line-opacity', satellite ? 0.45 : 0.7);
  S.map.setPaintProperty('kel-nama', 'text-color', satellite ? '#ffffff' : '#1e293b');
  S.map.setPaintProperty('kel-nama', 'text-halo-color', satellite ? '#000000' : '#ffffff');

  const showMarkers = on('opt-titik');
  S.markers.forEach((m) => {
    m.getElement().style.display = showMarkers ? '' : 'none';
  });

  const outlet = S.selectedOutlet ? outletByCode[S.selectedOutlet] : null;
  S.map.getSource('radius').setData(
    outlet && outlet.lat != null && on('opt-radius')
      ? circlePolygon(outlet.lng, outlet.lat, 5000) : emptyFC());
}

/* ==========================================================================
   MARKER OUTLET
   ========================================================================== */

function drawMarkers() {
  S.markers.forEach((m) => m.remove());
  S.markers = [];

  const rows = activeRows();
  const perOutlet = sumBy(rows, 'outlet');
  const dealerFilter = filterValue('filter-dealer');

  const posFilter = filterValue('filter-pos');
  const dealerTerpilih = posFilter !== 'ALL'
    ? (outletByCode[posFilter] || {}).kode_dealer : dealerFilter;

  DATA.outlets.forEach((o) => {
    if (o.lat == null) return;
    const selected = S.selectedOutlet === o.kode_pos;
    // Tiga tingkat, bukan dua: pos yang dipilih penuh, saudara sedealer tetap
    // berwarna tapi lebih kecil, sisanya abu. Diminta di meeting supaya saat menekan
    // satu pos masih kelihatan pos lain milik dealer yang sama.
    const seDealer = dealerTerpilih !== 'ALL' && o.kode_dealer === dealerTerpilih;
    const abu = dealerTerpilih !== 'ALL' && !seDealer;
    const sedang = seDealer && posFilter !== 'ALL' && !selected;

    const el = document.createElement('div');
    el.className = 'marker-outlet' + (abu ? ' abu' : '') +
      (sedang ? ' sedang' : '') + (selected ? ' terpilih' : '');
    el.style.background = abu ? '' : dealerColor(o.kode_dealer);
    el.innerHTML = '<i class="ph-fill ph-storefront"></i>';

    el.addEventListener('mouseenter', (e) => showOutletTooltip(o, perOutlet[o.kode_pos] || 0, e));
    el.addEventListener('mousemove', moveTooltip);
    el.addEventListener('mouseleave', () => $('tooltip').classList.remove('show'));
    el.addEventListener('click', (e) => { e.stopPropagation(); applyScope('pos', o.kode_pos); });

    S.markers.push(new maplibregl.Marker({ element: el })
      .setLngLat([o.lng, o.lat]).addTo(S.map));
  });
}

function showOutletTooltip(outlet, units, event) {
  const tip = $('tooltip');
  tip.innerHTML =
    `<div class="font-bold text-white">${esc(outlet.nama_pos)}</div>` +
    `<div class="text-[11px] text-slate-300 flex items-center gap-1.5 mt-0.5">` +
    `<span class="w-2 h-2 rounded-full inline-block" style="background:${esc(dealerColor(outlet.kode_dealer))}"></span>` +
    `${esc(outlet.nama_dealer)}</div>` +
    `<div class="text-[11px] text-slate-300 mt-1.5">${esc(num(units))} penjualan pada filter ini</div>` +
    `<div class="text-[10px] text-slate-400 mt-1">klik untuk melihat area layanannya</div>`;
  tip.classList.add('show');
  moveTooltip(event);
}

function moveTooltip(event) {
  const tip = $('tooltip');
  tip.style.left = event.clientX + 'px';
  tip.style.top = event.clientY + 'px';
}

/**
 * Klik outlet = seperti klik kotak di treemap.
 *
 * Diminta di meeting: heatmapnya dihitung ULANG hanya dari penjualan pos itu, bukan
 * sekadar menyorot di atas peta yang lama. Caranya dengan menyalakan filter pos —
 * dengan begitu KPI, peringkat, treemap, tabel, dan legenda ikut berpindah, dan tidak
 * ada satu pun angka di layar yang masih menghitung sesuatu yang lain.
 */
function selectOutlet(code) { applyScope('pos', code); }

/* ==========================================================================
   PANEL RINCIAN KELURAHAN
   ==========================================================================
   Diminta di meeting: daftar pos dan daftar konsumen dipisah dengan judul sendiri,
   supaya tidak menyatu dan susah dibaca. Porsinya tetap sama.
   ========================================================================== */

function openVillageDetail(code) {
  S.selectedVillage = code;
  const v = villageByCode[code] || {};
  const rows = activeRows().filter((r) => r.village === code);
  const perOutlet = sumBy(rows, 'outlet');
  const total = Object.values(perOutlet).reduce((s, n) => s + n, 0);
  const order = Object.keys(perOutlet).sort((a, b) => perOutlet[b] - perOutlet[a]);

  const customers = CUSTOMERS.filter((c) => c.village === code)
    .filter((c) => {
      const dealer = filterValue('filter-dealer');
      const outlet = filterValue('filter-pos');
      if (dealer !== 'ALL' && c.dealer !== dealer) return false;
      if (outlet !== 'ALL' && c.outlet !== outlet) return false;
      return true;
    });

  $('kelurahanDetailTitle').textContent = v.nama || code;
  $('kelurahanDetailMeta').textContent =
    `${v.nama_kecamatan || ''} · ${v.nama_kota || ''} · ${code}`;

  const header = (icon, title, count) =>
    `<div class="flex items-center gap-1.5 text-[11px] uppercase font-bold text-slate-500 ` +
    `bg-slate-100 rounded-lg px-2.5 py-1.5 mt-4 mb-2">` +
    `<i class="ph-fill ph-${icon}"></i>${title}` +
    `<span class="ml-auto mono text-slate-400">${esc(num(count))}</span></div>`;

  $('kelurahanDetailList').innerHTML =
    `<div class="pb-3 border-b border-slate-200">` +
    `<div class="text-[11px] uppercase font-bold text-slate-400">Total penjualan</div>` +
    `<div class="text-3xl font-extrabold text-slate-900 mono">${esc(num(total))}</div></div>` +

    header('storefront', 'Penjualan per Pos', order.length) +
    (order.length ? order.map((oc) => {
      const o = outletByCode[oc] || {};
      return `<div class="flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-slate-50 cursor-pointer" onclick="selectOutlet('${esc(oc)}')">` +
        `<span class="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style="background:${esc(dealerColor(o.kode_dealer))}"></span>` +
        `<div class="flex-1 min-w-0">` +
        `<div class="text-sm text-slate-800 font-semibold truncate">${esc(o.nama_pos || oc)}</div>` +
        `<div class="text-[11px] text-slate-400 truncate">${esc(o.nama_dealer || '')}` +
        ` <button onclick="event.stopPropagation(); suntingPos('${esc(oc)}')" ` +
        `class="text-slate-400 hover:text-slate-700" title="Sunting alamat dan koordinat">` +
        `<i class="ph ph-pencil-simple"></i></button></div></div>` +
        `<div class="text-right shrink-0">` +
        `<div class="text-sm font-bold text-slate-900 mono">${esc(num(perOutlet[oc]))}</div>` +
        `<div class="text-[10px] text-slate-400 mono">${esc((perOutlet[oc] / total * 100).toFixed(0))}%</div>` +
        `</div></div>`;
    }).join('')
      : '<p class="text-xs text-slate-400 text-center py-4">Tidak ada penjualan pada filter ini.</p>') +

    header('users-three', 'Konsumen', customers.length) +
    (customers.length ? customers.slice(0, 60).map((c) =>
      `<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50">` +
      `<span class="w-2 h-2 rounded-full shrink-0" style="background:${esc(dealerColor(c.dealer))}"></span>` +
      `<div class="min-w-0 flex-1"><div class="text-sm text-slate-700 truncate">${esc(c.name)}</div>` +
      `<div class="text-[11px] text-slate-400 truncate">${esc(c.address)}</div></div>` +
      `<button onclick="showCustomerDetail('${esc(c.id)}')" class="shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold text-white" style="background:var(--astra-navy)">Detail</button>` +
      `</div>`).join('') +
      (customers.length > 60
        ? `<div class="text-[11px] text-slate-400 px-2 pt-1">Menampilkan 60 dari ${esc(num(customers.length))}.</div>` : '')
      : '<p class="text-xs text-slate-400 text-center py-4">Belum ada konsumen tercatat.</p>');

  S.map.setFilter('kel-terpilih', ['==', ['get', 'kode'], code]);
  const panel = $('kelurahanDetailPanel');
  panel.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.remove('translate-x-full'));
}

function closeVillageDetail() {
  const panel = $('kelurahanDetailPanel');
  panel.classList.add('translate-x-full');
  setTimeout(() => panel.classList.add('hidden'), 300);
  S.selectedVillage = null;
  if (S.layersReady) S.map.setFilter('kel-terpilih', ['==', ['get', 'kode'], '']);
}

/* ==========================================================================
   KPI, TREEMAP, PERINGKAT
   ========================================================================== */

function renderKpi(rows, perVillage) {
  const dealers = new Set(rows.map((r) => r.dealer));
  const units = rows.reduce((s, r) => s + r.units, 0);
  const served = Object.keys(perVillage).filter((k) => perVillage[k] > 0).length;
  $('kpi-dealer').textContent = num(dealers.size);
  $('kpi-unit').textContent = num(units);
  $('kpi-terlayani').textContent = num(served);
  $('kpi-kosong').textContent = num(DATA.villages.length - served);
}

const MODES = {
  kota: { key: 'village', title: 'PERINGKAT KOTA' },
  dealer: { key: 'dealer', title: 'PERINGKAT DEALER' },
  pos: { key: 'outlet', title: 'PERINGKAT POS' },
};

function totalsByMode(rows, mode) {
  if (mode !== 'kota') return sumBy(rows, MODES[mode].key);
  const out = {};
  rows.forEach((r) => {
    const v = villageByCode[r.village];
    if (v) out[v.kode_kota] = (out[v.kode_kota] || 0) + r.units;
  });
  return out;
}

function entityName(mode, code) {
  if (mode === 'kota') return cityName[code] || code;
  if (mode === 'dealer') return dealerName(code);
  return (outletByCode[code] || {}).nama_pos || code;
}

function entityColor(mode, code) {
  if (mode === 'dealer') return dealerColor(code);
  if (mode === 'pos') return dealerColor((outletByCode[code] || {}).kode_dealer);
  return '#64748b';
}

function setTreemapView(mode) {
  S.treemapView = mode;
  ['kota', 'dealer', 'pos'].forEach((m) => {
    $('tm-' + m).className = 'px-3 py-1.5 rounded-lg ' +
      (m === mode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500');
  });
  renderTreemap(activeRows());
  renderPerforma(activeRows());
}

function renderTreemap(rows) {
  const mode = S.treemapView;
  const totals = totalsByMode(rows, mode);
  const codes = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 24);

  const data = codes.map((code) => ({ x: entityName(mode, code), y: totals[code] }));
  const colors = codes.map((code) => entityColor(mode, code));
  S.treemapCodes = codes;

  const options = {
    chart: { type: 'treemap', height: 330, toolbar: { show: false }, fontFamily: 'Manrope',
      events: {
        dataPointSelection: (e, ctx, cfg) => {
          const code = S.treemapCodes[cfg.dataPointIndex];
          if (code) selectEntity(mode, code);
        },
      } },
    series: [{ data: data }],
    colors: colors,
    // enableShades dimatikan supaya warna dealer tidak digelapkan sendiri oleh
    // ApexCharts — warna di treemap harus sama persis dengan di peta dan legenda.
    plotOptions: { treemap: { distributed: true, enableShades: false } },
    legend: { show: false },
    dataLabels: { style: { fontSize: '11px', fontWeight: 700 } },
    tooltip: { y: { formatter: (v) => num(v) + ' unit' } },
  };

  if (S.treemapChart) S.treemapChart.destroy();
  S.treemapChart = new ApexCharts($('treemap-chart'), options);
  S.treemapChart.render();
}

function selectEntity(mode, code) { applyScope(mode, code); }

/* ==========================================================================
   ANALISIS PERFORMA POS DEALER
   ==========================================================================
   Fungsi utama produknya: berapa bagian penjualan tiap pos yang berada di dalam radius
   jangkauan. Lihat coverage.js untuk cara menghitungnya dan asumsinya.
   ========================================================================== */

function performaPerPos(rows) {
  const perPos = {};
  rows.forEach((r) => { (perPos[r.outlet] ||= []).push(r); });

  return Object.keys(perPos).map((kode) => {
    const bagi = splitByCoverage(perPos[kode]);
    const o = outletByCode[kode] || {};
    return {
      kode,
      nama: o.nama_pos || kode,
      dealer: o.nama_dealer || '',
      warna: dealerColor(o.kode_dealer),
      unit: bagi.total,
      dalam: bagi.inside,
      persen: bagi.total ? (bagi.inside / bagi.total) * 100 : 0,
    };
  }).sort((a, b) => a.persen - b.persen);   // yang paling bermasalah di atas
}

function barisPerforma(p) {
  const aktif = S.selectedOutlet === p.kode;
  return `<div onclick="applyScope('pos','${esc(p.kode)}')" ` +
    `class="baris-pos rounded-xl px-3 py-2 ${aktif ? 'aktif' : ''}">` +
    `<div class="flex items-center gap-2">` +
    `<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${esc(p.warna)}"></span>` +
    `<span class="flex-1 text-sm font-semibold text-slate-800 truncate">${esc(p.nama)}</span>` +
    `<span class="text-[11px] text-slate-400 mono shrink-0">${esc(num(p.unit))} unit</span></div>` +
    `<div class="text-[11px] text-slate-400 truncate ml-4.5 mb-1">${esc(p.dealer)}</div>` +
    `<div class="bar-jangkauan"><span style="width:${p.persen.toFixed(1)}%"></span></div>` +
    `<div class="flex justify-between text-[11px] font-bold mt-1">` +
    `<span class="text-emerald-600">${esc(p.persen.toFixed(0))}% dalam jangkauan</span>` +
    `<span style="color:var(--astra-red)">${esc((100 - p.persen).toFixed(0))}% di luar</span>` +
    `</div></div>`;
}

function ringkasJangkauan(rows) {
  const bagi = splitByCoverage(rows);
  const persen = bagi.total ? (bagi.inside / bagi.total) * 100 : 0;
  const bukanAcuan = S.radiusM !== (DATA.radiusM || 5000);

  return `<div class="rounded-xl border border-slate-200 p-3">` +
    `<div class="flex items-baseline justify-between">` +
    `<span class="text-[11px] uppercase font-bold text-slate-400">Dalam radius ` +
    `${esc((S.radiusM / 1000).toFixed(1).replace('.', ','))} km</span>` +
    `<span class="text-2xl font-extrabold text-emerald-600">${esc(persen.toFixed(1))}%</span></div>` +
    `<div class="bar-jangkauan mt-2"><span style="width:${persen.toFixed(1)}%"></span></div>` +
    `<div class="flex justify-between text-[11px] mt-1.5">` +
    `<span class="text-emerald-700 font-bold">${esc(num(Math.round(bagi.inside)))} unit</span>` +
    `<span class="font-bold" style="color:var(--astra-red)">${esc(num(Math.round(bagi.outside)))} unit di luar</span>` +
    `</div>` +
    (bukanAcuan
      ? `<p class="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 mt-2 leading-snug">` +
        `Radius acuan proyek ini 5 km. Angka di atas dihitung untuk ` +
        `${esc((S.radiusM / 1000).toFixed(0))} km.</p>`
      : '') +
    `</div>`;
}

/* ==========================================================================
   KARTU REKAP DEALER
   ==========================================================================
   Muncul waktu satu dealer atau satu pos dipilih: rekap seluruh pos di bawah dealer
   itu, lengkap dengan bagian yang di dalam dan di luar jangkauan.

   Ada karena panel performa mengurutkan SELURUH pos dari semua dealer — berguna untuk
   mencari yang paling bermasalah, tapi tidak menjawab "bagaimana dealer ini secara
   keseluruhan". Kartu ini yang menjawabnya.
   ========================================================================== */

function kartuDealer(rows, ringkas) {
  const posFilter = filterValue('filter-pos');
  const dealerFilter = filterValue('filter-dealer');
  const kode = posFilter !== 'ALL'
    ? (outletByCode[posFilter] || {}).kode_dealer
    : (dealerFilter !== 'ALL' ? dealerFilter : null);
  if (!kode) return '';

  // Seluruh pos milik dealer ini pada periode dan wilayah yang aktif — TIDAK ikut
  // dipersempit oleh filter pos. Yang ditanyakan kartu ini memang rekap dealernya.
  const period = filterValue('filter-periode');
  const kota = filterValue('filter-kota');
  const prov = filterValue('filter-provinsi');
  const semua = FACTS.filter((f) => {
    if (f.dealer !== kode) return false;
    if (period !== 'ALL' && f.period !== period) return false;
    const v = villageByCode[f.village];
    if (!v) return false;
    if (kota !== 'ALL' && v.kode_kota !== kota) return false;
    if (prov !== 'ALL' && (v.kode_kota || '').slice(0, 2) !== prov) return false;
    return true;
  });

  const bagi = splitByCoverage(semua);
  const persen = bagi.total ? (bagi.inside / bagi.total) * 100 : 0;
  const nama = dealerName(kode);
  const warna = dealerColor(kode);

  const perPos = sumBy(semua, 'outlet');
  const urut = Object.keys(perPos).sort((a, b) => perPos[b] - perPos[a]);

  const chips = urut.map((oc) =>
    `<span class="chip-pos" onclick="applyScope('pos','${esc(oc)}')">` +
    `<span class="w-2 h-2 rounded-full shrink-0" style="background:${esc(dealerColor((outletByCode[oc] || {}).kode_dealer))}"></span>` +
    `${esc((outletByCode[oc] || {}).nama_pos || oc)}` +
    `<span class="n">${esc(num(perPos[oc]))}</span></span>`).join(' ');

  // Versi ringkas untuk layar penuh: satu baris, chip menggulir mendatar. Memakai
  // markup yang sama di atas peta membuat kartunya setinggi 245 px dan menutupi
  // sebagian besar wilayah yang justru sedang dilihat.
  const angka = (nilai, label, kelas, gaya) =>
    `<div class="text-center shrink-0"><div class="${ringkas ? 'text-lg' : 'text-2xl'} font-extrabold ${kelas}" ${gaya}>${nilai}</div>` +
    `<div class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">${label}</div></div>`;

  return `<div class="flex items-center gap-${ringkas ? '3' : '4'} ${ringkas ? '' : 'flex-wrap'}">` +
    `<div class="${ringkas ? 'w-8 h-8 text-sm' : 'w-10 h-10'} rounded-xl flex items-center justify-center text-white font-extrabold shrink-0" ` +
    `style="background:${esc(warna)}">${esc(nama.slice(0, 1))}</div>` +
    `<div class="min-w-0">` +
    `<div class="font-extrabold text-slate-800 truncate ${ringkas ? 'text-sm' : ''}">${esc(nama)}</div>` +
    `<div class="text-[11px] text-slate-400 truncate">Rekap seluruh pos di bawah dealer ini` +
    `${urut.length ? ` · ${esc(urut.length)} pos` : ''}</div></div>` +

    `<div class="flex items-center gap-${ringkas ? '4' : '6'} ml-auto shrink-0">` +
    angka(esc(num(bagi.total)), 'Total', 'text-slate-800', '') +
    angka(esc(persen.toFixed(0)) + '%', 'Dalam jangkauan', 'text-emerald-600', '') +
    angka(esc((100 - persen).toFixed(0)) + '%', 'Di luar', '', 'style="color:var(--astra-red)"') +
    `</div>` +

    `<div class="flex items-center gap-2 shrink-0">` +
    `<button onclick="lihatKonsumenDealer('${esc(kode)}')" class="px-3 py-2 rounded-xl text-white text-xs font-bold whitespace-nowrap" style="background:var(--astra-navy)">Lihat Data Konsumen</button>` +
    `<button onclick="tutupKartuDealer()" class="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50">Tutup</button>` +
    `</div></div>` +

    (ringkas
      ? `<div class="flex gap-2 mt-2.5 pt-2.5 border-t border-slate-200 overflow-x-auto pb-1">${chips}</div>`
      : `<div class="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100">${chips}</div>`);
}

function renderKartuDealer(rows) {
  const isi = kartuDealer(rows);
  const kartu = $('kartu-dealer');
  const posFilter = filterValue('filter-pos');
  const dealerFilter = filterValue('filter-dealer');
  const kode = posFilter !== 'ALL'
    ? (outletByCode[posFilter] || {}).kode_dealer
    : (dealerFilter !== 'ALL' ? dealerFilter : null);

  kartu.classList.toggle('hidden', !isi);
  if (isi) {
    kartu.innerHTML = isi;
    kartu.style.borderColor = dealerColor(kode);
  }

  // Versi ringkas saat layar penuh: chip-nya saja, tanpa blok angka besar — di atas
  // peta, ruang lebih berharga daripada ukuran huruf.
  const fs = $('fs-kartu');
  const isiRingkas = kartuDealer(rows, true);
  fs.classList.toggle('hidden', !isiRingkas);
  if (isiRingkas) fs.innerHTML = isiRingkas;
}

function tutupKartuDealer() {
  $('filter-dealer').value = 'ALL';
  $('filter-pos').value = 'ALL';
  S.selectedOutlet = null;
  renderAll();
}

/** Tombol "Lihat Data Konsumen": pindah tab dengan filter dealer sudah terpasang. */
function lihatKonsumenDealer(kode) {
  $('mkon-filter-dealer').value = kode;
  switchTab('konsumen');
  toast('Konsumen ' + dealerName(kode), 'ok');
}

function renderPerforma(rows) {
  const daftar = performaPerPos(rows);
  const isi = daftar.length ? daftar.map(barisPerforma).join('')
    : '<p class="text-center text-slate-400 text-sm py-8">Tidak ada pos pada filter ini.</p>';
  const ringkas = ringkasJangkauan(rows);

  $('panel-performa').innerHTML = isi;
  $('ringkas-jangkauan').innerHTML = ringkas;
  // Salinan untuk mode layar penuh.
  $('fs-performa').innerHTML = isi;
  $('fs-ringkas').innerHTML = ringkas;
}


/* ==========================================================================
   TABEL MASTER
   ========================================================================== */

function renderOutletTable() {
  const q = ($('mpos-search').value || '').toLowerCase();
  const dealer = $('mpos-filter-dealer').value;
  const perOutlet = sumBy(activeRows(), 'outlet');

  const list = DATA.outlets.filter((o) =>
    (dealer === 'ALL' || o.kode_dealer === dealer) &&
    (!q || o.nama_pos.toLowerCase().includes(q) || o.kode_pos.includes(q)))
    .sort((a, b) => (perOutlet[b.kode_pos] || 0) - (perOutlet[a.kode_pos] || 0));

  $('table-pos-body').innerHTML = list.length ? list.map((o) =>
    `<tr>` +
    `<td class="px-3 py-2 mono text-xs text-slate-500">${esc(o.kode_pos)}</td>` +
    `<td class="px-3 py-2"><div class="flex items-center gap-2">` +
    `<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${esc(dealerColor(o.kode_dealer))}"></span>` +
    `<span class="font-semibold text-slate-800">${esc(o.nama_pos)}</span></div></td>` +
    `<td class="px-3 py-2 text-slate-600">${esc(o.nama_dealer)}</td>` +
    `<td class="px-3 py-2"><div class="text-slate-600 text-xs">${esc(o.alamat)}</div>` +
    `<div class="mono text-[10px] text-slate-400">${o.lat == null ? 'belum di-pin'
      : esc(o.lat.toFixed(5)) + ', ' + esc(o.lng.toFixed(5))}` +
    (sudahDisunting(o.kode_pos)
      ? ` <span class="text-amber-600 font-bold">· disunting</span>` : '') +
    `</div></td>` +
    `<td class="px-3 py-2 text-right font-bold mono ${perOutlet[o.kode_pos] ? 'text-slate-900' : 'text-slate-300'}">` +
    `${esc(num(perOutlet[o.kode_pos] || 0))}</td>` +
    `<td class="px-3 py-2 text-center whitespace-nowrap">` +
    `<button onclick="showOnMap('${esc(o.kode_pos)}')" class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-white" style="background:var(--astra-navy)">` +
    `<i class="ph-fill ph-map-trifold"></i> Peta</button> ` +
    `<button onclick="suntingPos('${esc(o.kode_pos)}')" class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 text-slate-600 hover:bg-slate-50">` +
    `<i class="ph ph-pencil-simple"></i> Sunting</button></td>` +
    `</tr>`).join('')
    : '<tr><td colspan="6" class="text-center py-8 text-slate-400 text-sm">Tidak ada pos yang cocok.</td></tr>';
}

/** Tombol "Lihat Peta" di Master Pos: pindah tab, pilih pos, heatmapnya ikut. */
function showOnMap(code) {
  switchTab('peta');
  setTimeout(() => {
    S.selectedOutlet = null;               // paksa selectOutlet menyalakan, bukan mematikan
    selectOutlet(code);
    toast('Heatmap dihitung ulang untuk ' + (outletByCode[code] || {}).nama_pos, 'ok');
  }, 120);
}

function renderVillageTable() {
  const q = ($('mkel-search').value || '').toLowerCase();
  const prov = $('mkel-filter-provinsi').value;
  const city = $('mkel-filter-kota').value;
  const perVillage = sumBy(activeRows(), 'village');

  const list = DATA.villages.filter((v) =>
    (city === 'ALL' || v.kode_kota === city) &&
    (prov === 'ALL' || v.kode_kota.slice(0, 2) === prov) &&
    (!q || v.nama.toLowerCase().includes(q) || v.kode.includes(q)));

  // Urut provinsi -> kabupaten -> kecamatan -> kelurahan. Diminta di meeting: urutan
  // sebelumnya mengikuti volume, jadi kelurahan dari kabupaten yang berbeda-beda
  // berselang-seling dan tidak bisa ditelusuri.
  list.sort((a, b) =>
    a.kode_kota.slice(0, 2).localeCompare(b.kode_kota.slice(0, 2)) ||
    a.nama_kota.localeCompare(b.nama_kota) ||
    (a.nama_kecamatan || '').localeCompare(b.nama_kecamatan || '') ||
    a.nama.localeCompare(b.nama));

  const shown = list.slice(0, 400);
  $('table-kelurahan-body').innerHTML = shown.length ? shown.map((v) => {
    const total = perVillage[v.kode] || 0;
    return `<tr class="cursor-pointer" onclick="jumpToVillage('${esc(v.kode)}')">` +
      `<td class="px-3 py-2 mono text-xs text-slate-500">${esc(v.kode)}</td>` +
      `<td class="px-3 py-2"><div class="font-semibold text-slate-800">${esc(v.nama)}</div>` +
      `<div class="mono text-[10px] text-slate-400">${esc(v.lat.toFixed(5))}, ${esc(v.lng.toFixed(5))}</div></td>` +
      `<td class="px-3 py-2 text-slate-600">${esc(v.nama_kecamatan || '—')}</td>` +
      `<td class="px-3 py-2 text-slate-600">${esc(v.nama_kota)}</td>` +
      `<td class="px-3 py-2 text-slate-500 text-xs">${esc(PROVINCE_NAMES[v.kode_kota.slice(0, 2)] || v.kode_kota.slice(0, 2))}</td>` +
      `<td class="px-3 py-2 text-right font-bold mono ${total ? 'text-slate-900' : 'text-slate-300'}">${esc(num(total))}</td>` +
      `</tr>`;
  }).join('')
    : '<tr><td colspan="6" class="text-center py-8 text-slate-400 text-sm">Tidak ada kelurahan yang cocok.</td></tr>';

  if (list.length > shown.length) {
    $('table-kelurahan-body').innerHTML +=
      `<tr><td colspan="6" class="text-center py-2.5 bg-slate-50 text-slate-500 text-xs">` +
      `Menampilkan ${esc(num(shown.length))} dari ${esc(num(list.length))} kelurahan.</td></tr>`;
  }
}

function jumpToVillage(code) {
  const v = villageByCode[code];
  if (!v) return;
  switchTab('peta');
  setTimeout(() => {
    S.map.flyTo({ center: [v.lng, v.lat], zoom: 12, duration: 800 });
    openVillageDetail(code);
  }, 120);
}

function renderCustomerTable() {
  const q = ($('mkon-search').value || '').toLowerCase();
  const city = $('mkon-filter-kota').value;
  const dealer = $('mkon-filter-dealer').value;

  const list = CUSTOMERS.filter((c) => {
    const v = villageByCode[c.village] || {};
    if (city !== 'ALL' && v.kode_kota !== city) return false;
    if (dealer !== 'ALL' && c.dealer !== dealer) return false;
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q) ||
      c.engineNo.toLowerCase().includes(q);
  });

  const shown = list.slice(0, 300);
  $('table-konsumen-body').innerHTML = shown.length ? shown.map((c) => {
    const v = villageByCode[c.village] || {};
    const o = outletByCode[c.outlet] || {};
    return `<tr class="cursor-pointer" onclick="showCustomerDetail('${esc(c.id)}')">` +
      `<td class="px-3 py-2 font-semibold text-slate-800">${esc(c.name)}</td>` +
      `<td class="px-3 py-2 text-slate-600 text-xs">${esc(c.address)}</td>` +
      `<td class="px-3 py-2 mono text-xs text-slate-500">${esc(c.engineNo)}</td>` +
      `<td class="px-3 py-2 text-slate-600 text-xs">${esc(c.type)}</td>` +
      `<td class="px-3 py-2 text-slate-600 text-xs">${esc(v.nama || c.village)}</td>` +
      `<td class="px-3 py-2"><span class="inline-flex items-center gap-1.5 text-xs">` +
      `<span class="w-2 h-2 rounded-full shrink-0" style="background:${esc(dealerColor(c.dealer))}"></span>` +
      `${esc(o.nama_pos || c.outlet)}</span></td>` +
      `<td class="px-3 py-2 text-center">${photoBadge(c.hasPhoto)}</td>` +
      `</tr>`;
  }).join('')
    : '<tr><td colspan="7" class="text-center py-8 text-slate-400 text-sm">Tidak ada konsumen yang cocok.</td></tr>';

  if (list.length > shown.length) {
    $('table-konsumen-body').innerHTML +=
      `<tr><td colspan="7" class="text-center py-2.5 bg-slate-50 text-slate-500 text-xs">` +
      `Menampilkan ${esc(num(shown.length))} dari ${esc(num(list.length))} konsumen.</td></tr>`;
  }
}

/**
 * Bukti foto rumah. Fiturnya belum ada — aplikasi mobile-nya belum dibuat.
 * Ditampilkan apa adanya, bukan diisi gambar palsu, supaya tidak ada yang mengira
 * datanya sudah terkumpul.
 */
function photoBadge(has) {
  return has
    ? `<span class="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg"><i class="ph-fill ph-image"></i> ada</span>`
    : `<span class="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg"><i class="ph ph-camera-slash"></i> belum</span>`;
}

function showCustomerDetail(id) {
  const c = CUSTOMERS.find((x) => x.id === id);
  if (!c) return;
  const v = villageByCode[c.village] || {};
  const o = outletByCode[c.outlet] || {};

  $('konsumenDetailContent').innerHTML =
    `<div class="mb-4 pr-6"><div class="text-lg font-extrabold text-slate-800">${esc(c.name)}` +
    `<span class="ml-2 text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded align-middle">contoh</span></div>` +
    `<div class="text-xs mono text-slate-400">${esc(c.id)}</div></div>` +

    `<div class="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 h-36 flex flex-col items-center justify-center text-slate-400 mb-4">` +
    (c.hasPhoto
      ? `<i class="ph-fill ph-house-line text-4xl text-slate-300"></i><div class="text-[11px] mt-1 font-semibold">Bukti foto rumah</div><div class="text-[10px]">contoh &mdash; foto asli diunggah lewat aplikasi mobile</div>`
      : `<i class="ph ph-camera-slash text-4xl"></i><div class="text-[11px] mt-1 font-semibold">Belum ada foto</div><div class="text-[10px]">menunggu aplikasi mobile</div>`) +
    `</div>` +

    `<div class="space-y-3 text-sm">` +
    `<div><div class="text-[11px] uppercase font-bold text-slate-400 mb-0.5">Alamat</div>` +
    `<div class="text-slate-700">${esc(c.address)}</div></div>` +
    `<div class="grid grid-cols-2 gap-3">` +
    `<div><div class="text-[11px] uppercase font-bold text-slate-400 mb-0.5">No. Mesin</div>` +
    `<div class="text-slate-700 mono text-xs">${esc(c.engineNo)}</div></div>` +
    `<div><div class="text-[11px] uppercase font-bold text-slate-400 mb-0.5">Tipe</div>` +
    `<div class="text-slate-700 text-xs">${esc(c.type)}</div></div>` +
    `<div><div class="text-[11px] uppercase font-bold text-slate-400 mb-0.5">Kelurahan</div>` +
    `<div class="text-slate-700">${esc(v.nama || '-')}</div></div>` +
    `<div><div class="text-[11px] uppercase font-bold text-slate-400 mb-0.5">Kecamatan</div>` +
    `<div class="text-slate-700">${esc(v.nama_kecamatan || '-')}</div></div></div>` +
    `<div class="pt-3 border-t border-slate-100">` +
    `<div class="text-[11px] uppercase font-bold text-slate-400 mb-0.5">Pos Dealer</div>` +
    `<div class="text-slate-700 flex items-center gap-1.5">` +
    `<span class="w-2 h-2 rounded-full shrink-0" style="background:${esc(dealerColor(c.dealer))}"></span>` +
    `${esc(o.nama_pos || c.outlet)}</div></div>` +
    // Jarak per konsumen sengaja tidak ditampilkan: yang bisa dihitung cuma jarak
    // outlet ke titik tengah kelurahan, dan itu sama untuk semua orang di kelurahan
    // yang sama. Menampilkannya per orang memberi kesan presisi yang tidak ada.
    `<p class="text-[11px] text-slate-400 pt-2 border-t border-slate-100">` +
    `Jarak per konsumen tidak ditampilkan — alamat konsumen belum punya koordinat, ` +
    `jadi angka apa pun di sini akan sama untuk seluruh kelurahan.</p></div>`;

  $('konsumenDetailModal').classList.remove('hidden');
}

function closeCustomerDetail() { $('konsumenDetailModal').classList.add('hidden'); }

/* ==========================================================================
   IMPORT EXCEL
   ==========================================================================
   Prototipe: berkasnya tidak pernah benar-benar dibaca. Yang ditunjukkan alurnya —
   pilih periode dulu, baru unggah, lalu tinjau sebelum disimpan.
   ========================================================================== */

const IMPORT_STATE = {
  step: 1,
  period: '2026-09',
  rows: [],
  saved: [
    { period: '2026-08', rows: 19080, matched: 18512, at: '12 Agu 2026' },
    { period: '2026-07', rows: 17240, matched: 16702, at: '08 Jul 2026' },
    { period: '2026-06', rows: 16880, matched: 16301, at: '05 Jun 2026' },
  ],
};

function importPeriodChanged() {
  const period = `${$('imp-tahun').value}-${$('imp-bulan').value}`;
  IMPORT_STATE.period = period;
  const existing = IMPORT_STATE.saved.find((s) => s.period === period);
  $('imp-warning').classList.toggle('hidden', !existing);
  if (existing) {
    $('imp-warning-text').innerHTML =
      `Sheet <b>${esc(period)}</b> sudah ada, diimpor ${esc(existing.at)} dengan ` +
      `${esc(num(existing.rows))} baris. Mengimpor lagi akan <b>mengganti seluruh isi ` +
      `sheet itu</b>. Bulan lain tidak tersentuh.`;
  }
  $('imp-label-2').textContent = monthLabel(period);
  $('imp-label-4').textContent = monthLabel(period);
}

function importStep(step) {
  IMPORT_STATE.step = step;
  [1, 2, 3, 4].forEach((n) => {
    $('imp-' + n).classList.toggle('hidden', n !== step);
    const dot = $('step-' + n);
    dot.className = 'step-dot ' + (n < step ? 'done' : n === step ? 'now' : 'todo');
    dot.textContent = n < step ? '✓' : n;
  });
  if (step === 2) $('imp-file').classList.add('hidden');
  if (step === 3) runFakeImport();
  if (step === 4) renderImportTable();
}

function fakePickFile() {
  $('dropzone').classList.add('hover');
  setTimeout(() => {
    $('dropzone').classList.remove('hover');
    $('imp-file').classList.remove('hidden');
  }, 250);
}

const FAKE_STEPS = [
  'membaca berkas...',
  'memeriksa nama kolom...',
  'mencocokkan kelurahan (kota → kecamatan → kelurahan)...',
  'mengelompokkan pos ke dealer...',
  'menghitung agregat per kelurahan...',
  'selesai',
];

function runFakeImport() {
  $('imp-result').classList.add('hidden');
  $('imp-proc-title').textContent = 'Memproses berkas...';
  let progress = 0;
  let stepIndex = 0;
  $('imp-bar').style.width = '0%';

  const timer = setInterval(() => {
    progress += 4 + Math.random() * 7;
    if (progress > 100) progress = 100;
    $('imp-bar').style.width = progress + '%';
    const next = Math.min(FAKE_STEPS.length - 1, Math.floor(progress / 20));
    if (next !== stepIndex) {
      stepIndex = next;
      $('imp-proc-step').textContent = FAKE_STEPS[stepIndex];
    }
    if (progress >= 100) {
      clearInterval(timer);
      $('imp-proc-title').textContent = 'Selesai diproses';
      $('imp-unmatched').innerHTML = [
        ['PURWAREJA KLAMPOK', 'Banjarnegara', 41],
        ['BATURADEN', 'Banyumas', 38],
        ['KARANGWUNI', 'Kulon Progo', 22],
        ['SIDOMULYO', 'Magelang', 17],
        ['TAMBAKREJA', 'Cilacap', 14],
      ].map(([name, city, count]) =>
        `<div class="px-4 py-2 flex items-center gap-2">` +
        `<span class="font-semibold text-slate-700">${esc(name)}</span>` +
        `<span class="text-slate-400">${esc(city)}</span>` +
        `<span class="ml-auto mono text-slate-500">${esc(count)} baris</span></div>`).join('');
      $('imp-result').classList.remove('hidden');
    }
  }, 130);
}

function renderImportTable() {
  if (!IMPORT_STATE.rows.length) {
    // Contoh baris diambil dari kelurahan sungguhan supaya terlihat masuk akal.
    IMPORT_STATE.rows = DATA.villages.slice(120, 132).map((v, i) => {
      const outlet = DATA.outlets[i % DATA.outlets.length];
      return { village: v.nama, district: v.nama_kecamatan, city: v.nama_kota,
        outlet: outlet.nama_pos, units: 3 + ((i * 7) % 19) };
    });
  }

  $('imp-table').innerHTML = IMPORT_STATE.rows.map((r, i) =>
    `<tr>` +
    `<td class="px-3 py-1.5 editable" contenteditable oninput="editImportCell(${i},'village',this)">${esc(r.village)}</td>` +
    `<td class="px-3 py-1.5 editable text-slate-600" contenteditable oninput="editImportCell(${i},'district',this)">${esc(r.district)}</td>` +
    `<td class="px-3 py-1.5 editable text-slate-600" contenteditable oninput="editImportCell(${i},'city',this)">${esc(r.city)}</td>` +
    `<td class="px-3 py-1.5 editable text-slate-600" contenteditable oninput="editImportCell(${i},'outlet',this)">${esc(r.outlet)}</td>` +
    `<td class="px-3 py-1.5 editable text-right mono font-bold" contenteditable oninput="editImportCell(${i},'units',this)">${esc(r.units)}</td>` +
    `<td class="px-3 py-1.5 text-center"><button onclick="removeImportRow(${i})" class="text-slate-300 hover:text-red-500"><i class="ph ph-trash"></i></button></td>` +
    `</tr>`).join('');
}

function editImportCell(index, field, cell) {
  IMPORT_STATE.rows[index][field] = cell.textContent.trim();
}

function addImportRow() {
  IMPORT_STATE.rows.push({ village: '', district: '', city: '', outlet: '', units: 0 });
  renderImportTable();
}

function removeImportRow(index) {
  IMPORT_STATE.rows.splice(index, 1);
  renderImportTable();
}

function saveImport() {
  const period = IMPORT_STATE.period;
  const existing = IMPORT_STATE.saved.find((s) => s.period === period);
  if (existing) {
    existing.rows = 19080;
    existing.matched = 18512;
    existing.at = '12 Agu 2026';
  } else {
    IMPORT_STATE.saved.unshift({ period: period, rows: 19080, matched: 18512,
      at: '12 Agu 2026' });
  }
  renderSavedPeriods();
  toast(`Sheet ${period} disimpan ke spreadsheet`, 'ok');
  importStep(1);
}

function renderSavedPeriods() {
  $('imp-periods').innerHTML = IMPORT_STATE.saved.map((s) =>
    `<div class="border border-slate-100 rounded-xl px-3 py-2.5 hover:border-slate-300">` +
    `<div class="flex items-center gap-2">` +
    `<i class="ph-fill ph-microsoft-excel-logo text-emerald-600"></i>` +
    `<span class="text-sm font-bold text-slate-800">${esc(monthLabel(s.period))}</span>` +
    `<span class="ml-auto text-[10px] mono text-slate-400">sheet ${esc(s.period)}</span></div>` +
    `<div class="text-[11px] text-slate-500 mt-1">${esc(num(s.rows))} baris · ` +
    `${esc(num(s.matched))} cocok · diimpor ${esc(s.at)}</div>` +
    `<button onclick="editPeriod('${esc(s.period)}')" class="mt-2 text-[11px] font-bold text-slate-500 hover:text-slate-800">` +
    `<i class="ph ph-pencil-simple"></i> sunting bulan ini</button></div>`).join('');
}

function editPeriod(period) {
  const [year, month] = period.split('-');
  $('imp-tahun').value = year;
  $('imp-bulan').value = month;
  importPeriodChanged();
  IMPORT_STATE.rows = [];
  importStep(4);
  toast(`Menyunting sheet ${period}`, 'ok');
}

/* ==========================================================================
   PAS-KAN PETA
   ========================================================================== */

/**
 * Bawa peta ke data yang SEDANG TAMPIL, bukan selalu ke seluruh wilayah.
 *
 * Memfilter satu pos lalu harus menggeser dan memperbesar peta sendiri untuk
 * menemukannya adalah pekerjaan yang tidak perlu ada. Yang dipakai batas dari kelurahan
 * yang punya penjualan pada filter aktif, ditambah koordinat outlet yang tampil —
 * dengan begitu pos dan wilayah yang dilayaninya masuk semua.
 *
 * Kalau filternya tidak menyisakan apa-apa, kembali ke seluruh cakupan. Peta kosong
 * yang di-zoom ke tempat entah di mana lebih membingungkan daripada peta utuh.
 */
function fitToScope() {
  const rows = activeRows();
  const titik = [];

  const perKel = sumBy(rows, 'village');
  Object.keys(perKel).forEach((kode) => {
    const v = villageByCode[kode];
    if (v && v.lat != null) titik.push([v.lng, v.lat]);
  });

  // Outlet yang sedang jadi fokus ikut masuk, supaya posnya tidak tertinggal di luar
  // bingkai waktu wilayah layanannya kebetulan ada di satu sisi saja.
  const pos = filterValue('filter-pos');
  const dealer = filterValue('filter-dealer');
  DATA.outlets.forEach((o) => {
    if (o.lat == null) return;
    const ikut = pos !== 'ALL' ? o.kode_pos === pos
      : dealer !== 'ALL' ? o.kode_dealer === dealer
        : false;
    if (ikut) titik.push([o.lng, o.lat]);
  });

  if (!titik.length) {
    S.map.fitBounds(bounds(GEO), { padding: 40, duration: 700 });
    toast('Tidak ada data pada filter ini — peta dikembalikan ke seluruh wilayah');
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  titik.forEach(([x, y]) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });

  // Satu kelurahan saja menghasilkan kotak seluas nol, dan fitBounds akan memperbesar
  // sampai maksimum. Diberi kelonggaran ~2,5 km supaya tetap ada konteks di sekitarnya.
  const minSpan = 0.022;
  if (maxX - minX < minSpan) { const c = (maxX + minX) / 2; minX = c - minSpan / 2; maxX = c + minSpan / 2; }
  if (maxY - minY < minSpan) { const c = (maxY + minY) / 2; minY = c - minSpan / 2; maxY = c + minSpan / 2; }

  S.map.fitBounds([[minX, minY], [maxX, maxY]],
    { padding: S.fullscreen ? 90 : 50, duration: 700, maxZoom: 13 });
}

/* ==========================================================================
   LAYAR PENUH
   ========================================================================== */

function toggleFullscreen(paksa) {
  S.fullscreen = paksa === undefined ? !S.fullscreen : Boolean(paksa);
  $('map-shell').classList.toggle('penuh', S.fullscreen);
  $('label-penuh').textContent = S.fullscreen ? 'Keluar' : 'Layar penuh';
  $('btn-penuh').querySelector('i').className =
    S.fullscreen ? 'ph-fill ph-arrows-in' : 'ph-fill ph-arrows-out';
  document.body.style.overflow = S.fullscreen ? 'hidden' : '';

  // MapLibre menyimpan ukuran kanvas saat dibuat dan tidak mengikutinya sendiri.
  // Tanpa resize() peta akan tergambar di ukuran lama sampai jendelanya digeser.
  setTimeout(() => S.map.resize(), 60);
  setTimeout(() => S.map.resize(), 400);
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('modal-pos').classList.contains('hidden')) { tutupSuntingPos(); return; }
  if (S.fullscreen) toggleFullscreen(false);
});

/* ==========================================================================
   SUNTING POS DEALER
   ========================================================================== */

function suntingPos(kode) {
  const o = outletByCode[kode];
  if (!o) return;
  S.editing = kode;
  $('sp-nama').textContent = o.nama_pos;
  $('sp-kode').textContent = `${o.kode_pos} · ${o.nama_dealer}`;
  $('sp-alamat').value = o.alamat || '';
  $('sp-lat').value = o.lat == null ? '' : o.lat;
  $('sp-lng').value = o.lng == null ? '' : o.lng;
  $('sp-reset').classList.toggle('hidden', !sudahDisunting(kode));
  $('modal-pos').classList.remove('hidden');
}

function tutupSuntingPos() {
  $('modal-pos').classList.add('hidden');
  S.editing = null;
  S.pickingOnMap = false;
  S.map.getCanvas().style.cursor = '';
}

/** Modal menutup sementara; klik berikutnya di peta jadi koordinatnya. */
function ambilDariPeta() {
  if (!S.editing) return;
  S.pickingOnMap = true;
  $('modal-pos').classList.add('hidden');
  if (S.fullscreen === false) $('map').scrollIntoView({ block: 'center' });
  S.map.getCanvas().style.cursor = 'crosshair';
  toast('Klik titik yang benar di peta', 'ok');
}

function terimaTitikPeta(lngLat) {
  S.pickingOnMap = false;
  S.map.getCanvas().style.cursor = '';
  $('sp-lat').value = lngLat.lat.toFixed(6);
  $('sp-lng').value = lngLat.lng.toFixed(6);
  $('modal-pos').classList.remove('hidden');
}

function simpanSuntingPos() {
  const kode = S.editing;
  const o = outletByCode[kode];
  if (!o) return;

  const lat = Number(String($('sp-lat').value).trim());
  const lng = Number(String($('sp-lng').value).trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    toast('Koordinat harus angka. Contoh: -7.79558', 'error');
    return;
  }
  // Cakupan proyek: DIY + Jateng. Angka di luar ini hampir pasti salah ketik atau
  // lintang dan bujur tertukar, dan pin yang melompat ke Afrika lebih membingungkan
  // daripada penolakan.
  if (lat < -9 || lat > -5 || lng < 107 || lng > 113) {
    toast('Koordinat di luar wilayah cakupan. Lintang dan bujur tertukar?', 'error');
    return;
  }

  const simpanan = bacaSuntingan();
  simpanan[kode] = { lat, lng, alamat: $('sp-alamat').value.trim() };
  tulisSuntingan(simpanan);

  o.lat = lat;
  o.lng = lng;
  o.alamat = simpanan[kode].alamat;

  tutupSuntingPos();
  toast('Tersimpan di browser ini', 'ok');
  renderAll();
  renderOutletTable();
}

function kembalikanPos() {
  const kode = S.editing;
  const simpanan = bacaSuntingan();
  delete simpanan[kode];
  tulisSuntingan(simpanan);
  Object.assign(outletByCode[kode], BAWAAN[kode]);
  tutupSuntingPos();
  toast('Dikembalikan ke koordinat bawaan', 'ok');
  renderAll();
  renderOutletTable();
}

/* ==========================================================================
   TAB
   ========================================================================== */

function switchTab(name) {
  ['peta', 'import', 'pos', 'kelurahan', 'konsumen'].forEach((tab) => {
    $('tab-' + tab).classList.toggle('hidden', tab !== name);
    $('nav-' + tab).classList.toggle('active', tab === name);
  });
  if (name === 'peta' && S.map) setTimeout(() => S.map.resize(), 60);
  if (name === 'pos') renderOutletTable();
  if (name === 'kelurahan') renderVillageTable();
  if (name === 'konsumen') renderCustomerTable();
}

/* ==========================================================================
   RENDER SEMUA
   ========================================================================== */

function renderAll() {
  const rows = activeRows();
  const perVillage = S.layersReady ? renderMap(rows) : sumBy(rows, 'village');

  renderKpi(rows, perVillage);
  renderTreemap(rows);
  renderPerforma(rows);
  renderKartuDealer(rows);
  renderDealerLegend(rows);

  $('scope-label').textContent = scopeLabel();
  $('scope-clear').classList.toggle('hidden', scopeLabel() === 'seluruh penjualan');

  // Dropdown layar penuh cuma cermin; nilainya selalu mengikuti filter utama.
  [['fs-periode', 'filter-periode'], ['fs-kota', 'filter-kota'],
    ['fs-dealer', 'filter-dealer'], ['fs-pos', 'filter-pos']].forEach(([fs, utama]) => {
    if ($(fs)) $(fs).value = $(utama).value;
  });

  S.selectedOutlet = filterValue('filter-pos') === 'ALL' ? null : filterValue('filter-pos');

  if (S.layersReady) {
    drawMarkers();
    redrawMap();
  }
  if (S.selectedVillage) openVillageDetail(S.selectedVillage);
}

/* ==========================================================================
   MULAI
   ========================================================================== */

function fillSelect(el, pairs, allLabel) {
  el.innerHTML = `<option value="ALL">${esc(allLabel)}</option>` +
    pairs.map(([value, label]) =>
      `<option value="${esc(value)}">${esc(label)}</option>`).join('');
}

function boot() {
  // --- filter ---
  fillSelect($('filter-periode'),
    DATA.periods.slice().reverse().map((p) => [p, monthLabel(p)]), 'Semua Periode');
  $('filter-periode').value = DATA.periods[DATA.periods.length - 1];

  const provinces = [...new Set(DATA.villages.map((v) => v.kode_kota.slice(0, 2)))].sort();
  fillSelect($('filter-provinsi'),
    provinces.map((p) => [p, PROVINCE_NAMES[p] || 'Provinsi ' + p]), 'Semua Provinsi');
  fillSelect($('mkel-filter-provinsi'),
    provinces.map((p) => [p, PROVINCE_NAMES[p] || 'Provinsi ' + p]), 'Semua Provinsi');

  const cities = Object.keys(cityName).sort((a, b) => cityName[a].localeCompare(cityName[b]));
  [['filter-kota', 'Semua Kota'], ['mkel-filter-kota', 'Semua Kota'],
    ['mkon-filter-kota', 'Semua Kota']].forEach(([id, label]) => {
    fillSelect($(id), cities.map((c) => [c, cityName[c]]), label);
  });

  const dealers = DATA.dealers.map((d) => [d.dealerCode, d.dealerName]);
  [['filter-dealer', 'Semua Dealer'], ['mpos-filter-dealer', 'Semua Dealer'],
    ['mkon-filter-dealer', 'Semua Dealer']].forEach(([id, label]) => {
    fillSelect($(id), dealers, label);
  });

  fillSelect($('filter-pos'),
    DATA.outlets.slice().sort((a, b) => a.nama_pos.localeCompare(b.nama_pos))
      .map((o) => [o.kode_pos, o.nama_pos]), 'Semua Pos Dealer');

  // --- import ---
  fillSelect($('imp-bulan'), MONTHS.map((m, i) =>
    [String(i + 1).padStart(2, '0'), m]), 'Bulan');
  fillSelect($('imp-tahun'), ['2026', '2025'].map((y) => [y, y]), 'Tahun');
  $('imp-bulan').value = '09';
  $('imp-tahun').value = '2026';
  importPeriodChanged();
  renderSavedPeriods();

  // --- status ---
  $('sidebar-status').textContent =
    `${num(DATA.villages.length)} kelurahan · ${DATA.outlets.length} pos · ` +
    `${DATA.dealers.length} dealer · data contoh`;

  $('pos-count').textContent = DATA.outlets.length;
  $('pos-dealer-count').textContent = DATA.dealers.length;

  // Dipanggil eksplisit supaya tombol dan S.treemapView selalu sepakat. Mengandalkan
  // kelas yang ditulis di markup berarti dua sumber kebenaran untuk satu hal.
  setTreemapView('dealer');

  $('pilihan-radius').innerHTML = (DATA.radiiM || [DATA.radiusM]).map((r) =>
    `<button id="radius-${r}" onclick="ubahRadius(${r})" ` +
    `class="flex-1 px-2 py-1.5 rounded-md text-[11px] font-bold ` +
    `${r === DATA.radiusM ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}">` +
    `${r / 1000} km</button>`).join('');

  // Dropdown filter versi layar penuh dibangun dari yang utama, supaya tidak ada dua
  // daftar yang bisa menyimpang.
  [['fs-periode', 'filter-periode'], ['fs-kota', 'filter-kota'],
    ['fs-dealer', 'filter-dealer'], ['fs-pos', 'filter-pos']].forEach(([fs, utama]) => {
    $(fs).innerHTML = $(utama).innerHTML;
    $(fs).value = $(utama).value;
  });

  setupMap();
  S.map.on('load', () => {
    addLayers();
    S.layersReady = true;
    S.map.fitBounds(bounds(GEO), { padding: 30, duration: 0 });
    S.map.resize();
    renderAll();
  });

  renderAll();
}

function bounds(geo) {
  let minX = 180; let minY = 90; let maxX = -180; let maxY = -90;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1];
      return;
    }
    c.forEach(walk);
  };
  geo.features.forEach((f) => walk(f.geometry.coordinates));
  return [[minX, minY], [maxX, maxY]];
}

boot();
