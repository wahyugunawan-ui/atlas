/**
 * Uji resolusi nama desa -> kode wilayah (docs/FUSION.md 2.1c).
 *
 * Yang dijaga di sini bukan "jalan atau tidak", tapi hal-hal yang salahnya DIAM:
 * alias yang kalah dari nama asli, tebakan ambigu yang diterima diam-diam, dan status
 * yang salah label — ketiganya menghasilkan kode desa yang kelihatan benar di layar
 * sambil menempatkan pelanggan di tempat yang salah.
 *
 * Contoh nama di bawah bukan karangan: Cilacap benar-benar punya dua "Tambakreja" di
 * dua kecamatan berbeda, dan itulah alasan kunci pencocokannya tiga tingkat.
 */
const assert = require('assert');
const {
  buildVillageIndex, resolveVillage, ambiguous,
} = require('../backend/core/village-resolver');

const VILLAGES = [
  { code: '34.04.01.2001', name: 'Sinduadi', district: 'Mlati', cityCode: '34.04' },
  { code: '34.04.01.2002', name: 'Sendangadi', district: 'Mlati', cityCode: '34.04' },
  { code: '33.01.01.2001', name: 'Tambakreja', district: 'Cilacap Selatan', cityCode: '33.01' },
  { code: '33.01.02.2001', name: 'Tambakreja', district: 'Cilacap Utara', cityCode: '33.01' },
  { code: '33.01.03.2001', name: 'Tegalreja', district: 'Jeruklegi', cityCode: '33.01' },
];

const SEKOTA = (kode) => VILLAGES.filter((v) => v.cityCode === kode);

function test() {
  const index = buildVillageIndex(VILLAGES, [
    // Alias yang sudah dikonfirmasi manusia: ejaan Excel -> desa yang sungguhan.
    // Sengaja nama yang TIDAK ada di daftar desa, supaya yang diuji benar-benar jalur
    // alias dan bukan kebetulan cocok apa adanya.
    {
      villageCode: '34.04.01.2001', villageName: 'Sindoadi',
      districtName: 'Mlati', cityCode: '34.04',
    },
  ]);

  // --- ok: cocok persis; ejaan spasi dan huruf besar tidak dipersoalkan ---
  const ok = resolveVillage(
    { cityCode: '34.04', districtName: 'MLATI', villageName: 'SINDUADI' },
    index, SEKOTA('34.04'));
  assert.strictEqual(ok.status, 'ok');
  assert.strictEqual(ok.villageCode, '34.04.01.2001');
  assert.deepStrictEqual(ok.suggestions, [], 'yang cocok persis tidak perlu usulan');

  // Kode kota boleh datang tanpa titik — toDottedCityCode yang menyamakannya.
  assert.strictEqual(resolveVillage(
    { cityCode: '3404', districtName: 'Mlati', villageName: 'Sindu Adi' },
    index, SEKOTA('34.04')).villageCode, '34.04.01.2001');

  // --- alias: keputusan manusia, dan statusnya dibedakan dari 'ok' ---
  const alias = resolveVillage(
    { cityCode: '34.04', districtName: 'Mlati', villageName: 'Sindoadi' },
    index, SEKOTA('34.04'));
  assert.strictEqual(alias.status, 'alias',
    'alias yang dikonfirmasi manusia harus dibedakan dari cocok apa adanya');
  assert.strictEqual(alias.villageCode, '34.04.01.2001');

  // --- fuzzy: satu padanan dekat yang tidak ambigu ---
  // 'Tegalrejo' tidak ada di indeks; yang ada 'Tegalreja' (jarak sunting 1).
  const fuzzy = resolveVillage(
    { cityCode: '33.01', districtName: 'Jeruklegi', villageName: 'Tegalrejo' },
    index, SEKOTA('33.01'));
  assert.strictEqual(fuzzy.status, 'fuzzy');
  assert.strictEqual(fuzzy.villageCode, '33.01.03.2001');
  assert.strictEqual(fuzzy.suggestions.length, 1,
    'cuma satu kandidat yang cukup dekat — dua Tambakreja terlalu jauh ejaannya');

  // Kecamatan yang sama menang atas kandidat berjarak SAMA di kecamatan lain.
  // 'Tambakredja' berjarak 1 dari KEDUA Tambakreja; yang membedakan cuma kecamatannya.
  const sekecamatan = resolveVillage(
    { cityCode: '33.01', districtName: 'Cilacap Utara', villageName: 'Tambakredja' },
    index, SEKOTA('33.01'));
  assert.strictEqual(sekecamatan.status, 'fuzzy');
  assert.strictEqual(sekecamatan.villageCode, '33.01.02.2001',
    'kecamatan yang sama harus menang atas kandidat berjarak sama di kecamatan lain');

  // --- unmatched: dua kandidat sama kuat, JANGAN dipilih salah satunya ---
  // Kecamatannya tidak dikenal, jadi kedua Tambakreja sama-sama beda kecamatan dan
  // sama-sama berjarak 0. Tidak ada satu pun alasan tersisa untuk memilih salah satu.
  const seri = resolveVillage(
    { cityCode: '33.01', districtName: 'Kecamatan Entah', villageName: 'Tambakreja' },
    index, SEKOTA('33.01'));
  assert.strictEqual(seri.status, 'unmatched',
    'dua Tambakreja sama kuat — tebakannya TIDAK boleh dipakai');
  assert.strictEqual(seri.villageCode, null);
  assert.ok(seri.suggestions.length >= 2,
    'usulannya tetap dikembalikan supaya operator bisa memilih');

  // --- unmatched: tidak ada padanan sama sekali ---
  const jauh = resolveVillage(
    { cityCode: '34.04', districtName: 'Mlati', villageName: 'Zzzzzzzzzz' },
    index, SEKOTA('34.04'));
  assert.strictEqual(jauh.status, 'unmatched');
  assert.strictEqual(jauh.villageCode, null);
  assert.deepStrictEqual(jauh.suggestions, []);

  // --- alias DITIMPAKAN di atas indeks asli, bukan sebaliknya ---
  // Kalau sebuah nama belakangan ternyata juga cocok apa adanya, alias yang
  // dikonfirmasi orang tetap yang menang: dia keputusan, bukan kebetulan.
  const ditimpa = buildVillageIndex(VILLAGES, [{
    villageCode: '34.04.01.2002', villageName: 'Sinduadi',
    districtName: 'Mlati', cityCode: '34.04',
  }]);
  const menang = resolveVillage(
    { cityCode: '34.04', districtName: 'Mlati', villageName: 'Sinduadi' },
    ditimpa, SEKOTA('34.04'));
  assert.strictEqual(menang.status, 'alias');
  assert.strictEqual(menang.villageCode, '34.04.01.2002',
    'alias harus menimpa nama yang cocok apa adanya, bukan kalah darinya');

  // --- pembantu ambiguous() ---
  assert.ok(!ambiguous([]), 'kosong bukan ambigu');
  assert.ok(!ambiguous([{ sameDistrict: true, distance: 1 }]), 'satu kandidat bukan ambigu');
  assert.ok(ambiguous([
    { sameDistrict: true, distance: 2 }, { sameDistrict: true, distance: 2 },
  ]), 'sama kecamatan dan sama jarak = ambigu');
  assert.ok(!ambiguous([
    { sameDistrict: true, distance: 1 }, { sameDistrict: true, distance: 2 },
  ]), 'jarak berbeda = ada alasan memilih, bukan ambigu');
  assert.ok(!ambiguous([
    { sameDistrict: true, distance: 2 }, { sameDistrict: false, distance: 2 },
  ]), 'kecamatan sama vs beda = ada alasan memilih');

  // --- indeks dan kandidat kosong tidak meledak ---
  assert.strictEqual(resolveVillage(
    { cityCode: '34.04', districtName: 'Mlati', villageName: 'Sinduadi' },
    buildVillageIndex(null, null), []).status, 'unmatched');

  console.log('OK village-resolver — empat status benar, alias menimpa nama asli, ' +
    'tebakan ambigu ditolak, kecamatan menang atas jarak');
}

test();
