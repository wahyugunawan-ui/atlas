/**
 * Uji tabel keputusan Golongan Warlok (docs/FUSION.md 2.3).
 *
 * Seluruh enam golongan, urutan aturannya, dan tiga kasus batas yang disebut
 * spesifikasinya. Yang dijaga bukan "ada hasilnya", tapi hal-hal yang salahnya diam:
 * urutan aturan yang tertukar (Migran vs Tak Terverifikasi), ambang yang eksklusif
 * padahal harus inklusif, dan servis terjauh yang terpakai padahal harus yang terdekat.
 */
const assert = require('assert');
const { distanceMeters } = require('../backend/core/geo');
const {
  SEGMENTS, DEFAULT_KPI_M, fuseEngine, cwSales, confidenceRatio,
} = require('../backend/core/fusion');

// Semua koordinat di bawah nyata-nyata di DIY/Jateng, supaya jaraknya masuk akal.
const KTP = { lat: -7.7612, lng: 110.3583 };          // Sinduadi, Sleman
const DEKAT = { lat: -7.7956, lng: 110.3695 };        // ~4 km dari KTP
const JAUH = { lat: -7.4200, lng: 109.2300 };         // Purwokerto, ~133 km
const TANPA_TITIK = { lat: null, lng: null };         // gagal tergeocode

const KPI = DEFAULT_KPI_M;                            // 50 km

function test() {
  // --- prasyarat: jarak contohnya memang di sisi yang diharapkan ---
  assert.ok(distanceMeters(KTP.lat, KTP.lng, DEKAT.lat, DEKAT.lng) < KPI);
  assert.ok(distanceMeters(KTP.lat, KTP.lng, JAUH.lat, JAUH.lng) > KPI);

  const golongan = (input) => fuseEngine(Object.assign({ kpiRadiusM: KPI }, input)).segment;

  // --- enam golongan ---
  assert.strictEqual(golongan({ ktp: KTP, services: [DEKAT], pings: [DEKAT] }),
    'loyal_verified', 'servis dekat DAN kirim dekat');

  assert.strictEqual(golongan({ ktp: KTP, services: [DEKAT], pings: [] }),
    'service_near', 'servis dekat, kirim tidak ada');
  assert.strictEqual(golongan({ ktp: KTP, services: [DEKAT], pings: [JAUH] }),
    'service_near', 'servis dekat menang walau kirimnya jauh');

  assert.strictEqual(golongan({ ktp: KTP, services: [], pings: [DEKAT] }),
    'delivery_near', 'kirim dekat, servis tidak ada');
  assert.strictEqual(golongan({ ktp: KTP, services: [JAUH], pings: [DEKAT] }),
    'delivery_near', 'kirim dekat menang walau servisnya jauh');

  assert.strictEqual(golongan({ ktp: KTP, services: [], pings: [] }),
    'registered_only', 'tidak ada jejak lain sama sekali');

  assert.strictEqual(golongan({ ktp: KTP, services: [JAUH], pings: [] }),
    'nomad', 'terukur tapi jauh');
  assert.strictEqual(golongan({ ktp: KTP, services: [JAUH], pings: [JAUH] }),
    'nomad', 'dua-duanya jauh');

  assert.strictEqual(golongan({ ktp: KTP, services: [TANPA_TITIK], pings: [] }),
    'unverified', 'ada servis tapi gagal tergeocode');
  assert.strictEqual(golongan({ ktp: TANPA_TITIK, services: [DEKAT], pings: [] }),
    'unverified', 'KTP-nya sendiri gagal tergeocode — acuan jaraknya tidak ada');

  // --- urutan aturan: Migran MENDAHULUI Tak Terverifikasi ---
  // Satu servis terukur-jauh + satu servis gagal tergeocode. Kita SUDAH punya bukti
  // positif dia beraktivitas jauh dari KTP, jadi Migran, bukan "buta".
  assert.strictEqual(golongan({ ktp: KTP, services: [JAUH, TANPA_TITIK], pings: [] }),
    'nomad', 'bukti positif jarak harus menang atas satu sumber yang gagal tergeocode');

  // --- kasus batas 1: jarak PERSIS di ambang harus dihitung BERDEKATAN ---
  //
  // Ambangnya diberi jarak MENTAH, bukan yang sudah dibulatkan. Pembulatan ke bawah
  // membuat ambangnya jatuh SEDIKIT DI BAWAH jarak sebenarnya, dan yang teruji jadi
  // "sepersekian meter di luar ambang" — bukan kesamaan persis yang mau diuji.
  const mentah = distanceMeters(KTP.lat, KTP.lng, DEKAT.lat, DEKAT.lng);
  const persis = Math.round(mentah);
  assert.strictEqual(
    fuseEngine({ ktp: KTP, services: [DEKAT], pings: [], kpiRadiusM: mentah }).segment,
    'service_near', 'ambang harus inklusif (<=), bukan eksklusif');
  assert.strictEqual(
    fuseEngine({ ktp: KTP, services: [DEKAT], pings: [], kpiRadiusM: mentah - 1 }).segment,
    'nomad', 'satu meter di luar ambang sudah berjauhan');

  // --- kasus batas 2: dua desa servis dalam sebulan -> yang TERDEKAT yang dipakai ---
  const dua = fuseEngine({ ktp: KTP, services: [JAUH, DEKAT], pings: [], kpiRadiusM: KPI });
  assert.strictEqual(dua.segment, 'service_near',
    'servis terdekat yang menentukan, bukan yang pertama atau yang terjauh');
  assert.strictEqual(dua.distServiceM, persis, 'jarak yang dicatat harus yang terdekat');
  assert.strictEqual(dua.serviceCount, 2, 'kunjungan yang jauh tetap ikut terhitung');

  // --- kasus batas 3: ping mendahului KTP -> BELUM digolongkan, bukan merah ---
  assert.strictEqual(fuseEngine({ ktp: null, services: [], pings: [DEKAT] }), null,
    'tanpa baris KTP, mesin ini menunggu batch berikutnya — bukan Tak Terverifikasi');

  // --- bobot ikut golongannya, dan bisa ditimpa dari app_config ---
  assert.strictEqual(
    fuseEngine({ ktp: KTP, services: [DEKAT], pings: [DEKAT], kpiRadiusM: KPI }).weight,
    SEGMENTS.loyal_verified.weight);
  assert.strictEqual(
    fuseEngine({ ktp: KTP, services: [], pings: [], kpiRadiusM: KPI,
      weights: { registered_only: 0.9 } }).weight, 0.9,
    'bobot dari app_config harus menimpa bawaan');

  // --- metrik turunan: angka contoh di docs/FUSION.md 2.4 harus keluar persis ---
  const counts = {
    loyal_verified: 661, service_near: 1584, delivery_near: 984,
    registered_only: 1441, nomad: 427, unverified: 202,
  };
  assert.strictEqual(Number(cwSales(counts).toFixed(1)), 3554.3,
    'CW Sales contoh di dokumen tidak cocok lagi dengan rumusnya');
  assert.strictEqual(Number((confidenceRatio(counts) * 100).toFixed(1)), 67.1,
    'Confidence Ratio contoh di dokumen tidak cocok lagi');
  assert.strictEqual(confidenceRatio({}), null, 'tanpa pelanggan, rasionya bukan 0 tapi null');

  // --- keenam golongan punya bobot dan dua nama ---
  assert.strictEqual(Object.keys(SEGMENTS).length, 6);
  Object.entries(SEGMENTS).forEach(([kode, s]) => {
    assert.ok(s.weight > 0 && s.weight <= 1, `bobot ${kode} di luar 0..1`);
    assert.ok(s.label && s.short, `${kode} harus punya nama resmi dan label pendek`);
  });

  console.log('OK fusion — enam golongan, urutan aturan (Migran mendahului Tak ' +
    'Terverifikasi), ambang inklusif, servis terdekat menang, CW Sales 3.554,3');
}

test();
