/**
 * KPI, legenda, treemap, dan panel peringkat.
 */
import {
  CLASS_LABELS, COLOR_EMPTY, RAMP, classRanges, dealerColor,
} from './colors.js';
import { $, esc, formatNumber, sumBy } from './dom.js';
import { activeRows, applyScope, clearScope, pageFilters, scopeValue, splitByCoverage } from './filters.js';
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
 * Legenda persentil.
 *
 * Rentang tiap kelas diambil dari nilai yang benar-benar jatuh di kelas itu, bukan
 * dihitung dari batasnya — lihat classRanges() di colors.js untuk alasannya.
 */
export function renderLegend(perVillage, breaks) {
  const values = Object.values(perVillage).filter((v) => v > 0);
  const ranges = classRanges(values, breaks);
  const used = ranges.filter((r) => !r.empty).length;

  $('legend').innerHTML =
    `<div class="flex items-center gap-2 text-[11px] text-slate-500">` +
    `<span class="w-3.5 h-3.5 rounded shrink-0" style="background:${COLOR_EMPTY}"></span>` +
    `<span class="flex-1">tidak ada penjualan</span>` +
    `<span class="mono text-slate-400">${esc(formatNumber(S.villages.length - values.length))}</span></div>` +
    RAMP.map((color, i) =>
      `<div class="flex items-center gap-2 text-[11px] ${ranges[i].empty ? 'text-slate-300' : 'text-slate-600'}">` +
      `<span class="w-3.5 h-3.5 rounded shrink-0" style="background:${color}"></span>` +
      `<span class="flex-1">${CLASS_LABELS[i]}</span>` +
      `<span class="mono ${ranges[i].empty ? 'text-slate-300' : 'text-slate-400'}">${esc(ranges[i].label)}</span></div>`).join('') +
    `<p class="text-[10px] text-slate-400 pt-1.5 leading-snug">` +
    (used < RAMP.length && values.length
      ? `Sebarannya terlalu sempit untuk lima kelas — ${used} kelas terpakai. ` : '') +
    `Kelas dihitung dari sebaran yang sedang tampil, jadi ikut berubah waktu filternya diganti.</p>`;
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
   Fungsi utama produknya: berapa bagian penjualan tiap pos yang berada di dalam radius
   jangkauan. Rasionya dihitung server dari luas kelurahan yang beririsan dengan
   lingkaran radius — lihat backend/core/coverage.js.
   ========================================================================== */

function performanceByOutlet(rows) {
  const byOutlet = {};
  rows.forEach((r) => { (byOutlet[r.outlet] ||= []).push(r); });

  return Object.keys(byOutlet).map((code) => {
    const split = splitByCoverage(byOutlet[code]);
    const outlet = S.outletByCode[code] || {};
    return {
      code,
      name: outlet.name || code,
      dealer: outlet.dealerName || '',
      color: dealerColor(S.registry, outlet.dealerCode),
      units: split.total,
      percent: split.total ? (split.inside / split.total) * 100 : 0,
    };
  }).sort((a, b) => a.percent - b.percent);   // yang paling bermasalah di atas
}

function performanceRow(item) {
  const active = scopeValue('pos') === item.code;
  return `<div onclick="applyScope('pos','${esc(item.code)}')" ` +
    `class="baris-pos rounded-xl px-3 py-2 ${active ? 'aktif' : ''}">` +
    `<div class="flex items-center gap-2">` +
    `<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${esc(item.color)}"></span>` +
    `<span class="flex-1 text-sm font-semibold text-slate-800 truncate">${esc(item.name)}</span>` +
    `<span class="text-[11px] text-slate-400 mono shrink-0">${esc(formatNumber(item.units))} unit</span></div>` +
    `<div class="text-[11px] text-slate-400 truncate mb-1">${esc(item.dealer)}</div>` +
    `<div class="bar-jangkauan"><span style="width:${item.percent.toFixed(1)}%"></span></div>` +
    `<div class="flex justify-between text-[11px] font-bold mt-1">` +
    `<span class="text-emerald-600">${esc(item.percent.toFixed(0))}% dalam jangkauan</span>` +
    `<span style="color:var(--astra-red)">${esc((100 - item.percent).toFixed(0))}% di luar</span>` +
    `</div></div>`;
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
  const list = performanceByOutlet(rows);
  const body = list.length ? list.map(performanceRow).join('')
    : '<p class="text-center text-slate-400 text-sm py-8">Tidak ada pos pada filter ini.</p>';
  const summary = coverageSummary(rows);

  $('panel-performa').innerHTML = body;
  $('ringkas-jangkauan').innerHTML = summary;
  if ($('fs-performa')) $('fs-performa').innerHTML = body;
  if ($('fs-ringkas')) $('fs-ringkas').innerHTML = summary;
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
  const city = f.scopeKind === 'kota' ? f.scopeCode : 'ALL';
  const rows = S.sales.filter((r) => {
    if (r.dealer !== code) return false;
    if (f.from !== 'ALL' && r.period < f.from) return false;
    if (f.to !== 'ALL' && r.period > f.to) return false;
    const village = S.villageByCode[r.village];
    if (!village) return false;
    if (city !== 'ALL' && village.cityCode !== city) return false;
    if (f.province !== 'ALL' && village.provinceCode !== f.province) return false;
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
  clearScope();
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

export function renderTreemap(rows) {
  const mode = S.treemapView;
  const totals = totalsByMode(rows, mode);
  const codes = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 24);
  S.treemapCodes = codes;

  const options = {
    chart: {
      type: 'treemap', height: 330, toolbar: { show: false }, fontFamily: 'Manrope',
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

  if (S.treemapChart) S.treemapChart.destroy();
  S.treemapChart = new ApexCharts($('treemap-chart'), options);
  S.treemapChart.render();
}

export function selectEntity(mode, code) { applyScope(mode, code); }

