/** Panel diuji lewat keluaran DOM modul sebenarnya, tanpa database. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = (name) => pathToFileURL(path.join(__dirname, '../frontend/js', name)).href;
const elements = {};
for (const id of ['map-shell', 'kelurahanDetailPanel', 'kelurahanDetailBack',
  'kelurahanDetailTitle', 'kelurahanDetailMeta', 'kelurahanDetailList',
  'kelurahanDetailSummary', 'ringkas-utama', 'fs-ringkas-utama', 'fs-ring-stats', 'district-trend-chart']) {
  elements[id] = { innerHTML: '', textContent: '', classList: { add() {}, remove() {}, toggle() {} } };
}
global.document = { getElementById: (id) => elements[id] || null, addEventListener() {} };
global.window = { syncGroupControls() {} };
global.requestAnimationFrame = (fn) => fn();
let chart;
global.ApexCharts = class { constructor(el, options) { chart = options; } render() {} destroy() {} };

(async () => {
  const { S, makeFilter } = await import(url('state.js'));
  const { pageFilters, activeRows } = await import(url('filters.js'));
  const tables = await import(url('tables.js'));
  const render = await import(url('render.js'));
  Object.assign(pageFilters(), makeFilter());
  const evilName = 'Dealer <img src=x onerror=alert(1)>';
  Object.assign(S, { layersReady: false, navigationHistory: [],
    registry: { order: ['D1', 'D2'] }, realOutlets: [],
    districtByCode: {
      A: { code: 'A', name: 'Kecamatan A', cityCode: 'X', cityName: 'Kabupaten X' },
      B: { code: 'B', name: 'Kecamatan B', cityCode: 'X', cityName: 'Kabupaten X' },
    }, cityNames: { X: 'Kabupaten X' },
    dealers: [{ code: 'D1', name: evilName, cityCode: 'X' }, { code: 'D2', name: 'Dealer Dua', cityCode: 'X' }],
    dealerNames: { D1: evilName, D2: 'Dealer Dua' },
    dealerByCode: { D1: { cityCode: 'X' }, D2: { cityCode: 'X' } },
    dealerRings: { D1: { A: 1 }, D2: { B: 2 } }, dealerBorder: {},
    sales: [
      { period: '2026-08', district: 'A', dealer: 'D1', outlet: 'P1', units: 20 },
      { period: '2026-08', district: 'A', dealer: 'D2', outlet: 'P2', units: 30 },
      { period: '2026-08', district: 'B', dealer: 'D2', outlet: 'P2', units: 50 },
      { period: '2026-09', district: 'B', dealer: 'D2', outlet: 'P2', units: 100 },
    ],
  });
  tables.openDistrictDetail('A');
  const html = elements.kelurahanDetailList.innerHTML;
  assert.equal(elements.kelurahanDetailMeta.textContent, 'Kecamatan · Kabupaten X');
  assert.match(html, /Kontribusi Kecamatan ke Kabupaten/);
  assert.match(html, /Tren Kontribusi Bulanan/);
  assert.match(html, /Total Dealer/);
  assert.doesNotMatch(html, /Penjualan per Pos/);
  assert.match(html, /<summary[^>]*>Detail/);
  assert.match(html, /Dealer &lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Ring 1/);
  assert.match(html, /Pelanggaran Wilayah/);
  assert.deepEqual(chart.series[0].data, [50, 0], 'bulan tanpa penjualan tetap nol terhadap total kabupaten');
  tables.openCitySummary('X');
  assert.doesNotMatch(elements.kelurahanDetailMeta.textContent, / · X$/);
  assert.match(elements.kelurahanDetailList.innerHTML, /Dealer Dua/);
  assert.match(elements.kelurahanDetailList.innerHTML, /90[,.]00%/);
  assert.match(elements.kelurahanDetailList.innerHTML, /10[,.]00%/);
  assert.match(elements.kelurahanDetailList.innerHTML, /Pelanggaran Wilayah/);
  render.renderTopSummary(S.sales);
  assert.match(elements['ringkas-utama'].innerHTML, /Kabupaten X/);
  tables.openDistrictDetail('A');
  // openDistrictDetail mengisi Kec. = A, jadi activeRows() hanya memuat kecamatan A. Ringkasan
  // atas tetap harus memakai penyebut seluruh kabupaten, bukan 100% palsu.
  assert.equal(pageFilters().districtCode, 'A', 'klik kecamatan tidak mengisi Kec.');
  render.renderTopSummary(activeRows());
  assert.match(elements['ringkas-utama'].innerHTML, /25[,.]00%/, 'penyebut ringkasan atas hanya kecamatan itu');
  const salesTersimpan = S.sales;
  S.sales = []; // tanpa penjualan sama sekali: penyebut kontribusi nol
  render.renderTopSummary([]);
  S.sales = salesTersimpan;
  assert.match(elements['ringkas-utama'].innerHTML, /Data belum tersedia/, 'tanpa pembagi tidak boleh mengklaim kontribusi nol');
  console.log('OK panel-ui — judul tanpa kode, kontribusi %, daftar dealer+Detail ring, nama ter-escape, summary mengikuti panel');
})().catch((error) => { console.error(error); process.exitCode = 1; });
