/**
 * Warna dealer dan kelas heatmap.
 *
 * Dua keputusan yang diambil di meeting 12 Agustus 2026 ada di berkas ini.
 *
 * SATU: tiap dealer dapat warna sendiri, semuanya, tanpa kuota. Validator palet
 * sebelumnya cuma meloloskan 8 warna untuk dibandingkan sembarang di peta, dan itu
 * masih benar — dari warna ke-9 ke atas mata tidak bisa membedakannya dengan andal.
 * Peredamnya bukan di sini melainkan di tampilan: nama dealer SELALU ditempel di
 * sebelah warnanya, di legenda, tabel, treemap, dan tooltip. Warna jadi penanda
 * cepat, bukan satu-satunya sumber informasi.
 *
 * DUA: kelas heatmap dihitung dari PERSENTIL sebaran yang sedang tampil, bukan dari
 * jumlah unit mentah. Akibatnya legendanya tetap masuk akal waktu datanya bertambah,
 * dan — ini yang lebih penting — batasnya ikut berubah waktu filternya diganti.
 * Memfilter satu dealer membuat kelurahan terbaik DEALER ITU yang paling gelap, bukan
 * kelurahan terbaik keseluruhan yang kebetulan juga dilayani dia.
 *
 * Murni: tidak menyentuh DOM. Diuji oleh test/colors.test.js.
 */

/** Ramp volume, terang -> gelap. Lima langkah, satu untuk tiap kelas persentil. */
export const RAMP = ['#cde2fb', '#9ec5f4', '#5598e7', '#256abf', '#104281'];

/** Ramp enam langkah untuk mode heatmap "Per Nilai Kontribusi" (interval tetap). */
export const RAMP6 = ['#e8f0fc', '#cde2fb', '#9ec5f4', '#5598e7', '#256abf', '#104281'];

/**
 * Kelurahan tanpa penjualan. Bukan langkah paling terang dari ramp — "nol" dan
 * "paling sedikit" harus bisa dibedakan, karena kekosongan itu justru yang jadi bahan
 * analisis tim channel.
 */
export const COLOR_EMPTY = '#e1e0d9';

/** Dealer yang tidak dikenal. Tidak pernah dikarang jadi warna acak. */
export const COLOR_UNKNOWN = '#c3c2b7';

/** Label kelas. Persentase, bukan jumlah unit. */
export const CLASS_LABELS = ['20% terbawah', '20–40%', '40–60%', '60–80%', '20% teratas'];

function toHexPair(n) {
  const s = Math.max(0, Math.min(255, Math.round(n))).toString(16);
  return s.length === 1 ? '0' + s : s;
}

function toRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16)];
}

/** Campur dua warna di sRGB. t=0 -> from, t=1 -> to. */
export function mixColor(from, to, t) {
  const a = toRgb(from);
  const b = toRgb(to);
  return '#' + [0, 1, 2].map((i) => toHexPair(a[i] + (b[i] - a[i]) * t)).join('');
}

export function hslToHex(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return toHexPair(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Warna sebanyak yang diminta, disebar merata di roda warna.
 *
 * Sudut emas dipakai supaya dua warna yang berurutan selalu berjauhan — kalau hue-nya
 * dibagi rata berurutan, dealer peringkat 1 dan 2 akan bersebelahan warnanya dan
 * justru paling sering tertukar. Saturasi dan terang diselang-seling supaya tetangga
 * di roda warna masih punya beda kedua selain rona.
 *
 * Mulai dari 205 supaya dealer terbesar dapat biru — sama dengan versi sebelumnya,
 * jadi orang yang sudah pernah melihat dashboard ini tidak perlu belajar ulang.
 */
export function buildPalette(count) {
  const colors = [];
  for (let i = 0; i < count; i++) {
    colors.push(hslToHex(
      (205 + i * 137.508) % 360,
      58 + (i % 3) * 9,
      42 + (i % 4) * 6));
  }
  return colors;
}

/** Ramp 5 langkah dari satu warna, terang -> gelap. */
export function shadeRamp(hex) {
  return [
    mixColor(hex, '#ffffff', 0.82),
    mixColor(hex, '#ffffff', 0.58),
    mixColor(hex, '#ffffff', 0.28),
    hex,
    mixColor(hex, '#0b0b0b', 0.34),
  ];
}

/**
 * Tetapkan warna dealer sekali, dari SELURUH penjualan — bukan dari hasil filter.
 *
 * Kalau peringkatnya dihitung ulang tiap filter, dealer yang bertahan akan berganti
 * warna begitu dealer lain disembunyikan. Warna harus mengikuti dealer, bukan
 * peringkatnya.
 *
 * ponytail: urutan ikut volume total seluruh periode, jadi bisa bergeser waktu bulan
 * baru masuk. Kalau pergeseran itu mengganggu, tambahkan kolom color_order di tabel
 * outlets dan pakai itu sebagai kunci.
 *
 * @param {Array<Object>} sales  baris {dealer, units}
 * @param {Object} dealerNames   dealerCode -> nama
 */
export function buildColorRegistry(sales, dealerNames) {
  const totals = {};
  sales.forEach((row) => {
    if (!row.dealer) return;
    totals[row.dealer] = (totals[row.dealer] || 0) + (Number(row.units) || 0);
  });

  // Dealer tanpa penjualan sama sekali tetap perlu warna — mereka muncul di Master
  // Pos Dealer. Ditambahkan di belakang, urut nama supaya deterministik.
  Object.keys(dealerNames || {}).forEach((code) => {
    if (!(code in totals)) totals[code] = 0;
  });

  // Volume menurun; kode dealer sebagai pemutus supaya hasilnya sama tiap kali.
  const order = Object.keys(totals).sort((a, b) =>
    (totals[b] - totals[a]) || (a < b ? -1 : a > b ? 1 : 0));

  const palette = buildPalette(order.length);
  const colors = {};
  order.forEach((code, i) => { colors[code] = palette[i]; });

  return { colors, order, totals, dealerNames: dealerNames || {} };
}

export function dealerColor(registry, dealerCode) {
  return (registry && registry.colors && registry.colors[dealerCode]) || COLOR_UNKNOWN;
}

/**
 * Batas kelas dari persentil nilai yang sedang tampil.
 *
 * Kelurahan bernilai nol TIDAK ikut dihitung. Kalau ikut, dan 15% kelurahan bernilai
 * nol, keempat batas akan tertarik ke bawah dan kelasnya menumpuk — padahal nol sudah
 * punya warnanya sendiri.
 */
export function percentileBreaks(values) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return [0, 0, 0, 0];
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return [at(0.2), at(0.4), at(0.6), at(0.8)];
}

/** Kelas 0..4 untuk satu nilai; -1 berarti tidak ada penjualan. */
export function classOf(value, breaks) {
  if (!value) return -1;
  for (let i = 0; i < breaks.length; i++) if (value <= breaks[i]) return i;
  return breaks.length;
}

/**
 * Rentang nyata tiap kelas, untuk legenda.
 *
 * Diambil dari nilai yang BENAR-BENAR jatuh di tiap kelas, bukan dihitung dari
 * batasnya. Waktu filternya sempit — misalnya satu pos — hampir semua kelurahan
 * bernilai 1 atau 2 dan keempat batas jatuh di angka yang sama; menyusun label dari
 * batas menghasilkan rentang mustahil seperti "2–1", dan kelas yang memang kosong
 * tampak seolah punya isi.
 */
/**
 * @param {(n: number) => string} [format]  String secara bawaan (unit bulat). Panel
 *   yang nilainya persen (kontribusi penjualan) mengoper formatter sendiri supaya
 *   tidak menampilkan angka desimal panjang mentah.
 */
export function classRanges(values, breaks, format) {
  const fmt = format || String;
  const buckets = RAMP.map(() => []);
  values.forEach((v) => {
    const c = classOf(v, breaks);
    if (c >= 0) buckets[Math.min(c, RAMP.length - 1)].push(v);
  });
  return buckets.map((list) => {
    if (!list.length) return { empty: true, label: '—', count: 0 };
    const lo = Math.min(...list);
    const hi = Math.max(...list);
    return { empty: false, label: lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`, count: list.length };
  });
}
