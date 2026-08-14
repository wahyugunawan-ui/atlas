/**
 * Jalankan semua tes: `npm test`.
 *
 * Sengaja tidak memakai framework. Tiap berkas *.test.js adalah program Node biasa
 * yang keluar dengan kode bukan-nol kalau gagal — bisa dijalankan sendiri-sendiri
 * waktu sedang memperbaiki satu hal, tanpa menghafal perintah runner.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const files = fs.readdirSync(__dirname)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    failed++;
    console.error(`GAGAL: ${file}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} berkas tes lolos`);
process.exit(failed ? 1 : 0);
