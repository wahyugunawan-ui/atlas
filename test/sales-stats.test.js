/**
 * Uji frontend/js/sales-stats.js — murni, meng-import berkas ES yang sama persis
 * yang dikirim ke browser (pola sama dengan test/filters.test.js).
 *
 * Yang dijaga:
 * 1. Kontribusi % dihitung per KOTA, bukan global — dua kota dengan total berbeda
 *    tidak boleh saling memengaruhi angka satu sama lain.
 * 2. Kota tanpa penjualan menghasilkan "tidak tersedia" (null), bukan NaN/Infinity.
 * 3. Kelas interval tetap tidak tumpang tindih di titik batas.
 * 4. Selisih/Rasio terhadap Acuan benar terhadap benchmark yang DIBERIKAN, bukan
 *    hardcode 1%.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const url = (name) => pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'js', name)).href;

async function test() {
  const {
    groupByCity, contributionPercent, relativePosition, fixedContributionClass,
    referenceGap, referenceRatio, KONTRIBUSI_TETAP,
  } = await import(url('sales-stats.js'));
  const { percentileBreaks } = await import(url('colors.js'));

  /* ------------------------------------------------------------------
     1. groupByCity — per kota, bukan global
     ------------------------------------------------------------------ */
  const villageByCode = {
    V1: { cityCode: 'KOTA-A' },
    V2: { cityCode: 'KOTA-A' },
    V3: { cityCode: 'KOTA-B' },
  };
  const rows = [
    { village: 'V1', units: 8 },
    { village: 'V2', units: 92 },
    { village: 'V3', units: 5 },
    { village: 'TIDAK-DIKENAL', units: 999 }, // kelurahan tak dikenal, harus dilewati
  ];
  const perCity = groupByCity(rows, villageByCode);
  assert.strictEqual(perCity.size, 2, 'kelurahan tak dikenal ikut membuat kota baru');
  assert.strictEqual(perCity.get('KOTA-A').total, 100);
  assert.strictEqual(perCity.get('KOTA-B').total, 5);
  assert.strictEqual(perCity.get('KOTA-A').villages.get('V1'), 8);
  assert.strictEqual(perCity.get('KOTA-A').villages.get('V2'), 92);

  /* ------------------------------------------------------------------
     2. contributionPercent — per kota, dan aman terhadap total nol
     ------------------------------------------------------------------ */
  assert.strictEqual(contributionPercent(8, 100), 8);
  assert.strictEqual(contributionPercent(5, 5), 100);
  // KOTA-A dan KOTA-B totalnya beda jauh (100 vs 5) — kontribusi V1 (8 dari 100)
  // TIDAK boleh dihitung seolah-olah pembaginya total gabungan (105) atau kota lain.
  assert.strictEqual(contributionPercent(8, perCity.get('KOTA-A').total), 8);

  assert.strictEqual(contributionPercent(5, 0), null,
    'total kota nol menghasilkan nilai selain null (NaN/Infinity lolos ke layar)');
  assert.strictEqual(contributionPercent(0, 0), null);

  /* ------------------------------------------------------------------
     3. relativePosition — bungkus classOf() colors.js, label Indonesia baru
     ------------------------------------------------------------------ */
  const nilai = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const breaks = percentileBreaks(nilai);
  assert.strictEqual(relativePosition(1, breaks), 'Terbawah');
  assert.strictEqual(relativePosition(10, breaks), 'Teratas');
  assert.strictEqual(relativePosition(0, breaks), null, 'nol seharusnya "tidak ada penjualan"');
  assert.strictEqual(relativePosition(null, breaks), null);

  /* ------------------------------------------------------------------
     4. fixedContributionClass — 6 kelas TETAP, batas tidak tumpang tindih
     ------------------------------------------------------------------ */
  assert.strictEqual(fixedContributionClass(null), -1);
  assert.strictEqual(fixedContributionClass(0.02), 0, 'tepat di batas kelas 1 salah kelas');
  assert.strictEqual(fixedContributionClass(0.021), 1,
    'sedikit di atas batas kelas 1 seharusnya sudah masuk kelas 2');
  assert.strictEqual(fixedContributionClass(0.04), 1);
  assert.strictEqual(fixedContributionClass(0.08), 3);
  assert.strictEqual(fixedContributionClass(1), 4);
  assert.strictEqual(fixedContributionClass(1.5), 5, 'lebih dari 1% seharusnya kelas ke-6');
  assert.strictEqual(KONTRIBUSI_TETAP.length, 5, 'lima ambang untuk enam kelas');

  /* ------------------------------------------------------------------
     5. Reference Gap / Ratio — terhadap benchmark yang DIBERIKAN
     ------------------------------------------------------------------ */
  assert.ok(Math.abs(referenceGap(0.42, 1) - (-0.58)) < 1e-9);
  assert.ok(Math.abs(referenceRatio(0.42, 1) - 42) < 1e-9);

  // Benchmark BUKAN hardcode 1% — ganti jadi 1,5% harus mengubah hasilnya.
  assert.ok(Math.abs(referenceGap(0.42, 1.5) - (-1.08)) < 1e-9);
  assert.ok(Math.abs(referenceRatio(0.42, 1.5) - 28) < 1e-9);

  assert.strictEqual(referenceGap(null, 1), null);
  assert.strictEqual(referenceRatio(0.42, 0), null,
    'benchmark nol seharusnya tidak menghasilkan Infinity');

  console.log('OK sales-stats — kontribusi dihitung per kota (bukan global), total ' +
    'nol menghasilkan null, kelas interval tetap tidak tumpang tindih, Selisih/Rasio ' +
    'mengikuti benchmark yang diberikan');
}

test().catch((error) => {
  console.error(error);
  process.exit(1);
});
