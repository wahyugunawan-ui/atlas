/**
 * Kota/Karesidenan sebagai KUMPULAN DEALER terdaftar, di PostgreSQL sungguhan.
 *
 * Sejak 2026-10-11 filter Kota dan Karesidenan tidak lagi berarti "pelanggan yang tinggal
 * di sana", tapi "dealer yang TERDAFTAR di sana" (dealers.city_code, dari kolom
 * Kabupaten Excel Dealer & POS). Seluruh penjualan/pelanggan dealer-dealer itu ikut,
 * juga yang tinggal di kota lain.
 *
 * Yang dijaga, semuanya gagal DIAM kalau salah:
 *
 * 1. Kolom `city_code` benar-benar tersimpan dan sampai ke payload `dealers` (listDealers)
 *    — tanpa itu frontend tidak punya dasar menyusun kumpulan dealer, dan filter Kota
 *    menampilkan kosong.
 * 2. `legacyCodesOfCities()` hanya memberi dealer yang terdaftar di kota itu, dan
 *    melewati dealer tanpa legacy_code.
 * 3. `dealerCodes` menyaring menurut DEALER di ketujuh penyusun WHERE Fusion, dengan
 *    pelanggan di kota LAIN tetap terhitung. Penyaring lama (`cityCode`/`cityCodes`)
 *    menyaring kota PELANGGAN, jadi angkanya berbeda — itulah yang diuji.
 * 4. `dealerCodes: []` berarti KOSONG, bukan "tanpa saringan".
 * 5. Mengosongkan kota lewat updateDealer() mengeluarkan dealer dari kumpulan, dan
 *    `undefined` tidak menyentuh kota yang ada.
 */
const assert = require('assert');
const http = require('http');
const path = require('path');

const { buildApp } = require('../backend/server/app');
const { hashPassword, createSession, COOKIE_NAME } = require('../backend/server/auth');
const store = require('../backend/server/db');
const repo = require('../backend/server/repository');
const { openTestDb, closeTestDb } = require('./helpers/db');

const PERIOD = '2026-08';
const V_SLEMAN = '34.04.01.2001';
const V_CILACAP = '33.01.01.2001';

async function seed() {
  const db = store.db();
  const desa = `
    INSERT INTO villages (village_code, village_name, district_code, district_name,
                          city_code, city_name, province_code)
    VALUES (?, ?, ?, ?, ?, ?, ?)`;
  await store.run(db, desa, [V_SLEMAN, 'Sendangadi', '34.04.01', 'Mlati', '34.04', 'Sleman', '34']);
  await store.run(db, desa, [V_CILACAP, 'Cilacap Kota', '33.01.01', 'Cilacap', '33.01', 'Cilacap', '33']);

  // D1 terdaftar di Sleman, D2 di Cilacap, D3 tanpa kota (Excel tak terbaca), D4 dibuat
  // manual tanpa legacy_code.
  const dealer = `INSERT INTO dealers (dealer_code, dealer_name, legacy_code, city_code)
                  VALUES (?, ?, ?, ?)`;
  await store.run(db, dealer, ['DEALERSATU', 'DEALER SATU', '9', '34.04']);
  await store.run(db, dealer, ['DEALERDUA', 'DEALER DUA', '77', '33.01']);
  await store.run(db, dealer, ['DEALERTIGA', 'DEALER TIGA', '88', null]);
  await store.run(db, dealer, ['DEALEREMPAT', 'DEALER EMPAT', null, '34.04']);

  const rollup = `
    INSERT INTO segment_rollup
      (period, village_code, city_code, dealer_code, segment, customer_count, weight_sum)
    VALUES (?, ?, ?, ?, ?, ?, ?)`;
  // Dealer 9 (Sleman): 10 pelanggan di Sleman.
  await store.run(db, rollup, [PERIOD, V_SLEMAN, '34.04', '9', 'loyal_verified', 10, 10.0]);
  // Dealer 77 (terdaftar Cilacap): 5 pelanggan di Cilacap DAN 6 pelanggan di SLEMAN.
  await store.run(db, rollup, [PERIOD, V_CILACAP, '33.01', '77', 'registered_only', 5, 2.5]);
  await store.run(db, rollup, [PERIOD, V_SLEMAN, '34.04', '77', 'registered_only', 6, 3.0]);
  // Dealer 88 (tanpa kota): 4 pelanggan.
  await store.run(db, rollup, [PERIOD, V_CILACAP, '33.01', '88', 'registered_only', 4, 2.0]);

  const irisan = `
    INSERT INTO source_overlap
      (period, village_code, city_code, dealer_code, has_service, has_delivery,
       segment, customer_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  await store.run(db, irisan, [PERIOD, V_SLEMAN, '34.04', '9', true, false, 'loyal_verified', 10]);
  await store.run(db, irisan, [PERIOD, V_CILACAP, '33.01', '77', false, false, 'registered_only', 5]);
  await store.run(db, irisan, [PERIOD, V_SLEMAN, '34.04', '77', false, false, 'registered_only', 6]);
  await store.run(db, irisan, [PERIOD, V_CILACAP, '33.01', '88', false, false, 'registered_only', 4]);
}

/** Permintaan HTTP sederhana ke aplikasi yang berjalan di port acak. */
function minta(port, method, path, { cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function tesRute(testConfig) {
  const config = {
    ...testConfig,
    frontendDir: path.join(__dirname, '..', 'frontend'),
    passwordHash: hashPassword('sandi-uji-tim-channel'),
    sessionSecret: 'x'.repeat(48),
    cookieSecure: false,
  };
  const server = await new Promise((resolve) => {
    const s = buildApp(config).listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const cookie = `${COOKIE_NAME}=${createSession(config.sessionSecret)}`;
  const jumlah = async (query) => {
    const res = await minta(port, 'GET', `/api/v1/segmentasi?periode=${PERIOD}&${query}`, { cookie });
    assert.strictEqual(res.status, 200, `segmentasi ${query}: ${JSON.stringify(res.json)}`);
    return res.json.meta.total;
  };

  try {
    assert.strictEqual(await jumlah(''), 25);
    // Cilacap (33.01) = dealer 77 = 5 + 6, termasuk 6 pelanggan yang tinggal di Sleman.
    assert.strictEqual(await jumlah('kota=33.01'), 11,
      'kota di rute masih menyaring kota PELANGGAN (hasil lama: 9)');
    assert.strictEqual(await jumlah('kota=34.04'), 10, 'Sleman = dealer 9 saja');
    // Karesidenan = daftar kota -> gabungan dealernya.
    assert.strictEqual(await jumlah('kota=33.01,34.04'), 21);
    // Kota tanpa dealer terdaftar: kosong, bukan semuanya.
    assert.strictEqual(await jumlah('kota=99.99'), 0,
      'kota tanpa dealer terdaftar menampilkan semua pelanggan');
    // Kode kota yang bentuknya salah diabaikan (tanpa saringan), seperti sebelumnya.
    assert.strictEqual(await jumlah('kota=ngasal'), 25);

    // Jenjang: dealer yang dipilih menang atas kota yang ikut terisi dari bilah filter.
    assert.strictEqual(await jumlah('kota=34.04&dealer=DEALERDUA'), 11,
      'dealer terpilih tidak menang atas kota — hasilnya masih irisan');
    // Pos memakai mekanismenya sendiri dan tidak dikalikan dealer/kota.
    await store.run(store.db(),
      `INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name)
       VALUES ('O1', 'POS SATU', 'DEALERSATU', 'DEALER SATU')`);
    await store.run(store.db(),
      `INSERT INTO coverage (radius_m, outlet_code, district_code, ratio)
       VALUES (1000, 'O1', '34.04.01', 1.0)`);
    const lewatPos = await jumlah('pos=O1');
    assert.strictEqual(await jumlah('pos=O1&dealer=DEALERDUA&kota=33.01'), lewatPos,
      'pos dikalikan dealer/kota — mekanisme pos berubah diam-diam');

    // Panel Cakupan Sumber turun jadi daftar DEALER begitu kota dipilih.
    const cakupan = await minta(port, 'GET',
      `/api/v1/cakupan-sumber?periode=${PERIOD}&kota=33.01`, { cookie });
    assert.strictEqual(cakupan.json.groupBy, 'dealer');
    assert.strictEqual(cakupan.json.total, 11);
    const tanpaKota = await minta(port, 'GET',
      `/api/v1/cakupan-sumber?periode=${PERIOD}`, { cookie });
    assert.strictEqual(tanpaKota.json.groupBy, 'kota');

    // CRUD dealer menerima kota; kode yang bentuknya salah ditolak, bukan dikosongkan.
    const ubah = await minta(port, 'PUT', '/api/dealers/DEALERTIGA', {
      cookie, body: { cityCode: '33.01' } });
    assert.strictEqual(ubah.status, 200);
    assert.strictEqual(ubah.json.dealer.cityCode, '33.01');
    const salah = await minta(port, 'PUT', '/api/dealers/DEALERTIGA', {
      cookie, body: { cityCode: 'ngasal' } });
    assert.strictEqual(salah.status, 400, 'kode kota asal-asalan diterima');
    const summary = await minta(port, 'GET', '/api/summary', { cookie });
    const tiga = summary.json.dealers.find((d) => d.code === 'DEALERTIGA');
    assert.strictEqual(tiga.cityCode, '33.01', '/api/summary tidak membawa cityCode dealer');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const testConfig = await openTestDb('dealerregion');
  try {
    await seed();

    // 1. city_code sampai ke payload dealers.
    const dealers = await repo.listDealers();
    const kota = Object.fromEntries(dealers.map((d) => [d.code, d.cityCode]));
    assert.deepStrictEqual(kota, {
      DEALERSATU: '34.04', DEALERDUA: '33.01', DEALERTIGA: null, DEALEREMPAT: '34.04',
    }, 'listDealers tidak membawa cityCode — frontend tak bisa menyusun kumpulan dealer');

    // 2. Kumpulan dealer per kota.
    assert.deepStrictEqual(await repo.legacyCodesOfCities(['33.01']), ['77']);
    assert.deepStrictEqual((await repo.legacyCodesOfCities(['34.04'])).sort(), ['9'],
      'dealer tanpa legacy_code (DEALEREMPAT) tidak boleh ikut — rollup tak punya datanya');
    assert.deepStrictEqual((await repo.legacyCodesOfCities(['34.04', '33.01'])).sort(), ['77', '9']);
    assert.deepStrictEqual(await repo.legacyCodesOfCities(['99.99']), [],
      'kota tanpa dealer harus memberi daftar kosong');
    assert.deepStrictEqual(await repo.legacyCodesOfCities([]), []);

    // 3. INTI: dealerCodes menyaring DEALER, pelanggan di kota lain tetap terhitung.
    const cilacap = { dealerCodes: await repo.legacyCodesOfCities(['33.01']) };
    const total = async (f) => (await repo.fusionTotals({ period: PERIOD, ...f })).total;

    assert.strictEqual(await total({}), 25);
    assert.strictEqual(await total(cilacap), 11,
      'dealer terdaftar Cilacap harus membawa 5 pelanggan Cilacap + 6 pelanggan Sleman');
    assert.strictEqual(await total({ cityCode: '33.01' }), 9,
      'pembanding: saringan lama menyaring kota PELANGGAN, jadi beda dari kumpulan dealer');

    // Ketujuh penyusun WHERE, bukan cuma fusionTotals.
    assert.strictEqual(
      (await repo.fusionRows({ period: PERIOD, ...cilacap })).rows
        .reduce((s, r) => s + Number(r.customerCount), 0), 11, 'fusionRows');
    const jumlah = (rows, kolom) => rows.reduce((s, r) => s + Number(r[kolom]), 0);
    assert.strictEqual(jumlah(await repo.fusionByCity(PERIOD, cilacap), 'total'), 11, 'fusionByCity');
    assert.strictEqual(jumlah(await repo.fusionByDealer(PERIOD, cilacap), 'total'), 11, 'fusionByDealer');
    assert.strictEqual(jumlah(await repo.fusionMatrix(PERIOD, cilacap), 'n'), 11, 'fusionMatrix');
    assert.strictEqual(jumlah(await repo.fusionOverlap(PERIOD, cilacap), 'n'), 11, 'fusionOverlap');
    assert.strictEqual(
      jumlah(await repo.fusionSourceCoverage(PERIOD, cilacap, 'kota'), 'total'), 11,
      'fusionSourceCoverage');
    assert.strictEqual(jumlah(await repo.fusionVillagePoints(PERIOD, cilacap), 'ktp'), 11,
      'fusionVillagePoints');

    // Pelanggan Cilacap-registered di SLEMAN memang muncul di matriks kota pelanggan.
    const kotaPelanggan = (await repo.fusionByCity(PERIOD, cilacap)).map((r) => r.cityCode).sort();
    assert.deepStrictEqual(kotaPelanggan, ['33.01', '34.04'],
      'pelanggan dealer di luar kotanya hilang dari peringkat kota');

    // Gabungan dua kota = penjumlahan kumpulan dealernya.
    const dua = { dealerCodes: await repo.legacyCodesOfCities(['33.01', '34.04']) };
    assert.strictEqual(await total(dua), 21);

    // 4. Kumpulan KOSONG = hasil kosong, bukan semuanya.
    assert.strictEqual(await total({ dealerCodes: [] }), 0,
      'kota tanpa dealer terdaftar malah menampilkan seluruh pelanggan');
    assert.strictEqual((await repo.fusionRows({ period: PERIOD, dealerCodes: [] })).rows.length, 0);
    assert.strictEqual((await repo.fusionVillagePoints(PERIOD, { dealerCodes: [] })).length, 0);
    // Tanpa dealerCodes sama sekali = tanpa saringan (null/undefined bukan array).
    assert.strictEqual(await total({ dealerCodes: null }), 25);

    // Dealer yang dipilih langsung tetap bisa digabung dengan golongan.
    assert.strictEqual(
      await total({ ...cilacap, segment: 'loyal_verified' }), 0,
      'golongan tidak bertabrakan dengan kumpulan dealer');

    // 5. Menyunting kota dealer.
    const tanpaUbah = await repo.updateDealer('DEALERTIGA', { address: 'Jl. Baru' });
    assert.strictEqual(tanpaUbah.cityCode, null, 'undefined mengubah kota');
    const diisi = await repo.updateDealer('DEALERTIGA', { cityCode: '33.01' });
    assert.strictEqual(diisi.cityCode, '33.01');
    assert.deepStrictEqual((await repo.legacyCodesOfCities(['33.01'])).sort(), ['77', '88'],
      'dealer yang kotanya diisi tidak masuk kumpulan');
    const tetap = await repo.updateDealer('DEALERTIGA', { address: 'Jl. Lain' });
    assert.strictEqual(tetap.cityCode, '33.01', 'menyunting alamat menghapus kota');
    const dikosongkan = await repo.updateDealer('DEALERTIGA', { cityCode: '' });
    assert.strictEqual(dikosongkan.cityCode, null);
    assert.deepStrictEqual(await repo.legacyCodesOfCities(['33.01']), ['77'],
      'dealer yang kotanya dikosongkan masih di kumpulan');

    const baru = await repo.createDealer({ dealerName: 'Dealer Baru', cityCode: '34.04' });
    assert.strictEqual(baru.cityCode, '34.04', 'createDealer tidak menyimpan kota');

    /* 6. RUTE: `kota` di /v1/* kini berarti kumpulan DEALER terdaftar, diterjemahkan di
       saringFusi() (routes.js). Lewat HTTP sungguhan, karena terjemahannya hidup di
       rute dan tidak terlihat dari tes repository di atas. */
    await tesRute(testConfig);

    console.log('OK dealer-region — dealers.city_code tersimpan dan terbaca, kumpulan dealer per ' +
      'kota/kares, dealerCodes menyaring DEALER di ketujuh penyusun WHERE (pelanggan di kota ' +
      'lain tetap terhitung), kumpulan kosong = kosong, sunting kota dealer');
  } finally {
    await closeTestDb(testConfig);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
