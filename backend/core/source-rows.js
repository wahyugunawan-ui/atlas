/**
 * Pembacaan baris Data KTP dan Data Servis. MURNI: tidak menyentuh berkas, database,
 * maupun jaringan — yang memanggil menyerahkan tabelnya sudah jadi array of array.
 *
 * KOLOM DICARI LEWAT JUDULNYA, BUKAN NOMOR URUT. Dua alasan, dan keduanya nyata di
 * berkas yang dipakai tim:
 *
 *   1. Data KTP punya kolom 17 berjudul "No. Mesi" (terpotong di sumbernya) TEPAT DI
 *      SEBELAH kolom 18 "No Mesin" yang asli. Pencocokan judul yang longgar — "yang
 *      mengandung kata mesin" — akan memilih kolom 17 dan seluruh penyatuan data
 *      menempel ke nomor mesin yang salah, tanpa satu pun error muncul.
 *   2. "Alamat" muncul DUA KALI (alamat konsumen di kolom 3, alamat dealer di kolom
 *      11), dan "Kelurahan"/"Kecamatan" juga punya pasangan milik dealer.
 *
 * Aturannya karena itu: judul dinormalkan (huruf kecil, semua tanda baca dan spasi
 * dibuang) lalu dicocokkan PERSIS, dan yang diambil selalu kemunculan PERTAMA.
 */

/** 'No. Mesin' -> 'nomesin'. 'Jenis Service' -> 'jenisservice'. */
function normalizeHeader(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Spesifikasi per sumber.
 *
 * `wanted` memetakan nama field -> daftar judul yang diterima, berurutan menurut
 * prioritas. Judul milik dealer ('kelurahan', 'kecamatan', 'alamat' yang kedua)
 * SENGAJA tidak masuk daftar untuk field konsumen: di template Astra, kolom milik
 * konsumen bernama 'Kel' dan 'Kec', sedangkan 'Kelurahan'/'Kecamatan' yang panjang
 * adalah alamat dealernya. Ini bukan tebakan — importer penjualan yang sudah jalan
 * memakai pemetaan yang sama.
 */
const SPECS = {
  ktp: {
    table: 'customer_ktp',
    label: 'Data KTP',
    allowRepeatEngine: false,
    wanted: {
      engineNo: ['nomesin'],
      frameNo: ['norangka'],
      name: ['nama'],
      address: ['alamat'],
      villageText: ['kel'],
      districtText: ['kec'],
      cityCode: ['kodekota'],
      dealerCode: ['kodedealer'],
      requestDate: ['tglmohon'],
    },
    required: ['engineNo', 'villageText', 'districtText'],
    columns: ['period', 'engine_no', 'frame_no', 'name', 'address', 'village_text',
      'district_text', 'city_code', 'dealer_code', 'request_date', 'village_code',
      'resolve_status', 'row_no'],
    toValues: (r, period) => [period, r.engineNo || null, r.frameNo || null,
      r.name || null, r.address || null, r.villageText || null, r.districtText || null,
      r.cityCode || null, r.dealerCode || null, toDate(r.requestDate),
      r.villageCode || null, r.status, r.rowNo],
  },

  servis: {
    table: 'service_visit',
    label: 'Data Servis',
    // Satu motor memang bisa servis berkali-kali dalam sebulan. Nomor mesin berulang
    // di sini WAJAR, bukan cacat data — beda dari Data KTP.
    allowRepeatEngine: true,
    wanted: {
      engineNo: ['engineno', 'nomesin'],
      frameNo: ['norangka'],
      address: ['alamat'],
      villageText: ['kelurahan', 'kel'],
      districtText: ['kecamatan', 'kec'],
      cityText: ['kabupaten', 'kota'],
      serviceType: ['jenisservice', 'jenisservis'],
    },
    required: ['engineNo', 'villageText', 'districtText'],
    columns: ['period', 'engine_no', 'frame_no', 'address', 'village_text',
      'district_text', 'city_text', 'service_type', 'village_code', 'resolve_status',
      'row_no'],
    toValues: (r, period) => [period, r.engineNo || null, r.frameNo || null,
      r.address || null, r.villageText || null, r.districtText || null,
      r.cityText || null, r.serviceType || null, r.villageCode || null, r.status,
      r.rowNo],
  },
};

/**
 * Tanggal Excel -> 'YYYY-MM-DD', atau null.
 *
 * Kolomnya DATE di database, jadi teks yang tidak bisa dibaca sebagai tanggal HARUS
 * jadi null — bukan dikirim apa adanya dan membuat seluruh impor gagal karena satu sel
 * berisi "-" atau "n/a".
 */
function toDate(value) {
  // Apostrof di depan DIBUANG lebih dulu. Berkas CDB Astra menulis tanggal sebagai
  // TEKS dengan penanda apostrof Excel: sel berisi `'15082026`, bukan tanggal
  // sungguhan. Diukur pada berkas Agustus 2026: seluruh 19.598 barisnya begitu.
  const teks = String(value == null ? '' : value).trim().replace(/^'/, '');
  if (!teks) return null;

  const digit = teks.replace(/\D/g, '');
  const sah = (y, m, d) => y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

  if (digit.length === 8) {
    // DDMMYYYY — bentuk yang dipakai berkas Astra. Dicoba LEBIH DULU daripada
    // YYYYMMDD, dan urutannya bukan selera: '15082026' dibaca sebagai YYYYMMDD
    // berarti tahun 1508, yang mustahil. Jadi empat digit terakhirlah tahunnya.
    const d = Number(digit.slice(0, 2));
    const m = Number(digit.slice(2, 4));
    const y = Number(digit.slice(4));
    if (sah(y, m, d)) {
      return `${digit.slice(4)}-${digit.slice(2, 4)}-${digit.slice(0, 2)}`;
    }
    // YYYYMMDD sebagai cadangan, kalau kelak ada berkas yang menulisnya begitu.
    const y2 = Number(digit.slice(0, 4));
    const m2 = Number(digit.slice(4, 6));
    const d2 = Number(digit.slice(6));
    if (sah(y2, m2, d2)) {
      return `${digit.slice(0, 4)}-${digit.slice(4, 6)}-${digit.slice(6)}`;
    }
    return null;
  }

  // Bentuk lain (mis. '2026-08-15' atau tanggal sungguhan dari ExcelJS) dibiarkan
  // ditangani Date.parse. Yang tidak bisa dibaca jadi null, BUKAN menggagalkan
  // seluruh impor karena satu sel berisi '-' atau 'n/a'.
  const waktu = Date.parse(teks);
  return Number.isNaN(waktu) ? null : new Date(waktu).toISOString().slice(0, 10);
}

/**
 * Cari indeks kolom dari baris judul.
 *
 * Kemunculan PERTAMA yang menang — itu yang membuat 'Alamat' konsumen (kolom 3)
 * terpilih dan 'Alamat' dealer (kolom 11) diabaikan.
 *
 * @return {Object} {field: index}
 * @throws kalau ada field wajib yang judulnya tidak ketemu
 */
function findColumns(header, spec) {
  const judul = (header || []).map(normalizeHeader);
  const cols = {};

  Object.entries(spec.wanted).forEach(([field, kandidat]) => {
    for (const nama of kandidat) {
      const i = judul.indexOf(nama);
      if (i >= 0) { cols[field] = i; return; }
    }
  });

  const kurang = spec.required.filter((f) => cols[f] === undefined);
  if (kurang.length) {
    const diminta = kurang.map((f) => spec.wanted[f][0]).join(', ');
    throw new Error(
      `Berkas ini sepertinya bukan ${spec.label} — kolom ${diminta} tidak ketemu di ` +
      `baris judul. Judul yang terbaca: ${judul.filter(Boolean).slice(0, 12).join(', ')}`);
  }
  return cols;
}

/** Baris mentah -> objek berfield, membawa nomor barisnya di berkas asal. */
function mapRows(rows, cols, spec) {
  const ambil = (r, field) =>
    (cols[field] === undefined ? '' : String(r[cols[field]] == null ? '' : r[cols[field]]).trim());

  return (rows || []).map((r, i) => {
    const out = { rowNo: i + 2, status: null, villageCode: null };  // +2: judul + 1-index
    Object.keys(spec.wanted).forEach((field) => { out[field] = ambil(r, field); });
    return out;
  });
}

/**
 * Tandai baris yang tidak bisa ikut penyatuan.
 *
 * Nomor mesin kosong -> 'no_engine'. Nomor mesin ganda (cuma untuk sumber yang
 * pengulangannya TIDAK wajar) -> baris PERTAMA dipakai, sisanya 'duplicate'.
 *
 * Yang ditandai tidak dibuang: baris tetap tersimpan lengkap dengan nomor barisnya,
 * supaya operator bisa dirujuk balik ke baris ke-berapa di berkas mana. Membuang
 * diam-diam adalah cara paling halus untuk kehilangan data.
 */
function markEngines(rows, spec) {
  const terlihat = new Set();
  (rows || []).forEach((r) => {
    const mesin = String(r.engineNo || '').trim().toUpperCase();
    if (!mesin) { r.status = 'no_engine'; return; }
    if (spec.allowRepeatEngine) return;
    if (terlihat.has(mesin)) { r.status = 'duplicate'; return; }
    terlihat.add(mesin);
  });
  return rows;
}

module.exports = { SPECS, normalizeHeader, findColumns, mapRows, markEngines, toDate };
