/**
 * Panggilan ke server. Satu-satunya modul yang tahu bentuk URL-nya.
 *
 * Semua permintaan lewat sini, dan semuanya melempar Error dengan pesan yang sudah
 * bisa dibaca orang. Kegagalan jaringan dan kegagalan server butuh tindakan yang
 * berbeda, jadi pesannya juga harus berbeda — bukan sama-sama "terjadi kesalahan".
 */
import { API, GEO_BASE } from './config.js';

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error('Tidak bisa menghubungi server. Pastikan servernya masih berjalan.');
  }

  // 401 berarti sesinya habis. Yang benar bukan menampilkan pesan, tapi mengembalikan
  // orangnya ke halaman masuk — pesan "belum login" di tengah dashboard tidak
  // memberi tahu apa yang harus dilakukan.
  if (response.status === 401) {
    location.replace('/login');
    throw new Error('Sesi habis.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || `Server menjawab ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/** Seluruh isi dashboard dalam satu permintaan. */
export const fetchSummary = () => request(API + 'summary');

export const fetchPeriods = () => request(API + 'periods');

export const fetchImports = () => request(API + 'imports');

/**
 * Hapus seluruh data satu bulan.
 *
 * `confirm` harus sama persis dengan periodenya — server menolak kalau tidak, dan itu
 * disengaja. Penjaga yang cuma ada di layar bisa dilewati satu permintaan langsung ke
 * API, jadi konfirmasinya ikut dikirim, bukan cuma diperiksa di halaman.
 */
export function deletePeriod(period) {
  const query = new URLSearchParams({ confirm: period });
  return request(`${API}periods/${encodeURIComponent(period)}?${query}`,
    { method: 'DELETE' });
}

export const fetchUnmatched = (period) =>
  request(`${API}unmatched?period=${encodeURIComponent(period)}`);

/**
 * Konsumen di SATU kelurahan.
 *
 * Tidak ada versi "ambil semua". Server menolak permintaan tanpa kode kelurahan, dan
 * itu disengaja: satu akun dipakai bersama, jadi tidak boleh ada satu permintaan yang
 * bisa menyedot seluruh basis data konsumen.
 */
export function fetchCustomers(villageCode, range) {
  const query = new URLSearchParams({ village: villageCode });
  const r = range || {};
  if (r.from && r.from !== 'ALL') query.set('periodFrom', r.from);
  if (r.to && r.to !== 'ALL') query.set('periodTo', r.to);
  return request(`${API}customers?${query}`);
}

/**
 * Telusuri konsumen untuk halaman Data Konsumen.
 *
 * Penyaring yang bernilai 'ALL' atau kosong tidak dikirim sama sekali — server
 * memperlakukan parameter yang tidak ada sebagai "tanpa saringan", dan mengirim
 * 'ALL' sebagai teks akan dicari apa adanya.
 *
 * @param {Object} filters {periodFrom, periodTo, province, city, village, outlet,
 *   outlets, query, offset}
 */
export function browseCustomers(filters) {
  const query = new URLSearchParams();
  ['periodFrom', 'periodTo', 'province', 'city', 'village', 'outlet'].forEach((key) => {
    const value = filters[key];
    if (value && value !== 'ALL') query.set(key, value);
  });
  // Dealer diterjemahkan jadi daftar kode pos miliknya oleh pemanggil: tabel konsumen
  // tidak menyimpan kode dealer, dan tabel outlets ada di database yang berbeda.
  if (filters.outlets && filters.outlets.length) {
    query.set('outlets', filters.outlets.join(','));
  }
  if (filters.query) query.set('q', filters.query);
  if (filters.offset) query.set('offset', filters.offset);
  return request(`${API}customers/browse?${query}`);
}

/** Tambah pos dealer baru. Kodenya dari pengguna — server menolak kalau sudah ada. */
export function createOutlet(data) {
  return request(`${API}outlets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

/** Nama yang menunggu dicocokkan beserta sarannya, plus alias yang sudah tersimpan. */
export const fetchAliases = () => request(`${API}village-aliases`);

/**
 * Konfirmasi satu ejaan Excel menunjuk kelurahan mana.
 *
 * Kodenya selalu diambil dari daftar yang dikirim server, tidak pernah diketik —
 * kode kelurahan itu kode BPS dan tidak boleh lahir dari nama.
 */
export function saveAlias(data) {
  return request(`${API}village-aliases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function deleteAlias(cityCode, districtName, villageName) {
  const query = new URLSearchParams({ cityCode, districtName, villageName });
  return request(`${API}village-aliases?${query}`, { method: 'DELETE' });
}

export function saveOutlet(code, patch) {
  return request(`${API}outlets/${encodeURIComponent(code)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/**
 * Unggah berkas bulanan.
 *
 * Memakai XMLHttpRequest, bukan fetch, semata karena butuh progress unggahan —
 * fetch belum punya cara melaporkannya. Berkasnya ±2,5 MB dan pengunggahnya
 * menunggu; bar yang bergerak itu yang membedakan "sedang jalan" dari "menggantung".
 */
export function uploadImport({ file, period, onProgress }) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('period', period);
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', API + 'import');

    xhr.upload.addEventListener('progress', (e) => {
      if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
    });

    xhr.addEventListener('load', () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* bukan JSON */ }
      if (xhr.status === 401) { location.replace('/login'); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Server menjawab ${xhr.status}.`));
    });
    xhr.addEventListener('error', () =>
      reject(new Error('Sambungan terputus saat mengunggah.')));

    xhr.send(form);
  });
}

/** Berkas geo. Dilayani statis, bukan dari database. */
export async function fetchGeo(name) {
  const response = await fetch(GEO_BASE + name, { cache: 'default' });
  if (response.status === 401) { location.replace('/login'); throw new Error('Sesi habis.'); }
  if (!response.ok) {
    throw new Error(`Berkas peta ${name} tidak ada di server (${response.status}). ` +
      'Periksa folder data/geo.');
  }
  return response.json();
}
