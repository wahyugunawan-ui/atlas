/**
 * Impor Master Dealer, Master Pos, ring dealer, dan coverage pos dari Excel:
 * `npm run import-dealer-pos-rings -- "<Dealer & POS ....xlsx>" "<Ring dealer.xls>"`
 *
 * Tiga fase berurutan, satu proses — ketiga sumber saling terkait lewat pencocokan
 * nama dealer/kecamatan yang sama, jadi memisahkannya jadi beberapa skrip cuma
 * menggandakan boilerplate baca-Excel dan pencocokan wilayah.
 *
 * FASE A — sheet "Dealer" (header baris 2) -> tabel `dealers`. Kolom I dan J
 * SAMA-SAMA berjudul "Koordinat" — kolom I selalu kosong, J berisi "lat, lng"
 * sungguhan; diambil lewat `header.lastIndexOf()`, bukan `indexOf()`.
 *
 * PENTING soal nama: kolom "Nama Dealer System" sebenarnya nama level CABANG
 * ("NUSANTARA SAKTI - GEJAYAN", "TUNASJAYA MEKARARMADA - WONOSARI"), bukan nama
 * perusahaan induk — 78 barisnya memang 78 cabang berbeda, walau beberapa berbagi
 * nama perusahaan yang sama. dealer_code karena itu diturunkan dari NAMA UTUH
 * (cuma badan usaha PT/CV yang dilucuti), BUKAN lewat guessDealerName() yang akan
 * memotong " - GEJAYAN" dan membuat 8 cabang "NUSANTARA SAKTI - X" bertabrakan jadi
 * satu dealer_code (sempat terjadi, 78 baris cuma menyisakan 51 baris unik — bug ini
 * sudah diperbaiki di sini).
 *
 * FASE B — sheet "POS" (header baris 1) -> tabel `outlets` + `pos_coverage_district`.
 * outlet_code memakai kolom C "Kode POS OCEAN" (level fisik per lokasi, 109 baris) —
 * BUKAN kolom A "Kode AHM Dealer" (level cabang, dipakai skema LAMA sebelum
 * permintaan ini). Keputusan ini SENGAJA mengganti seluruh isi `outlets` lama:
 * 9.949 baris penjualan dari cadangan pagi 2026-08-31 memakai kode level cabang dan
 * TIDAK PUNYA PASANGAN di 109 kode baru ini — dikonfirmasi & diterima pengguna waktu
 * perencanaan. Skrip ini karena itu MENGOSONGKAN sales/unmatched/coverage/outlets
 * (bukan astra_customers) sebelum menulis ulang, sama seperti tombol "Reset" di
 * Master Pos Dealer. Penjualan sungguhan perlu diimpor ulang lewat halaman Import
 * Data sesudah ini, memakai kode pos yang baru — sistem input penjualan per-pos
 * belum ada (dikonfirmasi pengguna), jadi ini memang wajar kosong dulu.
 *
 * FASE C — "Ring dealer.xls" (format BINER LAMA, bukan .xlsx) sheet "RING" ->
 * `dealer_rings`. Dibaca dengan `xlsx` (SheetJS), BUKAN `exceljs` — exceljs gagal
 * DIAM-DIAM atas format ini (worksheets.length === 0, tanpa error).
 *
 * FASE D (kodenya ditulis tepat sesudah Fase B, bukan sesudah Fase C — urutannya
 * tidak penting, dua-duanya cuma butuh Fase A/B selesai) — satu baris `outlets`
 * "proxy" per dealer, outlet_code = `dealers.legacy_code` (kolom "Kode Dealer"
 * numerik dari sheet Dealer, BUKAN dealer_code turunan nama). Excel penjualan
 * BULANAN Astra cuma menyebut identitas level dealer ini (lihat komentar
 * COLUMN.outletCode di backend/core/aggregate.js) — bukan kode pos fisik yang
 * dipakai Fase B. Baris proxy inilah yang membuat sales/customers level-dealer
 * yang sudah diimpor tetap tersambung tanpa mengubah skema sales/customers sama
 * sekali. Disembunyikan dari Master Pos Dealer & hitungan Jumlah Pos lewat
 * `outlets.is_dealer_proxy` (lihat repository.js/frontend/js/app.js). Lihat
 * docs/DECISIONS.md untuk latar belakang lengkap kenapa fase ini ditambahkan.
 *
 * PENCOCOKAN DEALER (Fase B & C -> dealer): sheet POS cuma menyebut nama PERUSAHAAN
 * INDUK ("PT. NUSANTARA SAKTI"), bukan cabang spesifik mana — nama saja tidak cukup
 * untuk tahu cabang yang mana dari 78. Untungnya ketiga sheet (Dealer/POS/RING)
 * berbagi kolom "Kode Dealer"/"Kode AHM Dealer" NUMERIK yang SAMA persis (diverifikasi:
 * semua 55 kode unik di POS dan semua 78 kode unik di RING ada persis di antara 78
 * kode Dealer, nol yang hilang) — jadi dealer diselesaikan lewat kode numerik itu,
 * BUKAN lewat menebak nama. Nama cuma dipakai untuk membuat dealer_code dari sheet
 * Dealer sendiri (Fase A), dan untuk pesan laporan.
 *
 * PENCOCOKAN KECAMATAN (Fase B kolom I-P, Fase C kolom E): nama kecamatan di Excel
 * bisa ambigu (sama persis di kabupaten berbeda). Diselesaikan dengan menyaring ke
 * kabupaten DEALER terkait (dari kolom "Kabupaten" sheet Dealer, dicocokkan lewat
 * coreCityName() supaya "Kab. Sleman" bertemu "Kabupaten Sleman" di database) —
 * dikonfirmasi pengguna waktu perencanaan. Kalau masih ambigu sesudah itu, atau
 * tidak ada kandidat sama sekali: DILAPORKAN, tidak ditulis ke database (CLAUDE.md:
 * baris yang tidak cocok jangan dibuang diam-diam).
 *
 * IDEMPOTEN: `dealers` dan `dealer_rings` DIKOSONGKAN juga di awal (bukan cuma
 * sales/unmatched/coverage/outlets) — bukan cuma upsert. Alasannya: dealer_code
 * diturunkan dari NAMA, dan kalau skrip ini pernah dijalankan dengan aturan turunan
 * nama yang berbeda (mis. sempat pakai guessDealerName() yang salah, lihat catatan
 * Fase A), baris dealer LAMA dengan dealer_code lama tertinggal selamanya di
 * database berdampingan dengan yang baru — upsert tidak pernah membersihkannya
 * karena kuncinya sendiri yang berubah. Mengosongkan dulu menjadikan sheet Excel
 * satu-satunya sumber kebenaran, bukan gabungan riwayat semua versi skrip yang
 * pernah dijalankan. Sesudah dikosongkan, penulisannya sendiri lewat INSERT biasa
 * (bukan upsert lagi, karena tabelnya memang sudah kosong). Ring/coverage ditulis
 * lewat repo.saveDealerRings()/savePosCoverage() yang sama dipakai editor peta.
 */
const path = require('path');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const { toDealerCode } = require('../backend/core/grouping');
const { normalizeName, coreCityName } = require('../backend/core/region');
const { cellText, parseLongLat } = require('../backend/core/excel-coords');
const { config: defaultConfig } = require('../backend/server/config');
const store = require('../backend/server/db');
const repo = require('../backend/server/repository');

const SHEET_DEALER = 'Dealer';
const SHEET_POS = 'POS';
const SHEET_RING = 'RING';

/** Baris header sheet "Dealer" ada di baris 2 (baris 1 kosong) — cek 3 baris pertama. */
function findHeaderRow(sheet, kolomPenanda) {
  for (let i = 1; i <= 3; i++) {
    const row = sheet.getRow(i);
    if (row.values.some((v) => v === kolomPenanda)) return i;
  }
  throw new Error(`Baris header ("${kolomPenanda}") tidak ditemukan di 3 baris pertama.`);
}

/**
 * 'PT. NUSANTARA SAKTI' -> 'NUSANTARA SAKTI'. Sheet "Dealer" dan sheet "POS"/"RING"
 * tidak konsisten menyertakan badan usaha (PT/CV/UD/PD) di depan nama — dealer yang
 * sama bisa muncul dengan dan tanpa awalan itu di dua sumber berbeda. Dilucuti
 * SEBELUM toDealerCode() dari kedua sisi supaya keduanya bertemu di kode yang sama,
 * sama seperti coreCityName() melucuti "Kab."/"Kabupaten" untuk kabupaten.
 */
function coreDealerName(name) {
  return String(name || '').trim().replace(/^(PT|CV|UD|PD|TB)\.?\s+/i, '').trim();
}

/** Cetak daftar (dipotong 5 + "dan N lagi") — dipakai berkali-kali di laporan akhir. */
function daftarRingkas(arr) {
  if (!arr.length) return '';
  return ` <- ${arr.slice(0, 5).join(', ')}` + (arr.length > 5 ? `, dan ${arr.length - 5} lagi` : '');
}

/**
 * Baca sheet "Dealer": {numericCode, dealerCode, name, address, cityCode, lat, lng}
 * per baris, plus laporan baris tanpa koordinat sah.
 *
 * dealerCode diturunkan dari NAMA UTUH (cuma badan usaha PT/CV/dst. dilucuti) —
 * BUKAN guessDealerName(), yang akan memotong bagian " - CABANG" dan membuat
 * beberapa cabang berbeda bertabrakan jadi satu dealer_code. Lihat catatan panjang
 * di kepala berkas.
 *
 * @param {Map<string,{code,name}>} cityByCore  coreCityName(city_name) -> {code,name}
 */
async function readDealerSheet(file, cityByCore) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheet = wb.getWorksheet(SHEET_DEALER);
  if (!sheet) throw new Error(`Sheet "${SHEET_DEALER}" tidak ada di ${file}.`);

  const headerAt = findHeaderRow(sheet, 'Nama Dealer System');
  const header = sheet.getRow(headerAt).values; // 1-based, index 0 kosong
  const col = {
    kode: header.indexOf('Kode Dealer'),
    nama: header.indexOf('Nama Dealer System'),
    alamat: header.indexOf('Alamat'),
    kabupaten: header.indexOf('Kabupaten'),
    koordinat: header.lastIndexOf('Koordinat'), // dua "Koordinat" — yang kedua isinya
  };
  for (const [k, v] of Object.entries(col)) {
    if (v < 0) throw new Error(`Kolom untuk "${k}" tidak ditemukan di sheet Dealer.`);
  }

  const rows = [];
  const tanpaKoordinat = [];
  const kabupatenTakDikenal = [];
  sheet.eachRow({ includeEmpty: false }, (row, num) => {
    if (num <= headerAt) return;
    const nama = row.getCell(col.nama).value;
    if (!nama) return;
    const namaStr = String(nama).trim();
    const koordinat = parseLongLat(row.getCell(col.koordinat).value);
    if (!koordinat) tanpaKoordinat.push(namaStr);

    const kabupatenText = String(row.getCell(col.kabupaten).value || '').trim();
    const kota = cityByCore.get(coreCityName(kabupatenText));
    if (kabupatenText && !kota) kabupatenTakDikenal.push(`${namaStr} (${kabupatenText})`);

    rows.push({
      numericCode: String(row.getCell(col.kode).value || '').trim(),
      dealerCode: toDealerCode(coreDealerName(namaStr)),
      name: namaStr,
      address: String(row.getCell(col.alamat).value || '').trim() || null,
      cityCode: kota ? kota.code : null,
      lat: koordinat ? koordinat.lat : null,
      lng: koordinat ? koordinat.lng : null,
    });
  });

  return { rows, tanpaKoordinat, kabupatenTakDikenal };
}

/**
 * Baca sheet "POS": {outletCode, name, dealerNumericCode, dealerName, address, kel,
 * kec, lat, lng, coverage: [namaKecamatan,...]} per baris (kolom I-P, sel kosong
 * dilewati).
 *
 * dealerNumericCode dari kolom "Kode AHM Dealer" — dealerName ("Nama Dealer Induk")
 * cuma nama PERUSAHAAN INDUK (bukan cabang spesifik), jadi TIDAK dipakai untuk
 * mencocokkan ke dealer_code (lihat catatan panjang di kepala berkas). dealerName
 * masih dibawa untuk pesan laporan kalau kode numeriknya ternyata tidak dikenal.
 *
 * kel/kec (kolom F/G, "Kel"/"Kec") adalah lokasi POS ITU SENDIRI — dipakai di
 * main() mencari kabupatennya sendiri, disukai di atas kabupaten dealer induk
 * waktu menyaring kandidat kecamatan KEC COVER 1-8 (satu dealer bisa punya POS di
 * lebih dari satu kabupaten tetangga).
 */
async function readPosSheet(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheet = wb.getWorksheet(SHEET_POS);
  if (!sheet) throw new Error(`Sheet "${SHEET_POS}" tidak ada di ${file}.`);

  const header = sheet.getRow(1).values;
  const col = {
    dealerKode: header.indexOf('Kode AHM Dealer'),
    dealerNama: header.indexOf('Nama Dealer Induk'),
    kodePos: header.indexOf('Kode POS OCEAN'),
    namaPos: header.indexOf('Nama POS'),
    alamat: header.indexOf('Alamat'),
    kel: header.indexOf('Kel'),
    kec: header.indexOf('Kec'),
    longlat: header.indexOf('LongLat'),
  };
  for (const [k, v] of Object.entries(col)) {
    if (v < 0) throw new Error(`Kolom untuk "${k}" tidak ditemukan di sheet POS.`);
  }
  // KEC COVER 1..8: cari kolom yang judulnya persis begitu, urut apa adanya di header.
  const coverCols = [];
  header.forEach((judul, idx) => {
    if (/^KEC COVER \d$/i.test(String(judul || '').trim())) coverCols.push(idx);
  });
  if (coverCols.length !== 8) {
    throw new Error(`Kolom "KEC COVER 1".."KEC COVER 8" tidak lengkap (ketemu ${coverCols.length}).`);
  }

  const rows = [];
  const tanpaKode = [];
  // sheet.rowCount bisa menyesatkan (format kolom sampai jutaan baris) — dibatasi
  // actualRowCount, lihat catatan eksplorasi berkas ini.
  const batas = sheet.actualRowCount || sheet.rowCount;
  for (let num = 2; num <= batas; num++) {
    const row = sheet.getRow(num);
    const kodePos = String(cellText(row.getCell(col.kodePos).value) || '').trim();
    if (!kodePos) continue;
    const namaPos = String(cellText(row.getCell(col.namaPos).value) || '').trim();
    if (!namaPos) { tanpaKode.push(`baris ${num}`); continue; }

    const koordinat = parseLongLat(cellText(row.getCell(col.longlat).value));
    rows.push({
      outletCode: kodePos,
      name: namaPos,
      dealerNumericCode: String(cellText(row.getCell(col.dealerKode).value) || '').trim(),
      dealerName: String(cellText(row.getCell(col.dealerNama).value) || '').trim(),
      address: String(cellText(row.getCell(col.alamat).value) || '').trim() || null,
      kel: String(cellText(row.getCell(col.kel).value) || '').trim(),
      kec: String(cellText(row.getCell(col.kec).value) || '').trim(),
      lat: koordinat ? koordinat.lat : null,
      lng: koordinat ? koordinat.lng : null,
      coverage: coverCols
        .map((idx) => String(cellText(row.getCell(idx).value) || '').trim())
        .filter(Boolean),
    });
  }

  return { rows, tanpaKode };
}

/** Baca "Ring dealer.xls" (format BINER LAMA) sheet "RING" lewat SheetJS, bukan exceljs. */
/**
 * Kolom sungguhan (dicek langsung terhadap berkas): A Kode Dealer (numerik, dipakai
 * mencocokkan ke dealer — lihat catatan di kepala berkas), B Nama Dealer (cuma untuk
 * pesan laporan), C Kabupaten, D Kecamatan, E Ring ("RING 1".."RING 3", atau "LOKASI"
 * untuk kecamatan tempat dealer itu sendiri berada — BUKAN ring, dilewati dari
 * dealer_rings karena "lokasi" dihitung dinamis di halaman, bukan disimpan). Kolom
 * F-J berikutnya (Gabung/Ring duplikat) tidak dipakai.
 *
 * @param {Map<string,{code,name}>} cityByCore  coreCityName(city_name) -> {code,name}
 */
function readRingSheet(file, cityByCore) {
  const wb = XLSX.readFile(file);
  const sheetName = wb.SheetNames.find((n) => n.toUpperCase() === SHEET_RING) || wb.SheetNames[0];
  if (!wb.Sheets[sheetName]) throw new Error(`Sheet "${SHEET_RING}" tidak ada di ${file}.`);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });

  // Baris pertama yang menyebut persis "Nama Dealer" di kolom B dianggap header.
  let mulai = 1;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if (String(rows[i][1] || '').trim().toLowerCase() === 'nama dealer') { mulai = i + 1; break; }
  }

  const hasil = [];
  const ringTakDikenal = [];
  let lokasiDilewati = 0;
  for (let i = mulai; i < rows.length; i++) {
    const dealerNumericCode = String(rows[i][0] || '').trim(); // kolom A
    const dealerName = String(rows[i][1] || '').trim();      // kolom B
    const kabupatenText = String(rows[i][2] || '').trim();   // kolom C
    const kecamatan = String(rows[i][3] || '').trim();       // kolom D
    const ringText = String(rows[i][4] || '').trim();        // kolom E
    if (!dealerName || !kecamatan || !ringText) continue;

    // "LOKASI" (kecamatan tempat dealer sendiri berada) dan "OTHERS" (kecamatan yang
    // sengaja TIDAK masuk ring manapun) BUKAN kesalahan format — dua-duanya nilai
    // sah di sumber, cuma tidak berarti "ring 1/2/3" dan karena itu dilewati dari
    // dealer_rings, bukan dianggap "format tidak dikenali".
    if (/^(lokasi|others?)$/i.test(ringText)) { lokasiDilewati++; continue; }

    const cocok = /ring\s*(\d)/i.exec(ringText);
    const ring = cocok ? Number(cocok[1]) : null;
    if (!ring || ring < 1 || ring > 3) {
      ringTakDikenal.push(`${dealerName} / ${kecamatan}: "${ringText}"`);
      continue;
    }
    // "KODYA" (singkatan lama "Kotamadya") dipakai berkas ini SENDIRIAN, tanpa nama
    // kota mengikutinya — di cakupan Jateng+DIY cuma ada satu kotamadya yang relevan
    // di sini, Kota Yogyakarta, jadi ditulis eksplisit sebagai satu-satunya alias
    // yang tidak bisa diselesaikan coreCityName() (bukan pola umum, khusus sumber ini).
    const kabupatenEfektif = /^KODYA$/i.test(kabupatenText) ? 'YOGYAKARTA' : kabupatenText;
    const kota = cityByCore.get(coreCityName(kabupatenEfektif));
    hasil.push({
      dealerNumericCode, dealerName, kecamatan, ring, cityCode: kota ? kota.code : null,
    });
  }
  return { rows: hasil, ringTakDikenal, lokasiDilewati };
}

/**
 * @param {Object} [config]  dari config.js secara default; tes lewat config database
 *   sementaranya sendiri supaya tidak pernah menyentuh database sungguhan.
 * @param {string} [dealerPosFile]  path "Dealer & POS ....xlsx"; process.argv[2] bawaan.
 * @param {string} [ringFile]  path "Ring dealer.xls"; process.argv[3] bawaan.
 * @param {boolean} [noReset]  lewati blok RESET (lihat di bawah); process.argv
 *   `--no-reset` bawaan. Dipakai memperbaiki/menyegarkan Master Dealer & Master Pos
 *   TANPA membuang sales/customers yang sudah diimpor lewat halaman Import Data —
 *   lihat docs/DECISIONS.md untuk kapan ini dibutuhkan.
 */
async function main(config, dealerPosFile, ringFile, noReset) {
  config = config || defaultConfig;
  const argv = process.argv.slice(2).filter((a) => a !== '--no-reset');
  dealerPosFile = dealerPosFile || argv[0];
  ringFile = ringFile || argv[1];
  if (noReset === undefined) noReset = process.argv.includes('--no-reset');
  if (!dealerPosFile || !ringFile) {
    console.error('\n  Pakai: npm run import-dealer-pos-rings -- ' +
      '"<Dealer & POS ....xlsx>" "<Ring dealer.xls>" [--no-reset]\n');
    process.exitCode = 1;
    return;
  }
  dealerPosFile = path.resolve(dealerPosFile);
  ringFile = path.resolve(ringFile);

  await store.open(config);
  const db = store.db();

  // --- indeks wilayah, dipakai Fase A (kabupaten dealer) dan Fase B/C (kecamatan) ---
  const villageRows = await store.all(db,
    'SELECT DISTINCT district_code, district_name, city_code, city_name FROM villages');
  const cityByCore = new Map();
  villageRows.forEach((v) => {
    if (!cityByCore.has(coreCityName(v.city_name))) {
      cityByCore.set(coreCityName(v.city_name), { code: v.city_code, name: v.city_name });
    }
  });
  const districtsByNorm = new Map(); // normName -> [{code, cityCode, name}]
  villageRows.forEach((v) => {
    const key = normalizeName(v.district_name);
    if (!districtsByNorm.has(key)) districtsByNorm.set(key, []);
    districtsByNorm.get(key).push({ code: v.district_code, cityCode: v.city_code, name: v.district_name });
  });

  // Kelurahan+kecamatan -> kabupaten, dipakai Fase B mencari kabupaten POS ITU
  // SENDIRI (kolom Kel/Kec sheet POS) — lebih akurat daripada kabupaten dealer
  // induk waktu menyaring kandidat kecamatan KEC COVER 1-8, karena satu dealer
  // bisa punya POS di beberapa kabupaten tetangga. Dua tingkat (bukan tiga
  // seperti regionKey()) cukup untuk tujuan ini — dipakai cuma sebagai PETUNJUK
  // kabupaten, bukan mencocokkan kelurahan penjualan sungguhan.
  const villageDetailRows = await store.all(db,
    'SELECT village_name, district_name, city_code FROM villages');
  const cityByKelKec = new Map();
  villageDetailRows.forEach((v) => {
    const key = normalizeName(v.district_name) + '|' + normalizeName(v.village_name);
    if (!cityByKelKec.has(key)) cityByKelKec.set(key, v.city_code);
  });

  /** @return {{code,name}|null} kecamatan tunggal, diprioritaskan yang sekabupaten. */
  function matchDistrict(name, cityCodeHint) {
    const kandidat = districtsByNorm.get(normalizeName(name));
    if (!kandidat || !kandidat.length) return null;
    if (kandidat.length === 1) return kandidat[0];
    const sekabupaten = kandidat.filter((k) => k.cityCode === cityCodeHint);
    return sekabupaten.length === 1 ? sekabupaten[0] : null;
  }

  console.log('\n  Membaca berkas Excel...');
  const dealerSheet = await readDealerSheet(dealerPosFile, cityByCore);
  const posSheet = await readPosSheet(dealerPosFile);
  const ringSheet = readRingSheet(ringFile, cityByCore);

  const dealerCityCode = new Map(dealerSheet.rows.map((d) => [d.dealerCode, d.cityCode]));
  // Kunci sesungguhnya yang menghubungkan Dealer <-> POS <-> RING — lihat catatan
  // panjang di kepala berkas soal kenapa ini numerik, bukan nama.
  const numericToDealerCode = new Map(dealerSheet.rows.map((d) => [d.numericCode, d.dealerCode]));

  /* ======================================================================
     RESET — sales/unmatched/coverage/outlets/dealer_rings/dealers lama (BUKAN
     astra_customers). Wajib: kode pos lama (level cabang) tidak sekeluarga dengan
     109 kode baru (level fisik), dan dealer_code lama bisa memakai aturan turunan
     nama yang berbeda — lihat catatan panjang di kepala berkas.

     DILEWATI kalau --no-reset diberikan: dipakai memperbaiki/menyegarkan Master
     Dealer & Master Pos tanpa membuang sales/customers yang sudah diimpor lewat
     Import Data — lihat docs/DECISIONS.md.
     ====================================================================== */
  const sebelum = await store.one(db, 'SELECT COUNT(*) AS n FROM outlets');
  const dealerSebelum = await store.one(db, 'SELECT COUNT(*) AS n FROM dealers');
  if (!noReset) {
    await store.transaction(db, async (conn) => {
      await conn.query('DELETE FROM sales');
      await conn.query('DELETE FROM unmatched');
      await conn.query('DELETE FROM coverage');
      await conn.query('DELETE FROM outlets');
      await conn.query('DELETE FROM dealer_rings');
      await conn.query('DELETE FROM dealers');
    });
  }

  /* ====================================================================== FASE A */
  // ON CONFLICT tetap dipasang walau tabelnya baru dikosongkan — jaring pengaman
  // murah kalau ternyata ada dua baris Excel yang toDealerCode()-nya kebetulan sama
  // persis, supaya skrip melapor lewat penghitungan (dealerDitulis < 78 di baris
  // Excel), bukan crash di tengah jalan. Dengan --no-reset, ON CONFLICT inilah yang
  // benar-benar dipakai — dealer sudah ada, cuma diperbarui (termasuk legacy_code
  // yang sebelumnya belum pernah tersimpan).
  let dealerDitulis = 0;
  for (const d of dealerSheet.rows) {
    await store.run(db, `
      INSERT INTO dealers (dealer_code, dealer_name, address, lat, lng, legacy_code, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (dealer_code) DO UPDATE SET
        dealer_name = EXCLUDED.dealer_name, address = EXCLUDED.address,
        lat = EXCLUDED.lat, lng = EXCLUDED.lng, legacy_code = EXCLUDED.legacy_code,
        updated_at = EXCLUDED.updated_at`,
    [d.dealerCode, d.name, d.address, d.lat, d.lng, d.numericCode || null,
      new Date().toISOString()]);
    dealerDitulis++;
  }

  /* ====================================================================== FASE B */
  let posDitulis = 0;
  const posDealerAsing = [];
  const posCoverageTakDikenal = [];
  let posCoverageDitulis = 0;

  for (const p of posSheet.rows) {
    const dealerCode = numericToDealerCode.get(p.dealerNumericCode);
    if (!dealerCode) {
      // Kode dealer numerik tidak ketemu di sheet Dealer — pos ini DILEWATI, bukan
      // ditulis dengan dealer_code palsu yang melanggar foreign key. Dilaporkan,
      // bukan dibuang diam-diam.
      posDealerAsing.push(`${p.name} (kode dealer: ${p.dealerNumericCode}, nama: ${p.dealerName})`);
      continue;
    }

    await store.run(db, `
      INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name, address, lat, lng, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (outlet_code) DO UPDATE SET
        outlet_name = EXCLUDED.outlet_name, dealer_code = EXCLUDED.dealer_code,
        dealer_name = EXCLUDED.dealer_name, address = EXCLUDED.address,
        lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = EXCLUDED.updated_at`,
    [p.outletCode, p.name, dealerCode, p.dealerName, p.address, p.lat, p.lng,
      new Date().toISOString()]);
    posDitulis++;

    // Kabupaten POS ITU SENDIRI diutamakan (kolom Kel/Kec, lebih tepat), jatuh
    // ke kabupaten dealer induk kalau lokasinya sendiri tidak bisa diselesaikan.
    const posOwnCity = cityByKelKec.get(normalizeName(p.kec) + '|' + normalizeName(p.kel));
    const cityHint = posOwnCity || dealerCityCode.get(dealerCode);
    const assignments = {};
    p.coverage.forEach((namaKec, i) => {
      const match = matchDistrict(namaKec, cityHint);
      if (!match) { posCoverageTakDikenal.push(`${p.name}: cov${i + 1} "${namaKec}"`); return; }
      assignments[match.code] = i + 1;
    });
    if (Object.keys(assignments).length) {
      await repo.savePosCoverage(p.outletCode, assignments);
      posCoverageDitulis += Object.keys(assignments).length;
    }
  }

  /* ======================================================================
     FASE D — satu baris outlets "proxy" per dealer, dikunci ke legacy_code.
     Lihat komentar panjang di atas tabel outlets di schema.sql. Menulis ke
     outlet_code yang SAMA dengan yang dipakai importer bulanan (kolom "Kode
     Dealer" di Excel penjualan) — ON CONFLICT DO UPDATE ini jugalah yang
     memperbaiki baris outlet_name='[object Object]' kalau sebelumnya sempat
     tertulis begitu oleh bug pembacaan sel formula di importer.js (sudah
     diperbaiki, tapi baris lama yang sudah terlanjur tertulis perlu diperbaiki
     lewat sini, bukan lewat re-impor Excel penjualan).
     ====================================================================== */
  let proxyDitulis = 0;
  const proxyTanpaKode = [];
  for (const d of dealerSheet.rows) {
    if (!d.numericCode) { proxyTanpaKode.push(d.name); continue; }
    await store.run(db, `
      INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name,
                            address, lat, lng, updated_at, is_dealer_proxy)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, true)
      ON CONFLICT (outlet_code) DO UPDATE SET
        outlet_name = EXCLUDED.outlet_name, dealer_code = EXCLUDED.dealer_code,
        dealer_name = EXCLUDED.dealer_name, is_dealer_proxy = true,
        updated_at = EXCLUDED.updated_at`,
    [d.numericCode, d.name, d.dealerCode, d.name, d.address, new Date().toISOString()]);
    proxyDitulis++;
  }
  // Baris dealer "hantu" dari bug lama (mis. dealer_code='OBJECTOBJECT') sekarang
  // yatim — tidak ada lagi outlet yang menunjuknya, semua sudah dipindah ke
  // dealer_code yang benar di atas. Aman dihapus.
  const dealerAsli = new Set(dealerSheet.rows.map((d) => d.dealerCode));
  const dealerHantu = (await store.all(db, 'SELECT dealer_code AS code FROM dealers'))
    .map((r) => r.code).filter((code) => !dealerAsli.has(code));
  for (const code of dealerHantu) {
    await store.run(db, 'DELETE FROM dealers WHERE dealer_code = ?', [code]);
  }

  /* ====================================================================== FASE C */
  const byDealer = new Map(); // dealerCode -> {districtCode: ring}
  const ringKecTakDikenal = [];
  const ringDealerAsing = [];
  ringSheet.rows.forEach((r) => {
    const dealerCode = numericToDealerCode.get(r.dealerNumericCode);
    if (!dealerCode) {
      ringDealerAsing.push(`${r.dealerName} (kode: ${r.dealerNumericCode})`);
      return;
    }
    // Kabupaten dari BARIS INI sendiri (kolom C sheet RING) — lebih akurat daripada
    // kabupaten dealer dari sheet Dealer, karena satu dealer bisa punya ring lintas
    // beberapa kabupaten tetangga.
    const cityHint = r.cityCode || dealerCityCode.get(dealerCode);
    const match = matchDistrict(r.kecamatan, cityHint);
    if (!match) { ringKecTakDikenal.push(`${r.dealerName} / "${r.kecamatan}"`); return; }
    if (!byDealer.has(dealerCode)) byDealer.set(dealerCode, {});
    byDealer.get(dealerCode)[match.code] = r.ring;
  });

  let dealerRingDitulis = 0;
  for (const [dealerCode, assignments] of byDealer) {
    await repo.saveDealerRings(dealerCode, assignments);
    dealerRingDitulis += Object.keys(assignments).length;
  }

  /* ====================================================================== LAPORAN */
  console.log('');
  if (noReset) {
    console.log(`  === --no-reset: RESET DILEWATI ===`);
    console.log(`  outlets/dealers sebelumnya         : ${sebelum.n} / ${dealerSebelum.n} baris`);
    console.log(`  (sales/customers yang sudah diimpor TIDAK disentuh)`);
  } else {
    console.log(`  === RESET ===`);
    console.log(`  pos lama dihapus (level cabang)  : ${sebelum.n}`);
    console.log(`  dealer lama dihapus               : ${dealerSebelum.n}`);
    console.log(`  (penjualan/jangkauan lama ikut terhapus — impor ulang lewat Import Data)`);
  }
  console.log('');
  console.log(`  === MASTER DEALER (Fase A) ===`);
  console.log(`  dealer ditulis                   : ${dealerDitulis}`);
  console.log(`  tanpa koordinat sah               : ${dealerSheet.tanpaKoordinat.length}` +
    daftarRingkas(dealerSheet.tanpaKoordinat));
  console.log(`  kabupaten tidak dikenal            : ${dealerSheet.kabupatenTakDikenal.length}` +
    daftarRingkas(dealerSheet.kabupatenTakDikenal));
  console.log('');
  console.log(`  === MASTER POS (Fase B) ===`);
  console.log(`  pos ditulis                       : ${posDitulis}`);
  console.log(`  baris tanpa kode/nama pos          : ${posSheet.tanpaKode.length}` +
    daftarRingkas(posSheet.tanpaKode));
  console.log(`  pos dengan dealer induk asing      : ${posDealerAsing.length}` +
    daftarRingkas(posDealerAsing));
  console.log(`  coverage ditulis (baris kecamatan) : ${posCoverageDitulis}`);
  console.log(`  coverage: kecamatan tidak dikenal/ambigu : ${posCoverageTakDikenal.length}` +
    daftarRingkas(posCoverageTakDikenal));
  console.log('');
  console.log(`  === OUTLET PROXY DEALER (Fase D) ===`);
  console.log(`  proxy ditulis/diperbaiki           : ${proxyDitulis}`);
  console.log(`  dealer tanpa kode numerik           : ${proxyTanpaKode.length}` +
    daftarRingkas(proxyTanpaKode));
  console.log(`  dealer hantu (kode lama) dihapus     : ${dealerHantu.length}` +
    daftarRingkas(dealerHantu));
  console.log('');
  console.log(`  === RING DEALER (Fase C) ===`);
  console.log(`  ring ditulis (baris kecamatan)     : ${dealerRingDitulis}`);
  console.log(`  baris "LOKASI"/"OTHERS" dilewati (bukan ring) : ${ringSheet.lokasiDilewati}`);
  console.log(`  ring: dealer tidak dikenal         : ${ringDealerAsing.length}` +
    daftarRingkas(ringDealerAsing));
  console.log(`  ring: kecamatan tidak dikenal/ambigu : ${ringKecTakDikenal.length}` +
    daftarRingkas(ringKecTakDikenal));
  console.log(`  ring: format ring tidak dikenali     : ${ringSheet.ringTakDikenal.length}` +
    daftarRingkas(ringSheet.ringTakDikenal));
  console.log('');
  console.log('  Lanjutkan: npm run export-geo   (segarkan berkas peta untuk browser)');
  if (noReset) {
    console.log('             Restart server (kode readXlsx/repository.js berubah), lalu buka');
    console.log('             Data Konsumen — kolom "Pos Dealer" seharusnya sudah benar.');
  } else {
    console.log('             Buka Import Data di browser untuk mengisi penjualan dengan kode pos baru.');
  }
  console.log('');

  await store.close();
}

module.exports = main;

if (require.main === module) {
  main().catch((error) => {
    console.error('\n  GAGAL:', error.message, '\n');
    process.exit(1);
  });
}
