/**
 * Rasio jangkauan: berapa bagian tiap kelurahan yang masuk radius tiap pos.
 *
 * INI FUNGSI UTAMA PRODUKNYA. Pertanyaan yang dijawab: dari sekian penjualan satu pos,
 * berapa persen yang berada di dalam radius jangkauan, dan berapa yang di luar.
 *
 * Alamat konsumen tidak punya koordinat — yang ada cuma kelurahannya. Jadi "berapa
 * persen konsumen di dalam radius" TIDAK bisa dihitung per orang. Yang bisa dihitung
 * jujur: berapa bagian LUAS kelurahan yang masuk lingkaran radius, lalu dipakai sebagai
 * bobot terhadap jumlah penjualan di kelurahan itu.
 *
 * Asumsinya konsumen tersebar merata di dalam kelurahannya. Asumsi itu salah di
 * kelurahan yang setengahnya sawah — tapi jauh lebih dekat ke kenyataan daripada jarak
 * ke titik tengah, yang memberi jawaban biner "semua masuk" atau "semua keluar" untuk
 * seluruh kelurahan sekaligus. Asumsinya ditulis di layar, bukan cuma di sini.
 *
 * CARA MENGHITUNG: sampling, bukan geometri tepat.
 *
 * geo-kelurahan/radius.py mengerjakan hal yang sama dengan gpd.overlay dan hasilnya
 * tepat — tapi geopandas menarik GDAL (±100 MB) dan tidak terpasang di mesin ini.
 * Sampling mengukur besaran yang SAMA (proporsi luas), cuma diperkirakan. Galatnya
 * jauh lebih kecil daripada galat asumsi "tersebar merata" yang dipakai kedua cara.
 * Menambah 100 MB untuk memperbaiki angka ketiga di belakang koma dari perkiraan yang
 * asumsinya sendiri kasar bukan pertukaran yang masuk akal.
 */

/**
 * Titik per kelurahan.
 *
 * Angka ini DIUKUR, bukan ditebak. Terhadap acuan 20.000 sampel pada kelurahan yang
 * separuhnya masuk radius:
 *
 *     300 sampel  -> meleset 2,9 poin persen
 *     600         -> 2,6
 *     1.000       -> 1,3
 *     2.000       -> 0,5
 *
 * Dipakai 1.000. Menaikkannya lagi memperbaiki angka di belakang koma dari perkiraan
 * yang asumsi dasarnya jauh lebih kasar daripada itu.
 *
 * Klaim ini dijaga coverage.test.js — versi pertama komentar ini menulis "±3% pada 300
 * sampel", dan tesnya langsung membantahnya.
 */
const SAMPLES = 1000;

/** Di bawah ini dianggap nol dan tidak disimpan — kalau tidak, keluarannya penuh nol. */
const MIN_RATIO = 0.001;

/** Pembangkit acak berbenih. Dua kali build harus menghasilkan rasio yang sama persis;
 *  kalau tidak, tangkapan layar di proposal tidak akan cocok dengan layar saat demo. */
function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Titik di dalam cincin? Ray casting. */
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Jarak haversine dalam meter. */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Sebar titik merata di dalam poligon, dengan penolakan di kotak pembatas.
 *
 * Cincin terluar saja yang dipakai. Lubang (danau, enklave) diabaikan — di data
 * kelurahan Indonesia jumlahnya sedikit dan pengaruhnya ke rasio jauh di bawah galat
 * sampling itu sendiri.
 */
function samplePolygon(feature, random, count) {
  const rings = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates[0]]
    : feature.geometry.coordinates.map((poly) => poly[0]);
  const ring = rings.reduce((a, b) => (b.length > a.length ? b : a));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  ring.forEach(([x, y]) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });

  const points = [];
  // Batas percobaan supaya kelurahan yang sangat tipis (pesisir memanjang) tidak
  // membuat build menggantung selamanya.
  let attempts = 0;
  const maxAttempts = count * 60;
  while (points.length < count && attempts < maxAttempts) {
    attempts++;
    const lng = minX + random() * (maxX - minX);
    const lat = minY + random() * (maxY - minY);
    if (pointInRing(lng, lat, ring)) points.push([lng, lat]);
  }
  return points;
}

/**
 * Hitung rasio untuk BEBERAPA radius sekaligus.
 *
 * Beberapa radius, bukan satu lalu diskalakan. Penskalaan menurut luas lingkaran
 * terlihat masuk akal tapi salah arah: dia cuma bisa membesarkan rasio yang sudah ada,
 * tidak pernah menambahkan kelurahan baru yang tadinya di luar jangkauan. Diuji pada
 * data ini, radius 10 km hasil penskalaan memberi 36,8% padahal seharusnya jauh lebih
 * tinggi — dan angka yang terlalu rendah di slider akan dibaca sebagai temuan.
 *
 * Menghitungnya sekaligus hampir gratis: titik kelurahan disebar sekali, jaraknya ke
 * tiap pos dihitung sekali, lalu dihitung berapa yang masuk untuk tiap ambang.
 *
 * @param {Object} geo       FeatureCollection kelurahan
 * @param {Array}  outlets   [{kode_pos, lat, lng}]
 * @param {Array<number>} radiiM  daftar radius dalam meter
 * @param {number} samples   titik per kelurahan
 * @return {{coverage: Object, stats: Object}}
 *   coverage[radiusM][kode_pos][kode_kelurahan] = rasio 0..1
 */
function computeCoverage(geo, outlets, radiiM, samples) {
  const radii = (Array.isArray(radiiM) ? radiiM : [radiiM]).slice().sort((a, b) => a - b);
  const maxRadius = radii[radii.length - 1];
  const random = makeRandom(20260813);
  const count = samples || SAMPLES;
  const pinned = outlets.filter((o) => o.lat != null && o.lng != null);

  const coverage = {};
  radii.forEach((r) => {
    coverage[r] = {};
    pinned.forEach((o) => { coverage[r][o.kode_pos] = {}; });
  });

  const pairs = {};
  const touched = {};
  radii.forEach((r) => { pairs[r] = 0; touched[r] = new Set(); });
  let thin = 0;                       // kelurahan yang gagal disampel penuh

  geo.features.forEach((feature) => {
    const villageCode = feature.properties.kode;
    const points = samplePolygon(feature, random, count);
    if (points.length < count) thin++;
    if (!points.length) return;

    // Titik tengah kasar dipakai untuk melewati pos yang jelas terlalu jauh, supaya
    // tidak semua 78 pos diuji terhadap seribu titik di 3.466 kelurahan.
    let sumLng = 0;
    let sumLat = 0;
    points.forEach(([x, y]) => { sumLng += x; sumLat += y; });
    const cx = sumLng / points.length;
    const cy = sumLat / points.length;

    // Sejauh mana titik terjauh dari titik tengah — jari-jari kelurahan.
    let reach = 0;
    points.forEach(([x, y]) => {
      const d = distanceMeters(cy, cx, y, x);
      if (d > reach) reach = d;
    });

    pinned.forEach((outlet) => {
      if (distanceMeters(cy, cx, outlet.lat, outlet.lng) > maxRadius + reach) return;

      // Satu lintasan jarak, dipakai untuk semua ambang.
      const inside = radii.map(() => 0);
      for (const [x, y] of points) {
        const d = distanceMeters(y, x, outlet.lat, outlet.lng);
        for (let i = 0; i < radii.length; i++) if (d <= radii[i]) inside[i]++;
      }

      radii.forEach((r, i) => {
        if (!inside[i]) return;
        const ratio = inside[i] / points.length;
        if (ratio < MIN_RATIO) return;
        coverage[r][outlet.kode_pos][villageCode] = Number(ratio.toFixed(4));
        pairs[r]++;
        touched[r].add(villageCode);
      });
    });
  });

  return {
    coverage,
    stats: {
      outlets: pinned.length,
      skipped: outlets.length - pinned.length,
      radii,
      samples: count,
      pairs,
      villagesTouched: Object.fromEntries(radii.map((r) => [r, touched[r].size])),
      villagesTotal: geo.features.length,
      thinPolygons: thin,
    },
  };
}

/**
 * Bagi penjualan satu pos jadi "dalam jangkauan" dan "di luar".
 *
 * Dipakai build.js untuk memeriksa hasilnya, dan disalin ke app.js untuk dipakai
 * browser. Bentuknya sengaja sederhana supaya kedua sisi tidak bisa menyimpang.
 */
function splitByCoverage(rows, coverage) {
  let inside = 0;
  let total = 0;
  rows.forEach((row) => {
    const ratio = (coverage[row.outlet] || {})[row.village] || 0;
    inside += row.units * ratio;
    total += row.units;
  });
  return { inside, outside: total - inside, total };
}

module.exports = {
  computeCoverage, splitByCoverage, samplePolygon, pointInRing, distanceMeters,
  SAMPLES, MIN_RATIO,
};
