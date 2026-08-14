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

loadEnvFile(path.join(ROOT, '.env'));

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
 * @return {Array<string>} daftar masalah; kosong berarti aman
 */
function validate() {
  const problems = [];
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
  return problems;
}

module.exports = { config, validate, loadEnvFile };
