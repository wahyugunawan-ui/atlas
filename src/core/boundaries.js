/**
 * Baca berkas batas wilayah `wilayah_boundaries` jadi GeoJSON.
 *
 * Murni: tidak menyentuh berkas maupun database. Pemanggilnya yang membaca berkas dan
 * menyimpan hasilnya — itu yang membuat penukaran koordinat di bawah bisa diuji tanpa
 * PostgreSQL.
 *
 * BENTUK SUMBER. Berkasnya SQL dari cahyadsn/wilayah_boundaries:
 *
 *     INSERT INTO wilayah_boundaries(kode,nama,lat,lng,path) VALUES
 *     ('33.01.01.2001','Tambakreja',-7.5477,108.7750,'[[[-7.526,108.783],...]]')
 *
 * `path` array JSON, bukan WKB. Kedalamannya dua macam: 3 untuk poligon satu bagian,
 * 4 untuk multipoligon. Dari 284 baris contoh: 275 poligon, 9 multipoligon.
 *
 * KOORDINATNYA [LINTANG, BUJUR] — KEBALIKAN DARI GeoJSON.
 *
 * Itu satu-satunya hal paling berbahaya di seluruh berkas ini. GeoJSON memakai
 * [bujur, lintang]. Kalau tidak ditukar, seluruh Jawa Tengah pindah ke Samudra Hindia
 * di lepas pantai Afrika — dan TIDAK ADA yang melempar error. Poligonnya sah, luasnya
 * masuk akal, databasenya menerima. Yang terjadi cuma jangkauan 0% di mana-mana, yang
 * terlihat seperti temuan bisnis.
 */

/**
 * Satu baris data di berkas sumber.
 *
 * Ditulis sebagai regex, bukan pemecahan per baris: satu baris SQL memuat banyak tupel
 * dan `path` bisa sepanjang ratusan kilobyte tanpa satu pun baris baru.
 */
// Kodenya ditangkap longgar (`[\d.]+`) lalu disaring bentuknya di bawah, BUKAN
// dikenali lewat pola yang ketat di sini. Segmen terakhir kode kelurahan panjangnya
// 4 digit sementara sisanya 2 — pola ketat yang menganggap semuanya 2 digit gagal
// mencocokkan seluruh berkas tanpa satu pun pesan, dan hasilnya nol baris terbaca.
//
// `(?:[^']|'')*` menangani apostrof yang di-escape jadi dua (`D''Apostrof`).
const BARIS = /\('([\d.]+)','((?:[^']|'')*)',(-?[\d.]+),(-?[\d.]+),'(\[.*?\])'\)/gs;

/**
 * Kotak Jawa Tengah + DIY. Dipakai memeriksa arah koordinat, bukan menyaring data.
 *
 * Angkanya DIUKUR dari seluruh 8.999 kelurahan di 40 berkas sumber, bukan ditebak:
 *
 *     lintang  -8,212 .. -5,725
 *     bujur   108,556 .. 111,691
 *
 * Batas utaranya penting dan berlawanan dengan intuisi. Tebakan pertama saya -6,0
 * — masuk akal untuk daratan Jawa — dan penjaganya langsung berbunyi di berkas
 * Jepara. Yang tertangkap ternyata BUKAN kesalahan: empat kelurahan Karimunjawa
 * (Parang, Nyamuk, Kemujan, Karimunjawa) memang kepulauan di Laut Jawa, 90 km di
 * utara pesisir, di lintang -5,7 sampai -5,9. Datanya benar, kotaknya yang salah.
 *
 * Dilebihkan sedikit dari hasil ukur. Tetap jauh lebih ketat daripada yang diperlukan
 * untuk menangkap koordinat tertukar: kalau lintang dan bujur tertukar, lintangnya
 * jadi ~110 — di luar kotak ini dengan selisih puluhan derajat.
 */
const BATAS = { latMin: -8.5, latMax: -5.5, lngMin: 108.0, lngMax: 112.0 };

/**
 * Tukar [lintang, bujur] jadi [bujur, lintang], berapa pun kedalaman sarangnya.
 *
 * Rekursif sampai menemukan pasangan angka. Kedalaman 3 dan 4 dua-duanya ditangani
 * tanpa cabang khusus — cabang khusus untuk kedalaman berarti bentuk ketiga yang
 * muncul nanti akan diproses diam-diam dengan cara yang salah.
 */
function swapCoords(node) {
  if (typeof node[0] === 'number') return [node[1], node[0]];
  return node.map(swapCoords);
}

/** Kedalaman sarang larik: 3 = Polygon, 4 = MultiPolygon. */
function depth(node) {
  let d = 0;
  let q = node;
  while (Array.isArray(q)) { d++; q = q[0]; }
  return d;
}

/**
 * Ubah isi satu berkas SQL jadi daftar fitur GeoJSON.
 *
 * @param {string} sql   isi berkas
 * @param {Object} opts  { districtNames: {kodeKecamatan: nama} }
 * @return {{features: Array, skipped: Array}}
 *   skipped memuat alasan tiap baris yang dilewati — dilaporkan, tidak dibuang diam-diam
 */
function parseBoundaries(sql, opts) {
  const districtNames = (opts || {}).districtNames || {};
  const features = [];
  const skipped = [];

  BARIS.lastIndex = 0;
  let m;
  while ((m = BARIS.exec(sql)) !== null) {
    const [, kode, namaMentah, lat, lng, pathRaw] = m;

    // Berkas kelurahan memuat kode 13 karakter. Kode yang lebih pendek berarti baris
    // kabupaten atau kecamatan yang ikut di berkas yang sama — bukan kesalahan.
    if (!/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(kode)) continue;

    let path;
    try {
      path = JSON.parse(pathRaw);
    } catch {
      skipped.push({ kode, alasan: 'path bukan JSON yang sah' });
      continue;
    }

    const d = depth(path);
    if (d !== 3 && d !== 4) {
      skipped.push({ kode, alasan: `kedalaman sarang ${d}, bukan 3 atau 4` });
      continue;
    }

    const ditukar = swapCoords(path);
    features.push({
      code: kode,
      name: namaMentah.replace(/''/g, "'").trim(),
      districtCode: kode.slice(0, 8),
      districtName: districtNames[kode.slice(0, 8)] || null,
      cityCode: kode.slice(0, 5),
      provinceCode: kode.slice(0, 2),
      lat: Number(lat),
      lng: Number(lng),
      geometry: d === 3
        ? { type: 'Polygon', coordinates: ditukar }
        : { type: 'MultiPolygon', coordinates: ditukar },
    });
  }

  return { features, skipped };
}

/**
 * Peta `kode kecamatan -> nama` dari berkas kecamatan.
 *
 * Nama kecamatan tidak ada di berkas kelurahan, padahal kolom Kecamatan di Master
 * Kelurahan memerlukannya — dan pernah salah menampilkan nama kota selama berminggu.
 */
function parseDistricts(sql, bentuk) {
  const pola = bentuk || /^\d{2}\.\d{2}\.\d{2}$/;
  const peta = {};
  BARIS.lastIndex = 0;
  let m;
  while ((m = BARIS.exec(sql)) !== null) {
    const kode = m[1];
    if (pola.test(kode)) peta[kode] = m[2].replace(/''/g, "'").trim();
  }
  return peta;
}

/**
 * Periksa arah koordinat SEBELUM masuk database.
 *
 * Titik tengah tiap kelurahan harus jatuh di dalam kotak Jawa Tengah + DIY. Kalau
 * lintang dan bujur tertukar, semuanya jatuh jauh di luar — dan ini satu-satunya cara
 * menangkapnya, karena penukaran koordinat tidak pernah menimbulkan error.
 *
 * @return {Array} daftar yang di luar kotak; kosong berarti aman
 */
function checkOrientation(features) {
  return features.filter((f) => {
    const titik = f.geometry.coordinates.flat(f.geometry.type === 'Polygon' ? 1 : 2)[0];
    if (!titik) return true;
    const [lng, lat] = titik;
    return lat < BATAS.latMin || lat > BATAS.latMax ||
           lng < BATAS.lngMin || lng > BATAS.lngMax;
  });
}

module.exports = { parseBoundaries, parseDistricts, checkOrientation, swapCoords, depth, BATAS };
