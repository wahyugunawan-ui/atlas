/**
 * Tab Import Data.
 *
 * SATU berkas masuk per bulan sejak 2026-09-20: Data KTP. Sebelumnya ada dua alur —
 * wizard empat tahap untuk berkas PENJUALAN, plus alur terpisah untuk Data KTP/Servis
 * — padahal template KTP memuat semua kolom yang dibutuhkan penjualan (kelurahan,
 * kecamatan, kode kota, kode pos) DITAMBAH nomor mesin. Wizard penjualan dipensiunkan
 * dan angka penjualan sekarang diturunkan dari impor Data KTP (lihat
 * backend/server/source-import.js dan docs/DECISIONS.md).
 *
 * Urutannya tetap disengaja: periode dipilih SEBELUM berkas diunggah. Kalau
 * sebaliknya, berkas yang salah bulan sudah terlanjur terkirim sebelum ada yang
 * menyadarinya.
 */
import {
  deletePeriod, deleteSumberPeriode, fetchImports, fetchPeriods, fetchUnmatched,
  uploadSumber,
} from './api.js';
import { MONTHS } from './config.js';
import { $, esc, formatNumber, monthLabel, toast } from './dom.js';
// Checklist jenis data per periode. Logikanya di modul murni supaya bisa diuji tanpa
// browser — khususnya pembedaan "kosong" vs "tidak bisa diperiksa".
import { checklistPeriode, ringkasChecklist, ringkasHasilSumber } from './import-periods.js';

const STATE = {
  saved: [],
  result: null,
};

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
  // Blok Data KTP/Servis memakai periode yang SAMA, tapi pemilihnya ada di tahap 1
  // yang tersembunyi begitu wizard berpindah. Bulannya ditulis di blok itu supaya
  // tidak ada yang mengunggah ke bulan yang tidak sedang dia lihat.
  if ($('impx-periode')) {
    $('impx-periode').textContent = period ? monthLabel(period) : '—';
  }
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
            // Impor ulang TIDAK menuntut datanya sudah ada — beda dari hapus. Bulan yang
            // Data Servisnya belum pernah masuk justru yang paling butuh tombol ini;
            // menyembunyikannya di situ berarti satu-satunya jalan masuk hilang persis
            // pada keadaan yang memerlukannya.
            const bisaImpor = j.kunci === 'ktp' || j.kunci === 'servis';
            return `<div class="flex items-baseline gap-2 text-[11px] py-0.5">` +
              `<span class="text-slate-500 flex-1">${esc(j.label)}</span>` +
              `<span class="mono ${j.status === 'ada' ? 'text-slate-700' : 'text-slate-400'}">${
                j.jumlah === null ? 'tidak bisa diperiksa' : esc(formatNumber(j.jumlah))}</span>` +
              (bisaImpor
                ? `<button onclick="reimportSumber('${esc(j.kunci)}','${esc(p.period)}')" ` +
                  `title="${j.status === 'ada' ? 'Impor ulang' : 'Impor'} ${esc(j.label)} bulan ini" ` +
                  `class="text-slate-300 hover:text-slate-700"><i class="ph ph-arrow-clockwise"></i></button>`
                : '<span class="w-3"></span>') +
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

/**
 * "Impor ulang bulan ini" dari panel Periode Tersimpan.
 *
 * Sampai 2026-09-20 ini menyetel bulan lalu menggiring orang ke tahap 2 wizard
 * PENJUALAN. Wizard itu sudah tidak ada, dan Data KTP-lah yang sekarang mengisi angka
 * penjualan — jadi diteruskan ke sana, bukan dibiarkan menunjuk tahap yang hilang.
 */
export function reimportPeriod(period) {
  reimportSumber('ktp', period);
}

/**
 * Impor ulang SATU jenis data (Data KTP / Data Servis) untuk satu periode.
 *
 * Sampai 2026-09-17 hapus sudah bisa per jenis (hapusSumber) tapi impor ulang TIDAK:
 * reimportPeriod() cuma menyetel bulan lalu menggiring orang ke wizard PENJUALAN.
 * Akibatnya "perbaiki Data Servis bulan ini saja" tidak punya jalan sama sekali —
 * satu-satunya cara adalah menghapusnya dulu lalu mencari sendiri panel unggahnya.
 *
 * Periodenya disetel lebih dulu KARENA pilihSumber() menolak kalau bulannya belum
 * dipilih. Urutan ini bukan kebetulan: memanggil pemilih berkas duluan akan memunculkan
 * toast "pilih bulan dulu" untuk bulan yang jelas-jelas sudah ditunjuk orangnya.
 *
 * Impornya sendiri idempoten (hapus baris periode itu, tulis ulang), jadi ini memang
 * "impor ulang" dan bukan "impor kedua" — tidak ada baris yang berlipat.
 */
export function reimportSumber(source, period) {
  const [year, month] = String(period).split('-');
  $('imp-tahun').value = year;
  $('imp-bulan').value = month;
  importPeriodChanged();

  // Digulir ke panel prosesnya supaya jelas apa yang barusan terjadi; tanpa ini dialog
  // berkas muncul di atas halaman yang masih memperlihatkan daftar periode.
  const sasaran = $('imp-bagian-proses');
  if (sasaran) sasaran.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Masih di dalam penanganan klik, jadi membuka pemilih berkas di sini sah — browser
  // menolak dialog berkas yang tidak lahir dari gerakan orang.
  pilihSumber(source);
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
