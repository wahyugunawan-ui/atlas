/**
 * Uji impor: idempotensi, rollback, kunci sekali-jalan, dan penanganan berkas.
 *
 * Memakai database uji sendiri (`astra_test_import`), bukan database sungguhan. Yang
 * dijaga di sini bukan "impornya jalan" — itu terlihat sendiri — tapi hal-hal yang
 * gagalnya diam: impor ulang yang menggandakan data, impor gagal yang meninggalkan
 * setengah, dan nama berkas dari pengguna yang bisa keluar dari folder tujuan.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const store = require('../backend/server/db');
const { runImport, checkHeader } = require('../backend/server/importer');
const repo = require('../backend/server/repository');
const { parseMultipart } = require('../backend/server/routes');
const { openTestDb, closeTestDb, dropCustomerDatabase,
  queryOutsidePool } = require('./helpers/db');

const HEADER = 'Nama,Alamat,Kel,Kec,Kode Kota Konsumen,Kode Pos,Kode Prov,' +
  'Kode Dealer,NAMA Dealer,Alamat,Kelurahan,Kecamatan,Kabupaten,Propinsi';

/** Satu baris CSV. Kolom 0 dan 1 diisi PII sungguhan supaya kebocorannya ketahuan. */
function row(village, district, city, outletCode, outletName) {
  return ['Budi Santoso', 'Jl. Rahasia No. 1', village, district, city, '55584', '34',
    outletCode, outletName || 'ASTRA MOTOR SLEMAN', 'Jl. Magelang Km 7',
    'Tamanagung', 'Muntilan', 'Kab. Magelang', 'Jawa Tengah'].join(',');
}

function makeCsv(dir, name, rows) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, [HEADER].concat(rows).join('\n'));
  return file;
}

async function seedVillages(db) {
  const sql = `
    INSERT INTO villages (village_code, village_name, district_code, district_name,
                          city_code, city_name, province_code, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  await store.run(db, sql, ['34.04.06.2003', 'Sinduadi', '34.04.06', 'Mlati', '34.04',
    'Kabupaten Sleman', '34', -7.75, 110.36]);
  await store.run(db, sql, ['33.01.01.2001', 'Tambakreja', '33.01.01', 'Kedungreja',
    '33.01', 'Kabupaten Cilacap', '33', -7.6, 108.9]);
  // Sengaja beda SATU huruf dari "Karangwuni" yang muncul di CSV uji. Itu bentuk
  // kegagalan yang sungguhan terjadi: 31 dari 50 nama yang belum cocok di data asli
  // ternyata varian ejaan dari kelurahan yang sudah ada, bukan kelurahan yang hilang.
  await store.run(db, sql, ['34.01.05.2005', 'Karangwuno', '34.01.05', 'Wates',
    '34.01', 'Kabupaten Kulon Progo', '34', -7.85, 110.15]);
  // Sekecamatan dengan yang di atas dan namanya juga mirip — supaya peringkat saran
  // benar-benar harus memilih, bukan cuma mengembalikan satu-satunya kandidat.
  await store.run(db, sql, ['34.01.05.2006', 'Karangsari', '34.01.05', 'Wates',
    '34.01', 'Kabupaten Kulon Progo', '34', -7.86, 110.16]);
}

async function test() {
  const config = await openTestDb('import');
  const dir = config.dataDir;
  const db = store.db();
  await seedVillages(db);

  const total = async () =>
    (await store.one(db, 'SELECT COALESCE(SUM(quantity),0) AS n FROM sales')).n;
  const rowCount = async () =>
    (await store.one(db, 'SELECT COUNT(*) AS n FROM sales')).n;

  try {
    // --- impor pertama ---
    const file = makeCsv(dir, 'agustus.csv', [
      row('Sinduadi', 'Mlati', '34.04', 'O01'),
      row('Sinduadi', 'Mlati', '34.04', 'O01'),
      row('Tambakreja', 'Kedungreja', '33.01', 'O02', 'NUSANTARA SAKTI - CILACAP'),
      row('Karangwuni', 'Wates', '34.01', 'O02'),        // tidak ada di indeks
    ]);
    const first = await runImport({
      file, period: '2026-08', fileName: 'agustus.csv', config });

    assert.strictEqual(first.rowsRead, 4);
    assert.strictEqual(first.rowsUsed, 3);
    assert.strictEqual(await total(), 3);
    assert.strictEqual(first.unmatched.length, 1, 'yang tidak cocok harus dilaporkan');
    assert.strictEqual(first.unmatched[0].villageName, 'Karangwuni');
    assert.strictEqual(first.newOutlets.length, 2);

    // Yang tidak cocok tersimpan, bukan cuma dilaporkan lalu hilang.
    assert.strictEqual((await repo.unmatched('2026-08')).length, 1);

    // --- COMMIT benar-benar terjadi ---
    //
    // Diperiksa lewat koneksi LAIN. Pool aplikasi memakai koneksi yang sama sepanjang
    // tes ini, dan koneksi itu melihat tulisannya sendiri walaupun transaksinya
    // menggantung — jadi memeriksa lewat repo akan hijau meski COMMIT-nya dihapus.
    // Uji mutasi membuktikan itu: tanpa pemeriksaan ini, menghapus commit() lolos.
    const committed = await queryOutsidePool(config,
      'SELECT COALESCE(SUM(quantity),0) AS n FROM sales');
    assert.strictEqual(committed[0].n, 3,
      'impor tidak di-commit — datanya tidak terlihat dari koneksi lain');

    // --- PII tidak boleh masuk database bisnis ---
    const dump = JSON.stringify(await repo.summary());
    assert.ok(!dump.includes('Budi'), 'nama konsumen bocor ke database bisnis');
    assert.ok(!dump.includes('Rahasia'), 'alamat konsumen bocor ke database bisnis');
    assert.strictEqual(repo.hasCustomers(), false,
      'database konsumen dibuat padahal withCustomers tidak dinyalakan');

    // --- idempoten ---
    const second = await runImport({
      file, period: '2026-08', fileName: 'agustus.csv', config });
    assert.strictEqual(second.rowsUsed, 3);
    assert.strictEqual(await total(), 3,
      'impor ulang periode yang sama menggandakan data');
    assert.strictEqual((await repo.unmatched('2026-08')).length, 1,
      'daftar tidak-cocok ikut menggandakan');

    // --- periode lain tidak tersentuh ---
    const july = makeCsv(dir, 'juli.csv', [row('Sinduadi', 'Mlati', '34.04', 'O01')]);
    await runImport({ file: july, period: '2026-07', fileName: 'juli.csv', config });
    assert.strictEqual(await total(), 4, 'impor bulan lain mengubah bulan sebelumnya');
    await runImport({ file, period: '2026-08', fileName: 'agustus.csv', config });
    assert.strictEqual(await total(), 4, 'impor ulang Agustus menghapus Juli');

    // --- suntingan manusia tidak ditimpa impor bulanan ---
    await repo.updateOutlet('O01', { dealerCode: 'DIKURASI', dealerName: 'Sudah Diperiksa',
      lat: -7.7, lng: 110.3 });
    await runImport({ file, period: '2026-08', fileName: 'agustus.csv', config });
    const outlet = (await repo.summary()).outlets.find((o) => o.code === 'O01');
    assert.strictEqual(outlet.dealerCode, 'DIKURASI',
      'impor menimpa pengelompokan yang sudah diperbaiki manusia');
    assert.strictEqual(outlet.lat, -7.7, 'impor menimpa koordinat hasil pin manual');
    assert.ok(outlet.address, 'alamat outlet dari Excel tidak tersimpan');

    // --- gagal di tengah tidak meninggalkan setengah ---
    const before = await total();
    const beforeRows = await rowCount();
    const broken = path.join(dir, 'rusak.csv');
    fs.writeFileSync(broken, 'ini,bukan,laporan\n1,2,3\n');
    await assert.rejects(
      () => runImport({ file: broken, period: '2026-08', fileName: 'rusak.csv', config }),
      /bukan laporan bulanan/i);
    assert.strictEqual(await total(), before, 'impor gagal mengubah data yang sudah ada');
    assert.strictEqual(await rowCount(), beforeRows);

    // Kegagalan tercatat, bukan hilang tanpa jejak.
    const history = await repo.imports(10);
    assert.ok(history.some((h) => h.result === 'gagal'),
      'impor yang gagal tidak tercatat di riwayat');
    assert.ok(history.some((h) => h.result === 'ok'));

    // --- rollback: gagal DI DALAM transaksi ---
    //
    // Berkas rusak di atas ditolak SEBELUM transaksi dimulai, jadi tidak menguji
    // rollback sama sekali. Yang ini menyuntikkan kegagalan di tengah penulisan, dan
    // itu satu-satunya cara memastikan ROLLBACK-nya benar-benar ada — uji mutasi
    // membuktikan tes sebelumnya lolos meski ROLLBACK dihapus.
    //
    // Ada jebakan tambahan: transaksi hanya berlaku pada SATU koneksi. Kalau
    // store.transaction() memakai pool untuk perintah di dalamnya, DELETE-nya jalan di
    // koneksi lain, di luar transaksi, dan tidak pernah tergulung balik. Tes ini merah
    // kalau itu terjadi.
    const beforeRollback = await total();
    await assert.rejects(() => store.transaction(db, async (conn) => {
      await conn.query('DELETE FROM sales WHERE period = ?', ['2026-08']);
      await conn.query(
        'INSERT INTO sales (period, village_code, outlet_code, quantity) VALUES (?,?,?,?)',
        ['2026-08', '34.04.06.2003', 'O01', 999]);
      throw new Error('gagal di tengah');
    }), /gagal di tengah/);
    assert.strictEqual(await total(), beforeRollback,
      'transaksi gagal tidak digulung balik — data separuh tertinggal di database');

    // --- pengelompokan hasil kurasi bertahan meski nama di Excel berubah ---
    //
    // Kalau namanya berubah, tebakan otomatis akan menghasilkan dealer yang berbeda.
    // Yang menang harus tetap yang sudah diperiksa manusia.
    const renamed = makeCsv(dir, 'nama-baru.csv', [
      row('Sinduadi', 'Mlati', '34.04', 'O01', 'MERK LAIN - SLEMAN'),
    ]);
    await runImport({ file: renamed, period: '2026-08', fileName: 'nama-baru.csv', config });
    const stillCurated = (await repo.summary()).outlets.find((o) => o.code === 'O01');
    assert.strictEqual(stillCurated.dealerCode, 'DIKURASI',
      'nama baru di Excel menimpa pengelompokan yang sudah dikurasi');
    assert.strictEqual(stillCurated.lat, -7.7, 'koordinat hasil pin manual ikut tertimpa');

    // --- Fase 5: memindahkan pos ke dealer lain ---
    //
    // Pengelompokan dealer awalnya TEBAKAN dari nama pos, dan CLAUDE.md melarang
    // identitas diturunkan dari nama. Peredamnya: tebakan itu harus bisa diperbaiki
    // manusia. Bagian koordinat sudah; bagian dealer inilah yang dulu belum ada.

    // Pindah ke dealer yang SUDAH ADA lewat namanya: kodenya harus DIPAKAI ULANG,
    // bukan diturunkan ulang dari namanya.
    //
    // Sasarannya sengaja O01, yang kodenya `DIKURASI` sementara namanya
    // "Sudah Diperiksa" — kode yang TIDAK bisa diturunkan dari nama. Itu bukan
    // karangan: seed-outlets.js memasang kode dealer dari CSV kurasi, jadi kode yang
    // tidak sama dengan turunan namanya memang ada di data sungguhan.
    //
    // Kalau sasarannya dealer yang kodenya kebetulan turunan namanya, kedua jalur
    // menghasilkan jawaban yang sama dan tes ini tidak menguji apa pun — sudah dicoba,
    // dan mutasinya lolos.
    const tujuan = (await repo.summary()).outlets.find((o) => o.code === 'O01');
    assert.strictEqual(tujuan.dealerCode, 'DIKURASI', 'prasyarat tes berubah');
    assert.notStrictEqual(tujuan.dealerCode, 'SUDAHDIPERIKSA',
      'kode sasaran harus BEDA dari turunan namanya, kalau tidak tesnya tumpul');

    const digabung = await repo.updateOutlet('O02', { dealerName: tujuan.dealerName });
    assert.strictEqual(digabung.dealerChanged, true, 'perpindahan dealer tidak dilaporkan');
    assert.strictEqual(digabung.outlet.dealerCode, 'DIKURASI',
      'kode dealer tidak dipakai ulang — jadi dua dealer dengan nama yang sama persis');
    assert.strictEqual(digabung.outlet.dealerName, tujuan.dealerName);

    // Bergabung ke dealer yang SUDAH ADA tidak boleh membuat baris dealers kedua —
    // resolveDealer() cuma menulis dealers untuk nama yang benar-benar baru.
    assert.strictEqual(
      (await store.one(db, "SELECT COUNT(*) AS n FROM dealers WHERE dealer_code = 'DIKURASI'")).n,
      1, 'bergabung ke dealer yang sudah ada menggandakan barisnya di tabel dealers');

    // Jalur patch.dealerCode LANGSUNG (skrip/tes, dipakai lagi di sini dengan nama
    // yang beda dari yang sudah tersimpan) tidak boleh menimpa nama dealer yang
    // sudah ada — upsertDealer() memakai ON CONFLICT DO NOTHING, bukan DO UPDATE.
    // Tanpa penjaga ini, jalur langsung bisa mengganti nama dealer diam-diam cuma
    // karena kebetulan dipanggil dengan ejaan berbeda.
    await repo.updateOutlet('O01', { dealerCode: 'DIKURASI', dealerName: 'Nama Lain Sekali' });
    assert.strictEqual(
      (await store.one(db, "SELECT dealer_name AS n FROM dealers WHERE dealer_code = 'DIKURASI'")).n,
      'Sudah Diperiksa',
      'jalur dealerCode langsung menimpa nama dealer yang sudah tersimpan di tabel dealers');

    // Nama dicocokkan tanpa memandang besar-kecil huruf dan spasi berlebih, karena
    // itu yang diketik manusia.
    await repo.updateOutlet('O02', { dealerName: '  sudah diperiksa ' });
    const tetapSama = (await repo.summary()).outlets.find((o) => o.code === 'O02');
    assert.strictEqual(tetapSama.dealerCode, 'DIKURASI',
      'beda besar-kecil huruf dianggap dealer yang berbeda');

    // O02 di-pin dulu. Tanpa koordinat, cabang hitung-ulang jangkauan tidak pernah
    // terjangkau sama sekali, dan pemeriksaan coverageRebuilt di bawah jadi hijau
    // karena alasan yang salah — sudah dicoba, dan mutasinya lolos.
    await repo.updateOutlet('O02', { lat: -7.6, lng: 108.9 }, config);

    // Dealer yang BENAR-BENAR baru: kodenya diturunkan, dan harus deterministik.
    // config ikut dikirim supaya jalur hitung-ulang jangkauan benar-benar terlewati,
    // bukan terlewati karena confignya kebetulan tidak ada.
    const baru = await repo.updateOutlet('O02', { dealerName: 'Dealer Baru Sekali' }, config);
    assert.strictEqual(baru.outlet.dealerCode, 'DEALERBARUSEKALI',
      'kode dealer baru tidak diturunkan dengan aturan yang sama');
    assert.strictEqual(baru.outlet.dealerName, 'Dealer Baru Sekali');

    // Dealer yang benar-benar baru HARUS langsung tercatat di tabel dealers — wajib
    // sejak outlets.dealer_code jadi FOREIGN KEY ke sana. Kalau tidak, baris outlet
    // di atas mestinya sudah ditolak database sebelum sampai ke assert ini; tes ini
    // memeriksa ISINYA, bukan cuma bahwa penulisannya tidak melempar error.
    const dealerBaruTercatat = await store.one(db,
      "SELECT dealer_name AS n FROM dealers WHERE dealer_code = 'DEALERBARUSEKALI'");
    assert.strictEqual(dealerBaruTercatat && dealerBaruTercatat.n, 'Dealer Baru Sekali',
      'dealer baru tidak tercatat di tabel dealers dengan nama yang benar');

    // Memindahkan dealer tidak memicu hitung ulang jangkauan — jangkauan bergantung
    // pada lokasi, bukan pada pengelompokan.
    assert.strictEqual(baru.coverageRebuilt, false,
      'pindah dealer memicu hitung ulang jangkauan yang tidak perlu');

    // Dan tidak menyentuh koordinat. O01 yang di-pin manual harus tetap utuh.
    const pinUtuh = (await repo.summary()).outlets.find((o) => o.code === 'O01');
    assert.strictEqual(pinUtuh.lat, -7.7, 'menyunting dealer ikut mengubah koordinat');

    // Nama yang tidak memuat huruf atau angka ditolak: kodenya akan kosong, dan kode
    // kosong menggabungkan semua outlet bernasib sama jadi satu dealer hantu.
    await assert.rejects(() => repo.updateOutlet('O02', { dealerName: '---' }),
      /tidak bisa dipakai/i);

    // Dan yang paling penting: perpindahan ini harus BERTAHAN terhadap impor bulanan
    // berikutnya, sama seperti koordinat.
    await runImport({ file, period: '2026-08', fileName: 'agustus.csv', config });
    const setelahImpor = (await repo.summary()).outlets.find((o) => o.code === 'O02');
    assert.strictEqual(setelahImpor.dealerCode, 'DEALERBARUSEKALI',
      'impor bulanan menimpa perpindahan dealer yang dilakukan manusia');

    // --- tambah pos dealer baru lewat aplikasi ---
    //
    // Biasanya outlet lahir dari impor. Ini untuk pos yang sudah buka tapi belum
    // muncul di Excel.
    const posBaru = await repo.createOutlet({
      outletCode: 'O99', outletName: 'POS BARU MANUAL',
      dealerName: 'Sudah Diperiksa', address: 'Jl. Baru 99',
      lat: -7.75, lng: 110.36,
    }, config);
    assert.strictEqual(posBaru.outlet.code, 'O99');
    // Dealer yang namanya sudah ada harus MEMAKAI ULANG kodenya, sama seperti waktu
    // memindahkan pos — kalau tidak, muncul dua dealer bernama sama persis.
    assert.strictEqual(posBaru.outlet.dealerCode, 'DIKURASI',
      'pos baru membuat dealer kedua alih-alih bergabung ke yang sudah ada');
    // Pos yang langsung punya koordinat langsung punya jangkauan. Tanpa ini dia tampil
    // 0% sampai ada yang ingat menjalankan seed-coverage.
    assert.strictEqual(posBaru.coverageRebuilt, true,
      'pos baru berkoordinat tidak dihitung jangkauannya');

    // Kode yang sudah dipakai ditolak, dan pesannya menyebut siapa pemakainya —
    // tanpa itu orang akan mengira kodenya salah ketik.
    await assert.rejects(() => repo.createOutlet({
      outletCode: 'O99', outletName: 'Lain', dealerName: 'X' }, config),
    /sudah dipakai/i);

    // Pos tanpa koordinat boleh dibuat, tapi tidak memicu hitung jangkauan.
    const tanpaPin = await repo.createOutlet({
      outletCode: 'O98', outletName: 'POS BELUM DI-PIN', dealerName: 'X Baru' }, config);
    assert.strictEqual(tanpaPin.coverageRebuilt, false);
    assert.strictEqual(tanpaPin.outlet.lat, null);

    // --- cocokkan nama kelurahan (alias) ---
    //
    // Menggantikan fitur "tambah kelurahan" yang dulu ada di sini. Fitur itu membuat
    // kelurahan BARU tanpa poligon; setelah seluruh Jateng + DIY masuk database
    // berpoligon, itu hampir selalu jawaban yang salah — nama yang tidak cocok hampir
    // selalu varian ejaan dari kelurahan yang sudah ada beserta batas wilayahnya.
    const menunggu = await repo.unmatchedWithSuggestions('2026-08');
    assert.strictEqual(menunggu.length, 1);
    assert.strictEqual(menunggu[0].villageName, 'Karangwuni');
    assert.strictEqual(menunggu[0].alias, null, 'alias muncul padahal belum pernah disimpan');

    // Sarannya harus MENGURUT, bukan sekadar mengembalikan apa saja yang mirip.
    // Karangwuno beda satu huruf, Karangsari beda tiga — dua-duanya sekecamatan.
    assert.strictEqual(menunggu[0].suggestions[0].code, '34.01.05.2005',
      'saran teratas bukan yang paling mirip ejaannya');
    assert.strictEqual(menunggu[0].suggestions[0].distance, 1);
    assert.ok(menunggu[0].suggestions.length > 1, 'kandidat lain sekota tidak ikut dikirim');
    assert.ok(menunggu[0].suggestions[1].distance > 1, 'urutan sarannya terbalik');

    // INI PEMERIKSAAN TERPENTING DI BLOK INI: saran TIDAK PERNAH dipakai sendiri.
    //
    // Saran yang bagus di atas tidak boleh mengubah apa pun sampai ada orang yang
    // menekan tombol. Kalau importer diam-diam memakai padanan terdekat, baris ini
    // merah — dan tanpa baris ini, penjualan bisa menempel ke kelurahan yang salah
    // tanpa satu pun gejala di layar.
    const tanpaKonfirmasi = await runImport({
      file, period: '2026-08', fileName: 'agustus.csv', config });
    assert.strictEqual(tanpaKonfirmasi.rowsUsed, 3,
      'impor mencocokkan sendiri tanpa konfirmasi manusia');
    assert.strictEqual((await repo.unmatched('2026-08')).length, 1);

    // Alias yang menunjuk kelurahan tidak ada DITOLAK — kalau lolos, penjualannya
    // hilang ke kelurahan hantu yang tidak pernah muncul di mana pun.
    await assert.rejects(() => repo.saveAlias({
      cityCode: '34.01', districtName: 'Wates', villageName: 'Karangwuni',
      villageCode: '99.99.99.9999' }), /tidak ada/i);

    // Alias lintas kabupaten juga ditolak. Kunci pencocokannya memuat kode kota, jadi
    // alias seperti itu tidak akan pernah terpakai — dan diam-diam tidak terpakai lebih
    // buruk daripada ditolak, karena yang menyimpannya mengira sudah beres.
    await assert.rejects(() => repo.saveAlias({
      cityCode: '34.01', districtName: 'Wates', villageName: 'Karangwuni',
      villageCode: '34.04.06.2003' }), /bukan/i);

    // --- konfirmasi manusia ---
    const target = await repo.saveAlias({
      cityCode: '34.01', districtName: 'Wates', villageName: 'Karangwuni',
      villageCode: '34.01.05.2005' });
    assert.strictEqual(target.name, 'Karangwuno');

    // Alias BARU BERLAKU pada impor berikutnya. Baris yang sudah tertulis tidak
    // berubah sendiri — itu janji yang tertulis di modalnya, jadi diuji di sini.
    assert.strictEqual((await repo.unmatched('2026-08')).length, 1,
      'alias mengubah baris yang sudah tersimpan tanpa impor ulang');

    const setelahAlias = await runImport({
      file, period: '2026-08', fileName: 'agustus.csv', config });
    assert.strictEqual(setelahAlias.rowsUsed, 4, 'alias tidak dipakai saat impor');
    assert.strictEqual(setelahAlias.unmatched.length, 0);
    // Dan penjualannya menempel ke kelurahan SUNGGUHAN, yang punya poligon sendiri.
    const menempel = await store.one(db, `
      SELECT SUM(quantity) AS n FROM sales
      WHERE period = '2026-08' AND village_code = '34.01.05.2005'`);
    assert.strictEqual(menempel.n, 1, 'baris beralias tidak masuk ke kelurahan tujuan');

    // Jumlah yang menunggu ikut ke summary(), supaya tombolnya bisa menampilkan
    // pekerjaan yang tertunda tanpa ada yang membuka modalnya dulu.
    assert.strictEqual((await repo.summary()).pendingNames, 0);

    // --- batalkan alias yang salah pilih ---
    await repo.deleteAlias('34.01', 'Wates', 'Karangwuni');
    assert.strictEqual((await repo.aliases()).length, 0);
    const setelahBatal = await runImport({
      file, period: '2026-08', fileName: 'agustus.csv', config });
    assert.strictEqual(setelahBatal.rowsUsed, 3, 'alias yang dibatalkan masih dipakai');
    assert.strictEqual((await repo.summary()).pendingNames, 1);

    // summary() tetap membawa hasGeom. Sekarang tidak ada satu pun jalur yang membuat
    // kelurahan tanpa poligon, dan justru itu sebabnya tandanya harus tetap ada: kalau
    // suatu saat ada yang masuk, dia harus TERLIHAT, bukan hilang diam-diam.
    const ringkas = await repo.summary();
    const lama = ringkas.villages.find((v) => v.code === '34.04.06.2003');
    assert.strictEqual(lama.hasGeom, false,
      'summary() tidak membawa hasGeom — halaman tidak bisa membedakan 0% dari belum dihitung');

    // --- summary() menyaring kelurahan yang tidak berarti ---
    //
    // Database memuat SELURUH Jateng + DIY supaya perluasan cakupan tidak butuh setelan
    // apa pun. Yang dikirim ke halaman harus lebih sempit: yang punya penjualan, yang
    // masuk radius pos, atau yang ditambah manual.
    //
    // Ini bukan soal ukuran payload. Tanpa penyaring, KPI "Kelurahan Kosong" berubah
    // makna diam-diam — dari "kelurahan di wilayah kita yang belum ada penjualan"
    // jadi "kelurahan di seluruh Jawa Tengah yang tidak kita jual". Angkanya benar
    // secara hitungan, tidak berguna secara bisnis, dan di layar terlihat seperti
    // kemunduran drastis.
    await store.run(db, `
      INSERT INTO villages (village_code, village_name, district_code, district_name,
                            city_code, city_name, province_code, geom, geom_m)
      VALUES ('34.04.09.9001', 'Jauh Tanpa Penjualan', '34.04.09', 'Jauh',
              '34.04', 'Kabupaten Sleman', '34',
              ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)),
              ST_Transform(ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)), 32749))`,
    [JSON.stringify({ type: 'Polygon', coordinates: [[[111.9, -8.4], [111.91, -8.4],
      [111.91, -8.41], [111.9, -8.4]]] }),
    JSON.stringify({ type: 'Polygon', coordinates: [[[111.9, -8.4], [111.91, -8.4],
      [111.91, -8.41], [111.9, -8.4]]] })]);

    const disaring = await repo.summary();
    const kodeTampil = new Set(disaring.villages.map((v) => v.code));

    assert.ok(!kodeTampil.has('34.04.09.9001'),
      'kelurahan tanpa penjualan DAN di luar semua radius ikut terkirim — ' +
      'KPI "Kelurahan Kosong" jadi menghitung seluruh provinsi');
    assert.ok(kodeTampil.has('34.04.06.2003'),
      'kelurahan yang punya penjualan malah tersaring keluar');
    // Kelurahan tanpa poligon TETAP dikirim walau tanpa penjualan. Sekarang tidak ada
    // jalur yang membuatnya, tapi jaringnya harus tetap ada: yang datanya belum lengkap
    // wajib terlihat dan ditandai, bukan hilang dari layar tanpa ada yang tahu.
    assert.ok(kodeTampil.has('34.01.05.2006'),
      'kelurahan tanpa poligon hilang dari layar — ketidaklengkapannya jadi tak terlihat');

    // Kembalikan keadaan supaya pemeriksaan sesudah ini tetap bermakna.
    await runImport({ file, period: '2026-08', fileName: 'agustus.csv', config });

    // --- format berkas ---
    await assert.rejects(
      () => runImport({ file: path.join(dir, 'x.pdf'), period: '2026-08', config }),
      /format berkas tidak dikenal/i);

    assert.throws(() => checkHeader(['a', 'b', 'c']), /bukan laporan bulanan/i);
    assert.doesNotThrow(() => checkHeader(HEADER.split(',')));

    // --- data konsumen: hanya kalau diminta, dan terpisah ---
    const withPii = await runImport({
      file, period: '2026-08', fileName: 'agustus.csv', withCustomers: true, config });
    assert.strictEqual(withPii.customers, 3);
    assert.strictEqual(repo.hasCustomers(), true);

    const inVillage = await repo.customersInVillage('34.04.06.2003',
      { from: '2026-08', to: '2026-08' });
    assert.strictEqual(inVillage.length, 2);
    assert.strictEqual(inVillage[0].name, 'Budi Santoso');

    // Agregatnya TETAP bersih meski konsumen ikut disimpan.
    assert.ok(!JSON.stringify(await repo.summary()).includes('Budi'),
      'nama konsumen bocor ke ringkasan');

    // --- halaman Data Konsumen: penyaring bebas, tapi hasilnya TETAP dipotong ---
    //
    // browseCustomers() adalah pintu KEDUA ke tabel yang sama. customersInVillage()
    // dijaga oleh kewajiban menyebut kelurahan; yang ini tidak punya kewajiban itu,
    // jadi batasnya harus dari LIMIT — dan itu yang diuji di sini. Tanpa tes ini,
    // menghapus LIMIT dari kueri tidak membuat satu tes pun merah, dan satu permintaan
    // bisa mengembalikan seluruh basis data konsumen.
    const banyak = [];
    for (let i = 0; i < repo.BROWSE_LIMIT + 120; i++) {
      banyak.push([`bulk-${i}`, '2026-08', '34.04.06.2003', 'O01',
        `Nama Massal ${i}`, `Jl. Massal ${i}`]);
    }
    const customersDb = store.customers();
    for (let i = 0; i < banyak.length; i += 200) {
      const chunk = store.bulkValues(banyak.slice(i, i + 200));
      await store.run(customersDb, `
        INSERT INTO customers (id, period, village_code, outlet_code, name, address)
        VALUES ${chunk.text}`, chunk.params);
    }

    const semua = await repo.browseCustomers({});
    assert.strictEqual(semua.rows.length, repo.BROWSE_LIMIT,
      'browseCustomers tidak memotong hasilnya — satu permintaan bisa menyedot semuanya');
    assert.ok(semua.total > repo.BROWSE_LIMIT,
      'jumlah sebenarnya harus dilaporkan, bukan cuma yang tampil');
    assert.strictEqual(semua.total, banyak.length + 3, 'jumlah totalnya salah hitung');

    // --- menelusuri halaman: tiap baris tepat sekali, tidak kembar, tidak terlewat ---
    //
    // Ini sifat yang paling gampang rusak diam-diam. Salah hitung offset satu langkah
    // membuat satu baris terlewat tiap halaman; urutan tanpa pemecah seri membuat baris
    // yang sama muncul di dua halaman. Dua-duanya tetap terlihat "jalan" di layar.
    //
    // Datanya sengaja dibuat banyak yang bernama SAMA persis, karena di situlah urutan
    // tanpa pemecah seri mulai goyah.
    //
    // Jumlahnya harus lebih besar dari satu halaman supaya deretan nama kembar itu
    // MELINTASI batas halaman. Dengan 300 baris kembar semuanya muat di halaman
    // pertama, serinya tidak pernah terbelah, dan menghapus pemecah seri tidak membuat
    // satu tes pun merah — sudah dicoba.
    const kembar = [];
    for (let i = 0; i < repo.BROWSE_LIMIT + 200; i++) {
      kembar.push([`sama-${i}`, '2026-08', '34.04.06.2003', 'O01',
        'NAMA KEMBAR', `Jl. Kembar ${i}`]);
    }
    for (let i = 0; i < kembar.length; i += 200) {
      const chunk = store.bulkValues(kembar.slice(i, i + 200));
      await store.run(customersDb, `
        INSERT INTO customers (id, period, village_code, outlet_code, name, address)
        VALUES ${chunk.text}`, chunk.params);
    }

    const terlihat = new Set();
    let halaman = 0;
    let offset = 0;
    let jumlahSeluruhnya = null;
    for (;;) {
      const page = await repo.browseCustomers({ offset });
      jumlahSeluruhnya = page.total;
      page.rows.forEach((r) => {
        assert.ok(!terlihat.has(r.id),
          `baris ${r.id} muncul di dua halaman — urutannya tidak pasti antar permintaan`);
        terlihat.add(r.id);
      });
      assert.strictEqual(page.offset, offset, 'server mengembalikan offset yang berbeda');
      halaman++;
      offset += page.rows.length;
      if (offset >= page.total || !page.rows.length) break;
      assert.ok(halaman < 20, 'penelusuran halaman tidak pernah berhenti');
    }
    assert.strictEqual(terlihat.size, jumlahSeluruhnya,
      `menelusuri semua halaman cuma melihat ${terlihat.size} dari ${jumlahSeluruhnya} ` +
      'baris — ada yang terlewat');
    assert.ok(halaman >= 2, 'datanya kurang untuk benar-benar menguji halaman kedua');

    // Offset yang melewati ujung dijepit ke AWAL halaman terakhir, bukan ke baris
    // terakhir. Bedanya kelihatan: dijepit ke total-1 memberi satu baris sendirian,
    // yang terlihat seperti datanya habis padahal cuma salah mendarat.
    const lewat = await repo.browseCustomers({ offset: jumlahSeluruhnya + 5000 });
    assert.ok(lewat.rows.length > 0,
      'offset yang lewat ujung menghasilkan tabel kosong, bukan halaman terakhir');
    assert.strictEqual(lewat.offset % repo.BROWSE_LIMIT, 0,
      'offset yang dijepit tidak mendarat di awal halaman');
    assert.strictEqual(lewat.offset + lewat.rows.length, jumlahSeluruhnya,
      'halaman terakhir tidak berakhir tepat di baris terakhir');
    assert.ok(lewat.rows.length > 1,
      'melompat lewat ujung mendarat di satu baris sendirian, bukan halaman terakhir');

    // Penyaring kota memakai awalan kode kelurahan. 34.04.06.2003 ada di kota 34.04;
    // 33.01.01.2001 tidak — kalau awalannya salah dipasang, keduanya ikut terbawa.
    const perKota = await repo.browseCustomers({ city: '33.01' });
    assert.ok(perKota.total > 0, 'penyaring kota tidak menemukan apa pun');
    assert.strictEqual(perKota.rows.every((r) => r.village.startsWith('33.01.')), true,
      'penyaring kota membawa kelurahan dari kota lain');

    // Pencarian mencari apa adanya. Tanda persen yang diketik pengguna TIDAK boleh
    // jadi wildcard yang mencocokkan seluruh tabel.
    const cariNama = await repo.browseCustomers({ query: 'Budi' });
    assert.strictEqual(cariNama.total, 3, 'pencarian nama tidak menemukan yang benar');
    const cariPersen = await repo.browseCustomers({ query: '%' });
    assert.strictEqual(cariPersen.total, 0,
      "'%' yang diketik pengguna diperlakukan sebagai wildcard, bukan sebagai karakter");

    /* --------------------------------------------------------------------
       RENTANG PERIODE DAN PENYARING PROVINSI
       --------------------------------------------------------------------
       Rentang menggantikan kesetaraan satu bulan. Yang gagal diam di sini ada tiga:
       batas yang hilang (satu sisi rentang dibuang -> hasilnya melebar), pembanding
       yang bergeser satu langkah (>= jadi >, <= jadi <), dan ujung yang diam-diam
       ditukar supaya rentang terbalik "diperbaiki" jadi seluruh isi tabel.

       Semua baris sampai titik ini periodenya 2026-08, jadi jumlahnya dipakai sebagai
       titik acuan — bukan angka yang ditulis tangan dan lupa diperbarui.
       -------------------------------------------------------------------- */

    const hanyaAgustus = (await repo.browseCustomers({})).total;

    const lain = [];
    for (let i = 0; i < 4; i++) {
      lain.push([`juli-${i}`, '2026-07', '34.04.06.2003', 'O01',
        `Nama Juli ${i}`, `Jl. Juli ${i}`]);
    }
    for (let i = 0; i < 2; i++) {
      lain.push([`sept-${i}`, '2026-09', '34.04.06.2003', 'O01',
        `Nama September ${i}`, `Jl. September ${i}`]);
    }
    const chunkLain = store.bulkValues(lain);
    await store.run(store.customers(), `
      INSERT INTO customers (id, period, village_code, outlet_code, name, address)
      VALUES ${chunkLain.text}`, chunkLain.params);

    assert.strictEqual(
      (await repo.browseCustomers({ periodFrom: '2026-08', periodTo: '2026-08' })).total,
      hanyaAgustus,
      'rentang satu bulan tidak sama dengan kesetaraan satu bulan');
    assert.strictEqual(
      (await repo.browseCustomers({ periodFrom: '2026-07', periodTo: '2026-08' })).total,
      hanyaAgustus + 4,
      'rentang dua bulan tidak menjumlahkan keduanya, atau ikut membawa September');
    assert.strictEqual(
      (await repo.browseCustomers({ periodTo: '2026-07' })).total, 4,
      'batas atas sendirian tidak menyaring — batas bawahnya hilang bukan alasan');
    assert.strictEqual(
      (await repo.browseCustomers({ periodFrom: '2026-09' })).total, 2,
      'batas bawah sendirian tidak menyaring');

    // Rentang terbalik menghasilkan NOL, bukan seluruh tabel. Repositori tidak boleh
    // "memperbaiki" urutan ujungnya sendiri: yang salah harus terlihat sebagai kosong,
    // dan penolakannya jadi urusan rute yang aturannya keras.
    assert.strictEqual(
      (await repo.browseCustomers({ periodFrom: '2026-09', periodTo: '2026-07' })).total, 0,
      'rentang terbalik diam-diam ditukar — hasilnya melebar, bukan kosong');

    // Provinsi penyaring MANDIRI: dia hidup berdampingan dengan kota, tidak menggantikannya.
    const perProvinsi = await repo.browseCustomers({ province: '33' });
    assert.ok(perProvinsi.total > 0, 'penyaring provinsi tidak menemukan apa pun');
    assert.strictEqual(perProvinsi.rows.every((r) => r.village.startsWith('33.')), true,
      'penyaring provinsi membawa kelurahan dari provinsi lain');
    assert.strictEqual((await repo.browseCustomers({ province: '34' })).total,
      (await repo.browseCustomers({})).total - perProvinsi.total,
      'provinsi 33 dan 34 tidak menghabiskan seluruh tabel — awalannya salah dipasang');

    // Pintu satunya harus bergerak bersamaan; kalau tidak, dua tempat menjawab
    // pertanyaan yang sama dengan angka yang berbeda.
    assert.strictEqual(
      (await repo.customersInVillage('34.04.06.2003', { from: '2026-07', to: '2026-07' })).length,
      4, 'customersInVillage tidak ikut menghormati rentang');
    assert.strictEqual(
      (await repo.customersInVillage('34.04.06.2003', { from: '2026-09', to: '2026-07' })).length,
      0, 'customersInVillage diam-diam menukar ujung rentang yang terbalik');

    // Panggilan gaya lama gagal keras. Tanpa penjaga ini, customersInVillage(v, '2026-08')
    // tetap jalan dan berarti "seluruh riwayat kelurahan itu" — lebih luas dari yang
    // diminta, tanpa error, di rute yang mengeluarkan nama dan alamat.
    await assert.rejects(
      () => repo.customersInVillage('34.04.06.2003', '2026-08'),
      /objek, bukan argumen berurutan/,
      'panggilan periode gaya lama tidak ditolak — pelebarannya senyap');

    // Bersihkan lagi supaya blok berikutnya berangkat dari keadaan yang sama.
    await store.run(store.customers(),
      "DELETE FROM customers WHERE period IN ('2026-07', '2026-09')");

    /* --------------------------------------------------------------------
       HAPUS SATU PERIODE
       --------------------------------------------------------------------
       Untuk bulan yang salah diimpor. Yang dijaga di sini bukan "hapusnya jalan" —
       itu terlihat sendiri — tapi tiga hal yang gagalnya diam: bulan lain ikut
       terbawa, PII tertinggal untuk bulan yang sudah hilang dari layar, dan
       penghapusan yang tidak meninggalkan jejak padahal satu akun dipakai bersama.
       -------------------------------------------------------------------- */

    const juliSebelum = await store.one(db,
      "SELECT COALESCE(SUM(quantity),0) AS n FROM sales WHERE period = '2026-07'");
    const konsumenAgustus = await store.one(store.customers(),
      "SELECT COUNT(*) AS n FROM customers WHERE period = '2026-08'");
    assert.ok(konsumenAgustus.n > 0, 'prasyarat tes: Agustus harus punya data konsumen');

    // Periode yang tidak ada datanya ditolak, bukan diam-diam "berhasil menghapus nol
    // baris" — pesan sukses untuk sesuatu yang tidak terjadi membuat orang mengira
    // bulannya sudah hilang.
    await assert.rejects(() => repo.deletePeriod('2020-01'), /tidak punya data/i);

    const dihapus = await repo.deletePeriod('2026-08', '10.0.0.9');
    assert.strictEqual(dihapus.units, 3);
    assert.strictEqual(dihapus.customers, konsumenAgustus.n,
      'jumlah data konsumen yang terhapus tidak dilaporkan apa adanya');

    assert.strictEqual(
      (await store.one(db, "SELECT COUNT(*) AS n FROM sales WHERE period='2026-08'")).n, 0);
    assert.strictEqual(
      (await store.one(db, "SELECT COUNT(*) AS n FROM unmatched WHERE period='2026-08'")).n,
      0, 'daftar nama belum cocok bulan itu ikut tertinggal');

    // PII bulan itu HARUS ikut hilang. Kalau tertinggal, yang tersisa adalah nama dan
    // alamat untuk bulan yang tidak muncul di mana pun — PII yang tidak terlihat siapa
    // pun dan tidak ada yang tahu masih ada.
    assert.strictEqual((await store.one(store.customers(),
      "SELECT COUNT(*) AS n FROM customers WHERE period='2026-08'")).n, 0,
    'data konsumen bulan yang dihapus masih tertinggal di database PII');

    // Bulan lain TIDAK boleh tersentuh.
    assert.strictEqual((await store.one(db,
      "SELECT COALESCE(SUM(quantity),0) AS n FROM sales WHERE period='2026-07'")).n,
    juliSebelum.n, 'menghapus Agustus ikut membawa Juli');

    // Jejaknya tercatat di riwayat impor. Satu akun dipakai bersama, jadi penghapusan
    // sebulan data tanpa jejak berarti tidak ada yang bisa menjawab "kok hilang?".
    const jejak = (await repo.imports(10)).find((h) => h.result === 'hapus');
    assert.ok(jejak, 'penghapusan periode tidak tercatat di riwayat impor');
    assert.strictEqual(jejak.period, '2026-08');
    assert.match(jejak.message, /arsip tidak ikut dihapus/i,
      'catatannya harus menyebut bahwa berkas Excel-nya masih ada — itu jalan pulihnya');

    // JALAN PULIHNYA BENAR-BENAR BEKERJA. Ini alasan berkas Excel di arsip sengaja
    // tidak ikut dihapus: impor ulang berkas yang sama mengembalikan keadaan persis
    // seperti semula, karena impornya idempoten.
    const pulih = await runImport({
      file, period: '2026-08', fileName: 'agustus.csv', withCustomers: true, config });
    assert.strictEqual(pulih.rowsUsed, 3, 'impor ulang setelah dihapus tidak memulihkan');
    assert.strictEqual((await store.one(db,
      "SELECT COALESCE(SUM(quantity),0) AS n FROM sales WHERE period='2026-08'")).n, 3);
    assert.strictEqual((await repo.unmatched('2026-08')).length, 1,
      'daftar belum cocok tidak ikut pulih');

    /* --------------------------------------------------------------------
       RING LAYANAN PER POS
       --------------------------------------------------------------------
       Ring menggantikan "dalam radius X km". Yang dijaga di sini bukan "simpannya
       jalan", tapi empat hal yang gagalnya diam: satu kecamatan masuk dua ring
       sekaligus (satu penjualan terhitung dua kali, totalnya tetap terlihat wajar),
       kecamatan asing yang dilewati diam-diam, susunan lama yang tertinggal sesudah
       ditimpa, dan ring yang tetap menempel pada pos yang sudah dihapus.
       -------------------------------------------------------------------- */

    const posRing = (await store.all(db, 'SELECT outlet_code FROM outlets LIMIT 1'))[0]
      .outlet_code;
    const kecUji = (await store.all(db,
      'SELECT DISTINCT district_code AS kode FROM villages ORDER BY district_code LIMIT 3'))
      .map((r) => r.kode);
    assert.strictEqual(kecUji.length, 3, 'prasyarat tes: butuh tiga kecamatan');

    await repo.saveOutletRings(posRing,
      { [kecUji[0]]: 1, [kecUji[1]]: 2, [kecUji[2]]: 3 });
    let ring = (await repo.allRings())[posRing];
    assert.deepStrictEqual(ring,
      { [kecUji[0]]: 1, [kecUji[1]]: 2, [kecUji[2]]: 3 },
      'ring tidak tersimpan apa adanya');

    // Menyimpan lagi MENGGANTI seluruhnya, bukan menambal. Kalau menambal, kecamatan
    // yang dibuang orang di layar tetap tinggal di database dan ikut dihitung.
    await repo.saveOutletRings(posRing, { [kecUji[0]]: 3 });
    ring = (await repo.allRings())[posRing];
    assert.deepStrictEqual(ring, { [kecUji[0]]: 3 },
      'menyimpan ring menambal, bukan mengganti — susunan lama tertinggal');

    // Satu kecamatan tidak bisa ada di dua ring sekaligus. Objek JS sudah mencegahnya
    // di sisi halaman, tapi yang menjaganya di database adalah primary key — dan itu
    // yang harus tetap benar kalau suatu hari ada pemanggil lain.
    await assert.rejects(
      () => store.run(db,
        'INSERT INTO outlet_rings (outlet_code, district_code, ring) VALUES (?, ?, ?)',
        [posRing, kecUji[0], 1]),
      /duplicate key|unique/i,
      'satu kecamatan bisa masuk dua ring sekaligus — penjualannya terhitung dua kali');

    // Kecamatan asing DITOLAK, bukan dilewati. Ring yang diam-diam kehilangan satu
    // kecamatan tetap terlihat masuk akal di layar.
    await assert.rejects(
      () => repo.saveOutletRings(posRing, { '99.99.99': 1 }),
      /tidak dikenal/i, 'kecamatan asing tidak ditolak');
    await assert.rejects(
      () => repo.saveOutletRings(posRing, { [kecUji[0]]: 4 }),
      /Ring harus/i, 'nomor ring di luar 1-3 tidak ditolak');
    await assert.rejects(
      () => repo.saveOutletRings('POS-TIDAK-ADA', { [kecUji[0]]: 1 }),
      /tidak ada/i, 'ring bisa disimpan untuk pos yang tidak ada');

    // Penolakan TIDAK boleh merusak yang sudah tersimpan.
    assert.deepStrictEqual((await repo.allRings())[posRing], { [kecUji[0]]: 3 },
      'ring yang sudah benar ikut hilang waktu simpan berikutnya ditolak');

    // Ring tidak boleh menempel pada pos yang sudah tidak ada. Dijaga foreign key
    // ON DELETE CASCADE, dan reset di bawah ini yang membuktikannya.

    /* --------------------------------------------------------------------
       RESET MASTER POS
       --------------------------------------------------------------------
       Jalur paling destruktif di aplikasi ini. Yang dijaga bukan "hapusnya jalan",
       tapi empat hal yang gagalnya diam: pos tertinggal padahal penjualannya sudah
       hilang (atau sebaliknya), PII yang tetap tinggal untuk penjualan yang sudah
       tidak ada di layar mana pun, penghapusan tanpa jejak padahal satu akun dipakai
       bersama, dan reset di database yang sudah kosong yang melaporkan "berhasil"
       untuk sesuatu yang tidak terjadi.
       -------------------------------------------------------------------- */

    // Baris jangkauan diisi tangan dulu. Impor tidak pernah membuatnya sendiri —
    // jangkauan dihitung terpisah lewat seed-coverage — jadi tanpa ini tabelnya kosong
    // dan assertion "coverage ikut dikosongkan" di bawah tidak pernah bisa merah.
    // Sudah dicoba: menghapus DELETE FROM coverage dari repositori tetap hijau.
    const posUji = (await store.all(db, 'SELECT outlet_code FROM outlets LIMIT 2'))
      .map((r) => r.outlet_code);
    const kelUji = (await store.all(db, 'SELECT village_code FROM villages LIMIT 2'))
      .map((r) => r.village_code);
    assert.ok(posUji.length && kelUji.length, 'prasyarat tes: butuh pos dan kelurahan');
    for (const kode of posUji) {
      for (const kel of kelUji) {
        await store.run(db,
          'INSERT INTO coverage (radius_m, outlet_code, village_code, ratio) VALUES (?, ?, ?, ?)',
          [5000, kode, kel, 0.5]);
      }
    }
    assert.ok(Number((await store.one(db, 'SELECT COUNT(*) AS n FROM coverage')).n) > 0,
      'prasyarat tes: baris jangkauan gagal dibuat');

    const posSebelum = (await store.one(db, 'SELECT COUNT(*) AS n FROM outlets')).n;
    assert.ok(posSebelum > 0, 'prasyarat tes: harus ada pos sebelum direset');
    assert.ok((await store.one(store.customers(),
      'SELECT COUNT(*) AS n FROM customers')).n > 0,
    'prasyarat tes: harus ada data konsumen sebelum direset');

    const direset = await repo.resetOutlets('10.0.0.11');
    assert.strictEqual(direset.outlets, Number(posSebelum),
      'jumlah pos yang direset tidak dilaporkan apa adanya');
    assert.ok(direset.units > 0, 'unit penjualan yang ikut hilang tidak dilaporkan');

    // Empat tabel harus kosong bersamaan. Menyisakan salah satunya bukan "reset yang
    // lebih hati-hati" — itu baris yatim yang tidak muncul di mana pun.
    for (const tabel of ['outlets', 'sales', 'unmatched', 'coverage', 'outlet_rings']) {
      assert.strictEqual(
        Number((await store.one(db, `SELECT COUNT(*) AS n FROM ${tabel}`)).n), 0,
        `tabel ${tabel} tidak ikut dikosongkan waktu master pos direset`);
    }
    assert.strictEqual(Number((await store.one(store.customers(),
      'SELECT COUNT(*) AS n FROM customers')).n), 0,
    'data konsumen tertinggal padahal penjualannya sudah tidak ada di mana pun');

    // Jejaknya tercatat, di tempat yang sama dengan penghapusan periode.
    const jejakReset = (await repo.imports(10)).find((h) => h.result === 'reset');
    assert.ok(jejakReset, 'reset master pos tidak tercatat di riwayat impor');
    assert.match(jejakReset.message, /arsip tidak ikut dihapus/i,
      'catatannya harus menyebut bahwa berkas Excel-nya masih ada — itu jalan pulihnya');

    // Reset di database yang sudah kosong DITOLAK, bukan diam-diam "berhasil" — pesan
    // sukses untuk sesuatu yang tidak terjadi membuat orang mengira datanya hilang.
    await assert.rejects(() => repo.resetOutlets(), /sudah kosong/i);

    // Jalan pulihnya bekerja: impor ulang membuat lagi pos yang disebut berkas itu,
    // lalu menggantungkan penjualannya di sana.
    //
    // Yang dikembalikan CUMA yang ada di berkas yang diimpor — bukan seluruh 4 pos,
    // karena dua di antaranya datang dari bulan lain dan dari pos yang dibuat manual.
    // Memulihkan sepenuhnya berarti mengimpor ulang tiap bulan yang pernah masuk, dan
    // itu memang yang tertulis di layar konfirmasinya: "bulan per bulan".
    const pulihReset = await runImport({
      file, period: '2026-08', fileName: 'agustus.csv', withCustomers: true, config });
    assert.strictEqual(pulihReset.rowsUsed, 3, 'impor ulang setelah reset tidak memulihkan');
    assert.strictEqual(Number((await store.one(db,
      "SELECT COALESCE(SUM(quantity),0) AS n FROM sales WHERE period='2026-08'")).n), 3,
    'penjualan tidak pulih sesudah reset');

    // Tiap penjualan yang pulih HARUS punya posnya. Kalau impor ulang cuma menulis
    // sales tanpa membuat lagi outlet-nya, foreign key-nya akan menolak — tapi kalau
    // suatu hari FK itu dilepas, barisnya jadi yatim dan tidak muncul di mana pun.
    assert.strictEqual(Number((await store.one(db, `
      SELECT COUNT(*) AS n FROM sales s
      WHERE NOT EXISTS (SELECT 1 FROM outlets o WHERE o.outlet_code = s.outlet_code)`)).n),
    0, 'ada penjualan yang pulih tanpa posnya ikut dibuat lagi');
    assert.ok(Number((await store.one(db, 'SELECT COUNT(*) AS n FROM outlets')).n) > 0,
      'impor ulang tidak membuat satu pos pun');

    // PII bisa dicabut: DROP DATABASE, sisanya tetap jalan penuh.
    await dropCustomerDatabase(config);
    assert.strictEqual(repo.hasCustomers(), false);
    assert.strictEqual(await repo.customersInVillage('34.04.06.2003'), null,
      'tanpa database konsumen harus null, bukan melempar error');
    assert.strictEqual(await repo.browseCustomers({}), null,
      'tanpa database konsumen browseCustomers harus null, bukan melempar error');
    assert.strictEqual((await repo.summary()).sales.length > 0, true,
      'menghapus database konsumen mematikan sisanya juga');

    // Menghapus periode tetap bekerja TANPA database konsumen. Jalur ini menyentuh dua
    // database, dan yang kedua boleh saja tidak ada — itu justru sifat yang dijanjikan
    // KNF-PRIVASI-2. Tanpa tes ini, `store.customers()` yang null akan melempar dan
    // fitur hapus mati diam-diam di pemasangan yang tidak memakai PII sama sekali.
    const tanpaPii = await repo.deletePeriod('2026-08');
    assert.strictEqual(tanpaPii.customers, 0);
    // store.db() dipanggil lagi, BUKAN memakai `db` di atas: dropCustomerDatabase()
    // menutup lalu membuka ulang pool utamanya, jadi pegangan lama sudah mati.
    assert.strictEqual((await store.one(store.db(),
      "SELECT COUNT(*) AS n FROM sales WHERE period='2026-08'")).n, 0);

    // --- multipart: nama berkas dari pengguna tidak boleh dipercaya ---
    const boundary = '----uji';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="period"\r\n\r\n2026-08\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="berkas"; ` +
        `filename="..\\..\\.env"\r\nContent-Type: text/csv\r\n\r\n`),
      Buffer.from('isi,berkas\r\n'),
      Buffer.from(`--${boundary}--\r\n`),
    ]);
    const parsed = parseMultipart(body, `multipart/form-data; boundary=${boundary}`);
    assert.strictEqual(parsed.fields.period, '2026-08');
    assert.strictEqual(parsed.file.filename, '..\\..\\.env');
    // CRLF terakhir milik pembatas boundary, bukan isi berkas — memang harus dibuang.
    // Kalau ikut tersimpan, tiap .xlsx hasil unggahan akan punya dua byte tambahan di
    // ujungnya, dan Excel menolak membukanya.
    assert.strictEqual(parsed.file.data.toString(), 'isi,berkas',
      'isi berkas rusak saat di-parse');
    // routes.js memakai path.basename lalu MENGARANG nama baru; yang diuji di sini
    // parsernya mengembalikan nama apa adanya supaya lapisan di atas yang menyaring.
    assert.strictEqual(path.basename(parsed.file.filename), '.env');

    console.log('OK import — idempoten, rollback utuh, riwayat tercatat, ' +
      'suntingan manusia aman, PII terpisah dan bisa dicabut');
  } finally {
    await closeTestDb(config);
  }
}

test().catch((error) => { console.error(error); process.exit(1); });
