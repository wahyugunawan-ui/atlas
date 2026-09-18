/**
 * skalaMarkerZoom() — skala marker DOM dealer/pos mengikuti zoom peta.
 *
 * KENAPA TES INI ADA. Marker dealer/pos adalah elemen DOM (lihat komentar puncak
 * outlets.js), bukan lapisan MapLibre — jadi tidak bisa memakai `circle-radius`
 * interpolate bawaan seperti titik penjualan/KTP/Servis/Pengiriman. Fungsi ini
 * pengganti buatan sendiri, dan kalau titik acuannya diam-diam salah, markernya
 * akan mengecil waktu di-zoom MASUK atau sebaliknya — kebalikan dari yang diminta,
 * dan tidak ada satu pun galat yang menandakannya.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

globalThis.document = { getElementById: () => null, addEventListener: () => {} };
globalThis.window = new Proxy({}, { get: () => () => {} });

const MODUL = pathToFileURL(path.join(__dirname, '..', 'frontend', 'js', 'map.js')).href;

async function main() {
  const { skalaMarkerZoom } = await import(MODUL);

  // Titik acuan persis: 6->0.7, 10->1 (ukuran normal), 14->1.55.
  assert.strictEqual(skalaMarkerZoom(6), 0.7, 'titik acuan bawah harus persis 0.7');
  assert.strictEqual(skalaMarkerZoom(10), 1, 'titik acuan tengah harus persis 1 (ukuran normal)');
  assert.strictEqual(skalaMarkerZoom(14), 1.55, 'titik acuan atas harus persis 1.55');

  // Dijepit, bukan diekstrapolasi tanpa batas — zoom dunia sangat rendah atau zoom
  // sangat dekat tidak boleh membuat marker menyusut ke nol atau membesar tanpa batas.
  assert.strictEqual(skalaMarkerZoom(0), 0.7, 'di bawah titik acuan pertama harus dijepit ke 0.7');
  assert.strictEqual(skalaMarkerZoom(20), 1.55, 'di atas titik acuan terakhir harus dijepit ke 1.55');

  // Interpolasi LINEAR di antara titik acuan — nilai tengah harus persis rata-rata.
  assert.strictEqual(skalaMarkerZoom(8), 0.85, 'tengah 6..10 (0.7..1) harus 0.85');
  assert.strictEqual(skalaMarkerZoom(12), 1.275, 'tengah 10..14 (1..1.55) harus 1.275');

  // MONOTON NAIK: dekat harus SELALU lebih besar dari jauh, di seluruh rentang —
  // ini justru inti permintaannya ("jika dekat terlihat besar"), bukan detail.
  const sampel = [0, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 20];
  for (let i = 1; i < sampel.length; i++) {
    const a = skalaMarkerZoom(sampel[i - 1]);
    const b = skalaMarkerZoom(sampel[i]);
    assert.ok(b >= a,
      `zoom ${sampel[i]} (${b}) harus >= zoom ${sampel[i - 1]} (${a}) — dekat tidak ` +
      'boleh lebih kecil dari yang lebih jauh');
  }

  // Masukan tidak sah tidak boleh melempar galat atau menghasilkan NaN — dipanggil
  // dari event 'zoom' MapLibre, dan peta yang belum siap bisa saja melapor angka aneh.
  assert.strictEqual(skalaMarkerZoom(NaN), 0.7, 'NaN harus jatuh ke skala terendah, bukan NaN');
  assert.strictEqual(skalaMarkerZoom(undefined), 0.7);
  assert.strictEqual(skalaMarkerZoom(null), 0.7);

  console.log('OK map-skala-marker — skalaMarkerZoom monoton naik, dijepit di kedua ' +
    'ujung, interpolasi linear tepat di titik tengah, tahan masukan tidak sah');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
