/**
 * Konfigurasi halaman.
 *
 * Satu-satunya tempat menyetel dari mana data diambil dan basemap mana yang dipakai.
 */

/** Data bisnis: dilayani server dari PostgreSQL. */
export const API = '/api/';

/** Berkas geo: blob statis yang nyaris tidak pernah berubah. */
export const GEO_BASE = '/data/';

/**
 * Basemap.
 *
 * 'lokal' memakai berkas .pmtiles di server — tidak butuh internet sama sekali, dan
 * itu yang dipakai sehari-hari di jaringan kantor.
 *
 * 'satelit' memakai citra Esri dan JELAS butuh internet. Diminta di meeting untuk
 * presentasi; kalau jaringannya menutup akses keluar, petanya akan kosong dan
 * halaman memberi tahu, bukan diam saja.
 */
export const BASEMAP_PMTILES = GEO_BASE + 'cakupan.pmtiles';
export const BASEMAP_SATELLITE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
export const ATTRIBUTION_SATELLITE = 'Citra: Esri, Maxar, Earthstar Geographics';

/**
 * Radius acuan target di sekitar outlet. Acuan, bukan capaian.
 *
 * NILAI AWAL saja. Radius yang sedang dipakai ada di S.radiusM dan berubah waktu
 * tombol 3/5/7/10 km ditekan. Jangan dipakai untuk menggambar atau menghitung —
 * lingkaran radius di peta pernah memakai konstanta ini dan akibatnya diam di 5 km
 * sementara seluruh persentase di layar ikut berubah.
 */
export const RADIUS_METERS = 5000;

/** Batas baris tabel. Di atas ini halaman jadi lambat tanpa menambah informasi. */
export const TABLE_ROW_LIMIT = 400;

/** Konsumen yang ditampilkan sekaligus di panel kelurahan. */
export const CUSTOMER_PANEL_LIMIT = 60;

export const PROVINCE_NAMES = { '33': 'Jawa Tengah', '34': 'DI Yogyakarta' };

export const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
  'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/**
 * Kolom nomor mesin dan bukti foto rumah.
 *
 * Dimatikan karena datanya memang tidak ada: berkas bulanan dari Astra cuma punya 14
 * kolom, dan tidak satu pun berisi nomor mesin. Foto menunggu aplikasi mobile.
 *
 * Kolomnya sudah dirancang di prototipe dan tinggal dinyalakan di sini begitu
 * datanya masuk — bukan dihapus, supaya tidak perlu dirancang ulang.
 */
export const SHOW_ENGINE_NUMBER = false;
export const SHOW_HOUSE_PHOTO = false;
