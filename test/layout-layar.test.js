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
// Semua aturan dengan selector PERSIS itu, digabung (satu selector bisa punya beberapa aturan).
const rule = (selector) => {
  const parts = [];
  for (let at = css.indexOf(selector + ' {'); at >= 0; at = css.indexOf(selector + ' {', at + 1)) {
    const before = css[at - 1];
    if (before && !/\s/.test(before)) continue; // bagian dari selector yang lebih panjang
    parts.push(css.slice(at, css.indexOf('}', at)));
  }
  assert.ok(parts.length, `aturan CSS tidak ada: ${selector}`);
  return parts.join('\n');
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

// 4. Panel kiri layar penuh hanya summary Kab./Kec.: tanpa panel, kolom kiri dibuang.
assert.match(rule('#map-shell.penuh #fs-kiri-panel'), /display:\s*none/, 'panel performa masih di kolom kiri');
assert.match(rule('#map-shell.penuh:not(.panel-terbuka)'), /grid-template-columns:\s*1fr;/,
  'kolom kiri tetap dicadangkan tanpa panel');
assert.doesNotMatch(rule('#map-shell.penuh:not(.panel-terbuka)'), /left/);
assert.doesNotMatch(rule('#map-shell.penuh:not(.panel-terbuka):has(#fs-kartu.hidden)'), /left|bottom/);

// 5. Tombol Kembali: teks, di LUAR bilah filter (sesudah penutup #filter-bar), latar putih.
const bar = html.indexOf('id="filter-bar"');
const kembali = html.indexOf('id="btn-undo"');
const penutupBar = html.indexOf('<span class="text-[10px]">Reset</span></button>\n  </div>', bar);
assert.ok(bar > 0 && penutupBar > 0 && kembali > penutupBar, 'tombol Kembali masih di dalam bilah filter');
assert.match(html.slice(kembali, html.indexOf('</button>', kembali)), />Kembali$/, 'tombol undo bukan tulisan "Kembali"');
assert.match(rule('.btn-kembali'), /background:\s*#fff/, 'tombol Kembali tidak berlatar putih');

console.log('OK layout-layar — kartu performa selebar baris, baris bawah layar penuh tidak dicadangkan, bilah filter di atas kontrol peta');
