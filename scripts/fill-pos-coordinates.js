/**
 * Isi koordinat pos yang masih kosong dari sheet "POS" milik AHM:
 * `npm run fill-pos-coordinates -- <berkas.xlsx>`
 *
 * Sekali jalan, berdiri sendiri. TIDAK memakai backend/core/pos-diff.js: sheet "POS"
 * levelnya lebih rinci dari outlet_code kita (satu outlet_code kita bisa punya banyak
 * baris POS fisik di sini — 55 kode menyebar jadi 109 baris di sumber yang sudah
 * diperiksa), dan aturannya beda ("kandidat pertama + laporkan sisanya untuk
 * outlet_code yang bercabang" bukan diff nama/alamat seperti sheet "Dealer").
 *
 * Hanya mengisi outlets.lat yang MASIH KOSONG — kalau tidak, menjalankan skrip ini
 * dua kali (atau terhadap Excel yang sudah usang) akan menimpa pin yang sudah
 * diperbaiki manual lewat aplikasi. Pengamannya `AND lat IS NULL` di UPDATE itu
 * sendiri, bukan cuma dicek duluan di JavaScript — supaya tidak ada celah antara
 * baca dan tulis kalau ada yang sedang menyunting manual bersamaan.
 */
const ExcelJS = require('exceljs');
const { config: defaultConfig } = require('../backend/server/config');
const store = require('../backend/server/db');

/** Ambil nilai formula ({formula, result}) atau nilai polos, sebagai teks. */
function cellText(value) {
  if (value && typeof value === 'object' && 'result' in value) return value.result;
  return value;
}

/**
 * "−7.800178631152708, 110.35219737379504" -> {lat, lng}. Longgar dengan sengaja:
 * satu baris di sumber sekarang diawali tanda baca liar (";-7.51..., 109.29...") —
 * mengekstrak DUA angka desimal pertama yang dipisah koma tetap menemukan pasangan
 * yang benar tanpa perlu tahu bentuk kerusakannya duluan.
 */
function parseLongLat(raw) {
  const teks = String(raw == null ? '' : raw).trim();
  const cocok = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(teks);
  if (!cocok) return null;
  const lat = Number(cocok[1]);
  const lng = Number(cocok[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** @return {Array<{rowNumber, outletCode, raw}>} satu per baris data di sheet POS. */
async function readPosSheet(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.getWorksheet('POS');
  if (!sheet) throw new Error(`Sheet "POS" tidak ditemukan di ${file}.`);

  let outletCodeCol = null;
  let longLatCol = null;
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const judul = String(cell.value || '').toLowerCase().trim();
    if (judul.includes('kode ahm dealer')) outletCodeCol = colNumber;
    if (judul === 'longlat') longLatCol = colNumber;
  });
  if (!outletCodeCol || !longLatCol) {
    throw new Error(
      'Kolom "Kode AHM Dealer" atau "LongLat" tidak ketemu di baris judul sheet POS. ' +
      'Berkasnya sudah berubah bentuk?');
  }

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    rows.push({
      rowNumber,
      outletCode: String(row.getCell(outletCodeCol).value || '').trim(),
      raw: cellText(row.getCell(longLatCol).value),
    });
  });
  return rows;
}

/**
 * @param {Object} [config]  dari config.js secara default; tes lewat config database
 *   sementaranya sendiri supaya tidak pernah menyentuh database sungguhan.
 * @param {string} [file]  path berkas Excel; process.argv[2] secara default.
 */
async function main(config, file) {
  config = config || defaultConfig;
  file = file || process.argv[2];
  if (!file) {
    console.error('\n  Pakai: npm run fill-pos-coordinates -- <berkas.xlsx>\n');
    process.exitCode = 1;
    return;
  }

  const baris = await readPosSheet(file);

  const gagalParse = [];
  const byCode = new Map();
  baris.forEach((r) => {
    if (!r.outletCode) return; // baris tanpa kode tidak bisa dijodohkan ke outlet mana pun
    const koordinat = parseLongLat(r.raw);
    if (!koordinat) {
      gagalParse.push({ baris: r.rowNumber, outletCode: r.outletCode, nilai: r.raw });
      return;
    }
    if (!byCode.has(r.outletCode)) byCode.set(r.outletCode, []);
    byCode.get(r.outletCode).push({ ...koordinat, baris: r.rowNumber });
  });

  await store.open(config);
  const db = store.db();

  const kosong = await store.all(db,
    'SELECT outlet_code, outlet_name FROM outlets WHERE lat IS NULL');

  let terisi = 0;
  const tidakKetemu = [];
  const perluVerifikasi = [];
  const now = new Date().toISOString();

  for (const outlet of kosong) {
    const kandidat = byCode.get(outlet.outlet_code);
    if (!kandidat) { tidakKetemu.push(outlet); continue; }

    if (kandidat.length > 1) {
      perluVerifikasi.push({
        outletCode: outlet.outlet_code,
        outletName: outlet.outlet_name,
        dipakai: kandidat[0],
        dibuang: kandidat.slice(1),
      });
    }

    // ponytail: `AND lat IS NULL` di sini jaga-jaga terhadap jendela balapan antara
    // SELECT `kosong` di atas dan UPDATE ini (skrip berjalan menit-an untuk 100-an
    // baris; seseorang bisa saja sedang pin manual lewat aplikasi persis di outlet
    // yang sama). Jalur non-balapan sudah teruji lewat SELECT-nya; jendela balapan
    // itu sendiri tidak disimulasikan tesnya — butuh mock store.run untuk menyuntik
    // tulisan konkuren, ongkosnya tidak sepadan untuk skrip sekali-jalan ini.
    const pilihan = kandidat[0];
    const info = await store.run(db, `
      UPDATE outlets SET lat = ?, lng = ?, updated_at = ?
      WHERE outlet_code = ? AND lat IS NULL`,
    [pilihan.lat, pilihan.lng, now, outlet.outlet_code]);
    if (info.rowCount) terisi++;
  }

  console.log('');
  console.log(`  pos tanpa koordinat sebelumnya : ${kosong.length}`);
  console.log(`  terisi dari sheet POS          : ${terisi}`);
  console.log(`  tidak ketemu di sheet POS      : ${tidakKetemu.length}`);
  if (tidakKetemu.length) {
    tidakKetemu.forEach((o) => console.log(`      ${o.outlet_code}  ${o.outlet_name}`));
  }
  console.log(`  baris LongLat gagal diparse    : ${gagalParse.length}`);
  if (gagalParse.length) {
    gagalParse.forEach((g) =>
      console.log(`      baris ${g.baris}  ${g.outletCode}  nilai: ${JSON.stringify(g.nilai)}`));
  }
  console.log(`  perlu verifikasi manual        : ${perluVerifikasi.length} ` +
    '(outlet_code dengan >1 baris POS — kandidat pertama yang dipakai)');
  if (perluVerifikasi.length) {
    perluVerifikasi.forEach((v) => {
      console.log(`      ${v.outletCode}  ${v.outletName}`);
      console.log(`          dipakai : ${v.dipakai.lat}, ${v.dipakai.lng}  (baris ${v.dipakai.baris})`);
      v.dibuang.forEach((d) =>
        console.log(`          dibuang : ${d.lat}, ${d.lng}  (baris ${d.baris})`));
    });
  }
  console.log('');

  await store.close();
}

module.exports = main;

// Jalan sendiri cuma waktu dipanggil langsung — bukan waktu berkas ini di-require
// tes, yang butuh memanggil main(config, file) dengan config database UJI.
if (require.main === module) {
  main().catch((error) => {
    console.error('\n  GAGAL:', error.message, '\n');
    process.exit(1);
  });
}
