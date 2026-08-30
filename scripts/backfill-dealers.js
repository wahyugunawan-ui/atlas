/**
 * Isi tabel `dealers` dari data yang sudah ada di `outlets`, lalu validasi FK-nya:
 * `npm run backfill-dealers`
 *
 * Sekali jalan. Sebelum skrip ini dijalankan, `outlets.dealer_code`/`dealer_name`
 * cuma kolom string yang kebetulan konsisten — tidak ada tabel `dealers` sungguhan
 * untuk direferensikan. `schema.sql` sudah menambahkan constraint FK-nya lewat
 * `NOT VALID` (lihat komentar di sana), jadi database production yang sudah punya
 * puluhan outlet tetap bisa start tanpa skrip ini. Skrip ini yang mengisi `dealers`
 * dari data lama itu, lalu memvalidasi FK-nya terhadap SELURUH baris `outlets` yang
 * sudah ada — bukan cuma yang baru ditulis setelah constraint aktif.
 *
 * Aman dijalankan berulang: INSERT memakai ON CONFLICT DO NOTHING, dan
 * VALIDATE CONSTRAINT pada constraint yang sudah tervalidasi cuma jadi no-op cepat.
 */
const { config: defaultConfig } = require('../backend/server/config');
const store = require('../backend/server/db');

/**
 * @param {Object} [config]  dari config.js secara default; tes lewat config database
 *   sementaranya sendiri supaya tidak pernah menyentuh database sungguhan.
 */
async function main(config) {
  config = config || defaultConfig;
  await store.open(config);
  const db = store.db();

  const total = (await store.one(db, 'SELECT COUNT(*) AS n FROM outlets')).n;
  if (!total) {
    console.error('\n  Tabel outlets masih kosong. Tidak ada yang perlu dibackfill.\n');
    await store.close();
    return;
  }

  // Satu dealer_code SEHARUSNYA cuma punya satu dealer_name — tapi skrip ini tidak
  // boleh mengasumsikan itu diam-diam tetap benar. Kalau ternyata ada yang bercabang,
  // backfill akan MEMBEKUKAN satu nama secara sepihak (lewat DISTINCT ON di bawah);
  // itu keputusan yang harus terlihat oleh tim, bukan hilang begitu saja ke log.
  const anomali = await store.all(db, `
    SELECT dealer_code, COUNT(DISTINCT dealer_name) AS n,
           STRING_AGG(DISTINCT dealer_name, ' / ') AS names
    FROM outlets
    GROUP BY dealer_code
    HAVING COUNT(DISTINCT dealer_name) > 1`);

  if (anomali.length) {
    console.log('');
    console.log('  PERINGATAN: dealer_code berikut punya lebih dari satu nama di');
    console.log('  outlets yang ada. Satu nama akan dipakai (yang paling baru diubah),');
    console.log('  sisanya akan HILANG dari tabel dealers. Periksa manual kalau perlu:');
    console.log('');
    anomali.forEach((a) => console.log(`      ${a.dealer_code}  ${a.names}`));
    console.log('');
  }

  // DISTINCT ON, bukan DISTINCT biasa: kalau ada dealer_code yang bercabang nama
  // (kasus anomali di atas), ambil satu secara DETERMINISTIK — yang paling baru
  // diubah menang, supaya hasilnya konsisten kalau skrip ini dijalankan ulang.
  const dealers = await store.all(db, `
    SELECT DISTINCT ON (dealer_code) dealer_code, dealer_name
    FROM outlets
    ORDER BY dealer_code, updated_at DESC NULLS LAST`);

  const now = new Date().toISOString();
  let inserted = 0;
  await store.transaction(db, async (conn) => {
    for (const d of dealers) {
      const info = await conn.query(`
        INSERT INTO dealers (dealer_code, dealer_name, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT (dealer_code) DO NOTHING`, [d.dealer_code, d.dealer_name, now]);
      if (info.rowCount) inserted++;
    }
  });

  // Baris lama (ditulis sebelum constraint aktif) belum pernah diperiksa FK-nya --
  // NOT VALID di schema.sql sengaja melewatkannya. Divalidasi eksplisit di sini,
  // sekarang setelah dealers pasti sudah terisi lengkap.
  await store.run(db, 'ALTER TABLE outlets VALIDATE CONSTRAINT fk_outlets_dealer');

  const stats = await store.one(db, `
    SELECT (SELECT COUNT(*) FROM dealers) AS dealers,
           (SELECT COUNT(*) FROM outlets) AS outlets`);

  console.log('');
  console.log('  dealer baru ditambahkan :', inserted);
  console.log('  total dealer sekarang   :', stats.dealers);
  console.log('  total outlet            :', stats.outlets);
  console.log('  FK divalidasi           : ya, seluruh outlets lama ikut diperiksa');
  console.log('');

  await store.close();
}

module.exports = main;

// Jalan sendiri cuma waktu dipanggil langsung (`node scripts/backfill-dealers.js`
// atau `npm run backfill-dealers`) — bukan waktu berkas ini di-require test, yang
// butuh memanggil main(config) dengan config database UJI, bukan yang sungguhan.
if (require.main === module) {
  main().catch((error) => {
    console.error('\n  GAGAL:', error.message, '\n');
    process.exit(1);
  });
}
