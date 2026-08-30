/**
 * Uji silang: hitungan PostGIS lawan sampling di backend/core/coverage.js.
 *
 * Dua cara yang sepenuhnya berbeda menjawab pertanyaan yang sama — irisan luas
 * kelurahan dengan lingkaran radius. PostGIS memakai geometri tepat di proyeksi meter
 * (UTM 49S); backend/core memakai Monte Carlo di ruang derajat dengan jarak haversine.
 * Tidak ada satu baris kode pun yang dipakai bersama.
 *
 * Kalau keduanya sepakat, dua-duanya hampir pasti benar. Kalau berselisih jauh, salah
 * satunya salah — dan itulah yang tes ini cari. Satu implementasi tanpa pembanding
 * tidak punya cara membuktikan dirinya sendiri.
 *
 * Sekaligus mengunci satu hal yang gagalnya sangat diam: kehalusan lingkaran
 * ST_Buffer. Bawaannya menghasilkan segi-32 yang luasnya 0,65% lebih kecil daripada
 * lingkaran, selalu ke arah yang sama, jadi biasnya tidak pernah saling menghapus.
 */
const assert = require('assert');

const store = require('../backend/server/db');
const coverage = require('../backend/server/coverage-store');
const { computeCoverage } = require('../backend/core/coverage');
const { openTestDb, closeTestDb } = require('./helpers/db');

const OUTLET_LNG = 110.00;
const OUTLET_LAT = -7.80;

/** Bujur sangkar di sekitar satu titik, ukuran dalam derajat. */
function square(code, name, lng, lat, size) {
  const h = size / 2;
  return {
    type: 'Feature',
    properties: { kode: code, nama: name, kode_kota: '34.04' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h],
        [lng - h, lat + h], [lng - h, lat - h],
      ]],
    },
  };
}

/**
 * Petak kelurahan seukuran aslinya (±2,2 km) menyebar dari pos ke satu arah, jadi ada
 * yang di dalam penuh, yang terpotong tepi lingkaran, dan yang di luar sama sekali.
 * Yang terpotong itu yang paling berharga — di situlah dua cara bisa berselisih.
 */
function buildVillages() {
  const features = [];
  const SIZE = 0.02;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 3; j++) {
      const n = features.length;
      features.push(square(
        `34.04.01.${String(2001 + n).padStart(4, '0')}`, `Petak ${n}`,
        OUTLET_LNG + i * SIZE, OUTLET_LAT + j * SIZE, SIZE));
    }
  }
  // Satu petak besar yang menelan seluruh lingkaran 5 km. Dipakai menguji kehalusan
  // ST_Buffer: irisannya adalah lingkaran itu sendiri, jadi rasionya = luas lingkaran
  // dibagi luas petak, dan tiap penyimpangan bentuk lingkaran langsung kelihatan.
  features.push(square('34.04.09.9999', 'Petak Besar', OUTLET_LNG, OUTLET_LAT, 0.5));
  return { type: 'FeatureCollection', features };
}

async function seed(geo) {
  const db = store.db();
  for (const f of geo.features) {
    await store.run(db, `
      INSERT INTO villages (village_code, village_name, district_code, district_name,
                            city_code, city_name, province_code, lat, lng, geom, geom_m)
      VALUES (?, ?, '34.04.01', 'Mlati', '34.04', 'Sleman', '34', ?, ?,
              ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)),
              ST_Transform(ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)), 32749))`,
    [f.properties.kode, f.properties.nama,
      f.geometry.coordinates[0][0][1], f.geometry.coordinates[0][0][0],
      JSON.stringify(f.geometry), JSON.stringify(f.geometry)]);
  }
  // outlets.dealer_code sekarang FOREIGN KEY ke dealers.
  await store.run(db,
    `INSERT INTO dealers (dealer_code, dealer_name) VALUES ('D1', 'DEALER SATU')`);
  await store.run(db, `
    INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name, lat, lng)
    VALUES ('O1', 'POS UJI', 'D1', 'DEALER SATU', ?, ?)`, [OUTLET_LAT, OUTLET_LNG]);
}

async function test() {
  const config = await openTestDb('postgis');
  const geo = buildVillages();

  try {
    await seed(geo);
    const hasil = await coverage.rebuild(config, null);
    assert.strictEqual(hasil.outlets, 1);
    assert.ok(hasil.rows > 0, 'PostGIS tidak menghasilkan satu baris pun');

    const exact = await coverage.all();
    const { coverage: sampled } = computeCoverage(
      geo, [{ kode_pos: 'O1', lat: OUTLET_LAT, lng: OUTLET_LNG }], coverage.RADII_M);

    // --- sifat dasar ---
    for (const r of coverage.RADII_M) {
      assert.ok(exact[r], `radius ${r} tidak ada di keluaran`);
      for (const [village, ratio] of Object.entries(exact[r].O1 || {})) {
        assert.ok(ratio > 0 && ratio <= 1,
          `rasio di luar 0..1: ${village} radius ${r} = ${ratio}`);
      }
    }

    // Kelurahan tempat pos berdiri, radius 10 km: petak 2,2 km itu masuk seluruhnya.
    const dalam = exact[10000].O1['34.04.01.2001'];
    assert.ok(Math.abs(dalam - 1) < 1e-9,
      `kelurahan yang seluruhnya di dalam harus tepat 1,0 — dapat ${dalam}`);

    // --- kehalusan lingkaran ST_Buffer ---
    //
    // Irisan lingkaran 5 km dengan petak besar = lingkaran itu sendiri. Rasionya harus
    // sama dengan pi*r^2 dibagi luas petak. Kalau quad_segs dilepas, ST_Buffer jadi
    // segi-32 dan rasionya 0,65% terlalu kecil — tes ini yang menangkapnya.
    const luasPetak = (await store.one(store.db(),
      "SELECT ST_Area(geom_m) AS a FROM villages WHERE village_code = '34.04.09.9999'")).a;
    const seharusnya = (Math.PI * 5000 * 5000) / luasPetak;
    const didapat = exact[5000].O1['34.04.09.9999'];
    const meleset = Math.abs(didapat - seharusnya) / seharusnya;
    assert.ok(meleset < 0.002,
      `lingkaran radius menyimpang ${(meleset * 100).toFixed(2)}% dari pi*r^2 — ` +
      'kemungkinan quad_segs hilang dari ST_Buffer');

    // --- silang lawan sampling ---
    //
    // Yang diperiksa BUKAN "tiap kelurahan sama persis". Sampling memang berderau:
    // kelurahan yang tepinya dipotong lingkaran bisa meleset beberapa poin, dan itu
    // wajar — menjalankan sampling dua kali dengan benih berbeda pun menghasilkan
    // selisih sebesar itu di kelurahan yang sama.
    //
    // Yang diperiksa: apakah selisihnya BERDERAU atau BERBIAS. Derau saling
    // menghapus waktu dirata-rata; bias tidak. Salah proyeksi, salah satuan, atau
    // lingkaran yang bentuknya keliru semuanya menghasilkan bias — dan bias itulah
    // yang mengubah angka di proposal.
    const selisih = [];
    for (const r of coverage.RADII_M) {
      const semua = new Set([
        ...Object.keys(exact[r].O1 || {}),
        ...Object.keys(sampled[r].O1 || {}),
      ]);
      for (const village of semua) {
        const a = (exact[r].O1 || {})[village] || 0;
        const b = (sampled[r].O1 || {})[village] || 0;
        selisih.push({ village, r, d: a - b });
      }
    }

    assert.ok(selisih.length >= 20,
      `cuma ${selisih.length} pasangan yang dibandingkan — tesnya tidak menguji apa-apa`);

    const rerata = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const bias = rerata(selisih.map((x) => x.d));
    const rerataAbs = rerata(selisih.map((x) => Math.abs(x.d)));
    const terjauh = selisih.reduce((a, b) => (Math.abs(b.d) > Math.abs(a.d) ? b : a));

    // Batas paling tajam. Diukur, bukan ditebak: derau sampling murni (1.000 lawan
    // 4.000 titik) rerata 0,34 poin dan biasnya nol. Bias 0,5 poin sudah di luar
    // jangkauan derau dan berarti ada yang salah secara sistematis.
    assert.ok(Math.abs(bias) < 0.005,
      `PostGIS berbias ${(bias * 100).toFixed(2)} poin terhadap sampling — ` +
      'derau saling menghapus, bias tidak. Ada yang salah secara sistematis.');

    // Rerata selisih mutlak. Derau sampling sendiri 0,34 poin; 1 poin memberi ruang
    // tanpa membiarkan kesalahan nyata lolos.
    assert.ok(rerataAbs < 0.01,
      `rerata selisih ${(rerataAbs * 100).toFixed(2)} poin, terlalu besar untuk derau`);

    // Batas terluar. Longgar dengan sengaja: satu kelurahan yang tepinya tepat kena
    // lingkaran memang bisa meleset beberapa poin. Salah proyeksi menggeser puluhan.
    assert.ok(Math.abs(terjauh.d) < 0.06,
      `selisih terjauh ${(terjauh.d * 100).toFixed(1)} poin di ${terjauh.village} ` +
      `@ ${terjauh.r}m — itu bukan lagi derau sampling`);

    console.log(`OK coverage-postgis — ${selisih.length} pasangan, bias ` +
      `${(bias * 100).toFixed(2)} poin, rerata ${(rerataAbs * 100).toFixed(2)} poin, ` +
      `terjauh ${(Math.abs(terjauh.d) * 100).toFixed(1)} poin; lingkaran meleset ` +
      `${(meleset * 100).toFixed(2)}% dari pi*r²`);
  } finally {
    await closeTestDb(config);
  }
}

test().catch((error) => { console.error(error); process.exit(1); });
