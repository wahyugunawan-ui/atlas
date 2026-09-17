/**
 * Alasan penggolongan satu Nomor Mesin, dalam kalimat — dan posisi titiknya.
 *
 * Murni: angka masuk, teks dan koordinat relatif keluar. Tidak menyentuh DOM maupun
 * jaringan, jadi bisa diuji apa adanya.
 *
 * KENAPA ADA SAMA SEKALI. Golongan yang cuma ditulis namanya ("Migran / Nomaden")
 * memaksa pembaca percaya begitu saja. Yang membuatnya bisa DIPERIKSA adalah jaraknya
 * dibanding ambang yang berlaku saat itu — dan ambang itu bisa berubah (KPI Jarak
 * tersimpan per baris di `kpi_radius_m`, bukan dibaca ulang dari setelan sekarang).
 * Jadi kalimatnya selalu menyebut ambang yang DIPAKAI waktu golongan itu dihitung,
 * bukan ambang hari ini.
 */
import { SEGMENTS, SUMBER } from './fusion-segments.js';

/** Angka gaya Indonesia: koma sebagai desimal. */
function koma(nilai, desimal) {
  return Number(nilai).toFixed(desimal).replace('.', ',');
}

/**
 * Angka yang benar-benar angka. Kosong -> NaN, BUKAN nol.
 *
 * `Number(null)` bernilai 0, dan 0 itu finite. Jadi penjaga yang ditulis
 * `Number.isFinite(Number(x))` LOLOS untuk koordinat yang kosong, lalu jaraknya
 * dihitung terhadap garis khatulistiwa — menghasilkan ratusan kilometer yang tampak
 * masuk akal dan tidak tertangkap mata. Sudah kejadian di berkas ini; tesnya yang
 * menemukan. `Number(undefined)` NaN, tapi `Number(null)` dan `Number('')` sama-sama
 * 0, jadi ketiganya harus ditangani di satu tempat.
 */
function angka(nilai) {
  if (nilai === null || nilai === undefined || nilai === '') return NaN;
  return Number(nilai);
}

/**
 * Jarak untuk dibaca orang.
 *
 * Di bawah 1 km ditulis meter — "0,3 km" menyembunyikan bedanya 300 m dan 900 m,
 * padahal di skala itulah "dekat" jadi pertanyaan yang menarik.
 */
export function formatJarak(meter) {
  const m = angka(meter);
  if (!Number.isFinite(m)) return null;
  if (m < 1000) return `${Math.round(m)} m`;
  return `${koma(m / 1000, 1)} km`;
}

/** Bobot golongan, dua desimal gaya Indonesia. */
export function formatBobot(bobot) {
  const b = Number(bobot);
  return Number.isFinite(b) ? koma(b, 2) : '—';
}

/**
 * Satu baris alasan untuk satu sumber.
 *
 * Membedakan TIGA keadaan, dan bedanya penting:
 *   - tidak ada sama sekali        -> "tidak ditemukan"
 *   - ada, tapi tidak tergeocode   -> "tidak bisa diukur" (BUKAN "tidak ada")
 *   - ada dan terukur              -> jarak vs ambang
 * Menyamakan dua yang pertama membuat data yang gagal dikonversi terlihat seperti
 * data yang memang tidak pernah ada, dan itu menutupi masalah kualitas data.
 */
function barisSumber(nama, jumlah, jarakM, ambangM) {
  const n = Number(jumlah) || 0;
  if (!n) return `${nama} tidak ditemukan.`;

  const jarak = formatJarak(jarakM);
  if (jarak == null) {
    return `${nama} ada (${n}×) tapi titiknya tidak bisa diukur — alamatnya gagal ` +
      `dikonversi jadi koordinat.`;
  }

  const ambang = formatJarak(ambangM);
  const dekat = Number(jarakM) <= Number(ambangM);
  return `${nama} berjarak ${jarak} dari KTP (KPI Jarak: ${ambang}) → ${
    dekat ? 'berdekatan' : 'jauh'}.`;
}

/**
 * Alasan lengkap: beberapa baris pengukuran + satu kesimpulan.
 *
 * @param {Object} f baris customer_fusion (camelCase dari API)
 * @returns {{bagian: string[], kesimpulan: string, golongan: Object|null}}
 */
export function kalimatAlasan(f) {
  const fusion = f || {};
  const ambang = fusion.kpiRadiusM;
  const bagian = [];

  // Titik KTP adalah acuan SEMUA jarak. Tanpa dia tidak ada yang bisa diukur, dan
  // itu satu-satunya jalan menuju "Tak Terverifikasi".
  const adaKtp = Number.isFinite(angka(fusion.ktpLat)) &&
    Number.isFinite(angka(fusion.ktpLng));
  if (!adaKtp) {
    bagian.push('Titik KTP tidak tergeocode, jadi tidak ada jarak yang bisa diukur ' +
      'sama sekali.');
  } else {
    bagian.push(barisSumber('Servis', fusion.serviceCount, fusion.distServiceM, ambang));
    bagian.push(barisSumber('Kirim', fusion.deliveryCount, fusion.distDeliveryM, ambang));
  }

  const golongan = SEGMENTS[fusion.segment] || null;
  const kesimpulan = golongan
    ? `${golongan.label} (bobot ${formatBobot(fusion.weight)})`
    : 'Golongan tidak dikenal';

  return { bagian, kesimpulan, golongan };
}

/**
 * Posisi Servis dan Kirim RELATIF terhadap KTP, dalam meter (x timur, y utara).
 *
 * Dipakai diagram skematik di panel telusur. Proyeksi datar sederhana sudah cukup:
 * jaraknya puluhan kilometer, dan yang digambar perbandingan terhadap lingkaran
 * ambang — bukan peta yang dipakai menavigasi.
 */
export function titikRelatif(f) {
  const fusion = f || {};
  const lat0 = angka(fusion.ktpLat);
  const lng0 = angka(fusion.ktpLng);
  if (!Number.isFinite(lat0) || !Number.isFinite(lng0)) return [];

  const perDerajatLng = 111320 * Math.cos(lat0 * Math.PI / 180);
  const hasil = [];
  const tambah = (jenis, lat, lng, n) => {
    if (!Number(n)) return;
    const la = angka(lat);
    const ln = angka(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
    hasil.push({ jenis, x: (ln - lng0) * perDerajatLng, y: (la - lat0) * 111320 });
  };
  tambah('servis', fusion.serviceLat, fusion.serviceLng, fusion.serviceCount);
  tambah('kirim', fusion.deliveryLat, fusion.deliveryLng, fusion.deliveryCount);
  return hasil;
}

/**
 * Skala diagram: berapa meter yang harus muat di dalam setengah lebar gambar.
 *
 * Selalu memuat lingkaran ambang UTUH, dan juga titik terjauh kalau ia di luar
 * lingkaran. Kalau titik yang jauh dibiarkan terpotong, "jauh" jadi tidak terlihat
 * jauh — padahal itu justru yang ingin ditunjukkan.
 */
/**
 * Fitur GeoJSON satu mesin untuk digambar di PETA SUNGGUHAN: tiga titik dan garis
 * penghubung dari KTP ke tiap titik lain.
 *
 * Berbeda dari `titikRelatif()` yang menghasilkan offset meter untuk diagram
 * skematik; di sini yang dipakai koordinat aslinya, karena petanya punya latar.
 *
 * Tentang PII: koordinat ini datang dari jawaban telusur yang sudah berpagar
 * (`piiLimiter` + `logCustomerAccess`) dan hanya untuk SATU mesin yang memang sedang
 * dibuka. Ini beda dengan lapisan titik massal, yang sengaja TIDAK pernah membawa
 * pengenal per orang — lihat fusion-points.js.
 *
 * Titik KTP selalu jadi pangkal. Tanpa koordinat KTP tidak ada yang bisa digambar
 * sama sekali: garis tanpa pangkal akan tersambung ke titik nol derajat, dan itu
 * jatuh di Teluk Guinea — kelihatan seperti data, padahal bukan.
 */
export function fiturTelusur(f) {
  const fusion = f || {};
  const lat0 = angka(fusion.ktpLat);
  const lng0 = angka(fusion.ktpLng);
  if (!Number.isFinite(lat0) || !Number.isFinite(lng0)) return [];

  const titik = (jenis, lng, lat) => ({
    type: 'Feature',
    properties: { jenis, warna: SUMBER[jenis].color },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  });

  const fitur = [titik('ktp', lng0, lat0)];

  [['servis', fusion.serviceLat, fusion.serviceLng, fusion.serviceCount],
    ['kirim', fusion.deliveryLat, fusion.deliveryLng, fusion.deliveryCount],
  ].forEach(([jenis, lat, lng, jumlah]) => {
    if (!Number(jumlah)) return;
    const la = angka(lat);
    const ln = angka(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
    fitur.push({
      type: 'Feature',
      properties: { jenis, warna: SUMBER[jenis].color },
      geometry: { type: 'LineString', coordinates: [[lng0, lat0], [ln, la]] },
    });
    fitur.push(titik(jenis, ln, la));
  });

  return fitur;
}

export function jangkauanDiagram(f, titik) {
  const ambang = Number((f || {}).kpiRadiusM) || 0;
  const terjauh = (titik || []).reduce(
    (maks, t) => Math.max(maks, Math.hypot(t.x, t.y)), 0);
  return Math.max(ambang, terjauh) * 1.15 || 1;
}
