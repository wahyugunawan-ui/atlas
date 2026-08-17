/**
 * Hitung rasio jangkauan dan simpan ke database: `npm run seed-coverage`
 *
 * Dijalankan sekali setelah outlet punya koordinat, dan diulang kalau daftar radius di
 * backend/server/coverage-store.js berubah. Menyunting koordinat satu outlet lewat aplikasi
 * TIDAK perlu menjalankan ini — outlet itu dihitung ulang sendiri saat disimpan.
 */
const { config } = require('../backend/server/config');
const store = require('../backend/server/db');
const coverage = require('../backend/server/coverage-store');
const repo = require('../backend/server/repository');

async function main() {
  await store.open(config);
  const db = store.db();

  const outlets = await store.one(db,
    'SELECT COUNT(*) AS total, SUM(CASE WHEN lat IS NULL THEN 1 ELSE 0 END) AS tanpa FROM outlets');
  if (!outlets.total) {
    console.error('\n  Belum ada outlet. Jalankan impor dulu:');
    console.error('  npm run import -- <berkas> <YYYY-MM>\n');
    process.exit(1);
  }
  if (outlets.tanpa) {
    console.log(`\n  ${outlets.tanpa} outlet belum punya koordinat dan tidak akan`);
    console.log('  punya jangkauan sama sekali. Pin dulu di halaman Master Pos Dealer.');
  }

  console.log('');
  const started = Date.now();
  const hasil = await coverage.rebuild(config, null, (pesan) => console.log('  ' + pesan));

  console.log('');
  console.log('  outlet dihitung  :', hasil.outlets);
  console.log('  baris jangkauan  :', hasil.rows);
  console.log('  waktu            :', ((Date.now() - started) / 1000).toFixed(1), 'detik');
  console.log('');

  // Pemeriksaan kewarasan. Kalau SEMUA outlet 0% atau SEMUA 100%, hitungannya tidak
  // pernah jalan — itu gejala yang persis muncul di versi lama, dan angka seragam
  // jauh lebih berbahaya daripada error karena tampak seperti temuan.
  const data = await coverage.all();
  const sales = (await repo.summary()).sales;
  const perOutlet = {};
  sales.forEach((r) => { (perOutlet[r.outlet] ||= []).push(r); });

  const bagian = Object.keys(perOutlet).map((code) => {
    let inside = 0;
    let total = 0;
    perOutlet[code].forEach((r) => {
      inside += r.units * ((data[coverage.DEFAULT_RADIUS_M][code] || {})[r.village] || 0);
      total += r.units;
    });
    return { code, pct: total ? (inside / total) * 100 : 0, total };
  }).sort((a, b) => a.pct - b.pct);

  coverage.RADII_M.forEach((r) => {
    let inside = 0;
    let total = 0;
    sales.forEach((row) => {
      inside += row.units * ((data[r][row.outlet] || {})[row.village] || 0);
      total += row.units;
    });
    console.log(`  ${String(r / 1000).padStart(2)} km: ` +
      `${(inside / total * 100).toFixed(1)}% penjualan dalam jangkauan` +
      (r === coverage.DEFAULT_RADIUS_M ? '   <- acuan' : ''));
  });

  if (bagian.length) {
    console.log('');
    console.log('  outlet terendah  :', bagian[0].code, bagian[0].pct.toFixed(1) + '%');
    console.log('  outlet tertinggi :', bagian[bagian.length - 1].code,
      bagian[bagian.length - 1].pct.toFixed(1) + '%');
    if (bagian[0].pct === bagian[bagian.length - 1].pct) {
      console.error('');
      console.error('  PERIKSA: semua outlet punya persentase yang sama.');
      console.error('  Itu gejala hitungan yang tidak pernah jalan, bukan temuan.');
    }
  }
  console.log('');
  await store.close();
}

main().catch((error) => {
  console.error('\n  GAGAL:', error.message, '\n');
  process.exit(1);
});
