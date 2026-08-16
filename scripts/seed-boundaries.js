/**
 * Muat batas kelurahan seluruh Jateng + DIY ke database: `npm run seed-boundaries`
 *
 * Menggantikan peran build.py untuk keperluan ini, dan TANPA Python: kolom `path` di
 * berkas sumber ternyata array JSON biasa, bukan WKB, jadi Node bisa membacanya dan
 * PostGIS yang mengurus validasi, proyeksi, serta penyederhanaan. Dependensi geopandas
 * + GDAL 100 MB yang dulu jadi penghalang tidak diperlukan sama sekali.
 *
 * KENAPA SELURUH PROVINSI, bukan cuma kota yang sedang dipakai. Begitu semua kelurahan
 * ada di database beserta poligonnya, perluasan cakupan tidak butuh setelan apa pun:
 * bulan depan Excel memuat Klaten, barisnya langsung cocok dan jangkauannya terhitung.
 * Yang dikirim ke browser tetap disaring ke kota yang punya penjualan — lihat
 * scripts/export-geo.js — jadi database lengkap tidak membuat halaman melambat.
 *
 * Aman diulang: ON CONFLICT memperbarui, termasuk kelurahan yang tadinya ditambah
 * manual tanpa batas wilayah.
 */
const fs = require('fs');
const path = require('path');
const { config } = require('../src/server/config');
const store = require('../src/server/db');
const {
  parseBoundaries, parseDistricts, checkOrientation,
} = require('../src/core/boundaries');

/** Baris per INSERT. Kecil karena tiap baris membawa satu poligon utuh sebagai teks. */
const BATCH = 100;

async function main() {
  const input = path.join(config.geoSourceDir, 'input');
  if (!fs.existsSync(input)) {
    console.error(`\n  Folder sumber tidak ada: ${input}`);
    console.error('  Atur GEO_SOURCE_DIR di .env, lalu: npm run fetch-boundaries\n');
    process.exit(1);
  }

  // --- nama kecamatan dulu ---
  //
  // Tidak ada di berkas kelurahan. Tanpa ini kolom Kecamatan kosong — dan pernah
  // menampilkan nama kota selama berminggu-minggu karena diisi dari kolom yang salah.
  const districtNames = {};
  for (const berkas of fs.readdirSync(input)) {
    if (!/^wilayah_boundaries_kec_\d+\.sql$/.test(berkas)) continue;
    Object.assign(districtNames,
      parseDistricts(fs.readFileSync(path.join(input, berkas), 'utf8')));
  }
  console.log(`\n  kecamatan terbaca : ${Object.keys(districtNames).length}`);

  // --- nama kabupaten/kota ---
  //
  // Juga tidak ada di berkas kelurahan. Diambil dari berkas kabupaten di folder yang
  // sama, dan ejaannya SAMA PERSIS dengan yang sudah ada di database ("Kabupaten
  // Cilacap") — jadi memuat ulang tidak mengubah satu pun baris lama.
  const cityNames = {};
  for (const berkas of fs.readdirSync(input)) {
    if (!/^wilayah_boundaries_kab_\d+\.sql$/.test(berkas)) continue;
    Object.assign(cityNames, parseDistricts(
      fs.readFileSync(path.join(input, berkas), 'utf8'), /^\d{2}\.\d{2}$/));
  }
  console.log(`  kabupaten terbaca : ${Object.keys(cityNames).length}`);

  const berkasKel = fs.readdirSync(input)
    .filter((f) => /^wilayah_boundaries_kel_\d{2}\.\d{2}\.sql$/.test(f))
    .sort();
  if (!berkasKel.length) {
    console.error('\n  Tidak ada berkas kelurahan. Jalankan: npm run fetch-boundaries\n');
    process.exit(1);
  }
  console.log(`  berkas kelurahan  : ${berkasKel.length}`);

  await store.open(config);
  const db = store.db();

  const sebelum = (await store.one(db, 'SELECT COUNT(*) AS n FROM villages')).n;

  let total = 0;
  let dilewati = 0;
  const kota = [];

  for (const berkas of berkasKel) {
    const { features, skipped } = parseBoundaries(
      fs.readFileSync(path.join(input, berkas), 'utf8'), { districtNames });
    dilewati += skipped.length;
    skipped.forEach((s) => console.log(`    lewat ${s.kode}: ${s.alasan}`));
    if (!features.length) continue;

    // Arah koordinat diperiksa SEBELUM masuk database, per berkas.
    //
    // Ini pemeriksaan terpenting di seluruh skrip. Sumbernya [lintang, bujur],
    // GeoJSON [bujur, lintang]. Kalau tertukar, seluruh Jawa Tengah pindah ke
    // Samudra Hindia dan TIDAK ADA yang error — poligonnya sah, luasnya masuk akal,
    // jangkauannya cuma jadi 0% di mana-mana.
    const salah = checkOrientation(features);
    if (salah.length) {
      console.error(`\n  GAGAL di ${berkas}: ${salah.length} kelurahan di luar kotak ` +
        'Jawa Tengah + DIY. Lintang dan bujur tertukar — tidak ada yang ditulis.\n');
      await store.close();
      process.exit(1);
    }

    await store.transaction(db, async (conn) => {
      for (let i = 0; i < features.length; i += BATCH) {
        const chunk = features.slice(i, i + BATCH);
        let k = 0;
        const rows = chunk.map(() => {
          const plain = Array.from({ length: 9 }, () => `$${++k}`).join(',');
          const g = `ST_Multi(ST_CollectionExtract(ST_MakeValid(
            ST_SetSRID(ST_GeomFromGeoJSON($${++k}), 4326)), 3))`;
          return `(${plain},${g},ST_Transform(${g},32749))`;
        }).join(',');

        const params = chunk.flatMap((f) => [
          f.code, f.name, f.districtCode, f.districtName,
          f.cityCode, cityNames[f.cityCode] || f.cityCode, f.provinceCode,
          Number.isFinite(f.lat) ? Number(f.lat.toFixed(6)) : null,
          Number.isFinite(f.lng) ? Number(f.lng.toFixed(6)) : null,
          JSON.stringify(f.geometry),
        ]);

        await conn.query(`
          INSERT INTO villages (village_code, village_name, district_code, district_name,
                                city_code, city_name, province_code, lat, lng,
                                geom, geom_m)
          VALUES ${rows}
          ON CONFLICT (village_code) DO UPDATE SET
            village_name = EXCLUDED.village_name,
            district_code = EXCLUDED.district_code,
            district_name = EXCLUDED.district_name,
            city_name = EXCLUDED.city_name,
            lat = EXCLUDED.lat, lng = EXCLUDED.lng,
            geom = EXCLUDED.geom, geom_m = EXCLUDED.geom_m`, params);
      }
    });

    total += features.length;
    kota.push(features[0].cityCode);
    process.stdout.write(`\r  dimuat            : ${total} kelurahan`);
  }

  console.log('');
  const stats = await store.one(db, `
    SELECT COUNT(*) AS n,
           COUNT(DISTINCT city_code) AS kota,
           COUNT(*) FILTER (WHERE geom_m IS NULL) AS tanpa_geom,
           COUNT(*) FILTER (WHERE NOT ST_IsValid(geom)) AS tidak_sah,
           COUNT(*) FILTER (WHERE district_name IS NULL) AS tanpa_kecamatan,
           ROUND((SUM(ST_Area(geom_m)) / 1000000)::numeric, 0) AS luas
    FROM villages`);

  console.log('');
  console.log(`  kelurahan sebelum : ${sebelum}`);
  console.log(`  kelurahan sesudah : ${stats.n}  (+${stats.n - sebelum})`);
  console.log(`  kabupaten/kota    : ${stats.kota}`);
  console.log(`  tanpa poligon     : ${stats.tanpa_geom}`);
  console.log(`  poligon tidak sah : ${stats.tidak_sah}`);
  console.log(`  tanpa kecamatan   : ${stats.tanpa_kecamatan}`);
  console.log(`  luas total        : ${stats.luas} km²`);
  if (dilewati) console.log(`  baris dilewati    : ${dilewati}`);
  console.log('');
  console.log('  Lanjutkan: npm run export-geo   (segarkan berkas peta untuk browser)');
  console.log('             npm run seed-coverage (kalau ada pos di kota baru)\n');

  await store.close();
}

main().catch((error) => {
  console.error('\n  GAGAL:', error.message, '\n');
  process.exit(1);
});
