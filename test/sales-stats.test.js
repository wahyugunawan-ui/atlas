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
    groupByCity, contributionPercent, contributionsForRows, relativePosition,
    fixedContributionClass, referenceGap, referenceRatio, KONTRIBUSI_TETAP,
    contributionsByOutlet, contributionsByVillage, businessReferenceGroup, outletRingSplit,
  } = await import(url('sales-stats.js'));
  const { percentileBreaks } = await import(url('colors.js'));

  /* ------------------------------------------------------------------
     1. groupByCity — per kota, bukan global
     ------------------------------------------------------------------ */
  const villageByCode = {
    V1: { cityCode: 'KOTA-A' },
    V2: { cityCode: 'KOTA-A' },
    V3: { cityCode: 'KOTA-B' },
    V4: { cityCode: 'KOTA-C' },
  };
  const rows = [
    { village: 'V1', units: 8 },
    { village: 'V2', units: 92 },
    { village: 'V3', units: 5 },
    { village: 'V4', units: 0 }, // kota totalnya nol -- kontribusinya tidak terdefinisi
    { village: 'TIDAK-DIKENAL', units: 999 }, // kelurahan tak dikenal, harus dilewati
  ];
  const perCity = groupByCity(rows, villageByCode);
  assert.strictEqual(perCity.size, 3, 'kelurahan tak dikenal ikut membuat kota baru');
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

  // contributionsForRows() = groupByCity() + contributionPercent() sekaligus, untuk
  // seluruh kelurahan yang muncul di rows — dipakai bersama panel DAN pewarnaan peta.
  const kontribusi = contributionsForRows(rows, villageByCode);
  assert.strictEqual(kontribusi.get('V1'), 8);
  assert.strictEqual(kontribusi.get('V2'), 92);
  assert.strictEqual(kontribusi.get('V3'), 100, 'V3 satu-satunya di KOTA-B, harus 100%');
  assert.strictEqual(kontribusi.has('V4'), false,
    'V4 di kota bertotal nol ikut masuk hasil — seharusnya dilewati, bukan NaN diam-diam');
  assert.strictEqual(kontribusi.has('TIDAK-DIKENAL'), false);

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
     4. fixedContributionClass — 5 kelas TETAP (sejak 2026-08-31), batas tidak
        tumpang tindih
     ------------------------------------------------------------------ */
  assert.strictEqual(fixedContributionClass(null), -1);
  assert.strictEqual(fixedContributionClass(0.02), 0, 'tepat di batas kelas 1 salah kelas');
  assert.strictEqual(fixedContributionClass(0.021), 1,
    'sedikit di atas batas kelas 1 seharusnya sudah masuk kelas 2');
  assert.strictEqual(fixedContributionClass(0.04), 1);
  assert.strictEqual(fixedContributionClass(0.08), 3);
  assert.strictEqual(fixedContributionClass(1), 4, 'di atas 0,08% seharusnya kelas ke-5 (top)');
  assert.strictEqual(fixedContributionClass(1.5), 4,
    'kelas ke-5 dan ke-6 lama digabung jadi satu kelas "top" di atas 0,08%');
  assert.strictEqual(KONTRIBUSI_TETAP.length, 4, 'empat ambang untuk lima kelas');

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

  /* ------------------------------------------------------------------
     6. contributionsByOutlet — relatif terhadap TOTAL SELURUH POS, bukan per kota
     ------------------------------------------------------------------ */
  const rowsPos = [
    { outlet: 'POS-1', units: 10 },
    { outlet: 'POS-2', units: 90 },
    { outlet: 'POS-3', units: 0 },
  ];
  const kontribusiPos = contributionsByOutlet(rowsPos);
  assert.strictEqual(kontribusiPos.get('POS-1'), 10);
  assert.strictEqual(kontribusiPos.get('POS-2'), 90);
  assert.strictEqual(kontribusiPos.get('POS-3'), 0);
  assert.strictEqual(contributionsByOutlet([]).size, 0,
    'tidak ada baris seharusnya tidak menghasilkan NaN/Infinity di mana pun');

  /* ------------------------------------------------------------------
     6b. contributionsByVillage — sama seperti contributionsByOutlet tapi per desa,
         relatif terhadap TOTAL rows yang dioper (bukan kotanya sendiri) — dipakai
         blok Analisis Penjualan Wilayah, basisnya SENGAJA beda dari villageStats()
     ------------------------------------------------------------------ */
  const rowsDesa = [
    { village: 'DESA-X', units: 30 },
    { village: 'DESA-Y', units: 70 },
    { village: 'DESA-Z', units: 0 },
  ];
  const kontribusiDesa = contributionsByVillage(rowsDesa);
  assert.strictEqual(kontribusiDesa.get('DESA-X'), 30);
  assert.strictEqual(kontribusiDesa.get('DESA-Y'), 70);
  assert.strictEqual(kontribusiDesa.get('DESA-Z'), 0);
  assert.strictEqual(contributionsByVillage([]).size, 0);

  /* ------------------------------------------------------------------
     7. businessReferenceGroup — kelompok dari TANDA gap, bukan ambang baru
     ------------------------------------------------------------------ */
  assert.strictEqual(businessReferenceGroup(0.5), 'Di Atas Acuan');
  assert.strictEqual(businessReferenceGroup(-0.5), 'Di Bawah Acuan');
  assert.strictEqual(businessReferenceGroup(0), 'Sesuai Acuan');
  assert.strictEqual(businessReferenceGroup(null), null);

  /* ------------------------------------------------------------------
     8. outletRingSplit — %ring 1/2/3 per DESA (bukan kecamatan), sisanya di luar ring
     ------------------------------------------------------------------ */
  const ringMap = { 'DESA-A': 1, 'DESA-B': 2, 'DESA-C': 3 };
  const rowsRing = [
    { village: 'DESA-A', units: 10 },
    { village: 'DESA-B', units: 20 },
    { village: 'DESA-C', units: 30 },
    { village: 'DESA-TANPA-RING', units: 40 },
  ];
  const split = outletRingSplit(rowsRing, ringMap);
  assert.strictEqual(split.total, 100, 'desa tanpa ring tetap ikut masuk total');
  assert.strictEqual(split.percent1, 10);
  assert.strictEqual(split.percent2, 20);
  assert.strictEqual(split.percent3, 30);
  assert.strictEqual(100 - split.percent1 - split.percent2 - split.percent3, 40,
    '%di luar ring (100 - 1 - 2 - 3) harus sama dengan porsi desa tanpa ring');
  assert.deepStrictEqual(outletRingSplit([], ringMap),
    { total: 0, percent1: 0, percent2: 0, percent3: 0 },
    'tanpa baris seharusnya nol rapi, bukan NaN dari pembagian 0/0');
  assert.deepStrictEqual(outletRingSplit(rowsRing, undefined),
    { total: 100, percent1: 0, percent2: 0, percent3: 0 },
    'outlet tanpa ring sama sekali (ringMap undefined) seharusnya semua di luar ring');

  console.log('OK sales-stats — kontribusi dihitung per kota (bukan global), total ' +
    'nol menghasilkan null, kelas interval tetap 5 kelas tidak tumpang tindih, ' +
    'Selisih/Rasio mengikuti benchmark yang diberikan, kontribusi per outlet, ' +
    'kelompok acuan bisnis, dan %ring per desa dihitung benar');
}

test().catch((error) => {
  console.error(error);
  process.exit(1);
});
