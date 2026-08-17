/**
 * Database uji sekali pakai untuk tes yang menyentuh PostgreSQL.
 *
 * Tiap berkas tes memakai nama database sendiri (`astra_test_<label>`), jadi dua tes
 * bisa jalan bersamaan tanpa saling menimpa, dan tidak ada satu pun yang menyentuh
 * database sungguhan. Database dibuang di awal DAN di akhir: tes yang mati di tengah
 * meninggalkan sisa, dan sisa itu membuat tes berikutnya lulus karena alasan yang
 * salah.
 *
 * PostGIS-nya diwarisi dari `template1`, bukan dipasang di sini — CREATE EXTENSION
 * butuh superuser, sedangkan tes berjalan sebagai pengguna aplikasi. Dipasang sekali
 * saat menyiapkan server:
 *   psql -U postgres -d template1 -c "CREATE EXTENSION postgis;"
 *
 * Pengguna aplikasi juga butuh hak CREATEDB:
 *   ALTER ROLE astra CREATEDB;
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const pg = require('pg');

const { config } = require('../../backend/server/config');
const store = require('../../backend/server/db');

/** Koneksi ke database `postgres` — dipakai untuk CREATE/DROP DATABASE. */
async function admin() {
  const client = new pg.Client({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: 'postgres',
  });
  await client.connect();
  return client;
}

async function dropDatabases(testConfig) {
  const conn = await admin();
  try {
    // WITH (FORCE) memutus koneksi yang masih menggantung. Tanpa itu, tes yang mati
    // di tengah meninggalkan database yang tidak bisa dibuang sampai prosesnya habis.
    for (const name of [testConfig.dbName, testConfig.dbNameCustomers]) {
      await conn.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  } finally {
    await conn.end();
  }
}

/**
 * Buka database uji kosong. Folder sementara tetap dibuat — geo dan unggahan masih
 * berupa berkas, hanya databasenya yang ada di Postgres.
 *
 * Database PII SENGAJA tidak dibuat. Tes harus bisa membuktikan aplikasinya jalan
 * penuh tanpa itu, dan kalau helper ini membuatnya duluan, sifat itu tidak pernah
 * teruji.
 *
 * @param {string} label  nama pendek, jadi bagian nama database
 */
async function openTestDb(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `acc-${label}-`));
  const testConfig = {
    ...config,
    dataDir: dir,
    dbName: `astra_test_${label}`,
    dbNameCustomers: `astra_test_${label}_customers`,
  };

  await dropDatabases(testConfig);
  const conn = await admin();
  try {
    await conn.query(`CREATE DATABASE "${testConfig.dbName}" ENCODING 'UTF8'`);
  } finally {
    await conn.end();
  }

  await store.open(testConfig);
  return testConfig;
}

/** Tutup koneksi, buang database dan folder sementaranya. */
async function closeTestDb(testConfig) {
  await store.close();
  await dropDatabases(testConfig);
  fs.rmSync(testConfig.dataDir, { recursive: true, force: true });
}

/** Hapus database PII saja — meniru "cabut PII" di produksi. */
async function dropCustomerDatabase(testConfig) {
  await store.close();
  const conn = await admin();
  try {
    await conn.query(
      `DROP DATABASE IF EXISTS "${testConfig.dbNameCustomers}" WITH (FORCE)`);
  } finally {
    await conn.end();
  }
  await store.open(testConfig);
}

/**
 * Jalankan query lewat koneksi baru DI LUAR pool aplikasi.
 *
 * Ini satu-satunya cara membuktikan COMMIT benar-benar terjadi. Pool aplikasi hampir
 * selalu memakai koneksi yang sama di tes satu-utas, dan koneksi itu melihat
 * perubahannya sendiri meski transaksinya belum di-commit — jadi memeriksa lewat pool
 * akan hijau walaupun COMMIT-nya dihapus.
 */
async function queryOutsidePool(testConfig, sql, params) {
  const client = new pg.Client({
    host: testConfig.dbHost,
    port: testConfig.dbPort,
    user: testConfig.dbUser,
    password: testConfig.dbPassword,
    database: testConfig.dbName,
  });
  await client.connect();
  try {
    const result = await client.query(sql, params || []);
    return result.rows;
  } finally {
    await client.end();
  }
}

module.exports = { openTestDb, closeTestDb, dropCustomerDatabase, queryOutsidePool };
