/**
 * Isi `dealers.city_code` dari kolom "Kabupaten" Excel Dealer & POS, TANPA menyentuh yang
 * lain: `npm run backfill-dealer-city -- "<Dealer & POS ....xlsx>"`
 *
 * Kota asal dealer menentukan dealer mana yang masuk filter Kota/Karesidenan (lihat
 * docs/DECISIONS.md 2026-10-11). Kolomnya baru, jadi dealer yang SUDAH ada di database
 * masih kosong sampai skrip ini jalan. Importer penuh (import-dealer-pos-rings.js,
 * bahkan dengan --no-reset) akan menimpa nama, alamat, dan koordinat dealer, plus pos dan
 * ring — termasuk suntingan yang dibuat lewat Master Dealer. Skrip ini sengaja jauh lebih
 * sempit: hanya satu kolom, dan hanya yang terbaca.
 *
 * Dealer dicocokkan lewat `legacy_code` (kolom "Kode Dealer" Excel). Yang tidak cocok
 * atau kabupatennya tidak terbaca DILAPORKAN dengan namanya, bukan dilewati diam-diam:
 * dealer tanpa kota tidak muncul di filter Kota/Karesidenan mana pun.
 *
 * Aman dijalankan berulang. Kota yang sudah terisi TIDAK ditimpa kecuali berbeda dari
 * Excel — perbedaannya dilaporkan dan, kalau Excel menang, tertulis di laporan.
 */
const path = require('path');
const { coreCityName } = require('../backend/core/region');
const { config: defaultConfig } = require('../backend/server/config');
const store = require('../backend/server/db');
const { readDealerSheet } = require('./import-dealer-pos-rings');

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
    const cityByCore = new Map();
    (await store.all(db, 'SELECT DISTINCT city_code, city_name FROM villages')).forEach((v) => {
      if (!cityByCore.has(coreCityName(v.city_name))) {
        cityByCore.set(coreCityName(v.city_name), { code: v.city_code, name: v.city_name });
      }
    });
    if (!cityByCore.size) {
      console.error('\n  Tabel villages kosong. Jalankan: npm run seed-regions\n');
      process.exitCode = 1;
      return null;
    }

    const sheet = await readDealerSheet(path.resolve(file), cityByCore);

    const hasil = {
      dalamExcel: sheet.rows.length, diisi: 0, sama: 0, berubah: [],
      tanpaKota: [], tidakDiDatabase: [],
    };
    for (const d of sheet.rows) {
      const ada = d.numericCode ? await store.one(db,
        'SELECT dealer_code, city_code FROM dealers WHERE legacy_code = ?', [d.numericCode]) : null;
      if (!ada) { hasil.tidakDiDatabase.push(d.name); continue; }
      if (!d.cityCode) { hasil.tanpaKota.push(d.name); continue; }
      if (ada.city_code === d.cityCode) { hasil.sama++; continue; }
      if (ada.city_code) hasil.berubah.push(`${d.name} (${ada.city_code} -> ${d.cityCode})`);
      await store.run(db, 'UPDATE dealers SET city_code = ?, updated_at = ? WHERE dealer_code = ?',
        [d.cityCode, new Date().toISOString(), ada.dealer_code]);
      hasil.diisi++;
    }

    const kosong = await store.all(db,
      'SELECT dealer_name FROM dealers WHERE city_code IS NULL ORDER BY dealer_name');
    hasil.masihKosong = kosong.map((r) => r.dealer_name);

    console.log('');
    console.log(`  dealer di Excel                    : ${hasil.dalamExcel}`);
    console.log(`  city_code diisi/diperbarui         : ${hasil.diisi}`);
    console.log(`  sudah sama                         : ${hasil.sama}`);
    console.log(`  diganti nilai yang berbeda         : ${hasil.berubah.length}${ringkas(hasil.berubah)}`);
    console.log(`  kabupaten tak terbaca di Excel     : ${hasil.tanpaKota.length}${ringkas(hasil.tanpaKota)}`);
    console.log(`  kode dealer Excel tak ada di DB    : ${hasil.tidakDiDatabase.length}${ringkas(hasil.tidakDiDatabase)}`);
    console.log(`  dealer di DB yang MASIH tanpa kota : ${hasil.masihKosong.length}${ringkas(hasil.masihKosong)}`);
    console.log('  (dealer tanpa kota tidak muncul di filter Kota/Karesidenan mana pun)\n');
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
