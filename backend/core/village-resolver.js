/**
 * Nama desa dari Excel -> kode wilayah BPS. MURNI: tidak menyentuh berkas, database,
 * maupun jaringan. Yang memanggil menyiapkan indeks dan daftar kandidatnya sendiri —
 * itu yang membuat seluruh tabel keputusan di bawah bisa diuji tanpa PostgreSQL.
 *
 * KENAPA ADA, padahal importer penjualan sudah melakukannya. Importer memetakan
 * ribuan baris sekaligus dan cuma peduli "cocok atau tidak" — hasilnya satu kode atau
 * masuk daftar `unmatched`. Penyatuan tiga sumber (docs/FUSION.md) butuh yang lebih
 * halus: ia harus tahu BAGAIMANA sebuah baris cocok, karena itulah yang membedakan
 * pelanggan yang lokasinya kita yakini dari yang cuma kita tebak. Empat status di
 * bawah inilah yang kelak jadi bahan golongan "Tak Terverifikasi".
 *
 * Empat status:
 *
 *   ok        nama cocok persis pada kunci tiga tingkat (kota|kecamatan|desa)
 *   alias     cocok lewat alias yang sudah DIKONFIRMASI MANUSIA
 *   fuzzy     tidak cocok persis, tapi ada satu padanan dekat yang tidak ambigu
 *   unmatched tidak ada padanan, atau padanannya lebih dari satu dan sama kuat
 */
const { regionKey } = require('./region');
const { suggestVillages } = require('./matching');

/**
 * Indeks pencocokan tiga tingkat: `regionKey` -> {code, source}.
 *
 * Alias ditimpakan SESUDAH indeks asli, bukan sebelum — sama seperti di importer
 * penjualan. Kalau sebuah nama belakangan ternyata juga cocok apa adanya, alias yang
 * dikonfirmasi orang tetap menang: dia keputusan, bukan kebetulan.
 *
 * `source` disimpan, bukan cuma kodenya, supaya pemanggil bisa membedakan 'ok' dari
 * 'alias'. Bedanya penting waktu menelusuri angka yang mencurigakan: satu cocok
 * karena datanya memang rapi, satunya cocok karena ada orang yang pernah
 * memperbaikinya.
 *
 * @param {Array} villages [{code, name, district, cityCode}]
 * @param {Array} aliases  [{villageCode, villageName, districtName, cityCode}]
 */
function buildVillageIndex(villages, aliases) {
  const index = {};
  (villages || []).forEach((v) => {
    index[regionKey(v.cityCode, v.district, v.name)] = { code: v.code, source: 'villages' };
  });
  (aliases || []).forEach((a) => {
    index[regionKey(a.cityCode, a.districtName, a.villageName)] =
      { code: a.villageCode, source: 'alias' };
  });
  return index;
}

/**
 * Dua usulan teratas sama kuatnya?
 *
 * `suggestVillages` sudah mengurutkan kecamatan-sama dulu, baru jarak ejaan. Jadi dua
 * teratas "seri" kalau keduanya sama-sama di kecamatan yang sama (atau sama-sama
 * tidak) DAN jarak ejaannya sama persis — tidak ada satu pun alasan tersisa untuk
 * memilih salah satunya.
 */
function ambiguous(suggestions) {
  if (suggestions.length < 2) return false;
  const [a, b] = suggestions;
  return a.sameDistrict === b.sameDistrict && a.distance === b.distance;
}

/**
 * Selesaikan satu nama jadi satu kode wilayah.
 *
 * TEBAKAN YANG AMBIGU TIDAK PERNAH DIPAKAI. Kalau dua kandidat sama kuat, hasilnya
 * `unmatched` berikut usulannya — bukan salah satu yang dipilih diam-diam. Aturan ini
 * diwarisi dari impor penjualan, dan alasannya lebih keras lagi di sini: kode desa yang
 * salah menggeser titik pelanggan, dan titik yang bergeser menggeser golongannya tanpa
 * satu pun gejala di layar.
 *
 * Yang BERBEDA dari impor penjualan: padanan dekat yang TIDAK ambigu di sini dipakai
 * (status 'fuzzy'), sementara impor penjualan menolak semuanya sampai ada manusia yang
 * mengonfirmasi. Bedanya disengaja — sumber KTP dan Servis datang tiap bulan dengan
 * ribuan baris, dan meminta konfirmasi manual atas tiap varian ejaan yang sudah jelas
 * (TEGALREJO vs Tegalreja) berarti fiturnya tidak akan pernah dipakai oleh tim yang
 * tidak punya orang IT. Statusnya dicatat, jadi yang dipakai selalu bisa ditelusuri
 * dan dikoreksi belakangan lewat alias.
 *
 * @param {Object} input      {cityCode, districtName, villageName}
 * @param {Object} index      hasil buildVillageIndex()
 * @param {Array}  candidates [{code, name, district, ...}] — sekota, untuk fuzzy
 * @return {Object} {villageCode, status, suggestions}
 */
function resolveVillage(input, index, candidates) {
  const hit = index[regionKey(input.cityCode, input.districtName, input.villageName)];
  if (hit) {
    return {
      villageCode: hit.code,
      status: hit.source === 'alias' ? 'alias' : 'ok',
      suggestions: [],
    };
  }

  const suggestions = suggestVillages(
    input.villageName, input.districtName, candidates || [], 5);

  if (suggestions.length && !ambiguous(suggestions)) {
    return { villageCode: suggestions[0].code, status: 'fuzzy', suggestions };
  }
  return { villageCode: null, status: 'unmatched', suggestions };
}

module.exports = { buildVillageIndex, resolveVillage, ambiguous };
