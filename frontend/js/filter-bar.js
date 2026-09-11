/**
 * Bilah filter: satu baris kendali, selalu terlihat, di setiap halaman.
 *
 * Semua kode DOM bilah tinggal di sini supaya filters.js tetap bebas DOM dan bisa
 * diuji tanpa browser. Pembagiannya lurus: filters.js memegang NILAI dan ATURANNYA,
 * berkas ini cuma menuliskannya ke layar dan membaca balik apa yang ditekan orang.
 *
 * Bilahnya duduk di luar area gulir (di antara nav dan <main>), jadi dia tidak perlu
 * position:sticky sama sekali — yang di luar satu-satunya scroller memang tidak pernah
 * bergerak. Sticky masih bisa mati diam kalau suatu hari ada ancestor ber-overflow;
 * ini tidak bisa.
 */
import { closeCombo, fillCombo, setComboValue } from './combobox.js';
import { ALLOWED_CITY_CODES, KARESIDENAN, MONTHS } from './config.js';
import { $, esc } from './dom.js';
import {
  clearScope, pageFilters, scopeValue, setKares, setPeriod, setScope,
} from './filters.js';
import { invalidateSalePoints } from './map.js';
import { S } from './state.js';

/** Tiga dropdown lingkup, masing-masing slot sendiri. Urutannya urutan tampil di bilah. */
const SCOPE_KINDS = ['kota', 'dealer', 'pos'];

/** Halaman yang punya bilah, dan fungsi yang menggambar ulang isinya. */
const REPAINT = {
  peta: 'renderAll',
  pos: 'renderOutletTable',
  konsumen: 'renderCustomerTable',
  kelurahan: 'renderVillageTable',
};

const setValue = (id, value) => { if ($(id)) $(id).value = value; };

/**
 * Tahun yang bisa dipilih.
 *
 * Daftar biasa, TIDAK diturunkan dari periode yang sudah diimpor — diminta tim. Bulan
 * yang belum ada datanya boleh dipilih dan jawabannya nol; itu lebih jujur daripada
 * dropdown yang diam-diam tidak memuat tahun yang dicari orang.
 */
const TAHUN_AWAL = 2020;
const tahunTersedia = () => {
  const akhir = new Date().getFullYear() + 1;
  const daftar = [];
  for (let t = akhir; t >= TAHUN_AWAL; t--) daftar.push(t);
  return daftar;
};

/** Satu tanda hubung berarti "tanpa batas di sisi ini". */
const TANPA_BATAS = '\u2014';

/**
 * Nama ujung rentang di state vs di markup.
 *
 * `from`/`to` dipakai di filters.js karena kodenya bahasa Inggris; `dari`/`sampai`
 * dipakai di id elemen karena itu yang terbaca di layar. Terjemahannya WAJIB lewat
 * sini \u2014 menyambung `which + '-bulan'` begitu saja menghasilkan `from-bulan`, elemen
 * yang tidak ada, dan periodenya diam-diam jadi "tanpa batas". Sudah kejadian.
 */
const KOTAK = { from: 'dari', to: 'sampai' };

function isiKotakPeriode(ujung) {
  const bulan = $(ujung + '-bulan');
  const tahun = $(ujung + '-tahun');
  if (!bulan || !tahun) return;
  bulan.innerHTML = `<option value="">${TANPA_BATAS}</option>` +
    MONTHS.map((nama, i) =>
      `<option value="${String(i + 1).padStart(2, '0')}">${esc(nama.slice(0, 3))}</option>`).join('');
  tahun.innerHTML = `<option value="">${TANPA_BATAS}</option>` +
    tahunTersedia().map((t) => `<option value="${t}">${t}</option>`).join('');
}

/** Tahun yang dipakai melengkapi kalau orang baru memilih bulannya. */
const tahunAcuan = () => (S.periods.length
  ? S.periods[S.periods.length - 1].slice(0, 4)
  : String(new Date().getFullYear()));

/**
 * Baca kedua dropdown satu ujung jadi satu nilai 'YYYY-MM'.
 *
 * Dua hal berbeda yang gampang tertukar, dan bedanya ditentukan dropdown MANA yang
 * baru disentuh:
 *
 * - Memilih tanda hubung = "tanpa batas di sisi ini". Ujungnya dikosongkan seluruhnya.
 * - Memilih bulan padahal tahunnya masih kosong = separuh isian. Sisi satunya
 *   DILENGKAPI, bukan pilihannya yang dibuang.
 *
 * Yang kedua pernah salah: sisi yang belum terisi membuat seluruh ujung dianggap
 * "tanpa batas", jadi syncFilterBar() menghapus lagi bulan yang barusan dipilih. Dari
 * keadaan kosong, nilainya tidak pernah bisa dibangun — tiap pilihan langsung hilang.
 *
 * Melengkapi memang menebak, tapi tebakannya LANGSUNG TERLIHAT di dropdown sebelahnya
 * dan bisa diganti. Itu beda jauh dari menebak diam-diam di dalam kode.
 */
function bacaKotakPeriode(which, el) {
  const ujung = KOTAK[which];
  const bulanEl = $(ujung + '-bulan');
  const tahunEl = $(ujung + '-tahun');
  if (!bulanEl || !tahunEl) return 'ALL';
  if (el && el.value === '') return 'ALL';

  // Bulan yang dilengkapi memihak ke arah yang melebarkan rentang, bukan menyempitkan:
  // Januari untuk ujung awal, Desember untuk ujung akhir. Rentang yang kelewat lebar
  // terlihat sendiri di angkanya; rentang yang kelewat sempit terlihat seperti data
  // yang hilang.
  const bulan = bulanEl.value || (which === 'from' ? '01' : '12');
  const tahun = tahunEl.value || tahunAcuan();
  return `${tahun}-${bulan}`;
}

/**
 * Isi ulang combo Kota — dipanggil sekali di fillFilterBar() DAN tiap kali Kares
 * berganti (cascading). Opsinya disaring dua lapis: (1) cuma kode yang diizinkan
 * (ALLOWED_CITY_CODES, 14 kab/kota di 3 Kares), (2) kalau Kares aktif, dipersempit
 * lagi ke kota anggota Kares itu saja.
 */
function isiComboKota() {
  const f = pageFilters();
  const allowed = f.kares !== 'ALL' ? new Set(KARESIDENAN[f.kares].cities) : ALLOWED_CITY_CODES;

  fillCombo('kota', 'Kabupaten', Object.keys(S.cityNames)
    .filter((c) => allowed.has(c))
    .sort((a, b) => S.cityNames[a].localeCompare(S.cityNames[b]))
    .map((c) => [c, S.cityNames[c]]), 'Semua', (value) => {
      setScope('kota', value, true);
      repaint(false);
      // Kota dipilih TANPA kelurahan spesifik yang sedang aktif -> buka ringkasan
      // kota langsung. Lewat window: tables.js sudah meng-import berkas ini untuk
      // switchTab(), meng-import baliknya akan membuat lingkaran.
      if (value !== 'ALL' && !S.selectedVillage && window.openCitySummary) {
        window.openCitySummary(value);
      }
    });
}

/**
 * Isi opsi semua kendali di bilah. Dipanggil sekali setelah data server masuk.
 */
export function fillFilterBar() {
  isiKotakPeriode('dari');
  isiKotakPeriode('sampai');

  // Memilih dari daftar berarti "tampilkan yang ini", bukan "nyalakan atau matikan
  // yang ini" — jadi dipaksa, tidak di-toggle. Toggle cuma masuk akal untuk klik di
  // peta, dan itu jalur applyScope().
  const pilihLingkup = (kind) => (value) => {
    setScope(kind, value, true);
    repaint(false);
  };

  fillCombo('kares', 'Kares',
    Object.keys(KARESIDENAN).map((k) => [k, KARESIDENAN[k].label]), 'Semua',
    (value) => { setKares(value); isiComboKota(); repaint(false); });

  isiComboKota();

  fillCombo('dealer', 'Dealer', S.registry.order
    .filter((code) => S.dealerNames[code])
    .map((code) => [code, S.dealerNames[code]]), 'Semua', pilihLingkup('dealer'));

  // S.realOutlets, bukan S.outlets — dropdown Pos cuma menawarkan pos fisik
  // sungguhan, tidak ikut baris "proxy" per dealer (lihat schema.sql komentar
  // outlets.is_dealer_proxy).
  fillCombo('pos', 'Pos', S.realOutlets.slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((o) => [o.code, o.name]), 'Semua', pilihLingkup('pos'));

  // Halaman analisis mulai di bulan terakhir. Data Konsumen sengaja TIDAK ikut: dia
  // dipakai untuk mencari nama tanpa tahu bulannya, dan membukanya di satu bulan
  // berarti pencarian nihil sampai ada yang sadar harus melebarkan periodenya dulu.
  const last = S.periods.length ? S.periods[S.periods.length - 1] : 'ALL';
  ['peta', 'pos', 'kelurahan'].forEach((page) => {
    S.filters[page].from = last;
    S.filters[page].to = last;
  });

  syncFilterBar();
}

/**
 * Tulis nilai halaman yang sedang aktif ke bilah.
 *
 * Satu arah saja: objek -> DOM. Ketiga dropdown lingkup (kota/dealer/pos) SALING
 * EKSKLUSIF sejak [tanggal eksekusi] — cuma satu yang pernah menunjukkan selain
 * "Semua ..." di saat yang sama (lihat setScope() di filters.js).
 */
export function syncFilterBar() {
  const f = pageFilters();

  // 'ALL' ditulis ke kedua dropdown sebagai kosong, yang tampil sebagai tanda hubung.
  [['dari', f.from], ['sampai', f.to]].forEach(([ujung, nilai]) => {
    const [tahun, bulan] = nilai === 'ALL' ? ['', ''] : nilai.split('-');
    setValue(ujung + '-bulan', bulan);
    setValue(ujung + '-tahun', tahun);
  });

  setComboValue('kares', f.kares);
  SCOPE_KINDS.forEach((kind) => setComboValue(kind, scopeValue(kind, f)));
}

/**
 * Gambar ulang halaman yang sedang dilihat, bukan selalu halaman Peta.
 *
 * Lewat window, bukan import langsung: tables.js sudah meng-import berkas ini untuk
 * switchTab(), dan meng-import baliknya akan membuat lingkaran.
 */
function repaint(periodChanged) {
  // Titik penjualan dibangun ulang HANYA kalau rentangnya berganti. Filter lain tidak
  // mengubah titiknya — cuma warnanya — dan membangun ulang 18 ribu titik tiap kali
  // dropdown disentuh akan terasa berat tanpa alasan.
  if (periodChanged) invalidateSalePoints();
  syncFilterBar();
  const fungsi = window[REPAINT[S.filterPage]];
  if (fungsi) fungsi();
}

export function onPeriodChange(which, el) {
  setPeriod(which, bacaKotakPeriode(which, el));
  repaint(true);
}

/** Kembali ke seluruh penjualan. Periodenya sengaja TIDAK ikut direset. */
export function resetFilters() {
  closeCombo();
  setKares('ALL');
  isiComboKota();
  clearScope();
  if (window.closeVillageDetail) window.closeVillageDetail();
  repaint(false);
}
