/** Perilaku revisi panel: hitungan, pilihan geografis, dan undo tanpa database. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = (file) => pathToFileURL(path.join(__dirname, '../frontend/js', file)).href;

(async () => {
  global.window = { syncGroupControls() {}, renderAll() {} };
  const { S, makeFilter } = await import(url('state.js'));
  const stats = await import(url('sales-stats.js'));
  const filters = await import(url('filters.js'));
  const districts = { A: { cityCode: 'X' }, B: { cityCode: 'X' }, C: { cityCode: 'Y' } };
  const rows = [
    { period: '2026-08', dealer: 'D1', district: 'A', units: 20 },
    { period: '2026-08', dealer: 'D2', district: 'B', units: 80 },
    { period: '2026-08', dealer: 'D2', district: 'C', units: 900 },
    { period: '2026-09', dealer: 'D1', district: 'A', units: 30 },
    { period: '2026-09', dealer: 'D2', district: 'B', units: 30 },
  ];
  assert.deepEqual(stats.districtContributionTrend(rows, 'A', districts), [
    { period: '2026-08', contribution: 20 }, { period: '2026-09', contribution: 50 },
  ], 'tren membandingkan kecamatan terhadap kabupatennya setiap bulan');
  assert.equal(stats.districtContributionTrend([], 'A', districts).length, 0);
  assert.equal(stats.districtContributionTrend([{ ...rows[0], units: 0 }], 'A', districts)[0].contribution, null);
  const breakdown = stats.dealerSalesBreakdown(rows.slice(0, 3));
  assert.deepEqual(breakdown.map((d) => [d.code, d.units, d.contribution]), [
    ['D2', 980, 98], ['D1', 20, 2],
  ]);
  assert.deepEqual(stats.dealerSalesBreakdown([]), []);

  Object.assign(S, { districtByCode: districts, navigationHistory: [],
    selectedDistrict: null, panelView: null, ringView: { mode: null, value: null },
    dealerRings: { D1: { A: 1, B: 2 } }, dealers: [], dealerByCode: {},
  });
  Object.assign(filters.pageFilters(), makeFilter());
  filters.selectDistrictFromMap('A');
  assert.equal(filters.pageFilters().districtCode, 'A');
  assert.equal(S.selectedDistrict, 'A');
  assert.deepEqual([...filters.mapViewDistricts()], ['A']);
  assert.equal(filters.undoNavigation(), true);
  assert.equal(filters.pageFilters().districtCode, 'ALL');
  assert.equal(S.selectedDistrict, null);
  assert.equal(filters.undoNavigation(), false);

  filters.selectDistrictFromMap('A');
  filters.selectDistrictFromMap('B');
  filters.undoNavigation();
  assert.equal(S.selectedDistrict, 'A', 'undo kembali satu langkah, bukan reset');
  filters.setScope('dealer', 'D1', true);
  assert.equal(filters.pageFilters().districtCode, 'ALL', 'ganti lingkup melepas kecamatan lama');
  S.ringView = { mode: 'dealer-ring', value: 2 };
  assert.deepEqual([...filters.mapViewDistricts()], ['B']);
  S.ringView.value = 3;
  assert.deepEqual([...filters.mapViewDistricts()], [], 'ring kosong menyaring semuanya');
  S.ringView = { mode: null, value: null };
  assert.equal(filters.mapViewDistricts(), null);
  S.ringView = { mode: 'dealer-ring', value: 1 };
  filters.rememberNavigation();
  S.ringView = { mode: 'dealer-ring', value: 2 };
  filters.undoNavigation();
  assert.equal(S.ringView.value, 1, 'undo memulihkan ring sebelumnya');
  console.log('OK panel-revisions — tren kontribusi per bulan/kabupaten, breakdown dealer, kecamatan peta, undo, ring kosong');
})().catch((err) => { console.error(err); process.exitCode = 1; });
