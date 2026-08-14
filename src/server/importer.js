/**
 * Impor berkas bulanan dari Astra.
 *
 * Alurnya: baca berkas -> agregasi (logika murni di src/core) -> tulis dalam SATU
 * transaksi. Gagal di tengah berarti ROLLBACK dan data bulan lalu tetap utuh.
 *
 * Impor ulang periode yang sama menghasilkan keadaan yang sama, bukan dobel: baris
 * periode itu dihapus dulu di dalam transaksi yang sama. Ini aturan idempoten di
 * CLAUDE.md, sekarang dijaga database, bukan kehati-hatian.
 *
 * Nama dan alamat konsumen hanya dibaca kalau `withCustomers` dinyalakan, dan
 * hasilnya masuk ke database astra_customers — terpisah, bisa di-DROP kapan saja.
 */
const fs = require('fs');
const path = require('path');
const { parseCsv, stripBom } = require('../core/csv');
const { COLUMN, aggregate } = require('../core/aggregate');
const { regionKey } = require('../core/region');
const { resolveGroups } = require('../core/grouping');
const store = require('./db');

/**
 * Ejaan kecamatan di Excel yang berbeda dari referensi BPS.
 *
 * Tempat sementara. Yang benar, baris seperti ini disunting tim lewat halaman master
 * wilayah — tapi selama daftarnya cuma dua, membuat halaman untuk itu adalah kerja
 * yang lebih besar daripada masalahnya.
 */
const DISTRICT_ALIASES = {
  '33.04|PURWAREJA KLAMPOK': 'Purworeja Klampok',
  '33.02|BATURADEN': 'Baturraden',
};

/**
 * Kunci sekali-jalan.
 *
 * ponytail: hanya berlaku dalam satu proses. Yang menjaga integritas data adalah
 * transaksi di bawah, bukan kunci ini — kunci ini soal pesan error yang bisa
 * dimengerti orang non-IT, bukan menunggu sampai database timeout.
 */
let running = false;

/**
 * Baris per INSERT borongan.
 *
 * Menulis 18 ribu baris satu per satu lewat jaringan memakan menit; borongan 500 baris
 * memakan detik. Batasnya bukan ketakutan pada angka besar — Postgres membatasi satu
 * pernyataan pada 65.535 parameter, dan satu INSERT raksasa akan ditolak. Dengan 8
 * kolom, 500 baris memakai 4.000 parameter: jauh di bawah batas, tetap cepat.
 */
const BATCH = 500;

const isRunning = () => running;

/** Baca .xlsx jadi array of array. Sheet pertama, apa adanya. */
async function readXlsx(file) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Berkas Excel tidak punya sheet sama sekali.');

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    // row.values berindeks 1; kolom kosong di tengah harus tetap jadi slot supaya
    // indeks COLUMN tidak bergeser.
    for (let i = 1; i <= sheet.columnCount; i++) {
      const cell = row.getCell(i).value;
      values.push(cell == null ? '' : String(
        typeof cell === 'object' && cell.text !== undefined ? cell.text : cell).trim());
    }
    rows.push(values);
  });
  return rows;
}

function readCsv(file) {
  return parseCsv(stripBom(fs.readFileSync(file, 'utf8')));
}

async function readTable(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.xlsx' || ext === '.xlsm') return readXlsx(file);
  if (ext === '.csv' || ext === '.txt') return readCsv(file);
  throw new Error(`Format berkas tidak dikenal: ${ext || '(tanpa ekstensi)'}. ` +
    'Yang bisa dibaca .xlsx dan .csv.');
}

/**
 * Periksa bahwa berkasnya memang laporan bulanan Astra, bukan berkas lain yang
 * kebetulan .xlsx.
 *
 * Tanpa pemeriksaan ini, berkas yang salah akan terbaca sebagai "19.000 baris, 0
 * cocok" — dan orang akan mengira datanya yang bermasalah, bukan berkasnya.
 */
function checkHeader(header) {
  const cells = header.map((c) => String(c || '').toLowerCase().trim());
  const wanted = ['kel', 'kec', 'kode dealer'];
  const missing = wanted.filter((w) => !cells.some((c) => c === w || c.includes(w)));
  if (missing.length) {
    throw new Error(
      `Berkas ini sepertinya bukan laporan bulanan Astra — kolom ${missing.join(', ')} ` +
      'tidak ketemu di baris judul.');
  }
}

/**
 * @param {Object} options
 *   file           path berkas yang diunggah
 *   period         'YYYY-MM'
 *   fileName       nama asli, untuk dicatat
 *   ip             untuk dicatat
 *   withCustomers  simpan nama dan alamat konsumen ke database konsumen
 *   config         dari config.js; dibutuhkan kalau withCustomers dinyalakan
 */
async function runImport(options) {
  if (running) {
    const error = new Error(
      'Sedang ada impor yang berjalan. Tunggu sampai selesai, lalu coba lagi.');
    error.code = 'SEDANG_BERJALAN';
    throw error;
  }
  running = true;

  const db = store.db();
  const startedAt = new Date().toISOString();
  // RETURNING, bukan insertId: Postgres tidak punya padanan lastInsertId, dan tanpa
  // id-nya baris "berjalan" ini tidak pernah bisa ditutup jadi 'ok' atau 'gagal' —
  // riwayat impornya akan penuh baris yang selamanya tampak masih berjalan.
  const logged = await store.one(db, `
    INSERT INTO imports (started_at, ip, file_name, period, result)
    VALUES (?, ?, ?, ?, 'berjalan')
    RETURNING id`,
  [startedAt, options.ip || null, options.fileName || null, options.period]);
  const importId = logged.id;

  try {
    const table = await readTable(options.file);
    if (table.length < 2) throw new Error('Berkasnya kosong atau cuma berisi judul.');
    checkHeader(table[0]);

    const rows = table.slice(1);

    // Alias ejaan kecamatan diterapkan sebelum pencocokan.
    rows.forEach((r) => {
      const key = String(r[COLUMN.cityCode] || '').replace(/\D/g, '').slice(0, 4)
        .replace(/^(\d{2})(\d{2})$/, '$1.$2') +
        '|' + String(r[COLUMN.district] || '').trim().toUpperCase();
      if (DISTRICT_ALIASES[key]) r[COLUMN.district] = DISTRICT_ALIASES[key];
    });

    // Indeks kelurahan dari database, bukan dari CSV — sumbernya satu.
    const villageIndex = {};
    (await store.all(db,
      'SELECT village_code, village_name, district_name, city_code FROM villages'))
      .forEach((v) => {
        villageIndex[regionKey(v.city_code, v.district_name, v.village_name)] =
          v.village_code;
      });

    const result = aggregate(rows, villageIndex, options.period);

    // Outlet: gabungkan yang sudah terdaftar dengan yang baru muncul.
    const known = await store.all(db, `
      SELECT outlet_code AS "outletCode", outlet_name AS "outletName",
             dealer_code AS "dealerCode", dealer_name AS "dealerName", lat, lng
      FROM outlets`);
    const groups = resolveGroups(known, result.outlets);

    // Alamat outlet ada di kolom 9 Excel; ikut disimpan supaya Master Pos Dealer
    // tidak perlu mengarangnya.
    const addressByOutlet = {};
    rows.forEach((r) => {
      const code = String(r[COLUMN.outletCode] || '').trim();
      const address = String(r[COLUMN.outletAddress] || '').trim();
      if (code && address && !addressByOutlet[code]) addressByOutlet[code] = address;
    });

    const now = new Date().toISOString();

    await store.transaction(db, async (conn) => {
      // dealer_code, lat, dan lng SENGAJA tidak ikut diperbarui: ketiganya hasil
      // suntingan manusia, dan impor bulanan tidak boleh menimpanya.
      //
      // Ini lapisan KEDUA. Lapisan pertama ada di resolveGroups(), yang untuk outlet
      // yang sudah terdaftar mengembalikan baris dari database — bukan tebakan baru.
      // Karena itu menghapus klausa ini tidak membuat satu tes pun merah: nilainya
      // sudah benar sebelum sampai ke sini. Tetap dipertahankan supaya perubahan di
      // resolveGroups nanti tidak diam-diam membuka jalan bagi impor untuk menimpa
      // kurasi manusia.
      const outletRows = Object.values(groups.outlets).map((o) => [
        o.outletCode, o.outletName, o.dealerCode, o.dealerName,
        addressByOutlet[o.outletCode] || null, o.lat, o.lng, now,
      ]);
      for (let i = 0; i < outletRows.length; i += BATCH) {
        const bulk = store.bulkValues(outletRows.slice(i, i + BATCH));
        // Hanya nama dan alamat yang diperbarui. dealer_code, dealer_name, lat, dan
        // lng SENGAJA tidak disentuh: itu hasil kurasi manusia di halaman Master Pos
        // Dealer, dan impor bulanan tidak boleh menimpanya.
        await conn.query(`
          INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name,
                               address, lat, lng, updated_at)
          VALUES ${bulk.text}
          ON CONFLICT (outlet_code) DO UPDATE SET
            outlet_name = EXCLUDED.outlet_name,
            address = COALESCE(EXCLUDED.address, outlets.address)`,
        bulk.params);
      }

      // Idempoten: buang periode ini dulu, baru tulis ulang.
      await conn.query('DELETE FROM sales WHERE period = ?', [options.period]);
      for (let i = 0; i < result.rows.length; i += BATCH) {
        const bulk = store.bulkValues(result.rows.slice(i, i + BATCH));
        await conn.query(
          'INSERT INTO sales (period, village_code, outlet_code, quantity) VALUES ' +
          bulk.text, bulk.params);
      }

      await conn.query('DELETE FROM unmatched WHERE period = ?', [options.period]);
      const unmatchedRows = result.unmatched.map((u) =>
        [options.period, u.cityCode, u.districtName, u.villageName, u.count]);
      for (let i = 0; i < unmatchedRows.length; i += BATCH) {
        const bulk = store.bulkValues(unmatchedRows.slice(i, i + BATCH));
        await conn.query(`
          INSERT INTO unmatched (period, city_code, district_name, village_name, row_count)
          VALUES ${bulk.text}`, bulk.params);
      }
    });

    let customerCount = 0;
    if (options.withCustomers) {
      customerCount = await writeCustomers(rows, villageIndex, options.period,
        options.config);
    }

    await store.run(db, `
      UPDATE imports SET finished_at = ?, rows_read = ?, rows_used = ?,
        new_outlets = ?, result = 'ok', message = ? WHERE id = ?`,
    [new Date().toISOString(), result.read, result.used, groups.added.length,
      `${result.unmatched.length} nama kelurahan belum cocok`, importId]);

    return {
      period: options.period,
      rowsRead: result.read,
      rowsUsed: result.used,
      unmatched: result.unmatched,
      newOutlets: groups.added,
      customers: customerCount,
      salesRows: result.rows.length,
    };
  } catch (error) {
    await store.run(db, `UPDATE imports SET finished_at = ?, result = 'gagal', message = ?
                         WHERE id = ?`,
    [new Date().toISOString(), String(error.message).slice(0, 500), importId]);
    throw error;
  } finally {
    running = false;
  }
}

/**
 * Tulis nama dan alamat konsumen ke database konsumen.
 *
 * Transaksi terpisah dari yang di atas: keduanya database yang berbeda, dan satu
 * transaksi tidak bisa melintasi dua database. Konsekuensinya jujur — kalau langkah ini gagal,
 * agregatnya sudah masuk sementara konsumennya belum. Untuk data yang memang boleh
 * hilang, itu urutan yang benar: agregat lebih penting.
 */
async function writeCustomers(rows, villageIndex, period, config) {
  if (!config) {
    throw new Error('Menyimpan data konsumen butuh konfigurasi database.');
  }
  const db = await store.ensureCustomers(config);

  const values = [];
  rows.forEach((r, i) => {
    const code = villageIndex[regionKey(
      r[COLUMN.cityCode], r[COLUMN.district], r[COLUMN.village])];
    if (!code) return;
    const name = String(r[0] || '').trim();
    if (!name) return;
    values.push([
      `${period}-${String(i + 1).padStart(6, '0')}`, period, code,
      String(r[COLUMN.outletCode] || '').trim(), name, String(r[1] || '').trim(),
    ]);
  });

  await store.transaction(db, async (conn) => {
    await conn.query('DELETE FROM customers WHERE period = ?', [period]);
    for (let i = 0; i < values.length; i += BATCH) {
      const bulk = store.bulkValues(values.slice(i, i + BATCH));
      await conn.query(`
        INSERT INTO customers (id, period, village_code, outlet_code, name, address)
        VALUES ${bulk.text}`, bulk.params);
    }
  });
  return values.length;
}

module.exports = { runImport, isRunning, readTable, checkHeader, DISTRICT_ALIASES };
