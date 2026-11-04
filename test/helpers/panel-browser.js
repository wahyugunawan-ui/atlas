/** Uji browser mandiri dengan data contoh; tidak menyentuh database atau PII. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require(path.join(process.env.USERPROFILE,
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root = path.resolve(__dirname, '../..');
const districts = ['01', '02', '03'].map((suffix, i) => ({
  code: '33.02.' + suffix, name: 'Kecamatan ' + suffix, cityCode: '33.02',
  cityName: 'Kabupaten Contoh', lat: -7.5, lng: 109.2 + i * 0.05,
}));
const dealers = ['D1', 'D2'].map((code, i) => ({ code, name: 'Dealer Contoh ' + (i + 1),
  cityCode: '33.02', districtCode: districts[i].code, lat: -7.5, lng: districts[i].lng,
  outletCount: 1 }));
const outlets = dealers.map((d, i) => ({ ...d, code: 'P' + (i + 1), dealerCode: d.code,
  name: 'Pos Contoh ' + (i + 1), dealerName: d.name }));
const sales = ['2026-08', '2026-09'].flatMap((period, month) => districts.flatMap((d, i) =>
  dealers.map((dealer, j) => ({ period, district: d.code, dealer: dealer.code,
    outlet: outlets[j].code, units: (i + 1) * (j + 1) * 10 + month * 5 }))));
const summary = { districts, allDistricts: districts, dealers, outlets, sales,
  periods: ['2026-08', '2026-09'], dealerRings: {
    D1: { [districts[0].code]: 1, [districts[1].code]: 2, [districts[2].code]: 3 },
    D2: { [districts[0].code]: 3, [districts[1].code]: 1, [districts[2].code]: 2 },
  }, dealerBorder: {}, posCoverage: {}, coverage: {}, coverageReady: true,
  hasCustomers: false, pendingNames: 0, targets: {} };
const feature = (d, village = false) => ({ type: 'Feature', properties: {
  kode: d.code + (village ? '.2001' : ''), nama: d.name, kota: d.cityName,
}, geometry: { type: 'Polygon', coordinates: [[
  [d.lng - 0.02, -7.52], [d.lng + 0.02, -7.52], [d.lng + 0.02, -7.48],
  [d.lng - 0.02, -7.48], [d.lng - 0.02, -7.52],
]] } });
const collection = (features) => ({ type: 'FeatureCollection', features });

(async () => {
  const app = express();
  app.get('/api/summary', (req, res) => res.json(summary));
  app.get('/api/v1/peta/titik', (req, res) => res.json({ rows: [] }));
  app.get('/data/kecamatan.geojson', (req, res) => res.json(collection(districts.map((d) => feature(d)))));
  app.get('/data/kelurahan.geojson', (req, res) => res.json(collection(districts.map((d) => feature(d, true)))));
  app.get('/data/kota.geojson', (req, res) => res.json(collection([])));
  app.use(express.static(path.join(root, 'frontend')));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Basemap eksternal ditiadakan dalam uji. MapLibre dan seluruh lapisan bisnis asli.
    await page.route('**/js/map.js', async (route) => {
      let source = fs.readFileSync(path.join(root, 'frontend/js/map.js'), 'utf8');
      source = source.replace("const basemapLayers = protomaps_themes_base.noLabels('protomaps', 'grayscale');",
        'const basemapLayers = [];')
        .replace("url: 'pmtiles://' + BASEMAP_PMTILES", 'tiles: []')
        .replace('tiles: [BASEMAP_SATELLITE]', 'tiles: []');
      await route.fulfill({ body: source, contentType: 'text/javascript' });
    });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => document.getElementById('pageLoader').classList.contains('hidden'));
    assert.deepEqual(errors, [], 'boot tanpa galat JavaScript');
    assert.equal(await page.locator('#nav-fusion').isVisible(), false);
    await page.locator('#dari-bulan').selectOption('08');
    await page.locator('#pilih-area .pilih-tombol').click();
    await page.locator('#pilih-area [role="option"]').filter({ hasText: 'Kecamatan 01' }).click();
    await page.waitForFunction(() => document.getElementById('kelurahanDetailTitle').textContent === 'Kecamatan 01');
    assert.equal(await page.locator('#kelurahanDetailMeta').textContent(), 'Kecamatan · Contoh');
    assert.match(await page.locator('#kelurahanDetailList').textContent(), /Total Dealer/);
    await page.locator('#kelurahanDetailList summary').first().click();
    assert.match(await page.locator('#kelurahanDetailList details[open]').textContent(), /Ring 3/);
    const firstFilter = await page.evaluate(async () => {
      const { S } = await import('/js/state.js'); return S.map.getFilter('kec-warna');
    });
    assert.ok(JSON.stringify(firstFilter).includes('33.02.01'));
    await page.locator('#btn-undo').click();
    assert.equal(await page.locator('#nilai-area').textContent(), 'Semua');
    // Klik poligon sungguhan. Hindari marker di tengah poligon.
    const point = await page.evaluate(async () => {
      const { S } = await import('/js/state.js');
      S.map.stop(); S.map.jumpTo({ center: [109.25, -7.5], zoom: 10.5 });
      const p = S.map.project([109.258, -7.49]);
      const rect = S.map.getCanvas().getBoundingClientRect();
      return { x: p.x + rect.x, y: p.y + rect.y };
    });
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(() => document.getElementById('nilai-area').textContent.includes('Kecamatan 02'));
    await page.locator('#btn-undo').click();
    // Pilih dealer memakai dropdown asli.
    await page.locator('#pilih-dealer .pilih-tombol').click();
    await page.locator('#pilih-dealer [role="option"]').filter({ hasText: 'Dealer Contoh 1' }).click();
    assert.equal(await page.locator('#panel-ring-stats-group').isVisible(), true);
    await page.evaluate(() => window.jumpFromDealer('33.02.01', 'D1'));
    await page.locator('#kelurahanDetailBack button').click();
    assert.equal(await page.locator('#nilai-area').textContent(), 'Semua', 'kembali ke dealer melepas filter kecamatan');
    assert.ok(!(await page.locator('#ringkas-utama').textContent()).includes('Kontribusi ke Kabupaten'), 'ringkasan kecamatan tidak tertinggal');
    const beforeRing = await page.locator('#panel-ring-stats').textContent();
    await page.locator('#rv-1').click();
    const ringFilter = await page.evaluate(async () => {
      const { S } = await import('/js/state.js');
      return { polygon: S.map.getFilter('kec-warna'), ktp: S.map.getFilter('ktp-titik'),
        colors: [...document.querySelectorAll('.marker-outlet')].map((el) => el.style.backgroundColor) };
    });
    assert.ok(JSON.stringify(ringFilter.polygon).includes('33.02.01'));
    assert.ok(!JSON.stringify(ringFilter.polygon).includes('33.02.02'));
    assert.ok(JSON.stringify(ringFilter.ktp).includes('33.02.01'));
    assert.equal(await page.locator('#panel-ring-stats').textContent(), beforeRing, 'basis statistik tidak mengecil ke satu ring');
    assert.equal(new Set(ringFilter.colors).size, 1);
    await page.locator('#btn-undo').click();
    const resetRing = await page.evaluate(async () => {
      const { S } = await import('/js/state.js'); return S.map.getFilter('kec-warna');
    });
    assert.ok(resetRing == null);
    assert.equal(await page.locator('#rv-1').evaluate((el) => el.classList.contains('bg-white')), false);
    await page.locator('#rv-1').click();
    await page.locator('#rv-2').click();
    await page.locator('#btn-undo').click();
    assert.equal(await page.locator('#rv-1').evaluate((el) => el.classList.contains('bg-white')), true);
    assert.equal(await page.locator('#rv-2').evaluate((el) => el.classList.contains('bg-white')), false);
    await page.evaluate(() => window.openDistrictDetail('33.02.01'));
    await page.locator('#rv-2').click();
    await page.locator('#kelurahanDetailPanel').waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
    assert.equal(await page.locator('#kelurahanDetailPanel').isVisible(), false, 'pilih ring menutup panel kecamatan lama');
    await page.locator('#btn-penuh').click();
    assert.equal(await page.locator('#fs-ring-stats-group').isVisible(), true);
    assert.equal(await page.locator('#fs-performa-grup').isVisible(), false);
    await page.locator('#btn-penuh').click();
    await page.locator('#pilih-kota .pilih-tombol').click();
    await page.locator('#pilih-kota [role="option"]').filter({ hasText: 'Contoh' }).click();
    assert.match(await page.locator('#kelurahanDetailList').textContent(), /Dealer dan Kontribusi ke Kabupaten/);
    assert.match(await page.locator('#kelurahanDetailList').textContent(), /Dealer Contoh 2/);
    assert.match(await page.locator('#kelurahanDetailList').textContent(), /Pelanggaran Wilayah/);
    assert.match(await page.locator('#ringkas-utama').textContent(), /Kabupaten/);
    assert.deepEqual(errors, [], 'interaksi tanpa galat JavaScript');
    if (process.argv[2]) await page.screenshot({ path: path.resolve(process.argv[2]), fullPage: true });
    console.log('OK panel-browser — dropdown/poligon dua arah, Detail, Undo, ring hanya terpilih, statistik stabil, warna seragam, layar penuh, nol galat JS');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
