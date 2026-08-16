/**
 * Isi tabel `villages` dari batas kelurahan + referensi BPS: `npm run seed-regions`
 *
 * Dijalankan sekali di awal, dan diulang hanya kalau cakupan wilayahnya berubah.
 *
 * Ini yang memperbaiki kolom Kecamatan. kelurahan.geojson tidak punya field kecamatan
 * sama sekali — tabel Master Kelurahan selama ini menampilkan nama_kota di bawah judul
 * "Kecamatan". Nama kecamatannya ada di referensi_kelurahan.csv dan tinggal
 * digabungkan lewat kode kelurahan.
 *
 * Sejak pindah ke PostGIS, skrip ini JUGA memasukkan poligonnya. Itu yang membuat
 * jangkauan bisa dihitung eksak di database. Berkas geojson-nya tetap ada dan tetap
 * disajikan ke browser — MapLibre memakainya untuk menggambar. Dua salinan, tapi
 * tugasnya berbeda dan keduanya diisi dari sumber yang sama di langkah ini.
 */
const fs = require('fs');
const path = require('path');
const { config } = require('../src/server/config');
const store = require('../src/server/db');

const REFERENCE = path.join(config.geoSourceDir, 'output', 'referensi_kelurahan.csv');

/**
 * Baris per INSERT. Lebih kecil daripada tempat lain karena tiap baris membawa satu
 * poligon utuh sebagai teks — 200 baris sudah beberapa ratus KB per pernyataan.
 */
const BATCH = 200;

/** Titik tengah poligon. Dipakai untuk kolom koordinat dan untuk memusatkan peta. */
function centroid(geometry) {
  let sumLng = 0;
  let sumLat = 0;
  let count = 0;
  const walk = (coords, depth) => {
    if (depth === 0) { sumLng += coords[0]; sumLat += coords[1]; count++; return; }
    coords.forEach((c) => walk(c, depth - 1));
  };
  walk(geometry.coordinates, geometry.type === 'Polygon' ? 2 : 3);
  return count ? [sumLng / count, sumLat / count] : [null, null];
}

async function main() {
  const geoFile = path.join(config.dataDir, 'geo', 'kelurahan.geojson');
  if (!fs.existsSync(geoFile)) {
    console.error(`\n  Tidak ada ${geoFile}`);
    console.error('  Salin berkas geo ke folder data dulu. Lihat README.\n');
    process.exit(1);
  }
  if (!fs.existsSync(REFERENCE)) {
    console.error(`\n  Tidak ada ${REFERENCE}`);
    console.error('  Berkas ini keluaran pipeline Python di ../geo-kelurahan.\n');
    process.exit(1);
  }

  const geo = JSON.parse(fs.readFileSync(geoFile, 'utf8'));

  // kode, nama_kelurahan, kode_kecamatan, nama_kecamatan, kode_kota, nama_kota
  const reference = {};
  fs.readFileSync(REFERENCE, 'utf8').trim().split('\n').slice(1).forEach((line) => {
    const p = line.split(',');
    reference[p[0]] = { districtCode: p[2], districtName: p[3] };
  });

  await store.open(config);
  const db = store.db();

  let missingDistrict = 0;
  const values = geo.features.map((f) => {
    const p = f.properties;
    const ref = reference[p.kode] || {};
    if (!ref.districtName) missingDistrict++;
    const [lng, lat] = centroid(f.geometry);
    return [
      p.kode, p.nama, ref.districtCode || null, ref.districtName || null,
      p.kode_kota, p.nama_kota, String(p.kode_kota).slice(0, 2),
      lat == null ? null : Number(lat.toFixed(6)),
      lng == null ? null : Number(lng.toFixed(6)),
      JSON.stringify(f.geometry),
    ];
  });

  /**
   * Poligonnya dinormalkan waktu masuk, bukan waktu dipakai:
   *
   * - ST_MakeValid   — poligon yang self-intersect membuat ST_Intersection melempar
   *                    error di tengah hitungan jangkauan, jauh dari sini
   * - ST_Multi       — sumbernya campuran 3.383 Polygon dan 83 MultiPolygon; kolomnya
   *                    satu tipe supaya tidak ada cabang khusus di mana pun
   * - ST_CollectionExtract(..., 3) — MakeValid bisa mengembalikan campuran garis dan
   *                    poligon; hanya bagian poligonnya yang punya luas
   */
  const GEOM = (n) => `ST_Multi(ST_CollectionExtract(ST_MakeValid(
    ST_SetSRID(ST_GeomFromGeoJSON($${n}), 4326)), 3))`;

  await store.transaction(db, async (conn) => {
    for (let i = 0; i < values.length; i += BATCH) {
      const chunk = values.slice(i, i + BATCH);
      let k = 0;
      const rows = chunk.map(() => {
        const plain = Array.from({ length: 9 }, () => `$${++k}`).join(',');
        const geom = GEOM(++k);
        return `(${plain},${geom},ST_Transform(${geom},32749))`;
      }).join(',');

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
          geom = EXCLUDED.geom, geom_m = EXCLUDED.geom_m`, chunk.flat());
    }
  });

  const written = values.length;
  const stats = await store.one(db, `
    SELECT COUNT(DISTINCT city_code) AS cities,
           COUNT(DISTINCT province_code) AS provinces,
           COUNT(*) FILTER (WHERE geom IS NULL) AS no_geom,
           COUNT(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid,
           ROUND((SUM(ST_Area(geom_m)) / 1000000)::numeric, 0) AS area_km2
    FROM villages`);

  console.log('');
  console.log('  kelurahan ditulis :', written);
  console.log('  kabupaten/kota    :', stats.cities);
  console.log('  provinsi          :', stats.provinces);
  console.log('  tanpa kecamatan   :', missingDistrict,
    missingDistrict ? '<- periksa referensi_kelurahan.csv' : '');
  console.log('  tanpa poligon     :', stats.no_geom,
    stats.no_geom ? '<- jangkauannya tidak akan pernah terhitung' : '');
  console.log('  poligon tidak sah :', stats.invalid,
    stats.invalid ? '<- ST_MakeValid gagal, periksa sumbernya' : '');
  console.log('  luas total        :', stats.area_km2, 'km²');
  console.log('');
  await store.close();
}

main().catch((error) => { console.error('\n  GAGAL:', error.message, '\n'); process.exit(1); });
