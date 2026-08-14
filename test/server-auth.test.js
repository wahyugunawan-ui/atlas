/**
 * Uji penjagaan rute lewat HTTP sungguhan.
 *
 * auth.test.js sudah menguji fungsinya. Berkas ini menguji hal yang berbeda dan
 * justru lebih sering salah: apakah penjaganya benar-benar TERPASANG di rute yang
 * seharusnya. Fungsi yang sempurna tidak menolong kalau middleware-nya lupa dipakai.
 */
const assert = require('assert');
const http = require('http');
const { buildApp } = require('../src/server/app');
const { hashPassword, COOKIE_NAME } = require('../src/server/auth');

const PASSWORD = 'sandi-uji-tim-channel';
const config = {
  publicDir: require('path').join(__dirname, '..', 'public'),
  dataDir: require('path').join(__dirname, 'fixtures'),
  passwordHash: hashPassword(PASSWORD),
  sessionSecret: 'x'.repeat(48),
  cookieSecure: false,
};

/** Permintaan HTTP sederhana. Sengaja tanpa supertest — satu dependensi lagi untuk
 *  sesuatu yang muat dalam 20 baris. */
function request(port, method, path, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (cookie) headers.Cookie = cookie;

    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        location: res.headers.location,
        setCookie: res.headers['set-cookie'] || [],
        text: text,
      }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function test() {
  const server = await new Promise((resolve) => {
    const s = buildApp(config).listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;

  try {
    // --- tanpa login ---
    const guarded = await request(port, 'GET', '/');
    assert.strictEqual(guarded.status, 302, 'halaman tanpa login harus dialihkan');
    assert.strictEqual(guarded.location, '/login');

    const api = await request(port, 'GET', '/api/session');
    assert.strictEqual(api.status, 401, 'API tanpa login harus 401, bukan dialihkan');
    assert.ok(!api.text.includes('<'), 'API menjawab HTML, bukan JSON');

    // Rute yang belum ada pun harus dijaga. Ini bukti bahwa penjaganya "tolak semua
    // kecuali yang terdaftar" — kalau sebaliknya, rute baru akan otomatis terbuka.
    const unknown = await request(port, 'GET', '/api/customers?village=34.04.01.2001');
    assert.strictEqual(unknown.status, 401,
      'rute yang belum ada tidak terjaga — penjaganya berbasis daftar putih?');

    // Berkas data ikut terjaga. Ini yang memuat data penjualan dan, sampai Fase 3,
    // juga konsumen.json yang berisi nama dan alamat.
    const dataFile = await request(port, 'GET', '/data/konsumen.json');
    assert.strictEqual(dataFile.status, 302,
      'berkas data bisa diambil tanpa login');

    // Halaman login sendiri harus bisa dibuka tanpa login.
    const loginPage = await request(port, 'GET', '/login');
    assert.strictEqual(loginPage.status, 200);
    assert.ok(loginPage.text.includes('Astra Command Center'));

    // Daftar putihnya harus cocok PERSIS, bukan berawalan. '/login' yang dibuka
    // dengan startsWith() akan ikut membuka '/logs', '/login-lama', dan apa pun yang
    // kebetulan berawalan sama — kebocoran yang tidak akan terlihat sampai ada yang
    // menebaknya.
    for (const near of ['/logs', '/login-lama', '/loginx']) {
      const probe = await request(port, 'GET', near);
      assert.strictEqual(probe.status, 302,
        `${near} lolos penjaga — daftar putihnya berbasis awalan, bukan cocok persis`);
    }

    // --- sandi salah ---
    const wrong = await request(port, 'POST', '/login', { body: { password: 'salah' } });
    assert.strictEqual(wrong.status, 401);
    assert.strictEqual(wrong.setCookie.length, 0, 'sandi salah tetap memberi cookie');

    // --- sandi benar ---
    const ok = await request(port, 'POST', '/login', { body: { password: PASSWORD } });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.setCookie.length, 1);

    const cookie = ok.setCookie[0];
    assert.ok(/HttpOnly/i.test(cookie), 'cookie sesi harus HttpOnly');
    assert.ok(/SameSite=Lax/i.test(cookie), 'cookie sesi harus SameSite=Lax');
    assert.ok(!/Secure/i.test(cookie), 'Secure menyala padahal COOKIE_SECURE mati');
    assert.ok(!cookie.includes(PASSWORD), 'sandi ikut masuk ke cookie');

    const jar = cookie.split(';')[0];

    // --- dengan sesi ---
    const allowed = await request(port, 'GET', '/api/session', { cookie: jar });
    assert.strictEqual(allowed.status, 200);

    const page = await request(port, 'GET', '/login', { cookie: jar });
    assert.strictEqual(page.status, 302,
      'yang sudah login tidak perlu melihat halaman login lagi');
    assert.strictEqual(page.location, '/');

    // Cookie yang diutak-atik harus ditolak, bukan diterima diam-diam.
    const tampered = jar.slice(0, -1) + (jar.endsWith('A') ? 'B' : 'A');
    const rejected = await request(port, 'GET', '/api/session', { cookie: tampered });
    assert.strictEqual(rejected.status, 401, 'cookie yang diubah masih diterima');

    // 404 harus tetap dijawab dengan halaman yang bisa dibaca orang, bukan
    // "Cannot GET /laporan" berjudul "Error".
    const missing = await request(port, 'GET', '/laporan-yang-belum-ada',
      { cookie: jar });
    assert.strictEqual(missing.status, 404);
    assert.ok(missing.text.includes('Halaman ini tidak ada'),
      '404 memakai halaman bawaan Express, bukan pesan untuk pengguna');
    assert.ok(!missing.text.includes('Cannot GET'));

    const missingApi = await request(port, 'GET', '/api/entah', { cookie: jar });
    assert.strictEqual(missingApi.status, 404);
    assert.ok(!missingApi.text.includes('<'), 'API 404 harus JSON, bukan HTML');

    // --- keluar ---
    const out = await request(port, 'POST', '/logout', { cookie: jar });
    assert.strictEqual(out.status, 200);
    assert.ok(/acc_session=;/.test(out.setCookie[0] || ''), 'cookie tidak dihapus');
    assert.strictEqual(COOKIE_NAME, 'acc_session');

    // --- pembatas percobaan terpasang di rute, bukan cuma ada sebagai class ---
    let limited = null;
    for (let i = 0; i < 10; i++) {
      const attempt = await request(port, 'POST', '/login', { body: { password: 'x' } });
      if (attempt.status === 429) { limited = attempt; break; }
    }
    assert.ok(limited, 'sepuluh sandi salah berturut-turut tidak pernah dibatasi');
    assert.ok(limited.text.includes('Tunggu'),
      'pesan pembatas harus memberi tahu apa yang harus dilakukan');

    console.log('OK server-auth — rute tak dikenal ikut terjaga, cookie HttpOnly/Lax, ' +
      'cookie palsu ditolak, pembatas percobaan aktif di rute');
  } finally {
    server.close();
  }
}

test().catch((error) => { console.error(error); process.exit(1); });
