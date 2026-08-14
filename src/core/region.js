/**
 * Normalisasi dan pencocokan wilayah.
 *
 * Semua di sini murni: tidak menyentuh berkas, database, maupun jaringan. Itu yang
 * membuat fungsi yang sama bisa dipakai server, CLI, dan tes tanpa duplikasi.
 *
 * Kode wilayah selalu format BPS/Kemendagri bertitik: '34.04' untuk kabupaten/kota,
 * '34.04.01.2001' untuk kelurahan. JANGAN pernah menurunkan kode dari nama.
 */

/** 'Kali Wungu' / 'KALIWUNGU' -> 'KALIWUNGU'. Menyamakan ejaan antar berkas Excel. */
function normalizeName(value) {
  return String(value == null ? '' : value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** '3404' / '34.04' / '34.04.01.2001' -> '34.04'. Sama persis dengan build.py. */
function toDottedCityCode(value) {
  const digits = String(value == null ? '' : value).replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? digits.slice(0, 2) + '.' + digits.slice(2) : digits;
}

/**
 * Kunci pencocokan tiga tingkat: kota -> kecamatan -> kelurahan.
 *
 * Dua tingkat TIDAK cukup. Diuji atas 3.466 kelurahan cakupan: 'kode_kota + nama'
 * tabrakan di 171 tempat (Cilacap punya dua "Tambakreja"), tiga tingkat nol tabrakan.
 */
function regionKey(cityCode, districtName, villageName) {
  return toDottedCityCode(cityCode) + '|' + normalizeName(districtName) + '|' +
    normalizeName(villageName);
}

module.exports = { normalizeName, toDottedCityCode, regionKey };
