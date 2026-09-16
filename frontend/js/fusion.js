/**
 * Halaman penyatuan tiga sumber (docs/FUSION.md Tahap 3).
 *
 * Tiga halaman dilayani berkas ini:
 *   #tab-servis   daftar Lokasi Service   (sub-halaman menu Data)
 *   #tab-kirim    daftar Lokasi Delivery  (sub-halaman menu Data)
 *   #tab-fusion   ATLAS Confidence Fusion Dashboard
 *
 * KEADAAN SEKARANG: kerangka yang jujur. Angka golongan, KPI, dan peringkat sudah
 * diambil sungguhan dari `/api/v1/*` dan digambar; panel Venn, donut, matriks, dan
 * peta multi-layer BELUM — itu potongan berikutnya. Yang belum ada ditulis apa adanya
 * di layar sebagai "belum dibuat", bukan dibiarkan kosong: panel kosong tanpa
 * keterangan terbaca sebagai aplikasi rusak, dan orang akan melaporkannya sebagai bug.
 *
 * Kedua daftar sumber (servis/kirim) belum punya endpoint daftarnya sendiri — yang ada
 * baru drill-down per nomor mesin — jadi keduanya menjelaskan apa yang akan tampil dan
 * dari mana datangnya, tanpa berpura-pura punya data.
 */
import { fetchMatriks, fetchPeringkat, fetchSegmentation } from './api.js';
import { $, esc, formatNumber } from './dom.js';
import { SEGMENTS } from './fusion-segments.js';

/** Satu-satunya tempat status diterjemahkan jadi warna, biar konsisten antar panel. */
const WARNA_STATUS = {
  solid: 'text-emerald-600', sedang: 'text-amber-600', rapuh: 'text-red-600',
  sehat: 'text-emerald-600', waspada: 'text-amber-600', berisiko: 'text-red-600',
};

function kartuKpi(label, angka, sub, warna) {
  return `<div class="bg-white rounded-xl border border-slate-200 p-3 flex-1 min-w-0">` +
    `<div class="text-[10px] uppercase font-bold text-slate-400 tracking-wide truncate">${esc(label)}</div>` +
    `<div class="text-xl font-extrabold text-slate-800 mono leading-tight mt-0.5">${esc(angka)}</div>` +
    `<div class="text-[10px] font-bold ${warna || 'text-slate-400'} truncate">${esc(sub)}</div></div>`;
}

/** Baris satu golongan: swatch warna, nama, jumlah. */
function barisGolongan(kode, jumlah) {
  const s = SEGMENTS[kode];
  if (!s) return '';
  return `<div class="flex items-center gap-2 py-0.5">` +
    `<span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background:${esc(s.color)}"></span>` +
    `<span class="text-[11px] text-slate-600 truncate flex-1" title="${esc(s.label)}">${esc(s.short)}</span>` +
    `<span class="text-[11px] font-bold mono text-slate-800">${esc(formatNumber(jumlah || 0))}</span></div>`;
}

/** '#3B82F6' + alpha -> 'rgba(59,130,246,0.42)'. Untuk kepekatan sel heatmap. */
function rgba(hex, alpha) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha.toFixed(2)})`;
}

/**
 * Donut proporsi golongan.
 *
 * Digambar dengan stroke-dasharray pada lingkaran, BUKAN path busur: satu lingkaran
 * per golongan, panjang garisnya sepanjang porsinya. Tidak ada trigonometri yang bisa
 * salah tanda, dan tidak perlu pustaka — ApexCharts sudah ada di proyek ini tapi
 * memuat satu instance chart untuk enam angka statis jauh lebih mahal daripada enam
 * elemen SVG.
 *
 * Warna diambil dari daftar golongan yang sama dengan sidebar, donut, dan matriks —
 * satu sumber, supaya hijau di satu panel berarti hal yang sama di panel lain.
 */
function donut(counts, total) {
  if (!total) return '';
  const R = 42;
  const KELILING = 2 * Math.PI * R;
  let mulai = 0;

  const cincin = Object.keys(SEGMENTS).map((kode) => {
    const n = counts[kode] || 0;
    if (!n) return '';
    const panjang = (n / total) * KELILING;
    const el = `<circle cx="52" cy="52" r="${R}" fill="none" stroke="${esc(SEGMENTS[kode].color)}" ` +
      `stroke-width="15" stroke-dasharray="${panjang.toFixed(2)} ${(KELILING - panjang).toFixed(2)}" ` +
      `stroke-dashoffset="${(-mulai).toFixed(2)}" transform="rotate(-90 52 52)">` +
      `<title>${esc(SEGMENTS[kode].short)}: ${esc(formatNumber(n))}</title></circle>`;
    mulai += panjang;
    return el;
  }).join('');

  // Gaya ditulis inline, bukan kelas Tailwind: kelas seperti `fill-slate-800` cuma
  // ada di hasil build kalau kebetulan dipakai di tempat lain, dan lupa menjalankan
  // `npm run css` akan membuat angkanya tidak terlihat tanpa error apa pun.
  return `<svg viewBox="0 0 104 104" width="104" height="104" class="mx-auto mt-2 block">` +
    cincin +
    `<text x="52" y="50" text-anchor="middle" style="fill:#1e293b;font-size:15px;font-weight:800">` +
    `${esc(formatNumber(total))}</text>` +
    `<text x="52" y="63" text-anchor="middle" style="fill:#94a3b8;font-size:7.5px">pelanggan</text>` +
    `</svg>`;
}

/**
 * Matriks Kota x Golongan — heatmap ringkas.
 *
 * Kolomnya titik warna, bukan teks: enam nama golongan yang ditulis penuh memakan
 * seluruh lebar panel dan menyisakan ruang nol untuk angkanya. Nama lengkapnya ada di
 * `title` tiap kolom dan di daftar sidebar yang warnanya sama.
 *
 * Kepekatan sel dihitung terhadap nilai TERBESAR seluruh tabel (dikirim server), jadi
 * satu kota besar tidak membuat seluruh baris lain tampak kosong seperti kalau
 * dinormalkan per baris.
 */
function matriks(data) {
  if (!data || !data.rows || !data.rows.length) {
    return '<p class="text-xs text-slate-400 py-4 text-center">Belum ada data.</p>';
  }
  const kolom = (data.segments || Object.keys(SEGMENTS)).filter((k) => SEGMENTS[k]);
  const maksimum = Number(data.max) || 0;

  const kepala = kolom.map((k) =>
    `<th class="px-1 py-1" title="${esc(SEGMENTS[k].label)}">` +
    `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;` +
    `background:${esc(SEGMENTS[k].color)}"></span></th>`).join('');

  const baris = data.rows.map((r) => {
    const sel = kolom.map((k) => {
      const n = (r.counts || {})[k] || 0;
      const pekat = maksimum ? Math.min(n / maksimum, 1) : 0;
      const latar = n ? `background:${rgba(SEGMENTS[k].color, 0.10 + pekat * 0.55)}` : '';
      return `<td class="px-1 py-0.5 text-center mono text-[10px] text-slate-700" style="${latar}">` +
        `${n ? esc(formatNumber(n)) : ''}</td>`;
    }).join('');

    const warna = WARNA_STATUS[r.status] || 'text-slate-400';
    const cr = r.confidenceRatio == null ? '—' : `${(r.confidenceRatio * 100).toFixed(0)}%`;
    return `<tr class="border-b border-slate-50">` +
      `<td class="px-1 py-0.5 text-[10px] text-slate-700 truncate" style="max-width:130px" ` +
      `title="${esc(r.cityName || r.cityCode || '')}">${esc(r.cityName || r.cityCode || '—')}</td>` +
      sel +
      `<td class="px-1 text-right text-[10px] font-bold mono ${warna}">${esc(cr)}</td></tr>`;
  }).join('');

  return `<div class="overflow-y-auto" style="max-height:230px">` +
    `<table class="w-full border-collapse"><thead class="sticky top-0 bg-white">` +
    `<tr><th class="px-1 py-1 text-left text-[9px] font-bold text-slate-400 uppercase">Kota</th>` +
    kepala +
    `<th class="px-1 py-1 text-right text-[9px] font-bold text-slate-400 uppercase">%</th></tr>` +
    `</thead><tbody>${baris}</tbody></table></div>`;
}

function panelBelum(judul, keterangan) {
  return `<div class="bg-white rounded-xl border border-slate-200 p-3 flex-1 min-w-0">` +
    `<div class="text-[11px] font-bold text-slate-500 uppercase tracking-wide">${esc(judul)}</div>` +
    `<p class="text-[11px] text-slate-400 mt-2 leading-snug">${esc(keterangan)}</p></div>`;
}

/**
 * Daftar peringkat kota/dealer: nama, total, dan Confidence Ratio berwarna.
 *
 * `denganKota` menempelkan kota di belakang nama dealer ("Nama Dealer · Nama Kota",
 * docs/FUSION.md 3.3). Kota itu adalah asal pembeli TERBANYAK dealer tersebut, bukan
 * kota dealernya — kota dealer tidak ada di skema. Persentasenya ikut ditulis kalau
 * dominasinya di bawah 60%, karena "· Bantul" untuk dealer yang cuma 45% pembelinya
 * dari Bantul terbaca sebagai fakta padahal cuma mayoritas tipis.
 *
 * Persentase itu DISEMBUNYIKAN waktu filter kota sedang aktif: pada keadaan itu
 * nilainya selalu 100% karena barisnya memang sudah disaring ke kota itu saja.
 */
function daftarPeringkat(rows, kunciNama, opsi) {
  if (!rows || !rows.length) {
    return '<p class="text-xs text-slate-400 py-4 text-center">Belum ada data.</p>';
  }
  const denganKota = Boolean(opsi && opsi.denganKota);
  const kotaDisaring = Boolean(opsi && opsi.kotaDisaring);

  return rows.slice(0, 25).map((r) => {
    const total = Number(r.total) || 0;
    const rasio = total ? Number(r.cwSales) / total : null;
    const persen = rasio == null ? '—' : `${(rasio * 100).toFixed(0)}%`;
    const warna = rasio == null ? 'text-slate-400'
      : (rasio >= 0.65 ? 'text-emerald-600' : (rasio < 0.50 ? 'text-red-600' : 'text-amber-600'));

    const bagian = Number(r.citySharePct);
    const kota = (denganKota && r.cityName)
      ? `<span class="text-slate-400"> · ${esc(r.cityName)}${
        (!kotaDisaring && Number.isFinite(bagian) && bagian < 60) ? ` ${esc(String(bagian))}%` : ''
      }</span>`
      : '';

    return `<div class="flex items-center gap-2 py-1 border-b border-slate-50 last:border-0">` +
      `<span class="text-[11px] text-slate-700 truncate flex-1">${
        esc(r[kunciNama] || r.cityCode || r.dealerCode || '—')}${kota}</span>` +
      `<span class="text-[11px] mono text-slate-500">${esc(formatNumber(total))}</span>` +
      `<span class="text-[11px] font-bold mono ${warna} w-10 text-right">${esc(persen)}</span></div>`;
  }).join('');
}

/**
 * Dashboard Confidence Fusion.
 *
 * Dipanggil `switchTab('fusion')` dan tiap kali bilah filter berubah (lihat REPAINT di
 * filter-bar.js). Async: angkanya datang dari server, bukan dari `S` yang sudah ada di
 * memori — `segment_rollup` tidak ikut payload `/api/summary` dan memang tidak boleh,
 * karena halaman lain tidak membutuhkannya.
 */
export async function renderFusion() {
  const wadah = $('fusion-isi');
  if (!wadah) return;

  wadah.innerHTML = '<p class="text-sm text-slate-400 p-6 text-center">Memuat angka golongan…</p>';

  let hasil;
  let peringkat;
  let matrix;
  try {
    [hasil, peringkat, matrix] = await Promise.all([
      fetchSegmentation({}), fetchPeringkat({}), fetchMatriks({}),
    ]);
  } catch (error) {
    wadah.innerHTML = `<div class="p-6 text-center"><p class="text-sm text-red-600">${
      esc(error.message)}</p></div>`;
    return;
  }

  const meta = hasil.meta || {};
  const counts = meta.counts || {};
  const total = Number(meta.total) || 0;

  // Belum ada data sama sekali = keadaan yang WAJAR sampai Data KTP diimpor, bukan
  // error. Yang ditampilkan karena itu langkah berikutnya, bukan pesan gagal.
  if (!total) {
    wadah.innerHTML = `<div class="bg-white rounded-xl border border-slate-200 p-6 text-center">` +
      `<div class="text-sm font-bold text-slate-700">Belum ada hasil penggolongan</div>` +
      `<p class="text-xs text-slate-500 mt-2 leading-relaxed max-w-lg mx-auto">` +
      `Golongan Warlok dihitung dari Data KTP, Data Servis, dan Data Pengiriman yang ` +
      `disatukan lewat Nomor Mesin. Impor Data KTP dulu lewat rute ` +
      `<span class="mono">/api/v1/import/ktp</span> — begitu masuk, penggolongan jalan ` +
      `otomatis dan halaman ini terisi sendiri.</p></div>`;
    return;
  }

  const rasio = meta.confidenceRatio;
  const warnaRasio = WARNA_STATUS[meta.status] || 'text-slate-400';

  wadah.innerHTML =
    `<div class="flex gap-2 mb-2">` +
      kartuKpi('Pelanggan terfilter', formatNumber(total), `periode ${hasil.period || '—'}`, 'text-blue-500') +
      kartuKpi('CW Sales', formatNumber(Math.round(Number(meta.cwSales) || 0)), 'terkoreksi keyakinan', 'text-purple-500') +
      kartuKpi('Confidence Ratio', rasio == null ? '—' : `${(rasio * 100).toFixed(1)}%`,
        meta.status || 'belum ada data', warnaRasio) +
    `</div>` +
    `<div class="flex gap-2 items-start">` +
      `<div class="bg-white rounded-xl border border-slate-200 p-3 w-52 shrink-0">` +
        `<div class="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Golongan final</div>` +
        Object.keys(SEGMENTS).map((k) => barisGolongan(k, counts[k])).join('') +
        donut(counts, total) +
        `<div class="text-[10px] text-slate-400 mt-2 pt-2 border-t border-slate-100">` +
        `KPI Jarak: ${esc(String(meta.kpiJarakKm ?? '—'))} km</div>` +
      `</div>` +
      `<div class="bg-white rounded-xl border border-slate-200 p-3 flex-1 min-w-0">` +
        `<div class="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Peringkat kota</div>` +
        daftarPeringkat(peringkat.cities, 'cityName') +
      `</div>` +
      `<div class="bg-white rounded-xl border border-slate-200 p-3 flex-1 min-w-0">` +
        `<div class="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Peringkat dealer</div>` +
        daftarPeringkat(peringkat.dealers, 'dealerName', { denganKota: true }) +
      `</div>` +
    `</div>` +
    `<div class="flex gap-2 mt-2">` +
      panelBelum('Tampilan peta',
        'Sebaran titik KTP, Servis, dan Pengiriman memakai peta yang sama dengan ' +
        'halaman Insight & Peta. Belum dibuat.') +
      panelBelum('Irisan sumber data (Venn)',
        'Irisan KTP / Servis / Kirim berikut yang di luar irisan. Belum dibuat: ' +
        'wilayah Migran perlu dipecah menurut sumber mana yang dimiliki, dan angka ' +
        'itu belum ada di ringkasan — butuh satu tambahan kecil di pipeline.') +
    `</div>` +
    `<div class="bg-white rounded-xl border border-slate-200 p-3 mt-2">` +
      `<div class="flex items-baseline gap-2 mb-1">` +
        `<span class="text-[11px] font-bold text-slate-500 uppercase tracking-wide">` +
        `Matriks Kota &times; Golongan</span>` +
        `<span class="text-[10px] text-slate-400">${
          esc(String((matrix && matrix.rows ? matrix.rows.length : 0)))} kota</span>` +
      `</div>` +
      matriks(matrix) +
    `</div>`;
}

/** Daftar Lokasi Service — sub-halaman menu Data. */
export function renderServiceTable() {
  const wadah = $('servis-isi');
  if (!wadah) return;
  wadah.innerHTML = panelBelum('Lokasi Service',
    'Halaman ini akan menampilkan baris Data Servis (Nomor Mesin, No Rangka, Jenis ' +
    'Service, dan wilayahnya) dari database konsumen. Datanya sudah bisa diimpor ' +
    'lewat /api/v1/import/servis; daftar per barisnya belum dibuat.');
}

/** Daftar Lokasi Delivery — sub-halaman menu Data. */
export function renderDeliveryTable() {
  const wadah = $('kirim-isi');
  if (!wadah) return;
  wadah.innerHTML = panelBelum('berdasarkan Lokasi Delivery',
    'Halaman ini akan menampilkan ping pengiriman (waktu, Nomor Mesin, koordinat GPS, ' +
    'akurasi, dan bukti foto). Rute penerimanya sudah ada di /api/v1/pengiriman/ping; ' +
    'daftar per barisnya belum dibuat.');
}
