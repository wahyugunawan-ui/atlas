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

  console.log('OK map-titik-fusi-tooltip — carikanBagianTitikFusi mencocokkan desa DAN ' +
    'dealer sekaligus (tidak tertukar kalau salah satunya sama), null untuk yang tidak ' +
    'ketemu maupun rows kosong');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
