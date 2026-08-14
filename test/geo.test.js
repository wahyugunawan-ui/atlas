/**
 * Uji hitungan geometri: lingkaran radius dan jarak haversine.
 *
 * Keduanya menentukan apa yang dilihat orang di peta — lingkaran yang salah ukuran
 * atau jarak yang salah satuan tidak akan terlihat sebagai error, cuma sebagai angka
 * yang salah. Karena itu diuji, bukan diperiksa dengan mata.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function test() {
  const source = pathToFileURL(
    path.join(__dirname, '..', 'public', 'js', 'geo.js')).href;
  const { circle, distanceMeters } = await import(source);

  // --- jarak ---
  assert.strictEqual(Math.round(distanceMeters(-7.8, 110.4, -7.8, 110.4)), 0);
  // Yogyakarta -> Purwokerto kira-kira 130 km garis lurus.
  const yp = distanceMeters(-7.80, 110.37, -7.42, 109.23) / 1000;
  assert.ok(yp > 110 && yp < 150,
    `jarak Yogya-Purwokerto tidak masuk akal: ${yp.toFixed(0)} km`);
  // Satu derajat lintang ~111 km di mana pun.
  const oneDegree = distanceMeters(-7.0, 110.0, -8.0, 110.0) / 1000;
  assert.ok(Math.abs(oneDegree - 111) < 2,
    `1 derajat lintang: ${oneDegree.toFixed(1)} km`);

  // --- lingkaran ---
  const lat = -7.8;
  const lng = 110.4;
  const R = 5000;
  const ring = circle(lng, lat, R).geometry.coordinates[0];
  assert.ok(ring.length > 32, 'lingkaran terlalu kasar');
  assert.deepStrictEqual(ring[0], ring[ring.length - 1], 'cincin harus tertutup');

  // Tiap titik harus benar-benar sejauh R dari pusat. Kalau koreksi bujur menurut
  // lintang dilupakan, lingkarannya jadi lonjong dan cek ini gagal.
  const spans = ring.map(([x, y]) => distanceMeters(lat, lng, y, x));
  const min = Math.min(...spans);
  const max = Math.max(...spans);
  assert.ok(Math.abs(min - R) / R < 0.02, `sisi terdekat ${min.toFixed(0)} m, target ${R}`);
  assert.ok(Math.abs(max - R) / R < 0.02, `sisi terjauh ${max.toFixed(0)} m, target ${R}`);
  assert.ok((max - min) / R < 0.02,
    `lingkaran lonjong: ${min.toFixed(0)}..${max.toFixed(0)} m`);

  // Radius lebih besar menghasilkan lingkaran lebih besar, bukan sama.
  const wide = circle(lng, lat, 20000).geometry.coordinates[0];
  const wideSpan = distanceMeters(lat, lng, wide[0][1], wide[0][0]);
  assert.ok(wideSpan > 19000 && wideSpan < 21000,
    `radius 20 km meleset: ${wideSpan.toFixed(0)} m`);

  // Koreksi bujur menurut lintang cuma bergeser ~0,9% di Jawa — terlalu kecil untuk
  // membuktikan koreksinya ada. Di lintang 50 selisihnya jadi ~56%, jadi kasus ini
  // yang benar-benar menguncinya. Fungsinya harus benar di mana saja, bukan cuma di
  // wilayah cakupan.
  const north = circle(10, 50, R).geometry.coordinates[0];
  const northSpans = north.map(([x, y]) => distanceMeters(50, 10, y, x));
  const minNorth = Math.min(...northSpans);
  const maxNorth = Math.max(...northSpans);
  assert.ok((maxNorth - minNorth) / R < 0.02,
    `lingkaran lonjong di lintang 50: ${minNorth.toFixed(0)}..${maxNorth.toFixed(0)} m — ` +
    'kemungkinan koreksi bujur menurut lintang hilang');

  console.log(`OK geo — jarak Yogya-Purwokerto ${yp.toFixed(0)} km, ` +
    `lingkaran 5 km galat ${((max - min) / R * 100).toFixed(2)}%`);
}

test().catch((error) => { console.error(error); process.exit(1); });
