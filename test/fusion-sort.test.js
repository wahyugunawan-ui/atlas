/**
 * Urutkan dan sorot Confidence Ratio — blok Matriks/Peringkat Kota dan Peringkat
 * Dealer (permintaan tim 2026-09-18).
 *
 * KENAPA TES INI ADA. Dulu memilih Kota/Kares/Dealer membuat server mengembalikan
 * SATU baris tersisa untuk ketiga blok ini. Sekarang server selalu mengembalikan
 * baris LENGKAP, dan halaman yang menyorot baris mana yang cocok — kotaSorotSet()
 * menerjemahkan filter aktif jadi kode-kode yang harus disorot, urutkanConfidence()
 * mengurutkannya. Salah satunya diam-diam salah berarti baris yang seharusnya
 * disorot tidak pernah ketemu, atau urutannya terbalik tanpa satu pun galat.
 *
 * confidenceRatioOf() dites lewat dua fungsi ini, bukan sendiri-sendiri: yang
 * penting bukan bahwa ia mengembalikan angka yang benar in isolation, tapi bahwa
 * SORT-nya berakhir dengan urutan yang benar untuk KEDUA bentuk baris (matriks
 * ber-confidenceRatio siap pakai, peringkat ber-cwSales/total mentah).
 *
 * fusion.js modul ES — diimpor dinamis lewat pathToFileURL(), mengikuti pola
 * test/fusion-klik-filter.test.js. `document`/`window` di-stub seadanya: fusion.js
 * tidak menyentuh DOM di level modul, hanya di dalam fungsi yang tidak dipanggil tes
 * ini, tapi impor modul lain (map.js dkk) tetap butuh keduanya TERDEFINISI.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

globalThis.document = { getElementById: () => null, addEventListener: () => {} };
globalThis.window = new Proxy({}, { get: () => () => {} });

const MODUL = pathToFileURL(path.join(__dirname, '..', 'frontend', 'js', 'fusion.js')).href;

async function main() {
  const { confidenceRatioOf, urutkanConfidence, kotaSorotSet } = await import(MODUL);

  // --- confidenceRatioOf: dua BENTUK baris berbeda, satu fungsi ---
  assert.strictEqual(confidenceRatioOf({ confidenceRatio: 0.42 }), 0.42,
    'baris matriks (confidenceRatio siap pakai) harus dipakai apa adanya');
  assert.strictEqual(confidenceRatioOf({ confidenceRatio: 0 }), 0,
    'confidenceRatio NOL harus tetap 0, bukan jatuh ke cabang cwSales/total — ' +
    '`!= null` dipakai justru supaya 0 tidak dianggap "tidak ada"');
  assert.strictEqual(confidenceRatioOf({ cwSales: 65, total: 100 }), 0.65,
    'baris peringkat (cwSales/total mentah) harus dihitung');
  assert.strictEqual(confidenceRatioOf({ cwSales: 65, total: 0 }), null,
    'total nol harus null, BUKAN Infinity atau NaN dari pembagian nol');
  assert.strictEqual(confidenceRatioOf({}), null,
    'baris tanpa confidenceRatio maupun total harus null, bukan melempar galat');

  // --- urutkanConfidence: arah, null selalu di ujung, TIDAK mengubah array asli ---
  const baris = [
    { kode: 'B', confidenceRatio: 0.80 },
    { kode: 'A', confidenceRatio: 0.20 },
    { kode: 'C', confidenceRatio: null },
    { kode: 'D', confidenceRatio: 0.50 },
  ];
  const asliJSON = JSON.stringify(baris);

  const naik = urutkanConfidence(baris, 'asc');
  assert.deepStrictEqual(naik.map((r) => r.kode), ['A', 'D', 'B', 'C'],
    'ascending: rendah -> tinggi, null selalu di UJUNG (bukan di depan)');

  const turun = urutkanConfidence(baris, 'desc');
  assert.deepStrictEqual(turun.map((r) => r.kode), ['B', 'D', 'A', 'C'],
    'descending: tinggi -> rendah, null TETAP di ujung — bukan "terendah" saat dibalik');

  assert.strictEqual(JSON.stringify(baris), asliJSON,
    'urutkanConfidence() harus mengurutkan SALINAN, array yang dioper tidak boleh ikut berubah');

  assert.deepStrictEqual(urutkanConfidence(null, 'asc'), [],
    'rows null tidak boleh melempar galat — dipakai sebelum data pertama tiba');
  assert.deepStrictEqual(urutkanConfidence(undefined, 'asc'), []);

  // --- kotaSorotSet: kota eksplisit menang atas kares, konsisten dengan fusionFilter() ---
  assert.strictEqual(kotaSorotSet(null), null, 'tanpa filter aktif, tidak ada yang disorot');
  assert.strictEqual(kotaSorotSet({ kota: null, kotaBanyak: null }), null,
    'tanpa kota maupun kares aktif, tidak ada yang disorot');

  const dariKota = kotaSorotSet({ kota: '34.04', kotaBanyak: null });
  assert.ok(dariKota instanceof Set && dariKota.has('34.04') && dariKota.size === 1,
    'kota eksplisit -> Set berisi satu kode itu saja');

  const dariKares = kotaSorotSet({ kota: null, kotaBanyak: ['33.01', '33.02'] });
  assert.ok(dariKares.has('33.01') && dariKares.has('33.02') && dariKares.size === 2,
    'kares -> Set berisi SELURUH kota anggotanya');

  const keduanya = kotaSorotSet({ kota: '33.08', kotaBanyak: ['33.01', '33.02'] });
  assert.deepStrictEqual([...keduanya], ['33.08'],
    'kota eksplisit MENANG atas kares kalau kebetulan keduanya terisi — sama seperti ' +
    'aturan fusionFilter() sendiri (filters.js)');

  assert.strictEqual(kotaSorotSet({ kota: null, kotaBanyak: [] }), null,
    'daftar kares KOSONG harus diperlakukan sebagai tidak ada saringan, bukan Set kosong');

  console.log('OK fusion-sort — confidenceRatioOf menyatukan dua bentuk baris, ' +
    'urutkanConfidence ascending/descending dengan null selalu di ujung tanpa ' +
    'mengubah array asli, kotaSorotSet konsisten dengan fusionFilter()');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
