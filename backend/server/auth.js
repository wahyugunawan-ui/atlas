/**
 * Autentikasi satu akun.
 *
 * Sengaja tanpa penyimpanan sesi. Cookie-nya menandatangani dirinya sendiri, jadi:
 *   - restart server tidak menendang siapa pun yang sedang login
 *   - banyak orang login serentak dengan sandi yang sama tidak saling mengganggu
 *     (sesi itu cookie di masing-masing browser, bukan slot di server)
 *   - tidak ada yang perlu dibersihkan waktu sesi kedaluwarsa
 *
 * Yang tidak diselesaikan teknologi: satu akun bersama berarti tidak ada yang tahu
 * SIAPA yang melakukan apa. Peredamnya tabel `imports` yang mencatat tiap impor.
 *
 * Semua di sini memakai node:crypto — tidak ada dependensi kriptografi dari npm.
 */
const crypto = require('crypto');

/** Parameter scrypt. N=16384 butuh ~16 MB, jauh di bawah batas bawaan Node (32 MB). */
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 };

/** Umur sesi. Cukup panjang supaya tidak mengganggu kerja sehari, cukup pendek
 *  supaya laptop yang ditinggal tidak login selamanya. */
const SESSION_MS = 12 * 60 * 60 * 1000;

const COOKIE_NAME = 'acc_session';

/**
 * Hash sandi. Keluarannya satu baris yang aman ditaruh di .env:
 *   scrypt$16384$8$1$<salt-base64url>$<hash-base64url>
 *
 * Parameternya ikut disimpan supaya sandi lama tetap bisa diverifikasi kalau suatu
 * saat parameternya dinaikkan.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keyLength, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString('base64url'), key.toString('base64url')].join('$');
}

/**
 * Cocokkan sandi dengan hash tersimpan.
 *
 * Perbandingannya timing-safe. Tanpa itu, waktu yang dibutuhkan untuk menolak sandi
 * membocorkan berapa banyak byte awal yang sudah benar, dan sandi bisa ditebak byte
 * demi byte.
 */
function verifyPassword(password, stored) {
  const part = String(stored || '').split('$');
  if (part.length !== 6 || part[0] !== 'scrypt') return false;

  const options = { N: Number(part[1]), r: Number(part[2]), p: Number(part[3]) };
  if (!options.N || !options.r || !options.p) return false;

  const salt = Buffer.from(part[4], 'base64url');
  const expected = Buffer.from(part[5], 'base64url');
  let actual;
  try {
    actual = crypto.scryptSync(password, salt, expected.length, options);
  } catch {
    return false;                       // parameter di luar batas: perlakukan salah
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Buat nilai cookie sesi: `v1.<kedaluwarsa>.<tanda tangan>`.
 *
 * Kedaluwarsa ikut ditandatangani, jadi tidak bisa diperpanjang dari sisi browser.
 * Mengganti SESSION_SECRET membatalkan semua sesi sekaligus — itulah cara mengusir
 * semua orang kalau sandinya bocor.
 */
function createSession(secret, now, ttlMs) {
  const expiresAt = (now || Date.now()) + (ttlMs || SESSION_MS);
  const payload = `v1.${expiresAt}`;
  return `${payload}.${sign(secret, payload)}`;
}

/**
 * Baca cookie sesi. Mengembalikan { expiresAt } kalau sah, null kalau tidak.
 *
 * Tanda tangan diperiksa SEBELUM kedaluwarsa. Urutannya penting: memeriksa
 * kedaluwarsa duluan berarti menjawab pertanyaan tentang isi cookie yang belum
 * terbukti asli.
 */
function readSession(secret, value, now) {
  const raw = String(value || '');
  const at = raw.lastIndexOf('.');
  if (at < 0) return null;

  const payload = raw.slice(0, at);
  const given = raw.slice(at + 1);
  if (!payload.startsWith('v1.')) return null;

  const expectedSignature = sign(secret, payload);
  const a = Buffer.from(given);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const expiresAt = Number(payload.slice(3));
  if (!Number.isFinite(expiresAt) || expiresAt <= (now || Date.now())) return null;
  return { expiresAt };
}

/**
 * Pembatas percobaan login per IP. Jendela geser sederhana di memori.
 *
 * ponytail: cuma berlaku dalam satu proses, dan lupa segalanya waktu server
 * restart. Untuk satu proses melayani 20 orang di LAN itu memadai; kalau suatu saat
 * dijalankan multi-proses, pindahkan hitungannya ke tabel di database.
 */
class RateLimiter {
  constructor(maxAttempts, windowMs) {
    this.maxAttempts = maxAttempts || 5;
    this.windowMs = windowMs || 60 * 1000;
    this.hits = new Map();
  }

  /** @return {boolean} true kalau percobaan ini masih boleh diproses. */
  allow(key, now) {
    const at = now || Date.now();
    const recent = (this.hits.get(key) || []).filter((t) => at - t < this.windowMs);
    recent.push(at);
    this.hits.set(key, recent);

    // Buang IP yang sudah lama diam supaya Map tidak tumbuh selamanya.
    if (this.hits.size > 1000) {
      for (const [k, times] of this.hits) {
        if (!times.some((t) => at - t < this.windowMs)) this.hits.delete(k);
      }
    }
    return recent.length <= this.maxAttempts;
  }

  /** Login berhasil menghapus hitungan, supaya salah ketik tidak menumpuk. */
  reset(key) {
    this.hits.delete(key);
  }
}

/** Sisa waktu tunggu dalam detik, untuk ditampilkan ke pengguna. */
function cookieOptions(secure) {
  return {
    httpOnly: true,                  // JavaScript halaman tidak bisa membacanya
    sameSite: 'lax',                 // tidak ikut terkirim dari situs lain
    secure: Boolean(secure),         // dinyalakan lewat .env begitu ada HTTPS
    maxAge: SESSION_MS,
    path: '/',
  };
}

module.exports = {
  COOKIE_NAME, SESSION_MS,
  hashPassword, verifyPassword,
  createSession, readSession,
  RateLimiter, cookieOptions,
};
