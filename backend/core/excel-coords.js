/**
 * Bantuan baca sel Excel: koordinat gabungan satu sel dan sel formula ExcelJS.
 *
 * Murni: tidak menyentuh berkas maupun database. Dipakai scripts/fill-pos-coordinates.js
 * dan scripts/import-dealer-pos-rings.js — sebelumnya digandakan di keduanya.
 */

/**
 * Ambil nilai sungguhan satu sel ExcelJS, apa pun bentuknya: sel formula
 * ({formula, result} — ambil .result), sel rich-text/hyperlink ({text,
 * hyperlink, ...} — ambil .text), atau nilai polos (dikembalikan apa adanya).
 *
 * Dua bentuk objek ini gampang tertukar kalau cuma satu yang ditangani: sel
 * formula yang tidak dibuka lewat `.result` jadi "[object Object]" secara
 * diam-diam kalau cuma `String(value)` yang dipanggil — pernah terjadi di
 * backend/server/importer.js readXlsx(), yang dulu cuma membuka rich-text dan
 * menulis "[object Object]" ke database untuk setiap kolom hasil VLOOKUP
 * (lihat docs/DECISIONS.md).
 */
function cellText(value) {
  if (value && typeof value === 'object') {
    if ('result' in value) return value.result;
    if (value.text !== undefined) return value.text;
  }
  return value;
}

/**
 * "−7.800178631152708, 110.35219737379508" -> {lat, lng}. Longgar dengan sengaja:
 * beberapa baris di sumber diawali tanda baca liar (";-7.51..., 109.29...") —
 * mengekstrak DUA angka desimal pertama yang dipisah koma tetap menemukan pasangan
 * yang benar tanpa perlu tahu bentuk kerusakannya duluan.
 */
function parseLongLat(raw) {
  const teks = String(raw == null ? '' : raw).trim();
  const cocok = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(teks);
  if (!cocok) return null;
  const lat = Number(cocok[1]);
  const lng = Number(cocok[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

module.exports = { cellText, parseLongLat };
