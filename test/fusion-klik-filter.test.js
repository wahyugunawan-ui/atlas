/**
 * Klik-untuk-menyaring di halaman Confidence Fusion.
 *
 * KENAPA TES INI ADA. Kendali silangnya diminta TANPA sidebar: yang bisa diklik adalah
 * elemen yang memang sudah ada di layar — baris matriks, baris peringkat kota, baris
 * peringkat dealer. Ketiganya dibangun sebagai STRING di dalam fusion.js, bukan ditulis
 * di index.html.
 *
 * KOREKSI atas versi pertama komentar ini, yang salah dan sempat ikut ter-commit: saya
 * menulis bahwa page.test.js "cuma memindai markup statis" sehingga onclick yang lahir
 * di template literal luput dari penjaganya. TIDAK BENAR. Pemindai handler di sana
 * membaca `onclick=` dari markup DAN dari seluruh sumber modul, jadi nama yang lupa
 * didaftarkan ke window sudah merah di sana. Yang menunjukkannya uji mutasi: mutasi
 * yang mencabut sebuah nama dari HANDLERS merah di penjaga LAMA, bukan di asersi saya.
 *
 * Asersi HANDLERS di bawah karena itu memang kembar dengan penjaga itu. Dibiarkan
 * karena berkas ini dijalankan sendiri waktu memperbaiki klik-untuk-menyaring, dan
 * pesannya menyebut gejalanya langsung — tapi ia BUKAN satu-satunya yang menjaga, dan
 * tidak boleh dibaca begitu.
 *
 * Yang benar-benar tidak dijaga siapa pun selain berkas ini: kode mana yang dikirim
 * ke setScope(), dan apakah kedua pemanggil daftarPeringkat() menyebut jenisnya.
 *
 * DAN SATU JEBAKAN YANG HAMPIR SAYA MASUKI. Peringkat Dealer punya DUA kode di tiap
 * barisnya: `dealerCode` numerik ('7348', kosakata rollup) dan `dealerFilterCode`
 * turunan nama ('NUSANTARASAKTIGEJAYAN', satu-satunya yang dikenal bilah filter).
 * Memakai yang numerik untuk menyaring TIDAK melempar galat — setScope() menerimanya,
 * bilahnya bergerak, dan halamannya cuma kosong. Persis cacat diam yang sama dengan
 * warna titik KTP yang baru diperbaiki giliran lalu, di tempat yang berbeda.
 *
 * Yang diperiksa di sini SIFAT strukturalnya, karena ketiga fungsi ini menghasilkan
 * HTML dan bergantung pada DOM. Yang menguji perilakunya di database sungguhan adalah
 * test/fusion-filter-sql.test.js, yang memastikan kedua kode itu benar-benar berbeda
 * isi dan keduanya ikut dikembalikan.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function sumber(nama) {
  return fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', nama), 'utf8')
    .replace(/\r\n/g, '\n');
}

/** Badan satu fungsi top-level; batasnya '\n}' di kolom nol. */
function badanFungsi(src, deklarasi, namaBerkas) {
  const mulai = src.indexOf(deklarasi);
  assert.notStrictEqual(mulai, -1, `"${deklarasi}" tidak ada lagi di ${namaBerkas}`);
  const akhir = src.indexOf('\n}', mulai);
  assert.notStrictEqual(akhir, -1, `kurung tutup "${deklarasi}" tidak ketemu di ${namaBerkas}`);
  return src.slice(mulai, akhir);
}

const fusion = sumber('fusion.js');
const app = sumber('app.js');

// 1. Penanganya ada dan diekspor.
assert.ok(/export async function filterDariFusi\s*\(/.test(fusion),
  'fusion.js tidak lagi mengekspor filterDariFusi()');

// 2. Isinya benar-benar menyaring lalu menggambar ulang, bukan stub kosong.
const badanFilter = badanFungsi(fusion, 'export async function filterDariFusi(', 'fusion.js');
assert.ok(badanFilter.includes('setScope('),
  'filterDariFusi() tidak memanggil setScope(); kliknya tidak mengubah saringan apa pun');
assert.ok(badanFilter.includes('renderFusion('),
  'filterDariFusi() tidak menggambar ulang halaman sesudah menyaring');

// 3. Terdaftar di window. Onclick yang lahir di template literal TIDAK dijaga
//    page.test.js, jadi tanpa pemeriksaan ini sebuah nama yang lupa didaftarkan cuma
//    ketahuan waktu ada orang mengklik barisnya di browser.
assert.ok(/\bfilterDariFusi\b/.test(app),
  'app.js tidak menyebut filterDariFusi sama sekali (tidak di-import maupun didaftarkan)');
const blokHandlers = app.slice(app.indexOf('const HANDLERS'), app.indexOf('Object.assign(window'));
assert.ok(blokHandlers.includes('filterDariFusi'),
  'filterDariFusi tidak terdaftar di HANDLERS; onclick di baris matriks/peringkat akan ' +
  'melempar "filterDariFusi is not defined" waktu diklik');

// 4. Baris matriks bisa diklik, dan menyaring per KOTA.
const badanMatriks = badanFungsi(fusion, 'function matriks(', 'fusion.js');
assert.ok(badanMatriks.includes("filterDariFusi('kota'"),
  'baris Matriks Kota x Golongan tidak lagi bisa diklik untuk menyaring kota');

// 5. Baris peringkat bisa diklik — dan yang dikirim untuk dealer WAJIB kode turunan
//    nama, bukan kode numerik rollup.
const badanPeringkat = badanFungsi(fusion, 'function daftarPeringkat(', 'fusion.js');
assert.ok(badanPeringkat.includes('filterDariFusi('),
  'baris peringkat tidak lagi bisa diklik untuk menyaring');
assert.ok(badanPeringkat.includes('dealerFilterCode'),
  'baris peringkat dealer tidak memakai dealerFilterCode');

const barisKode = badanPeringkat.split('\n').find((b) => b.includes('kodeKlik ='));
assert.ok(barisKode, 'baris yang menentukan kode klik tidak ditemukan di daftarPeringkat()');
assert.ok(barisKode.includes('dealerFilterCode'),
  'kode klik dealer tidak diambil dari dealerFilterCode');
// 'dealerFilterCode' TIDAK memuat 'dealerCode' sebagai substring, jadi pemeriksaan ini
// benar-benar membedakan keduanya dan bukan sekadar cocok karena kemiripan nama.
assert.ok(!barisKode.includes('r.dealerCode'),
  'kode klik dealer jatuh kembali ke r.dealerCode yang NUMERIK — bilah filter tidak ' +
  'mengenalnya, jadi saringannya tidak pernah cocok dan halamannya cuma kosong');

// 6. Kedua pemanggilnya menyebut jenisnya. Tanpa `jenis`, barisnya diam-diam tidak
//    bisa diklik sama sekali — tidak ada galat, kliknya cuma tidak melakukan apa pun.
assert.ok(/daftarPeringkat\([^)]*'cityName'[^)]*jenis:\s*'kota'/.test(fusion),
  "panel Peringkat Kota tidak mengirim { jenis: 'kota' }");
assert.ok(/daftarPeringkat\([^)]*'dealerName'[^)]*jenis:\s*'dealer'/.test(fusion),
  "panel Peringkat Dealer tidak mengirim { jenis: 'dealer' }");

console.log('OK fusion-klik-filter — filterDariFusi ada, terdaftar di HANDLERS, dipakai ' +
  'baris matriks dan baris peringkat, dan klik dealer memakai kode turunan nama ' +
  '(bukan kode numerik rollup yang tidak dikenal bilah filter)');
