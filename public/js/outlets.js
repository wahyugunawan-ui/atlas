/**
 * Titik dealer/pos di peta.
 *
 * Marker DOM, bukan lapisan circle: jumlahnya 78, dan tiap marker perlu ikon, hover,
 * dan klik. Untuk 78 elemen itu murah; untuk 18 ribu titik penjualan tidak, dan itu
 * sebabnya titik penjualan memakai lapisan circle di map.js.
 */
import { dealerColor } from './colors.js';
import { $, esc, formatNumber, sumBy } from './dom.js';
import { activeRows, applyScope, filterValue } from './filters.js';
import { S } from './state.js';

export function drawMarkers() {
  S.markers.forEach((m) => m.remove());
  S.markers = [];

  const perOutlet = sumBy(activeRows(), 'outlet');
  const dealerFilter = filterValue('filter-dealer');
  const posFilter = filterValue('filter-pos');
  const focusDealer = posFilter !== 'ALL'
    ? (S.outletByCode[posFilter] || {}).dealerCode : dealerFilter;

  S.outlets.forEach((outlet) => {
    if (outlet.lat == null) return;
    const selected = S.selectedOutlet === outlet.code;
    // Tiga tingkat, bukan dua: pos terpilih penuh, saudara sedealer tetap berwarna
    // tapi lebih kecil, sisanya abu. Waktu menekan satu pos, pos lain milik dealer
    // yang sama tetap harus kelihatan.
    const sameDealer = focusDealer !== 'ALL' && outlet.dealerCode === focusDealer;
    const grey = focusDealer !== 'ALL' && !sameDealer;
    const medium = sameDealer && posFilter !== 'ALL' && !selected;

    const el = document.createElement('div');
    el.className = 'marker-outlet' + (grey ? ' abu' : '') +
      (medium ? ' sedang' : '') + (selected ? ' terpilih' : '');
    el.style.background = grey ? '' : dealerColor(S.registry, outlet.dealerCode);
    el.innerHTML = '<i class="ph-fill ph-storefront"></i>';

    el.addEventListener('mouseenter', (e) =>
      showOutletTooltip(outlet, perOutlet[outlet.code] || 0, e));
    el.addEventListener('mousemove', moveTooltip);
    el.addEventListener('mouseleave', () => $('tooltip').classList.remove('show'));
    el.addEventListener('click', (e) => { e.stopPropagation(); selectOutlet(outlet.code); });

    S.markers.push(new maplibregl.Marker({ element: el })
      .setLngLat([outlet.lng, outlet.lat]).addTo(S.map));
  });
}

function showOutletTooltip(outlet, units, event) {
  const tip = $('tooltip');
  tip.innerHTML =
    `<div class="font-bold text-white">${esc(outlet.name)}</div>` +
    `<div class="text-[11px] text-slate-300 flex items-center gap-1.5 mt-0.5">` +
    `<span class="w-2 h-2 rounded-full inline-block" style="background:${esc(dealerColor(S.registry, outlet.dealerCode))}"></span>` +
    `${esc(outlet.dealerName)}</div>` +
    `<div class="text-[11px] text-slate-300 mt-1.5">${esc(formatNumber(units))} penjualan pada filter ini</div>` +
    `<div class="text-[10px] text-slate-400 mt-1">klik untuk melihat area layanannya</div>`;
  tip.classList.add('show');
  moveTooltip(event);
}

export function moveTooltip(event) {
  const tip = $('tooltip');
  tip.style.left = event.clientX + 'px';
  tip.style.top = event.clientY + 'px';
}

/**
 * Klik outlet = seperti klik kotak di treemap.
 *
 * Diminta di meeting 12 Agustus: heatmapnya dihitung ULANG hanya dari penjualan pos
 * itu, bukan sekadar menyorot di atas peta yang lama. Caranya dengan menyalakan filter
 * pos — dengan begitu KPI, peringkat, treemap, tabel, dan legenda ikut berpindah, dan
 * tidak ada satu pun angka di layar yang masih menghitung sesuatu yang lain.
 */
export function selectOutlet(code) { applyScope('pos', code); }

export function closeSelectionInfo() {
  S.selectedOutlet = null;
  $('filter-pos').value = 'ALL';
  window.renderAll();
}
