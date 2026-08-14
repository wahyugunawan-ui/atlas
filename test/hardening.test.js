/**
 * Uji pengerasan operasional: retensi arsip PII, catatan log, dan peringatan rahasia
 * yang tersimpan di folder tersinkron.
 *
 * Ketiganya punya sifat yang sama: kalau rusak, TIDAK ADA yang gagal. Arsip PII cuma
 * menumpuk diam-diam, log cuma hilang, dan rahasia cuma naik ke cloud tanpa ada yang
 * menyadarinya. Justru karena itu ketiganya butuh tes — tidak ada gejala yang akan
 * memberi tahu.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { pruneUploads, UPLOAD_KEEP_DAYS } = require('../src/server/routes');
const logger = require('../src/server/logger');
const { validate } = require('../src/server/config');

const HARI = 24 * 60 * 60 * 1000;

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `acc-${label}-`));
}

/** Buat berkas dengan waktu ubah yang dimundurkan sekian hari. */
function fileAged(dir, name, days) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'isi');
  const when = new Date(Date.now() - days * HARI);
  fs.utimesSync(file, when, when);
  return file;
}

function testRetensiArsip() {
  const dir = tempDir('uploads');
  try {
    fileAged(dir, '2026-01-lama.csv', UPLOAD_KEEP_DAYS + 5);
    fileAged(dir, '2026-05-tepat-batas.csv', UPLOAD_KEEP_DAYS - 1);
    fileAged(dir, '2026-08-baru.xlsx', 1);

    const dibuang = pruneUploads(dir);
    const tersisa = fs.readdirSync(dir).sort();

    assert.strictEqual(dibuang, 1, 'jumlah yang dibuang salah');
    assert.deepStrictEqual(tersisa, ['2026-05-tepat-batas.csv', '2026-08-baru.xlsx'],
      'yang dibuang bukan yang paling tua, atau yang masih berlaku ikut terbuang');

    // Dijalankan dua kali tidak boleh membuang apa pun lagi.
    assert.strictEqual(pruneUploads(dir), 0, 'jalan kedua ikut membuang yang masih berlaku');

    // Folder yang tidak ada bukan error — impor pertama terjadi sebelum foldernya ada.
    assert.strictEqual(pruneUploads(path.join(dir, 'tidak-ada')), 0,
      'folder yang belum ada seharusnya dilewati, bukan melempar error');

    console.log('  retensi arsip : 1 dari 3 dibuang, idempoten, folder hilang aman');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testLog() {
  const dir = tempDir('log');
  try {
    const hasil = logger.start({ dataDir: dir });

    // Yang dijaga: console yang SUDAH ADA di seluruh kode ikut tercatat tanpa
    // disentuh. Kalau logger memakai API sendiri, 17 titik panggil yang ada sekarang
    // akan diam-diam tidak tercatat.
    console.log('halo dari tes');
    console.error('galat dari tes');
    logger.stop();

    const isi = fs.readFileSync(hasil.file, 'utf8');
    assert.ok(isi.includes('halo dari tes'), 'console.log tidak tercatat ke berkas');
    assert.ok(isi.includes('galat dari tes'), 'console.error tidak tercatat ke berkas');
    assert.ok(/ERROR/.test(isi), 'tingkat galat tidak dibedakan di catatan');
    assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /m.test(isi),
      'baris log tanpa waktu — tidak berguna untuk menelusuri "kemarin sore"');

    // console harus kembali seperti semula, kalau tidak tes lain ikut tercemar.
    assert.strictEqual(typeof console.log, 'function');
    const bersih = fs.readFileSync(hasil.file, 'utf8');
    console.log('');
    assert.strictEqual(fs.readFileSync(hasil.file, 'utf8'), bersih,
      'logger.stop() tidak melepas sadapan console');

    console.log('  catatan log   : console tersadap, waktu tercatat, sadapan dilepas');
  } finally {
    logger.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testLogRetensi() {
  const dir = tempDir('log-retensi');
  try {
    const logs = path.join(dir, 'logs');
    fs.mkdirSync(logs, { recursive: true });

    const lama = new Date(Date.now() - (logger.KEEP_DAYS + 5) * HARI)
      .toISOString().slice(0, 10);
    const baru = new Date(Date.now() - 2 * HARI).toISOString().slice(0, 10);
    fs.writeFileSync(path.join(logs, `server-${lama}.log`), 'lama');
    fs.writeFileSync(path.join(logs, `server-${baru}.log`), 'baru');
    // Berkas yang bukan log tidak boleh disentuh sama sekali — dan umpannya SENGAJA
    // memuat tanggal yang sudah lama. Kalau namanya tidak bertanggal, pola yang
    // terlalu longgar pun akan melewatinya, dan tesnya hijau tanpa menjaga apa pun.
    fs.writeFileSync(path.join(logs, 'laporan-2020-01-01.txt'), 'jangan dihapus');
    fs.writeFileSync(path.join(logs, `server-${lama}.log.bak`), 'jangan dihapus');

    const hasil = logger.start({ dataDir: dir });
    logger.stop();

    const tersisa = fs.readdirSync(logs);
    assert.strictEqual(hasil.pruned, 1, 'jumlah log lama yang dibuang salah');
    assert.ok(!tersisa.includes(`server-${lama}.log`), 'log lama tidak dibuang');
    assert.ok(tersisa.includes(`server-${baru}.log`), 'log yang masih berlaku ikut dibuang');
    assert.ok(tersisa.includes('laporan-2020-01-01.txt'),
      'berkas bertanggal yang BUKAN log ikut dihapus — polanya terlalu longgar');
    assert.ok(tersisa.includes(`server-${lama}.log.bak`),
      'berkas .bak ikut dihapus — pola tidak berlabuh di akhir nama');

    console.log(`  retensi log   : 1 dibuang di atas ${logger.KEEP_DAYS} hari, ` +
      'berkas lain aman');
  } finally {
    logger.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testPeringatanRahasia() {
  // validate() membaca config yang sudah dimuat, jadi yang diuji di sini bentuk
  // keluarannya: dua daftar terpisah. Menggabungkan keduanya jadi satu berarti
  // peringatan ikut menolak start, dan orang akan mencari cara mematikannya.
  const hasil = validate();
  assert.ok(Array.isArray(hasil.problems), 'validate() tidak mengembalikan problems');
  assert.ok(Array.isArray(hasil.warnings), 'validate() tidak mengembalikan warnings');

  // Rahasia di folder tersinkron harus jadi PERINGATAN, bukan penolakan start:
  // servernya memang jalan, cuma tidak aman, dan menolak start akan membuat orang
  // memindahkan .env ke tempat yang lebih buruk demi bisa jalan.
  const semua = hasil.problems.concat(hasil.warnings).join(' ');
  if (/onedrive|google drive|dropbox/i.test(semua)) {
    assert.ok(hasil.warnings.some((w) => /onedrive|google drive|dropbox/i.test(w)),
      'rahasia di folder tersinkron seharusnya peringatan, bukan penolakan start');
  }

  console.log('  peringatan    : problems dan warnings terpisah');
}

testRetensiArsip();
testLog();
testLogRetensi();
testPeringatanRahasia();
console.log('OK hardening — retensi arsip PII, catatan log berotasi, peringatan terpisah');
