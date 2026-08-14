/**
 * Setel sandi aplikasi: `npm run set-password`
 *
 * Menanyakan sandi, menulis PASSWORD_HASH dan SESSION_SECRET ke .env. Sandinya
 * sendiri tidak pernah disimpan.
 *
 * Ada supaya tidak ada seorang pun yang perlu tahu cara mengedit berkas konfigurasi
 * atau apa itu hash. Penggunanya tim channel, bukan developer.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { hashPassword } = require('../src/server/auth');
const { config } = require('../src/server/config');

/**
 * Ditulis ke berkas .env yang BENAR-BENAR dipakai server, bukan ke yang di dalam
 * proyek begitu saja.
 *
 * Kalau keduanya berbeda — dan memang berbeda begitu .env dipindah keluar dari
 * folder tersinkron — menulis ke tempat yang salah menghasilkan gejala yang paling
 * membingungkan: skripnya bilang "sandi tersimpan", tapi sandi lamanya masih berlaku.
 *
 * Kalau belum ada satu pun .env, dibuat di sebelah folder data, yang memang sudah
 * harus di disk lokal.
 */
const ENV_FILE = config.envFile || path.join(config.dataDir, '.env');

/** Baca satu baris tanpa menampilkan ketikan di layar. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const output = rl.output;
    let silent = false;
    output.write(question);
    // Menimpa _writeToOutput adalah cara yang didukung readline untuk menyembunyikan
    // masukan; tidak ada API resmi untuk ini.
    rl._writeToOutput = (chunk) => { if (!silent) output.write(chunk); };
    silent = true;
    rl.question('', (answer) => {
      silent = false;
      output.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

/** Ganti satu kunci di isi .env, atau tambahkan kalau belum ada. */
function upsert(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(content)
    ? content.replace(pattern, line)
    : (content.trimEnd() + '\n' + line + '\n').trimStart();
}

async function main() {
  console.log('\n  Setel sandi Astra Command Center');
  console.log('  Sandi ini dipakai bersama seluruh tim.\n');

  const password = await askHidden('  Sandi baru          : ');
  if (password.length < 8) {
    console.error('\n  Sandi minimal 8 karakter. Tidak ada yang diubah.\n');
    process.exit(1);
  }
  const again = await askHidden('  Ketik ulang sandinya: ');
  if (password !== again) {
    console.error('\n  Kedua sandi tidak sama. Tidak ada yang diubah.\n');
    process.exit(1);
  }

  let content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  content = upsert(content, 'PASSWORD_HASH', hashPassword(password));

  // SESSION_SECRET hanya dibuat kalau belum ada. Menggantinya membatalkan semua sesi
  // yang sedang berjalan — perilaku yang benar kalau memang diinginkan, tapi tidak
  // boleh terjadi diam-diam cuma karena ada yang mengganti sandi.
  if (!/^SESSION_SECRET=.+$/m.test(content)) {
    content = upsert(content, 'SESSION_SECRET', crypto.randomBytes(48).toString('base64url'));
    console.log('\n  SESSION_SECRET baru dibuat.');
  } else {
    console.log('\n  SESSION_SECRET yang lama dipertahankan (sesi tidak terputus).');
  }

  // Foldernya bisa saja belum ada kalau ini .env pertama di lokasi baru.
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  fs.writeFileSync(ENV_FILE, content, { mode: 0o600 });
  console.log('  Sandi tersimpan di ' + ENV_FILE + '\n');
  console.log('  Berkas .env memuat kredensial. Jangan dikirim lewat chat atau email,');
  console.log('  dan jangan ikut disalin ke tempat umum.\n');
}

main();
