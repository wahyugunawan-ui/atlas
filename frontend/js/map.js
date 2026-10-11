/**
 * Peta: basemap, lapisan choropleth, batas kabupaten, dan titik tiga sumber.
 */
import {
  ATTRIBUTION, ATTRIBUTION_SATELLITE, BASEMAP_PMTILES, BASEMAP_SATELLITE,
} from './config.js';
import { classOf, dealerColor, percentileBreaks, RAMP, COLOR_EMPTY } from './colors.js';
import {
  $, bbox, diAtasMarker, displayCityName, esc, formatNumber, setTooltipJenis, sumBy, toast,
} from './dom.js';
import { fetchDistrictCustomers, fetchTitikPeta } from './api.js';
import {
  activeRows, focusDealerSet, fusionFilterPeta, hasScopeFilter, pageFilters, scopeValue,
} from './filters.js';
import { circle, EMPTY_COLLECTION } from './geo.js';
import {
  cincinPerDesa, ikonKotak, pembangkitAcak, sebarDiPoligon, titikPerDesa,
} from './fusion-points.js';
import { fiturTelusur } from './fusion-alasan.js';
// Cuma tabel warna+nama golongan (data murni, tanpa DOM) — bukan lingkaran modul.
import { SEGMENTS } from './fusion-segments.js';
import { contributionsForRows, relatedDistricts, unitsForRows } from './sales-stats.js';
// outlets.js TIDAK meng-import berkas ini (ia cuma memakai colors, dom, filters, dan
// state), jadi impor ini tidak membuat lingkaran modul. Lihat catatan serupa di
// outlets.js yang memakai window.openDealerDetail justru untuk menghindari lingkaran
// ke tables.js.
import { drawDealerMarkers, drawMarkers, moveTooltip } from './outlets.js';
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

/**
 * Skala marker DOM dealer/pos mengikuti zoom peta — dekat = besar, jauh = kecil
 * (permintaan tim). Titik acuan dan gaya interpolasinya SENGAJA meniru pola yang
 * sudah dipakai lapisan circle/symbol lain (`jual-titik`, `ktp-titik`, dkk, semua
 * pakai `['interpolate', ['linear'], ['zoom'], ...]`) — bukan skala linear murni,
 * supaya di zoom rendah markernya tidak menyusut sampai tidak terlihat, dan di zoom
 * tinggi tidak membesar sampai menutupi area yang sedang dilihat.
 *
 * Marker dealer/pos MARKER DOM, bukan lapisan MapLibre (lihat komentar di puncak
 * outlets.js), jadi tidak bisa memakai `circle-radius`/`icon-size` interpolate
 * bawaan MapLibre seperti lapisan lain — makanya perlu fungsi JS sendiri di sini,
 * dipanggil dari event `zoom` peta (lihat pemanggilnya di bawah).
 *
 * Diekspor murni supaya bisa diuji tanpa membuat instance peta sungguhan.
 *
 * @returns {number} faktor skala CSS, mis. 0.7 di zoom rendah, 1.55 di zoom tinggi
 */
export function skalaMarkerZoom(zoom) {
  // Kurva DIPERTAJAM 2026-09-18 sore. Versi pertama ([[6,0.7],[10,1],[14,1.55]]) cuma
  // menyusut 30% di zoom terjauh, dan keluhannya tepat: waktu peta ditarik keluar,
  // simbol pos/dealer tetap sebesar itu lalu saling menumpuk sampai wilayahnya
  // tertutup sendiri.
  //
  // Acuannya sekarang ditetapkan tim: ukuran NORMAL (1.0) adalah ukuran sekarang pada
  // tampilan skala 2 km, yaitu sekitar zoom 13. Dari situ ke luar menyusut tajam —
  // 5 km (z12) tinggal ~0.72, 10 km (z11) ~0.52, 20 km (z10) 0.4 — dan berhenti di
  // 0.25 supaya di tampilan se-provinsi titiknya masih terlihat, bukan hilang.
  // Ke dalam sengaja cuma sampai 1.25: di zoom sedekat itu yang perlu dibaca peta
  // dan ringnya, bukan simbolnya.
  const TITIK = [[7, 0.25], [10, 0.4], [12, 0.72], [13, 1], [15, 1.25]];
  const z = Number(zoom);
  if (!Number.isFinite(z) || z <= TITIK[0][0]) return TITIK[0][1];
  if (z >= TITIK[TITIK.length - 1][0]) return TITIK[TITIK.length - 1][1];
  for (let i = 0; i < TITIK.length - 1; i++) {
    const [z0, s0] = TITIK[i];
    const [z1, s1] = TITIK[i + 1];
    if (z >= z0 && z <= z1) return s0 + (s1 - s0) * ((z - z0) / (z1 - z0));
  }
  return 1;
}

/**
 * Tulis ulang variabel CSS `--zoom-scale` di `#map`. Custom property CSS mewarisi ke
 * seluruh keturunan DOM secara bawaan — marker dealer/pos (elemen DOM biasa yang
 * ditambahkan MapLibre sebagai anak `#map`) otomatis ikut membaca nilai ini lewat
 * aturan `.marker-outlet { transform: scale(var(--zoom-scale, 1)); }` di index.html,
 * TANPA perlu menyentuh style tiap marker satu per satu.
 *
 * `transform` di sini ditulis di STYLESHEET, bukan `style.transform` inline per
 * elemen — sengaja, supaya aturan `:hover { transform: scale(1.18); }` yang sudah
 * ada tetap menang saat kursor di atas marker (inline style SELALU mengalahkan
 * stylesheet apa pun specificity-nya, jadi menyetel transform inline di sini akan
 * mematikan efek hover yang sudah ada).
 */
function perbaruiSkalaMarker() {
  const peta = $('map');
  if (!S.map || !peta) return;
  peta.style.setProperty('--zoom-scale', String(skalaMarkerZoom(S.map.getZoom())));
}

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

  // 'bottom-left', BUKAN 'top-right': pojok kanan-atas sudah ditempati
  // #opsi-peta-panel (absolute, DOM biasa) — dua kontrol di pojok yang sama
  // saling menutupi karena #opsi-peta-panel tidak tahu-menahu soal stacking
  // internal MapLibre. ScaleControl di baris berikutnya (default bottom-left)
  // dan kontrol atribusi bawaan MapLibre (default bottom-right) sudah pasti
  // aman menumpuk rapi dengan kontrol MapLibre lain di pojok yang sama.
  S.map.addControl(new maplibregl.NavigationControl(), 'bottom-left');
  S.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }));

  // Titik dealer/pos ikut skala zoom (permintaan tim) — lihat skalaMarkerZoom() di
  // atas. Dipanggil sekali SEKARANG (zoom awal peta, bukan menunggu event 'zoom'
  // pertama) supaya markernya tidak sekejap tampil ukuran bawaan lalu melompat
  // begitu orang pertama kali menggeser/memperbesar peta.
  S.map.on('zoom', perbaruiSkalaMarker);
  perbaruiSkalaMarker();

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
  // KECAMATAN = satuan analisis peta sejak 2026-10-10 (docs/DECISIONS.md): ini yang
  // diwarnai, diklik, dan disorot. Kelurahan di bawahnya tinggal garis referensi
  // "Batas dan Nama Desa" (mati bawaan) — tidak ada isian per desa lagi, karena tidak
  // ada angka per desa yang boleh tampil.
  S.map.addSource('kec', { type: 'geojson', data: S.geo, promoteId: 'kode' });
  S.map.addSource('kel', { type: 'geojson', data: S.villageGeo, promoteId: 'kode' });

  S.map.addLayer({
    id: 'kec-warna', type: 'fill', source: 'kec',
    paint: {
      'fill-color': ['coalesce', ['feature-state', 'warna'], COLOR_EMPTY],
      'fill-opacity': 0.85,
    },
  });
  S.map.addLayer({
    id: 'kel-garis', type: 'line', source: 'kel',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#ffffff', 'line-width': 0.4, 'line-opacity': 0.5 },
  });
  S.map.addLayer({
    id: 'kel-nama', type: 'symbol', source: 'kel', minzoom: 11.5,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'nama'], 'text-font': ['Noto Sans Regular'],
      'text-size': 10, 'text-allow-overlap': false,
    },
    paint: { 'text-color': '#475569', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
  });
  addDistrictLayers();

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

  /* ---- tiga lapisan titik penyatuan sumber (docs/FUSION.md 3.1) -------------
     MENYIMPANG DARI SPESIFIKASI, disengaja: spesifikasi meminta Servis berupa
     SYMBOL layer berbentuk kotak lewat map.addImage(). addImage() belum pernah
     dipakai sekali pun di proyek ini, dan ikonnya tidak bisa saya lihat hasilnya
     di browser — memperkenalkan API baru yang tidak terverifikasi demi bentuk
     kotak bukan pertukaran yang sepadan. Ketiganya circle layer, dibedakan lewat
     ISIAN dan OUTLINE:
       KTP    = isian warna dealer, tanpa outline
       Servis = isian merah muda tetap, kecil       (warna tetap = bukan soal dealer)
       Kirim  = isian kosong, outline kuning        (kosong-berpinggir beda jelas)
     Warna tetap dipakai untuk DEALER pada lapisan KTP; golongan tidak pernah
     memakai warna, sesuai prinsip dua saluran di 3.1. */
  S.map.addSource('ktp', { type: 'geojson', data: EMPTY_COLLECTION });
  S.map.addLayer({
    id: 'ktp-titik', type: 'circle', source: 'ktp',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 1.4, 11, 2.6, 14, 4.5],
      'circle-color': ['get', 'warna'],
      'circle-opacity': 0.8,
    },
  });

  // Servis = KOTAK, sesuai docs/FUSION.md 3.1. `circle` layer tidak bisa membuat
  // sudut, jadi ini satu-satunya lapisan titik yang memakai symbol + ikon.
  //
  // Ikonnya dibangkitkan dari piksel (fusion-points.js), bukan berkas gambar:
  // aturan proyek melarang aset dari internet. addLayers() sendiri dijalankan di
  // dalam `S.map.on('load')` (app.js), jadi gaya peta sudah siap dan addImage()
  // aman dipanggil di sini. Dijaga hasImage() kalau suatu hari gayanya dimuat ulang.
  if (!S.map.hasImage('kotak-servis')) {
    S.map.addImage('kotak-servis', ikonKotak(12, [236, 72, 153], [255, 255, 255]));
  }
  S.map.addSource('servis', { type: 'geojson', data: EMPTY_COLLECTION });
  S.map.addLayer({
    id: 'servis-titik', type: 'symbol', source: 'servis',
    layout: {
      visibility: 'none',
      'icon-image': 'kotak-servis',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.25, 11, 0.45, 14, 0.75],
      // KEDUANYA WAJIB. Lapisan symbol secara bawaan membuang ikon yang bertumpuk
      // demi kerapian label — di sini itu berarti dari ~1.300 titik servis cuma
      // sebagian kecil yang tergambar, dan hasilnya terbaca sebagai DATA HILANG,
      // bukan sebagai setelan tampilan. Lapisan circle tidak punya masalah ini,
      // jadi jebakan ini cuma ada di satu lapisan ini.
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });

  S.map.addSource('kirim', { type: 'geojson', data: EMPTY_COLLECTION });
  S.map.addLayer({
    id: 'kirim-titik', type: 'circle', source: 'kirim',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 1.6, 11, 3, 14, 5],
      'circle-opacity': 0,
      'circle-stroke-width': 1.2,
      'circle-stroke-color': '#f59e0b',
    },
  });

  // DUA TINGKAT, sengaja, dan bedanya soal biaya — bukan soal kerahasiaan:
  //
  //   lewat begitu saja  -> tooltip AGREGAT (dealer, kelurahan, jumlah tiga sumber).
  //                         Murni dari data yang sudah ada di browser, nol permintaan.
  //   klik / diam 3 detik -> daftar pelanggan kantong itu (nama, nomor mesin,
  //                         golongan), lalu klik satu baris untuk riwayat lengkapnya.
  //                         Ini menembus pagar PII: dibatasi 30/menit dan ditulis ke
  //                         access_log.
  //
  // Versi pertama (2026-09-18 pagi) berhenti di tingkat pertama saja, dengan alasan
  // hover memicu PII terlalu sering. Tim menegaskan ulang permintaannya DAN menjawab
  // keberatan itu dengan menentukan pemicunya: bukan sekali lewat, melainkan klik atau
  // diam 3 detik. Pemicu itulah yang menyelesaikan masalahnya — satu perbuatan yang
  // disengaja = satu permintaan = satu baris log, bukan satu per gerakan mouse.
  //
  // Yang TIDAK berubah: titiknya sendiri tetap anonim. Posisinya acak di dalam
  // kelurahan (fusion-points.js) dan muatan petanya tidak membawa satu pun nomor
  // mesin — identitas selalu datang dari permintaan terpisah per kantong, tidak
  // pernah ikut menumpang di peta. Karena itu panelnya menampilkan DAFTAR orang di
  // kelurahan+dealer itu, bukan mengaku tahu siapa yang tinggal di koordinat titik
  // yang diklik: koordinat itu memang bukan alamat siapa-siapa.
  //
  // Object.entries(LAYER_TITIK), BUKAN daftar id ditulis ulang: LAYER_TITIK
  // (didefinisikan di bawah, dipakai lagi di redrawMap()) sudah memetakan
  // jenis->id lapisan — menuliskannya kedua kali di sini cuma membuka celah dua
  // daftar diam-diam menyimpang kalau suatu hari ada jenis titik baru.
  Object.entries(LAYER_TITIK).forEach(([jenis, layerId]) => {
    S.map.on('mouseenter', layerId, () => { S.map.getCanvas().style.cursor = 'pointer'; });
    S.map.on('mousemove', layerId, (e) => {
      if (!e.features || !e.features.length) return;
      // Di atas ikon pos/dealer yang menang tooltip ikonnya (nama pos/dealer); hitungan mundur
      // kartu orang (rute PII) juga dibatalkan: kursor itu tidak sedang menunjuk titik.
      if (diAtasMarker(e.originalEvent)) { batalkanKartuTitik(); return; }
      hoverTitik(jenis, e.features[0].properties, e.originalEvent);
    });
    S.map.on('mouseleave', layerId, (e) => {
      if (diAtasMarker(e && e.originalEvent)) { batalkanKartuTitik(); return; }
      S.map.getCanvas().style.cursor = '';
      const tip = $('tooltip');
      if (tip) { tip.classList.remove('show'); setTooltipJenis(tip, 'ringkasan'); }
      batalkanKartuTitik();
    });
    // Klik = riwayat LENGKAP orang itu, bukan sekadar kartunya. Pewaktunya dibatalkan
    // dulu supaya satu klik tidak berbuntut kartu yang muncul sesaat sesudahnya.
    S.map.on('click', layerId, (e) => {
      if (!e.features || !e.features.length) return;
      batalkanKartuTitik();
      bukaRiwayatDariTitik(jenis, e.features[0].properties);
    });
  });

  // Peta yang digeser/di-zoom membatalkan hitungan mundur: kursor yang kebetulan
  // berhenti di atas titik selama animasi bukan permintaan siapa pun, dan tiap
  // bukaan menembus pagar PII sekaligus menulis satu baris access_log.
  S.map.on('movestart', batalkanKartuTitik);
  S.map.on('zoomstart', batalkanKartuTitik);

  /* ---- telusur SATU mesin (docs/FUSION.md 3.1 dan 3.4) ---------------------
     Ditambahkan PALING AKHIR supaya berada di atas lapisan titik massal: yang
     sedang ditelusuri satu orang, dan ia harus terlihat di antara ribuan titik
     lain. Kosong sampai ada yang membuka panel telusur.

     Lingkaran ambangnya terpisah dari milik pos/dealer karena pusatnya berbeda
     (titik KTP mesin itu, bukan pos) dan keduanya boleh tampil bersamaan. */
  S.map.addSource('telusur', { type: 'geojson', data: EMPTY_COLLECTION });
  S.map.addSource('telusur-lingkaran', { type: 'geojson', data: EMPTY_COLLECTION });

  S.map.addLayer({
    id: 'telusur-lingkaran-isi', type: 'fill', source: 'telusur-lingkaran',
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#0b2f6b', 'fill-opacity': 0.07 },
  });
  S.map.addLayer({
    id: 'telusur-lingkaran-tepi', type: 'line', source: 'telusur-lingkaran',
    layout: { visibility: 'none' },
    paint: {
      'line-color': '#0b2f6b', 'line-width': 1.6, 'line-dasharray': [3, 2],
      'line-opacity': 0.9,
    },
  });
  S.map.addLayer({
    id: 'telusur-garis', type: 'line', source: 'telusur',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'warna'], 'line-width': 2, 'line-opacity': 0.9 },
  });
  S.map.addLayer({
    id: 'telusur-titik', type: 'circle', source: 'telusur',
    filter: ['==', ['geometry-type'], 'Point'],
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 6,
      'circle-color': ['get', 'warna'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  });
}

/** Semua lapisan telusur, dinyalakan dan dimatikan bersama. */
const LAPISAN_TELUSUR = ['telusur-lingkaran-isi', 'telusur-lingkaran-tepi',
  'telusur-garis', 'telusur-titik'];

/**
 * Gambar satu mesin di peta: tiga titik, garis penghubung, dan lingkaran ambang
 * KPI Jarak yang BERPUSAT DI TITIK KTP-nya — inilah bentuk yang diminta
 * docs/FUSION.md 3.4, dan yang membuat alasan penggolongan bisa DILIHAT, bukan cuma
 * dibaca: kalau titik servis jatuh di dalam lingkaran, "berdekatan" jadi kasatmata.
 *
 * Ambang yang dipakai yang TERSIMPAN di baris mesin itu (`kpiRadiusM`), bukan setelan
 * hari ini — sama seperti kalimat alasannya. Kalau tidak, lingkarannya bisa
 * bertentangan dengan golongan yang sedang dijelaskan.
 */
export function gambarTelusurDiPeta(detail) {
  if (!S.layersReady || !S.map) return;
  const f = (detail && detail.fusion) || {};
  const fitur = fiturTelusur(f);
  if (!fitur.length) { hapusTelusurDiPeta(); return; }

  S.map.getSource('telusur').setData({ type: 'FeatureCollection', features: fitur });

  const ambang = Number(f.kpiRadiusM) || 0;
  const pusat = fitur[0].geometry.coordinates;      // selalu titik KTP
  S.map.getSource('telusur-lingkaran').setData(ambang
    ? { type: 'FeatureCollection', features: [circle(pusat[0], pusat[1], ambang)] }
    : EMPTY_COLLECTION);

  LAPISAN_TELUSUR.forEach((id) => S.map.setLayoutProperty(id, 'visibility', 'visible'));

  // Bawa peta ke mesinnya. Tanpa ini orang harus mencari sendiri titik yang baru
  // saja digambar, di antara belasan ribu titik lain.
  S.map.easeTo({ center: pusat, zoom: Math.max(S.map.getZoom(), 10), duration: 600 });
}

/** Bersihkan jejak telusur dari peta. */
export function hapusTelusurDiPeta() {
  if (!S.layersReady || !S.map) return;
  S.map.getSource('telusur').setData(EMPTY_COLLECTION);
  S.map.getSource('telusur-lingkaran').setData(EMPTY_COLLECTION);
  LAPISAN_TELUSUR.forEach((id) => S.map.setLayoutProperty(id, 'visibility', 'none'));
}

/* ==========================================================================
   TITIK KTP / SERVIS / PENGIRIMAN
   ==========================================================================
   Datanya HITUNGAN per kelurahan, bukan koordinat — lihat fusion-points.js untuk
   alasan lengkapnya (centroid kelurahan, dan PII pada titik pengiriman). Yang di
   sini cuma urusan MapLibre dan pengambilan data; aritmetika dan geometrinya di
   fusion-points.js supaya bisa diuji tanpa browser.
   ========================================================================== */

/** Benih berbeda per jenis, supaya titik KTP dan Servis tidak saling menimpa persis. */
const BENIH_TITIK = { ktp: 991, servis: 20260917, kirim: 4242 };

const LAYER_TITIK = { ktp: 'ktp-titik', servis: 'servis-titik', kirim: 'kirim-titik' };

/**
 * Tanda saringan yang sedang aktif.
 *
 * Dipakai membandingkan apakah data yang tersimpan masih menjawab pertanyaan yang
 * sama. Tanpa ini, mengganti Kota akan tetap menampilkan titik kota sebelumnya —
 * salah yang tidak kelihatan salah, karena sebaran acak selalu tampak wajar.
 */
function tandaSaringPeta() {
  // fusionFilterPeta(), BUKAN fusionFilter(pageFilters('peta')): pos ikut dibuang di
  // halaman Confidence Fusion, dan tanda tangan ini WAJIB dihitung dari objek yang
  // sama persis dengan yang dikirim muatTitikFusi() — kalau tidak, pindah halaman
  // tidak menginvalidasi cache dan titiknya diam saja.
  const f = fusionFilterPeta();
  return [f.periode, f.kota, f.kec, (f.kotaBanyak || []).join(','), f.dealer, f.pos].join('|');
}

/** Ambil hitungan titik dari server, lalu gambar ulang. Aman dipanggil berkali-kali. */
async function muatTitikFusi() {
  if (S.fusionPointsLoading) return;
  S.fusionPointsLoading = true;
  const tanda = tandaSaringPeta();
  try {
    const jawab = await fetchTitikPeta(fusionFilterPeta());
    S.fusionPoints = { tanda, rows: jawab.rows || [], cache: {}, cincin: null };
  } catch (e) {
    S.fusionPoints = { tanda, rows: [], cache: {}, cincin: null, galat: e.message };
    toast(`Titik tiga sumber gagal dimuat: ${e.message}`);
  } finally {
    S.fusionPointsLoading = false;
  }
  redrawMap();
}

/**
 * Sebaran titik satu jenis, dibangun sekali lalu dipakai ulang.
 *
 * Hasilnya disimpan di `cache` milik data yang sedang dipegang, jadi dia ikut terbuang
 * sendiri begitu saringannya berubah — tidak ada cache yang hidup lebih lama daripada
 * data yang melahirkannya.
 */
/** Label ramah-baca per jenis titik, dipakai tooltip hover di bawah — BUKAN
 * legenda Opsi Peta, yang sudah punya labelnya sendiri di index.html. */
const LABEL_TITIK = { ktp: 'Titik KTP', servis: 'Titik Servis', kirim: 'Titik Pengiriman' };

/**
 * Jumlah KETIGA sumber untuk satu kantong (KECAMATAN, dealer) — isi tooltip titik.
 *
 * Satu FITUR titik TIDAK membawa hitungan ktp/servis/kirim-nya sendiri —
 * titikPerDesa() (fusion-points.js) mengempiskan satu bucket jadi satu angka `n`
 * untuk JENIS yang sedang diminta saja. Baris ASLI tersimpan apa adanya di
 * S.fusionPoints.rows (per desa+dealer, karena titiknya disebar per desa), jadi
 * di sini DIJUMLAHKAN ke kecamatan — satuan analisis sejak 2026-10-10 — tanpa
 * permintaan baru ke server.
 *
 * Murni: diekspor supaya bisa diuji tanpa membuat instance peta sungguhan.
 *
 * @returns {Object|null} {districtCode, dealerCode, ktp, servis, kirim}, atau null
 *   kalau tidak ada satu baris pun (semestinya tidak pernah terjadi — titiknya
 *   sendiri lahir dari baris ini — tapi dijaga daripada melempar galat saat hover).
 */
export function carikanBagianTitikFusi(rows, district, dealer) {
  if (!Array.isArray(rows)) return null;
  const cocok = rows.filter((r) => r.districtCode === district && r.dealerCode === dealer);
  if (!cocok.length) return null;
  const jumlah = (k) => cocok.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  return {
    districtCode: district, dealerCode: dealer,
    ktp: jumlah('ktp'), servis: jumlah('servis'), kirim: jumlah('kirim'),
  };
}

/**
 * Tooltip AGREGAT satu titik KTP/Servis/Pengiriman: dealer, kelurahan, dan jumlah
 * KETIGA sumber di bucket (kelurahan, dealer) itu — BUKAN identitas satu orang.
 *
 * TINGKAT PERTAMA dari dua (lihat komentar panjang di addLayers()). Sengaja tanpa
 * identitas siapa pun: dia menyala di SETIAP gerakan kursor, jadi ia harus gratis —
 * seluruh isinya sudah ada di S.fusionPoints.rows, nol permintaan ke server.
 *
 * Data per orang ada di tingkat kedua (klik, atau diam 3 detik), yang memanggil rute
 * PII ber-pagar. Pembagian ini yang membuat pembatas 30/menit dan access_log tetap
 * berarti: yang sering terjadi tidak berbiaya, yang berbiaya tidak sering terjadi.
 */
function tampilkanTooltipTitikFusi(jenis, properties, event) {
  const tip = $('tooltip');
  if (!tip) return;
  setTooltipJenis(tip, 'ringkasan');
  // Yang disebut KECAMATAN, bukan desa: titiknya memang disebar di desa asalnya
  // (supaya sebarannya aktual), tapi satuan analisis yang boleh tampil di peta
  // berhenti di kecamatan (2026-10-10). Nama desa per orang tetap ada di daftar
  // pelanggan — itu keterangan orang, bukan analisis.
  const { district, dealer } = properties || {};
  const kec = S.districtByCode[district];
  const namaKec = S.districtNames[district] || (kec && kec.name) || district || '—';
  const namaKota = kec ? displayCityName(kec.cityName) : '';
  const namaDealer = S.dealerNames[dealer] || dealer || 'dealer tidak dikenal';
  const bagian = carikanBagianTitikFusi(
    (S.fusionPoints && S.fusionPoints.rows) || [], district, dealer);

  const baris = (label, n) => `<div class="text-[11px] text-slate-300 flex ` +
    `items-center justify-between gap-3"><span>${esc(label)}</span>` +
    `<span class="mono text-white font-bold">${esc(formatNumber(Number(n) || 0))}</span></div>`;

  tip.innerHTML =
    `<div class="font-bold text-white">${esc(LABEL_TITIK[jenis] || 'Titik')}</div>` +
    `<div class="text-[11px] text-slate-300 mt-0.5">Kec. ${esc(namaKec)}${
      namaKota ? `, ${esc(namaKota)}` : ''}</div>` +
    `<div class="text-[11px] text-slate-300">${esc(namaDealer)}</div>` +
    `<div class="mt-1.5 pt-1.5 border-t border-slate-600">` +
    baris('KTP', bagian ? bagian.ktp : 0) +
    baris('Servis', bagian ? bagian.servis : 0) +
    baris('Pengiriman', bagian ? bagian.kirim : 0) +
    `</div>` +
    `<div class="text-[10px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-600 ` +
    `leading-snug">Jumlah pelanggan di kecamatan ini, BUKAN satu orang — posisi titik ` +
    `acak di dalam desa asalnya, bukan alamat sebenarnya.<br>` +
    `<span class="text-slate-300 font-bold">Klik</span> atau diam 3 detik untuk daftar ` +
    `pelanggannya.</div>`;
  tip.classList.add('show');
  moveTooltip(event);
}

/* ==========================================================================
   SATU TITIK = SATU ORANG
   ==========================================================================
   Permintaan tim 2026-09-20, dan perubahan KONSEP: hover titik tidak lagi menjawab
   "kelurahan ini punya berapa" melainkan "titik ini siapa".

   Yang TIDAK berubah, dan tidak boleh berubah: muatan peta tetap anonim. Tidak ada
   satu pun nomor mesin ikut dikirim bersama titik — kalau iya, seluruh basis data
   konsumen ada di browser begitu halaman dibuka. Yang dibawa titik cuma desa asal
   sebarannya, kecamatannya, dealer, dan NOMOR URUT-nya di dalam desa itu (`idx`,
   lihat bangunTitikFusi()).

   Identitasnya diminta terpisah lewat rute PII yang sudah berpagar
   (/v1/kecamatan/:district/pelanggan sejak 2026-10-10), satu kantong KECAMATAN per
   permintaan, dan hasilnya di-cache. Menyapu 40 titik di satu kecamatan = SATU
   permintaan, bukan 40.
   ========================================================================== */

/** Jeda sebelum daftar kantong diminta saat hover. Lihat alasannya di hoverTitik(). */
const TUNDA_KARTU_MS = 350;

/**
 * Daftar pelanggan per kantong, berkunci 'kecamatan|dealer|periode'.
 *
 * Nilainya Promise, bukan array: dua titik dari kantong yang sama yang di-hover
 * berurutan sebelum permintaan pertama selesai harus MENUNGGU permintaan itu, bukan
 * menembakkan yang kedua.
 *
 * Dibersihkan tiap muatan titik diganti (lihat muatTitikFusi()) — periode atau
 * saringan yang berubah membuat isinya tidak lagi menjawab pertanyaan yang sama.
 */
let cacheKantong = new Map();

export function bersihkanCacheKantong() { cacheKantong = new Map(); }

function ambilKantong(district, dealer, periode) {
  const kunci = `${district}|${dealer || ''}|${periode || ''}`;
  if (!cacheKantong.has(kunci)) {
    cacheKantong.set(kunci, fetchDistrictCustomers(district, { dealer, periode })
      .then((jawab) => ({
        rows: (jawab && jawab.rows) || [],
        total: Number(jawab && jawab.total) || 0,
      }))
      // Kegagalan TIDAK di-cache sebagai daftar kosong permanen: kantongnya dilepas
      // supaya percobaan berikutnya benar-benar mencoba lagi. Daftar kosong yang
      // tertanam akan terbaca "tidak ada orangnya di sini" selamanya.
      .catch((e) => { cacheKantong.delete(kunci); throw e; }));
  }
  return cacheKantong.get(kunci);
}

/**
 * Baris mana di daftar kantong yang diwakili titik ini.
 *
 * Kantongnya KECAMATAN, tapi titiknya disebar per DESA dan `idx`-nya dihitung di
 * dalam desa itu. Jadi daftarnya dipersempit dulu ke desa asal titik (`village`),
 * baru `idx` dipakai. Kalau kantongnya TERPOTONG di server (total > rows), daftar
 * per desa bisa tidak lengkap dan urutannya bergeser — pemetaannya ditolak (null),
 * bukan ditebak.
 *
 * Lapisan KTP menggambar SEMUA orang di kantong; lapisan Servis hanya yang punya
 * servis; Kirim hanya yang punya pengiriman. Jadi daftarnya disaring dulu dengan
 * aturan yang sama sebelum `idx` dipakai — kalau tidak, titik Servis ke-2 akan
 * menunjuk orang ke-2 di daftar LENGKAP, yang belum tentu punya servis sama sekali.
 *
 * Mengembalikan null kalau jumlahnya tidak cocok. Itu bukan kelalaian: titik lahir
 * dari source_overlap sedangkan daftar dari customer_fusion, dan walau keduanya
 * ditulis perhitungan yang sama, menebak saat keduanya menyimpang berarti menampilkan
 * nama orang yang SALAH — jauh lebih buruk daripada tidak menampilkan nama.
 *
 * Murni: diekspor supaya bisa diuji tanpa peta maupun jaringan.
 */
export function orangDiTitik(kantong, jenis, idx, village) {
  if (!kantong || !Array.isArray(kantong.rows)) return null;
  if (kantong.total > kantong.rows.length) return null;
  const saring = jenis === 'servis' ? ((r) => Number(r.serviceCount) > 0)
    : jenis === 'kirim' ? ((r) => Number(r.deliveryCount) > 0)
      : (() => true);
  const cocok = kantong.rows.filter((r) => r.villageCode === village && saring(r));
  const n = Number(idx);
  if (!Number.isInteger(n) || n < 0 || n >= cocok.length) return null;
  return cocok[n];
}

/** Satu baris "punya / tidak punya" untuk ketiga sumber. */
function barisSumber(ada, label, nilai) {
  const warna = ada ? 'color:#0f172a' : 'color:#94a3b8';
  const tanda = ada ? '&check;' : '&times;';
  return `<div class="flex items-center gap-2 text-[11px]" style="${warna}">` +
    `<span style="width:12px;display:inline-block;text-align:center">${tanda}</span>` +
    `<span class="flex-1">${esc(label)}</span>` +
    `<span class="mono font-bold">${esc(nilai)}</span></div>`;
}

/** Kartu PUTIH satu orang. Semua nilai dari PII — WAJIB lewat esc(). */
function tampilkanKartuOrang(jenis, orang, event) {
  const tip = $('tooltip');
  if (!tip) return;
  const golongan = SEGMENTS[orang.segment];
  const servis = Number(orang.serviceCount) || 0;
  const kirim = Number(orang.deliveryCount) || 0;

  setTooltipJenis(tip, 'orang');
  tip.innerHTML =
    `<div class="font-extrabold text-[13px] leading-tight">${
      esc(orang.name || 'Nama tidak ada di data KTP')}</div>` +
    `<div class="text-[11px] font-bold" style="color:${
      golongan ? golongan.color : '#64748b'}">${
      esc(golongan ? golongan.label : orang.segment || '—')}</div>` +
    `<div class="text-[10px] mono text-slate-500 mt-0.5">${esc(orang.engineNo || '—')}</div>` +
    `<div class="mt-2 pt-2 border-t border-slate-200 space-y-0.5">` +
      barisSumber(true, 'Data KTP', 'ada') +
      barisSumber(servis > 0, 'Servis', servis ? `${servis}x` : 'tidak ada') +
      barisSumber(kirim > 0, 'Pengiriman', kirim ? `${kirim}x` : 'tidak ada') +
    `</div>` +
    `<div class="text-[10px] text-slate-400 mt-2 pt-2 border-t border-slate-200 leading-snug">` +
      `Titik ${esc(LABEL_TITIK[jenis] || '')} · posisi acak di dalam desa asalnya, bukan ` +
      `alamat sebenarnya.<br><span class="font-bold text-slate-600">Klik</span> untuk ` +
      `riwayat lengkapnya.</div>`;
  tip.classList.add('show');
  moveTooltip(event);
}


let pewaktuKartu = null;
let kunciKartuTerakhir = null;

/**
 * Identitas satu TITIK: jenis + kelurahan + dealer + nomor urutnya.
 *
 * Dipakai untuk tahu apakah kursor masih di atas titik yang SAMA. Beda dari versi
 * sebelumnya yang cuma sampai kantong (jenis|kelurahan|dealer): sekarang tiap titik
 * menampilkan ORANG yang berbeda, jadi pindah satu titik ke tetangganya di kelurahan
 * yang sama pun harus mengganti kartunya.
 *
 * Murni dan diekspor supaya aturannya bisa diuji tanpa peta sungguhan.
 */
export function kunciBucket(props, jenis) {
  const p = props || {};
  return [jenis || '', p.village || '', p.dealer || '', p.idx == null ? '' : p.idx].join('|');
}

function batalkanKartuTitik() {
  if (pewaktuKartu) clearTimeout(pewaktuKartu);
  pewaktuKartu = null;
  kunciKartuTerakhir = null;
}

/**
 * Hover satu titik: tooltip kelurahan dulu, kartu orang menyusul.
 *
 * DUA TINGKAT, dan jedanya yang membuat ini mungkin sama sekali:
 *   segera       -> tooltip BIRU berisi ringkasan kelurahan. Gratis, seluruh isinya
 *                   sudah ada di browser, jadi tidak apa-apa kalau menyala ratusan
 *                   kali saat kursor menyapu peta.
 *   sesudah 350ms -> kartu PUTIH berisi ORANG di titik itu. Ini memanggil rute PII.
 *
 * Tanpa jeda itu, menyeret kursor melintasi 30 kelurahan menembakkan 30 permintaan
 * PII dan langsung menghabiskan piiLimiter (30/menit) — fiturnya mematikan dirinya
 * sendiri dalam satu gerakan. 350 ms tidak terasa sebagai menunggu bagi orang yang
 * memang sedang menunjuk satu titik, tapi cukup untuk menyaring lewatan.
 *
 * Hasil per kantong di-cache, jadi titik ke-2 sampai ke-40 di kelurahan yang sama
 * muncul seketika tanpa permintaan baru.
 */
function hoverTitik(jenis, props, event) {
  tampilkanTooltipTitikFusi(jenis, props, event);

  const kunci = kunciBucket(props, jenis);
  if (kunci === kunciKartuTerakhir) return;
  batalkanKartuTitik();
  kunciKartuTerakhir = kunci;

  const { village, district, dealer, idx } = props || {};
  if (!village || !district) return;
  const periode = fusionFilterPeta().periode;

  pewaktuKartu = setTimeout(() => {
    pewaktuKartu = null;
    ambilKantong(district, dealer, periode).then((kantong) => {
      // Kursor sudah pindah sebelum jawabannya datang: jangan menimpa apa pun.
      if (kunciKartuTerakhir !== kunci) return;
      const orang = orangDiTitik(kantong, jenis, idx, village);
      // Tidak ketemu -> tooltip kelurahan yang biru DIBIARKAN. Itu keadaan antara yang
      // jujur: "belum bisa menunjuk satu orang", bukan kartu kosong yang terlihat
      // seperti kerusakan.
      if (orang) tampilkanKartuOrang(jenis, orang, event);
    }).catch(() => { /* tooltip biru tetap tampil; galat PII tidak dibuat ribut di peta */ });
  }, TUNDA_KARTU_MS);
}

/**
 * Klik satu titik: buka panel Telusur berisi riwayat LENGKAP orang itu.
 *
 * Lewat `window`, bukan import langsung: fusion.js sudah meng-import berkas ini, jadi
 * meng-import baliknya membuat lingkaran modul. Pola yang sama dipakai
 * window.openDealerDetail di filter-bar.js dan outlets.js.
 */
function bukaRiwayatDariTitik(jenis, props) {
  const { village, district, dealer, idx } = props || {};
  if (!village || !district) return;
  const periode = fusionFilterPeta().periode;
  ambilKantong(district, dealer, periode).then((kantong) => {
    const orang = orangDiTitik(kantong, jenis, idx, village);
    if (orang && orang.engineNo && window.bukaTelusurMesinDari) {
      window.bukaTelusurMesinDari(orang.engineNo);
    } else if (window.bukaDaftarTitik) {
      // Titiknya tidak bisa dipetakan ke satu orang — buka daftar sekantongnya supaya
      // orangnya tetap bisa dicari sendiri, bukan kliknya tidak melakukan apa-apa.
      window.bukaDaftarTitik(jenis, district, dealer || null);
    }
  }).catch(() => { /* panel tidak dibuka; pesannya sudah muncul di panel telusur */ });
}

function bangunTitikFusi(jenis) {
  const data = S.fusionPoints;
  if (!data || !S.villageGeo) return EMPTY_COLLECTION;
  if (data.cache[jenis]) return data.cache[jenis];

  // Disebar di poligon DESA, bukan kecamatan (keputusan user 2026-10-10): sebarannya
  // lebih aktual. Kecamatannya ikut dibawa tiap titik untuk tooltip dan kantong PII.
  if (!data.cincin) data.cincin = cincinPerDesa(S.villageGeo);
  const kecamatanDesa = {};
  data.rows.forEach((r) => { kecamatanDesa[r.villageCode] = r.districtCode; });
  const perDesa = titikPerDesa(data.rows, jenis);
  const rand = pembangkitAcak(BENIH_TITIK[jenis]);
  const features = [];

  Object.keys(perDesa).forEach((kode) => {
    const ring = data.cincin[kode];
    if (!ring) return;
    perDesa[kode].forEach((bagian) => {
      // `idx` = nomor urut titik ini DI DALAM kantongnya (kelurahan+dealer+jenis),
      // 0..n-1. Inilah yang membuat tiap titik bisa menunjuk SATU orang tanpa satu
      // pun nomor mesin ikut di muatan peta: panelnya mengambil daftar kantong lewat
      // rute PII yang sudah berpagar, lalu menampilkan baris ke-idx. Tiga titik di
      // satu desa jadi tiga orang berbeda (permintaan tim 2026-09-20).
      //
      // Urutannya harus STABIL antara titik dan daftar. Titik digambar dari
      // source_overlap (`bagian.n`), daftarnya dari customer_fusion — dua tabel yang
      // ditulis perhitungan yang SAMA, jadi jumlahnya cocok. Kalau suatu saat tidak
      // cocok, pemetaannya ditolak dengan jujur (lihat orangDiTitik() di bawah):
      // menampilkan nama yang SALAH jauh lebih buruk daripada tidak menampilkan nama.
      sebarDiPoligon(ring, bagian.n, rand).forEach((koordinat, idx) => {
        features.push({
          type: 'Feature',
          properties: {
            warna: dealerColor(S.registry, bagian.dealer),
            dealer: bagian.dealer,
            village: kode,
            district: kecamatanDesa[kode] || '',
            idx,
          },
          geometry: { type: 'Point', coordinates: koordinat },
        });
      });
    });
  });

  data.cache[jenis] = { type: 'FeatureCollection', features };
  return data.cache[jenis];
}

/** Toggle tiga titik sumber. Memuat data saat pertama dibutuhkan. */
export function toggleFusionPoints() {
  redrawMap();
}

/* --- meminjamkan peta ke halaman Confidence Fusion ---------------------------
   SATU instance peta, dipindah-pindah — bukan dua. `S.map` global dan hampir
   seluruh modul peta bergantung padanya; instance kedua berarti dua sumber
   kebenaran untuk lapisan, sorotan, dan lingkup yang sama.

   Panel Opsi Peta tidak ikut pindah karena ia SAUDARA #map di dalam #map-shell,
   bukan anaknya — jadi "hanya peta" di halaman Fusion didapat tanpa menyembunyikan
   apa pun secara khusus. */

/** Pindahkan elemen peta ke slot di halaman Fusion. Aman dipanggil berulang. */
export function pinjamPetaKeFusion() {
  const peta = $('map');
  const slot = $('fx-peta-host');
  if (!peta || !slot || peta.parentElement === slot) return;

  // Layar penuh memakai aturan `#map-shell.penuh #map`; begitu #map keluar dari
  // #map-shell, aturan itu tidak berlaku lagi dan petanya akan tampak rusak.
  // Jadi keluar dari layar penuh dulu, bukan membiarkannya setengah jalan.
  if (S.fullscreen) toggleFullscreen(false);

  slot.appendChild(peta);
  peta.classList.add('di-fusion');
  if (S.map) { setTimeout(() => S.map.resize(), 60); setTimeout(() => S.map.resize(), 400); }
}

/** Kembalikan elemen peta ke #map-shell sebagai anak pertama. Aman dipanggil berulang. */
export function kembalikanPeta() {
  const peta = $('map');
  const shell = $('map-shell');
  if (!peta || !shell || peta.parentElement === shell) return;

  shell.prepend(peta);
  peta.classList.remove('di-fusion');
  if (S.map) { setTimeout(() => S.map.resize(), 60); setTimeout(() => S.map.resize(), 400); }
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

export const districtsLoaded = () => kecamatanSiap;

/**
 * Pasang lapisan kecamatan di atas isian warnanya (kec-warna, di addLayers()).
 *
 * Sejak 2026-10-10 TIDAK lagi dimuat malas lewat toggle: kecamatan jadi satuan
 * analisis, jadi berkasnya (S.geo) dimuat di boot. Berkasnya juga tinggal 0,6 MB,
 * bukan 3 MB, sejak 29.823 lubang sliver ditutup di view district_shapes.
 */
function addDistrictLayers() {
  if (kecamatanSiap) return;

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
    paint: { 'line-color': '#ffffff', 'line-width': 0.9, 'line-opacity': 0.8 },
  });
  // Kecamatan KOSONG (nol penjualan pada filter aktif) tidak berisi warna dan garisnya
  // ABU-ABU, bukan putih (2026-10-11). Lapisan tersendiri di atas kec-garis, bukan
  // warna garis berbasis feature-state di kec-garis: tepi yang dipakai bersama dua
  // kecamatan digambar dua kali, dan putih milik tetangga yang berisi akan menimpa abu-
  // abu kalau lapisannya sama. `kosong` diisi paintChoropleth().
  S.map.addLayer({
    id: 'kec-garis-kosong', type: 'line', source: 'kec',
    paint: {
      'line-color': '#94a3b8', 'line-width': 1,
      'line-opacity': ['case', ['boolean', ['feature-state', 'kosong'], false], 1, 0],
    },
  });
  S.map.addLayer({
    id: 'kec-terpilih', type: 'line', source: 'kec',
    filter: ['==', ['get', 'kode'], ''],
    paint: { 'line-color': '#0b2f6b', 'line-width': 2.5 },
  });
  S.map.addLayer({
    id: 'kec-nama', type: 'symbol', source: 'kec', minzoom: 8.5,
    layout: {
      'text-field': ['get', 'nama'], 'text-font': ['Noto Sans Regular'],
      'text-size': 11, 'text-allow-overlap': false,
    },
    paint: { 'text-color': '#1e293b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
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
/** Warna tiap jenis Kec. Tercover pos — sama dengan COVERAGE_COLORS di rings.js. */
const COVERAGE_WARNA = { 1: '#0891b2', 2: '#ca8a04' };
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
  // Mode edit hidup/mati mengubah apakah garis kecamatan di luar yang terkait ditampilkan.
  terapkanBatasKecamatan();

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
  if (!S.geo || lat == null || lng == null) return null;
  for (const f of S.geo.features) {
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
function setGroupView(mode, value, tombolIds) {
  const sama = S.ringView && S.ringView.mode === mode && S.ringView.value === value;
  S.ringView = sama ? { mode: null, value: null } : { mode, value };

  tombolIds.forEach((id) => {
    const tombol = $(id);
    if (!tombol) return;
    const aktif = !sama && tombolMatches(id, S.ringView.value);
    tombol.classList.remove('bg-white', 'text-slate-800', 'shadow-sm', 'text-slate-500');
    tombol.classList.add(...(aktif ? ['bg-white', 'text-slate-800', 'shadow-sm'] : ['text-slate-500']));
  });

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
    ['cv-lokasi', 'cv-1', 'cv-2']);
}

/**
 * Tampilkan blok KONTEKSTUAL "Ring Dealer" / "Kec. Tercover" di tengah atas peta
 * (2026-10-11, permintaan tim; dulu dua bagian di dalam Opsi Peta yang cuma diredupkan).
 *
 * - Ring Dealer muncul HANYA kalau tepat satu dealer dipilih (klik di peta maupun filter).
 * - Kec. Tercover muncul HANYA kalau tepat satu pos dipilih.
 * - Keduanya hilang waktu pilihannya dibatalkan, dan tidak pernah tampil bersamaan.
 *
 * "Tepat satu" selalu benar, karena filter hanya memegang satu dealer dan satu pos.
 * Yang perlu dijaga: memilih pos ikut mengisi dealernya (filter berjenjang), jadi POS
 * MENANG — saat pos terpilih yang tampil Kec. Tercover pos itu, bukan Ring Dealer
 * milik dealernya. Dipanggil dari filters.js tiap scope berubah dan dari redrawMap().
 *
 * Sorotan yang menggantung (grup yang sedang disorot tapi blok-nya sudah hilang) ikut
 * dimatikan: highlight tanpa kontrol yang menjelaskannya cuma membingungkan.
 */
export function syncGroupControls() {
  const posAktif = scopeValue('pos') !== 'ALL';
  const dealerAktif = scopeValue('dealer') !== 'ALL' && !posAktif;

  const ringBlok = $('blok-ring-dealer');
  const coverBlok = $('blok-kec-tercover');
  if (ringBlok) ringBlok.classList.toggle('hidden', !dealerAktif);
  if (coverBlok) coverBlok.classList.toggle('hidden', !posAktif);

  const sebelum = S.ringView.mode;
  if (S.ringView.mode === 'dealer-ring' && !dealerAktif) S.ringView = { mode: null, value: null };
  if (S.ringView.mode === 'pos-coverage' && !posAktif) S.ringView = { mode: null, value: null };
  // Gaya tombol ikut dibersihkan waktu sorotan dimatikan lewat jalur ini (setGroupView()
  // hanya memperbarui gayanya waktu tombolnya sendiri diklik).
  if (sebelum && !S.ringView.mode) {
    ['rv-lokasi', 'rv-1', 'rv-2', 'rv-3', 'cv-lokasi', 'cv-1', 'cv-2'].forEach((id) => {
      const tombol = $(id);
      if (!tombol) return;
      tombol.classList.remove('bg-white', 'text-slate-800', 'shadow-sm');
      tombol.classList.add('text-slate-500');
    });
  }
  paintGroupView();
}
/**
 * Warnai KECAMATAN (satuan analisis sejak 2026-10-10; sebelumnya kelurahan) menurut
 * Kontribusi Penjualan (% terhadap total KOTANYA SENDIRI), bukan unit mentah — sejak
 * 2026-08-30. Wilayah kecil yang justru dominan di kotanya sendiri terlihat gelap,
 * bukan tenggelam di bawah wilayah bervolume besar dari kota lain.
 *
 * Kelasnya selalu PERSENTIL dari sebaran yang sedang tampil (status kelompok relatif).
 * Yang berbeda hanya nilai yang dipersentilkan, lihat `pakaiUnit`. Mode "Per Nilai
 * Kontribusi" (interval tetap) dihapus 2026-10-11.
 *
 * Kecamatan tanpa nilai (nol penjualan pada filter aktif) TIDAK berisi warna dan garisnya
 * abu-abu: ditandai lewat feature-state `kosong` (lapisan kec-garis-kosong).
 */
export function paintChoropleth(rows) {
  // UNIT MUTLAK, bukan kontribusi % terhadap kota, dipakai kalau:
  //
  // 1. Filter DEALER/POS aktif (perbaikan 2026-09-20, dilaporkan tim). Kontribusi %
  //    membagi dengan total kota DARI BARIS YANG SUDAH TERSARING: satu dealer dengan 1
  //    unit di kota yang — bagi dealer itu — juga cuma 1 unit menghasilkan 100%, jadi
  //    kecamatan dengan penjualan PALING SEDIKIT justru tampil paling gelap.
  // 2. Filter KOTA/KARESIDENAN aktif (2026-10-11). Keduanya kini memilih KUMPULAN DEALER,
  //    jadi baris yang lolos berisi penjualan dealer-dealer itu di kota pelanggan mana
  //    pun — cacat yang sama seperti butir 1.
  // 3. Saklar "Status Kelompok Relatif" dimatikan (S.statusRelatif === false): pengguna
  //    meminta jumlah unit, bukan kontribusi.
  //
  // Tanpa semuanya, kontribusi % TETAP dipakai — keputusan sengaja 2026-08-30 supaya
  // kecamatan kecil yang dominan di kotanya tidak tenggelam.
  const pakaiUnit = S.statusRelatif === false
    || scopeValue('dealer') !== 'ALL' || scopeValue('pos') !== 'ALL'
    || scopeValue('kota') !== 'ALL' || pageFilters().kares !== 'ALL';

  const kontribusi = pakaiUnit
    ? unitsForRows(rows, S.districtByCode)
    : contributionsForRows(rows, S.districtByCode);
  const perDistrict = Object.fromEntries(kontribusi);
  const breaks = percentileBreaks([...kontribusi.values()]);

  S.geo.features.forEach((f) => {
    const value = kontribusi.get(f.properties.kode);
    const cls = value != null ? classOf(value, breaks) : -1;
    const warna = cls < 0 ? COLOR_EMPTY : RAMP[cls];
    S.map.setFeatureState({ source: 'kec', id: f.properties.kode },
      { warna, kosong: cls < 0 });
  });

  kecTerkait = hasScopeFilter() ? hitungKecamatanTerkait([...kontribusi.keys()]) : null;
  terapkanBatasKecamatan();

  // `satuan` ikut dikembalikan supaya legenda MENYEBUT apa yang sedang diukur. Tanpa
  // itu, angka yang sama ("12") berarti "12% kontribusi" di satu keadaan dan "12 unit"
  // di keadaan lain, di kotak legenda yang bentuknya persis sama.
  return { perDistrict, breaks, satuan: pakaiUnit ? 'unit' : 'persen' };
}

/**
 * Kecamatan yang "terkait" dengan filter ruang lingkup terakhir, atau null kalau tidak ada
 * filter (semua kecamatan bergaris). Diisi paintChoropleth(), dibaca terapkanBatasKecamatan().
 * @type {Set<string>|null}
 */
let kecTerkait = null;

/**
 * Kecamatan yang terkait dengan filter aktif: yang BERPENJUALAN pada filter itu (yang
 * diwarnai), kecamatan tempat dealer terdaftar dan ring 1-3 dealernya, Kec. Tercover pos
 * terpilih, dan kecamatan tempat titik dealer/pos terpilih sungguh berada. Hitungannya
 * murni di relatedDistricts() (sales-stats.js); di sini hanya bahan-bahannya dikumpulkan.
 *
 * districtAt() dipakai HANYA untuk satu dealer / satu pos terpilih: dia memindai seluruh
 * poligon, dan memanggilnya untuk semua dealer di tiap renderAll() terlalu mahal.
 */
function hitungKecamatanTerkait(salesDistricts) {
  const focus = focusDealerSet();
  const dealerCodes = focus ? [...focus] : [];
  const posKode = scopeValue('pos');
  const dealerHome = {};
  S.dealers.forEach((d) => { if (d.districtCode) dealerHome[d.code] = d.districtCode; });

  const extra = [];
  if (dealerCodes.length === 1) {
    const dealer = S.dealerByCode[dealerCodes[0]] || {};
    extra.push(districtAt(dealer.lat, dealer.lng));
  }
  if (posKode !== 'ALL') {
    const outlet = S.outletByCode[posKode] || {};
    extra.push(districtAt(outlet.lat, outlet.lng));
  }
  return relatedDistricts({
    salesDistricts, dealerCodes, dealerHome, dealerRings: S.dealerRings,
    posCoverage: S.posCoverage, outletCodes: posKode !== 'ALL' ? [posKode] : [], extra,
  });
}

/**
 * Sembunyikan garis dan nama kecamatan yang TIDAK terkait filter (2026-10-11): ketiga
 * lapisan memakai filter `kode IN terkait`, jadi fiturnya benar-benar tidak digambar (juga
 * tidak ikut berebut tempat label). Tanpa filter ruang lingkup, filternya dilepas.
 *
 * Selagi mode EDIT ring/Kec. Tercover aktif semuanya ditampilkan lagi: orang perlu
 * melihat dan mengklik kecamatan di luar yang terkait untuk memasukkannya ke ring.
 * Dipanggil paintChoropleth() dan setGroupPaint() (yang jalan tiap mode edit hidup/mati).
 */
function terapkanBatasKecamatan() {
  if (!kecamatanSiap) return;
  const menyunting = Boolean(window.anyGroupEditing && window.anyGroupEditing());
  let filter = null;
  if (kecTerkait && !menyunting) {
    // `in` dengan daftar kosong tidak sah di ekspresi; kosong = tidak ada yang cocok.
    filter = kecTerkait.size
      ? ['in', ['get', 'kode'], ['literal', [...kecTerkait]]]
      : ['==', ['get', 'kode'], ''];
  }
  ['kec-garis', 'kec-garis-kosong', 'kec-nama'].forEach((id) => {
    if (S.map.getLayer(id)) S.map.setFilter(id, filter);
  });
}

/** Saklar "Status Kelompok Relatif" di Opsi Peta (nyala bawaan). Mati = peta dalam unit. */
export function setStatusRelatif() {
  const kotak = $('opt-status-relatif');
  S.statusRelatif = kotak ? kotak.checked : true;
  window.renderAll();
}

/**
 * Buka/tutup panel Opsi Peta lewat tombol "Set Tampilan Peta" di pojok kanan atas.
 * Tersembunyi bawaan (2026-10-11): panelnya menutupi peta, dan sebagian besar sesi tidak
 * menyentuh opsinya sama sekali.
 */
export function toggleOpsiPeta() {
  const panel = $('opsi-peta-panel');
  const tombol = $('btn-opsi-peta');
  if (!panel) return;
  const terbuka = panel.classList.toggle('hidden') === false;
  if (tombol) {
    tombol.setAttribute('aria-expanded', String(terbuka));
    tombol.classList.toggle('bg-slate-100', terbuka);
  }
}
/**
 * Bagian VISUAL peta saja: warna heatmap, titik, dan marker — tanpa satu pun panel.
 *
 * Dipisah dari renderAll() (app.js) karena renderAll() berhenti di baris pertama waktu
 * `S.filterPage !== 'peta'`. Penjaga itu benar dan tidak dibuang: renderAll() juga
 * mengisi treemap, panel performa, panel wilayah, dan kartu dealer yang hanya ada di
 * halaman Peta. Akibat sampingannya, peta yang sedang menumpang di halaman Confidence
 * Fusion tidak pernah ikut berganti waktu filternya berpindah — termasuk tiap langkah
 * mode LIVE, yang justru seluruh gunanya memperlihatkan wilayah berganti-ganti.
 *
 * Legendanya SENGAJA tidak digambar di sini. `#legend` adalah SAUDARA `#map` di dalam
 * `#map-shell`, bukan anaknya, jadi ia tidak ikut pindah ke halaman Fusion dan tidak
 * terlihat di sana. Nilainya dikembalikan supaya renderAll() yang menggambarnya —
 * dengan begitu map.js tidak perlu meng-import render.js, dan lingkaran modul
 * map -> render -> tables -> map tidak pernah terbentuk.
 *
 * @returns {{perDistrict: Object, breaks: Array, satuan: string}|null} null kalau
 *   lapisan belum siap
 */
export function refreshMapVisual() {
  if (!S.layersReady) return null;

  const rows = activeRows();
  // `satuan` ikut diteruskan. Sampai 2026-10-10 baris ini membuangnya, jadi legenda
  // selalu jatuh ke bawaannya dan tidak pernah berkata "unit" waktu filter dealer/pos
  // aktif — padahal paintChoropleth() sudah menghitungnya.
  const { perDistrict, breaks, satuan } = paintChoropleth(rows);
  drawMarkers();
  drawDealerMarkers();
  redrawMap();
  return { perDistrict, breaks, satuan };
}

export function redrawMap() {
  if (!S.layersReady) return;
  const on = (id) => ($(id) ? $(id).checked : false);

  // "Batas dan Nama Desa" — satu toggle, dua lapisan. Mati bawaan sejak 2026-10-10:
  // desa tinggal referensi orientasi, bukan satuan analisis.
  const tampilKel = on('opt-kelurahan');
  S.map.setLayoutProperty('kel-garis', 'visibility', tampilKel ? 'visible' : 'none');
  S.map.setLayoutProperty('kel-nama', 'visibility', tampilKel ? 'visible' : 'none');

  // "Batas dan Nama Kota" — satu toggle, batas + label kota sekaligus.
  const tampilKota = on('opt-kota');
  S.map.setLayoutProperty('kota-garis', 'visibility', tampilKota ? 'visible' : 'none');
  S.map.setLayoutProperty('kota-nama', 'visibility', tampilKota ? 'visible' : 'none');

  // "Batas dan Nama Kecamatan" — garis + label, nyala bawaan. Isian warnanya
  // (kec-warna) SELALU tampil karena itu heatmapnya. kec-isi (sorotan ring dealer/
  // coverage pos) diatur TERPISAH oleh setGroupPaint()/paintGroupView() di bawah.
  if (kecamatanSiap) {
    const tampilKec = on('opt-kecamatan');
    ['kec-garis', 'kec-garis-kosong', 'kec-nama'].forEach((id) => {
      if (S.map.getLayer(id)) {
        S.map.setLayoutProperty(id, 'visibility', tampilKec ? 'visible' : 'none');
      }
    });
  }

  // Blok kontekstual Ring Dealer / Kec. Tercover + sorotannya ikut ruang lingkup —
  // dipanggil di sini supaya ganti dealer/pos otomatis menampilkan/menyembunyikan
  // bloknya tanpa perlu klik ulang.
  syncGroupControls();
  // Tiga titik penyatuan sumber. Datanya diambil sekali, lalu dipakai ulang; kalau
  // saringannya sudah berganti, diambil lagi. Pengambilannya asinkron dan memanggil
  // redrawMap() lagi setelah selesai — jadi di lintasan INI layernya cukup dibiarkan
  // memakai data lama, bukan dikosongkan (mengosongkannya bikin titik berkedip).
  const jenisAktif = Object.keys(LAYER_TITIK).filter((j) => on(`opt-titik-${j}`));
  if (jenisAktif.length) {
    const basi = !S.fusionPoints || S.fusionPoints.tanda !== tandaSaringPeta();
    if (basi && !S.fusionPointsLoading) muatTitikFusi();
  }
  Object.keys(LAYER_TITIK).forEach((jenis) => {
    const tampil = on(`opt-titik-${jenis}`);
    if (tampil && S.fusionPoints) {
      S.map.getSource(jenis).setData(bangunTitikFusi(jenis));
    }
    S.map.setLayoutProperty(LAYER_TITIK[jenis], 'visibility', tampil ? 'visible' : 'none');
  });

  // Di atas citra satelit, isian pekat menutupi apa pun yang membuat satelit berguna.
  const satellite = S.basemap === 'satelit';
  S.map.setPaintProperty('kec-warna', 'fill-opacity', satellite ? 0.5 : 0.85);
  S.map.setPaintProperty('kec-nama', 'text-color', satellite ? '#ffffff' : '#1e293b');
  S.map.setPaintProperty('kec-nama', 'text-halo-color', satellite ? '#000000' : '#ffffff');
  S.map.setPaintProperty('kel-garis', 'line-opacity', satellite ? 0.35 : 0.5);
  S.map.setPaintProperty('kel-nama', 'text-color', satellite ? '#e2e8f0' : '#475569');
  S.map.setPaintProperty('kel-nama', 'text-halo-color', satellite ? '#000000' : '#ffffff');

  // "Titik Dealer" dan "Titik Pos" — dua sakelar terpisah sejak 2026-08-31 (permintaan
  // Pakbos; sebelumnya satu sakelar untuk keduanya).
  const showPos = on('opt-titik-pos');
  S.markers.forEach((m) => { m.getElement().style.display = showPos ? '' : 'none'; });
  const showDealer = on('opt-titik-dealer');
  S.dealerMarkers.forEach((m) => { m.getElement().style.display = showDealer ? '' : 'none'; });
}

/* ==========================================================================
   GEOMETRI TITIK
   ==========================================================================
   Lapisan "Titik Penjualan" (satu titik acak per unit terjual, dibangkitkan di peta)
   DIHAPUS 2026-10-11 atas permintaan tim: titik KTP (default nyala) sudah menampilkan
   sebaran pelanggan berwarna dealer, dan keduanya saling menumpuk. Yang tersisa di sini
   hanya uji titik-dalam-poligon, dipakai districtAt() di bawah.
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

// Sama seperti moveFilterBar() di atas: tombol dipindah, bukan dicerminkan.
// Di mode biasa dia HARUS balik ke #map-top-buttons (itu tombol MASUK layar
// penuh) — kalau tidak dipindah balik, tombol masuk layar penuh hilang dari
// tampilan biasa.
function moveExitButton() {
  const btn = $('btn-penuh');
  const host = S.fullscreen ? $('fs-exit-host') : $('map-top-buttons');
  if (btn && host && btn.parentElement !== host) host.appendChild(btn);
}

export function toggleFullscreen(force) {
  S.fullscreen = force === undefined ? !S.fullscreen : Boolean(force);
  moveExitButton();
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
 * Kalau satu pos dipilih, yang dipas-kan adalah pos itu beserta seluruh kecamatan yang
 * dilayaninya, pos saudara sedealernya, dan titik dealernya — sekali klik langsung
 * kelihatan seberapa jauh pelanggannya menyebar, dan itu justru pertanyaan pokoknya. Zoom
 * ke titik posnya saja malah membuang yang di luar radius keluar layar.
 *
 * @param {boolean} [auto] Sejak 2026-09-14: `true` waktu dipanggil OTOMATIS sesudah
 *   aksi yang mengubah tampilan peta (renderAll(), openDistrictDetail() — lihat
 *   pemanggilnya), BUKAN dari tombol Fit manual. Bedanya dua hal: animasi SENGAJA
 *   dibuat lebih pelan (900ms vs 700ms manual — permintaan eksplisit user, versi
 *   pertama 400ms dianggap "terlalu cepat" untuk dinikmati), dan toast "tidak ada
 *   data" DILEWATI (kalau tidak, kombinasi filter yang kebetulan kosong akan
 *   menoast di SETIAP render otomatis, bukan cuma sekali waktu ditekan manual).
 */
export function fitToScope(auto) {
  const points = [];
  const perDistrict = sumBy(activeRows(), 'district');
  Object.keys(perDistrict).forEach((code) => {
    const district = S.districtByCode[code];
    if (district && district.lat != null) points.push([district.lng, district.lat]);
  });

  // Titik yang DIGAMBAR karena filter — pos dan titik dealer dari focusDealerSet() (dealer
  // terpilih, dealer pemilik pos terpilih, atau dealer terdaftar di Kec/Kota/Kares) — ikut
  // dipas-kan, supaya letak dealernya sendiri terlihat bersama sebaran pelanggannya. Waktu
  // SATU pos dipilih, pos saudaranya dan titik dealernya juga ikut (2026-10-11): ketiganya
  // memang ditampilkan, dan peta yang hanya mendekat ke satu pos menyembunyikannya di luar
  // layar. Tanpa filter ruang lingkup (focus null) tidak ada titik tambahan.
  const focus = focusDealerSet();
  if (focus) {
    S.outlets.forEach((o) => {
      if (o.lat != null && focus.has(o.dealerCode)) points.push([o.lng, o.lat]);
    });
    S.dealers.forEach((d) => {
      if (d.lat != null && focus.has(d.code)) points.push([d.lng, d.lat]);
    });
  }

  if (!points.length) {
    // Peta kosong yang di-zoom ke tempat entah di mana lebih membingungkan daripada
    // peta utuh.
    S.map.fitBounds(bbox(S.geo), { padding: S.fullscreen ? 90 : 40, duration: auto ? 900 : 700 });
    if (!auto) toast('Tidak ada data pada filter ini — peta dikembalikan ke seluruh wilayah');
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

  // Satu kecamatan saja menghasilkan kotak seluas nol dan fitBounds akan memperbesar
  // sampai maksimum. Diberi kelonggaran ~2,5 km supaya tetap ada konteks.
  const minSpan = 0.022;
  if (maxX - minX < minSpan) { const c = (maxX + minX) / 2; minX = c - minSpan / 2; maxX = c + minSpan / 2; }
  if (maxY - minY < minSpan) { const c = (maxY + minY) / 2; minY = c - minSpan / 2; maxY = c + minSpan / 2; }

  // Peta layar penuh sekarang kotak tersendiri di grid (bukan lagi peta penuh
  // layar dengan panel melayang di atasnya, lihat komentar #map-shell.penuh di
  // index.html) — jarak "mekanisme fit" cukup angka tetap seperti sebelumnya,
  // panel kiri/kanan/atas/bawah sudah otomatis tidak menutupi kotak peta lagi.
  S.map.fitBounds([[minX, minY], [maxX, maxY]],
    { padding: S.fullscreen ? 90 : 50, duration: auto ? 900 : 700, maxZoom: 13 });
}

