/**
 * Express app: rute dan middleware. Dipisah dari index.js supaya tes bisa
 * membangunnya tanpa membuka port.
 */
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const {
  COOKIE_NAME, verifyPassword, createSession, readSession, RateLimiter, cookieOptions,
} = require('./auth');

/** Halaman dan aset yang boleh diakses tanpa login. */
const PUBLIC_PATHS = new Set(['/login', '/login.html']);

function buildApp(config) {
  const app = express();
  const limiter = new RateLimiter(5, 60 * 1000);

  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  /** Aset statis boleh tanpa login: CSS dan library tidak memuat data apa pun. */
  app.use('/vendor', express.static(path.join(config.frontendDir, 'vendor'),
    { maxAge: '365d', immutable: true }));
  app.use('/css', express.static(path.join(config.frontendDir, 'css')));

  app.get('/login', (req, res) => {
    if (readSession(config.sessionSecret, req.cookies[COOKIE_NAME])) {
      return res.redirect('/');
    }
    res.sendFile(path.join(config.frontendDir, 'login.html'));
  });

  app.post('/login', (req, res) => {
    const who = req.ip || 'tidak diketahui';
    if (!limiter.allow(who)) {
      // 429, bukan 401. Bedanya penting buat pengguna: "salah sandi" dan "terlalu
      // sering mencoba" butuh tindakan yang berbeda.
      return res.status(429).json({
        error: 'Terlalu banyak percobaan. Tunggu satu menit lalu coba lagi.',
      });
    }

    const password = String((req.body && req.body.password) || '');
    if (!verifyPassword(password, config.passwordHash)) {
      return res.status(401).json({ error: 'Sandi salah.' });
    }

    limiter.reset(who);
    res.cookie(COOKIE_NAME, createSession(config.sessionSecret),
      cookieOptions(config.cookieSecure));
    res.json({ ok: true });
  });

  app.post('/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME, cookieOptions(config.cookieSecure));
    res.json({ ok: true });
  });

  /**
   * Penjaga. Semua yang belum lewat sampai baris ini butuh sesi yang sah.
   *
   * Ditulis sebagai "tolak semua kecuali yang terdaftar", bukan "lindungi rute yang
   * ini dan itu". Bedanya muncul waktu ada rute baru ditambahkan dan lupa didaftarkan:
   * dengan cara ini rute baru otomatis terlindungi, dengan cara sebaliknya otomatis
   * terbuka.
   */
  app.use((req, res, next) => {
    if (PUBLIC_PATHS.has(req.path)) return next();
    if (readSession(config.sessionSecret, req.cookies[COOKIE_NAME])) return next();

    // Permintaan API dijawab 401 supaya halaman bisa menanganinya; permintaan
    // halaman diarahkan ke login supaya orang tidak melihat JSON telanjang.
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Belum login.' });
    }
    res.redirect('/login');
  });

  // ---- mulai dari sini semuanya sudah pasti login ----

  app.get('/api/session', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', require('./routes').build(config));

  /**
   * Berkas geo: batas kelurahan, batas kota, dan basemap PMTiles.
   *
   * Disajikan sebagai berkas statis, bukan lewat database. Ini blob yang nyaris tidak
   * pernah berubah — database tidak menambah apa pun selain lapisan di tengah, dan
   * express.static sudah menangani Range request yang dibutuhkan PMTiles: browser
   * mengambil potongan yang perlu saja, bukan 28 MB sekaligus.
   *
   * ponytail: sementara masih memuat agregat.json dan konsumen.json juga. Fase 3
   * memindahkan keduanya ke /api/aggregate dan /api/customers.
   */
  app.use('/data', express.static(path.join(config.dataDir, 'geo'), {
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.pmtiles')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));

  app.use(express.static(config.frontendDir, { index: 'index.html' }));

  /**
   * 404 yang bisa dibaca orang.
   *
   * Bawaan Express menulis "Cannot GET /laporan" dengan judul halaman "Error", dan
   * itu tidak memberi tahu apa pun kepada orang yang tidak menulis kodenya.
   */
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Alamat API tidak dikenal.' });
    }
    res.status(404).type('html').send(
      '<!DOCTYPE html><html lang="id"><meta charset="utf-8">' +
      '<title>Halaman tidak ada</title>' +
      '<body style="font-family:system-ui,sans-serif;background:#f2f4f9;color:#0b1220;' +
      'display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">' +
      '<div style="text-align:center;max-width:380px;padding:24px">' +
      '<p style="font-size:19px;font-weight:800;margin:0">Halaman ini tidak ada</p>' +
      '<p style="color:#64748b;font-size:14px;line-height:1.5;margin:10px 0 20px">' +
      'Alamatnya mungkin salah ketik, atau halamannya sudah dipindah.</p>' +
      '<a href="/" style="color:#0b2f6b;font-weight:700;font-size:14px">' +
      'Kembali ke dashboard</a></div></body></html>');
  });

  app.use((error, req, res, next) => {          // eslint-disable-line no-unused-vars
    console.error('[error]', error);
    // Pesan aslinya bisa memuat path server atau potongan query; yang keluar cuma
    // kalimat umum. Detailnya ada di log server, tempatnya memang di situ.
    res.status(500).json({ error: 'Terjadi kesalahan di server.' });
  });

  return app;
}

module.exports = { buildApp, PUBLIC_PATHS };
