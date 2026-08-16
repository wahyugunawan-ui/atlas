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

console.log(`OK docs — ${files.length} berkas teks, nol karakter kontrol, ` +
  'nol tautan putus, berkas yang disebut README ada');
