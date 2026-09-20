/**
 * carikanBagianTitikFusi() — bahan tooltip hover titik KTP/Servis/Pengiriman.
 *
 * KENAPA TES INI ADA. Satu FITUR titik di peta cuma membawa {village, dealer} —
 * hitungan ktp/servis/kirimnya sendiri DIBUANG saat titikPerDesa() (fusion-points.js)
 * mengempiskan satu bucket jadi satu angka untuk jenis yang sedang digambar.
 * Fungsi ini mencari BALIK baris asli (ketiga hitungan utuh) dari
 * S.fusionPoints.rows lewat kode desa + kode dealer, TANPA permintaan baru ke
 * server. Kalau pencocokannya salah kolom, tooltip akan menampilkan angka bucket
 * yang SALAH — kelihatan masuk akal, tapi menjawab pertanyaan yang salah.
 *
 * KEPUTUSAN DESAIN yang dijaga secara tidak langsung oleh tes ini (tidak ada
 * assert langsung untuknya, karena ini soal APA YANG TIDAK ADA): tidak ada satu
 * baris kode pun di sini yang membaca nama/alamat konsumen atau nomor mesin.
 * Tooltip-nya cuma agregat — lihat komentar panjang di tampilkanTooltipTitikFusi()
 * (map.js) untuk tiga alasannya (posisi acak menyesatkan, piiLimiter tertembak
 * dalam hitungan detik, access_log tercatat untuk gerakan mouse tidak disengaja).
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

globalThis.document = { getElementById: () => null, addEventListener: () => {} };
globalThis.window = new Proxy({}, { get: () => () => {} });

const MODUL = pathToFileURL(path.join(__dirname, '..', 'frontend', 'js', 'map.js')).href;

async function main() {
  const { carikanBagianTitikFusi } = await import(MODUL);

  const rows = [
    { villageCode: '34.04.01.2001', dealerCode: 'NUSANTARASAKTIGEJAYAN', ktp: 10, servis: 4, kirim: 1 },
    { villageCode: '34.04.01.2001', dealerCode: 'DEALERLAIN', ktp: 3, servis: 0, kirim: 0 },
    { villageCode: '33.01.01.2001', dealerCode: 'NUSANTARASAKTIGEJAYAN', ktp: 7, servis: 2, kirim: 0 },
  ];

  const cocok = carikanBagianTitikFusi(rows, '34.04.01.2001', 'NUSANTARASAKTIGEJAYAN');
  assert.ok(cocok, 'kombinasi desa+dealer yang memang ada harus ketemu');
  assert.strictEqual(cocok.ktp, 10);
  assert.strictEqual(cocok.servis, 4);
  assert.strictEqual(cocok.kirim, 1);

  // Desa yang SAMA tapi dealer BEDA harus mengembalikan baris yang lain — kalau
  // pencocokannya cuma memakai village (lupa membandingkan dealer), dua dealer di
  // desa yang sama akan tertukar hitungannya.
  const dealerLain = carikanBagianTitikFusi(rows, '34.04.01.2001', 'DEALERLAIN');
  assert.strictEqual(dealerLain.ktp, 3, 'dealer berbeda di desa yang sama tidak boleh tertukar');

  // Dealer yang SAMA tapi desa BEDA juga harus baris yang lain — kebalikan dari
  // kasus di atas, kalau pencocokannya cuma memakai dealer.
  const desaLain = carikanBagianTitikFusi(rows, '33.01.01.2001', 'NUSANTARASAKTIGEJAYAN');
  assert.strictEqual(desaLain.ktp, 7, 'desa berbeda dengan dealer yang sama tidak boleh tertukar');

  assert.strictEqual(carikanBagianTitikFusi(rows, 'TIDAK-ADA', 'NUSANTARASAKTIGEJAYAN'), null,
    'kombinasi yang tidak ada harus null, bukan melempar galat atau mengembalikan baris asal');
  assert.strictEqual(carikanBagianTitikFusi(null, '34.04.01.2001', 'X'), null,
    'rows null tidak boleh melempar galat — dipanggil dari event hover yang bisa datang ' +
    'sebelum S.fusionPoints pernah terisi');
  assert.strictEqual(carikanBagianTitikFusi(undefined, '34.04.01.2001', 'X'), null);


  // --- kunciBucket(): aturan "masih di kantong yang sama?" -------------------
  //
  // Dipakai pewaktu 3 detik di map.js. Satu kantong (kelurahan, dealer) digambar
  // sebagai BANYAK fitur titik terpisah yang disebar acak, jadi menggeser kursor satu
  // piksel sering berarti pindah FITUR tanpa pindah kantong. Kalau kunci ini terlalu
  // halus (ikut membedakan koordinat), hitungan mundur mulai dari nol tiap gerakan
  // dan pemicunya tidak akan pernah menyala — kursor manusia tidak pernah benar-benar
  // diam. Kalau terlalu kasar (mengabaikan dealer atau jenis), pindah ke kantong lain
  // tidak me-reset dan panel yang terbuka memuat kantong yang SALAH.
  const { kunciBucket } = await import(MODUL);

  const titikA1 = { village: '34.04.01.2001', dealer: 'NUSANTARASAKTIGEJAYAN', idx: 0, warna: '#111' };
  const titikA2 = { village: '34.04.01.2001', dealer: 'NUSANTARASAKTIGEJAYAN', idx: 0, warna: '#999' };

  // Titik yang SAMA (kelurahan+dealer+nomor urut sama) berkunci sama walau warnanya
  // beda — warna bukan identitas.
  assert.strictEqual(kunciBucket(titikA1, 'ktp'), kunciBucket(titikA2, 'ktp'),
    'titik yang sama harus berkunci sama — kalau tidak, kartunya diambil ulang terus ' +
    'dan jeda 350 ms tidak pernah selesai');

  // Sejak tiap titik menampilkan ORANG yang berbeda (2026-09-20), pindah ke titik
  // TETANGGA di kelurahan yang sama pun WAJIB mengganti kartunya. Dulu kuncinya
  // berhenti di kantong, jadi menggeser satu titik ke sebelahnya menampilkan orang
  // yang lama.
  assert.notStrictEqual(kunciBucket(titikA1, 'ktp'),
    kunciBucket({ ...titikA1, idx: 1 }, 'ktp'),
    'nomor urut titik tidak ikut kunci — titik tetangga akan menampilkan orang yang salah');

  assert.notStrictEqual(kunciBucket(titikA1, 'ktp'),
    kunciBucket({ village: '33.01.01.2001', dealer: 'NUSANTARASAKTIGEJAYAN' }, 'ktp'),
    'kelurahan berbeda harus berkunci beda');
  assert.notStrictEqual(kunciBucket(titikA1, 'ktp'),
    kunciBucket({ village: '34.04.01.2001', dealer: 'DEALERLAIN' }, 'ktp'),
    'dealer berbeda di kelurahan yang sama harus berkunci beda');
  assert.notStrictEqual(kunciBucket(titikA1, 'ktp'), kunciBucket(titikA1, 'servis'),
    'jenis titik berbeda harus berkunci beda — lapisan KTP dan Servis bertumpuk di ' +
    'koordinat yang sama, dan panelnya menyebut jenis yang sedang dibuka');

  assert.strictEqual(typeof kunciBucket(null, 'ktp'), 'string',
    'props null tidak boleh melempar galat — event hover bisa datang tanpa properti');
  assert.strictEqual(typeof kunciBucket(undefined, undefined), 'string',
    'dipanggil tanpa argumen pun harus mengembalikan string, bukan meledak');

  // --- orangDiTitik(): satu titik = satu orang ------------------------------
  //
  // Perubahan KONSEP 2026-09-20. Hover titik tidak lagi menjawab "kelurahan ini punya
  // berapa" melainkan "titik ini siapa". Titiknya tetap anonim di muatan peta — yang
  // dibawa cuma kelurahan, dealer, dan NOMOR URUT-nya (idx). Fungsi ini yang
  // memetakan nomor urut itu ke satu baris di daftar kantong.
  //
  // Yang paling gampang salah, dan itulah yang diuji di sini: lapisan Servis hanya
  // menggambar orang yang PUNYA servis, jadi titik Servis ke-2 menunjuk orang ke-2 di
  // antara yang punya servis — BUKAN orang ke-2 di daftar lengkap. Salah di sini
  // menampilkan nama orang yang keliru, dan tidak ada galat apa pun yang menandainya.
  const { orangDiTitik } = await import(MODUL);

  const kantong = [
    { engineNo: 'M1', name: 'Ani', segment: 'loyal_verified', serviceCount: 2, deliveryCount: 1 },
    { engineNo: 'M2', name: 'Budi', segment: 'registered_only', serviceCount: 0, deliveryCount: 0 },
    { engineNo: 'M3', name: 'Cici', segment: 'service_near', serviceCount: 5, deliveryCount: 0 },
    { engineNo: 'M4', name: 'Dedi', segment: 'nomad', serviceCount: 0, deliveryCount: 3 },
  ];

  // Lapisan KTP menggambar SEMUA orang di kantong: urutannya apa adanya.
  assert.strictEqual(orangDiTitik(kantong, 'ktp', 0).engineNo, 'M1');
  assert.strictEqual(orangDiTitik(kantong, 'ktp', 3).engineNo, 'M4');

  // Lapisan SERVIS hanya yang punya servis: M1 dan M3. Titik ke-1 = M3, BUKAN M2.
  assert.strictEqual(orangDiTitik(kantong, 'servis', 0).engineNo, 'M1',
    'titik servis pertama harus orang pertama yang PUNYA servis');
  assert.strictEqual(orangDiTitik(kantong, 'servis', 1).engineNo, 'M3',
    'titik servis kedua menunjuk orang kedua di daftar LENGKAP — daftarnya belum ' +
    'disaring lebih dulu menurut jenis lapisannya');
  assert.strictEqual(orangDiTitik(kantong, 'servis', 2), null,
    'cuma dua orang yang punya servis; titik ketiga tidak boleh menunjuk siapa pun');

  // Lapisan KIRIM hanya yang punya pengiriman: M1 dan M4.
  assert.strictEqual(orangDiTitik(kantong, 'kirim', 0).engineNo, 'M1');
  assert.strictEqual(orangDiTitik(kantong, 'kirim', 1).engineNo, 'M4',
    'penyaring kirim tertukar dengan penyaring servis');

  // JUMLAH TIDAK COCOK = null, bukan menebak. Titik lahir dari source_overlap
  // sedangkan daftarnya dari customer_fusion; kalau keduanya menyimpang, menampilkan
  // nama yang SALAH jauh lebih buruk daripada tidak menampilkan nama.
  assert.strictEqual(orangDiTitik(kantong, 'ktp', 4), null,
    'idx di luar jangkauan harus null, bukan melipat balik ke baris pertama');
  assert.strictEqual(orangDiTitik(kantong, 'ktp', -1), null);
  assert.strictEqual(orangDiTitik([], 'ktp', 0), null);
  assert.strictEqual(orangDiTitik(null, 'ktp', 0), null,
    'rows null tidak boleh melempar galat — jawaban rute bisa gagal');
  assert.strictEqual(orangDiTitik(kantong, 'ktp', undefined), null,
    'titik tanpa idx (muatan peta versi lama) tidak boleh menunjuk orang asal');
  // Angka dalam bentuk teks DITERIMA. MapLibre mengembalikan properti fitur apa
  // adanya, tapi kalau suatu saat idx sampai ke sini sebagai '1', baris ke-1 tetap
  // baris yang benar — menolaknya cuma mematikan fitur tanpa menambah keamanan
  // sedikit pun. Yang ditolak nilai yang memang tidak menunjuk baris mana pun.
  assert.strictEqual(orangDiTitik(kantong, 'ktp', '1').engineNo, 'M2',
    'idx berbentuk teks angka seharusnya tetap menunjuk baris yang sama');
  assert.strictEqual(orangDiTitik(kantong, 'ktp', 1.5), null,
    'idx pecahan tidak menunjuk baris mana pun');
  assert.strictEqual(orangDiTitik(kantong, 'ktp', 'abc'), null,
    'idx yang bukan angka harus null, bukan NaN yang diam-diam jadi baris pertama');

  console.log('OK map-titik-fusi-tooltip — carikanBagianTitikFusi mencocokkan desa DAN ' +
    'dealer sekaligus (tidak tertukar kalau salah satunya sama), null untuk yang tidak ' +
    'ketemu maupun rows kosong; kunciBucket membedakan TIAP TITIK; orangDiTitik ' +
    'menyaring daftar menurut jenis lapisan dan menolak menebak saat jumlahnya tidak cocok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
