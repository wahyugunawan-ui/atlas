/**
 * Target penjualan per dealer per bulan (2026-10-11), di PostgreSQL sungguhan dan lewat HTTP.
 *
 * Seksi "Persentase Keberhasilan Target Penjualan" menyimpan targetnya di tabel
 * sales_targets lewat PUT /api/targets dan membacanya dari /api/summary.targets.
 *
 * Yang dijaga:
 * 1. Simpan -> terbaca di allTargets() dan /api/summary dengan bentuk {periode: {dealer: unit}}.
 * 2. Menyimpan lagi untuk (bulan, dealer) yang sama MENIMPA, bukan menambah baris.
 * 3. Target NOL adalah target yang sah (baris tetap ada); KOSONG/null menghapus barisnya.
 *    Dua hal ini dibedakan frontend ("belum punya target" vs "target nol").
 * 4. Masukan buruk ditolak, tidak dibulatkan diam-diam: pecahan, negatif, di atas batas,
 *    teks. Dealer yang tidak ada = 404. Periode/dealer berformat salah = 400.
 * 5. Rute butuh sesi: tanpa cookie 401, dan tidak ada yang tersimpan.
 */
const assert = require('assert');
const http = require('http');
const path = require('path');

const { buildApp } = require('../backend/server/app');
const { hashPassword, createSession, COOKIE_NAME } = require('../backend/server/auth');
const store = require('../backend/server/db');
const repo = require('../backend/server/repository');
const { openTestDb, closeTestDb } = require('./helpers/db');

function minta(port, method, urlPath, { cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* bukan JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function jumlahBaris() {
  const r = await store.one(store.db(), 'SELECT COUNT(*)::int AS n FROM sales_targets');
  return r.n;
}

async function main() {
  const testConfig = await openTestDb('salestargets');
  let server;
  try {
    const db = store.db();
    const dealer = 'INSERT INTO dealers (dealer_code, dealer_name) VALUES (?, ?)';
    await store.run(db, dealer, ['DEALERSATU', 'DEALER SATU']);
    await store.run(db, dealer, ['DEALERDUA', 'DEALER DUA']);

    // --- 1 & 2. simpan, terbaca, menimpa ---
    assert.deepStrictEqual(await repo.allTargets(), {}, 'awalnya tidak ada target');
    assert.deepStrictEqual(await repo.saveTarget('2026-09', 'DEALERSATU', 120),
      { period: '2026-09', dealerCode: 'DEALERSATU', units: 120 });
    await repo.saveTarget('2026-09', 'DEALERDUA', '80');           // teks angka dari JSON/formulir
    await repo.saveTarget('2026-10', 'DEALERSATU', 150);
    assert.deepStrictEqual(await repo.allTargets(), {
      '2026-09': { DEALERSATU: 120, DEALERDUA: 80 },
      '2026-10': { DEALERSATU: 150 },
    }, 'bentuk allTargets harus {periode: {dealer: unit}} dengan unit berupa ANGKA');
    await repo.saveTarget('2026-09', 'DEALERSATU', 999);
    assert.strictEqual((await repo.allTargets())['2026-09'].DEALERSATU, 999, 'simpan ulang tidak menimpa');
    assert.strictEqual(await jumlahBaris(), 3, 'simpan ulang menambah baris, bukan menimpa');

    // --- 3. nol vs kosong ---
    await repo.saveTarget('2026-09', 'DEALERDUA', 0);
    assert.strictEqual((await repo.allTargets())['2026-09'].DEALERDUA, 0,
      'target nol harus tersimpan sebagai nol, bukan hilang');
    assert.strictEqual(await jumlahBaris(), 3);
    for (const kosong of [null, '', undefined]) {
      await repo.saveTarget('2026-09', 'DEALERDUA', 5);
      const hasil = await repo.saveTarget('2026-09', 'DEALERDUA', kosong);
      assert.strictEqual(hasil.units, null);
      assert.strictEqual((await repo.allTargets())['2026-09'].DEALERDUA, undefined,
        `${JSON.stringify(kosong)} seharusnya menghapus target`);
    }
    assert.strictEqual(await jumlahBaris(), 2);

    // --- 4. masukan buruk (tingkat repository) ---
    for (const buruk of [1.5, -1, 1000001, 'abc', NaN, Infinity]) {
      await assert.rejects(() => repo.saveTarget('2026-09', 'DEALERSATU', buruk), /bilangan bulat/,
        `${String(buruk)} seharusnya ditolak`);
    }
    assert.strictEqual((await repo.allTargets())['2026-09'].DEALERSATU, 999, 'masukan buruk mengubah target');
    await repo.saveTarget('2026-09', 'DEALERSATU', 1000000);       // tepat di batas: sah
    await assert.rejects(() => repo.saveTarget('2026-09', 'TIDAKADA', 10), /tidak ada/);

    // --- HTTP ---
    const config = {
      ...testConfig,
      frontendDir: path.join(__dirname, '..', 'frontend'),
      passwordHash: hashPassword('sandi-uji-tim-channel'),
      sessionSecret: 'x'.repeat(48),
      cookieSecure: false,
    };
    server = await new Promise((resolve) => {
      const s = buildApp(config).listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;
    const cookie = `${COOKIE_NAME}=${createSession(config.sessionSecret)}`;
    const put = (body, opsi = {}) => minta(port, 'PUT', '/api/targets', { cookie, body, ...opsi });

    // --- 5. tanpa sesi ---
    const sebelum = await jumlahBaris();
    const tanpaSesi = await minta(port, 'PUT', '/api/targets',
      { body: { period: '2026-11', dealerCode: 'DEALERSATU', units: 7 } });
    assert.strictEqual(tanpaSesi.status, 401, 'PUT /api/targets tanpa sesi lolos');
    assert.strictEqual(await jumlahBaris(), sebelum, 'tanpa sesi tetap menulis target');

    // Simpan lewat HTTP, lalu terbaca di /api/summary.
    const ok = await put({ period: '2026-11', dealerCode: 'DEALERDUA', units: 42 });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
    assert.deepStrictEqual(ok.json, { period: '2026-11', dealerCode: 'DEALERDUA', units: 42 });
    const ringkas = await minta(port, 'GET', '/api/summary', { cookie });
    assert.strictEqual(ringkas.status, 200, JSON.stringify(ringkas.json));
    assert.strictEqual(ringkas.json.targets['2026-11'].DEALERDUA, 42,
      '/api/summary tidak membawa targets — frontend tidak punya angka untuk digambar');
    assert.strictEqual(ringkas.json.targets['2026-09'].DEALERSATU, 1000000);

    // Hapus lewat HTTP (units null).
    const hapus = await put({ period: '2026-11', dealerCode: 'DEALERDUA', units: null });
    assert.strictEqual(hapus.status, 200);
    assert.strictEqual(hapus.json.units, null);
    const lagi = await minta(port, 'GET', '/api/summary', { cookie });
    assert.strictEqual(lagi.json.targets['2026-11'], undefined, 'target yang dihapus masih terkirim');

    // Penolakan lewat HTTP.
    const tolak = async (body, status, pola) => {
      const r = await put(body);
      assert.strictEqual(r.status, status, `${JSON.stringify(body)} -> ${r.status} ${JSON.stringify(r.json)}`);
      assert.match(r.json.error, pola);
    };
    await tolak({ period: '2026-9', dealerCode: 'DEALERSATU', units: 1 }, 400, /YYYY-MM/);
    await tolak({ period: '', dealerCode: 'DEALERSATU', units: 1 }, 400, /YYYY-MM/);
    await tolak({ period: '2026-11', dealerCode: 'a b;', units: 1 }, 400, /dealer/i);
    await tolak({ period: '2026-11', dealerCode: 'DEALERSATU', units: 2.5 }, 400, /bilangan bulat/);
    await tolak({ period: '2026-11', dealerCode: 'DEALERSATU', units: -3 }, 400, /bilangan bulat/);
    await tolak({ period: '2026-11', dealerCode: 'TIDAKADA', units: 3 }, 404, /tidak ada/);
    assert.strictEqual((await minta(port, 'GET', '/api/summary', { cookie })).json.targets['2026-11'],
      undefined, 'permintaan yang ditolak ikut menyimpan sesuatu');

    console.log('OK sales-targets — target tersimpan dan terbaca di /api/summary, simpan ulang ' +
      'menimpa, nol beda dari kosong, masukan buruk ditolak (400/404), tanpa sesi 401');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await closeTestDb(testConfig);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
