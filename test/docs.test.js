/**
 * Uji dokumentasi: karakter kontrol, dan tautan yang menunjuk berkas tidak ada.
 *
 * Ada karena keduanya sudah pernah terjadi, dan keduanya gagal dengan DIAM.
 *
 * Karakter kontrol: escape `\a` dan `\b` di skrip penyunting mengubah
 * `C:\astra-data` jadi `C:` + karakter bel, dan `ops\backup.bat` jadi
 * `ops` + backspace + `ackup.bat`. Tidak kelihatan di editor mana pun, tidak
 * mengubah tampilan di GitHub, dan baru ketahuan waktu ada yang menyalin
 * perintahnya lalu bingung kenapa gagal. Sudah dua kali: `.env.example`, lalu
 * `README.md` dan `PINDAH.md`.
 *
 * Tautan mati: dokumen dipindah ke docs/ dan tautan silangnya ikut berubah.
 * Tautan yang salah tidak pernah membuat apa pun gagal — dia cuma diam-diam
 * salah sampai ada yang mengkliknya.
 *
 * Dokumen di proyek ini BUKAN hiasan: penggunanya tidak punya orang IT, dan
 * PINDAH.md adalah satu-satunya jalan mereka memindahkan server. Perintah yang
 * rusak di sana sama seriusnya dengan kode yang rusak.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Semua berkas teks yang dibaca manusia, tanpa masuk node_modules atau .git. */
function textFiles(dir, out) {
  const hasil = out || [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'vendor', 'data'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) textFiles(full, hasil);
    else if (/\.(md|example|bat|ps1|sql)$/.test(entry.name)) hasil.push(full);
  }
  return hasil;
}

const files = textFiles(ROOT);
assert.ok(files.length > 10, `cuma ${files.length} berkas ditemukan — penyapuannya salah`);

// --- 1. tidak ada karakter kontrol ---
//
// Yang diizinkan cuma newline, carriage return, dan tab. Sisanya di bawah 0x20 tidak
// punya alasan berada di berkas teks, dan yang paling sering menyelinap justru BEL
// (0x07, dari \a) dan BS (0x08, dari \b) — dua huruf yang sering muncul di path
// Windows: \astra... dan \backup...
const kotor = [];
for (const file of files) {
  const isi = fs.readFileSync(file, 'utf8');
  const baris = isi.split('\n');
  baris.forEach((teks, i) => {
    for (const ch of teks) {
      const kode = ch.charCodeAt(0);
      if (kode < 32 && ch !== '\r' && ch !== '\t') {
        kotor.push(`${path.relative(ROOT, file)}:${i + 1} karakter 0x` +
          kode.toString(16).padStart(2, '0'));
        break;
      }
    }
  });
}
assert.deepStrictEqual(kotor, [],
  'karakter kontrol di berkas teks — hampir pasti dari escape \\a atau \\b:\n  ' +
  kotor.join('\n  '));

// --- 1b. berkas .bat WAJIB berakhiran CRLF ---
//
// cmd.exe mengurai berkas batch per baris dan memerlukan CRLF. Dengan LF saja dia
// salah memenggal dan memuntahkan galat seperti "'M' is not recognized as an internal
// or external command" — potongan dari kata REM yang terbelah.
//
// Sudah terjadi: ops\akses-luar-nyala.bat ditulis dengan LF dan tiga baris REM-nya
// dieksekusi sebagai perintah. Skripnya tetap "jalan", jadi gampang dikira wajar —
// dan yang dipakai orang non-IT di hari pitch tidak boleh memuntahkan galat merah
// yang tidak berarti apa-apa.
const lfSaja = [];
for (const file of files.filter((f) => f.endsWith('.bat'))) {
  const buf = fs.readFileSync(file);
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a && (i === 0 || buf[i - 1] !== 0x0d)) {
      lfSaja.push(path.relative(ROOT, file));
      break;
    }
  }
}
assert.deepStrictEqual(lfSaja, [],
  'berkas .bat berakhiran LF, bukan CRLF — cmd.exe akan salah mengurai barisnya:\n  ' +
  lfSaja.join('\n  '));

// --- 2. tautan markdown menunjuk berkas yang ada ---
const putus = [];
for (const file of files.filter((f) => f.endsWith('.md'))) {
  const isi = fs.readFileSync(file, 'utf8');
  for (const m of isi.matchAll(/\[[^\]]*\]\(([^)#:\s]+\.md)\)/g)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (!fs.existsSync(target)) {
      putus.push(`${path.relative(ROOT, file)} -> ${m[1]}`);
    }
  }
}
assert.deepStrictEqual(putus, [], 'tautan dokumen menunjuk berkas yang tidak ada:\n  ' +
  putus.join('\n  '));

// --- 3. berkas yang dijanjikan README benar-benar ada ---
//
// README menyebut perintah dan berkas yang harus dijalankan orang. Menyebut berkas
// yang sudah dipindah atau diganti nama membuat orang berhenti di langkah pertama.
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
for (const wajib of ['start.bat', 'ops/install-tasks.ps1', 'ops/backup.bat',
  '.env.example']) {
  assert.ok(readme.includes(wajib.replace(/\//g, '\\')) || readme.includes(wajib),
    `README tidak menyebut ${wajib} — atau menyebutnya dengan nama yang salah`);
  assert.ok(fs.existsSync(path.join(ROOT, wajib)),
    `README menyebut ${wajib}, tapi berkasnya tidak ada`);
}

/* ==========================================================================
   PRD
   ==========================================================================
   PRD memuat daftar kebutuhan beserta berkas tes yang menjaganya. Daftar itu cuma
   berguna kalau isinya benar, dan tiga cara dia jadi salah semuanya gagal dengan diam:
   tes diganti nama, ID disalin-tempel tanpa diubah, dan folder dipindah.
   ========================================================================== */

const prd = fs.readFileSync(path.join(ROOT, 'docs', 'PRD.md'), 'utf8');

// --- 4. berkas tes yang disebut PRD benar-benar ada ---
//
// Tanpa ini, mengganti nama satu berkas tes membuat PRD menunjuk penjaga yang tidak
// ada. Tidak ada yang gagal; daftarnya cuma diam-diam bohong.
const tesHilang = [];
for (const m of prd.matchAll(/`(test\/[\w.-]+\.js)`/g)) {
  if (!fs.existsSync(path.join(ROOT, m[1]))) tesHilang.push(m[1]);
}
assert.deepStrictEqual([...new Set(tesHilang)], [],
  'PRD menyebut berkas tes yang tidak ada:\n  ' + tesHilang.join('\n  '));

// --- 5. ID kebutuhan unik ---
//
// Dua kebutuhan berbeda ber-ID sama membuat rujukan silangnya tidak berarti, dan
// salin-tempel adalah cara paling mudah itu terjadi.
const idBaris = [...prd.matchAll(/^\| (KN?F-[A-Z]+-\d+) \|/gm)].map((m) => m[1]);
const kembar = idBaris.filter((id, i) => idBaris.indexOf(id) !== i);
assert.deepStrictEqual([...new Set(kembar)], [],
  'ID kebutuhan dipakai lebih dari sekali di PRD: ' + kembar.join(', '));
assert.ok(idBaris.length > 40,
  `cuma ${idBaris.length} ID kebutuhan terbaca — polanya tidak cocok lagi dengan tabelnya`);

// --- 6. berkas dan folder yang DIKLAIM ADA benar-benar ada ---
//
// Peta folder yang masih menyebut `src/` setelah pindah ke `backend/` adalah tepat
// jenis kesalahan yang tidak membuat apa pun gagal — sampai ada yang mencarinya.
//
// Dua aturan berbeda, dan bedanya disengaja:
//
//   berkas (ada titik-ekstensi)  diperiksa DI MANA PUN dia disebut
//   folder telanjang             diperiksa HANYA di dalam blok peta struktur
//
// Sebabnya prosa boleh menyebut nama lama. "Sampai 2026-08-17 folder ini bernama
// `src/`" itu kalimat sejarah yang benar, dan penjaga yang melarangnya memaksa
// dokumennya berbohong tentang masa lalu. Blok peta struktur lain urusannya: di situ
// tiap baris adalah klaim tentang keadaan sekarang.
const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
const AKAR = '(?:backend|frontend|src|public|test|scripts|ops|docs|prototype|data)';
const hilang = [];

for (const m of (prd + claude).matchAll(new RegExp('`(' + AKAR + '/[\\w./-]*\\.\\w+)`', 'g'))) {
  if (!fs.existsSync(path.join(ROOT, m[1]))) hilang.push(`berkas ${m[0]}`);
}

for (const isi of [prd, claude]) {
  for (const blok of isi.matchAll(/```\n([\s\S]*?)```/g)) {
    for (const baris of blok[1].split('\n')) {
      // Baris yang menandai dirinya DI LUAR GIT memang tidak ada di repositori —
      // `data/` diatur lewat DATA_DIR di `.env` dan `frontend/vendor/` dibangun
      // `npm run vendor`. Tandanya sudah tertulis di barisnya; penjaga ini
      // membacanya, bukan menyimpan daftar pengecualian sendiri yang bisa menyimpang.
      if (/DI LUAR GIT/.test(baris)) continue;
      const m = baris.match(new RegExp('^(' + AKAR + '/[\\w./-]*)'));
      if (m && !fs.existsSync(path.join(ROOT, m[1]))) hilang.push(`folder ${m[1]}`);
    }
  }
}

assert.deepStrictEqual([...new Set(hilang)], [],
  'PRD atau CLAUDE.md menyebut sesuatu yang tidak ada:\n  ' + hilang.join('\n  '));

// --- 7. tidak ada TAUTAN yang mengirim pembaca ke PLAN.md ---
//
// PLAN.md menjelaskan SQLite, folder lama, dan tabel bernama Indonesia. Tidak satu pun
// masih benar, dan CLAUDE.md pernah menunjuknya sebagai "rencana lengkap".
//
// Yang dilarang TAUTAN, bukan penyebutan. Dokumen boleh — malah harus — bercerita
// kenapa berkas itu diarsipkan, dan entri ROADMAP yang mencatat pengarsipannya wajib
// menyebut namanya. Yang berbahaya cuma penunjuk yang benar-benar mengirim orang ke
// sana. Penyebutan sebagai path ber-backtick di PRD dan CLAUDE sudah ditangkap
// pemeriksaan 6 di atas.
for (const nama of ['CLAUDE.md', 'README.md', 'docs/ROADMAP.md', 'docs/PRD.md',
  'docs/DECISIONS.md']) {
  const isi = fs.readFileSync(path.join(ROOT, nama), 'utf8');
  assert.ok(!/\]\((?:docs\/)?PLAN\.md\)/.test(isi),
    `${nama} menautkan ke PLAN.md — sudah pindah ke docs/archive/, dan isinya ` +
    'menjelaskan rancangan yang sudah ditinggalkan');
}

console.log(`OK docs — ${files.length} berkas teks, nol karakter kontrol, ` +
  `nol tautan putus, berkas yang disebut README ada, ` +
  `${idBaris.length} kebutuhan PRD ber-ID unik dengan penjaga yang ada`);
