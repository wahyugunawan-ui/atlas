/**
 * Tab Import Data.
 *
 * Alurnya sama dengan prototipe — pilih periode, unggah, proses, tinjau — bedanya
 * berkasnya benar-benar dibaca server dan hasilnya benar-benar masuk database.
 *
 * Urutannya disengaja: periode dipilih SEBELUM berkas diunggah. Kalau sebaliknya,
 * berkas yang salah bulan sudah terlanjur terkirim sebelum ada yang menyadarinya.
 */
import {
  deletePeriod, deleteSumberPeriode, fetchImports, fetchPeriods, fetchUnmatched,
  uploadImport, uploadSumber,
} from './api.js';
import { MONTHS } from './config.js';
import { $, esc, formatNumber, monthLabel, toast } from './dom.js';
// Checklist jenis data per periode. Logikanya di modul murni supaya bisa diuji tanpa
// browser — khususnya pembedaan "kosong" vs "tidak bisa diperiksa".
import { checklistPeriode, ringkasChecklist, ringkasHasilSumber } from './import-periods.js';

const STATE = {
  step: 1,
  file: null,
  saved: [],
  result: null,
};

function setStep(step) {
  STATE.step = step;
  [1, 2, 3, 4].forEach((n) => {
    $('imp-' + n).classList.toggle('hidden', n !== step);
    const dot = $('step-' + n);
    dot.className = 'step-dot ' + (n < step ? 'done' : n === step ? 'now' : 'todo');
    dot.textContent = n < step ? '✓' : String(n);
  });
}

export function importStep(step) {
  if (step === 2 && !currentPeriod()) {
    toast('Pilih bulan dan tahun dulu.', 'error');
    return;
  }
  setStep(step);
}

function currentPeriod() {
  const month = $('imp-bulan').value;
  const year = $('imp-tahun').value;
  return month && year && month !== 'ALL' && year !== 'ALL' ? `${year}-${month}` : '';
}

export function importPeriodChanged() {
  const period = currentPeriod();
  const existing = STATE.saved.find((s) => s.period === period);

  $('imp-warning').classList.toggle('hidden', !existing);
  if (existing) {
    $('imp-warning-text').innerHTML =
      `Periode <b>${esc(monthLabel(period))}</b> sudah pernah diimpor ` +
      `(${esc(formatNumber(existing.units))} unit). Mengimpor lagi akan ` +
      `<b>mengganti seluruh data bulan itu</b>. Bulan lain tidak tersentuh.`;
  }
  $('imp-label-2').textContent = monthLabel(period);
  $('imp-label-4').textContent = monthLabel(period);
  // Blok Data KTP/Servis memakai periode yang SAMA, tapi pemilihnya ada di tahap 1
  // yang tersembunyi begitu wizard berpindah. Bulannya ditulis di blok itu supaya
  // tidak ada yang mengunggah ke bulan yang tidak sedang dia lihat.
  if ($('impx-periode')) {
    $('impx-periode').textContent = period ? monthLabel(period) : '—';
  }
}

/* ==========================================================================
   PILIH BERKAS
   ========================================================================== */

export function pickFile() { $('imp-input').click(); }

export function fileChosen(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  STATE.file = file;

  $('imp-file-name').textContent = file.name;
  $('imp-file-size').textContent =
    `${(file.size / 1e6).toFixed(1)} MB · ${file.name.split('.').pop().toUpperCase()}`;
  $('imp-file').classList.remove('hidden');
}

export function dropFile(event) {
  event.preventDefault();
  $('dropzone').classList.remove('hover');
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  $('imp-input').files = event.dataTransfer.files;
  fileChosen($('imp-input'));
}

export function dragOver(event) {
  event.preventDefault();
  $('dropzone').classList.add('hover');
}

export function dragLeave() { $('dropzone').classList.remove('hover'); }

/* ==========================================================================
   PROSES
   ========================================================================== */

export async function runUpload() {
  if (!STATE.file) { toast('Pilih berkasnya dulu.', 'error'); return; }
  const period = currentPeriod();
  setStep(3);

  $('imp-result').classList.add('hidden');
  $('imp-proc-title').textContent = 'Mengunggah berkas...';
  $('imp-bar').style.width = '0%';
  $('imp-proc-step').textContent = '';

  try {
    const result = await uploadImport({
      file: STATE.file,
      period,
      onProgress: (ratio) => {
        // Unggah cuma separuh cerita; sisanya server yang bekerja. Bar berhenti di
        // 60% lalu berpindah ke pesan "diproses" supaya tidak terlihat menggantung
        // di 100% padahal masih menghitung.
        $('imp-bar').style.width = (ratio * 60).toFixed(0) + '%';
        if (ratio >= 1) {
          $('imp-proc-title').textContent = 'Diproses di server...';
          $('imp-proc-step').textContent =
            'mencocokkan kelurahan, mengelompokkan pos, menghitung agregat';
          $('imp-bar').style.width = '75%';
        }
      },
    });

    STATE.result = result;
    $('imp-bar').style.width = '100%';
    $('imp-proc-title').textContent = 'Selesai';
    $('imp-proc-step').textContent = '';
    showResult(result);
    await refreshImportTab();
  } catch (error) {
    $('imp-proc-title').textContent = 'Gagal';
    $('imp-bar').style.width = '0%';
    $('imp-proc-step').innerHTML =
      `<span class="text-red-600 font-semibold">${esc(error.message)}</span>`;
    toast(error.message, 'error');
  }
}

function showResult(result) {
  const percent = result.rowsRead
    ? (result.rowsUsed / result.rowsRead * 100).toFixed(1) : '0';

  $('imp-stat-read').textContent = formatNumber(result.rowsRead);
  $('imp-stat-used').textContent = formatNumber(result.rowsUsed);
  $('imp-stat-percent').textContent = percent + '%';
  $('imp-stat-unmatched').textContent = formatNumber(
    result.unmatched.reduce((sum, u) => sum + u.count, 0));
  $('imp-stat-new').textContent = formatNumber(result.newOutlets.length);

  // Yang tidak cocok TIDAK boleh cuma jadi angka. Namanya ditampilkan supaya ada yang
  // bisa memeriksanya — itu satu-satunya cara daftar ini mengecil dari bulan ke bulan.
  $('imp-unmatched').innerHTML = result.unmatched.length
    ? result.unmatched.slice(0, 40).map((u) =>
      `<div class="px-4 py-2 flex items-center gap-2">` +
      `<span class="font-semibold text-slate-700">${esc(u.villageName)}</span>` +
      `<span class="text-slate-400">${esc(u.districtName)}, ${esc(u.cityCode)}</span>` +
      `<span class="ml-auto mono text-slate-500">${esc(formatNumber(u.count))} baris</span></div>`).join('')
    : '<div class="px-4 py-3 text-slate-400">Semua nama kelurahan cocok.</div>';
  $('imp-unmatched-title').textContent =
    `${formatNumber(result.unmatched.length)} nama kelurahan belum cocok — perlu diperiksa manusia`;
  $('imp-unmatched-box').classList.toggle('hidden', !result.unmatched.length);

  // Outlet baru dikelompokkan dengan MENEBAK dari namanya. Itu harus disebut, bukan
  // dibiarkan lewat sebagai angka di antara angka lain.
  $('imp-new-outlets').innerHTML = result.newOutlets.length
    ? `<div class="mt-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-900">` +
      `<b>${esc(formatNumber(result.newOutlets.length))} pos baru</b> dikelompokkan ` +
      `dengan menebak dari namanya. Periksa di halaman Master Pos Dealer sebelum ` +
      `dipakai untuk mengambil keputusan.<br>` +
      result.newOutlets.slice(0, 8).map((o) =>
        `<span class="inline-block mt-1 mr-2 bg-white border border-blue-200 rounded px-2 py-0.5 mono">` +
        `${esc(o.outletName)}</span>`).join('') +
      `</div>`
    : '';

  $('imp-result').classList.remove('hidden');
}

/* ==========================================================================
   TINJAU
   ========================================================================== */

export async function reviewImport() {
  setStep(4);
  const period = currentPeriod();
  $('imp-review').innerHTML =
    '<p class="text-sm text-slate-400 py-6 text-center">memuat…</p>';

  try {
    const { unmatched } = await fetchUnmatched(period);
    const result = STATE.result || {};

    $('imp-review').innerHTML =
      `<div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">` +
      card('Periode', monthLabel(period)) +
      card('Baris masuk', formatNumber(result.rowsUsed || 0)) +
      card('Baris penjualan', formatNumber(result.salesRows || 0)) +
      `</div>` +

      `<div class="text-sm font-bold text-slate-700 mb-2">Nama kelurahan yang belum cocok</div>` +
      `<p class="text-xs text-slate-500 mb-3">Baris-baris ini TIDAK masuk hitungan. ` +
      `Biasanya karena beda ejaan. Perbaiki di berkas Excel lalu impor ulang bulan ini — ` +
      `data lama bulan ini akan diganti, bulan lain tidak tersentuh.</p>` +

      (unmatched.length
        ? `<div class="border border-slate-200 rounded-xl overflow-hidden">` +
          `<table class="w-full text-xs"><thead class="bg-slate-50"><tr>` +
          `<th class="px-3 py-2 text-left font-bold text-slate-500">Kelurahan</th>` +
          `<th class="px-3 py-2 text-left font-bold text-slate-500">Kecamatan</th>` +
          `<th class="px-3 py-2 text-left font-bold text-slate-500">Kode Kota</th>` +
          `<th class="px-3 py-2 text-right font-bold text-slate-500">Baris</th>` +
          `</tr></thead><tbody class="divide-y divide-slate-100">` +
          unmatched.map((u) =>
            `<tr><td class="px-3 py-1.5 font-semibold text-slate-700">${esc(u.villageName)}</td>` +
            `<td class="px-3 py-1.5 text-slate-600">${esc(u.districtName)}</td>` +
            `<td class="px-3 py-1.5 mono text-slate-500">${esc(u.cityCode)}</td>` +
            `<td class="px-3 py-1.5 text-right mono">${esc(formatNumber(u.rowCount))}</td></tr>`).join('') +
          `</tbody></table></div>`
        : `<p class="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">` +
          `Semua nama kelurahan cocok. Tidak ada yang perlu diperiksa.</p>`);
  } catch (error) {
    $('imp-review').innerHTML =
      `<p class="text-sm text-red-600 py-6 text-center">${esc(error.message)}</p>`;
  }
}

function card(label, value) {
  return `<div class="bg-slate-50 rounded-xl p-3">` +
    `<div class="text-[10px] uppercase font-bold text-slate-400">${esc(label)}</div>` +
    `<div class="text-lg font-extrabold text-slate-800">${esc(value)}</div></div>`;
}

export function finishImport() {
  setStep(1);
  STATE.file = null;
  STATE.result = null;
  $('imp-input').value = '';
  $('imp-file').classList.add('hidden');
  toast('Data sudah masuk. Buka tab Sales Analytics untuk melihatnya.', 'ok');
  window.reloadSummary();
}

/* ==========================================================================
   DAFTAR PERIODE DAN RIWAYAT
   ========================================================================== */

/* ==========================================================================
   DATA KTP & DATA SERVIS
   ==========================================================================
   Alur terpisah dari wizard 4 tahap: panel hasilnya khusus penjualan, dan
   runSourceImport() mengembalikan bentuk yang berbeda (rowsRead/rowsUsed/
   unmatchedNames). Memakai panel yang sama akan menampilkan field penjualan
   dengan nilai kosong — terlihat resmi dan salah.
   ========================================================================== */

const LABEL_SUMBER = { ktp: 'Data KTP', servis: 'Data Servis' };

/** Buka pemilih berkas. Periodenya diperiksa DULU, sebelum orang memilih berkas. */
export function pilihSumber(source) {
  if (!currentPeriod()) {
    toast('Pilih bulan dan tahun dulu di tahap 1.', 'error');
    return;
  }
  const input = $(`impx-${source}-input`);
  if (input) { input.value = ''; input.click(); }
}

/** Unggah, lalu tampilkan ringkasan dari field yang benar-benar dikembalikan server. */
export async function unggahSumber(source, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const period = currentPeriod();
  if (!period) { toast('Pilih bulan dan tahun dulu di tahap 1.', 'error'); return; }

  const status = $('impx-status');
  const kotak = $('impx-hasil');
  status.classList.remove('hidden');
  status.textContent = `Mengunggah ${LABEL_SUMBER[source]}… 0%`;
  kotak.innerHTML = '';

  try {
    const hasil = await uploadSumber({
      source,
      file,
      period,
      onProgress: (rasio) => {
        status.textContent =
          `Mengunggah ${LABEL_SUMBER[source]}… ${Math.round(rasio * 100)}%`;
      },
    });

    status.textContent = `${LABEL_SUMBER[source]} selesai diproses.`;
    const r = ringkasHasilSumber(hasil);

    // Baris yang tidak cocok TIDAK dibuang diam-diam: jumlah dan namanya ikut
    // ditampilkan, sesuai aturan proyek.
    const daftar = (hasil.unmatched || []).slice(0, 8).map((u) =>
      `<div class="flex items-baseline gap-2 text-[11px] py-0.5">` +
      `<span class="text-slate-600 flex-1 truncate">${esc(u.name)}</span>` +
      `<span class="mono text-slate-400">${esc(formatNumber(u.count))}</span></div>`).join('');

    kotak.innerHTML =
      `<div class="rounded-xl border ${r.perluPerhatian ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'} p-3">` +
      `<div class="text-xs font-bold ${r.perluPerhatian ? 'text-amber-900' : 'text-emerald-800'}">` +
      `${esc(LABEL_SUMBER[source])} · ${esc(monthLabel(period))}</div>` +
      `<div class="text-[11px] text-slate-600 mt-1">` +
      `${esc(formatNumber(r.dibaca))} baris dibaca · ${esc(formatNumber(r.terpakai))} masuk` +
      (r.terbuang ? ` · <b>${esc(formatNumber(r.terbuang))} tidak masuk</b>` : '') +
      `</div>` +
      (r.namaTakCocok
        ? `<div class="text-[11px] text-amber-900 mt-2"><b>${esc(formatNumber(r.namaTakCocok))} nama wilayah belum cocok</b> — terbanyak:</div>${daftar}`
        : '') +
      `</div>`;

    await refreshImportTab();
    window.reloadSummary();
  } catch (error) {
    status.classList.add('hidden');
    kotak.innerHTML = `<p class="text-xs text-red-600">${esc(error.message)}</p>`;
  }
}

/* Checklist jenis data per periode. Logikanya di modul murni supaya bisa diuji tanpa
   browser — khususnya pembedaan "kosong" vs "tidak bisa diperiksa". */

/**
 * Hapus satu jenis data satu bulan.
 *
 * Konfirmasinya MENGETIK ULANG periodenya, bukan sekadar "Ya/Batal" — disiplin yang
 * sama dengan hapus periode penuh, karena yang hilang juga sebulan penuh data satu
 * jenis dan tidak bisa dibatalkan. Servernya menuntut hal yang sama, jadi penjaga di
 * layar ini bukan satu-satunya.
 */
export async function hapusSumber(source, period) {
  const nama = { ktp: 'Data KTP', servis: 'Data Servis' }[source] || source;
  const ketik = window.prompt(
    `Hapus ${nama} untuk ${monthLabel(period)}?\n\n` +
    'Seluruh baris bulan itu akan hilang dan penggolongan dihitung ulang. ' +
    'Tindakan ini tidak bisa dibatalkan.\n\n' +
    `Ketik ${period} untuk melanjutkan:`);
  if (ketik === null) return;                       // dibatalkan, bukan salah ketik
  if (ketik.trim() !== period) {
    toast(`Konfirmasi tidak cocok. ${nama} tidak dihapus.`, 'error');
    return;
  }

  try {
    const hasil = await deleteSumberPeriode(source, period);
    const gagalHitung = hasil.fusi && hasil.fusi.gagal;
    toast(`${nama} ${monthLabel(period)} dihapus (${formatNumber(hasil.deleted)} baris).` +
      (gagalHitung ? ' Penggolongan GAGAL dihitung ulang.' : ''),
    gagalHitung ? 'error' : 'ok');
    await refreshImportTab();
    window.reloadSummary();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/** Periode yang rinciannya sedang dibuka; cuma satu, supaya panel tetap ringkas. */
let periodeTerbuka = null;

/** Buka/tutup rincian satu periode. Klik periode lain memindahkan, bukan menumpuk. */
export function togglePeriodeDetail(period) {
  periodeTerbuka = periodeTerbuka === period ? null : period;
  refreshImportTab();
}

export async function refreshImportTab() {
  try {
    const [{ periods }, { imports }] = await Promise.all([fetchPeriods(), fetchImports()]);
    STATE.saved = periods;

    $('imp-periods').innerHTML = periods.length ? periods.map((p) => {
      const daftar = checklistPeriode(p);
      const terbuka = periodeTerbuka === p.period;

      // Tiga keadaan, tiga tampilan. "tak-diketahui" TIDAK boleh terlihat sama dengan
      // "kosong": yang satu berarti diperiksa dan memang nihil, yang satu lagi berarti
      // database konsumen tidak tersedia sehingga tidak bisa diperiksa sama sekali.
      const cip = daftar.map((j) => {
        const gaya = {
          ada: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          kosong: 'bg-slate-50 text-slate-400 border-slate-200',
          'tak-diketahui': 'bg-amber-50 text-amber-700 border-amber-200',
        }[j.status];
        const ikon = { ada: 'ph-check-circle', kosong: 'ph-minus-circle', 'tak-diketahui': 'ph-question' }[j.status];
        return `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold ${gaya}" ` +
          `title="${esc(j.status === 'tak-diketahui' ? 'Database konsumen tidak tersedia — tidak bisa diperiksa' : `${j.jumlah} baris`)}">` +
          `<i class="ph-fill ${ikon}"></i>${esc(j.label)}</span>`;
      }).join('');

      const rincian = terbuka
        ? `<div class="mt-2 pt-2 border-t border-slate-200/70">` +
          daftar.map((j) => {
            // Tombol hapus HANYA muncul untuk jenis yang memang ada datanya, dan
            // hanya untuk jenis yang bisa dihapus per bulan. Tombol yang selalu
            // tampil lalu menolak waktu ditekan cuma melatih orang mengabaikannya.
            const bisaHapus = j.status === 'ada' && (j.kunci === 'ktp' || j.kunci === 'servis');
            return `<div class="flex items-baseline gap-2 text-[11px] py-0.5">` +
              `<span class="text-slate-500 flex-1">${esc(j.label)}</span>` +
              `<span class="mono ${j.status === 'ada' ? 'text-slate-700' : 'text-slate-400'}">${
                j.jumlah === null ? 'tidak bisa diperiksa' : esc(formatNumber(j.jumlah))}</span>` +
              (bisaHapus
                ? `<button onclick="hapusSumber('${esc(j.kunci)}','${esc(p.period)}')" ` +
                  `title="Hapus ${esc(j.label)} bulan ini" ` +
                  `class="text-slate-300 hover:text-red-600"><i class="ph ph-trash"></i></button>`
                : '<span class="w-3"></span>') +
              `</div>`;
          }).join('') +
          `<div class="text-[10px] text-slate-400 mt-1">Impor terakhir: ${
            esc(p.importedAt ? String(p.importedAt).slice(0, 10) : '—')}</div>` +
          `<div class="text-[11px] text-slate-500 mt-1">${esc(formatNumber(p.units))} unit · ` +
          `${esc(formatNumber(p.villages))} kelurahan · ${esc(formatNumber(p.outlets))} pos</div>` +
          `<div class="flex items-center gap-3 mt-2">` +
          `<button onclick="reimportPeriod('${esc(p.period)}')" class="text-[11px] font-bold text-slate-500 hover:text-slate-800">` +
          `<i class="ph ph-arrow-clockwise"></i> impor ulang</button>` +
          // Didorong ke ujung kanan dan dibiarkan abu-abu sampai disentuh. Dia
          // bersebelahan dengan tombol impor ulang, dan yang satu ini membuang sebulan
          // data. Yang benar-benar menjaga bukan warnanya, tapi kewajiban mengetik
          // ulang periodenya di dialog.
          `<button onclick="askDeletePeriod('${esc(p.period)}')" class="ml-auto text-[11px] font-semibold text-slate-400 hover:text-red-600">` +
          `<i class="ph ph-trash"></i> hapus</button></div></div>`
        : '';

      return `<div class="bg-white border border-slate-200 rounded-xl px-3 py-2.5">` +
        `<button onclick="togglePeriodeDetail('${esc(p.period)}')" class="w-full text-left">` +
        `<div class="flex items-center gap-2">` +
        `<i class="ph-fill ${terbuka ? 'ph-caret-down' : 'ph-caret-right'} text-slate-400"></i>` +
        `<span class="text-sm font-bold text-slate-800">${esc(monthLabel(p.period))}</span>` +
        `<span class="ml-auto text-[10px] mono text-slate-400">${esc(p.period)}</span></div>` +
        `<div class="flex flex-wrap gap-1 mt-1.5">${cip}</div>` +
        `<div class="text-[10px] text-slate-400 mt-1">${esc(ringkasChecklist(daftar))}</div>` +
        `</button>${rincian}</div>`;
    }).join('')
      : '<p class="text-xs text-slate-400">Belum ada data. Impor berkas pertama di panel tengah.</p>';

    $('imp-history').innerHTML = imports.length ? imports.slice(0, 8).map((h) =>
      `<div class="flex items-center gap-2 px-2 py-1.5 text-[11px] border-b border-slate-50 last:border-0">` +
      `<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:${h.result === 'ok' ? '#10b981' : '#e2231a'}"></span>` +
      `<span class="text-slate-600 truncate flex-1">${esc(h.fileName || '—')}</span>` +
      `<span class="mono text-slate-400">${esc(h.period || '')}</span>` +
      `<span class="text-slate-400">${esc(String(h.startedAt || '').slice(0, 10))}</span></div>`).join('')
      : '<p class="text-[11px] text-slate-400 px-2">Belum ada riwayat.</p>';

    importPeriodChanged();
  } catch (error) {
    $('imp-periods').innerHTML =
      `<p class="text-xs text-red-600">${esc(error.message)}</p>`;
  }
}

export function reimportPeriod(period) {
  const [year, month] = period.split('-');
  $('imp-tahun').value = year;
  $('imp-bulan').value = month;
  importPeriodChanged();
  setStep(2);
}

/* ==========================================================================
   HAPUS SATU BULAN
   ==========================================================================
   Untuk bulan yang salah diimpor: berkas keliru, periode salah pilih, atau data uji
   yang ikut masuk. Impor ulang sudah menimpa periode yang sama, jadi ini bukan untuk
   memperbaiki isi — ini untuk membuang bulan yang memang tidak seharusnya ada.

   Konfirmasinya mengetik ulang periodenya, dan itu memang merepotkan dengan sengaja.
   Tombolnya bersebelahan dengan "impor ulang bulan ini" di kartu yang sama, dan yang
   satu ini membuang belasan ribu baris. Dialog ya/tidak terlalu mudah ditekan refleks.

   Server memeriksa hal yang sama sekali lagi. Penjaga yang cuma di sini bisa dilewati
   satu permintaan langsung ke API.
   ========================================================================== */

/** Periode yang sedang ditanyakan. Berubah hanya lewat askDeletePeriod(). */
let periodToDelete = null;

export function askDeletePeriod(period) {
  periodToDelete = period;
  const p = STATE.saved.find((x) => x.period === period) || {};

  $('hp-judul').textContent = `Hapus ${monthLabel(period)}?`;
  // Akibatnya disebutkan dengan angka SEBELUM ditekan, bukan sesudah. "Hapus bulan ini"
  // tidak memberi tahu apa pun; "18.915 unit di 3.326 kelurahan" memberi tahu.
  $('hp-rincian').textContent =
    `${formatNumber(p.units || 0)} unit · ${formatNumber(p.villages || 0)} kelurahan · ` +
    `${formatNumber(p.outlets || 0)} pos akan hilang dari seluruh dashboard.`;
  $('hp-target').textContent = period;
  $('hp-ketik').value = '';
  $('hp-pesan').textContent = '';
  $('hp-hapus').disabled = true;
  $('modal-hapus-periode').classList.remove('hidden');
  $('hp-ketik').focus();
}

export function closeDeletePeriod() {
  $('modal-hapus-periode').classList.add('hidden');
  periodToDelete = null;
}

/** Tombol hapus baru hidup kalau yang diketik sama persis. */
export function deletePeriodTyped() {
  $('hp-hapus').disabled = $('hp-ketik').value.trim() !== periodToDelete;
}

export async function confirmDeletePeriod() {
  if (!periodToDelete || $('hp-ketik').value.trim() !== periodToDelete) return;

  const tombol = $('hp-hapus');
  tombol.disabled = true;
  tombol.textContent = 'Menghapus...';
  try {
    const hasil = await deletePeriod(periodToDelete);
    closeDeletePeriod();
    toast(`${monthLabel(hasil.period)} dihapus — ${formatNumber(hasil.units)} unit` +
      (hasil.customers ? `, ${formatNumber(hasil.customers)} data konsumen` : '') +
      '. Berkas Excel-nya masih ada di arsip.', 'ok');
    // Sebulan data hilang mengubah KPI, peta, treemap, dan daftar periode sekaligus.
    // Mengambil ulang semuanya lebih jujur daripada menambal sebagian.
    await window.reloadSummary();
    await refreshImportTab();
  } catch (error) {
    $('hp-pesan').textContent = error.message;
    $('hp-pesan').className = 'text-xs text-red-600 mb-3';
    tombol.disabled = false;
  } finally {
    tombol.textContent = 'Hapus permanen';
  }
}

/** Isi dropdown bulan dan tahun. Dipanggil sekali saat halaman dimuat. */
export function setupImportTab() {
  const now = new Date();
  const years = [];
  for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 3; y--) years.push(String(y));

  $('imp-bulan').innerHTML = MONTHS.map((name, i) =>
    `<option value="${String(i + 1).padStart(2, '0')}">${esc(name)}</option>`).join('');
  $('imp-tahun').innerHTML = years.map((y) =>
    `<option value="${esc(y)}">${esc(y)}</option>`).join('');

  $('imp-bulan').value = String(now.getMonth() + 1).padStart(2, '0');
  $('imp-tahun').value = String(now.getFullYear());
}
