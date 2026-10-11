/**
 * Dua subhalaman Data: membedakan GAGAL dari KOSONG.
 *
 * KENAPA TES INI ADA. Sampai 2026-09-17 kedua subhalaman menampilkan apa pun yang
 * gagal sebagai satu baris merah kecil. Database PII yang tidak terhubung, galat
 * server, dan jaringan putus terlihat persis sama — padahal yang pertama BUKAN
 * kerusakan: aturan proyek menuntut `DROP DATABASE astra_customers` meninggalkan sisa
 * aplikasi jalan penuh. Orang yang melihat baris merah itu tidak punya cara tahu
 * apakah ada yang perlu diperbaiki, dan itulah keluhan "halaman servis kosong".
 *
 * Kebalikannya juga: sejak bilah filter dipakai BERSAMA antar halaman, memilih Kota di
 * Sales Analytics ikut mempersempit kedua tabel ini. Tabel yang mendadak kosong lalu
 * terbaca sebagai "datanya hilang", padahal saringannya dipasang di halaman lain.
 *
 * Diuji lewat fungsi yang SUNGGUHAN dipakai halaman, bukan salinan logikanya —
 * mengikuti fusion-cakupan.test.js dan aturan di CLAUDE.md. Saringannya digerakkan
 * lewat setScope(), API yang sama dengan yang dipakai bilah filter, bukan dengan
 * menyentuh bentuk variabel di dalam state.
 */
const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// fusion.js menyentuh DOM lewat $(). Stub seadanya, sama seperti fusion-cakupan.test.js.
globalThis.document = { getElementById: () => null };

// setScope() memanggil penyegar tampilan lewat `window` — pola yang memang dipakai
// proyek ini untuk menghindari lingkaran impor (lihat catatan di filters.js dan di blok
// HANDLERS app.js). Di Node `window` tidak ada, jadi tanpa stub ini setScope melempar
// ReferenceError SEBELUM sempat mengubah saringan apa pun, dan tesnya merah karena
// alasan yang tidak ada hubungannya dengan yang sedang diuji.
//
// Proxy, bukan daftar nama yang ditulis satu per satu: yang diuji di berkas ini BUKAN
// siapa saja yang dipanggil setScope. Daftar nama membuat tes ini ikut merah tiap kali
// ada penyegar baru ditambahkan di tempat lain — merah yang tidak menandakan apa pun.
globalThis.window = new Proxy({}, { get: () => () => {} });

const modul = (nama) => pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'js', nama)).href;

/**
 * Kosongkan saringan kota.
 *
 * 'ALL' memang nilai sah untuk lingkup ini — mode LIVE memutar melewatinya tiap
 * putaran (lihat kotaBerikutnya di filters.js), jadi ini API yang benar-benar dipakai
 * halaman, bukan jalan pintas khusus tes. `force` supaya tidak bersifat toggle.
 */
async function bersihkanSaringan() {
  const f = await import(modul('filters.js'));
  f.setScope('kota', 'ALL', true);
}

test('database PII mati dijelaskan sebagai keadaan yang sah, bukan kerusakan', async () => {
  const m = await import(modul('fusion.js'));
  const html = m.panelGagal(new Error('Database konsumen tidak tersedia.'));

  assert.match(html, /tidak terhubung/i,
    'penyebabnya harus disebut, bukan cuma pesan mentah dari server');
  assert.match(html, /astra_customers/,
    'nama databasenya disebut supaya yang membaca tahu apa yang harus dinyalakan');
  assert.match(html, /jalan penuh/,
    'wajib dikatakan bahwa sisa aplikasi TIDAK ikut rusak — itu sifat yang dijanjikan ' +
    'aturan proyek, dan tanpa kalimat ini orang akan mengira seluruh aplikasi mati');
  assert.ok(!/Gagal memuat/.test(html),
    'keadaan sah ini tidak boleh memakai kata-kata kegagalan yang sama dengan galat server');
});

test('galat lain tetap ditampilkan apa adanya, dan dibedakan dari "tidak ada data"', async () => {
  const m = await import(modul('fusion.js'));
  const html = m.panelGagal(new Error('relation "service_visit" does not exist'));

  assert.match(html, /Gagal memuat/, 'galat sungguhan harus terbaca sebagai kegagalan');
  assert.match(html, /service_visit/, 'pesan aslinya tidak boleh ditelan');
  assert.match(html, /bukan "tidak ada data"/,
    'bedanya dengan tabel kosong wajib dikatakan; itu seluruh alasan panel ini ada');
});

test('pesan galat di-escape sebelum masuk innerHTML', async () => {
  const m = await import(modul('fusion.js'));
  // Pesan galat bisa memuat teks dari sumber yang tidak dipercaya (nama berkas Excel,
  // isi kolom). Aturan proyek: escape SEMUA nilai sebelum innerHTML.
  const html = m.panelGagal(new Error('<img src=x onerror=alert(1)>'));

  assert.ok(!html.includes('<img'),
    'tag mentah dari pesan galat lolos ke innerHTML — itu jalan masuk skrip asing');
  assert.match(html, /&lt;img/, 'pesannya tetap ditampilkan, tapi sudah di-escape');
});

test('tanpa saringan aktif, tidak ada keterangan saringan sama sekali', async () => {
  const m = await import(modul('fusion.js'));
  await bersihkanSaringan();

  assert.strictEqual(m.catatanKosongSaringan(), '',
    'keterangan "kosong karena saringan" yang muncul waktu tidak ada saringan justru ' +
    'menyesatkan: orang akan mencari saringan yang harus dikosongkan dan tidak menemukannya');
  await bersihkanSaringan();
});

test('saringan kota aktif: dikatakan, berikut cara mengosongkannya', async () => {
  const m = await import(modul('fusion.js'));
  const f = await import(modul('filters.js'));
  await bersihkanSaringan();

  f.setScope('kota', '34.04', true);
  const html = m.catatanKosongSaringan();

  assert.match(html, /Kota/, 'saringan yang sedang berlaku harus disebut namanya');
  assert.match(html, /reset/i, 'cara mengosongkannya ikut disebut, bukan cuma masalahnya');
  assert.match(html, /bukan karena gagal/,
    'inti keterangannya: kosong di sini BUKAN kegagalan');

  // Dealer dan Pos memang TIDAK dikirim saringSumber() ke rutenya. Menyebut keduanya
  // sebagai saringan aktif akan membuat orang mengosongkan saringan yang sejak awal
  // tidak berpengaruh di halaman ini — dan tabelnya tetap kosong.
  assert.match(html, /Periode, Dealer, dan Pos tidak berpengaruh/,
    'harus dikatakan bahwa Periode, Dealer, dan Pos tidak menyaring halaman ini');

  await bersihkanSaringan();
  assert.strictEqual(m.catatanKosongSaringan(), '',
    'saringan bocor antar tes; hasil tes berikutnya jadi tidak bisa dipercaya');
});

test('periode (Dari–Sampai) TIDAK menyaring Servis dan Pengiriman, hanya data KTP', async () => {
  const m = await import(modul('fusion.js'));
  const f = await import(modul('filters.js'));
  await bersihkanSaringan();

  // Permintaan 2026-10-11: rentang tanggal hanya untuk data KTP. Servis dan Pengiriman
  // selalu tampil seluruhnya, jadi saringSumber() tidak boleh lagi mengirim periode.
  f.setPeriod('from', '2026-08');
  f.setPeriod('to', '2026-08');
  const q = m.saringSumber(0, null);
  assert.strictEqual('periodFrom' in q, false, 'periodFrom masih dikirim ke Servis/Pengiriman');
  assert.strictEqual('periodTo' in q, false, 'periodTo masih dikirim ke Servis/Pengiriman');

  // Dan keterangan "kosong karena saringan" tidak menyalahkan periode yang tidak berlaku.
  assert.strictEqual(m.catatanKosongSaringan(), '',
    'periode disebut sebagai saringan aktif di halaman yang tidak memakainya');

  // Saringan yang MEMANG berlaku di halaman ini (kota) tetap terkirim.
  f.setScope('kota', '34.04', true);
  assert.strictEqual(m.saringSumber(0, null).city, '34.04', 'saringan kota ikut hilang');

  await bersihkanSaringan();
});
