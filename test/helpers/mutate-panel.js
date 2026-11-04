/** Mutasi terarah; selalu pulihkan sumber asli, termasuk ketika tes gagal/macat. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const cases = [
  ['pembagi tren', 'sales-stats.js', 'contributionPercent(item.units, item.total)', 'contributionPercent(item.units, item.units)', 'panel-revisions.test.js'],
  ['pembagi dealer', 'sales-stats.js', 'contribution: contributionPercent(count, total)', 'contribution: contributionPercent(count, count)', 'panel-revisions.test.js'],
  ['pilihan kecamatan', 'filters.js', "S.selectedDistrict = value === 'ALL' ? null : value;", 'S.selectedDistrict = null;', 'panel-revisions.test.js'],
  ['undo ring', 'filters.js', 'S.ringView = previous.ringView;', 'S.ringView = S.ringView;', 'panel-revisions.test.js'],
  ['saringan titik', 'map.js', "expression(codes, 'district')", "expression(codes, 'village')", 'map-revisions.test.js'],
  ['escape dealer', 'tables.js', 'esc(S.dealerNames[item.code] || item.code)', '(S.dealerNames[item.code] || item.code)', 'panel-ui.test.js'],
];
if (process.argv.includes('--browser')) cases.push(
  ['panel tertinggal', 'app.js', '    hideDetailPanel();', '    // mutasi: panel tidak ditutup', 'helpers/panel-browser.js'],
  ['kembali ke dealer', 'tables.js', '  showPanel();\n  syncFilterBar();\n  renderTopSummary(activeRows());', '  showPanel();\n  renderTopSummary(activeRows());', 'helpers/panel-browser.js'],
  ['tombol ring saat undo', 'map.js', 'const active = S.ringView.mode === mode && tombolMatches(id, S.ringView.value);', 'const active = false;', 'helpers/panel-browser.js'],
);
let caught = 0;
for (const [label, name, before, after, test] of cases) {
  const file = path.join(root, 'frontend/js', name);
  const original = fs.readFileSync(file, 'utf8');
  const normalized = original.replace(/\r\n/g, '\n');
  assert.ok(normalized.includes(before), 'sasaran mutasi tidak ditemukan: ' + label);
  let result;
  try {
    fs.writeFileSync(file, normalized.replace(before, after));
    result = spawnSync(process.execPath, [path.join(root, 'test', test)], {
      cwd: root, encoding: 'utf8', timeout: 45000,
    });
  } finally {
    fs.writeFileSync(file, original);
  }
  assert.ok(!result.error, 'tes tidak selesai: ' + label);
  assert.notEqual(result.status, 0, 'mutasi lolos: ' + label);
  assert.match(result.stdout + result.stderr, /AssertionError/, 'tes harus gagal karena sifat yang dijaga: ' + label);
  caught++;
  console.log('TERTANGKAP ' + label);
}
console.log(`OK mutasi panel — ${caught}/${cases.length} tertangkap, sumber dipulihkan`);
