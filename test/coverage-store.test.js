/**
 * Uji penyimpanan jangkauan dan hitung ulang saat outlet dipindah.
 *
 * Database uji sendiri (`astra_test_coverage`), dibuang di akhir.
 *
 * Yang dijaga bukan "angkanya benar" — itu tugas coverage.test.js atas hitungannya —
 * tapi hal yang gagalnya paling diam: memindahkan pin lalu meninggalkan jangkauan di
 * lokasi lama. Angkanya akan tetap tampak wajar, cuma menggambarkan tempat yang sudah
 * tidak dipakai.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const store = require('../backend/server/db');
const coverage = require('../backend/server/coverage-store');
const repo = require('../backend/server/repository');
const { openTestDb, closeTestDb } = require('./helpers/db');

/** Bujur sangkar kecil di sekitar satu titik. */
function square(code, name, lng, lat, size) {
  const h = size / 2;
  return {
    type: 'Feature',
    properties: { kode: code, nama: name, kode_kota: code.slice(0, 5) },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h],
        [lng - h, lat + h], [lng - h, lat - h],
      ]],
    },
  };
}

async function seed(dir) {
  const barat = square('34.04.01.2001', 'Barat', 110.00, -7.80, 0.02);
  const timur = square('34.04.01.2002', 'Timur', 110.20, -7.80, 0.02);

  // Berkas geojson tetap ditulis: itu yang dipakai MapLibre untuk menggambar, dan
  // halaman tetap memintanya. Hitungan jangkauan tidak lagi membacanya — poligonnya
  // masuk ke kolom geom_m di bawah, dan PostGIS yang mengerjakannya.
  fs.mkdirSync(path.join(dir, 'geo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'geo', 'kelurahan.geojson'), JSON.stringify({
    type: 'FeatureCollection',
    features: [barat, timur],
  }));

  const db = store.db();
  const village = `
    INSERT INTO villages (village_code, village_name, district_code, district_name,
                          city_code, city_name, province_code, lat, lng, geom, geom_m)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
            ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)),
            ST_Transform(ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)), 32749))`;
  await store.run(db, village,
    ['34.04.01.2001', 'Barat', '34.04.01', 'Mlati', '34.04', 'Sleman', '34', -7.80, 110.00,
      JSON.stringify(barat.geometry), JSON.stringify(barat.geometry)]);
  // Barat dan Timur di KECAMATAN BERBEDA: sejak 2026-10-10 rasio jangkauan berkunci
  // kecamatan, jadi uji "pin dipindah" butuh dua kecamatan supaya bisa dibedakan.
  await store.run(db, village,
    ['34.04.02.2002', 'Timur', '34.04.02', 'Depok', '34.04', 'Sleman', '34', -7.80, 110.20,
      JSON.stringify(timur.geometry), JSON.stringify(timur.geometry)]);

  // Kecamatan ketiga dari DUA desa berukuran sama yang berjauhan (22 km). Pos O4
  // berdiri di tengah desa Dekat; desa Jauh di luar radius sama sekali. Rasio
  // kecamatan seharusnya ~0,5 (separuh LUAS kecamatan di dalam lingkaran) — kalau
  // hitungannya kembali per desa, yang keluar adalah 1,0 untuk desa Dekat dan kunci
  // kecamatannya tidak ada sama sekali.
  const dekat = square('34.04.03.3001', 'Dekat', 110.40, -7.90, 0.005);
  const jauh = square('34.04.03.3002', 'Jauh', 110.60, -7.90, 0.005);
  await store.run(db, village,
    ['34.04.03.3001', 'Dekat', '34.04.03', 'Gamping', '34.04', 'Sleman', '34', -7.90, 110.40,
      JSON.stringify(dekat.geometry), JSON.stringify(dekat.geometry)]);
  await store.run(db, village,
    ['34.04.03.3002', 'Jauh', '34.04.03', 'Gamping', '34.04', 'Sleman', '34', -7.90, 110.60,
      JSON.stringify(jauh.geometry), JSON.stringify(jauh.geometry)]);

  // outlets.dealer_code sekarang FOREIGN KEY ke dealers — baris dealernya harus ada
  // dulu, sebelum outlet mana pun yang menunjuknya.
  await store.run(db, `
    INSERT INTO dealers (dealer_code, dealer_name) VALUES ('D1', 'DEALER SATU')`);
  await store.run(db, `
    INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name, lat, lng)
    VALUES ('O1', 'POS BARAT', 'D1', 'DEALER SATU', -7.80, 110.00)`);
  await store.run(db, `
    INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name, lat, lng)
    VALUES ('O2', 'POS TANPA PIN', 'D1', 'DEALER SATU', NULL, NULL)`);

  // Semua penjualan O1 ada di kelurahan Barat, tempat posnya berdiri.
  await store.run(db, `INSERT INTO sales (period, village_code, outlet_code, quantity)
                       VALUES ('2026-08', '34.04.01.2001', 'O1', 100)`);
  await store.run(db, `INSERT INTO sales (period, village_code, outlet_code, quantity)
                       VALUES ('2026-08', '34.04.02.2002', 'O1', 100)`);
  await store.run(db, `
    INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name, lat, lng)
    VALUES ('O4', 'POS DEKAT', 'D1', 'DEALER SATU', -7.90, 110.40)`);
}

async function share(data, outlet) {
  const rows = (await repo.summary()).sales.filter((r) => r.outlet === outlet);
  let inside = 0;
  let total = 0;
  rows.forEach((r) => {
    inside += r.units * ((data[coverage.DEFAULT_RADIUS_M][r.outlet] || {})[r.district] || 0);
    total += r.units;
  });
  return total ? (inside / total) * 100 : 0;
}

async function test() {
  const config = await openTestDb('coverage');
  await seed(config.dataDir);

  try {
    // --- belum dihitung ---
    assert.strictEqual(await coverage.isEmpty(), true);
    assert.strictEqual((await repo.summary()).coverageReady, false,
      'server yang belum menghitung harus mengaku belum, bukan melaporkan 0%');
    assert.strictEqual((await repo.summary()).businessReferencePercent,
      require('../backend/server/config').config.businessReferencePercent,
      'summary() tidak mengirim businessReferencePercent dari config.js');

    // --- hitung pertama ---
    const first = await coverage.rebuild(config, null);
    assert.strictEqual(first.outlets, 2, 'outlet tanpa koordinat ikut dihitung');
    assert.ok(first.rows > 0);
    assert.strictEqual(await coverage.isEmpty(), false);
    assert.strictEqual((await repo.summary()).coverageReady, true);

    const data = await coverage.all();
    coverage.RADII_M.forEach((r) => {
      assert.ok(data[r], `radius ${r} tidak ada di keluaran`);
    });

    // Pos ada di kecamatan Mlati (desa Barat): Mlati masuk penuh, Depok (22 km) tidak
    // sama sekali. Kuncinya KODE KECAMATAN, bukan kode desa.
    assert.ok(data[5000].O1['34.04.01'] > 0.9, 'rasio tidak berkunci kode kecamatan');
    assert.ok(!data[5000].O1['34.04.01.2001'], 'rasio masih berkunci kode desa');
    assert.ok(!data[5000].O1['34.04.02'],
      'kecamatan 22 km jauhnya tidak boleh punya rasio');
    assert.ok(!data[5000].O2, 'outlet tanpa koordinat tidak boleh punya jangkauan');

    // Rasio = bagian LUAS KECAMATAN di dalam lingkaran, bukan rasio desa terdekat.
    const gamping = data[5000].O4['34.04.03'];
    assert.ok(gamping > 0.45 && gamping < 0.55,
      `kecamatan dua desa sama luas, satu di dalam radius: harusnya ~0,5, dapat ${gamping}`);

    const before = await share(data, 'O1');
    assert.ok(before > 40 && before < 60,
      `separuh penjualan di kelurahan yang jauh: harusnya ~50%, dapat ${before.toFixed(1)}%`);

    // --- pindahkan pin ke kelurahan Timur ---
    //
    // Ini inti tesnya. Kalau baris lama tidak dibuang, O1 akan punya jangkauan di
    // KEDUA kelurahan dan persentasenya melonjak ke 100% — angka yang tampak bagus
    // dan sepenuhnya salah.
    const moved = await repo.updateOutlet('O1', { lat: -7.80, lng: 110.20 }, config);
    assert.strictEqual(moved.coverageRebuilt, true,
      'memindahkan koordinat tidak memicu hitung ulang');

    const after = await coverage.all();
    assert.ok(!after[5000].O1['34.04.01'],
      'jangkauan di lokasi LAMA masih tertinggal setelah pin dipindah');
    assert.ok(after[5000].O1['34.04.02'] > 0.9,
      'jangkauan di lokasi baru tidak terbentuk');
    assert.ok(Math.abs(await share(after, 'O1') - before) < 15,
      'persentase melonjak — kemungkinan baris lama dan baru dihitung dua-duanya');

    // --- menyunting alamat saja tidak memicu hitung ulang ---
    const renamed = await repo.updateOutlet('O1', { address: 'Jl. Baru 1' }, config);
    assert.strictEqual(renamed.coverageRebuilt, false,
      'menyunting alamat memicu hitung ulang yang tidak perlu');
    assert.strictEqual(renamed.outlet.address, 'Jl. Baru 1');
    assert.strictEqual(renamed.outlet.lat, -7.80, 'alamat menimpa koordinat');

    // --- hitung ulang satu outlet tidak menyentuh yang lain ---
    await store.run(store.db(),
      `INSERT INTO dealers (dealer_code, dealer_name) VALUES ('D2', 'DEALER DUA')`);
    await store.run(store.db(), `
      INSERT INTO outlets (outlet_code, outlet_name, dealer_code, dealer_name, lat, lng)
      VALUES ('O3', 'POS LAIN', 'D2', 'DEALER DUA', -7.80, 110.00)`);
    await coverage.rebuild(config, ['O3']);
    const withThird = await coverage.all();
    assert.ok(withThird[5000].O3, 'outlet baru tidak dihitung');
    assert.ok(withThird[5000].O1['34.04.02'],
      'menghitung satu outlet menghapus jangkauan outlet lain');

    console.log('OK coverage-store — rasio berkunci kecamatan (luas kecamatan di dalam ' +
      'radius), pin dipindah membuang jangkauan lama, ' +
      'sunting alamat tidak memicu hitung ulang, satu outlet tidak menyentuh yang lain');
  } finally {
    await closeTestDb(config);
  }
}

test().catch((error) => { console.error(error); process.exit(1); });
