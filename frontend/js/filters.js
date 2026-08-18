/**
 * Filter dan ruang lingkup.
 *
 * activeRows() adalah satu-satunya jalan membaca data yang sedang tampil. Kalau ada
 * bagian lain yang menyaring S.sales sendiri, angkanya akan berbeda dari KPI dan tidak
 * ada yang tahu mana yang benar.
 */
import { PROVINCE_NAMES } from './config.js';
import { $ } from './dom.js';
import { S } from './state.js';

export const filterValue = (id) => ($(id) ? $(id).value : 'ALL');

export const FILTER_IDS = ['filter-periode', 'filter-provinsi', 'filter-kota',
  'filter-dealer', 'filter-pos'];

export function activeRows() {
  const period = filterValue('filter-periode');
  const province = filterValue('filter-provinsi');
  const city = filterValue('filter-kota');
  const dealer = filterValue('filter-dealer');
  const outlet = filterValue('filter-pos');

  return S.sales.filter((row) => {
    if (period !== 'ALL' && row.period !== period) return false;
    if (dealer !== 'ALL' && row.dealer !== dealer) return false;
    if (outlet !== 'ALL' && row.outlet !== outlet) return false;
    const village = S.villageByCode[row.village];
    if (!village) return false;
    if (city !== 'ALL' && village.cityCode !== city) return false;
    if (province !== 'ALL' && village.provinceCode !== province) return false;
    return true;
  });
}

/**
 * Satu pintu untuk semua cara memilih ruang lingkup.
 *
 * Marker di peta, blok treemap, baris panel performa, chip kartu dealer, poligon
 * kelurahan, dan dropdown semuanya lewat sini. Itu yang membuat "klik di peta langsung
 * berpindah" otomatis benar: tidak ada jalur kedua yang bisa lupa diperbarui, dan titik
 * penjualan, KPI, heatmap, serta panel performa selalu berpindah bersamaan.
 */
export function applyScope(kind, code) {
  if (kind === 'kota') {
    $('filter-kota').value = code;
    $('filter-pos').value = 'ALL';
    S.selectedOutlet = null;
  } else if (kind === 'dealer') {
    const same = filterValue('filter-dealer') === code;
    $('filter-dealer').value = same ? 'ALL' : code;
    $('filter-pos').value = 'ALL';
    S.selectedOutlet = null;
  } else if (kind === 'pos') {
    const same = S.selectedOutlet === code;
    S.selectedOutlet = same ? null : code;
    $('filter-pos').value = same ? 'ALL' : code;
    if (!same) {
      const outlet = S.outletByCode[code];
      if (outlet && outlet.lat != null) {
        S.map.flyTo({ center: [outlet.lng, outlet.lat], zoom: 10.5, duration: 700 });
      }
    }
  } else if (kind === 'kelurahan') {
    // Menyetel kotanya, bukan kelurahannya: filter kelurahan tidak ada, dan
    // menyempitkan ke satu kelurahan akan mengosongkan hampir semua panel.
    const village = S.villageByCode[code];
    if (village) $('filter-kota').value = village.cityCode;
  }
  window.renderAll();
}

/**
 * Bagi penjualan jadi dalam dan luar radius jangkauan.
 *
 * Rasio jangkauan datang dari server, dihitung dari luas kelurahan yang beririsan
 * dengan lingkaran radius. Alamat konsumen tidak punya koordinat, jadi ini TIDAK bisa
 * dihitung per orang — asumsinya konsumen tersebar merata di dalam kelurahannya, dan
 * asumsi itu ditulis di layar, bukan cuma di sini.
 */
export function splitByCoverage(rows) {
  let inside = 0;
  let total = 0;
  let noBoundary = 0;

  rows.forEach((row) => {
    // Kelurahan yang belum punya batas wilayah DIKELUARKAN dari hitungan, bukan
    // dihitung sebagai "di luar jangkauan".
    //
    // Bedanya besar dan halus. Tanpa poligon, rasio jangkauannya selalu 0 — bukan
    // karena posnya jauh, tapi karena belum ada yang bisa dihitung. Memasukkannya ke
    // penyebut membuat persentase turun tiap kali ada kelurahan baru ditambahkan,
    // dan turunnya terlihat seperti temuan padahal cuma data yang belum lengkap.
    //
    // Jumlahnya dilaporkan terpisah supaya yang belum lengkap TERLIHAT, bukan hilang.
    const village = S.villageByCode[row.village];
    if (village && village.hasGeom === false) {
      noBoundary += row.units;
      return;
    }
    inside += row.units * ((S.coverage[row.outlet] || {})[row.village] || 0);
    total += row.units;
  });

  return { inside, outside: total - inside, total, noBoundary };
}

/**
 * Sebaran penjualan satu dealer: kabupaten -> kelurahan.
 *
 * DUA TINGKAT, dan itu hasil pengukuran bukan selera. Dealer terbesar menyentuh 1.157
 * kelurahan, dan 677 di antaranya (59%) cuma satu unit. Daftar datar sepanjang itu
 * isinya hampir seluruhnya "1 unit" — panjang, tapi tidak menjawab apa pun. Kabupaten
 * memampatkannya jadi 25 baris yang terbaca sekali lihat, dan kelurahannya menyusul
 * waktu diklik.
 *
 * Jangkauan tiap kelurahan dihitung lewat splitByCoverage() yang sama dengan seluruh
 * aplikasi, BUKAN disalin ulang di sini. Aturan "kelurahan tanpa poligon dikeluarkan
 * dari persentase dan dilaporkan terpisah" itu halus dan sudah pernah salah; satu-
 * satunya cara memastikan dia tidak menyimpang adalah tidak punya salinan keduanya.
 *
 * @param {Array} rows  baris penjualan yang SUDAH disaring ke satu dealer
 * @return {Array} kabupaten urut unit terbanyak, kelurahan di dalamnya juga
 */
export function dealerBreakdown(rows) {
  const perKota = {};

  rows.forEach((row) => {
    const village = S.villageByCode[row.village];
    if (!village) return;
    const kota = perKota[village.cityCode] || (perKota[village.cityCode] = {
      cityCode: village.cityCode,
      cityName: village.cityName || village.cityCode,
      units: 0,
      byVillage: {},
    });
    kota.units += row.units;
    (kota.byVillage[row.village] || (kota.byVillage[row.village] = [])).push(row);
  });

  return Object.values(perKota).map((kota) => {
    const villages = Object.entries(kota.byVillage).map(([code, barisnya]) => {
      // splitByCoverage dipanggil dengan baris KELURAHAN INI saja. Memanggilnya dengan
      // seluruh baris dealer akan menghasilkan angka yang sama di tiap baris — masuk
      // akal dilihat sekilas, dan salah di semuanya.
      const split = splitByCoverage(barisnya);
      const village = S.villageByCode[code] || {};
      return {
        code,
        name: village.name || code,
        district: village.district || '',
        units: barisnya.reduce((sum, r) => sum + r.units, 0),
        inside: split.inside,
        covered: split.total,
        noBoundary: split.noBoundary,
      };
    }).sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));

    return {
      cityCode: kota.cityCode,
      cityName: kota.cityName,
      units: kota.units,
      // Dijumlahkan dari kelurahannya, bukan dihitung ulang dari baris kabupaten.
      // Kalau dihitung terpisah, dua angka di layar bisa tidak bersambung dan tidak
      // ada yang tahu mana yang benar.
      inside: villages.reduce((sum, v) => sum + v.inside, 0),
      covered: villages.reduce((sum, v) => sum + v.covered, 0),
      villages,
    };
  }).sort((a, b) => b.units - a.units || a.cityName.localeCompare(b.cityName));
}

/**
 * Kalimat yang menjelaskan 100%-nya siapa.
 *
 * Ada karena heatmapnya relatif: kelas warnanya dihitung ulang dari data yang lolos
 * filter. Tanpa keterangan ini, dua tangkapan layar dengan warna yang sama bisa
 * berarti hal yang sama sekali berbeda.
 */
export function scopeLabel() {
  const parts = [];
  const outlet = filterValue('filter-pos');
  const dealer = filterValue('filter-dealer');
  const city = filterValue('filter-kota');
  const province = filterValue('filter-provinsi');

  if (outlet !== 'ALL') {
    parts.push('Pos ' + ((S.outletByCode[outlet] || {}).name || outlet));
  } else if (dealer !== 'ALL') {
    parts.push('Dealer ' + (S.dealerNames[dealer] || dealer));
  }
  if (city !== 'ALL') parts.push(S.cityNames[city] || city);
  else if (province !== 'ALL') {
    parts.push(PROVINCE_NAMES[province] || 'Provinsi ' + province);
  }
  return parts.length ? parts.join(' di ') : 'seluruh penjualan';
}
