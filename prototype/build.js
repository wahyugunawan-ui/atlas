/**
 * Bangun prototype/index.html: `node prototype/build.js`
 *
 * Menyatukan template, logika, batas kelurahan asli, dan data sintetis jadi SATU
 * berkas yang bisa dibuka dengan dobel-klik atau di-drag ke Netlify.
 *
 * index.html adalah hasil, bukan sumber. Jangan disunting tangan — 4 MB tidak bisa
 * disunting dengan waras, dan perubahannya akan hilang di build berikutnya.
 */
const fs = require('fs');
const path = require('path');
const { buildDataset, WORDS } = require('./src/data');
// Implementasinya milik aplikasi, bukan prototipe. Satu berkas, dua pemakai —
// kalau disalin, angka di proposal dan angka di aplikasi akan menyimpang diam-diam.
const { computeCoverage, splitByCoverage } = require('../backend/core/coverage');

const HERE = __dirname;
const PROJECT = path.join(HERE, '..');
const DATA = process.env.DATA_DIR || 'C:/astra-data';
const REFERENCE = path.join(PROJECT, '..', 'geo-kelurahan', 'output',
  'referensi_kelurahan.csv');

const PERIODS = ['2026-06', '2026-07', '2026-08'];

/**
 * Radius jangkauan yang dihitung.
 *
 * Beberapa nilai, bukan satu lalu diskalakan di browser — lihat coverage.js untuk
 * alasannya. Slider di Opsi Peta hanya bisa memilih salah satu dari daftar ini, jadi
 * setiap angka yang muncul di layar benar-benar dihitung.
 *
 * 5 km yang dipakai sebagai acuan; sisanya untuk menunjukkan pengaruh radius saat
 * presentasi.
 */
const RADII_M = [3000, 5000, 7000, 10000];
const RADIUS_M = 5000;

/** Presisi koordinat. 4 desimal ~11 meter — jauh lebih halus daripada yang bisa
 *  dilihat pada peta sepropinsi, dan memangkas ukuran berkas hampir separuh. */
const COORD_DIGITS = 4;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Susun kerangka prototipe dari halaman aplikasi yang sebenarnya.
 *
 * Dengan ini perubahan tata letak di frontend/index.html otomatis ikut terlihat pada
 * berkas demo. Logika dan datanya tetap milik prototype/src, jadi index.html hasil
 * build masih satu berkas, bisa dibuka lewat file://, dan tidak membawa data nyata.
 */
function currentAppTemplate() {
  const page = fs.readFileSync(path.join(PROJECT, 'frontend', 'index.html'), 'utf8');
  const cdn = `
  <!-- Prototipe sengaja memakai CDN agar tetap satu berkas yang mudah dibagikan. -->
  <script src="https://cdn.tailwindcss.com"><\/script>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">
  <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/fill/style.css">
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css">
  <script src="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/apexcharts@3.54.1"><\/script>`;
  const prototypeData = `
<script>
/* Batas kelurahan asli dan data demo sintetis; tidak ada data penjualan nyata. */
const GEO = /*__GEO__*/;
const DATA = /*__DATA__*/;
</script>
<script>
/*__APP__*/
</script>`;

  return page
    .replace(/\s*<link rel="stylesheet" href="\/vendor\/[^\n]+\n/g, '\n')
    .replace(/\s*<link rel="stylesheet" href="\/css\/app\.css">\n/g, '\n')
    .replace(/\s*<script defer src="\/vendor\/[^\n]+\n/g, '\n')
    .replace(/\s*<script type="module" src="\/js\/app\.js"><\/script>\n/g, '\n')
    // Loader aplikasi menunggu API. Prototipe tidak punya API, jadi tidak dipakai.
    .replace(/\n<div id="pageLoader"[\s\S]*?<\/div>\n\n<nav id="topnav"/, '\n<nav id="topnav"')
    // Tombol keluar tidak relevan pada demo statis dan akan mengarah ke URL file://.
    .replace(/\s*<form method="post" action="\/logout"[\s\S]*?<\/form>/,
      '\n    <div class="bg-white\/10 rounded-xl px-3 py-2 text-[11px] text-white\/80">Prototipe demo</div>')
    .replace('</head>', cdn + '\n</head>')
    .replace('</body>', prototypeData + '\n</body>');
}

/** Titik tengah poligon, cukup untuk menempatkan label dan menghitung jarak. */
function centroid(geometry) {
  let sumLng = 0;
  let sumLat = 0;
  let count = 0;
  const walk = (coords, depth) => {
    if (depth === 0) { sumLng += coords[0]; sumLat += coords[1]; count++; return; }
    coords.forEach((c) => walk(c, depth - 1));
  };
  walk(geometry.coordinates, geometry.type === 'Polygon' ? 2 : 3);
  return count ? [sumLng / count, sumLat / count] : [0, 0];
}

/** Bulatkan seluruh koordinat di tempat. */
function roundCoords(node, digits) {
  if (typeof node[0] === 'number') {
    node[0] = Number(node[0].toFixed(digits));
    node[1] = Number(node[1].toFixed(digits));
    if (node.length > 2) node.length = 2;
    return;
  }
  node.forEach((child) => roundCoords(child, digits));
}

function main() {
  console.log('membaca sumber...');

  // --- batas kelurahan ---
  const geo = readJson(path.join(DATA, 'geo', 'kelurahan.geojson'));

  // --- kecamatan, dari referensi BPS ---
  //
  // Ini yang selama ini hilang: geojson tidak punya field kecamatan sama sekali, dan
  // tabel Master Kelurahan menampilkan nama_kota di bawah judul "Kecamatan".
  const districts = {};
  fs.readFileSync(REFERENCE, 'utf8').trim().split('\n').slice(1).forEach((line) => {
    const p = line.split(',');
    districts[p[0]] = { districtCode: p[2], districtName: p[3] };
  });

  const villages = [];
  geo.features.forEach((f) => {
    const p = f.properties;
    const [lng, lat] = centroid(f.geometry);
    const d = districts[p.kode] || {};
    const village = {
      kode: p.kode,
      nama: p.nama,
      kode_kota: p.kode_kota,
      nama_kota: p.nama_kota,
      kode_kecamatan: d.districtCode || '',
      nama_kecamatan: d.districtName || '',
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
    };
    villages.push(village);

    // Properti fitur dipangkas ke yang benar-benar dipakai peta. Sisanya cuma
    // menambah ukuran berkas.
    f.properties = { kode: p.kode, nama: p.nama, kode_kota: p.kode_kota };
    roundCoords(f.geometry.coordinates, COORD_DIGITS);
  });

  const missingDistrict = villages.filter((v) => !v.nama_kecamatan).length;

  // --- outlet asli: nama dan koordinat ---
  const aggregate = readJson(path.join(DATA, 'geo', 'agregat.json'));
  const outlets = aggregate.dealer.map((d) => ({
    kode_pos: d.kode_pos,
    nama_pos: d.nama_pos,
    kode_dealer: d.kode_dealer,
    nama_dealer: d.nama_dealer,
    lat: d.lat,
    lng: d.lng,
  }));

  // Alamat outlet tidak ada di berkas mana pun yang bebas PII, jadi dikarang dari
  // kota terdekat. Untuk prototipe ini cukup — yang ditunjukkan bentuk kolomnya.
  outlets.forEach((o) => {
    if (o.lat == null) { o.alamat = 'Belum ada koordinat'; return; }
    let nearest = null;
    let best = Infinity;
    villages.forEach((v) => {
      const d = (v.lat - o.lat) ** 2 + (v.lng - o.lng) ** 2;
      if (d < best) { best = d; nearest = v; }
    });
    o.alamat = `Jl. Raya ${nearest.nama}, ${nearest.nama_kecamatan}, ${nearest.nama_kota}`;
    o.village = nearest.kode;
  });

  // --- batas kabupaten ---
  //
  // Diambil dari kota.geojson, yang sudah dihasilkan pipeline Python dengan dissolve
  // geometri sungguhan. Percobaan menyusunnya sendiri dari poligon kelurahan gagal:
  // poligonnya disederhanakan sendiri-sendiri, jadi dua kelurahan bertetangga tidak
  // berbagi titik yang persis sama, dan ratusan batas DALAM ikut lolos sebagai garis
  // merah di tengah wilayah.
  console.log('membaca batas kabupaten...');
  const cityLines = readJson(path.join(DATA, 'geo', 'kota.geojson'));
  cityLines.features.forEach((f) => {
    f.properties = { kode_kota: f.properties.kode_kota };
    roundCoords(f.geometry.coordinates, COORD_DIGITS);
  });

  // --- rasio jangkauan ---
  //
  // Fungsi utama produknya. Dihitung dari geografi dan koordinat outlet yang ASLI —
  // hanya angka penjualannya yang sintetis.
  console.log('menghitung rasio jangkauan (sampling)...');
  const { coverage, stats } = computeCoverage(geo, outlets, RADII_M);

  console.log('membangkitkan data sintetis...');
  const dataset = buildDataset(villages, outlets, PERIODS);

  const lastIndex = PERIODS.length - 1;
  const totalUnits = dataset.facts
    .filter((f) => f[0] === lastIndex)
    .reduce((s, f) => s + f[3], 0);

  // --- rakit ---
  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    periods: PERIODS,
    villages: villages,
    outlets: outlets,
    dealers: dataset.dealers,
    facts: dataset.facts,          // [periodeIndex, kelurahan, outlet, unit]
    cityLines: cityLines,          // batas kabupaten, dari pipeline Python
    words: WORDS,                  // bahan konsumen; dirakit di browser
    radiusM: RADIUS_M,
    radiiM: RADII_M,
    coverage: coverage,            // coverage[radius][kode_pos][kode_kelurahan] = rasio
  };

  const template = currentAppTemplate();
  const app = fs.readFileSync(path.join(HERE, 'src', 'app.js'), 'utf8');

  const html = template
    .replace('/*__GEO__*/', () => JSON.stringify(geo))
    .replace('/*__DATA__*/', () => JSON.stringify(payload))
    .replace('/*__APP__*/', () => app);

  const out = path.join(HERE, 'index.html');
  fs.writeFileSync(out, html);

  console.log('');
  console.log('  kelurahan        :', villages.length,
    missingDistrict ? `(${missingDistrict} tanpa kecamatan)` : '(kecamatan lengkap)');
  console.log('  outlet           :', outlets.length);
  console.log('  dealer           :', dataset.dealers.length, '- warna berbeda semua');
  console.log('  periode          :', PERIODS.join(', '));
  console.log('  baris fakta      :', dataset.facts.length);
  console.log('  unit', PERIODS[PERIODS.length - 1], ' :', totalUnits, '(SINTETIS, bukan data asli)');
  console.log('  konsumen         :', totalUnits, '(dirakit di browser, nama dikarang)');
  // Pemeriksaan kewarasan: kalau SEMUA pos 0% atau SEMUA 100%, hitungannya salah.
  // Itu gejala persis yang muncul di versi lama, dan tidak boleh lolos diam-diam.
  const lastPeriod = PERIODS.length - 1;
  const rows = dataset.facts.filter((f) => f[0] === lastPeriod)
    .map(([, village, outlet, units]) => ({ village, outlet, units }));
  const overall = splitByCoverage(rows, coverage[RADIUS_M]);

  const perOutlet = {};
  rows.forEach((r) => { (perOutlet[r.outlet] ||= []).push(r); });
  const shares = Object.keys(perOutlet).map((code) => {
    const s = splitByCoverage(perOutlet[code], coverage[RADIUS_M]);
    return { code, pct: s.total ? s.inside / s.total * 100 : 0, total: s.total };
  }).sort((a, b) => a.pct - b.pct);

  console.log('');
  console.log('  --- jangkauan', RADIUS_M / 1000, 'km ---');
  RADII_M.forEach((r) => {
    const bagi = splitByCoverage(rows, coverage[r]);
    console.log(`  ${String(r / 1000).padStart(2)} km: ` +
      `${stats.pairs[r]} pasangan, ${stats.villagesTouched[r]} kelurahan, ` +
      `${(bagi.inside / bagi.total * 100).toFixed(1)}% dalam jangkauan` +
      (r === RADIUS_M ? '   <- acuan' : ''));
  });
  if (stats.thinPolygons) {
    console.log('  poligon terlalu tipis untuk disampel penuh:', stats.thinPolygons);
  }
  console.log('  pos terendah      :', shares[0].code, shares[0].pct.toFixed(1) + '%');
  console.log('  pos tertinggi     :', shares[shares.length - 1].code,
    shares[shares.length - 1].pct.toFixed(1) + '%');
  if (shares[0].pct === shares[shares.length - 1].pct) {
    console.error('');
    console.error('  PERIKSA: semua pos punya persentase yang sama.');
    console.error('  Itu gejala hitungan yang tidak pernah jalan, bukan temuan.');
    console.error('');
  }
  console.log('');

  console.log('  ukuran berkas    :', (fs.statSync(out).size / 1e6).toFixed(2), 'MB');
  console.log('');
  console.log('  ->', out);
  console.log('  Buka dengan dobel-klik, atau seret berkas ini ke netlify.com/drop');
  console.log('');
}

main();
