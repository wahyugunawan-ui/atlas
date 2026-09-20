/**
 * Penggolongan Warlok: satu nomor mesin -> satu dari enam golongan (docs/FUSION.md 2.3).
 *
 * MURNI. Tidak menyentuh berkas, database, maupun jaringan — yang memanggil menyiapkan
 * titik-titiknya sendiri. Itu yang membuat SELURUH tabel keputusan di bawah bisa diuji
 * dengan angka, tanpa PostgreSQL dan tanpa satu baris data sungguhan.
 *
 * Yang dijawab golongan ini: seberapa yakin kita bahwa pelanggan ini benar-benar
 * tinggal di sekitar alamat KTP-nya. Bukan "di mana dia membeli" — itu sudah dijawab
 * data penjualan yang lama.
 *
 * Titik acuannya SELALU KTP. Servis dan Pengiriman diukur jaraknya ke sana, tidak
 * pernah satu sama lain: pertanyaannya soal ikatan dengan alamat resmi, dan alamat
 * resmi cuma ada di KTP.
 */
const { distanceMeters } = require('./geo');

/**
 * Enam golongan berikut bobotnya.
 *
 * `label` nama resmi (dipakai dokumen dan database), `short` label layar — sidebar
 * dashboard cuma selebar 164 px dan nama panjang pasti terpotong. Dua nama, satu
 * tempat pemetaan; lihat DECISIONS.md 2026-09-16.
 *
 * Bobot di sini cuma BAWAAN. Nilai yang berlaku dibaca dari tabel `app_config` dan
 * dioper lewat parameter `weights` — permintaan eksplisit supaya dapat dikustom tanpa
 * deploy ulang.
 */
const SEGMENTS = {
  loyal_verified: { label: 'Warlok Loyal Verified', short: 'Warlok Loyal Verified', weight: 1.00 },
  service_near: { label: 'Warlok bengkel dekat', short: 'Warlok bengkel dekat', weight: 0.80 },
  delivery_near: { label: 'Warlok kirim dekat', short: 'Warlok kirim dekat', weight: 0.75 },
  registered_only: { label: 'Warga asli', short: 'Warga asli', weight: 0.55 },
  nomad: { label: 'Migran / Nomaden', short: 'Migran / Nomaden', weight: 0.20 },
  unverified: { label: 'Tak Terverifikasi', short: 'Tak Terverifikasi', weight: 0.05 },
};

/** Bawaan KPI Jarak: 50 km. Yang berlaku dibaca dari app_config. */
const DEFAULT_KPI_M = 50000;

/** Titik yang benar-benar punya koordinat. Sisanya berarti gagal tergeocode. */
function bertitik(p) {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

/**
 * Jarak ke titik TERDEKAT, bukan ke yang pertama atau yang paling sering.
 *
 * Kasus batas 2 di docs/FUSION.md: satu mesin servis di Sleman (8 km dari KTP) dan di
 * Cilacap (140 km). Yang dipakai 8 km. Pertanyaan yang dijawab golongan ini adalah
 * "apakah pelanggan ini punya ikatan dengan wilayah KTP-nya", dan satu servis jauh
 * saat bepergian tidak menghapus bukti bahwa dia rutin servis dekat rumah. Kunjungan
 * yang jauh tidak hilang — tetap tersimpan dan tampil utuh di drill-down.
 *
 * "Paling sering" ditolak: pada data satu bulan mayoritas mesin cuma punya satu
 * kunjungan, jadi modusnya tidak bermakna.
 */
function terdekat(ktp, points) {
  let best = null;
  (points || []).forEach((p) => {
    if (!bertitik(p)) return;
    const jarak = distanceMeters(ktp.lat, ktp.lng, p.lat, p.lng);
    if (!best || jarak < best.distance) best = { distance: jarak, point: p };
  });
  return best;
}

/**
 * Golongkan satu nomor mesin.
 *
 * URUTAN ATURANNYA MENGIKAT. Beberapa kondisi bisa terpenuhi bersamaan, dan tanpa
 * urutan yang pasti hasilnya ambigu. Urutan persis seperti docs/FUSION.md 2.3.
 *
 * @param {Object} input
 *   ktp           {lat, lng} titik desa KTP; null/tanpa koordinat = gagal tergeocode
 *   services      [{lat, lng}] titik desa tiap kunjungan servis
 *   pings         [{lat, lng}] titik GPS tiap pengiriman
 *   kpiRadiusM    ambang "berdekatan" dalam meter
 *   weights       {kode: bobot} penimpa bobot bawaan
 * @return {Object|null} null kalau BELUM bisa digolongkan (tidak ada baris KTP sama
 *   sekali — lihat kasus batas 3: ping yang datang mendahului impor KTP-nya menunggu,
 *   bukan dihitung sebagai Tak Terverifikasi)
 */
function fuseEngine(input) {
  const ktp = input.ktp;
  const services = input.services || [];
  const pings = input.pings || [];
  const kpi = Number.isFinite(input.kpiRadiusM) ? input.kpiRadiusM : DEFAULT_KPI_M;
  const bobot = (kode) => {
    const w = (input.weights || {})[kode];
    return Number.isFinite(w) ? w : SEGMENTS[kode].weight;
  };
  const jadi = (kode, extra) => Object.assign({
    segment: kode,
    weight: bobot(kode),
    kpiRadiusM: kpi,
    distServiceM: null,
    distDeliveryM: null,
    serviceLat: null,
    serviceLng: null,
    deliveryLat: null,
    deliveryLng: null,
    serviceCount: services.length,
    deliveryCount: pings.length,
  }, extra || {});

  // Tidak ada baris KTP sama sekali: BELUM bisa digolongkan, bukan Tak Terverifikasi.
  // Memasukkannya sebagai merah akan menggelembungkan angka karena alasan
  // administratif (urutan impor), bukan karena kualitas datanya.
  if (!ktp) return null;

  // 0. Acuan jaraknya sendiri tidak ada -> semua pengukuran mustahil.
  if (!bertitik(ktp)) return jadi('unverified');

  // 1. Tidak ada jejak lain sama sekali. Bukan buruk — cuma belum terlihat.
  if (!services.length && !pings.length) return jadi('registered_only');

  // 2. Ukur yang bisa diukur, dan ingat yang gagal tergeocode.
  const s = terdekat(ktp, services);
  const d = terdekat(ktp, pings);
  const adaGagal = services.some((x) => !bertitik(x)) || pings.some((x) => !bertitik(x));

  const titik = {
    distServiceM: s ? Math.round(s.distance) : null,
    distDeliveryM: d ? Math.round(d.distance) : null,
    serviceLat: s ? s.point.lat : null,
    serviceLng: s ? s.point.lng : null,
    deliveryLat: d ? d.point.lat : null,
    deliveryLng: d ? d.point.lng : null,
  };

  // Ambangnya INKLUSIF (<=), bukan <. Pembulatan koordinat 6 desimal (~11 cm) tidak
  // boleh jadi penentu golongan seseorang.
  const sDekat = s && s.distance <= kpi;
  const dDekat = d && d.distance <= kpi;

  // 3-5. Satu bukti dekat sudah cukup, dua bukti lebih baik.
  if (sDekat && dDekat) return jadi('loyal_verified', titik);
  if (sDekat) return jadi('service_near', titik);
  if (dDekat) return jadi('delivery_near', titik);

  // 6. Terukur, tapi jauh. MENDAHULUI 7 dengan sengaja: kita sudah punya bukti positif
  //    bahwa dia beraktivitas jauh dari alamat KTP-nya. "Tak Terverifikasi" disediakan
  //    hanya untuk keadaan kita benar-benar buta.
  if (s || d) return jadi('nomad', titik);

  // 7. Ada jejaknya, tapi tidak satu pun bisa dikonversi jadi titik.
  if (adaGagal) return jadi('unverified', titik);

  // Tidak terjangkau: langkah 1 sudah menangkap "tidak ada jejak sama sekali".
  return jadi('unverified', titik);
}

/** Confidence-Weighted Sales: jumlah pelanggan ditimbang keyakinan lokasinya. */
function cwSales(counts, weights) {
  return Object.entries(counts || {}).reduce((total, [kode, n]) => {
    if (!SEGMENTS[kode]) return total;
    const w = (weights || {})[kode];
    return total + n * (Number.isFinite(w) ? w : SEGMENTS[kode].weight);
  }, 0);
}

/** CW Sales dibagi jumlah pelanggan. null kalau tidak ada pelanggan sama sekali. */
function confidenceRatio(counts, weights) {
  const total = Object.values(counts || {}).reduce((a, b) => a + b, 0);
  return total ? cwSales(counts, weights) / total : null;
}

module.exports = {
  SEGMENTS, DEFAULT_KPI_M, fuseEngine, cwSales, confidenceRatio, terdekat,
};
