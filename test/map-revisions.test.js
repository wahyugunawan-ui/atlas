const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = (file) => pathToFileURL(path.join(__dirname, '../frontend/js', file)).href;

(async () => {
  global.window = { anyGroupEditing: () => false };
  const { S, makeFilter } = await import(url('state.js'));
  const { pageFilters } = await import(url('filters.js'));
  const map = await import(url('map.js'));
  Object.assign(pageFilters(), makeFilter(), { dealerCode: 'D1' });
  S.dealerRings = { D1: { A: 1, B: 2 } };
  S.ringView = { mode: 'dealer-ring', value: 1 };
  const filters = {};
  S.layersReady = true;
  S.map = { getLayer: () => true, setFilter: (id, filter) => { filters[id] = filter; } };
  map.applyMapViewFilter();
  assert.deepEqual(filters['ktp-titik'][1], ['get', 'district']);
  for (const id of ['kec-warna', 'kec-garis', 'kec-nama', 'ktp-titik', 'servis-titik', 'kirim-titik']) {
    assert.ok(JSON.stringify(filters[id]).includes('A'), `${id} ikut disaring ring`);
    assert.ok(!JSON.stringify(filters[id]).includes('B'), `${id} tidak menampilkan ring lain`);
  }
  S.ringView.value = 3;
  map.applyMapViewFilter();
  assert.deepEqual(filters['kec-warna'], ['==', ['get', 'kode'], '']);
  S.ringView = { mode: null, value: null };
  map.applyMapViewFilter();
  assert.equal(filters['kec-warna'], null, 'melepas ring memulihkan peta');
  S.ringView = { mode: 'dealer-ring', value: 1 };
  window.anyGroupEditing = () => true;
  map.applyMapViewFilter();
  assert.equal(filters['kec-warna'], null, 'editor ring tidak membatasi kandidat kecamatan');

  const html = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(html, /id="nav-fusion"[^>]*class="[^"]*\bhidden\b/);
  assert.doesNotMatch(html, />\s*ANALISIS PENJUALAN WILAYAH\s*</i);
  assert.match(html, /onclick="undoFilters\(\)"/);
  assert.match(html, /id="fs-ring-stats"/);
  const colorSource = fs.readFileSync(path.join(__dirname, '../frontend/js/outlets.js'), 'utf8');
  assert.equal((colorSource.match(/el\.style\.background = '#0b2f6b'/g) || []).length, 2);
  console.log('OK map-revisions — ring menyaring lapisan analisis, ring kosong, pulihkan/editor, Fusion tersembunyi, Undo, warna marker seragam');
})().catch((error) => { console.error(error); process.exitCode = 1; });
