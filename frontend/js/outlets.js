/**
 * Titik dealer/pos di peta.
 *
 * Marker DOM, bukan lapisan circle: jumlahnya 78, dan tiap marker perlu ikon, hover,
 * dan klik. Untuk 78 elemen itu murah; untuk 18 ribu titik penjualan tidak, dan itu
 * sebabnya titik penjualan memakai lapisan circle di map.js.
 */
import { dealerColor } from './colors.js';
import { $, esc, formatNumber, sumBy } from './dom.js';
import { activeRows, applyScope, clearScope, scopeValue, splitByCoverage } from './filters.js';
import { S } from './state.js';

export function drawMarkers() {
  S.markers.forEach((m) => m.remove());
  S.markers = [];

  const perOutlet = sumBy(activeRows(), 'outlet');
  const dealerFilter = scopeValue('dealer');
  const posFilter = scopeValue('pos');
  const focusDealer = posFilter !== 'ALL'
    ? (S.outletByCode[posFilter] || {}).dealerCode : dealerFilter;

  S.outlets.forEach((outlet) => {
    if (outlet.lat == null) return;
    const selected = posFilter === outlet.code;
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
  clearScope('pos');
  window.renderAll();
}

/* ==========================================================================
   TOOLTIP KELURAHAN DI PETA
   ==========================================================================
   Sebaran per kelurahan dan kabupaten terbaca TANPA mengklik apa pun — arahkan kursor,
   angkanya muncul. Panel rincian tetap ada untuk menelusuri berurutan; ini untuk
   pertanyaan yang muncul sambil melihat peta: "yang gelap di sini berapa?".

   Mengikuti ruang lingkup yang sedang aktif. Kalau satu dealer sedang dipilih, yang
   ditampilkan penjualan DEALER ITU di kelurahan tersebut — bukan total semua dealer.
   Kalau tidak ada yang dipilih, ya totalnya. Angka di tooltip tidak boleh menghitung
   hal yang berbeda dari peta yang sedang diwarnai di bawahnya.
   ========================================================================== */

/**
 * Ringkasan satu kelurahan beserta kabupatennya, dari baris yang sedang aktif.
 *
 * Dihitung saat kursor lewat, bukan disiapkan di awal. 4.003 kelurahan x tiap perubahan
 * filter berarti pekerjaan yang hampir seluruhnya terbuang — yang dilihat orang cuma
 * satu per satu.
 */
export function villageTooltipData(villageCode) {
  const village = S.villageByCode[villageCode];
  if (!village) return null;

  const rows = activeRows();
  const diKelurahan = rows.filter((r) => r.village === villageCode);
  const diKabupaten = rows.filter((r) => {
    const v = S.villageByCode[r.village];
    return v && v.cityCode === village.cityCode;
  });

  const kel = splitByCoverage(diKelurahan);
  const kab = splitByCoverage(diKabupaten);
  const kabVillages = new Set(diKabupaten.map((r) => r.village));

  return {
    name: village.name,
    district: village.district,
    cityName: village.cityName,
    units: diKelurahan.reduce((sum, r) => sum + r.units, 0),
    inside: kel.inside,
    covered: kel.total,
    hasGeom: village.hasGeom !== false,
    city: {
      units: diKabupaten.reduce((sum, r) => sum + r.units, 0),
      inside: kab.inside,
      covered: kab.total,
      villages: kabVillages.size,
    },
  };
}

export function showVillageTooltip(villageCode, event) {
  const d = villageTooltipData(villageCode);
  const tip = $('tooltip');
  if (!d) { tip.classList.remove('show'); return; }

  const persen = (inside, covered) =>
    covered ? `${(inside / covered * 100).toFixed(0)}% dalam jangkauan` : null;
  const kelPersen = persen(d.inside, d.covered);
  const kabPersen = persen(d.city.inside, d.city.covered);

  tip.innerHTML =
    `<div class="font-bold text-white">${esc(d.name)}</div>` +
    `<div class="text-[11px] text-slate-300">${esc(d.district || '')}</div>` +
    `<div class="text-[11px] text-slate-200 mt-1.5">` +
    `<b>${esc(formatNumber(d.units))}</b> penjualan` +
    (kelPersen ? ` · ${esc(kelPersen)}` : '') + `</div>` +
    // Kelurahan tanpa batas wilayah disebut apa adanya, bukan ditampilkan 0%. Nol yang
    // sebenarnya "belum bisa dihitung" adalah cara tercepat membuat orang salah simpul.
    (d.hasGeom ? '' :
      `<div class="text-[10px] text-amber-300 mt-0.5">belum ada batas wilayah — ` +
      `jangkauannya tidak bisa dihitung</div>`) +
    `<div class="text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-600">` +
    `${esc(d.cityName || '')}<br>` +
    `<b class="text-slate-300">${esc(formatNumber(d.city.units))}</b> penjualan di ` +
    `${esc(formatNumber(d.city.villages))} kelurahan` +
    (kabPersen ? ` · ${esc(kabPersen)}` : '') + `</div>`;

  tip.classList.add('show');
  moveTooltip(event);
}
