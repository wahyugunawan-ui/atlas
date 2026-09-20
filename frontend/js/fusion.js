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
import {
  fetchCakupanSumber, fetchEngineDetail, fetchIrisan, fetchMatriks, fetchPeringkat,
  fetchPengiriman, fetchSegmentation, fetchServis, fetchVillageCustomers,
} from './api.js';
import {
  formatJarak, jangkauanDiagram, kalimatAlasan, titikRelatif,
} from './fusion-alasan.js';
// map.js TIDAK mengimpor fusion.js, jadi arah impor ini tidak membuat lingkaran.
import {
  fitToScope, gambarTelusurDiPeta, hapusTelusurDiPeta, refreshMapVisual,
} from './map.js';
import { $, displayCityName, esc, formatNumber, formatPercent, labelKota } from './dom.js';
import { ALLOWED_CITY_CODES, KARESIDENAN } from './config.js';
import { fusionFilter, kotaBerikutnya, pageFilters, persenSumber, setScope } from './filters.js';
import { S } from './state.js';
// CATATAN: `syncFilterBar` SENGAJA dipanggil lewat `window`, bukan di-import.
//
// Meng-import filter-bar.js dari sini menariknya beserta combobox.js, dan
// combobox.js memanggil `document.addEventListener` saat modul dimuat. Akibatnya
// fusion.js tidak lagi bisa di-import di Node — dan itu langsung mematahkan
// test/fusion-cakupan.test.js yang memang menguji modul ini dengan `document`
// tiruan seadanya. Sudah kejadian; ini perbaikannya.
//
// Pola window ini bukan karangan baru: setScope() di filters.js memanggil
// window.syncHeatmapModeButtons dan window.syncGroupControls dengan alasan yang
// sama persis, dan blok HANDLERS di app.js menandai keduanya "dipanggil antar
// modul lewat window supaya tidak ada lingkaran import".
import { SEGMENTS, SUMBER } from './fusion-segments.js';

/** Satu-satunya tempat status diterjemahkan jadi warna, biar konsisten antar panel. */
const WARNA_STATUS = {
  solid: 'text-emerald-600', sedang: 'text-amber-600', rapuh: 'text-red-600',
  sehat: 'text-emerald-600', waspada: 'text-amber-600', berisiko: 'text-red-600',
};

/**
 * Kartu KPI angka.
 *
 * DIRAMPINGKAN 2026-09-18 (`p-3`→`p-2`, `text-xl`→`text-lg`, `mt-0.5` dibuang): pita
 * KPI cuma 2 dari 12 baris grid dan memuat 2x2 kartu, jadi tiap kartu dapat ±67 px.
 * Ukuran lama butuh ±75 px — meluber, dan permintaannya eksplisit "tanpa scroll".
 * Angkanya tetap paling menonjol di kartu; yang hilang cuma kelegaan yang tidak ada
 * ruangnya.
 */
function kartuKpi(label, angka, sub, warna) {
  return `<div class="bg-white rounded-xl border border-slate-200 p-2 flex-1 min-w-0 overflow-hidden">` +
    `<div class="text-[10px] uppercase font-bold text-slate-400 tracking-wide truncate">${esc(label)}</div>` +
    `<div class="text-lg font-extrabold text-slate-800 mono leading-tight truncate" ` +
    `title="${esc(angka)}">${esc(angka)}</div>` +
    `<div class="text-[10px] font-bold ${warna || 'text-slate-400'} truncate" ` +
    `title="${esc(sub)}">${esc(sub)}</div></div>`;
}

/**
 * Kartu KPI ke-4: "Cakupan Sumber" — bukan ANGKA, tapi KALIMAT ("Karesidenan Kedu ·
 * Dealer X"), jadi kartuKpi() TIDAK dipakai apa adanya: kolomnya di sana `mono`,
 * cocok untuk "24.567" tapi salah untuk kalimat.
 *
 * `truncate` SATU BARIS, bukan `line-clamp-2` seperti versi pertama: tiap kartu di
 * pita 2x2 cuma dapat ±67 px, dan kalimat dua baris membuat kartu ini lebih tinggi
 * dari tiga tetangganya — persis ketidaksejajaran yang mau dihindari. Kalimat
 * penuhnya tetap terbaca lewat `title` saat di-hover.
 */
function kartuKpiTeks(label, teks, sub) {
  return `<div class="bg-white rounded-xl border border-slate-200 p-2 flex-1 min-w-0 flex flex-col overflow-hidden">` +
    `<div class="text-[10px] uppercase font-bold text-slate-400 tracking-wide truncate">${esc(label)}</div>` +
    `<div class="text-sm font-extrabold text-slate-800 leading-snug truncate" ` +
    `title="${esc(teks)}">${esc(teks)}</div>` +
    `<div class="text-[10px] font-bold text-slate-400 truncate mt-auto">${esc(sub)}</div></div>`;
}

/**
 * Keterangan singkat kartu "Cakupan Sumber": saringan APA yang sedang berlaku di
 * seluruh halaman ini.
 *
 * SENGAJA TIDAK memakai scopeLabel() (filters.js) apa adanya — fungsi itu ikut
 * menyebut Pos, dan Pos TIDAK berpengaruh di halaman Confidence Fusion (dihapus
 * 2026-09-18, lihat komentar fusionFilter()). Menyebutnya di sini akan membuat
 * orang mengira pos ikut menyaring padahal tidak — persis salah yang tidak
 * kelihatan salah, kelas cacat yang sudah berkali-kali muncul di proyek ini.
 */
function labelCakupanSumber() {
  const f = pageFilters('fusion');
  const bagian = [];
  if (f.kares !== 'ALL' && KARESIDENAN[f.kares]) bagian.push(KARESIDENAN[f.kares].label);
  if (f.cityCode !== 'ALL') {
    bagian.push(displayCityName(S.cityNames[f.cityCode] || f.cityCode));
  }
  if (f.dealerCode !== 'ALL') {
    bagian.push('Dealer ' + (S.dealerNames[f.dealerCode] || f.dealerCode));
  }
  return bagian.length ? bagian.join(' · ') : 'Semua sumber (tanpa saringan)';
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
 *
 * TIDAK memotong ATAU mengurutkan `data.rows` sendiri — keduanya sudah beres di
 * `gambarMatriks()` sebelum fungsi ini dipanggil (urutkanConfidence()), supaya logika
 * urut-dan-sorot satu tempat saja, dipakai bersama dengan daftarPeringkat() di bawah.
 *
 * @param {Set<string>|null} sorotKota  kode kota yang sedang disaring di halaman
 *   (lihat kotaSorotSet()) — barisnya diberi highlight, TIDAK disembunyikan yang
 *   lain. Permintaan tim: dulu server yang menyaring jadi cuma satu baris tersisa;
 *   sekarang server selalu mengirim SEMUA kota, dan penyaringannya jadi sorotan.
 */
function matriks(data, sorotKota) {
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
    const cr = r.confidenceRatio == null ? '—' : formatPercent(r.confidenceRatio * 100, 1);
    // Baris yang sedang disaring di bilah filter (kota/kares) disorot, BUKAN
    // disembunyikan — lihat komentar @param sorotKota di atas.
    const disorot = Boolean(sorotKota && r.cityCode && sorotKota.has(r.cityCode));
    // fx-sorot dipakai gambarMatriks() sesudah ini untuk auto-scroll ke baris pertama
    // yang cocok — bukan sekadar nama kelas gaya.
    const kelasBaris = 'border-b border-slate-50' + (disorot ? ' fx-sorot' : '');
    // Barisnya jadi kendali silang: klik = saring seluruh halaman ke kota itu.
    // Baris tanpa kode kota tidak bisa diklik sama sekali — tombol yang menerima klik
    // lalu tidak melakukan apa-apa cuma melatih orang berhenti mempercayainya.
    const klik = r.cityCode
      ? ` onclick="filterDariFusi('kota','${esc(r.cityCode)}')" title="Saring seluruh ` +
        `halaman ke kota ini" class="${kelasBaris} cursor-pointer hover:bg-blue-50"`
      : ` class="${kelasBaris}"`;
    // labelKota() DI SINI, bukan di server: baris ini juga dipakai klik-untuk-
    // menyaring (filterDariFusi memakai r.cityCode, bukan namanya), jadi kode kotanya
    // wajib apa adanya sementara cuma teks yang tampil di layar yang dipangkas. Kota
    // luar Jateng+DIY tidak punya nama di tabel wilayah dan dulu tampil sebagai kode
    // telanjang — sekarang "Luar cakupan (31.74)".
    const namaKota = labelKota(r.cityName, r.cityCode);
    // 96px, turun dari 130px: kolom nama kota dulu melebar sampai memaksa seluruh blok
    // ikut lebar, dan ruang itu diambil dari peta. Nama terpanjang di cakupan
    // ("Kota Yogyakarta", "Banjarnegara") masih muat; yang lebih panjang terpotong
    // rapi dan tetap terbaca penuh lewat title.
    return `<tr${klik}>` +
      `<td class="px-1 py-0.5 text-[10px] text-slate-700 truncate" style="max-width:96px" ` +
      `title="${esc(namaKota)}">${esc(namaKota)}</td>` +
      sel +
      `<td class="px-1 text-right text-[10px] font-bold mono ${warna}">${esc(cr)}</td></tr>`;
  }).join('');

  // TANPA pembungkus overflow-y-auto/max-height sendiri lagi (permintaan tim: "jangan
  // dibatasi"). #fx-matriks di index.html sudah punya overflow-y-auto — dua scrollbox
  // bersarang cuma membuat sebagian besar blok terasa terpotong padahal ruangnya ada.
  return `<table class="w-full border-collapse"><thead class="sticky top-0 bg-white">` +
    `<tr><th class="px-1 py-1 text-left text-[9px] font-bold text-slate-400 uppercase">Kota</th>` +
    kepala +
    `<th class="px-1 py-1 text-right text-[9px] font-bold text-slate-400 uppercase">%</th></tr>` +
    `</thead><tbody>${baris}</tbody></table>`;
}

/**
 * Diagram Venn irisan sumber data.
 *
 * GEOMETRINYA STATIS, angkanya saja yang berubah. Venn tiga himpunan yang luasnya
 * proporsional-akurat adalah masalah geometri yang jauh lebih mahal daripada nilainya
 * di sini — dan pembacanya toh membaca angkanya, bukan luasnya. Posisi tiap angka
 * dihitung sekali di bawah dan tidak pernah bergerak.
 *
 * Kotak garis putus-putus membungkus SELURUH diagram: yang di luar ketiga lingkaran
 * adalah "Tak Terverifikasi" — punya jejak, tapi tidak satu pun bisa dijadikan titik.
 *
 * DI-FIT ke blok pembungkusnya (permintaan tim: "tanpa scroll"), bukan lagi
 * `max-height` piksel tetap: `width`/`height` 100% + `preserveAspectRatio` (nilai
 * bawaan SVG, ditulis eksplisit di sini supaya jelas ini pilihan, bukan kelalaian)
 * membuat SVG menyusut/membesar mengisi kotak `#fx-venn` apa pun tingginya, tanpa
 * pernah terpotong atau memicu scrollbar.
 */
function venn(data) {
  const r = (data && data.regions) || {};
  const total = Number(data && data.total) || 0;
  if (!total) {
    return '<p class="text-xs text-slate-400 py-6 text-center">Belum ada data.</p>';
  }

  const A = SUMBER.kirim.color;
  const B = SUMBER.servis.color;
  const C = SUMBER.ktp.color;
  const angka = (x, y, n, warna, besar) => (n
    ? `<text x="${x}" y="${y}" text-anchor="middle" style="fill:${warna};font-size:${
      besar ? 13 : 10}px;font-weight:800">${esc(formatNumber(n))}</text>`
    : '');

  return `<svg viewBox="0 0 300 208" width="100%" height="100%" ` +
    `preserveAspectRatio="xMidYMid meet" class="block">` +
    `<rect x="6" y="6" width="288" height="196" rx="8" fill="none" ` +
    `stroke="${esc(SEGMENTS.unverified.color)}" stroke-width="1.5" stroke-dasharray="5 4"/>` +
    `<text x="14" y="22" style="fill:${esc(SEGMENTS.unverified.color)};font-size:8px;` +
    `font-weight:800">TAK TERVERIFIKASI</text>` +

    `<circle cx="112" cy="88" r="56" fill="${esc(A)}" fill-opacity="0.10" stroke="${esc(A)}" stroke-width="1.2"/>` +
    `<circle cx="188" cy="88" r="56" fill="${esc(B)}" fill-opacity="0.10" stroke="${esc(B)}" stroke-width="1.2"/>` +
    `<circle cx="150" cy="134" r="56" fill="${esc(C)}" fill-opacity="0.10" stroke="${esc(C)}" stroke-width="1.2"/>` +

    `<text x="74" y="40" style="fill:${esc(A)};font-size:8px;font-weight:800">A · KIRIM</text>` +
    `<text x="196" y="40" style="fill:${esc(B)};font-size:8px;font-weight:800">B · SERVIS</text>` +
    `<text x="128" y="196" style="fill:${esc(C)};font-size:8px;font-weight:800">C · KTP</text>` +

    angka(86, 74, r.a_saja, A) +
    angka(214, 74, r.b_saja, B) +
    angka(150, 62, r.a_b, '#64748b') +
    angka(112, 124, r.a_c, SEGMENTS.delivery_near.color) +
    angka(188, 124, r.b_c, SEGMENTS.service_near.color) +
    angka(150, 166, r.c_saja, SEGMENTS.registered_only.color) +
    `<circle cx="150" cy="104" r="17" fill="${esc(SEGMENTS.loyal_verified.color)}"/>` +
    (r.a_b_c
      ? `<text x="150" y="108" text-anchor="middle" style="fill:#fff;font-size:11px;` +
        `font-weight:800">${esc(formatNumber(r.a_b_c))}</text>` : '') +
    angka(40, 190, r.luar, SEGMENTS.unverified.color, true) +
    `</svg>`;
}

/**
 * Panel Cakupan Sumber: berapa persen pelanggan tiap kota/dealer yang punya tiap
 * sumber data.
 *
 * C · KTP SENGAJA tidak digambar sebagai bar. Tiap pelanggan yang sampai ke panel ini
 * menurut definisi punya baris KTP — itu syarat masuk penggolongan sama sekali — jadi
 * barnya akan 100% di setiap baris tanpa kecuali. Bar yang selalu penuh tidak
 * membedakan apa pun; yang membedakan cuma dua sumber sisanya.
 *
 * Judulnya memakai `groupBy` dari server, bukan tebakan sendiri, supaya judul panel
 * tidak pernah bisa berbeda dari isi daftarnya.
 */
/**
 * Sumber mana yang sedang dicentang di panel Cakupan Sumber, dan teks pencariannya.
 *
 * KTP MENYALA secara bawaan sejak 2026-09-17 (permintaan tim). Barnya memang akan
 * 100% di setiap baris — tiap pelanggan yang sampai ke panel ini menurut definisi
 * punya KTP — jadi ia tidak membedakan antar baris. Yang tetap diberitahukan:
 * keterangan "selalu 100%" muncul di bawah daftar supaya pembaca tahu bar penuh itu
 * sifat data, bukan prestasi. Sempat mati secara bawaan atas pertimbangan saya
 * sendiri; tim memutuskan sebaliknya.
 */
const sumberAktif = { ktp: true, servis: true, kirim: true };
let cariCakupanTeks = '';

/**
 * Jawaban Cakupan Sumber yang terakhir diterima.
 *
 * Disimpan supaya mencentang checkbox atau mengetik di kotak cari TIDAK menembak lima
 * permintaan baru ke server — yang berubah cuma cara menggambarnya, bukan datanya.
 */
let cakupanTerakhir = null;

/** Gambar ulang HANYA daftar Cakupan Sumber, dari data yang sudah ada di tangan. */
function gambarCakupan() {
  const kotak = $('cakupan-isi');
  if (kotak) kotak.innerHTML = cakupanSumber(cakupanTerakhir);
}

/**
 * Nyalakan/matikan satu sumber.
 *
 * Kendalinya SENGAJA di luar bagian yang digambar ulang. Kalau kotak cari ikut
 * dibangun ulang tiap ketikan, fokus dan posisi kursornya hilang tiap huruf.
 */
export function toggleSumberCakupan(kunci) {
  if (!(kunci in sumberAktif)) return;
  sumberAktif[kunci] = !sumberAktif[kunci];
  gambarCakupan();
}

/** Saring daftar per nama. Penyaringannya lokal, jadi tidak perlu ditunda. */
export function cariCakupan() {
  cariCakupanTeks = ($('cs-cari') ? $('cs-cari').value : '').trim().toLowerCase();
  gambarCakupan();
}

/* ==========================================================================
   TELUSUR SATU NOMOR MESIN — PANEL PII (docs/FUSION.md 3.4)
   ==========================================================================
   Menampilkan nama dan alamat konsumen. Servernya yang menegakkan pagarnya
   (piiLimiter + logCustomerAccess); layar ini tidak menyimpan apa pun ke mana
   pun, dan isinya dibuang begitu panelnya ditutup.
   ========================================================================== */

/**
 * Diagram skematik posisi tiga titik terhadap lingkaran KPI Jarak.
 *
 * MENYIMPANG DARI SPESIFIKASI, disengaja: 3.4 meminta "peta mini". Peta sungguhan
 * berarti instance MapLibre kedua di dalam panel — komponen berat yang tidak bisa
 * saya verifikasi di browser. Yang digambar di sini menjawab pertanyaan yang sama
 * ("jaraknya di dalam atau di luar ambang?") tanpa satu pun ubin peta: KTP di pusat,
 * lingkaran putus-putus = ambang, garis penghubung ke tiap titik.
 *
 * Tanpa ubin peta, ARAH tidak bisa dibaca sebagai lokasi sebenarnya — dan itu ditulis
 * di bawah gambarnya, bukan dibiarkan ditebak.
 */
function diagramTelusur(f) {
  const titik = titikRelatif(f);
  const ambang = Number(f.kpiRadiusM) || 0;
  if (!ambang) return '';

  const jangkauan = jangkauanDiagram(f, titik);
  const skala = 66 / jangkauan;                 // 66 px = setengah lebar gambar
  const rAmbang = ambang * skala;

  const garis = titik.map((t) => {
    const x = t.x * skala;
    const y = -t.y * skala;                     // SVG: y tumbuh ke bawah, utara ke atas
    return `<line x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" ` +
        `stroke="${SUMBER[t.jenis].color}" stroke-width="1" stroke-opacity="0.6"></line>` +
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${
        SUMBER[t.jenis].color}"></circle>`;
  }).join('');

  return `<svg viewBox="-80 -80 160 160" class="w-full" style="max-height:170px">` +
    `<circle cx="0" cy="0" r="${rAmbang.toFixed(1)}" fill="#0b2f6b" fill-opacity="0.05" ` +
      `stroke="#0b2f6b" stroke-width="1" stroke-dasharray="3 2" stroke-opacity="0.7"></circle>` +
    garis +
    `<circle cx="0" cy="0" r="4" fill="${SUMBER.ktp.color}"></circle>` +
    `</svg>` +
    `<p class="text-[9px] text-slate-400 leading-snug">Skematik, bukan peta: lingkaran ` +
    `putus-putus = ambang KPI Jarak (${esc(formatJarak(ambang))}). Jarak dan arah ` +
    `relatif terhadap titik KTP; tanpa latar peta, arah tidak menunjukkan lokasi ` +
    `sebenarnya.</p>`;
}

/** Satu baris riwayat, dipakai daftar servis dan daftar ping. */
function barisRiwayat(kiri, kanan) {
  return `<div class="flex items-baseline gap-2 py-0.5 border-b border-slate-50 last:border-0">` +
    `<span class="text-[10px] text-slate-600 flex-1 truncate">${kiri}</span>` +
    `<span class="text-[9px] mono text-slate-400 shrink-0">${kanan}</span></div>`;
}

/** Isi panel telusur. Semua nilai dari Excel/PII — WAJIB lewat esc(). */
function isiTelusur(detail) {
  const f = detail.fusion || {};
  const ktp = detail.ktp || null;
  const services = detail.services || [];
  const pings = detail.pings || [];
  const { bagian, kesimpulan, golongan } = kalimatAlasan(f);

  const judul = `<div class="text-[10px] font-bold uppercase tracking-wide text-slate-400">` +
    `Telusur Nomor Mesin</div>` +
    `<div class="text-sm font-extrabold text-slate-900 mono pr-6">${esc(f.engineNo || '—')}</div>`;

  const identitas = ktp
    ? `<div class="mt-2 p-2 rounded-lg bg-slate-50">` +
        `<div class="text-[11px] font-bold text-slate-700">${esc(ktp.name || '—')}</div>` +
        `<div class="text-[10px] text-slate-500 leading-snug">${esc(ktp.address || '—')}</div>` +
        `<div class="text-[9px] text-slate-400 mt-1">${esc(ktp.villageText || '—')} · ` +
        `${esc(ktp.districtText || '—')} · status cocok: ${esc(ktp.resolveStatus || '—')}</div>` +
      `</div>`
    : `<p class="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg ` +
      `p-2 mt-2">Baris KTP-nya tidak ada, jadi nama dan alamat tidak bisa ditampilkan.</p>`;

  const alasan = `<div class="mt-3">` +
    `<div class="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Alasan golongan</div>` +
    bagian.map((b) => `<p class="text-[11px] text-slate-600 leading-snug">${esc(b)}</p>`).join('') +
    `<div class="mt-1 text-[12px] font-extrabold" style="color:${
      golongan ? golongan.color : '#64748b'}">→ ${esc(kesimpulan)}</div></div>`;

  const daftarServis = services.length
    ? services.map((s) => barisRiwayat(
      `${esc(s.villageText || '—')}, ${esc(s.districtText || '—')}` +
      (s.serviceType ? ` · ${esc(s.serviceType)}` : ''),
      `${esc(s.period || '—')} · ${esc(s.resolveStatus || '—')}`)).join('')
    : '<p class="text-[10px] text-slate-400">Tidak ada kunjungan servis.</p>';

  const daftarPing = pings.length
    ? pings.map((p) => barisRiwayat(
      esc(p.locationText || p.courierName || 'Ping pengiriman'),
      // Potong DULU, escape belakangan. Urutan terbalik (escape lalu potong) bisa
      // memenggal entity di tengah — "&amp;" jadi "&am" — dan itu merusak markup,
      // bukan sekadar memotong teks.
      `${esc(String(p.sentAt || '—').slice(0, 16))}${
        p.accuracyM == null ? '' : ` · ±${esc(String(Math.round(Number(p.accuracyM))))} m`}`)).join('')
    : '<p class="text-[10px] text-slate-400">Belum ada ping pengiriman.</p>';

  return judul + identitas + alasan +
    `<div class="mt-3">${diagramTelusur(f)}</div>` +
    `<div class="mt-3"><div class="text-[10px] font-bold uppercase tracking-wide ` +
      `text-slate-400 mb-1">Riwayat servis (${esc(String(services.length))})</div>` +
      daftarServis + `</div>` +
    `<div class="mt-3"><div class="text-[10px] font-bold uppercase tracking-wide ` +
      `text-slate-400 mb-1">Riwayat pengiriman (${esc(String(pings.length))})</div>` +
      daftarPing + `</div>` +
    `<p class="text-[9px] text-slate-400 mt-3 pt-2 border-t border-slate-100">Data ` +
      `pribadi. Tiap pembukaan halaman ini tercatat di log akses server.</p>`;
}

/**
 * Kantong titik peta yang sedang dibuka, supaya tombol "kembali ke daftar" tahu harus
 * kembali ke mana tanpa meminta ulang ke server.
 *
 * Disimpan sebagai argumen, bukan hasilnya: barisnya PII, dan menyimpannya di variabel
 * modul berarti nama-nama itu menggantung di memori halaman sampai tab ditutup. Yang
 * disimpan cuma pertanyaannya — jawabannya diambil lagi, dan pengambilan ulang itu
 * tercatat di access_log seperti seharusnya.
 */
let kantongTitikTerakhir = null;

/** Satu baris pelanggan di daftar kantong titik. Semua nilai dari PII — WAJIB esc(). */
function barisPelangganKantong(r) {
  const golongan = SEGMENTS[r.segment];
  const jejak = [];
  if (Number(r.serviceCount) > 0) jejak.push(`${Number(r.serviceCount)}x servis`);
  if (Number(r.deliveryCount) > 0) jejak.push(`${Number(r.deliveryCount)}x kirim`);

  return `<button type="button" onclick="bukaTelusurMesinDari('${esc(r.engineNo)}')" ` +
    `class="w-full text-left p-2 rounded-lg hover:bg-blue-50 border-b border-slate-100">` +
    `<div class="flex items-baseline gap-2">` +
      `<span class="text-[11px] font-bold text-slate-700 truncate flex-1">${
        esc(r.name || 'Nama tidak ada di data KTP')}</span>` +
      `<span class="text-[9px] font-bold shrink-0" style="color:${
        golongan ? golongan.color : '#64748b'}">${
        esc(golongan ? golongan.short : r.segment || '—')}</span>` +
    `</div>` +
    `<div class="text-[10px] text-slate-400 mono truncate">${esc(r.engineNo)}${
      jejak.length ? ` · ${esc(jejak.join(' · '))}` : ''}</div>` +
    `</button>`;
}

/**
 * Isi panel untuk SATU kantong titik peta: daftar orang di kelurahan+dealer itu.
 *
 * Bukan satu orang, karena satu titik memang bukan satu orang — posisinya disebar ACAK
 * di dalam kelurahan (fusion-points.js). Menampilkan satu nama di koordinat acak akan
 * dibaca sebagai alamat rumah sungguhan, dan itu salah yang berbahaya, bukan sekadar
 * tidak akurat. Yang jujur: "di kelurahan ini, dealer ini, ada orang-orang berikut".
 */
function isiDaftarKantong(kantong, rows) {
  const desa = S.villageByCode[kantong.village];
  const namaDesa = desa ? desa.name : (kantong.village || '—');
  const namaKota = desa ? displayCityName(desa.cityName) : '';
  const namaDealer = S.dealerNames[kantong.dealer] || kantong.dealer || 'dealer tidak dikenal';

  const kepala = `<div class="text-[10px] font-bold uppercase tracking-wide text-slate-400">` +
      `${esc(LABEL_TITIK_PANEL[kantong.jenis] || 'Titik peta')}</div>` +
    `<div class="text-sm font-extrabold text-slate-900 pr-6">${esc(namaDesa)}${
      namaKota ? `, ${esc(namaKota)}` : ''}</div>` +
    `<div class="text-[11px] text-slate-500">${esc(namaDealer)}</div>`;

  if (!rows.length) {
    return kepala + `<p class="text-[11px] text-slate-400 mt-3">Tidak ada pelanggan yang ` +
      `cocok di kantong ini.</p>`;
  }

  // Batas 200 dari server. Kalau kena, katakan — daftar yang diam-diam terpotong
  // membuat orang menghitung dari layar dan mendapat angka yang salah.
  const terpotong = rows.length >= 200
    ? `<p class="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg ` +
      `p-2 mt-2">Ditampilkan 200 teratas. Kantong ini punya lebih banyak.</p>`
    : '';

  return kepala +
    `<p class="text-[10px] text-slate-400 mt-1">${esc(String(rows.length))} pelanggan · ` +
      `klik satu baris untuk rinciannya</p>` + terpotong +
    `<div class="mt-2">${rows.map(barisPelangganKantong).join('')}</div>` +
    `<p class="text-[9px] text-slate-400 mt-3 pt-2 border-t border-slate-100">Data ` +
      `pribadi. Tiap pembukaan daftar ini tercatat di log akses server.</p>`;
}

/** Nama jenis titik untuk kepala panel. Sengaja terpisah dari legenda Opsi Peta. */
const LABEL_TITIK_PANEL = {
  ktp: 'Titik KTP', servis: 'Titik Servis', kirim: 'Titik Pengiriman',
};

/**
 * Buka daftar pelanggan di balik satu titik peta.
 *
 * Dipanggil map.js saat titik DIKLIK atau kursor berhenti 3 detik di atasnya — dua
 * perbuatan yang disengaja. TIDAK boleh dipanggil dari mousemove biasa: tiap panggilan
 * menembus pagar PII (dibatasi 30/menit) dan meninggalkan baris di access_log.
 */
export async function bukaDaftarTitik(jenis, village, dealer) {
  const panel = $('telusur-panel');
  const isi = $('telusur-isi');
  if (!panel || !isi || !village) return;

  kantongTitikTerakhir = { jenis, village, dealer };
  panel.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.remove('translate-x-full'));
  isi.innerHTML = '<p class="text-xs text-slate-400 p-4 text-center">Mengambil data…</p>';

  try {
    const periode = fusionFilter(pageFilters('peta')).periode;
    const jawab = await fetchVillageCustomers(village, { dealer, periode });
    isi.innerHTML = isiDaftarKantong(kantongTitikTerakhir, jawab.rows || []);
  } catch (error) {
    // 404 (database PII tidak ada) dan 429 (terlalu sering) artinya sangat berbeda,
    // dan pesan servernya sudah membedakannya — jadi itu yang ditampilkan.
    isi.innerHTML = `<p class="text-xs text-red-600 p-4 text-center">${esc(error.message)}</p>`;
  }
}

/**
 * Buka rincian satu mesin DARI daftar kantong, bukan dari kotak ketik.
 *
 * Tampilannya persis sama dengan hasil Telusur Nomor Mesin — fungsi isiTelusur() yang
 * sama — ditambah satu tautan kembali ke daftar asalnya, supaya orang tidak terjebak
 * di satu orang dan harus mengklik ulang titiknya di peta.
 */
export async function bukaTelusurMesinDari(nomor) {
  const panel = $('telusur-panel');
  const isi = $('telusur-isi');
  if (!panel || !isi || !nomor) return;

  panel.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.remove('translate-x-full'));
  isi.innerHTML = '<p class="text-xs text-slate-400 p-4 text-center">Mencari…</p>';

  const kembali = kantongTitikTerakhir
    ? `<button type="button" onclick="kembaliKeDaftarTitik()" class="text-[10px] ` +
      `font-bold text-blue-600 hover:underline mb-2">&larr; Kembali ke daftar titik</button>`
    : '';

  try {
    const detail = await fetchEngineDetail(nomor);
    isi.innerHTML = kembali + isiTelusur(detail);
    gambarTelusurDiPeta(detail);
  } catch (error) {
    isi.innerHTML = kembali +
      `<p class="text-xs text-red-600 p-4 text-center">${esc(error.message)}</p>`;
    hapusTelusurDiPeta();
  }
}

/** Kembali ke daftar kantong yang tadi dibuka. Datanya diminta ulang, bukan disimpan. */
export function kembaliKeDaftarTitik() {
  if (!kantongTitikTerakhir) return;
  const { jenis, village, dealer } = kantongTitikTerakhir;
  hapusTelusurDiPeta();
  bukaDaftarTitik(jenis, village, dealer);
}

/** Buka panel telusur untuk nomor mesin yang diketik. */
export async function bukaTelusurMesin() {
  const kotak = $('telusur-mesin');
  const panel = $('telusur-panel');
  const isi = $('telusur-isi');
  if (!kotak || !panel || !isi) return;

  const nomor = kotak.value.trim();
  if (!nomor) return;

  panel.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.remove('translate-x-full'));
  isi.innerHTML = '<p class="text-xs text-slate-400 p-4 text-center">Mencari…</p>';

  try {
    const detail = await fetchEngineDetail(nomor);
    isi.innerHTML = isiTelusur(detail);
    // Sekalian di PETA SUNGGUHAN. Sejak halaman ini punya blok peta, panel dan peta
    // ada di layar yang sama — jadi alasan penggolongannya bisa dilihat langsung:
    // titik servis di dalam lingkaran ambang berarti "berdekatan", kasatmata.
    gambarTelusurDiPeta(detail);
  } catch (error) {
    // 404 dan 429 punya arti yang sangat berbeda, dan pesan servernya sudah
    // membedakannya — jadi yang ditampilkan pesan itu, bukan "terjadi kesalahan".
    isi.innerHTML = `<p class="text-xs text-red-600 p-4 text-center">${
      esc(error.message)}</p>`;
    // Jejak mesin SEBELUMNYA harus hilang. Kalau tidak, peta masih menunjukkan
    // mesin lama sementara panelnya bilang pencarian gagal — dua pesan yang
    // bertentangan di layar yang sama.
    hapusTelusurDiPeta();
  }
}

/** Tutup panel, dan KOSONGKAN isinya — PII tidak ditinggal menggantung di DOM. */
export function tutupTelusurMesin() {
  const panel = $('telusur-panel');
  if (!panel) return;
  // Peta dibersihkan SEGERA, bukan menunggu animasi panel selesai — titik dan
  // lingkaran yang tertinggal sesudah panelnya tertutup tidak lagi punya penjelasan
  // apa pun di layar.
  hapusTelusurDiPeta();
  panel.classList.add('translate-x-full');
  setTimeout(() => {
    panel.classList.add('hidden');
    if ($('telusur-isi')) $('telusur-isi').innerHTML = '';
  }, 300);
}

/** Baris kendali panel: tiga checkbox + kotak cari. Di LUAR `#cakupan-isi`. */
function kendaliCakupan() {
  const kotakCentang = Object.keys(SUMBER).map((k) =>
    `<label class="flex items-center gap-1 text-[10px] text-slate-600 cursor-pointer">` +
      `<input type="checkbox" id="cs-${esc(k)}"${sumberAktif[k] ? ' checked' : ''} ` +
      `onchange="toggleSumberCakupan('${esc(k)}')" class="w-3 h-3">` +
      `<span class="inline-block w-2 h-2 rounded-full" style="background:${
        SUMBER[k].color}"></span>${esc(SUMBER[k].label)}</label>`).join('');

  return `<div class="flex items-center gap-2 flex-wrap mb-1">${kotakCentang}` +
    `<input id="cs-cari" oninput="cariCakupan()" type="text" placeholder="Cari…" ` +
    `value="${esc(cariCakupanTeks)}" ` +
    `class="ml-auto px-2 py-0.5 rounded-lg border border-slate-200 text-[10px] w-24"></div>`;
}

/**
 * DIEKSPOR khusus untuk tes (`test/fusion-cakupan.test.js`).
 *
 * Fungsinya murni — data masuk, teks HTML keluar, tidak menyentuh DOM sama sekali —
 * jadi ia bisa diuji apa adanya. Yang dijaga tesnya adalah keputusan yang TIDAK
 * kelihatan salah di layar: sumber yang tidak dicentang tetap tergambar, pencarian
 * yang diam-diam tidak menyaring, atau daftar yang terpotong tanpa memberi tahu.
 */
export function cakupanSumber(data) {
  const rows = (data && data.rows) || [];
  const total = Number(data && data.total) || 0;
  if (!rows.length || !total) {
    return '<p class="text-xs text-slate-400 py-4 text-center">Belum ada data.</p>';
  }

  const sumber = (data && data.sumber) || {};
  // Dipadatkan 2026-09-20: bar 7px->5px dan jarak antar bar dihapus. Tiap baris
  // memuat tiga bar, jadi tinggi yang dihemat di sini berlipat tiga.
  const bar = (kunci, nilai, pembagi) => {
    const p = persenSumber(nilai, pembagi);
    return `<div class="flex items-center gap-1.5">` +
      `<span class="text-[9px] text-slate-400 w-12 shrink-0">${esc(SUMBER[kunci].label)}</span>` +
      `<div class="h-[5px] rounded-sm bg-slate-100 overflow-hidden flex-1">` +
        `<div class="h-full rounded-sm" style="width:${p || 0}%;background:${
          SUMBER[kunci].color}"></div></div>` +
      `<span class="text-[9px] mono text-slate-500 w-14 text-right">${
        esc(formatNumber(Number(nilai) || 0))} · ${p == null ? '—' : `${p}%`}</span></div>`;
  };

  const perDealer = Boolean(data && data.groupBy === 'dealer');

  /**
   * Nama baris waktu servernya tidak menemukan namanya.
   *
   * Diukur pada data Agustus 2026: dari 57 kota, 20 tidak punya nama — 3 memakai
   * sentinel '' (kota tidak diketahui) dan 17 sisanya kode BPS di LUAR cakupan proyek
   * (31.75 Jakarta, 32.xx Jawa Barat, 35.xx Jawa Timur, bahkan 12.75 Sumatera Utara).
   * Itu pembeli dari luar DIY/Jateng, bukan kesalahan data. Tapi menulis "31.75" begitu
   * saja ke orang non-IT tidak memberi tahu apa pun, jadi kodenya tetap ditulis
   * DIDAMPINGI keterangannya.
   */
  const namaBaris = (r) => {
    // displayCityName() tidak mengubah apa pun kalau grouping-nya per DEALER — nama
    // dealer tidak pernah berawalan "Kabupaten", jadi pemanggilannya di sini aman
    // untuk kedua mode tanpa cabang if terpisah.
    if (r.name) return perDealer ? r.name : displayCityName(r.name);
    if (perDealer) return r.code ? `Dealer ${r.code}` : 'Dealer tidak dikenal';
    if (r.code === '' || !r.code) return 'Kota tidak diketahui';
    return `Luar cakupan (${r.code})`;
  };

  // Semua checkbox dilepas: daftarnya akan jadi deretan nama tanpa satu pun bar, dan
  // itu terbaca seperti data yang hilang. Dikatakan apa yang terjadi, bukan dibiarkan.
  const aktif = Object.keys(SUMBER).filter((k) => sumberAktif[k]);
  if (!aktif.length) {
    return '<p class="text-[11px] text-slate-400 py-4 text-center">Centang minimal satu ' +
      'sumber untuk melihat cakupannya.</p>';
  }

  const cocok = cariCakupanTeks
    ? rows.filter((r) => namaBaris(r).toLowerCase().includes(cariCakupanTeks))
    : rows;

  if (!cocok.length) {
    return `<p class="text-[11px] text-slate-400 py-4 text-center">Tidak ada yang cocok ` +
      `dengan “${esc(cariCakupanTeks)}”.</p>`;
  }

  // Batas 25 DIBUANG (permintaan tim: tampilkan semuanya). Dengan 49 kota panelnya
  // memang masih bisa digulir, tapi yang tidak tampil sekarang cuma yang ada di bawah
  // lipatan — bukan yang diam-diam dipotong dan tidak pernah bisa dilihat.
  const daftar = cocok.map((r) => {
    const n = Number(r.total) || 0;
    // city_code '' = kota yang tidak diketahui (source_overlap memakainya sebagai
    // sentinel, kolomnya NOT NULL). Dikatakan apa adanya, bukan dibuang diam-diam.
    const nama = namaBaris(r);
    // KTP memakai totalnya sendiri: tiap baris di sini menurut definisi punya KTP,
    // jadi nilainya = pembaginya, dan barnya selalu penuh.
    const nilai = { ktp: n, servis: r.servis, kirim: r.kirim };
    return `<div class="py-0.5 border-b border-slate-50 last:border-0">` +
      `<div class="flex items-center gap-2">` +
        `<span class="text-[11px] text-slate-700 truncate flex-1">${esc(nama)}</span>` +
        `<span class="text-[11px] mono text-slate-500">${esc(formatNumber(n))}</span>` +
      `</div>` + aktif.map((k) => bar(k, nilai[k], n)).join('') + `</div>`;
  }).join('');

  // Dulu di sini ada "Menampilkan 25 teratas dari N". Batasnya dibuang 2026-09-20
  // (permintaan tim), jadi pesannya ikut hilang — keterangan pemotongan yang muncul
  // di daftar yang TIDAK dipotong lebih menyesatkan daripada tidak ada keterangan
  // sama sekali. Jumlah barisnya sendiri tetap disebut di kepala panel.
  const sisa = '';

  // Kirim kosong sama sekali itu keadaan yang BENAR sekarang (belum ada produsen ping),
  // bukan cacat gambar. Deretan bar kosong di tiap baris akan terbaca sebagai "dealer
  // ini tidak pernah mengirim" kalau tidak dikatakan. Hanya relevan kalau barnya
  // memang sedang ditampilkan.
  const catatan = (sumberAktif.kirim && !Number(sumber.kirim))
    ? `<p class="text-[10px] text-slate-400 mt-2 leading-snug">Bar <b>${
      esc(SUMBER.kirim.label)}</b> kosong di semua baris karena belum ada satu pun data ` +
      `pengiriman yang masuk — bukan karena pengirimannya nol.</p>`
    : '';

  const catatanKtp = sumberAktif.ktp
    ? `<p class="text-[10px] text-slate-400 mt-2 leading-snug">Bar <b>${
      esc(SUMBER.ktp.label)}</b> selalu 100%: tiap pelanggan di panel ini menurut ` +
      `definisi punya data KTP — itu syarat masuk penggolongan.</p>`
    : '';

  return daftar + sisa + catatan + catatanKtp;
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
 *
 * TIDAK dipotong 25 lagi sejak permintaan tim mengubah blok Peringkat Kota dan
 * Peringkat Dealer dari "tampilkan satu, sembunyikan sisanya" jadi "tampilkan
 * semua, sorot yang cocok" (lihat @param sorotKota/sorotDealer). Memotongnya akan
 * membuat baris yang seharusnya disorot kadang tidak pernah ikut tergambar sama
 * sekali kalau posisinya jatuh di luar 25 teratas — persis kebalikan dari tujuan
 * fitur ini.
 *
 * @param {Set<string>|null} [opsi.sorotKota]  kode kota yang sedang disaring
 * @param {string|null} [opsi.sorotDealer]  kode dealer (turunan nama) yang disaring
 */
function daftarPeringkat(rows, kunciNama, opsi) {
  if (!rows || !rows.length) {
    return '<p class="text-xs text-slate-400 py-4 text-center">Belum ada data.</p>';
  }
  const denganKota = Boolean(opsi && opsi.denganKota);
  const kotaDisaring = Boolean(opsi && opsi.kotaDisaring);
  const sorotKota = (opsi && opsi.sorotKota) || null;
  const sorotDealer = (opsi && opsi.sorotDealer) || null;

  return rows.map((r) => {
    const total = Number(r.total) || 0;
    const rasio = total ? Number(r.cwSales) / total : null;
    // formatPercent(n, 1) dari dom.js: satu angka di belakang koma dan pemisah koma
    // (locale id-ID) — permintaan tim 2026-09-20, dan dipakai ulang supaya format
    // persen di halaman ini tidak jadi salinan kedua dari yang sudah ada.
    const persen = rasio == null ? '—' : formatPercent(rasio * 100, 1);
    const warna = rasio == null ? 'text-slate-400'
      : (rasio >= 0.65 ? 'text-emerald-600' : (rasio < 0.50 ? 'text-red-600' : 'text-amber-600'));

    const bagian = Number(r.citySharePct);
    const kota = (denganKota && r.cityName)
      ? `<span class="text-slate-400"> · ${esc(displayCityName(r.cityName))}${
        (!kotaDisaring && Number.isFinite(bagian) && bagian < 60) ? ` ${esc(String(bagian))}%` : ''
      }</span>`
      : '';

    // Barisnya jadi kendali silang: klik = saring seluruh halaman ke kota/dealer itu.
    //
    // Untuk dealer dipakai dealerFilterCode (kode turunan nama), BUKAN dealerCode yang
    // numerik — bilah filter cuma mengenal yang pertama. Baris tanpa kode yang bisa
    // dipakai tidak menerima klik sama sekali: lebih baik tidak bisa diklik daripada
    // bisa diklik lalu mengosongkan halaman tanpa sebab yang terlihat.
    const jenisKlik = opsi && opsi.jenis;
    const kodeKlik = jenisKlik === 'dealer' ? (r.dealerFilterCode || '') : (r.cityCode || '');
    // Baris yang sedang disaring di bilah filter disorot, BUKAN disembunyikan — lihat
    // JSDoc di atas fungsi ini. fx-sorot dipakai gambarMatriks() untuk auto-scroll.
    const disorot = sorotKota ? Boolean(r.cityCode && sorotKota.has(r.cityCode))
      : sorotDealer ? r.dealerFilterCode === sorotDealer : false;
    const KELAS_BARIS = 'flex items-center gap-2 py-1 border-b border-slate-50 last:border-0' +
      (disorot ? ' fx-sorot' : '');
    const klik = (jenisKlik && kodeKlik)
      ? ` onclick="filterDariFusi('${esc(jenisKlik)}','${esc(kodeKlik)}')" ` +
        `title="Saring seluruh halaman ke ${jenisKlik === 'dealer' ? 'dealer' : 'kota'} ini" ` +
        `class="${KELAS_BARIS} cursor-pointer hover:bg-blue-50"`
      : ` class="${KELAS_BARIS}"`;

    // "Kabupaten " dipangkas HANYA saat kolom namanya memang nama kota (mode Peringkat
    // Kota, kunciNama === 'cityName'). Mode dealer memakai kolom yang sama untuk
    // dealerName; menerapkan labelKota ke situ akan SALAH — dealer tanpa nama bukan
    // "luar cakupan", jadi cabangnya dijaga eksplisit, bukan kebetulan.
    const namaUtama = kunciNama === 'cityName'
      ? labelKota(r[kunciNama], r.cityCode)
      : r[kunciNama];
    // Jumlah pelanggan DIBUANG di mode dealer (permintaan tim 2026-09-20): blok
    // Peringkat Dealer cukup menjawab "dealer mana yang datanya paling rapuh", dan
    // angka jumlah di sebelahnya cuma bersaing dengan CR untuk perhatian. Mode kota
    // tetap menampilkannya — di sana jumlahnya yang memberi arti pada peringkatnya.
    const kolomJumlah = jenisKlik === 'dealer' ? ''
      : `<span class="text-[11px] mono text-slate-500">${esc(formatNumber(total))}</span>`;
    return `<div${klik}>` +
      `<span class="text-[11px] text-slate-700 truncate flex-1">${
        esc(namaUtama || r.cityCode || r.dealerCode || '—')}${kota}</span>` +
      kolomJumlah +
      `<span class="text-[11px] font-bold mono ${warna} w-14 text-right">${esc(persen)}</span></div>`;
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
/**
 * Katakan saringan mana yang TIDAK terpakai di halaman ini.
 *
 * Tinggal karesidenan: petanya cuma hidup di frontend (`config.js`), server tidak
 * mengenalnya. Kota, Dealer, dan Pos semuanya dipahami sejak 2026-09-17. Tanpa catatan
 * ini, memilih karesidenan memberi angka se-provinsi sementara dropdownnya menunjuk
 * satu karesidenan — salah yang tidak kelihatan salah.
 */
function catatanAbaikan(f) {
  if (!f.abaikan.length) return '';
  const pesan = {
    rentang: 'Rentang periode diciutkan ke bulan terakhir — penggolongan dihitung ' +
      'per satu bulan, dan menjumlahkan dua bulan akan menghitung satu pelanggan ' +
      'dua kali.',
  };
  return f.abaikan.map((k) =>
    `<div class="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 ` +
    `text-[11px] text-amber-800">${esc(pesan[k] || k)}</div>`).join('');
}

/* ==========================================================================
   MODE LIVE / WALLBOARD (docs/FUSION.md 3.5)
   ==========================================================================
   Filter Kota berpindah sendiri tiap ~3,5 detik, termasuk kembali ke "Semua".
   Dealer ikut direset tiap perpindahan — itu didapat GRATIS dari aturan
   eksklusivitas di setScope(), bukan ditulis ulang di sini.

   BEDA dari dua mode live yang sudah ada (Performa dan Wilayah): keduanya cuma
   menggulir piksel tiap 40 ms tanpa menyentuh jaringan. Yang ini memindahkan
   filter, dan tiap perpindahan menembak LIMA permintaan ke server — karena itu
   ada penjaga `sibukLive` di bawah.
   ========================================================================== */

const JEDA_LIVE_MS = 3500;

/** Putaran kota: "Semua" lalu tiap kota cakupan, berulang. */
const PUTARAN_LIVE = ['ALL', ...ALLOWED_CITY_CODES];

/** Benar selama satu langkah masih menunggu jawaban server. */
let sibukLive = false;

function syncTombolLive() {
  const tombol = $('fx-live');
  if (!tombol) return;
  tombol.classList.toggle('live-nyala', Boolean(S.liveFusion));
  const ikon = tombol.querySelector('i');
  if (ikon) ikon.className = S.liveFusion ? 'ph-fill ph-stop' : 'ph-fill ph-play';
}

/**
 * Satu langkah putaran.
 *
 * `force: true` WAJIB: tanpa itu setScope() bersifat toggle, dan menyetel kota yang
 * sama dua kali justru mematikannya — putarannya akan tersendat di 'ALL'.
 *
 * Ketukan dilewati kalau langkah sebelumnya belum dijawab server. Tanpa ini, server
 * yang lambat membuat permintaan menumpuk dan jawabannya bisa tiba tidak berurutan —
 * layar menampilkan kota yang BUKAN kota yang sedang ditunjuk dropdown.
 */
async function langkahLive() {
  if (sibukLive) return;
  sibukLive = true;
  try {
    const sekarang = pageFilters('fusion').cityCode;
    setScope('kota', kotaBerikutnya(sekarang, PUTARAN_LIVE), true);
    window.syncFilterBar();
    await renderFusion();
  } finally {
    sibukLive = false;
  }
}

/** Hentikan putaran TANPA menandai dijeda manusia — dipakai waktu keluar tab. */
export function hentikanLiveFusion() {
  if (!S.liveFusion) return;
  clearInterval(S.liveFusion);
  S.liveFusion = null;
  sibukLive = false;
  syncTombolLive();
}

/** Tombol LIVE — dipencet manusia, jadi jedanya ikut ditandai. */
export function toggleLiveFusion() {
  if (S.liveFusion) {
    hentikanLiveFusion();
    S.liveFusionPaused = true;
    return;
  }
  S.liveFusionPaused = false;
  S.liveFusion = setInterval(langkahLive, JEDA_LIVE_MS);
  syncTombolLive();
  langkahLive();          // langsung bergerak, tidak menunggu 3,5 detik pertama
}

/** Tulis ke satu slot grid. Kerangkanya sendiri tidak pernah disentuh. */
function isiSlot(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

/**
 * Golongan Final dan Venn PISAH jadi dua blok sendiri sejak 2026-09-18 (permintaan
 * tim) — sebelumnya satu sel bermode-dua seperti Matriks/Peringkat Kota di bawah.
 * Karena keduanya sekarang selalu tampil BERSAMAAN (tidak ada tombol mode lagi),
 * gambarGolongan()/setModeGolongan() diganti gambarGolonganFinal()+gambarVenn(),
 * dipanggil berdua dari renderFusion().
 */

/** Angka terakhir yang diterima, supaya kedua blok bisa digambar ulang tanpa
 * meminta apa pun lagi ke server (mis. waktu jendela di-resize). */
let fusiTerakhir = null;

/**
 * Gambar ulang blok Golongan Final: pie di KIRI, daftar golongan di KANAN
 * (permintaan tim — dulu ditumpuk atas-bawah dalam satu sel bermode).
 */
function gambarGolonganFinal() {
  if (!fusiTerakhir) return;
  const { counts, total, meta } = fusiTerakhir;
  const legenda = Object.keys(SEGMENTS).map((k) => barisGolongan(k, counts[k])).join('');
  isiSlot('fx-golongan-final',
    `<div class="shrink-0">${donut(counts, total)}</div>` +
    `<div class="flex-1 min-w-0 min-h-0 overflow-y-auto">` +
      legenda +
      `<div class="text-[10px] text-slate-400 mt-2 pt-2 border-t border-slate-100">` +
      `KPI Jarak: ${esc(String(meta.kpiJarakKm ?? '—'))} km</div>` +
    `</div>`);
}

/** Gambar ulang blok Venn — kini blok sendiri, bukan lagi mode dalam sel bersama. */
function gambarVenn() {
  if (!fusiTerakhir) return;
  isiSlot('fx-venn', venn(fusiTerakhir.irisan));
}

/**
 * Blok Matriks Kota x Golongan dan Peringkat Kota DISATUKAN jadi satu blok dua mode
 * (permintaan tim, tata letak 12x12). Bawaannya matriks.
 *
 * Polanya sengaja tidak diabstraksikan jadi satu fungsi bersama dengan blok Dealer
 * di bawah: keduanya beda bentuk data (satu punya dua mode, satu tidak) dan
 * menyatukannya berarti satu fungsi yang harus tahu keduanya. Sama alasannya
 * dengan flyout Master/Data di tables.js yang juga sengaja dibiarkan kembar.
 */
let modeMatriks = 'matriks';

/** Angka peringkat & matriks terakhir, supaya ganti mode ATAU ganti arah urutan
 * bisa menggambar ulang tanpa meminta apa pun lagi ke server. */
let peringkatTerakhir = null;
let matriksTerakhir = null;

/**
 * Saringan Kota/Kares/Dealer yang AKTIF saat data terakhir diminta — dipakai
 * menghitung baris mana yang harus disorot di blok Matriks/Peringkat Kota/Dealer.
 *
 * BUKAN filter yang dipakai fetchMatriks()/fetchPeringkat() itu sendiri: sejak
 * permintaan "tampilkan semua, sorot yang cocok" (2026-09-18), kedua fetch itu
 * SENGAJA hanya mengirim periode — lihat renderFusion(). Nilai ini dipakai
 * terpisah, murni untuk mencocokkan baris mana yang perlu disorot.
 */
let filterAktifTerakhir = null;

/**
 * Confidence Ratio satu baris, dari BENTUK APA PUN baris itu datang.
 *
 * Baris matriks membawa `confidenceRatio` siap pakai; baris peringkat kota/dealer
 * cuma membawa `cwSales`/`total` mentah (lihat daftarPeringkat()). Satu fungsi
 * dipakai untuk dua bentuk data itu, bukan dua rumus yang bisa diam-diam menyimpang.
 *
 * @returns {number|null} null = belum bisa dihitung (total nol / rasio tidak ada)
 */
export function confidenceRatioOf(r) {
  if (r.confidenceRatio != null) return Number(r.confidenceRatio);
  const total = Number(r.total) || 0;
  return total ? Number(r.cwSales) / total : null;
}

/**
 * Urutkan salinan `rows` berdasarkan Confidence Ratio. Bawaannya (dan default
 * halaman) ASCENDING — permintaan tim: yang paling perlu perhatian adalah baris
 * yang paling RAPUH, bukan yang paling meyakinkan.
 *
 * Baris yang confidence-nya TIDAK BISA dihitung (null) selalu jatuh ke UJUNG,
 * arah mana pun: "tidak diketahui" bukan "terendah" ataupun "tertinggi", jadi
 * tidak boleh ikut menempati posisi teratas cuma karena kebetulan sortnya ascending.
 *
 * @param {'asc'|'desc'} arah
 */
export function urutkanConfidence(rows, arah) {
  const list = (rows || []).slice();
  list.sort((a, b) => {
    const ra = confidenceRatioOf(a);
    const rb = confidenceRatioOf(b);
    if (ra == null && rb == null) return 0;
    if (ra == null) return 1;
    if (rb == null) return -1;
    return arah === 'desc' ? rb - ra : ra - rb;
  });
  return list;
}

/** Kode kota yang harus disorot di blok Matriks/Peringkat Kota, dari filter AKTIF
 * (bukan dari filter yang dikirim ke server — lihat filterAktifTerakhir di atas).
 * Kares diterjemahkan jadi daftar kota; Kota eksplisit menang kalau keduanya ada,
 * sama seperti fusionFilter() sendiri. null = tidak ada yang perlu disorot. */
export function kotaSorotSet(f) {
  if (!f) return null;
  if (f.kota) return new Set([f.kota]);
  if (f.kotaBanyak && f.kotaBanyak.length) return new Set(f.kotaBanyak);
  return null;
}

/** Teks tombol urutkan: panah mengikuti arah yang SEDANG berlaku, bukan yang akan
 * terjadi kalau ditekan — supaya tombolnya menjelaskan keadaan, bukan aksi. */
function perbaruiLabelSort(id, arah) {
  const tombol = $(id);
  if (tombol) tombol.textContent = arah === 'desc' ? 'CR ↓' : 'CR ↑';
}

/** Sorot baris pertama yang cocok (fx-sorot) ke dalam pandangan, di dalam wadah
 * `id` — auto-scroll TANPA menggulir halaman, cuma kotak gulir blok itu sendiri. */
function sorotDanGulir(id) {
  const wadah = $(id);
  const baris = wadah && wadah.querySelector('.fx-sorot');
  if (baris) baris.scrollIntoView({ block: 'nearest' });
}

/** Urutan Confidence Ratio blok Matriks/Peringkat Kota. Satu variabel untuk
 * KEDUA mode — mode dan urutan itu dua sumbu independen, bukan alasan untuk dua
 * tombol urutkan. */
let arahSortMatriks = 'asc';

/** Gambar ulang HANYA blok Matriks/Peringkat Kota. */
function gambarMatriks() {
  ['matriks', 'kota'].forEach((m) => {
    const tombol = $(`fx-mode-${m}`);
    if (tombol) tombol.classList.toggle('fx-mode-aktif', modeMatriks === m);
  });
  perbaruiLabelSort('fx-sort-matriks', arahSortMatriks);
  const sorotKota = kotaSorotSet(filterAktifTerakhir);

  if (modeMatriks === 'kota') {
    const kota = urutkanConfidence(
      (peringkatTerakhir && peringkatTerakhir.cities) || [], arahSortMatriks);
    isiSlot('fx-matriks', daftarPeringkat(kota, 'cityName', { jenis: 'kota', sorotKota }));
    isiSlot('fx-matriks-jumlah', `Peringkat kota · ${esc(String(kota.length))} kota`);
    sorotDanGulir('fx-matriks');
    return;
  }

  const rowsUrut = urutkanConfidence(
    (matriksTerakhir && matriksTerakhir.rows) || [], arahSortMatriks);
  isiSlot('fx-matriks',
    matriks(matriksTerakhir ? { ...matriksTerakhir, rows: rowsUrut } : matriksTerakhir, sorotKota));
  isiSlot('fx-matriks-jumlah', `Matriks Kota × Golongan · ${esc(String(rowsUrut.length))} kota`);
  sorotDanGulir('fx-matriks');
}

/** Ganti tampilan blok antara Matriks Kota x Golongan dan Peringkat Kota. */
export function setModeMatriks(mode) {
  modeMatriks = mode === 'kota' ? 'kota' : 'matriks';
  gambarMatriks();
}

/** Balik arah urutan Confidence Ratio blok Matriks/Peringkat Kota — TANPA meminta
 * apa pun ke server, datanya sudah di tangan (matriksTerakhir/peringkatTerakhir). */
export function toggleSortMatriks() {
  arahSortMatriks = arahSortMatriks === 'asc' ? 'desc' : 'asc';
  gambarMatriks();
}

/** Sama alasannya dengan arahSortMatriks di atas, tapi Peringkat Dealer daftar yang
 * BERBEDA — dua daftar, dua kemungkinan urutan yang berbeda pula. */
let arahSortDealer = 'asc';

/** Gambar ulang HANYA blok Peringkat Dealer. */
function gambarDealer() {
  perbaruiLabelSort('fx-sort-dealer', arahSortDealer);
  const dealers = urutkanConfidence(
    (peringkatTerakhir && peringkatTerakhir.dealers) || [], arahSortDealer);
  const sorotDealer = filterAktifTerakhir ? filterAktifTerakhir.dealer : null;
  isiSlot('fx-dealer', daftarPeringkat(dealers, 'dealerName',
    { denganKota: true, jenis: 'dealer', sorotDealer }));
  sorotDanGulir('fx-dealer');
}

/** Balik arah urutan Confidence Ratio blok Peringkat Dealer. */
export function toggleSortDealer() {
  arahSortDealer = arahSortDealer === 'asc' ? 'desc' : 'asc';
  gambarDealer();
}

/**
 * Saring seluruh halaman dari elemen yang diklik — baris matriks, peringkat kota,
 * atau peringkat dealer.
 *
 * TANPA SIDEBAR, atas permintaan tim: yang jadi kendali silang adalah elemen yang
 * memang sudah ada di layar, bukan panel baru di samping. Filter bilah dipakai
 * bersama seluruh halaman sejak 2026-09-17, jadi menyaring di sini ikut terbawa waktu
 * pindah ke Sales Analytics — itu memang yang diharapkan.
 *
 * `force: true`, sama seperti langkahLive(). Tanpa itu setScope() bersifat toggle dan
 * mengklik baris yang SAMA dua kali justru mematikan saringannya — untuk mode LIVE itu
 * membuat putarannya tersendat, dan di sini membuat klik kedua terasa seperti aplikasi
 * yang tidak merespons. Yang mengosongkan saringan tombol reset di bilah filter, satu
 * tempat, bukan dua perilaku berbeda untuk gerakan yang sama.
 *
 * @param {'kota'|'dealer'} jenis
 * @param {string} kode  kode kota BPS, atau kode dealer TURUNAN NAMA (bukan numerik)
 */
export async function filterDariFusi(jenis, kode) {
  if (!kode) return;
  setScope(jenis === 'dealer' ? 'dealer' : 'kota', kode, true);
  window.syncFilterBar();
  await renderFusion();
}

/** Munculkan/sembunyikan panel Cakupan Sumber. */
export function toggleCakupanPanel() {
  const panel = $('fx-cakupan-panel');
  if (panel) panel.classList.toggle('hidden');
}

export async function renderFusion() {
  const wadah = $('fusion-isi');
  if (!wadah) return;

  // Saringan dari bilah, bukan objek kosong. Sebelum ini halaman SELALU meminta angka
  // se-provinsi: bilahnya tampil, tombolnya bergerak, angkanya tidak pernah berubah.
  const f = fusionFilter();

  isiSlot('fx-kpi-pelanggan',
    '<p class="text-xs text-slate-400 p-2">Memuat angka golongan…</p>');

  // Peringkat DEALER selalu diminta lengkap (periode saja): menyaringnya
  // menghilangkan konteks "posisi dibanding dealer lain", yang justru gunanya.
  const fSemua = { periode: f.periode };

  // MATRIKS dan PERINGKAT KOTA ikut saringan kota/karesidenan (permintaan tim
  // 2026-09-20: "hanya menampilkan kota sesuai isian filter"). Keduanya daftar PER
  // KOTA, jadi menyisakan kota yang sedang dilihat memang yang diminta — bukan 49
  // baris yang harus digulir untuk mencari 14 kota Kedu.
  //
  // KECUALI SAAT LIVE. Mode Live memutar filter Kota tiap 3,5 detik untuk wallboard;
  // kalau tabelnya ikut menyaring, isinya berkedip tinggal satu baris tiap putaran dan
  // tidak ada yang bisa dibaca. Saat Live, keduanya kembali menampilkan SEMUA kota dan
  // yang sedang diputar cuma DISOROT — itu sebabnya sorotannya dibuat mencolok
  // (.fx-sorot di index.html), karena di mode inilah ia jadi satu-satunya penunjuk.
  //
  // Dealer sengaja TIDAK ikut menyaring matriks: matriksnya per KOTA, dan menyaring
  // dealer mengubah arti angkanya jadi "kota ini menurut dealer itu" tanpa keterangan
  // apa pun di layar.
  const fPerKota = S.liveFusion
    ? fSemua
    : { periode: f.periode, kota: f.kota, kotaBanyak: f.kotaBanyak };


  // Pos TIDAK dipakai kelima panel halaman ini (permintaan tim 2026-09-18) — satu
  // pos cuma melayani sebagian kecil kelurahan satu kota, dan Kota/Dealer/Kares
  // sudah cukup. Dibuang DI SINI, bukan di fusionFilter() (filters.js) sendiri:
  // fungsi itu juga dipakai muatTitikFusi() (map.js) untuk titik tiga sumber di
  // peta yang SAMA tampil di halaman Sales Analytics, dan Pos masih relevan di
  // sana — membuangnya di fusionFilter() langsung pernah dicoba dan salah, ikut
  // mematikan saringan itu untuk halaman yang tidak diminta berubah.
  const { pos: _posTidakDipakai, ...fPanel } = f;

  let hasil;
  let peringkat;
  let matrix;
  let irisan;
  let cakupan;
  try {
    [hasil, peringkat, matrix, irisan, cakupan] = await Promise.all([
      fetchSegmentation(fPanel), fetchPeringkat(fPerKota), fetchMatriks(fPerKota),
      fetchIrisan(fPanel), fetchCakupanSumber(fPanel),
    ]);
  } catch (error) {
    // Galat ditulis di sel Summary saja. Menimpa seluruh kerangka akan mencabut
    // elemen peta yang sedang menumpang di #fx-peta-host.
    isiSlot('fx-kpi-pelanggan',
      `<p class="text-xs text-red-600 p-2">${esc(error.message)}</p>`);
    return;
  }

  // Disimpan supaya checkbox, kotak cari, dan tombol mode bisa menggambar ulang
  // tanpa meminta apa pun lagi ke server.
  cakupanTerakhir = cakupan;

  const meta = hasil.meta || {};
  const counts = meta.counts || {};
  const total = Number(meta.total) || 0;
  fusiTerakhir = { counts, total, irisan, meta };

  // Belum ada data sama sekali = keadaan yang WAJAR sampai Data KTP diimpor, bukan
  // error. Yang ditampilkan karena itu langkah berikutnya, bukan pesan gagal.
  if (!total) {
    // Keterangannya ditaruh di #fx-catatan yang selebar halaman, bukan dijejalkan ke
    // salah satu sel KPI selebar tiga kolom — kalimatnya panjang dan di sel sesempit
    // itu ia terpotong jadi tidak terbaca.
    isiSlot('fx-catatan',
      `<div class="bg-white rounded-xl border border-slate-200 p-3">` +
      `<div class="text-xs font-bold text-slate-700">Belum ada hasil penggolongan</div>` +
      `<p class="text-[10px] text-slate-500 mt-1 leading-relaxed">Golongan Warlok ` +
      `dihitung dari Data KTP, Data Servis, dan Data Pengiriman yang disatukan lewat ` +
      `Nomor Mesin. Impor Data KTP dulu lewat rute ` +
      `<span class="mono">/api/v1/import/ktp</span>.</p></div>`);
    ['fx-kpi-pelanggan', 'fx-kpi-cw', 'fx-kpi-ratio', 'fx-kpi-cakupan', 'fx-golongan-final',
      'fx-venn', 'fx-matriks', 'fx-matriks-jumlah', 'fx-dealer'].forEach((id) => isiSlot(id, ''));
    return;
  }

  const rasio = meta.confidenceRatio;
  const warnaRasio = WARNA_STATUS[meta.status] || 'text-slate-400';

  // EMPAT KPI kini EMPAT sel grid terpisah dalam wadah 2x2 (index.html), bukan tiga —
  // "Cakupan Sumber" ditambahkan 2026-09-18 (permintaan tim). kartuKpi()/kartuKpiTeks()
  // sudah menghasilkan kartu utuh sendiri, jadi tiap sel cukup diisi satu kartu apa
  // adanya.
  isiSlot('fx-catatan', catatanAbaikan(f));
  isiSlot('fx-kpi-pelanggan', kartuKpi('Pelanggan terfilter', formatNumber(total),
    `periode ${hasil.period || '—'}`, 'text-blue-500'));
  isiSlot('fx-kpi-cw', kartuKpi('CW Sales',
    formatNumber(Math.round(Number(meta.cwSales) || 0)),
    'terkoreksi keyakinan', 'text-purple-500'));
  isiSlot('fx-kpi-ratio', kartuKpi('Confidence Ratio',
    rasio == null ? '—' : `${(rasio * 100).toFixed(1)}%`,
    meta.status || 'belum ada data', warnaRasio));
  isiSlot('fx-kpi-cakupan',
    kartuKpiTeks('Cakupan Sumber', labelCakupanSumber(), 'total filter aktif'));

  gambarGolonganFinal();
  gambarVenn();

  // filterAktifTerakhir WAJIB disetel SEBELUM gambarMatriks()/gambarDealer():
  // keduanya membaca variabel ini untuk menentukan baris mana yang disorot.
  filterAktifTerakhir = f;
  peringkatTerakhir = peringkat;
  matriksTerakhir = matrix;
  gambarMatriks();
  gambarDealer();

  isiSlot('fx-cakupan-per',
    `per ${esc(cakupan && cakupan.groupBy === 'dealer' ? 'dealer' : 'kota')}`);
  isiSlot('fx-cakupan-kendali', kendaliCakupan());
  isiSlot('cakupan-isi', cakupanSumber(cakupan));

  // Peta ikut menyesuaikan diri ke lingkup yang sedang dipilih, sama seperti di
  // halaman Sales Analytics.
  //
  // Harus dipanggil DI SINI, bukan mengandalkan renderAll(): renderAll() berhenti di
  // baris pertama kalau `S.filterPage !== 'peta'` (lihat app.js), jadi di halaman ini
  // ia tidak pernah berjalan. Argumen `true` = otomatis: durasinya lebih lambat dan
  // tidak memunculkan toast "tidak ada data" — pemanggilan ini bukan hasil orang
  // menekan tombol Fokuskan.
  //
  // Alasan yang sama persis berlaku untuk ISI petanya, bukan cuma bingkainya. Sampai
  // sekarang peta di halaman ini cuma bergeser dan membesar-mengecil; warna heatmap,
  // titik, dan markernya tetap memperlihatkan filter yang lama. Paling kentara di mode
  // LIVE: dropdown-nya berganti kota tiap 3,5 detik sementara petanya diam.
  //
  // langkahLive() memanggil renderFusion() juga, jadi satu baris ini melayani dua-duanya
  // — perpindahan filter biasa DAN tiap ketukan LIVE.
  refreshMapVisual();

  if (S.layersReady) fitToScope(true);
}

/** Daftar Lokasi Service — sub-halaman menu Data. */
/* ==========================================================================
   DUA SUBHALAMAN DATA: LOKASI SERVICE & LOKASI DELIVERY
   ==========================================================================
   Sampai 2026-09-17 keduanya cuma panel "belum dibuat" — bukan rusak, memang
   belum pernah dikerjakan. Sekarang keduanya membaca rute PII berhalaman.

   Offsetnya disimpan per halaman dan DIKEMBALIKAN KE NOL tiap kali filter
   berubah: menyisakan offset lama sesudah menyaring lebih sempit membuat orang
   mendarat di halaman kosong dan mengira datanya tidak ada.
   ========================================================================== */

let servisOffset = 0;
let kirimOffset = 0;

/** Saringan dua subhalaman: periode + kota, mengikuti bilah filter bersama. */
function saringSumber(offset) {
  const f = pageFilters();
  return {
    periodFrom: f.from !== 'ALL' ? f.from : null,
    periodTo: f.to !== 'ALL' ? f.to : null,
    city: f.cityCode !== 'ALL' ? f.cityCode : null,
    offset,
  };
}

/**
 * Panel gagal yang MEMBEDAKAN dua sebab yang tampak sama di layar.
 *
 * Sampai 2026-09-17 kedua subhalaman ini menampilkan apa pun yang gagal sebagai SATU
 * baris merah kecil: `<p class="text-xs text-red-600">pesan</p>`. Database PII yang
 * tidak terhubung, galat server, dan jaringan putus terlihat persis sama — dan yang
 * pertama itu bukan kerusakan sama sekali, melainkan keadaan yang memang dirancang
 * boleh terjadi (aturan proyek: DROP DATABASE astra_customers harus meninggalkan
 * sisanya jalan penuh). Orang yang melihat baris merah itu tidak punya cara tahu
 * apakah ada yang perlu diperbaiki.
 */
export function panelGagal(error) {
  const pesan = String((error && error.message) || 'Galat tidak dikenal.');

  // Dicocokkan ke pesan yang dikirim repository.js waktu store.customers() null.
  if (/database konsumen tidak tersedia/i.test(pesan)) {
    return `<div class="rounded-xl border border-amber-200 bg-amber-50 p-3">` +
      `<div class="text-xs font-bold text-amber-900">Database konsumen tidak terhubung</div>` +
      `<p class="text-[11px] text-amber-800 mt-1 leading-relaxed">Halaman ini membaca data ` +
      `yang memuat alamat konsumen, dan database itu (<span class="mono">astra_customers</span>) ` +
      `sedang tidak terhubung. <b>Sisa aplikasi tetap jalan penuh</b> — itu memang ` +
      `dirancang begitu, bukan kerusakan. Nyalakan databasenya lalu jalankan ulang ` +
      `servernya; halaman ini akan terisi sendiri.</p></div>`;
  }

  return `<div class="rounded-xl border border-red-200 bg-red-50 p-3">` +
    `<div class="text-xs font-bold text-red-900">Gagal memuat</div>` +
    `<p class="text-[11px] text-red-800 mt-1 leading-relaxed">${esc(pesan)}</p>` +
    `<p class="text-[10px] text-red-700 mt-1 leading-snug">Ini permintaan yang GAGAL, ` +
    `bukan "tidak ada data". Tabel yang kosong karena saringan terlihat berbeda: ` +
    `kerangka tabelnya tetap tergambar.</p></div>`;
}

/**
 * Keterangan "kosong karena saringan" — muncul HANYA kalau saringannya memang aktif.
 *
 * Sejak filter disatukan antar halaman (2026-09-17), memilih Kota di Sales Analytics
 * ikut mempersempit kedua tabel ini. Tabel yang mendadak kosong lalu terbaca sebagai
 * "datanya hilang", padahal saringannya yang dipasang di halaman lain.
 *
 * Yang disebut HANYA Kota dan Periode, karena cuma keduanya yang benar-benar dikirim
 * saringSumber() ke rutenya. Dealer dan Pos TIDAK berlaku di sini — menyebutnya akan
 * membuat orang mengosongkan saringan yang sejak awal tidak berpengaruh.
 */
export function catatanKosongSaringan() {
  const f = pageFilters();
  const aktif = [];
  if (f.cityCode !== 'ALL') aktif.push('Kota');
  if (f.from !== 'ALL' || f.to !== 'ALL') aktif.push('Periode');
  if (!aktif.length) return '';

  return `<div class="rounded-xl border border-slate-200 bg-slate-50 p-3 mb-2">` +
    `<div class="text-xs font-bold text-slate-700">Kosong karena saringan, bukan karena gagal</div>` +
    `<p class="text-[11px] text-slate-600 mt-1 leading-relaxed">Saringan yang sedang ` +
    `berlaku di halaman ini: <b>${esc(aktif.join(' dan '))}</b>. Bilah filter dipakai ` +
    `bersama seluruh halaman, jadi saringan ini bisa saja dipasang di halaman lain. ` +
    `Kosongkan lewat tombol reset di bilah filter. Saringan Dealer dan Pos tidak ` +
    `berpengaruh di halaman ini.</p></div>`;
}

/** Baris navigasi halaman, dipakai kedua tabel. */
function navHalaman(hasil, fungsi) {
  const dari = hasil.total ? hasil.offset + 1 : 0;
  const sampai = Math.min(hasil.offset + hasil.limit, hasil.total);
  return `<div class="flex items-center gap-2 mt-2 text-[11px] text-slate-500">` +
    `<span>${esc(formatNumber(dari))}–${esc(formatNumber(sampai))} dari ` +
    `${esc(formatNumber(hasil.total))}</span>` +
    `<button onclick="${fungsi}(-1)" class="ml-auto px-2 py-1 rounded-lg border border-slate-200 font-bold hover:bg-slate-50">&larr;</button>` +
    `<button onclick="${fungsi}(1)" class="px-2 py-1 rounded-lg border border-slate-200 font-bold hover:bg-slate-50">&rarr;</button></div>`;
}

/** Tabel sederhana: judul kolom + baris. Semua nilai dari Excel, jadi WAJIB esc(). */
/**
 * Tabel untuk halaman Lokasi Servis dan Lokasi Delivery.
 *
 * GAYANYA DISAMAKAN dengan tabel Data Konsumen · berdasarkan KTP (index.html,
 * #table-konsumen-body) pada 2026-09-20 — permintaan tim. Dulu dua halaman yang
 * bersebelahan di menu yang sama terlihat seperti dibuat aplikasi yang berbeda:
 * kepala tabel yang satu 11px ber-shadow, yang satu lagi 10px tanpa; barisnya yang
 * satu punya hover, yang satu lagi tidak.
 *
 * JARAK ANTAR BARIS SENGAJA TIDAK IKUT diperbesar (px-3 py-2.5 di halaman KTP menjadi
 * px-3 py-1 di sini) — permintaan tim eksplisit: "jarak antar baris dan isiannya tetap
 * ada saat ini". Halaman ini memuat 100 baris per halaman dan dipakai untuk memindai
 * cepat, bukan membaca satu per satu.
 */
function tabelSumber(kolom, rows) {
  if (!rows.length) {
    return '<p class="text-xs text-slate-400 py-6 text-center">Tidak ada baris untuk ' +
      'saringan ini.</p>';
  }
  const kepala = kolom.map((k) =>
    `<th class="px-3 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase">${
      esc(k.judul)}</th>`).join('');
  const isi = rows.map((r) =>
    `<tr class="hover:bg-slate-50 border-b border-slate-100 last:border-0">${
      kolom.map((k) => `<td class="px-3 py-1 text-[11px] ${k.kelas || 'text-slate-600'}">${
        k.nilai(r)}</td>`).join('')}</tr>`).join('');
  return `<div class="overflow-auto rounded-xl border border-slate-200 bg-white">` +
    `<table class="w-full"><thead class="sticky top-0 z-10 shadow-sm" ` +
    `style="background:#eef1f7"><tr>${kepala}</tr></thead><tbody>${isi}</tbody></table></div>`;
}

/**
 * Status PENCOCOKAN WILAYAH, dalam bahasa yang bisa dibaca orang.
 *
 * Kata aslinya (`ok`/`alias`/`fuzzy`/`unmatched`) istilah mesin, dan diminta diganti.
 * Yang TIDAK boleh: menggantinya jadi "Dekat"/"Jauh". Kolom ini sama sekali bukan
 * soal jarak — ia menjawab "alamat baris ini berhasil dikenali jadi kelurahan mana".
 * Baris `unmatched` berarti alamatnya tidak dikenali, BUKAN lokasinya jauh. Jarak
 * punya kolomnya sendiri di sebelah.
 */
const LABEL_COCOK = {
  ok: { teks: 'Cocok', gaya: 'bg-emerald-50 text-emerald-700' },
  alias: { teks: 'Cocok (alias)', gaya: 'bg-emerald-50 text-emerald-700' },
  fuzzy: { teks: 'Mirip', gaya: 'bg-amber-50 text-amber-700' },
  unmatched: { teks: 'Tidak dikenal', gaya: 'bg-slate-100 text-slate-500' },
};

function lencanaStatus(status) {
  const l = LABEL_COCOK[status] || { teks: status || '—', gaya: 'bg-slate-100 text-slate-500' };
  return `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${l.gaya}" ` +
    `title="Status pencocokan alamat ke kelurahan, bukan jarak">${esc(l.teks)}</span>`;
}

/**
 * Penilaian JARAK terhadap ambang KPI yang sedang dipakai halaman ini.
 *
 * Tiga keadaan, bukan dua. "tidak terukur" bukan sinonim "Jauh": ia berarti baris itu
 * tidak bisa dipasangkan ke Data KTP lewat nomor mesin, atau salah satu titiknya tidak
 * diketahui. Diukur pada data Agustus 2026: dari 187.774 baris servis, cuma 1.994 yang
 * punya titik di KEDUA sisi — sekitar 1%. Memaksa 99% sisanya jadi "Jauh" akan
 * menciptakan kesimpulan yang tidak pernah diukur siapa pun.
 */
function lencanaJarak(meter, ambangKm) {
  if (meter == null) {
    return `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 ` +
      `text-slate-400" title="Baris ini tidak bisa dipasangkan ke Data KTP lewat ` +
      `Nomor Mesin, jadi jaraknya tidak pernah diukur">tidak terukur</span>`;
  }
  const km = Number(meter) / 1000;
  const dekat = km <= Number(ambangKm);
  const gaya = dekat ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700';
  return `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${gaya}" ` +
    `title="${esc(km.toFixed(1).replace('.', ','))} km dari kelurahan KTP-nya">${
      dekat ? 'Dekat' : 'Jauh'}</span>`;
}

/**
 * KPI Jarak khusus halaman Lokasi Service, dalam km.
 *
 * SENGAJA terpisah dari ambang yang tersimpan di `app_config` dan dipakai mesin
 * penggolongan. Yang ini alat lihat-lihat: mengubahnya hanya mengubah cara tabel ini
 * menilai Dekat/Jauh, TIDAK menghitung ulang golongan siapa pun dan tidak tersimpan.
 * Kalau ia menulis ke setelan yang sama, menggeser angka di sini diam-diam akan
 * mengubah arti seluruh dashboard.
 */
let kpiServisKm = 50;

/** Ubah ambang lalu gambar ulang — datanya sudah ada, jaraknya tidak perlu diminta lagi. */
export function setKpiServis(nilai) {
  const km = Number(nilai);
  if (Number.isFinite(km) && km > 0) kpiServisKm = km;
  renderServiceTable();
}

export async function renderServiceTable() {
  const wadah = $('servis-isi');
  if (!wadah) return;
  wadah.innerHTML = '<p class="text-xs text-slate-400 p-4">Memuat Data Servis…</p>';

  try {
    const hasil = await fetchServis(saringSumber(servisOffset));
    servisOffset = hasil.offset;

    // Berapa baris di halaman ini yang jaraknya benar-benar terukur. Dikatakan apa
    // adanya: pada data Agustus 2026 cuma ~1% baris servis punya pasangan Data KTP
    // lewat nomor mesin, jadi kolom Jarak akan sebagian besar "tidak terukur". Tanpa
    // kalimat ini, kolom yang hampir kosong terbaca seperti fitur yang rusak.
    const kendali =
      `<div class="flex items-center gap-2 mb-2 flex-wrap">` +
        `<span class="text-[11px] font-bold text-slate-600">KPI Jarak</span>` +
        `<input id="servis-kpi" type="number" min="1" step="1" value="${esc(String(kpiServisKm))}" ` +
        `onchange="setKpiServis(this.value)" ` +
        `class="w-20 px-2 py-1 rounded-lg border border-slate-200 text-[11px] mono">` +
        `<span class="text-[11px] text-slate-500">km — di bawahnya "Dekat", di atasnya "Jauh"</span>` +
        `<span class="ml-auto text-[10px] text-slate-400">${
          esc(formatNumber(hasil.terukur || 0))} dari ${esc(formatNumber(hasil.rows.length))} ` +
        `baris di halaman ini punya jarak terukur</span>` +
      `</div>`;

    wadah.innerHTML = kendali + (hasil.total ? '' : catatanKosongSaringan()) + tabelSumber([
      { judul: 'Periode', nilai: (r) => esc(r.period || '—'), kelas: 'mono text-slate-500' },
      { judul: 'Nomor Mesin', nilai: (r) => esc(r.engineNo || '—'), kelas: 'mono text-slate-700' },
      { judul: 'Jenis Service', nilai: (r) => esc(r.serviceType || '—') },
      { judul: 'Kelurahan', nilai: (r) => esc(r.villageText || '—') },
      { judul: 'Kecamatan', nilai: (r) => esc(r.districtText || '—') },
      { judul: 'Kota', nilai: (r) => esc(r.cityText || '—') },
      { judul: 'Jarak', nilai: (r) => lencanaJarak(r.distanceM, kpiServisKm) },
      { judul: 'Alamat cocok', nilai: (r) => lencanaStatus(r.resolveStatus) },
    ], hasil.rows) + navHalaman(hasil, 'servisPage');
  } catch (error) {
    wadah.innerHTML = panelGagal(error);
  }
}

/** Maju/mundur satu halaman daftar Servis. */
export function servisPage(arah) {
  servisOffset = Math.max(0, servisOffset + arah * 100);
  renderServiceTable();
}

/** Maju/mundur satu halaman daftar Pengiriman. */
export function kirimPage(arah) {
  kirimOffset = Math.max(0, kirimOffset + arah * 100);
  renderDeliveryTable();
}

/** Daftar Lokasi Delivery — sub-halaman menu Data. */
export async function renderDeliveryTable() {
  const wadah = $('kirim-isi');
  if (!wadah) return;
  wadah.innerHTML = '<p class="text-xs text-slate-400 p-4">Memuat Data Pengiriman…</p>';

  try {
    const hasil = await fetchPengiriman(saringSumber(kirimOffset));
    kirimOffset = hasil.offset;

    // Tabel kosong di sini BUKAN kegagalan: belum ada satu pun ping yang masuk,
    // karena produsennya (integrasi sistem lapangan) memang belum ada.
    //
    // KERANGKA TABELNYA TETAP DIGAMBAR, lengkap dengan judul kolomnya (permintaan
    // tim). Alasannya bagus: orang jadi tahu kolom apa saja yang akan datang, dan
    // halaman kosong tanpa kerangka terbaca seperti halaman yang rusak. Penjelasannya
    // ditaruh DI ATAS tabel, bukan menggantikannya.
    const catatanKosong = hasil.total ? '' :
      `<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-2">` +
      `<div class="text-xs font-bold text-amber-900">Belum ada data pengiriman</div>` +
      `<p class="text-[11px] text-amber-800 mt-1 leading-relaxed">Rute penerimanya ` +
      `sudah ada (<span class="mono">/api/v1/pengiriman/ping</span>), tapi belum ada ` +
      `satu pun ping yang dikirim — integrasi sistem lapangan belum terpasang. ` +
      `Kerangka tabel di bawah menunjukkan kolom yang akan terisi sendiri begitu ping ` +
      `pertama masuk.</p></div>`;

    wadah.innerHTML = catatanKosong + (hasil.total ? '' : catatanKosongSaringan()) + tabelSumber([
      { judul: 'Waktu', nilai: (r) => esc(String(r.sentAt || '').slice(0, 16)), kelas: 'mono text-slate-500' },
      { judul: 'Nomor Mesin', nilai: (r) => esc(r.engineNo || '—'), kelas: 'mono text-slate-700' },
      { judul: 'Lokasi', nilai: (r) => esc(r.locationText || '—') },
      { judul: 'Koordinat', nilai: (r) => esc(r.lat == null ? '—' : `${Number(r.lat).toFixed(5)}, ${Number(r.lng).toFixed(5)}`), kelas: 'mono text-slate-400' },
      { judul: 'Akurasi', nilai: (r) => esc(r.accuracyM == null ? '—' : `±${Math.round(Number(r.accuracyM))} m`), kelas: 'mono text-slate-500' },
      { judul: 'Kurir', nilai: (r) => esc(r.courierName || '—') },
    ], hasil.rows) + navHalaman(hasil, 'kirimPage');
  } catch (error) {
    wadah.innerHTML = panelGagal(error);
  }
}
