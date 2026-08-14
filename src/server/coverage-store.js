/**
 * Hitung dan simpan rasio jangkauan — dikerjakan PostGIS, di dalam database.
 *
 * Rasionya: berapa bagian LUAS tiap kelurahan yang masuk lingkaran radius sebuah pos.
 * Dihitung dengan ST_Intersection/ST_Area, jadi eksak terhadap poligon yang ada —
 * bukan diperkirakan dengan menyebar titik seperti sebelumnya.
 *
 * "Eksak" ada batasnya, dan batas itu harus disebut: poligonnya sudah disederhanakan
 * di pipeline Python, dan asumsi "konsumen tersebar merata di dalam kelurahannya"
 * tetap berlaku. Yang hilang cuma derau hitungan, bukan galat model — dan galat model
 * itulah yang paling besar. Kalimat asumsinya tetap dipasang di panel.
 *
 * src/core/coverage.js (sampling) TIDAK dibuang. Dia dipakai prototipe proposal yang
 * tidak punya database, dan jadi pembanding independen untuk hitungan di sini —
 * test/coverage-postgis.test.js membandingkan keduanya.
 */
const store = require('./db');

/**
 * Radius yang dihitung dan disimpan.
 *
 * 5 km acuan proyek; sisanya supaya pengaruh radius bisa ditunjukkan tanpa menghitung
 * ulang. Menambah nilai di sini berarti menjalankan ulang seed-coverage.
 */
const RADII_M = [3000, 5000, 7000, 10000];
const DEFAULT_RADIUS_M = 5000;

/**
 * Rasio di bawah ini tidak disimpan.
 *
 * Tanpa ambang, tiap pos punya baris untuk tiap kelurahan yang lingkarannya sempat
 * menyentuh — 0,0001 pun ikut — dan tabelnya membengkak oleh angka yang tidak pernah
 * mengubah kesimpulan apa pun.
 */
const MIN_RATIO = 0.001;

/**
 * Kehalusan lingkaran radius.
 *
 * ST_Buffer membuat poligon, bukan lingkaran sungguhan. Bawaannya 8 segmen per
 * seperempat lingkaran — segi-32 yang luasnya 0,65% LEBIH KECIL daripada lingkaran
 * yang diwakilinya. Itu persis sebesar galat sampling yang mau dihilangkan dengan
 * pindah ke PostGIS, dan arahnya selalu sama, jadi bias itu tidak pernah saling
 * menghapus. Dengan 32 segmen per seperempat (segi-128) selisihnya turun ke 0,04%.
 */
const QUAD_SEGS = 32;

/**
 * Satu query yang mengisi seluruh tabel.
 *
 * ST_DWithin dipakai untuk menyaring, bukan ST_Distance — hanya ST_DWithin yang
 * memakai indeks GiST. Tanpa itu ini jadi 78 x 3.466 perbandingan poligon penuh.
 *
 * Irisannya dihitung sekali di LATERAL lalu dipakai dua kali (nilai dan saringan);
 * kalau ditulis dua kali di SELECT dan WHERE, ST_Intersection-nya jalan dua kali.
 */
const REBUILD_SQL = `
  INSERT INTO coverage (radius_m, outlet_code, village_code, ratio)
  SELECT r.radius_m, o.outlet_code, v.village_code, x.ratio
  FROM outlets o
  CROSS JOIN unnest($1::int[]) AS r(radius_m)
  JOIN villages v
    ON v.geom_m IS NOT NULL
   AND ST_DWithin(v.geom_m, o.geom_m, r.radius_m)
  CROSS JOIN LATERAL (
    -- LEAST(..., 1) menjepit galat pembulatan. Kelurahan yang seluruhnya di dalam
    -- lingkaran bisa menghasilkan 1,0000000000000002, dan angka itu berujung jadi
    -- "100,0000000000000002% dalam jangkauan" di layar — omong kosong yang lolos
    -- karena bentuknya wajar.
    SELECT LEAST(ST_Area(ST_Intersection(
             v.geom_m,
             ST_Buffer(o.geom_m, r.radius_m, 'quad_segs=${QUAD_SEGS}')
           )) / NULLIF(ST_Area(v.geom_m), 0), 1.0) AS ratio
  ) AS x
  WHERE o.geom_m IS NOT NULL
    AND x.ratio >= $2`;

/**
 * Hitung ulang dan simpan.
 *
 * @param {Object} config        dari config.js. Tidak dipakai lagi untuk membaca berkas
 *                                 geo — geometrinya sudah di database — tapi tetap
 *                                 diterima supaya pemanggilnya tidak berubah.
 * @param {Array<string>} codes  outlet tertentu saja; kosong berarti semuanya
 * @param {Function} onProgress  dipanggil dengan pesan, untuk CLI
 */
async function rebuild(config, codes, onProgress) {
  const db = store.db();
  const log = onProgress || (() => {});
  const only = codes && codes.length ? codes : null;

  const counted = await store.one(db,
    only
      ? 'SELECT COUNT(*) AS n FROM outlets WHERE geom_m IS NOT NULL AND outlet_code = ANY(?)'
      : 'SELECT COUNT(*) AS n FROM outlets WHERE geom_m IS NOT NULL',
    only ? [only] : []);
  if (!counted.n) {
    return { outlets: 0, rows: 0, radii: RADII_M };
  }

  log(`menghitung ${counted.n} outlet × ${RADII_M.length} radius dengan PostGIS...`);

  const rows = await store.transaction(db, async (conn) => {
    // Baris lama outlet ini dibuang dulu. Tanpa itu, memindahkan pin ke tempat lain
    // meninggalkan jangkauan di lokasi yang sudah tidak dipakai — dan angkanya akan
    // tampak wajar, cuma salah.
    if (only) {
      await conn.query('DELETE FROM coverage WHERE outlet_code = ANY(?)', [only]);
    } else {
      await conn.query('DELETE FROM coverage');
    }

    const sql = only
      ? `${REBUILD_SQL} AND o.outlet_code = ANY($3)`
      : REBUILD_SQL;
    const params = only ? [RADII_M, MIN_RATIO, only] : [RADII_M, MIN_RATIO];
    const result = await conn.query(sql, params);
    return result.rowCount;
  });

  return { outlets: counted.n, rows, radii: RADII_M };
}

/**
 * Seluruh isi tabel, dikelompokkan untuk dikirim ke browser:
 *   coverage[radius][outlet_code][village_code] = ratio
 */
async function all() {
  const out = {};
  RADII_M.forEach((r) => { out[r] = {}; });

  const rows = await store.all(store.db(),
    'SELECT radius_m, outlet_code, village_code, ratio FROM coverage');
  rows.forEach((row) => {
    const byRadius = (out[row.radius_m] ||= {});
    (byRadius[row.outlet_code] ||= {})[row.village_code] = row.ratio;
  });
  return out;
}

/** Apakah tabelnya sudah diisi. Dipakai halaman untuk memberi tahu kalau belum. */
async function isEmpty() {
  const row = await store.one(store.db(), 'SELECT COUNT(*) AS n FROM coverage');
  return Number(row.n) === 0;
}

module.exports = {
  rebuild, all, isEmpty, RADII_M, DEFAULT_RADIUS_M, MIN_RATIO, QUAD_SEGS, REBUILD_SQL,
};
