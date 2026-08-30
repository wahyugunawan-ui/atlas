/**
 * Uji skema `dealers` dan FK dari `outlets`, plus `scripts/backfill-dealers.js`.
 *
 * Yang dijaga di sini bukan "tabelnya ada" — itu terlihat sendiri kalau server gagal
 * start. Yang gagalnya diam: FK yang tidak benar-benar mencegah outlet menunjuk dealer
 * yang tidak ada, `schema.sql` yang cuma aman dijalankan sekali (padahal dia jalan
 * TIAP KALI server start), dan skrip backfill yang diam-diam memilih satu nama waktu
 * data lama ternyata bercabang alih-alih melaporkannya.
 */
const assert = require('assert');
const store = require('../backend/server/db');
const { openTestDb, closeTestDb, queryOutsidePool } = require('./helpers/db');
const backfillDealers = require('../scripts/backfill-dealers');

async function test() {
  const config = await openTestDb('dealers-schema');
  const db = store.db();

  try {
    /* --------------------------------------------------------------------
       FK MENOLAK dealer_code YANG TIDAK ADA
       --------------------------------------------------------------------
       Sebelum tabel dealers ada, dealer_code cuma string yang KEBETULAN konsisten —
       tidak ada yang mencegah outlet menunjuk dealer hantu. Ini yang membuatnya
       benar-benar dijamin database, bukan cuma disiplin penulis kode.
       -------------------------------------------------------------------- */
    await assert.rejects(
      () => store.run(db, `
        INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name)
        VALUES ('T01', 'Pos Uji', 'TIDAKADA', 'Dealer Hantu')`),
      /violat|constraint|foreign key/i,
      'outlet dengan dealer_code yang tidak ada di tabel dealers berhasil disimpan — ' +
      'FK tidak lagi mencegah dealer hantu');

    // Sebaliknya: dealer_code yang memang ada harus berhasil tanpa halangan.
    await store.run(db, `
      INSERT INTO dealers (dealer_code, dealer_name) VALUES ('DEALERUJI', 'Dealer Uji')`);
    await store.run(db, `
      INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name)
      VALUES ('T02', 'Pos Uji Dua', 'DEALERUJI', 'Dealer Uji')`);
    assert.strictEqual(
      (await store.one(db, "SELECT COUNT(*) AS n FROM outlets WHERE outlet_code = 'T02'")).n,
      1, 'outlet dengan dealer_code yang valid gagal disimpan');

    /* --------------------------------------------------------------------
       schema.sql AMAN DIJALANKAN BERULANG
       --------------------------------------------------------------------
       Dijalankan TIAP KALI server start (db.js: store.open -> runSchema). Kalau blok
       penambahan constraint FK tidak dijaga IF NOT EXISTS, server kedua yang start
       terhadap database yang sama akan gagal connect — bukan cuma tes yang merah.
       -------------------------------------------------------------------- */
    await assert.doesNotReject(
      () => store.open(config),
      'menjalankan schema.sql kedua kalinya (persis yang terjadi tiap server ' +
      'restart) melempar error — constraint FK ditambahkan tanpa penjaga IF NOT EXISTS');

    /* --------------------------------------------------------------------
       BACKFILL: MELAPORKAN ANOMALI, BUKAN DIAM-DIAM MEMILIH
       --------------------------------------------------------------------
       Satu dealer_code seharusnya cuma punya satu dealer_name. Kalau data lama
       (dari sebelum tabel dealers ada) ternyata bercabang, backfill akan MEMBEKUKAN
       satu nama secara sepihak (DISTINCT ON memilih yang paling baru diubah). Itu
       keputusan yang harus TERLIHAT tim, bukan hilang begitu saja ke log yang tidak
       dibaca siapa pun.
       -------------------------------------------------------------------- */
    await store.run(db, `
      INSERT INTO dealers (dealer_code, dealer_name) VALUES ('CABANG', 'Nama Awal')`);
    await store.run(db, `
      INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name)
      VALUES ('T03', 'Pos Cabang Satu', 'CABANG', 'Nama Cabang Satu')`);
    await store.run(db, `
      INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name)
      VALUES ('T04', 'Pos Cabang Dua', 'CABANG', 'Nama Cabang Dua')`);

    const baris = [];
    const asliLog = console.log;
    console.log = (...args) => { baris.push(args.join(' ')); };
    try {
      await backfillDealers(config);
    } finally {
      console.log = asliLog;
    }
    const keluaran = baris.join('\n');
    assert.match(keluaran, /PERINGATAN/i,
      'dealer_code dengan >1 nama berbeda di outlets tidak memicu peringatan apa pun');
    assert.match(keluaran, /CABANG/,
      'peringatan anomali tidak menyebut dealer_code yang sebenarnya bercabang');

    console.log('OK dealers-schema — FK menolak dealer hantu, schema.sql idempoten, ' +
      'backfill melaporkan (bukan menyembunyikan) nama yang bercabang');
  } finally {
    await closeTestDb(config).catch(() => {});
    // backfillDealers() menutup store-nya sendiri di akhir; closeTestDb menutup lagi
    // (idempoten, lihat store.close()) sekaligus membuang database ujinya.
  }
}

test().catch((error) => {
  console.error(error);
  process.exit(1);
});
