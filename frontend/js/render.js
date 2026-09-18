/**
 * KPI, legenda, treemap, dan panel peringkat.
 */
import {
  COLOR_EMPTY, RAMP, classRanges, dealerColor, percentileBreaks,
} from './colors.js';
import { KARESIDENAN } from './config.js';
import { $, esc, formatNumber, formatPercent, sumBy } from './dom.js';
import {
  activeRows, applyScope, clearScope, pageFilters, scopeLabel, scopeValue,
} from './filters.js';
import {
  businessReferenceGroup, contributionsByOutlet, contributionsByVillage,
  dealerRingSplit, fixedContributionClass, groupSplit, KONTRIBUSI_LABEL, POSISI_LABEL,
  referenceGap, relativePosition,
} from './sales-stats.js';
import { posisiBadgeHtml } from './tables.js';
import { S } from './state.js';


/**
 * Label tier legenda peta — HANYA di sini, TIDAK menimpa POSISI_LABEL
 * (Terbawah/Bawah/Tengah/Atas/Teratas): badge di panel kelurahan, ringkasan kota, dan
 * blok Performa Pos Dealer tetap memakai istilah itu, cuma legenda peta yang berbeda.
 *
 * Sampai 2026-09-17 istilahnya Inggris (bottom/lower/middle/upper/top, permintaan
 * Pakbos 2026-08-31). Diganti Indonesia + warna teks per permintaan tim: empat kelas
 * bawah memakai kata posisi (Terbawah/Bawah/Tengah/Atas), kelas TERATAS sengaja diberi
 * nama "Hijau" — bukan "Teratas" — supaya kelas terbaik langsung dikenali dari
 * namanya sendiri, bukan cuma dari swatch warnanya.
 *
 * Warna TEKS-nya (bukan cuma swatch-nya) ikut permintaan: merah di kelas terburuk,
 * hijau di kelas terbaik — tangga warna yang sama arahnya dengan RAMP di colors.js
 * (terang -> gelap = kontribusi kecil -> besar), supaya membaca cepat tanpa perlu
 * mencocokkan swatch satu per satu.
 */
const MAP_TIER_LABEL = ['Terbawah', 'Bawah', 'Tengah', 'Atas', 'Hijau'];
const MAP_TIER_TEXT_COLOR = [
  'text-red-600', 'text-orange-600', 'text-slate-500', 'text-blue-600', 'text-emerald-600',
];

/** Judul panel legenda — mengikuti S.heatmapMode. */
function legendTitle() {
  return S.heatmapMode === 'fixed'
    ? 'Static Relative Tiering by Total Sales per City'
    : 'Dynamic Relative Tiering by Sales';
}

/**
 * Legenda persentil.
 *
 * Rentang tiap kelas diambil dari nilai yang benar-benar jatuh di kelas itu, bukan
 * dihitung dari batasnya — lihat classRanges() di colors.js untuk alasannya.
 *
 * `perVillage` sejak 2026-08-30 berisi Kontribusi Penjualan (%), bukan unit mentah —
 * lihat paintChoropleth() di map.js. Dua mode, S.heatmapMode:
 * - 'relative' ("Dynamic Relative Tiering by Sales"): lima kelas PERSENTIL dari
 *   sebaran yang sedang tampil (colors.js) — tiap kelas ~20% dari titik yang ada.
 * - 'fixed' ("Static Relative Tiering by Total Sales per City"): lima kelas interval
 *   TETAP (sales-stats.js KONTRIBUSI_TETAP), sama di mana pun dan kapan pun — beda
 *   mesin dari relative, jadi rendernya terpisah, bukan cuma ganti label.
 */
export function renderLegend(perVillage, breaks) {
  if ($('legend-title')) $('legend-title').textContent = legendTitle();

  const values = Object.values(perVillage).filter((v) => v > 0);
  const kosong = `<div class="flex items-center gap-2 text-[11px] text-slate-500">` +
    `<span class="w-3.5 h-3.5 rounded shrink-0" style="background:${COLOR_EMPTY}"></span>` +
    `<span class="flex-1">No Sales</span>` +
    `<span class="mono text-slate-400">${esc(formatNumber(S.villages.length - values.length))}</span></div>`;

  if (S.heatmapMode === 'fixed') {
    const counts = new Array(KONTRIBUSI_LABEL.length).fill(0);
    values.forEach((v) => {
      const cls = fixedContributionClass(v);
      if (cls >= 0) counts[Math.min(cls, KONTRIBUSI_LABEL.length - 1)]++;
    });
    $('legend').innerHTML = kosong +
      RAMP.map((color, i) =>
        `<div class="flex items-center gap-2 text-[11px] ${counts[i] ? 'text-slate-600' : 'text-slate-300'}" ` +
        `title="Interval tetap, sama di mana pun dan kapan pun dipakai — tidak bergantung wilayah lain yang sedang tampil.">` +
        `<span class="w-3.5 h-3.5 rounded shrink-0" style="background:${color}"></span>` +
        `<span class="flex-1 font-semibold ${MAP_TIER_TEXT_COLOR[i]}">${esc(MAP_TIER_LABEL[i])}</span>` +
        `<span class="flex-1">: ${esc(KONTRIBUSI_LABEL[i])}</span>` +
        `<span class="mono ${counts[i] ? 'text-slate-400' : 'text-slate-300'}">${esc(formatNumber(counts[i]))}</span></div>`).join('') +
      `<p class="text-[10px] text-slate-400 pt-1.5 leading-snug">` +
      `Interval Kontribusi Penjualan TETAP — sama di mana pun dan kapan pun, tidak bergantung wilayah lain yang sedang tampil.</p>`;
    return;
  }

  const ranges = classRanges(values, breaks, (n) => formatPercent(n));
  const used = ranges.filter((r) => !r.empty).length;
  // Batas persentil tetap (0-20% / 21-40% / ... / 81-100%) walau kelas yang TERPAKAI
  // bisa kurang dari lima kalau sebarannya sempit — lihat catatan "used < RAMP.length"
  // di bawah. Keterangannya menjelaskan definisi persentilnya, bukan hasil hitungnya.
  const TIER_INFO = ['20% dari titik yang ada', '21–40% dari titik yang ada',
    '41–60% dari titik yang ada', '61–80% dari titik yang ada',
    '81–100% dari titik yang ada'];

  $('legend').innerHTML = kosong +
    RAMP.map((color, i) =>
      `<div class="flex items-center gap-2 text-[11px] ${ranges[i].empty ? 'text-slate-300' : 'text-slate-600'}" ` +
      `title="${esc(TIER_INFO[i])}">` +
      `<span class="w-3.5 h-3.5 rounded shrink-0" style="background:${color}"></span>` +
      `<span class="flex-1 font-semibold ${ranges[i].empty ? 'text-slate-300' : MAP_TIER_TEXT_COLOR[i]}">${
        esc(MAP_TIER_LABEL[i])}</span>` +
      `<span class="mono ${ranges[i].empty ? 'text-slate-300' : 'text-slate-400'}">${esc(ranges[i].label)}</span></div>`).join('') +
    `<p class="text-[10px] text-slate-400 pt-1.5 leading-snug">` +
    (used < RAMP.length && values.length
      ? `Sebarannya terlalu sempit untuk lima kelas — ${used} kelas terpakai. ` : '') +
    `Kelas dihitung dari sebaran Kontribusi Penjualan yang sedang tampil, jadi ikut berubah waktu filternya diganti.</p>`;
}

/** Legenda dealer. Nama SELALU menempel di sebelah warnanya. */
export function renderDealerLegend(rows) {
  const totals = sumBy(rows, 'dealer');
  const order = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);

  $('legend-dealer').innerHTML = order.length ? order.map((code) =>
    `<div class="flex items-center gap-2 text-[11px]">` +
    `<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${esc(dealerColor(S.registry, code))}"></span>` +
    `<span class="flex-1 truncate text-slate-600">${esc(S.dealerNames[code] || code)}</span>` +
    `<span class="mono text-slate-400">${esc(formatNumber(totals[code]))}</span></div>`).join('')
    : '<p class="text-[11px] text-slate-400">Tidak ada dealer pada filter ini.</p>';
}

/* ==========================================================================
   ANALISIS PERFORMA POS DEALER
   ==========================================================================
   Sejak 2026-08-31 pagi (permintaan Pakbos): persentase "dalam/luar radius jangkauan"
   diganti total jadi %ring 1/2/3, ditambah %Sales Contribution, Kelompok Relative
   Position, dan Kelompok Business Reference per pos. Sejak 2026-08-31 SORE, ring
   pindah ke DEALER (lihat dealerScopeSummary di bawah) dan blok performa per-POS ini
   memakai COVERAGE 1-8 (kecamatan) sebagai gantinya — lihat docs/DECISIONS.md.
   Semuanya relatif terhadap TOTAL SELURUH POS yang tampil di filter aktif, dihitung
   lewat fungsi murni sales-stats.js (tidak ada mesin klasifikasi baru, cuma dipanggil
   dengan input per-outlet).
   ========================================================================== */

/**
 * @return {{list: Array, counts: Object}} `list` sudah disaring S.performanceGroupFilter
 *   dan diurutkan; `counts` (jumlah per POSISI_LABEL) dihitung SEBELUM penyaringan itu,
 *   supaya board 5-kelompok tetap menunjukkan kelima angka walau salah satu diklik.
 */
function performanceByOutlet(rows) {
  const byOutlet = {};
  rows.forEach((r) => { (byOutlet[r.outlet] ||= []).push(r); });

  const kontribusi = contributionsByOutlet(rows);
  const breaks = percentileBreaks([...kontribusi.values()]);

  const all = Object.keys(byOutlet).map((code) => {
    const outletRows = byOutlet[code];
    const outlet = S.outletByCode[code] || {};
    const units = outletRows.reduce((sum, r) => sum + r.units, 0);
    const contribution = kontribusi.has(code) ? kontribusi.get(code) : null;
    const posisi = contribution == null ? null : relativePosition(contribution, breaks);
    const gap = referenceGap(contribution, S.businessReferencePercent);
    const cover = groupSplit(outletRows, S.posCoverage[code], S.villageByCode, 8);

    return {
      code,
      name: outlet.name || code,
      dealer: outlet.dealerName || '',
      color: dealerColor(S.registry, outlet.dealerCode),
      units,
      contribution,
      posisi,
      acuanGroup: businessReferenceGroup(gap),
      coveragePercents: cover.percents, // indeks 0..7 = Coverage 1..8
      percentLuarCoverage: 100 - cover.percents.reduce((a, b) => a + b, 0),
    };
  });

  const counts = {};
  POSISI_LABEL.forEach((label) => { counts[label] = 0; });
  all.forEach((item) => { if (item.posisi) counts[item.posisi]++; });

  // Peringkat per coverage dihitung dari SELURUH pos (`all`), bukan dari hasil saring
  // kelompok — mengklik satu kartu di board tidak boleh mengubah arti "peringkat 3
  // dari 25", cuma mempersempit pos MANA yang ditampilkan.
  const idx = S.performanceCoverageFocus - 1;
  const coverageSorted = [...all].sort((a, b) => b.coveragePercents[idx] - a.coveragePercents[idx]);
  const coverageRank = new Map(coverageSorted.map((item, i) => [item.code, i + 1]));
  all.forEach((item) => {
    item.coverageRank = coverageRank.get(item.code);
    item.coverageRankTotal = all.length;
  });

  const filtered = S.performanceGroupFilter
    ? all.filter((item) => item.posisi === S.performanceGroupFilter)
    : all;

  filtered.sort((a, b) => {
    const desc = S.performanceSort === 'desc';
    if (S.performanceCriteria === 'coverage') {
      return desc ? b.coveragePercents[idx] - a.coveragePercents[idx]
        : a.coveragePercents[idx] - b.coveragePercents[idx];
    }
    return desc ? b.units - a.units : a.units - b.units;
  });

  return { list: filtered, counts };
}

/**
 * Balik urutan daftar performa.
 *
 * Urutannya sebenarnya SUDAH terkecil-dulu sejak awal, tapi tidak ada yang menuliskan
 * itu di layar — jadi tidak ada yang tahu, dan tidak ada yang bisa membaliknya waktu
 * ingin melihat pos yang paling baik. Tombolnya menjawab dua-duanya sekaligus.
 */
export function togglePerformanceSort() {
  S.performanceSort = S.performanceSort === 'asc' ? 'desc' : 'asc';
  window.renderAll();
}

/** @param {'units'|'ring'} criteria */
export function setPerformanceCriteria(criteria) {
  if (criteria !== 'units' && criteria !== 'ring') return;
  S.performanceCriteria = criteria;
  window.renderAll();
}

/** @param {number} num 1..8 */
export function setPerformanceCoverageFocus(num) {
  const nomor = Number(num);
  if (nomor < 1 || nomor > 8) return;
  S.performanceCoverageFocus = nomor;
  window.renderAll();
}

/** Klik kartu board: kelompok yang sama lagi = matikan (tampilkan semua lagi). */
export function filterPerformanceGroup(label) {
  S.performanceGroupFilter = S.performanceGroupFilter === label ? null : label;
  window.renderAll();
}

/**
 * Kriteria + coverage fokus + arah urut — WAJIB tertulis di layar (Pakbos eksplisit:
 * "diinformasikan ring berapa", sekarang coverage berapa sejak ring pindah ke dealer).
 * Sama untuk panel normal, layar penuh peta, dan tampilan besar (Pakbos: sort harus
 * jalan di baik layar penuh maupun tidak).
 */
function performanceControlsHtml() {
  const crit = S.performanceCriteria;
  const cov = S.performanceCoverageFocus;
  const desc = S.performanceSort === 'desc';
  const btn = (active) => 'px-2 py-1 rounded-md ' +
    (active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500');
  const label = crit === 'coverage'
    ? `Diurutkan berdasar %Coverage ${cov} ${desc ? 'terbesar' : 'terkecil'}`
    : `Diurutkan berdasar total sales ${desc ? 'terbesar' : 'terkecil'}`;

  return `<div class="flex items-center gap-1.5 flex-wrap mb-2">` +
    `<div class="flex bg-slate-100 rounded-lg p-0.5 text-[10px] font-bold">` +
    `<button onclick="setPerformanceCriteria('units')" class="${btn(crit === 'units')}">Total Sales</button>` +
    `<button onclick="setPerformanceCriteria('coverage')" class="${btn(crit === 'coverage')}">Coverage</button>` +
    `</div>` +
    (crit === 'coverage'
      ? `<div class="flex bg-slate-100 rounded-lg p-0.5 text-[10px] font-bold">` +
        Array.from({ length: 8 }, (_, i) => i + 1).map((c) =>
          `<button onclick="setPerformanceCoverageFocus(${c})" class="${btn(cov === c)}">${c}</button>`).join('') +
        `</div>`
      : '') +
    `<span class="text-[10px] text-slate-400">${esc(label)}</span>` +
    `</div>`;
}

/** Board ringkas 5 kelompok Relative Position. Klik satu kartu menyaring daftar di bawahnya. */
function performanceGroupBoard(counts) {
  return `<div class="grid grid-cols-5 gap-1.5 mb-2">` +
    POSISI_LABEL.map((label) => {
      const aktif = S.performanceGroupFilter === label;
      return `<button onclick="filterPerformanceGroup('${esc(label)}')" ` +
        `class="rounded-lg border px-1 py-1.5 text-center ${aktif ? 'border-slate-800 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'}">` +
        `<div class="text-sm font-extrabold text-slate-800">${esc(formatNumber(counts[label]))}</div>` +
        `<div class="text-[9px] text-slate-500 truncate">${esc(label)}</div></button>`;
    }).join('') +
    `</div>`;
}

/** Badge Kelompok Business Reference — pola warna sama seperti posisiBadgeHtml(). */
function acuanBadgeHtml(label) {
  if (!label) return '<span class="text-[10px] text-slate-400">Data belum tersedia</span>';
  const WARNA = {
    'Di Atas Acuan': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Sesuai Acuan': 'bg-slate-100 text-slate-600 border-slate-200',
    'Di Bawah Acuan': 'bg-red-50 text-red-700 border-red-200',
  };
  return `<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${WARNA[label]}" ` +
    'title="Dibandingkan terhadap Acuan Bisnis (businessReferencePercent).">' +
    `${esc(label)}</span>`;
}

/** Baris peringkat coverage — cuma ditulis waktu kriteria sort memang "coverage". */
function coverageRankLine(item) {
  if (S.performanceCriteria !== 'coverage') return '';
  return `<div class="text-[10px] text-slate-400 mt-1">Peringkat ${esc(item.coverageRank)} dari ` +
    `${esc(item.coverageRankTotal)} — Coverage ${S.performanceCoverageFocus}</div>`;
}

/** Ringkasan singkat coverage 1-8 untuk tooltip — 8 kolom tidak muat di baris tabel. */
function coverageTooltip(item) {
  return item.coveragePercents.map((p, i) => `Cov${i + 1}: ${p.toFixed(0)}%`).join(' · ');
}

/** Baris lebar: panel normal (di bawah Proporsi Penjualan) dan tampilan besar. */
function performanceRowWide(item) {
  const active = scopeValue('pos') === item.code;
  return `<div onclick="applyScope('pos','${esc(item.code)}')" ` +
    `class="baris-pos rounded-xl px-3 py-2.5 ${active ? 'aktif' : ''}">` +
    `<div class="flex items-center gap-3 flex-wrap">` +
    `<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${esc(item.color)}"></span>` +
    `<div class="min-w-0" style="flex:2 1 160px">` +
    `<div class="text-sm font-semibold text-slate-800 truncate">${esc(item.name)}</div>` +
    `<div class="text-[11px] text-slate-400 truncate">${esc(item.dealer)}</div></div>` +
    `<div class="text-right shrink-0"><div class="text-sm font-bold mono text-slate-800">` +
    `${esc(formatNumber(item.units))}</div><div class="text-[9px] text-slate-400">total sales</div></div>` +
    `<div class="text-right shrink-0 w-14"><div class="text-sm font-bold mono text-slate-800">` +
    `${item.contribution == null ? '—' : esc(item.contribution.toFixed(2)) + '%'}</div>` +
    `<div class="text-[9px] text-slate-400">kontribusi</div></div>` +
    posisiBadgeHtml(item.posisi) +
    acuanBadgeHtml(item.acuanGroup) +
    `<div class="flex items-center gap-1 text-[10px] mono shrink-0 text-slate-500" ` +
    `title="${esc(coverageTooltip(item))}">` +
    `<span>Coverage ${esc((100 - item.percentLuarCoverage).toFixed(0))}%</span>` +
    `<span class="text-slate-400">Luar ${esc(item.percentLuarCoverage.toFixed(0))}%</span>` +
    `</div>` +
    `<div class="flex items-center gap-1.5 shrink-0" onclick="event.stopPropagation()">` +
    `<button onclick="showOnMap('${esc(item.code)}')" class="px-2 py-1.5 rounded-lg text-[11px] font-bold text-white btn-primary">` +
    `<i class="ph-fill ph-map-trifold"></i></button>` +
    `<button onclick="editPosCoverageFromTable('${esc(item.code)}')" class="px-2 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 text-slate-600 hover:bg-slate-50">` +
    `<i class="ph ph-target"></i></button>` +
    `</div></div>` +
    coverageRankLine(item) +
    `</div>`;
}

/** Baris ringkas: layar penuh peta (`w-80`, TIDAK BOLEH mengubah lebar panel). */
function performanceRowCompact(item) {
  const active = scopeValue('pos') === item.code;
  return `<div onclick="applyScope('pos','${esc(item.code)}')" ` +
    `class="baris-pos rounded-xl px-2.5 py-2 ${active ? 'aktif' : ''}">` +
    `<div class="flex items-center gap-1.5">` +
    `<span class="w-2 h-2 rounded-full shrink-0" style="background:${esc(item.color)}"></span>` +
    `<span class="flex-1 text-xs font-semibold text-slate-800 truncate">${esc(item.name)}</span>` +
    `<span class="text-[10px] text-slate-400 mono shrink-0">${esc(formatNumber(item.units))}</span></div>` +
    `<div class="text-[10px] text-slate-400 truncate">${esc(item.dealer)}</div>` +
    `<div class="flex items-center gap-1 mt-1 text-[9px] mono text-slate-500" ` +
    `title="${esc(coverageTooltip(item))}">` +
    `<span>Coverage ${esc((100 - item.percentLuarCoverage).toFixed(0))}%</span>` +
    `<span class="text-slate-400">Luar ${esc(item.percentLuarCoverage.toFixed(0))}%</span></div>` +
    `<div class="flex items-center gap-1 mt-1">${posisiBadgeHtml(item.posisi)}${acuanBadgeHtml(item.acuanGroup)}</div>` +
    coverageRankLine(item) +
    `</div>`;
}

/**
 * Ringkasan kontekstual di atas daftar Performa Pos — sejak 2026-08-31 GANTI TOTAL
 * (permintaan Pakbos, putaran keempat) dari "Dalam radius X km" (radius-based, satu
 * bentuk untuk semua orang) jadi tiga bentuk berbeda menurut filter yang aktif.
 * `splitByCoverage`/`coverage.js` TIDAK dihapus — masih dipakai tooltip kelurahan
 * (`outlets.js`), di luar cakupan perubahan ini.
 */
const average = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

/**
 * grid-template-columns lewat inline style, SENGAJA bukan Tailwind grid-cols-N:
 * jumlah kolomnya beda tiap mode (4/6/9/10 sejak coverage 1-8 ikut ditampilkan), dan
 * proyek ini sudah DUA KALI lupa `npm run css` sesudah kelas Tailwind baru dipakai di
 * template literal JS (grid-cols-5 di Bagian B, .marker-outlet.dealer di Bagian H) —
 * inline style tidak butuh build step sama sekali, jadi kelas bug itu mustahil
 * terulang di sini.
 *
 * `auto-fill` + `minmax`, BUKAN `repeat(N,...)` sejak coverage pos bisa sampai 9 sel
 * sekaligus (total + 8 coverage) — memaksa 9 kolom di satu baris membuat tiap sel
 * terlalu sempit untuk dibaca. Sel-sel MELIPAT ke baris berikutnya begitu lebar
 * panelnya tidak cukup, lebar minimum tiap sel tetap terjaga.
 *
 * `auto-fit`, BUKAN `auto-fill`: keduanya melipat sama begitu sempit, tapi beda
 * waktu SELNYA SEDIKIT dan panelnya lebar (mis. 4 sel scope Kota di kartu ringkasan
 * utama, selebar halaman) — `auto-fill` tetap MENCADANGKAN kolom kosong sebanyak
 * yang muat secara lebar, jadi 4 selnya mepet ke kiri dan separuh baris sisanya
 * kosong. `auto-fit` MELUMAT kolom kosong itu, sel yang ada (lewat `1fr`) melebar
 * mengisi satu baris penuh — persis yang diminta tim.
 */
function summaryGridHtml(cells) {
  return `<div class="grid gap-2" style="grid-template-columns:repeat(auto-fit,minmax(84px,1fr))">` +
    cells.map((c) => `<div class="rounded-xl border border-slate-200 p-2.5 text-center">` +
      `<div class="text-sm font-extrabold text-slate-800 mono">${esc(c.value)}</div>` +
      `<div class="text-[9px] uppercase font-bold text-slate-400 tracking-wide mt-0.5">${esc(c.label)}</div></div>`).join('') +
    `</div>`;
}

/** Filter Kota ATAU tidak ada filter kota/dealer/pos sama sekali (Semua) — sama-sama lewat sini. */
function baseScopeSummary(rows) {
  const { list, breaks } = villageSalesRows(rows);
  const totalSales = rows.reduce((sum, r) => sum + r.units, 0);
  const kontribusi = list.map((v) => v.contribution).filter((v) => v != null);
  const avg = average(kontribusi);
  return summaryGridHtml([
    { label: 'Jumlah Desa', value: formatNumber(list.length) },
    { label: 'Total Sales', value: formatNumber(totalSales) },
    { label: 'AVG Kontribusi', value: avg == null ? '—' : avg.toFixed(2) + '%' },
    { label: 'AVG Posisi Relatif', value: avg == null ? '—' : (relativePosition(avg, breaks) || '—') },
  ]);
}

/**
 * Union kecamatan dari coverage seluruh pos di bawah satu dealer — dipakai
 * dealerScopeSummary untuk bucket "Coverage gabungan" di dealerRingSplit().
 */
function dealerCoverageDistricts(dealerCode) {
  const districts = new Set();
  Object.values(S.outletByCode)
    .filter((o) => o.dealerCode === dealerCode)
    .forEach((o) => {
      Object.keys(S.posCoverage[o.code] || {}).forEach((d) => districts.add(d));
    });
  return districts;
}

/**
 * Enam sel dasar scope dealer (jumlah desa, jumlah pos, total sales, tiga AVG) —
 * dipakai DUA tempat: dealerScopeSummary() di bawah (ringkas-jangkauan, panel
 * Performa, ditambah pecahan Ring/Coverage) dan topScopeSummary() (kartu ringkasan
 * atas halaman, TANPA pecahan ring/coverage — dikonfirmasi user waktu perencanaan
 * 2026-08-31: kartu atas sengaja ringkas, rincian ring/coverage cukup di satu
 * tempat).
 */
function dealerScopeBaseCells(rows, dealerCode) {
  const { list, breaks } = villageSalesRows(rows);
  const totalSales = rows.reduce((sum, r) => sum + r.units, 0);
  const kontribusi = list.map((v) => v.contribution).filter((v) => v != null);
  const avg = average(kontribusi);
  const gaps = list.map((v) => referenceGap(v.contribution, S.businessReferencePercent)).filter((g) => g != null);
  const avgGap = average(gaps);
  const outletCount = (S.dealerByCode[dealerCode] || {}).outletCount || 0;

  return [
    { label: 'Jumlah Desa', value: formatNumber(list.length) },
    { label: 'Jumlah Pos Dealer', value: formatNumber(outletCount) },
    { label: 'Total Sales', value: formatNumber(totalSales) },
    { label: 'AVG Kontribusi', value: avg == null ? '—' : avg.toFixed(2) + '%' },
    { label: 'AVG Posisi Relatif', value: avg == null ? '—' : (relativePosition(avg, breaks) || '—') },
    { label: 'AVG Acuan Bisnis', value: avgGap == null ? '—' : (avgGap > 0 ? '+' : '') + avgGap.toFixed(2) },
  ];
}

function dealerScopeSummary(rows) {
  const dealerCode = scopeValue('dealer');
  const cells = dealerScopeBaseCells(rows, dealerCode);

  // Ring dealer (kecamatan) + coverage gabungan pos cabangnya — ring menang kalau
  // satu kecamatan masuk keduanya (dikonfirmasi user waktu perencanaan 2026-08-31).
  const split = dealerRingSplit(
    rows, S.dealerRings[dealerCode], dealerCoverageDistricts(dealerCode), S.villageByCode);

  return summaryGridHtml([
    ...cells,
    { label: 'Ring 1', value: split.percent1.toFixed(1) + '%' },
    { label: 'Ring 2', value: split.percent2.toFixed(1) + '%' },
    { label: 'Ring 3', value: split.percent3.toFixed(1) + '%' },
    { label: 'Coverage Gabungan Pos', value: split.percentCoverage.toFixed(1) + '%' },
  ]);
}

function posScopeSummary(rows) {
  const pos = scopeValue('pos');
  const total = rows.reduce((sum, r) => sum + r.units, 0);
  const coverageMap = S.posCoverage[pos] || {};
  const counts = {};
  for (let i = 1; i <= 8; i++) counts[i] = 0;
  Object.values(coverageMap).forEach((c) => { if (counts[c] !== undefined) counts[c]++; });
  const split = groupSplit(rows, coverageMap, S.villageByCode, 8);
  return summaryGridHtml([
    { label: 'Total Penjualan Pos', value: formatNumber(total) },
    ...Array.from({ length: 8 }, (_, i) => ({
      label: `Coverage ${i + 1}`,
      value: `${formatNumber(counts[i + 1])} kec · ${split.percents[i].toFixed(1)}%`,
    })),
  ]);
}

function scopeSummary(rows) {
  if (scopeValue('pos') !== 'ALL') return posScopeSummary(rows);
  if (scopeValue('dealer') !== 'ALL') return dealerScopeSummary(rows);
  return baseScopeSummary(rows); // Kota ATAU Semua — activeRows() yang sudah menentukan isi `rows`
}

/**
 * Kartu ringkasan UTAMA di puncak halaman Sales Analytics — menggantikan 4 KPI
 * statis (Dealer Aktif/Total Penjualan/Kelurahan Terlayani/Kelurahan Kosong) yang
 * sebelumnya SELALU sama nilainya berapa pun filternya. Sejak 2026-08-31 malam
 * ikut scope, sama seperti scopeSummary() (ringkas-jangkauan, panel Performa) —
 * TAPI field-nya beda: scope dealer di sini TANPA pecahan Ring/Coverage (dikonfirmasi
 * user, kartu atas sengaja ringkas — rincian ring/coverage cukup di satu tempat),
 * scope pos SAMA PERSIS posScopeSummary() (kedelapan Coverage-nya, dikonfirmasi
 * user waktu perencanaan).
 *
 * Kota dan "Semua" SENGAJA sama (baseScopeSummary) — dikonfirmasi user: tanpa
 * filter dihitung dari SELURUH data, kartunya tetap 4 field yang sama.
 */
function topScopeSummary(rows) {
  if (scopeValue('pos') !== 'ALL') return posScopeSummary(rows);
  if (scopeValue('dealer') !== 'ALL') {
    return summaryGridHtml(dealerScopeBaseCells(rows, scopeValue('dealer')));
  }
  return baseScopeSummary(rows);
}

export function renderTopSummary(rows) {
  const html = topScopeSummary(rows);
  $('ringkas-utama').innerHTML = html;
  // #fs-ringkas-utama (strip di atas kartu dealer/pos, layar penuh) menampilkan
  // ringkasan yang SAMA — sebelumnya angka ini hilang begitu masuk layar penuh.
  if ($('fs-ringkas-utama')) $('fs-ringkas-utama').innerHTML = html;
}

export function renderPerformance(rows) {
  const naik = S.performanceSort !== 'desc';
  if ($('label-urut-performa')) {
    $('label-urut-performa').textContent = naik ? 'terkecil' : 'terbesar';
    $('btn-urut-performa').querySelector('i').className =
      naik ? 'ph ph-sort-ascending' : 'ph ph-sort-descending';
  }

  const { list, counts } = performanceByOutlet(rows);
  const controls = performanceControlsHtml();
  const kosong = '<p class="text-center text-slate-400 text-sm py-8">Tidak ada pos pada filter ini.</p>';

  // panel-performa (normal) dan fp-performa (tampilan besar) berbagi `bodyWide` yang
  // SATU — kalau masing-masing menghitung sendiri, dua angka berbeda bisa tampil
  // bersamaan dan tidak ada yang tahu mana yang benar. fs-performa (layar penuh peta,
  // w-80) pakai `bodyCompact` — field yang SAMA dari `list` yang SAMA, cuma kemasannya
  // lebih ringkas supaya lebar panel tidak berubah.
  const bodyWide = controls + performanceGroupBoard(counts) +
    (list.length ? list.map(performanceRowWide).join('') : kosong);
  // Sejak 2026-09-14: jalur fs-* (layar penuh) TIDAK lagi menaruh `controls` di
  // #fs-performa — panel itu sekarang wadah gulir SENDIRI (lihat CSS
  // #fs-kiri-panel di index.html), dan ringkasan+sort-by harus tetap diam di
  // atas sementara cuma daftarnya yang bergulir. `controls` pindah ke
  // #fs-ringkas, digabung dengan summary (satu blok tetap, sama-sama shrink-0).
  const bodyCompact = list.length ? list.map(performanceRowCompact).join('') : kosong;
  const summary = scopeSummary(rows);
  // Sejak 2026-09-14 malam: mode BIASA (bukan layar penuh peta) dapat perlakuan
  // sama seperti fs-* di atas — ringkasan+sort-by+papan kelompok tetap diam
  // (#ringkas-jangkauan, shrink-0 lewat CSS di index.html), cuma baris pos
  // (rowsHtml, TANPA controls/groupBoard) yang masuk ke #panel-performa yang
  // bergulir sendiri. `bodyWide` (gabungan lengkap) dipertahankan apa adanya
  // untuk fp-performa/fp-ringkas ("Tampilan lebih besar", di luar cakupan).
  const rowsHtml = list.length ? list.map(performanceRowWide).join('') : kosong;

  $('panel-performa').innerHTML = rowsHtml;
  $('ringkas-jangkauan').innerHTML = summary + controls + performanceGroupBoard(counts);
  if ($('fs-performa')) $('fs-performa').innerHTML = bodyCompact;
  if ($('fs-ringkas')) $('fs-ringkas').innerHTML = summary + controls;
  if ($('fp-performa')) $('fp-performa').innerHTML = bodyWide;
  if ($('fp-ringkas')) $('fp-ringkas').innerHTML = summary;

  autoStartPerforma();
  if ($('fp-lingkup')) $('fp-lingkup').textContent = 'Dihitung terhadap ' + scopeLabel();
}

/* ==========================================================================
   TAMPILAN BESAR DAN GULIR OTOMATIS
   ========================================================================== */

export function openPerformaFull() {
  $('modal-performa').classList.remove('hidden');
  window.renderAll();
}

export function closePerformaFull() {
  $('modal-performa').classList.add('hidden');
  // Gulir otomatis ikut berhenti: kalau tidak, dia terus berjalan di panel yang
  // tertutup dan tombol Live-nya tetap menyala tanpa ada yang bergerak. Dihentikan
  // LANGSUNG (bukan lewat toggleLivePerforma) supaya livePerformaPaused tidak ikut
  // ke-set — panel normal yang kini terlihat harus tetap auto-mulai lagi lewat
  // autoStartPerforma(), bukan diam menunggu tombol Live diklik.
  stopLivePerforma();
}

/**
 * Wadah daftar yang sedang terlihat — tampilan besar menang kalau sedang terbuka,
 * baru layar penuh peta, baru panel biasa.
 *
 * Sebelum 2026-08-31 fungsi ini tidak pernah mengembalikan `fs-performa` sama sekali
 * — tombol Live di layar penuh peta menggulir `panel-performa` yang sudah tidak
 * terlihat (tertutup peta layar penuh, tinggi 0), bukan panel yang sungguh tampil.
 * Permintaan Pakbos eksplisit: "Tampilan live dashboard auto looping juga" di mode
 * layar penuh peta.
 */
function panelPerformaAktif() {
  const besar = $('modal-performa');
  if (besar && !besar.classList.contains('hidden')) return $('fp-performa');
  if (S.fullscreen) return $('fs-performa');
  return $('panel-performa');
}

/**
 * Gulir daftar performa sendiri, berulang.
 *
 * Untuk layar yang diproyeksikan waktu rapat: daftarnya jalan pelan sampai ujung, lalu
 * kembali ke atas. Sengaja per piksel dan bukan per baris — gerakan yang meloncat
 * antar baris membuat orang kehilangan tempat bacanya.
 *
 * Berhenti sendiri kalau daftarnya tidak lebih panjang dari wadahnya: menggulir
 * sesuatu yang sudah muat seluruhnya cuma membuat layar bergetar.
 */
function startLivePerforma() {
  S.livePerforma = setInterval(() => {
    const panel = panelPerformaAktif();
    if (!panel) return;
    const sisa = panel.scrollHeight - panel.clientHeight;
    if (sisa <= 4) return;
    panel.scrollTop = panel.scrollTop >= sisa - 1 ? 0 : panel.scrollTop + 1;
  }, 40);
  [$('btn-live-performa'), $('btn-live-performa-besar')].filter(Boolean).forEach((b) => {
    b.classList.add('live-nyala');
    b.querySelector('i').className = 'ph ph-pause';
  });
}

/** Dipanggil tiap renderPerformance() — aman dipanggil berkali-kali, dijaga oleh dua state. */
function autoStartPerforma() {
  if (S.livePerforma || S.livePerformaPaused) return;
  startLivePerforma();
}

/** Hentikan interval TANPA menandai livePerformaPaused — dipakai closePerformaFull(). */
function stopLivePerforma() {
  if (!S.livePerforma) return;
  clearInterval(S.livePerforma);
  S.livePerforma = null;
  [$('btn-live-performa'), $('btn-live-performa-besar')].filter(Boolean).forEach((b) => {
    b.classList.remove('live-nyala');
    b.querySelector('i').className = 'ph ph-play';
  });
}

/** Tombol Pause/Lanjut — dipencet manusia, jadi livePerformaPaused IKUT ditandai. */
export function toggleLivePerforma() {
  if (S.livePerforma) {
    stopLivePerforma();
    S.livePerformaPaused = true;
    return;
  }
  S.livePerformaPaused = false;
  startLivePerforma();
}

/* ==========================================================================
   ANALISIS PENJUALAN WILAYAH
   ==========================================================================
   Blok baru (permintaan Pakbos, putaran ketiga): satu baris per DESA — beda dari
   blok Performa Pos Dealer di atas yang satu baris per POS. Basis kontribusi &
   posisi relatif SENGAJA relatif terhadap `rows` apa adanya (contributionsByVillage
   di sales-stats.js), BUKAN terhadap kotanya sendiri seperti villageStats() yang
   sudah ada di tables.js untuk panel kelurahan — dikonfirmasi user: karena `rows`
   di sini datang dari activeRows(), ini otomatis berarti "relatif terhadap
   dealer/pos yang difilter" tanpa percabangan khusus.

   Auto-loop SENDIRI (bukan tombol Live manual seperti Performa Pos) — tombolnya
   Pause, dan begitu isinya ada dia langsung bergulir tanpa diklik dulu.
   ========================================================================== */

/**
 * @return {{list: Array, breaks: number[]}} `breaks` diekspos (bukan cuma dipakai
 *   internal) supaya scopeSummary() (Bagian I) bisa mengklasifikasikan AVG kontribusi
 *   dengan breaks yang SAMA PERSIS dipakai tiap baris — kalau dihitung ulang
 *   terpisah, bisa menyimpang tipis dari sebaran yang sesungguhnya ditampilkan.
 */
function villageSalesRows(rows) {
  const byVillage = {};
  rows.forEach((r) => { byVillage[r.village] = (byVillage[r.village] || 0) + r.units; });

  const kontribusi = contributionsByVillage(rows);
  const breaks = percentileBreaks([...kontribusi.values()]);

  const list = Object.keys(byVillage).map((code) => {
    const village = S.villageByCode[code] || {};
    const contribution = kontribusi.has(code) ? kontribusi.get(code) : null;
    return {
      code,
      name: village.name || code,
      district: village.district || '',
      cityName: village.cityName || '',
      units: byVillage[code],
      contribution,
      posisi: contribution == null ? null : relativePosition(contribution, breaks),
    };
    // Terendah -> tertinggi, TETAP — permintaan eksplisit, tidak ada tombol balik
    // arah seperti blok Performa Pos (beda tujuan: ini untuk memantau berjalan,
    // bukan mencari yang paling bermasalah dulu).
  }).sort((a, b) => a.units - b.units);

  return { list, breaks };
}

function wilayahLokasi(item) {
  return [item.district, item.cityName].filter(Boolean).join(', ');
}

/** Baris lebar: kartu normal (SELALU tampil, tidak bergantung filter). */
function wilayahRowWide(item) {
  return `<div class="baris-pos rounded-xl px-3 py-2.5">` +
    `<div class="flex items-center gap-3 flex-wrap">` +
    `<div class="min-w-0" style="flex:2 1 160px">` +
    `<div class="text-sm font-semibold text-slate-800 truncate">${esc(item.name)}</div>` +
    `<div class="text-[11px] text-slate-400 truncate">${esc(wilayahLokasi(item))}</div></div>` +
    `<div class="text-right shrink-0"><div class="text-sm font-bold mono text-slate-800">` +
    `${esc(formatNumber(item.units))}</div><div class="text-[9px] text-slate-400">total sales</div></div>` +
    `<div class="text-right shrink-0 w-14"><div class="text-sm font-bold mono text-slate-800">` +
    `${item.contribution == null ? '—' : esc(item.contribution.toFixed(2)) + '%'}</div>` +
    `<div class="text-[9px] text-slate-400">kontribusi</div></div>` +
    posisiBadgeHtml(item.posisi) +
    `</div></div>`;
}

/** Baris ringkas: layar penuh peta (`w-80`, TIDAK BOLEH mengubah lebar panel). */
function wilayahRowCompact(item) {
  return `<div class="baris-pos rounded-xl px-2.5 py-2">` +
    `<div class="flex items-center gap-1.5">` +
    `<span class="flex-1 text-xs font-semibold text-slate-800 truncate">${esc(item.name)}</span>` +
    `<span class="text-[10px] text-slate-400 mono shrink-0">${esc(formatNumber(item.units))}</span></div>` +
    `<div class="text-[10px] text-slate-400 truncate">${esc(wilayahLokasi(item))}</div>` +
    `<div class="flex items-center justify-between mt-1">` +
    `<span class="text-[10px] mono text-slate-500">${item.contribution == null ? '—' : esc(item.contribution.toFixed(2)) + '% kontribusi'}</span>` +
    posisiBadgeHtml(item.posisi) +
    `</div></div>`;
}

export function renderWilayah(rows) {
  const { list } = villageSalesRows(rows);
  const kosong = '<p class="text-center text-slate-400 text-sm py-8">Tidak ada desa pada filter ini.</p>';
  const bodyWide = list.length ? list.map(wilayahRowWide).join('') : kosong;
  const bodyCompact = list.length ? list.map(wilayahRowCompact).join('') : kosong;

  if ($('panel-wilayah')) $('panel-wilayah').innerHTML = bodyWide;
  if ($('fs-wilayah')) $('fs-wilayah').innerHTML = bodyCompact;

  autoStartWilayah();
  syncWilayahButtons();
}

/**
 * Panel kiri layar penuh peta cuma punya SATU slot — jadi begitu dealer/pos
 * difilter, "Analisis Penjualan Wilayah" (per desa, relevan untuk melihat wilayah
 * SATU dealer/pos itu) menggantikan "Analisis Performa Pos" (per pos, lebih relevan
 * waktu melihat semua pos/kota) di slot yang sama. Dipanggil dari renderAll().
 */
export function syncFullscreenPanels() {
  const wilayah = scopeValue('dealer') !== 'ALL' || scopeValue('pos') !== 'ALL';
  if ($('fs-performa-grup')) $('fs-performa-grup').classList.toggle('hidden', wilayah);
  if ($('fs-wilayah-grup')) $('fs-wilayah-grup').classList.toggle('hidden', !wilayah);
}

/** Wadah daftar yang sedang terlihat — sama seperti panelPerformaAktif() tapi tanpa tampilan besar (blok ini tidak punya versi itu). */
function panelWilayahAktif() {
  return S.fullscreen ? $('fs-wilayah') : $('panel-wilayah');
}

function startLiveWilayah() {
  S.liveWilayah = setInterval(() => {
    const panel = panelWilayahAktif();
    if (!panel) return;
    const sisa = panel.scrollHeight - panel.clientHeight;
    if (sisa <= 4) return;
    panel.scrollTop = panel.scrollTop >= sisa - 1 ? 0 : panel.scrollTop + 1;
  }, 40); // sama persis dengan interval toggleLivePerforma — kecepatan gulir konsisten
}

/** Dipanggil tiap renderWilayah() — aman dipanggil berkali-kali, dijaga oleh dua state. */
function autoStartWilayah() {
  if (S.liveWilayah || S.liveWilayahPaused) return;
  startLiveWilayah();
}

function syncWilayahButtons() {
  [$('btn-live-wilayah'), $('btn-live-wilayah-fs')].filter(Boolean).forEach((b) => {
    b.querySelector('i').className = S.liveWilayah ? 'ph ph-pause' : 'ph ph-play';
    b.classList.toggle('live-nyala', Boolean(S.liveWilayah));
  });
}

/** Tombol Pause/Lanjut — beda dari toggleLivePerforma: default-nya JALAN, bukan mati. */
export function toggleLiveWilayah() {
  if (S.liveWilayah) {
    clearInterval(S.liveWilayah);
    S.liveWilayah = null;
    S.liveWilayahPaused = true;
  } else {
    S.liveWilayahPaused = false;
    startLiveWilayah();
  }
  syncWilayahButtons();
}

/* ==========================================================================
   KARTU REKAP DEALER
   ==========================================================================
   Muncul waktu satu dealer atau satu pos dipilih. Ada karena panel performa
   mengurutkan SELURUH pos dari semua dealer — berguna untuk mencari yang paling
   bermasalah, tapi tidak menjawab "bagaimana dealer ini secara keseluruhan".
   ========================================================================== */

function activeDealerCode() {
  const outlet = scopeValue('pos');
  if (outlet !== 'ALL') return (S.outletByCode[outlet] || {}).dealerCode || null;
  const dealer = scopeValue('dealer');
  return dealer !== 'ALL' ? dealer : null;
}

/**
 * Sejak 2026-08-31: trio Total/Dalam jangkauan/Di luar (berbasis `splitByCoverage()`,
 * radius lama) diganti metrik kontribusi/posisi relatif/acuan bisnis yang sudah
 * dipakai di panel lain, plus pecahan ring (scope dealer) atau coverage (scope pos)
 * — permintaan eksplisit user, dikonfirmasi lewat pertanyaan field "Pos".
 */
export function dealerCardHtml(compact) {
  const code = activeDealerCode();
  if (!code) return '';

  // Seluruh pos milik dealer ini pada periode dan wilayah aktif — TIDAK ikut
  // dipersempit filter pos. Yang ditanyakan kartu ini memang rekap dealernya
  // (AVG Kontribusi/Posisi Relatif/Acuan Bisnis tetap level dealer walau lagi
  // melihat satu pos tertentu — cuma pecahan ring/coverage di bawah yang beda).
  const f = pageFilters();
  const city = f.cityCode;
  const rows = S.sales.filter((r) => {
    if (r.dealer !== code) return false;
    if (f.from !== 'ALL' && r.period < f.from) return false;
    if (f.to !== 'ALL' && r.period > f.to) return false;
    const village = S.villageByCode[r.village];
    if (!village) return false;
    if (city !== 'ALL' && village.cityCode !== city) return false;
    if (f.kares !== 'ALL' && !KARESIDENAN[f.kares].cities.includes(village.cityCode)) return false;
    return true;
  });

  const name = S.dealerNames[code] || code;
  const color = dealerColor(S.registry, code);

  const perOutlet = sumBy(rows, 'outlet');
  const order = Object.keys(perOutlet).sort((a, b) => perOutlet[b] - perOutlet[a]);
  const chips = order.map((oc) =>
    `<span class="chip-pos" onclick="applyScope('pos','${esc(oc)}')">` +
    `<span class="w-2 h-2 rounded-full shrink-0" style="background:${esc(dealerColor(S.registry, (S.outletByCode[oc] || {}).dealerCode))}"></span>` +
    `${esc((S.outletByCode[oc] || {}).name || oc)}` +
    `<span class="n">${esc(formatNumber(perOutlet[oc]))}</span></span>`).join(' ');

  // Pos: nama pos yang sedang aktif kalau scope pos dipilih, jumlah pos di bawah
  // dealer ini kalau belum (dikonfirmasi user waktu perencanaan 2026-08-31).
  const activePos = scopeValue('pos');
  const posValue = activePos !== 'ALL'
    ? ((S.outletByCode[activePos] || {}).name || activePos)
    : formatNumber(order.length) + ' pos';

  // AVG Kontribusi/Posisi Relatif/Acuan Bisnis: tiga sel terakhir dealerScopeBaseCells,
  // dihitung dari `rows` (dealer-wide) yang sama seperti panel ringkasan lain.
  const [, , , kontribusi, posisiRelatif, acuanBisnis] = dealerScopeBaseCells(rows, code);

  // Cabang: pos aktif → %coverage 1-8 milik pos itu SENDIRI (bukan dealer-wide —
  // disaring ulang ke penjualan pos ini saja, sama seperti posScopeSummary() di
  // tempat lain memakai rows yang sudah tersaring scope pos lewat activeRows());
  // kalau tidak ada pos aktif (scope dealer saja) → %ring 1/2/3 + %luar (di luar 3
  // ring) milik dealer ini, dari `rows` dealer-wide. "Luar" dihitung di sini, BUKAN
  // field dealerRingSplit() — kartu ini cuma minta 4 angka (ring1/2/3/luar), beda
  // dari panel ringkas-jangkauan yang punya "Coverage Gabungan Pos" terpisah.
  let cabang;
  if (activePos !== 'ALL') {
    const posRows = rows.filter((r) => r.outlet === activePos);
    const split = groupSplit(posRows, S.posCoverage[activePos], S.villageByCode, 8);
    cabang = Array.from({ length: 8 }, (_, i) =>
      ({ label: `Coverage ${i + 1}`, value: split.percents[i].toFixed(1) + '%' }));
  } else {
    const split = dealerRingSplit(
      rows, S.dealerRings[code], dealerCoverageDistricts(code), S.villageByCode);
    const luar = 100 - split.percent1 - split.percent2 - split.percent3;
    cabang = [
      { label: 'Ring 1', value: split.percent1.toFixed(1) + '%' },
      { label: 'Ring 2', value: split.percent2.toFixed(1) + '%' },
      { label: 'Ring 3', value: split.percent3.toFixed(1) + '%' },
      { label: 'Luar', value: luar.toFixed(1) + '%' },
    ];
  }

  const cells = [{ label: 'Pos', value: posValue }, kontribusi, posisiRelatif, acuanBisnis, ...cabang];

  // Kartu ringkas (strip di bawah peta layar penuh, DAN #kelurahanDetailSummary
  // di panel kiri w-96 mode biasa) — dua baris: Baris 1 = avatar + JUDUL (nama
  // pos kalau scope pos aktif, kalau tidak nama dealer) + subjudul nama dealer
  // induk (cuma muncul kalau judulnya nama pos — dealer scope saja tidak perlu
  // subjudul) + tombol Tutup (ikon X, pojok kanan). Baris 2 = grid stat, sel
  // "Pos" DIBUANG kalau sudah jadi judul baris 1 (supaya tidak diulang), TETAP
  // ADA kalau scope dealer saja. Chip daftar pos TETAP DIHILANGKAN dari versi
  // ini (ada di kartu penuh `#kartu-dealer`).
  //
  // Baris 2 sengaja CSS GRID auto-fit (bukan flex + overflow-x-auto seperti
  // sebelumnya): di strip layar penuh yang lebar, semua sel muat sebaris; di
  // panel kiri w-96 mode biasa yang sempit, sel yang tidak muat TURUN ke baris
  // berikutnya sendiri — tidak ada lagi yang perlu digulir horizontal di kedua
  // konteks, satu markup dipakai apa adanya untuk keduanya.
  if (compact) {
    const headerTitle = activePos !== 'ALL' ? posValue : name;
    const headerSubtitle = activePos !== 'ALL' ? name : '';
    const baris2 = activePos !== 'ALL' ? cells.slice(1) : cells;
    const statCell = (c) => `<div class="text-center px-1">` +
      `<div class="text-xs font-extrabold text-slate-800 mono leading-tight">${esc(c.value)}</div>` +
      `<div class="text-[8px] uppercase font-bold text-slate-400 tracking-wide leading-tight whitespace-nowrap">${esc(c.label)}</div></div>`;
    return `<div class="flex flex-col justify-center gap-1 w-full min-w-0">` +
      `<div class="flex items-center gap-2">` +
      `<div class="w-7 h-7 text-xs rounded-lg flex items-center justify-center text-white font-extrabold shrink-0" ` +
      `style="background:${esc(color)}">${esc(headerTitle.slice(0, 1))}</div>` +
      `<div class="min-w-0 flex-1">` +
      `<div class="font-extrabold text-slate-800 truncate text-sm leading-tight">${esc(headerTitle)}</div>` +
      (headerSubtitle ? `<div class="text-[10px] text-slate-400 truncate leading-tight">${esc(headerSubtitle)}</div>` : '') +
      `</div>` +
      `<button onclick="closeDealerCard()" title="Tutup" class="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><i class="ph ph-x"></i></button>` +
      `</div>` +
      `<div class="grid gap-1" style="grid-template-columns:repeat(auto-fit,minmax(56px,1fr))">${baris2.map(statCell).join('')}</div>` +
      `</div>`;
  }

  const stats = summaryGridHtml(cells);
  return `<div>` +
    `<div class="flex items-center gap-4 justify-between"><div class="flex items-center gap-4 min-w-0">` +
    `<div class="w-10 h-10 rounded-xl flex items-center justify-center text-white font-extrabold shrink-0" ` +
    `style="background:${esc(color)}">${esc(name.slice(0, 1))}</div>` +
    `<div class="font-extrabold text-slate-800 truncate">${esc(name)}</div>` +
    `</div>` +
    `<div class="flex items-center gap-2 shrink-0">` +
    `<button onclick="openDealerDetail('${esc(code)}')" ` +
    `class="px-3 py-2 rounded-xl text-white text-xs font-bold hover:opacity-90 whitespace-nowrap btn-primary">` +
    `<i class="ph ph-list-magnifying-glass mr-1"></i>Rincian per kelurahan</button>` +
    `<button onclick="closeDealerCard()" class="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50">Tutup</button>` +
    `</div></div>` +
    `<div class="mt-3">${stats}</div>` +
    `<div class="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100">${chips}</div>` +
    `</div>`;
}

export function renderDealerCard() {
  const code = activeDealerCode();
  const card = $('kartu-dealer');
  const full = dealerCardHtml(false);

  card.classList.toggle('hidden', !full);
  if (full) {
    card.innerHTML = full;
    card.style.borderColor = dealerColor(S.registry, code);
  }

  // Versi ringkas di atas peta: bentuk yang sama setinggi 245 px menutupi sebagian
  // besar wilayah yang justru sedang dilihat.
  const floating = $('fs-kartu');
  if (!floating) return;
  const compact = dealerCardHtml(true);
  floating.classList.toggle('hidden', !compact);
  if (compact) floating.innerHTML = compact;
}

export function closeDealerCard() {
  // Kartu ini muncul kalau pos ATAU dealer aktif (activeDealerCode() di atas cek
  // dua-duanya) — menutupnya harus melepas dua-duanya, kalau tidak kartunya muncul
  // lagi begitu renderAll() berikutnya jalan.
  clearScope('pos');
  clearScope('dealer');
  window.renderAll();
}

/* ==========================================================================
   TREEMAP
   ========================================================================== */

export const MODES = {
  kota: { title: 'PERINGKAT KOTA' },
  dealer: { title: 'PERINGKAT DEALER' },
  pos: { title: 'PERINGKAT POS' },
};

export function totalsByMode(rows, mode) {
  if (mode === 'dealer') return sumBy(rows, 'dealer');
  if (mode === 'pos') return sumBy(rows, 'outlet');
  const out = {};
  rows.forEach((r) => {
    const village = S.villageByCode[r.village];
    if (village) out[village.cityCode] = (out[village.cityCode] || 0) + r.units;
  });
  return out;
}

export function entityName(mode, code) {
  if (mode === 'kota') return S.cityNames[code] || code;
  if (mode === 'dealer') return S.dealerNames[code] || code;
  return (S.outletByCode[code] || {}).name || code;
}

export function entityColor(mode, code) {
  if (mode === 'dealer') return dealerColor(S.registry, code);
  if (mode === 'pos') return dealerColor(S.registry, (S.outletByCode[code] || {}).dealerCode);
  return '#64748b';
}

export function setTreemapView(mode) {
  S.treemapView = mode;
  ['kota', 'dealer', 'pos'].forEach((m) => {
    $('tm-' + m).className = 'px-3 py-1.5 rounded-lg ' +
      (m === mode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500');
  });
  const rows = activeRows();
  renderTreemap(rows);
  renderPerformance(rows);
}

/** Opsi ApexCharts treemap — sama untuk versi kecil dan besar, cuma tinggi beda. */
function treemapOptions(mode, codes, totals, height) {
  return {
    chart: {
      type: 'treemap', height, toolbar: { show: false }, fontFamily: 'Manrope',
      events: {
        dataPointSelection: (event, ctx, cfg) => {
          const code = S.treemapCodes[cfg.dataPointIndex];
          if (code) selectEntity(mode, code);
        },
      },
    },
    series: [{ data: codes.map((code) => ({ x: entityName(mode, code), y: totals[code] })) }],
    colors: codes.map((code) => entityColor(mode, code)),
    // enableShades dimatikan supaya ApexCharts tidak menggelapkan warnanya sendiri —
    // warna di treemap harus sama persis dengan di peta dan legenda.
    plotOptions: { treemap: { distributed: true, enableShades: false } },
    legend: { show: false },
    dataLabels: { style: { fontSize: '11px', fontWeight: 700 } },
    tooltip: { y: { formatter: (v) => formatNumber(v) + ' unit' } },
  };
}

/**
 * Sejak 2026-09-14: "Proporsi Penjualan" tidak lagi kartu inline di halaman —
 * cuma popup (`#modal-treemap`), dipicu tombol di bilah filter. `#treemap-chart`
 * sekarang SATU-SATUNYA container (dulu ada versi "kecil" inline + "besar" di
 * modal, dua ApexCharts terpisah dari `codes`/`totals` yang sama) — digambar
 * HANYA waktu modalnya sungguh terbuka, sama seperti pola `panelPerformaAktif()`
 * dkk.: `renderTreemap()` dipanggil TANPA SYARAT dari `renderAll()` tiap render,
 * jadi kalau modalnya tertutup, keluar lebih awal daripada membuang waktu
 * menghitung ulang treemap yang tidak terlihat siapa pun.
 */
export function renderTreemap(rows) {
  const modal = $('modal-treemap');
  if (!modal || modal.classList.contains('hidden')) return;

  const mode = S.treemapView;
  const totals = totalsByMode(rows, mode);
  const codes = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 24);
  S.treemapCodes = codes;

  if (S.treemapChart) S.treemapChart.destroy();
  S.treemapChart = new ApexCharts($('treemap-chart'), treemapOptions(mode, codes, totals, 420));
  S.treemapChart.render();
}

export function selectEntity(mode, code) { applyScope(mode, code); }

/* ==========================================================================
   POPUP TREEMAP
   ========================================================================== */

export function openTreemapFull() {
  $('modal-treemap').classList.remove('hidden');
  renderTreemap(activeRows());
}

export function closeTreemapFull() {
  $('modal-treemap').classList.add('hidden');
  if (S.treemapChart) { S.treemapChart.destroy(); S.treemapChart = null; }
}

