/**
 * Peta: basemap, lapisan choropleth, batas kabupaten, radius, dan titik penjualan.
 */
import {
  ATTRIBUTION, ATTRIBUTION_SATELLITE, BASEMAP_PMTILES, BASEMAP_SATELLITE, KARESIDENAN,
} from './config.js';
import { classOf, dealerColor, percentileBreaks, RAMP, COLOR_EMPTY } from './colors.js';
import { $, bbox, displayCityName, esc, formatNumber, sumBy, toast } from './dom.js';
import { fetchGeo, fetchKpiJarak, fetchTitikPeta } from './api.js';
import { activeRows, fusionFilterPeta, pageFilters, scopeValue } from './filters.js';
import { circle, EMPTY_COLLECTION } from './geo.js';
import {
  cincinPerDesa, ikonKotak, pembangkitAcak, sebarDiPoligon, titikPerDesa,
} from './fusion-points.js';
import { fiturTelusur } from './fusion-alasan.js';
import { contributionsForRows, fixedContributionClass } from './sales-stats.js';
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
  const TITIK = [[6, 0.7], [10, 1], [14, 1.55]];
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

  /* ---- tiga lapisan titik penyatuan sumber (docs/FUSION.md 3.1) -------------
     MENYIMPANG DARI SPESIFIKASI, disengaja: spesifikasi meminta Servis berupa
     SYMBOL layer berbentuk kotak lewat map.addImage(). addImage() belum pernah
     dipakai sekali pun di proyek ini, dan ikonnya tidak bisa saya lihat hasilnya
     di browser — memperkenalkan API baru yang tidak terverifikasi demi bentuk
     kotak bukan pertukaran yang sepadan. Ketiganya circle layer, dibedakan lewat
     ISIAN dan OUTLINE:
       KTP    = isian warna dealer, tanpa outline   (menyatu dengan titik penjualan)
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
      const props = e.features[0].properties;
      tampilkanTooltipTitikFusi(jenis, props, e.originalEvent);
      jadwalkanDaftarTitik(jenis, props);
    });
    S.map.on('mouseleave', layerId, () => {
      S.map.getCanvas().style.cursor = '';
      $('tooltip').classList.remove('show');
      batalkanDaftarTitik();
    });
    // Klik = pemicu kedua, dan yang paling jelas disengaja. Pewaktunya dibatalkan
    // dulu supaya satu klik tidak berbuntut panggilan kedua tiga detik kemudian.
    S.map.on('click', layerId, (e) => {
      if (!e.features || !e.features.length) return;
      batalkanDaftarTitik();
      bukaDaftarTitikDariProps(jenis, e.features[0].properties);
    });
  });

  // Peta yang digeser/di-zoom membatalkan hitungan mundur: kursor yang kebetulan
  // berhenti di atas titik selama animasi bukan permintaan siapa pun, dan tiap
  // bukaan menembus pagar PII sekaligus menulis satu baris access_log.
  S.map.on('movestart', batalkanDaftarTitik);
  S.map.on('zoomstart', batalkanDaftarTitik);

  // Lingkaran radius KPI Jarak. Fill sangat tipis + garis putus-putus: ini alat ukur,
  // bukan data — tidak boleh menutupi wilayah di bawahnya.
  //
  // NAMANYA `kpi-jarak-*`. JANGAN diberi awalan "radius".
  //
  // test/page.test.js bagian 11 menjaga agar dua nama lapisan milik fitur lama
  // "Lingkaran Radius 3/5/7/10 km" (dibuang total 2026-08-31) tidak pernah muncul
  // lagi di berkas ini. Penjaganya mencocokkan POTONGAN TEKS pada seluruh isi
  // map.js — komentar pun ikut terbaca. Jadi menuliskan kedua nama lama itu di sini,
  // bahkan hanya untuk menjelaskan, sudah cukup untuk menyalakannya; itu persis yang
  // terjadi pada versi pertama komentar ini. KPI Jarak juga memang hal yang berbeda
  // dari radius jangkauan lama, jadi namanya tidak seharusnya mirip.
  S.map.addSource('kpi-jarak', { type: 'geojson', data: EMPTY_COLLECTION });
  S.map.addLayer({
    id: 'kpi-jarak-isi', type: 'fill', source: 'kpi-jarak',
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#0b2f6b', 'fill-opacity': 0.05 },
  });
  S.map.addLayer({
    id: 'kpi-jarak-garis', type: 'line', source: 'kpi-jarak',
    layout: { visibility: 'none' },
    paint: {
      'line-color': '#0b2f6b', 'line-width': 1.4, 'line-dasharray': [3, 2],
      'line-opacity': 0.8,
    },
  });

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
   TITIK KTP / SERVIS / PENGIRIMAN + RADIUS KPI
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
  return [f.periode, f.kota, f.dealer, f.pos].join('|');
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
 * Cari baris bucket (kelurahan, dealer) asal satu titik yang sedang di-hover.
 *
 * Satu FITUR titik TIDAK membawa hitungan ktp/servis/kirim-nya sendiri —
 * titikPerDesa() (fusion-points.js) mengempiskan satu bucket jadi satu angka `n`
 * untuk JENIS yang sedang diminta saja, membuang dua hitungan sisanya. Baris ASLI
 * (ketiga hitungan utuh) masih tersimpan apa adanya di S.fusionPoints.rows —
 * dicari ulang di sini lewat kode desa + kode dealer, TANPA permintaan baru ke
 * server sama sekali.
 *
 * Murni: diekspor supaya bisa diuji tanpa membuat instance peta sungguhan.
 *
 * @returns {Object|null} baris {villageCode, dealerCode, ktp, servis, kirim}, atau
 *   null kalau tidak ketemu (semestinya tidak pernah terjadi — titiknya sendiri
 *   lahir dari baris ini — tapi dijaga daripada melempar galat di tengah hover).
 */
export function carikanBagianTitikFusi(rows, village, dealer) {
  if (!Array.isArray(rows)) return null;
  return rows.find((r) => r.villageCode === village && r.dealerCode === dealer) || null;
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
  const { village, dealer } = properties || {};
  const desa = S.villageByCode[village];
  const namaDesa = desa ? desa.name : (village || '—');
  const namaKota = desa ? displayCityName(desa.cityName) : '';
  const namaDealer = S.dealerNames[dealer] || dealer || 'dealer tidak dikenal';
  const bagian = carikanBagianTitikFusi(
    (S.fusionPoints && S.fusionPoints.rows) || [], village, dealer);

  const baris = (label, n) => `<div class="text-[11px] text-slate-300 flex ` +
    `items-center justify-between gap-3"><span>${esc(label)}</span>` +
    `<span class="mono text-white font-bold">${esc(formatNumber(Number(n) || 0))}</span></div>`;

  tip.innerHTML =
    `<div class="font-bold text-white">${esc(LABEL_TITIK[jenis] || 'Titik')}</div>` +
    `<div class="text-[11px] text-slate-300 mt-0.5">${esc(namaDesa)}${
      namaKota ? `, ${esc(namaKota)}` : ''}</div>` +
    `<div class="text-[11px] text-slate-300">${esc(namaDealer)}</div>` +
    `<div class="mt-1.5 pt-1.5 border-t border-slate-600">` +
    baris('KTP', bagian ? bagian.ktp : 0) +
    baris('Servis', bagian ? bagian.servis : 0) +
    baris('Pengiriman', bagian ? bagian.kirim : 0) +
    `</div>` +
    `<div class="text-[10px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-600 ` +
    `leading-snug">Jumlah pelanggan di kelurahan ini, BUKAN satu orang — posisi titik ` +
    `acak di dalam kelurahan, bukan alamat sebenarnya.<br>` +
    `<span class="text-slate-300 font-bold">Klik</span> atau diam 3 detik untuk daftar ` +
    `pelanggannya.</div>`;
  tip.classList.add('show');
  moveTooltip(event);
}

/** Lama kursor harus DIAM di atas satu titik sebelum daftar pelanggannya diminta. */
const TUNDA_DAFTAR_TITIK_MS = 3000;

let pewaktuDaftarTitik = null;
let kunciDaftarTitik = null;

/**
 * Identitas satu kantong titik: jenis + kelurahan + dealer.
 *
 * Dipakai untuk tahu apakah kursor masih di atas kantong yang SAMA. Titik-titik satu
 * kantong digambar terpisah-pisah (satu fitur per pelanggan, disebar acak), jadi
 * bergeser satu piksel sering berarti pindah FITUR tapi tidak pindah kantong — dan
 * hitungan mundur tidak boleh mulai dari nol lagi setiap kali itu terjadi.
 *
 * Murni dan diekspor supaya aturan ini bisa diuji tanpa peta sungguhan.
 */
export function kunciBucket(props, jenis) {
  const p = props || {};
  return [jenis || '', p.village || '', p.dealer || ''].join('|');
}

/**
 * Mulai (atau lanjutkan) hitungan mundur 3 detik untuk satu kantong.
 *
 * Kantong yang sama: pewaktunya DIBIARKAN berjalan — kalau di-reset tiap mousemove,
 * kursor manusia yang tidak pernah benar-benar diam tidak akan pernah mencapai tiga
 * detik, dan pemicunya jadi fitur yang tidak pernah menyala.
 * Kantong berbeda: hitungan lama dibuang, mulai dari nol.
 */
function jadwalkanDaftarTitik(jenis, props) {
  const kunci = kunciBucket(props, jenis);
  if (kunci === kunciDaftarTitik && pewaktuDaftarTitik) return;

  batalkanDaftarTitik();
  kunciDaftarTitik = kunci;
  pewaktuDaftarTitik = setTimeout(() => {
    pewaktuDaftarTitik = null;
    bukaDaftarTitikDariProps(jenis, props);
  }, TUNDA_DAFTAR_TITIK_MS);
}

function batalkanDaftarTitik() {
  if (pewaktuDaftarTitik) clearTimeout(pewaktuDaftarTitik);
  pewaktuDaftarTitik = null;
  kunciDaftarTitik = null;
}

/**
 * Minta panel daftar pelanggan untuk satu kantong.
 *
 * Lewat `window`, bukan import langsung: fusion.js sudah meng-import berkas ini
 * (gambarTelusurDiPeta dkk), jadi meng-import baliknya membuat lingkaran modul. Pola
 * yang sama dipakai `window.openDealerDetail` di filter-bar.js dan outlets.js.
 */
function bukaDaftarTitikDariProps(jenis, props) {
  const p = props || {};
  if (!p.village || !window.bukaDaftarTitik) return;
  window.bukaDaftarTitik(jenis, p.village, p.dealer || null);
}

function bangunTitikFusi(jenis) {
  const data = S.fusionPoints;
  if (!data || !S.geo) return EMPTY_COLLECTION;
  if (data.cache[jenis]) return data.cache[jenis];

  if (!data.cincin) data.cincin = cincinPerDesa(S.geo);
  const perDesa = titikPerDesa(data.rows, jenis);
  const rand = pembangkitAcak(BENIH_TITIK[jenis]);
  const features = [];

  Object.keys(perDesa).forEach((kode) => {
    const ring = data.cincin[kode];
    if (!ring) return;
    perDesa[kode].forEach((bagian) => {
      sebarDiPoligon(ring, bagian.n, rand).forEach((koordinat) => {
        features.push({
          type: 'Feature',
          properties: {
            warna: dealerColor(S.registry, bagian.dealer),
            dealer: bagian.dealer,
            village: kode,
          },
          geometry: { type: 'Point', coordinates: koordinat },
        });
      });
    });
  });

  data.cache[jenis] = { type: 'FeatureCollection', features };
  return data.cache[jenis];
}

/**
 * Lingkaran radius KPI Jarak, dipusatkan di pos atau dealer yang sedang dipilih.
 *
 * Spesifikasi menggambarnya di sekitar titik KTP saat telusur satu Nomor Mesin.
 * Layar telusur itu SUDAH ada (panel `#telusur-panel`, fusion.js), tapi ia
 * menggambar lingkarannya sebagai diagram skematik di dalam panel — bukan di atas
 * peta ini. Menyambungkan keduanya berarti mengirim koordinat KTP satu mesin ke
 * lapisan peta, dan itu keputusan PII tersendiri yang belum diambil.
 *
 * Di peta, pusatnya karena itu tetap pos/dealer terpilih — pertanyaan yang bisa
 * dijawab tanpa PII sama sekali ("sejauh apa 50 km dari pos ini?"), bukan
 * lingkaran karangan di tengah peta.
 */
function bangunRadiusKpi() {
  if (!S.kpiRadiusM) return EMPTY_COLLECTION;

  const kodePos = scopeValue('pos');
  const kodeDealer = scopeValue('dealer');
  let titik = null;
  if (kodePos !== 'ALL') titik = S.outletByCode[kodePos];
  else if (kodeDealer !== 'ALL') titik = S.dealerByCode[kodeDealer];

  if (!titik || !Number.isFinite(titik.lat) || !Number.isFinite(titik.lng)) {
    return EMPTY_COLLECTION;
  }
  return {
    type: 'FeatureCollection',
    features: [circle(titik.lng, titik.lat, S.kpiRadiusM)],
  };
}

/** Toggle tiga titik dan radius KPI. Memuat data saat pertama dibutuhkan. */
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
 * @returns {{perVillage: Object, breaks: Array}|null} null kalau lapisan belum siap
 */
export function refreshMapVisual() {
  if (!S.layersReady) return null;

  const rows = activeRows();
  const { perVillage, breaks } = paintChoropleth(rows);
  drawMarkers();
  drawDealerMarkers();
  redrawMap();
  return { perVillage, breaks };
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

  // Radius KPI Jarak. Ambangnya diambil sekali dari server; sampai datang, lingkaran
  // tidak digambar sama sekali — lebih baik tidak ada daripada lingkaran berjari-jari
  // tebakan yang terlihat persis seperti yang sungguhan.
  const tampilRadius = on('opt-kpi-jarak');
  if (tampilRadius && S.kpiRadiusM == null && !S.kpiRadiusLoading) {
    S.kpiRadiusLoading = true;
    fetchKpiJarak()
      .then((k) => { S.kpiRadiusM = k.radiusM; })
      .catch(() => { S.kpiRadiusM = null; })
      .finally(() => { S.kpiRadiusLoading = false; redrawMap(); });
  }
  if (tampilRadius) S.map.getSource('kpi-jarak').setData(bangunRadiusKpi());
  ['kpi-jarak-isi', 'kpi-jarak-garis'].forEach((id) => {
    S.map.setLayoutProperty(id, 'visibility', tampilRadius ? 'visible' : 'none');
  });

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
 * Kalau satu pos dipilih, yang dipas-kan adalah pos itu beserta seluruh kelurahan yang
 * dilayaninya — sekali klik langsung kelihatan seberapa jauh pelanggannya menyebar, dan
 * itu justru pertanyaan pokoknya. Zoom ke titik posnya saja malah membuang yang di luar
 * radius keluar layar.
 *
 * @param {boolean} [auto] Sejak 2026-09-14: `true` waktu dipanggil OTOMATIS sesudah
 *   aksi yang mengubah tampilan peta (renderAll(), openVillageDetail() — lihat
 *   pemanggilnya), BUKAN dari tombol Fit manual. Bedanya dua hal: animasi SENGAJA
 *   dibuat lebih pelan (900ms vs 700ms manual — permintaan eksplisit user, versi
 *   pertama 400ms dianggap "terlalu cepat" untuk dinikmati), dan toast "tidak ada
 *   data" DILEWATI (kalau tidak, kombinasi filter yang kebetulan kosong akan
 *   menoast di SETIAP render otomatis, bukan cuma sekali waktu ditekan manual).
 */
export function fitToScope(auto) {
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

  // Satu kelurahan saja menghasilkan kotak seluas nol dan fitBounds akan memperbesar
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

