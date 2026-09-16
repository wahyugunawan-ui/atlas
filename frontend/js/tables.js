/**
 * Panel rincian kelurahan, tabel master, dan perpindahan tab.
 */
import {
  browseCustomers, createDealer, createOutlet, deleteAlias, deleteDealer, fetchAliases,
  fetchCustomers, resetOutlets, saveAlias, saveDealer, saveOutlet,
} from './api.js';
import { dealerColor, percentileBreaks } from './colors.js';
import {
  CUSTOMER_PANEL_LIMIT, KARESIDENAN, PROVINCE_NAMES, SHOW_ENGINE_NUMBER, SHOW_HOUSE_PHOTO,
  TABLE_ROW_LIMIT,
} from './config.js';
import { $, esc, formatNumber, formatPercent, monthLabel, sumBy, toast } from './dom.js';
import { syncFilterBar } from './filter-bar.js';
import {
  activeRows, clearScope, dealerBreakdown, pageFilters, scopeValue, setScope,
} from './filters.js';
import { selectOutlet } from './outlets.js';
import { dealerCardHtml } from './render.js';
import { fitToScope } from './map.js';
import {
  contributionPercent, contributionsForRows, groupByCity, referenceGap, referenceRatio,
  relativePosition,
} from './sales-stats.js';
import { S } from './state.js';

/* ==========================================================================
   PANEL RINCIAN KELURAHAN
   ==========================================================================
   Diminta di meeting 12 Agustus: daftar pos dan daftar konsumen dipisah dengan judul
   sendiri supaya tidak menyatu dan susah dibaca. Porsinya tetap sama.
   ========================================================================== */

function sectionHeader(icon, title, count) {
  return `<div class="flex items-center gap-1.5 text-[11px] uppercase font-bold ` +
    `text-slate-500 bg-slate-100 rounded-lg px-2.5 py-1.5 mt-4 mb-2">` +
    `<i class="ph-fill ph-${icon}"></i>${title}` +
    `<span class="ml-auto mono text-slate-400">${esc(formatNumber(count))}</span></div>`;
}

/* ==========================================================================
   PANEL RINCIAN DEALER
   ==========================================================================
   Kartu dealer menjawab "berapa persen di dalam radius". Panel ini menjawab pertanyaan
   yang selalu datang sesudahnya: "di kelurahan mana saja?".

   DUA TINGKAT, dan itu hasil pengukuran. Dealer terbesar menyentuh 1.157 kelurahan dan
   677 di antaranya cuma satu unit — daftar datar sepanjang itu isinya hampir seluruhnya
   "1 unit". Kabupaten memampatkannya jadi 25 baris; kelurahannya menyusul waktu diklik.

   Panelnya PANEL YANG SAMA dengan klik-kelurahan, bukan panel kedua. Di atas peta yang
   sempit, dua panel bersanding menutupi justru wilayah yang sedang dilihat.

   Nama konsumen tidak ikut di sini. Dia baru diambil waktu satu kelurahan diklik, dan
   itu bukan pilihan rancangan: /api/customers menolak permintaan tanpa kode kelurahan,
   supaya satu akun bersama tidak bisa menyedot seluruh basis data konsumen.
   ========================================================================== */

/**
 * Jadwal menyembunyikan panel, supaya bisa DIBATALKAN.
 *
 * closeVillageDetail() menyelesaikan animasi geser dulu sebelum memasang `hidden`,
 * jadi ada jendela 300 ms. Panel yang dibuka di dalam jendela itu akan disembunyikan
 * lagi oleh jadwal lama yang belum sempat berjalan — panelnya tampak tidak terbuka
 * sama sekali, tanpa satu pun pesan. Gejalanya bergantung waktu, jadi kadang muncul
 * kadang tidak, dan itu yang membuatnya paling sulit dipercaya waktu dilaporkan.
 */
let hideTimer = null;

/** Tampilkan panel geser, sekaligus batalkan jadwal sembunyi yang masih menggantung. */
function showPanel() {
  clearTimeout(hideTimer);
  const panel = $('kelurahanDetailPanel');
  panel.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.remove('translate-x-full'));
}

/** Kabupaten yang sedang mekar. Bertahan waktu bolak-balik dari panel kelurahan. */
const dealerCityOpen = new Set();

/** Kelurahan per kabupaten yang ditampilkan sekaligus. Sisanya diringkas satu baris. */
const VILLAGE_CHUNK = 200;

function coverageBar(inside, covered) {
  const percent = covered ? (inside / covered) * 100 : 0;
  return `<div class="bar-jangkauan w-16 shrink-0" title="${esc(percent.toFixed(0))}% dalam jangkauan">` +
    `<span style="width:${esc(percent.toFixed(1))}%"></span></div>`;
}

export function openDealerDetail(dealerCode) {
  S.panelView = { kind: 'dealer', code: dealerCode };
  // Sorotan kelurahan di peta dilepas: panel ini bicara tentang dealer, dan
  // membiarkan satu kelurahan tetap tersorot membuat orang mengira daftarnya
  // sedang disaring ke kelurahan itu.
  S.selectedVillage = null;
  if (S.layersReady) S.map.setFilter('kel-terpilih', ['==', ['get', 'kode'], '']);
  const name = S.dealerNames[dealerCode] || dealerCode;

  // Baris dealer ini pada periode dan wilayah aktif — TIDAK dipersempit filter pos,
  // sama seperti kartu dealernya. Kalau berbeda, angka di panel dan di kartu tidak
  // akan bersambung dan tidak ada yang tahu mana yang benar.
  const f = pageFilters();
  const city = f.cityCode;
  const kares = f.kares;
  const rows = S.sales.filter((r) => {
    if (r.dealer !== dealerCode) return false;
    if (f.from !== 'ALL' && r.period < f.from) return false;
    if (f.to !== 'ALL' && r.period > f.to) return false;
    const village = S.villageByCode[r.village];
    if (!village) return false;
    if (city !== 'ALL' && village.cityCode !== city) return false;
    if (kares !== 'ALL' && !KARESIDENAN[kares].cities.includes(village.cityCode)) return false;
    return true;
  });

  const cities = dealerBreakdown(rows);
  const total = cities.reduce((sum, k) => sum + k.units, 0);
  const villageCount = cities.reduce((sum, k) => sum + k.villages.length, 0);

  // Kontribusi % tiap kelurahan TERHADAP DATA DEALER INI SAJA — rows sudah disaring ke
  // dealerCode, jadi "total kota" yang dipakai contributionsForRows() otomatis jadi
  // "total dealer ini di kota itu", bukan total seluruh dealer. Sama persis prinsipnya
  // dengan panel kelurahan: satu fungsi, input yang beda mengikuti filter aktif.
  const kontribusiDealer = contributionsForRows(rows, S.villageByCode);
  const avgContribution = kontribusiDealer.size
    ? [...kontribusiDealer.values()].reduce((a, b) => a + b, 0) / kontribusiDealer.size
    : null;

  $('kelurahanDetailBack').innerHTML = '';
  // Ringkasan dealer (avatar, nama, AVG Kontribusi/Posisi Relatif/Acuan Bisnis,
  // pecahan ring/coverage) digabung ke ATAS rincian per kelurahan yang sudah ada
  // di sini — permintaan user: satu panel, bukan dua langkah klik. Dipakai versi
  // compact yang sama dengan strip #fs-kartu (layar penuh), sudah satu baris
  // ramping. Aman dipanggil di sini: dealerCode yang dikirim ke fungsi ini selalu
  // sama dengan scope dealer yang sedang aktif di SEMUA titik panggil yang ada
  // (klik marker, tombol "Rincian per kelurahan" di kartunya sendiri, tombol
  // kembali antar-kabupaten) — dealerCardHtml() membaca scope aktif, bukan
  // parameter ini, tapi keduanya selalu selaras.
  $('kelurahanDetailSummary').innerHTML = dealerCardHtml(true);
  $('kelurahanDetailTitle').textContent = name;
  $('kelurahanDetailMeta').textContent =
    `${formatNumber(cities.length)} kabupaten · ${formatNumber(villageCount)} kelurahan`;

  $('kelurahanDetailList').innerHTML =
    `<div class="grid grid-cols-2 gap-2 pb-3 border-b border-slate-200">` +
    `<div><div class="text-[10px] uppercase font-bold text-slate-400">Total Penjualan</div>` +
    `<div class="text-lg font-extrabold text-slate-900 mono">${esc(formatNumber(total))}</div></div>` +
    `<div><div class="text-[10px] uppercase font-bold text-slate-400">Kelurahan Ber-sales</div>` +
    `<div class="text-lg font-extrabold text-slate-900 mono">${esc(formatNumber(villageCount))}</div></div>` +
    `<div><div class="text-[10px] uppercase font-bold text-slate-400" ` +
    'title="Rata-rata Kontribusi Penjualan seluruh kelurahan yang dilayani dealer ini, terhadap total dealer ini per kota.">Rata-rata Kontribusi</div>' +
    `<div class="text-lg font-extrabold text-slate-900 mono">${esc(formatPercent(avgContribution))}</div></div>` +
    `<div><div class="text-[10px] uppercase font-bold text-slate-400">Mode Heatmap</div>` +
    `<div class="text-sm font-bold text-slate-700 mt-0.5">${esc(heatmapModeLabel())}</div></div>` +
    '</div>' +
    sectionHeader('buildings', 'Sebaran per Kabupaten', cities.length) +
    (cities.length
      ? cities.map((k) => dealerCityHtml(k, dealerCode)).join('')
      : '<p class="text-xs text-slate-400 text-center py-4">Tidak ada penjualan pada filter ini.</p>');

  showPanel();
}

/** Belum fungsional mengubah warna peta — togglenya dipasang di bagian berikutnya. */
function heatmapModeLabel() {
  return S.heatmapMode === 'fixed' ? 'Per Nilai Kontribusi' : 'Per Peringkat Relatif';
}

/**
 * Panel ringkasan satu kota — dipakai waktu kota dipilih TANPA kelurahan spesifik
 * yang aktif. Muncul dari `frontend/js/filter-bar.js` (dropdown Kabupaten) dan
 * digambar ulang otomatis tiap filter berubah lewat S.panelView di renderAll()
 * (app.js), pola yang sama persis dengan panel dealer di atas.
 *
 * Angkanya SELALU dihitung ulang dari activeRows() — tidak ada nilai yang
 * dipertahankan dari kota sebelumnya (aturan spek: ganti kota = ganti semua angka).
 */
export function openCitySummary(cityCode) {
  S.panelView = { kind: 'city', code: cityCode };
  S.selectedVillage = null;
  if (S.layersReady) S.map.setFilter('kel-terpilih', ['==', ['get', 'kode'], '']);

  const rows = activeRows().filter((r) => {
    const village = S.villageByCode[r.village];
    return village && village.cityCode === cityCode;
  });
  const perCity = groupByCity(rows, S.villageByCode);
  const kota = perCity.get(cityCode) || { total: 0, villages: new Map() };
  const villageCount = kota.villages.size;
  const avgContribution = villageCount
    ? [...kota.villages.entries()]
      .reduce((sum, [, units]) => sum + contributionPercent(units, kota.total), 0) / villageCount
    : null;

  // Posisi Relatif dihitung dari SELURUH filter aktif (semua kota kalau tidak ada
  // filter kota lain yang menyempitkan) — definisi yang sama dengan panel kelurahan,
  // supaya label "Terbawah"/"Teratas" berarti hal yang sama di mana pun dilihat.
  const kontribusiAktif = contributionsForRows(activeRows(), S.villageByCode);
  const breaks = percentileBreaks([...kontribusiAktif.values()]);
  const distribusi = { Terbawah: 0, Bawah: 0, Tengah: 0, Atas: 0, Teratas: 0 };
  kota.villages.forEach((units, villageCode) => {
    const pct = contributionPercent(units, kota.total);
    const label = pct == null ? null : relativePosition(pct, breaks);
    if (label) distribusi[label]++;
  });

  $('kelurahanDetailBack').innerHTML = '';
  $('kelurahanDetailTitle').textContent = S.cityNames[cityCode] || cityCode;
  $('kelurahanDetailMeta').textContent = `${formatNumber(villageCount)} kelurahan berpenjualan · ${cityCode}`;

  $('kelurahanDetailList').innerHTML =
    `<div class="grid grid-cols-2 gap-2 pb-3 border-b border-slate-200">` +
    `<div><div class="text-[10px] uppercase font-bold text-slate-400">Total Penjualan</div>` +
    `<div class="text-lg font-extrabold text-slate-900 mono">${esc(formatNumber(kota.total))}</div></div>` +
    `<div><div class="text-[10px] uppercase font-bold text-slate-400">Jumlah Kelurahan</div>` +
    `<div class="text-lg font-extrabold text-slate-900 mono">${esc(formatNumber(villageCount))}</div></div>` +
    `<div><div class="text-[10px] uppercase font-bold text-slate-400" ` +
    'title="Rata-rata Kontribusi Penjualan seluruh kelurahan berpenjualan di kota ini.">Rata-rata Kontribusi</div>' +
    `<div class="text-lg font-extrabold text-slate-900 mono">${esc(formatPercent(avgContribution))}</div></div>` +
    `<div><div class="text-[10px] uppercase font-bold text-slate-400">Mode Heatmap</div>` +
    `<div class="text-sm font-bold text-slate-700 mt-0.5">${esc(heatmapModeLabel())}</div></div>` +
    '</div>' +

    `<div class="pb-3">` +
    `<div class="text-[11px] uppercase font-bold text-slate-400 mb-2">Distribusi Posisi Relatif</div>` +
    (villageCount
      ? Object.entries(distribusi).map(([label, n]) =>
        `<div class="flex items-center justify-between text-xs py-1.5">` +
        `<span>${posisiBadgeHtml(label)}</span>` +
        `<span class="mono font-bold text-slate-800">${esc(formatNumber(n))} wilayah</span></div>`).join('')
      : '<p class="text-xs text-slate-400">Data belum tersedia.</p>') +
    '</div>';

  showPanel();
}

function dealerCityHtml(kota, dealerCode) {
  const open = dealerCityOpen.has(kota.cityCode);
  const percent = kota.covered ? (kota.inside / kota.covered) * 100 : 0;

  const shown = kota.villages.slice(0, VILLAGE_CHUNK);
  const isi = open
    ? shown.map((v) => {
      const vp = v.covered ? (v.inside / v.covered) * 100 : 0;
      return `<div class="flex items-center gap-2 pl-4 pr-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer" ` +
        `onclick="jumpFromDealer('${esc(v.code)}','${esc(dealerCode)}')">` +
        `<div class="flex-1 min-w-0">` +
        `<div class="text-xs text-slate-700 truncate">${esc(v.name)}</div>` +
        `<div class="text-[10px] text-slate-400 truncate">${esc(v.district)}</div></div>` +
        (v.covered
          ? coverageBar(v.inside, v.covered) +
            `<span class="text-[10px] mono text-slate-400 w-8 text-right shrink-0">${esc(vp.toFixed(0))}%</span>`
          : `<span class="text-[10px] text-amber-600 shrink-0" title="Belum ada batas wilayah">tanpa batas</span>`) +
        `<span class="text-xs font-bold mono text-slate-800 w-8 text-right shrink-0">${esc(formatNumber(v.units))}</span>` +
        `</div>`;
    }).join('') +
      (kota.villages.length > shown.length
        ? `<div class="pl-4 py-1.5 text-[10px] text-slate-400">` +
          `Menampilkan ${esc(formatNumber(shown.length))} dari ` +
          `${esc(formatNumber(kota.villages.length))} kelurahan.</div>`
        : '')
    : '';

  // Nama kabupaten diberi BARIS SENDIRI, bilah jangkauan turun ke baris kedua.
  //
  // Versi pertama menaruh semuanya sebaris — nama, bilah, persen, unit — dan di panel
  // selebar 320 px nama kabupatennya terpotong jadi "Kabupat…". Cilacap dan Cirebon
  // jadi tidak bisa dibedakan, dan itu menghapus satu-satunya hal yang membuat baris
  // ini berguna.
  return `<div class="border-b border-slate-100 last:border-0">` +
    `<div class="flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-slate-50 cursor-pointer" ` +
    `onclick="toggleDealerCity('${esc(kota.cityCode)}','${esc(dealerCode)}')">` +
    `<i class="ph ph-caret-${open ? 'down' : 'right'} text-slate-400 shrink-0 mt-0.5"></i>` +
    `<div class="flex-1 min-w-0">` +
    `<div class="text-sm font-semibold text-slate-800 truncate">${esc(kota.cityName)}</div>` +
    `<div class="flex items-center gap-1.5 mt-0.5">` +
    `<span class="text-[10px] text-slate-400 shrink-0">${esc(formatNumber(kota.villages.length))} kel</span>` +
    coverageBar(kota.inside, kota.covered) +
    `<span class="text-[10px] mono text-slate-400 shrink-0">${esc(percent.toFixed(0))}%</span>` +
    `</div></div>` +
    `<span class="text-sm font-bold mono text-slate-900 shrink-0">${esc(formatNumber(kota.units))}</span>` +
    `</div>${isi}</div>`;
}

export function toggleDealerCity(cityCode, dealerCode) {
  if (dealerCityOpen.has(cityCode)) dealerCityOpen.delete(cityCode);
  else dealerCityOpen.add(cityCode);
  openDealerDetail(dealerCode);
}

/**
 * Dari panel dealer ke panel kelurahan, dengan jalan pulang.
 *
 * Kabupaten yang sedang mekar SENGAJA tidak direset — orang yang menelusuri satu
 * kabupaten lalu kembali akan menemukannya persis seperti yang ditinggalkan.
 */
export function jumpFromDealer(villageCode, dealerCode) {
  openVillageDetail(villageCode, dealerCode);
}

/**
 * Badge kecil berwarna untuk Posisi Relatif. `null` berarti kota belum punya
 * penjualan sama sekali pada filter aktif — "Data belum tersedia", bukan "Terbawah".
 */
export function posisiBadgeHtml(label) {
  if (!label) return '<span class="text-xs text-slate-400">Data belum tersedia</span>';
  const WARNA = {
    Terbawah: 'bg-red-50 text-red-700 border-red-200',
    Bawah: 'bg-orange-50 text-orange-700 border-orange-200',
    Tengah: 'bg-slate-100 text-slate-600 border-slate-200',
    Atas: 'bg-sky-50 text-sky-700 border-sky-200',
    Teratas: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return `<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border ${WARNA[label]}" ` +
    'title="Dihitung dari sebaran Kontribusi Penjualan seluruh kelurahan pada filter yang sedang aktif -- bukan ambang tetap. 20% terendah = Terbawah, 20% teratas = Teratas.">' +
    `${esc(label)}</span>`;
}

/** '+0,50 poin persentase' / '-0,58 poin persentase' / 'Data belum tersedia'. */
function formatGap(n) {
  if (n == null) return 'Data belum tersedia';
  const tanda = n > 0 ? '+' : '';
  return tanda + n.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
    ' poin persentase';
}

/**
 * Semua angka Blok 3 (Distribution) dan Blok 4 (Business Reference) untuk satu
 * kelurahan, dihitung dari `rows` yang SUDAH melewati seluruh filter aktif (periode,
 * kota, dealer, pos, provinsi) — bukan disaring ulang di sini.
 *
 * Kontribusi dan posisi relatif kota lain TIDAK bisa saling memengaruhi: masing-
 * masing dihitung terhadap total KOTANYA SENDIRI (groupByCity), sesuai desain
 * sales-stats.js.
 */
function villageStats(code, rows) {
  const village = S.villageByCode[code] || {};
  const perCity = groupByCity(rows, S.villageByCode);
  const kota = perCity.get(village.cityCode);

  const myUnits = kota ? (kota.villages.get(code) || 0) : 0;
  const contribution = kota ? contributionPercent(myUnits, kota.total) : null;

  const kontribusiAktif = contributionsForRows(rows, S.villageByCode);
  const breaks = percentileBreaks([...kontribusiAktif.values()]);
  const posisi = contribution == null ? null : relativePosition(contribution, breaks);

  let rank = null;
  let rankTotal = null;
  let cityAverage = null;
  if (kota) {
    const sorted = [...kota.villages.entries()].sort((a, b) => b[1] - a[1]);
    const idx = sorted.findIndex(([kode]) => kode === code);
    rank = idx === -1 ? null : idx + 1;
    rankTotal = sorted.length;
    cityAverage = sorted.length
      ? sorted.reduce((sum, [, units]) => sum + contributionPercent(units, kota.total), 0) / sorted.length
      : null;
  }

  const benchmark = S.businessReferencePercent;
  return {
    myUnits,
    contribution,
    posisi,
    rank,
    rankTotal,
    cityAverage,
    benchmark,
    gap: referenceGap(contribution, benchmark),
    ratio: referenceRatio(contribution, benchmark),
  };
}

/** Unit per bulan untuk satu kelurahan, atau `null` kalau cuma satu bulan (tidak ada tren untuk digambar). */
function villageTrend(code, rows) {
  const perPeriod = {};
  rows.forEach((r) => { perPeriod[r.period] = (perPeriod[r.period] || 0) + r.units; });
  const periods = Object.keys(perPeriod).sort();
  return periods.length >= 2 ? periods.map((p) => ({ period: p, units: perPeriod[p] })) : null;
}

/** Gambar (atau bongkar) grafik tren Blok 2. Dipanggil SETELAH innerHTML terpasang. */
function renderVillageTrend(trend) {
  if (S.villageTrendChart) { S.villageTrendChart.destroy(); S.villageTrendChart = null; }
  const holder = $('village-trend-chart');
  if (!holder || !trend) return;
  S.villageTrendChart = new ApexCharts(holder, {
    chart: { type: 'line', height: 130, toolbar: { show: false }, fontFamily: 'Manrope' },
    series: [{ name: 'Unit', data: trend.map((t) => t.units) }],
    xaxis: { categories: trend.map((t) => monthLabel(t.period)), labels: { style: { fontSize: '10px' } } },
    yaxis: { labels: { style: { fontSize: '10px' } } },
    colors: ['#0b2f6b'],
    dataLabels: { enabled: false },
    stroke: { width: 2, curve: 'smooth' },
    tooltip: { y: { formatter: (v) => formatNumber(v) + ' unit' } },
  });
  S.villageTrendChart.render();
}

/**
 * Panel rincian satu kelurahan — 4 blok: Overview, Sales, Distribution, Business
 * Reference (di atas daftar per-pos dan konsumen yang sudah ada sebelumnya).
 *
 * @param {string} code        kode kelurahan
 * @param {string} [fromDealer] kalau dibuka dari panel dealer, kode dealernya —
 *   panel diberi tautan kembali supaya orang tidak kehilangan jalur telusurnya
 */
export function openVillageDetail(code, fromDealer) {
  S.selectedVillage = code;
  S.panelView = { kind: 'village', code: code };
  const village = S.villageByCode[code] || {};
  const semuaAktif = activeRows();
  const rows = semuaAktif.filter((r) => r.village === code);
  const perOutlet = sumBy(rows, 'outlet');
  const total = Object.values(perOutlet).reduce((sum, n) => sum + n, 0);
  const order = Object.keys(perOutlet).sort((a, b) => perOutlet[b] - perOutlet[a]);

  const stats = villageStats(code, semuaAktif);
  const trend = villageTrend(code, rows);

  $('kelurahanDetailBack').innerHTML = fromDealer
    ? `<button onclick="openDealerDetail('${esc(fromDealer)}')" ` +
      `class="text-[11px] font-bold text-slate-500 hover:text-slate-800">` +
      `&lsaquo; kembali ke ${esc(S.dealerNames[fromDealer] || fromDealer)}</button>`
    : '';
  // Drill-down kelurahan biasa bicara soal SATU kelurahan, bukan dealer — ringkasan
  // dealer (diisi openDealerDetail()) dikosongkan supaya tidak nyasar tampil di sini.
  $('kelurahanDetailSummary').innerHTML = '';
  $('kelurahanDetailTitle').textContent = village.name || code;
  $('kelurahanDetailMeta').textContent =
    `${village.district || ''} · ${village.cityName || ''} · ${code}`;

  $('kelurahanDetailList').innerHTML =
    // --- Blok 1: OVERVIEW ---
    `<div class="grid grid-cols-2 gap-2 pb-3 border-b border-slate-200">` +
    `<div><div class="text-[10px] uppercase font-bold text-slate-400">Total Penjualan</div>` +
    `<div class="text-lg font-extrabold text-slate-900 mono">${esc(formatNumber(total))}</div></div>` +
    `<div><div class="text-[10px] uppercase font-bold text-slate-400" ` +
    `title="Kontribusi penjualan kelurahan terhadap total penjualan kotanya.">Kontribusi Penjualan</div>` +
    `<div class="text-lg font-extrabold text-slate-900 mono">${esc(formatPercent(stats.contribution))}</div></div>` +
    `<div><div class="text-[10px] uppercase font-bold text-slate-400">Posisi Relatif</div>` +
    `<div class="mt-0.5">${posisiBadgeHtml(stats.posisi)}</div></div>` +
    `<div><div class="text-[10px] uppercase font-bold text-slate-400" ` +
    'title="Acuan bisnis dari Marketing/Head Department, bukan hasil statistik.">Acuan Bisnis</div>' +
    `<div class="text-sm font-bold text-slate-700 mt-0.5">${
      stats.ratio == null ? 'Data belum tersedia'
        : `${esc(formatPercent(stats.ratio, 0))} dari ${esc(formatPercent(stats.benchmark, 0))}`
    }</div></div></div>` +

    // --- Blok 2: SALES ---
    `<div class="pb-3 border-b border-slate-200">` +
    `<div class="text-[11px] uppercase font-bold text-slate-400 mb-2">Tren Bulanan</div>` +
    (trend
      ? '<div id="village-trend-chart"></div>'
      : '<p class="text-xs text-slate-400">Data belum tersedia atau filter cuma satu bulan.</p>') +
    '</div>' +

    // --- Blok 3: DISTRIBUTION ---
    `<div class="pb-3 border-b border-slate-200">` +
    `<div class="text-[11px] uppercase font-bold text-slate-400 mb-2">Distribusi</div>` +
    `<div class="grid grid-cols-2 gap-2 text-xs text-slate-600">` +
    `<div>Peringkat: <b class="text-slate-800">${
      stats.rank == null ? '—' : `${esc(formatNumber(stats.rank))} / ${esc(formatNumber(stats.rankTotal))}`
    }</b></div>` +
    `<div title="Rata-rata Kontribusi Penjualan seluruh kelurahan berpenjualan di kota yang sama.">` +
    `Rata-rata Kota: <b class="text-slate-800">${esc(formatPercent(stats.cityAverage))}</b></div>` +
    '</div></div>' +

    sectionHeader('storefront', 'Penjualan per Pos', order.length) +
    (order.length ? order.map((outletCode) => {
      const outlet = S.outletByCode[outletCode] || {};
      return `<div class="flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-slate-50 cursor-pointer" onclick="selectOutlet('${esc(outletCode)}')">` +
        `<span class="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style="background:${esc(dealerColor(S.registry, outlet.dealerCode))}"></span>` +
        `<div class="flex-1 min-w-0">` +
        `<div class="text-sm text-slate-800 font-semibold truncate">${esc(outlet.name || outletCode)}</div>` +
        `<div class="text-[11px] text-slate-400 truncate">${esc(outlet.dealerName || '')}` +
        ` <button onclick="event.stopPropagation(); openOutletEditor('${esc(outletCode)}')" ` +
        `class="text-slate-400 hover:text-slate-700" title="Sunting alamat dan koordinat">` +
        `<i class="ph ph-pencil-simple"></i></button></div></div>` +
        `<div class="text-right shrink-0">` +
        `<div class="text-sm font-bold text-slate-900 mono">${esc(formatNumber(perOutlet[outletCode]))}</div>` +
        `<div class="text-[10px] text-slate-400 mono">${esc((perOutlet[outletCode] / total * 100).toFixed(0))}%</div>` +
        `</div></div>`;
    }).join('')
      : '<p class="text-xs text-slate-400 text-center py-4">Tidak ada penjualan pada filter ini.</p>') +

    // --- Blok 4: BUSINESS REFERENCE ---
    `<div class="pt-3 pb-3 border-b border-slate-200">` +
    `<div class="text-[11px] uppercase font-bold text-slate-400 mb-2" ` +
    'title="Acuan bisnis dari Marketing/Head Department, bukan hasil statistik.">Business Reference</div>' +
    `<div class="text-xs text-slate-600 space-y-1">` +
    `<div>Acuan aktif: <b class="text-slate-800">${esc(formatPercent(stats.benchmark, 0))}</b></div>` +
    `<div title="Kontribusi Penjualan dikurangi Acuan Bisnis.">Selisih dari Acuan: ` +
    `<b class="text-slate-800">${esc(formatGap(stats.gap))}</b></div>` +
    `<div title="Kontribusi Penjualan dibagi Acuan Bisnis.">Rasio terhadap Acuan: ` +
    `<b class="text-slate-800">${esc(formatPercent(stats.ratio, 0))}</b></div>` +
    '</div></div>' +

    (S.hasCustomers
      ? sectionHeader('users-three', 'Konsumen', 0).replace('>0<', '>…<') +
        '<p class="text-xs text-slate-400 text-center py-3" id="village-customers">memuat…</p>'
      : '');

  renderVillageTrend(trend);
  showPanel();

  if (S.hasCustomers) loadVillageCustomers(code);

  // Sejak 2026-09-14: klik kelurahan di peta (dan jumpFromDealer()/jumpToVillage()
  // yang berujung ke fungsi ini) ikut auto-Fit — jalur ini TIDAK lewat renderAll(),
  // jadi tidak tercakup hook auto-Fit di sana, perlu baris sendiri di sini.
  if (S.layersReady) fitToScope(true);
}

/**
 * Konsumen diambil per kelurahan, saat dibuka.
 *
 * Bukan sekaligus di awal seperti versi sebelumnya. Bedanya bukan kecepatan: satu akun
 * dipakai bersama, dan tidak boleh ada satu permintaan yang bisa menyedot seluruh
 * basis data konsumen. Server juga menolak permintaan tanpa kode kelurahan.
 */
async function loadVillageCustomers(code) {
  const holder = $('village-customers');
  if (!holder) return;
  try {
    const { from, to } = pageFilters();
    const { customers } = await fetchCustomers(code, { from, to });
    // Kalau orangnya sudah pindah ke kelurahan lain sebelum ini selesai, jangan timpa.
    if (S.selectedVillage !== code) return;

    const outletFilter = scopeValue('pos');
    const dealerFilter = scopeValue('dealer');
    const list = customers.filter((c) => {
      const outlet = S.outletByCode[c.outlet] || {};
      if (outletFilter !== 'ALL' && c.outlet !== outletFilter) return false;
      if (dealerFilter !== 'ALL' && outlet.dealerCode !== dealerFilter) return false;
      return true;
    });

    const header = holder.previousElementSibling;
    if (header) header.querySelector('span:last-child').textContent = formatNumber(list.length);

    holder.outerHTML = list.length
      ? list.slice(0, CUSTOMER_PANEL_LIMIT).map((c) => {
        const outlet = S.outletByCode[c.outlet] || {};
        return `<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50">` +
          `<span class="w-2 h-2 rounded-full shrink-0" style="background:${esc(dealerColor(S.registry, outlet.dealerCode))}"></span>` +
          `<div class="min-w-0 flex-1"><div class="text-sm text-slate-700 truncate">${esc(c.name)}</div>` +
          `<div class="text-[11px] text-slate-400 truncate">${esc(c.address)}</div></div></div>`;
      }).join('') +
        (list.length > CUSTOMER_PANEL_LIMIT
          ? `<div class="text-[11px] text-slate-400 px-2 pt-1">Menampilkan ${CUSTOMER_PANEL_LIMIT} dari ${esc(formatNumber(list.length))}.</div>`
          : '')
      : '<p class="text-xs text-slate-400 text-center py-3">Tidak ada konsumen pada filter ini.</p>';
  } catch (error) {
    if (S.selectedVillage !== code) return;
    holder.textContent = 'Data konsumen tidak bisa dimuat: ' + error.message;
    holder.className = 'text-xs text-slate-400 text-center py-3';
  }
}

export function closeVillageDetail() {
  const panel = $('kelurahanDetailPanel');
  panel.classList.add('translate-x-full');
  hideTimer = setTimeout(() => panel.classList.add('hidden'), 300);
  S.selectedVillage = null;
  S.panelView = null;
  if (S.layersReady) S.map.setFilter('kel-terpilih', ['==', ['get', 'kode'], '']);
}

/* ==========================================================================
   MASTER POS DEALER
   ========================================================================== */

/** Berapa nama kecamatan yang ditulis penuh sebelum sisanya diringkas. */
const RING_NAMA_TAMPIL = 3;

/**
 * Satu sel ring (dealer, 1-3): kecamatan mana saja yang masuk ring itu untuk dealer
 * ini.
 *
 * Namanya ditulis, bukan cuma jumlahnya — diminta tim, dan memang itu yang dicari
 * orang waktu memeriksa hasil pengisian ring. Tapi satu ring bisa memuat belasan
 * kecamatan, jadi yang ditulis penuh cuma tiga pertama; sisanya diringkas jadi
 * "+N lagi" dan nama lengkapnya ada di tooltip. Tanpa batas itu, satu baris tabel bisa
 * setinggi sepuluh baris lain dan tabelnya berhenti bisa dipindai.
 *
 * Yang kosong ditulis tanda hubung, bukan angka nol. "Belum diisi" dan "benar-benar
 * nol" dua hal berbeda, dan angka nol di kolom baru akan terbaca seperti temuan.
 *
 * @param {Object} groupMap  S.dealerRings[dealerCode] atau S.posCoverage[outletCode]
 * @param {number} group     nomor ring/coverage yang mau ditulis
 */
function groupCell(groupMap, group) {
  const punya = groupMap || {};
  const kode = Object.keys(punya).filter((c) => punya[c] === group);
  if (!kode.length) {
    return '<td class="px-3 py-2 text-center mono text-xs text-slate-300">&mdash;</td>';
  }

  // Kode yang tidak dikenal tetap ditampilkan sebagai kode, bukan dilewati: kecamatan
  // yang hilang dari daftar nama tapi masih tersimpan di ring/coverage adalah hal
  // yang harus terlihat, bukan disembunyikan.
  const nama = kode.map((c) => S.districtNames[c] || c).sort((a, b) => a.localeCompare(b));
  const tampil = nama.slice(0, RING_NAMA_TAMPIL);
  const sisa = nama.length - tampil.length;

  return `<td class="px-3 py-2 text-xs text-slate-600 align-top" title="${esc(nama.join(', '))}">` +
    `<span class="mono font-bold text-slate-800">${esc(String(nama.length))}</span> ` +
    `<span class="text-slate-500">${esc(tampil.join(', '))}` +
    (sisa ? ` <span class="text-slate-400">+${esc(String(sisa))} lagi</span>` : '') +
    '</span></td>';
}

/**
 * Satu sel ringkas coverage (pos, 1-8): total kecamatan di seluruh 8 grup, rincian
 * per grup di tooltip. Delapan kolom terpisah seperti ring dealer tidak muat di
 * lebar tabel Master Pos Dealer — beda dari groupCell() di atas yang menulis satu
 * ring per kolom.
 */
function coverageCellRingkas(outletCode) {
  const punya = S.posCoverage[outletCode] || {};
  const kodeUnik = Object.keys(punya);
  if (!kodeUnik.length) {
    return '<td class="px-3 py-2 text-xs text-slate-300">&mdash;</td>';
  }

  const grupTerisi = new Set(Object.values(punya)).size;
  const tooltip = Array.from({ length: 8 }, (_, i) => i + 1).map((g) => {
    const nama = kodeUnik.filter((c) => punya[c] === g)
      .map((c) => S.districtNames[c] || c).sort((a, b) => a.localeCompare(b));
    return `Cov${g}: ${nama.length ? nama.join(', ') : '—'}`;
  }).join(' · ');

  return `<td class="px-3 py-2 text-xs text-slate-600" title="${esc(tooltip)}">` +
    `<span class="mono font-bold text-slate-800">${esc(String(kodeUnik.length))}</span> kec · ` +
    `<span class="text-slate-500">${esc(String(grupTerisi))} grup terisi</span></td>`;
}

export function renderOutletTable() {
  const query = ($('mpos-search').value || '').toLowerCase();
  const f = pageFilters('pos');
  const perOutlet = sumBy(activeRows('pos'), 'outlet');

  // Filter KOTA sengaja tidak menyaring daftar pos, cuma angkanya. Pos tidak punya
  // kabupaten sendiri di data ini — yang punya kabupaten adalah kelurahan tempat
  // penjualannya jatuh. Menebaknya dari koordinat pos akan salah tanpa gejala.
  // S.realOutlets, bukan S.outlets — katalog ini cuma pos FISIK sungguhan, tidak
  // ikut baris "proxy" per dealer yang menyambungkan penjualan level-dealer lama
  // (lihat schema.sql komentar outlets.is_dealer_proxy).
  const list = S.realOutlets.filter((o) =>
    (f.dealerCode === 'ALL' || o.dealerCode === f.dealerCode) &&
    (f.outletCode === 'ALL' || o.code === f.outletCode) &&
    (!query || o.name.toLowerCase().includes(query) || o.code.includes(query)))
    .sort((a, b) => (perOutlet[b.code] || 0) - (perOutlet[a.code] || 0));

  // Angkanya mengikuti daftar yang BENAR-BENAR tampil, bukan seluruh isi database:
  // kalau tidak, menyaring dealer membuat subtitelnya membantah tabel di bawahnya.
  $('pos-count').textContent = formatNumber(list.length);
  $('pos-dealer-count').textContent = formatNumber(
    new Set(list.map((o) => o.dealerCode)).size);

  $('table-pos-body').innerHTML = list.length ? list.map((o) =>
    `<tr>` +
    `<td class="px-3 py-2 mono text-xs text-slate-500">${esc(o.code)}</td>` +
    `<td class="px-3 py-2"><div class="flex items-center gap-2">` +
    `<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${esc(dealerColor(S.registry, o.dealerCode))}"></span>` +
    `<span class="font-semibold text-slate-800">${esc(o.name)}</span></div></td>` +
    `<td class="px-3 py-2 text-slate-600">${esc(o.dealerName)}</td>` +
    `<td class="px-3 py-2"><div class="text-slate-600 text-xs">${esc(o.address || '—')}</div>` +
    `<div class="mono text-[10px] text-slate-400">` +
    (o.lat == null ? 'belum di-pin'
      : `${esc(o.lat.toFixed(5))}, ${esc(o.lng.toFixed(5))}`) + `</div></td>` +
    coverageCellRingkas(o.code) +
    `<td class="px-3 py-2 text-right font-bold mono ${perOutlet[o.code] ? 'text-slate-900' : 'text-slate-300'}">` +
    `${esc(formatNumber(perOutlet[o.code] || 0))}</td>` +
    `<td class="px-3 py-2 text-center whitespace-nowrap">` +
    (o.lat == null
      ? `<button onclick="promptPin('${esc(o.code)}')" class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 text-slate-600 hover:bg-slate-50"><i class="ph ph-map-pin"></i> Pin</button> `
      : `<button onclick="showOnMap('${esc(o.code)}')" class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-white btn-primary"><i class="ph-fill ph-map-trifold"></i> Lihat di peta</button> `) +
    `<button onclick="editPosCoverageFromTable('${esc(o.code)}')" class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 text-slate-600 hover:bg-slate-50"><i class="ph ph-target"></i> Coverage</button> ` +
    `<button onclick="openOutletEditor('${esc(o.code)}')" class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 text-slate-600 hover:bg-slate-50"><i class="ph ph-pencil-simple"></i> Edit</button>` +
    `</td></tr>`).join('')
    : '<tr><td colspan="7" class="text-center py-8 text-slate-400 text-sm">Tidak ada pos yang cocok.</td></tr>';
}

/**
 * Tombol "Coverage" di tabel pos: pindah ke halaman peta, pilih posnya, lalu buka
 * mode edit coverage.
 *
 * Coverage-nya dipilih dengan mengklik kecamatan di peta, jadi tombol di tabel tidak
 * bisa membuka apa pun sendiri — dia mengantar orang ke tempat pemilihannya. Jeda
 * 120 ms yang sama dengan showOnMap(): peta baru bisa dipakai sesudah tabnya benar-
 * benar terlihat dan MapLibre sempat menghitung ulang ukurannya.
 */
export function editPosCoverageFromTable(code) {
  switchTab('peta');
  setTimeout(() => {
    clearScope('pos');
    selectOutlet(code);
    window.startCoverageEdit(code);
  }, 120);
}

/** Tombol "Ring" di tabel dealer: sama seperti editPosCoverageFromTable, tapi dealer. */
export function editDealerRingFromTable(code) {
  switchTab('peta');
  setTimeout(() => {
    setScope('dealer', code, true);
    window.startRingEdit(code);
  }, 120);
}

/** Tombol "Lihat Peta": pindah tab, pilih pos, heatmap ikut dihitung ulang. */
export function showOnMap(code) {
  switchTab('peta');
  setTimeout(() => {
    // Lingkupnya dikosongkan dulu supaya selectOutlet() pasti MENYALAKAN. Menekan
    // tombol ini berarti "tampilkan pos ini"; tanpa ini, menekannya untuk pos yang
    // kebetulan sedang aktif justru mematikannya.
    clearScope('pos');
    selectOutlet(code);
    toast('Heatmap dihitung ulang untuk ' + ((S.outletByCode[code] || {}).name || code), 'ok');
  }, 120);
}

/* ==========================================================================
   SUNTING POS DEALER
   ==========================================================================
   Alamat dan koordinat. Memindahkan koordinat membuat jangkauan pos itu dihitung
   ulang di server — kalau tidak, angkanya masih menggambarkan lokasi yang sudah
   tidak dipakai, dan itu salah tanpa gejala apa pun.
   ========================================================================== */

function editorMessage(text, kind) {
  const box = $('sp-pesan');
  box.textContent = text || '';
  box.className = text
    ? `mt-3 text-xs px-3 py-2 rounded-xl ${kind === 'error'
      ? 'bg-red-50 border border-red-200 text-red-700'
      : 'bg-emerald-50 border border-emerald-200 text-emerald-700'}`
    : 'hidden';
}

export function openOutletEditor(code) {
  const outlet = S.outletByCode[code];
  if (!outlet) return;
  S.editing = code;
  $('sp-nama').textContent = outlet.name;
  $('sp-kode').textContent = `${outlet.code} · ${outlet.dealerName}`;
  $('sp-alamat').value = outlet.address || '';
  $('sp-lat').value = outlet.lat == null ? '' : outlet.lat;
  $('sp-lng').value = outlet.lng == null ? '' : outlet.lng;

  // Dari Master Dealer, termasuk dealer yang belum punya pos sama sekali.
  const namaDealer = S.dealers.map((d) => d.name).sort((a, b2) => a.localeCompare(b2));
  $('sp-dealer').innerHTML = namaDealer
    .map((nama) => `<option value="${esc(nama)}">${esc(nama)}</option>`).join('') +
    `<option value="${DEALER_BARU}">+ tambahkan dealer induk</option>`;
  $('sp-dealer').value = outlet.dealerName || namaDealer[0] || DEALER_BARU;
  $('sp-dealer-baru').value = '';
  $('sp-dealer-baru').classList.add('hidden');

  editorMessage('');
  $('modal-pos').classList.remove('hidden');
}

export function closeOutletEditor() {
  $('modal-pos').classList.add('hidden');
  S.editing = null;
  S.pickingOnMap = false;
  if (S.map) S.map.getCanvas().style.cursor = '';
}

/** Modal menutup sementara; klik berikutnya di peta jadi koordinatnya. */
export function pickFromMap() {
  if (!S.editing) return;
  S.pickingOnMap = true;
  $('modal-pos').classList.add('hidden');
  if (!S.fullscreen) $('map').scrollIntoView({ block: 'center' });
  S.map.getCanvas().style.cursor = 'crosshair';
  toast('Klik titik yang benar di peta', 'ok');
}

/** Dipanggil map click handler waktu sedang menunggu titik. */
export function acceptMapPoint(lngLat) {
  S.pickingOnMap = false;
  S.map.getCanvas().style.cursor = '';
  $('sp-lat').value = lngLat.lat.toFixed(6);
  $('sp-lng').value = lngLat.lng.toFixed(6);
  $('modal-pos').classList.remove('hidden');
}

/**
 * Nilai penanda di dropdown dealer. Bukan nama dealer yang mungkin ada.
 *
 * Ditulis sebagai ESCAPE, bukan byte NUL asli di dalam berkas. Sebelumnya bytenya
 * ditulis langsung: tidak terlihat di editor, membuat grep menganggap berkas ini biner,
 * dan alat apa pun yang menormalkan encoding akan memakannya tanpa suara — begitu
 * hilang, penandanya berubah jadi teks biasa "baru" dan dealer bernama "baru"
 * menabraknya.
 */
const DEALER_BARU = '\u0000baru';

/** Tampilkan kotak isian nama begitu "dealer baru" dipilih. */
export function dealerChoiceChanged() {
  const baru = $('sp-dealer').value === DEALER_BARU;
  $('sp-dealer-baru').classList.toggle('hidden', !baru);
  if (baru) $('sp-dealer-baru').focus();
}

export async function saveOutletEditor() {
  const code = S.editing;
  const outlet = S.outletByCode[code];
  if (!outlet) return;

  const lat = Number(String($('sp-lat').value).trim());
  const lng = Number(String($('sp-lng').value).trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    editorMessage('Koordinat harus angka. Contoh: -7.79558', 'error');
    return;
  }

  const pilihan = $('sp-dealer').value;
  const dealerName = pilihan === DEALER_BARU
    ? $('sp-dealer-baru').value.trim()
    : pilihan;
  if (!dealerName) {
    editorMessage('Isi nama dealer barunya, atau pilih dealer yang sudah ada.', 'error');
    return;
  }

  const button = $('sp-simpan');
  button.disabled = true;
  button.textContent = 'Menyimpan...';
  editorMessage('');

  try {
    const { outlet: saved, coverageRebuilt, dealerChanged } = await saveOutlet(code, {
      address: $('sp-alamat').value.trim(), lat, lng, dealerName,
    });
    Object.assign(outlet, saved);
    const index = S.outlets.findIndex((o) => o.code === code);
    if (index >= 0) S.outlets[index] = outlet;

    closeOutletEditor();
    // Jangkauan yang dihitung ulang mengubah angka di panel performa, jadi datanya
    // harus diambil ulang — bukan sekadar menggambar ulang dari yang lama.
    if (coverageRebuilt || dealerChanged) {
      // Pindah dealer mengubah warna pos ini, isi treemap, daftar dropdown, dan
      // pengelompokan di seluruh halaman. Menggambar ulang dari data lama akan
      // menampilkan setengah keadaan lama dan setengah yang baru.
      toast(dealerChanged
        ? `Tersimpan. Pos dipindahkan ke ${saved.dealerName}.`
        : 'Tersimpan. Jangkauan pos ini dihitung ulang.', 'ok');
      await window.reloadSummary();
    } else {
      toast('Tersimpan', 'ok');
      window.renderAll();
    }
    renderOutletTable();
  } catch (error) {
    editorMessage(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Simpan';
  }
}

/**
 * Pin cepat untuk outlet yang belum punya koordinat.
 *
 * Tetap ada di samping modal sunting: outlet baru dari impor bulanan sering perlu
 * di-pin berurutan, dan membuka modal untuk tiap satu lebih lambat daripada menempel
 * koordinat dari Google Maps.
 */
export async function promptPin(code) {
  const outlet = S.outletByCode[code] || {};
  const input = prompt(
    `Koordinat untuk ${outlet.name || code}\n\n` +
    'Salin dari Google Maps: klik kanan di lokasinya, lalu klik angka yang muncul.\n' +
    'Tulis di sini sebagai: lintang, bujur', '');
  if (!input) return;

  const [lat, lng] = input.split(',').map((n) => Number(String(n).trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    toast('Formatnya belum benar. Contoh: -7.79558, 110.36949', 'error');
    return;
  }
  try {
    const { outlet: saved } = await saveOutlet(code, { lat, lng });
    Object.assign(S.outletByCode[code], saved);
    const index = S.outlets.findIndex((o) => o.code === code);
    if (index >= 0) S.outlets[index] = S.outletByCode[code];
    toast('Koordinat tersimpan', 'ok');
    window.renderAll();
    renderOutletTable();
  } catch (error) {
    toast('Gagal menyimpan: ' + error.message, 'error');
  }
}

/* ==========================================================================
   RESET MASTER POS
   ========================================================================== */

/**
 * Akibatnya disebut dengan ANGKA sebelum ditekan, bukan sesudah.
 *
 * "Reset master pos" tidak memberi tahu apa pun; "79 pos, 52 dealer, dan 18.915 unit
 * akan hilang" memberi tahu. Pola yang sama dipakai hapus periode, dan alasannya sama:
 * satu akun dipakai bersama, jadi yang menekan belum tentu yang mengimpor.
 */
export function askResetOutlets() {
  const dealers = new Set(S.outlets.map((o) => o.dealerCode)).size;
  const unit = S.sales.reduce((sum, r) => sum + r.units, 0);
  $('rp-rincian').textContent =
    `${formatNumber(S.outlets.length)} pos · ${formatNumber(dealers)} dealer · ` +
    `${formatNumber(unit)} unit penjualan akan hilang dari seluruh dashboard.`;
  $('rp-ketik').value = '';
  $('rp-pesan').textContent = '';
  $('rp-reset').disabled = true;
  $('modal-reset-pos').classList.remove('hidden');
  $('rp-ketik').focus();
}

export function closeResetOutlets() {
  $('modal-reset-pos').classList.add('hidden');
}

export function resetOutletsTyped() {
  $('rp-reset').disabled = $('rp-ketik').value.trim() !== 'RESET';
}

export async function confirmResetOutlets() {
  $('rp-reset').disabled = true;
  $('rp-pesan').textContent = 'Mengosongkan...';
  try {
    const hasil = await resetOutlets();
    closeResetOutlets();
    toast(`Master pos direset: ${formatNumber(hasil.outlets)} pos, ` +
      `${formatNumber(hasil.units)} unit dihapus.`, 'ok');
    await window.reloadSummary();
  } catch (error) {
    $('rp-pesan').textContent = error.message;
    $('rp-pesan').className = 'text-xs mb-3 text-red-600';
    $('rp-reset').disabled = false;
  }
}

/* ==========================================================================
   MASTER KELURAHAN
   ========================================================================== */

export function renderVillageTable() {
  const query = ($('mkel-search').value || '').toLowerCase();
  const f = pageFilters('kelurahan');
  const rows = activeRows('kelurahan');
  const perVillage = sumBy(rows, 'village');

  // Kalau lingkupnya dealer atau pos, yang ditampilkan adalah kelurahan yang BENAR-
  // BENAR disentuh dealer atau pos itu — bukan seluruh kelurahan dengan angka nol.
  // Daftar 8.999 baris yang 8.900 di antaranya nol tidak menjawab apa pun.
  const disentuh = f.dealerCode !== 'ALL' || f.outletCode !== 'ALL'
    ? new Set(rows.map((r) => r.village)) : null;

  // Sudah datang terurut dari server (provinsi -> kabupaten -> kecamatan ->
  // kelurahan). Diminta di meeting: urutan sebelumnya mengikuti volume, jadi
  // kelurahan dari kabupaten berbeda berselang-seling dan tidak bisa ditelusuri.
  const list = S.villages.filter((v) =>
    (f.cityCode === 'ALL' || v.cityCode === f.cityCode) &&
    (f.kares === 'ALL' || KARESIDENAN[f.kares].cities.includes(v.cityCode)) &&
    (!disentuh || disentuh.has(v.code)) &&
    (!query || v.name.toLowerCase().includes(query) || v.code.includes(query)));

  const shown = list.slice(0, TABLE_ROW_LIMIT);
  $('table-kelurahan-body').innerHTML = shown.length ? shown.map((v) => {
    const total = perVillage[v.code] || 0;
    return `<tr class="cursor-pointer" onclick="jumpToVillage('${esc(v.code)}')">` +
      `<td class="px-3 py-2 mono text-xs text-slate-500">${esc(v.code)}</td>` +
      `<td class="px-3 py-2"><div class="font-semibold text-slate-800">${esc(v.name)}</div>` +
      `<div class="mono text-[10px] text-slate-400">` +
      (v.lat == null ? '—' : `${esc(v.lat.toFixed(5))}, ${esc(v.lng.toFixed(5))}`) +
      `</div></td>` +
      `<td class="px-3 py-2 text-slate-600">${esc(v.district || '—')}</td>` +
      `<td class="px-3 py-2 text-slate-600">${esc(v.cityName)}</td>` +
      `<td class="px-3 py-2 text-slate-500 text-xs">${esc(PROVINCE_NAMES[v.provinceCode] || v.provinceCode)}</td>` +
      `<td class="px-3 py-2 text-right font-bold mono ${total ? 'text-slate-900' : 'text-slate-300'}">${esc(formatNumber(total))}</td>` +
      `</tr>`;
  }).join('')
    : '<tr><td colspan="6" class="text-center py-8 text-slate-400 text-sm">Tidak ada kelurahan yang cocok.</td></tr>';

  if (list.length > shown.length) {
    $('table-kelurahan-body').innerHTML +=
      `<tr><td colspan="6" class="text-center py-2.5 bg-slate-50 text-slate-500 text-xs">` +
      `Menampilkan ${esc(formatNumber(shown.length))} dari ${esc(formatNumber(list.length))} kelurahan.</td></tr>`;
  }
}

export function jumpToVillage(code) {
  const village = S.villageByCode[code];
  if (!village || village.lat == null) return;
  switchTab('peta');
  setTimeout(() => {
    S.map.flyTo({ center: [village.lng, village.lat], zoom: 12, duration: 800 });
    S.map.setFilter('kel-terpilih', ['==', ['get', 'kode'], code]);
    openVillageDetail(code);
  }, 140);
}

/* ==========================================================================
   TAB
   ========================================================================== */

/** Escape menutup modal dulu, baru keluar dari layar penuh. */
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('modal-pos').classList.contains('hidden')) { closeOutletEditor(); return; }
  if (S.fullscreen) window.toggleFullscreen(false);
});

/* ==========================================================================
   TAMBAH POS DEALER
   ==========================================================================
   Untuk pos yang sudah buka tapi belum muncul di Excel bulanan. Pos baru langsung utuh
   — kolom geom_m-nya dibuat database dari lat/lng, jadi jangkauannya bisa dihitung saat
   itu juga.

   Dulu ada pasangannya di sini, "Tambah Kelurahan", dan sekarang sudah dibuang. Lihat
   bagian COCOKKAN NAMA KELURAHAN di bawah untuk sebabnya.
   ========================================================================== */

function pesanModal(id, teks, jenis) {
  const el = $(id);
  if (!el) return;
  el.textContent = teks || '';
  el.className = 'text-xs mb-3 ' +
    (jenis === 'error' ? 'text-red-600' : 'text-emerald-600');
}

/** Isi dropdown dealer dengan yang sudah ada di Master Dealer, plus pilihan membuat baru. */
function isiDealer(selectId, inputId) {
  const nama = S.dealers.map((d) => d.name).sort((a, b) => a.localeCompare(b));
  $(selectId).innerHTML = nama
    .map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('') +
    `<option value="${DEALER_BARU}">+ tambahkan dealer induk</option>`;
  $(selectId).value = nama[0] || DEALER_BARU;
  $(inputId).value = '';
  $(inputId).classList.toggle('hidden', $(selectId).value !== DEALER_BARU);
}

export function openNewOutlet() {
  ['np-kode', 'np-nama', 'np-alamat', 'np-lat', 'np-lng'].forEach((id) => {
    $(id).value = '';
  });
  isiDealer('np-dealer', 'np-dealer-baru');
  pesanModal('np-pesan', '');
  $('modal-pos-baru').classList.remove('hidden');
  $('np-kode').focus();
}

export function closeNewOutlet() {
  $('modal-pos-baru').classList.add('hidden');
}

export function newOutletDealerChanged() {
  const baru = $('np-dealer').value === DEALER_BARU;
  $('np-dealer-baru').classList.toggle('hidden', !baru);
  if (baru) $('np-dealer-baru').focus();
}

export async function saveNewOutlet() {
  const pilihan = $('np-dealer').value;
  const dealerName = pilihan === DEALER_BARU
    ? $('np-dealer-baru').value.trim() : pilihan;
  const lat = $('np-lat').value.trim();
  const lng = $('np-lng').value.trim();

  if (!$('np-kode').value.trim()) return pesanModal('np-pesan', 'Kode pos wajib diisi.', 'error');
  if (!$('np-nama').value.trim()) return pesanModal('np-pesan', 'Nama pos wajib diisi.', 'error');
  if (!dealerName) return pesanModal('np-pesan', 'Pilih dealer, atau isi nama dealer barunya.', 'error');
  if (Boolean(lat) !== Boolean(lng)) {
    return pesanModal('np-pesan', 'Isi lintang dan bujur dua-duanya, atau kosongkan dua-duanya.', 'error');
  }

  const tombol = $('np-simpan');
  tombol.disabled = true;
  tombol.textContent = 'Menyimpan...';
  pesanModal('np-pesan', '');
  try {
    const { outlet } = await createOutlet({
      outletCode: $('np-kode').value.trim(),
      outletName: $('np-nama').value.trim(),
      dealerName,
      address: $('np-alamat').value.trim(),
      lat: lat || null,
      lng: lng || null,
    });
    closeNewOutlet();
    toast(`Pos ${outlet.name} ditambahkan.`, 'ok');
    // Pos baru mengubah daftar dealer, warna, treemap, dan dropdown — ambil ulang
    // semuanya daripada menambal setengah keadaan.
    await window.reloadSummary();
    renderOutletTable();
  } catch (error) {
    pesanModal('np-pesan', error.message, 'error');
  } finally {
    tombol.disabled = false;
    tombol.textContent = 'Tambah';
  }
}

/* ==========================================================================
   MASTER DEALER
   ==========================================================================
   Terpisah dari Master Pos sejak dealers jadi tabel sendiri di server. Kode dealer
   tidak pernah diketik di sini — selalu turunan nama, ditentukan server.
   ========================================================================== */

export function renderDealerTable() {
  const query = ($('mdeal-search').value || '').toLowerCase();
  const list = S.dealers
    .filter((d) => !query || d.name.toLowerCase().includes(query) || d.code.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));

  $('dealer-count').textContent = formatNumber(list.length);

  $('table-dealer-body').innerHTML = list.length ? list.map((d) =>
    `<tr>` +
    `<td class="px-3 py-2 mono text-xs text-slate-500">${esc(d.code)}</td>` +
    `<td class="px-3 py-2"><div class="flex items-center gap-2">` +
    `<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${esc(dealerColor(S.registry, d.code))}"></span>` +
    `<span class="font-semibold text-slate-800">${esc(d.name)}</span></div></td>` +
    `<td class="px-3 py-2 text-slate-600 text-xs">${esc(d.address || '—')}</td>` +
    `<td class="px-3 py-2 mono text-[10px] text-slate-400">` +
    (d.lat == null ? '—' : `${esc(Number(d.lat).toFixed(5))}, ${esc(Number(d.lng).toFixed(5))}`) +
    `</td>` +
    groupCell(S.dealerRings[d.code], 1) + groupCell(S.dealerRings[d.code], 2) +
    groupCell(S.dealerRings[d.code], 3) +
    `<td class="px-3 py-2 text-right font-bold mono text-slate-900">${esc(formatNumber(Number(d.outletCount)))}</td>` +
    `<td class="px-3 py-2 text-center whitespace-nowrap">` +
    `<button onclick="editDealerRingFromTable('${esc(d.code)}')" class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 text-slate-600 hover:bg-slate-50"><i class="ph ph-target"></i> Ring</button> ` +
    `<button onclick="openDealerEditor('${esc(d.code)}')" class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 text-slate-600 hover:bg-slate-50"><i class="ph ph-pencil-simple"></i> Edit</button> ` +
    `<button onclick="deleteDealerConfirm('${esc(d.code)}')" class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-red-200 text-red-700 hover:bg-red-50"><i class="ph ph-trash"></i></button>` +
    `</td></tr>`).join('')
    : '<tr><td colspan="9" class="text-center py-8 text-slate-400 text-sm">Tidak ada dealer yang cocok.</td></tr>';
}

export function openNewDealer() {
  ['nd-nama', 'nd-alamat', 'nd-lat', 'nd-lng'].forEach((id) => { $(id).value = ''; });
  pesanModal('nd-pesan', '');
  $('modal-dealer-baru').classList.remove('hidden');
  $('nd-nama').focus();
}

export function closeNewDealer() {
  $('modal-dealer-baru').classList.add('hidden');
}

export async function saveNewDealer() {
  const name = $('nd-nama').value.trim();
  const lat = $('nd-lat').value.trim();
  const lng = $('nd-lng').value.trim();
  if (!name) return pesanModal('nd-pesan', 'Nama dealer wajib diisi.', 'error');
  if (Boolean(lat) !== Boolean(lng)) {
    return pesanModal('nd-pesan', 'Isi lintang dan bujur dua-duanya, atau kosongkan dua-duanya.', 'error');
  }

  const tombol = $('nd-simpan');
  tombol.disabled = true;
  tombol.textContent = 'Menyimpan...';
  pesanModal('nd-pesan', '');
  try {
    await createDealer({
      dealerName: name,
      address: $('nd-alamat').value.trim(),
      lat: lat || null,
      lng: lng || null,
    });
    closeNewDealer();
    toast(`Dealer ${name} ditambahkan.`, 'ok');
    await window.reloadSummary();
    renderDealerTable();
  } catch (error) {
    pesanModal('nd-pesan', error.message, 'error');
  } finally {
    tombol.disabled = false;
    tombol.textContent = 'Tambah';
  }
}

export function openDealerEditor(code) {
  const dealer = S.dealerByCode[code];
  if (!dealer) return;
  S.editingDealer = code;
  $('sd-nama').textContent = dealer.name;
  $('sd-kode').textContent = `${dealer.code} · ${formatNumber(Number(dealer.outletCount))} pos`;
  $('sd-alamat').value = dealer.address || '';
  $('sd-lat').value = dealer.lat == null ? '' : dealer.lat;
  $('sd-lng').value = dealer.lng == null ? '' : dealer.lng;
  pesanModal('sd-pesan', '');
  $('modal-dealer').classList.remove('hidden');
}

export function closeDealerEditor() {
  $('modal-dealer').classList.add('hidden');
  S.editingDealer = null;
}

export async function saveDealerEditor() {
  const code = S.editingDealer;
  if (!code) return;
  const lat = $('sd-lat').value.trim();
  const lng = $('sd-lng').value.trim();
  if (Boolean(lat) !== Boolean(lng)) {
    return pesanModal('sd-pesan', 'Isi lintang dan bujur dua-duanya, atau kosongkan dua-duanya.', 'error');
  }

  const tombol = $('sd-simpan');
  tombol.disabled = true;
  tombol.textContent = 'Menyimpan...';
  pesanModal('sd-pesan', '');
  try {
    const { dealer } = await saveDealer(code, {
      address: $('sd-alamat').value.trim(),
      lat: lat || null,
      lng: lng || null,
    });
    closeDealerEditor();
    toast('Tersimpan', 'ok');
    // Nama dealer dipakai di banyak tempat (warna, dropdown pos, treemap) — ambil
    // ulang seluruh ringkasan daripada menambal setengah keadaan.
    await window.reloadSummary();
    renderDealerTable();
    void dealer;
  } catch (error) {
    pesanModal('sd-pesan', error.message, 'error');
  } finally {
    tombol.disabled = false;
    tombol.textContent = 'Simpan';
  }
}

/** Server sendiri yang menolak kalau masih ada pos — dialog ini cuma jaga dari klik tidak sengaja. */
export async function deleteDealerConfirm(code) {
  const dealer = S.dealerByCode[code];
  if (!dealer) return;
  if (!confirm(`Hapus dealer "${dealer.name}"?`)) return;
  try {
    await deleteDealer(code);
    toast(`Dealer ${dealer.name} dihapus.`, 'ok');
    await window.reloadSummary();
    renderDealerTable();
  } catch (error) {
    toast('Gagal menghapus: ' + error.message, 'error');
  }
}

/* ==========================================================================
   COCOKKAN NAMA KELURAHAN
   ==========================================================================
   Menggantikan "Tambah Kelurahan" yang dulu di sini. Fitur itu membuat kelurahan BARU
   tanpa poligon; setelah seluruh Jateng + DIY masuk database berpoligon, itu hampir
   selalu jawaban yang salah.

   Yang sebenarnya terjadi pada baris Excel yang tidak cocok: hampir semuanya varian
   ejaan dari kelurahan yang SUDAH ada — TEGALREJO untuk Tegalreja, PABUARAN untuk
   Pabuwaran. Menunjuk yang sudah ada langsung membawa poligonnya.

   SERVER MENYARANKAN, ORANG MEMUTUSKAN. Tidak ada satu pun saran yang tersimpan sendiri.
   ========================================================================== */

/** Isi kotak dialog yang sedang tampil. Dari server, bukan dari S — cuma dipakai di sini. */
let matchList = [];

export async function openMatchNames() {
  $('modal-cocok').classList.remove('hidden');
  $('mc-isi').innerHTML =
    '<div class="text-center py-8 text-slate-400 text-sm">Memuat...</div>';
  try {
    const data = await fetchAliases();
    matchList = data.unmatched;
    $('mc-periode').textContent = data.period
      ? `Dari impor periode ${data.period}` : 'Belum ada impor';
    renderMatchList();
  } catch (error) {
    $('mc-isi').innerHTML =
      `<div class="text-center py-8 text-red-600 text-sm">${esc(error.message)}</div>`;
  }
}

export function closeMatchNames() {
  $('modal-cocok').classList.add('hidden');
}

/**
 * Satu baris per nama yang belum cocok.
 *
 * Sarannya ditampilkan sebagai dropdown yang SUDAH terpilih di urutan teratas, bukan
 * terisi otomatis lalu disimpan. Orang tetap harus menekan Cocokkan — dan kalau
 * sarannya meleset, kandidat lain sekota ada di dropdown yang sama.
 */
function renderMatchList() {
  if (!matchList.length) {
    $('mc-isi').innerHTML = '<div class="text-center py-8 text-slate-400 text-sm">' +
      'Semua nama kelurahan sudah cocok.</div>';
    return;
  }

  $('mc-isi').innerHTML = matchList.map((u, i) => {
    if (u.alias) {
      return `<div class="px-4 py-3 flex items-center gap-3">` +
        `<div class="min-w-0 flex-1"><div class="font-semibold text-slate-800">${esc(u.villageName)}</div>` +
        `<div class="text-[11px] text-slate-400">${esc(u.districtName)} · ${esc(formatNumber(u.rowCount))} baris</div></div>` +
        `<div class="text-xs text-emerald-700 text-right shrink-0">` +
        `<i class="ph-fill ph-check-circle"></i> ${esc(u.alias.targetName)}` +
        `<div class="text-[10px] text-slate-400">berlaku saat impor ulang</div></div>` +
        `<button onclick="undoMatch(${i})" class="text-xs text-slate-400 hover:text-red-600 shrink-0" title="Batalkan">` +
        `<i class="ph ph-x-circle text-lg"></i></button></div>`;
    }

    const pilihan = u.suggestions.length
      ? u.suggestions.map((s) =>
        `<option value="${esc(s.code)}">${esc(s.name)} — ${esc(s.district || '?')}` +
        ` (beda ${esc(String(s.distance))} huruf)</option>`).join('')
      : '<option value="">tidak ada kelurahan yang mirip di kabupaten ini</option>';

    return `<div class="px-4 py-3 flex items-center gap-3">` +
      `<div class="min-w-0 flex-1"><div class="font-semibold text-slate-800">${esc(u.villageName)}</div>` +
      `<div class="text-[11px] text-slate-400">${esc(u.districtName)} · ${esc(formatNumber(u.rowCount))} baris</div></div>` +
      `<select id="mc-pilih-${i}" class="px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white max-w-[16rem] shrink-0"` +
      (u.suggestions.length ? '' : ' disabled') + `>${pilihan}</select>` +
      `<button onclick="confirmMatch(${i})"` +
      ` class="px-3 py-1.5 rounded-lg text-white text-xs font-bold hover:opacity-90 shrink-0 btn-primary"` +
      (u.suggestions.length ? '' : ' disabled') + `>Cocokkan</button></div>`;
  }).join('');
}

export async function confirmMatch(index) {
  const u = matchList[index];
  const villageCode = $(`mc-pilih-${index}`).value;
  if (!u || !villageCode) return;
  try {
    const { village } = await saveAlias({
      cityCode: u.cityCode,
      districtName: u.districtName,
      villageName: u.villageName,
      villageCode,
    });
    // Ditandai di daftar, TIDAK dihapus dari layar. Barisnya masih tercatat belum cocok
    // sampai impor ulang — menghilangkannya dari sini akan terlihat seperti angka di
    // halaman impor sudah ikut turun, padahal belum.
    u.alias = { villageCode, targetName: village.name, targetDistrict: village.district };
    renderMatchList();
    toast(`${u.villageName} → ${village.name}. Berlaku setelah impor ulang.`, 'ok');
  } catch (error) {
    toast('Gagal: ' + error.message, 'error');
  }
}

export async function undoMatch(index) {
  const u = matchList[index];
  if (!u) return;
  try {
    await deleteAlias(u.cityCode, u.districtName, u.villageName);
    u.alias = null;
    renderMatchList();
  } catch (error) {
    toast('Gagal: ' + error.message, 'error');
  }
}

/* ==========================================================================
   DATA KONSUMEN
   ==========================================================================
   Isi berkas Excel yang sudah diimpor, apa adanya. Beda dari tabel master lain:
   penyaringannya dikerjakan SERVER, bukan di sini.

   Alasannya bukan kecepatan. Kelurahan dan pos memang seluruhnya dikirim ke browser
   sejak awal — jumlahnya ribuan dan tidak ada PII di dalamnya. Konsumen tidak: 18 ribu
   nama dan alamat tidak pernah dikirim sekaligus, tiap permintaan dipotong di server
   dan dicatat. Yang butuh seluruh isinya masih punya berkas Excel aslinya.
   ========================================================================== */

let customerSearchTimer = null;

/** Baris pertama yang sedang ditampilkan. Berubah hanya lewat customerPage(). */
let customerOffset = 0;

/** Ketikan ditunda 300 ms supaya tiap huruf tidak jadi satu permintaan ke server. */
export function searchCustomers() {
  clearTimeout(customerSearchTimer);
  customerSearchTimer = setTimeout(renderCustomerTable, 300);
}

/**
 * Maju atau mundur satu halaman.
 *
 * @param {number} direction  +1 berikutnya, -1 sebelumnya
 */
export function customerPage(direction) {
  customerOffset = Math.max(0, customerOffset + direction * customerPageSize);
  renderCustomerTable(true);
}

/** Diisi dari balasan server, bukan ditebak — batasnya milik server. */
let customerPageSize = 500;

/** Permintaan terakhir yang dikirim; balasan yang datang terlambat dibuang. */
let customerRequest = 0;

/**
 * @param {boolean} keepOffset  true kalau dipanggil tombol halaman. Mengubah penyaring
 *                              SELALU kembali ke halaman pertama — kalau tidak, hasil
 *                              baru yang cuma 30 baris akan tampak kosong karena
 *                              offsetnya masih di baris 1.500.
 */
export async function renderCustomerTable(keepOffset) {
  if (!keepOffset) customerOffset = 0;
  const body = $('table-konsumen-body');
  const note = $('mkon-note');
  if (!body) return;

  if (!S.hasCustomers) {
    body.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-400 text-sm">' +
      'Server ini tidak menyimpan data konsumen.</td></tr>';
    note.textContent = 'Impor dengan pilihan "simpan data konsumen" dicentang supaya ' +
      'nama dan alamat ikut tersimpan.';
    $('mkon-prev').disabled = true;
    $('mkon-next').disabled = true;
    return;
  }

  const f = pageFilters('konsumen');
  const filters = {
    periodFrom: f.from,
    periodTo: f.to,
    city: f.cityCode,
    outlet: f.outletCode !== 'ALL' ? f.outletCode : null,
    query: ($('mkon-search').value || '').trim(),
    // Tabel konsumen tidak menyimpan kode dealer — itu milik tabel outlets di database
    // yang berbeda, jadi tidak bisa di-JOIN. Dealer diterjemahkan di sini jadi daftar
    // kode pos miliknya. Server sudah meng-AND-kan city/outlet/outlets kalau lebih
    // dari satu terisi (browseCustomers()), jadi ketiganya boleh dikirim bersamaan.
    outlets: f.dealerCode !== 'ALL'
      ? S.outlets.filter((o) => o.dealerCode === f.dealerCode).map((o) => o.code) : null,
    offset: customerOffset,
  };

  const ticket = ++customerRequest;
  note.textContent = 'Memuat...';

  try {
    const { rows, total, limit, offset } = await browseCustomers(filters);
    if (ticket !== customerRequest) return;      // sudah ada permintaan yang lebih baru

    // Server yang menentukan batas dan offset sebenarnya — dia menjepit offset yang
    // sudah lewat ujung. Kalau halaman menyimpan tebakannya sendiri, tombolnya akan
    // menghitung dari angka yang tidak pernah dipakai server.
    customerPageSize = limit;
    customerOffset = offset;

    body.innerHTML = rows.length ? rows.map((c) => {
      const village = S.villageByCode[c.village] || {};
      const outlet = S.outletByCode[c.outlet] || {};
      return `<tr class="hover:bg-slate-50">` +
        `<td class="px-3 py-2 font-semibold text-slate-800">${esc(c.name)}</td>` +
        `<td class="px-3 py-2 text-slate-600">${esc(c.address)}</td>` +
        `<td class="px-3 py-2 text-slate-600">${esc(village.name || c.village)}` +
        `<div class="mono text-[10px] text-slate-400">${esc(c.village)}</div></td>` +
        `<td class="px-3 py-2 text-slate-500 text-xs">${esc(village.cityName || '—')}</td>` +
        `<td class="px-3 py-2"><div class="flex items-center gap-2">` +
        `<span class="w-2 h-2 rounded-full shrink-0" style="background:${esc(dealerColor(S.registry, outlet.dealerCode))}"></span>` +
        `<div class="min-w-0"><div class="text-slate-700 truncate">${esc(outlet.name || c.outlet)}</div>` +
        `<div class="text-[10px] text-slate-400 truncate">${esc(S.dealerNames[outlet.dealerCode] || '—')}</div>` +
        `</div></div></td>` +
        `<td class="px-3 py-2 mono text-xs text-slate-500 whitespace-nowrap">${esc(c.period)}</td>` +
        `</tr>`;
    }).join('')
      : '<tr><td colspan="6" class="text-center py-8 text-slate-400 text-sm">' +
        'Tidak ada konsumen yang cocok dengan penyaring ini.</td></tr>';

    // Jumlah sebenarnya SELALU disebut, bukan cuma yang tampil. Tabel yang diam-diam
    // terpotong membuat orang menyimpulkan dari sebagian data tanpa tahu.
    note.textContent = total > rows.length
      ? `Menampilkan ${formatNumber(offset + 1)}–${formatNumber(offset + rows.length)} ` +
        `dari ${formatNumber(total)} konsumen.`
      : `${formatNumber(total)} konsumen.`;

    $('mkon-prev').disabled = offset === 0;
    $('mkon-next').disabled = offset + rows.length >= total;
  } catch (error) {
    if (ticket !== customerRequest) return;
    body.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-400 text-sm">' +
      `Tidak bisa memuat: ${esc(error.message)}</td></tr>`;
    note.textContent = '';
    $('mkon-prev').disabled = true;
    $('mkon-next').disabled = true;
  }
}

// Tiga tab ini sejak 2026-08-31 malam dipindah dari tombol datar di navbar ke dalam
// flyout "Master" (lihat toggleMasterMenu() di bawah) — nama tab & id nav-*-nya TIDAK
// berubah, cuma posisi DOM-nya. Daftar terpisah di sini (bukan dihitung dari
// switchTab) supaya kedua tempat yang perlu tahu "tab mana yang masuk flyout" tidak
// bisa menyimpang diam-diam.
const TAB_MASTER = ['dealer', 'pos', 'kelurahan'];

// Tiga sub-halaman di flyout "Data" (docs/FUSION.md Tahap 1.4). Alasannya sama
// dengan TAB_MASTER: daftar terpisah supaya dua tempat yang perlu tahu "tab mana
// yang masuk flyout" tidak bisa menyimpang diam-diam.
const TAB_DATA = ['konsumen', 'servis', 'kirim'];

export function switchTab(name) {
  ['peta', 'import', 'pos', 'dealer', 'konsumen', 'kelurahan',
    'servis', 'kirim', 'fusion'].forEach((tab) => {
    const section = $('tab-' + tab);
    const nav = $('nav-' + tab);
    if (section) section.classList.toggle('hidden', tab !== name);
    if (nav) nav.classList.toggle('active', tab === name);
  });
  // Tombol trigger Master sendiri bukan nama tab (tidak ada tab-master/nav-master di
  // loop atas) — disorot terpisah waktu salah satu tab di dalam flyoutnya aktif.
  const navMaster = $('nav-master');
  if (navMaster) navMaster.classList.toggle('active', TAB_MASTER.includes(name));
  closeMasterMenu();

  const navData = $('nav-data');
  if (navData) navData.classList.toggle('active', TAB_DATA.includes(name));
  closeDataMenu();

  // Urutannya penting: halaman aktif ditetapkan SEBELUM tabelnya digambar, kalau tidak
  // tabelnya membaca filter halaman sebelumnya. Halaman impor tidak punya filter, dan
  // S.filterPage sengaja tidak diubah waktu masuk ke sana — begitu keluar, halaman
  // yang tadi ditinggalkan masih ingat filternya. Master Dealer sama: dealer tidak
  // punya periode maupun kelurahan untuk disaring bilah filter.
  const TANPA_FILTER = ['import', 'dealer'];
  if (!TANPA_FILTER.includes(name)) {
    S.filterPage = name;
    syncFilterBar();
  }
  $('filter-bar').classList.toggle('hidden', TANPA_FILTER.includes(name));

  if (name === 'peta' && S.map) setTimeout(() => S.map.resize(), 60);
  if (name === 'pos') renderOutletTable();
  if (name === 'dealer') renderDealerTable();
  if (name === 'konsumen') renderCustomerTable();
  if (name === 'kelurahan') renderVillageTable();
  if (name === 'import') window.refreshImportTab();
}

/**
 * Flyout navbar "Master" (Master Dealer/Master Pos Dealer/Master Kelurahan) — gaya
 * visual pakai ulang kelas `.pilih`/`.pilih-panel`/`.pilih-opsi` yang sudah ada
 * (combobox filter, `frontend/index.html`), tapi logika buka/tutupnya SENDIRI, bukan
 * lewat combobox.js: `terbuka`/`host()`/`_combo` di sana terikat erat ke semantik
 * filter (pairs, onPick, kotak cari) yang tidak relevan di sini — tiga isi panelnya
 * cuma tombol switchTab() biasa, bukan pilihan yang menyaring data.
 *
 * Sejak 2026-09-14: bisa dibuka lewat hover JUGA, bukan cuma klik (permintaan
 * user) — openMasterMenu() dipisah dari toggleMasterMenu() supaya dua jalur
 * (klik & hover) pakai satu logika "buka" yang sama, tidak dobel ditulis.
 *
 * Sejak 2026-09-14 malam: panelnya diberi `position:fixed` + top/left dihitung
 * dari posisi tombol, BUKAN lagi murni `position:absolute` bawaan `.pilih-panel`.
 * Sebabnya: `#nav-master-wrap` ada di dalam <div class="... overflow-x-auto">
 * (pembungkus baris tombol nav) — `overflow-x-auto` memaksa `overflow-y` efektif
 * jadi `auto` juga (bukan `visible`), jadi panel yang melayang DI BAWAH tombol
 * ikut terpotong div itu. `position:fixed` tidak pernah dipotong overflow leluhur
 * mana pun (cuma tepi viewport) — jalan pintas paling kecil risikonya, tidak
 * perlu menyentuh `.pilih-panel` (dipakai bersama combobox filter) atau
 * melepas `overflow-x-auto` (mungkin memang perlu untuk layar sempit).
 */
/**
 * Flyout navbar "Data" — tiga sub-halaman sumber (KTP / Lokasi Service / Lokasi
 * Delivery), docs/FUSION.md Tahap 1.4.
 *
 * Sengaja SALINAN pola Master di bawah, bukan abstraksi bersama: keduanya cuma
 * tiga baris logika, dan menyatukannya berarti satu fungsi yang harus tahu dua
 * panel, dua tombol, dan dua daftar tab. Yang penting sama di keduanya —
 * `position:fixed` dihitung dari posisi tombol — ditulis ulang berikut alasannya
 * supaya yang membaca salah satunya tidak perlu mencari yang lain.
 */
function openDataMenu() {
  const panel = $('data-panel');
  if (!panel || !panel.hidden) return;
  const tombol = document.getElementById('nav-data').getBoundingClientRect();
  // position:fixed, sama alasannya dengan flyout Master: pembungkus baris nav
  // `overflow-x-auto`, dan itu memaksa overflow-y ikut memotong panel absolut.
  panel.style.position = 'fixed';
  panel.style.top = `${tombol.bottom + 6}px`;
  panel.style.left = `${tombol.left}px`;
  panel.hidden = false;
  const wrap = $('nav-data-wrap');
  if (wrap) wrap.classList.add('buka');
}

export function toggleDataMenu() {
  const panel = $('data-panel');
  if (!panel) return;
  if (panel.hidden) openDataMenu(); else closeDataMenu();
}

function closeDataMenu() {
  const panel = $('data-panel');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  const wrap = $('nav-data-wrap');
  if (wrap) wrap.classList.remove('buka');
}

function openMasterMenu() {
  const panel = $('master-panel');
  if (!panel || !panel.hidden) return;
  const tombol = document.getElementById('nav-master').getBoundingClientRect();
  panel.style.position = 'fixed';
  panel.style.top = (tombol.bottom + 6) + 'px';
  panel.style.left = tombol.left + 'px';
  panel.hidden = false;
  $('nav-master-wrap').classList.add('buka');
}

export function toggleMasterMenu() {
  const panel = $('master-panel');
  if (!panel) return;
  if (!panel.hidden) { closeMasterMenu(); return; }
  openMasterMenu();
}

export function closeMasterMenu() {
  const panel = $('master-panel');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  $('nav-master-wrap').classList.remove('buka');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#nav-master-wrap')) closeMasterMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMasterMenu();
});

// Hover, di samping klik yang sudah ada di atas. `#nav-master-wrap` markup
// statis di index.html (bukan dibuat JS), jadi sudah ada di DOM begitu modul
// ini (type="module", jalan sesudah HTML diparse) dieksekusi — tidak perlu
// menunggu DOMContentLoaded. Jeda tutup 150ms waktu mouse keluar — dibatalkan
// kalau mouse balik ke tombol ATAU ke panelnya sebelum jeda habis, supaya
// tidak "kedip" waktu kursor pindah dari tombol Master ke daftar di bawahnya.
let masterHoverTimer = null;
const navMasterWrap = document.getElementById('nav-master-wrap');
if (navMasterWrap) {
  navMasterWrap.addEventListener('mouseenter', () => {
    clearTimeout(masterHoverTimer);
    openMasterMenu();
  });
  navMasterWrap.addEventListener('mouseleave', () => {
    masterHoverTimer = setTimeout(closeMasterMenu, 150);
  });
}

// Kolom nomor mesin dan bukti foto belum dinyalakan karena datanya memang tidak ada
// di berkas bulanan Astra. Dibaca di sini supaya lint tidak menganggapnya tak terpakai
// dan supaya jelas di mana nanti dipasang.
export const PENDING_COLUMNS = { SHOW_ENGINE_NUMBER, SHOW_HOUSE_PHOTO };
