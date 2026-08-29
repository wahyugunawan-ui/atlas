/**
 * Mode edit ring: pilih kecamatan langsung di peta.
 *
 * Ring menggantikan cara lama "dalam radius X km". Radius tidak tahu jalan, sungai,
 * maupun gunung; tim yang tahu — jadi ringnya ditentukan manusia, dan tempat paling
 * masuk akal menentukannya adalah di atas peta, bukan dari daftar 654 nama kecamatan.
 *
 * Cara pakainya seperti kuas: pilih ring 1, 2, atau 3 di bilah alat, lalu klik
 * kecamatan di peta. Mengklik kecamatan yang sudah punya ring yang sama akan
 * MELEPASNYA — dengan begitu memberi dan membatalkan cuma satu gerakan yang sama,
 * dan tidak ada mode "hapus" terpisah yang harus diingat.
 *
 * Perubahannya ditahan di sini sampai Simpan ditekan. Tanpa itu, tiap klik jadi satu
 * permintaan ke server dan membatalkan berarti membalikkan puluhan klik satu per satu.
 */
import { saveRings } from './api.js';
import { $, toast } from './dom.js';
import { scopeValue } from './filters.js';
import { addDistrictLayers, districtsLoaded, setRingPaint } from './map.js';
import { S } from './state.js';

/** Warna tiap ring. Satu keluarga, makin jauh makin pudar — jaraknya terbaca. */
export const RING_COLORS = { 1: '#0b2f6b', 2: '#3b6fc4', 3: '#93b4e6' };

/** Ring yang sedang jadi kuas. */
let ringAktif = 1;

/** Salinan kerja: {districtCode: ring}. Null berarti mode edit sedang mati. */
let draft = null;

/** Pos yang ringnya sedang disunting. */
let posEdit = null;

export const ringEditing = () => draft !== null;
export const ringDraft = () => draft;
export const ringActive = () => ringAktif;

/**
 * Masuk mode edit untuk satu pos.
 *
 * Batas kecamatan dimuat DI SINI, bukan saat halaman dibuka: berkasnya 3 MB dan
 * sebagian besar sesi tidak pernah menyunting ring sama sekali.
 */
export async function startRingEdit(outletCode) {
  // Tanpa argumen berarti "pos yang sedang dipilih" — itu cara tombol di bilah ruang
  // lingkup memanggilnya, dan tombolnya memang cuma muncul waktu ada pos terpilih.
  const kode = outletCode || scopeValue('pos');
  const outlet = S.outletByCode[kode];
  if (!outlet) return;

  posEdit = kode;
  draft = Object.assign({}, S.rings[kode] || {});
  ringAktif = 1;

  $('ring-nama').textContent = outlet.name;
  $('ring-bar').classList.remove('hidden');
  renderRingBar();

  if (!districtsLoaded()) {
    $('ring-pesan').textContent = 'Memuat batas kecamatan...';
    try {
      await addDistrictLayers();
    } catch (error) {
      $('ring-pesan').textContent = 'Batas kecamatan tidak bisa dimuat: ' + error.message;
      return;
    }
  }
  $('ring-pesan').textContent = '';
  setRingPaint(draft);
}

export function cancelRingEdit() {
  draft = null;
  posEdit = null;
  $('ring-bar').classList.add('hidden');
  setRingPaint(null);
}

export function setRingBrush(ring) {
  ringAktif = Number(ring);
  renderRingBar();
}

/**
 * Satu kecamatan diklik di peta.
 *
 * Kecamatan yang sudah memakai ring aktif dilepas; selain itu dipindah ke ring aktif.
 * Karena satu kecamatan cuma punya satu nilai di objek ini, dua ring tidak bisa
 * memilikinya bersamaan — aturan yang sama dijaga primary key di database.
 */
export function toggleDistrict(code) {
  if (!draft) return;
  if (draft[code] === ringAktif) delete draft[code];
  else draft[code] = ringAktif;
  setRingPaint(draft);
  renderRingBar();
}

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
    toast(`Ring tersimpan: ${jumlah} kecamatan.`, 'ok');
    window.renderAll();
  } catch (error) {
    $('ring-pesan').textContent = error.message;
    $('ring-simpan').disabled = false;
  }
}

/** Bilah alat: tiga tombol ring, masing-masing dengan jumlahnya sekarang. */
function renderRingBar() {
  const isi = draft || {};
  [1, 2, 3].forEach((ring) => {
    const tombol = $('ring-btn-' + ring);
    if (!tombol) return;
    const jumlah = Object.values(isi).filter((r) => r === ring).length;
    tombol.classList.toggle('aktif', ring === ringAktif);
    tombol.style.background = ring === ringAktif ? RING_COLORS[ring] : '';
    $('ring-jml-' + ring).textContent = jumlah;
  });
  $('ring-simpan').disabled = false;
}
