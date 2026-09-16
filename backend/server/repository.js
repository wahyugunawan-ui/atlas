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
const { config } = require('./config');
const { toDealerCode } = require('../core/grouping');
const { regionKey, normalizeName, toDottedCityCode } = require('../core/region');
const { suggestVillages } = require('../core/matching');
const { buildVillageIndex, resolveVillage } = require('../core/village-resolver');

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
  // Yang dikirim ke halaman: kelurahan yang punya penjualan, ATAU yang masuk radius
  // jangkauan sebuah pos. 4.003 dari 8.999 yang ada di database.
  //
  // Penyaring ini bukan soal ukuran payload — itu cuma 1,6 MB dan halaman tetap siap
  // dalam 1,5 detik tanpanya. Alasannya ARTI ANGKANYA.
  //
  // Database sekarang memuat SELURUH Jateng + DIY supaya perluasan cakupan tidak butuh
  // setelan apa pun. Tapi tanpa penyaring, KPI "Kelurahan Kosong" berubah makna
  // diam-diam: dari "kelurahan di wilayah kita yang belum ada penjualan" (439) jadi
  // "kelurahan di seluruh Jawa Tengah yang tidak kita jual" (5.673). Angka kedua benar
  // secara hitungan dan tidak berguna secara bisnis — dan di layar terlihat seperti
  // kemunduran drastis.
  //
  // `geom_m IS NULL` ikut disertakan sebagai JARING PENGAMAN, bukan untuk satu fitur
  // tertentu. Sekarang tidak ada satu pun jalur yang membuat kelurahan tanpa poligon —
  // fitur "tambah kelurahan" sudah dibuang dan seluruh isi tabel datang dari berkas
  // sumber yang berpoligon — jadi syarat ini seharusnya tidak pernah cocok.
  //
  // Justru itu gunanya. Kalau suatu saat ada kelurahan tanpa geometri masuk dari jalur
  // mana pun, dia MUNCUL di layar dan ditandai `hasGeom: false`, bukan hilang diam-diam.
  // Kebenarannya tidak boleh bergantung pada fitur mana yang kebetulan sedang ada.
  //
  // Kriterianya sama dengan scripts/export-geo.js, KECUALI bagian ini: yang tanpa
  // poligon memang tidak bisa digambar di peta. Perbedaan yang disengaja dan satu-satunya.
  const villages = await store.all(db, `
    SELECT village_code AS code, village_name AS name,
           district_name AS district, district_code AS "districtCode",
           city_code AS "cityCode", city_name AS "cityName",
           province_code AS "provinceCode", lat, lng,
           (geom_m IS NOT NULL) AS "hasGeom"
    FROM villages
    WHERE village_code IN (SELECT village_code FROM sales)
       OR village_code IN (SELECT DISTINCT village_code FROM coverage)
       OR geom_m IS NULL
    ORDER BY province_code, city_name, district_name, village_name`);

  // is_dealer_proxy dikirim (bukan disaring di sini) supaya S.outletByCode di
  // frontend tetap punya nama dealer yang benar untuk baris level-dealer lama
  // (lihat schema.sql komentar outlets.is_dealer_proxy) — yang disaring adalah
  // TAMPILAN katalog (S.realOutlets di app.js), bukan pencarian nama.
  const outlets = await store.all(db, `
    SELECT outlet_code AS code, outlet_name AS name,
           dealer_code AS "dealerCode", dealer_name AS "dealerName",
           address, lat, lng, is_dealer_proxy AS synthetic
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
    dealers: await listDealers(),
    sales,
    periods: periodRows.map((r) => r.period),
    lastImport,
    coverage: await coverage.all(),
    // Ring milik dealer, coverage milik pos — dua konsep terpisah sejak 2026-08-31
    // sore, lihat komentar di schema.sql dan docs/DECISIONS.md.
    dealerRings: await allDealerRings(),
    posCoverage: await allPosCoverage(),
    // Daftar kecamatan ikut dikirim supaya halaman bisa menyebut NAMANYA, bukan cuma
    // kodenya. Tidak bisa diturunkan dari daftar kelurahan: kelurahan yang dikirim
    // sudah disaring ke yang punya penjualan, sementara ring/coverage justru sering
    // menandai kecamatan yang belum ada penjualannya sama sekali. 654 baris, ~40 KB.
    districts: await districts(),
    radiiM: coverage.RADII_M,
    radiusM: coverage.DEFAULT_RADIUS_M,
    // Halaman perlu tahu bedanya "jangkauan 0%" dan "jangkauan belum pernah dihitung".
    // Tanpa ini, server yang baru dipasang akan menampilkan 0% di semua outlet dan
    // orang akan mengira itu temuan.
    coverageReady: !(await coverage.isEmpty()),
    // Berapa nama yang menunggu dicocokkan manusia, di periode terakhir yang diimpor.
    //
    // Ikut di sini supaya jumlahnya bisa tampil di tombol "Cocokkan Nama" tanpa
    // permintaan kedua, dan supaya ikut segar tiap kali halaman memuat ulang ringkasan.
    // Pekerjaan yang menunggu harus terlihat tanpa ada yang membuka modalnya dulu.
    pendingNames: (await store.one(db, `
      SELECT COUNT(*) AS n FROM unmatched
      WHERE period = (SELECT MAX(period) FROM unmatched)`)).n,
    // Acuan bisnis, bukan hasil statistik — lihat config.js. Dikirim di sini supaya
    // panel wilayah bisa menghitung Selisih/Rasio terhadap Acuan tanpa permintaan kedua.
    businessReferencePercent: config.businessReferencePercent,
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
 * Periodenya berupa RENTANG, dan opsinya sengaja dioper sebagai objek — bukan
 * argumen berurutan. Dengan `(village, from, to)`, pemanggil lama
 * `customersInVillage(v, '2026-08')` tetap jalan dan diam-diam berarti "Agustus dan
 * seterusnya": hasilnya melebar tanpa error dan tanpa tes yang merah. Objek membuat
 * panggilan lama gagal keras, dan itu memang yang diinginkan.
 *
 * @param {string} villageCode
 * @param {{from?: string, to?: string, limit?: number}} [opsi] batas periode 'YYYY-MM'
 * @return {Array|null} null berarti database konsumen tidak ada — bukan error.
 */
async function customersInVillage(villageCode, opsi) {
  // Panggilan gaya lama gagal KERAS, bukan diam. `customersInVillage(v, '2026-08')`
  // akan lolos begitu saja dan berarti "seluruh riwayat kelurahan itu" — lebih luas
  // dari yang diminta, tanpa error dan tanpa tes merah. Di rute yang mengeluarkan
  // nama dan alamat, pelebaran senyap tidak boleh mungkin.
  if (typeof opsi === 'string') {
    throw new TypeError('customersInVillage(village, {from, to}): periode dioper sebagai ' +
      'objek, bukan argumen berurutan.');
  }
  const db = store.customers();
  if (!db) return null;

  const o = opsi || {};
  const max = Number(o.limit) || 500;
  const where = ['village_code = ?'];
  const params = [villageCode];
  // Periode dibandingkan sebagai TEKS, bukan tanggal. Kolomnya lebar-tetap 'YYYY-MM'
  // dengan bulan ber-nol depan, jadi urutan leksikografisnya identik dengan urutan
  // kronologis. Ini hanya benar selama nol depannya ada — dijaga regex PERIOD di
  // routes.js dan oleh importir, jadi nilai seperti '2026-9' tidak bisa masuk.
  if (o.from) { where.push('period >= ?'); params.push(o.from); }
  if (o.to) { where.push('period <= ?'); params.push(o.to); }

  return store.all(db, `SELECT id, name, address, outlet_code AS outlet, period
                        FROM customers WHERE ${where.join(' AND ')}
                        ORDER BY period DESC, name LIMIT ?`, params.concat([max]));
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

  // Periode dibandingkan sebagai teks — alasannya sama persis dengan
  // customersInVillage() di atas, dan sengaja tidak diulang panjang di sini.
  if (f.periodFrom) { where.push('period >= ?'); params.push(f.periodFrom); }
  if (f.periodTo) { where.push('period <= ?'); params.push(f.periodTo); }
  // Provinsi TIDAK ikut rebutan dengan kota dan kelurahan di bawah: dia penyaring
  // mandiri yang boleh dipakai bersama salah satunya. Kode kelurahan BPS memuat kode
  // provinsi di paling depan ('33' -> '33.74.01.1001'), jadi awalannya cukup. Titiknya
  // mutan EKUIVALEN persis seperti pada penyaring kota di bawah — kode provinsi selalu
  // dua digit, jadi '33%' tidak mungkin menarik provinsi lain. Tetap ditulis.
  if (f.province) {
    where.push("village_code LIKE ? ESCAPE '\\'");
    params.push(escapeLike(f.province) + '.%');
  }
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

/* ==========================================================================
   ALIAS NAMA KELURAHAN
   ==========================================================================
   Ejaan Excel yang sudah dikonfirmasi manusia menunjuk kelurahan mana. Menggantikan
   fitur "tambah kelurahan" yang dulu ada di sini: setelah seluruh Jateng + DIY masuk
   database berpoligon, membuat kelurahan BARU tanpa poligon hampir selalu jawaban yang
   salah — yang benar hampir selalu menunjuk kelurahan yang sudah ada beserta batasnya.
   ========================================================================== */

/** Semua alias yang tersimpan, lengkap dengan kelurahan yang ditunjuknya. */
function aliases() {
  return store.all(store.db(), `
    SELECT a.city_code AS "cityCode", a.district_name AS "districtName",
           a.village_name AS "villageName", a.village_code AS "villageCode",
           v.village_name AS "targetName", v.district_name AS "targetDistrict",
           (v.geom_m IS NOT NULL) AS "targetHasGeom"
    FROM village_aliases a
    JOIN villages v ON v.village_code = a.village_code
    ORDER BY a.city_code, a.district_name, a.village_name`);
}

/**
 * Simpan satu alias. Dipanggil HANYA dari klik konfirmasi, tidak pernah dari impor.
 *
 * Kelurahan tujuan diperiksa keberadaannya di sini walaupun foreign key sudah menjaga
 * hal yang sama: pesan "kode tidak ada" lebih berguna bagi orang yang sedang memilih
 * daripada pelanggaran constraint yang keluar sebagai teks Postgres.
 */
async function saveAlias(data) {
  const db = store.db();
  const cityCode = String(data.cityCode || '').trim();
  const districtName = String(data.districtName || '').trim();
  const villageName = String(data.villageName || '').trim();
  const villageCode = String(data.villageCode || '').trim();

  if (!cityCode || !districtName || !villageName) {
    throw new Error('Kota, kecamatan, dan nama dari Excel wajib ada.');
  }
  const target = await store.one(db, `
    SELECT village_code AS code, village_name AS name, district_name AS district,
           city_code AS "cityCode", (geom_m IS NOT NULL) AS "hasGeom"
    FROM villages WHERE village_code = ?`, [villageCode]);
  if (!target) throw new Error(`Kelurahan ${villageCode} tidak ada di tabel.`);

  // Alias lintas kabupaten DITOLAK. Kunci pencocokannya memuat kode kota, jadi alias
  // seperti itu tidak akan pernah terpakai — dan diam-diam tidak terpakai jauh lebih
  // buruk daripada ditolak, karena orang yang menyimpannya mengira sudah beres.
  if (target.cityCode !== cityCode) {
    throw new Error(
      `${target.name} ada di kabupaten ${target.cityCode}, bukan ${cityCode}.`);
  }

  await store.run(db, `
    INSERT INTO village_aliases (city_code, district_name, village_name,
                                 village_code, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (city_code, district_name, village_name) DO UPDATE SET
      village_code = EXCLUDED.village_code,
      created_at = EXCLUDED.created_at`,
  [cityCode, districtName, villageName, villageCode, new Date().toISOString()]);

  return target;
}

function deleteAlias(cityCode, districtName, villageName) {
  return store.run(store.db(), `
    DELETE FROM village_aliases
    WHERE city_code = ? AND district_name = ? AND village_name = ?`,
  [String(cityCode || ''), String(districtName || ''), String(villageName || '')]);
}

/** Periode terakhir yang punya nama belum cocok. NULL kalau semuanya sudah cocok. */
async function latestUnmatchedPeriod() {
  const row = await store.one(store.db(),
    'SELECT MAX(period) AS period FROM unmatched');
  return row ? row.period : null;
}

/**
 * Nama yang belum cocok, masing-masing beserta saran kelurahan yang mungkin dimaksud.
 *
 * Kandidatnya diambil sekota, bukan sekecamatan. Nama kecamatan di Excel sendiri
 * kadang salah eja — itu justru salah satu sebab barisnya tidak cocok — jadi menyaring
 * kandidat ke kecamatan yang tertulis akan membuang jawaban yang benar. Kecamatan tetap
 * dipakai untuk MENGURUTKAN, di backend/core/matching.js, bukan untuk menyaring.
 *
 * Kolom `alias` diisi kalau namanya sudah pernah dicocokkan tapi barisnya masih tercatat
 * belum cocok — itu keadaan wajar: alias baru berlaku pada impor berikutnya.
 */
async function unmatchedWithSuggestions(period) {
  const rows = await unmatched(period);
  if (!rows.length) return [];

  const cities = [...new Set(rows.map((r) => r.cityCode))];
  const candidates = await store.all(store.db(), `
    SELECT village_code AS code, village_name AS name, district_name AS district,
           city_code AS "cityCode", (geom_m IS NOT NULL) AS "hasGeom"
    FROM villages
    WHERE city_code IN (${cities.map(() => '?').join(',')})`, cities);

  const perCity = {};
  candidates.forEach((c) => {
    (perCity[c.cityCode] = perCity[c.cityCode] || []).push(c);
  });

  const tersimpan = {};
  (await aliases()).forEach((a) => {
    tersimpan[regionKey(a.cityCode, a.districtName, a.villageName)] = a;
  });

  return rows.map((r) => ({
    ...r,
    alias: tersimpan[regionKey(r.cityCode, r.districtName, r.villageName)] || null,
    suggestions: suggestVillages(
      r.villageName, r.districtName, perCity[r.cityCode] || [], 5),
  }));
}

/**
 * Hapus seluruh data satu periode.
 *
 * Untuk bulan yang salah diimpor: berkas Excel keliru, periode salah pilih, atau data
 * uji yang ikut masuk. Impor ulang sudah menimpa periode yang sama, jadi ini BUKAN
 * untuk memperbaiki isi — ini untuk membuang bulan yang memang tidak seharusnya ada.
 *
 * BERKAS EXCEL DI ARSIP SENGAJA TIDAK IKUT DIHAPUS. Dia satu-satunya jalan pulih kalau
 * salah hapus: impor ulang berkas yang sama mengembalikan keadaan persis seperti semula,
 * karena impornya idempoten. Arsipnya tetap terbuang sendiri setelah 90 hari lewat
 * pruneUploads(), jadi PII di dalamnya tidak menetap selamanya.
 *
 * URUTANNYA PII DULU, dan itu bukan kebetulan. Dua database berbeda, jadi tidak mungkin
 * satu transaksi. Kalau penjualan dihapus lebih dulu lalu langkah kedua gagal, yang
 * tersisa adalah nama dan alamat untuk bulan yang sudah hilang dari layar — PII yang
 * tidak terlihat siapa pun dan tidak ada yang tahu masih ada. Kebalikannya jauh lebih
 * ringan: penjualan tanpa PII, dan itu keadaan normal untuk impor tanpa `--konsumen`.
 */
/**
 * Kosongkan seluruh master pos dan dealer, dan semua yang menggantung padanya.
 *
 * Penjualan IKUT TERHAPUS, dan itu bukan pilihan: `sales.outlet_code` menunjuk
 * `outlets` lewat foreign key, jadi pos tidak bisa hilang sementara penjualannya
 * tinggal. Menyisakan salah satunya bukan "reset yang lebih aman" — itu database yang
 * menolak, atau baris yatim yang tidak muncul di mana pun.
 *
 * Data konsumen ikut dikosongkan. Membiarkannya berarti nama dan alamat tertinggal
 * untuk penjualan yang sudah tidak ada di layar mana pun — PII yang tidak terlihat
 * siapa pun dan tidak ada yang tahu masih ada. Aturan yang sama sudah berlaku di
 * deletePeriod().
 *
 * Jalan pulihnya: impor ulang berkas Excel dari arsip. Arsipnya sengaja tidak ikut
 * dihapus, sama seperti pada penghapusan periode.
 */
/**
 * Seluruh ring dealer, dibentuk dealerRings[dealerCode][districtCode] = 1|2|3.
 *
 * Sejak 2026-08-31 sore, ring pindah dari pos+kelurahan ke DEALER+KECAMATAN — lihat
 * docs/DECISIONS.md. Dikirim sekaligus di /api/summary, sama seperti jangkauan:
 * halaman butuh semuanya untuk menghitung %ring tiap baris penjualan tanpa
 * bolak-balik ke server.
 */
async function allDealerRings() {
  const rows = await store.all(store.db(), `
    SELECT dealer_code AS "dealerCode", district_code AS "districtCode", ring
    FROM dealer_rings`);
  const out = {};
  rows.forEach((r) => {
    (out[r.dealerCode] || (out[r.dealerCode] = {}))[r.districtCode] = Number(r.ring);
  });
  return out;
}

/**
 * Seluruh coverage pos, dibentuk posCoverage[outletCode][districtCode] = 1..8.
 *
 * Konsep baru sejak 2026-08-31 sore, bukan penggantian nama dari `coverage` (rasio
 * radius PostGIS lama, lihat backend/server/coverage-store.js) — lihat docs/DECISIONS.md.
 */
async function allPosCoverage() {
  const rows = await store.all(store.db(), `
    SELECT outlet_code AS "outletCode", district_code AS "districtCode", coverage_num
    FROM pos_coverage_district`);
  const out = {};
  rows.forEach((r) => {
    (out[r.outletCode] || (out[r.outletCode] = {}))[r.districtCode] = Number(r.coverage_num);
  });
  return out;
}

/** Daftar kecamatan untuk pemilih ring/coverage: kode, nama, dan kabupatennya. */
async function districts() {
  return store.all(store.db(), `
    SELECT district_code AS code, MIN(district_name) AS name,
           city_code AS "cityCode", MIN(city_name) AS "cityName"
    FROM villages
    GROUP BY district_code, city_code
    ORDER BY MIN(city_name), MIN(district_name)`);
}

/** Kode kecamatan yang benar-benar dikenal, dari daftar kandidat. Dipakai kedua fungsi save di bawah. */
async function knownDistricts(db, codes) {
  return new Set((await store.all(db, `
    SELECT DISTINCT district_code AS code FROM villages
    WHERE district_code = ANY(?)`, [codes])).map((r) => r.code));
}

/**
 * Ganti seluruh ring satu dealer sekaligus.
 *
 * Hapus lalu tulis ulang di dalam satu transaksi — pola yang sama dengan impor, dan
 * alasannya sama: menambal sebagian membuat sisa dari susunan lama tertinggal tanpa
 * ada yang tahu. Yang dikirim halaman adalah gambaran LENGKAP ring dealer itu.
 *
 * Kode kecamatan yang tidak dikenal DITOLAK, bukan dilewati diam-diam.
 *
 * @param {string} dealerCode
 * @param {Object} assignments  {districtCode: 1|2|3}
 */
async function saveDealerRings(dealerCode, assignments) {
  const db = store.db();
  const dealer = await store.one(db,
    'SELECT dealer_code FROM dealers WHERE dealer_code = ?', [dealerCode]);
  if (!dealer) throw new Error(`Dealer ${dealerCode} tidak ada.`);

  const entries = Object.entries(assignments || {});
  for (const [, ring] of entries) {
    if (![1, 2, 3].includes(Number(ring))) {
      throw new Error('Ring harus 1, 2, atau 3.');
    }
  }

  if (entries.length) {
    const codes = entries.map(([code]) => code);
    const dikenal = await knownDistricts(db, codes);
    const asing = codes.filter((c) => !dikenal.has(c));
    if (asing.length) {
      throw new Error(`Kecamatan tidak dikenal: ${asing.slice(0, 5).join(', ')}` +
        (asing.length > 5 ? ` dan ${asing.length - 5} lagi.` : '.'));
    }
  }

  await store.transaction(db, async (conn) => {
    await conn.query('DELETE FROM dealer_rings WHERE dealer_code = ?', [dealerCode]);
    if (entries.length) {
      const bulk = store.bulkValues(
        entries.map(([code, ring]) => [dealerCode, code, Number(ring)]));
      await conn.query(
        'INSERT INTO dealer_rings (dealer_code, district_code, ring) VALUES ' + bulk.text,
        bulk.params);
    }
  });

  return { dealer: dealerCode, districts: entries.length };
}

/**
 * Ganti seluruh coverage satu pos sekaligus. Pola sama persis dengan saveDealerRings,
 * bedanya rentang nilai (1..8) dan tabel tujuannya.
 *
 * @param {string} outletCode
 * @param {Object} assignments  {districtCode: 1..8}
 */
async function savePosCoverage(outletCode, assignments) {
  const db = store.db();
  const outlet = await store.one(db,
    'SELECT outlet_code FROM outlets WHERE outlet_code = ?', [outletCode]);
  if (!outlet) throw new Error(`Pos ${outletCode} tidak ada.`);

  const entries = Object.entries(assignments || {});
  for (const [, num] of entries) {
    if (!Number.isInteger(Number(num)) || Number(num) < 1 || Number(num) > 8) {
      throw new Error('Coverage harus angka 1 sampai 8.');
    }
  }

  if (entries.length) {
    const codes = entries.map(([code]) => code);
    const dikenal = await knownDistricts(db, codes);
    const asing = codes.filter((c) => !dikenal.has(c));
    if (asing.length) {
      throw new Error(`Kecamatan tidak dikenal: ${asing.slice(0, 5).join(', ')}` +
        (asing.length > 5 ? ` dan ${asing.length - 5} lagi.` : '.'));
    }
  }

  await store.transaction(db, async (conn) => {
    await conn.query('DELETE FROM pos_coverage_district WHERE outlet_code = ?', [outletCode]);
    if (entries.length) {
      const bulk = store.bulkValues(
        entries.map(([code, num]) => [outletCode, code, Number(num)]));
      await conn.query(
        'INSERT INTO pos_coverage_district (outlet_code, district_code, coverage_num) VALUES ' +
        bulk.text, bulk.params);
    }
  });

  return { outlet: outletCode, districts: entries.length };
}

async function resetOutlets(ip) {
  const db = store.db();

  const sebelum = await store.one(db, `
    SELECT (SELECT COUNT(*) FROM outlets) AS outlets,
           (SELECT COUNT(DISTINCT dealer_code) FROM outlets) AS dealers,
           (SELECT COUNT(*) FROM sales) AS sales,
           (SELECT COALESCE(SUM(quantity), 0) FROM sales) AS units`);
  if (!Number(sebelum.outlets)) {
    throw new Error('Master pos sudah kosong, tidak ada yang perlu direset.');
  }

  let customers = 0;
  const customerDb = store.customers();
  if (customerDb) {
    customers = (await store.run(customerDb, 'DELETE FROM customers')).rowCount || 0;
  }

  await store.transaction(db, async (conn) => {
    // Urutannya mengikuti arah foreign key: yang menunjuk dihapus lebih dulu.
    // coverage sebenarnya ON DELETE CASCADE, tapi ditulis eksplisit supaya urutan ini
    // tetap benar kalau suatu hari cascade-nya dilepas. Uji mutasi mencatat barisnya
    // sebagai mutan EKUIVALEN selama cascade-nya masih ada: membuangnya tidak membuat
    // satu tes pun merah, dan itu memang benar — bukan celah tes. Yang TIDAK ekuivalen
    // adalah membuang DELETE FROM outlets; itu langsung merah.
    await conn.query('DELETE FROM sales');
    await conn.query('DELETE FROM unmatched');
    await conn.query('DELETE FROM coverage');
    await conn.query('DELETE FROM outlets');
  });

  const now = new Date().toISOString();
  await store.run(db, `
    INSERT INTO imports (started_at, finished_at, ip, file_name, period,
                         rows_read, rows_used, new_outlets, result, message)
    VALUES (?, ?, ?, NULL, NULL, NULL, ?, NULL, 'reset', ?)`,
  [now, now, ip || null, Number(sebelum.units),
    `Master pos direset: ${sebelum.outlets} pos, ${sebelum.dealers} dealer, ` +
    `${sebelum.sales} baris penjualan (${sebelum.units} unit)` +
    (customers ? `, ${customers} data konsumen` : '') +
    '. Berkas Excel di arsip tidak ikut dihapus.']);

  return {
    outlets: Number(sebelum.outlets),
    dealers: Number(sebelum.dealers),
    sales: Number(sebelum.sales),
    units: Number(sebelum.units),
    customers,
  };
}

async function deletePeriod(period, ip) {
  const db = store.db();

  const sebelum = await store.one(db, `
    SELECT COALESCE(SUM(quantity), 0) AS units, COUNT(*) AS rows
    FROM sales WHERE period = ?`, [period]);
  if (!Number(sebelum.rows)) {
    throw new Error(`Periode ${period} tidak punya data penjualan.`);
  }

  let customers = 0;
  const customerDb = store.customers();
  if (customerDb) {
    customers = (await store.run(customerDb,
      'DELETE FROM customers WHERE period = ?', [period])).rowCount || 0;
  }

  await store.transaction(db, async (conn) => {
    await conn.query('DELETE FROM sales WHERE period = ?', [period]);
    await conn.query('DELETE FROM unmatched WHERE period = ?', [period]);
  });

  // Jejaknya masuk tabel `imports`, bukan tabel sendiri.
  //
  // Satu akun dipakai bersama, jadi menghapus sebulan data WAJIB meninggalkan jejak —
  // dan tempat orang mencarinya adalah riwayat impor, satu daftar berurut waktu tentang
  // apa yang pernah terjadi pada data. Penghapusan yang dicatat di tempat lain sama
  // saja dengan tidak dicatat.
  const now = new Date().toISOString();
  await store.run(db, `
    INSERT INTO imports (started_at, finished_at, ip, file_name, period,
                         rows_read, rows_used, new_outlets, result, message)
    VALUES (?, ?, ?, NULL, ?, NULL, ?, NULL, 'hapus', ?)`,
  [now, now, ip || null, period, Number(sebelum.units),
    `Periode dihapus: ${sebelum.units} unit, ${sebelum.rows} baris` +
    (customers ? `, ${customers} data konsumen` : '') +
    '. Berkas Excel di arsip tidak ikut dihapus.']);

  return {
    period,
    units: Number(sebelum.units),
    sales: Number(sebelum.rows),
    customers,
  };
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
 * Nama BARU langsung ditulis ke tabel `dealers` (upsert, ON CONFLICT DO NOTHING) —
 * wajib sejak `outlets.dealer_code` jadi FOREIGN KEY ke sana: outlet yang menunjuk
 * dealer yang belum ada baris-nya akan ditolak database.
 *
 * @return {{code: string, name: string}|null} null kalau namanya tidak bisa dipakai
 */
async function resolveDealer(name) {
  const bersih = String(name || '').trim().replace(/\s+/g, ' ');
  if (!bersih) return null;

  const adaSama = await store.one(store.db(), `
    SELECT dealer_code AS "dealerCode", dealer_name AS "dealerName"
    FROM dealers
    WHERE LOWER(dealer_name) = LOWER(?)
    LIMIT 1`, [bersih]);
  if (adaSama) return { code: adaSama.dealerCode, name: adaSama.dealerName };

  const code = toDealerCode(bersih);
  // Nama yang seluruhnya tanda baca ('---') menghasilkan kode kosong. Kode kosong
  // akan menggabungkan semua outlet bernasib sama jadi satu dealer hantu.
  if (!code) return null;
  await upsertDealer(code, bersih);
  return { code, name: bersih };
}

/**
 * Pastikan baris `dealers` ada untuk (code, name) — TIDAK menimpa nama yang sudah
 * tersimpan kalau kodenya sudah ada (`ON CONFLICT DO NOTHING`). Dipakai di mana pun
 * kode dealer siap ditulis ke `outlets`: resolveDealer() untuk nama yang diketik
 * manusia, dan jalur `patch.dealerCode` langsung di updateOutlet() (skrip/tes).
 */
async function upsertDealer(code, name) {
  await store.run(store.db(), `
    INSERT INTO dealers (dealer_code, dealer_name, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT (dealer_code) DO NOTHING`, [code, name, new Date().toISOString()]);
}

/** Kode, nama, alamat seluruh pos. Untuk dibandingkan dengan Excel di impor massal pos. */
async function listOutletsForImport() {
  return store.all(store.db(), `
    SELECT outlet_code AS "outletCode", outlet_name AS "outletName", address
    FROM outlets`);
}

/**
 * Semua dealer, lengkap jumlah pos yang menunjuknya. Untuk halaman Master Dealer.
 *
 * outletCount HANYA menghitung pos fisik sungguhan — baris "proxy" (lihat
 * outlets.is_dealer_proxy, dipakai menyambungkan penjualan level-dealer lama)
 * sengaja tidak ikut, supaya "Jumlah Pos" tidak diam-diam lebih besar dari
 * katalog Master Pos Dealer yang sebenarnya.
 */
async function listDealers() {
  return store.all(store.db(), `
    SELECT d.dealer_code AS code, d.dealer_name AS name, d.address, d.lat, d.lng,
           COUNT(o.outlet_code) FILTER (WHERE NOT o.is_dealer_proxy) AS "outletCount"
    FROM dealers d
    LEFT JOIN outlets o ON o.dealer_code = d.dealer_code
    GROUP BY d.dealer_code
    ORDER BY d.dealer_name`);
}

/**
 * Dealer baru, dibuat manual dari halaman Master Dealer — bukan lewat resolveDealer(),
 * karena di sini nama dealernya sendiri yang sedang didefinisikan, bukan ditebak dari
 * nama pos.
 */
async function createDealer(data) {
  const db = store.db();
  const name = String(data.dealerName || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Nama dealer wajib diisi.');
  const code = toDealerCode(name);
  if (!code) throw new Error('Nama dealer tidak bisa dipakai. Harus memuat huruf atau angka.');

  const ada = await store.one(db,
    'SELECT dealer_name FROM dealers WHERE dealer_code = ?', [code]);
  if (ada) throw new Error(`Nama ${name} sudah dipakai oleh dealer "${ada.dealer_name}".`);

  await store.run(db, `
    INSERT INTO dealers (dealer_code, dealer_name, address, lat, lng, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`,
  [code, name, data.address ? String(data.address).trim() : null,
    data.lat === undefined || data.lat === null ? null : data.lat,
    data.lng === undefined || data.lng === null ? null : data.lng,
    new Date().toISOString()]);

  return store.one(db,
    'SELECT dealer_code AS code, dealer_name AS name, address, lat, lng FROM dealers WHERE dealer_code = ?',
    [code]);
}

/**
 * Sunting dealer. Kodenya TIDAK berubah meski namanya berubah — lihat toDealerCode()
 * di createDealer(): kode cuma diturunkan sekali, waktu dealer dibuat.
 */
async function updateDealer(code, patch) {
  const db = store.db();
  const current = await store.one(db, 'SELECT * FROM dealers WHERE dealer_code = ?', [code]);
  if (!current) return null;

  const name = patch.dealerName === undefined
    ? current.dealer_name
    : String(patch.dealerName).trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Nama dealer wajib diisi.');

  // Kode dealer tidak ikut berubah waktu namanya disunting (lihat createDealer): jadi
  // dua dealer beda kode bisa saja diberi nama yang sama persis kalau tidak dicegah
  // di sini — dan itu akan membingungkan di dropdown pos, dua pilihan terlihat sama.
  if (name.toLowerCase() !== current.dealer_name.toLowerCase()) {
    const bentrok = await store.one(db,
      'SELECT dealer_code FROM dealers WHERE LOWER(dealer_name) = LOWER(?) AND dealer_code != ?',
      [name, code]);
    if (bentrok) throw new Error(`Nama ${name} sudah dipakai dealer lain.`);
  }

  await store.run(db, `
    UPDATE dealers SET dealer_name = ?, address = ?, lat = ?, lng = ?, updated_at = ?
    WHERE dealer_code = ?`, [
    name,
    patch.address === undefined ? current.address : patch.address,
    patch.lat === undefined ? current.lat : patch.lat,
    patch.lng === undefined ? current.lng : patch.lng,
    new Date().toISOString(), code,
  ]);

  return store.one(db,
    'SELECT dealer_code AS code, dealer_name AS name, address, lat, lng FROM dealers WHERE dealer_code = ?',
    [code]);
}

/** Tolak kalau masih ada pos yang menunjuk dealer ini — pindahkan dulu manual. */
async function deleteDealer(code) {
  const db = store.db();
  const current = await store.one(db, 'SELECT dealer_name FROM dealers WHERE dealer_code = ?', [code]);
  if (!current) return null;

  const { n } = await store.one(db,
    'SELECT COUNT(*) AS n FROM outlets WHERE dealer_code = ?', [code]);
  if (Number(n) > 0) {
    throw new Error(`Dealer "${current.dealer_name}" masih punya ${n} pos. Pindahkan posnya dulu.`);
  }

  await store.run(db, 'DELETE FROM dealers WHERE dealer_code = ?', [code]);
  return { code, name: current.dealer_name };
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
    // Jalur ini melewati resolveDealer() sepenuhnya (skrip/tes yang sudah tahu
    // kodenya) — upsert dealers-nya harus dilakukan di sini juga, kalau tidak FK
    // menolak outlet yang menunjuk dealer_code yang belum pernah tercatat.
    await upsertDealer(dealer.code, dealer.name);
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

/**
 * Cari koordinat satu desa dari namanya (docs/FUSION.md 2.1a).
 *
 * Tabel `villages` sudah memuat seluruh DIY + Jateng berikut centroidnya, jadi ini
 * BUKAN geocoder alamat — tidak ada jalan dan nomor rumah di sini, cuma titik tengah
 * desa. Itu memang yang tersedia di Data KTP dan Data Servis.
 *
 * `cityCode` OPSIONAL, dan itu keputusan yang perlu dijelaskan. Kunci pencocokan
 * proyek ini tiga tingkat (kota|kecamatan|desa) karena dua tingkat tabrakan di 171
 * tempat. Pemanggil yang punya kode kota — importer, yang mengambilnya dari kolom
 * Excel — mendapat resolusi yang deterministik. Pemanggil yang tidak punya (operator
 * yang mengetik manual di halaman) tetap dilayani: namanya dicari ke seluruh desa,
 * dan kalau ternyata ada di lebih dari satu kabupaten, jawabannya BUKAN salah satu
 * yang dipilih diam-diam, tapi 'ambiguous' berikut daftar kandidatnya.
 *
 * Seluruh 8.999 desa dibaca sekali per permintaan. Itu murah (beberapa milidetik) dan
 * sengaja tidak di-cache: rutenya dipakai sesekali oleh orang, bukan per baris impor.
 * Jalur impor nanti membangun indeksnya SEKALI untuk ribuan baris (2.1c).
 */
async function resolveVillageByName(input) {
  const districtName = String(input.districtName || '');
  const villageName = String(input.villageName || '');
  const cityCode = input.cityCode ? toDottedCityCode(input.cityCode) : '';

  const villages = await store.all(store.db(), `
    SELECT village_code AS code, village_name AS name, district_name AS district,
           district_code AS "districtCode", city_code AS "cityCode",
           city_name AS "cityName", province_code AS "provinceCode", lat, lng
    FROM villages`);

  // Tanpa kode kota, kunci tiga tingkat mustahil dipakai — jadi dicari apa adanya
  // lebih dulu. Satu hasil berarti tidak ada yang perlu ditebak sama sekali.
  if (!cityCode) {
    const persis = villages.filter((v) =>
      normalizeName(v.district) === normalizeName(districtName) &&
      normalizeName(v.name) === normalizeName(villageName));
    if (persis.length === 1) {
      return { status: 'ok', village: persis[0], suggestions: [] };
    }
    if (persis.length > 1) {
      return { status: 'ambiguous', village: null, suggestions: persis.slice(0, 5) };
    }
  }

  const index = buildVillageIndex(villages, await aliases());
  const candidates = cityCode
    ? villages.filter((v) => v.cityCode === cityCode)
    : villages;

  const hasil = resolveVillage({ cityCode, districtName, villageName }, index, candidates);
  const byCode = {};
  villages.forEach((v) => { byCode[v.code] = v; });

  return {
    status: hasil.status,
    village: hasil.villageCode ? byCode[hasil.villageCode] : null,
    suggestions: hasil.suggestions,
  };
}

/* ==========================================================================
   PENYATUAN TIGA SUMBER — bacaan untuk API (docs/FUSION.md Tahap E)
   ==========================================================================
   Semua di bawah ini membaca `segment_rollup` di database `astra` — agregat
   TANPA identitas. Satu-satunya yang menyentuh database PII adalah
   fusionEngineDetail() di paling bawah, dan rutenya wajib lewat piiLimiter
   plus logCustomerAccess.
   ========================================================================== */

/**
 * Simpan satu nilai konfigurasi.
 *
 * Upsert, bukan INSERT: kuncinya sudah ada sejak schema.sql menyemai nilai bawaan.
 * `updated_by` diisi IP karena itu satu-satunya yang kita punya — aplikasi ini tidak
 * punya identitas pengguna, satu sandi dipakai bersama. Jejak yang jujur tapi kasar
 * lebih berguna daripada kolom kosong.
 */
async function setAppConfig(key, value, ip) {
  await store.run(store.db(), `
    INSERT INTO app_config (key, value, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by`,
  [key, String(value), new Date().toISOString(), ip || null]);
  return { key, value: String(value) };
}

/** Periode terbaru yang sudah punya hasil penggolongan. */
async function latestFusionPeriod() {
  const row = await store.one(store.db(),
    'SELECT MAX(period) AS period FROM segment_rollup');
  return row && row.period ? row.period : null;
}

/** Susun WHERE dari penyaring yang benar-benar diisi. */
function fusionWhere(filter) {
  const where = ['period = ?'];
  const params = [filter.period];
  if (filter.cityCode) { where.push('city_code = ?'); params.push(filter.cityCode); }
  if (filter.dealerCode) { where.push('dealer_code = ?'); params.push(filter.dealerCode); }
  if (filter.segment) { where.push('segment = ?'); params.push(filter.segment); }
  return { text: where.join(' AND '), params };
}

/**
 * Angka golongan untuk satu kombinasi penyaring.
 *
 * `counts` per golongan, plus CW Sales dan Confidence Ratio yang dihitung dari
 * `weight_sum` yang SUDAH tersimpan — bukan dari bobot yang dibaca ulang sekarang.
 * Bedanya penting: kalau bobot di app_config diubah tapi penggolongan belum dihitung
 * ulang, angka yang tampil harus tetap konsisten dengan golongan yang tersimpan,
 * bukan campuran bobot baru dan golongan lama.
 */
async function fusionTotals(filter) {
  const w = fusionWhere(filter);
  const rows = await store.all(store.db(), `
    SELECT segment, SUM(customer_count) AS n, SUM(weight_sum) AS bobot
    FROM segment_rollup WHERE ${w.text} GROUP BY segment`, w.params);

  const counts = {};
  let total = 0;
  let cwSales = 0;
  rows.forEach((r) => {
    counts[r.segment] = Number(r.n);
    total += Number(r.n);
    cwSales += Number(r.bobot);
  });
  return {
    counts,
    total,
    cwSales: Number(cwSales.toFixed(2)),
    confidenceRatio: total ? cwSales / total : null,
  };
}

/** Baris rollup, buat tabel dan peringkat. Dibatasi halaman. */
async function fusionRows(filter) {
  const w = fusionWhere(filter);
  const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 500);
  const offset = Math.max(Number(filter.offset) || 0, 0);

  return store.all(store.db(), `
    SELECT r.village_code AS "villageCode", v.village_name AS "villageName",
           r.city_code AS "cityCode",
           (SELECT MIN(city_name) FROM villages c WHERE c.city_code = r.city_code) AS "cityName",
           r.dealer_code AS "dealerCode", d.dealer_name AS "dealerName",
           r.segment, r.customer_count AS "customerCount", r.weight_sum AS "weightSum"
    FROM segment_rollup r
    LEFT JOIN villages v ON v.village_code = r.village_code
    -- legacy_code, BUKAN dealer_code. Data KTP menyebut dealer dengan kode numerik
    -- Excel ('7348'), sedangkan dealers.dealer_code adalah kode turunan nama
    -- ('NUSANTARASAKTIGEJAYAN'); yang numerik disimpan di kolom legacy_code. Diukur
    -- pada data Agustus 2026: lewat legacy_code cocok 78 dari 78, lewat dealer_code
    -- cocok 0 dari 78 — seluruh nama dealer kosong di layar sampai ini diperbaiki.
    LEFT JOIN dealers d ON d.legacy_code = r.dealer_code
    WHERE ${w.text}
    ORDER BY r.customer_count DESC, r.village_code
    LIMIT ? OFFSET ?`, [...w.params, limit + 1, offset])
    .then((rows) => ({
      rows: rows.slice(0, limit),
      hasMore: rows.length > limit,
      limit,
      offset,
    }));
}

/**
 * Bahan Matriks Kota x Golongan: satu baris per (kota, golongan).
 *
 * Pivot-nya SENGAJA tidak dilakukan di SQL. Jumlah golongan bisa berubah (bobot dan
 * daftarnya sudah jadi konfigurasi), dan query dengan enam kolom yang ditulis tangan
 * akan diam-diam kehilangan golongan ketujuh tanpa error — cuma kolom yang hilang di
 * layar. Rute yang memutarnya, dari daftar golongan yang sama dengan yang dipakai
 * mesin penggolongannya.
 */
async function fusionMatrix(period, filter) {
  const where = ['period = ?'];
  const params = [period];
  if (filter && filter.cityCode) { where.push('city_code = ?'); params.push(filter.cityCode); }
  if (filter && filter.dealerCode) { where.push('dealer_code = ?'); params.push(filter.dealerCode); }

  return store.all(store.db(), `
    SELECT r.city_code AS "cityCode",
           (SELECT MIN(city_name) FROM villages c WHERE c.city_code = r.city_code) AS "cityName",
           r.segment, SUM(r.customer_count) AS n, SUM(r.weight_sum) AS bobot
    FROM segment_rollup r
    WHERE ${where.join(' AND ')}
    GROUP BY r.city_code, r.segment`, params);
}

/** Ringkasan per kota: siapa yang paling banyak, dan seberapa yakin kita. */
async function fusionByCity(period) {
  return store.all(store.db(), `
    SELECT city_code AS "cityCode",
           (SELECT MIN(city_name) FROM villages c WHERE c.city_code = r.city_code) AS "cityName",
           SUM(customer_count) AS total, SUM(weight_sum) AS "cwSales"
    FROM segment_rollup r WHERE period = ?
    GROUP BY city_code ORDER BY SUM(customer_count) DESC`, [period]);
}

/**
 * Ringkasan per dealer, berikut bahan Retention Index.
 *
 * `returning` = pelanggan yang kembali servis DEKAT rumahnya (golongan
 * loyal_verified + service_near). `delivery_near` sengaja tidak ikut: pengiriman
 * terjadi sekali di awal dan tidak membuktikan apa pun tentang pelanggan yang
 * kembali. Lihat docs/FUSION.md 2.4.
 */
async function fusionByDealer(period, cityCode) {
  const where = ['r.period = ?'];
  const params = [period, period];   // yang pertama untuk CTE `utama` di bawah
  if (cityCode) { where.push('r.city_code = ?'); params.push(cityCode); }

  // Kota dealer = kota ASAL PEMBELI TERBANYAKNYA, bukan MIN(city_code), dan bukan
  // kota dealer itu sendiri — karena kota dealer TIDAK ADA di skema: baik `dealers`
  // maupun `outlets` tidak punya kolom kota.
  //
  // MIN() yang dipakai versi pertama salah dan terbukti salah: ASTRA MOTOR KEBUMEN
  // dapat 33.01 (Cilacap) padahal 88% pembelinya 33.05 (Kebumen); ASTRA MOTOR
  // CILACAP dapat 32.07 (Bogor) padahal 94% pembelinya 33.01 (Cilacap). Kota
  // terbanyak justru cocok dengan nama dealernya sendiri di kedua kasus.
  //
  // `citySharePct` ikut dikembalikan karena dominasinya TIDAK selalu kuat — diukur:
  // 94%, 88%, 53%, 45%, 42%. Di ujung bawah itu label kota cuma mayoritas tipis, dan
  // yang membaca layar berhak tahu bedanya. Menurunkan kota dari koordinat pos
  // ditolak: cuma 55 dari 78 dealer punya pos berkoordinat, jadi 23 dealer akan
  // kehilangan labelnya demi ketepatan yang tidak seluruhnya bisa dicapai.
  //
  // JEBAKAN BACA: kalau `cityCode` diisi (filter Kota aktif), `citySharePct` SELALU
  // 100% — bukan karena dealernya terpusat, tapi karena barisnya memang sudah
  // disaring ke kota itu saja. Yang menampilkannya wajib menyembunyikan persentase
  // ini waktu filter kota sedang aktif; angkanya cuma bermakna pada Kota = Semua.
  return store.all(store.db(), `
    WITH utama AS (
      SELECT DISTINCT ON (dealer_code) dealer_code, city_code,
             SUM(customer_count) AS n
      FROM segment_rollup
      WHERE period = ?
      GROUP BY dealer_code, city_code
      ORDER BY dealer_code, SUM(customer_count) DESC, city_code
    )
    SELECT r.dealer_code AS "dealerCode", d.dealer_name AS "dealerName",
           u.city_code AS "cityCode",
           (SELECT MIN(city_name) FROM villages vc WHERE vc.city_code = u.city_code)
             AS "cityName",
           ROUND(u.n * 100.0 / NULLIF(SUM(r.customer_count), 0), 0) AS "citySharePct",
           SUM(r.customer_count) AS total, SUM(r.weight_sum) AS "cwSales",
           SUM(CASE WHEN r.segment IN ('loyal_verified', 'service_near')
                    THEN r.customer_count ELSE 0 END) AS returning
    FROM segment_rollup r
    -- legacy_code, alasan sama dengan fusionRows() di atas.
    LEFT JOIN dealers d ON d.legacy_code = r.dealer_code
    LEFT JOIN utama u ON u.dealer_code = r.dealer_code
    WHERE ${where.join(' AND ')}
    GROUP BY r.dealer_code, d.dealer_name, u.city_code, u.n
    ORDER BY SUM(r.customer_count) DESC`, params);
}

/**
 * Rincian satu nomor mesin — PII.
 *
 * Mengembalikan nama, alamat, dan titik rumah, jadi rutenya WAJIB lewat piiLimiter
 * dan mencatat aksesnya. null kalau database PII memang tidak ada: aplikasi harus
 * tetap jalan penuh tanpanya.
 */
async function fusionEngineDetail(engineNo) {
  const pii = store.customers();
  if (!pii) return null;

  const fusion = await store.one(pii, `
    SELECT engine_no AS "engineNo", period, village_code AS "villageCode",
           city_code AS "cityCode", dealer_code AS "dealerCode",
           ktp_lat AS "ktpLat", ktp_lng AS "ktpLng",
           service_lat AS "serviceLat", service_lng AS "serviceLng",
           service_count AS "serviceCount",
           delivery_lat AS "deliveryLat", delivery_lng AS "deliveryLng",
           delivery_count AS "deliveryCount",
           dist_service_m AS "distServiceM", dist_delivery_m AS "distDeliveryM",
           segment, weight, kpi_radius_m AS "kpiRadiusM", computed_at AS "computedAt"
    FROM customer_fusion WHERE engine_no = ?`, [engineNo]);
  if (!fusion) return null;

  const ktp = await store.one(pii, `
    SELECT name, address, village_text AS "villageText", district_text AS "districtText",
           village_code AS "villageCode", resolve_status AS "resolveStatus", period
    FROM customer_ktp WHERE engine_no = ? ORDER BY period DESC LIMIT 1`, [engineNo]);

  const services = await store.all(pii, `
    SELECT period, village_text AS "villageText", district_text AS "districtText",
           city_text AS "cityText", service_type AS "serviceType",
           village_code AS "villageCode", resolve_status AS "resolveStatus"
    FROM service_visit WHERE engine_no = ? ORDER BY period DESC`, [engineNo]);

  const pings = await store.all(pii, `
    SELECT sent_at AS "sentAt", lat, lng, accuracy_m AS "accuracyM",
           location_text AS "locationText", courier_name AS "courierName"
    FROM delivery_ping WHERE engine_no = ? ORDER BY sent_at DESC LIMIT 50`, [engineNo]);

  return { fusion, ktp, services, pings };
}

module.exports = {
  resolveVillageByName,
  latestFusionPeriod, fusionTotals, fusionRows, fusionByCity, fusionByDealer,
  fusionEngineDetail, setAppConfig, fusionMatrix,
  summary, unmatched, imports, periodSummary,
  customersInVillage, browseCustomers, hasCustomers, logCustomerAccess, updateOutlet,
  resetOutlets, allDealerRings, allPosCoverage, districts, saveDealerRings, savePosCoverage,
  resolveDealer, createOutlet, deletePeriod,
  listDealers, createDealer, updateDealer, deleteDealer, listOutletsForImport,
  aliases, saveAlias, deleteAlias, latestUnmatchedPeriod, unmatchedWithSuggestions,
  BROWSE_LIMIT,
};
