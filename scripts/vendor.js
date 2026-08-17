/**
 * Salin library dari node_modules ke frontend/vendor: `npm run vendor`
 *
 * Dijalankan otomatis sesudah `npm install` lewat postinstall, jadi pindah server
 * tetap cuma "salin folder -> npm install -> npm start".
 *
 * Kenapa tidak pakai CDN sama sekali: jaringan kantor bisa memblokirnya, dan
 * dashboard yang mati karena unpkg tidak terjangkau adalah kegagalan yang tidak bisa
 * diperbaiki siapa pun di tim itu. Versinya juga jadi terkunci di package.json —
 * halaman tidak akan berubah sendiri karena ada library yang merilis versi baru.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODULES = path.join(ROOT, 'node_modules');
const VENDOR = path.join(ROOT, 'frontend', 'vendor');

/** [asal di node_modules, tujuan di frontend/vendor] */
const FILES = [
  ['maplibre-gl/dist/maplibre-gl.js', 'maplibre-gl.js'],
  ['maplibre-gl/dist/maplibre-gl.css', 'maplibre-gl.css'],
  ['pmtiles/dist/pmtiles.js', 'pmtiles.js'],
  ['apexcharts/dist/apexcharts.min.js', 'apexcharts.js'],
  ['apexcharts/dist/apexcharts.css', 'apexcharts.css'],
  ['protomaps-themes-base/dist/protomaps-themes-base.js', 'protomaps-themes-base.js'],
];

/**
 * Font ikon Phosphor. Hanya gaya `regular` dan `fill` yang dipakai halaman; menyalin
 * keenam gayanya menambah ~1,5 MB yang tidak pernah diminta browser.
 */
const ICON_STYLES = ['regular', 'fill'];

/** Berat font yang benar-benar dipakai. Sisanya tidak ikut. */
const FONTS = [
  ['@fontsource/manrope', 'manrope', [400, 500, 600, 700, 800]],
  ['@fontsource/jetbrains-mono', 'jetbrains-mono', [400, 500, 600, 700]],
];

/**
 * Glyph label peta. Satu-satunya aset yang tidak datang dari npm.
 *
 * MapLibre mengambil berkas ini saat merender label kelurahan. Aslinya menunjuk ke
 * demotiles.maplibre.org — permintaan keluar yang tidak akan terlihat sebagai error
 * kalau diblokir: petanya tetap tampil, labelnya saja yang hilang.
 *
 * Cuma satu fontstack karena cuma satu yang dipakai (lihat 'text-font' di
 * index.html), dan tiga rentang: latin dasar, latin diperluas, dan tanda baca umum.
 */
const GLYPH_FONT = 'Noto Sans Regular';
const GLYPH_RANGES = ['0-255', '256-511', '8192-8447'];
const GLYPH_ORIGIN = 'https://demotiles.maplibre.org/font';

async function fetchGlyphs() {
  const dir = path.join(VENDOR, 'glyphs', GLYPH_FONT);
  fs.mkdirSync(dir, { recursive: true });
  let downloaded = 0;
  let bytes = 0;

  for (const range of GLYPH_RANGES) {
    const target = path.join(dir, range + '.pbf');
    if (fs.existsSync(target) && fs.statSync(target).size > 0) {
      bytes += fs.statSync(target).size;
      continue;                                  // sudah ada, jangan unduh lagi
    }
    const url = `${GLYPH_ORIGIN}/${encodeURIComponent(GLYPH_FONT)}/${range}.pbf`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} -> ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(target, data);
    downloaded++;
    bytes += data.length;
  }
  return { downloaded, bytes };
}

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return fs.statSync(to).size;
}

async function main() {
  fs.mkdirSync(VENDOR, { recursive: true });
  let total = 0;
  let count = 0;
  const missing = [];

  for (const [from, to] of FILES) {
    const source = path.join(MODULES, from);
    if (!fs.existsSync(source)) { missing.push(from); continue; }
    total += copy(source, path.join(VENDOR, to));
    count++;
  }

  // --- ikon ---
  const iconCss = [];
  for (const style of ICON_STYLES) {
    const dir = path.join(MODULES, '@phosphor-icons/web/src', style);
    if (!fs.existsSync(dir)) { missing.push(`@phosphor-icons/web/src/${style}`); continue; }
    total += copy(path.join(dir, 'Phosphor' + (style === 'regular' ? '' : '-Fill') + '.woff2'),
      path.join(VENDOR, 'icons', `${style}.woff2`));
    // CSS bawaannya menunjuk ./Phosphor.woff2 dan teman-temannya; di sini semuanya
    // diratakan jadi satu berkas per gaya, jadi url()-nya ikut disesuaikan.
    iconCss.push(fs.readFileSync(path.join(dir, 'style.css'), 'utf8')
      .replace(/url\([^)]*\)\s*format\([^)]*\)(,\s*)?/g, '')
      .replace(/src:\s*;/g, `src: url("./icons/${style}.woff2") format("woff2");`));
    count++;
  }
  if (iconCss.length) {
    fs.writeFileSync(path.join(VENDOR, 'phosphor.css'), iconCss.join('\n'));
  }

  // --- font huruf ---
  const fontCss = [];
  for (const [pkg, family, weights] of FONTS) {
    const dir = path.join(MODULES, pkg);
    if (!fs.existsSync(dir)) { missing.push(pkg); continue; }
    for (const weight of weights) {
      // fontsource menaruh woff2 di files/<family>-latin-<weight>-normal.woff2
      const file = `${family}-latin-${weight}-normal.woff2`;
      const source = path.join(dir, 'files', file);
      if (!fs.existsSync(source)) { missing.push(file); continue; }
      total += copy(source, path.join(VENDOR, 'fonts', file));
      count++;
      fontCss.push(
        `@font-face{font-family:'${family === 'manrope' ? 'Manrope' : 'JetBrains Mono'}';` +
        `font-style:normal;font-weight:${weight};font-display:swap;` +
        `src:url("./fonts/${file}") format("woff2")}`);
    }
  }
  if (fontCss.length) {
    fs.writeFileSync(path.join(VENDOR, 'fonts.css'), fontCss.join('\n') + '\n');
  }

  // --- glyph ---
  try {
    const glyphs = await fetchGlyphs();
    total += glyphs.bytes;
    count += GLYPH_RANGES.length;
    if (glyphs.downloaded) console.log(`glyph: ${glyphs.downloaded} berkas diunduh`);
  } catch (error) {
    console.error('\nGagal mengambil glyph label peta:', error.message);
    console.error('Butuh koneksi internet SEKALI saja, waktu memasang.');
    console.error('Tanpa berkas ini peta tetap tampil tapi nama kelurahan hilang.');
    console.error('Kalau memasang di mesin tanpa internet, salin folder');
    console.error('frontend/vendor/glyphs dari mesin yang sudah berhasil.\n');
    process.exit(1);
  }

  console.log(`vendor: ${count} berkas, ${(total / 1e6).toFixed(2)} MB -> frontend/vendor`);
  if (missing.length) {
    // Berkas yang hilang JANGAN diabaikan diam-diam: halaman akan tampil separuh jadi
    // dan penyebabnya tidak akan kelihatan di mana pun.
    console.error('\nTIDAK KETEMU di node_modules:');
    missing.forEach((name) => console.error('  - ' + name));
    console.error('\nJalankan `npm install` dulu. Kalau sudah dan tetap hilang,');
    console.error('berarti struktur paketnya berubah dan scripts/vendor.js perlu disesuaikan.\n');
    process.exit(1);
  }
}

main();
