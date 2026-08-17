/**
 * Uji logika inti: normalisasi, pencocokan tiga tingkat, agregasi, idempotensi,
 * dan jaminan PII tidak bocor. Tidak menyentuh berkas maupun database.
 *
 * Diport dari md-command-center-uji/test_agregasi.js. Satu bentuk keluaran berubah:
 * aggregate() tidak lagi mengembalikan dealerCode di baris fakta — lihat ROADMAP.md.
 * Seluruh maksud pengujian yang lain dipertahankan apa adanya.
 */
const assert = require('assert');
const { normalizeName, toDottedCityCode, regionKey } = require('../backend/core/region');
const { aggregate, mergeAggregates } = require('../backend/core/aggregate');
const { resolveGroups, guessDealerName, toDealerCode } = require('../backend/core/grouping');

/**
 * Satu baris Excel. Kolom 0 dan 1 sengaja diisi PII sungguhan supaya kalau suatu saat
 * ada yang membacanya, tesnya yang berteriak — bukan pengguna.
 * [nama, alamat, kelurahan, kecamatan, kodeKota, kodePos, kodeProv,
 *  kodeOutlet, namaOutlet, alamatOutlet]
 */
function row(village, district, city, outletCode, outletName) {
  return ['Budi Santoso', 'Jl. Rahasia No. 1 RT 3', village, district, city, '55584',
    '34', outletCode || 'O01', outletName || 'ASTRA MOTOR SLEMAN',
    'Jl. Magelang Km 7'];
}

function test() {
  // --- normalisasi ---
  assert.strictEqual(normalizeName('Kali Wungu'), 'KALIWUNGU');
  assert.strictEqual(normalizeName('KALIWUNGU'), 'KALIWUNGU');
  assert.strictEqual(normalizeName("Sungai R. A'yun"), 'SUNGAIRAYUN');
  assert.strictEqual(normalizeName(null), '');
  assert.strictEqual(toDottedCityCode('3404012001'), '34.04');
  assert.strictEqual(toDottedCityCode('34.04'), '34.04');
  assert.strictEqual(toDottedCityCode(3404), '34.04');
  assert.strictEqual(toDottedCityCode(''), '');

  // --- pencocokan tiga tingkat ---
  // Nama kelurahan sama di dua kecamatan pada kabupaten yang sama harus BEDA kunci.
  // Ini kasus nyata: Cilacap punya dua "Tambakreja".
  const a = regionKey('33.01', 'Kedungreja', 'Tambakreja');
  const b = regionKey('33.01', 'Cilacap Selatan', 'Tambakreja');
  assert.notStrictEqual(a, b, 'kecamatan harus ikut membedakan');
  // Ejaan berbeda tetap satu kunci.
  assert.strictEqual(regionKey('3301', 'kedung reja', 'TAMBAKREJA'), a);

  const villages = {};
  villages[a] = '33.01.01.2001';
  villages[b] = '33.01.21.1003';
  villages[regionKey('34.04', 'Mlati', 'Sinduadi')] = '34.04.06.2003';

  // --- agregasi ---
  // Sinduadi (34.04) sengaja ditaruh PALING ATAS meski kodenya paling besar. Kalau
  // aggregate() berhenti mengurutkan, urutan keluarannya akan ikut urutan kemunculan
  // dan cek "urutan stabil" di bawah yang menangkapnya.
  const rows = [
    row('Sinduadi', 'Mlati', '34.04', 'O02', 'NUSANTARA SAKTI - SLEMAN'),
    row('Tambakreja', 'Kedungreja', '33.01', 'O01'),
    row('Tambakreja', 'Kedungreja', '33.01', 'O01'),
    row('Tambakreja', 'Cilacap Selatan', '33.01', 'O01'),   // kecamatan beda
    row('Karangwuni', 'Wates', '34.01', 'O02'),             // tidak ada di indeks
    ['', '', '', '', '', '', '', '', '', ''],               // baris kosong
  ];
  const result = aggregate(rows, villages, '2026-08');

  assert.strictEqual(result.read, 5, 'baris kosong tidak dihitung');
  assert.strictEqual(result.used, 4);
  assert.strictEqual(result.rows.length, 3, 'dua Tambakreja Kedungreja jadi satu baris');

  const find = (code) => result.rows.find((r) => r[1] === code);
  assert.strictEqual(find('33.01.01.2001')[3], 2, 'dua baris identik dijumlahkan');
  assert.strictEqual(find('33.01.21.1003')[3], 1, 'kecamatan beda tidak tertukar');
  assert.strictEqual(find('34.04.06.2003')[3], 1);
  assert.strictEqual(result.rows[0][0], '2026-08');
  assert.strictEqual(result.rows[0].length, 4,
    'baris fakta empat kolom; dealerCode diambil lewat JOIN, tidak disalin ke sini');

  // Urutan keluaran harus stabil, bukan mengikuti urutan kemunculan di Excel. Kalau
  // tidak, dua impor dari berkas yang sama menghasilkan urutan baris yang berbeda dan
  // tidak ada cara membandingkannya.
  const factKeys = result.rows.map((r) => r.slice(0, 3).join('|'));
  assert.deepStrictEqual(factKeys, factKeys.slice().sort(),
    'baris fakta tidak terurut — keluaran jadi bergantung pada urutan baris Excel');

  // Yang tidak cocok dilaporkan, tidak dibuang diam-diam.
  assert.strictEqual(result.unmatched.length, 1);
  assert.strictEqual(result.unmatched[0].villageName, 'Karangwuni');
  assert.strictEqual(result.unmatched[0].cityCode, '34.01');
  assert.strictEqual(result.unmatched[0].count, 1);
  assert.strictEqual(result.read - result.used, 1);

  // Outlet: satu baris per kode outlet, tanpa koordinat (pin manual).
  assert.strictEqual(result.outlets.length, 2);
  assert.strictEqual(result.outlets.map((o) => o.outletCode).join(','), 'O01,O02');

  // Kolom 5 adalah kode pos surat dan TIDAK BOLEH jadi identitas outlet. Kalau ada
  // yang menukarnya kembali, '55584' akan muncul sebagai kode outlet di sini.
  assert.ok(!result.outlets.some((o) => o.outletCode === '55584'),
    'kode pos surat terpakai sebagai kode outlet');

  // --- PII tidak boleh bocor ke keluaran ---
  const dump = JSON.stringify(result);
  assert.ok(!dump.includes('Budi'), 'nama konsumen bocor ke hasil agregasi');
  assert.ok(!dump.includes('Rahasia'), 'alamat konsumen bocor ke hasil agregasi');

  // --- pengelompokan outlet -> dealer ---
  assert.strictEqual(guessDealerName('NUSANTARA SAKTI - SLEMAN'), 'NUSANTARA SAKTI');
  assert.strictEqual(guessDealerName('ASTRA MOTOR SLEMAN'), 'ASTRA MOTOR SLEMAN',
    'nama tanpa " - " berdiri sendiri');
  assert.strictEqual(toDealerCode('NUSANTARA SAKTI'), 'NUSANTARASAKTI');

  // Pemisahnya " - " dengan spasi, bukan "-". Belum ada nama berhubung di data
  // sekarang, tapi satu saja yang masuk bulan depan sudah cukup untuk memecah nama
  // dealer di tempat yang salah — dan hasilnya berupa dealer baru yang tampak wajar,
  // bukan error.
  assert.strictEqual(guessDealerName('SUMBER-BARU MOTOR - WATES'), 'SUMBER-BARU MOTOR');
  assert.strictEqual(guessDealerName('SUMBER-BARU MOTOR'), 'SUMBER-BARU MOTOR');

  const groups = resolveGroups([], result.outlets);
  assert.strictEqual(groups.added.length, 2, 'dua outlet baru ditebak');
  assert.strictEqual(groups.outlets.O02.dealerCode, 'NUSANTARASAKTI');
  assert.strictEqual(groups.outlets.O02.lat, null, 'koordinat kosong, pin manual');

  // Suntingan manusia harus menang atas tebakan, kalau tidak perbaikan tim akan
  // ditimpa diam-diam tiap impor bulanan.
  const edited = [{
    outletCode: 'O02', outletName: 'NUSANTARA SAKTI - SLEMAN',
    dealerCode: 'NSS', dealerName: 'Nusantara Sakti Sentra', lat: -7.7, lng: 110.3,
  }];
  const after = resolveGroups(edited, result.outlets);
  assert.strictEqual(after.outlets.O02.dealerCode, 'NSS', 'tebakan menimpa suntingan');
  assert.strictEqual(after.outlets.O02.lat, -7.7, 'koordinat hasil pin manual hilang');
  assert.strictEqual(after.added.length, 1, 'hanya O01 yang benar-benar baru');

  // --- idempotensi ---
  const previous = [
    ['2026-07', '34.04.06.2003', 'O02', 9],
    ['2026-08', '34.04.06.2003', 'O02', 99],   // periode yang diimpor ulang
  ];
  const first = mergeAggregates(previous, result.rows, '2026-08');
  const second = mergeAggregates(first, result.rows, '2026-08');
  assert.deepStrictEqual(second, first, 'jalan dua kali harus identik');
  assert.ok(!first.some((r) => r[0] === '2026-08' && r[3] === 99),
    'baris periode lama tersisa');
  assert.ok(first.some((r) => r[0] === '2026-07' && r[3] === 9),
    'periode lain ikut terhapus');
  assert.strictEqual(first.length, 4);

  // Urutan stabil -> dua kali tulis menghasilkan keluaran yang sama persis.
  const joined = first.map((r) => r.join(' '));
  assert.deepStrictEqual(joined, joined.slice().sort());

  console.log(`OK aggregate — ${result.rows.length} baris fakta, ` +
    `${result.unmatched.length} nama belum cocok, ${groups.added.length} outlet baru, ` +
    `idempoten, tanpa PII`);
}

test();
