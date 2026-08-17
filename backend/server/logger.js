/**
 * Catat keluaran server ke berkas, bukan cuma ke jendela yang nanti ditutup.
 *
 * Sebelum ini semua `console.log`/`console.error` hilang begitu jendela start.bat
 * ditutup. Waktu ada yang bilang "kemarin sore error", tidak ada satu pun jejak yang
 * bisa dibaca — dan penggunanya bukan orang yang bisa menyalin pesan error.
 *
 * CARA KERJANYA: `console.log` dan kawan-kawan DISADAP, bukan diganti dengan API baru.
 * Itu disengaja. Menyalurkan objek logger ke 17 titik panggil yang sudah ada (dan ke
 * tiap titik baru nanti) menambah pekerjaan tanpa menambah apa pun — sementara
 * menyadap console membuat semua yang sudah ditulis, dan semua yang ditulis nanti,
 * langsung ikut tercatat. Keluaran ke layar tetap seperti semula.
 *
 * DITULIS SINKRON, bukan lewat stream. Stream menahan baris di buffer sampai sempat
 * dikosongkan — dan waktu proses mati mendadak, baris yang tertahan itu justru baris
 * yang paling dibutuhkan. Volumenya beberapa baris per permintaan untuk 20 orang di
 * LAN; menukar kecepatan yang tidak terasa dengan catatan yang benar-benar sampai ke
 * disk adalah pertukaran yang jelas.
 *
 * Yang TIDAK dikerjakan di sini: level log, format terstruktur, kirim ke layanan luar.
 * Berkas teks per hari sudah menjawab "apa yang terjadi kemarin sore", dan itu
 * satu-satunya pertanyaan yang pernah muncul.
 */
const fs = require('fs');
const path = require('path');

/** Berapa hari berkas log disimpan sebelum dibuang sendiri. */
const KEEP_DAYS = 30;

let logDir = null;
const original = {};

/** '2026-08-13' — dipakai jadi nama berkas dan pemicu pergantian hari. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

function fileFor(day) {
  return path.join(logDir, `server-${day}.log`);
}

/**
 * Buang log yang lebih tua dari KEEP_DAYS.
 *
 * Log server memuat alamat IP dan kode kelurahan yang diakses — bukan PII, tapi juga
 * bukan sesuatu yang perlu disimpan selamanya di laptop yang dipakai bersama.
 *
 * Polanya ketat (`server-YYYY-MM-DD.log`) supaya berkas lain yang kebetulan ada di
 * folder itu tidak ikut terhapus.
 */
function prune() {
  const batas = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let dibuang = 0;
  for (const name of fs.readdirSync(logDir)) {
    const cocok = /^server-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
    if (!cocok) continue;
    if (Date.parse(cocok[1]) < batas) {
      fs.unlinkSync(path.join(logDir, name));
      dibuang++;
    }
  }
  return dibuang;
}

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function write(level, args) {
  try {
    const text = args.map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack || a.message;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    // Nama berkas dihitung tiap kali menulis, jadi pergantian hari terjadi sendiri
    // tanpa penjadwal — server yang menyala berminggu-minggu tetap memisah per hari.
    fs.appendFileSync(fileFor(today()), `${stamp()} ${level} ${text}\n`);
  } catch {
    // Gagal menulis log TIDAK boleh menjatuhkan aplikasi. Kalau disknya penuh atau
    // foldernya hilang, yang benar adalah tetap melayani permintaan tanpa catatan —
    // bukan mati karena tidak bisa mencatat.
  }
}

/**
 * Mulai mencatat. Dipanggil sekali di index.js sebelum apa pun yang lain.
 *
 * @param {Object} config  dari config.js — butuh dataDir
 * @return {{dir: string, file: string, pruned: number}}
 */
function start(config) {
  logDir = path.join(config.dataDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const pruned = prune();

  for (const level of ['log', 'warn', 'error']) {
    if (original[level]) continue;                 // sudah disadap, jangan bertumpuk
    original[level] = console[level].bind(console);
    console[level] = (...args) => {
      original[level](...args);
      write(level === 'log' ? 'INFO ' : level.toUpperCase().padEnd(5), args);
    };
  }

  return { dir: logDir, file: fileFor(today()), pruned };
}

/** Kembalikan console seperti semula. Dipakai tes supaya tidak saling mengganggu. */
function stop() {
  for (const level of Object.keys(original)) {
    console[level] = original[level];
    delete original[level];
  }
}

module.exports = { start, stop, KEEP_DAYS };
