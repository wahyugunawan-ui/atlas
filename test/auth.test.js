/**
 * Uji autentikasi.
 *
 * Ini satu-satunya pintu antara data konsumen dan internet kantor, jadi yang diuji
 * bukan "jalan atau tidak" tapi hal-hal yang gagalnya diam: tanda tangan yang tidak
 * benar-benar diperiksa, kedaluwarsa yang bisa diubah dari browser, perbandingan yang
 * membocorkan waktu.
 */
const assert = require('assert');
const {
  hashPassword, verifyPassword, createSession, readSession, RateLimiter,
  cookieOptions, SESSION_MS,
} = require('../src/server/auth');

const SECRET = 'rahasia-uji-jangan-dipakai-sungguhan';

function test() {
  // --- hash sandi ---
  const stored = hashPassword('sandi rahasia tim channel');
  assert.ok(verifyPassword('sandi rahasia tim channel', stored));
  assert.ok(!verifyPassword('sandi rahasia tim channe', stored), 'kurang satu huruf');
  assert.ok(!verifyPassword('Sandi Rahasia Tim Channel', stored), 'beda kapital');
  assert.ok(!verifyPassword('', stored));

  // Sandi tidak boleh bisa dibaca kembali dari hash-nya.
  assert.ok(!stored.includes('sandi rahasia'), 'sandi tersimpan apa adanya');

  // Salt acak: sandi sama dua kali harus menghasilkan hash berbeda. Kalau tidak,
  // dua sistem dengan sandi sama bisa saling membocorkan lewat tabel pelangi.
  assert.notStrictEqual(hashPassword('sama'), hashPassword('sama'));

  // Hash yang rusak atau dari format lain ditolak, bukan dianggap cocok.
  for (const broken of ['', 'bukan-hash', 'scrypt$1$2$3', 'scrypt$0$0$0$aa$bb',
    stored.replace('scrypt', 'md5')]) {
    assert.ok(!verifyPassword('apa pun', broken), `hash rusak diterima: ${broken}`);
  }

  // --- sesi ---
  const now = 1_760_000_000_000;
  const session = createSession(SECRET, now);
  const read = readSession(SECRET, session, now);
  assert.ok(read, 'sesi yang baru dibuat harus sah');
  assert.strictEqual(read.expiresAt, now + SESSION_MS);

  // Rahasia lain tidak boleh bisa membuka. Ini yang membuat "ganti SESSION_SECRET"
  // menjadi cara mengusir semua orang sekaligus.
  assert.strictEqual(readSession('rahasia-lain', session, now), null);

  // Kedaluwarsa dihormati.
  assert.strictEqual(readSession(SECRET, session, now + SESSION_MS + 1), null,
    'sesi kedaluwarsa masih diterima');
  assert.ok(readSession(SECRET, session, now + SESSION_MS - 1));

  // --- pemalsuan ---
  // Memperpanjang masa berlaku dari sisi browser harus gagal, karena kedaluwarsanya
  // ikut ditandatangani. Ini serangan paling wajar: sesi kedaluwarsa, angkanya diubah.
  const [, expiry, signature] = session.split('.');
  const extended = `v1.${Number(expiry) + 999_999_999}.${signature}`;
  assert.strictEqual(readSession(SECRET, extended, now), null,
    'kedaluwarsa bisa diperpanjang dari browser');

  for (const forged of [
    '',
    'v1.9999999999999',                          // tanpa tanda tangan
    `v1.${expiry}.`,                             // tanda tangan kosong
    `v1.${expiry}.${signature}x`,                // panjang tidak sama
    `v1.${expiry}.${'A'.repeat(signature.length)}`,  // panjang sama, isi salah
    `v2.${expiry}.${signature}`,                 // versi tidak dikenal
    session.replace('v1.', ''),                  // awalan dibuang
    session.toUpperCase(),
  ]) {
    assert.strictEqual(readSession(SECRET, forged, now), null,
      `cookie palsu diterima: ${JSON.stringify(forged)}`);
  }

  // Sesi dari dua waktu berbeda harus berbeda tanda tangannya.
  assert.notStrictEqual(createSession(SECRET, now), createSession(SECRET, now + 1000));

  // --- pembatas percobaan ---
  const limiter = new RateLimiter(5, 60_000);
  const t = 1_000_000;
  for (let i = 1; i <= 5; i++) {
    assert.ok(limiter.allow('10.0.0.1', t), `percobaan ke-${i} harusnya masih boleh`);
  }
  assert.ok(!limiter.allow('10.0.0.1', t), 'percobaan ke-6 harus ditolak');

  // IP lain tidak ikut terkunci.
  assert.ok(limiter.allow('10.0.0.2', t), 'satu IP mengunci IP lain');

  // Jendela geser: setelah lewat satu menit, boleh lagi.
  assert.ok(limiter.allow('10.0.0.1', t + 60_001), 'jendela tidak pernah bergeser');

  // Login berhasil menghapus hitungan, supaya salah ketik beberapa kali tidak
  // menyisakan kuota yang habis.
  const fresh = new RateLimiter(2, 60_000);
  fresh.allow('10.0.0.3', t);
  fresh.allow('10.0.0.3', t);
  assert.ok(!fresh.allow('10.0.0.3', t));
  fresh.reset('10.0.0.3');
  assert.ok(fresh.allow('10.0.0.3', t), 'reset setelah login berhasil tidak bekerja');

  // --- opsi cookie ---
  const plain = cookieOptions(false);
  assert.strictEqual(plain.httpOnly, true,
    'cookie sesi harus httpOnly, kalau tidak skrip halaman bisa membacanya');
  assert.strictEqual(plain.sameSite, 'lax');
  assert.strictEqual(plain.secure, false, 'di LAN tanpa HTTPS, secure harus mati');
  assert.strictEqual(cookieOptions(true).secure, true,
    'flag secure harus bisa dinyalakan lewat konfigurasi, bukan diubah di kode');

  // --- perbandingan harus timing-safe ---
  //
  // Ini satu-satunya pemeriksaan sumber di seluruh proyek, dan itu disengaja.
  // Mengganti timingSafeEqual dengan '!==' menolak pemalsuan yang sama persis, jadi
  // TIDAK ADA tes perilaku yang bisa membedakannya — yang bocor cuma waktu, dan
  // waktu itulah yang membiarkan tanda tangan ditebak byte demi byte.
  //
  // Pemeriksaan sumber memang rapuh. Dipakai di sini karena alternatifnya bukan
  // pemeriksaan yang lebih baik, melainkan tidak ada pemeriksaan sama sekali.
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'server', 'auth.js'), 'utf8');
  const body = source.slice(source.indexOf('function readSession'));
  assert.ok(body.includes('timingSafeEqual'),
    'readSession harus membandingkan tanda tangan dengan crypto.timingSafeEqual');
  assert.ok(!/given\s*[!=]==\s*expectedSignature/.test(body),
    'tanda tangan dibandingkan dengan operator biasa — waktunya bocor');

  console.log('OK auth — scrypt bersalt, tanda tangan sesi tahan pemalsuan, ' +
    'kedaluwarsa tidak bisa diperpanjang, pembatas per IP bekerja, perbandingan timing-safe');
}

test();
