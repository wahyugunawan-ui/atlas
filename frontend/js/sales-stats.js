/**
 * Kontribusi penjualan kelurahan/pos terhadap basisnya, posisi relatif, dan acuan
 * bisnis.
 *
 * Murni: tidak menyentuh DOM, tidak membaca S langsung — pemanggilnya yang menyaring
 * baris penjualan lewat activeRows() dan mengoper villageByCode. Diuji oleh
 * test/sales-stats.test.js.
 *
 * Posisi relatif memakai ULANG percentileBreaks()/classOf() dari colors.js — mesin
 * yang sama yang sudah dipakai heatmap sejak awal, cuma inputnya beda tergantung
 * pemanggilnya: kontribusi % per kelurahan (relatif terhadap kotanya sendiri) untuk
 * panel kelurahan, atau kontribusi % per outlet (relatif terhadap TOTAL SELURUH pos
 * yang tampil) untuk blok Performa Pos Dealer — lihat bagian PERFORMA POS DEALER di
 * bawah.
 */
import { classOf } from './colors.js';

/** Label posisi relatif, indeks 0..4 sama dengan classOf(). Bahasa Indonesia (CLAUDE.md). */
export const POSISI_LABEL = ['Terbawah', 'Bawah', 'Tengah', 'Atas', 'Teratas'];

/**
 * Batas kelas interval TETAP untuk mode Static ("Static Relative Tiering by Total
 * Sales per City") — beda dari posisi relatif (yang bergantung sebaran), kelas ini
 * sama di mana pun dan kapan pun dipakai.
 *
 * Sejak 2026-08-31: 5 kelas, bukan 6 — permintaan Pakbos. Ambang angkanya SAMA PERSIS
 * (0,02/0,04/0,06/0,08), cuma kelas ke-5 dan ke-6 lama ("0,081–1%" dan "Lebih dari 1%")
 * DIGABUNG jadi satu kelas "top" di atas 0,08%.
 */
export const KONTRIBUSI_TETAP = [0.02, 0.04, 0.06, 0.08];

/** Label tetap mode Static — SATU indeks dengan fixedContributionClass(). */
export const KONTRIBUSI_LABEL = [
  '0–0,02%', '0,021–0,04%', '0,041–0,06%', '0,061–0,08%', 'Lebih dari 0,08%',
];

/**
 * Kelompokkan baris penjualan per kota, lalu per kelurahan di dalamnya.
 *
 * @param {Array<{village, units}>} rows        baris penjualan yang SUDAH difilter
 * @param {Object} villageByCode                 kode -> {cityCode, ...}
 * @return {Map<string, {total: number, villages: Map<string, number>}>}
 */
export function groupByCity(rows, villageByCode) {
  const perCity = new Map();
  (rows || []).forEach((row) => {
    const village = villageByCode[row.village];
    if (!village) return;
    if (!perCity.has(village.cityCode)) {
      perCity.set(village.cityCode, { total: 0, villages: new Map() });
    }
    const kota = perCity.get(village.cityCode);
    kota.total += row.units;
    kota.villages.set(row.village, (kota.villages.get(row.village) || 0) + row.units);
  });
  return perCity;
}

/**
 * % unit kelurahan terhadap total kotanya. `null` kalau kotanya belum punya
 * penjualan sama sekali (dibagi nol) — dilaporkan sebagai "Data belum tersedia",
 * bukan dipaksa jadi 0 atau NaN.
 */
export function contributionPercent(villageUnits, cityTotal) {
  if (!cityTotal) return null;
  return (villageUnits / cityTotal) * 100;
}

/**
 * Kontribusi % tiap kelurahan yang muncul di `rows`, terhadap total KOTANYA SENDIRI.
 * Dipakai bersama: panel wilayah (Rank/City Average) DAN pewarnaan peta — satu
 * hitungan, dua pemakai, supaya angka di panel dan di peta tidak pernah menyimpang.
 *
 * @return {Map<string, number>} kode kelurahan -> kontribusi %. Kelurahan dari kota
 *   yang totalnya nol TIDAK ikut masuk (bukan NaN).
 */
export function contributionsForRows(rows, villageByCode) {
  const perCity = groupByCity(rows, villageByCode);
  const result = new Map();
  perCity.forEach((kota) => {
    kota.villages.forEach((units, villageCode) => {
      const pct = contributionPercent(units, kota.total);
      if (pct != null) result.set(villageCode, pct);
    });
  });
  return result;
}

/** Label posisi relatif untuk satu nilai, atau `null` kalau tidak ada penjualan. */
export function relativePosition(value, breaks) {
  const kelas = classOf(value, breaks);
  return kelas < 0 ? null : POSISI_LABEL[Math.min(kelas, POSISI_LABEL.length - 1)];
}

/**
 * Kelas interval tetap (mode Static). -1 kalau tidak ada data (kontribusi `null`),
 * 0..3 sesuai KONTRIBUSI_TETAP, 4 untuk "lebih dari 0,08%".
 */
export function fixedContributionClass(percent) {
  if (percent == null || !Number.isFinite(percent)) return -1;
  for (let i = 0; i < KONTRIBUSI_TETAP.length; i++) {
    if (percent <= KONTRIBUSI_TETAP[i]) return i;
  }
  return KONTRIBUSI_TETAP.length;
}

/** Selisih dari Acuan, dalam poin persentase. `null` kalau salah satu nilainya tidak ada. */
export function referenceGap(contributionPct, benchmarkPct) {
  if (contributionPct == null || benchmarkPct == null) return null;
  return contributionPct - benchmarkPct;
}

/** Rasio terhadap Acuan, dalam persen (100 = tepat sama dengan acuan). */
export function referenceRatio(contributionPct, benchmarkPct) {
  if (contributionPct == null || !benchmarkPct) return null;
  return (contributionPct / benchmarkPct) * 100;
}

/* ==========================================================================
   PERFORMA POS DEALER — kontribusi, posisi relatif, dan acuan bisnis PER POS
   ==========================================================================
   Sejak 2026-08-31 (permintaan Pakbos). Basisnya beda dari kelurahan: kontribusi
   kelurahan relatif terhadap KOTANYA SENDIRI (groupByCity), kontribusi pos relatif
   terhadap TOTAL SELURUH POS yang tampil di filter aktif — dikonfirmasi user waktu
   perencanaan. Posisi relatif dan acuan bisnis TETAP memakai mesin yang sama
   (percentileBreaks/classOf lewat relativePosition(), referenceGap()) — tidak ada
   mesin klasifikasi baru, cuma dipanggil dengan input per-outlet.
   ========================================================================== */

/**
 * Kontribusi % tiap nilai `field` (mis. `outlet` atau `village`) yang muncul di
 * `rows`, terhadap total SELURUH `rows` itu — bukan per kota seperti kelurahan biasa
 * (groupByCity). Nilai dari total yang nol TIDAK ikut masuk.
 *
 * @param {Array<Object>} rows   baris penjualan yang SUDAH difilter
 * @param {string} field         nama field pengelompok, mis. 'outlet' atau 'village'
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
 * Kontribusi % tiap desa yang muncul di `rows`, terhadap total SELURUH `rows` itu —
 * dipakai blok "Analisis Penjualan Wilayah". Basisnya SENGAJA bukan kotanya sendiri
 * (beda dari contributionsForRows/villageStats yang sudah ada untuk panel
 * kelurahan): `rows` di sini biasanya sudah dipersempit ke satu dealer/pos lewat
 * activeRows(), jadi "relatif terhadap dealer/pos yang difilter" otomatis terjadi
 * tanpa percabangan khusus — dikonfirmasi user waktu perencanaan.
 * @param {Array<{village, units}>} rows  baris penjualan yang SUDAH difilter
 * @return {Map<string, number>} kode desa -> kontribusi %
 */
export function contributionsByVillage(rows) { return contributionsByField(rows, 'village'); }

/**
 * Kelompok Business Reference dari selisih (referenceGap()) — cuma tandanya yang
 * menentukan kelompok, bukan ambang baru. `null` kalau gap-nya tidak ada (salah satu
 * dari kontribusi/acuan tidak tersedia).
 */
export function businessReferenceGroup(gap) {
  if (gap == null) return null;
  if (gap > 0) return 'Di Atas Acuan';
  if (gap < 0) return 'Di Bawah Acuan';
  return 'Sesuai Acuan';
}

/**
 * Bagi penjualan satu pos ke coverage 1..8 (kecamatan), dari penetapan manual (bukan
 * radius) — lihat backend/server/schema.sql `pos_coverage_district`. Kecamatan yang
 * tidak masuk coverage manapun TIDAK dihitung ke kelompok manapun, tapi TETAP masuk
 * `total` — sisanya adalah "%di luar semua coverage", dihitung pemanggilnya supaya
 * totalnya selalu genap 100% di layar.
 *
 * Generik untuk jumlah kelompok berapa pun (dipakai coverage pos, 8 kelompok) —
 * bedanya dari ring dealer (yang punya bucket tambahan "coverage gabungan" dan aturan
 * prioritas) cukup besar untuk dipisah sebagai dealerRingSplit() sendiri di bawah,
 * bukan dipaksa satu fungsi dengan banyak cabang.
 *
 * @param {Array<{village, units}>} rows  baris SATU pos, sudah difilter
 * @param {Object} groupMap  S.posCoverage[outletCode] — {districtCode: 1..groupCount}
 * @param {Object} villageByCode  S.villageByCode — {villageCode: {districtCode, ...}}
 * @param {number} groupCount  jumlah slot, 8 untuk coverage pos
 * @return {{total: number, percents: number[]}}  percents[0] = kelompok 1, dst.
 */
export function groupSplit(rows, groupMap, villageByCode, groupCount) {
  const units = {};
  for (let i = 1; i <= groupCount; i++) units[i] = 0;
  let total = 0;
  (rows || []).forEach((row) => {
    total += row.units;
    const district = villageByCode ? (villageByCode[row.village] || {}).districtCode : undefined;
    const group = district && groupMap ? groupMap[district] : undefined;
    if (group >= 1 && group <= groupCount) units[group] += row.units;
  });
  const percents = [];
  for (let i = 1; i <= groupCount; i++) {
    percents.push(contributionPercent(units[i], total) || 0);
  }
  return { total, percents };
}

/**
 * Bagi penjualan satu dealer ke Ring 1/2/3 (kecamatan milik dealer itu) dan "Coverage
 * gabungan" (union kecamatan dari seluruh coverage pos cabangnya). Kalau satu
 * kecamatan masuk ring DAN coverage gabungan sekaligus, RING MENANG — dikonfirmasi
 * user waktu perencanaan (2026-08-31). Kecamatan yang tidak masuk keduanya TIDAK
 * dihitung ke kelompok manapun, tapi TETAP masuk `total`.
 *
 * @param {Array<{village, units}>} rows  baris SATU dealer, sudah difilter
 * @param {Object} ringMap  S.dealerRings[dealerCode] — {districtCode: 1|2|3}
 * @param {Set<string>} coverageDistricts  union kecamatan dari S.posCoverage milik
 *   seluruh pos dealer ini — dibangun pemanggilnya (butuh S.outletByCode)
 * @param {Object} villageByCode  S.villageByCode — {villageCode: {districtCode, ...}}
 * @return {{total: number, percent1: number, percent2: number, percent3: number,
 *   percentCoverage: number}}
 */
export function dealerRingSplit(rows, ringMap, coverageDistricts, villageByCode) {
  const units = { 1: 0, 2: 0, 3: 0, coverage: 0 };
  let total = 0;
  (rows || []).forEach((row) => {
    total += row.units;
    const district = villageByCode ? (villageByCode[row.village] || {}).districtCode : undefined;
    const ring = district && ringMap ? ringMap[district] : undefined;
    if (ring === 1 || ring === 2 || ring === 3) {
      units[ring] += row.units;
    } else if (district && coverageDistricts && coverageDistricts.has(district)) {
      units.coverage += row.units;
    }
  });
  return {
    total,
    percent1: contributionPercent(units[1], total) || 0,
    percent2: contributionPercent(units[2], total) || 0,
    percent3: contributionPercent(units[3], total) || 0,
    percentCoverage: contributionPercent(units.coverage, total) || 0,
  };
}
