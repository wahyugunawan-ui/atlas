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

