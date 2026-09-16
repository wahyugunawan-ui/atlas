/**
 * Uji penjagaan rute lewat HTTP sungguhan.
 *
 * auth.test.js sudah menguji fungsinya. Berkas ini menguji hal yang berbeda dan
 * justru lebih sering salah: apakah penjaganya benar-benar TERPASANG di rute yang
 * seharusnya. Fungsi yang sempurna tidak menolong kalau middleware-nya lupa dipakai.
 */
const assert = require('assert');
const http = require('http');
const { buildApp } = require('../backend/server/app');
const { simpanKonsumen } = require('../backend/server/routes');
const { hashPassword, createSession, COOKIE_NAME } = require('../backend/server/auth');

const PASSWORD = 'sandi-uji-tim-channel';
const config = {
  frontendDir: require('path').join(__dirname, '..', 'frontend'),
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
  const app = buildApp(config);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;

  try {
    /* --------------------------------------------------------------------
       X-Forwarded-For cuma dipercaya dari loopback
       --------------------------------------------------------------------
       Diperlukan begitu aplikasi berada di belakang proksi lokal (Tailscale Funnel,
       Caddy, nginx): tanpa itu SELURUH pengunjung ber-IP 127.0.0.1, pembatas login
       dan pembatas PII jadi ditanggung bersama, dan catatan akses PII kehilangan
       artinya — padahal satu akun dipakai bersama dan justru itu gunanya.

       Tapi 'loopback' BUKAN `true`, dan bedanya itu yang dijaga di sini. Dengan
       `true`, siapa pun yang bisa menjangkau server — termasuk dari LAN yang sama —
       boleh menuliskan IP palsu di header dan melewati pembatas PII dengan mengganti
       nilainya tiap permintaan. Pembatas yang bisa dilewati begitu sama saja dengan
       tidak ada.
       -------------------------------------------------------------------- */
    assert.strictEqual(app.get('trust proxy'), 'loopback',
      "trust proxy harus 'loopback'. `true` membuat pembatas PII bisa dilewati siapa " +
      'pun yang memalsukan X-Forwarded-For; tanpa setelan sama sekali, semua ' +
      'pengunjung di balik proksi berbagi satu jatah dan jejak auditnya jadi 127.0.0.1');

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
    assert.ok(loginPage.text.includes('ATLAS'));

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

    // --- reset master pos wajib konfirmasi ---
    //
    // Jalur paling destruktif di aplikasi ini: seluruh pos, seluruh penjualan, dan
    // seluruh data konsumen sekaligus. Konfirmasinya diperiksa SEBELUM repositori
    // disentuh, jadi tes ini tidak butuh database — dan justru itu yang membuatnya
    // berarti: kalau penjagaan pindah ke dalam repo, satu permintaan yang salah ketik
    // sudah terlanjur masuk ke sana.
    const resetSesi = `${COOKIE_NAME}=${createSession(config.sessionSecret)}`;

    const resetTanpa = await request(port, 'DELETE', '/api/outlets', { cookie: resetSesi });
    assert.strictEqual(resetTanpa.status, 400,
      'DELETE /api/outlets tanpa konfirmasi tidak ditolak — satu permintaan nyasar ' +
      'bisa mengosongkan seluruh master pos beserta penjualannya');
    assert.match(resetTanpa.text, /RESET/,
      'pesannya harus menyebut apa yang harus diketik, bukan cuma "tidak sah"');

    // Huruf kecil ditolak. Yang diperiksa BUKAN cuma statusnya: kalau perbandingannya
    // dilonggarkan (misalnya .toUpperCase()), permintaannya lolos penjaga lalu gagal di
    // repositori — dan itu juga 400. Statusnya sama, artinya beda jauh. Yang
    // membedakan cuma pesannya, jadi pesannya yang diperiksa.
    const resetSalah = await request(port, 'DELETE', '/api/outlets?confirm=reset',
      { cookie: resetSesi });
    assert.strictEqual(resetSalah.status, 400,
      'konfirmasi huruf kecil diterima — perbandingannya harus persis');
    assert.match(resetSalah.text, /Ketik RESET persis/,
      'konfirmasi huruf kecil lolos penjaga dan baru gagal di repositori — ' +
      'perbandingannya tidak lagi persis');

    // --- rentang periode: satu rute menolak, satu rute mengabaikan ---
    //
    // Dua rute PII memakai NAMA PARAMETER YANG SAMA dengan aturan yang sengaja
    // berbeda, dan itu undangan untuk salin-tempel. /customers/browse dipakai sambil
    // mengetik, jadi penyaring cacat diabaikan; /customers mengeluarkan nama dan
    // alamat satu kelurahan, jadi bentuk yang salah DITOLAK — mengabaikannya berarti
    // permintaannya melebar diam-diam jadi seluruh riwayat kelurahan itu.
    //
    // Ditaruh SEBELUM blok pembatas di bawah: blok itu sengaja menghabiskan jatah
    // 30/menit, dan permintaan apa pun sesudahnya cuma dapat 429 lalu ikut hijau.
    const sesiPeriode = `${COOKIE_NAME}=${createSession(config.sessionSecret)}`;

    const periodeCacat = await request(port, 'GET',
      '/api/customers?village=34.04.01.2001&periodFrom=2026-13', { cookie: sesiPeriode });
    assert.strictEqual(periodeCacat.status, 400,
      '/api/customers menerima periode yang bentuknya salah lalu mengabaikannya — ' +
      'hasilnya seluruh riwayat kelurahan itu, bukan bulan yang diminta');

    const terbalik = await request(port, 'GET',
      '/api/customers?village=34.04.01.2001&periodFrom=2026-09&periodTo=2026-07',
      { cookie: sesiPeriode });
    assert.strictEqual(terbalik.status, 400,
      'rentang terbalik di /api/customers tidak ditolak');
    assert.match(terbalik.text, /terbalik/i,
      'pesannya harus menyebut apa yang salah, bukan cuma "permintaan tidak sah"');

    // Sebaliknya di rute telusur: bentuk yang salah tidak boleh membatalkan permintaan.
    const lunak = await request(port, 'GET',
      '/api/customers/browse?periodFrom=bukan-periode', { cookie: sesiPeriode });
    assert.notStrictEqual(lunak.status, 400,
      '/api/customers/browse menolak penyaring yang cacat — halaman yang dipakai ' +
      'sambil mengetik jadi terasa rusak tiap satu dropdown belum diisi');

    // --- pembatas laju di rute yang mengembalikan PII ---
    //
    // Halaman Data Konsumen mengirim 500 baris per permintaan. Tanpa pembatas, satu
    // akun bersama bisa menyedot 18 ribu baris dalam hitungan detik lewat 40
    // permintaan berurutan. Yang diuji di sini bukan kelas RateLimiter-nya —
    // auth.test.js sudah — tapi apakah dia benar-benar TERPASANG di rutenya.
    //
    // Tidak butuh database: pembatasnya jalan sebelum repositori disentuh.
    const sesi = `${COOKIE_NAME}=${createSession(config.sessionSecret)}`;
    let piiLimited = null;
    for (let i = 0; i < 60; i++) {
      const hit = await request(port, 'GET', '/api/customers/browse', { cookie: sesi });
      assert.notStrictEqual(hit.status, 401, 'sesi uji ditolak — tesnya salah, bukan kodenya');
      if (hit.status === 429) { piiLimited = { hit, ke: i + 1 }; break; }
    }
    assert.ok(piiLimited,
      '60 permintaan data konsumen berturut-turut tidak pernah dibatasi');
    assert.ok(piiLimited.ke > 10,
      `dibatasi terlalu cepat (permintaan ke-${piiLimited.ke}) — menelusuri dengan ` +
      'tangan pun akan kena');
    assert.ok(piiLimited.hit.text.includes('Tunggu'),
      'pesan pembatas harus memberi tahu apa yang harus dilakukan');

    // Rute per-kelurahan ikut dibatasi oleh pembatas yang sama.
    const perKelurahan = await request(port, 'GET',
      '/api/customers?village=34.04.01.2001', { cookie: sesi });
    assert.strictEqual(perKelurahan.status, 429,
      '/api/customers tidak ikut dibatasi — pembatasnya cuma dipasang di satu rute');

    /* --------------------------------------------------------------------
       Absennya withCustomers berarti SIMPAN
       --------------------------------------------------------------------
       Arah yang gampang terbalik, dan terbaliknya tidak berbunyi. Halaman impor tidak
       lagi mengirim field ini sejak centangnya dibuang; kalau aturannya ditulis
       `=== '1'`, halaman yang tidak mengirim apa-apa berarti TIDAK PERNAH menyimpan.
       Impor tetap berjalan mulus, angka penjualannya tetap benar, dan tab Data
       Konsumen diam-diam kosong selamanya.

       Nilai '0' yang eksplisit tetap mematikannya, dan itu yang menjaga jalur CLI dan
       tes tetap bisa mengimpor tanpa PII — dasar dari KNF-PRIVASI-2.
       -------------------------------------------------------------------- */
    assert.strictEqual(simpanKonsumen(undefined), true,
      'field yang tidak dikirim diperlakukan sebagai "jangan simpan" — halaman impor ' +
      'tidak mengirimnya sama sekali, jadi data konsumen tidak akan pernah tersimpan');
    assert.strictEqual(simpanKonsumen(''), true);
    assert.strictEqual(simpanKonsumen('1'), true);
    assert.strictEqual(simpanKonsumen('0'), false,
      "'0' yang eksplisit harus tetap mematikannya — itu jalan satu-satunya mengimpor " +
      'tanpa PII, dan tes PII-bisa-dicabut bergantung padanya');

    /* ----------------------------------------------------------------------
       Hapus periode: konfirmasinya diperiksa DI SERVER
       ----------------------------------------------------------------------
       Halaman meminta orang mengetik ulang periodenya sebelum tombolnya hidup. Kalau
       penjaganya cuma di sana, satu permintaan langsung ke API melewatinya begitu saja
       — dan yang dilewati adalah penghapusan belasan ribu baris tanpa jalan kembali.

       Ditolak SEBELUM database disentuh, jadi tes ini tidak butuh data sama sekali.
       ---------------------------------------------------------------------- */
    // PESANNYA yang diperiksa, bukan cuma statusnya. Tanpa database terbuka, permintaan
    // yang LOLOS penjaga konfirmasi juga berakhir 400 — dari kegagalan query, bukan
    // dari penolakan. Memeriksa status saja membuat tes ini hijau walaupun penjaganya
    // dicabut; sudah dibuktikan lewat uji mutasi.
    const wajibKonfirmasi = /konfirmasi tidak cocok/i;

    const tanpaKonfirmasi = await request(port, 'DELETE', '/api/periods/2026-08',
      { cookie: sesi });
    assert.strictEqual(tanpaKonfirmasi.status, 400);
    assert.match(tanpaKonfirmasi.text, wajibKonfirmasi,
      'menghapus periode tanpa konfirmasi tidak ditolak oleh penjaganya — ' +
      'penjaga itu cuma ada di layar, dan satu permintaan langsung ke API melewatinya');

    const konfirmasiSalah = await request(port, 'DELETE',
      '/api/periods/2026-08?confirm=2026-07', { cookie: sesi });
    assert.match(konfirmasiSalah.text, wajibKonfirmasi,
      'konfirmasi periode LAIN diterima — salah ketik bisa menghapus bulan yang salah');

    const konfirmasiAsal = await request(port, 'DELETE',
      '/api/periods/2026-08?confirm=1', { cookie: sesi });
    assert.match(konfirmasiAsal.text, wajibKonfirmasi,
      'nilai apa pun diterima sebagai konfirmasi — harus sama persis dengan periodenya');

    const bentukSalah = await request(port, 'DELETE',
      '/api/periods/agustus?confirm=agustus', { cookie: sesi });
    assert.strictEqual(bentukSalah.status, 400);
    assert.match(bentukSalah.text, /YYYY-MM/,
      'periode yang bukan YYYY-MM diterima');

    // Dan rutenya tetap butuh sesi, sama seperti rute lain.
    const tanpaSesi = await request(port, 'DELETE', '/api/periods/2026-08?confirm=2026-08');
    assert.strictEqual(tanpaSesi.status, 401,
      'menghapus periode bisa dilakukan tanpa login');

    console.log('OK server-auth — rute tak dikenal ikut terjaga, cookie HttpOnly/Lax, ' +
      'cookie palsu ditolak, pembatas login dan pembatas PII aktif di rute, ' +
      'X-Forwarded-For cuma dipercaya dari loopback, hapus periode wajib konfirmasi');
  } finally {
    server.close();
  }
}

test().catch((error) => { console.error(error); process.exit(1); });
