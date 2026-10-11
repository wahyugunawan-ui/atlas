/**
 * Isi `dealers.city_code` dan `dealers.district_code` dari kolom "Kabupaten" dan
 * "Kecamatan" Excel Dealer & POS, TANPA menyentuh yang lain:
 * `npm run backfill-dealer-city -- "<Dealer & POS ....xlsx>"`
 *
 * Kota dan kecamatan asal dealer menentukan dealer mana yang masuk filter Kota/Kec/
 * Karesidenan (lihat docs/DECISIONS.md 2026-10-11), dan kecamatan asal juga titik tolak
 * toleransi perbatasan di ringkasan jangkauan dealer. Kolomnya baru, jadi dealer yang
 * SUDAH ada di database masih kosong sampai skrip ini jalan. Importer penuh
 * (import-dealer-pos-rings.js, bahkan dengan --no-reset) akan menimpa nama, alamat, dan
 * koordinat dealer, plus pos dan ring — termasuk suntingan yang dibuat lewat Master
 * Dealer. Skrip ini sengaja jauh lebih sempit: hanya dua kolom, dan hanya yang terbaca.
 *
 * Dealer dicocokkan lewat `legacy_code` (kolom "Kode Dealer" Excel). Yang tidak cocok
 * atau kabupaten/kecamatannya tidak terbaca DILAPORKAN dengan namanya, bukan dilewati
 * diam-diam: dealer tanpa kota tidak muncul di filter Kota/Karesidenan, dan dealer
 * tanpa kecamatan tidak muncul di filter Kec. Nama kecamatan yang ambigu antar-kabupaten
 * dipersempit ke kabupaten dealer; kalau masih ambigu, dilaporkan, tidak ditebak.
 *
 * Aman dijalankan berulang. Nilai yang sudah sama tidak disentuh. Nilai yang BERBEDA dari
 * Excel ditimpa (Excel menang) dan dilaporkan.
 */
const path = require('path');
const { coreCityName } = require('../backend/core/region');
const { config: defaultConfig } = require('../backend/server/config');
const store = require('../backend/server/db');
const { readDealerSheet, makeDistrictMatcher } = require('./import-dealer-pos-rings');

const ringkas = (arr) => (arr.length
  ? ` <- ${arr.slice(0, 5).join(', ')}${arr.length > 5 ? `, dan ${arr.length - 5} lagi` : ''}`
  : '');

/**
 * @param {Object} [config]  dari config.js secara default; tes memberi database sementara.
 * @param {string} [file]    path Excel; process.argv[2] bawaan.
 */
async function main(config, file) {
  config = config || defaultConfig;
  file = file || process.argv[2];
  if (!file) {
    console.error('\n  Pakai: npm run backfill-dealer-city -- "<Dealer & POS ....xlsx>"\n');
    process.exitCode = 1;
    return null;
  }

  await store.open(config);
  try {
    const db = store.db();

    // Indeks kota SAMA dengan importer: nama inti kabupaten ("Kab. Sleman" dan
    // "Kabupaten Sleman" bertemu) -> kode BPS dari tabel villages.
    const villageRows = await store.all(db,
      'SELECT DISTINCT district_code, district_name, city_code, city_name FROM villages');
    const cityByCore = new Map();
    villageRows.forEach((v) => {
      if (!cityByCore.has(coreCityName(v.city_name))) {
        cityByCore.set(coreCityName(v.city_name), { code: v.city_code, name: v.city_name });
      }
    });
    if (!cityByCore.size) {
      console.error('\n  Tabel villages kosong. Jalankan: npm run seed-regions\n');
      process.exitCode = 1;
      return null;
    }
    const matchDistrict = makeDistrictMatcher(villageRows);

    const sheet = await readDealerSheet(path.resolve(file), cityByCore);

    const hasil = {
      dalamExcel: sheet.rows.length, diisi: 0, sama: 0, berubah: [],
      tanpaKota: [], tanpaKecamatan: [], tidakDiDatabase: [],
    };
    for (const d of sheet.rows) {
      const ada = d.numericCode ? await store.one(db,
        'SELECT dealer_code, city_code, district_code FROM dealers WHERE legacy_code = ?',
        [d.numericCode]) : null;
      if (!ada) { hasil.tidakDiDatabase.push(d.name); continue; }

      if (!d.cityCode) hasil.tanpaKota.push(d.name);
      const kec = d.kecamatan ? matchDistrict(d.kecamatan, d.cityCode) : null;
      if (!kec) hasil.tanpaKecamatan.push(d.kecamatan ? `${d.name} (${d.kecamatan})` : d.name);

      // Hanya kolom yang TERBACA yang ditulis: kabupaten yang tak terbaca tidak boleh
      // mengosongkan kota yang sudah ada.
      const kotaBaru = d.cityCode || ada.city_code;
      const kecBaru = kec ? kec.code : ada.district_code;
      if (kotaBaru === ada.city_code && kecBaru === ada.district_code) { hasil.sama++; continue; }

      if (ada.city_code && d.cityCode && ada.city_code !== d.cityCode) {
        hasil.berubah.push(`${d.name} (kota ${ada.city_code} -> ${d.cityCode})`);
      }
      if (ada.district_code && kec && ada.district_code !== kec.code) {
        hasil.berubah.push(`${d.name} (kec. ${ada.district_code} -> ${kec.code})`);
      }
      await store.run(db,
        'UPDATE dealers SET city_code = ?, district_code = ?, updated_at = ? WHERE dealer_code = ?',
        [kotaBaru, kecBaru, new Date().toISOString(), ada.dealer_code]);
      hasil.diisi++;
    }

    const kosong = await store.all(db,
      'SELECT dealer_name, city_code, district_code FROM dealers ORDER BY dealer_name');
    hasil.masihTanpaKota = kosong.filter((r) => !r.city_code).map((r) => r.dealer_name);
    hasil.masihTanpaKecamatan = kosong.filter((r) => !r.district_code).map((r) => r.dealer_name);
    // Nama lama untuk pembaca yang sudah ada.
    hasil.masihKosong = hasil.masihTanpaKota;

    console.log('');
    console.log(`  dealer di Excel                          : ${hasil.dalamExcel}`);
    console.log(`  kota/kecamatan diisi atau diperbarui     : ${hasil.diisi}`);
    console.log(`  sudah sama                               : ${hasil.sama}`);
    console.log(`  diganti nilai yang berbeda               : ${hasil.berubah.length}${ringkas(hasil.berubah)}`);
    console.log(`  kabupaten tak terbaca di Excel           : ${hasil.tanpaKota.length}${ringkas(hasil.tanpaKota)}`);
    console.log(`  kecamatan tak terbaca/ambigu di Excel    : ${hasil.tanpaKecamatan.length}${ringkas(hasil.tanpaKecamatan)}`);
    console.log(`  kode dealer Excel tak ada di DB          : ${hasil.tidakDiDatabase.length}${ringkas(hasil.tidakDiDatabase)}`);
    console.log(`  dealer di DB yang MASIH tanpa kota       : ${hasil.masihTanpaKota.length}${ringkas(hasil.masihTanpaKota)}`);
    console.log(`  dealer di DB yang MASIH tanpa kecamatan  : ${hasil.masihTanpaKecamatan.length}${ringkas(hasil.masihTanpaKecamatan)}`);
    console.log('  (tanpa kota: tak muncul di filter Kota/Karesidenan; tanpa kecamatan: tak muncul di filter Kec)\n');
    return hasil;
  } finally {
    await store.close();
  }
}

module.exports = main;

if (require.main === module) {
  main().catch((error) => {
    console.error('\n  GAGAL:', error.message, '\n');
    process.exit(1);
  });
}
