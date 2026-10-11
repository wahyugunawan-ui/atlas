/**
 * Uji frontend/js/sales-stats.js — murni, meng-import berkas ES yang sama persis
 * yang dikirim ke browser (pola sama dengan test/filters.test.js).
 *
 * Yang dijaga:
 * 1. Kontribusi % dihitung per KOTA, bukan global — dua kota dengan total berbeda
 *    tidak boleh saling memengaruhi angka satu sama lain.
 * 2. Kota tanpa penjualan menghasilkan "tidak tersedia" (null), bukan NaN/Infinity.
 * 3. (DIHAPUS 2026-10-11) Kelas interval tetap mode "Per Nilai Kontribusi" dan
 *    Selisih/Rasio/Kelompok Acuan Bisnis tidak ada lagi di modul ini — bagian 4, 5, dan 7
 *    di bawah dipakai ulang untuk yang baru.
 * 4. Lima kategori jangkauan dealer (Ring 1–3, Others, Pelanggaran Wilayah) saling lepas
 *    dan SELALU berjumlah 100%, termasuk setelah dibulatkan (balancedPercents).
 * 5. Kontribusi pos terhadap dealer berpenyebut SELURUH penjualan dealer.
 * 5. Satuan wilayahnya KECAMATAN (sejak 2026-10-10): dua baris dari DESA berbeda di
 *    kecamatan yang sama harus jatuh ke satu kecamatan. `village` di baris hanya
 *    untuk sebaran titik di peta dan tidak boleh ikut menentukan angka.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const url = (name) => pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'js', name)).href;

async function test() {
  const {
    groupByCity, contributionPercent, contributionsForRows, relativePosition,
    contributionsByOutlet, contributionsByDistrict, groupSplit,
    unitsForRows,
    dealerRingSplit, balancedPercents, posContributionInDealer, ringCells,
    monthsBetween, targetProgress, relatedDistricts,
  } = await import(url('sales-stats.js'));
  const salesStats = await import(url('sales-stats.js'));
  const { percentileBreaks } = await import(url('colors.js'));

  /* ------------------------------------------------------------------
     1. groupByCity — per kota, bukan global
     ------------------------------------------------------------------ */
  const districtByCode = {
    V1: { cityCode: 'KOTA-A' },
    V2: { cityCode: 'KOTA-A' },
    V3: { cityCode: 'KOTA-B' },
    V4: { cityCode: 'KOTA-C' },
  };
  const rows = [
    { district: 'V1', units: 8 },
    { district: 'V2', units: 92 },
    { district: 'V3', units: 5 },
    { district: 'V4', units: 0 }, // kota totalnya nol -- kontribusinya tidak terdefinisi
    { district: 'TIDAK-DIKENAL', units: 999 }, // kecamatan tak dikenal, harus dilewati
  ];
  const perCity = groupByCity(rows, districtByCode);
  assert.strictEqual(perCity.size, 3, 'kecamatan tak dikenal ikut membuat kota baru');
  assert.strictEqual(perCity.get('KOTA-A').total, 100);
  assert.strictEqual(perCity.get('KOTA-B').total, 5);
  assert.strictEqual(perCity.get('KOTA-A').districts.get('V1'), 8);
  assert.strictEqual(perCity.get('KOTA-A').districts.get('V2'), 92);

  // SATUAN = KECAMATAN. Dua baris dari desa BERBEDA di kecamatan yang sama harus jatuh
  // ke SATU kecamatan, dan kode desanya tidak boleh muncul sebagai kunci apa pun.
  // Kalau suatu saat ada yang kembali membaca `row.village`, ini yang merah.
  const rowsDuaDesa = [
    { district: 'V1', village: 'V1.0001', units: 3 },
    { district: 'V1', village: 'V1.0002', units: 7 },
    { district: 'V2', village: 'V2.0001', units: 10 },
  ];
  const unitKec = unitsForRows(rowsDuaDesa, districtByCode);
  assert.strictEqual(unitKec.get('V1'), 10, 'dua desa satu kecamatan tidak dijumlahkan');
  assert.strictEqual(unitKec.has('V1.0001'), false, 'kode desa bocor jadi kunci analisis');
  const kontribusiKec = contributionsForRows(rowsDuaDesa, districtByCode);
  assert.strictEqual(kontribusiKec.get('V1'), 50, 'kontribusi kecamatan bukan gabungan desanya');
  assert.strictEqual(kontribusiKec.size, 2, 'satu kunci per kecamatan, bukan per desa');

  /* ------------------------------------------------------------------
     2. contributionPercent — per kota, dan aman terhadap total nol
     ------------------------------------------------------------------ */
  assert.strictEqual(contributionPercent(8, 100), 8);
  assert.strictEqual(contributionPercent(5, 5), 100);
  // KOTA-A dan KOTA-B totalnya beda jauh (100 vs 5) — kontribusi V1 (8 dari 100)
  // TIDAK boleh dihitung seolah-olah pembaginya total gabungan (105) atau kota lain.
  assert.strictEqual(contributionPercent(8, perCity.get('KOTA-A').total), 8);

  assert.strictEqual(contributionPercent(5, 0), null,
    'total kota nol menghasilkan nilai selain null (NaN/Infinity lolos ke layar)');
  assert.strictEqual(contributionPercent(0, 0), null);

  // contributionsForRows() = groupByCity() + contributionPercent() sekaligus, untuk
  // seluruh kecamatan yang muncul di rows — dipakai bersama panel DAN pewarnaan peta.
  const kontribusi = contributionsForRows(rows, districtByCode);
  assert.strictEqual(kontribusi.get('V1'), 8);
  assert.strictEqual(kontribusi.get('V2'), 92);
  assert.strictEqual(kontribusi.get('V3'), 100, 'V3 satu-satunya di KOTA-B, harus 100%');
  assert.strictEqual(kontribusi.has('V4'), false,
    'V4 di kota bertotal nol ikut masuk hasil — seharusnya dilewati, bukan NaN diam-diam');
  assert.strictEqual(kontribusi.has('TIDAK-DIKENAL'), false);

  /* ------------------------------------------------------------------
     3. relativePosition — bungkus classOf() colors.js, label Indonesia baru
     ------------------------------------------------------------------ */
  const nilai = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const breaks = percentileBreaks(nilai);
  assert.strictEqual(relativePosition(1, breaks), 'Terbawah');
  assert.strictEqual(relativePosition(10, breaks), 'Teratas');
  assert.strictEqual(relativePosition(0, breaks), null, 'nol seharusnya "tidak ada penjualan"');
  assert.strictEqual(relativePosition(null, breaks), null);

  /* ------------------------------------------------------------------
     4. Fitur yang DIHAPUS 2026-10-11 benar-benar hilang dari modul
     ------------------------------------------------------------------
     Kalau seseorang mengembalikan salah satunya diam-diam, mode Static atau Acuan Bisnis
     hidup lagi tanpa keputusan apa pun.
     ------------------------------------------------------------------ */
  ['fixedContributionClass', 'KONTRIBUSI_TETAP', 'KONTRIBUSI_LABEL', 'referenceGap',
    'referenceRatio', 'businessReferenceGroup'].forEach((nama) => {
    assert.strictEqual(salesStats[nama], undefined, `${nama} masih diekspor sales-stats.js`);
  });
  /* ------------------------------------------------------------------
     6. contributionsByOutlet — relatif terhadap TOTAL SELURUH POS, bukan per kota
     ------------------------------------------------------------------ */
  const rowsPos = [
    { outlet: 'POS-1', units: 10 },
    { outlet: 'POS-2', units: 90 },
    { outlet: 'POS-3', units: 0 },
  ];
  const kontribusiPos = contributionsByOutlet(rowsPos);
  assert.strictEqual(kontribusiPos.get('POS-1'), 10);
  assert.strictEqual(kontribusiPos.get('POS-2'), 90);
  assert.strictEqual(kontribusiPos.get('POS-3'), 0);
  assert.strictEqual(contributionsByOutlet([]).size, 0,
    'tidak ada baris seharusnya tidak menghasilkan NaN/Infinity di mana pun');

  /* ------------------------------------------------------------------
     6b. contributionsByDistrict — sama seperti contributionsByOutlet tapi per
         kecamatan, relatif terhadap TOTAL rows yang dioper (bukan kotanya sendiri) —
         dipakai blok Analisis Penjualan Wilayah, basisnya SENGAJA beda dari
         districtStats()
     ------------------------------------------------------------------ */
  const rowsKec = [
    { district: 'KEC-X', village: 'KEC-X.1', units: 10 },
    { district: 'KEC-X', village: 'KEC-X.2', units: 20 },
    { district: 'KEC-Y', village: 'KEC-Y.1', units: 70 },
    { district: 'KEC-Z', village: 'KEC-Z.1', units: 0 },
  ];
  const kontribusiKecTotal = contributionsByDistrict(rowsKec);
  assert.strictEqual(kontribusiKecTotal.get('KEC-X'), 30, 'dua desa KEC-X tidak digabung');
  assert.strictEqual(kontribusiKecTotal.get('KEC-Y'), 70);
  assert.strictEqual(kontribusiKecTotal.get('KEC-Z'), 0);
  assert.strictEqual(contributionsByDistrict([]).size, 0);

  /* ------------------------------------------------------------------
     8. groupSplit — %coverage 1..N per KECAMATAN (sejak 2026-08-31 sore, ring
        pindah ke dealer & coverage pos jadi per kecamatan; sejak 2026-10-10 baris
        penjualan langsung membawa kecamatannya)
     ------------------------------------------------------------------ */
  const groupMap = { 'KEC-1': 1, 'KEC-2': 2, 'KEC-3': 3 };
  const rowsGrup = [
    { district: 'KEC-1', units: 10 },
    { district: 'KEC-2', units: 20 },
    { district: 'KEC-3', units: 30 },
    { district: 'KEC-X', units: 40 },
  ];
  const split = groupSplit(rowsGrup, groupMap, 3);
  assert.strictEqual(split.total, 100, 'desa tanpa grup tetap ikut masuk total');
  assert.deepStrictEqual(split.percents, [10, 20, 30],
    'percents[0..2] harus persis kelompok 1/2/3');
  assert.strictEqual(100 - split.percents.reduce((a, b) => a + b, 0), 40,
    '%di luar semua kelompok harus sama dengan porsi desa tanpa grup');
  assert.deepStrictEqual(groupSplit([], groupMap, 3),
    { total: 0, percents: [0, 0, 0] },
    'tanpa baris seharusnya nol rapi, bukan NaN dari pembagian 0/0');
  assert.deepStrictEqual(groupSplit(rowsGrup, undefined, 3),
    { total: 100, percents: [0, 0, 0] },
    'entitas tanpa grup sama sekali (groupMap undefined) seharusnya semua di luar grup');

  /* ------------------------------------------------------------------
     9. dealerRingSplit — LIMA kategori saling lepas (sejak 2026-10-11)
     ------------------------------------------------------------------
     Ring 1/2/3 (ring MENANG atas semuanya), Others (di luar ring tapi di kota dealer atau
     kecamatan yang ditoleransi), Pelanggaran Wilayah (di luar ring, di luar kota dealer,
     dan bukan kecamatan yang ditoleransi). Jumlahnya selalu 100%.
     ------------------------------------------------------------------ */
  const kotaKecamatan = {
    'KEC-1': 'KOTA-A', 'KEC-2': 'KOTA-B', 'KEC-3': 'KOTA-A', 'KEC-4': 'KOTA-B',
    'KEC-5': 'KOTA-C', 'KEC-6': 'KOTA-C',
  };
  const dealerA = {
    cityCode: 'KOTA-A',
    cityOfDistrict: (kode) => kotaKecamatan[kode] || null,
    tolerated: new Set(['KEC-4']),     // kecamatan kota lain yang berbatasan dengan dealer
  };
  const ringA = { 'KEC-1': 1, 'KEC-2': 2, 'KEC-5': 3 };
  const rowsLima = [
    { district: 'KEC-1', units: 10 },   // ring 1 (juga di kota dealer: ring menang)
    { district: 'KEC-2', units: 20 },   // ring 2 DI KOTA LAIN: ring boleh lintas kota
    { district: 'KEC-5', units: 5 },    // ring 3 di kota lain
    { district: 'KEC-3', units: 15 },   // tak di ring, kota dealer -> Others
    { district: 'KEC-4', units: 10 },   // tak di ring, kota lain tapi ditoleransi -> Others
    { district: 'KEC-6', units: 40 },   // tak di ring, kota lain, tak ditoleransi -> Pelanggaran
  ];
  const lima = dealerRingSplit(rowsLima, ringA, dealerA);
  assert.strictEqual(lima.total, 100);
  assert.strictEqual(lima.percent1, 10);
  assert.strictEqual(lima.percent2, 20,
    'ring 2 di kota lain harus tetap ring (ring boleh mencakup kota lain)');
  assert.strictEqual(lima.percent3, 5);
  assert.strictEqual(lima.percentOthers, 25,
    'Others = kota dealer di luar ring (15) + kecamatan perbatasan yang ditoleransi (10)');
  assert.strictEqual(lima.percentViolation, 40,
    'di luar ring, di luar kota dealer, dan tidak ditoleransi harus Pelanggaran Wilayah');
  assert.strictEqual(
    lima.percent1 + lima.percent2 + lima.percent3 + lima.percentOthers + lima.percentViolation,
    100, 'lima kategori tidak berjumlah 100% (hitung ganda atau ada yang hilang)');
  assert.strictEqual(lima.kotaTakDikenal, false);

  // Ring MENANG: kecamatan yang sekaligus di kota dealer, tertoleransi, DAN di ring -> ring.
  const ringMenang = dealerRingSplit([{ district: 'KEC-4', units: 10 }], { 'KEC-4': 3 }, dealerA);
  assert.strictEqual(ringMenang.percent3, 100, 'ring tidak menang atas Others');
  assert.strictEqual(ringMenang.percentOthers, 0);

  // Tanpa toleransi, kecamatan perbatasan yang sama jadi Pelanggaran: tanpa pengecualian
  // perbatasan, hasilnya berubah — inilah yang membuktikan pengecualiannya bekerja.
  const tanpaToleransi = dealerRingSplit([{ district: 'KEC-4', units: 10 }], {},
    { ...dealerA, tolerated: new Set() });
  assert.strictEqual(tanpaToleransi.percentViolation, 100);
  assert.strictEqual(dealerRingSplit([{ district: 'KEC-4', units: 10 }], {}, dealerA).percentOthers,
    100, 'kecamatan perbatasan yang ditoleransi harus Others, bukan Pelanggaran');

  // Kota dealer tidak tercatat: tidak ada dasar menyebut sesuatu "pelanggaran".
  const takTahu = dealerRingSplit([{ district: 'KEC-6', units: 10 }], {},
    { ...dealerA, cityCode: null });
  assert.strictEqual(takTahu.percentViolation, 0, 'kota tak dikenal dituduh melanggar wilayah');
  assert.strictEqual(takTahu.percentOthers, 100);
  assert.strictEqual(takTahu.kotaTakDikenal, true);

  // Tanpa penjualan: nol rapi, bukan NaN.
  const kosongSplit = dealerRingSplit([], ringA, dealerA);
  assert.strictEqual(kosongSplit.total, 0);
  assert.strictEqual(kosongSplit.percentViolation, 0);

  /* ------------------------------------------------------------------
     9b. balancedPercents — dibulatkan TANPA merusak jumlahnya
     ------------------------------------------------------------------ */
  const tiga = [100 / 3, 100 / 3, 100 / 3];
  const bulat = balancedPercents(tiga, 1);
  assert.ok(Math.abs(bulat.reduce((a, b) => a + b, 0) - 100) < 1e-9,
    `1/3 + 1/3 + 1/3 dibulatkan jadi ${bulat.join('+')}, bukan 100,0`);
  // Pembulatan biasa tiap angka (toFixed) di sini menjumlah 99,9 — itu yang dicegah.
  // Premis ini ikut diperiksa supaya tes tidak lulus karena contohnya kebetulan mulus.
  assert.strictEqual(
    tiga.map((v) => Number(v.toFixed(1))).reduce((a, b) => a + b, 0).toFixed(1), '99.9',
    'premis tes: toFixed biasa pada tiga sepertiga harus menjumlah 99,9');
  const lagi = balancedPercents([12.25, 12.25, 12.25, 12.25, 51], 1);
  assert.ok(Math.abs(lagi.reduce((a, b) => a + b, 0) - 100) < 1e-9);
  assert.deepStrictEqual(balancedPercents([0, 0, 0], 1), [0, 0, 0],
    'tanpa data (jumlah 0) seharusnya tetap nol, bukan membagikan sisa');

  // Sel yang tampil di layar: lima label, berurutan, jumlah yang TAMPIL tetap 100,0%.
  const sel = ringCells(dealerRingSplit([
    { district: 'KEC-1', units: 1 }, { district: 'KEC-3', units: 1 }, { district: 'KEC-6', units: 1 },
  ], ringA, dealerA));
  assert.deepStrictEqual(sel.map((c) => c.label),
    ['Ring 1', 'Ring 2', 'Ring 3', 'Others', 'Pelanggaran Wilayah']);
  assert.ok(Math.abs(sel.reduce((s, c) => s + parseFloat(c.value), 0) - 100) < 1e-9,
    `angka yang tampil tidak berjumlah 100,0%: ${sel.map((c) => c.value).join(' + ')}`);
  assert.deepStrictEqual(ringCells(dealerRingSplit([], ringA, dealerA)).map((c) => c.value),
    ['—', '—', '—', '—', '—'], 'tanpa penjualan harus tanda hubung, bukan lima nol');

  /* ------------------------------------------------------------------
     10. posContributionInDealer — penyebutnya SELURUH penjualan dealer
     ------------------------------------------------------------------ */
  const nyata = new Set(['P1', 'P2']);
  const rowsDealerPos = [
    { outlet: 'P1', units: 20 }, { outlet: 'P2', units: 30 },
    { outlet: 'PROXY', units: 50 },       // penjualan tingkat dealer, belum per pos
  ];
  const share = posContributionInDealer(rowsDealerPos, (kode) => nyata.has(kode));
  assert.strictEqual(share.dealerTotal, 100);
  assert.strictEqual(share.perOutlet.get('P1'), 20, 'P1 = 20 dari 100 unit dealer');
  assert.strictEqual(share.perOutlet.get('P2'), 30);
  assert.strictEqual(share.perOutlet.has('PROXY'), false, 'baris proxy dihitung sebagai pos');
  assert.strictEqual(share.attributed, 50);
  assert.strictEqual(share.unattributed, 50);

  // Belum ada penjualan per pos sama sekali: attributed 0 -> layar menulis "belum tersedia".
  const belum = posContributionInDealer([{ outlet: 'PROXY', units: 80 }], (k) => nyata.has(k));
  assert.strictEqual(belum.attributed, 0);
  assert.strictEqual(belum.perOutlet.size, 0, 'pos tanpa penjualan tercatat tampil 0% palsu');
  assert.strictEqual(posContributionInDealer([], () => true).dealerTotal, 0);

  /* ------------------------------------------------------------------
     8. Target penjualan (2026-10-11): monthsBetween + targetProgress
     ------------------------------------------------------------------ */
  const ada = ['2026-01', '2026-02', '2026-03', '2026-04'];
  assert.deepStrictEqual(monthsBetween('2026-02', '2026-03', ada), ['2026-02', '2026-03']);
  assert.deepStrictEqual(monthsBetween('2026-03', '2026-03', ada), ['2026-03'], 'satu bulan = satu elemen');
  assert.deepStrictEqual(monthsBetween('ALL', 'ALL', ada), ada, "'ALL' = batas data");
  assert.deepStrictEqual(monthsBetween('2026-11', '2027-02', ada),
    ['2026-11', '2026-12', '2027-01', '2027-02'], 'rentang melewati pergantian tahun');
  assert.deepStrictEqual(monthsBetween('2026-01', '2026-04', ['2026-01', '2026-04']), ada,
    'bulan tanpa data di tengah rentang tetap ikut');
  assert.deepStrictEqual(monthsBetween('2026-05', '2026-02', ada), [], 'rentang terbalik kosong');
  assert.deepStrictEqual(monthsBetween('ALL', 'ALL', []), [], 'tanpa data dan tanpa batas = kosong, bukan tebakan');
  assert.ok(monthsBetween('2000-01', '2099-12', ada).length <= 240, 'rentang ngawur ada batas pengaman');

  const barisT = [
    { dealer: 'D1', period: '2026-03', units: 40 },
    { dealer: 'D1', period: '2026-04', units: 60 },
    { dealer: 'D2', period: '2026-03', units: 30 },
    { dealer: 'D3', period: '2026-03', units: 500 },     // tanpa target
    { dealer: 'D1', period: '2026-02', units: 999 },     // di luar bulan
  ];
  const targetT = {
    '2026-03': { D1: 100, D2: 60, D4: 0 },
    '2026-04': { D1: 100 },
  };
  const satuBulan = targetProgress({
    dealerCodes: ['D1', 'D2', 'D3', 'D4'], rows: barisT, targets: targetT, months: ['2026-03'],
  });
  const per = Object.fromEntries(satuBulan.perDealer.map((d) => [d.code, d]));
  assert.strictEqual(per.D1.realized, 40, 'penjualan bulan lain ikut terhitung');
  assert.strictEqual(per.D1.percent, 40);
  assert.strictEqual(per.D2.percent, 50);
  assert.strictEqual(per.D3.target, null, 'belum punya target harus null, bukan 0');
  assert.strictEqual(per.D3.percent, null);
  assert.strictEqual(per.D4.target, 0, 'target nol adalah target yang sah');
  assert.strictEqual(per.D4.percent, null, 'dibagi nol bukan 0% dan bukan Infinity');
  // Persentase terendah dulu (yang tertinggal paling atas); tanpa persentase di bawah, dan di
  // antara mereka (D3 500 unit, D4 0 unit) yang penjualannya terbesar dulu.
  assert.deepStrictEqual(satuBulan.perDealer.map((d) => d.code), ['D1', 'D2', 'D3', 'D4']);
  const terbalik = targetProgress({
    dealerCodes: ['D2', 'D1'], rows: barisT, targets: { '2026-03': { D1: 100, D2: 40 } }, months: ['2026-03'],
  });
  assert.deepStrictEqual(terbalik.perDealer.map((d) => d.code), ['D1', 'D2'],
    'D1 40% harus di atas D2 75% walau urutan masukan sebaliknya');

  // TOTAL tidak boleh memasukkan penjualan dealer tanpa target ke pembilang.
  assert.strictEqual(satuBulan.total.target, 160);
  assert.strictEqual(satuBulan.total.realizedBertarget, 70);
  assert.strictEqual(satuBulan.total.percent, 43.75);
  assert.strictEqual(satuBulan.total.realized, 570, 'realized total tetap seluruh dealer');
  assert.strictEqual(satuBulan.total.dealerTotal, 4);
  assert.strictEqual(satuBulan.total.dealerBertarget, 2, 'target nol tidak dihitung punya target');

  // Rentang dua bulan: target dijumlahkan per bulan, penjualan juga.
  const duaBulan = targetProgress({
    dealerCodes: ['D1'], rows: barisT, targets: targetT, months: ['2026-03', '2026-04'],
  });
  assert.strictEqual(duaBulan.perDealer[0].realized, 100);
  assert.strictEqual(duaBulan.perDealer[0].target, 200);
  assert.strictEqual(duaBulan.perDealer[0].percent, 50);
  // Target hanya ada di satu dari dua bulan: tetap dihitung, bukan dianggap "belum punya".
  const sebagian = targetProgress({
    dealerCodes: ['D2'], rows: barisT, targets: targetT, months: ['2026-03', '2026-04'],
  });
  assert.strictEqual(sebagian.perDealer[0].target, 60);

  // Melewati 100% tidak dijepit di hitungan (penjepitan hanya urusan lebar bar).
  const lewat = targetProgress({
    dealerCodes: ['D1'], rows: [{ dealer: 'D1', period: '2026-03', units: 150 }],
    targets: { '2026-03': { D1: 100 } }, months: ['2026-03'],
  });
  assert.strictEqual(lewat.perDealer[0].percent, 150);

  // Tanpa target sama sekali: total null (bukan 0%), seluruh dealer dilaporkan tak bertarget.
  const kosongT = targetProgress({ dealerCodes: ['D1', 'D2'], rows: barisT, targets: {}, months: ['2026-03'] });
  assert.strictEqual(kosongT.total.percent, null);
  assert.strictEqual(kosongT.total.dealerBertarget, 0);
  assert.strictEqual(kosongT.total.dealerTotal, 2);

  /* ------------------------------------------------------------------
     9. relatedDistricts (2026-10-11): garis kecamatan yang tetap tampil saat difilter
     ------------------------------------------------------------------ */
  const terkait = relatedDistricts({
    salesDistricts: ['K-JUAL-1', 'K-JUAL-2'],
    dealerCodes: ['D1', 'D2'],
    dealerHome: { D1: 'K-ASAL-1', D2: 'K-ASAL-2', D9: 'K-LAIN' },
    dealerRings: { D1: { 'K-RING-1': 1, 'K-JUAL-1': 2 }, D2: {}, D9: { 'K-RING-LAIN': 1 } },
    posCoverage: { P1: { 'K-COVER-1': 1 }, P9: { 'K-COVER-LAIN': 2 } },
    outletCodes: ['P1'],
    extra: ['K-TITIK', null, undefined, ''],
  });
  assert.deepStrictEqual([...terkait].sort(), [
    'K-ASAL-1', 'K-ASAL-2', 'K-COVER-1', 'K-JUAL-1', 'K-JUAL-2', 'K-RING-1', 'K-TITIK',
  ], 'kecamatan terkait salah: harus penjualan + asal dealer + ring dealer + Kec. Tercover pos ' +
    'terpilih + kecamatan titik, tanpa duplikat dan tanpa nilai kosong');
  assert.ok(!terkait.has('K-LAIN') && !terkait.has('K-RING-LAIN') && !terkait.has('K-COVER-LAIN'),
    'dealer/pos di luar yang difokuskan ikut membuat kecamatannya terkait');
  assert.strictEqual(relatedDistricts({}).size, 0, 'tanpa masukan harus himpunan kosong, bukan galat');
  assert.deepStrictEqual([...relatedDistricts({ salesDistricts: ['A'], dealerCodes: ['D1'] })], ['A'],
    'dealer tanpa asal/ring tidak boleh menambah apa pun');

  console.log('OK sales-stats — kontribusi dihitung per kota (bukan global), total ' +
    'nol menghasilkan null, mode Static dan Acuan Bisnis sudah hilang, kontribusi per ' +
    'outlet, %kec. tercover per pos, lima kategori jangkauan dealer saling lepas dan ' +
    'berjumlah 100% (ring menang, perbatasan ditoleransi, kota tak dikenal bukan ' +
    'pelanggaran), pembulatan menjaga jumlah, dan kontribusi pos ke dealer');}

test().catch((error) => {
  console.error(error);
  process.exit(1);
});
