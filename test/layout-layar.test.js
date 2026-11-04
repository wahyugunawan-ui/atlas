/**
 * Tiga sifat tata letak yang pernah rusak (2026-11-04), dijaga lewat aturan CSS di
 * index.html — bukan lewat nama kelas Tailwind:
 *  1. Kartu Analisis Performa selebar baris, kecuali panel Statistik Ring (3 kolom di
 *     kanannya) sedang tampil.
 *  2. Layar penuh tanpa kartu dealer/pos: baris bawah grid dibuang, kartu ringkasan
 *     menempel sampai dasar panel kiri (bukan menyisakan 100px kosong).
 *  3. Bilah filter di layar penuh berada DI ATAS kontrol peta (#konteks-peta), supaya
 *     dropdown tidak tertutup popup Ring Dealer.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
const rule = (selector) => {
  const at = css.indexOf(selector + ' {');
  assert.ok(at >= 0, `aturan CSS tidak ada: ${selector}`);
  return css.slice(at, css.indexOf('}', at));
};

// 1. Kartu performa
assert.match(rule('#kartu-performa'), /grid-column:\s*1\s*\/\s*-1/, 'kartu performa tidak selebar baris');
assert.match(rule('#tab-peta .grid:has(#panel-ring-stats-group:not(.hidden)) #kartu-performa'),
  /grid-column:\s*span 7/, 'kartu performa tidak menyisakan 3 kolom saat Statistik Ring tampil');
assert.ok(/id="kartu-performa"/.test(html) && /id="panel-ring-stats-group"/.test(html));

// 2. Baris bawah layar penuh
const penuh = rule('#map-shell.penuh');
assert.doesNotMatch(penuh, /grid-template-rows:[^;]*\b100px\b/, 'baris 100px dicadangkan walau kartu dealer tersembunyi');
const tanpaKartu = rule('#map-shell.penuh:has(#fs-kartu.hidden)');
assert.match(tanpaKartu, /grid-template-rows:\s*auto 1fr auto;/);
assert.doesNotMatch(tanpaKartu.match(/grid-template-areas:[^;]*/)[0], /bottom/, 'area bottom masih ada tanpa kartu');
assert.match(rule('#map-shell.penuh #fs-kartu'), /height:\s*100px/, 'kartu dealer kehilangan tingginya');

// 3. Bilah filter di atas kontrol peta
const z = (selector) => Number((rule(selector).match(/z-index:\s*(\d+)/) || [])[1]);
assert.ok(z('#map-shell.penuh #fs-filter-host') > 30 &&
  /position:\s*relative/.test(rule('#map-shell.penuh #fs-filter-host')),
  'bilah filter layar penuh tidak di atas kontrol peta');
assert.match(html, /id="konteks-peta" class="absolute z-20/, 'z-index kontrol peta berubah: tinjau ulang tes ini');

console.log('OK layout-layar — kartu performa selebar baris, baris bawah layar penuh tidak dicadangkan, bilah filter di atas kontrol peta');
