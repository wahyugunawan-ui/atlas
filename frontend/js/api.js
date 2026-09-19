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

/** Daftar kecamatan, untuk pemilih ring. */
/* --- penyatuan tiga sumber (docs/FUSION.md) ---------------------------------
   Semua lewat request() yang sama: 401 tetap mengembalikan orang ke halaman
   masuk, bukan memunculkan pesan di tengah dashboard. */

/** Angka golongan + baris rollup, tersaring kota/dealer/golongan. */
export function fetchSegmentation(filter) {
  const q = new URLSearchParams();
  if (filter && filter.periode) q.set('periode', filter.periode);
  if (filter && filter.kota && filter.kota !== 'ALL') q.set('kota', filter.kota);
  // Karesidenan: satu parameter `kota` berisi DAFTAR kode, dipisah koma. Mengikuti
  // pola `outlets` yang sudah ada di /api/customers/browse — server memvalidasi tiap
  // kode satu per satu, bukan menerima daftarnya bulat-bulat.
  else if (filter && filter.kotaBanyak && filter.kotaBanyak.length) {
    q.set('kota', filter.kotaBanyak.join(','));
  }
  if (filter && filter.dealer && filter.dealer !== 'ALL') q.set('dealer', filter.dealer);
  if (filter && filter.pos && filter.pos !== 'ALL') q.set('pos', filter.pos);
  if (filter && filter.segmentasi) q.set('segmentasi', filter.segmentasi);
  return request(`${API}v1/segmentasi?${q}`);
}

/** Peringkat kota dan dealer sekaligus — satu permintaan, dua panel. */
export function fetchPeringkat(filter) {
  const q = new URLSearchParams();
  if (filter && filter.periode) q.set('periode', filter.periode);
  if (filter && filter.kota && filter.kota !== 'ALL') q.set('kota', filter.kota);
  // Karesidenan: satu parameter `kota` berisi DAFTAR kode, dipisah koma. Mengikuti
  // pola `outlets` yang sudah ada di /api/customers/browse — server memvalidasi tiap
  // kode satu per satu, bukan menerima daftarnya bulat-bulat.
  else if (filter && filter.kotaBanyak && filter.kotaBanyak.length) {
    q.set('kota', filter.kotaBanyak.join(','));
  }
  if (filter && filter.dealer && filter.dealer !== 'ALL') q.set('dealer', filter.dealer);
  if (filter && filter.pos && filter.pos !== 'ALL') q.set('pos', filter.pos);
  return request(`${API}v1/peringkat?${q}`);
}

/** Irisan sumber data (Venn) — region-nya sudah dipetakan server. */
export function fetchIrisan(filter) {
  const q = new URLSearchParams();
  if (filter && filter.periode) q.set('periode', filter.periode);
  if (filter && filter.kota && filter.kota !== 'ALL') q.set('kota', filter.kota);
  // Karesidenan: satu parameter `kota` berisi DAFTAR kode, dipisah koma. Mengikuti
  // pola `outlets` yang sudah ada di /api/customers/browse — server memvalidasi tiap
  // kode satu per satu, bukan menerima daftarnya bulat-bulat.
  else if (filter && filter.kotaBanyak && filter.kotaBanyak.length) {
    q.set('kota', filter.kotaBanyak.join(','));
  }
  if (filter && filter.dealer && filter.dealer !== 'ALL') q.set('dealer', filter.dealer);
  if (filter && filter.pos && filter.pos !== 'ALL') q.set('pos', filter.pos);
  return request(`${API}v1/irisan?${q}`);
}

/** Matriks Kota x Golongan, sudah dipivot dan diurutkan server. */
export function fetchMatriks(filter) {
  const q = new URLSearchParams();
  if (filter && filter.periode) q.set('periode', filter.periode);
  if (filter && filter.kota && filter.kota !== 'ALL') q.set('kota', filter.kota);
  // Karesidenan: satu parameter `kota` berisi DAFTAR kode, dipisah koma. Mengikuti
  // pola `outlets` yang sudah ada di /api/customers/browse — server memvalidasi tiap
  // kode satu per satu, bukan menerima daftarnya bulat-bulat.
  else if (filter && filter.kotaBanyak && filter.kotaBanyak.length) {
    q.set('kota', filter.kotaBanyak.join(','));
  }
  if (filter && filter.dealer && filter.dealer !== 'ALL') q.set('dealer', filter.dealer);
  if (filter && filter.pos && filter.pos !== 'ALL') q.set('pos', filter.pos);
  return request(`${API}v1/matriks?${q}`);
}

/**
 * Cakupan sumber per kota atau per dealer.
 *
 * Pengelompokannya ditentukan SERVER dari ada/tidaknya saringan kota, dan dikembalikan
 * lewat field `groupBy` — layar tidak menebaknya sendiri, supaya judul panel tidak
 * pernah bisa berbeda dari isinya.
 */
export function fetchCakupanSumber(filter) {
  const q = new URLSearchParams();
  if (filter && filter.periode) q.set('periode', filter.periode);
  if (filter && filter.kota && filter.kota !== 'ALL') q.set('kota', filter.kota);
  // Karesidenan: satu parameter `kota` berisi DAFTAR kode, dipisah koma. Mengikuti
  // pola `outlets` yang sudah ada di /api/customers/browse — server memvalidasi tiap
  // kode satu per satu, bukan menerima daftarnya bulat-bulat.
  else if (filter && filter.kotaBanyak && filter.kotaBanyak.length) {
    q.set('kota', filter.kotaBanyak.join(','));
  }
  if (filter && filter.dealer && filter.dealer !== 'ALL') q.set('dealer', filter.dealer);
  if (filter && filter.pos && filter.pos !== 'ALL') q.set('pos', filter.pos);
  return request(`${API}v1/cakupan-sumber?${q}`);
}

/** Ambang KPI Jarak yang sedang berlaku, untuk menggambar lingkaran radius di peta. */
export const fetchKpiJarak = () => request(`${API}v1/konfigurasi/kpi-jarak`);

/**
 * Hitungan titik KTP/Servis/Pengiriman per kelurahan, untuk tiga lapisan peta.
 *
 * Jawabannya hitungan, BUKAN koordinat — alasannya ada di rutenya dan di
 * fusion-points.js. Petanya sendiri yang menyebar titik di dalam poligon kelurahan.
 */
export function fetchTitikPeta(filter) {
  const q = new URLSearchParams();
  if (filter && filter.periode) q.set('periode', filter.periode);
  if (filter && filter.kota && filter.kota !== 'ALL') q.set('kota', filter.kota);
  // Karesidenan: satu parameter `kota` berisi DAFTAR kode, dipisah koma. Mengikuti
  // pola `outlets` yang sudah ada di /api/customers/browse — server memvalidasi tiap
  // kode satu per satu, bukan menerima daftarnya bulat-bulat.
  else if (filter && filter.kotaBanyak && filter.kotaBanyak.length) {
    q.set('kota', filter.kotaBanyak.join(','));
  }
  if (filter && filter.dealer && filter.dealer !== 'ALL') q.set('dealer', filter.dealer);
  if (filter && filter.pos && filter.pos !== 'ALL') q.set('pos', filter.pos);
  return request(`${API}v1/peta/titik?${q}`);
}

/**
 * Hapus SATU jenis data untuk SATU periode.
 *
 * Konfirmasinya ikut dikirim, bukan cuma diperiksa di layar — persis alasan yang sama
 * dengan deletePeriod(): penjaga yang hanya ada di halaman bisa dilewati satu
 * permintaan langsung ke API.
 */
export function deleteSumberPeriode(source, period) {
  const query = new URLSearchParams({ confirm: period });
  return request(
    `${API}v1/sumber/${encodeURIComponent(source)}/${encodeURIComponent(period)}?${query}`,
    { method: 'DELETE' });
}

/**
 * Daftar baris Data Servis. RUTE PII — dibatasi laju dan dicatat di server.
 *
 * Bentuk jawabannya {rows, total, limit, offset}, sama dengan browseCustomers.
 */
export function fetchServis(filter) {
  const q = new URLSearchParams();
  const f = filter || {};
  if (f.periodFrom) q.set('periodFrom', f.periodFrom);
  if (f.periodTo) q.set('periodTo', f.periodTo);
  if (f.city && f.city !== 'ALL') q.set('city', f.city);
  if (f.village && f.village !== 'ALL') q.set('village', f.village);
  if (f.query) q.set('q', f.query);
  if (f.offset) q.set('offset', f.offset);
  return request(`${API}v1/servis?${q}`);
}

/** Daftar ping pengiriman. RUTE PII — titik GPS rumah, jadi pagarnya sama. */
export function fetchPengiriman(filter) {
  const q = new URLSearchParams();
  const f = filter || {};
  if (f.periodFrom) q.set('periodFrom', f.periodFrom);
  if (f.periodTo) q.set('periodTo', f.periodTo);
  if (f.query) q.set('q', f.query);
  if (f.offset) q.set('offset', f.offset);
  return request(`${API}v1/pengiriman?${q}`);
}

/** Rincian satu nomor mesin. RUTE PII — dibatasi laju dan dicatat di server. */
export const fetchEngineDetail = (engineNo) =>
  request(`${API}v1/mesin/${encodeURIComponent(engineNo)}`);

/**
 * Daftar pelanggan satu kantong (kelurahan, dealer) di balik satu titik peta.
 *
 * RUTE PII — dibatasi laju dan dicatat di server, jadi ia HANYA boleh dipanggil dari
 * perbuatan yang disengaja (klik titik, atau berhenti 3 detik di atasnya), tidak
 * pernah dari gerakan kursor biasa. Lihat komentar rutenya di routes.js.
 */
export function fetchVillageCustomers(village, opsi) {
  const o = opsi || {};
  const q = new URLSearchParams();
  if (o.dealer) q.set('dealer', o.dealer);
  if (o.periode) q.set('periode', o.periode);
  const tanya = q.toString();
  return request(`${API}v1/kelurahan/${encodeURIComponent(village)}/pelanggan${
    tanya ? `?${tanya}` : ''}`);
}

export function fetchDistricts() {
  return request(`${API}districts`);
}

/**
 * Simpan ring satu dealer. Badannya gambaran LENGKAP, bukan tambalan — yang tidak
 * ikut dikirim berarti dilepas, dan itu memang yang dilihat orang di layar.
 */
export function saveDealerRings(dealerCode, rings) {
  return request(`${API}dealers/${encodeURIComponent(dealerCode)}/rings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rings }),
  });
}

/** Simpan coverage satu pos. Pola sama persis dengan saveDealerRings di atas. */
export function savePosCoverage(outletCode, coverage) {
  return request(`${API}outlets/${encodeURIComponent(outletCode)}/coverage`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coverage }),
  });
}

/** Kosongkan master pos dan dealer. Konfirmasinya diperiksa lagi di server. */
export function resetOutlets() {
  return request(`${API}outlets?confirm=RESET`, { method: 'DELETE' });
}

/**
 * Telusuri konsumen untuk halaman Data Konsumen.
 *
 * Penyaring yang bernilai 'ALL' atau kosong tidak dikirim sama sekali — server
 * memperlakukan parameter yang tidak ada sebagai "tanpa saringan", dan mengirim
 * 'ALL' sebagai teks akan dicari apa adanya.
 *
 * @param {Object} filters {periodFrom, periodTo, province, city, village, dealer,
 *   query, offset}
 */
export function browseCustomers(filters) {
  const query = new URLSearchParams();
  // 'dealer' LANGSUNG, bukan lagi daftar 'outlets'. Halaman ini membaca customer_ktp
  // sejak 2026-09-18, dan tabel itu menyimpan dealer_code sendiri — terjemahan
  // "satu dealer -> daftar pos miliknya" yang dulu terpaksa dilakukan di sini tidak
  // diperlukan lagi. Pos sendiri tidak ada di data KTP, jadi tidak ikut dikirim.
  ['periodFrom', 'periodTo', 'province', 'city', 'village', 'dealer'].forEach((key) => {
    const value = filters[key];
    if (value && value !== 'ALL') query.set(key, value);
  });
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

/** Tambah dealer baru. Kodenya diturunkan server dari nama, tidak dikirim dari sini. */
export function createDealer(data) {
  return request(`${API}dealers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function saveDealer(code, patch) {
  return request(`${API}dealers/${encodeURIComponent(code)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** Ditolak server (400) kalau dealer masih punya pos. */
export function deleteDealer(code) {
  return request(`${API}dealers/${encodeURIComponent(code)}`, { method: 'DELETE' });
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

/**
 * Unggah Data KTP atau Data Servis.
 *
 * Bentuknya SAMA PERSIS dengan uploadImport() di atas — multipart `period` + `file`,
 * XMLHttpRequest demi progress — karena `importSumber` di server memang memakai
 * parser multipart yang sama. Dipisah jadi fungsi sendiri, bukan parameter tambahan
 * di uploadImport(), supaya rutenya tidak pernah bisa tertukar: yang satu menulis
 * data penjualan, yang satu lagi data penyatuan tiga sumber.
 *
 * `source` dibatasi dua nilai. Menyusun URL dari teks bebas berarti satu salah ketik
 * menghasilkan permintaan ke rute yang tidak ada, dan pesannya akan membingungkan.
 */
export function uploadSumber({ source, file, period, onProgress }) {
  if (source !== 'ktp' && source !== 'servis') {
    return Promise.reject(new Error(`Jenis data "${source}" tidak dikenal.`));
  }

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('period', period);
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}v1/import/${source}`);

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

/**
 * Baca sheet "Dealer" dari Excel dan bandingkan dengan pos yang sudah ada. Tidak
 * mengubah apa pun di server — cuma menghitung bedanya dan menyimpan hasilnya
 * sebentar di balik previewToken.
 */
export async function previewOutletImport(file) {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(API + 'outlets/import/preview', { method: 'POST', body: form });
  if (response.status === 401) { location.replace('/login'); throw new Error('Sesi habis.'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Server menjawab ${response.status}.`);
  return body;
}

/** Terapkan hasil pratinjau. previewToken kedaluwarsa 1 jam sejak dibuat. */
export function commitOutletImport(previewToken) {
  return request(`${API}outlets/import/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewToken }),
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
