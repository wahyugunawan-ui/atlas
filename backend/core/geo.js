/**
 * Hitungan bumi yang dipakai bersama: jarak haversine.
 *
 * Dulu rumus ini hidup di dua tempat — `backend/core/coverage.js` (dipakai server)
 * dan `frontend/js/geo.js` (dipakai peta). Dua salinan rumus yang sama adalah dua
 * kesempatan untuk menyimpang diam-diam: yang satu diperbaiki, yang lain tidak, dan
 * tidak ada yang gagal sampai ada orang membandingkan dua angka yang seharusnya sama.
 *
 * Penyatuan penyatuan-tiga-sumber (docs/FUSION.md) menambah pemanggil KETIGA di sisi
 * server — jarak KTP ke titik servis dan ke titik pengiriman. Itu batasnya: rumusnya
 * dipindah ke sini lebih dulu, baru ditambah pemakainya. `coverage.js` sekarang
 * mengambil dari sini dan meneruskannya lagi lewat module.exports, jadi pemanggil
 * lamanya tidak perlu tahu apa pun berubah.
 *
 * Salinan frontend SENGAJA dibiarkan: `frontend/` tidak pernah meng-import dari
 * `backend/`, dan itu batas yang lebih berharga daripada menghapus satu fungsi
 * sepuluh baris. Yang menjaga keduanya tetap sama adalah test/geo.test.js, yang
 * membandingkan hasil kedua salinan pada koordinat yang sama.
 */

/**
 * Jarak haversine dalam METER.
 *
 * Bola berjari-jari 6.371 km, bukan elipsoid. Selisihnya terhadap jarak geodetik
 * sungguhan di bawah 0,5% — jauh di bawah galat yang sudah kita bawa sendiri, karena
 * titik kelurahan yang dipakai adalah centroid desa, bukan alamat orangnya.
 */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { distanceMeters };
