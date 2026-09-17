/**
 * Kolom periode `delivery_ping`: disimpan, dipakai menyaring, dan dipakai menghapus.
 *
 * KENAPA TES INI ADA. Sampai 2026-09-17 tidak ada SATU tes pun yang menyentuh
 * savePing(), deleteSourcePeriod(), atau database PII lewat ensureCustomers(). Seluruh
 * jalur itu — termasuk hapus per jenis yang sudah ter-commit sebelumnya — tidak dijaga.
 *
 * Yang dijaga di sini SIFAT arti kolomnya, karena di situ satu-satunya cara salah yang
 * tidak kelihatan: `period` = periode PEMBELIAN motornya (periode Data KTP-nya), BUKAN
 * bulan ping tiba. Motor yang dibeli Agustus bisa menerima ping di September; kalau
 * periodenya diturunkan dari `sent_at`, menghapus "Pengiriman September" akan membuang
 * titik GPS rumah pelanggan Agustus. Salah, diam-diam, dan tidak bisa dibatalkan.
 *
 * Database uji sendiri (utama + PII), dibuang di akhir.
 */
const assert = require('assert');

const store = require('../backend/server/db');
const repo = require('../backend/server/repository');
const { savePing } = require('../backend/server/source-import');
const { openTestDb, closeTestDb } = require('./helpers/db');

const SEPTEMBER = '2026-09-20T08:30:00.000Z';

async function adaKolomPeriod(pii) {
  const baris = await store.one(pii, `
    SELECT COUNT(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'delivery_ping' AND column_name = 'period'`);
  return baris.n === 1;
}

async function periodePing(id) {
  const baris = await store.one(store.customers(),
    'SELECT period FROM delivery_ping WHERE id = ?', [id]);
  return baris.period;
}

function ping(tambahan) {
  return { lat: -7.75, lng: 110.36, sentAt: SEPTEMBER, ...tambahan };
}

async function main() {
  const testConfig = await openTestDb('pingperiod');
  try {
    await store.ensureCustomers(testConfig);
    let pii = store.customers();
    assert.ok(pii, 'database PII uji harus bisa dibuat');

    // 1. MIGRASI PADA TABEL YANG SUDAH TERLANJUR ADA.
    //
    // CREATE TABLE IF NOT EXISTS tidak pernah menambah kolom ke tabel lama, dan proyek
    // ini belum punya penjalan migrasi bernomor. Laptop tim sudah punya delivery_ping
    // bentuk LAMA — jadi yang harus dibuktikan: menjalankan skema lagi (yang terjadi
    // tiap server menyala) benar-benar menambahkan kolomnya.
    assert.ok(await adaKolomPeriod(pii), 'skema baru harus punya kolom period');
    await store.run(pii, 'ALTER TABLE delivery_ping DROP COLUMN period');
    assert.ok(!(await adaKolomPeriod(pii)), 'tabel bentuk lama berhasil ditiru');

    const poolLama = pii;
    await store.openCustomers(testConfig);
    await poolLama.end().catch(() => {});
    pii = store.customers();
    assert.ok(await adaKolomPeriod(pii),
      'menjalankan ulang skema TIDAK menambahkan kolom period ke tabel yang sudah ada — ' +
      'di laptop tim kolomnya tidak akan pernah muncul dan seluruh fitur ini diam saja');

    // Data KTP: MESIN-A tercatat di Juli dan Agustus, MESIN-B hanya Agustus.
    const ktp = `INSERT INTO customer_ktp (period, engine_no, resolve_status, row_no)
                 VALUES (?, ?, 'ok', ?)`;
    await store.run(pii, ktp, ['2026-07', 'MESIN-A', 1]);
    await store.run(pii, ktp, ['2026-08', 'MESIN-A', 2]);
    await store.run(pii, ktp, ['2026-08', 'MESIN-B', 3]);

    // 2. PERIODE YANG TERSIMPAN.
    const idEksplisit = await savePing(ping({ engineNo: 'MESIN-B', period: '2026-05' }), testConfig);
    assert.strictEqual(await periodePing(idEksplisit), '2026-05',
      'periode yang dikirim sistem lapangan harus menang atas hasil pencarian');

    const idA = await savePing(ping({ engineNo: 'MESIN-A' }), testConfig);
    assert.strictEqual(await periodePing(idA), '2026-07',
      'mesin yang tercatat di dua periode KTP harus mendapat periode PALING AWAL');

    const idB = await savePing(ping({ engineNo: 'MESIN-B' }), testConfig);
    assert.strictEqual(await periodePing(idB), '2026-08',
      'periode diambil dari Data KTP. Ping ini tiba SEPTEMBER; kalau hasilnya 2026-09, ' +
      'periodenya diturunkan dari sent_at — persis yang dilarang');

    const idAsing = await savePing(ping({ engineNo: 'TIDAK-DIKENAL' }), testConfig);
    assert.ok(idAsing, 'ping bernomor mesin tak dikenal TETAP harus tersimpan');
    assert.strictEqual(await periodePing(idAsing), null,
      'mesin tak dikenal harus ber-period NULL, bukan dikarang dari bulan kedatangannya');

    // 3. MENYARING.
    const semua = await repo.deliveryPings({});
    assert.strictEqual(semua.total, 4, 'tanpa saringan, keempat ping tampil (termasuk yang NULL)');

    const agustus = await repo.deliveryPings({ periodFrom: '2026-08', periodTo: '2026-08' });
    assert.strictEqual(agustus.total, 1, 'saringan Agustus harus cuma memuat ping MESIN-B');

    const september = await repo.deliveryPings({ periodFrom: '2026-09', periodTo: '2026-09' });
    assert.strictEqual(september.total, 0,
      'semua ping TIBA di September, tapi tak satu pun motornya DIBELI di September — ' +
      'saringan yang memakai sent_at akan memuat keempatnya');

    const setahun = await repo.deliveryPings({ periodFrom: '2026-01', periodTo: '2026-12' });
    assert.strictEqual(setahun.total, 3,
      'ping ber-period NULL tidak boleh diklaim milik bulan mana pun waktu saringan aktif');

    // 4. HAPUS PER JENIS.
    await assert.rejects(repo.deleteSourcePeriod('ngawur', '2026-07', '127.0.0.1'),
      /tidak dikenal/, 'jenis data tak dikenal harus ditolak');

    const hapus = await repo.deleteSourcePeriod('kirim', '2026-07', '127.0.0.1');
    assert.strictEqual(hapus.deleted, 1, 'hapus Pengiriman Juli harus membuang tepat satu ping');
    assert.strictEqual((await repo.deliveryPings({})).total, 3,
      'ping periode lain dan ping ber-period NULL harus tetap utuh');
    assert.strictEqual(await periodePing(idAsing), null,
      'ping ber-period NULL ikut terhapus — ia tidak pernah milik Juli');

    await assert.rejects(repo.deleteSourcePeriod('kirim', '2026-07', '127.0.0.1'),
      /tidak punya data/, 'periode yang sudah kosong harus ditolak, bukan "berhasil menghapus 0"');

    // 5. HAPUS SATU PERIODE PENUH ikut membuang ping periode itu.
    const periode = await repo.deletePeriod('2026-08', '127.0.0.1');
    assert.strictEqual(periode.kirim, 1,
      'hapus periode Agustus tidak membuang ping Agustus — bulan yang "sudah dihapus" ' +
      'masih meninggalkan titik GPS rumah pelanggannya');
    const sisaAgustus = await repo.deliveryPings({ periodFrom: '2026-08', periodTo: '2026-08' });
    assert.strictEqual(sisaAgustus.total, 0);
    assert.strictEqual((await repo.deliveryPings({})).total, 2,
      'ping periode lain (Mei) dan ping NULL harus selamat dari hapus periode Agustus');

    console.log('OK delivery-ping-period — kolom period ditambahkan ke tabel lama, periode ' +
      'diambil dari Data KTP (bukan sent_at), NULL untuk mesin tak dikenal, saringan tidak ' +
      'mengklaim NULL, hapus per jenis dan hapus periode hanya membuang ping periode itu');
  } finally {
    await closeTestDb(testConfig);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
