/**
 * Mode edit ring: pilih satu kecamatan di peta, lalu tentukan ringnya.
 *
 * Ring menggantikan cara lama "dalam radius X km". Radius tidak tahu jalan, sungai,
 * maupun gunung; tim yang tahu — jadi ringnya ditentukan manusia, dan tempat paling
 * masuk akal menentukannya adalah di atas peta, bukan dari daftar 654 nama kecamatan.
 *
 * Urutannya SATU KECAMATAN DULU, baru ringnya. Versi pertama kebalikannya — pilih ring
 * sebagai "kuas", lalu sapu banyak kecamatan sekaligus. Itu lebih cepat untuk mengisi
 * borongan, tapi tim memintanya per satu kecamatan: yang dipikirkan orang waktu melihat
 * peta adalah "kecamatan ini masuk ring berapa", bukan "ring 2 isinya kecamatan mana
 * saja". Urutan kendalinya sekarang mengikuti urutan pikirannya.
 *
 * Perubahannya ditahan di sini sampai Simpan ditekan. Tanpa itu, tiap klik jadi satu
 * permintaan ke server dan membatalkan berarti membalikkan puluhan klik satu per satu.
 */
import { saveRings } from './api.js';
import { $, esc, toast } from './dom.js';
import { scopeValue } from './filters.js';
import { addDistrictLayers, districtsLoaded, setRingPaint } from './map.js';
import { S } from './state.js';

/** Warna tiap ring. Satu keluarga, makin jauh makin pudar — jaraknya terbaca. */
export const RING_COLORS = { 1: '#0b2f6b', 2: '#3b6fc4', 3: '#93b4e6' };

/** Salinan kerja: {districtCode: ring}. Null berarti mode edit sedang mati. */
let draft = null;

/** Pos yang ringnya sedang disunting. */
let posEdit = null;

/** Kecamatan yang pemilih ringnya sedang terbuka. */
let dipilih = null;

export const ringEditing = () => draft !== null;
export const ringDraft = () => draft;

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
  closeRingChooser();
  $('ring-bar').classList.add('hidden');
  setRingPaint(null);
}

/* ==========================================================================
   PEMILIH RING SATU KECAMATAN
   ========================================================================== */

/**
 * Satu kecamatan diklik di peta: buka pemilih ringnya di titik klik.
 *
 * @param {string} code   kode kecamatan bertitik
 * @param {Object} event  MouseEvent asli, untuk menaruh pemilihnya di dekat kursor
 */
export function openRingChooser(code, event) {
  if (!draft) return;
  dipilih = code;

  const nama = S.districtNames[code] || code;
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
    toast(`Ring tersimpan: ${jumlah} kecamatan.`, 'ok');
    window.renderAll();
  } catch (error) {
    $('ring-pesan').textContent = error.message;
    $('ring-simpan').disabled = false;
  }
}

/**
 * Bilah alat: berapa kecamatan di tiap ring, dan nama-namanya.
 *
 * Cuma penanda, bukan kendali — yang mengendalikan adalah klik di peta. Namanya ikut
 * ditulis (dipotong) supaya orang tidak perlu menutup mode edit dulu untuk memeriksa
 * apa yang sudah dimasukkan.
 */
function renderRingBar() {
  const isi = draft || {};
  [1, 2, 3].forEach((ring) => {
    const kode = Object.keys(isi).filter((c) => isi[c] === ring);
    const nama = kode.map((c) => S.districtNames[c] || c)
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
