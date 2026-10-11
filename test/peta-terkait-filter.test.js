/**
 * Titik pos dan dealer di peta mengikuti filter (2026-10-11): yang TIDAK terkait hilang,
 * tidak lagi diabukan.
 *
 * Modul yang sama persis dengan yang dikirim ke browser; DOM dan MapLibre diganti objek
 * polos yang mencatat apa yang digambar.
 *
 * Yang dijaga:
 * 1. Tanpa filter ruang lingkup semua pos dan dealer bertitik tampil.
 * 2. Filter Dealer: hanya dealer itu dan pos-posnya.
 * 3. SATU POS dianalisis (contoh permintaan: pos A dari dealer C yang punya pos B): tampil
 *    pos A (terpilih), pos B (sedang), dan dealer C — tidak ada yang lain.
 * 4. Filter Kota/Kec/Kares = dealer TERDAFTAR di sana (bukan lokasi pelanggan) beserta pos
 *    mereka.
 * 5. Filter yang tidak cocok dengan dealer mana pun = peta tanpa titik, bukan semua titik.
 * 6. Filter Periode saja BUKAN filter ruang lingkup (hasScopeFilter) — titik tetap semua.
 * 7. Tidak ada titik yang digambar dengan kelas abu-abu: itu cara lama (diredupkan).
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const url = (name) => pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'js', name)).href;

// --- dunia tiruan: DOM dan MapLibre yang hanya mencatat ---
globalThis.document = {
  createElement: () => ({ className: '', style: {}, innerHTML: '', addEventListener() {} }),
  getElementById: () => null,
};
globalThis.window = new Proxy({}, { get: () => () => {} });   // map.js membaca window.* saat dipakai
globalThis.maplibregl = {
  Marker: class {
    constructor({ element }) { this.element = element; }
    setLngLat(lngLat) { this.lngLat = lngLat; return this; }
    addTo() { return this; }
    remove() {}
    getElement() { return this.element; }
  },
};

const DEALERS = [
  // Dealer C punya dua pos (A dan B) — contoh dari permintaan.
  { code: 'DC', name: 'Dealer C', cityCode: '34.04', districtCode: '34.04.01', lat: -7.6, lng: 110.12 },
  { code: 'DD', name: 'Dealer D', cityCode: '33.01', districtCode: '33.01.01', lat: -7.7, lng: 109.0 },
  { code: 'DE', name: 'Dealer E', cityCode: '34.04', districtCode: '34.04.02', lat: -7.8, lng: 110.4 },
  { code: 'DF', name: 'Dealer F (tanpa koordinat)', cityCode: '34.04', districtCode: '34.04.01', lat: null, lng: null },
];
const OUTLETS = [
  { code: 'POS-A', name: 'Pos A', dealerCode: 'DC', lat: -7.71, lng: 110.31 },
  { code: 'POS-B', name: 'Pos B', dealerCode: 'DC', lat: -7.92, lng: 110.52 },
  { code: 'POS-X', name: 'Pos X', dealerCode: 'DD', lat: -7.71, lng: 109.01 },
  { code: 'POS-Y', name: 'Pos Y', dealerCode: 'DD', lat: -7.72, lng: 109.02 },
  { code: 'POS-Z', name: 'Pos Z', dealerCode: 'DE', lat: -7.81, lng: 110.41 },
  { code: 'POS-N', name: 'Pos tanpa koordinat', dealerCode: 'DC', lat: null, lng: null },
];

async function main() {
  const { S, makeFilter } = await import(url('state.js'));
  const filters = await import(url('filters.js'));
  const { drawMarkers, drawDealerMarkers } = await import(url('outlets.js'));
  const { hasScopeFilter, focusDealerSet } = filters;

  S.sales = [];
  S.districtByCode = {};
  S.dealers = DEALERS;
  S.dealerByCode = Object.fromEntries(DEALERS.map((d) => [d.code, d]));
  S.outlets = OUTLETS;
  S.realOutlets = OUTLETS;
  S.outletByCode = Object.fromEntries(OUTLETS.map((o) => [o.code, o]));
  S.allDistrictByCode = {
    '33.01.01': { code: '33.01.01', cityCode: '33.01' },
    '34.04.01': { code: '34.04.01', cityCode: '34.04' },
    '34.04.02': { code: '34.04.02', cityCode: '34.04' },
  };
  S.registry = null;
  S.markers = [];
  S.dealerMarkers = [];
  S.map = {};

  const f = S.filters.peta;
  const reset = () => { S.filterPage = 'peta'; Object.assign(f, makeFilter()); };

  /** Kode pos/dealer yang digambar, dikenali dari koordinatnya. */
  const gambarPos = () => S.markers.map((m) => OUTLETS.find((o) => o.lng === m.lngLat[0]).code).sort();
  const gambarDealer = () => S.dealerMarkers.map((m) => DEALERS.find((d) => d.lng === m.lngLat[0]).code).sort();
  const gambar = () => { drawMarkers(); drawDealerMarkers(); return { pos: gambarPos(), dealer: gambarDealer() }; };
  const kelasPos = (kode) => S.markers.find((m) =>
    m.lngLat[0] === OUTLETS.find((o) => o.code === kode).lng).element.className;

  /* 1. tanpa filter */
  reset();
  assert.strictEqual(hasScopeFilter(), false);
  assert.strictEqual(focusDealerSet(), null, 'tanpa filter himpunan fokus harus null (semua tampil)');
  let g = gambar();
  assert.deepStrictEqual(g.pos, ['POS-A', 'POS-B', 'POS-X', 'POS-Y', 'POS-Z'],
    'tanpa filter semua pos berkoordinat harus tampil (yang tanpa koordinat tidak)');
  assert.deepStrictEqual(g.dealer, ['DC', 'DD', 'DE'], 'dealer tanpa koordinat tidak boleh tampil');

  /* 6. periode saja bukan filter ruang lingkup */
  f.from = '2026-01'; f.to = '2026-03';
  assert.strictEqual(hasScopeFilter(), false, 'filter periode dianggap filter ruang lingkup');
  assert.strictEqual(gambar().pos.length, 5, 'filter periode menghilangkan titik');
  reset();
  for (const kunci of ['kares', 'cityCode', 'districtCode', 'dealerCode', 'outletCode']) {
    reset();
    f[kunci] = 'X';
    assert.strictEqual(hasScopeFilter(), true, `${kunci} tidak dihitung sebagai filter ruang lingkup`);
  }

  /* 2. filter Dealer */
  reset();
  f.dealerCode = 'DD';
  g = gambar();
  assert.deepStrictEqual(g.pos, ['POS-X', 'POS-Y'], 'pos dealer lain masih tampil');
  assert.deepStrictEqual(g.dealer, ['DD'], 'dealer lain masih tampil');

  /* 3. SATU POS: pos A (dealer C punya pos B) -> A, B, dan dealer C */
  reset();
  f.outletCode = 'POS-A';
  f.dealerCode = 'DC';                      // memilih pos ikut mengisi dealernya
  g = gambar();
  assert.deepStrictEqual(g.pos, ['POS-A', 'POS-B'], 'satu pos dianalisis: harus pos itu + saudara sedealernya');
  assert.deepStrictEqual(g.dealer, ['DC'], 'satu pos dianalisis: harus dealernya saja');
  assert.ok(/\bterpilih\b/.test(kelasPos('POS-A')), 'pos yang dianalisis tidak ditandai terpilih');
  assert.ok(/\bsedang\b/.test(kelasPos('POS-B')), 'pos saudara tidak diperkecil (sedang)');
  assert.ok(!/\bsedang\b/.test(kelasPos('POS-A')), 'pos terpilih ikut diperkecil');
  // Sama kalau yang terisi hanya filter pos (dealer diturunkan dari pos).
  f.dealerCode = 'ALL';
  g = gambar();
  assert.deepStrictEqual(g.pos, ['POS-A', 'POS-B'], 'filter pos saja tidak membawa dealernya');
  assert.deepStrictEqual(g.dealer, ['DC']);

  /* 4. Kota / Kec / Kares = dealer terdaftar */
  reset();
  f.cityCode = '34.04';
  g = gambar();
  assert.deepStrictEqual(g.dealer, ['DC', 'DE'], 'filter kota harus memilih dealer yang TERDAFTAR di kota itu');
  assert.deepStrictEqual(g.pos, ['POS-A', 'POS-B', 'POS-Z']);
  reset();
  f.districtCode = '33.01.01';
  g = gambar();
  assert.deepStrictEqual(g.dealer, ['DD']);
  assert.deepStrictEqual(g.pos, ['POS-X', 'POS-Y']);

  /* 5. tidak cocok dengan dealer mana pun */
  reset();
  f.cityCode = '99.99';
  g = gambar();
  assert.deepStrictEqual(g, { pos: [], dealer: [] },
    'filter tanpa dealer harus mengosongkan titik, bukan menampilkan semuanya');
  assert.ok(focusDealerSet() instanceof Set && focusDealerSet().size === 0,
    'himpunan fokus kosong harus Set kosong, BUKAN null (null = tanpa filter)');

  /* 8. peta dipas-kan ke SEMUA yang digambar: satu pos -> pos itu, pos saudara, dan dealernya.
     (Dulu hanya ke pos terpilih; saudara dan dealernya digambar tapi jatuh di luar layar.) */
  const { fitToScope } = await import(url('map.js'));
  let kotak = null;
  S.map = { fitBounds: (b) => { kotak = b; } };
  const mencakup = (b, lng, lat) => b[0][0] <= lng && lng <= b[1][0] && b[0][1] <= lat && lat <= b[1][1];
  reset();
  f.outletCode = 'POS-A';
  f.dealerCode = 'DC';
  fitToScope(true);
  assert.ok(kotak, 'fitBounds tidak dipanggil');
  assert.ok(mencakup(kotak, 110.31, -7.71), 'peta tidak mencakup pos yang dianalisis');
  assert.ok(mencakup(kotak, 110.52, -7.92), 'peta tidak mencakup pos saudara sedealer (digambar tapi di luar layar)');
  assert.ok(mencakup(kotak, 110.12, -7.6), 'peta tidak mencakup titik dealernya (digambar tapi di luar layar)');
  assert.ok(!mencakup(kotak, 109.01, -7.71), 'peta ikut mencakup pos dealer LAIN yang tidak digambar');
  // Filter dealer: titik dealer ikut (bukan hanya pos-posnya).
  reset();
  f.dealerCode = 'DD';
  fitToScope(true);
  assert.ok(mencakup(kotak, 109.0, -7.7), 'filter dealer: titik dealernya tidak ikut dipas-kan');
  assert.ok(mencakup(kotak, 109.02, -7.72) && mencakup(kotak, 109.01, -7.71));

  /* 7. tidak ada yang abu-abu */
  reset();
  f.cityCode = '34.04';
  gambar();
  [...S.markers, ...S.dealerMarkers].forEach((m) => {
    assert.ok(!/\babu\b/.test(m.element.className), `titik masih diabukan: ${m.element.className}`);
  });

  console.log('OK peta-terkait-filter — pos/dealer yang tidak terkait filter tidak digambar, satu pos ' +
    'membawa pos saudara dan dealernya, kota/kec/kares memilih dealer terdaftar, filter periode ' +
    'bukan filter ruang lingkup, himpunan kosong = peta kosong');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
