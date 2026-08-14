/**
 * Pembangkit data sintetis untuk prototipe.
 *
 * Dijalankan saat build, bukan di browser. Keluarannya ditanam ke dalam index.html.
 *
 * ANGKA PENJUALANNYA BUKAN DATA ASLI. Prototipe ini akan di-upload ke Netlify, dan
 * URL Netlify bisa dibuka siapa saja termasuk mesin pengindeks. Yang asli di sini cuma
 * geografi (batas kelurahan, nama wilayah) dan nama outlet — nama toko itu informasi
 * publik. Penjualan, nama konsumen, alamat, dan nomor mesin semuanya dikarang.
 *
 * Berbenih tetap: dua kali build menghasilkan angka yang sama persis. Kalau angkanya
 * berubah tiap build, tangkapan layar di proposal tidak akan cocok dengan yang tampil
 * saat demo — dan itu jenis kejanggalan yang ditanyakan orang di ruang rapat.
 */

/**
 * Pembangkit acak berbenih (mulberry32). Math.random() tidak bisa dipakai karena
 * tidak punya benih.
 */
function makeRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROVINCE_NAMES = { '33': 'Jawa Tengah', '34': 'DI Yogyakarta' };

/**
 * 51 hue dibagi rata di roda warna.
 *
 * Diminta di meeting 12 Agustus. Validator palet cuma meloloskan 8 warna untuk
 * dibandingkan sembarang, jadi dari nomor 9 ke atas warnanya TIDAK bisa dibedakan
 * andal dengan mata. Peredamnya bukan di sini melainkan di tampilan: nama dealer
 * selalu menempel di sebelah warnanya, di legenda, tabel, treemap, dan tooltip.
 *
 * Sudut awal 205 supaya dealer terbesar dapat biru — warna yang sama dengan versi
 * sebelumnya, jadi orang yang sudah pernah melihat dashboard ini tidak bingung.
 * Saturasi dan terang diselang-seling supaya hue yang bertetangga tetap punya beda
 * kedua selain rona.
 */
function dealerPalette(count) {
  const colors = [];
  const golden = 137.508;                    // sudut emas: sebaran paling merata
  for (let i = 0; i < count; i++) {
    const hue = (205 + i * golden) % 360;
    const sat = 58 + (i % 3) * 9;            // 58, 67, 76
    const light = 42 + (i % 4) * 6;          // 42, 48, 54, 60
    colors.push(hslToHex(hue, sat, light));
  }
  return colors;
}

function hslToHex(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * value).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/* ==========================================================================
   NAMA KONSUMEN SINTETIS
   ========================================================================== */

const FIRST_NAMES = [
  'Budi', 'Siti', 'Agus', 'Dewi', 'Eko', 'Rina', 'Joko', 'Wati', 'Hendra', 'Yuni',
  'Bambang', 'Sri', 'Slamet', 'Endang', 'Dedi', 'Ani', 'Rudi', 'Lestari', 'Anton',
  'Nur', 'Tri', 'Puji', 'Wahyu', 'Ika', 'Bagus', 'Fitri', 'Arif', 'Ratna', 'Dwi',
  'Muhammad', 'Ahmad', 'Rizki', 'Indah', 'Sugeng', 'Maya', 'Iwan', 'Novi', 'Heri',
];

const LAST_NAMES = [
  'Santoso', 'Wijaya', 'Setiawan', 'Kurniawan', 'Hidayat', 'Nugroho', 'Saputra',
  'Prasetyo', 'Utomo', 'Wibowo', 'Susanto', 'Handoko', 'Firmansyah', 'Maulana',
  'Ramadhan', 'Pratama', 'Permana', 'Hartono', 'Gunawan', 'Purnomo', 'Suryana',
];

const STREETS = [
  'Jl. Melati', 'Jl. Kenanga', 'Jl. Mawar', 'Jl. Anggrek', 'Jl. Cempaka',
  'Jl. Diponegoro', 'Jl. Sudirman', 'Jl. Ahmad Yani', 'Jl. Gatot Subroto',
  'Jl. Kartini', 'Jl. Veteran', 'Jl. Pemuda', 'Jl. Merdeka', 'Jl. Pahlawan',
];

const MOTORCYCLE_TYPES = [
  'BEAT SPORTY CBS', 'VARIO 160 CBS', 'SCOOPY PRESTIGE', 'PCX 160 ABS',
  'GENIO CBS ISS', 'VARIO 125 CBS ISS', 'BEAT DELUXE', 'SUPRA X 125 FI',
  'CB150R STREETFIRE', 'ADV 160 ABS',
];

/* ==========================================================================
   PEMBANGKIT
   ========================================================================== */

/**
 * @param {Array} villages  properti kelurahan: {kode, nama, kode_kota, nama_kota,
 *                          nama_kecamatan, kode_kecamatan, lat, lng}
 * @param {Array} outlets   outlet asli: {kode_pos, nama_pos, kode_dealer,
 *                          nama_dealer, lat, lng, alamat}
 * @param {Array<string>} periods  ['2026-06', '2026-07', '2026-08']
 */
function buildDataset(villages, outlets, periods, seed) {
  const random = makeRandom(seed || 20260812);

  // --- dealer: kumpulkan dari outlet, urutkan supaya warnanya stabil ---
  const dealerMap = {};
  outlets.forEach((o) => {
    if (!dealerMap[o.kode_dealer]) {
      dealerMap[o.kode_dealer] = {
        dealerCode: o.kode_dealer,
        dealerName: o.nama_dealer,
        outletCount: 0,
        weight: 0,
      };
    }
    dealerMap[o.kode_dealer].outletCount++;
  });

  const dealers = Object.values(dealerMap);

  // Bobot dealer: dealer dengan banyak outlet dapat porsi lebih besar, ditambah
  // pengali acak supaya tidak terlihat mekanis. Ini yang membuat peringkatnya
  // menyerupai data asli tanpa memakai angkanya.
  dealers.forEach((d) => {
    d.weight = d.outletCount * (0.6 + random() * 1.8);
  });
  dealers.sort((a, b) => b.weight - a.weight);

  const palette = dealerPalette(dealers.length);
  dealers.forEach((d, i) => { d.color = palette[i]; d.rank = i + 1; });

  const colorByDealer = {};
  dealers.forEach((d) => { colorByDealer[d.dealerCode] = d.color; });

  // --- bobot kelurahan: kota lebih ramai daripada pinggiran ---
  //
  // Diambil dari jarak ke outlet terdekat. Kelurahan dekat outlet dapat bobot besar,
  // yang jauh mengecil. Hasilnya sebaran yang mengelompok di sekitar outlet, persis
  // seperti data penjualan sungguhan — bukan bercak acak yang merata.
  const villageWeight = {};
  villages.forEach((v) => {
    let nearest = Infinity;
    let nearestOutlet = null;
    outlets.forEach((o) => {
      if (o.lat == null) return;
      const d = (o.lat - v.lat) ** 2 + (o.lng - v.lng) ** 2;
      if (d < nearest) { nearest = d; nearestOutlet = o; }
    });
    const km = Math.sqrt(nearest) * 111;

    // Peluruhan /7 km, bukan /12. Dengan /12 hampir seluruh kelurahan kebagian
    // penjualan dan hanya 88 dari 3.466 yang kosong — peta jadi biru rata dan tidak
    // menunjukkan apa pun. Data aslinya meninggalkan 439 kelurahan kosong, dan
    // justru kekosongan itu yang jadi bahan analisis tim channel.
    //
    // Sebagian kelurahan juga sengaja dinolkan meski dekat outlet: di kenyataan ada
    // kelurahan yang memang tidak ada pembelinya bulan itu, bukan cuma yang jauh.
    const quiet = random() < 0.06;
    villageWeight[v.kode] = {
      weight: quiet ? 0 : Math.max(0, Math.exp(-km / 7) * (0.25 + random() * 1.5)),
      nearest: nearestOutlet,
    };
  });

  // --- fakta penjualan per periode ---
  //
  // Baris fakta disimpan sebagai ARRAY, bukan objek: [periodeIndex, kelurahan,
  // outlet, unit]. Dengan 26 ribu baris, nama field yang diulang-ulang menambah
  // megabyte tanpa menambah informasi. Dibongkar lagi jadi objek di browser.
  const facts = [];

  periods.forEach((period, periodIndex) => {
    // Bulan terakhir paling ramai; bulan sebelumnya sedikit lebih sepi, supaya grafik
    // tren punya sesuatu untuk ditampilkan.
    const monthScale = 0.82 + periodIndex * 0.09;

    villages.forEach((v) => {
      const info = villageWeight[v.kode];
      if (!info.nearest) return;
      const expected = info.weight * 15 * monthScale;
      const units = Math.floor(expected + random() * expected * 0.5);
      if (units <= 0) return;

      // Outlet mana yang melayani: yang terdekat paling sering, tapi tidak selalu —
      // wilayah yang diperebutkan memang begitu keadaannya.
      const perOutlet = {};
      for (let i = 0; i < units; i++) {
        const outlet = random() < 0.62
          ? info.nearest
          : outlets[Math.floor(random() * outlets.length)];
        perOutlet[outlet.kode_pos] = (perOutlet[outlet.kode_pos] || 0) + 1;
      }

      Object.keys(perOutlet).forEach((outletCode) => {
        facts.push([periodIndex, v.kode, outletCode, perOutlet[outletCode]]);
      });
    });
  });

  return { dealers, colorByDealer, facts };
}

/**
 * Bahan untuk membangkitkan konsumen DI BROWSER, bukan di sini.
 *
 * 17.710 konsumen lengkap dengan nama, alamat, nomor mesin, dan tipe motor menambah
 * ±6 MB ke berkas hasil — separuh ukurannya, untuk data yang bisa dirakit ulang dari
 * baris fakta yang sudah ada. Yang ditanam cuma daftar katanya; browser yang
 * menyusunnya, dengan benih tetap supaya hasilnya sama tiap kali halaman dibuka.
 */
const WORDS = {
  firstNames: FIRST_NAMES,
  lastNames: LAST_NAMES,
  streets: STREETS,
  types: MOTORCYCLE_TYPES,
};

module.exports = {
  buildDataset, dealerPalette, hslToHex, makeRandom, PROVINCE_NAMES, WORDS,
};
