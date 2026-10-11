/**
 * Seksi "Persentase Keberhasilan Target Penjualan" di halaman Sales Analytics.
 *
 * Bar persentase penjualan terhadap target, per dealer dan total, dengan jumlah target yang
 * DAPAT DIEDIT langsung di seksi ini (2026-10-11, permintaan tim). Target disimpan di server
 * per (bulan, dealer) dalam unit — lihat tabel sales_targets di schema.sql.
 *
 * Yang ditampilkan mengikuti filter yang sama dengan seluruh halaman: dealer yang masuk
 * (Kares/Kota/Kec/Dealer/Pos) dan rentang periode. Hitungannya ada di sales-stats.js
 * (monthsBetween, targetProgress), murni dan diuji.
 *
 * ATURAN PENTING:
 * - Target hanya bisa DIUBAH waktu rentang periode tepat SATU bulan: target milik bulan itu.
 *   Pada rentang beberapa bulan target ditampilkan sebagai jumlah target bulanannya, dan
 *   kolom isiannya dikunci — mengubah "jumlah" tidak punya arti bulan mana yang berubah.
 * - Dealer yang belum punya target dikecualikan dari persentase total dan DIKATAKAN di layar.
 */
import { saveTarget } from './api.js';
import { dealerColor } from './colors.js';
import { $, esc, formatNumber, monthLabel, toast } from './dom.js';
import { activeRows, pageFilters, regionDealerCodes, scopeLabel } from './filters.js';
import { monthsBetween, targetProgress } from './sales-stats.js';
import { S } from './state.js';

/** Warna bar menurut capaian: jauh dari target, mendekati, tercapai. Tetap, bukan persentil. */
const WARNA_BAR = { rendah: '#dc2626', sedang: '#f59e0b', tercapai: '#10b981', kosong: '#cbd5e1' };

/** Warna bar untuk satu persentase (null = belum punya target). */
export function warnaCapaian(percent) {
  if (percent == null) return WARNA_BAR.kosong;
  if (percent >= 100) return WARNA_BAR.tercapai;
  if (percent >= 50) return WARNA_BAR.sedang;
  return WARNA_BAR.rendah;
}

/** Dealer yang masuk hitungan: yang dipilih, atau seluruh dealer di wilayah, atau semuanya. */
function dealerDalamLingkup() {
  const f = pageFilters();
  if (f.dealerCode !== 'ALL') return [f.dealerCode];
  const wilayah = regionDealerCodes(f);
  return wilayah || S.dealers.map((d) => d.code);
}

/** Bulan yang sedang tercakup filter periode. */
function bulanAktif() {
  const f = pageFilters();
  return monthsBetween(f.from, f.to, S.periods);
}

/** 1 desimal, pemisah ribuan Indonesia ("102.400,0%"). null = belum punya target. */
const persenTeks = (p) => (p == null ? '—'
  : `${p.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);

/** Satu bar: lebar dijepit ke 100% (capaian di atas 100 tetap tertulis angkanya). */
function barHtml(percent) {
  const lebar = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  return `<div style="height:8px;border-radius:999px;background:#e2e8f0;overflow:hidden">` +
    `<div style="height:100%;width:${lebar.toFixed(1)}%;background:${warnaCapaian(percent)};` +
    `border-radius:999px;transition:width .3s ease"></div></div>`;
}

function barisDealerHtml(d, dapatDiedit) {
  const nama = S.dealerNames[d.code] || d.code;
  const keterangan = d.target == null
    ? `${formatNumber(d.realized)} unit · belum punya target`
    : `${formatNumber(d.realized)} dari ${formatNumber(d.target)} unit`;
  const nilai = d.target == null ? '' : String(d.target);
  const judulInput = dapatDiedit
    ? 'Target ' + nama + ' (unit) untuk bulan ini. Kosongkan untuk menghapus.'
    : 'Pilih satu bulan pada filter periode untuk mengubah target.';

  return `<div class="px-2 py-2 rounded-lg hover:bg-slate-50">` +
    `<div class="flex items-center gap-3">` +
    `<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${esc(dealerColor(S.registry, d.code))}"></span>` +
    `<div class="min-w-0" style="flex:1 1 140px">` +
    `<div class="text-sm font-semibold text-slate-800 truncate" title="${esc(nama)}">${esc(nama)}</div>` +
    `<div class="text-[11px] text-slate-400">${esc(keterangan)}</div></div>` +
    `<input id="tgt-${esc(d.code)}" type="number" min="0" max="1000000" step="1" inputmode="numeric" ` +
    `value="${esc(nilai)}" placeholder="target" title="${esc(judulInput)}" ` +
    `${dapatDiedit ? `onchange="saveTargetInput('${esc(d.code)}')"` : 'disabled'} ` +
    `class="w-24 shrink-0 px-2 py-1 rounded-lg border border-slate-200 text-sm mono text-right ` +
    `${dapatDiedit ? 'bg-white' : 'bg-slate-50 text-slate-400'}">` +
    `<div class="w-16 shrink-0 text-right text-sm font-extrabold mono" style="color:${warnaCapaian(d.percent)}">` +
    `${esc(persenTeks(d.percent))}</div></div>` +
    `<div class="mt-1.5">${barHtml(d.percent)}</div></div>`;
}

/**
 * Gambar ulang seksi. Dipanggil renderAll() (app.js) tiap filter berubah.
 *
 * Tidak menerima `rows` dari renderAll(): barisnya harus TANPA filter Pos (target milik
 * dealer), sedangkan yang dikirim renderAll() sudah disaring sampai pos.
 */
export function renderTargets() {
  const isi = $('target-isi');
  if (!isi) return;

  const months = bulanAktif();
  const dapatDiedit = months.length === 1;
  const hasil = targetProgress({
    dealerCodes: dealerDalamLingkup(),
    rows: activeRows(undefined, { tanpaPos: true }),
    targets: S.targets,
    months,
  });
  const { total } = hasil;
  const posDipilih = pageFilters().outletCode !== 'ALL';

  const periodeTeks = months.length === 0 ? 'belum ada data'
    : months.length === 1 ? monthLabel(months[0])
      : `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])} (${months.length} bulan)`;
  if ($('target-info')) {
    $('target-info').textContent = `${scopeLabel()} · ${periodeTeks}` +
      (dapatDiedit ? '' : ' · target = jumlah target bulanan; pilih satu bulan untuk mengubahnya') +
      (posDipilih ? ' · target milik dealer, jadi filter Pos tidak dipakai di sini' : '');
  }

  const dikecualikan = total.dealerTotal - total.dealerBertarget;
  const totalHtml = `<div class="rounded-xl border border-slate-200 p-3 mb-2">` +
    `<div class="flex items-end justify-between gap-3 flex-wrap">` +
    `<div><div class="text-[10px] uppercase font-bold text-slate-400 tracking-wide">Total capaian target</div>` +
    `<div class="text-2xl font-extrabold mono" style="color:${warnaCapaian(total.percent)}">${esc(persenTeks(total.percent))}</div></div>` +
    `<div class="text-right text-[11px] text-slate-500">` +
    `<div><b class="text-slate-800 mono">${esc(formatNumber(total.realizedBertarget))}</b> dari ` +
    `<b class="text-slate-800 mono">${esc(formatNumber(total.target))}</b> unit target</div>` +
    `<div>${esc(formatNumber(total.dealerBertarget))} dari ${esc(formatNumber(total.dealerTotal))} dealer punya target</div>` +
    `</div></div><div class="mt-2">${barHtml(total.percent)}</div>` +
    (dikecualikan > 0 && total.dealerBertarget > 0
      ? `<div class="text-[10px] text-slate-400 mt-1.5">${esc(formatNumber(dikecualikan))} dealer belum punya ` +
        `target — penjualannya tidak dihitung dalam persentase total.</div>` : '') +
    `</div>`;

  const kosong = '<p class="text-center text-slate-400 text-sm py-6">Tidak ada dealer pada filter ini.</p>';
  const belumAdaTarget = total.dealerTotal > 0 && total.dealerBertarget === 0
    ? '<p class="text-xs text-slate-500 px-1 pb-2">Belum ada target. Isi kolom <b>target</b> pada ' +
      'dealer di bawah (dalam unit) untuk melihat persentase keberhasilannya.</p>' : '';

  // Total + keterangan DI LUAR wadah gulir: angka totalnya tidak ikut menggulir hilang
  // waktu daftar dealer panjang (78 baris) digulir.
  if ($('target-total')) $('target-total').innerHTML = months.length === 0 ? '' : totalHtml + belumAdaTarget;
  // Dua kolom kalau lebar (auto-fill), satu kolom di layar sempit. Inline style, bukan kelas
  // Tailwind baru, supaya tidak bergantung pada `npm run css`.
  isi.innerHTML = months.length === 0
    ? '<p class="text-center text-slate-400 text-sm py-6">Belum ada data penjualan.</p>'
    : hasil.perDealer.length
      ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));column-gap:1rem">' +
        hasil.perDealer.map((d) => barisDealerHtml(d, dapatDiedit)).join('') + '</div>'
      : kosong;
}

/**
 * Simpan target yang baru diketik. Angka kosong menghapus target dealer itu. Hasilnya
 * ditulis ke S.targets lalu seksi digambar ulang; kalau server menolak, nilai lama
 * dikembalikan (digambar ulang dari S.targets, bukan dari isi kotak) dan alasannya
 * ditampilkan apa adanya.
 */
export async function saveTargetInput(dealerCode) {
  const months = bulanAktif();
  if (months.length !== 1) return;          // terkunci di layar; jaga-jaga kalau lolos
  const bulan = months[0];
  const kotak = $(`tgt-${dealerCode}`);
  if (!kotak) return;

  const teks = kotak.value.trim();
  try {
    const hasil = await saveTarget(bulan, dealerCode, teks === '' ? null : Number(teks));
    const perBulan = S.targets[bulan] || (S.targets[bulan] = {});
    if (hasil.units === null) delete perBulan[dealerCode];
    else perBulan[dealerCode] = hasil.units;
    toast(hasil.units === null ? 'Target dihapus' : 'Target disimpan', 'ok');
  } catch (error) {
    toast(error.message || 'Target gagal disimpan', 'error');
  }
  renderTargets();
}
