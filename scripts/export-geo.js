/**
 * Tulis berkas peta untuk browser dari database: `npm run export-geo`
 *
 * Database memuat SELURUH Jateng + DIY (8.999 kelurahan). Browser tidak boleh menerima
 * semuanya — MapLibre memuat berkas ini sekaligus di awal, dan 8.999 kelurahan detail
 * penuh berarti puluhan MB yang harus diunduh dan diurai tiap kali halaman dibuka.
 *
 * YANG DIKIRIM: kelurahan yang punya penjualan, ATAU yang masuk radius jangkauan
 * sebuah pos. 4.003 dari 8.999.
 *
 * Kriteria itu bukan sekadar yang paling kecil, tapi yang paling berarti. Kelurahan
 * berpenjualan diwarnai menurut volume; kelurahan dalam radius dipakai menggambar
 * jangkauan. Sisanya kelurahan tanpa penjualan yang juga di luar semua radius —
 * menggambarnya tidak menjawab satu pun pertanyaan yang ditanyakan dashboard ini.
 *
 * Penyaring "kota yang punya penjualan" sempat dipertimbangkan dan DITOLAK setelah
 * diukur: 38 dari 40 kota punya setidaknya satu penjualan, jadi penyaringnya cuma
 * membuang 3% — nyaris tidak menyaring apa pun.
 */
const fs = require('fs');
const path = require('path');
const { config } = require('../backend/server/config');
const store = require('../backend/server/db');

/**
 * Toleransi penyederhanaan, dalam meter.
 *
 * Sama dengan `TOLERANSI_METER` di pipeline Python lama, supaya berkas hasilnya
 * sebanding dengan yang selama ini dipakai. Disederhanakan di UTM 49S (satuan meter),
 * bukan di derajat — 50 derajat tidak berarti apa-apa.
 *
 * Yang disimpan di database tetap detail penuh; penyederhanaan HANYA untuk yang
 * digambar. Hitungan jangkauan memakai yang detail.
 */
const TOLERANSI_M = 50;

async function main() {
  await store.open(config);
  const db = store.db();

  const dir = path.join(config.dataDir, 'geo');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'kelurahan.geojson');

  const total = (await store.one(db, 'SELECT COUNT(*) AS n FROM villages')).n;

  // ST_SimplifyPreserveTopology, bukan ST_Simplify: yang kedua bisa merobek poligon
  // jadi bentuk yang tidak sah, dan MapLibre menggambarnya sebagai jaring merah aneh.
  const rows = await store.all(db, `
    SELECT village_code AS code, village_name AS name,
           city_code AS "cityCode", city_name AS "cityName",
           ST_AsGeoJSON(
             ST_Transform(ST_SimplifyPreserveTopology(geom_m, $1), 4326), 6
           ) AS geometry
    FROM villages
    WHERE geom_m IS NOT NULL
      AND (village_code IN (SELECT village_code FROM sales)
           OR village_code IN (SELECT DISTINCT village_code FROM coverage))
    ORDER BY province_code, city_name, district_name, village_name`, [TOLERANSI_M]);

  if (!rows.length) {
    console.error('\n  Tidak ada kelurahan yang punya penjualan maupun jangkauan.');
    console.error('  Jalankan impor dan seed-coverage dulu.\n');
    await store.close();
    process.exit(1);
  }

  // Properti dibuat SAMA dengan yang dipakai halaman sekarang (`kode`, `nama`,
  // `kode_kota`, `nama_kota`). Mengganti namanya di sini berarti memutus map.js dan
  // seluruh penyaring tanpa ada yang error — cuma peta kosong.
  const features = rows.map((r) => ({
    type: 'Feature',
    properties: {
      kode: r.code, nama: r.name, kode_kota: r.cityCode, nama_kota: r.cityName,
    },
    geometry: JSON.parse(r.geometry),
  }));

  const isi = JSON.stringify({ type: 'FeatureCollection', features });
  const sementara = file + '.parsial';
  fs.writeFileSync(sementara, isi);
  fs.renameSync(sementara, file);

  console.log('');
  console.log(`  kelurahan di database : ${total}`);
  console.log(`  dikirim ke browser    : ${features.length}  ` +
    `(${(features.length / total * 100).toFixed(0)}%)`);
  console.log(`  penyederhanaan        : ${TOLERANSI_M} m`);
  console.log(`  berkas                : ${(isi.length / 1048576).toFixed(2)} MB`);
  console.log(`                          ${file}`);
  console.log('');

  await store.close();
}

main().catch((error) => {
  console.error('\n  GAGAL:', error.message, '\n');
  process.exit(1);
});
