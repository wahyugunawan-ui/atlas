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
  rows.forEach((row) => {
    inside += row.units * ((S.coverage[row.outlet] || {})[row.village] || 0);
    total += row.units;
  });
  return { inside, outside: total - inside, total };
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
