/**
 * Rute API. Semuanya di bawah /api dan semuanya butuh sesi yang sah — penjaganya
 * dipasang di app.js sebelum modul ini dipakai.
 */
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const repo = require('./repository');
const { runImport, isRunning } = require('./importer');
const { runSourceImport, savePing } = require('./source-import');
const {
  recalculate, readSettings, statusRatio, statusRetention,
} = require('./fusion-store');
const { SEGMENTS } = require('../core/fusion');
const { previewOutletImport, commitOutletImport } = require('./pos-import');
const { RateLimiter } = require('./auth');

/** Batas ukuran unggahan. Berkas Astra ±2,5 MB; 25 MB memberi ruang lega. */
const MAX_UPLOAD = 25 * 1024 * 1024;

/**
 * Berapa lama arsip Excel yang diunggah disimpan.
 *
 * Berkas ini memuat PII mentah — nama, alamat, dan seluruh baris apa adanya dari
 * Astra. Yang dibutuhkan aplikasi sudah masuk database sejak impor selesai; arsipnya
 * cuma untuk menelusuri kalau ada angka yang dicurigai. Tiga bulan cukup untuk itu,
 * dan menyimpan selamanya berarti menumpuk PII tanpa ada yang pernah memutuskannya.
 */
const UPLOAD_KEEP_DAYS = 90;

/**
 * Apakah impor ini ikut menyimpan nama dan alamat konsumen.
 *
 * ABSENNYA FIELD BERARTI YA, dan arah itu yang penting. Halaman impor tidak lagi
 * mengirim field ini sama sekali — centangnya dibuang 2026-08-18 karena tim selalu
 * memerlukan datanya. Kalau aturannya ditulis `=== '1'`, halaman yang tidak mengirim
 * apa-apa berarti TIDAK PERNAH menyimpan: impor berjalan mulus, angkanya benar, dan
 * tab Data Konsumen diam-diam kosong selamanya.
 *
 * Cuma nilai '0' yang eksplisit yang mematikannya. Itu menjaga jalur CLI dan tes tetap
 * bisa mengimpor tanpa PII — jaminan yang mendasari KNF-PRIVASI-2.
 */
function simpanKonsumen(field) {
  return String(field) !== '0';
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const VILLAGE = /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/;
const DISTRICT = /^\d{2}\.\d{2}\.\d{2}$/;
const CITY = /^\d{2}\.\d{2}$/;
const PROVINCE = /^\d{2}$/;
const OUTLET = /^[A-Za-z0-9._-]{1,32}$/;
// Kode dealer selalu hasil toDealerCode(), tidak pernah diketik manusia — beda dari
// OUTLET yang memang wajib diketik cocok Excel Astra.
const DEALER = /^[A-Z0-9]{1,64}$/;

/**
 * Periksa koordinat. Dipakai bersama rute tambah dan rute sunting pos.
 *
 * Cakupan proyek: DIY + Jawa Tengah. Koordinat di luar itu hampir pasti salah ketik
 * atau lintang dan bujur tertukar, dan pin yang melompat ke Afrika lebih membingungkan
 * daripada penolakan.
 *
 * @return {string|null} pesan kesalahan, atau null kalau tidak apa-apa
 */
function cekKoordinat(lat, lng) {
  if ((lat !== undefined && !Number.isFinite(lat)) ||
      (lng !== undefined && !Number.isFinite(lng))) {
    return 'Koordinat harus angka.';
  }
  if ((lat !== undefined && (lat < -9 || lat > -5)) ||
      (lng !== undefined && (lng < 107 || lng > 113))) {
    return 'Koordinat di luar wilayah cakupan. Lintang dan bujur tertukar?';
  }
  return null;
}

/**
 * Periksa koordinat dealer. Beda dari cekKoordinat(): kantor pusat dealer boleh saja
 * di luar cakupan peta DIY+Jateng (mis. Jakarta) — cuma dicek sebagai angka lat/lng
 * yang sah, tanpa batas wilayah.
 */
function cekKoordinatBebas(lat, lng) {
  if ((lat !== undefined && !Number.isFinite(lat)) ||
      (lng !== undefined && !Number.isFinite(lng))) {
    return 'Koordinat harus angka.';
  }
  if ((lat !== undefined && (lat < -90 || lat > 90)) ||
      (lng !== undefined && (lng < -180 || lng > 180))) {
    return 'Koordinat di luar rentang yang mungkin.';
  }
  return null;
}

function build(config) {
  const api = express.Router();

  /**
   * Pembatas laju untuk rute yang mengembalikan PII.
   *
   * Halaman Data Konsumen mengirim 500 baris per permintaan, dan itu wajar untuk
   * orang yang menelusuri. Yang tidak wajar: 40 permintaan berturut-turut, yang
   * menyedot seluruh 18 ribu baris dalam hitungan detik. Dengan satu akun bersama,
   * tidak ada cara lain membedakan keduanya selain kecepatan.
   *
   * 30 per menit memberi ruang lebih dari cukup untuk menelusuri dengan tangan —
   * satu halaman per dua detik tanpa henti — sambil membuat penyedotan penuh butuh
   * lebih dari satu menit dan meninggalkan 40 baris di access_log.
   *
   * Kelasnya dipakai ulang dari auth.js, sama seperti pembatas percobaan login.
   */
  const piiLimiter = new RateLimiter(30, 60 * 1000);

  // Express 5 meneruskan penolakan promise dari handler async ke penangan error,
  // jadi tidak perlu try/catch di tiap rute.
  api.get('/summary', async (req, res) => {
    const data = await repo.summary();
    data.hasCustomers = repo.hasCustomers();
    res.json(data);
  });

  api.get('/periods', async (req, res) => {
    res.json({ periods: await repo.periodSummary() });
  });

  /**
   * Hapus seluruh data satu periode.
   *
   * Satu-satunya rute yang membuang data bisnis dalam jumlah besar, jadi pengamannya
   * ada DI SINI, bukan cuma di layar. Halaman meminta orang mengetik ulang periodenya;
   * kalau penjaganya cuma di sana, satu permintaan langsung ke API melewatinya begitu
   * saja.
   *
   * Konfirmasinya diminta sebagai `confirm` yang harus SAMA PERSIS dengan periodenya,
   * bukan `?yakin=1`. Flag bernilai benar bisa terkirim karena salah salin; mengetik
   * "2026-08" tidak bisa terjadi tanpa sengaja.
   *
   * Ditolak selagi ada impor berjalan. Impor menghapus lalu menulis ulang periodenya
   * sendiri di dalam satu transaksi, dan menghapus di tengah itu menghasilkan setengah
   * keadaan yang tidak pernah diuji siapa pun.
   */
  api.delete('/periods/:period', async (req, res) => {
    const period = String(req.params.period || '');
    if (!PERIOD.test(period)) {
      return res.status(400).json({ error: 'Periode harus format YYYY-MM.' });
    }
    if (String(req.query.confirm || '') !== period) {
      return res.status(400).json({
        error: `Konfirmasi tidak cocok. Ketik ${period} persis untuk menghapusnya.`,
      });
    }
    if (isRunning()) {
      return res.status(409).json({
        error: 'Sedang ada impor berjalan. Tunggu sampai selesai, baru hapus.',
      });
    }
    try {
      res.json(await repo.deletePeriod(period, req.ip));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * Kosongkan master pos dan dealer.
   *
   * Konfirmasinya harus diketik persis, sama seperti hapus periode: yang hilang di
   * sini jauh lebih banyak daripada satu bulan, jadi tidak boleh ada satu klik pun
   * yang bisa melakukannya tanpa sengaja.
   */
  api.delete('/outlets', async (req, res) => {
    if (String(req.query.confirm || '') !== 'RESET') {
      return res.status(400).json({
        error: 'Konfirmasi tidak cocok. Ketik RESET persis untuk mengosongkan master pos.',
      });
    }
    if (isRunning()) {
      return res.status(409).json({
        error: 'Sedang ada impor berjalan. Tunggu sampai selesai, baru reset.',
      });
    }
    try {
      res.json(await repo.resetOutlets(req.ip));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  /** Daftar kecamatan, untuk pemilih ring/coverage. Tanpa PII, tanpa penyaring. */
  api.get('/districts', async (req, res) => {
    res.json({ districts: await repo.districts() });
  });

  /**
   * Koordinat satu desa dari namanya — layanan referensi wilayah (docs/FUSION.md 2.1a).
   *
   * Awalan /v1 dipakai SEMUA rute penyatuan tiga sumber, dan rute lama di /api/* tidak
   * disentuh sama sekali. Itu yang membuat fitur baru ini tidak pernah bisa merusak
   * halaman yang sudah dipakai tim tiap hari.
   *
   * Tanpa PII: nama desa dan koordinat titik tengahnya bukan data pribadi siapa pun.
   * Jadi tidak lewat piiLimiter — beda dari rute /customers.
   *
   * Tiga jawaban, dan bedanya disengaja:
   *   200  ketemu; `match` menyebut BAGAIMANA ketemunya (ok/alias/fuzzy)
   *   409  namanya ada di lebih dari satu kabupaten; sebutkan `kota`
   *   404  tidak ketemu, lengkap dengan usulan ejaan terdekat
   *
   * Usulan ikut dikirim pada 404 karena itulah gunanya buat operator: yang mengetik
   * nama salah butuh kandidat, bukan sekadar penolakan.
   */
  api.get('/v1/wilayah/koordinat', async (req, res) => {
    const districtName = String(req.query.kecamatan || '').trim();
    const villageName = String(req.query.desa || '').trim();
    const cityCode = String(req.query.kota || '').trim();
    if (!districtName || !villageName) {
      return res.status(400).json({
        error: 'Parameter kecamatan dan desa wajib diisi.',
      });
    }

    const ringkas = (v) => ({
      villageCode: v.code,
      villageName: v.name,
      districtName: v.district,
      districtCode: v.districtCode,
      cityCode: v.cityCode,
      cityName: v.cityName,
      provinceCode: v.provinceCode,
      lat: v.lat,
      lng: v.lng,
      ...(v.distance === undefined ? {} : { editDistance: v.distance }),
    });

    const hasil = await repo.resolveVillageByName({ cityCode, districtName, villageName });

    if (hasil.status === 'ambiguous') {
      return res.status(409).json({
        error: 'Nama ini ada di lebih dari satu kabupaten. Sebutkan parameter kota.',
        match: 'ambiguous',
        candidates: hasil.suggestions.map(ringkas),
      });
    }
    if (!hasil.village) {
      return res.status(404).json({
        error: 'Desa tidak ditemukan.',
        match: hasil.status,
        suggestions: hasil.suggestions.map(ringkas),
      });
    }
    res.json({ ...ringkas(hasil.village), match: hasil.status, source: 'villages' });
  });

  /**
   * Ganti seluruh ring satu dealer.
   *
   * Badannya gambaran LENGKAP, bukan tambalan: {rings: {"33.13.09": 1, ...}}.
   * Mengirim sebagian berarti sisanya terhapus, dan itu memang yang diinginkan —
   * halaman selalu mengirim keadaan akhir yang dilihat orang di layar.
   */
  api.put('/dealers/:code/rings', async (req, res) => {
    const code = String(req.params.code || '');
    if (!DEALER.test(code)) {
      return res.status(400).json({ error: 'Kode dealer tidak sah.' });
    }
    const rings = (req.body || {}).rings;
    if (!rings || typeof rings !== 'object' || Array.isArray(rings)) {
      return res.status(400).json({
        error: 'Kirim {rings: {"kode kecamatan": 1|2|3}}.',
      });
    }
    // Bentuk kodenya diperiksa di sini; keberadaannya diperiksa repositori terhadap
    // daftar kecamatan. Dua-duanya menolak, tidak ada yang dilewati diam-diam.
    const salah = Object.keys(rings).filter((c) => !DISTRICT.test(c));
    if (salah.length) {
      return res.status(400).json({
        error: `Kode kecamatan harus bertitik seperti 33.13.09. Yang salah: ` +
          salah.slice(0, 5).join(', '),
      });
    }
    try {
      res.json(await repo.saveDealerRings(code, rings));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * Ganti seluruh coverage satu pos. Pola sama persis dengan ring dealer di atas,
   * bedanya rentang nilai (1..8) dan entitasnya.
   */
  api.put('/outlets/:code/coverage', async (req, res) => {
    const code = String(req.params.code || '');
    if (!OUTLET.test(code)) {
      return res.status(400).json({ error: 'Kode pos tidak sah.' });
    }
    const coverage = (req.body || {}).coverage;
    if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) {
      return res.status(400).json({
        error: 'Kirim {coverage: {"kode kecamatan": 1..8}}.',
      });
    }
    const salah = Object.keys(coverage).filter((c) => !DISTRICT.test(c));
    if (salah.length) {
      return res.status(400).json({
        error: `Kode kecamatan harus bertitik seperti 33.13.09. Yang salah: ` +
          salah.slice(0, 5).join(', '),
      });
    }
    try {
      res.json(await repo.savePosCoverage(code, coverage));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  api.get('/imports', async (req, res) => {
    res.json({ imports: await repo.imports(20), running: isRunning() });
  });

  api.get('/unmatched', async (req, res) => {
    const period = String(req.query.period || '');
    if (!PERIOD.test(period)) {
      return res.status(400).json({ error: 'Periode harus format YYYY-MM.' });
    }
    res.json({ unmatched: await repo.unmatched(period) });
  });

  /**
   * Telusuri konsumen untuk halaman Data Konsumen.
   *
   * Rute TERPISAH dari /customers, bukan penambahan parameter di sana. /customers
   * tetap mewajibkan satu kode kelurahan dan tetap diuji begitu — jaminan itu tidak
   * dilonggarkan, cuma didampingi jalur kedua yang batasnya berbeda dan tertulis.
   *
   * Di sini penyaringnya bebas, tapi hasilnya selalu dipotong repo.BROWSE_LIMIT dan
   * jumlah sebenarnya dikirim terpisah — halaman menampilkan "500 dari 18.512", tidak
   * diam-diam memotong. Tiap akses dicatat, sama seperti jalur satunya.
   *
   * Penyaring yang bentuknya salah DIABAIKAN, bukan bikin 400: halaman ini dipakai
   * sambil mengetik, dan menolak seluruh permintaan karena satu dropdown belum diisi
   * akan terasa seperti aplikasinya rusak.
   */
  api.get('/customers/browse', async (req, res) => {
    if (!piiLimiter.allow(req.ip || 'tidak diketahui')) {
      return res.status(429).json({
        error: 'Terlalu banyak permintaan data konsumen. Tunggu sebentar lalu coba lagi.',
      });
    }
    const q = req.query;
    // Periode jadi RENTANG. `period` yang lama tetap diterima dan diperlakukan sebagai
    // rentang satu bulan — kalau tidak, tautan lama akan lolos validasi lunak di bawah
    // sebagai "tanpa penyaring periode" dan mengembalikan seluruh basis data konsumen.
    // Pelebaran senyap adalah kesalahan yang paling mahal di rute PII.
    const period = String(q.period || '');
    const periodFrom = String(q.periodFrom || period);
    const periodTo = String(q.periodTo || period);
    const province = String(q.province || '');
    const village = String(q.village || '');
    const city = String(q.city || '');
    const outlet = String(q.outlet || '');
    const search = String(q.q || '').trim().slice(0, 80);

    const result = await repo.browseCustomers({
      periodFrom: PERIOD.test(periodFrom) ? periodFrom : null,
      periodTo: PERIOD.test(periodTo) ? periodTo : null,
      // Rentang terbalik sengaja TIDAK ditolak di sini: nol baris adalah jawaban yang
      // benar untuk halaman yang dipakai sambil mengetik. Yang menolaknya rute
      // /customers, yang aturannya memang keras.
      province: PROVINCE.test(province) ? province : null,
      village: VILLAGE.test(village) ? village : null,
      city: CITY.test(city) ? city : null,
      outlet: OUTLET.test(outlet) ? outlet : null,
      // Daftar pos dikirim halaman waktu yang dipilih adalah DEALER: satu dealer punya
      // beberapa pos, dan tabel customers tidak menyimpan kode dealer — itu milik
      // tabel outlets di database yang lain, jadi tidak bisa di-JOIN dari sini.
      outlets: Array.isArray(q.outlets)
        ? q.outlets.filter((c) => OUTLET.test(String(c))).slice(0, 200)
        : (typeof q.outlets === 'string'
          ? q.outlets.split(',').filter((c) => OUTLET.test(c)).slice(0, 200)
          : null),
      query: search || null,
      offset: Number(q.offset) || 0,
    });

    if (result === null) {
      return res.status(404).json({ error: 'Data konsumen tidak tersedia di server ini.' });
    }
    await repo.logCustomerAccess(req.ip, village || city || 'telusur', result.rows.length);
    res.json(result);
  });

  /**
   * Konsumen di SATU kelurahan.
   *
   * Parameter `village` WAJIB. Tanpa itu 400, bukan dikembalikan semuanya — ini
   * satu-satunya hal yang mencegah satu akun bersama menyedot seluruh basis data
   * konsumen dalam satu permintaan. Tiap akses dicatat.
   */
  api.get('/customers', async (req, res) => {
    if (!piiLimiter.allow(req.ip || 'tidak diketahui')) {
      return res.status(429).json({
        error: 'Terlalu banyak permintaan data konsumen. Tunggu sebentar lalu coba lagi.',
      });
    }
    const village = String(req.query.village || '');
    if (!VILLAGE.test(village)) {
      return res.status(400).json({
        error: 'Sebutkan satu kode kelurahan, misalnya village=34.04.01.2001.',
      });
    }
    // Berbeda dari /customers/browse yang mengabaikan penyaring cacat: di sini bentuk
    // yang salah DITOLAK. Mengabaikannya berarti permintaannya melebar diam-diam jadi
    // seluruh riwayat kelurahan itu, dan rute ini yang mengeluarkan nama dan alamat.
    const period = String(req.query.period || '');
    const periodFrom = String(req.query.periodFrom || period);
    const periodTo = String(req.query.periodTo || period);
    if ((periodFrom && !PERIOD.test(periodFrom)) || (periodTo && !PERIOD.test(periodTo))) {
      return res.status(400).json({ error: 'Periode harus format YYYY-MM.' });
    }
    if (periodFrom && periodTo && periodFrom > periodTo) {
      return res.status(400).json({
        error: 'Rentang periode terbalik: bulan "dari" lebih akhir daripada bulan "sampai".',
      });
    }
    const rows = await repo.customersInVillage(village,
      { from: periodFrom || null, to: periodTo || null });
    if (rows === null) {
      return res.status(404).json({ error: 'Data konsumen tidak tersedia di server ini.' });
    }
    await repo.logCustomerAccess(req.ip, village, rows.length);
    res.json({ village, customers: rows });
  });

  /**
   * Tambah pos dealer baru.
   *
   * Kodenya datang dari pengguna dan tidak pernah dibuatkan server: kode itu harus
   * sama dengan yang dipakai Astra di Excel, dan cuma manusia yang tahu. Kode yang
   * salah membuat impor berikutnya membuat outlet KEDUA untuk pos yang sama.
   */
  api.post('/outlets', async (req, res) => {
    const body = req.body || {};
    const lat = body.lat === null || body.lat === undefined || body.lat === ''
      ? undefined : Number(body.lat);
    const lng = body.lng === null || body.lng === undefined || body.lng === ''
      ? undefined : Number(body.lng);
    const salah = cekKoordinat(lat, lng);
    if (salah) return res.status(400).json({ error: salah });
    if ((lat === undefined) !== (lng === undefined)) {
      return res.status(400).json({ error: 'Isi lintang dan bujur dua-duanya, atau kosongkan dua-duanya.' });
    }
    if (!OUTLET.test(String(body.outletCode || ''))) {
      return res.status(400).json({
        error: 'Kode pos cuma boleh huruf, angka, titik, strip, dan garis bawah.',
      });
    }
    try {
      const hasil = await repo.createOutlet({
        outletCode: body.outletCode,
        outletName: body.outletName,
        dealerName: body.dealerName,
        address: body.address,
        lat: lat === undefined ? null : lat,
        lng: lng === undefined ? null : lng,
      }, config);
      res.status(201).json(hasil);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  /* ------------------------------------------------------------------------
     ALIAS NAMA KELURAHAN
     ------------------------------------------------------------------------
     Menggantikan POST /villages yang dulu membuat kelurahan BARU tanpa poligon.
     Sekarang seluruh Jateng + DIY sudah ada di database berpoligon, jadi nama Excel
     yang tidak cocok hampir selalu varian ejaan — yang dibutuhkan menunjuk kelurahan
     yang sudah ada, bukan membuat baris baru yang tidak akan pernah punya jangkauan.
     ------------------------------------------------------------------------ */

  /** Nama yang menunggu dicocokkan + sarannya, dan alias yang sudah tersimpan. */
  api.get('/village-aliases', async (req, res) => {
    // Periode boleh tidak dikirim: halaman Master Kelurahan tidak punya penyaring
    // periode, dan yang relevan selalu impor terakhir.
    const diminta = String(req.query.period || '');
    if (diminta && !PERIOD.test(diminta)) {
      return res.status(400).json({ error: 'Periode harus format YYYY-MM.' });
    }
    const period = diminta || await repo.latestUnmatchedPeriod();
    res.json({
      period,
      unmatched: period ? await repo.unmatchedWithSuggestions(period) : [],
      aliases: await repo.aliases(),
    });
  });

  /**
   * Konfirmasi satu alias. Ini SATU-SATUNYA jalan alias masuk database.
   *
   * Saran dari backend/core/matching.js tidak pernah tersimpan sendiri — yang menulis di
   * sini selalu klik orang. Kode kelurahannya datang dari daftar yang dikirim server,
   * jadi tetap kode BPS dan tidak pernah diturunkan dari nama.
   */
  api.post('/village-aliases', async (req, res) => {
    const body = req.body || {};
    try {
      const village = await repo.saveAlias({
        cityCode: body.cityCode,
        districtName: body.districtName,
        villageName: body.villageName,
        villageCode: body.villageCode,
      });
      res.status(201).json({ village });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  /** Batalkan alias yang salah pilih. Berlaku pada impor berikutnya, sama seperti simpan. */
  api.delete('/village-aliases', async (req, res) => {
    const { cityCode, districtName, villageName } = req.query;
    if (!cityCode || !districtName || !villageName) {
      return res.status(400).json({
        error: 'Butuh cityCode, districtName, dan villageName.',
      });
    }
    await repo.deleteAlias(cityCode, districtName, villageName);
    res.json({ ok: true });
  });

  api.put('/outlets/:code', async (req, res) => {
    const patch = req.body || {};
    const lat = patch.lat === null || patch.lat === undefined ? undefined : Number(patch.lat);
    const lng = patch.lng === null || patch.lng === undefined ? undefined : Number(patch.lng);
    const salah = cekKoordinat(lat, lng);
    if (salah) return res.status(400).json({ error: salah });

    // Nama dealer diterima; KODENYA tidak. Kode dealer itu identitas, dan browser
    // tidak boleh menentukannya — repo.resolveDealer() yang memutuskan, sekaligus
    // memakai ulang kode dealer yang sudah ada kalau namanya sama.
    if (patch.dealerName !== undefined) {
      if (typeof patch.dealerName !== 'string' || !patch.dealerName.trim()) {
        return res.status(400).json({ error: 'Nama dealer tidak boleh kosong.' });
      }
      if (patch.dealerName.length > 200) {
        return res.status(400).json({ error: 'Nama dealer terlalu panjang.' });
      }
    }

    let hasil;
    try {
      hasil = await repo.updateOutlet(String(req.params.code), {
        dealerName: patch.dealerName,
        address: typeof patch.address === 'string' ? patch.address.trim() : undefined,
        lat,
        lng,
      }, config);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    if (!hasil) return res.status(404).json({ error: 'Outlet tidak ditemukan.' });
    res.json(hasil);
  });

  /* ------------------------------------------------------------------------
     MASTER DEALER
     ------------------------------------------------------------------------
     Terpisah dari outlets sejak dealers jadi tabel sendiri (lihat schema.sql). Kode
     dealer tidak pernah diketik manusia — selalu turunan toDealerCode(nama), jadi
     rute-rute ini tidak menerima dealerCode di body, cuma di URL untuk PUT/DELETE.
     ------------------------------------------------------------------------ */

  api.post('/dealers', async (req, res) => {
    const body = req.body || {};
    const lat = body.lat === null || body.lat === undefined || body.lat === ''
      ? undefined : Number(body.lat);
    const lng = body.lng === null || body.lng === undefined || body.lng === ''
      ? undefined : Number(body.lng);
    const salah = cekKoordinatBebas(lat, lng);
    if (salah) return res.status(400).json({ error: salah });
    if ((lat === undefined) !== (lng === undefined)) {
      return res.status(400).json({ error: 'Isi lintang dan bujur dua-duanya, atau kosongkan dua-duanya.' });
    }
    try {
      const dealer = await repo.createDealer({
        dealerName: body.dealerName,
        address: body.address,
        lat: lat === undefined ? null : lat,
        lng: lng === undefined ? null : lng,
      });
      res.status(201).json({ dealer });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  api.put('/dealers/:code', async (req, res) => {
    if (!DEALER.test(req.params.code)) return res.status(404).json({ error: 'Dealer tidak ditemukan.' });
    const patch = req.body || {};
    const lat = patch.lat === null || patch.lat === undefined ? undefined : Number(patch.lat);
    const lng = patch.lng === null || patch.lng === undefined ? undefined : Number(patch.lng);
    const salah = cekKoordinatBebas(lat, lng);
    if (salah) return res.status(400).json({ error: salah });

    let dealer;
    try {
      dealer = await repo.updateDealer(req.params.code, {
        dealerName: patch.dealerName,
        address: typeof patch.address === 'string' ? patch.address.trim() : undefined,
        lat,
        lng,
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    if (!dealer) return res.status(404).json({ error: 'Dealer tidak ditemukan.' });
    res.json({ dealer });
  });

  api.delete('/dealers/:code', async (req, res) => {
    if (!DEALER.test(req.params.code)) return res.status(404).json({ error: 'Dealer tidak ditemukan.' });
    let hasil;
    try {
      hasil = await repo.deleteDealer(req.params.code);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    if (!hasil) return res.status(404).json({ error: 'Dealer tidak ditemukan.' });
    res.json({ ok: true });
  });

  /**
   * Unggah berkas bulanan.
   *
   * Multipart di-parse sendiri, bukan dengan multer: yang dibutuhkan cuma satu berkas
   * dan dua field teks, dan menambah dependensi untuk itu tidak sepadan. Yang penting
   * dijaga: batas ukuran, dan nama berkas dari pengguna TIDAK PERNAH dipakai sebagai
   * nama berkas di disk.
   */
  api.post('/import', express.raw({ type: 'multipart/form-data', limit: MAX_UPLOAD }),
    async (req, res) => {
      if (isRunning()) {
        return res.status(409).json({
          error: 'Sedang ada impor yang berjalan. Tunggu sampai selesai, lalu coba lagi.',
        });
      }

      let parsed;
      try {
        parsed = parseMultipart(req.body, req.headers['content-type']);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      const period = String(parsed.fields.period || '');
      if (!PERIOD.test(period)) {
        return res.status(400).json({ error: 'Pilih bulan dan tahun dulu.' });
      }
      if (!parsed.file) {
        return res.status(400).json({ error: 'Tidak ada berkas yang terkirim.' });
      }

      const original = String(parsed.file.filename || 'unggahan');
      const ext = path.extname(original).toLowerCase();
      if (!['.xlsx', '.xlsm', '.csv', '.txt'].includes(ext)) {
        return res.status(400).json({
          error: `Format ${ext || 'itu'} tidak bisa dibaca. Kirim .xlsx atau .csv.`,
        });
      }

      // Nama di disk dibuat server, bukan diambil dari pengguna. Nama seperti
      // "..\..\.env" tidak akan pernah punya kesempatan.
      const dir = path.join(config.dataDir, 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      pruneUploads(dir);
      const safe = path.join(dir,
        `${period}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
      fs.writeFileSync(safe, parsed.file.data);

      try {
        const result = await runImport({
          file: safe,
          period,
          fileName: path.basename(original),
          ip: req.ip,
          withCustomers: simpanKonsumen(parsed.fields.withCustomers),
          config,
        });
        res.json(result);
      } catch (error) {
        const status = error.code === 'SEDANG_BERJALAN' ? 409 : 400;
        res.status(status).json({ error: error.message });
      }
    });

  /* ------------------------------------------------------------------------
     IMPOR DATA KTP & DATA SERVIS (docs/FUSION.md Tahap C)
     ------------------------------------------------------------------------
     Bentuknya sama persis dengan /import di atas — multipart, berkas disimpan
     dengan nama buatan server, kunci impor yang sama — cuma tujuannya database
     PII dan tabelnya berbeda per sumber. Satu handler untuk dua sumber: yang
     membedakan cuma satu parameter di path.
     ------------------------------------------------------------------------ */

  const importSumber = (source) =>
    async (req, res) => {
      if (isRunning()) {
        return res.status(409).json({
          error: 'Sedang ada impor yang berjalan. Tunggu sampai selesai, lalu coba lagi.',
        });
      }

      let parsed;
      try {
        parsed = parseMultipart(req.body, req.headers['content-type']);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      const period = String(parsed.fields.period || '');
      if (!PERIOD.test(period)) {
        return res.status(400).json({ error: 'Pilih bulan dan tahun dulu.' });
      }
      if (!parsed.file) {
        return res.status(400).json({ error: 'Tidak ada berkas yang terkirim.' });
      }

      const original = String(parsed.file.filename || 'unggahan');
      const ext = path.extname(original).toLowerCase();
      if (!['.xlsx', '.xlsm', '.csv', '.txt'].includes(ext)) {
        return res.status(400).json({
          error: `Format ${ext || 'itu'} tidak bisa dibaca. Kirim .xlsx atau .csv.`,
        });
      }

      const dir = path.join(config.dataDir, 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      pruneUploads(dir);
      const safe = path.join(dir,
        `${source}-${period}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
      fs.writeFileSync(safe, parsed.file.data);

      try {
        res.json(await runSourceImport({
          source, file: safe, period, fileName: path.basename(original),
          ip: req.ip, config,
        }));
      } catch (error) {
        const status = error.code === 'SEDANG_BERJALAN' ? 409 : 400;
        res.status(status).json({ error: error.message });
      }
    };

  api.post('/v1/import/ktp',
    express.raw({ type: 'multipart/form-data', limit: MAX_UPLOAD }),
    importSumber('ktp'));

  api.post('/v1/import/servis',
    express.raw({ type: 'multipart/form-data', limit: MAX_UPLOAD }),
    importSumber('servis'));

  /**
   * Ping pengiriman realtime (docs/FUSION.md 1.3).
   *
   * Untuk sekarang tetap di belakang sesi yang sama dengan rute lain. Brief-nya
   * menyebut integrasi sistem lapangan menyusul ("buatkan dulu templatenya"), dan
   * membuka satu jalur publik ber-token sebelum ada yang memakainya berarti menambah
   * permukaan serangan yang menganggur — dilakukan nanti, bersama integrasinya.
   *
   * Disimpan dulu, divalidasi belakangan: satu-satunya yang benar-benar wajib adalah
   * koordinat yang berupa angka, karena kolomnya memang angka. Nomor mesin yang belum
   * dikenal TIDAK ditolak.
   */
  api.post('/v1/pengiriman/ping', express.json({ limit: '64kb' }), async (req, res) => {
    const body = req.body || {};
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat dan lng harus angka.' });
    }
    const sentAt = body.sentAt ? new Date(body.sentAt) : new Date();
    if (Number.isNaN(sentAt.getTime())) {
      return res.status(400).json({ error: 'sentAt bukan waktu yang sah.' });
    }

    try {
      const id = await savePing({
        engineNo: String(body.engineNo || '').trim().slice(0, 32),
        sentAt: sentAt.toISOString(),
        lat,
        lng,
        accuracyM: Number.isFinite(Number(body.accuracyM)) ? Number(body.accuracyM) : null,
        locationText: String(body.locationText || '').slice(0, 200),
        photoUrl: String(body.photoUrl || '').slice(0, 500),
        courierName: String(body.courierName || '').slice(0, 120),
        note: String(body.note || ''),
      }, config);
      res.status(201).json({ stored: true, id });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  /* ------------------------------------------------------------------------
     HASIL PENGGOLONGAN & METRIK (docs/FUSION.md Tahap E)
     ------------------------------------------------------------------------
     Semuanya membaca `segment_rollup` — agregat TANPA identitas — kecuali
     drill-down satu nomor mesin di paling bawah, yang memang PII dan karena
     itu lewat piiLimiter dan dicatat di access_log.
     ------------------------------------------------------------------------ */

  /** Periode yang diminta, atau periode terbaru yang punya hasil. */
  const periodeFusi = async (q) => {
    const diminta = String(q.periode || q.period || '');
    return PERIOD.test(diminta) ? diminta : await repo.latestFusionPeriod();
  };

  /**
   * Kode dealer dari bilah filter, diterjemahkan ke kosakata `segment_rollup`.
   *
   * Bilah mengirim `dealers.dealer_code` ('NUSANTARASAKTIGEJAYAN'); rollup menyimpan
   * kode numerik Excel ('7348'). Keduanya lolos regex DEALER, jadi tanpa terjemahan
   * ini permintaannya SAH tapi hasilnya kosong — dan dashboard kosong terbaca sebagai
   * "dealer ini tidak punya konsumen". Diukur pada data Agustus 2026: 0 dari 78 kode
   * dealer cocok apa adanya. Lihat repo.legacyDealerCode().
   */
  const dealerFusi = async (nilai) => {
    const kode = String(nilai || '');
    if (!DEALER.test(kode)) return null;
    return repo.legacyDealerCode(kode);
  };

  /**
   * Ketiga saringan lingkup, dibaca di SATU tempat.
   *
   * Sebelumnya tiap rute menyusunnya sendiri-sendiri, dan itu yang membuat filter Pos
   * terlewat di semua rute sekaligus tanpa ada yang menyadarinya: tidak ada satu
   * tempat pun yang bisa dilihat untuk menjawab "saringan apa saja yang dipahami
   * halaman ini". Sekarang ada.
   */
  const saringFusi = async (q) => {
    // `kota` menerima SATU kode atau daftar dipisah koma (karesidenan). Tiap kode
    // divalidasi sendiri-sendiri dengan regex yang sama — daftarnya tidak pernah
    // dipercaya bulat-bulat. Pola ini mengikuti `outlets` di /api/customers/browse.
    const kota = String(q.kota || '');
    const daftar = kota.includes(',')
      ? kota.split(',').map((x) => x.trim()).filter((x) => CITY.test(x)).slice(0, 50)
      : [];

    return {
      cityCode: CITY.test(kota) ? kota : null,
      cityCodes: daftar.length ? daftar : null,
      dealerCode: await dealerFusi(q.dealer),
      outletCode: OUTLET.test(String(q.pos || '')) ? String(q.pos) : null,
    };
  };

  api.get('/v1/segmentasi', async (req, res) => {
    const period = await periodeFusi(req.query);
    if (!period) {
      return res.json({
        period: null, data: [],
        meta: { total: 0, counts: {}, cwSales: 0, confidenceRatio: null },
        note: 'Belum ada hasil penggolongan. Impor Data KTP dulu.',
      });
    }
    const filter = {
      period,
      ...(await saringFusi(req.query)),
      segment: SEGMENTS[String(req.query.segmentasi || '')] ? String(req.query.segmentasi) : null,
      limit: req.query.limit,
      offset: req.query.offset,
    };
    const [totals, halaman, setelan] = await Promise.all([
      repo.fusionTotals(filter), repo.fusionRows(filter), readSettings(),
    ]);
    res.json({
      period,
      data: halaman.rows,
      meta: {
        total: totals.total,
        counts: totals.counts,
        cwSales: totals.cwSales,
        confidenceRatio: totals.confidenceRatio,
        status: statusRatio(totals.confidenceRatio,
          setelan.confidenceSolidMin, setelan.confidenceRapuhMax),
        kpiJarakKm: setelan.kpiRadiusM / 1000,
        limit: halaman.limit,
        offset: halaman.offset,
        hasMore: halaman.hasMore,
      },
    });
  });

  api.get('/v1/metrik/kota/:kota', async (req, res) => {
    const kota = String(req.params.kota || '');
    if (!CITY.test(kota)) {
      return res.status(400).json({ error: 'Kode kota harus format BPS bertitik, mis. 34.04.' });
    }
    const period = await periodeFusi(req.query);
    if (!period) return res.status(404).json({ error: 'Belum ada hasil penggolongan.' });

    const [totals, setelan] = await Promise.all([
      repo.fusionTotals({ period, cityCode: kota }), readSettings(),
    ]);
    res.json({
      period,
      cityCode: kota,
      total: totals.total,
      cwSales: totals.cwSales,
      confidenceRatio: totals.confidenceRatio,
      status: statusRatio(totals.confidenceRatio,
        setelan.confidenceSolidMin, setelan.confidenceRapuhMax),
      counts: totals.counts,
    });
  });

  api.get('/v1/metrik/dealer/:dealer', async (req, res) => {
    const dealer = String(req.params.dealer || '');
    if (!DEALER.test(dealer)) return res.status(400).json({ error: 'Kode dealer tidak sah.' });

    const period = await periodeFusi(req.query);
    if (!period) return res.status(404).json({ error: 'Belum ada hasil penggolongan.' });

    const [totals, perDealer, setelan] = await Promise.all([
      repo.fusionTotals({ period, dealerCode: dealer }),
      repo.fusionByDealer(period, null), readSettings(),
    ]);
    const baris = perDealer.find((d) => d.dealerCode === dealer);
    const kembali = baris ? Number(baris.returning) : 0;
    const retention = totals.total ? kembali / totals.total : null;

    res.json({
      period,
      dealerCode: dealer,
      dealerName: baris ? baris.dealerName : null,
      total: totals.total,
      cwSales: totals.cwSales,
      confidenceRatio: totals.confidenceRatio,
      confidenceStatus: statusRatio(totals.confidenceRatio,
        setelan.confidenceSolidMin, setelan.confidenceRapuhMax),
      retentionIndex: retention,
      retentionStatus: statusRetention(retention,
        setelan.retentionSehatMin, setelan.retentionRisikoMax),
      counts: totals.counts,
    });
  });

  /** Peringkat kota dan dealer sekaligus — bahan dua panel di Tahap 3. */
  api.get('/v1/peringkat', async (req, res) => {
    const period = await periodeFusi(req.query);
    if (!period) return res.json({ period: null, cities: [], dealers: [] });
    const saring = await saringFusi(req.query);
    const [cities, dealers] = await Promise.all([
      repo.fusionByCity(period, saring), repo.fusionByDealer(period, saring),
    ]);
    res.json({ period, cities, dealers });
  });

  /**
   * Matriks Kota x Golongan (docs/FUSION.md 3.2).
   *
   * Pivot dilakukan di sini, bukan di SQL, dan urutan kolomnya diambil dari daftar
   * golongan yang SAMA dengan yang dipakai mesin penggolongan — jadi menambah
   * golongan ketujuh kelak tidak diam-diam menghilangkan kolom di layar.
   *
   * `max` ikut dikirim: heatmap butuh nilai terbesar seluruh tabel untuk menghitung
   * kepekatan tiap selnya, dan menghitungnya di sini sekali lebih murah daripada
   * halaman menyapu ulang seluruh baris.
   */
  api.get('/v1/matriks', async (req, res) => {
    const period = await periodeFusi(req.query);
    const kolom = Object.keys(SEGMENTS);
    if (!period) return res.json({ period: null, segments: kolom, rows: [], max: 0 });

    const [baris, setelan] = await Promise.all([
      repo.fusionMatrix(period, await saringFusi(req.query)),
      readSettings(),
    ]);

    const per = new Map();
    baris.forEach((b) => {
      const kunci = b.cityCode || '';
      const row = per.get(kunci) || {
        cityCode: b.cityCode, cityName: b.cityName, counts: {}, total: 0, cwSales: 0,
      };
      row.counts[b.segment] = Number(b.n);
      row.total += Number(b.n);
      row.cwSales += Number(b.bobot);
      per.set(kunci, row);
    });

    let max = 0;
    const rows = [...per.values()].map((r) => {
      kolom.forEach((k) => { max = Math.max(max, r.counts[k] || 0); });
      const rasio = r.total ? r.cwSales / r.total : null;
      return Object.assign(r, {
        cwSales: Number(r.cwSales.toFixed(2)),
        confidenceRatio: rasio,
        status: statusRatio(rasio, setelan.confidenceSolidMin, setelan.confidenceRapuhMax),
      });
    }).sort((a, b) => b.total - a.total);

    res.json({ period, segments: kolom, rows, max });
  });

  /**
   * Irisan sumber data — bahan diagram Venn (docs/FUSION.md 3.2).
   *
   * Region Venn dipetakan DI SINI, bukan di SQL maupun di halaman, karena
   * pemetaannya bergantung pada daftar golongan yang sama dengan mesin
   * penggolongan — dan daftar itu tinggal di satu tempat.
   *
   * Pemetaannya mengikuti aritmetika gambar acuan: tiap region Venn berpadanan satu
   * lawan satu dengan golongan, KECUALI Migran yang dipecah menurut sumber yang
   * dimilikinya (di gambar: 199 "kirim saja" + 228 "servis saja" = 427 Migran).
   *
   * Satu region yang TIDAK ada di gambar acuan tetap disediakan: Migran yang punya
   * KEDUA sumber tapi dua-duanya jauh. Di Venn tiga lingkaran, lensa A∩B di luar C
   * memang ada tempatnya. Menggabungkannya diam-diam ke "servis saja" akan membuat
   * angka yang dijumlah pembaca tidak pernah cocok dengan daftar golongan.
   */
  api.get('/v1/irisan', async (req, res) => {
    const period = await periodeFusi(req.query);
    const kosong = {
      a_b_c: 0, b_c: 0, a_c: 0, c_saja: 0, a_saja: 0, b_saja: 0, a_b: 0, luar: 0,
    };
    if (!period) {
      return res.json({ period: null, regions: kosong, total: 0,
        sumber: { ktp: 0, servis: 0, kirim: 0 } });
    }

    const baris = await repo.fusionOverlap(period, await saringFusi(req.query));

    const wilayah = (punyaServis, punyaKirim, segment) => {
      if (segment === 'unverified') return 'luar';
      if (segment === 'loyal_verified') return 'a_b_c';
      if (segment === 'service_near') return 'b_c';
      if (segment === 'delivery_near') return 'a_c';
      if (segment === 'registered_only') return 'c_saja';
      // Sisanya Migran: terukur tapi jauh — posisinya ditentukan sumber yang ada.
      if (punyaServis && punyaKirim) return 'a_b';
      if (punyaServis) return 'b_saja';
      if (punyaKirim) return 'a_saja';
      return 'c_saja';
    };

    const regions = Object.assign({}, kosong);
    const sumber = { ktp: 0, servis: 0, kirim: 0 };
    let total = 0;

    baris.forEach((b) => {
      const n = Number(b.n) || 0;
      regions[wilayah(b.hasService, b.hasDelivery, b.segment)] += n;
      total += n;
      sumber.ktp += n;                       // tiap baris di sini menurut definisi punya KTP
      if (b.hasService) sumber.servis += n;
      if (b.hasDelivery) sumber.kirim += n;
    });

    res.json({ period, regions, total, sumber });
  });

  /**
   * Panel Cakupan Sumber: siapa punya sumber apa, dipecah per kota atau per dealer.
   *
   * SPESIFIKASINYA DIUBAH SEDIKIT, dan ini disengaja. docs/FUSION.md menulis daftarnya
   * berpindah "per-dealer bila filter Dealer aktif". Tapi kalau satu dealer sudah
   * dipilih, daftar per-dealer cuma berisi SATU baris — panel yang tidak memberi tahu
   * apa pun. Yang dipakai di sini: begitu KOTA dipilih, daftarnya turun jadi
   * dealer-dealer di kota itu. Itu arah drill-down yang sebenarnya dicari orang, dan
   * memilih dealer tetap menyisakan daftar kota yang berguna (dari mana pembelinya).
   */
  api.get('/v1/cakupan-sumber', async (req, res) => {
    const period = await periodeFusi(req.query);
    const saring = await saringFusi(req.query);
    const groupBy = saring.cityCode ? 'dealer' : 'kota';

    if (!period) {
      return res.json({ period: null, groupBy, rows: [], total: 0,
        sumber: { ktp: 0, servis: 0, kirim: 0 } });
    }

    const rows = await repo.fusionSourceCoverage(period, saring, groupBy);

    // Tiap baris source_overlap menurut definisi punya KTP — itu syarat masuk
    // penggolongan sama sekali (lihat fuseEngine: tanpa baris KTP hasilnya null).
    const sumber = { ktp: 0, servis: 0, kirim: 0 };
    let total = 0;
    rows.forEach((r) => {
      const n = Number(r.total) || 0;
      total += n;
      sumber.ktp += n;
      sumber.servis += Number(r.servis) || 0;
      sumber.kirim += Number(r.kirim) || 0;
    });

    res.json({ period, groupBy, rows, total, sumber });
  });

  /**
   * Tiga lapisan titik di peta, dalam bentuk HITUNGAN PER KELURAHAN.
   *
   * Sengaja bukan daftar titik. Titik KTP dan Servis yang tersimpan adalah centroid
   * kelurahan, jadi mengirimkannya satu per satu berarti mengirim ribuan koordinat
   * yang identik. Titik pengiriman sebaliknya GPS rumah sungguhan — itu PII, dan
   * tidak boleh keluar lewat rute yang tidak berpagar. Yang digambar peta adalah
   * sebaran berbenih tetap di dalam poligon kelurahan (frontend/js/fusion-points.js).
   */
  api.get('/v1/peta/titik', async (req, res) => {
    const period = await periodeFusi(req.query);
    if (!period) return res.json({ period: null, rows: [] });
    const rows = await repo.fusionVillagePoints(period, await saringFusi(req.query));
    res.json({ period, rows });
  });

  api.get('/v1/konfigurasi/kpi-jarak', async (req, res) => {
    const s = await readSettings();
    res.json({
      radiusKm: s.kpiRadiusM / 1000,
      radiusM: s.kpiRadiusM,
      weights: s.weights,
      confidenceSolidMin: s.confidenceSolidMin,
      confidenceRapuhMax: s.confidenceRapuhMax,
    });
  });

  /**
   * Ubah KPI Jarak.
   *
   * TIDAK ada pemeriksaan peran, karena aplikasi ini memang tidak punya sistem peran:
   * satu sandi dipakai bersama seluruh tim (lihat auth.js). Spesifikasi menyebut
   * "role admin"; sampai peran benar-benar ada, yang dipakai adalah pengaman yang
   * SUDAH terbukti di rute perusak lain — konfirmasi yang harus diketik PERSIS.
   * Mengubah ambang ini membuat seluruh golongan yang tersimpan tidak sebanding lagi,
   * jadi ia pantas diperlakukan seperti hapus periode, bukan seperti ganti setelan.
   *
   * Tidak langsung menghitung ulang: mengembalikan berapa baris yang akan terdampak
   * supaya layar bisa meminta kepastian dulu. Perhitungan ulangnya panggilan terpisah.
   */
  api.put('/v1/konfigurasi/kpi-jarak', express.json({ limit: '8kb' }), async (req, res) => {
    const km = Number((req.body || {}).radiusKm);
    if (!Number.isFinite(km) || km <= 0 || km > 500) {
      return res.status(400).json({ error: 'radiusKm harus angka antara 0 dan 500.' });
    }
    if (String(req.query.confirm || '') !== String(km)) {
      return res.status(400).json({
        error: `Konfirmasi tidak cocok. Kirim ?confirm=${km} untuk mengubah KPI Jarak.`,
      });
    }
    if (isRunning()) {
      return res.status(409).json({ error: 'Sedang ada impor berjalan. Tunggu sampai selesai.' });
    }

    const meter = Math.round(km * 1000);
    await repo.setAppConfig('kpi_jarak_m', String(meter), req.ip);
    const period = await repo.latestFusionPeriod();
    const totals = period ? await repo.fusionTotals({ period }) : { total: 0 };
    res.json({
      radiusKm: km,
      radiusM: meter,
      barisPerluHitungUlang: totals.total,
      catatan: 'Nilai tersimpan. Golongan lama BELUM dihitung ulang — panggil ' +
        'POST /api/v1/fusion/recalculate supaya angkanya sebanding lagi.',
    });
  });

  /**
   * Hitung ulang penggolongan.
   *
   * Dibalas 202 (diterima), bukan 200: untuk periode besar pekerjaannya bisa
   * menit-menitan. Ditolak selagi ada impor berjalan — keduanya menulis tabel yang sama.
   */
  api.post('/v1/fusion/recalculate', express.json({ limit: '8kb' }), async (req, res) => {
    if (isRunning()) {
      return res.status(409).json({ error: 'Sedang ada impor berjalan. Tunggu sampai selesai.' });
    }
    const diminta = String((req.body || {}).periode || '');
    const period = PERIOD.test(diminta) ? diminta : await repo.latestFusionPeriod();
    if (!period) {
      return res.status(400).json({ error: 'Belum ada periode yang bisa dihitung ulang.' });
    }
    try {
      res.status(202).json(await recalculate({ period, config }));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * Rincian satu nomor mesin — RUTE PII.
   *
   * Mengembalikan nama, alamat, dan titik rumah. Karena itu WAJIB dua hal, sama
   * seperti /customers: lewat piiLimiter, dan tiap aksesnya tercatat. Rute PII baru
   * tanpa keduanya membuka jalan penyedotan yang tidak meninggalkan jejak.
   */
  api.get('/v1/mesin/:engine', async (req, res) => {
    if (!piiLimiter.allow(req.ip || 'tidak diketahui')) {
      return res.status(429).json({
        error: 'Terlalu banyak permintaan data konsumen. Tunggu sebentar lalu coba lagi.',
      });
    }
    const engine = String(req.params.engine || '').trim().slice(0, 32);
    if (!engine) return res.status(400).json({ error: 'Nomor mesin wajib diisi.' });

    const detail = await repo.fusionEngineDetail(engine);
    if (!detail) {
      return res.status(404).json({
        error: 'Nomor mesin ini belum punya hasil penggolongan, atau data konsumen tidak tersedia.',
      });
    }
    repo.logCustomerAccess(req.ip, detail.fusion.villageCode || 'mesin', 1);
    res.json(detail);
  });

  /* ------------------------------------------------------------------------
     IMPOR MASSAL POS (Master Dealer/Pos)
     ------------------------------------------------------------------------
     Beda dari /import di atas: ini menyunting outlet_name/address pos yang SUDAH
     ada dari sheet "Dealer" AHM, dua langkah terpisah (pratinjau lalu terapkan) —
     lihat backend/server/pos-import.js untuk alasannya boleh menimpa.
     ------------------------------------------------------------------------ */

  api.post('/outlets/import/preview',
    express.raw({ type: 'multipart/form-data', limit: MAX_UPLOAD }),
    async (req, res) => {
      let parsed;
      try {
        parsed = parseMultipart(req.body, req.headers['content-type']);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      if (!parsed.file) return res.status(400).json({ error: 'Tidak ada berkas yang terkirim.' });

      const ext = path.extname(String(parsed.file.filename || '')).toLowerCase();
      if (!['.xlsx', '.xlsm', '.csv', '.txt'].includes(ext)) {
        return res.status(400).json({
          error: `Format ${ext || 'itu'} tidak bisa dibaca. Kirim .xlsx atau .csv.`,
        });
      }

      // Ke folder sementara sistem, BUKAN folder uploads yang diarsipkan — berkas ini
      // tidak memuat PII dan cuma dibutuhkan sesaat untuk dibaca, tidak seperti
      // arsip impor bulanan yang sengaja disimpan.
      const temp = path.join(os.tmpdir(),
        `pos-import-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
      fs.writeFileSync(temp, parsed.file.data);
      try {
        res.json(await previewOutletImport(temp));
      } catch (error) {
        res.status(400).json({ error: error.message });
      } finally {
        fs.unlink(temp, () => {});
      }
    });

  api.post('/outlets/import/commit', async (req, res) => {
    const previewToken = String((req.body || {}).previewToken || '');
    if (!previewToken) return res.status(400).json({ error: 'previewToken wajib diisi.' });
    try {
      res.json(await commitOutletImport(previewToken));
    } catch (error) {
      const status = error.code === 'SEDANG_BERJALAN' ? 409
        : error.code === 'KEDALUWARSA' ? 410 : 400;
      res.status(status).json({ error: error.message });
    }
  });

  return api;
}

/**
 * Parser multipart/form-data seadanya: satu berkas, beberapa field teks.
 *
 * Bekerja di atas Buffer, bukan string — mengubah .xlsx jadi string akan merusak
 * byte-nya, dan kerusakannya baru terlihat waktu Excel gagal dibuka.
 */
function parseMultipart(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw new Error('Permintaan unggahan tidak lengkap.');
  const boundary = Buffer.from('--' + (match[1] || match[2]).trim());

  const parts = [];
  let start = body.indexOf(boundary);
  if (start < 0) throw new Error('Permintaan unggahan tidak lengkap.');

  while (start >= 0) {
    const next = body.indexOf(boundary, start + boundary.length);
    if (next < 0) break;
    parts.push(body.subarray(start + boundary.length, next));
    start = next;
  }

  const fields = {};
  let file = null;

  for (const part of parts) {
    const split = part.indexOf('\r\n\r\n');
    if (split < 0) continue;
    const head = part.subarray(0, split).toString('utf8');
    // Buang CRLF penutup sebelum boundary berikutnya.
    const data = part.subarray(split + 4, part.length - 2);

    const name = /name="([^"]*)"/i.exec(head);
    if (!name) continue;
    const filename = /filename="([^"]*)"/i.exec(head);

    if (filename) {
      if (filename[1]) file = { filename: filename[1], data };
    } else {
      fields[name[1]] = data.toString('utf8');
    }
  }

  return { fields, file };
}

/**
 * Buang arsip unggahan yang lebih tua dari UPLOAD_KEEP_DAYS.
 *
 * Dijalankan waktu ada unggahan baru, bukan lewat penjadwal terpisah: impor terjadi
 * sebulan sekali, dan penjadwal yang harus dipasang orang adalah penjadwal yang
 * lupa dipasang. Kegagalan menghapus tidak boleh menggagalkan impor — kalau satu
 * berkas terkunci, yang benar adalah impornya tetap jalan.
 *
 * @return {number} jumlah berkas yang dibuang
 */
function pruneUploads(dir) {
  const batas = Date.now() - UPLOAD_KEEP_DAYS * 24 * 60 * 60 * 1000;
  let dibuang = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      try {
        if (fs.statSync(file).mtimeMs < batas) { fs.unlinkSync(file); dibuang++; }
      } catch { /* satu berkas terkunci tidak boleh menghentikan sisanya */ }
    }
    if (dibuang) {
      console.log(`Arsip unggahan: ${dibuang} berkas di atas ` +
        `${UPLOAD_KEEP_DAYS} hari dibuang (memuat PII).`);
    }
  } catch { /* folder belum ada — tidak ada yang perlu dibuang */ }
  return dibuang;
}

module.exports = { build, simpanKonsumen, parseMultipart, pruneUploads, MAX_UPLOAD, UPLOAD_KEEP_DAYS };
