/**
 * KPI, legenda, treemap, dan panel peringkat.
 */
import {
  COLOR_EMPTY, RAMP, classRanges, dealerColor, percentileBreaks,
} from './colors.js';
import { KARESIDENAN } from './config.js';
import { $, esc, formatNumber, formatPercent, sumBy } from './dom.js';
import {
  activeRows, applyScope, clearScope, pageFilters, scopeLabel, scopeValue, splitByCoverage,
} from './filters.js';
import {
  businessReferenceGroup, contributionsByOutlet, contributionsByVillage,
  fixedContributionClass, KONTRIBUSI_LABEL, outletRingSplit, POSISI_LABEL,
  referenceGap, relativePosition,
} from './sales-stats.js';
import { posisiBadgeHtml } from './tables.js';
import { S } from './state.js';

export function renderKpi(rows, perVillage) {
  const dealers = new Set(rows.map((r) => r.dealer));
  const units = rows.reduce((sum, r) => sum + r.units, 0);
  const served = Object.keys(perVillage).filter((k) => perVillage[k] > 0).length;

  $('kpi-dealer').textContent = formatNumber(dealers.size);
  $('kpi-unit').textContent = formatNumber(units);
  $('kpi-terlayani').textContent = formatNumber(served);
  $('kpi-kosong').textContent = formatNumber(S.villages.length - served);
}

/**
 * Label tier legenda peta — HANYA di sini, permintaan Pakbos 2026-08-31. TIDAK
 * menimpa POSISI_LABEL (Terbawah/Bawah/Tengah/Atas/Teratas): badge di panel
 * kelurahan, ringkasan kota, dan blok Performa Pos Dealer TETAP bahasa Indonesia,
 * cuma legenda peta yang pakai istilah ini.
 */
const MAP_TIER_LABEL = ['bottom', 'lower', 'middle', 'upper', 'top'];

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
        `<span class="flex-1">${esc(MAP_TIER_LABEL[i])}: ${esc(KONTRIBUSI_LABEL[i])}</span>` +
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
      `<span class="flex-1">${esc(MAP_TIER_LABEL[i])}</span>` +
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
   Sejak 2026-08-31 (permintaan Pakbos): persentase "dalam/luar radius jangkauan"
   diganti total jadi %ring 1/2/3 (penetapan manual, lihat Bagian D di rencana) +
   %di luar ketiga ring, dan ditambah %Sales Contribution, Kelompok Relative Position,
   dan Kelompok Business Reference per pos — semuanya relatif terhadap TOTAL SELURUH
   POS yang tampil di filter aktif, dihitung lewat fungsi murni sales-stats.js (tidak
   ada mesin klasifikasi baru, cuma dipanggil dengan input per-outlet).
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
    const ring = outletRingSplit(outletRows, S.rings[code]);

    return {
      code,
      name: outlet.name || code,
      dealer: outlet.dealerName || '',
      color: dealerColor(S.registry, outlet.dealerCode),
      units,
      contribution,
      posisi,
      acuanGroup: businessReferenceGroup(gap),
      percent1: ring.percent1,
      percent2: ring.percent2,
      percent3: ring.percent3,
      percentLuarRing: 100 - ring.percent1 - ring.percent2 - ring.percent3,
    };
  });

  const counts = {};
  POSISI_LABEL.forEach((label) => { counts[label] = 0; });
  all.forEach((item) => { if (item.posisi) counts[item.posisi]++; });

  // Peringkat per ring dihitung dari SELURUH pos (`all`), bukan dari hasil saring
  // kelompok — mengklik satu kartu di board tidak boleh mengubah arti "peringkat 3
  // dari 25", cuma mempersempit pos MANA yang ditampilkan.
  const ringKey = 'percent' + S.performanceRingFocus;
  const ringSorted = [...all].sort((a, b) => b[ringKey] - a[ringKey]);
  const ringRank = new Map(ringSorted.map((item, i) => [item.code, i + 1]));
  all.forEach((item) => { item.ringRank = ringRank.get(item.code); item.ringRankTotal = all.length; });

  const filtered = S.performanceGroupFilter
    ? all.filter((item) => item.posisi === S.performanceGroupFilter)
    : all;

  filtered.sort((a, b) => {
    const desc = S.performanceSort === 'desc';
    if (S.performanceCriteria === 'ring') {
      return desc ? b[ringKey] - a[ringKey] : a[ringKey] - b[ringKey];
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

/** @param {1|2|3} ring */
export function setPerformanceRingFocus(ring) {
  const nomor = Number(ring);
  if (![1, 2, 3].includes(nomor)) return;
  S.performanceRingFocus = nomor;
  window.renderAll();
}

/** Klik kartu board: kelompok yang sama lagi = matikan (tampilkan semua lagi). */
export function filterPerformanceGroup(label) {
  S.performanceGroupFilter = S.performanceGroupFilter === label ? null : label;
  window.renderAll();
}

/**
 * Kriteria + ring fokus + arah urut — WAJIB tertulis di layar (Pakbos eksplisit:
 * "diinformasikan ring berapa"). Sama untuk panel normal, layar penuh peta, dan
 * tampilan besar (Pakbos: sort harus jalan di baik layar penuh maupun tidak).
 */
function performanceControlsHtml() {
  const crit = S.performanceCriteria;
  const ring = S.performanceRingFocus;
  const desc = S.performanceSort === 'desc';
  const btn = (active) => 'px-2 py-1 rounded-md ' +
    (active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500');
  const label = crit === 'ring'
    ? `Diurutkan berdasar %Ring ${ring} ${desc ? 'terbesar' : 'terkecil'}`
    : `Diurutkan berdasar total sales ${desc ? 'terbesar' : 'terkecil'}`;

  return `<div class="flex items-center gap-1.5 flex-wrap mb-2">` +
    `<div class="flex bg-slate-100 rounded-lg p-0.5 text-[10px] font-bold">` +
    `<button onclick="setPerformanceCriteria('units')" class="${btn(crit === 'units')}">Total Sales</button>` +
    `<button onclick="setPerformanceCriteria('ring')" class="${btn(crit === 'ring')}">Ring</button>` +
    `</div>` +
    (crit === 'ring'
      ? `<div class="flex bg-slate-100 rounded-lg p-0.5 text-[10px] font-bold">` +
        [1, 2, 3].map((r) =>
          `<button onclick="setPerformanceRingFocus(${r})" class="${btn(ring === r)}">${r}</button>`).join('') +
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

/** Baris peringkat ring — cuma ditulis waktu kriteria sort memang "ring". */
function ringRankLine(item) {
  if (S.performanceCriteria !== 'ring') return '';
  return `<div class="text-[10px] text-slate-400 mt-1">Peringkat ${esc(item.ringRank)} dari ` +
    `${esc(item.ringRankTotal)} — Ring ${S.performanceRingFocus}</div>`;
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
    `<div class="flex items-center gap-1 text-[10px] mono shrink-0 text-slate-500">` +
    `<span title="Ring 1">R1 ${esc(item.percent1.toFixed(0))}%</span>` +
    `<span title="Ring 2">R2 ${esc(item.percent2.toFixed(0))}%</span>` +
    `<span title="Ring 3">R3 ${esc(item.percent3.toFixed(0))}%</span>` +
    `<span title="Di luar ketiga ring" class="text-slate-400">Luar ${esc(item.percentLuarRing.toFixed(0))}%</span>` +
    `</div>` +
    `<div class="flex items-center gap-1.5 shrink-0" onclick="event.stopPropagation()">` +
    `<button onclick="showOnMap('${esc(item.code)}')" class="px-2 py-1.5 rounded-lg text-[11px] font-bold text-white" ` +
    `style="background:var(--astra-navy)"><i class="ph-fill ph-map-trifold"></i></button>` +
    `<button onclick="editRingFromTable('${esc(item.code)}')" class="px-2 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 text-slate-600 hover:bg-slate-50">` +
    `<i class="ph ph-target"></i></button>` +
    `</div></div>` +
    ringRankLine(item) +
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
    `<div class="flex items-center gap-1 mt-1 text-[9px] mono text-slate-500">` +
    `<span>R1 ${esc(item.percent1.toFixed(0))}%</span>` +
    `<span>R2 ${esc(item.percent2.toFixed(0))}%</span>` +
    `<span>R3 ${esc(item.percent3.toFixed(0))}%</span>` +
    `<span class="text-slate-400">Luar ${esc(item.percentLuarRing.toFixed(0))}%</span></div>` +
    `<div class="flex items-center gap-1 mt-1">${posisiBadgeHtml(item.posisi)}${acuanBadgeHtml(item.acuanGroup)}</div>` +
    ringRankLine(item) +
    `</div>`;
}

function coverageSummary(rows) {
  // Server yang baru dipasang belum punya tabel jangkauan. Bedanya "0%" dan "belum
  // dihitung" harus kelihatan — angka nol di semua baris tampak seperti temuan.
  if (!S.coverageReady) {
    return `<div class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">` +
      `<b>Jangkauan belum dihitung.</b> Jalankan <code class="mono">npm run seed-coverage</code> ` +
      `di server sekali, lalu muat ulang halaman ini.</div>`;
  }

  const split = splitByCoverage(rows);
  const percent = split.total ? (split.inside / split.total) * 100 : 0;

  return `<div class="rounded-xl border border-slate-200 p-3">` +
    `<div class="flex items-baseline justify-between">` +
    `<span class="text-[11px] uppercase font-bold text-slate-400">Dalam radius ` +
    `${esc((S.radiusM / 1000).toFixed(0))} km</span>` +
    `<span class="text-2xl font-extrabold text-emerald-600">${esc(percent.toFixed(1))}%</span></div>` +
    `<div class="bar-jangkauan mt-2"><span style="width:${percent.toFixed(1)}%"></span></div>` +
    `<div class="flex justify-between text-[11px] mt-1.5">` +
    `<span class="text-emerald-700 font-bold">${esc(formatNumber(Math.round(split.inside)))} unit</span>` +
    `<span class="font-bold" style="color:var(--astra-red)">${esc(formatNumber(Math.round(split.outside)))} unit di luar</span>` +
    `</div>` +
    // Yang belum punya batas wilayah disebut TERPISAH, bukan disembunyikan dan bukan
    // dicampur jadi "di luar jangkauan". Angka persennya di atas dihitung tanpa
    // mereka — jadi kalimat ini yang menjelaskan kenapa jumlahnya tidak genap.
    (split.noBoundary
      ? `<p class="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 ` +
        `rounded-lg px-2 py-1 mt-2 leading-snug">` +
        `${esc(formatNumber(Math.round(split.noBoundary)))} unit di kelurahan yang ` +
        `belum punya batas wilayah — tidak ikut dihitung di persentase atas.</p>`
      : '') +
    (S.radiusM === 5000 ? ''
      : `<p class="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 mt-2 leading-snug">` +
        `Radius acuan proyek ini 5 km.</p>`) +
    `</div>`;
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
  const bodyCompact = controls + (list.length ? list.map(performanceRowCompact).join('') : kosong);
  const summary = coverageSummary(rows);

  $('panel-performa').innerHTML = bodyWide;
  $('ringkas-jangkauan').innerHTML = summary;
  if ($('fs-performa')) $('fs-performa').innerHTML = bodyCompact;
  if ($('fs-ringkas')) $('fs-ringkas').innerHTML = summary;
  if ($('fp-performa')) $('fp-performa').innerHTML = bodyWide;
  if ($('fp-ringkas')) $('fp-ringkas').innerHTML = summary;
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
  // tertutup dan tombol Live-nya tetap menyala tanpa ada yang bergerak.
  if (S.livePerforma) toggleLivePerforma();
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
export function toggleLivePerforma() {
  const tombol = [$('btn-live-performa'), $('btn-live-performa-besar')].filter(Boolean);

  if (S.livePerforma) {
    clearInterval(S.livePerforma);
    S.livePerforma = null;
    tombol.forEach((b) => {
      b.classList.remove('live-nyala');
      b.querySelector('i').className = 'ph ph-play';
    });
    return;
  }

  S.livePerforma = setInterval(() => {
    const panel = panelPerformaAktif();
    if (!panel) return;
    const sisa = panel.scrollHeight - panel.clientHeight;
    if (sisa <= 4) return;
    panel.scrollTop = panel.scrollTop >= sisa - 1 ? 0 : panel.scrollTop + 1;
  }, 40);

  tombol.forEach((b) => {
    b.classList.add('live-nyala');
    b.querySelector('i').className = 'ph ph-pause';
  });
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

function villageSalesRows(rows) {
  const byVillage = {};
  rows.forEach((r) => { byVillage[r.village] = (byVillage[r.village] || 0) + r.units; });

  const kontribusi = contributionsByVillage(rows);
  const breaks = percentileBreaks([...kontribusi.values()]);

  return Object.keys(byVillage).map((code) => {
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
  const list = villageSalesRows(rows);
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

function dealerCardHtml(compact) {
  const code = activeDealerCode();
  if (!code) return '';

  // Seluruh pos milik dealer ini pada periode dan wilayah aktif — TIDAK ikut
  // dipersempit filter pos. Yang ditanyakan kartu ini memang rekap dealernya.
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

  const split = splitByCoverage(rows);
  const percent = split.total ? (split.inside / split.total) * 100 : 0;
  const name = S.dealerNames[code] || code;
  const color = dealerColor(S.registry, code);

  const perOutlet = sumBy(rows, 'outlet');
  const order = Object.keys(perOutlet).sort((a, b) => perOutlet[b] - perOutlet[a]);
  const chips = order.map((oc) =>
    `<span class="chip-pos" onclick="applyScope('pos','${esc(oc)}')">` +
    `<span class="w-2 h-2 rounded-full shrink-0" style="background:${esc(dealerColor(S.registry, (S.outletByCode[oc] || {}).dealerCode))}"></span>` +
    `${esc((S.outletByCode[oc] || {}).name || oc)}` +
    `<span class="n">${esc(formatNumber(perOutlet[oc]))}</span></span>`).join(' ');

  const stat = (value, label, cls, style) =>
    `<div class="text-center shrink-0"><div class="${compact ? 'text-lg' : 'text-2xl'} font-extrabold ${cls}" ${style}>${value}</div>` +
    `<div class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">${label}</div></div>`;

  return `<div class="flex items-center gap-${compact ? '3' : '4'} ${compact ? '' : 'flex-wrap'}">` +
    `<div class="${compact ? 'w-8 h-8 text-sm' : 'w-10 h-10'} rounded-xl flex items-center justify-center text-white font-extrabold shrink-0" ` +
    `style="background:${esc(color)}">${esc(name.slice(0, 1))}</div>` +
    `<div class="min-w-0">` +
    `<div class="font-extrabold text-slate-800 truncate ${compact ? 'text-sm' : ''}">${esc(name)}</div>` +
    `<div class="text-[11px] text-slate-400 truncate">Rekap seluruh pos di bawah dealer ini` +
    `${order.length ? ` · ${esc(order.length)} pos` : ''}</div></div>` +
    `<div class="flex items-center gap-${compact ? '4' : '6'} ml-auto shrink-0">` +
    stat(esc(formatNumber(split.total)), 'Total', 'text-slate-800', '') +
    stat(esc(percent.toFixed(0)) + '%', 'Dalam jangkauan', 'text-emerald-600', '') +
    stat(esc((100 - percent).toFixed(0)) + '%', 'Di luar', '', 'style="color:var(--astra-red)"') +
    `</div>` +
    `<div class="flex items-center gap-2 shrink-0">` +
    // Tombolnya cuma di kartu penuh. Kartu ringkas di atas peta memang dibuat sependek
    // mungkin supaya tidak menutupi wilayah yang justru sedang dilihat.
    (compact ? '' :
      `<button onclick="openDealerDetail('${esc(code)}')" style="background:var(--astra-navy)" ` +
      `class="px-3 py-2 rounded-xl text-white text-xs font-bold hover:opacity-90 whitespace-nowrap">` +
      `<i class="ph ph-list-magnifying-glass mr-1"></i>Rincian per kelurahan</button>`) +
    `<button onclick="closeDealerCard()" class="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50">Tutup</button>` +
    `</div></div>` +
    (compact
      ? `<div class="flex gap-2 mt-2.5 pt-2.5 border-t border-slate-200 overflow-x-auto pb-1">${chips}</div>`
      : `<div class="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100">${chips}</div>`);
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

export function renderTreemap(rows) {
  const mode = S.treemapView;
  const totals = totalsByMode(rows, mode);
  const codes = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 24);
  S.treemapCodes = codes;

  if (S.treemapChart) S.treemapChart.destroy();
  S.treemapChart = new ApexCharts($('treemap-chart'), treemapOptions(mode, codes, totals, 330));
  S.treemapChart.render();

  // Popup treemap (Bagian C): render ulang ke container KEDUA cuma waktu modalnya
  // sungguh terbuka — sama seperti panel Performa, dari `codes`/`totals` yang SAMA,
  // bukan dihitung ulang terpisah.
  const besar = $('modal-treemap');
  if (besar && !besar.classList.contains('hidden')) {
    if (S.treemapChartBesar) S.treemapChartBesar.destroy();
    S.treemapChartBesar = new ApexCharts(
      $('treemap-chart-besar'), treemapOptions(mode, codes, totals, window.innerHeight - 160));
    S.treemapChartBesar.render();
  }
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
  if (S.treemapChartBesar) { S.treemapChartBesar.destroy(); S.treemapChartBesar = null; }
}

