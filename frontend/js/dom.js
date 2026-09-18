/**
 * Bantu DOM: escape, format angka, pencari elemen, toast.
 *
 * esc() WAJIB dipakai untuk setiap nilai yang berasal dari Excel sebelum masuk
 * innerHTML. Sumbernya tidak dipercaya, dan satu nama outlet berisi tanda kurung
 * sudah cukup untuk menyuntikkan markup.
 */
import { MONTHS } from './config.js';

export const $ = (id) => document.getElementById(id);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const formatNumber = (n) => Number(n || 0).toLocaleString('id-ID');

/** `null`/`undefined` -> 'Data belum tersedia', bukan dipaksa jadi "0%". */
export const formatPercent = (n, digits = 2) => (n == null ? 'Data belum tersedia' :
  Number(n).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + '%');

/** '2026-08' -> 'Agustus 2026'. */
export function monthLabel(period) {
  const [year, month] = String(period || '').split('-');
  return MONTHS[Number(month) - 1] ? `${MONTHS[Number(month) - 1]} ${year}` : period;
}

export function toast(message, kind) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.style.background = kind === 'ok' ? '#10b981'
    : kind === 'error' ? 'var(--astra-red)' : 'var(--astra-navy)';
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 3200);
}

/** Kotak pembatas satu FeatureCollection, untuk fitBounds. */
export function bbox(geo) {
  let minX = 180;
  let minY = 90;
  let maxX = -180;
  let maxY = -90;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
      return;
    }
    c.forEach(walk);
  };
  geo.features.forEach((f) => walk(f.geometry.coordinates));
  return [[minX, minY], [maxX, maxY]];
}

/** Jumlahkan `units` per nilai satu field. */
export function sumBy(rows, key) {
  const out = {};
  rows.forEach((r) => { out[r[key]] = (out[r[key]] || 0) + r.units; });
  return out;
}

/**
 * Nama kota untuk TAMPILAN saja — buang awalan "Kabupaten ", biarkan "Kota " apa
 * adanya.
 *
 * PERMINTAAN TIM: kata "Kabupaten" dihapus dari layar, TAPI kata itu tetap harus bisa
 * dibaca dari berkas Excel yang diimpor — pencocokan nama kelurahan dan `city_name` di
 * database TIDAK disentuh sama sekali, cuma tempat menampilkannya yang dipangkas.
 * Karena itu fungsi ini murni untuk TAMPILAN: dipanggil di titik render, bukan pernah
 * di jalur impor atau pencocokan.
 *
 * "Kota " sengaja DIBIARKAN, bukan ikut dibuang: itu bagian nama resmi yang
 * membedakan satu wilayah dari yang lain (mis. "Kota Yogyakarta" vs empat
 * "Kabupaten ..." lain di Karesidenan Yogyakarta) — membuangnya akan membuat dua
 * wilayah berbeda terlihat sama di layar.
 *
 * Dibuat case-insensitive dan tahan spasi ganda: sumbernya Excel, dan variasi
 * "KABUPATEN  Sleman" (dua spasi, huruf besar semua) sudah pernah muncul di data
 * nyata proyek lain.
 */
export function displayCityName(name) {
  const s = String(name ?? '').trim();
  return s.replace(/^kabupaten\s+/i, '').trim();
}

/**
 * Nama kota untuk ditampilkan, dengan jalan keluar waktu namanya memang tidak ada.
 *
 * Tabel wilayah proyek ini hanya memuat Jateng + DIY. Pelanggan ber-KTP Jakarta,
 * Tangerang, atau Bandung yang membeli di wilayah cakupan TETAP masuk hitungan —
 * kotanya nyata, cuma namanya tidak pernah di-seed. Sampai 2026-09-18 baris seperti
 * itu tampil sebagai kode telanjang ("31.74", "36.73") di Matriks dan Peringkat Kota,
 * dan pengguna non-IT membacanya sebagai data rusak, bukan sebagai kota luar daerah.
 *
 * Kodenya TETAP disebut, tidak disembunyikan: itu satu-satunya pegangan kalau suatu
 * saat ada yang perlu menelusuri baris itu. Barisnya juga tidak dibuang — penjualan
 * ke luar daerah tetap penjualan, dan membuangnya diam-diam akan membuat total di
 * layar tidak cocok dengan total di panel lain.
 *
 * Kalimatnya sengaja SAMA PERSIS dengan yang sudah dipakai panel Cakupan Sumber
 * (`namaBaris()` di fusion.js), yang lebih dulu memecahkan masalah yang sama untuk
 * panelnya sendiri. Satu keadaan data seharusnya punya satu sebutan di seluruh
 * layar; dua kalimat berbeda untuk hal yang sama membuat orang mengira itu dua hal.
 *
 * @param {string|null} name nama kota dari server; kosong/null untuk luar cakupan
 * @param {string|null} code kode BPS kota (bertitik), dipakai kalau namanya kosong
 */
export function labelKota(name, code) {
  const bersih = displayCityName(name);
  if (bersih) return bersih;
  const kode = String(code ?? '').trim();
  return kode ? `Luar cakupan (${kode})` : '—';
}

