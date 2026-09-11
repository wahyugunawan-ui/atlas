/**
 * Mode edit ring dealer & coverage pos: pilih satu kecamatan di peta, lalu tentukan
 * kelompoknya (ring 1-3 untuk dealer, coverage 1-8 untuk pos).
 *
 * Sejak 2026-08-31 sore, ring pindah dari POS+KELURAHAN ke DEALER+KECAMATAN, dan pos
 * mendapat konsep baru coverage (1-8, juga kecamatan) — lihat docs/DECISIONS.md dan
 * komentar di backend/server/schema.sql sekitar `dealer_rings`/`pos_coverage_district`.
 *
 * KEDUA editor (dealer-ring, pos-coverage) berbagi SATU mesin (createGroupEditor di
 * bawah): alurnya identik — klik kecamatan di peta, buka pemilih, tentukan
 * kelompoknya, draft tertahan sampai Simpan ditekan — beda cuma entitasnya (dealer vs
 * outlet), jumlah slot (3 vs 8), warna, dan endpoint simpannya. Logika draft/pemilih/
 * simpan ini ~200 baris state-machine yang sama persis di kedua kasus; menduplikasinya
 * berarti merawat dua salinan yang harus tetap sinkron, jadi digeneralisasi.
 *
 * Perubahannya ditahan di sini sampai Simpan ditekan. Tanpa itu, tiap klik jadi satu
 * permintaan ke server dan membatalkan berarti membalikkan puluhan klik satu per satu.
 */
import { saveDealerRings, savePosCoverage } from './api.js';
import { $, esc, toast } from './dom.js';
import { scopeValue } from './filters.js';
import { addDistrictLayers, districtsLoaded, setGroupPaint } from './map.js';
import { S } from './state.js';

/** Warna tiap ring dealer. Satu keluarga, makin jauh makin pudar — jaraknya terbaca. */
export const RING_COLORS = { 1: '#0b2f6b', 2: '#3b6fc4', 3: '#93b4e6' };

/** Warna tiap coverage pos. Delapan warna berbeda — beda dari ring, lebih banyak slot. */
export const COVERAGE_COLORS = {
  1: '#0b2f6b', 2: '#1d4ed8', 3: '#3b6fc4', 4: '#0891b2',
  5: '#0d9488', 6: '#65a30d', 7: '#ca8a04', 8: '#c2410c',
};

/**
 * Satu mesin edit, dipakai dua kali (dealer-ring, pos-coverage) dengan konfigurasi
 * beda. Mengembalikan objek `{editing, startFor, cancel, openChooser, closeChooser,
 * assign, save}` yang statenya (draft, entityCode, dipilih) tertutup di closure —
 * dua instance tidak saling mengintip state satu sama lain.
 *
 * @param {Object} config
 * @param {'dealer'|'outlet'} config.entityType
 * @param {number} config.groupCount     3 (ring dealer) atau 8 (coverage pos)
 * @param {Object} config.colors         RING_COLORS atau COVERAGE_COLORS
 * @param {Function} config.saveFn       saveDealerRings atau savePosCoverage
 * @param {string} config.savedLabel     "Ring dealer" atau "Coverage pos", untuk toast
 * @param {string} config.kataKelompok   "ring" atau "coverage", untuk teks status
 */
function createGroupEditor({ entityType, groupCount, colors, saveFn, savedLabel, kataKelompok }) {
  /** Salinan kerja: {districtCode: number}. Null berarti mode edit sedang mati. */
  let draft = null;
  /** Dealer/outlet yang kelompoknya sedang disunting. */
  let entityCode = null;
  /** Kecamatan yang pemilih kelompoknya sedang terbuka. */
  let dipilih = null;

  const editing = () => draft !== null;

  function sumberData() {
    return entityType === 'dealer' ? S.dealerRings : S.posCoverage;
  }

  function namaEntitas(code) {
    const tabel = entityType === 'dealer' ? S.dealerByCode : S.outletByCode;
    return (tabel[code] || {}).name || code;
  }

  /**
   * Batas kecamatan dimuat DI SINI, bukan saat halaman dibuka: berkasnya lumayan
   * besar dan sebagian besar sesi tidak pernah menyunting ring/coverage sama sekali.
   */
  async function startFor(code) {
    if (!code) return undefined;
    entityCode = code;
    draft = Object.assign({}, sumberData()[code] || {});

    // Mode Tampilan Ring Dealer/Coverage POS dan mode edit berbagi layer kec-isi yang
    // sama — matikan sorotan lihat-saja begitu masuk mode edit, supaya dua-duanya
    // tidak berebut mewarnai layer yang sama (lihat paintGroupView() di map.js).
    S.ringView = { mode: null, value: null };

    $('ring-mode-label').textContent = `Edit ${kataKelompok}`;
    $('ring-nama').textContent = namaEntitas(code);
    $('ring-bantuan').textContent = 'Klik satu kecamatan di peta, lalu pilih kelompoknya.';
    $('ring-bar').classList.remove('hidden');
    renderBar();

    if (!districtsLoaded()) {
      $('ring-pesan').textContent = 'Memuat batas kecamatan...';
      try {
        await addDistrictLayers();
      } catch (error) {
        $('ring-pesan').textContent = 'Batas kecamatan tidak bisa dimuat: ' + error.message;
        return undefined;
      }
    }
    $('ring-pesan').textContent = '';
    setGroupPaint(draft, colors);
    return undefined;
  }

  function cancel() {
    draft = null;
    entityCode = null;
    closeChooser();
    $('ring-bar').classList.add('hidden');
    setGroupPaint(null, colors);
  }

  function openChooser(code, name, event) {
    if (!draft) return;
    dipilih = code;

    const nama = name || S.districtNames[code] || code;
    const sekarang = draft[code] || 0;
    $('rp-kec-nama').textContent = nama;
    $('rp-kec-kode').textContent = code;
    $('rp-kec-status').textContent = sekarang
      ? `sekarang ${kataKelompok} ${sekarang}`
      : 'belum masuk kelompok';

    const kontainer = $('rp-tombol-ring');
    kontainer.innerHTML = Array.from({ length: groupCount }, (_, i) => i + 1).map((g) => {
      const aktif = sekarang === g;
      return `<button type="button" onclick="assignRing(${g})" ` +
        `class="rp-ring px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 ` +
        `${aktif ? 'aktif' : 'text-slate-600'}" ` +
        `style="background:${aktif ? colors[g] : ''}">${g}</button>`;
    }).join('');
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

  function closeChooser() {
    dipilih = null;
    const kotak = $('ring-pilih');
    if (kotak) kotak.classList.add('hidden');
  }

  /** @param {number} num  1..groupCount, atau 0 untuk melepas */
  function assign(num) {
    if (!draft || !dipilih) return;
    const nomor = Number(num);
    if (!nomor) delete draft[dipilih];
    else draft[dipilih] = nomor;
    closeChooser();
    setGroupPaint(draft, colors);
    renderBar();
  }

  /**
   * Bilah alat: berapa kecamatan di tiap kelompok, dan nama-namanya. Cuma penanda,
   * bukan kendali — yang mengendalikan adalah klik di peta.
   */
  function renderBar() {
    const isi = draft || {};
    const kontainer = $('ring-kotak-list');
    kontainer.innerHTML = Array.from({ length: groupCount }, (_, i) => i + 1).map((g) => {
      const kode = Object.keys(isi).filter((c) => isi[c] === g);
      const nama = kode.map((c) => S.districtNames[c] || c).sort((a, b) => a.localeCompare(b));
      const label = entityType === 'dealer' ? `Ring ${g}` : `Cov ${g}`;
      return `<div class="ring-kotak"><span class="text-[10px] uppercase font-bold ` +
        `text-slate-400 tracking-wider">${esc(label)} <span class="n text-slate-800">` +
        `${nama.length}</span></span><span class="isi" title="${esc(nama.join(', '))}">` +
        `${nama.length ? esc(nama.join(', ')) : '—'}</span></div>`;
    }).join('');
    $('ring-simpan').disabled = false;
  }

  async function save() {
    if (!draft || !entityCode) return;
    $('ring-simpan').disabled = true;
    $('ring-pesan').textContent = 'Menyimpan...';
    try {
      await saveFn(entityCode, draft);
      // Salinan di S diperbarui langsung supaya kolom di Master Dealer/Pos dan
      // hitungan ring/coverage ikut berubah tanpa memuat ulang seluruh ringkasan.
      sumberData()[entityCode] = Object.assign({}, draft);
      const jumlah = Object.keys(draft).length;
      cancel();
      toast(`${savedLabel} tersimpan: ${jumlah} kecamatan.`, 'ok');
      window.renderAll();
    } catch (error) {
      $('ring-pesan').textContent = error.message;
      $('ring-simpan').disabled = false;
    }
  }

  return { editing, startFor, cancel, openChooser, closeChooser, assign, save };
}

const dealerRingEditor = createGroupEditor({
  entityType: 'dealer', groupCount: 3, colors: RING_COLORS,
  saveFn: saveDealerRings, savedLabel: 'Ring dealer', kataKelompok: 'ring',
});

const posCoverageEditor = createGroupEditor({
  entityType: 'outlet', groupCount: 8, colors: COVERAGE_COLORS,
  saveFn: savePosCoverage, savedLabel: 'Coverage pos', kataKelompok: 'coverage',
});

/** Editor yang sedang aktif, atau null kalau tidak ada satu pun yang sedang disunting. */
function activeEditor() {
  if (dealerRingEditor.editing()) return dealerRingEditor;
  if (posCoverageEditor.editing()) return posCoverageEditor;
  return null;
}

export const ringEditing = () => dealerRingEditor.editing();
export const coverageEditing = () => posCoverageEditor.editing();
/** Dipakai map.js: kec-isi jangan disentuh mode lihat selagi SALAH SATU editor aktif. */
export const anyGroupEditing = () => Boolean(activeEditor());

/**
 * Mulai edit ring satu dealer. Tanpa argumen: pakai dealer yang sedang dipilih di
 * filter (scope). Beda dari versi lama (per-outlet): ring sekarang langsung milik
 * dealer, tidak perlu lagi memilih pos dulu.
 */
export function startRingEdit(dealerCode) {
  const code = dealerCode || scopeValue('dealer');
  if (!code || code === 'ALL') {
    toast('Pilih dealer dulu sebelum menyunting ring.', 'error');
    return undefined;
  }
  return dealerRingEditor.startFor(code);
}

/**
 * Mulai edit coverage satu pos. Tanpa argumen: pakai pos yang sedang dipilih di
 * filter (scope).
 */
export function startCoverageEdit(outletCode) {
  const code = outletCode || scopeValue('pos');
  if (!code || code === 'ALL') {
    toast('Pilih pos dulu sebelum menyunting coverage.', 'error');
    return undefined;
  }
  return posCoverageEditor.startFor(code);
}

/**
 * Dipanggil dari tombol "Edit ring/coverage" di bilah ruang lingkup dan pojok peta
 * (satu tombol, dua kemungkinan aksi) — dealer scope buka editor ring, pos scope
 * buka editor coverage. app.js yang memutuskan label tombolnya, fungsi ini yang
 * memutuskan aksinya, keduanya membaca scope yang sama supaya tidak pernah berbeda.
 */
export function startGroupEdit() {
  if (scopeValue('dealer') !== 'ALL') return startRingEdit();
  if (scopeValue('pos') !== 'ALL') return startCoverageEdit();
  return undefined;
}

export function cancelRingEdit() {
  const editor = activeEditor();
  if (editor) editor.cancel();
}

export function openRingChooser(code, name, event) {
  const editor = activeEditor();
  if (editor) editor.openChooser(code, name, event);
}

export function closeRingChooser() {
  dealerRingEditor.closeChooser();
  posCoverageEditor.closeChooser();
}

export function assignRing(num) {
  const editor = activeEditor();
  if (editor) editor.assign(num);
}

export function saveRingEdit() {
  const editor = activeEditor();
  return editor ? editor.save() : undefined;
}
