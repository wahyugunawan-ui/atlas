/**
 * Saran padanan nama kelurahan.
 *
 * Murni: tidak menyentuh berkas, database, maupun jaringan. Yang memanggil menyiapkan
 * daftar kandidatnya sendiri — itu yang membuat peringkatnya bisa diuji tanpa PostgreSQL.
 *
 * KENAPA INI ADA. Setelah seluruh Jateng + DIY masuk database berpoligon, baris Excel
 * yang tidak cocok ternyata hampir semuanya varian ejaan dari kelurahan yang SUDAH ada:
 * TEGALREJO/Tegalreja, PABUARAN/Pabuwaran, KEWAYUHAN/Kuwayuhan. Dari 50 nama (165 baris)
 * yang belum cocok, 31 nama (136 baris) punya padanan dekat. Yang dibutuhkan bukan
 * membuat kelurahan baru, tapi menunjuk kelurahan yang sudah ada.
 *
 * BERKAS INI MENYARANKAN, TIDAK MEMUTUSKAN. Hasilnya tidak pernah langsung dipakai
 * impor. Yang masuk indeks pencocokan cuma alias yang sudah dikonfirmasi manusia —
 * aturan proyek yang sama dengan pengelompokan dealer, dan alasannya sama: satu tebakan
 * yang diterima diam-diam akan menempelkan penjualan ke kelurahan yang salah, dan tidak
 * ada satu pun gejala yang muncul di layar.
 *
 * Levenshtein ditulis di sini, bukan memakai ekstensi `fuzzystrmatch` PostgreSQL.
 * Ekstensinya tersedia tapi belum terpasang, dan CREATE EXTENSION butuh superuser —
 * satu langkah pemasangan lagi untuk tim yang tidak punya orang IT.
 */
const { normalizeName } = require('./region');

/**
 * Jarak sunting antara dua teks.
 *
 * Dua baris saja yang disimpan, bukan matriks penuh: kandidatnya bisa ribuan per kota
 * dan matriks 120x120 untuk tiap satu cuma jadi sampah yang harus dibersihkan.
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (unused, i) => i);
  let cur = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const ganti = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      cur[j] = Math.min(ganti, prev[j] + 1, cur[j - 1] + 1);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/**
 * Jarak terjauh yang masih boleh disebut "mirip", menurut panjang namanya.
 *
 * Sepertiga panjang, minimal 2. Bukan angka tetap: jarak 3 pada "REJO" (4 huruf) berarti
 * hampir seluruh katanya berbeda, sementara jarak 3 pada "TAMBAKREJA" (10 huruf) cuma
 * beda ejaan. Batas tetap akan salah di salah satu ujungnya.
 */
function maxDistance(length) {
  return Math.max(2, Math.floor(length / 3));
}

/**
 * Urutkan kelurahan yang paling mungkin dimaksud oleh satu nama dari Excel.
 *
 * Kecamatan yang sama SELALU menang atas jarak yang lebih pendek. Nama kelurahan
 * berulang antar kecamatan di kabupaten yang sama — Cilacap punya dua "Tambakreja" —
 * jadi kandidat berjarak 0 di kecamatan lain hampir pasti kelurahan yang berbeda,
 * sementara kandidat berjarak 2 di kecamatan yang benar hampir pasti yang dicari.
 *
 * @param {string} villageName   nama kelurahan seperti tertulis di Excel
 * @param {string} districtName  nama kecamatan dari baris Excel yang sama
 * @param {Array}  candidates    [{code, name, district, hasGeom}] — sekota, dari database
 * @param {number} limit         berapa saran yang dikembalikan
 * @return {Array} [{code, name, district, hasGeom, distance, sameDistrict}]
 */
function suggestVillages(villageName, districtName, candidates, limit) {
  const target = normalizeName(villageName);
  if (!target) return [];
  const district = normalizeName(districtName);
  const batas = maxDistance(target.length);

  return candidates
    .map((c) => ({
      ...c,
      distance: levenshtein(target, normalizeName(c.name)),
      sameDistrict: normalizeName(c.district) === district,
    }))
    .filter((c) => c.distance <= batas)
    .sort((a, b) =>
      Number(b.sameDistrict) - Number(a.sameDistrict) ||
      a.distance - b.distance ||
      a.name.localeCompare(b.name))
    .slice(0, limit || 5);
}

module.exports = { levenshtein, maxDistance, suggestVillages };
