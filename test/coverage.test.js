/**
 * Uji hitungan jangkauan.
 *
 * Ini fungsi utama produknya, jadi yang diuji bukan "jalan atau tidak" tapi hal-hal
 * yang salahnya diam: rasio yang melebihi 1, kelurahan penuh yang tidak dihitung
 * penuh, hasil yang berubah tiap build, dan sampel yang terlalu sedikit.
 */
const assert = require('assert');
const {
  computeCoverage, splitByCoverage, pointInRing, distanceMeters,
} = require('../backend/core/coverage');

/** Bujur sangkar kecil, sisi ~2,2 km di khatulistiwa. */
function square(code, lng, lat, size) {
  const h = size / 2;
  return {
    type: 'Feature',
    properties: { kode: code },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h],
        [lng - h, lat + h], [lng - h, lat - h],
      ]],
    },
  };
}

function test() {
  // --- bantu ---
  const ring = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  assert.ok(pointInRing(1, 1, ring), 'titik di tengah harus di dalam');
  assert.ok(!pointInRing(3, 1, ring), 'titik di luar harus di luar');
  assert.ok(Math.abs(distanceMeters(0, 0, 0, 1) - 111195) < 500,
    'satu derajat bujur di khatulistiwa ~111 km');

  const geo = {
    type: 'FeatureCollection',
    features: [
      square('DALAM', 110.0, -7.0, 0.02),     // ~2,2 km, seluruhnya dekat pos
      square('SEBAGIAN', 110.05, -7.0, 0.06), // ~6,6 km, separuh masuk
      square('JAUH', 111.0, -7.0, 0.02),      // ~110 km, tidak mungkin masuk
    ],
  };
  const outlets = [
    { kode_pos: 'P1', lat: -7.0, lng: 110.0 },
    { kode_pos: 'TANPA-KOORDINAT', lat: null, lng: null },
  ];

  const { coverage, stats } = computeCoverage(geo, outlets, [5000]);

  // --- rasio masuk akal ---
  const p1 = coverage[5000].P1;
  assert.strictEqual(p1.DALAM, 1, 'kelurahan yang seluruhnya di dalam harus tepat 1,0');
  assert.ok(p1.SEBAGIAN > 0.05 && p1.SEBAGIAN < 0.95,
    `kelurahan yang separuh masuk harus di antara: ${p1.SEBAGIAN}`);
  assert.ok(!('JAUH' in p1), 'kelurahan 110 km jauhnya tidak boleh punya rasio');

  Object.values(coverage[5000]).forEach((byVillage) => {
    Object.entries(byVillage).forEach(([code, ratio]) => {
      assert.ok(ratio > 0 && ratio <= 1, `rasio di luar rentang: ${code} = ${ratio}`);
    });
  });

  // Pos tanpa koordinat tidak punya jangkauan sama sekali, dan itu dilaporkan —
  // bukan didiamkan seolah dia melayani nol kelurahan karena memang begitu.
  assert.ok(!coverage[5000]['TANPA-KOORDINAT'], 'pos tanpa koordinat masuk hasil');
  assert.strictEqual(stats.skipped, 1, 'pos tanpa koordinat tidak dihitung di laporan');

  // --- berbenih tetap ---
  const again = computeCoverage(geo, outlets, [5000]);
  assert.deepStrictEqual(again.coverage, coverage,
    'dua kali hitung menghasilkan angka berbeda — tangkapan layar proposal tidak akan ' +
    'cocok dengan layar saat demo');

  // --- jumlah sampel cukup ---
  //
  // Dibandingkan dengan acuan 20.000 sampel, BUKAN dengan 3.000 — acuan yang sendirinya
  // masih berderau membuat selisihnya tampak lebih besar dari yang sebenarnya, dan itu
  // yang membuat versi pertama tes ini menuduh 300 sampel meleset 3,5 poin padahal
  // terhadap nilai sebenarnya cuma 2,9.
  const reference = computeCoverage(geo, outlets, [5000], 20000)
    .coverage[5000].P1.SEBAGIAN;
  const drift = Math.abs(p1.SEBAGIAN - reference);
  assert.ok(drift < 0.02,
    `sampel bawaan meleset ${(drift * 100).toFixed(1)} poin dari acuan — ` +
    'terlalu sedikit, naikkan SAMPLES di coverage.js');

  // Lebih banyak sampel harus lebih dekat ke acuan, bukan sekadar berbeda.
  const coarse = computeCoverage(geo, outlets, [5000], 150).coverage[5000].P1.SEBAGIAN;
  assert.ok(Math.abs(coarse - reference) > drift,
    'menaikkan jumlah sampel tidak membuat hasilnya lebih akurat — samplingnya bias, ' +
    'bukan sekadar berderau');

  // --- radius berpengaruh, dan tiap radius dihitung sendiri ---
  //
  // Bukan diskalakan dari satu radius. Penskalaan menurut luas lingkaran cuma bisa
  // membesarkan rasio yang sudah ada dan tidak pernah menambahkan kelurahan baru; pada
  // data sungguhan itu memberi 36,8% untuk 10 km padahal jawabannya 55,1%.
  const banyak = computeCoverage(geo, outlets, [3000, 5000, 12000]);
  assert.ok(banyak.coverage[12000].P1.SEBAGIAN > banyak.coverage[5000].P1.SEBAGIAN,
    'radius lebih besar harus menjangkau lebih banyak');
  assert.ok(banyak.coverage[3000].P1.SEBAGIAN < banyak.coverage[5000].P1.SEBAGIAN,
    'radius lebih kecil harus menjangkau lebih sedikit');

  // Radius besar harus MENAMBAH kelurahan, bukan cuma membesarkan yang sudah ada —
  // itu tepat yang tidak bisa dilakukan penskalaan.
  assert.ok(!banyak.coverage[3000].P1.JAUH && !banyak.coverage[12000].P1.JAUH,
    'kelurahan 110 km jauhnya tetap di luar bahkan pada 12 km');
  const geoJauh = {
    type: 'FeatureCollection',
    features: [square('AGAKJAUH', 110.08, -7.0, 0.02)],   // ~8,8 km dari pos
  };
  const dekat = computeCoverage(geoJauh, outlets, [5000, 12000]);
  assert.ok(!dekat.coverage[5000].P1.AGAKJAUH, 'di luar 5 km seharusnya kosong');
  assert.ok(dekat.coverage[12000].P1.AGAKJAUH > 0.9,
    'kelurahan baru harus MUNCUL waktu radiusnya diperbesar');

  // --- pembagian penjualan ---
  const rows = [
    { village: 'DALAM', outlet: 'P1', units: 100 },
    { village: 'JAUH', outlet: 'P1', units: 100 },
  ];
  const split = splitByCoverage(rows, coverage[5000]);
  assert.strictEqual(split.total, 200);
  assert.strictEqual(Math.round(split.inside), 100,
    'penjualan di kelurahan yang penuh masuk harus dihitung penuh');
  assert.strictEqual(Math.round(split.outside), 100,
    'penjualan di kelurahan yang jauh harus dihitung di luar');

  // Pos yang tidak punya rasio sama sekali: semuanya di luar, bukan dibagi nol.
  const orphan = splitByCoverage([{ village: 'DALAM', outlet: 'ENTAH', units: 50 }],
    coverage[5000]);
  assert.strictEqual(orphan.inside, 0);
  assert.strictEqual(orphan.outside, 50);
  assert.strictEqual(orphan.total, 50);

  console.log('OK coverage — rasio 0..1, kelurahan penuh tepat 1,0, berbenih tetap, ' +
    `meleset ${(drift * 100).toFixed(2)} poin dari acuan 20.000 sampel`);
}

test();
