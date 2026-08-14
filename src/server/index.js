/**
 * Titik masuk server.
 *
 * Tugasnya cuma tiga: periksa konfigurasi, buka port, dan memberi tahu pengguna
 * alamat mana yang harus dibuka rekannya. Yang ketiga itu bukan hiasan — penggunanya
 * tidak punya tim IT, dan "Listening on port 3000" tidak memberi tahu siapa pun cara
 * membuka aplikasinya dari komputer lain.
 */
const os = require('os');
const { config, validate } = require('./config');
const { buildApp } = require('./app');

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

async function main() {
  const problems = validate();
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

  const app = buildApp(config);

  // Mengikat 0.0.0.0, bukan 127.0.0.1. Kalau tidak, aplikasinya hanya bisa dibuka di
  // laptop ini sendiri dan rekan sekantor akan melihat "situs tidak dapat dijangkau"
  // tanpa petunjuk apa pun tentang sebabnya.
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log('\n  Astra Command Center berjalan.\n');
    console.log('  Buka di laptop ini          : http://localhost:' + config.port);
    const addresses = localAddresses();
    if (addresses.length) {
      console.log('  Buka dari komputer sekantor : ' +
        addresses.map((ip) => `http://${ip}:${config.port}`).join('\n' + ' '.repeat(32)));
      if (addresses.length > 1) {
        console.log('  (kalau alamat pertama tidak bisa dibuka, coba yang berikutnya)');
      }
    } else {
      console.log('  (tidak terhubung ke jaringan — hanya bisa dibuka di laptop ini)');
    }
    if (!config.cookieSecure) {
      console.log('\n  Catatan: berjalan tanpa HTTPS. Wajar di jaringan kantor,');
      console.log('  tapi jangan dibuka ke internet dalam keadaan ini.');
    }
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
