/**
 * Dua salinan daftar golongan harus tetap sama.
 *
 * `backend/core/fusion.js` memutuskan golongan dan bobotnya; `frontend/js/fusion-segments.js`
 * menggambarnya. Keduanya SENGAJA salinan terpisah — aturan proyek: `frontend/` tidak
 * pernah meng-import dari `backend/`, dan batas itu lebih berharga daripada menghapus
 * enam baris. Yang menjaga keduanya tidak menyimpang adalah tes ini, bukan disiplin
 * orang. Pola yang sama dipakai untuk dua salinan haversine di test/geo.test.js.
 *
 * Yang dibandingkan: kode golongannya, nama resminya, dan BOBOTNYA. Bobot yang
 * menyimpang adalah yang paling berbahaya — CW Sales di layar akan berbeda dari CW
 * Sales yang tersimpan di database, dan tidak ada satu pun yang terlihat salah.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { SEGMENTS: belakang } = require('../backend/core/fusion');

async function test() {
  const source = pathToFileURL(
    path.join(__dirname, '..', 'frontend', 'js', 'fusion-segments.js')).href;
  const { SEGMENTS: depan, SUMBER } = await import(source);

  const kodeBelakang = Object.keys(belakang).sort();
  const kodeDepan = Object.keys(depan).sort();
  assert.deepStrictEqual(kodeDepan, kodeBelakang,
    'daftar kode golongan frontend dan backend sudah berbeda');

  kodeBelakang.forEach((kode) => {
    assert.strictEqual(depan[kode].label, belakang[kode].label,
      `nama resmi ${kode} berbeda antara frontend dan backend`);
    assert.strictEqual(depan[kode].weight, belakang[kode].weight,
      `BOBOT ${kode} berbeda — CW Sales di layar tidak akan sama dengan yang tersimpan`);
    assert.ok(depan[kode].short, `${kode} belum punya label pendek untuk layar sempit`);
    assert.ok(/^#[0-9A-Fa-f]{6}$/.test(depan[kode].color),
      `${kode} belum punya warna yang sah`);
  });

  // Warna harus BEDA satu sama lain: dua golongan sewarna membuat stacked bar dan
  // heatmap mustahil dibaca, dan itu tidak akan memunculkan error apa pun.
  const warna = kodeDepan.map((k) => depan[k].color.toUpperCase());
  assert.strictEqual(new Set(warna).size, warna.length,
    'ada dua golongan yang warnanya kembar');

  // Tiga warna sumber (Venn) juga tidak boleh kembar satu sama lain.
  const warnaSumber = Object.values(SUMBER).map((s) => s.color.toUpperCase());
  assert.strictEqual(new Set(warnaSumber).size, warnaSumber.length,
    'warna sumber data (Kirim/Servis/KTP) ada yang kembar');

  console.log(`OK fusion-segments — ${kodeDepan.length} golongan sama persis di ` +
    'frontend dan backend (kode, nama, bobot), warna tidak ada yang kembar');
}

test();
