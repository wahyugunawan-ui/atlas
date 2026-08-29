/**
 * Dropdown dengan kotak pencarian DI DALAM panelnya.
 *
 * Ada karena `<select>` bawaan tidak bisa memuat kotak pencarian, dan daftar 51 dealer
 * atau 78 pos terlalu panjang untuk digulir. Versi sebelumnya menempelkan kotak cari di
 * SEBELAH `<select>` — dua kendali untuk satu pilihan, dan yang kedua tidak terlihat
 * seperti bagian dari yang pertama.
 *
 * Yang dijaga tetap sama seperti dulu: **nilai yang tersimpan selalu KODE**, tidak
 * pernah teks yang diketik. Kotak pencarian cuma menyaring apa yang tampil; memilih
 * tetap harus menekan salah satu barisnya. Tanpa itu, salah ketik diam-diam mengubah
 * filter.
 *
 * Daftar opsinya menempel di elemen hostnya (`host._combo`), bukan di objek global
 * berkunci id. Objek global itu pernah ada, tidak pernah dibuat siapa pun, dan membuat
 * pencarian di dalam dropdown melempar TypeError sejak hari pertama tanpa satu pun tes
 * merah.
 */
import { $, esc } from './dom.js';

/** Di bawah ini daftarnya cukup pendek untuk dibaca sekaligus; kotak cari cuma ribut. */
const AMBANG_CARI = 8;

const host = (name) => $('pilih-' + name);

/**
 * Bangun satu dropdown dan isi opsinya.
 *
 * @param {string} name    'provinsi' | 'kota' | 'dealer' | 'pos'
 * @param {string} label   nama sumbunya, tampil kecil di dalam pil
 * @param {Array}  pairs   [[kode, teks], ...]
 * @param {string} allLabel teks untuk "tanpa saringan"
 * @param {Function} onPick dipanggil dengan kode terpilih ('ALL' = tanpa saringan)
 */
export function fillCombo(name, label, pairs, allLabel, onPick) {
  const el = host(name);
  if (!el) return;

  el._combo = { label, pairs, allLabel, onPick };
  const pakaiCari = pairs.length > AMBANG_CARI;

  el.innerHTML =
    `<button type="button" class="pilih-tombol" onclick="toggleCombo('${esc(name)}')" ` +
    `aria-haspopup="listbox" aria-expanded="false">` +
    `<span class="pilih-kunci">${esc(label)}</span>` +
    `<span class="pilih-nilai" id="nilai-${esc(name)}">${esc(allLabel)}</span>` +
    `<i class="ph ph-caret-down pilih-caret"></i></button>` +
    `<div class="pilih-panel" id="panel-${esc(name)}" role="listbox" hidden>` +
    (pakaiCari
      ? `<input id="cari-${esc(name)}" class="pilih-cari" type="text" autocomplete="off" ` +
        `placeholder="Cari ${esc(label.toLowerCase())}..." oninput="comboSearch('${esc(name)}')">`
      : '') +
    `<div class="pilih-daftar" id="daftar-${esc(name)}"></div></div>`;

  drawOptions(name, '');
}

/** Gambar isi daftar, disaring kata kunci. Opsi "semua" selalu ikut, di paling atas. */
function drawOptions(name, q) {
  const el = host(name);
  if (!el || !el._combo) return;
  const { pairs, allLabel } = el._combo;
  const kunci = q.trim().toLowerCase();
  const cocok = kunci
    ? pairs.filter(([, teks]) => String(teks).toLowerCase().includes(kunci))
    : pairs;

  const baris = ([kode, teks]) =>
    `<button type="button" class="pilih-opsi" role="option" ` +
    `onclick="chooseCombo('${esc(name)}','${esc(kode)}')">${esc(teks)}</button>`;

  $('daftar-' + name).innerHTML =
    baris(['ALL', allLabel]) +
    (cocok.length
      ? cocok.map(baris).join('')
      : '<p class="pilih-kosong">Tidak ada yang cocok.</p>');
  tandaiTerpilih(name);
}

/** Baris yang sedang jadi nilai aktif ditandai, supaya panel bisa dibaca sendirian. */
function tandaiTerpilih(name) {
  const el = host(name);
  const aktif = el && el._nilai ? el._nilai : 'ALL';
  [...$('daftar-' + name).querySelectorAll('.pilih-opsi')].forEach((b) => {
    b.classList.toggle('terpilih', b.getAttribute('onclick').includes(`'${aktif}'`));
  });
}

/**
 * Tulis nilai ke pilnya. Satu arah: state -> layar.
 *
 * Pil MENYALA hanya kalau dia benar-benar menyempitkan tampilan. Karena kabupaten,
 * dealer, dan pos berbagi satu slot, tidak akan pernah ada dua di antara ketiganya yang
 * menyala bersamaan — aturannya jadi terlihat, bukan cuma berlaku.
 */
export function setComboValue(name, value) {
  const el = host(name);
  if (!el || !el._combo) return;
  el._nilai = value;
  const pasangan = el._combo.pairs.find(([kode]) => kode === value);
  const teks = value === 'ALL' || !pasangan ? el._combo.allLabel : pasangan[1];
  $('nilai-' + name).textContent = teks;
  el.classList.toggle('nyala', value !== 'ALL');
}

/* ==========================================================================
   BUKA, TUTUP, PILIH
   ========================================================================== */

let terbuka = null;

export function closeCombo() {
  if (!terbuka) return;
  const el = host(terbuka);
  if (el) {
    $('panel-' + terbuka).hidden = true;
    el.classList.remove('buka');
    el.querySelector('.pilih-tombol').setAttribute('aria-expanded', 'false');
  }
  terbuka = null;
}

export function toggleCombo(name) {
  const sudahBuka = terbuka === name;
  closeCombo();
  if (sudahBuka) return;

  const el = host(name);
  if (!el || !el._combo) return;
  terbuka = name;
  $('panel-' + name).hidden = false;
  el.classList.add('buka');
  el.querySelector('.pilih-tombol').setAttribute('aria-expanded', 'true');

  // Kotak cari dikosongkan tiap kali dibuka. Kata kunci yang tertinggal dari kemarin
  // membuat daftarnya terlihat pendek tanpa alasan yang terlihat.
  const cari = $('cari-' + name);
  if (cari) {
    cari.value = '';
    cari.focus();
  }
  drawOptions(name, '');
}

export function comboSearch(name) {
  drawOptions(name, ($('cari-' + name) || {}).value || '');
}

export function chooseCombo(name, value) {
  const el = host(name);
  closeCombo();
  if (el && el._combo) el._combo.onPick(value);
}

// Klik di luar dan Escape menutup. Dipasang sekali, bukan per dropdown.
document.addEventListener('click', (e) => {
  if (terbuka && !e.target.closest('#pilih-' + terbuka)) closeCombo();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeCombo();
});

// ponytail: tanpa navigasi panah atas/bawah. Daftarnya bisa dicari dan diklik, dan
// menambah roving tabindex sekarang berarti menebak kebutuhan yang belum ada. Kalau
// ada yang benar-benar memakai keyboard penuh, itu yang ditambahkan berikutnya.
