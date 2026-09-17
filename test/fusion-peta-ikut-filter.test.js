/**
 * Peta HARUS ikut filter di halaman Confidence Fusion, bukan cuma di halaman Peta.
 *
 * KENAPA TES INI ADA. renderAll() (app.js) berhenti di baris pertama kalau
 * `S.filterPage !== 'peta'`, dan sampai 2026-09-17 dialah SATU-SATUNYA yang memanggil
 * paintChoropleth(), drawMarkers(), dan redrawMap(). Akibatnya peta yang menumpang di
 * halaman Confidence Fusion cuma bergeser dan membesar-mengecil lewat fitToScope();
 * warna heatmap, titik, dan markernya tetap memperlihatkan filter yang lama. Paling
 * kentara di mode LIVE — dropdownnya berganti kota tiap 3,5 detik sementara petanya
 * diam saja.
 *
 * Penjaga `S.filterPage !== 'peta'` itu TIDAK boleh sekadar dibuang: renderAll() juga
 * mengisi treemap, panel performa, panel wilayah, dan kartu dealer yang cuma ada di
 * halaman Peta. Jalan keluarnya memisahkan bagian visualnya jadi refreshMapVisual().
 *
 * KENAPA TESNYA MEMBACA SUMBER, BUKAN MENJALANKANNYA. Ketiga fungsi yang dijaga di
 * sini menyentuh MapLibre dan `S.map` — tidak ada satu pun yang bisa dijalankan tanpa
 * browser, dan menirukan seluruh MapLibre hanya akan menguji tiruan saya sendiri.
 * Yang dijaga karena itu SIFAT strukturalnya: bahwa panggilannya ada, bahwa isinya
 * tidak kosong, dan bahwa tidak ada dua salinan logika yang sama. Ketiganya cukup
 * untuk menangkap persis cacat yang melahirkan tes ini.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function sumber(nama) {
  const p = path.join(__dirname, '..', 'frontend', 'js', nama);
  // CRLF disamakan dulu: pencarian '\n}' di bawah bergantung pada akhiran baris.
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Badan satu fungsi TOP-LEVEL.
 *
 * Batas akhirnya '\n}' — kurung tutup fungsi top-level selalu di kolom nol, sedangkan
 * kurung di dalamnya selalu menjorok. Sengaja tidak memakai pencocokan kurung
 * berpasangan: berkas ini penuh template literal dan komentar, dan penghitung kurung
 * naif justru lebih mudah salah di situ daripada aturan kolom-nol yang sederhana ini.
 */
function badanFungsi(src, deklarasi, namaBerkas) {
  const mulai = src.indexOf(deklarasi);
  assert.notStrictEqual(mulai, -1, `"${deklarasi}" tidak ada lagi di ${namaBerkas}`);
  const akhir = src.indexOf('\n}', mulai);
  assert.notStrictEqual(akhir, -1, `kurung tutup "${deklarasi}" tidak ketemu di ${namaBerkas}`);
  return src.slice(mulai, akhir);
}

const map = sumber('map.js');
const fusion = sumber('fusion.js');
const app = sumber('app.js');

// 1. Fungsi bersamanya ada, dan diekspor supaya bisa dipakai modul lain.
assert.ok(/export function refreshMapVisual\s*\(/.test(map),
  'map.js tidak lagi mengekspor refreshMapVisual()');

// 2. Isinya benar-benar menyegarkan peta, bukan stub kosong.
//
// Tanpa pemeriksaan ini, mengosongkan badan fungsinya tetap hijau di semua tes lain —
// halamannya tidak error, petanya cuma diam. Justru gejala yang sama dengan bug asalnya.
const badanVisual = badanFungsi(map, 'export function refreshMapVisual(', 'map.js');
for (const wajib of ['paintChoropleth(', 'drawMarkers(', 'drawDealerMarkers(', 'redrawMap(']) {
  assert.ok(badanVisual.includes(wajib),
    `refreshMapVisual() tidak lagi memanggil ${wajib} — petanya jadi setengah disegarkan`);
}

// 3. Halaman Fusion memakainya. Inilah cacat aslinya.
assert.ok(/import\s*\{[^}]*\brefreshMapVisual\b[^}]*\}\s*from\s*'\.\/map\.js'/s.test(fusion),
  "fusion.js tidak lagi meng-import refreshMapVisual dari './map.js'");

const badanRenderFusion = badanFungsi(fusion, 'export async function renderFusion(', 'fusion.js');
assert.ok(badanRenderFusion.includes('refreshMapVisual('),
  'renderFusion() tidak memanggil refreshMapVisual() — peta di halaman Confidence ' +
  'Fusion berhenti mengikuti filter, termasuk tiap ketukan mode LIVE');

// 4. Mode LIVE ikut tertolong lewat jalur yang sama.
//
// langkahLive() sengaja TIDAK memanggil refreshMapVisual() sendiri — ia memanggil
// renderFusion(), dan renderFusion() yang menyegarkan peta. Kalau suatu saat rantai itu
// diputus, LIVE akan berhenti menyegarkan peta tanpa satu pun tes lain jadi merah.
const badanLangkahLive = badanFungsi(fusion, 'async function langkahLive(', 'fusion.js');
assert.ok(badanLangkahLive.includes('renderFusion('),
  'langkahLive() tidak lagi memanggil renderFusion(); rantai penyegar peta mode LIVE putus');

// 5. Penjaga halaman di renderAll() TETAP ADA.
//
// Membuangnya adalah "perbaikan" yang paling menggoda dan paling salah: renderAll()
// menyentuh $('btn-ring-peta'), $('mkel-pending'), treemap, dan panel performa —
// semuanya milik halaman Peta. Dipanggil dari halaman lain, ia akan melempar galat.
const badanRenderAll = badanFungsi(app, 'export function renderAll(', 'app.js');
assert.ok(badanRenderAll.includes("S.filterPage !== 'peta'"),
  'penjaga halaman di renderAll() hilang — fungsi ini tidak boleh jalan di luar halaman Peta');

// 6. SATU sumber kebenaran: renderAll() mendelegasikan, tidak menyalin ulang.
//
// Dua salinan akan berpisah diam-diam. Perbaikan di satu tempat tidak sampai ke tempat
// lain, dan gejalanya "peta benar di satu halaman, salah di halaman lain" — persis
// kelas bug yang baru saja diperbaiki.
assert.ok(badanRenderAll.includes('refreshMapVisual('),
  'renderAll() tidak memakai refreshMapVisual()');
for (const jangan of ['paintChoropleth(', 'drawMarkers(', 'drawDealerMarkers(']) {
  assert.ok(!badanRenderAll.includes(jangan),
    `renderAll() memanggil ${jangan} sendiri lagi — kembali jadi dua salinan logika ` +
    'yang sama, dan halaman Fusion akan tertinggal tiap kali salah satunya diubah');
}

console.log('OK fusion-peta-ikut-filter — refreshMapVisual() ada dan tidak kosong, ' +
  'dipakai renderFusion() (jadi mode LIVE ikut), penjaga halaman renderAll() utuh, ' +
  'dan tidak ada dua salinan logika penggambar peta');
