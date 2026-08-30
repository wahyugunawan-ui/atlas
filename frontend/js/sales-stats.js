/**
 * Kontribusi penjualan kelurahan terhadap kotanya, posisi relatif, dan acuan bisnis.
 *
 * Murni: tidak menyentuh DOM, tidak membaca S langsung — pemanggilnya yang menyaring
 * baris penjualan lewat activeRows() dan mengoper villageByCode. Diuji oleh
 * test/sales-stats.test.js.
 *
 * Posisi relatif memakai ULANG percentileBreaks()/classOf() dari colors.js — mesin
 * yang sama yang sudah dipakai heatmap sejak awal, cuma inputnya sekarang array
 * kontribusi % per kelurahan (relatif terhadap kotanya sendiri), bukan unit mentah.
 */
import { classOf } from './colors.js';

/** Label posisi relatif, indeks 0..4 sama dengan classOf(). Bahasa Indonesia (CLAUDE.md). */
export const POSISI_LABEL = ['Terbawah', 'Bawah', 'Tengah', 'Atas', 'Teratas'];

/**
 * Batas kelas interval TETAP untuk mode "Per Nilai Kontribusi" — beda dari posisi
 * relatif (yang bergantung sebaran), kelas ini sama di mana pun dan kapan pun dipakai.
 * 6 kelas: <=0,02% / <=0,04% / <=0,06% / <=0,08% / <=1% / >1%.
 */
export const KONTRIBUSI_TETAP = [0.02, 0.04, 0.06, 0.08, 1];

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

/** Label posisi relatif untuk satu nilai, atau `null` kalau tidak ada penjualan. */
export function relativePosition(value, breaks) {
  const kelas = classOf(value, breaks);
  return kelas < 0 ? null : POSISI_LABEL[Math.min(kelas, POSISI_LABEL.length - 1)];
}

/**
 * Kelas interval tetap (mode "Per Nilai Kontribusi"). -1 kalau tidak ada data
 * (kontribusi `null`), 0..4 sesuai KONTRIBUSI_TETAP, 5 untuk "lebih dari 1%".
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
