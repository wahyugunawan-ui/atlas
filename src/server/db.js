/**
 * Lapisan database. PostgreSQL 17 + PostGIS lewat paket `pg`.
 *
 * Dua DATABASE, bukan satu:
 *   astra            data bisnis + geometri kelurahan, boleh di-backup bebas
 *   astra_customers  PII; DROP DATABASE itu, fiturnya mati, sisanya jalan penuh
 *
 * Kalau database konsumen tidak ada atau tidak bisa diakses, `customers()`
 * mengembalikan null dan pemanggilnya harus menanganinya. Bukan error — itu keadaan
 * yang sah, dan justru cara mencabut PII.
 *
 * PostGIS-nya yang membuat Postgres dipilih: rasio jangkauan dihitung dengan
 * ST_Intersection/ST_Area di database, eksak, bukan diperkirakan dengan sampling.
 */
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const SCHEMA_VERSION = 1;

let main = null;
let customerPool = null;

/**
 * `pg` mengembalikan bigint dan numeric sebagai STRING supaya presisinya tidak hilang.
 * Buat kami itu justru merusak: COUNT(*) dan SUM(quantity) jadi teks, lalu `'3' + '4'`
 * menghasilkan `'34'` di frontend — tanpa satu pun error, angkanya cuma salah.
 *
 * Jumlah unit motor dan jumlah baris tidak akan pernah mendekati batas presisi Number,
 * jadi menukarnya dengan angka sungguhan adalah pilihan yang benar. Persis jebakan yang
 * sama pernah muncul di MySQL lewat DECIMAL; di sini penyebabnya OID yang berbeda tapi
 * akibatnya identik.
 *
 * 20 = INT8/bigint, 1700 = numeric.
 */
pg.types.setTypeParser(20, (value) => (value === null ? null : Number(value)));
pg.types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));

/**
 * Ubah placeholder gaya `?` jadi gaya Postgres `$1, $2, ...`.
 *
 * Ada supaya ~60 titik query di repository, importer, dan skrip tidak perlu ditulis
 * ulang satu per satu waktu pindah dari MySQL — penulisan ulang sebanyak itu tidak
 * menambah apa pun selain kesempatan salah ketik yang tidak terdeteksi.
 *
 * Tanda tanya di dalam string literal dan komentar dilewati. Tanpa itu, sebuah `?` di
 * dalam teks akan ikut dinomori dan jumlah parameternya bergeser — dan gejalanya
 * muncul jauh dari sebabnya.
 */
function toPositional(sql) {
  if (!sql.includes('?')) return sql;

  let out = '';
  let n = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];

    if (c === "'" || c === '"') {
      // String literal atau nama berkutip: disalin apa adanya sampai penutupnya.
      // Kutip ganda di dalamnya ('' atau "") adalah escape, bukan penutup.
      const quote = c;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) { j += 2; continue; }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (c === '?') { n++; out += '$' + n; i++; continue; }

    out += c;
    i++;
  }
  return out;
}

/**
 * Susun daftar VALUES borongan: `($1,$2),($3,$4)` beserta parameternya yang sudah
 * diratakan.
 *
 * MySQL menerima `VALUES ?` dengan larik-dari-larik; Postgres tidak punya padanannya,
 * jadi barisnya disusun di sini. Dipakai semua penulisan borongan — impor, seed
 * kelurahan, dan pemindahan data.
 *
 * @param {Array<Array>} rows  larik baris, tiap baris larik nilai
 * @param {number} offset      nomor parameter yang sudah terpakai sebelumnya
 */
function bulkValues(rows, offset) {
  let n = offset || 0;
  const groups = rows.map((row) => `(${row.map(() => `$${++n}`).join(',')})`);
  return { text: groups.join(','), params: rows.flat() };
}

/**
 * Setelan koneksi yang dipakai semua pool.
 *
 * max 5: aplikasinya melayani 5–20 pembaca dan satu impor sekali waktu. Batas yang
 * lebih besar cuma menahan lebih banyak koneksi menganggur di server.
 */
function poolOptions(config, database) {
  return {
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database,
    max: 5,
    idleTimeoutMillis: 30000,
    // Permintaan yang menunggu koneksi lebih dari 10 detik lebih baik gagal dengan
    // pesan daripada menggantung sampai browser yang menyerah duluan.
    connectionTimeoutMillis: 10000,
  };
}

/**
 * Bungkus pool/koneksi supaya seluruh aplikasi tetap memanggil `.query(sql, params)`
 * dengan placeholder `?`, sama seperti waktu masih MySQL.
 */
function wrap(client) {
  return {
    query: (sql, params) => client.query(toPositional(sql), params || []),
    raw: client,
    end: () => client.end(),
  };
}

async function runSchema(pool, file) {
  const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
  // Skemanya cuma CREATE TABLE/INDEX, jadi pemisahan per titik koma aman — tidak ada
  // trigger atau fungsi yang memuat titik koma di dalam badannya.
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--[^\n]*$/gm, '').trim())
    .filter(Boolean);
  for (const statement of statements) {
    await pool.raw.query(statement);
  }
}

/**
 * Buka koneksi ke kedua database. Dipanggil sekali saat server start.
 *
 * @param {Object} config  dari config.js
 */
async function open(config) {
  const pool = new pg.Pool(poolOptions(config, config.dbName));
  // Pool `pg` melempar error dari koneksi menganggur ke seluruh proses. Tanpa
  // penanganan ini, satu koneksi yang diputus server akan mematikan aplikasinya.
  pool.on('error', (error) => {
    console.error('Koneksi database menganggur terputus:', error.message);
  });
  main = wrap(pool);

  try {
    await main.query('SELECT 1');
  } catch (error) {
    await main.end().catch(() => {});
    main = null;
    throw new Error(
      `Tidak bisa menghubungi PostgreSQL di ${config.dbHost}:${config.dbPort} — ${error.message}\n` +
      '  Periksa servernya jalan, dan DB_HOST/DB_USER/DB_PASSWORD di .env sudah benar.');
  }

  const postgis = await one(main, "SELECT extname FROM pg_extension WHERE extname = 'postgis'");
  if (!postgis) {
    await main.end().catch(() => {});
    main = null;
    throw new Error(
      'Database ini tidak punya ekstensi PostGIS. Jangkauan tidak bisa dihitung.\n' +
      '  Jalankan sebagai superuser: CREATE EXTENSION postgis;');
  }

  await runSchema(main, 'schema.sql');

  const row = await one(main, 'SELECT version FROM schema_version WHERE id = 1');
  const version = row ? row.version : 0;

  // Versi yang lebih BARU daripada yang dikenal aplikasi ditolak: itu berarti
  // databasenya pernah dibuka aplikasi yang lebih baru, dan menulisinya dengan yang
  // lama bisa merusak data yang belum dikenal.
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Database ini versi skema ${version}, aplikasi ini cuma mengenal ` +
      `${SCHEMA_VERSION}. Perbarui aplikasinya, jangan turunkan databasenya.`);
  }
  if (version !== SCHEMA_VERSION) {
    await run(main,
      'INSERT INTO schema_version (id, version) VALUES (1, ?) ' +
      'ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version', [SCHEMA_VERSION]);
  }

  await openCustomers(config);
  return main;
}

/**
 * Buka database konsumen kalau ada. TIDAK membuatnya kalau belum ada — server yang
 * memang tidak menyimpan PII tidak boleh diam-diam mulai menyimpannya.
 */
async function openCustomers(config) {
  const pool = new pg.Pool(poolOptions(config, config.dbNameCustomers));
  pool.on('error', () => {});
  const wrapped = wrap(pool);
  try {
    await wrapped.query('SELECT 1');
  } catch {
    await wrapped.end().catch(() => {});
    customerPool = null;
    return null;
  }
  await runSchema(wrapped, 'customers-schema.sql');
  customerPool = wrapped;
  return wrapped;
}

/**
 * Buat database konsumen kalau belum ada. Dipanggil HANYA oleh importer, waktu memang
 * ada data konsumen yang akan ditulis.
 */
async function ensureCustomers(config) {
  if (customerPool) return customerPool;

  // Membuat database butuh koneksi ke database lain; `postgres` selalu ada.
  const admin = new pg.Pool(poolOptions(config, 'postgres'));
  admin.on('error', () => {});
  try {
    const exists = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1', [config.dbNameCustomers]);
    // CREATE DATABASE tidak boleh di dalam transaksi dan tidak punya IF NOT EXISTS,
    // jadi keberadaannya diperiksa dulu.
    if (!exists.rows.length) {
      await admin.query(`CREATE DATABASE "${config.dbNameCustomers}" ENCODING 'UTF8'`);
    }
  } finally {
    await admin.end().catch(() => {});
  }
  return openCustomers(config);
}

const db = () => main;
const customers = () => customerPool;

/**
 * Jalankan fn di dalam satu transaksi, pada SATU koneksi.
 *
 * Koneksinya diambil sekali dan dioper ke fn. Itu wajib: BEGIN pada satu koneksi dan
 * INSERT pada koneksi lain dari pool tidak berada dalam transaksi yang sama, dan
 * kegagalannya tidak terlihat sampai ada yang perlu di-rollback.
 *
 * Inilah yang membuat impor aman: gagal di tengah berarti ROLLBACK, dan data bulan
 * lalu tetap utuh.
 */
async function transaction(pool, fn) {
  const client = await pool.raw.connect();
  const conn = wrap(client);
  try {
    await client.query('BEGIN');
    try {
      const result = await fn(conn);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    client.release();
  }
}

/** Ambil semua baris. */
async function all(pool, sql, params) {
  const result = await pool.query(sql, params || []);
  return result.rows;
}

/** Ambil satu baris, atau null. */
async function one(pool, sql, params) {
  const rows = await all(pool, sql, params);
  return rows.length ? rows[0] : null;
}

/** Jalankan perintah tulis. Mengembalikan info hasil (rowCount). */
async function run(pool, sql, params) {
  const result = await pool.query(sql, params || []);
  // Nama `affectedRows` dipertahankan supaya pemanggil yang sudah ada tidak berubah.
  return { affectedRows: result.rowCount, rowCount: result.rowCount, rows: result.rows };
}

async function close() {
  if (main) { await main.end().catch(() => {}); main = null; }
  if (customerPool) { await customerPool.end().catch(() => {}); customerPool = null; }
}

module.exports = {
  open, close, db, customers, ensureCustomers, openCustomers, transaction,
  all, one, run, bulkValues, toPositional, SCHEMA_VERSION,
};
