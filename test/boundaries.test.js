/**
 * Uji pembaca batas wilayah — terutama PENUKARAN KOORDINAT.
 *
 * Berkas sumber memakai [lintang, bujur]; GeoJSON memakai [bujur, lintang]. Kalau
 * tidak ditukar, seluruh Jawa Tengah pindah ke Samudra Hindia di lepas pantai Afrika
 * — dan tidak ada satu pun yang melempar error. Poligonnya tetap sah, luasnya tetap
 * masuk akal, PostGIS tetap menerimanya. Yang terjadi cuma jangkauan 0% di mana-mana,
 * yang di layar terlihat seperti temuan bisnis.
 *
 * Itu sebabnya berkas ini ada, dan sebabnya parsernya murni: bisa diuji tanpa
 * PostgreSQL, sebelum satu baris pun masuk database.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  parseBoundaries, parseDistricts, checkOrientation, swapCoords, depth, BATAS,
} = require('../src/core/boundaries');
const { config } = require('../src/server/config');

/* ==========================================================================
   1. penukaran koordinat
   ========================================================================== */

assert.deepStrictEqual(swapCoords([-7.5, 110.3]), [110.3, -7.5],
  'pasangan tunggal tidak ditukar');
assert.deepStrictEqual(swapCoords([[[-7.5, 110.3], [-7.6, 110.4]]]),
  [[[110.3, -7.5], [110.4, -7.6]]], 'poligon (kedalaman 3) tidak ditukar');
assert.deepStrictEqual(swapCoords([[[[-7.5, 110.3]]]]), [[[[110.3, -7.5]]]],
  'multipoligon (kedalaman 4) tidak ditukar');

assert.strictEqual(depth([[[-7.5, 110.3]]]), 3);
assert.strictEqual(depth([[[[-7.5, 110.3]]]]), 4);

/* ==========================================================================
   2. parser terhadap contoh yang dibuat sendiri
   ========================================================================== */

const CONTOH = `
INSERT INTO wilayah_boundaries(kode,nama,lat,lng,path) VALUES
('33.01.01.2001','Tambakreja',-7.5477,108.7750,'[[[-7.526,108.783],[-7.527,108.784],[-7.526,108.783]]]'),
('33.01.01.2002','Nama D''Apostrof',-7.55,108.78,'[[[[-7.52,108.78],[-7.53,108.79],[-7.52,108.78]]]]'),
('33.01.01','Kedungreja',-7.5,108.7,'[[[-7.5,108.7],[-7.6,108.8],[-7.5,108.7]]]'),
('33.01.01.2003','Rusak',-7.5,108.7,'[bukan json]');
`;

const { features, skipped } = parseBoundaries(CONTOH, {
  districtNames: { '33.01.01': 'Kedungreja' },
});

assert.strictEqual(features.length, 2,
  'jumlah kelurahan salah — baris kecamatan seharusnya dilewati, bukan ikut');
assert.strictEqual(features[0].code, '33.01.01.2001');
assert.strictEqual(features[0].geometry.type, 'Polygon');
assert.strictEqual(features[1].geometry.type, 'MultiPolygon');

// Bujur harus > 100 dan lintang negatif. Kalau tertukar, keduanya terbalik.
assert.deepStrictEqual(features[0].geometry.coordinates[0][0], [108.783, -7.526],
  'koordinat tidak ditukar — GeoJSON butuh [bujur, lintang]');

// Kode wilayah DITURUNKAN dari kode kelurahan, tidak pernah dari isian terpisah.
assert.strictEqual(features[0].districtCode, '33.01.01');
assert.strictEqual(features[0].cityCode, '33.01');
assert.strictEqual(features[0].provinceCode, '33');
assert.strictEqual(features[0].districtName, 'Kedungreja',
  'nama kecamatan tidak tersambung dari peta kecamatan');

// Apostrof ganda di SQL adalah escape, bukan dua karakter.
assert.strictEqual(features[1].name, "Nama D'Apostrof");

// Baris rusak DILAPORKAN, tidak dibuang diam-diam.
assert.strictEqual(skipped.length, 1, 'baris rusak tidak dilaporkan');
assert.match(skipped[0].alasan, /JSON/i);

/* ==========================================================================
   3. penjaga arah koordinat
   ========================================================================== */

assert.deepStrictEqual(checkOrientation(features), [],
  'contoh yang benar dianggap di luar kotak Jawa Tengah');

// Yang TIDAK ditukar harus tertangkap. Ini simulasi persis dari bug yang ditakutkan.
const salahArah = [{
  code: 'X', geometry: { type: 'Polygon', coordinates: [[[-7.526, 108.783]]] },
}];
assert.strictEqual(checkOrientation(salahArah).length, 1,
  'koordinat terbalik LOLOS penjaga — ini bug yang tidak menimbulkan error apa pun');

// KARIMUNJAWA. Kepulauan di Laut Jawa, 90 km di utara pesisir, secara administratif
// masuk Kabupaten Jepara. Lintangnya -5,7 sampai -5,9 — di luar daratan Jawa Tengah,
// dan tebakan batas utara pertama (-6,0) menolaknya sebagai "koordinat tertukar".
//
// Datanya benar; kotaknya yang salah. Tes ini menahan supaya batas itu tidak
// diperketat lagi oleh orang yang cuma melihat peta daratan.
const karimunjawa = [{
  code: '33.20.10.2003',
  geometry: { type: 'Polygon', coordinates: [[[110.24, -5.768]]] },
}];
assert.deepStrictEqual(checkOrientation(karimunjawa), [],
  'Karimunjawa ditolak sebagai koordinat tertukar — batas utara terlalu ketat');

/* ==========================================================================
   4. berkas sumber SUNGGUHAN
   ========================================================================== */

const input = path.join(config.geoSourceDir, 'input');
const kel = path.join(input, 'wilayah_boundaries_kel_33.01.sql');
const kec = path.join(input, 'wilayah_boundaries_kec_33.sql');

if (fs.existsSync(kel) && fs.existsSync(kec)) {
  const districts = parseDistricts(fs.readFileSync(kec, 'utf8'));
  assert.ok(Object.keys(districts).length > 500,
    `cuma ${Object.keys(districts).length} kecamatan terbaca dari berkas Jawa Tengah`);
  assert.strictEqual(districts['33.01.01'], 'Kedungreja');

  const asli = parseBoundaries(fs.readFileSync(kel, 'utf8'), { districtNames: districts });
  assert.ok(asli.features.length > 250,
    `cuma ${asli.features.length} kelurahan terbaca dari 33.01`);
  assert.deepStrictEqual(asli.skipped, [], 'ada baris sumber yang gagal dibaca');
  assert.deepStrictEqual(checkOrientation(asli.features), [],
    'ada kelurahan di luar kotak Jawa Tengah — koordinatnya tertukar?');
  assert.ok(asli.features.every((f) => f.districtName),
    'ada kelurahan tanpa nama kecamatan — kolom Kecamatan akan kosong di layar');

  console.log(`OK boundaries — ${asli.features.length} kelurahan dari berkas sungguhan, ` +
    `${Object.keys(districts).length} kecamatan, koordinat benar arah`);
} else {
  console.log('OK boundaries — parser dan penjaga arah (berkas sumber tidak ada, ' +
    'bagian itu dilewati)');
}
