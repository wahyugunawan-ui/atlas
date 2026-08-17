/**
 * Pindahkan koordinat dan pengelompokan outlet yang sudah dikurasi:
 * `npm run seed-outlets`
 *
 * Sekali jalan. Sumbernya dua CSV dari tahap percobaan:
 *   dealer_grup.csv             kode_pos -> dealer (hasil tebakan yang sudah diperiksa)
 *   dealer_koordinat.csv        koordinat 76 outlet
 *   dealer_koordinat_tambahan.csv  4 outlet yang di-pin manual
 *
 * Hanya mengisi yang KOSONG di database. Suntingan yang dibuat lewat aplikasi tidak
 * ditimpa — kalau tidak, menjalankan skrip ini dua kali akan membatalkan perbaikan
 * yang sudah dilakukan tim.
 */
const fs = require('fs');
const path = require('path');
const { config } = require('../backend/server/config');
const { parseCsv, stripBom } = require('../backend/core/csv');
const store = require('../backend/server/db');

const SOURCE = path.join(__dirname, '..', '..', 'md-command-center-uji', 'contoh-excel');

function readCsvFile(name) {
  const file = path.join(SOURCE, name);
  if (!fs.existsSync(file)) return [];
  return parseCsv(stripBom(fs.readFileSync(file, 'utf8')));
}

async function main() {
  await store.open(config);
  const db = store.db();

  const total = (await store.one(db, 'SELECT COUNT(*) AS n FROM outlets')).n;
  if (!total) {
    console.error('\n  Tabel outlets masih kosong. Jalankan impor dulu:');
    console.error('  npm run import -- <berkas> <YYYY-MM>\n');
    process.exit(1);
  }

  // --- pengelompokan ---
  // kode_pos, nama_pos, kode_dealer, nama_dealer
  const groups = readCsvFile('dealer_grup.csv').slice(1);

  // --- koordinat ---
  const coords = {};
  ['dealer_koordinat.csv', 'dealer_koordinat_tambahan.csv'].forEach((name) => {
    readCsvFile(name).slice(1).forEach((row) => {
      const code = String(row[0] || '').trim();
      const lat = Number(row[2]);
      const lng = Number(row[3]);
      if (code && Number.isFinite(lat) && Number.isFinite(lng) && !coords[code]) {
        coords[code] = { lat, lng };
      }
    });
  });
  const now = new Date().toISOString();
  let grouped = 0;
  let pinned = 0;

  await store.transaction(db, async (conn) => {
    for (const row of groups) {
      const code = String(row[0] || '').trim();
      if (!code) continue;
      const info = await conn.query(`
        UPDATE outlets SET dealer_code = ?, dealer_name = ?, updated_at = ?
        WHERE outlet_code = ?`, [row[2].trim(), row[3].trim(), now, code]);
      if (info.rowCount) grouped++;
    }
    for (const code of Object.keys(coords)) {
      const info = await conn.query(`
        UPDATE outlets SET lat = ?, lng = ?, updated_at = ?
        WHERE outlet_code = ? AND lat IS NULL`,
      [coords[code].lat, coords[code].lng, now, code]);
      if (info.rowCount) pinned++;
    }
  });

  const stats = await store.one(db, `
    SELECT COUNT(*) AS outlets,
           COUNT(DISTINCT dealer_code) AS dealers,
           SUM(CASE WHEN lat IS NULL THEN 1 ELSE 0 END) AS unpinned
    FROM outlets`);

  console.log('');
  console.log('  outlet total     :', stats.outlets);
  console.log('  pengelompokan    :', grouped, 'diperbarui');
  console.log('  koordinat        :', pinned, 'diisi');
  console.log('  dealer            :', stats.dealers);
  console.log('  belum di-pin     :', stats.unpinned);
  console.log('');
  if (stats.unpinned) {
    (await store.all(db,
      'SELECT outlet_code, outlet_name FROM outlets WHERE lat IS NULL'))
      .forEach((o) => console.log(`      ${o.outlet_code}  ${o.outlet_name}`));
    console.log('');
  }
  await store.close();
}

main().catch((error) => {
  console.error('\n  GAGAL:', error.message, '\n');
  process.exit(1);
});
