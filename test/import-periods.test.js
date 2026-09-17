/**
 * Checklist jenis data per periode di halaman Import.
 *
 * Yang dijaga: TIGA keadaan tidak boleh menciut jadi dua. "Tidak bisa diperiksa"
 * (database PII tidak ada) berbeda dari "diperiksa, memang kosong" — dan kalau
 * keduanya tampil sama, orang bisa mengimpor ulang sebulan penuh karena mengira
 * datanya hilang.
 */
const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODUL = pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'js', 'import-periods.js')).href;

test('tiga keadaan dibedakan: ada, kosong, tak diketahui', async () => {
  const { statusJenis } = await import(MODUL);
  assert.strictEqual(statusJenis(19598), 'ada');
  assert.strictEqual(statusJenis(0), 'kosong');
  // null datang dari server waktu database PII tidak tersedia.
  assert.strictEqual(statusJenis(null), 'tak-diketahui');
  assert.strictEqual(statusJenis(undefined), 'tak-diketahui');
});

test('checklist memakai angka sungguhan, bukan sekadar tanda centang', async () => {
  const { checklistPeriode } = await import(MODUL);
  const hasil = checklistPeriode({
    period: '2026-08', units: 10019, ktpRows: 19598, servisRows: 186471,
  });
  assert.deepStrictEqual(hasil.map((x) => x.kunci), ['sales', 'ktp', 'servis']);
  assert.deepStrictEqual(hasil.map((x) => x.status), ['ada', 'ada', 'ada']);
  assert.deepStrictEqual(hasil.map((x) => x.jumlah), [10019, 19598, 186471]);
});

test('periode yang hanya punya KTP tetap terbaca benar', async () => {
  const { checklistPeriode } = await import(MODUL);
  // Bisa terjadi: Data KTP bulan ini sudah diimpor, penjualannya belum.
  const hasil = checklistPeriode({ period: '2026-09', units: 0, ktpRows: 120, servisRows: 0 });
  assert.deepStrictEqual(hasil.map((x) => x.status), ['kosong', 'ada', 'kosong']);
});

test('database PII tidak ada: jumlahnya null, bukan nol', async () => {
  const { checklistPeriode } = await import(MODUL);
  const hasil = checklistPeriode({ period: '2026-08', units: 10019, ktpRows: null, servisRows: null });
  assert.deepStrictEqual(hasil.map((x) => x.status), ['ada', 'tak-diketahui', 'tak-diketahui']);
  // Jumlahnya TIDAK boleh jadi 0 — angka nol di layar adalah pernyataan yang salah.
  assert.strictEqual(hasil[1].jumlah, null);
  assert.strictEqual(hasil[2].jumlah, null);
});

test('ringkasan tidak mencampur "tidak diketahui" ke dalam pecahan', async () => {
  const { checklistPeriode, ringkasChecklist } = await import(MODUL);
  // 1 ada + 2 tak diketahui. "1 dari 3" akan berbohong: penyebutnya memuat dua hal
  // yang tidak pernah diperiksa.
  const sebagian = ringkasChecklist(checklistPeriode(
    { units: 10019, ktpRows: null, servisRows: null }));
  assert.match(sebagian, /1 dari 1 jenis data tersimpan/);
  assert.match(sebagian, /2 tidak bisa diperiksa/);

  const lengkap = ringkasChecklist(checklistPeriode(
    { units: 10019, ktpRows: 19598, servisRows: 0 }));
  assert.strictEqual(lengkap, '2 dari 3 jenis data tersimpan');
});

test('ringkasan waktu tidak ada satu pun yang bisa diperiksa', async () => {
  const { checklistPeriode, ringkasChecklist } = await import(MODUL);
  const hasil = checklistPeriode({ units: null, ktpRows: null, servisRows: null });
  assert.strictEqual(ringkasChecklist(hasil), 'Tidak bisa diperiksa.');
});
