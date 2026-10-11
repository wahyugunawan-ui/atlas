/**
 * Kontribusi penjualan kecamatan/pos terhadap basisnya, posisi relatif, dan acuan
 * bisnis.
 *
 * Satuan wilayahnya KECAMATAN sejak 2026-10-10 (docs/DECISIONS.md): tiap baris
 * penjualan membawa `district`, dan itu satu-satunya kunci wilayah yang dibaca di sini.
 * `village` di baris yang sama cuma untuk menyebar titik di peta — tidak pernah
 * dipakai menghitung.
 *
 * Murni: tidak menyentuh DOM, tidak membaca S langsung — pemanggilnya yang menyaring
 * baris penjualan lewat activeRows() dan mengoper districtByCode. Diuji oleh
 * test/sales-stats.test.js.
 *
 * Posisi relatif memakai ULANG percentileBreaks()/classOf() dari colors.js — mesin
 * yang sama yang sudah dipakai heatmap sejak awal, cuma inputnya beda tergantung
 * pemanggilnya: kontribusi % per kecamatan (relatif terhadap kotanya sendiri) untuk
 * panel kecamatan, atau kontribusi % per outlet (relatif terhadap TOTAL SELURUH pos
 * yang tampil) untuk blok Performa Pos Dealer — lihat bagian PERFORMA POS DEALER di
 * bawah.
 */
import { classOf } from './colors.js';

/** Label posisi relatif, indeks 0..4 sama dengan classOf(). Bahasa Indonesia (CLAUDE.md). */
export const POSISI_LABEL = ['Terbawah', 'Bawah', 'Tengah', 'Atas', 'Teratas'];

/**
 * Kelompokkan baris penjualan per kota, lalu per kecamatan di dalamnya.
 *
 * @param {Array<{district, units}>} rows       baris penjualan yang SUDAH difilter
 * @param {Object} districtByCode                kode -> {cityCode, ...}
 * @return {Map<string, {total: number, districts: Map<string, number>}>}
 */
export function groupByCity(rows, districtByCode) {
  const perCity = new Map();
  (rows || []).forEach((row) => {
    const district = districtByCode[row.district];
    if (!district) return;
    if (!perCity.has(district.cityCode)) {
      perCity.set(district.cityCode, { total: 0, districts: new Map() });
    }
    const kota = perCity.get(district.cityCode);
    kota.total += row.units;
    kota.districts.set(row.district, (kota.districts.get(row.district) || 0) + row.units);
  });
  return perCity;
}

/**
 * % unit kecamatan terhadap total kotanya. `null` kalau kotanya belum punya
 * penjualan sama sekali (dibagi nol) — dilaporkan sebagai "Data belum tersedia",
 * bukan dipaksa jadi 0 atau NaN.
 */
export function contributionPercent(units, cityTotal) {
  if (!cityTotal) return null;
  return (units / cityTotal) * 100;
}

/**
 * Kontribusi % tiap kecamatan yang muncul di `rows`, terhadap total KOTANYA SENDIRI.
 * Dipakai bersama: panel wilayah (Rank/City Average) DAN pewarnaan peta — satu
 * hitungan, dua pemakai, supaya angka di panel dan di peta tidak pernah menyimpang.
 *
 * @return {Map<string, number>} kode kecamatan -> kontribusi %. Kecamatan dari kota
 *   yang totalnya nol TIDAK ikut masuk (bukan NaN).
 */
export function contributionsForRows(rows, districtByCode) {
  const perCity = groupByCity(rows, districtByCode);
  const result = new Map();
  perCity.forEach((kota) => {
    kota.districts.forEach((units, districtCode) => {
      const pct = contributionPercent(units, kota.total);
      if (pct != null) result.set(districtCode, pct);
    });
  });
  return result;
}

/**
 * Unit MUTLAK per kecamatan dari baris yang sedang tampil.
 *
 * Pasangan contributionsForRows() di atas, dan dipakai waktu penyebut "% terhadap
 * kota" justru merusak artinya: saat filter DEALER aktif, satu dealer yang punya 1
 * unit di kota yang totalnya (bagi dealer itu) juga 1 unit menghasilkan kontribusi
 * 100% — jadi kelurahan dengan penjualan paling sedikit tampil paling gelap. Persis
 * yang dilaporkan tim 2026-09-20.
 *
 * Saat tidak ada filter dealer/pos, kontribusi % tetap yang dipakai: penyebutnya
 * berbeda antar kota, dan itu memang disengaja sejak 2026-08-30 supaya kelurahan
 * kecil yang dominan di kotanya sendiri tidak tenggelam di bawah kelurahan bervolume
 * besar dari kota lain.
 *
 * @return {Map<string, number>} kode kecamatan -> jumlah unit. Kecamatan yang tidak
 *   dikenal di districtByCode TIDAK ikut — sama seperti groupByCity().
 */
export function unitsForRows(rows, districtByCode) {
  const hasil = new Map();
  (rows || []).forEach((row) => {
    if (!districtByCode[row.district]) return;
    hasil.set(row.district, (hasil.get(row.district) || 0) + row.units);
  });
  return hasil;
}

/** Label posisi relatif untuk satu nilai, atau `null` kalau tidak ada penjualan. */
export function relativePosition(value, breaks) {
  const kelas = classOf(value, breaks);
  return kelas < 0 ? null : POSISI_LABEL[Math.min(kelas, POSISI_LABEL.length - 1)];
}

/* ==========================================================================
   PERFORMA POS DEALER — kontribusi dan posisi relatif PER POS
   ==========================================================================
   Sejak 2026-08-31 (permintaan Pakbos). Basisnya beda dari kecamatan: kontribusi
   kecamatan relatif terhadap KOTANYA SENDIRI (groupByCity), kontribusi pos relatif
   terhadap TOTAL SELURUH POS yang tampil di filter aktif — dikonfirmasi user waktu
   perencanaan. Posisi relatif TETAP memakai mesin yang sama (percentileBreaks/classOf
   lewat relativePosition()) — tidak ada mesin klasifikasi baru, cuma dipanggil dengan
   input per-outlet.

   Mode "Per Nilai Kontribusi" (interval tetap) dan Acuan Bisnis (selisih/rasio/kelompok
   terhadap acuan) DIHAPUS 2026-10-11 atas permintaan tim; lihat docs/DECISIONS.md.
   ========================================================================== */

/**
 * Kontribusi % tiap nilai `field` (mis. `outlet` atau `district`) yang muncul di
 * `rows`, terhadap total SELURUH `rows` itu — bukan per kota seperti kecamatan biasa
 * (groupByCity). Nilai dari total yang nol TIDAK ikut masuk.
 *
 * @param {Array<Object>} rows   baris penjualan yang SUDAH difilter
 * @param {string} field         nama field pengelompok, mis. 'outlet' atau 'district'
 * @return {Map<string, number>} nilai field -> kontribusi %
 */
function contributionsByField(rows, field) {
  const totals = {};
  let grand = 0;
  (rows || []).forEach((r) => {
    totals[r[field]] = (totals[r[field]] || 0) + r.units;
    grand += r.units;
  });
  const result = new Map();
  Object.keys(totals).forEach((code) => {
    const pct = contributionPercent(totals[code], grand);
    if (pct != null) result.set(code, pct);
  });
  return result;
}

/**
 * Kontribusi % tiap outlet yang muncul di `rows`, terhadap total SELURUH outlet itu.
 * @param {Array<{outlet, units}>} rows  baris penjualan yang SUDAH difilter
 * @return {Map<string, number>} kode outlet -> kontribusi %
 */
export function contributionsByOutlet(rows) { return contributionsByField(rows, 'outlet'); }

/**
 * Kontribusi % tiap kecamatan yang muncul di `rows`, terhadap total SELURUH `rows`
 * itu — dipakai blok "Analisis Penjualan Wilayah". Basisnya SENGAJA bukan kotanya
 * sendiri (beda dari contributionsForRows/districtStats untuk panel kecamatan):
 * `rows` di sini biasanya sudah dipersempit ke satu dealer/pos lewat activeRows(),
 * jadi "relatif terhadap dealer/pos yang difilter" otomatis terjadi tanpa
 * percabangan khusus — dikonfirmasi user waktu perencanaan.
 * @param {Array<{district, units}>} rows  baris penjualan yang SUDAH difilter
 * @return {Map<string, number>} kode kecamatan -> kontribusi %
 */
export function contributionsByDistrict(rows) { return contributionsByField(rows, 'district'); }

/**
 * Bagi penjualan satu pos ke Kec. Tercover 1..N (kecamatan), dari penetapan manual
 * (bukan radius) — lihat backend/server/schema.sql `pos_coverage_district`. Kecamatan
 * yang tidak masuk jenis manapun TIDAK dihitung ke kelompok manapun, tapi TETAP masuk
 * `total` — sisanya adalah "%di luar kec. tercover", dihitung pemanggilnya supaya
 * totalnya selalu genap 100% di layar.
 *
 * Generik untuk jumlah kelompok berapa pun (sejak 2026-10-11 hanya DUA jenis, dulu 8).
 *
 * @param {Array<{district, units}>} rows  baris SATU pos, sudah difilter
 * @param {Object} groupMap  S.posCoverage[outletCode] — {districtCode: 1..groupCount}
 * @param {number} groupCount  jumlah slot, 2 untuk kec. tercover
 * @return {{total: number, percents: number[]}}  percents[0] = kelompok 1, dst.
 */
export function groupSplit(rows, groupMap, groupCount) {
  const units = {};
  for (let i = 1; i <= groupCount; i++) units[i] = 0;
  let total = 0;
  (rows || []).forEach((row) => {
    total += row.units;
    const group = row.district && groupMap ? groupMap[row.district] : undefined;
    if (group >= 1 && group <= groupCount) units[group] += row.units;
  });
  const percents = [];
  for (let i = 1; i <= groupCount; i++) {
    percents.push(contributionPercent(units[i], total) || 0);
  }
  return { total, percents };
}

/**
 * Bulatkan daftar persentase ke `decimals` desimal TANPA merusak jumlahnya: hasilnya
 * selalu menjumlah persis seperti jumlah aslinya (100 kalau ada penjualan), bukan 99,9
 * atau 100,1 akibat pembulatan tiap angka sendiri-sendiri. Metode sisa terbesar: semua
 * angka dibulatkan ke bawah, sisanya dibagikan ke angka dengan pecahan terbesar.
 *
 * @param {number[]} values  persentase mentah (jumlahnya 100, atau 0 kalau tidak ada data)
 * @return {number[]} nilai terbulatkan, urutan sama
 */
export function balancedPercents(values, decimals = 1) {
  const scale = 10 ** decimals;
  const sum = values.reduce((a, b) => a + b, 0);
  const target = Math.round(sum * scale);
  const scaled = values.map((v) => v * scale);
  const floors = scaled.map(Math.floor);
  let sisa = target - floors.reduce((a, b) => a + b, 0);
  const urutan = scaled.map((v, i) => ({ i, frac: v - floors[i] })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < urutan.length && sisa > 0; k++, sisa--) floors[urutan[k].i] += 1;
  return floors.map((v) => v / scale);
}

/**
 * Bagi penjualan satu dealer ke LIMA kategori yang saling lepas (sejak 2026-10-11):
 *
 * 1. Ring 1, Ring 2, Ring 3 — kecamatan milik ring dealer itu. Definisi dan mekanisme
 *    TIDAK berubah, dan ring boleh mencakup kecamatan di kota lain. Ring MENANG atas
 *    semua kategori lain kalau satu kecamatan memenuhi lebih dari satu.
 * 2. Others — di luar Ring 1–3 tapi masih di kota TERDAFTAR dealer (dealers.city_code),
 *    ATAU kecamatan yang ditoleransi (kecamatan tempat dealer berada dan yang berbatasan
 *    langsung dengannya — pengecualian dealer di perbatasan kota).
 * 3. Pelanggaran Wilayah — di luar Ring 1–3, di luar kota dealer, dan bukan kecamatan
 *    yang ditoleransi.
 *
 * Tiap baris jatuh ke TEPAT satu kategori, jadi jumlahnya selalu 100% tanpa hitung
 * ganda. Kota dealer yang tidak tercatat: tidak ada dasar menyebut sesuatu "pelanggaran",
 * jadi sisa non-ring masuk Others dan `kotaTakDikenal` bernilai true supaya layar bisa
 * mengatakannya.
 *
 * @param {Array<{district, units}>} rows  baris SATU dealer, sudah difilter
 * @param {Object} ringMap  S.dealerRings[dealerCode] — {districtCode: 1|2|3}
 * @param {{cityCode: string|null, cityOfDistrict: function(string): (string|null),
 *   tolerated: Set<string>}} dealer  kota terdaftar dealer, pencari kota sebuah
 *   kecamatan, dan himpunan kecamatan yang ditoleransi
 * @return {{total, units: {1,2,3,others,violation}, percent1, percent2, percent3,
 *   percentOthers, percentViolation, kotaTakDikenal: boolean}}
 */
export function dealerRingSplit(rows, ringMap, dealer) {
  const info = dealer || {};
  const units = { 1: 0, 2: 0, 3: 0, others: 0, violation: 0 };
  let total = 0;
  (rows || []).forEach((row) => {
    total += row.units;
    const district = row.district;
    const ring = district && ringMap ? ringMap[district] : undefined;
    if (ring === 1 || ring === 2 || ring === 3) {
      units[ring] += row.units;
      return;
    }
    const diKotaDealer = info.cityCode && info.cityOfDistrict
      && info.cityOfDistrict(district) === info.cityCode;
    const ditoleransi = Boolean(info.tolerated && info.tolerated.has(district));
    if (!info.cityCode || diKotaDealer || ditoleransi) units.others += row.units;
    else units.violation += row.units;
  });
  const pct = (n) => contributionPercent(n, total) || 0;
  return {
    total,
    units,
    percent1: pct(units[1]),
    percent2: pct(units[2]),
    percent3: pct(units[3]),
    percentOthers: pct(units.others),
    percentViolation: pct(units.violation),
    kotaTakDikenal: !info.cityCode,
  };
}

/**
 * Kontribusi tiap POS FISIK terhadap total DEALER-nya.
 *
 * Penyebutnya SELURUH penjualan dealer (termasuk yang dicatat di baris "proxy" tingkat
 * dealer), bukan hanya penjualan pos: jumlah semua pos + sisa yang belum terpetakan ke
 * pos = 100%. Sampai penjualan dicatat per pos, `attributed` bernilai 0 dan pemanggil
 * menampilkan "belum tersedia" — bukan angka karangan.
 *
 * @param {Array<{outlet, units}>} rows  baris dealer ini (seluruh pos + proxy)
 * @param {function(string): boolean} isRealOutlet  true untuk pos fisik
 * @return {{dealerTotal: number, attributed: number, unattributed: number,
 *   perOutlet: Map<string, number>}}  perOutlet: kode pos -> % terhadap total dealer
 */
export function posContributionInDealer(rows, isRealOutlet) {
  const perUnits = new Map();
  let dealerTotal = 0;
  (rows || []).forEach((row) => {
    dealerTotal += row.units;
    if (isRealOutlet(row.outlet)) perUnits.set(row.outlet, (perUnits.get(row.outlet) || 0) + row.units);
  });
  let attributed = 0;
  const perOutlet = new Map();
  perUnits.forEach((units, code) => {
    attributed += units;
    const pct = contributionPercent(units, dealerTotal);
    if (pct != null) perOutlet.set(code, pct);
  });
  return { dealerTotal, attributed, unattributed: dealerTotal - attributed, perOutlet };
}

/**
 * Lima sel jangkauan dealer untuk layar: Ring 1, Ring 2, Ring 3, Others, Pelanggaran
 * Wilayah, dari hasil dealerRingSplit(). Nilainya dibulatkan lewat balancedPercents()
 * supaya jumlah yang TAMPIL tetap 100,0% (bukan 99,9 atau 100,1). Tanpa penjualan sama
 * sekali: "—", bukan lima nol.
 *
 * @return {Array<{label: string, value: string}>}
 */
export function ringCells(split) {
  const ada = split.total > 0;
  const nilai = ada ? balancedPercents([
    split.percent1, split.percent2, split.percent3,
    split.percentOthers, split.percentViolation,
  ]) : [];
  const teks = (i) => (ada ? nilai[i].toFixed(1) + '%' : '—');
  return [
    { label: 'Ring 1', value: teks(0) },
    { label: 'Ring 2', value: teks(1) },
    { label: 'Ring 3', value: teks(2) },
    { label: 'Others', value: teks(3) },
    { label: 'Pelanggaran Wilayah', value: teks(4) },
  ];
}

/* ==========================================================================
   TARGET PENJUALAN (2026-10-11)
   ==========================================================================
   Target disimpan per (bulan, dealer) dalam UNIT. Seksi "Persentase Keberhasilan Target
   Penjualan" membandingkan penjualan yang tampil dengan target dealer-dealer pada rentang
   periode yang sedang dipilih. Murni, diuji test/sales-stats.test.js.
   ========================================================================== */

/** Batas pengaman jumlah bulan yang dienumerasi (20 tahun) — rentang ngawur tidak membekukan halaman. */
const MAKS_BULAN = 240;

/**
 * Daftar bulan 'YYYY-MM' dari `from` sampai `to`, inklusif. Ujung 'ALL' memakai batas data
 * (`periods`, terurut): "sejak awal" = bulan pertama yang ada datanya, "sampai terbaru" =
 * bulan terakhir. Tanpa data dan tanpa batas yang jelas -> daftar kosong, bukan tebakan.
 * Bulan tanpa penjualan di tengah rentang TETAP ikut: targetnya sah walau belum ada
 * penjualan, dan persentasenya memang harus menanggungnya.
 *
 * @param {string} from  'YYYY-MM' atau 'ALL'
 * @param {string} to    'YYYY-MM' atau 'ALL'
 * @param {string[]} periods  bulan-bulan yang punya data, terurut naik
 */
export function monthsBetween(from, to, periods) {
  const ada = periods || [];
  const awal = from && from !== 'ALL' ? from : ada[0];
  const akhir = to && to !== 'ALL' ? to : ada[ada.length - 1];
  if (!awal || !akhir || awal > akhir) return [];

  const out = [];
  let [tahun, bulan] = awal.split('-').map(Number);
  while (out.length < MAKS_BULAN) {
    const kode = `${tahun}-${String(bulan).padStart(2, '0')}`;
    if (kode > akhir) break;
    out.push(kode);
    bulan += 1;
    if (bulan > 12) { bulan = 1; tahun += 1; }
  }
  return out;
}

/**
 * Persentase keberhasilan target per dealer dan total.
 *
 * - `realized` dealer = jumlah unit pada `rows` untuk bulan-bulan `months`.
 * - `target` dealer = jumlah target bulanannya pada `months`; null kalau tidak ada satu pun
 *   bulan yang punya target (BELUM PUNYA TARGET, beda dari target nol).
 * - `percent` = realized / target x 100; null kalau belum punya target atau targetnya nol
 *   (dibagi nol bukan "0%" dan bukan "tak terhingga"). Boleh melewati 100.
 * - TOTAL hanya menghitung dealer yang PUNYA target (dan targetnya > 0): menjumlahkan
 *   penjualan dealer tanpa target ke pembilang menggelembungkan persentasenya. Jumlah dealer
 *   yang dikecualikan dikembalikan supaya layar bisa mengatakannya.
 * - Urutan: persentase terendah dulu (yang tertinggal paling atas); yang belum punya target
 *   di bawah, urut penjualan terbesar.
 *
 * @param {{dealerCodes: string[], rows: Array<{dealer, period, units}>,
 *   targets: Object<string, Object<string, number>>, months: string[]}} masukan
 */
export function targetProgress({ dealerCodes, rows, targets, months }) {
  const bulan = new Set(months);
  const terjual = {};
  (rows || []).forEach((r) => {
    if (bulan.has(r.period)) terjual[r.dealer] = (terjual[r.dealer] || 0) + r.units;
  });

  const perDealer = (dealerCodes || []).map((code) => {
    let target = null;
    months.forEach((m) => {
      const t = targets && targets[m] ? targets[m][code] : undefined;
      if (t !== undefined && t !== null) target = (target || 0) + Number(t);
    });
    const realized = terjual[code] || 0;
    return {
      code,
      realized,
      target,
      percent: target ? (realized / target) * 100 : null,
    };
  });

  perDealer.sort((a, b) => {
    if (a.percent == null && b.percent == null) return b.realized - a.realized;
    if (a.percent == null) return 1;
    if (b.percent == null) return -1;
    return a.percent - b.percent;
  });

  const bertarget = perDealer.filter((d) => d.target);
  const targetTotal = bertarget.reduce((s, d) => s + d.target, 0);
  const realizedBertarget = bertarget.reduce((s, d) => s + d.realized, 0);
  return {
    perDealer,
    total: {
      realized: perDealer.reduce((s, d) => s + d.realized, 0),
      realizedBertarget,
      target: targetTotal,
      percent: targetTotal ? (realizedBertarget / targetTotal) * 100 : null,
      dealerTotal: perDealer.length,
      dealerBertarget: bertarget.length,
    },
  };
}
