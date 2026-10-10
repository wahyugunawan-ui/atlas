/**
 * Uji poligon kecamatan (view `district_shapes`, backend/server/schema.sql).
 *
 * KENAPA ADA. Sejak 2026-10-10 kecamatan jadi satuan analisis yang DIWARNAI di peta,
 * dan poligonnya gabungan (ST_Union) kelurahan. Di data asli gabungan itu
 * meninggalkan 29.823 lubang sliver karena tepi kelurahan bersebelahan tidak
 * berimpit — tak terlihat sebagai garis, tapi jadi bintik-bintik begitu diwarnai.
 *
 * Aturannya: lubang DITUTUP, kecuali titik di dalamnya jatuh di kelurahan milik
 * kecamatan LAIN (enclave sah). Dua sifat yang dijaga, dua-duanya gagal diam:
 *   1. lubang yatim (tidak ada yang mengisinya) harus hilang
 *   2. enclave kecamatan lain harus TETAP lubang — kalau ikut ditutup, dua kecamatan
 *      bertumpuk dan rasio jangkauan keduanya menghitung tanah yang sama dua kali
 */
const assert = require('assert');

const store = require('../backend/server/db');
const { openTestDb, closeTestDb } = require('./helpers/db');

const BASE_LNG = 110.0;
const BASE_LAT = -7.8;

/** Persegi [x0,y0]-[x1,y1] dalam satuan 0,01 derajat dari titik dasar, lubang opsional. */
function kotak(x0, y0, x1, y1, lubang) {
  const titik = (x, y) => [BASE_LNG + x * 0.01, BASE_LAT + y * 0.01];
  const cincin = (a, b, c, d) => [titik(a, b), titik(c, b), titik(c, d), titik(a, d), titik(a, b)];
  const rings = [cincin(x0, y0, x1, y1)];
  if (lubang) rings.push(cincin(...lubang).reverse());
  return { type: 'Polygon', coordinates: rings };
}

async function desa(db, code, district, geom) {
  await store.run(db, `
    INSERT INTO villages (village_code, village_name, district_code, district_name,
                          city_code, city_name, province_code, lat, lng, geom, geom_m)
    VALUES (?, ?, ?, ?, '34.04', 'Sleman', '34', NULL, NULL,
            ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)),
            ST_Transform(ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)), 32749))`,
  [code, code, district, district, JSON.stringify(geom), JSON.stringify(geom)]);
}

async function test() {
  const config = await openTestDb('districtshapes');
  const db = store.db();
  try {
    // Kecamatan A, desa A1: persegi 0..10 dengan lubang 4..6 yang TIDAK diisi siapa pun
    // — tiruan celah sliver antara kelurahan bersebelahan.
    await desa(db, '34.04.01.0001', '34.04.01', kotak(0, 0, 10, 10, [4, 4, 6, 6]));
    // Kecamatan A, desa A2: persegi 20..30 dengan lubang 24..26 yang DIISI desa B1
    // milik kecamatan B — enclave sah.
    await desa(db, '34.04.01.0002', '34.04.01', kotak(20, 0, 30, 10, [24, 4, 26, 6]));
    await desa(db, '34.04.02.0001', '34.04.02', kotak(24, 4, 26, 6));

    await db.query('REFRESH MATERIALIZED VIEW district_shapes');

    const lubang = async (district) => Number((await store.one(db, `
      SELECT COUNT(*) AS n
      FROM (SELECT (ST_DumpRings((ST_Dump(geom_m)).geom)).path[1] AS idx
            FROM district_shapes WHERE district_code = ?) r
      WHERE idx > 0`, [district])).n);

    const kec = await store.all(db, 'SELECT district_code FROM district_shapes ORDER BY 1');
    assert.deepStrictEqual(kec.map((r) => r.district_code), ['34.04.01', '34.04.02'],
      'tiap kecamatan harus jadi satu baris di district_shapes');

    assert.strictEqual(await lubang('34.04.01'), 1,
      'kecamatan A harus punya TEPAT satu lubang: enclave B dipertahankan, lubang ' +
      'yatim ditutup');

    // Lubang yang tersisa harus yang di 24..26 (enclave), bukan yang di 4..6 (yatim).
    const tertutup = await store.one(db, `
      SELECT ST_Contains(geom_m, ST_Transform(ST_SetSRID(ST_MakePoint(?, ?), 4326), 32749)) AS yatim,
             ST_Contains(geom_m, ST_Transform(ST_SetSRID(ST_MakePoint(?, ?), 4326), 32749)) AS enclave
      FROM district_shapes WHERE district_code = '34.04.01'`,
    [BASE_LNG + 0.05, BASE_LAT + 0.05, BASE_LNG + 0.25, BASE_LAT + 0.05]);
    assert.strictEqual(tertutup.yatim, true, 'lubang yatim (sliver) tidak ditutup');
    assert.strictEqual(tertutup.enclave, false,
      'enclave kecamatan lain ikut ditutup — dua kecamatan bertumpuk');

    // Kecamatan tidak boleh saling tumpuk karena penutupan lubang.
    const tumpuk = await store.one(db, `
      SELECT ST_Area(ST_Intersection(a.geom_m, b.geom_m)) AS luas
      FROM district_shapes a, district_shapes b
      WHERE a.district_code = '34.04.01' AND b.district_code = '34.04.02'`);
    assert.ok(tumpuk.luas < 1, `kecamatan A dan B bertumpuk ${tumpuk.luas} m²`);

    // lat/lng (titik di dalam poligon, dipakai halaman untuk terbang ke kecamatan) terisi.
    const pusat = await store.one(db,
      "SELECT lat, lng FROM district_shapes WHERE district_code = '34.04.02'");
    assert.ok(Math.abs(pusat.lng - (BASE_LNG + 0.25)) < 0.011 &&
      Math.abs(pusat.lat - (BASE_LAT + 0.05)) < 0.011, 'lat/lng kecamatan di luar poligonnya');

    console.log('OK district-shapes — lubang sliver ditutup, enclave kecamatan lain ' +
      'dipertahankan, kecamatan tidak bertumpuk');
  } finally {
    await closeTestDb(config);
  }
}

test().catch((error) => { console.error(error); process.exit(1); });
