/**
 * Uji pembacaan baris Data KTP dan Data Servis (docs/FUSION.md Tahap C).
 *
 * Judul kolom di bawah disalin PERSIS dari berkas yang dipakai tim — termasuk
 * "No. Mesi" yang terpotong di sumbernya dan "Alamat" yang muncul dua kali. Keduanya
 * jenis cacat yang tidak pernah memunculkan error: impornya berhasil, angkanya masuk,
 * dan seluruh penyatuan data menempel ke kolom yang salah.
 */
const assert = require('assert');
const {
  SPECS, normalizeHeader, findColumns, mapRows, markEngines, toDate,
} = require('../backend/core/source-rows');

// 20 kolom, persis seperti "CDB Full Agustus 2026 ... Data KTP.xlsx".
const JUDUL_KTP = [
  'No. Rangka', 'Nama', 'Alamat', 'Kel', 'Kec', 'Kode Kota', 'Kode Pos', 'Kode Prov',
  'Kode Dealer', 'NAMA Dealer', 'Alamat', 'Kelurahan', 'Kecamatan', 'Kabupaten',
  'Propinsi', 'Kode Mesin', 'No. Mesi', 'No Mesin', 'Tgl Mohon', '',
];

const JUDUL_SERVIS = [
  'engineno', 'No Rangka', 'Alamat', 'Kecamatan', 'Kabupaten', 'Kelurahan',
  'Jenis Service',
];

function test() {
  // --- normalisasi judul ---
  assert.strictEqual(normalizeHeader('No. Mesin'), 'nomesin');
  assert.strictEqual(normalizeHeader('Jenis Service'), 'jenisservice');
  assert.strictEqual(normalizeHeader(null), '');

  // --- KTP: kolom yang benar yang terpilih ---
  const kolomKtp = findColumns(JUDUL_KTP, SPECS.ktp);

  assert.strictEqual(kolomKtp.engineNo, 17,
    'kolom mesin harus "No Mesin" (indeks 17), BUKAN "No. Mesi" yang terpotong di 16');
  assert.strictEqual(kolomKtp.address, 2,
    'Alamat yang diambil harus milik konsumen (indeks 2), bukan alamat dealer (10)');
  assert.strictEqual(kolomKtp.villageText, 3,
    '"Kel" milik konsumen, bukan "Kelurahan" milik dealer');
  assert.strictEqual(kolomKtp.districtText, 4,
    '"Kec" milik konsumen, bukan "Kecamatan" milik dealer');
  assert.strictEqual(kolomKtp.cityCode, 5);
  assert.strictEqual(kolomKtp.name, 1);

  // --- KTP: pemetaan baris ---
  const barisKtp = mapRows([
    ['RANGKA1', 'Budi', 'Jl. Kaliurang 5', 'Sinduadi', 'Mlati', '3404', '55284', '34',
      'D01', 'Dealer A', 'Jl. Dealer 1', 'Caturtunggal', 'Depok', 'Sleman', 'DIY',
      'KM1', 'SALAH-JANGAN-DIPAKAI', 'MESIN-BENAR-1', '2026-08-01', ''],
  ], kolomKtp, SPECS.ktp);

  assert.strictEqual(barisKtp[0].engineNo, 'MESIN-BENAR-1',
    'nilai mesin diambil dari kolom yang salah — ini bug yang paling mahal di berkas ini');

  // Apostrof penanda teks Excel dibuang untuk SEMUA field. Di berkas sungguhan ini
  // kena Tgl Mohon ("'15082026") dan Kode Kota ("'3404"); yang kedua membuat 0 dari
  // 49 kode kota cocok ke tabel villages sampai ketahuan dari data Agustus 2026.
  const berapostrof = mapRows([
    ["'R1", 'Budi', 'Jl. A', 'Sinduadi', 'Mlati', "'3404", '', '', "'7348", '', '', '',
      '', '', '', '', 'x', "'MESIN1", "'15082026", ''],
  ], kolomKtp, SPECS.ktp);
  assert.strictEqual(berapostrof[0].cityCode, '3404',
    'apostrof penanda teks Excel harus dibuang dari kode kota');
  assert.strictEqual(berapostrof[0].engineNo, 'MESIN1',
    'apostrof juga dibuang dari nomor mesin, kalau sumbernya menulis begitu');
  assert.strictEqual(berapostrof[0].frameNo, 'R1');
  assert.strictEqual(berapostrof[0].dealerCode, '7348');
  assert.strictEqual(barisKtp[0].address, 'Jl. Kaliurang 5');
  assert.strictEqual(barisKtp[0].villageText, 'Sinduadi');
  assert.strictEqual(barisKtp[0].rowNo, 2, 'baris data pertama = baris 2 di Excel');

  // --- nomor mesin kosong dan ganda ---
  const ganda = markEngines(mapRows([
    ['R1', 'A', 'x', 'Sinduadi', 'Mlati', '3404', '', '', '', '', '', '', '', '', '',
      '', 'x', 'MESIN-1', '', ''],
    ['R2', 'B', 'x', 'Sinduadi', 'Mlati', '3404', '', '', '', '', '', '', '', '', '',
      '', 'x', 'mesin-1', '', ''],
    ['R3', 'C', 'x', 'Sinduadi', 'Mlati', '3404', '', '', '', '', '', '', '', '', '',
      '', 'x', '', '', ''],
  ], kolomKtp, SPECS.ktp), SPECS.ktp);

  assert.strictEqual(ganda[0].status, null, 'baris pertama yang dipakai');
  assert.strictEqual(ganda[1].status, 'duplicate',
    'nomor mesin sama (beda huruf besar-kecil) tetap terhitung ganda');
  assert.strictEqual(ganda[2].status, 'no_engine');
  assert.strictEqual(ganda[1].rowNo, 3,
    'nomor baris ikut dilaporkan supaya operator bisa mencarinya di Excel');

  // --- Servis: nomor mesin berulang itu WAJAR, tidak ditandai ---
  const kolomServis = findColumns(JUDUL_SERVIS, SPECS.servis);
  assert.strictEqual(kolomServis.engineNo, 0);
  assert.strictEqual(kolomServis.serviceType, 6);
  assert.strictEqual(kolomServis.cityText, 4);

  const servis = markEngines(mapRows([
    ['M1', 'R1', 'Jl. A', 'Mlati', 'Sleman', 'Sinduadi', 'Servis berkala'],
    ['M1', 'R1', 'Jl. A', 'Mlati', 'Sleman', 'Sinduadi', 'Ganti oli'],
    ['', 'R2', 'Jl. B', 'Mlati', 'Sleman', 'Sendangadi', 'Servis berkala'],
  ], kolomServis, SPECS.servis), SPECS.servis);

  assert.strictEqual(servis[0].status, null);
  assert.strictEqual(servis[1].status, null,
    'satu motor servis dua kali sebulan itu wajar — JANGAN ditandai duplikat');
  assert.strictEqual(servis[2].status, 'no_engine');

  // --- berkas salah ditolak dengan pesan yang menyebut kolomnya ---
  assert.throws(() => findColumns(['Tanggal', 'Jumlah', 'Keterangan'], SPECS.ktp),
    /nomesin|No Mesin|bukan Data KTP/i,
    'berkas yang salah harus ditolak jelas, bukan terbaca 0 baris cocok');

  // Judul Servis yang dipakai KTP juga harus ditolak: keduanya .xlsx, gampang tertukar.
  assert.throws(() => findColumns(JUDUL_SERVIS, SPECS.ktp), /tidak ketemu/i);

  // --- tanggal ---
  //
  // Bentuk yang BENAR-BENAR ada di berkas CDB Astra: teks berpenanda apostrof Excel
  // berisi DDMMYYYY. Versi pertama kode ini memakai Date.parse apa adanya, dan
  // Date.parse("'15082026") = NaN — seluruh 19.598 tanggal jadi NULL tanpa satu pun
  // error muncul. Ditemukan waktu mengimpor data Agustus 2026 yang sungguhan.
  assert.strictEqual(toDate("'15082026"), '2026-08-15',
    'apostrof penanda teks Excel + DDMMYYYY adalah bentuk sungguhan di berkas Astra');
  assert.strictEqual(toDate("'04082026"), '2026-08-04');
  assert.strictEqual(toDate('28082026'), '2026-08-28', 'tanpa apostrof juga harus jalan');

  // DDMMYYYY dicoba lebih dulu: '15082026' sebagai YYYYMMDD berarti tahun 1508.
  assert.strictEqual(toDate('15082026'), '2026-08-15');
  // YYYYMMDD tetap terbaca kalau tanggalnya mustahil dibaca sebagai DDMMYYYY
  // (bulan 20 tidak ada).
  assert.strictEqual(toDate('20260815'), '2026-08-15');

  assert.strictEqual(toDate('2026-08-01'), '2026-08-01');
  assert.strictEqual(toDate(''), null);
  assert.strictEqual(toDate('-'), null, 'sel berisi "-" tidak boleh menggagalkan impor');
  assert.strictEqual(toDate('n/a'), null);
  assert.strictEqual(toDate('99999999'), null, 'delapan digit yang bukan tanggal jadi null');

  // --- kolom yang benar-benar dipakai INSERT cocok jumlahnya dengan nilainya ---
  // Kalau tidak, Postgres menolak seluruh impor dengan pesan yang tidak menyebut
  // sebabnya. Dijaga di sini, bukan ditemukan saat impor sungguhan.
  Object.values(SPECS).forEach((spec) => {
    const contoh = { rowNo: 2, status: 'ok', villageCode: '34.04.01.2001' };
    assert.strictEqual(spec.toValues(contoh, '2026-08').length, spec.columns.length,
      `jumlah nilai dan kolom ${spec.table} tidak sama`);
  });

  console.log('OK source-rows — "No Mesin" menang atas "No. Mesi", alamat konsumen ' +
    'bukan alamat dealer, ganda/kosong tertandai, servis berulang dibiarkan');
}

test();
