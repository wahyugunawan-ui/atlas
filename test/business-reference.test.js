/**
 * Uji nilai konfigurasi `businessReferencePercent`.
 *
 * Murni tentang config.js, tanpa database: default 1% kalau `.env`/env var tidak
 * menyebutnya, dan nilai kustom dari env var terbawa masuk. Kewajiban summary()
 * benar-benar MENGIRIM nilai ini ke frontend diuji terpisah di
 * test/coverage-store.test.js, yang sudah membuka database — menduplikasi bukaan
 * database di sini cuma untuk satu field tidak sepadan.
 */
const assert = require('assert');

const CONFIG_PATH = require.resolve('../backend/server/config');

/** config.js membaca process.env sekali waktu di-require — muat ulang dari nol. */
function freshConfig() {
  delete require.cache[CONFIG_PATH];
  return require('../backend/server/config').config;
}

function test() {
  const asli = process.env.BUSINESS_REFERENCE_PERCENT;
  try {
    delete process.env.BUSINESS_REFERENCE_PERCENT;
    assert.strictEqual(freshConfig().businessReferencePercent, 1,
      'default businessReferencePercent bukan 1% waktu env var tidak diisi');

    process.env.BUSINESS_REFERENCE_PERCENT = '1.5';
    assert.strictEqual(freshConfig().businessReferencePercent, 1.5,
      'nilai kustom dari BUSINESS_REFERENCE_PERCENT tidak terbawa ke config');

    process.env.BUSINESS_REFERENCE_PERCENT = '0';
    assert.strictEqual(freshConfig().businessReferencePercent, 1,
      '"0" seharusnya jatuh ke default 1 (Number(\'0\') falsy lolos ke || 1), ' +
      'bukan tersimpan sebagai 0% -- 0% berarti tidak ada acuan sama sekali, ' +
      'bukan pengaturan yang masuk akal untuk dipilih diam-diam');

    console.log('OK business-reference — default 1% tanpa env var, nilai kustom ' +
      'terbawa, "0" jatuh ke default');
  } finally {
    if (asli === undefined) delete process.env.BUSINESS_REFERENCE_PERCENT;
    else process.env.BUSINESS_REFERENCE_PERCENT = asli;
    delete require.cache[CONFIG_PATH];
  }
}

test();
