/**
 * Filter dan ruang lingkup.
 *
 * activeRows() adalah satu-satunya jalan membaca data yang sedang tampil. Kalau ada
 * bagian lain yang menyaring S.sales sendiri, angkanya akan berbeda dari KPI dan tidak
 * ada yang tahu mana yang benar.
 *
 * Modul ini SENGAJA tidak menyentuh DOM. Nilai filter tinggal di S.filters[halaman] dan
 * <select> di bilah cuma cerminnya. Itu dua hal sekaligus: tiap halaman bisa punya
 * filter sendiri tanpa trik simpan-muat, dan aturannya bisa diuji tanpa browser.
 */
import { PROVINCE_NAMES } from './config.js';
import { S } from './state.js';

/** Nilai filter halaman yang sedang aktif, atau halaman yang disebut. */
export const pageFilters = (page) => S.filters[page || S.filterPage] || S.filters.peta;

/** 'kota' | 'dealer' | 'pos' -> nama field-nya di objek filter. */
const FIELD = { kota: 'cityCode', dealer: 'dealerCode', pos: 'outletCode' };
const KINDS = Object.keys(FIELD);

/**
 * Kota, dealer, dan pos masing-masing SLOT SENDIRI, di-AND-kan — sama seperti provinsi
 * yang sudah begitu sejak awal.
 *
 * Sebelum 2026-08-30 ketiganya berbagi satu slot (`scopeKind`/`scopeCode`): tim minta
 * kota DAN dealer bisa aktif bersamaan untuk panel ringkasan gabungan, dan begitu dua
 * dari tiga jadi independen, mengecualikan pos sendirian justru menambah percabangan
 * dibanding memperlakukan ketiganya seragam. Lihat DECISIONS.md untuk pertimbangan
 * lengkapnya.
 */
export function scopeValue(kind, f) {
  const filters = f || pageFilters();
  return filters[FIELD[kind]] || 'ALL';
}

/**
 * @param {string} kind  'kota' | 'dealer' | 'pos'
 * @param {string} code  kode, atau 'ALL' untuk mengosongkan
 * @param {boolean} [force]  jangan toggle — dipakai "Lihat di peta" dari tabel, yang
 *   artinya "tampilkan ini", bukan "nyalakan atau matikan ini"
 */
export function setScope(kind, code, force) {
  const f = pageFilters();
  const field = FIELD[kind];
  const same = !force && f[field] === code;
  f[field] = (same || !code || code === 'ALL') ? 'ALL' : code;
}

/** @param {string} [kind] tanpa argumen, kosongkan KETIGANYA (dipakai tombol Reset). */
export function clearScope(kind) {
  const f = pageFilters();
  (kind ? [kind] : KINDS).forEach((k) => { f[FIELD[k]] = 'ALL'; });
}

export function setProvince(code) { pageFilters().province = code || 'ALL'; }

/**
 * Ujung rentang yang menyilang DISERET, bukan ditolak.
 *
 * Penggunanya tim channel, bukan developer, dan dropdown yang menolak pilihan tidak
 * memberi tahu apa yang harus dilakukan. Menyeret ujung satunya selalu menghasilkan
 * rentang yang sah, dan yang terjadi terlihat langsung di layar.
 *
 * @param {string} which  'from' | 'to'
 */
export function setPeriod(which, value) {
  const f = pageFilters();
  f[which] = value || 'ALL';
  if (f.from !== 'ALL' && f.to !== 'ALL' && f.from > f.to) {
    if (which === 'from') f.to = f.from;
    else f.from = f.to;
  }
}

export function activeRows(page) {
  const f = pageFilters(page);

  return S.sales.filter((row) => {
    // Periode dibandingkan sebagai TEKS. Kolomnya lebar-tetap 'YYYY-MM' dengan bulan
    // ber-nol depan, jadi urutan leksikografisnya identik dengan urutan kronologis.
    // Ini hanya benar selama nol depannya ada — dijaga regex PERIOD di
    // backend/server/routes.js dan oleh importir, jadi '2026-9' tidak bisa masuk.
    if (f.from !== 'ALL' && row.period < f.from) return false;
    if (f.to !== 'ALL' && row.period > f.to) return false;
    if (f.dealerCode !== 'ALL' && row.dealer !== f.dealerCode) return false;
    if (f.outletCode !== 'ALL' && row.outlet !== f.outletCode) return false;
    const village = S.villageByCode[row.village];
    if (!village) return false;
    if (f.cityCode !== 'ALL' && village.cityCode !== f.cityCode) return false;
    if (f.province !== 'ALL' && village.provinceCode !== f.province) return false;
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
 *
 * Kota, dealer, dan pos independen sejak 2026-08-30: mengklik pos waktu dealer sedang
 * aktif TIDAK membuang dealernya lagi — keduanya di-AND-kan (lihat scopeValue()).
 */
export function applyScope(kind, code) {
  if (kind === 'kelurahan') {
    // Menyetel kotanya, bukan kelurahannya: filter kelurahan tidak ada, dan
    // menyempitkan ke satu kelurahan akan mengosongkan hampir semua panel.
    //
    // Dipaksa, bukan di-toggle: mengklik poligon berarti "lihat kabupaten ini", dan
    // mengklik kelurahan kedua di kabupaten yang sama tidak boleh mematikannya.
    const village = S.villageByCode[code];
    if (village) setScope('kota', village.cityCode, true);
  } else {
    setScope(kind, code);
  }

  if (kind === 'pos' && scopeValue('pos') === code) {
    const outlet = S.outletByCode[code];
    if (outlet && outlet.lat != null && S.map) {
      S.map.flyTo({ center: [outlet.lng, outlet.lat], zoom: 10.5, duration: 700 });
    }
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
 *
 * Rentang periodenya sengaja TIDAK ikut disebut: rentangnya sekarang permanen terlihat
 * di bilah filter, dan menyalinnya ke sini cuma bikin dua tempat yang bisa menyimpang.
 */
export function scopeLabel() {
  const f = pageFilters();
  const parts = [];

  if (f.cityCode !== 'ALL') parts.push(S.cityNames[f.cityCode] || f.cityCode);
  if (f.dealerCode !== 'ALL') {
    parts.push('Dealer ' + (S.dealerNames[f.dealerCode] || f.dealerCode));
  }
  if (f.outletCode !== 'ALL') {
    parts.push('Pos ' + ((S.outletByCode[f.outletCode] || {}).name || f.outletCode));
  }
  if (f.province !== 'ALL') {
    parts.push(PROVINCE_NAMES[f.province] || 'Provinsi ' + f.province);
  }
  return parts.length ? parts.join(' · ') : 'seluruh penjualan';
}
