/**
 * Alasan penggolongan satu Nomor Mesin.
 *
 * Yang dijaga di sini adalah hal-hal yang SALAH TANPA TERLIHAT SALAH: ambang yang
 * dipakai bukan ambang yang tersimpan, "tidak ada data" disamakan dengan "ada tapi
 * gagal diukur", dan titik jauh yang terpotong dari diagram sehingga "jauh" tidak
 * pernah terlihat jauh.
 */
const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODUL = pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'js', 'fusion-alasan.js')).href;

/** Contoh di docs/FUSION.md 3.4: servis 22 km, ambang 50 km, kirim tidak ada. */
const CONTOH = {
  ktpLat: -7.8, ktpLng: 110.4,
  serviceLat: -7.9, serviceLng: 110.6, serviceCount: 2, distServiceM: 22000,
  deliveryLat: null, deliveryLng: null, deliveryCount: 0, distDeliveryM: null,
  segment: 'service_near', weight: 0.8, kpiRadiusM: 50000,
};

test('kalimatnya sesuai contoh spesifikasi', async () => {
  const { kalimatAlasan } = await import(MODUL);
  const { bagian, kesimpulan } = kalimatAlasan(CONTOH);
  assert.match(bagian[0], /Servis berjarak 22,0 km dari KTP \(KPI Jarak: 50,0 km\) → berdekatan\./);
  assert.match(bagian[1], /Kirim tidak ditemukan\./);
  assert.strictEqual(kesimpulan, 'Warlok ke Bengkel dekat (bobot 0,80)');
});

test('ambang yang dipakai adalah yang TERSIMPAN di baris itu', async () => {
  const { kalimatAlasan } = await import(MODUL);
  // kpi_radius_m disimpan per baris justru supaya golongan lama tetap bisa
  // dijelaskan walau setelan sekarang sudah berubah. Kalau kalimatnya memakai
  // ambang hari ini, penjelasannya bisa bertentangan dengan golongannya sendiri.
  const lama = Object.assign({}, CONTOH, { kpiRadiusM: 10000 });
  const { bagian } = kalimatAlasan(lama);
  assert.match(bagian[0], /KPI Jarak: 10,0 km/);
  assert.match(bagian[0], /→ jauh\./, '22 km di ambang 10 km itu JAUH');
});

test('ambang inklusif: tepat di ambang berarti berdekatan', async () => {
  const { kalimatAlasan } = await import(MODUL);
  const pas = Object.assign({}, CONTOH, { distServiceM: 50000 });
  assert.match(kalimatAlasan(pas).bagian[0], /→ berdekatan\./);
});

test('"tidak ada" dan "ada tapi gagal diukur" TIDAK disamakan', async () => {
  const { kalimatAlasan } = await import(MODUL);
  // Menyamakan keduanya menutupi masalah kualitas data: alamat yang gagal
  // dikonversi akan terbaca seolah pelanggannya memang tidak pernah servis.
  const gagalUkur = Object.assign({}, CONTOH, { serviceCount: 3, distServiceM: null });
  const tidakAda = Object.assign({}, CONTOH, { serviceCount: 0, distServiceM: null });
  assert.match(kalimatAlasan(gagalUkur).bagian[0], /tidak bisa diukur/);
  assert.match(kalimatAlasan(gagalUkur).bagian[0], /3×/);
  assert.match(kalimatAlasan(tidakAda).bagian[0], /tidak ditemukan/);
});

test('tanpa titik KTP, tidak ada jarak yang diklaim terukur', async () => {
  const { kalimatAlasan } = await import(MODUL);
  const tanpaKtp = Object.assign({}, CONTOH, {
    ktpLat: null, ktpLng: null, segment: 'unverified', weight: 0.05,
  });
  const { bagian, kesimpulan } = kalimatAlasan(tanpaKtp);
  assert.strictEqual(bagian.length, 1);
  assert.match(bagian[0], /Titik KTP tidak tergeocode/);
  assert.strictEqual(kesimpulan, 'Tak Terverifikasi (bobot 0,05)');
});

test('jarak di bawah 1 km ditulis meter, bukan 0,x km', async () => {
  const { formatJarak } = await import(MODUL);
  // "0,3 km" dan "0,9 km" menyembunyikan beda yang justru penting di skala ini.
  assert.strictEqual(formatJarak(300), '300 m');
  assert.strictEqual(formatJarak(999), '999 m');
  assert.strictEqual(formatJarak(1000), '1,0 km');
  assert.strictEqual(formatJarak(22000), '22,0 km');
  assert.strictEqual(formatJarak(null), null);
});

test('titik relatif: arah timur dan utara tidak tertukar', async () => {
  const { titikRelatif } = await import(MODUL);
  // Bujur lebih besar = TIMUR = x positif; lintang lebih besar = UTARA = y positif.
  // Di belahan selatan lintangnya negatif, dan di situlah tanda mudah terbalik.
  const f = Object.assign({}, CONTOH, { serviceLat: -7.7, serviceLng: 110.5 });
  const [servis] = titikRelatif(f);
  assert.ok(servis.x > 0, 'bujur lebih besar harus ke timur (x positif)');
  assert.ok(servis.y > 0, 'lintang -7,7 lebih UTARA daripada -7,8 (y positif)');
});

test('sumber tanpa hitungan tidak melahirkan titik', async () => {
  const { titikRelatif } = await import(MODUL);
  assert.deepStrictEqual(titikRelatif(CONTOH).map((t) => t.jenis), ['servis']);
  const tanpaKtp = Object.assign({}, CONTOH, { ktpLat: null });
  assert.deepStrictEqual(titikRelatif(tanpaKtp), []);
});

test('fitur peta: KTP jadi pangkal, tiap sumber dapat titik DAN garis', async () => {
  const { fiturTelusur } = await import(MODUL);
  const fitur = fiturTelusur(CONTOH);
  const jenis = fitur.map((x) => `${x.properties.jenis}/${x.geometry.type}`);
  // KTP titik, lalu garis KTP->servis, lalu titik servis. Kirim tidak ada (count 0).
  assert.deepStrictEqual(jenis,
    ['ktp/Point', 'servis/LineString', 'servis/Point']);
  // Garisnya WAJIB berpangkal di KTP, bukan di titik lain.
  const garis = fitur.find((x) => x.geometry.type === 'LineString');
  assert.deepStrictEqual(garis.geometry.coordinates[0], [110.4, -7.8]);
  // Dan ujungnya WAJIB titik servis, dengan bujur-lintang pada urutan yang benar.
  // GeoJSON memakai [lng, lat]; tertukar, garisnya menunjuk tempat yang sama sekali
  // lain dan tidak ada satu pun tes lain yang akan merah.
  assert.deepStrictEqual(garis.geometry.coordinates[1], [110.6, -7.9]);
  const titikServis = fitur.find(
    (x) => x.geometry.type === 'Point' && x.properties.jenis === 'servis');
  assert.deepStrictEqual(titikServis.geometry.coordinates, [110.6, -7.9]);
});

test('fitur peta: tanpa koordinat KTP tidak menggambar apa pun', async () => {
  const { fiturTelusur } = await import(MODUL);
  // Number(null) = 0, dan 0 itu lintang/bujur yang sah — titik nol derajat jatuh di
  // Teluk Guinea. Garis ke sana akan terlihat seperti data, padahal cuma penjaga
  // yang jebol. Jebakan yang sama sudah pernah kejadian di berkas ini.
  assert.deepStrictEqual(fiturTelusur({ ...CONTOH, ktpLat: null }), []);
  assert.deepStrictEqual(fiturTelusur({ ...CONTOH, ktpLng: '' }), []);
  assert.deepStrictEqual(fiturTelusur(null), []);
});

test('fitur peta: sumber berjumlah nol tidak digambar', async () => {
  const { fiturTelusur } = await import(MODUL);
  const adaKirim = {
    ...CONTOH, deliveryLat: -7.85, deliveryLng: 110.5, deliveryCount: 1,
  };
  assert.strictEqual(fiturTelusur(adaKirim).length, 5, 'ktp + 2x(garis+titik)');
  const tanpaServis = { ...adaKirim, serviceCount: 0 };
  assert.deepStrictEqual(
    fiturTelusur(tanpaServis).map((x) => x.properties.jenis),
    ['ktp', 'kirim', 'kirim']);
});

test('diagram selalu memuat titik terjauh, bukan cuma lingkaran ambang', async () => {
  const { jangkauanDiagram, titikRelatif } = await import(MODUL);
  // Titik 120 km dengan ambang 50 km: kalau skalanya cuma mengikuti ambang, titik
  // itu jatuh di luar gambar dan "jauh" tidak pernah terlihat jauh.
  const jauh = Object.assign({}, CONTOH, { serviceLat: -8.9, serviceLng: 110.4 });
  const titik = titikRelatif(jauh);
  const jarakTitik = Math.hypot(titik[0].x, titik[0].y);
  assert.ok(jarakTitik > 50000, 'prasyarat tes: titiknya memang di luar ambang');
  assert.ok(jangkauanDiagram(jauh, titik) >= jarakTitik,
    'skala harus memuat titik terjauh');
  // Sebaliknya, titik dekat tidak boleh membuat lingkaran ambang terpotong.
  assert.ok(jangkauanDiagram(CONTOH, [{ x: 100, y: 100 }]) >= 50000);
});
