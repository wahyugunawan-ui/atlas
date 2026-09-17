/**
 * Titik KTP / Servis / Pengiriman di peta — bagian yang MURNI.
 *
 * Dipisah dari map.js supaya bisa diuji tanpa browser: map.js menyentuh MapLibre dan
 * DOM, berkas ini tidak menyentuh apa pun. Yang di sini cuma aritmetika dan geometri.
 *
 * KENAPA TITIKNYA DISEBAR, bukan digambar di koordinat aslinya. Titik KTP dan Servis
 * yang tersimpan adalah CENTROID KELURAHAN (lihat docs/FUSION.md 2.3 dan
 * `titikDesa()` di fusion-store.js), bukan titik rumah. Kalau digambar apa adanya,
 * seluruh pelanggan satu kelurahan menumpuk persis di satu piksel dan petanya
 * berbohong: seribu orang terlihat seperti satu. Menyebarnya di dalam poligon
 * kelurahan menunjukkan kepadatan yang sebenarnya, dengan harga yang jujur — posisi
 * di dalam kelurahan itu TIDAK berarti apa-apa, dan tidak boleh dibaca sebagai alamat.
 *
 * Titik pengiriman aslinya memang GPS rumah sungguhan (PII). Justru karena itu yang
 * dipakai di sini tetap agregat per kelurahan, bukan titik aslinya: yang menyeberang
 * dari database PII ke layar hanya hitungan, tidak pernah koordinat rumah. Titik
 * sungguhan hanya muncul di telusur satu Nomor Mesin, yang memang berpagar PII.
 */

/** Tiga jenis titik. `kunci` = nama field di jawaban API, `layer` = id layer MapLibre. */
export const JENIS_TITIK = {
  ktp: { kunci: 'ktp', layer: 'ktp-titik', label: 'Titik KTP' },
  servis: { kunci: 'servis', layer: 'servis-titik', label: 'Titik Servis' },
  kirim: { kunci: 'kirim', layer: 'kirim-titik', label: 'Titik Pengiriman' },
};

/**
 * Pembangkit acak berbenih tetap.
 *
 * Benihnya tetap supaya titik yang sama SELALU muncul di tempat yang sama — kalau
 * diacak ulang tiap kali filter berubah, titiknya melompat-lompat dan orang mengira
 * datanya yang berubah. Ini juga yang menjawab pertanyaan terbuka di docs/FUSION.md
 * 3.1: koordinat tiap titik deterministik, tidak bergeser antar kombinasi toggle.
 *
 * LCG yang sama persis dengan buildSalePoints() di map.js — sengaja, supaya titik
 * penjualan dan titik KTP punya karakter sebaran yang sama.
 */
export function pembangkitAcak(benih) {
  let seed = benih || 991;
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/** Apakah titik ada di dalam cincin poligon (ray casting). */
export function titikDiDalam(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Baris API -> berapa titik yang harus digambar di tiap kelurahan, per dealer.
 *
 * Satu baris API adalah satu (kelurahan, dealer) dengan tiga hitungan sekaligus.
 * Warna titik mengikuti DEALER (registry warna yang sudah ada), jadi dealernya harus
 * ikut terbawa sampai ke sini — bukan cuma totalnya per kelurahan.
 *
 * @param {Array} rows [{villageCode, dealerCode, ktp, servis, kirim}]
 * @param {string} jenis 'ktp' | 'servis' | 'kirim'
 * @returns {Object} { [villageCode]: [{dealer, n}] } — hanya yang n > 0
 */
export function titikPerDesa(rows, jenis) {
  const kunci = (JENIS_TITIK[jenis] || {}).kunci;
  const hasil = {};
  if (!kunci || !Array.isArray(rows)) return hasil;

  rows.forEach((r) => {
    const n = Math.max(0, Math.round(Number(r[kunci]) || 0));
    if (!n) return;                       // nol bukan titik; jangan buat fitur kosong
    const desa = r.villageCode || '';
    if (!desa) return;                    // kelurahan tidak diketahui: tidak bisa digambar
    (hasil[desa] = hasil[desa] || []).push({ dealer: r.dealerCode || '', n });
  });
  return hasil;
}

/**
 * Sebar `jumlah` titik di dalam satu cincin poligon.
 *
 * Kotak pembatas + tolak-yang-di-luar. Poligon kelurahan yang sangat tipis bisa
 * membuat percobaan habis sebelum dapat titik yang sah; yang seperti itu DILEWATI,
 * bukan dipaksa ditaruh di centroid — titik di luar wilayahnya sendiri lebih
 * menyesatkan daripada titik yang tidak digambar.
 *
 * @returns {Array} [[lng, lat], ...] panjangnya bisa KURANG dari `jumlah`
 */
export function sebarDiPoligon(ring, jumlah, rand) {
  const titik = [];
  if (!ring || ring.length < 3 || jumlah <= 0) return titik;

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

  for (let i = 0; i < jumlah; i++) {
    let ok = false;
    for (let coba = 0; coba < 24 && !ok; coba++) {
      const lng = minX + rand() * (maxX - minX);
      const lat = minY + rand() * (maxY - minY);
      if (titikDiDalam(lng, lat, ring)) { titik.push([lng, lat]); ok = true; }
    }
  }
  return titik;
}

/**
 * Ikon kotak kecil, dibuat dari piksel mentah.
 *
 * `docs/FUSION.md` 3.1 meminta titik Servis berbentuk KOTAK, dan `circle` layer
 * MapLibre tidak bisa membuat sudut. Jalan satu-satunya symbol layer dengan ikon yang
 * didaftarkan lewat `map.addImage()` — dan ikonnya harus lahir dari kode, bukan
 * berkas gambar: aturan proyek melarang aset dari internet, dan menambah berkas biner
 * ke repo untuk 12×12 piksel jelas berlebihan.
 *
 * Tepi putih tipis disengaja, sama seperti titik penjualan dan titik Servis versi
 * lingkaran sebelumnya: tanpa itu kotak merah muda hilang di atas basemap satelit
 * yang ramai.
 *
 * @param {number} sisi  panjang sisi dalam piksel
 * @param {number[]} isi  warna isian [r, g, b]
 * @param {number[]} tepi warna tepi [r, g, b]
 * @returns {{width: number, height: number, data: Uint8Array}} bentuk yang diterima
 *   `map.addImage()` apa adanya
 */
export function ikonKotak(sisi, isi, tepi) {
  // Di bawah 3 piksel tidak ada ruang untuk tepi DAN isi; dinaikkan diam-diam lebih
  // baik daripada mengembalikan ikon yang seluruhnya tepi.
  const n = Math.max(3, Math.floor(Number(sisi)) || 12);
  const data = new Uint8Array(n * n * 4);

  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const diTepi = x === 0 || y === 0 || x === n - 1 || y === n - 1;
      const warna = diTepi ? tepi : isi;
      const i = (y * n + x) * 4;
      data[i] = warna[0];
      data[i + 1] = warna[1];
      data[i + 2] = warna[2];
      // Alfa 255 di SELURUH ikon. Alfa nol menghasilkan ikon yang terdaftar dengan
      // sukses, tanpa galat, dan tidak terlihat sama sekali di peta.
      data[i + 3] = 255;
    }
  }
  return { width: n, height: n, data };
}

/**
 * Cincin TERPANJANG tiap kelurahan, dari GeoJSON batas kelurahan.
 *
 * Terpanjang, bukan yang pertama: kelurahan kepulauan disimpan sebagai MultiPolygon,
 * dan bagian pertamanya bisa saja pulau kecil. Menyebar seluruh penduduk ke pulau
 * kecil itu akan terbaca seperti temuan.
 */
export function cincinPerDesa(geo) {
  const hasil = {};
  if (!geo || !geo.features) return hasil;
  geo.features.forEach((f) => {
    if (!f.geometry) return;
    const rings = f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates[0]]
      : (f.geometry.coordinates || []).map((p) => p[0]);
    if (!rings.length) return;
    hasil[f.properties.kode] = rings.reduce((a, b) => (b.length > a.length ? b : a));
  });
  return hasil;
}
