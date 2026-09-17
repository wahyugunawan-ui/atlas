/**
 * Titik tiga sumber di peta — bagian murninya.
 *
 * Yang dijaga di sini SIFATNYA: titik tidak boleh melompat waktu filter berubah,
 * tidak boleh jatuh di luar kelurahannya sendiri, dan hitungan nol tidak boleh
 * melahirkan titik. Ketiganya salah yang TIDAK kelihatan salah di peta — sebaran
 * acak memang tampak wajar apa pun isinya.
 */
const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODUL = pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'js', 'fusion-points.js')).href;

// Kotak sederhana 0..10, dipakai sebagian besar tes geometri.
const KOTAK = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

test('benih tetap: dua pembangkit menghasilkan urutan yang sama persis', async () => {
  const { pembangkitAcak } = await import(MODUL);
  const a = pembangkitAcak(991);
  const b = pembangkitAcak(991);
  const deret = (r) => [r(), r(), r(), r(), r()];
  assert.deepStrictEqual(deret(a), deret(b));
  // Benih berbeda harus menghasilkan urutan berbeda, kalau tidak benihnya diabaikan.
  assert.notDeepStrictEqual(deret(pembangkitAcak(1)), deret(pembangkitAcak(2)));
});

test('titik hasil sebaran selalu di DALAM poligonnya', async () => {
  const { sebarDiPoligon, pembangkitAcak, titikDiDalam } = await import(MODUL);
  const titik = sebarDiPoligon(KOTAK, 50, pembangkitAcak(7));
  assert.ok(titik.length > 0, 'kotak lebar harus menghasilkan titik');
  titik.forEach(([lng, lat]) => {
    assert.ok(titikDiDalam(lng, lat, KOTAK), `titik ${lng},${lat} jatuh di luar`);
  });
});

test('sebaran deterministik: dipanggil dua kali, titiknya identik', async () => {
  const { sebarDiPoligon, pembangkitAcak } = await import(MODUL);
  // Inilah yang mencegah titik melompat-lompat tiap filter diubah.
  assert.deepStrictEqual(
    sebarDiPoligon(KOTAK, 20, pembangkitAcak(991)),
    sebarDiPoligon(KOTAK, 20, pembangkitAcak(991)));
});

test('poligon yang luasnya jauh lebih kecil dari kotak pembatasnya dilewati', async () => {
  const { sebarDiPoligon, pembangkitAcak, titikDiDalam } = await import(MODUL);
  // VERSI PERTAMA TES INI SALAH: saya memakai persegi panjang tipis (10 x 1e-7).
  // Persegi panjang tipis MEMENUHI kotak pembatasnya sendiri, jadi hampir semua
  // titik acak justru sah dan tesnya gagal — premisnya yang keliru, bukan kodenya.
  // Yang benar-benar menguji jalur "menyerah" adalah bentuk yang luasnya jauh lebih
  // kecil daripada kotak pembatasnya: segitiga diagonal sangat pipih.
  const pipih = [[0, 0], [10, 10], [10, 9.98], [0, 0]];
  const titik = sebarDiPoligon(pipih, 30, pembangkitAcak(3));

  assert.ok(titik.length < 30,
    `harus menyerah untuk sebagian titik, dapat ${titik.length} dari 30`);
  // Yang berhasil ditaruh tetap WAJIB di dalam — menyerah tidak boleh berubah jadi
  // menaruhnya sembarangan di kotak pembatas (di luar wilayahnya sendiri).
  titik.forEach(([lng, lat]) => {
    assert.ok(titikDiDalam(lng, lat, pipih), `titik ${lng},${lat} jatuh di luar`);
  });
});

test('hitungan nol tidak melahirkan titik', async () => {
  const { titikPerDesa } = await import(MODUL);
  const rows = [
    { villageCode: '34.04.01.2001', dealerCode: '9', ktp: 5, servis: 0, kirim: 0 },
  ];
  assert.deepStrictEqual(titikPerDesa(rows, 'servis'), {});
  assert.deepStrictEqual(titikPerDesa(rows, 'kirim'), {});
  assert.deepStrictEqual(titikPerDesa(rows, 'ktp'),
    { '34.04.01.2001': [{ dealer: '9', n: 5 }] });
});

test('dealer ikut terbawa, karena warna titik mengikuti dealer', async () => {
  const { titikPerDesa } = await import(MODUL);
  const rows = [
    { villageCode: 'A', dealerCode: '9', ktp: 2, servis: 1, kirim: 0 },
    { villageCode: 'A', dealerCode: '7348', ktp: 3, servis: 0, kirim: 0 },
  ];
  const hasil = titikPerDesa(rows, 'ktp');
  assert.strictEqual(hasil.A.length, 2);
  assert.deepStrictEqual(hasil.A.map((x) => x.dealer).sort(), ['7348', '9']);
  assert.strictEqual(hasil.A.reduce((s, x) => s + x.n, 0), 5);
});

test('kelurahan tidak diketahui tidak digambar', async () => {
  const { titikPerDesa } = await import(MODUL);
  // village_code '' adalah sentinel "desa tidak diketahui" (schema.sql). Tidak ada
  // poligon untuk digambari; memaksakannya berarti menaruhnya di tempat karangan.
  const rows = [{ villageCode: '', dealerCode: '9', ktp: 4, servis: 0, kirim: 0 }];
  assert.deepStrictEqual(titikPerDesa(rows, 'ktp'), {});
});

test('ikon kotak: ukuran buffer persis, tanpa sisa dan tanpa kurang', async () => {
  const { ikonKotak } = await import(MODUL);
  const ikon = ikonKotak(12, [236, 72, 153], [255, 255, 255]);
  assert.strictEqual(ikon.width, 12);
  assert.strictEqual(ikon.height, 12);
  // Salah hitung buffer tidak melempar galat — ia menghasilkan ikon acak-acakan
  // atau terpotong, dan itu cuma terlihat kalau ada yang membuka petanya.
  assert.strictEqual(ikon.data.length, 12 * 12 * 4);
});

test('ikon kotak: tepi dan isi benar-benar berbeda', async () => {
  const { ikonKotak } = await import(MODUL);
  const n = 8;
  const ikon = ikonKotak(n, [236, 72, 153], [255, 255, 255]);
  const piksel = (x, y) => Array.from(ikon.data.slice((y * n + x) * 4, (y * n + x) * 4 + 4));
  assert.deepStrictEqual(piksel(0, 0), [255, 255, 255, 255], 'sudut = tepi');
  assert.deepStrictEqual(piksel(n - 1, n - 1), [255, 255, 255, 255], 'sudut jauh = tepi');
  assert.deepStrictEqual(piksel(4, 4), [236, 72, 153, 255], 'tengah = isian');
});

test('ikon kotak: seluruh piksel buram', async () => {
  const { ikonKotak } = await import(MODUL);
  const ikon = ikonKotak(10, [236, 72, 153], [255, 255, 255]);
  // Alfa nol = ikon terdaftar dengan sukses, tanpa galat, dan tidak terlihat sama
  // sekali. Kegagalan paling diam yang mungkin terjadi di lapisan ini.
  for (let i = 3; i < ikon.data.length; i += 4) {
    assert.strictEqual(ikon.data[i], 255, `piksel ke-${(i - 3) / 4} tembus pandang`);
  }
});

test('ikon kotak: ukuran mustahil dinaikkan, bukan menghasilkan ikon cacat', async () => {
  const { ikonKotak } = await import(MODUL);
  // Sisi 1 px tidak punya ruang untuk tepi DAN isi; yang keluar akan seluruhnya
  // tepi dan tidak pernah terbaca sebagai kotak berwarna.
  assert.strictEqual(ikonKotak(1, [1, 2, 3], [4, 5, 6]).width, 3);
  assert.strictEqual(ikonKotak(0, [1, 2, 3], [4, 5, 6]).width, 12);
});

test('kelurahan MultiPolygon memakai cincin TERPANJANG, bukan yang pertama', async () => {
  const { cincinPerDesa } = await import(MODUL);
  // Kalau yang dipakai cincin pertama, seluruh penduduk tersebar di pulau kecil dan
  // itu akan terbaca seperti temuan, bukan seperti bug.
  const kecil = [[0, 0], [1, 0], [1, 1], [0, 0]];
  const besar = [[5, 5], [9, 5], [9, 9], [5, 9], [5, 5]];
  const geo = {
    features: [{
      properties: { kode: 'X' },
      geometry: { type: 'MultiPolygon', coordinates: [[kecil], [besar]] },
    }],
  };
  assert.deepStrictEqual(cincinPerDesa(geo).X, besar);
});
