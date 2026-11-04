/**
 * Panel kiri (2026-11-04): summary kabupaten/kecamatan, daftar dealer berwarna, Detail ring
 * yang bisa diklik, komposisi ring per dealer, dan kontribusi kabupaten ke karesidenan.
 * Diuji lewat keluaran modul sebenarnya, tanpa database dan tanpa browser.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = (name) => pathToFileURL(path.join(__dirname, '../frontend/js', name)).href;

const elements = {};
const kelas = {};
for (const id of ['map-shell', 'kelurahanDetailPanel', 'kelurahanDetailBack', 'kelurahanDetailTitle',
  'kelurahanDetailMeta', 'kelurahanDetailJenis', 'kelurahanDetailList', 'kelurahanDetailSummary',
  'ringkas-utama', 'fs-ringkas-utama', 'district-trend-chart']) {
  kelas[id] = new Set();
  elements[id] = { innerHTML: '', textContent: '', classList: {
    add: (...c) => c.forEach((x) => kelas[id].add(x)),
    remove: (...c) => c.forEach((x) => kelas[id].delete(x)),
    toggle() {}, contains: (c) => kelas[id].has(c) } };
}
global.document = { getElementById: (id) => elements[id] || null, addEventListener() {} };
let renders = 0;
global.window = { syncGroupControls() {}, renderAll() { renders++; } };
global.requestAnimationFrame = (fn) => fn();
global.ApexCharts = class { render() {} destroy() {} };

(async () => {
  const { S, makeFilter } = await import(url('state.js'));
  const filters = await import(url('filters.js'));
  const stats = await import(url('sales-stats.js'));
  const tables = await import(url('tables.js'));
  const { pageFilters } = filters;

  /* --- 1. kontribusi kabupaten ke karesidenan (murni) --- */
  const kotaDealer = { A: '34.04', B: '34.04', C: '34.71', Z: '33.01' };
  const baris = [
    { dealer: 'A', units: 30 }, { dealer: 'B', units: 10 },
    { dealer: 'C', units: 60 }, { dealer: 'Z', units: 500 },
  ];
  const yogya = ['34.04', '34.71', '34.02', '34.01', '34.03'];
  assert.equal(stats.cityContributionToRegion(baris, '34.04', yogya, (d) => kotaDealer[d]), 40,
    'Sleman 40 dari 100 unit Kares Yogyakarta; dealer kares lain tidak boleh ikut penyebut');
  assert.equal(stats.cityContributionToRegion(baris, '33.01', yogya, (d) => kotaDealer[d]), null,
    'kabupaten di luar region harus null, bukan angka');
  assert.equal(stats.cityContributionToRegion([], '34.04', yogya, (d) => kotaDealer[d]), null,
    'tanpa penjualan harus null, bukan 0%');

  /* --- 2. satu aturan kategori untuk persentase dan sorotan peta --- */
  const ringMap = { K1: 1, K2: 2 };
  const info = { cityCode: '34.04', cityOfDistrict: (k) => ({ K1: '34.04', K2: '34.04', K3: '34.04', K4: '33.01', K5: '33.01' })[k],
    tolerated: new Set(['K5']) };
  const rowsDealer = [
    { district: 'K1', units: 5 }, { district: 'K2', units: 4 }, { district: 'K3', units: 3 },
    { district: 'K4', units: 2 }, { district: 'K5', units: 1 },
  ];
  const split = stats.dealerRingSplit(rowsDealer, ringMap, info);
  for (const kategori of [1, 2, 3, 'others', 'violation']) {
    const kec = stats.districtsInRingCategory(['K1', 'K2', 'K3', 'K4', 'K5'], kategori, ringMap, info);
    const unit = rowsDealer.filter((r) => kec.has(r.district)).reduce((s, r) => s + r.units, 0);
    assert.equal(unit, split.units[kategori], `kecamatan tersorot kategori ${kategori} tidak cocok dengan persentasenya`);
  }
  assert.deepEqual([...stats.districtsInRingCategory(['K1', 'K2', 'K3', 'K4', 'K5'], 'violation', ringMap, info)], ['K4']);

  /* --- 3. komposisi ring per dealer, urut tertinggi --- */
  const perKategori = stats.dealersByRingCategory(new Map([
    ['A', [{ district: 'K4', units: 2 }]], ['B', [{ district: 'K4', units: 7 }, { district: 'K1', units: 1 }]],
  ]), () => ({ ringMap, info }));
  assert.deepEqual(perKategori.violation, [{ code: 'B', units: 7 }, { code: 'A', units: 2 }],
    'pelanggaran harus urut dari yang tertinggi');
  assert.deepEqual(perKategori[1], [{ code: 'B', units: 1 }]);
  assert.deepEqual(perKategori[3], [], 'dealer tanpa unit di kategori tidak boleh ikut');

  /* --- 4. summary kabupaten --- */
  Object.assign(pageFilters(), makeFilter());
  Object.assign(S, { layersReady: false, navigationHistory: [], realOutlets: [],
    registry: { order: ['D1', 'D2', 'D3'], colors: {} },
    districtByCode: {
      KA: { code: 'KA', name: 'Mlati', cityCode: '34.04', cityName: 'Sleman' },
      KB: { code: 'KB', name: 'Depok', cityCode: '34.04', cityName: 'Sleman' },
      KC: { code: 'KC', name: 'Kotagede', cityCode: '34.71', cityName: 'Kota Yogyakarta' },
    },
    allDistrictByCode: {},
    cityNames: { '34.04': 'Sleman', '34.71': 'Kota Yogyakarta' },
    dealers: [{ code: 'D1', name: 'Dealer Satu', cityCode: '34.04', districtCode: 'KA' },
      { code: 'D2', name: 'Dealer Dua', cityCode: '34.04', districtCode: 'KB' },
      { code: 'D3', name: 'Dealer Tiga', cityCode: '34.71', districtCode: 'KC' }],
    dealerNames: { D1: 'Dealer Satu', D2: 'Dealer Dua', D3: 'Dealer Tiga' },
    dealerRings: { D1: { KA: 1 }, D2: { KB: 1 }, D3: { KC: 1 } }, dealerBorder: {},
    sales: [
      { period: '2026-08', district: 'KA', dealer: 'D1', outlet: 'P1', units: 10 },
      { period: '2026-08', district: 'KC', dealer: 'D1', outlet: 'P1', units: 30 },
      { period: '2026-08', district: 'KB', dealer: 'D2', outlet: 'P2', units: 20 },
      { period: '2026-08', district: 'KC', dealer: 'D3', outlet: 'P3', units: 40 },
    ],
  });
  S.dealerByCode = Object.fromEntries(S.dealers.map((d) => [d.code, d]));
  S.outletByCode = {};
  elements.kelurahanDetailSummary.innerHTML = '<div>TUNAS DWIPA sisa kartu dealer</div>';
  filters.setScope('kota', '34.04', true);
  tables.openCitySummary('34.04');
  const html = elements.kelurahanDetailList.innerHTML;
  assert.equal(elements.kelurahanDetailSummary.innerHTML, '', 'kartu dealer lama masih tampil di atas nama kabupaten');
  assert.equal(elements.kelurahanDetailJenis.textContent, 'Kabupaten');
  assert.equal(elements.kelurahanDetailTitle.textContent, 'Sleman');
  assert.ok(kelas.kelurahanDetailPanel.has('blok-kab') && !kelas.kelurahanDetailPanel.has('blok-kec'),
    'garis warna panel kabupaten salah');
  assert.doesNotMatch(elements.kelurahanDetailMeta.textContent, /dealer terdaftar|berpenjualan/);
  assert.doesNotMatch(html, /Distribusi Posisi Relatif/, 'section distribusi masih ada');
  assert.doesNotMatch(html, /Rata-rata Kontribusi/);
  // Sleman (D1 10+30, D2 20 = 60) dari Kares Yogyakarta (60 + D3 40 = 100) = 60%, walau
  // filter Kabupaten Sleman sedang aktif (penyebut tidak boleh ikut disaring).
  assert.match(html, /Kontribusi Penjualan ke Karesidenan Yogyakarta[\s\S]*?60[,.]00%/);
  // Daftar dealer: tombol data-aksi berwarna, judul hover, Detail sebaris dengan persen.
  assert.match(html, /data-aksi="dealer" data-dealer="D1"[^>]*style="color:#/, 'nama dealer tidak berwarna titiknya');
  assert.doesNotMatch(html, /onclick="applyScope\('dealer'/, 'kode dealer masih masuk string JS onclick');
  assert.match(html, /title="Total penjualan"/);
  assert.match(html, /title="Persentase kontribusi dealer ke kabupaten"/);
  assert.match(html, /<summary[^>]*>[\s\S]*?Detail[\s\S]*?66[,.]67%<\/span>\s*<\/summary>/, 'Detail tidak sebaris dengan persentase');
  assert.match(html, /data-aksi="ring" data-dealer="D1" data-kategori="1"/, 'baris Detail ring tidak bisa diklik');
  // Komposisi Ring Dealer: tiap baris membuka daftar dealer.
  assert.match(html, /<details class="ring-baris[\s\S]*?Ring 1[\s\S]*?Dealer Dua[\s\S]*?20/);

  /* --- 5. klik baris Detail ring -> dealer + sorotan kategori --- */
  renders = 0;
  filters.focusDealerRing('D1', 'violation');
  assert.equal(filters.scopeValue('dealer'), 'D1');
  assert.deepEqual(S.ringView, { mode: 'dealer-ring', value: 'violation' });
  assert.ok(renders > 0, 'peta tidak digambar ulang');
  assert.deepEqual([...filters.mapViewDistricts()], ['KC'],
    'Pelanggaran Wilayah D1 (Sleman) = kecamatan Kota Yogyakarta');
  filters.focusDealerRing('D1', '2');
  assert.deepEqual(S.ringView.value, 2, 'kategori angka dari data-* harus jadi angka');
  filters.focusDealerRing('D1', 'apa saja');
  assert.deepEqual(S.ringView.value, 2, 'kategori tak dikenal harus diabaikan');

  /* --- 6. tombol X melepas kecamatan dulu, lalu kabupaten --- */
  Object.assign(pageFilters(), makeFilter());
  filters.selectDistrictFromMap('KA');
  assert.deepEqual([pageFilters().cityCode, pageFilters().districtCode], ['34.04', 'KA']);
  tables.closeDistrictDetail();
  assert.deepEqual([pageFilters().cityCode, pageFilters().districtCode], ['34.04', 'ALL'],
    'X pada panel kecamatan harus kembali ke summary kabupaten');
  tables.closeDistrictDetail();
  assert.equal(pageFilters().cityCode, 'ALL', 'X pada summary kabupaten harus melepas kabupaten');

  console.log('OK panel-kiri — kontribusi ke karesidenan, satu aturan kategori ring untuk angka dan sorotan, ' +
    'komposisi ring per dealer urut, summary kabupaten bersih, dealer berwarna via data-*, X melepas bertahap');
})().catch((error) => { console.error(error); process.exitCode = 1; });
