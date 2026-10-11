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
  // Kecamatan asal: D1 di 34.04.01 (Mlati), D2 di 33.01.01 (Cilacap), D3 tanpa kota
  // maupun kecamatan, D4 dibuat manual tanpa legacy_code.
  const dealer = `INSERT INTO dealers (dealer_code, dealer_name, legacy_code, city_code, district_code)
                  VALUES (?, ?, ?, ?, ?)`;
  await store.run(db, dealer, ['DEALERSATU', 'DEALER SATU', '9', '34.04', '34.04.01']);
  await store.run(db, dealer, ['DEALERDUA', 'DEALER DUA', '77', '33.01', '33.01.01']);
  await store.run(db, dealer, ['DEALERTIGA', 'DEALER TIGA', '88', null, null]);
  await store.run(db, dealer, ['DEALEREMPAT', 'DEALER EMPAT', null, '34.04', null]);

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

/**
 * Perbatasan kecamatan untuk kategori Others vs Pelanggaran Wilayah.
 *
 * Empat kecamatan di sekitar X (1° ≈ 110 km di sini):
 *   X = kecamatan dealer 9 · Y menempel di timur X · G di barat X dengan celah ±55 m
 *   (celah sempit hasil ST_Union kelurahan) · F di utara X dengan jarak ±330 m (memang
 *   terpisah).
 * Hanya X, Y, dan G yang boleh ditoleransi; F tidak. Dan batasnya harus datang dari POLIGON,
 * bukan dari angka lain: dealer di kecamatan terpencil tidak membawa tetangga.
 */
async function tesPerbatasan() {
  const db = store.db();
  const BASE_LNG = 110.0;
  const BASE_LAT = -7.8;
  const kotak = (x0, x1, dy = 0) => ({
    type: 'Polygon',
    coordinates: [[[BASE_LNG + x0, BASE_LAT + dy], [BASE_LNG + x1, BASE_LAT + dy],
      [BASE_LNG + x1, BASE_LAT + dy + 0.01], [BASE_LNG + x0, BASE_LAT + dy + 0.01],
      [BASE_LNG + x0, BASE_LAT + dy]]],
  });
  // Desa yang SUDAH ada (V_SLEMAN, kecamatan dealer 9) tinggal diberi poligon.
  const beriPoligon = async (kode, geom) => store.run(db, `
    UPDATE villages SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)),
                        geom_m = ST_Transform(ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)), 32749)
    WHERE village_code = ?`, [JSON.stringify(geom), JSON.stringify(geom), kode]);
  const tambah = async (kode, kecamatan, geom) => store.run(db, `
    INSERT INTO villages (village_code, village_name, district_code, district_name,
                          city_code, city_name, province_code, lat, lng, geom, geom_m)
    VALUES (?, ?, ?, ?, '34.04', 'Sleman', '34', NULL, NULL,
            ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)),
            ST_Transform(ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)), 32749))`,
  [kode, kode, kecamatan, kecamatan, JSON.stringify(geom), JSON.stringify(geom)]);

  await beriPoligon(V_SLEMAN, kotak(0, 0.05));                            // X
  await tambah('34.04.02.0001', '34.04.02', kotak(0.05, 0.10));           // Y menempel
  await tambah('34.04.03.0001', '34.04.03', kotak(-0.0505, -0.0005));     // G celah ±55 m
  await tambah('34.04.04.0001', '34.04.04', kotak(0, 0.05, 0.013));       // F ±330 m
  await db.query('REFRESH MATERIALIZED VIEW district_shapes');

  const batas = await repo.dealerBorderDistricts();
  assert.deepStrictEqual((batas.DEALERSATU || []).sort(),
    ['34.04.01', '34.04.02', '34.04.03'], 'perbatasan dealer 9 salah');
  assert.ok(!(batas.DEALERSATU || []).includes('34.04.04'),
    'kecamatan yang berjarak ±330 m ikut ditoleransi — pengecualian terlalu longgar');
  assert.ok((batas.DEALERSATU || []).includes('34.04.02'),
    'kecamatan yang menempel pada kecamatan dealer tidak ditoleransi');
  assert.ok((batas.DEALERSATU || []).includes('34.04.03'),
    'celah sempit ±55 m antar kecamatan membuat tetangga sungguhan tidak terdeteksi');
  assert.ok((batas.DEALERSATU || []).includes('34.04.01'), 'kecamatan dealer sendiri tidak ikut');
  // Dealer tanpa kecamatan tercatat tidak punya perbatasan; D2 (kecamatan tanpa poligon).
  assert.strictEqual(batas.DEALERTIGA, undefined);
  assert.strictEqual(batas.DEALERDUA, undefined, 'dealer di kecamatan tanpa poligon dapat tetangga');
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

    // Kec (kecamatan ASAL dealer): dealer yang terdaftar di kecamatan itu, dan lebih sempit
    // dari kota — kalau keduanya dikirim, Kec yang menang.
    assert.strictEqual(await jumlah('kec=34.04.01'), 10, 'Kec 34.04.01 = dealer 9 (10 pelanggan)');
    assert.strictEqual(await jumlah('kec=33.01.01'), 11,
      'Kec 33.01.01 = dealer 77 termasuk 6 pelanggannya di Sleman');
    assert.strictEqual(await jumlah('kec=34.04.01&kota=33.01'), 10,
      'kota mengalahkan kec — seharusnya yang lebih sempit yang menang');
    assert.strictEqual(await jumlah('kec=99.99.99'), 0, 'kecamatan tanpa dealer harus kosong');
    assert.strictEqual(await jumlah('kec=ngasal'), 25, 'kode kecamatan salah-bentuk tidak diabaikan');

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
    const ubahKec = await minta(port, 'PUT', '/api/dealers/DEALERTIGA', {
      cookie, body: { districtCode: '33.01.01' } });
    assert.strictEqual(ubahKec.json.dealer.districtCode, '33.01.01', 'kecamatan dealer tak tersimpan');
    const salahKec = await minta(port, 'PUT', '/api/dealers/DEALERTIGA', {
      cookie, body: { districtCode: 'ngasal' } });
    assert.strictEqual(salahKec.status, 400, 'kode kecamatan asal-asalan diterima');
    const summary = await minta(port, 'GET', '/api/summary', { cookie });
    assert.ok(summary.json.dealerBorder && summary.json.dealerBorder.DEALERSATU,
      '/api/summary tidak membawa dealerBorder — kategori Others/Pelanggaran tak punya dasar');
    assert.strictEqual(
      summary.json.dealers.find((d) => d.code === 'DEALERSATU').districtCode, '34.04.01');
    assert.ok(!('businessReferencePercent' in summary.json), 'Acuan Bisnis muncul lagi di summary');
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
    const kecDealer = Object.fromEntries(dealers.map((d) => [d.code, d.districtCode]));
    assert.deepStrictEqual(kecDealer, {
      DEALERSATU: '34.04.01', DEALERDUA: '33.01.01', DEALERTIGA: null, DEALEREMPAT: null,
    }, 'listDealers tidak membawa districtCode — filter Kec tidak punya dasar');

    // Kumpulan dealer per KECAMATAN (filter Kec).
    assert.deepStrictEqual(await repo.legacyCodesOfDistricts(['34.04.01']), ['9']);
    assert.deepStrictEqual(await repo.legacyCodesOfDistricts(['33.01.01']), ['77']);
    assert.deepStrictEqual(await repo.legacyCodesOfDistricts(['99.99.99']), [],
      'kecamatan tanpa dealer harus memberi daftar kosong');
    assert.deepStrictEqual(await repo.legacyCodesOfDistricts([]), []);

    await tesPerbatasan();

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
