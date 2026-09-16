/**
 * Uji ambang warna status (docs/FUSION.md 2.4).
 *
 * Angka-angka ini yang memutuskan sebuah kota tampil hijau atau merah, dan sebuah
 * dealer disebut "sehat" atau "berisiko". Salahnya diam: tidak ada yang error, cuma
 * satu dealer yang mestinya diperhatikan tampil tenang berwarna hijau.
 *
 * Yang dijaga di sini batas-batasnya — persis di ambang, sepersekian di bawahnya — dan
 * bahwa kedua fungsi memakai KOSAKATA yang berbeda. Keduanya berbentuk sama persis,
 * jadi salin-tempel yang kelewat akan membuat dealer dijawab "solid" alih-alih "sehat".
 */
const assert = require('assert');
const { statusRatio, statusRetention } = require('../backend/server/fusion-store');

// Bawaan yang disemai schema.sql.
const SOLID_MIN = 0.65;
const RAPUH_MAX = 0.50;
const SEHAT_MIN = 0.50;
const RISIKO_MAX = 0.30;

function test() {
  // --- Confidence Ratio: solid / sedang / rapuh ---
  assert.strictEqual(statusRatio(0.80, SOLID_MIN, RAPUH_MAX), 'solid');
  assert.strictEqual(statusRatio(0.65, SOLID_MIN, RAPUH_MAX), 'solid',
    'persis di ambang solid harus SOLID — ambangnya inklusif');
  assert.strictEqual(statusRatio(0.6499, SOLID_MIN, RAPUH_MAX), 'sedang',
    'sepersekian di bawah ambang solid sudah sedang');
  assert.strictEqual(statusRatio(0.50, SOLID_MIN, RAPUH_MAX), 'sedang',
    'persis di batas rapuh masih SEDANG, bukan rapuh');
  assert.strictEqual(statusRatio(0.4999, SOLID_MIN, RAPUH_MAX), 'rapuh');
  assert.strictEqual(statusRatio(0, SOLID_MIN, RAPUH_MAX), 'rapuh');

  // --- Retention Index: sehat / waspada / berisiko ---
  assert.strictEqual(statusRetention(0.72, SEHAT_MIN, RISIKO_MAX), 'sehat');
  assert.strictEqual(statusRetention(0.50, SEHAT_MIN, RISIKO_MAX), 'sehat',
    'persis di ambang sehat harus SEHAT');
  assert.strictEqual(statusRetention(0.4999, SEHAT_MIN, RISIKO_MAX), 'waspada');
  assert.strictEqual(statusRetention(0.30, SEHAT_MIN, RISIKO_MAX), 'waspada',
    'persis di batas berisiko masih WASPADA');
  assert.strictEqual(statusRetention(0.2999, SEHAT_MIN, RISIKO_MAX), 'berisiko');

  // --- kosakata keduanya TIDAK boleh tertukar ---
  const kataRasio = [0.9, 0.6, 0.2].map((r) => statusRatio(r, SOLID_MIN, RAPUH_MAX));
  const kataRetensi = [0.9, 0.4, 0.2].map((r) => statusRetention(r, SEHAT_MIN, RISIKO_MAX));
  assert.deepStrictEqual(kataRasio, ['solid', 'sedang', 'rapuh']);
  assert.deepStrictEqual(kataRetensi, ['sehat', 'waspada', 'berisiko']);
  assert.ok(!kataRetensi.some((k) => kataRasio.includes(k)),
    'kedua fungsi harus memakai kosakata yang benar-benar berbeda');

  // --- belum ada datanya BUKAN nol ---
  // Kota tanpa satu pun pelanggan harus tampil "belum ada data", bukan merah 0%.
  // Menjawab 'rapuh' untuk kota kosong akan menuduh wilayah yang belum diimpor.
  assert.strictEqual(statusRatio(null, SOLID_MIN, RAPUH_MAX), null);
  assert.strictEqual(statusRetention(null, SEHAT_MIN, RISIKO_MAX), null);

  // --- ambang yang dikustom benar-benar dipakai, bukan angka mati di kode ---
  assert.strictEqual(statusRatio(0.55, 0.50, 0.40), 'solid',
    'ambang dari app_config harus menggeser hasilnya');
  assert.strictEqual(statusRatio(0.55, 0.90, 0.60), 'rapuh');

  console.log('OK fusion-status — batas ambang inklusif di sisi yang benar, kosakata ' +
    'rasio dan retensi tidak tertukar, tanpa data bukan nol');
}

test();
