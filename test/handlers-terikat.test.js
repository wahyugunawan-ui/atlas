/**
 * Tiap nama di HANDLERS harus benar-benar TERIKAT di app.js.
 *
 * KENAPA TES INI ADA. Pada 2026-09-17 `bukaBagianImport` didaftarkan di HANDLERS
 * tapi tidak pernah di-import dari tables.js. `Object.assign(window, HANDLERS)`
 * dievaluasi saat modul dimuat, jadi hasilnya ReferenceError yang mematikan SELURUH
 * halaman — bukan satu tombol. Cacatnya ter-commit dan ter-push, dan 38 berkas tes
 * tetap hijau sepanjang waktu.
 *
 * `test/page.test.js` memeriksa dua arah yang BERBEDA dan keduanya lolos:
 *   - tiap handler yang dipanggil markup harus terdaftar di HANDLERS  (lolos)
 *   - tiap nama terdaftar harus diekspor oleh SUATU modul             (lolos)
 * Yang tidak pernah diperiksa: apakah app.js sendiri menariknya. Itu celahnya, dan
 * celah itu meloloskan cacat yang sama dua kali dalam satu sesi.
 *
 * Pemeriksaannya dua lapis, sengaja. Yang statis menunjuk nama persisnya; yang
 * runtime menangkap SEMUA binding yang tidak teresolusi, bukan cuma yang di HANDLERS.
 * Yang menemukan cacat aslinya adalah yang runtime — pembacaan mata dan penghitung
 * substring justru sempat menyatakan semuanya beres.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const APP = path.join(__dirname, '..', 'frontend', 'js', 'app.js');
const source = fs.readFileSync(APP, 'utf8');

/** Nama yang didaftarkan ke window lewat blok HANDLERS. */
function namaHandlers() {
  const blok = source.match(/const HANDLERS = \{([\s\S]*?)\n\};/);
  assert.ok(blok, 'app.js harus punya blok HANDLERS');
  return [...new Set(blok[1]
    .replace(/\/\/[^\n]*/g, '')          // komentar pengelompokan, bukan nama
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean))];
}

/** Semua nama yang benar-benar terikat di app.js: hasil import, atau dideklarasikan. */
function namaTerikat() {
  const terikat = new Set();

  // import { a, b as c } from '...'
  for (const m of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from/g)) {
    m[1].split(',').forEach((bagian) => {
      const nama = bagian.trim().split(/\s+as\s+/).pop().trim();
      if (nama) terikat.add(nama);
    });
  }
  // import bawaan dan namespace
  for (const m of source.matchAll(/import\s+(\w+)\s*,?\s*(?:\{[\s\S]*?\})?\s*from/g)) {
    terikat.add(m[1]);
  }
  for (const m of source.matchAll(/import\s*\*\s*as\s+(\w+)\s+from/g)) terikat.add(m[1]);

  // dideklarasikan di app.js sendiri
  for (const m of source.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm)) {
    terikat.add(m[1]);
  }
  for (const m of source.matchAll(/^(?:export\s+)?(?:const|let|var)\s+(\w+)/gm)) {
    terikat.add(m[1]);
  }
  return terikat;
}

async function main() {
  // 1. Statis: tiap nama terdaftar harus punya binding di app.js.
  const terikat = namaTerikat();
  const menggantung = namaHandlers().filter((n) => !terikat.has(n));
  assert.deepStrictEqual(menggantung, [],
    'HANDLERS mendaftarkan nama yang TIDAK di-import maupun dideklarasikan di ' +
    `app.js: ${menggantung.join(', ')}. Object.assign(window, HANDLERS) dievaluasi ` +
    'saat modul dimuat, jadi ini ReferenceError yang mematikan seluruh halaman.');

  // 2. Runtime: app.js harus bisa dievaluasi tanpa binding yang menggantung.
  //
  // DOM tiruan seadanya. Yang diuji BUKAN perilaku halaman — cuma apakah modulnya
  // selesai dievaluasi. Kegagalan lain (jaringan, dsb.) sengaja ditoleransi; yang
  // ditolak hanya "is not defined".
  const elemen = {
    style: {},
    hidden: true,
    value: '',
    files: [],
    textContent: '',
    innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    querySelector: () => null,
    addEventListener() {},
    click() {},
    scrollIntoView() {},
    closest: () => null,
    appendChild() {},
    prepend() {},
  };
  globalThis.document = {
    getElementById: () => elemen,
    addEventListener() {},
    createElement: () => elemen,
    querySelectorAll: () => [],
    body: elemen,
  };
  globalThis.window = globalThis;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = () => Promise.reject(new Error('tanpa jaringan di tes'));

  let galat = null;
  try {
    await import(pathToFileURL(APP).href);
  } catch (error) {
    galat = error;
  }

  if (galat && /is not defined/.test(String(galat.message))) {
    assert.fail(`app.js gagal dievaluasi: ${galat.message}. ` +
      'Ada nama yang dipakai tapi tidak pernah di-import.');
  }

  console.log('OK handlers-terikat — tiap nama HANDLERS punya binding di app.js, ' +
    'dan app.js selesai dievaluasi tanpa nama yang menggantung');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
