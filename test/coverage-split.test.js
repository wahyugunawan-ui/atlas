/**
 * Uji pembagi dalam/luar jangkauan, khususnya kelurahan yang BELUM punya batas wilayah.
 *
 * KENAPA INI ADA. Kelurahan yang ditambah lewat aplikasi tidak punya poligon —
 * poligonnya datang dari pipeline geo, bukan dari ketikan. Tanpa poligon, rasio
 * jangkauannya selalu 0.
 *
 * Nol itu AMBIGU, dan di situlah bahayanya: "0% terjangkau" dan "belum bisa dihitung"
 * terlihat sama persis di layar. Kalau yang kedua ikut masuk penyebut, tiap kelurahan
 * baru yang ditambahkan MENURUNKAN persentase jangkauan — dan turunnya tampak seperti
 * temuan bisnis ("jangkauan kita memburuk") padahal cuma data yang belum lengkap.
 *
 * Yang dijaga di sini: penjualan di kelurahan tanpa batas dikeluarkan dari hitungan
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

/** Dua kelurahan: satu berpoligon, satu belum. Satu pos, jangkauan 50% di yang pertama. */
const S = {
  coverage: { O1: { 'ADA': 0.5 } },
  villageByCode: {
    ADA: { code: 'ADA', hasGeom: true },
    BELUM: { code: 'BELUM', hasGeom: false },
  },
};

const split = loadSplit(S);

// --- hanya kelurahan berpoligon ---
const a = split([{ outlet: 'O1', village: 'ADA', units: 100 }]);
assert.strictEqual(a.total, 100);
assert.strictEqual(a.inside, 50);
assert.strictEqual(a.outside, 50);
assert.strictEqual(a.noBoundary, 0);

// --- kelurahan tanpa batas TIDAK boleh mengubah persentase ---
//
// Ini inti tesnya. Menambah 900 unit di kelurahan tanpa batas ke data yang sama:
// persentasenya harus TETAP 50%, bukan turun jadi 5%.
const b = split([
  { outlet: 'O1', village: 'ADA', units: 100 },
  { outlet: 'O1', village: 'BELUM', units: 900 },
]);
assert.strictEqual(b.total, 100,
  'kelurahan tanpa batas ikut masuk penyebut — persentase turun tanpa sebab yang terlihat');
assert.strictEqual(b.inside, 50);
assert.strictEqual(b.outside, 50);
assert.strictEqual((b.inside / b.total) * 100, 50,
  'persentase berubah gara-gara kelurahan yang belum punya batas wilayah');

// --- tapi unitnya TIDAK boleh hilang begitu saja ---
assert.strictEqual(b.noBoundary, 900,
  'unit di kelurahan tanpa batas hilang tanpa dilaporkan — sama buruknya dengan salah hitung');

// --- kelurahan yang tidak dikenal sama sekali tetap dihitung apa adanya ---
//
// Beda dari "tahu belum punya batas": kelurahan yang tidak ada di villageByCode berarti
// datanya memang di luar cakupan, dan itu memang "di luar jangkauan" yang jujur.
const c = split([{ outlet: 'O1', village: 'ASING', units: 10 }]);
assert.strictEqual(c.total, 10, 'kelurahan tak dikenal seharusnya tetap masuk penyebut');
assert.strictEqual(c.inside, 0);
assert.strictEqual(c.noBoundary, 0);

// --- semuanya tanpa batas: jangan bagi nol ---
const d = split([{ outlet: 'O1', village: 'BELUM', units: 500 }]);
assert.strictEqual(d.total, 0);
assert.strictEqual(d.noBoundary, 500);
assert.ok(Number.isFinite(d.inside) && d.inside === 0, 'inside harus 0, bukan NaN');

/* ==========================================================================
   SEBARAN SATU DEALER: kabupaten -> kelurahan
   ==========================================================================
   Dipakai panel rincian dealer. Yang dijaga di sini bukan "pengelompokannya jalan" —
   itu terlihat sendiri — tapi tiga hal yang gagalnya DIAM, karena semuanya
   menghasilkan angka yang tetap terlihat masuk akal di layar:

     1. dikelompokkan dengan kunci yang salah (kecamatan, bukan kabupaten)
     2. jangkauan tiap kelurahan dihitung dari SELURUH baris dealer, bukan baris
        kelurahan itu — hasilnya angka yang sama persis di tiap baris
     3. total kabupaten tidak bersambung dengan jumlah kelurahannya
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
 * Dua kabupaten, empat kelurahan. Jangkauannya sengaja BERBEDA-BEDA per kelurahan —
 * kalau dihitung dari seluruh baris dealer, keempatnya akan keluar dengan angka yang
 * sama dan bug nomor 2 di atas lolos tanpa terlihat.
 */
const SD = {
  coverage: {
    O1: { 'K-A1': 1.0, 'K-A2': 0.5, 'K-B1': 0.0 },
    O2: { 'K-A1': 0.25 },
  },
  villageByCode: {
    'K-A1': { name: 'Anggrek', district: 'Kec A', cityCode: '33.01', cityName: 'Cilacap', hasGeom: true },
    'K-A2': { name: 'Bakung',  district: 'Kec B', cityCode: '33.01', cityName: 'Cilacap', hasGeom: true },
    'K-B1': { name: 'Cempaka', district: 'Kec C', cityCode: '34.04', cityName: 'Sleman',  hasGeom: true },
    'K-B2': { name: 'Dahlia',  district: 'Kec C', cityCode: '34.04', cityName: 'Sleman',  hasGeom: false },
  },
};

const breakdown = loadBreakdown(SD);
const ROWS = [
  { outlet: 'O1', village: 'K-A1', units: 10 },
  { outlet: 'O2', village: 'K-A1', units: 4 },
  { outlet: 'O1', village: 'K-A2', units: 20 },
  { outlet: 'O1', village: 'K-B1', units: 100 },
  { outlet: 'O1', village: 'K-B2', units: 7 },
];

const hasil = breakdown(ROWS);

// --- dikelompokkan per KABUPATEN, urut unit terbanyak ---
assert.strictEqual(hasil.length, 2, 'jumlah kabupaten salah — dikelompokkan pakai kunci apa?');
assert.strictEqual(hasil[0].cityCode, '34.04',
  'kabupaten tidak diurutkan dari unit terbanyak');
assert.strictEqual(hasil[0].units, 107, 'total kabupaten salah');
assert.strictEqual(hasil[1].cityCode, '33.01');
assert.strictEqual(hasil[1].units, 34);

// Kalau dikelompokkan per kecamatan, keempat kelurahan uji ini terpecah jadi 3 grup.
assert.ok(!hasil.some((k) => String(k.cityCode).includes('Kec')),
  'dikelompokkan per kecamatan, bukan kabupaten');

// --- total kabupaten HARUS bersambung dengan jumlah kelurahannya ---
//
// Angka yang tidak bersambung tidak pernah melempar error; dia cuma membuat dua tempat
// di layar menunjukkan hal berbeda, dan tidak ada yang tahu mana yang benar.
hasil.forEach((kota) => {
  const dariKelurahan = kota.villages.reduce((sum, v) => sum + v.units, 0);
  assert.strictEqual(kota.units, dariKelurahan,
    `total ${kota.cityName} (${kota.units}) tidak sama dengan jumlah kelurahannya (${dariKelurahan})`);
});

// Begitu juga angka jangkauannya: dijumlahkan dari kelurahan, bukan dihitung ulang.
// Tanpa pemeriksaan ini, kabupaten yang jangkauannya dipaksa nol lolos tanpa satu pun
// tes merah — sudah dibuktikan lewat uji mutasi.
hasil.forEach((kota) => {
  const dalamDariKelurahan = kota.villages.reduce((sum, v) => sum + v.inside, 0);
  assert.strictEqual(kota.inside, dalamDariKelurahan,
    `unit dalam jangkauan ${kota.cityName} (${kota.inside}) tidak sama dengan ` +
    `jumlah kelurahannya (${dalamDariKelurahan})`);
});
assert.strictEqual(hasil.find((k) => k.cityCode === '33.01').inside, 21,
  'jangkauan kabupaten salah hitung');

// Dan seluruhnya harus sama dengan total dealer di kartu.
const totalSemua = hasil.reduce((sum, k) => sum + k.units, 0);
assert.strictEqual(totalSemua, 141,
  'jumlah seluruh kabupaten tidak sama dengan total penjualan dealer');

// --- jangkauan dihitung PER KELURAHAN, bukan dari seluruh baris dealer ---
const cilacap = hasil.find((k) => k.cityCode === '33.01');
const anggrek = cilacap.villages.find((v) => v.code === 'K-A1');
const bakung = cilacap.villages.find((v) => v.code === 'K-A2');

// Anggrek: 10 unit lewat O1 (rasio 1,0) + 4 unit lewat O2 (rasio 0,25) = 11.
assert.strictEqual(anggrek.inside, 11,
  'jangkauan Anggrek salah — dihitung dari baris kelurahan lain?');
assert.strictEqual(bakung.inside, 10, 'jangkauan Bakung salah (20 unit x 0,5)');
assert.notStrictEqual(anggrek.inside / anggrek.units, bakung.inside / bakung.units,
  'persentase jangkauan sama persis di tiap kelurahan — tandanya dihitung dari ' +
  'seluruh baris dealer, bukan per kelurahan');

// --- kelurahan urut unit terbanyak di dalam kabupatennya ---
assert.strictEqual(cilacap.villages[0].code, 'K-A2', 'kelurahan tidak diurutkan');

// --- kelurahan tanpa poligon: unitnya ikut, tapi keluar dari penyebut jangkauan ---
//
// Aturan yang sama dengan splitByCoverage, dan memang harus sama — dia yang dipanggil.
const sleman = hasil.find((k) => k.cityCode === '34.04');
const dahlia = sleman.villages.find((v) => v.code === 'K-B2');
assert.strictEqual(dahlia.units, 7, 'unit di kelurahan tanpa poligon hilang dari daftar');
assert.strictEqual(dahlia.covered, 0, 'kelurahan tanpa poligon masuk penyebut jangkauan');
assert.strictEqual(dahlia.noBoundary, 7, 'yang tanpa poligon tidak dilaporkan terpisah');
assert.strictEqual(sleman.covered, 100,
  'penyebut jangkauan kabupaten ikut memuat kelurahan tanpa poligon');

// --- baris kelurahan yang tidak dikenal tidak merusak apa pun ---
//
// Diperiksa dengan .length, bukan deepStrictEqual: larik yang keluar dari sandbox vm
// punya prototipe realm berbeda, jadi deepStrictEqual menolaknya walau isinya sama.
assert.strictEqual(breakdown([{ outlet: 'O1', village: 'ASING', units: 5 }]).length, 0,
  'kelurahan di luar villageByCode seharusnya dilewati, bukan bikin grup tanpa nama');
assert.strictEqual(breakdown([]).length, 0);

console.log('OK coverage-split — kelurahan tanpa batas dikeluarkan dari persentase ' +
  'dan tetap dilaporkan, kelurahan tak dikenal tetap dihitung; sebaran dealer ' +
  'dikelompokkan per kabupaten dan jangkauannya dihitung per kelurahan');
