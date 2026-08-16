/**
 * Query database. Satu-satunya tempat SQL ditulis.
 *
 * Bentuk keluarannya sengaja sudah persis seperti yang dipakai halaman, supaya frontend
 * tidak perlu merakit ulang apa pun. Nama field bahasa Inggris — sama dengan nama
 * kolom, jadi tidak ada penerjemahan di tengah yang bisa salah.
 *
 * Semuanya async sejak databasenya bukan lagi berkas lokal.
 */
const store = require('./db');
const coverage = require('./coverage-store');
const { toDealerCode } = require('../core/grouping');

/**
 * Seluruh isi dashboard dalam satu permintaan.
 *
 * Satu endpoint, bukan lima. Datanya saling bergantung — warna dealer dihitung dari
 * seluruh agregat, dan KPI harus konsisten dengan peta — jadi mengambilnya terpisah
 * membuka peluang halaman menampilkan potongan dari dua keadaan yang berbeda.
 */
async function summary() {
  const db = store.db();

  // hasGeom: kelurahan yang ditambah manual belum punya batas wilayah, dan tanpa itu
  // dia tidak bisa punya rasio jangkauan sama sekali. Halaman WAJIB tahu bedanya
  // "0% terjangkau" dan "belum bisa dihitung" — kalau tidak, penjualannya diam-diam
  // masuk hitungan sebagai "di luar jangkauan" dan menurunkan persentase tanpa sebab
  // yang terlihat.
  const villages = await store.all(db, `
    SELECT village_code AS code, village_name AS name,
           district_name AS district, city_code AS "cityCode", city_name AS "cityName",
           province_code AS "provinceCode", lat, lng,
           (geom_m IS NOT NULL) AS "hasGeom"
    FROM villages
    ORDER BY province_code, city_name, district_name, village_name`);

  const outlets = await store.all(db, `
    SELECT outlet_code AS code, outlet_name AS name,
           dealer_code AS "dealerCode", dealer_name AS "dealerName",
           address, lat, lng
    FROM outlets
    ORDER BY outlet_name`);

  // dealer_code diambil lewat JOIN, bukan disimpan di tabel sales. Memperbaiki satu
  // pengelompokan outlet langsung terlihat di seluruh dashboard tanpa impor ulang.
  const sales = await store.all(db, `
    SELECT s.period, s.village_code AS village, s.outlet_code AS outlet,
           o.dealer_code AS dealer, s.quantity AS units
    FROM sales s
    JOIN outlets o ON o.outlet_code = s.outlet_code`);

  const periodRows = await store.all(db,
    'SELECT DISTINCT period FROM sales ORDER BY period');

  const lastImport = await store.one(db, `
    SELECT period, finished_at AS "finishedAt", rows_read AS "rowsRead",
           rows_used AS "rowsUsed"
    FROM imports WHERE result = 'ok' ORDER BY id DESC LIMIT 1`);

  return {
    villages,
    outlets,
    sales,
    periods: periodRows.map((r) => r.period),
    lastImport,
    coverage: await coverage.all(),
    radiiM: coverage.RADII_M,
    radiusM: coverage.DEFAULT_RADIUS_M,
    // Halaman perlu tahu bedanya "jangkauan 0%" dan "jangkauan belum pernah dihitung".
    // Tanpa ini, server yang baru dipasang akan menampilkan 0% di semua outlet dan
    // orang akan mengira itu temuan.
    coverageReady: !(await coverage.isEmpty()),
  };
}

/** Nama kelurahan yang belum cocok, per periode. Untuk halaman impor. */
function unmatched(period) {
  return store.all(store.db(), `
    SELECT city_code AS "cityCode", district_name AS "districtName",
           village_name AS "villageName", row_count AS "rowCount"
    FROM unmatched WHERE period = ? ORDER BY row_count DESC`, [period]);
}

function imports(limit) {
  return store.all(store.db(), `
    SELECT id, started_at AS "startedAt", finished_at AS "finishedAt", file_name AS "fileName",
           period, rows_read AS "rowsRead", rows_used AS "rowsUsed",
           new_outlets AS "newOutlets", result, message
    FROM imports ORDER BY id DESC LIMIT ?`, [Number(limit) || 20]);
}

/** Ringkasan per periode, untuk daftar "Periode Tersimpan". */
function periodSummary() {
  return store.all(store.db(), `
    SELECT s.period,
           SUM(s.quantity) AS units,
           COUNT(DISTINCT s.village_code) AS villages,
           COUNT(DISTINCT s.outlet_code) AS outlets,
           (SELECT i.finished_at FROM imports i
             WHERE i.period = s.period AND i.result = 'ok'
             ORDER BY i.id DESC LIMIT 1) AS "importedAt"
    FROM sales s GROUP BY s.period ORDER BY s.period DESC`);
}

/**
 * Konsumen di SATU kelurahan.
 *
 * Wajib pakai kode kelurahan — tidak ada jalan mengambil semuanya sekaligus. Ini
 * satu-satunya hal yang mencegah satu akun bersama menyedot seluruh basis data
 * konsumen dalam satu permintaan.
 *
 * @return {Array|null} null berarti database konsumen tidak ada — bukan error.
 */
async function customersInVillage(villageCode, period, limit) {
  const db = store.customers();
  if (!db) return null;

  const max = Number(limit) || 500;
  return period
    ? store.all(db, `SELECT id, name, address, outlet_code AS outlet, period
                     FROM customers WHERE village_code = ? AND period = ?
                     ORDER BY name LIMIT ?`, [villageCode, period, max])
    : store.all(db, `SELECT id, name, address, outlet_code AS outlet, period
                     FROM customers WHERE village_code = ?
                     ORDER BY period DESC, name LIMIT ?`, [villageCode, max]);
}

/**
 * Batas keras jumlah baris konsumen per permintaan.
 *
 * Bukan soal kecepatan. Halaman Data Konsumen memang untuk menelusuri data yang tim
 * unggah sendiri, tapi satu akun dipakai bersama — jadi tidak ada satu permintaan pun
 * yang mengembalikan seluruh tabel sekaligus. Yang ingin melihat semuanya masih punya
 * berkas Excel aslinya.
 */
const BROWSE_LIMIT = 500;

/** Escape `%` dan `_` supaya yang diketik dicari apa adanya, bukan jadi wildcard. */
function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, (c) => '\\' + c);
}

/**
 * Telusuri konsumen dengan penyaring, untuk halaman Data Konsumen.
 *
 * Berbeda dari customersInVillage() yang mewajibkan satu kelurahan: di sini
 * penyaringnya bebas, tapi hasilnya selalu dipotong BROWSE_LIMIT dan jumlah
 * sebenarnya dilaporkan terpisah supaya halaman bisa bilang "menampilkan 500 dari
 * 18.512" — bukan diam-diam memotong.
 *
 * Penyaring kota memakai awalan kode: kode kelurahan BPS bertitik selalu memuat kode
 * kotanya di depan (`34.04` -> `34.04.01.2001`), jadi tidak perlu menggabung tabel
 * villages yang ada di database lain.
 *
 * @return {{rows: Array, total: number, limit: number}|null}
 *   null berarti database konsumen tidak ada — bukan error.
 */
async function browseCustomers(filters) {
  const db = store.customers();
  if (!db) return null;

  const f = filters || {};
  const where = [];
  const params = [];

  if (f.period) { where.push('period = ?'); params.push(f.period); }
  if (f.village) { where.push('village_code = ?'); params.push(f.village); }
  else if (f.city) {
    // Titik setelah kode kota tidak menentukan perilaku selama kode BPS lebar-tetap
    // (NN.NN.NN.NNNN) — '34.04%' tidak mungkin menarik kota lain. Tetap ditulis supaya
    // tetap benar kalau formatnya berubah. Uji mutasi mencatatnya sebagai mutan
    // EKUIVALEN, bukan celah tes: tidak ada data yang bisa membedakan keduanya.
    where.push("village_code LIKE ? ESCAPE '\\'");
    params.push(escapeLike(f.city) + '.%');
  }
  if (f.outlet) { where.push('outlet_code = ?'); params.push(f.outlet); }
  if (f.outlets && f.outlets.length) {
    where.push('outlet_code = ANY(?)');
    params.push(f.outlets);
  }
  if (f.query) {
    where.push("(name ILIKE ? ESCAPE '\\' OR address ILIKE ? ESCAPE '\\')");
    const like = '%' + escapeLike(f.query) + '%';
    params.push(like, like);
  }

  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (await store.one(db,
    `SELECT COUNT(*) AS n FROM customers ${clause}`, params)).n;

  // Offset dijepit ke dalam jangkauan. Halaman bisa saja meminta offset yang sudah
  // lewat ujung — misalnya sesudah penyaring dipersempit — dan lebih baik menampilkan
  // halaman terakhir daripada tabel kosong yang tampak seperti "tidak ada data".
  //
  // Dijepit ke AWAL halaman terakhir, bukan ke baris terakhir. Kalau dijepit ke
  // total-1, melompat lewat ujung mendarat di satu baris sendirian — benar secara
  // angka, tapi terlihat seperti datanya habis.
  const lastPage = Math.max(0,
    Math.floor(Math.max(0, total - 1) / BROWSE_LIMIT) * BROWSE_LIMIT);
  const offset = Math.max(0, Math.min(
    Math.floor(Number(f.offset) || 0), lastPage));

  // `id` di ujung ORDER BY bukan hiasan. Tanpa pemecah seri, dua konsumen bernama sama
  // urutannya tidak dijamin, dan urutan yang berubah antar halaman membuat satu baris
  // muncul dua kali di halaman 2 sementara baris lain tidak pernah terlihat sama
  // sekali. `id` unik, jadi urutannya jadi pasti.
  const rows = await store.all(db, `
    SELECT id, name, address, village_code AS "village", outlet_code AS "outlet", period
    FROM customers ${clause}
    ORDER BY period DESC, name, id
    LIMIT ? OFFSET ?`, params.concat([BROWSE_LIMIT, offset]));

  return { rows, total, limit: BROWSE_LIMIT, offset };
}

/**
 * Tambah pos dealer baru.
 *
 * Biasanya outlet lahir dari impor bulanan. Ini untuk pos yang sudah buka tapi belum
 * muncul di Excel — tanpa ini, timnya harus menunggu satu bulan sebelum bisa
 * memetakannya.
 *
 * `outletCode` datang dari pengguna dan HARUS sama dengan kode di Excel nanti. Kalau
 * beda, impor berikutnya membuat outlet KEDUA untuk pos yang sama, dan penjualannya
 * terbelah dua tanpa gejala. Itu sebabnya kodenya wajib diisi tangan, bukan dibuatkan
 * server: cuma manusia yang tahu kode apa yang dipakai Astra.
 *
 * @return {{outlet: Object, coverageRebuilt: boolean}}
 */
async function createOutlet(data, config) {
  const db = store.db();
  const code = String(data.outletCode || '').trim();
  const name = String(data.outletName || '').trim();
  if (!code) throw new Error('Kode pos wajib diisi.');
  if (!name) throw new Error('Nama pos wajib diisi.');

  const ada = await store.one(db,
    'SELECT outlet_name FROM outlets WHERE outlet_code = ?', [code]);
  if (ada) {
    throw new Error(`Kode ${code} sudah dipakai oleh "${ada.outlet_name}".`);
  }

  const dealer = await resolveDealer(data.dealerName || name);
  if (!dealer) throw new Error('Nama dealer tidak bisa dipakai. Harus memuat huruf atau angka.');

  const lat = data.lat === undefined || data.lat === null ? null : data.lat;
  const lng = data.lng === undefined || data.lng === null ? null : data.lng;

  await store.run(db, `
    INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name,
                         address, lat, lng, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [code, name, dealer.code, dealer.name,
    data.address ? String(data.address).trim() : null, lat, lng,
    new Date().toISOString()]);

  // Pos yang langsung punya koordinat langsung punya jangkauan juga. Tanpa ini dia
  // tampil 0% sampai ada yang ingat menjalankan seed-coverage.
  let coverageRebuilt = false;
  if (lat != null && lng != null && config) {
    await coverage.rebuild(config, [code]);
    coverageRebuilt = true;
  }

  return {
    outlet: await store.one(db, `
      SELECT outlet_code AS code, outlet_name AS name, dealer_code AS "dealerCode",
             dealer_name AS "dealerName", address, lat, lng
      FROM outlets WHERE outlet_code = ?`, [code]),
    coverageRebuilt,
  };
}

/**
 * Tambah kelurahan baru.
 *
 * TANPA BATAS WILAYAH. Poligon kelurahan datang dari pipeline geo (BPS/Ina-Geoportal),
 * bukan dari ketikan manusia — dan tanpa poligon, kelurahan ini tidak akan pernah
 * punya rasio jangkauan.
 *
 * Itu BUKAN dianggap sepele: `summary()` menandainya lewat `hasGeom`, dan halaman
 * mengeluarkan penjualannya dari hitungan dalam/luar jangkauan lalu melaporkannya
 * terpisah. Yang belum lengkap harus terlihat, bukan tersamar jadi "di luar jangkauan".
 *
 * Kodenya WAJIB kode BPS bertitik dan tidak pernah diturunkan dari nama — aturan
 * proyek, dan satu-satunya cara kelurahan ini nanti bisa disambungkan ke poligonnya
 * waktu cakupan geo diperluas.
 */
async function createVillage(data) {
  const db = store.db();
  const code = String(data.villageCode || '').trim();
  const name = String(data.villageName || '').trim();
  if (!/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(code)) {
    throw new Error('Kode kelurahan harus format BPS bertitik, misalnya 34.04.01.2001.');
  }
  if (!name) throw new Error('Nama kelurahan wajib diisi.');

  const ada = await store.one(db,
    'SELECT village_name FROM villages WHERE village_code = ?', [code]);
  if (ada) throw new Error(`Kode ${code} sudah dipakai oleh "${ada.village_name}".`);

  // Kode kota dan provinsi TURUNAN dari kode kelurahan, bukan isian terpisah. Kalau
  // dipisah, keduanya bisa saling bertentangan dan penyaring kota jadi salah diam-diam.
  const cityCode = code.slice(0, 5);
  const provinceCode = code.slice(0, 2);

  // Nama kota diambil dari kelurahan lain di kota yang sama kalau ada — supaya tidak
  // muncul dua ejaan untuk kota yang sama di dropdown.
  const kota = await store.one(db,
    'SELECT city_name FROM villages WHERE city_code = ? LIMIT 1', [cityCode]);
  const cityName = kota ? kota.city_name : String(data.cityName || '').trim();
  if (!cityName) {
    throw new Error('Kota ini belum ada di tabel — isi nama kabupaten/kotanya.');
  }

  await store.run(db, `
    INSERT INTO villages (village_code, village_name, district_code, district_name,
                          city_code, city_name, province_code, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [code, name, code.slice(0, 8),
    data.districtName ? String(data.districtName).trim() : null,
    cityCode, cityName, provinceCode,
    data.lat === undefined ? null : data.lat,
    data.lng === undefined ? null : data.lng]);

  return store.one(db, `
    SELECT village_code AS code, village_name AS name, district_name AS district,
           city_code AS "cityCode", city_name AS "cityName",
           province_code AS "provinceCode", lat, lng, (geom_m IS NOT NULL) AS "hasGeom"
    FROM villages WHERE village_code = ?`, [code]);
}

/** Apakah data konsumen tersedia sama sekali. */
function hasCustomers() {
  return Boolean(store.customers());
}

async function logCustomerAccess(ip, villageCode, count) {
  const db = store.customers();
  if (!db) return;
  await store.run(db,
    'INSERT INTO access_log (at, ip, village_code, row_count) VALUES (?, ?, ?, ?)',
    [new Date().toISOString(), ip || null, villageCode, count]);
}

/**
 * Tentukan (kode, nama) dealer dari nama yang diketik atau dipilih pengguna.
 *
 * Kode dealer TIDAK pernah datang dari browser. Dia identitas, dan aturan proyek
 * melarang identitas diturunkan dari nama di tempat yang tersebar — jadi penurunannya
 * dikurung di satu tempat: di sini.
 *
 * Nama yang sudah dipakai dealer lain akan MEMAKAI ULANG kode dealer itu, bukan
 * menurunkan kode baru. Itu yang membuat "pindahkan pos ini ke NUSANTARA SAKTI"
 * benar-benar menggabungkannya ke dealer yang sudah ada, bukan membuat dealer kedua
 * dengan nama yang sama persis. Pencocokannya tanpa memandang besar-kecil huruf dan
 * spasi berlebih, karena itu yang diketik manusia.
 *
 * @return {{code: string, name: string}|null} null kalau namanya tidak bisa dipakai
 */
async function resolveDealer(name) {
  const bersih = String(name || '').trim().replace(/\s+/g, ' ');
  if (!bersih) return null;

  const adaSama = await store.one(store.db(), `
    SELECT dealer_code AS "dealerCode", dealer_name AS "dealerName"
    FROM outlets
    WHERE LOWER(dealer_name) = LOWER(?)
    LIMIT 1`, [bersih]);
  if (adaSama) return { code: adaSama.dealerCode, name: adaSama.dealerName };

  const code = toDealerCode(bersih);
  // Nama yang seluruhnya tanda baca ('---') menghasilkan kode kosong. Kode kosong
  // akan menggabungkan semua outlet bernasib sama jadi satu dealer hantu.
  if (!code) return null;
  return { code, name: bersih };
}

/**
 * Perbaiki satu outlet: alamat, pengelompokan dealer, dan/atau koordinat.
 *
 * Pengelompokan dealer diubah lewat `patch.dealerName` — kodenya ditentukan
 * resolveDealer(). `patch.dealerCode` masih dihormati kalau diberikan langsung, untuk
 * pemakaian dari skrip dan tes; browser tidak pernah mengirimnya.
 *
 * @param {Object} config  dibutuhkan kalau koordinatnya berubah — jangkauan outlet ini
 *                          harus dihitung ulang, kalau tidak angkanya masih
 *                          menggambarkan lokasi yang sudah tidak dipakai
 * @return {{outlet: Object, coverageRebuilt: boolean, dealerChanged: boolean}|null}
 */
async function updateOutlet(code, patch, config) {
  const db = store.db();
  const current = await store.one(db,
    'SELECT * FROM outlets WHERE outlet_code = ?', [code]);
  if (!current) return null;

  // Dealer diselesaikan SEBELUM UPDATE, dan sebelum baris ini ikut terhitung sebagai
  // "dealer yang sudah ada" — kalau tidak, memindahkan satu-satunya pos milik sebuah
  // dealer akan mencocokkan dirinya sendiri.
  let dealer = null;
  if (patch.dealerCode) {
    dealer = { code: patch.dealerCode, name: patch.dealerName || current.dealer_name };
  } else if (patch.dealerName !== undefined) {
    dealer = await resolveDealer(patch.dealerName);
    if (!dealer) {
      throw new Error('Nama dealer tidak bisa dipakai. Harus memuat huruf atau angka.');
    }
  }

  const lat = patch.lat === undefined ? current.lat : patch.lat;
  const lng = patch.lng === undefined ? current.lng : patch.lng;
  const moved = lat !== current.lat || lng !== current.lng;

  const dealerChanged = Boolean(dealer) && dealer.code !== current.dealer_code;

  await store.run(db, `
    UPDATE outlets SET dealer_code = ?, dealer_name = ?, address = ?,
                       lat = ?, lng = ?, updated_at = ?
    WHERE outlet_code = ?`, [
    dealer ? dealer.code : current.dealer_code,
    dealer ? dealer.name : current.dealer_name,
    patch.address === undefined ? current.address : patch.address,
    lat, lng, new Date().toISOString(), code,
  ]);

  // Pin yang dipindah membuat jangkauan lamanya salah. Dihitung ulang di sini juga,
  // bukan diserahkan ke skrip yang harus diingat orang — satu outlet cuma perlu
  // sepersekian detik, dan lupa menjalankannya berarti angka yang salah tanpa gejala.
  let coverageRebuilt = false;
  if (moved && lat != null && config) {
    await coverage.rebuild(config, [code]);
    coverageRebuilt = true;
  }

  return {
    outlet: await store.one(db, `
      SELECT outlet_code AS code, outlet_name AS name, dealer_code AS "dealerCode",
             dealer_name AS "dealerName", address, lat, lng
      FROM outlets WHERE outlet_code = ?`, [code]),
    coverageRebuilt,
    dealerChanged,
  };
}

module.exports = {
  summary, unmatched, imports, periodSummary,
  customersInVillage, browseCustomers, hasCustomers, logCustomerAccess, updateOutlet,
  resolveDealer, createOutlet, createVillage,
  BROWSE_LIMIT,
};
