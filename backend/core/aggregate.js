/**
 * Agregasi baris Excel mentah jadi baris fakta penjualan.
 *
 * Murni: tidak menyentuh berkas, database, maupun jaringan.
 *
 * Yang keluar dari sini TIDAK PERNAH memuat nama atau alamat konsumen. Itu bukan
 * kebetulan — kolom 0 dan 1 sengaja tidak ada di COLUMN, jadi tidak ada jalan bagi
 * fungsi ini untuk membacanya. Dijaga oleh test/aggregate.test.js.
 */
const { regionKey, toDottedCityCode } = require('./region');

/**
 * Indeks kolom berkas Excel dari Astra.
 *
 * Kolom 0 (nama konsumen) dan 1 (alamat konsumen) SENGAJA TIDAK ADA di sini.
 *
 * Kolom 5 diberi judul "Kode Pos" di Excel dan memang kode pos surat (56553) —
 * BUKAN kode outlet. Kode lama pernah memakainya sebagai identitas outlet dan
 * menghasilkan ratusan "dealer" palsu.
 *
 * Kolom 7 diberi judul "Kode Dealer" di Excel, tapi isinya kode OUTLET: 78 kode,
 * masing-masing satu nama dan satu alamat, dan satu dealer bisa punya beberapa.
 * Penamaan di sini mengikuti kenyataan, bukan judul kolomnya.
 */
const COLUMN = {
  village: 2,
  district: 3,
  cityCode: 4,
  postalCode: 5,
  outletCode: 7,
  outletName: 8,
  outletAddress: 9,
};

/**
 * Pemisah kunci internal. NUL dipilih karena tidak mungkin muncul di kode wilayah
 * maupun kode outlet, jadi kunci tidak bisa tabrakan. Dibuat lewat fromCharCode
 * supaya tidak ada byte kontrol di berkas sumber ini.
 */
const SEPARATOR = String.fromCharCode(0);

const text = (value) => String(value == null ? '' : value).trim();

/**
 * @param {Array<Array>} rows        baris Excel tanpa baris judul
 * @param {Object} villageIndex      regionKey() -> kode kelurahan BPS
 * @param {string} period            'YYYY-MM'
 * @return {{rows: Array<Array>, unmatched: Array<Object>, outlets: Array<Object>,
 *           read: number, used: number}}
 *   rows: [period, villageCode, outletCode, quantity] — EMPAT kolom.
 *   dealerCode sengaja tidak ada; dia milik tabel `outlets` dan diambil lewat JOIN.
 *   Kalau ikut disalin ke tiap baris, memperbaiki satu pengelompokan outlet berarti
 *   menulis ulang ratusan ribu baris — dan yang lupa ditulis ulang jadi diam-diam
 *   salah.
 */
function aggregate(rows, villageIndex, period) {
  const counts = {};      // kunci -> jumlah
  const missing = {};     // regionKey -> {cityCode, districtName, villageName, count}
  const outlets = {};     // outletCode -> {outletCode, outletName, address}
  let read = 0;
  let used = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const villageName = row[COLUMN.village];
    const outletCode = text(row[COLUMN.outletCode]);
    if (!villageName && !outletCode) continue;          // baris kosong
    read++;

    if (outletCode && !outlets[outletCode]) {
      outlets[outletCode] = {
        outletCode: outletCode,
        outletName: text(row[COLUMN.outletName]),
        address: text(row[COLUMN.outletAddress]),
      };
    }

    const key = regionKey(row[COLUMN.cityCode], row[COLUMN.district], villageName);
    const villageCode = villageIndex[key];

    if (!villageCode) {
      // Baris yang tidak cocok JANGAN dibuang diam-diam. Dilaporkan supaya bisa
      // diverifikasi manusia, dan jumlahnya masuk laporan impor.
      if (!missing[key]) {
        missing[key] = {
          key: key,
          cityCode: toDottedCityCode(row[COLUMN.cityCode]),
          districtName: text(row[COLUMN.district]),
          villageName: text(villageName),
          count: 0,
        };
      }
      missing[key].count++;
      continue;
    }

    used++;
    const factKey = [period, villageCode, outletCode].join(SEPARATOR);
    counts[factKey] = (counts[factKey] || 0) + 1;
  }

  // Diurutkan supaya dua kali jalan menghasilkan keluaran yang sama persis.
  const facts = Object.keys(counts).sort().map((key) => {
    const part = key.split(SEPARATOR);
    return [part[0], part[1], part[2], counts[key]];
  });

  return {
    rows: facts,
    unmatched: Object.values(missing).sort((a, b) => b.count - a.count),
    outlets: Object.keys(outlets).sort().map((code) => outlets[code]),
    read: read,
    used: used,
  };
}

/**
 * Buang baris periode X dari agregat lama, gabung dengan yang baru, urutkan.
 *
 * Ini yang membuat impor idempoten: impor ulang bulan yang sama menghasilkan keadaan
 * yang sama, bukan dobel. Di jalur database peran ini diambil alih oleh
 * "DELETE WHERE period = ?" di dalam transaksi; fungsi ini tetap ada untuk jalur CLI
 * dan untuk diuji tanpa database.
 */
function mergeAggregates(previous, incoming, period) {
  const kept = previous.filter((row) =>
    String(row[0]).trim() !== period && String(row[0]).trim() !== '');
  return kept.concat(incoming).sort((a, b) => {
    const ka = [a[0], a[1], a[2]].join(SEPARATOR);
    const kb = [b[0], b[1], b[2]].join(SEPARATOR);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

module.exports = { COLUMN, aggregate, mergeAggregates };
