/**
 * Bangun satu berkas HTML yang berdiri sendiri: `npm run offline-html`
 *
 * Untuk dikirim ke rekan supaya dashboard tetap bisa dibuka waktu link Tailscale mati
 * atau tidak ada jaringan sama sekali. Dobel-klik, jalan. Tidak ada server, tidak ada
 * database, tidak ada login.
 *
 * BEDANYA DENGAN build.js DI SEBELAH. Yang itu dibuat untuk proposal 13 Agustus dan
 * ditujukan ke Netlify: dia menarik library dari CDN dan memakai implementasi terpisah
 * di prototype/src/ dengan angka karangan. Dua-duanya salah untuk keperluan ini —
 * CDN mati tanpa internet, dan implementasi paralel sudah menyimpang dari aplikasinya.
 *
 * Yang ini memakai MODUL FRONTEND YANG SUNGGUHAN. Tampilannya mirip bukan karena
 * ditiru, tapi karena memang kode yang sama.
 *
 * TIGA HAL YANG BERBEDA DARI APLIKASI, dan semuanya disengaja:
 *
 * 1. Nama dan alamat konsumen DIKARANG. Berkas ini berpindah tangan lewat WhatsApp
 *    atau email, tanpa login dan tanpa pembatas laju. 18 ribu nama asli di dalamnya
 *    risiko yang tidak sebanding dengan manfaat demonya. Angka penjualannya asli.
 * 2. Basemap peta jalan tidak ikut — berkas .pmtiles-nya 27 MB dan butuh range
 *    request yang tidak ada di file://. Latarnya polos, dan poligon kelurahan berwarna
 *    yang jadi isi petanya memang tetap utuh.
 * 3. Semua tombol yang MENULIS (impor, simpan pos, hapus periode, cocokkan nama)
 *    menolak dengan pesan yang jelas. Prototipe tidak punya tempat menyimpan.
 *
 * MODUL ES DIGABUNG JADI SATU SKRIP BIASA. Browser menolak `import` lewat file://
 * karena CORS, jadi berkas modul yang ditanam apa adanya akan menghasilkan halaman
 * kosong tanpa pesan yang bisa dimengerti.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const PROJECT = path.join(HERE, '..');
const FRONTEND = path.join(PROJECT, 'frontend');
const VENDOR = path.join(FRONTEND, 'vendor');

const { config } = require('../backend/server/config');
const store = require('../backend/server/db');
const repo = require('../backend/server/repository');

/** Berkas vendor yang benar-benar dipakai halaman, sesuai urutan di index.html. */
const VENDOR_CSS = ['fonts.css', 'phosphor.css', 'maplibre-gl.css', 'apexcharts.css'];
const VENDOR_JS = ['maplibre-gl.js', 'pmtiles.js', 'protomaps-themes-base.js',
  'apexcharts.js'];

const read = (p) => fs.readFileSync(p, 'utf8');

/**
 * Tanam berkas font dan ikon sebagai data URI ke dalam CSS-nya.
 *
 * Tanpa ini seluruh ikon jadi kotak kosong dan hurufnya mundur ke font bawaan sistem —
 * halaman masih terbaca, tapi tidak lagi terlihat seperti aplikasinya, dan itu justru
 * satu-satunya alasan berkas ini dibuat.
 */
function inlineAssets(css, baseDir) {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (whole, quote, url) => {
    if (/^(data:|https?:)/.test(url)) return whole;
    const file = path.join(baseDir, url.split('?')[0].split('#')[0]);
    if (!fs.existsSync(file)) return whole;
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf',
      svg: 'image/svg+xml', png: 'image/png' }[ext] || 'application/octet-stream';
    return `url(data:${mime};base64,${fs.readFileSync(file).toString('base64')})`;
  });
}

/* ==========================================================================
   MENGGABUNG MODUL
   ========================================================================== */

/** Nama yang diekspor satu modul. */
function exportsOf(code) {
  return [...code.matchAll(
    /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((m) => m[1]);
}

/** Berkas yang di-import satu modul. */
function importsOf(code) {
  return [...code.matchAll(/^import[\s\S]*?from\s*'\.\/([^']+)'/gm)].map((m) => m[1]);
}

/**
 * Bungkus satu modul jadi IIFE dengan lingkupnya sendiri.
 *
 * TIAP MODUL HARUS PUNYA LINGKUP SENDIRI, bukan digabung datar. Versi pertama
 * menggabung semuanya ke satu lingkup dan langsung menabrak bug yang gejalanya
 * menyesatkan: dom.js dan select-search.js sama-sama mengekspor `fillSelect`, dan yang
 * belakangan menimpa yang duluan. app.js memanggil nama yang benar, dapat fungsi yang
 * salah, lalu gagal dengan "Cannot set properties of undefined" — pesan yang menunjuk
 * ke dalam select-search padahal yang salah cara menggabungnya.
 *
 * Di modul ES nama yang sama di dua berkas memang sah. Bundler yang mengandalkan
 * "kebetulan tidak ada yang bentrok" akan gagal lagi begitu ada ekspor baru bernama
 * sama, dengan gejala yang sama sulitnya dilacak.
 */
function wrapModule(name, code) {
  const lines = code.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^import\s/.test(lines[i])) {
      let stmt = lines[i];
      while (i < lines.length && !/;\s*$/.test(lines[i])) { i++; stmt += '\n' + lines[i]; }
      const m = stmt.match(/^import\s*\{([\s\S]*?)\}\s*from\s*'\.\/([^']+)'/);
      if (!m) continue;
      if (/\bas\b/.test(m[1])) {
        throw new Error(name + ': import beralias belum didukung penggabung ini');
      }
      const nama = m[1].split(',').map((x) => x.trim()).filter(Boolean).join(', ');
      out.push('const { ' + nama + ' } = ' + moduleVar(m[2]) + ';');
      continue;
    }
    out.push(lines[i].replace(/^export\s+/, ''));
  }
  return 'const ' + moduleVar(name) + ' = (function () {\n' +
    out.join('\n') +
    '\nreturn { ' + exportsOf(code).join(', ') + ' };\n}());';
}

/** 'select-search.js' -> 'M$select_search' */
function moduleVar(name) {
  return 'M$' + name.replace(/\.js$/, '').replace(/[^A-Za-z0-9]/g, '_');
}

/**
 * Urutkan modul supaya yang dipakai selalu didefinisikan lebih dulu.
 *
 * Deklarasi `const` dan `let` tidak ter-hoist; modul yang digabung dengan urutan
 * asal-asalan akan gagal dengan "Cannot access before initialization" — dan pesan itu
 * menunjuk baris yang benar tapi sebab yang salah.
 */
function sortModules(sources) {
  const done = new Set();
  const order = [];
  const visit = (name, trail) => {
    if (done.has(name)) return;
    if (trail.includes(name)) {
      throw new Error(`Lingkaran import: ${trail.concat(name).join(' -> ')}`);
    }
    for (const dep of importsOf(sources[name])) {
      if (sources[dep]) visit(dep, trail.concat(name));
    }
    done.add(name);
    order.push(name);
  };
  Object.keys(sources).sort().forEach((n) => visit(n, []));
  return order;
}

module.exports = { inlineAssets, exportsOf, importsOf, wrapModule, moduleVar, sortModules,
  VENDOR_CSS, VENDOR_JS, HERE, PROJECT, FRONTEND, VENDOR, read, config, store, repo };

/* ==========================================================================
   PENGGANTI api.js
   ==========================================================================
   Nama ekspornya harus sama persis dengan api.js yang asli — modul lain memanggilnya
   apa adanya, dan satu nama yang meleset membuat seluruh halaman gagal dimuat.

   Konsumen DIBANGKITKAN SAAT JALAN dari baris penjualan yang sudah ditanam, bukan
   disimpan sebagai daftar tersendiri. Dua alasannya: berkasnya tidak bertambah 2 MB,
   dan jumlah konsumen per kelurahan otomatis sama dengan angka penjualannya — kalau
   ditanam terpisah, dua angka di layar bisa berbeda dan itu pertanyaan pertama yang
   akan diajukan orang saat demo.
   ========================================================================== */
const API_STUB = `
/* Tiap fungsi WAJIB diawali kata export. Penggabung membaca kata itu untuk menyusun
   objek yang dikembalikan modul; tanpa itu modul api mengembalikan {} dan seluruh
   pemanggilnya dapat undefined — halaman memuat tanpa error yang menyebut sebabnya,
   cuma KPI nol di mana-mana. */
const DEPAN = ['Budi', 'Siti', 'Agus', 'Dewi', 'Rizal', 'Ratna', 'Joko', 'Sari',
  'Bayu', 'Indah', 'Fajar', 'Wulan', 'Hendra', 'Nur', 'Eko', 'Lestari'];
const BELAKANG = ['Santoso', 'Wijaya', 'Pratama', 'Utami', 'Nugroho', 'Handayani',
  'Saputra', 'Rahayu', 'Kurniawan', 'Safitri'];
const JALAN = ['Melati', 'Kenanga', 'Anggrek', 'Cempaka', 'Mawar', 'Dahlia', 'Flamboyan'];

/* Berbenih tetap dari kodenya, jadi nama yang sama muncul lagi tiap halaman dibuka.
   Nama yang berubah tiap muat ulang akan terlihat seperti data yang tidak stabil. */
function benih(teks) {
  let h = 2166136261;
  for (let i = 0; i < teks.length; i++) { h ^= teks.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function konsumenSintetis(row, urutan) {
  const b = benih(row.village + row.outlet + urutan);
  return {
    id: row.period + '-' + row.village + '-' + urutan,
    period: row.period,
    village: row.village,
    outlet: row.outlet,
    name: DEPAN[b % DEPAN.length] + ' ' + BELAKANG[(b >>> 4) % BELAKANG.length],
    address: 'Jl. ' + JALAN[(b >>> 8) % JALAN.length] + ' No. ' + ((b >>> 12) % 180 + 1) +
      ' RT ' + String((b >>> 20) % 12 + 1).padStart(2, '0'),
    engine: null,
    photo: false,
  };
}

function semuaKonsumen(filterFn) {
  const out = [];
  for (const row of OFFLINE.summary.sales) {
    if (!filterFn(row)) continue;
    for (let i = 0; i < row.units; i++) out.push(konsumenSintetis(row, i));
  }
  return out;
}

const tolak = (apa) => Promise.reject(new Error(
  apa + ' tidak bisa dilakukan di berkas demo — ini salinan offline tanpa server. ' +
  'Pakai aplikasi yang sebenarnya untuk itu.'));

export const fetchSummary = () => Promise.resolve(OFFLINE.summary);
export const fetchPeriods = () => Promise.resolve({ periods: OFFLINE.periods });
export const fetchImports = () => Promise.resolve({ imports: OFFLINE.imports, running: false });
export const fetchUnmatched = (period) => Promise.resolve({
  unmatched: OFFLINE.unmatched.filter((u) => u.period === period) });
export const fetchAliases = () => Promise.resolve({ period: null, unmatched: [], aliases: [] });

export function fetchCustomers(villageCode, period) {
  return Promise.resolve({ customers: semuaKonsumen((r) =>
    r.village === villageCode && (!period || period === 'ALL' || r.period === period)) });
}

export function browseCustomers(filters) {
  const f = filters || {};
  const cocok = (r) => {
    if (f.period && f.period !== 'ALL' && r.period !== f.period) return false;
    if (f.village && f.village !== 'ALL' && r.village !== f.village) return false;
    if (f.outlet && f.outlet !== 'ALL' && r.outlet !== f.outlet) return false;
    if (f.outlets && f.outlets.length && !f.outlets.includes(r.outlet)) return false;
    if (f.city && f.city !== 'ALL' && !String(r.village).startsWith(f.city + '.')) return false;
    return true;
  };
  let rows = semuaKonsumen(cocok);
  if (f.query) {
    const q = String(f.query).toLowerCase();
    rows = rows.filter((c) => c.name.toLowerCase().includes(q) ||
      c.address.toLowerCase().includes(q));
  }
  const total = rows.length;
  const offset = Number(f.offset) || 0;
  return Promise.resolve({ rows: rows.slice(offset, offset + 500), total, limit: 500 });
}

export const fetchGeo = (name) => Promise.resolve(OFFLINE.geo[name]);

export const createOutlet = () => tolak('Menambah pos');
export const saveOutlet = () => tolak('Menyimpan perubahan pos');
export const saveAlias = () => tolak('Mencocokkan nama kelurahan');
export const deleteAlias = () => tolak('Membatalkan pencocokan');
export const deletePeriod = () => tolak('Menghapus periode');
export const uploadImport = () => tolak('Mengimpor berkas');
export const fetchDistricts = () => Promise.resolve({ districts: [] });
export const saveDealerRings = () => tolak('Menyimpan ring dealer');
export const savePosCoverage = () => tolak('Menyimpan coverage pos');
export const resetOutlets = () => tolak('Mengosongkan master pos dan dealer');
export const createDealer = () => tolak('Menambah dealer');
export const saveDealer = () => tolak('Menyimpan perubahan dealer');
export const deleteDealer = () => tolak('Menghapus dealer');
export const previewOutletImport = () => tolak('Mengimpor master pos');
export const commitOutletImport = () => tolak('Mengimpor master pos');
`;

/* ==========================================================================
   MERAKIT HALAMAN
   ========================================================================== */

async function main() {
  console.log('');
  console.log('  membaca data dari database...');
  await store.open(config);

  const summary = await repo.summary();
  summary.hasCustomers = true;          // tab konsumen tetap bisa didemokan
  const periods = await repo.periodSummary();
  const imports = await repo.imports(20);
  const unmatched = [];
  for (const p of summary.periods) {
    (await repo.unmatched(p)).forEach((u) => unmatched.push({ ...u, period: p }));
  }
  await store.close();

  const geoDir = path.join(config.dataDir, 'geo');
  const geo = {
    'kelurahan.geojson': JSON.parse(read(path.join(geoDir, 'kelurahan.geojson'))),
    'kota.geojson': JSON.parse(read(path.join(geoDir, 'kota.geojson'))),
  };

  console.log(`  ${summary.villages.length} kelurahan · ${summary.outlets.length} pos · ` +
    `${summary.sales.reduce((s, r) => s + r.units, 0)} unit`);

  // --- gabungkan modul frontend, api.js diganti ---
  const jsDir = path.join(FRONTEND, 'js');
  const sources = {};
  fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).forEach((f) => {
    sources[f] = read(path.join(jsDir, f));
  });

  // --- basemap peta jalan (.pmtiles, 27 MB) TIDAK ikut dalam berkas ini ---
  //
  // Ditukar di TEKS SUMBER map.js sebelum digabung, bukan ditambal lewat window
  // sesudah peta dibuat. Versi pertama menambal window.setBasemap sesudahnya, dan
  // itu terlambat: style AWAL MapLibre sudah memuat sumber vektor pmtiles://, dan
  // MapLibre menunggu sumber itu selesai sebelum menembakkan kejadian 'load'.
  // pmtiles.js mencoba mengambilnya, gagal karena tidak ada server, dan 'load' tidak
  // pernah tertembak — boot() diam-diam berhenti sebelum sempat memanggil renderAll().
  // KPI tetap 0 tanpa satu pun error di konsol.
  //
  // Sumber 'protomaps' diganti jadi geojson kosong: selesai seketika, tanpa jaringan.
  // Ditulis di sini, bukan di map.js produksi, supaya modul aslinya tidak perlu tahu
  // apa pun soal mode offline.
  if (!sources['map.js'].includes("protomaps: { type: 'vector', url: 'pmtiles://' + BASEMAP_PMTILES,")) {
    throw new Error('map.js sudah berubah — patch basemap offline perlu disesuaikan');
  }
  sources['map.js'] = sources['map.js'].replace(
    "protomaps: { type: 'vector', url: 'pmtiles://' + BASEMAP_PMTILES,\n          attribution: ATTRIBUTION },",
    "protomaps: { type: 'geojson',\n          data: { type: 'FeatureCollection', features: [] } },");

  const asli = sources['api.js'];
  sources['api.js'] = API_STUB;
  const order = sortModules(sources);
  // Nama ekspor api.js yang asli harus semuanya tersedia di penggantinya. Satu yang
  // meleset membuat modul lain memanggil sesuatu yang tidak ada, dan halamannya mati
  // total dengan satu baris di konsol yang tidak menyebut sebabnya.
  // Dicocokkan dengan includes(), BUKAN regex. Versi pertama memakai
  // new RegExp(`\b${n}\b`) di dalam template literal — dan di situ \b bukan batas
  // kata melainkan karakter BACKSPACE. Regexnya jadi [BS]fetchSummary[BS] yang tidak
  // akan pernah cocok, lalu melaporkan ke-14 nama sebagai hilang padahal semuanya ada.
  const kurang = exportsOf(asli).filter((n) => !API_STUB.includes(n));
  if (kurang.length) throw new Error(`Pengganti api.js kurang: ${kurang.join(', ')}`);

  const bundle = order.map((name) =>
    `/* ---- ${name} ---- */\n${wrapModule(name, sources[name])}`).join('\n\n');

  // --- CSS dan JS vendor ---
  const css = [read(path.join(FRONTEND, 'css', 'app.css'))]
    .concat(VENDOR_CSS.map((f) => inlineAssets(read(path.join(VENDOR, f)), VENDOR)))
    .join('\n');
  const vendorJs = VENDOR_JS.map((f) => read(path.join(VENDOR, f))).join('\n;\n');

  // --- kerangka dari halaman aplikasi yang sebenarnya ---
  let page = read(path.join(FRONTEND, 'index.html'))
    .replace(/\s*<link rel="stylesheet" href="\/vendor\/[^\n]*\n/g, '\n')
    .replace(/\s*<link rel="stylesheet" href="\/css\/app\.css">\n/g, '\n')
    .replace(/\s*<script defer src="\/vendor\/[^\n]*\n/g, '\n')
    .replace(/\s*<script type="module" src="\/js\/app\.js"><\/script>\n/g, '\n')
    // Tombol keluar mengarah ke /logout yang tidak ada di file://.
    .replace(/<form method="post" action="\/logout"[\s\S]*?<\/form>/,
      '<div class="bg-white/10 rounded-xl px-3 py-2 text-[11px] text-white/80">Salinan offline</div>');

  const tanda = `
<div style="position:fixed;left:12px;bottom:12px;z-index:999;background:rgba(11,47,107,.92);
     color:#fff;border-radius:10px;padding:7px 11px;font-size:11px;line-height:1.45;
     max-width:280px;box-shadow:0 6px 20px rgba(0,0,0,.25)">
  <b>Salinan offline</b> &mdash; angka penjualan asli, nama konsumen dikarang.
  Tanpa peta jalan dan tanpa tombol simpan.
</div>`;

  const isi = `
<style>${css}</style>
<script>${vendorJs}<\/script>
<script>window.OFFLINE = ${JSON.stringify({ summary, periods, imports, unmatched, geo })};<\/script>
<script>
(function () {
${bundle}
// Basemap peta jalan tidak ikut dalam berkas ini, jadi langsung ke latar polos.
// Tanpa ini MapLibre menunggu sumber pmtiles yang tidak pernah datang, dan yang
// terlihat cuma abu-abu kosong tanpa penjelasan.
// Basemap peta jalan (.pmtiles, 27 MB) TIDAK ikut dalam berkas ini. Ditukar SEBELUM
// setupMap() membuat peta, bukan sesudahnya.
//
// Versi pertama menambal window.setBasemap SESUDAH peta dibuat, dan itu terlambat:
// style awal MapLibre sudah memuat sumber pmtiles://.../cakupan.pmtiles, dan
// MapLibre MENUNGGU sumber itu selesai sebelum menembakkan kejadian 'load'.
// pmtiles.js mencoba mengambilnya, gagal karena tidak ada server, dan 'load' tidak
// pernah tertembak — bukan error yang terlihat, cuma boot() yang diam-diam berhenti
// sebelum sempat memanggil renderAll(). KPI tetap 0 tanpa satu pun pesan.
//
// Diganti dengan menimpa config.js SEBELUM modul map.js membacanya: BASEMAP_PMTILES
// jadi data URI GeoJSON kosong, sumber protomaps jadi 'geojson' bukan 'vector', dan
// itu selesai seketika tanpa jaringan sama sekali.
window.__OFFLINE_EMPTY_PMTILES__ = 'data:application/json,' +
  encodeURIComponent(JSON.stringify({ type: 'FeatureCollection', features: [] }));
}());
<\/script>${tanda}`;

  page = page.replace('</body>', `${isi}\n</body>`);

  const out = path.join(HERE, 'astra-offline.html');
  fs.writeFileSync(out, page);

  const mb = (fs.statSync(out).size / 1048576).toFixed(1);
  console.log('');
  console.log(`  berkas   : ${out}`);
  console.log(`  ukuran   : ${mb} MB`);
  console.log(`  modul    : ${order.length} digabung jadi satu skrip biasa`);
  console.log('');
  console.log('  Dobel-klik untuk membuka. Tidak butuh internet, server, maupun login.');
  console.log('');
}

if (require.main === module) {
  main().catch((e) => { console.error('\n  GAGAL:', e.message, '\n'); process.exit(1); });
}
