/**
 * Mode edit ring: pilih satu desa/kelurahan di peta, lalu tentukan ringnya.
 *
 * Ring menggantikan cara lama "dalam radius X km". Radius tidak tahu jalan, sungai,
 * maupun gunung; tim yang tahu — jadi ringnya ditentukan manusia, dan tempat paling
 * masuk akal menentukannya adalah di atas peta, bukan dari daftar ribuan nama desa.
 *
 * Sejak 2026-08-31 per DESA/KELURAHAN, bukan lagi kecamatan — permintaan Pakbos,
 * granularitas kecamatan dianggap terlalu kasar. Data ring versi kecamatan lama
 * dihapus total waktu migrasi (lihat docs/DECISIONS.md).
 *
 * Urutannya SATU DESA DULU, baru ringnya. Versi pertama (kecamatan) kebalikannya —
 * pilih ring sebagai "kuas", lalu sapu banyak kecamatan sekaligus. Itu lebih cepat
 * untuk mengisi borongan, tapi tim memintanya per satu unit: yang dipikirkan orang
 * waktu melihat peta adalah "desa ini masuk ring berapa", bukan "ring 2 isinya desa
 * mana saja". Urutan kendalinya sekarang mengikuti urutan pikirannya.
 *
 * Perubahannya ditahan di sini sampai Simpan ditekan. Tanpa itu, tiap klik jadi satu
 * permintaan ke server dan membatalkan berarti membalikkan puluhan klik satu per satu.
 */
import { saveRings } from './api.js';
import { $, esc, toast } from './dom.js';
import { scopeValue } from './filters.js';
import { addRingVillageLayers, ringVillagesLoaded, setRingPaint } from './map.js';
import { S } from './state.js';

/** Warna tiap ring. Satu keluarga, makin jauh makin pudar — jaraknya terbaca. */
export const RING_COLORS = { 1: '#0b2f6b', 2: '#3b6fc4', 3: '#93b4e6' };

/** Salinan kerja: {villageCode: ring}. Null berarti mode edit sedang mati. */
let draft = null;

/** Pos yang ringnya sedang disunting. */
let posEdit = null;

/** Desa yang pemilih ringnya sedang terbuka. */
let dipilih = null;

export const ringEditing = () => draft !== null;
export const ringDraft = () => draft;

/**
 * Masuk mode edit untuk satu pos.
 *
 * Tanpa argumen: pakai pos yang sedang dipilih; kalau tidak ada pos tapi ada DEALER
 * yang dipilih (klik titik dealer di peta — permintaan Pakbos), pilih pos-nya dulu:
 * langsung kalau dealernya cuma punya satu pos, tampilkan pemilih kalau lebih dari satu.
 */
export function startRingEdit(outletCode) {
  if (outletCode) return startRingEditFor(outletCode);

  const pos = scopeValue('pos');
  if (pos !== 'ALL') return startRingEditFor(pos);

  const dealer = scopeValue('dealer');
  if (dealer === 'ALL') return undefined;
  const outlets = Object.values(S.outletByCode).filter((o) => o.dealerCode === dealer);
  if (!outlets.length) {
    toast('Dealer ini belum punya pos untuk disunting ring-nya.', 'error');
    return undefined;
  }
  if (outlets.length === 1) return startRingEditFor(outlets[0].code);
  return openRingOutletChooser(outlets);
}

/**
 * Daftar pos satu dealer, dipilih salah satu sebelum masuk mode edit ring —
 * dealer dengan lebih dari satu pos tidak bisa langsung ditebak yang mana.
 */
function openRingOutletChooser(outlets) {
  $('rp-pos-daftar').innerHTML = outlets
    .slice().sort((a, b) => a.name.localeCompare(b.name))
    .map((o) => `<button type="button" onclick="chooseRingOutlet('${esc(o.code)}')" ` +
      `class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50">` +
      `${esc(o.name)}</button>`).join('');
  $('ring-pilih-pos').classList.remove('hidden');
}

export function closeRingOutletChooser() {
  const el = $('ring-pilih-pos');
  if (el) el.classList.add('hidden');
}

export function chooseRingOutlet(code) {
  closeRingOutletChooser();
  startRingEditFor(code);
}

/**
 * Batas desa dimuat DI SINI, bukan saat halaman dibuka: berkasnya besar (semua desa,
 * tanpa disaring) dan sebagian besar sesi tidak pernah menyunting ring sama sekali.
 */
async function startRingEditFor(outletCode) {
  const outlet = S.outletByCode[outletCode];
  if (!outlet) return;

  posEdit = outletCode;
  draft = Object.assign({}, S.rings[outletCode] || {});

  // Mode Tampilkan Ring (Bagian I) dan mode edit berbagi layer kel-ring-* yang sama
  // — matikan sorotan lihat-saja begitu masuk mode edit, supaya dua-duanya tidak
  // berebut mewarnai layer yang sama (lihat paintRingView() di map.js).
  S.ringView = null;

  $('ring-nama').textContent = outlet.name;
  $('ring-bar').classList.remove('hidden');
  renderRingBar();

  if (!ringVillagesLoaded()) {
    $('ring-pesan').textContent = 'Memuat batas desa...';
    try {
      await addRingVillageLayers();
    } catch (error) {
      $('ring-pesan').textContent = 'Batas desa tidak bisa dimuat: ' + error.message;
      return;
    }
  }
  $('ring-pesan').textContent = '';
  setRingPaint(draft);
}

export function cancelRingEdit() {
  draft = null;
  posEdit = null;
  closeRingChooser();
  closeRingOutletChooser();
  $('ring-bar').classList.add('hidden');
  setRingPaint(null);
}

/* ==========================================================================
   PEMILIH RING SATU DESA/KELURAHAN
   ========================================================================== */

/**
 * Satu desa/kelurahan diklik di peta: buka pemilih ringnya di titik klik.
 *
 * @param {string} code   kode desa bertitik
 * @param {string} name   nama desa dari properti fitur yang diklik (kelurahan-ring.
 *   geojson membawa nama SEMUA desa, termasuk yang belum ada di S.villageByCode
 *   karena belum pernah punya penjualan) — dipakai LEBIH DULU sebelum jatuh ke
 *   S.villageByCode, supaya desa yang justru paling perlu ditandai (belum tergarap)
 *   tidak tampil sebagai kode mentah tanpa nama.
 * @param {Object} event  MouseEvent asli, untuk menaruh pemilihnya di dekat kursor
 */
export function openRingChooser(code, name, event) {
  if (!draft) return;
  dipilih = code;

  const nama = name || (S.villageByCode[code] || {}).name || code;
  const sekarang = draft[code] || 0;
  $('rp-kec-nama').textContent = nama;
  $('rp-kec-kode').textContent = code;
  $('rp-kec-status').textContent = sekarang ? `sekarang ring ${sekarang}` : 'belum masuk ring';

  [1, 2, 3].forEach((ring) => {
    const tombol = $('rp-ring-' + ring);
    const aktif = sekarang === ring;
    tombol.classList.toggle('aktif', aktif);
    tombol.style.background = aktif ? RING_COLORS[ring] : '';
  });
  // Tombol lepas cuma masuk akal kalau kecamatannya memang sedang punya ring.
  $('rp-lepas').classList.toggle('hidden', !sekarang);

  const kotak = $('ring-pilih');
  kotak.classList.remove('hidden');
  const lebar = kotak.offsetWidth || 220;
  const tinggi = kotak.offsetHeight || 130;
  // Dijepit ke dalam jendela: kecamatan di tepi peta jangan sampai pemilihnya
  // separuh keluar layar dan tombolnya tidak bisa ditekan.
  const x = Math.min(Math.max(8, event.clientX - lebar / 2), window.innerWidth - lebar - 8);
  const y = Math.max(8, event.clientY - tinggi - 12);
  kotak.style.left = x + 'px';
  kotak.style.top = y + 'px';
}

export function closeRingChooser() {
  dipilih = null;
  const kotak = $('ring-pilih');
  if (kotak) kotak.classList.add('hidden');
}

/**
 * Taruh kecamatan yang sedang dipilih ke satu ring, atau lepaskan.
 *
 * @param {number} ring  1, 2, 3, atau 0 untuk melepas
 */
export function assignRing(ring) {
  if (!draft || !dipilih) return;
  const nomor = Number(ring);
  if (!nomor) delete draft[dipilih];
  else draft[dipilih] = nomor;
  closeRingChooser();
  setRingPaint(draft);
  renderRingBar();
}

/* ==========================================================================
   SIMPAN
   ========================================================================== */

export async function saveRingEdit() {
  if (!draft || !posEdit) return;
  $('ring-simpan').disabled = true;
  $('ring-pesan').textContent = 'Menyimpan...';
  try {
    await saveRings(posEdit, draft);
    // Salinan di S diperbarui langsung supaya kolom di Master Pos dan hitungan ring
    // ikut berubah tanpa memuat ulang seluruh ringkasan dari server.
    S.rings[posEdit] = Object.assign({}, draft);
    const jumlah = Object.keys(draft).length;
    cancelRingEdit();
    toast(`Ring tersimpan: ${jumlah} desa.`, 'ok');
    window.renderAll();
  } catch (error) {
    $('ring-pesan').textContent = error.message;
    $('ring-simpan').disabled = false;
  }
}

/**
 * Bilah alat: berapa desa di tiap ring, dan nama-namanya.
 *
 * Cuma penanda, bukan kendali — yang mengendalikan adalah klik di peta. Namanya ikut
 * ditulis (dipotong) supaya orang tidak perlu menutup mode edit dulu untuk memeriksa
 * apa yang sudah dimasukkan.
 */
function renderRingBar() {
  const isi = draft || {};
  [1, 2, 3].forEach((ring) => {
    const kode = Object.keys(isi).filter((c) => isi[c] === ring);
    const nama = kode.map((c) => (S.villageByCode[c] || {}).name || c)
      .sort((a, b) => a.localeCompare(b));
    $('ring-jml-' + ring).textContent = nama.length;
    const daftar = $('ring-isi-' + ring);
    if (daftar) {
      daftar.textContent = nama.length ? nama.join(', ') : '—';
      daftar.title = nama.length ? nama.join(', ') : '';
    }
  });
  $('ring-simpan').disabled = false;
}
