/**
 * Pindahkan data dari MySQL ke PostgreSQL: `npm run migrate-mysql`
 *
 * Sekali jalan, saat pindah dari versi MySQL. Setelah datanya di Postgres dan sudah
 * diperiksa, skrip ini, paket mysql2, dan variabel MYSQL_* di .env boleh dibuang.
 *
 * Aman diulang: tiap tabel dikosongkan dulu sebelum diisi, jadi menjalankan dua kali
 * tidak menggandakan apa pun. Urutan tabel mengikuti foreign key — outlets sebelum
 * sales, kalau tidak Postgres menolak barisnya.
 *
 * Tabel `coverage` SENGAJA tidak ikut. Dia dihitung ulang oleh PostGIS lewat
 * `npm run seed-coverage` — itu justru inti kepindahan ini. Menyalin rasio lama
 * berarti membawa serta angka hasil sampling yang mau digantikan.
 */
const mysql = require('mysql2/promise');
const { config } = require('../src/server/config');
const store = require('../src/server/db');

const BATCH = 500;

// Kolom disebut satu per satu, tidak SELECT *. Kalau suatu saat urutan kolom di salah
// satu sisi berubah, yang terjadi harus error — bukan data yang masuk ke kolom salah.
//
// `imports.id` tidak ikut: kolomnya GENERATED ALWAYS AS IDENTITY di Postgres dan
// nomornya tidak dipakai sebagai rujukan dari mana pun.
const TABLES = [
  ['villages', ['village_code', 'village_name', 'district_code', 'district_name',
    'city_code', 'city_name', 'province_code', 'lat', 'lng']],
  ['outlets', ['outlet_code', 'outlet_name', 'dealer_code', 'dealer_name',
    'address', 'lat', 'lng', 'updated_at']],
  ['sales', ['period', 'village_code', 'outlet_code', 'quantity']],
  ['unmatched', ['period', 'city_code', 'district_name', 'village_name', 'row_count']],
  ['imports', ['started_at', 'finished_at', 'ip', 'file_name', 'period',
    'rows_read', 'rows_used', 'new_outlets', 'result', 'message']],
];

const CUSTOMER_TABLES = [
  ['customers', ['id', 'period', 'village_code', 'outlet_code', 'name', 'address']],
  ['access_log', ['at', 'ip', 'village_code', 'row_count']],
];

function mysqlOptions(database) {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || '',
    password: process.env.MYSQL_PASSWORD || '',
    database,
    decimalNumbers: true,
    dateStrings: true,
  };
}

async function copyTable(source, target, name, columns) {
  const [rows] = await source.query(`SELECT ${columns.join(', ')} FROM ${name}`);
  for (let i = 0; i < rows.length; i += BATCH) {
    const values = rows.slice(i, i + BATCH)
      .map((row) => columns.map((c) => (row[c] === undefined ? null : row[c])));
    const bulk = store.bulkValues(values);
    await target.query(
      `INSERT INTO ${name} (${columns.join(', ')}) VALUES ${bulk.text}`, bulk.params);
  }
  const written = (await store.one(target, `SELECT COUNT(*) AS n FROM ${name}`)).n;
  const mark = written === rows.length ? ' ' : ' <- TIDAK SAMA';
  console.log(`  ${name.padEnd(12)} ${String(rows.length).padStart(7)} -> ` +
    `${String(written).padStart(7)}${mark}`);
  return written === rows.length;
}

/** Sambung ke MySQL, atau null kalau databasenya memang tidak ada. */
async function openMysql(database) {
  try {
    const conn = await mysql.createConnection(mysqlOptions(database));
    await conn.query('SELECT 1');
    return conn;
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env.MYSQL_USER) {
    console.error('\n  MYSQL_USER belum ada di .env.');
    console.error('  Skrip ini butuh kredensial MySQL yang lama sebagai sumber.\n');
    process.exit(1);
  }

  const source = await openMysql(process.env.MYSQL_DATABASE || 'astra');
  if (!source) {
    console.error('\n  Tidak bisa menghubungi MySQL.');
    console.error('  Nyalakan dulu servernya — datanya masih di sana, bukan di sini.\n');
    process.exit(1);
  }

  await store.open(config);
  let ok = true;

  console.log('\n  astra (tanpa PII)');
  // Dikosongkan terbalik dari urutan pengisian: anak sebelum induk, kalau tidak
  // foreign key menolak DELETE FROM outlets selagi sales masih menunjuk ke sana.
  // coverage ikut dikosongkan meski tidak diisi — isinya milik data lama.
  await store.run(store.db(), 'DELETE FROM coverage');
  for (const [name] of [...TABLES].reverse()) {
    await store.run(store.db(), `DELETE FROM ${name}`);
  }
  for (const [name, columns] of TABLES) {
    ok = await copyTable(source, store.db(), name, columns) && ok;
  }
  await source.end();

  const pii = await openMysql(process.env.MYSQL_DATABASE_CUSTOMERS || 'astra_customers');
  if (!pii) {
    console.log('\n  astra_customers: dilewati, database PII lama tidak ada');
  } else {
    const customers = await store.ensureCustomers(config);
    console.log('\n  astra_customers (PII)');
    for (const [name] of CUSTOMER_TABLES) {
      await store.run(customers, `DELETE FROM ${name}`);
    }
    for (const [name, columns] of CUSTOMER_TABLES) {
      ok = await copyTable(pii, customers, name, columns) && ok;
    }
    await pii.end();
  }

  console.log('');
  if (!ok) {
    console.error('  Ada tabel yang jumlahnya tidak sama. JANGAN matikan MySQL.\n');
    process.exitCode = 1;
  } else {
    console.log('  Semua tabel jumlahnya sama.');
    console.log('  Lanjutkan: npm run seed-regions  (memasukkan poligon)');
    console.log('             npm run seed-coverage (menghitung ulang dengan PostGIS)\n');
  }
  await store.close();
}

main().catch((error) => {
  console.error('\n  GAGAL:', error.message, '\n');
  process.exit(1);
});
