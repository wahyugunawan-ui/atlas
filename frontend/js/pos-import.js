/**
 * Impor massal pos dari Excel: dua langkah, pilih berkas -> pratinjau -> terapkan.
 *
 * Terpisah dari wizard impor penjualan bulanan (import.js): tujuannya beda —
 * menyunting nama/alamat pos yang SUDAH ADA, bukan menulis penjualan baru — dan
 * menyatukannya ke wizard 4-langkah yang sudah ada cuma akan membingungkan
 * step-dot-nya.
 *
 * Beda penting dari impor bulanan: impor ini MEMANG dimaksudkan menimpa nama/alamat
 * pos yang beda dari Excel — bukan bug. Pengamannya pratinjau eksplisit + satu
 * tombol konfirmasi ("Terapkan Perubahan"), bukan perlindungan diam-diam.
 */
import { commitOutletImport, previewOutletImport } from './api.js';
import { $, esc, formatNumber, toast } from './dom.js';
import { renderOutletTable } from './tables.js';

const STATE = { preview: null };

const NAMA_FIELD = { outletName: 'Nama', address: 'Alamat' };

export function openPosImport() {
  STATE.preview = null;
  $('pimp-input').value = '';
  $('pimp-2').classList.add('hidden');
  $('pimp-1').classList.remove('hidden');
  $('pimp-pesan').textContent = '';
  $('modal-pos-import').classList.remove('hidden');
}

export function closePosImport() {
  $('modal-pos-import').classList.add('hidden');
}

export async function posImportFileChosen(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  $('pimp-pesan').textContent = 'Membaca berkas...';
  try {
    STATE.preview = await previewOutletImport(file);
    renderPosImportPreview();
    $('pimp-1').classList.add('hidden');
    $('pimp-2').classList.remove('hidden');
  } catch (error) {
    $('pimp-pesan').textContent = error.message;
  }
}

function renderPosImportPreview() {
  const p = STATE.preview;
  const posBerubah = new Set(p.changed.map((c) => c.outletCode)).size;

  $('pimp-ringkas').innerHTML =
    `<b>${formatNumber(p.changed.length)}</b> field berubah di ` +
    `<b>${formatNumber(posBerubah)}</b> pos &middot; ` +
    `${formatNumber(p.unchanged)} pos sudah sama &middot; ` +
    `${formatNumber(p.added.length)} kode baru (tidak dibuat di sini) &middot; ` +
    `${formatNumber(p.invalid.length)} baris tidak terbaca`;

  $('pimp-table-body').innerHTML = p.changed.length ? p.changed.map((c) =>
    `<tr>` +
    `<td class="px-3 py-2 mono text-xs text-slate-500">${esc(c.outletCode)}</td>` +
    `<td class="px-3 py-2 text-slate-600 text-xs">${esc(NAMA_FIELD[c.field] || c.field)}</td>` +
    `<td class="px-3 py-2 text-xs text-red-600 line-through">${esc(c.oldValue || '—')}</td>` +
    `<td class="px-3 py-2 text-xs text-emerald-700 font-semibold">${esc(c.newValue || '—')}</td>` +
    `</tr>`).join('')
    : '<tr><td colspan="4" class="text-center py-6 text-slate-400 text-sm">Tidak ada yang berubah.</td></tr>';

  const peringatan = [];
  if (p.multiCandidate.length) {
    peringatan.push(`${p.multiCandidate.length} kode pos punya lebih dari satu baris di Excel — ` +
      `kandidat PERTAMA yang dipakai: ${p.multiCandidate.map((m) => esc(m.outletCode)).join(', ')}.`);
  }
  if (p.invalid.length) {
    peringatan.push(`${p.invalid.length} baris tidak punya kode atau nama pos, dilewati.`);
  }
  if (p.added.length) {
    peringatan.push(`${p.added.length} kode pos di Excel belum ada di database: ` +
      `${p.added.map((a) => esc(a.outletCode)).join(', ')} — tambahkan manual lewat ` +
      '"Tambah Pos" kalau memang pos baru. Butuh dealer induk, tidak ada di sheet ini.');
  }
  $('pimp-peringatan').innerHTML = peringatan.map((t) =>
    `<div class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 leading-snug mb-2">${t}</div>`,
  ).join('');

  $('pimp-terapkan').disabled = p.changed.length === 0;
}

export async function applyPosImport() {
  if (!STATE.preview) return;
  const tombol = $('pimp-terapkan');
  tombol.disabled = true;
  tombol.textContent = 'Menerapkan...';
  try {
    const hasil = await commitOutletImport(STATE.preview.previewToken);
    closePosImport();
    toast(`${hasil.applied} pos diperbarui.`, 'ok');
    await window.reloadSummary();
    renderOutletTable();
  } catch (error) {
    toast('Gagal menerapkan: ' + error.message, 'error');
  } finally {
    tombol.disabled = false;
    tombol.textContent = 'Terapkan Perubahan';
  }
}
