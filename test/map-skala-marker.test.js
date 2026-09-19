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

  // Titik acuan persis. Diubah 2026-09-18 sore: kurva lama ([[6,0.7],[10,1],[14,1.55]])
  // cuma menyusut 30% di zoom terjauh, dan simbol pos/dealer saling menumpuk waktu
  // peta ditarik keluar. Acuan barunya ditetapkan tim — ukuran NORMAL (1.0) adalah
  // ukuran pada tampilan skala 2 km, sekitar zoom 13.
  assert.strictEqual(skalaMarkerZoom(13), 1,
    'zoom 13 (tampilan ~2 km) harus PERSIS 1 — itu ukuran acuan yang ditetapkan tim');
  assert.strictEqual(skalaMarkerZoom(7), 0.25, 'titik acuan bawah harus persis 0.25');
  assert.strictEqual(skalaMarkerZoom(10), 0.4, 'zoom 10 (~20 km) harus persis 0.4');
  assert.strictEqual(skalaMarkerZoom(12), 0.72, 'zoom 12 (~5 km) harus persis 0.72');
  assert.strictEqual(skalaMarkerZoom(15), 1.25, 'titik acuan atas harus persis 1.25');

  // INTI KELUHANNYA, dijaga sebagai angka: ditarik keluar dari tampilan 2 km, simbolnya
  // harus menyusut BANYAK — bukan sekadar sedikit lebih kecil. Kurva lama gagal di sini
  // (z10 dulu 1.0, sama persis dengan z13), dan itu yang membuatnya menumpuk.
  assert.ok(skalaMarkerZoom(10) <= skalaMarkerZoom(13) * 0.55,
    'di zoom 10 simbol harus tinggal <=55% ukuran acuannya, kalau tidak ia menumpuk ' +
    'lagi persis seperti keluhan aslinya');
  assert.ok(skalaMarkerZoom(11) < skalaMarkerZoom(12),
    'tampilan 10 km harus lebih kecil daripada tampilan 5 km');

  // Tapi TIDAK sampai hilang: di tampilan se-provinsi titiknya masih harus terlihat.
  assert.ok(skalaMarkerZoom(6) >= 0.2,
    'jangan menyusut sampai praktis tidak terlihat — titik yang hilang sama saja ' +
    'dengan data yang hilang bagi yang melihat');

  // Dijepit, bukan diekstrapolasi tanpa batas.
  assert.strictEqual(skalaMarkerZoom(0), 0.25, 'di bawah titik acuan pertama dijepit ke 0.25');
  assert.strictEqual(skalaMarkerZoom(20), 1.25, 'di atas titik acuan terakhir dijepit ke 1.25');

  // Interpolasi LINEAR di antara titik acuan — nilai tengah harus persis rata-rata.
  assert.ok(Math.abs(skalaMarkerZoom(11) - 0.56) < 1e-9, 'tengah 10..12 (0.4..0.72) harus 0.56');
  assert.ok(Math.abs(skalaMarkerZoom(14) - 1.125) < 1e-9, 'tengah 13..15 (1..1.25) harus 1.125');

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
  assert.strictEqual(skalaMarkerZoom(NaN), 0.25, 'NaN harus jatuh ke skala terendah, bukan NaN');
  assert.strictEqual(skalaMarkerZoom(undefined), 0.25);
  assert.strictEqual(skalaMarkerZoom(null), 0.25);

  console.log('OK map-skala-marker — skalaMarkerZoom monoton naik, dijepit di kedua ' +
    'ujung, 1.0 tepat di tampilan 2 km dan menyusut tajam saat ditarik keluar, tahan ' +
    'masukan tidak sah');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
