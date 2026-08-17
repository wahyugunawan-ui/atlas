/**
 * Titik masuk server.
 *
 * Tugasnya cuma tiga: periksa konfigurasi, buka port, dan memberi tahu pengguna
 * alamat mana yang harus dibuka rekannya. Yang ketiga itu bukan hiasan — penggunanya
 * tidak punya tim IT, dan "Listening on port 3000" tidak memberi tahu siapa pun cara
 * membuka aplikasinya dari komputer lain.
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { config, validate } = require('./config');
const { buildApp } = require('./app');
const logger = require('./logger');

/** Alamat IPv4 di jaringan lokal, untuk ditunjukkan ke pengguna. */
function localAddresses() {
  const found = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const entry of interfaces[name] || []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  return found;
}

/**
 * Baca sertifikat TLS kalau SSL_CERT dan SSL_KEY menunjuk berkas yang ada.
 *
 * Mengembalikan null diam-diam kalau dua-duanya kosong — itu keadaan normal di
 * laptop. Tapi kalau DIISI dan berkasnya tidak ketemu, itu salah ketik yang harus
 * terdengar: server yang diam-diam turun ke HTTP padahal orangnya mengira HTTPS
 * lebih berbahaya daripada server yang menolak start.
 *
 * TIDAK ada sertifikat yang dibuat sendiri secara otomatis. Sertifikat yang
 * ditandatangani sendiri membuat tiap pengguna melihat layar peringatan merah dan
 * mengajari mereka menekan "lanjutkan saja" — kebiasaan yang lebih berbahaya
 * daripada HTTP di jaringan kantor yang tertutup.
 */
function readTls() {
  const cert = process.env.SSL_CERT;
  const key = process.env.SSL_KEY;
  if (!cert && !key) return null;
  if (!cert || !key) {
    console.error('\n  SSL_CERT dan SSL_KEY harus diisi dua-duanya, bukan salah satu.\n');
    process.exit(1);
  }
  for (const file of [cert, key]) {
    if (!fs.existsSync(file)) {
      console.error(`\n  Berkas sertifikat tidak ada: ${file}`);
      console.error('  Perbaiki SSL_CERT/SSL_KEY di .env, atau kosongkan dua-duanya');
      console.error('  kalau memang belum pakai HTTPS.\n');
      process.exit(1);
    }
  }
  return {
    cert: fs.readFileSync(cert),
    key: fs.readFileSync(key),
    from: path.basename(cert),
  };
}

async function main() {
  // Log dinyalakan PALING AWAL. Kalau tidak, justru pesan kegagalan start —
  // yang paling dibutuhkan waktu ada yang bertanya "kenapa tadi pagi mati" —
  // adalah satu-satunya yang tidak tercatat.
  const log = logger.start(config);

  const { problems, warnings } = validate();
  if (problems.length) {
    console.error('\nServer tidak bisa dijalankan:\n');
    problems.forEach((problem) => console.error('  - ' + problem));
    console.error('');
    process.exit(1);
  }

  const store = require('./db');
  try {
    await store.open(config);
  } catch (error) {
    console.error('\n' + error.message + '\n');
    process.exit(1);
  }

  // Satu promise yang gagal tanpa .catch() MENJATUHKAN proses Node, dan tidak ada
  // yang menghidupkannya kembali — aplikasinya sekadar hilang, di tengah jam kerja,
  // tanpa jejak. Dua penangan ini mengubahnya jadi baris di log dan aplikasi yang
  // tetap melayani.
  //
  // Sengaja TIDAK memanggil process.exit(). Nasihat umum bilang "keadaan proses
  // sudah tidak bisa dipercaya, matikan saja" — itu benar kalau ada supervisor yang
  // menghidupkan ulang. Di laptop tim tanpa orang IT tidak ada supervisor, jadi mati
  // berarti mati sampai ada yang menyadarinya. Tetap melayani dengan satu permintaan
  // gagal lebih baik daripada tidak melayani sama sekali.
  process.on('unhandledRejection', (reason) => {
    console.error('Promise gagal tanpa ditangani:', reason);
  });
  process.on('uncaughtException', (error) => {
    console.error('Galat tidak tertangkap:', error);
  });

  const app = buildApp(config);

  // Mengikat 0.0.0.0, bukan 127.0.0.1. Kalau tidak, aplikasinya hanya bisa dibuka di
  // laptop ini sendiri dan rekan sekantor akan melihat "situs tidak dapat dijangkau"
  // tanpa petunjuk apa pun tentang sebabnya.
  // Di VPS, Caddy atau Nginx di depan yang mengurus sertifikat dan aplikasi ini
  // tetap HTTP di belakangnya. Jalur TLS ini untuk keadaan sebaliknya: tidak ada
  // apa pun di depannya, jadi aplikasinya sendiri yang harus melayani HTTPS.
  const tls = readTls();
  const skema = tls ? 'https' : 'http';
  const server = tls ? https.createServer(tls, app) : http.createServer(app);

  server.listen(config.port, '0.0.0.0', () => {
    console.log('\n  Astra Command Center berjalan.\n');
    console.log(`  Buka di laptop ini          : ${skema}://localhost:${config.port}`);
    const addresses = localAddresses();
    if (addresses.length) {
      console.log('  Buka dari komputer sekantor : ' +
        addresses.map((ip) => `${skema}://${ip}:${config.port}`)
          .join('\n' + ' '.repeat(32)));
      if (addresses.length > 1) {
        console.log('  (kalau alamat pertama tidak bisa dibuka, coba yang berikutnya)');
      }
    } else {
      console.log('  (tidak terhubung ke jaringan — hanya bisa dibuka di laptop ini)');
    }
    if (tls) {
      console.log('  HTTPS          : aktif (' + tls.from + ')');
      if (!config.cookieSecure) {
        console.warn('\n  PERHATIAN: HTTPS aktif tapi COOKIE_SECURE masih 0. Isi');
        console.warn('  COOKIE_SECURE=1 di .env supaya cookie sesi tidak pernah');
        console.warn('  terkirim lewat sambungan biasa.');
      }
    } else {
      console.log('\n  Catatan: berjalan tanpa HTTPS. Wajar di jaringan kantor yang');
      console.log('  tertutup, tapi sandi dan cookie lewat sebagai teks polos —');
      console.log('  jangan dibuka ke internet begini. Lihat docs/PINDAH.md.');
    }
    console.log('\n  Berkas .env    : ' + (config.envFile || '(tidak ada)'));
    console.log('  Catatan (log)  : ' + log.file);
    if (log.pruned) {
      console.log(`  (${log.pruned} log lama di atas ${logger.KEEP_DAYS} hari dibuang)`);
    }

    // Peringatan dicetak SETELAH alamatnya, bukan sebelum. Yang dicetak duluan
    // tergulung hilang begitu server ramai; yang terakhir masih terbaca.
    warnings.forEach((w) => console.warn('\n  PERHATIAN: ' + w));

    console.log('\n  Tutup jendela ini untuk mematikan server.\n');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n  Port ${config.port} sedang dipakai program lain.`);
      console.error('  Kemungkinan server ini sudah berjalan di jendela lain.');
      console.error(`  Kalau memang perlu port lain, ubah PORT di berkas .env\n`);
      process.exit(1);
    }
    throw error;
  });

  // Ctrl+C dan penutupan jendela harus melepas port dan menutup koneksi database
  // dengan rapi, supaya Postgres tidak menyimpan sesi menggantung sampai
  // timeout-nya sendiri habis.
  const shutdown = () => {
    console.log('\n  Menutup server...');
    server.close(async () => { await store.close(); process.exit(0); });
    setTimeout(async () => { await store.close(); process.exit(0); }, 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
