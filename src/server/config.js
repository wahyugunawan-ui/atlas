/**
 * Konfigurasi. Satu-satunya tempat yang membaca .env.
 *
 * Aturannya: apa pun yang berubah antar mesin harus lewat sini. Kalau ada path, port,
 * atau rahasia yang ditulis di tempat lain, syarat "pindah server = salin folder"
 * langsung batal.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Pembaca .env sederhana. Sengaja tidak memakai paket dotenv: berkasnya lima baris
 * dan formatnya KUNCI=nilai.
 */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const at = trimmed.indexOf('=');
    if (at < 0) return;
    const key = trimmed.slice(0, at).trim();
    let value = trimmed.slice(at + 1).trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  });
}

/**
 * Letak berkas .env, diperiksa berurutan sampai ketemu yang pertama.
 *
 * Ada urutan begini karena berkas ini memuat hash sandi, rahasia penanda tangan
 * cookie, dan sandi database — dan folder proyeknya bisa saja ada di dalam
 * OneDrive/Google Drive. Kalau .env ada di sana, ketiganya ikut naik ke cloud pihak
 * ketiga tanpa ada yang menyadarinya.
 *
 * Yang disarankan: taruh di sebelah folder data (mis. C:/astra-data/.env), yang memang
 * sudah harus di disk lokal. Yang di dalam proyek dipertahankan sebagai jalan terakhir
 * supaya pemasangan lama tidak mendadak berhenti jalan.
 *
 * Tidak ada path mesin tertentu yang ditulis di sini — start.bat (Windows) dan unit
 * systemd (Linux) yang menunjuknya lewat ACC_ENV_FILE, jadi kodenya tetap sama di
 * kedua tempat.
 */

/**
 * Isi `.env.path` kalau ada: satu baris berisi LETAK berkas .env yang sebenarnya.
 *
 * Berkas penunjuk, bukan berkas rahasia — isinya cuma sebuah path, jadi aman
 * tertinggal di folder yang disinkronkan. Gunanya supaya `npm start` dan `npm test`
 * tetap jalan tanpa siapa pun harus mengatur variabel lingkungan lebih dulu, sementara
 * rahasianya sendiri tetap di luar folder proyek.
 *
 * Tetap di-gitignore: isinya path mesin masing-masing, bukan sesuatu yang sama untuk
 * semua orang.
 */
function readPointer() {
  const pointer = path.join(ROOT, '.env.path');
  if (!fs.existsSync(pointer)) return null;
  const baris = fs.readFileSync(pointer, 'utf8').split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  return baris.length ? path.resolve(baris[0]) : null;
}

const ENV_CANDIDATES = [
  process.env.ACC_ENV_FILE,
  readPointer(),
  process.env.DATA_DIR && path.join(path.resolve(process.env.DATA_DIR), '.env'),
  path.join(ROOT, '.env'),
].filter(Boolean);

/** Berkas .env yang benar-benar dipakai. Dilaporkan waktu server start. */
const envFile = ENV_CANDIDATES.find((file) => fs.existsSync(file)) || null;
if (envFile) loadEnvFile(envFile);

/**
 * Letak folder data: berkas geo dan arsip unggahan. Databasenya sendiri sudah di
 * PostgreSQL, bukan di sini.
 *
 * Tetap disarankan di luar OneDrive. Berkas geo dibaca utuh tiap kali jangkauan
 * dihitung ulang, dan folder yang sedang disinkronkan bisa membuat berkasnya terkunci
 * di tengah pembacaan.
 */
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');

const config = {
  root: ROOT,
  envFile,
  port: Number(process.env.PORT) || 3000,
  dataDir: dataDir,

  // PostgreSQL + PostGIS. Dua database: yang kedua memuat PII dan sengaja dipisah
  // supaya bisa dicabut dengan satu DROP DATABASE, dan supaya backup yang pertama
  // tidak pernah membawa nama serta alamat konsumen.
  dbHost: process.env.DB_HOST || '127.0.0.1',
  dbPort: Number(process.env.DB_PORT) || 5432,
  dbUser: process.env.DB_USER || '',
  dbPassword: process.env.DB_PASSWORD || '',
  dbName: process.env.DB_NAME || 'astra',
  dbNameCustomers: process.env.DB_NAME_CUSTOMERS || 'astra_customers',
  publicDir: path.join(ROOT, 'public'),
  passwordHash: process.env.PASSWORD_HASH || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  cookieSecure: process.env.COOKIE_SECURE === '1',
};

/**
 * Periksa konfigurasi SEBELUM server menerima permintaan pertama.
 *
 * Kalau PASSWORD_HASH kosong dan ini dibiarkan lewat, server akan hidup dengan pintu
 * terbuka dan tidak ada yang menyadarinya. Lebih baik menolak start.
 *
 * Dua daftar, bukan satu:
 *   problems  server MENOLAK start. Salah di sini berarti aplikasinya tidak aman
 *             atau tidak mungkin jalan.
 *   warnings  server tetap start, tapi ada yang harus dibereskan. Dipisah karena
 *             menolak start untuk hal yang bisa ditoleransi akan membuat orang
 *             mencari cara mematikan pemeriksaannya.
 *
 * @return {{problems: Array<string>, warnings: Array<string>}}
 */
function validate() {
  const problems = [];
  const warnings = [];

  // Tidak ada .env sama sekali adalah keadaan yang berbeda dari .env yang isinya
  // kurang, dan pesannya harus berbeda juga. Tanpa ini, orang yang lupa mengatur
  // ACC_ENV_FILE akan melihat "PASSWORD_HASH belum diisi" dan mengisi berkas yang
  // salah — yang tetap tidak menolong, karena bukan berkas itu yang dibaca.
  if (!config.envFile) {
    problems.push(
      'Tidak menemukan berkas .env di satu pun tempat berikut:\n' +
      ENV_CANDIDATES.map((f) => '        ' + f).join('\n') + '\n' +
      '      Jalankan lewat start.bat, atau tunjuk berkasnya sendiri:\n' +
      '        set ACC_ENV_FILE=C:\\astra-data\\.env');
    return { problems, warnings };
  }

  if (!config.passwordHash) {
    problems.push('PASSWORD_HASH belum diisi di .env — jalankan: npm run set-password');
  }
  if (!config.sessionSecret) {
    problems.push('SESSION_SECRET belum diisi di .env — jalankan: npm run set-password');
  } else if (config.sessionSecret.length < 32) {
    problems.push('SESSION_SECRET terlalu pendek (minimal 32 karakter)');
  }
  if (!config.dbUser) {
    problems.push('DB_USER belum diisi di .env — lihat README.md bagian PostgreSQL');
  }
  if (/onedrive|google drive|dropbox/i.test(config.dataDir)) {
    problems.push(
      `DATA_DIR ada di folder yang disinkronkan (${config.dataDir}). ` +
      'Berkas geo bisa terkunci di tengah pembacaan. Pindahkan ke disk lokal, ' +
      'misalnya C:\\astra-data');
  }

  // Rahasia di folder yang disinkronkan = rahasia yang sudah ada di cloud pihak
  // ketiga. Ini TIDAK menolak start — servernya jalan, cuma memang tidak aman — tapi
  // harus diteriakkan, karena gejalanya nol dan tidak ada yang akan menyadarinya
  // sendiri.
  if (config.envFile && /onedrive|google drive|dropbox|icloud/i.test(config.envFile)) {
    warnings.push(
      `.env ada di folder yang disinkronkan (${config.envFile}).\n` +
      '    Hash sandi, rahasia cookie, dan sandi database ikut naik ke cloud.\n' +
      '    Pindahkan ke sebelah folder data, lalu arahkan lewat ACC_ENV_FILE:\n' +
      `      move .env ${path.join(config.dataDir, '.env')}`);
  }
  return { problems, warnings };
}

module.exports = { config, validate, loadEnvFile, ENV_CANDIDATES };
