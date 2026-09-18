/**
 * Kelas penempatan yang dipakai markup HARUS ada di CSS yang benar-benar disajikan.
 *
 * KENAPA TES INI ADA — ini bukan tes hipotetis, ini rekaman kejadian nyata 2026-09-18.
 * `frontend/css/app.css` adalah HASIL BANGUN (`npm run css`) dan sengaja di luar git.
 * Setelah `frontend/index.html` ditulis ulang dengan tata letak grid baru, berkas itu
 * TIDAK dibangun ulang. Enam kelas — col-span-5, col-span-4, col-start-10, row-span-4,
 * row-start-7, grid-rows-2 — tidak ada di CSS yang dikirim ke browser, jadi SETIAP blok
 * halaman Confidence Fusion jatuh ke aliran otomatis: kartu saling menumpuk, peta
 * menciut jadi sepotong. Halamannya hancur total, dan SELURUH 47 berkas tes tetap hijau.
 *
 * Itu sifat yang membuat kegagalan ini pantas dijaga: tidak ada yang error, tidak ada
 * yang merah, tidak ada gejala apa pun di sisi kode — cuma layar yang berantakan, dan
 * itu baru ketahuan kalau ada manusia yang kebetulan membukanya.
 *
 * Yang diperiksa SENGAJA cuma kelas PENEMPATAN (kolom, baris, jarak). Kelas warna atau
 * tipografi yang hilang membuat halaman jelek; kelas penempatan yang hilang membuat
 * halaman tidak terbaca sama sekali. Memeriksa semua kelas Tailwind akan ribut oleh
 * nilai arbitrer (`text-[11px]`) dan kelas komponen buatan sendiri (`fx-mode`), lalu
 * dimatikan orang — penjaga yang berisik tidak menjaga apa pun.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const CSS = path.join(AKAR, 'frontend', 'css', 'app.css');

/**
 * Token kelas lengkap, termasuk awalan varian (`xl:col-span-2`).
 *
 * WAJIB berakhir angka. Tanpa itu, `grid-cols-${n}` di template literal dan
 * `xl:grid-cols-N` di dalam komentar ikut tertangkap — dan menuntut CSS menyediakan
 * kelas yang memang tidak pernah ada.
 */
const POLA = /(?:[a-z]+:)*(?:(?:col|row)-(?:start|span)|grid-(?:cols|rows))-\d+|(?:[a-z]+:)*gap(?:-[xy])?-\d+(?:\.\d+)?/g;

/** Buang komentar dulu: nama kelas yang cuma DISEBUT penjelasan bukan kelas yang dipakai. */
const tanpaKomentarHtml = (teks) => teks.replace(/<!--[\s\S]*?-->/g, ' ');
const tanpaKomentarBlok = (teks) => teks.replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * Apakah selektor kelas ini benar-benar ada di CSS?
 *
 * Titik dan titik dua di-escape di CSS: kelas `gap-1.5` tertulis `.gap-1\.5`, dan
 * `xl:col-span-2` tertulis `.xl\:col-span-2`. Mencari titiknya apa adanya memberi
 * false negative — saya sendiri sempat tertipu persis di sini waktu mendiagnosis.
 *
 * Karakter SESUDAH selektor ikut diperiksa, kalau tidak `.gap-1` akan dianggap ada
 * hanya karena `.gap-1\.5` kebetulan diawali teks yang sama.
 */
function adaDiCss(css, kelas) {
  const selektor = '.' + kelas.replace(/[.:]/g, (c) => '\\' + c);
  for (let i = css.indexOf(selektor); i !== -1; i = css.indexOf(selektor, i + 1)) {
    if (/[{,\s>+~]/.test(css[i + selektor.length] || '{')) return true;
  }
  return false;
}

function kelasDipakai() {
  const pakai = new Map();
  const catat = (teks, asal) => {
    for (const cocok of teks.matchAll(POLA)) {
      if (!pakai.has(cocok[0])) pakai.set(cocok[0], asal);
    }
  };

  catat(tanpaKomentarHtml(
    fs.readFileSync(path.join(AKAR, 'frontend', 'index.html'), 'utf8')), 'index.html');

  // Modul JS ikut discan: fusion.js dan render.js menulis markup sendiri, dan kelas
  // yang lahir di sana sama rapuhnya dengan yang ditulis di HTML.
  const dirJs = path.join(AKAR, 'frontend', 'js');
  for (const nama of fs.readdirSync(dirJs).filter((n) => n.endsWith('.js'))) {
    catat(tanpaKomentarBlok(fs.readFileSync(path.join(dirJs, nama), 'utf8')), 'js/' + nama);
  }
  return pakai;
}

assert.ok(fs.existsSync(CSS),
  `frontend/css/app.css tidak ada — jalankan "npm run css". Tanpa berkas itu seluruh ` +
  `tata letak halaman runtuh di browser, dan tidak ada tes lain yang akan memberi tahu.`);

const css = fs.readFileSync(CSS, 'utf8');
const pakai = kelasDipakai();

assert.ok(pakai.size >= 20,
  `cuma ${pakai.size} kelas penempatan yang terbaca dari markup — polanya kemungkinan ` +
  `rusak, dan penjaga yang tidak menemukan apa-apa selalu hijau`);

const hilang = [...pakai].filter(([kelas]) => !adaDiCss(css, kelas));
assert.deepStrictEqual(hilang, [],
  `kelas penempatan ini dipakai markup tapi TIDAK ADA di frontend/css/app.css:\n` +
  hilang.map(([kelas, asal]) => `  ${kelas}  (${asal})`).join('\n') +
  `\nCSS-nya basi — jalankan "npm run css". Ini persis kegagalan 2026-09-18.`);

console.log(`OK css-terbangun — ${pakai.size} kelas penempatan dari index.html dan ` +
  `modul JS semuanya ada di app.css yang terbangun`);
