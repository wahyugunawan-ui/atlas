/**
 * Isi koordinat HQ dealer dari Excel: `node scripts/import-dealer-coordinates.js <berkas.xlsx>`
 *
 * Sekali pakai. Tabel `dealers` punya kolom lat/lng sejak awal tapi belum pernah
 * diisi — dibutuhkan untuk titik dealer baru di peta (permintaan Pakbos, lihat
 * docs/DECISIONS.md 2026-08-31). Sumbernya sheet "Dealer" di berkas yang diberikan:
 * kolom "Nama Dealer System" dan "Koordinat" (teks "-lat, lng").
 *
 * Pencocokan ke dealer_code LEWAT NAMA, pakai pipeline yang SAMA dengan importir
 * bulanan (guessDealerName lalu toDealerCode di backend/core/grouping.js) — kolom
 * "Kode Dealer" di Excel numerik dan tidak berhubungan dengan dealer_code di database.
 *
 * Baris yang tidak cocok DUA ARAH dilaporkan, bukan dilewati diam-diam (CLAUDE.md).
 */
const path = require('path');
const ExcelJS = require('exceljs');
const { toDealerCode, guessDealerName } = require('../backend/core/grouping');
const { config } = require('../backend/server/config');
const store = require('../backend/server/db');

const SHEET = 'Dealer';
const KOLOM_NAMA = 'Nama Dealer System';
const KOLOM_KOORDINAT = 'Koordinat';

/** Baris header ada di baris 2 (baris 1 kosong) — lihat isi berkas yang diberikan. */
function headerRow(sheet) {
  for (let i = 1; i <= 3; i++) {
    const row = sheet.getRow(i);
    if (row.values.some((v) => v === KOLOM_NAMA)) return i;
  }
  throw new Error(`Baris header ("${KOLOM_NAMA}") tidak ditemukan di 3 baris pertama.`);
}

/** '"-7.74..., 110.36..."' -> [-7.74..., 110.36...], atau null kalau tidak sah. */
function parseKoordinat(text) {
  if (!text) return null;
  const parts = String(text).split(',').map((s) => Number(s.trim()));
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  return parts;
}

async function main() {
  const file = process.argv[2] || 'Dealer & POS (dgn koordinat dealer).xlsx';

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(file));
  const sheet = wb.getWorksheet(SHEET);
  if (!sheet) throw new Error(`Sheet "${SHEET}" tidak ada di ${file}.`);

  const headerAt = headerRow(sheet);
  const header = sheet.getRow(headerAt).values; // index 1-based, index 0 kosong
  const colNama = header.indexOf(KOLOM_NAMA);
  const colKoordinat = header.lastIndexOf(KOLOM_KOORDINAT); // dua kolom "Koordinat", yang kedua isinya
  if (colNama < 0 || colKoordinat < 0) {
    throw new Error('Kolom "Nama Dealer System" atau "Koordinat" tidak ditemukan.');
  }

  const fromExcel = new Map(); // dealerCode -> {name, lat, lng}
  const tanpaKoordinat = [];
  sheet.eachRow({ includeEmpty: false }, (row, num) => {
    if (num <= headerAt) return;
    const nama = row.getCell(colNama).value;
    if (!nama) return;
    const koordinat = parseKoordinat(row.getCell(colKoordinat).value);
    const code = toDealerCode(guessDealerName(String(nama)));
    if (!koordinat) { tanpaKoordinat.push(String(nama)); return; }
    fromExcel.set(code, { name: String(nama), lat: koordinat[0], lng: koordinat[1] });
  });

  await store.open(config);
  const db = store.db();

  const dealers = await store.all(db, 'SELECT dealer_code AS code, dealer_name AS name FROM dealers');
  const dikenal = new Set(dealers.map((d) => d.code));

  const cocok = [];
  const asingDiExcel = [];
  fromExcel.forEach((row, code) => {
    if (dikenal.has(code)) cocok.push({ code, ...row });
    else asingDiExcel.push(row.name);
  });

  for (const row of cocok) {
    await store.run(db, 'UPDATE dealers SET lat = ?, lng = ? WHERE dealer_code = ?',
      [row.lat, row.lng, row.code]);
  }

  const tanpaExcel = dealers.filter((d) => !fromExcel.has(d.code)).map((d) => d.name);

  console.log('');
  console.log(`  baris di Excel        : ${fromExcel.size + tanpaKoordinat.length}`);
  console.log(`  koordinat disimpan    : ${cocok.length}`);
  console.log(`  tanpa koordinat sah   : ${tanpaKoordinat.length}` +
    (tanpaKoordinat.length ? ` <- ${tanpaKoordinat.slice(0, 5).join(', ')}` +
      (tanpaKoordinat.length > 5 ? ', ...' : '') : ''));
  console.log(`  di Excel, bukan dealer dikenal : ${asingDiExcel.length}` +
    (asingDiExcel.length ? ` <- ${asingDiExcel.slice(0, 5).join(', ')}` +
      (asingDiExcel.length > 5 ? ', ...' : '') : ''));
  console.log(`  dealer tanpa baris Excel       : ${tanpaExcel.length}` +
    (tanpaExcel.length ? ` <- ${tanpaExcel.slice(0, 5).join(', ')}` +
      (tanpaExcel.length > 5 ? ', ...' : '') : ''));
  console.log('');

  await store.close();
}

main().catch((error) => { console.error('\n  GAGAL:', error.message, '\n'); process.exit(1); });
