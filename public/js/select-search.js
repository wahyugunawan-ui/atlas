/**
 * Dropdown yang bisa dicari.
 */
import { $, esc } from './dom.js';
import { S } from './state.js';

/**
 * Cari di dalam dropdown. Daftar penuhnya disimpan supaya bisa dibangun ulang;
 * `<select>` tetap jadi pemegang nilai, jadi yang tersimpan selalu KODE, bukan
 * teks yang diketik. Tanpa itu, salah ketik akan diam-diam mengubah filter.
 */
export function filterSelectOptions(nama) {
  const el = $('filter-' + nama);
  const q = ($('cari-' + nama).value || '').trim().toLowerCase();
  const penuh = S.allOptions['filter-' + nama];
  if (!el || !penuh) return;
  const dipilih = el.value;
  const saring = q ? penuh.daftar.filter(([, t]) => t.toLowerCase().includes(q)) : penuh.daftar;
  // Pilihan yang sedang aktif selalu ikut ditampilkan, walau tidak cocok kata
  // kunci — kalau tidak, filternya berubah sendiri hanya karena orang mengetik.
  const tampil = saring.some(([v]) => v === dipilih) || dipilih === 'ALL'
    ? saring : saring.concat(penuh.daftar.filter(([v]) => v === dipilih));
  el.innerHTML = `<option value="ALL">${esc(penuh.labelSemua)}</option>` +
    tampil.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  el.value = dipilih;
}

export function fillSelect(el, pasangan, labelSemua) {
  S.allOptions[el.id] = { daftar: pasangan, labelSemua: labelSemua };
  el.innerHTML = `<option value="ALL">${esc(labelSemua)}</option>` +
    pasangan.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
}
