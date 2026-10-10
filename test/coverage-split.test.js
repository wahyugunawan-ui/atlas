/**
 * Uji pembagi dalam/luar jangkauan, khususnya wilayah yang BELUM punya batas wilayah.
 *
 * Satuannya KECAMATAN sejak 2026-10-10 (rasio jangkauan dihitung per kecamatan, baris
 * penjualan membawa `district`). Sebelumnya kelurahan; sifat yang dijaga sama.
 *
 * KENAPA INI ADA. Kecamatan yang ditambah lewat aplikasi tidak punya poligon —
 * poligonnya datang dari pipeline geo, bukan dari ketikan. Tanpa poligon, rasio
 * jangkauannya selalu 0.
 *
 * Nol itu AMBIGU, dan di situlah bahayanya: "0% terjangkau" dan "belum bisa dihitung"
 * terlihat sama persis di layar. Kalau yang kedua ikut masuk penyebut, tiap kecamatan
 * baru yang ditambahkan MENURUNKAN persentase jangkauan — dan turunnya tampak seperti
 * temuan bisnis ("jangkauan kita memburuk") padahal cuma data yang belum lengkap.
 *
 * Yang dijaga di sini: penjualan di kecamatan tanpa batas dikeluarkan dari hitungan
 * DAN dilaporkan terpisah. Dua-duanya perlu — dikeluarkan tanpa dilaporkan berarti
 * datanya hilang diam-diam, yang sama buruknya.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/**
 * Muat splitByCoverage() dari modul frontend.
 *
 * Berkasnya modul ES yang mengimpor state; di sini badan fungsinya diambil dan
 * dijalankan dengan S palsu. Menyalin logikanya ke tes akan menguji salinan, bukan
 * kode yang benar-benar dipakai halaman.
 */
function loadSplit(S) {
  const src = fs.readFileSync(path.join(ROOT, 'frontend', 'js', 'filters.js'), 'utf8');
  const mulai = src.indexOf('export function splitByCoverage');
  assert.ok(mulai >= 0, 'splitByCoverage tidak ditemukan di filters.js');
  const akhir = src.indexOf('\n}', mulai) + 2;
  const body = src.slice(mulai, akhir).replace('export function', 'function');

  const sandbox = { S, hasil: null };
  vm.createContext(sandbox);
  vm.runInContext(`${body}; hasil = splitByCoverage;`, sandbox);
  return sandbox.hasil;
}

/** Dua kecamatan: satu berpoligon, satu belum. Satu pos, jangkauan 50% di yang pertama. */
const S = {
  coverage: { O1: { 'ADA': 0.5 } },
  districtByCode: {
    ADA: { code: 'ADA', hasGeom: true },
    BELUM: { code: 'BELUM', hasGeom: false },
  },
};

const split = loadSplit(S);

// --- hanya kecamatan berpoligon ---
const a = split([{ outlet: 'O1', district: 'ADA', units: 100 }]);
assert.strictEqual(a.total, 100);
assert.strictEqual(a.inside, 50);
assert.strictEqual(a.outside, 50);
assert.strictEqual(a.noBoundary, 0);

// --- kecamatan tanpa batas TIDAK boleh mengubah persentase ---
//
// Ini inti tesnya. Menambah 900 unit di kecamatan tanpa batas ke data yang sama:
// persentasenya harus TETAP 50%, bukan turun jadi 5%.
const b = split([
  { outlet: 'O1', district: 'ADA', units: 100 },
  { outlet: 'O1', district: 'BELUM', units: 900 },
]);
assert.strictEqual(b.total, 100,
  'kecamatan tanpa batas ikut masuk penyebut — persentase turun tanpa sebab yang terlihat');
assert.strictEqual(b.inside, 50);
assert.strictEqual(b.outside, 50);
assert.strictEqual((b.inside / b.total) * 100, 50,
  'persentase berubah gara-gara kecamatan yang belum punya batas wilayah');

// --- tapi unitnya TIDAK boleh hilang begitu saja ---
assert.strictEqual(b.noBoundary, 900,
  'unit di kecamatan tanpa batas hilang tanpa dilaporkan — sama buruknya dengan salah hitung');

// --- kecamatan yang tidak dikenal sama sekali tetap dihitung apa adanya ---
//
// Beda dari "tahu belum punya batas": kecamatan yang tidak ada di districtByCode berarti
// datanya memang di luar cakupan, dan itu memang "di luar jangkauan" yang jujur.
const c = split([{ outlet: 'O1', district: 'ASING', units: 10 }]);
assert.strictEqual(c.total, 10, 'kecamatan tak dikenal seharusnya tetap masuk penyebut');
assert.strictEqual(c.inside, 0);
assert.strictEqual(c.noBoundary, 0);

// --- semuanya tanpa batas: jangan bagi nol ---
const d = split([{ outlet: 'O1', district: 'BELUM', units: 500 }]);
assert.strictEqual(d.total, 0);
assert.strictEqual(d.noBoundary, 500);
assert.ok(Number.isFinite(d.inside) && d.inside === 0, 'inside harus 0, bukan NaN');

/* ==========================================================================
   SEBARAN SATU DEALER: kabupaten -> kecamatan
   ==========================================================================
   Dipakai panel rincian dealer. Yang dijaga di sini bukan "pengelompokannya jalan" —
   itu terlihat sendiri — tapi tiga hal yang gagalnya DIAM, karena semuanya
   menghasilkan angka yang tetap terlihat masuk akal di layar:

     1. dikelompokkan dengan kunci yang salah (kecamatan, bukan kabupaten)
     2. jangkauan tiap kecamatan dihitung dari SELURUH baris dealer, bukan baris
        kecamatan itu — hasilnya angka yang sama persis di tiap baris
     3. total kabupaten tidak bersambung dengan jumlah kecamatannya
   ========================================================================== */

/** Muat dealerBreakdown BESERTA splitByCoverage yang dipanggilnya. */
function loadBreakdown(S) {
  const src = fs.readFileSync(path.join(ROOT, 'frontend', 'js', 'filters.js'), 'utf8');
  const ambil = (nama) => {
    const mulai = src.indexOf(`export function ${nama}`);
    assert.ok(mulai >= 0, `${nama} tidak ditemukan di filters.js`);
    const akhir = src.indexOf('\n}', mulai) + 2;
    return src.slice(mulai, akhir).replace('export function', 'function');
  };
  const sandbox = { S, hasil: null };
  vm.createContext(sandbox);
  vm.runInContext(
    `${ambil('splitByCoverage')}\n${ambil('dealerBreakdown')}\nhasil = dealerBreakdown;`,
    sandbox);
  return sandbox.hasil;
}

/**
 * Dua kabupaten, empat kecamatan. Jangkauannya sengaja BERBEDA-BEDA per kecamatan —
 * kalau dihitung dari seluruh baris dealer, keempatnya akan keluar dengan angka yang
 * sama dan bug nomor 2 di atas lolos tanpa terlihat.
 */
const SD = {
  coverage: {
    O1: { 'K-A1': 1.0, 'K-A2': 0.5, 'K-B1': 0.0 },
    O2: { 'K-A1': 0.25 },
  },
  districtByCode: {
    'K-A1': { name: 'Anggrek', cityCode: '33.01', cityName: 'Cilacap', hasGeom: true },
    'K-A2': { name: 'Bakung',  cityCode: '33.01', cityName: 'Cilacap', hasGeom: true },
    'K-B1': { name: 'Cempaka', cityCode: '34.04', cityName: 'Sleman',  hasGeom: true },
    'K-B2': { name: 'Dahlia',  cityCode: '34.04', cityName: 'Sleman',  hasGeom: false },
  },
};

const breakdown = loadBreakdown(SD);
const ROWS = [
  { outlet: 'O1', district: 'K-A1', units: 10 },
  { outlet: 'O2', district: 'K-A1', units: 4 },
  { outlet: 'O1', district: 'K-A2', units: 20 },
  { outlet: 'O1', district: 'K-B1', units: 100 },
  { outlet: 'O1', district: 'K-B2', units: 7 },
];

const hasil = breakdown(ROWS);

// --- dikelompokkan per KABUPATEN, urut unit terbanyak ---
assert.strictEqual(hasil.length, 2, 'jumlah kabupaten salah — dikelompokkan pakai kunci apa?');
assert.strictEqual(hasil[0].cityCode, '34.04',
  'kabupaten tidak diurutkan dari unit terbanyak');
assert.strictEqual(hasil[0].units, 107, 'total kabupaten salah');
assert.strictEqual(hasil[1].cityCode, '33.01');
assert.strictEqual(hasil[1].units, 34);

// Kalau dikelompokkan pakai kunci baris (kecamatan), hasilnya 4 grup, bukan 2.
assert.ok(!hasil.some((k) => String(k.cityCode).startsWith('K-')),
  'dikelompokkan per kecamatan, bukan kabupaten');

// --- total kabupaten HARUS bersambung dengan jumlah kecamatannya ---
//
// Angka yang tidak bersambung tidak pernah melempar error; dia cuma membuat dua tempat
// di layar menunjukkan hal berbeda, dan tidak ada yang tahu mana yang benar.
hasil.forEach((kota) => {
  const dariKecamatan = kota.districts.reduce((sum, v) => sum + v.units, 0);
  assert.strictEqual(kota.units, dariKecamatan,
    `total ${kota.cityName} (${kota.units}) tidak sama dengan jumlah kecamatannya (${dariKecamatan})`);
});

// Begitu juga angka jangkauannya: dijumlahkan dari kecamatan, bukan dihitung ulang.
// Tanpa pemeriksaan ini, kabupaten yang jangkauannya dipaksa nol lolos tanpa satu pun
// tes merah — sudah dibuktikan lewat uji mutasi.
hasil.forEach((kota) => {
  const dalamDariKecamatan = kota.districts.reduce((sum, v) => sum + v.inside, 0);
  assert.strictEqual(kota.inside, dalamDariKecamatan,
    `unit dalam jangkauan ${kota.cityName} (${kota.inside}) tidak sama dengan ` +
    `jumlah kecamatannya (${dalamDariKecamatan})`);
});
assert.strictEqual(hasil.find((k) => k.cityCode === '33.01').inside, 21,
  'jangkauan kabupaten salah hitung');

// Dan seluruhnya harus sama dengan total dealer di kartu.
const totalSemua = hasil.reduce((sum, k) => sum + k.units, 0);
assert.strictEqual(totalSemua, 141,
  'jumlah seluruh kabupaten tidak sama dengan total penjualan dealer');

// --- jangkauan dihitung PER KELURAHAN, bukan dari seluruh baris dealer ---
const cilacap = hasil.find((k) => k.cityCode === '33.01');
const anggrek = cilacap.districts.find((v) => v.code === 'K-A1');
const bakung = cilacap.districts.find((v) => v.code === 'K-A2');

// Anggrek: 10 unit lewat O1 (rasio 1,0) + 4 unit lewat O2 (rasio 0,25) = 11.
assert.strictEqual(anggrek.inside, 11,
  'jangkauan Anggrek salah — dihitung dari baris kecamatan lain?');
assert.strictEqual(bakung.inside, 10, 'jangkauan Bakung salah (20 unit x 0,5)');
assert.notStrictEqual(anggrek.inside / anggrek.units, bakung.inside / bakung.units,
  'persentase jangkauan sama persis di tiap kecamatan — tandanya dihitung dari ' +
  'seluruh baris dealer, bukan per kecamatan');

// --- kecamatan urut unit terbanyak di dalam kabupatennya ---
assert.strictEqual(cilacap.districts[0].code, 'K-A2', 'kecamatan tidak diurutkan');

// --- kecamatan tanpa poligon: unitnya ikut, tapi keluar dari penyebut jangkauan ---
//
// Aturan yang sama dengan splitByCoverage, dan memang harus sama — dia yang dipanggil.
const sleman = hasil.find((k) => k.cityCode === '34.04');
const dahlia = sleman.districts.find((v) => v.code === 'K-B2');
assert.strictEqual(dahlia.units, 7, 'unit di kecamatan tanpa poligon hilang dari daftar');
assert.strictEqual(dahlia.covered, 0, 'kecamatan tanpa poligon masuk penyebut jangkauan');
assert.strictEqual(dahlia.noBoundary, 7, 'yang tanpa poligon tidak dilaporkan terpisah');
assert.strictEqual(sleman.covered, 100,
  'penyebut jangkauan kabupaten ikut memuat kecamatan tanpa poligon');

// --- baris kecamatan yang tidak dikenal tidak merusak apa pun ---
//
// Diperiksa dengan .length, bukan deepStrictEqual: larik yang keluar dari sandbox vm
// punya prototipe realm berbeda, jadi deepStrictEqual menolaknya walau isinya sama.
assert.strictEqual(breakdown([{ outlet: 'O1', district: 'ASING', units: 5 }]).length, 0,
  'kecamatan di luar districtByCode seharusnya dilewati, bukan bikin grup tanpa nama');
assert.strictEqual(breakdown([]).length, 0);

console.log('OK coverage-split — kecamatan tanpa batas dikeluarkan dari persentase ' +
  'dan tetap dilaporkan, kecamatan tak dikenal tetap dihitung; sebaran dealer ' +
  'dikelompokkan per kabupaten dan jangkauannya dihitung per kecamatan');
