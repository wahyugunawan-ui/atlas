/**
 * Uji CRUD Master Dealer (backend/server/repository.js): listDealers, createDealer,
 * updateDealer, deleteDealer.
 *
 * Yang dijaga: dealer tidak bisa dihapus selama masih punya pos (satu-satunya
 * pengaman sebelum pos itu jadi yatim tanpa dealer), nama yang cuma tanda baca
 * ditolak (toDealerCode() akan menghasilkan kode kosong), dan ganti nama ke nama yang
 * sudah dipakai dealer lain ditolak jelas alih-alih diam-diam digabung.
 */
const assert = require('assert');
const store = require('../backend/server/db');
const repo = require('../backend/server/repository');
const { openTestDb, closeTestDb } = require('./helpers/db');

async function test() {
  const config = await openTestDb('dealers-crud');
  const db = store.db();

  try {
    // --- createDealer ---
    const d1 = await repo.createDealer({ dealerName: 'Dealer Uji Satu' });
    assert.strictEqual(d1.name, 'Dealer Uji Satu');
    assert.ok(d1.code, 'kode dealer kosong');
    assert.strictEqual(d1.lat, null, 'koordinat dealer baru harus kosong, bukan 0');

    await assert.rejects(
      () => repo.createDealer({ dealerName: 'Dealer Uji Satu' }),
      /sudah dipakai/i,
      'nama dealer yang sudah ada berhasil dibuat dua kali — kodenya bentrok diam-diam');

    await assert.rejects(
      () => repo.createDealer({ dealerName: '---' }),
      /nama dealer/i,
      'nama yang seluruhnya tanda baca (kode kosong) seharusnya ditolak');

    // --- listDealers ikut menghitung pos ---
    await store.run(db, `
      INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name)
      VALUES ('TD01', 'Pos Uji Dealer', ?, ?)`, [d1.code, d1.name]);
    const daftar = await repo.listDealers();
    const baris1 = daftar.find((d) => d.code === d1.code);
    assert.strictEqual(Number(baris1.outletCount), 1, 'outletCount tidak menghitung pos yang ada');

    // --- updateDealer ---
    const d2 = await repo.createDealer({ dealerName: 'Dealer Uji Dua' });
    const disunting = await repo.updateDealer(d1.code, { address: 'Jl. Uji 1' });
    assert.strictEqual(disunting.address, 'Jl. Uji 1');
    assert.strictEqual(disunting.name, d1.name, 'field yang tidak dikirim ikut berubah');
    assert.strictEqual(disunting.code, d1.code, 'updateDealer mengubah kode — kode harus tetap');

    await assert.rejects(
      () => repo.updateDealer(d1.code, { dealerName: 'Dealer Uji Dua' }),
      /.+/,
      'rename ke nama dealer lain yang sudah dipakai seharusnya ditolak, ' +
      'bukan diam-diam membuat dua dealer beda kode dengan nama sama');
    void d2;

    // --- deleteDealer ditolak selama masih punya pos ---
    await assert.rejects(
      () => repo.deleteDealer(d1.code),
      /1 pos/i,
      'dealer yang masih punya pos berhasil dihapus, atau pesannya tidak menyebut jumlahnya');

    await store.run(db, `DELETE FROM outlets WHERE outlet_code = 'TD01'`);
    const dihapus = await repo.deleteDealer(d1.code);
    assert.strictEqual(dihapus.code, d1.code);
    assert.strictEqual(await repo.deleteDealer(d1.code), null,
      'menghapus dealer yang sudah tidak ada seharusnya null, bukan error');

    console.log('OK dealers-crud — hapus ditolak selagi punya pos, nama tanda baca ' +
      'ditolak, rename ke nama dealer lain ditolak, kode dealer tidak ikut berubah');
  } finally {
    await closeTestDb(config);
  }
}

test().catch((error) => {
  console.error(error);
  process.exit(1);
});
