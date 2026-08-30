/**
 * Uji backend/server/pos-import.js: pratinjau tidak menyentuh outlets sama sekali,
 * commit atomik (satu baris gagal membatalkan semuanya), token kedaluwarsa ditolak,
 * dan commit menolak selagi impor bulanan sedang berjalan (kunci bersama).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const store = require('../backend/server/db');
const repo = require('../backend/server/repository');
const importLock = require('../backend/server/import-lock');
const { previewOutletImport, commitOutletImport } = require('../backend/server/pos-import');
const { openTestDb, closeTestDb } = require('./helpers/db');

const HEADER = 'Kode Dealer,Nama Dealer System,Alamat';

function makeCsv(dir, name, rows) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, [HEADER].concat(rows).join('\n'));
  return file;
}

async function seed(db) {
  await store.run(db, "INSERT INTO dealers (dealer_code, dealer_name) VALUES ('D1', 'DEALER SATU')");
  await store.run(db, `
    INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name, address)
    VALUES ('O01', 'Pos Satu', 'D1', 'DEALER SATU', 'Alamat Lama')`);
  await store.run(db, `
    INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name, address)
    VALUES ('O02', 'Pos Dua', 'D1', 'DEALER SATU', 'Alamat Dua')`);
}

async function test() {
  const config = await openTestDb('pos-import');
  const dir = config.dataDir;
  const db = store.db();
  await seed(db);

  try {
    /* --------------------------------------------------------------------
       PRATINJAU TIDAK MENYENTUH outlets SAMA SEKALI
       -------------------------------------------------------------------- */
    const csv1 = makeCsv(dir, 'pos1.csv', [
      'O01,Pos Satu Baru,Alamat Lama',      // outletName beda -> changed
      'O02,Pos Dua,Alamat Dua',             // identik -> unchanged
      'O03,Pos Tiga Baru,Alamat Tiga',      // belum ada -> added
      ',Tanpa Kode,Alamat',                 // invalid
    ]);
    const preview = await previewOutletImport(csv1);
    assert.ok(preview.previewToken, 'previewToken tidak ada di hasil pratinjau');
    assert.strictEqual(preview.changed.length, 1);
    assert.strictEqual(preview.changed[0].outletCode, 'O01');
    assert.strictEqual(preview.unchanged, 1);
    assert.strictEqual(preview.added.length, 1);
    assert.strictEqual(preview.invalid.length, 1);

    const sebelum = await store.one(db, "SELECT outlet_name AS n FROM outlets WHERE outlet_code = 'O01'");
    assert.strictEqual(sebelum.n, 'Pos Satu', 'pratinjau sudah mengubah data — seharusnya cuma menghitung');
    const jumlahSebelum = (await store.one(db, 'SELECT COUNT(*) AS n FROM outlets')).n;
    assert.strictEqual(Number(jumlahSebelum), 2, 'pratinjau membuat outlet baru — added seharusnya cuma dilaporkan');

    /* --------------------------------------------------------------------
       COMMIT MENERAPKAN changed, TIDAK MENYENTUH added
       -------------------------------------------------------------------- */
    const hasil = await commitOutletImport(preview.previewToken);
    assert.strictEqual(hasil.applied, 1);
    const sesudah = await store.one(db, "SELECT outlet_name AS n FROM outlets WHERE outlet_code = 'O01'");
    assert.strictEqual(sesudah.n, 'Pos Satu Baru');
    assert.strictEqual(Number((await store.one(db, 'SELECT COUNT(*) AS n FROM outlets')).n), 2,
      'commit ikut membuat outlet dari daftar added — seharusnya cuma menyunting yang sudah ada');

    // Token yang sudah dipakai tidak bisa dipakai ulang.
    await assert.rejects(() => commitOutletImport(preview.previewToken), (error) => error.code === 'KEDALUWARSA');

    /* --------------------------------------------------------------------
       TOKEN TIDAK DIKENAL / KEDALUWARSA -> ditolak dengan kode yang jelas
       -------------------------------------------------------------------- */
    await assert.rejects(() => commitOutletImport('token-tidak-ada'),
      (error) => error.code === 'KEDALUWARSA',
      'token tidak dikenal seharusnya ditolak dengan kode KEDALUWARSA (dipetakan ke HTTP 410)');

    /* --------------------------------------------------------------------
       ROLLBACK: satu baris gagal membatalkan SEMUA perubahan di commit itu
       -------------------------------------------------------------------- */
    // O02 (valid) SENGAJA ditulis lebih dulu di Excel, O01 (bakal ditolak database)
    // belakangan — supaya tes ini benar-benar menguji rollback dari perubahan yang
    // SUDAH sempat ditulis, bukan cuma "baris setelah yang gagal tidak ikut diproses".
    // Satu urutan lain sudah dicoba dan mutasinya lolos: gagal di baris pertama
    // membuat loop berhenti sebelum sempat menulis apa pun, jadi tesnya tidak menguji
    // ROLLBACK sama sekali — cuma menguji bahwa loop berhenti begitu error.
    const csv2 = makeCsv(dir, 'pos2.csv', [
      'O02,Pos Dua Baru,Alamat Dua',           // valid, harus IKUT batal
      `O01,${'X'.repeat(250)},Alamat Lama`,    // > VARCHAR(200), DB akan menolak
    ]);
    const preview2 = await previewOutletImport(csv2);
    assert.strictEqual(preview2.changed.length, 2, 'setup tes rollback tidak menghasilkan dua perubahan');

    await assert.rejects(() => commitOutletImport(preview2.previewToken));
    const o01 = await store.one(db, "SELECT outlet_name AS n FROM outlets WHERE outlet_code = 'O01'");
    const o02 = await store.one(db, "SELECT outlet_name AS n FROM outlets WHERE outlet_code = 'O02'");
    assert.strictEqual(o01.n, 'Pos Satu Baru', 'baris yang gagal ikut menimpa data lama');
    assert.strictEqual(o02.n, 'Pos Dua', 'baris LAIN yang valid ikut tertulis meski satu baris gagal — commit tidak atomik');

    /* --------------------------------------------------------------------
       KUNCI BERSAMA DENGAN IMPOR BULANAN
       -------------------------------------------------------------------- */
    const csv3 = makeCsv(dir, 'pos3.csv', ['O02,Pos Dua Ketiga Kalinya,Alamat Dua']);
    const preview3 = await previewOutletImport(csv3);
    importLock.begin();
    try {
      await assert.rejects(() => commitOutletImport(preview3.previewToken),
        (error) => error.code === 'SEDANG_BERJALAN',
        'commit tidak menolak selagi impor bulanan (atau commit lain) sedang berjalan');
    } finally {
      importLock.end();
    }
    // Kalau commit yang gagal DI ATAS (rollback VARCHAR) atau yang ditolak barusan
    // sempat lupa melepas kuncinya sendiri, commit berikutnya ini akan ikut ditolak
    // SEDANG_BERJALAN meski tidak ada apa pun yang sungguhan berjalan lagi.
    const hasil3 = await commitOutletImport(preview3.previewToken);
    assert.strictEqual(hasil3.applied, 1);

    console.log('OK pos-import — pratinjau tidak menyentuh outlets, commit atomik ' +
      '(satu baris gagal membatalkan semua), token bekas/tidak dikenal ditolak, ' +
      'commit dan impor bulanan saling menolak lewat kunci bersama');
  } finally {
    await closeTestDb(config);
  }
}

test().catch((error) => {
  console.error(error);
  process.exit(1);
});
