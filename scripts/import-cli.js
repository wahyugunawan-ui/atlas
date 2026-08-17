/**
 * Impor dari terminal: `npm run import -- <berkas> <YYYY-MM> [--konsumen]`
 *
 * Jalur yang sama dengan tombol upload di web — importer.js yang itu juga. Ada untuk
 * mengisi data pertama kali dan untuk memeriksa masalah tanpa menyalakan server.
 */
const fs = require('fs');
const { config } = require('../backend/server/config');
const store = require('../backend/server/db');
const { runImport } = require('../backend/server/importer');

async function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  const period = args[1];
  const withCustomers = args.includes('--konsumen');

  if (!file || !/^\d{4}-\d{2}$/.test(period || '')) {
    console.error('\n  Pakai: npm run import -- <berkas.xlsx> <YYYY-MM> [--konsumen]');
    console.error('  Contoh: npm run import -- data/agustus.xlsx 2026-08 --konsumen\n');
    console.error('  --konsumen menyimpan nama dan alamat konsumen ke database astra_customers.');
    console.error('  Tanpa itu, tidak ada satu pun PII yang masuk ke server.\n');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`\n  Berkas tidak ada: ${file}\n`);
    process.exit(1);
  }

  await store.open(config);
  console.log(`\n  Mengimpor ${file} sebagai periode ${period}...`);
  if (withCustomers) {
    console.log('  Data konsumen IKUT disimpan (nama dan alamat) ke database astra_customers.');
  }

  try {
    const result = await runImport({
      file, period, fileName: file, ip: 'cli', withCustomers, config,
    });

    console.log('');
    console.log('  baris dibaca     :', result.rowsRead);
    console.log('  baris terpakai   :', result.rowsUsed,
      `(${(result.rowsUsed / result.rowsRead * 100).toFixed(1)}%)`);
    console.log('  baris penjualan  :', result.salesRows);
    console.log('  outlet baru      :', result.newOutlets.length);
    console.log('  nama belum cocok :', result.unmatched.length);
    if (result.unmatched.length) {
      result.unmatched.slice(0, 8).forEach((u) => {
        console.log(`      ${u.villageName} (${u.districtName}, ${u.cityCode}) — ${u.count} baris`);
      });
      if (result.unmatched.length > 8) {
        console.log(`      ... dan ${result.unmatched.length - 8} lagi`);
      }
    }
    if (withCustomers) console.log('  konsumen ditulis :', result.customers);
    console.log('');

    if (result.newOutlets.length) {
      console.log('  Outlet baru dikelompokkan dengan menebak dari namanya. Periksa di');
      console.log('  halaman Master Pos Dealer sebelum dipakai untuk mengambil keputusan.\n');
    }
  } catch (error) {
    console.error('\n  GAGAL:', error.message, '\n');
    process.exitCode = 1;
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error('\n  GAGAL:', error.message, '\n');
  process.exit(1);
});
