/**
 * Unduh berkas batas kelurahan yang belum ada: `npm run fetch-boundaries`
 *
 * Sumbernya `cahyadsn/wilayah_boundaries` di GitHub — data batas wilayah Indonesia
 * berlisensi MIT, satu berkas SQL per kabupaten/kota. Yang diambil provinsi 33 (Jawa
 * Tengah, 35 kabupaten/kota) dan 34 (DI Yogyakarta, 5).
 *
 * KENAPA SELURUH PROVINSI, bukan cuma yang sedang dipakai. Menyiapkan semuanya di
 * database membuat perluasan cakupan tidak butuh setelan apa pun lagi: bulan depan
 * Excel memuat Klaten, kelurahannya sudah ada beserta poligonnya, barisnya langsung
 * cocok. Biayanya murah — 40 kabupaten cuma ~15 MB di database — dan yang dikirim ke
 * browser tetap disaring ke kota yang punya penjualan (lihat scripts/export-geo.js).
 *
 * Aman dijalankan berulang: yang sudah ada dilewati.
 */
const fs = require('fs');
const path = require('path');
const { config } = require('../src/server/config');

const REPO = 'https://raw.githubusercontent.com/cahyadsn/wilayah_boundaries/main';
const API = 'https://api.github.com/repos/cahyadsn/wilayah_boundaries/contents';

/** Provinsi yang diambil. 33 = Jawa Tengah, 34 = DI Yogyakarta. */
const PROVINSI = ['33', '34'];

async function daftarBerkas(provinsi) {
  const res = await fetch(`${API}/db/kel/${provinsi}`, {
    headers: { 'User-Agent': 'astra-command-center' },
  });
  if (!res.ok) {
    throw new Error(`Tidak bisa membaca daftar berkas provinsi ${provinsi} ` +
      `(HTTP ${res.status}). Periksa sambungan internet.`);
  }
  return (await res.json())
    .filter((f) => f.type === 'file' && f.name.endsWith('.sql'))
    .map((f) => f.name);
}

async function main() {
  const tujuan = path.join(config.geoSourceDir, 'input');
  if (!fs.existsSync(tujuan)) {
    console.error(`\n  Folder tujuan tidak ada: ${tujuan}`);
    console.error('  Atur GEO_SOURCE_DIR di .env ke folder geo-kelurahan.\n');
    process.exit(1);
  }

  console.log('');
  let diunduh = 0;
  let dilewati = 0;
  let byte = 0;

  for (const provinsi of PROVINSI) {
    const nama = await daftarBerkas(provinsi);
    console.log(`  provinsi ${provinsi}: ${nama.length} berkas di sumber`);

    for (const berkas of nama) {
      const file = path.join(tujuan, berkas);
      if (fs.existsSync(file)) { dilewati++; continue; }

      const res = await fetch(`${REPO}/db/kel/${provinsi}/${berkas}`, {
        headers: { 'User-Agent': 'astra-command-center' },
      });
      if (!res.ok) {
        console.error(`    GAGAL ${berkas}: HTTP ${res.status}`);
        continue;
      }
      const isi = Buffer.from(await res.arrayBuffer());

      // Ditulis ke berkas sementara lalu dipindahkan. Unduhan yang putus di tengah
      // tidak boleh meninggalkan berkas separuh yang dikira lengkap oleh jalan
      // berikutnya — dan `existsSync` tidak bisa membedakannya.
      const sementara = file + '.parsial';
      fs.writeFileSync(sementara, isi);
      fs.renameSync(sementara, file);

      diunduh++;
      byte += isi.length;
      console.log(`    ${berkas}  ${(isi.length / 1048576).toFixed(2)} MB`);
    }
  }

  console.log('');
  console.log(`  diunduh  : ${diunduh} berkas, ${(byte / 1048576).toFixed(1)} MB`);
  console.log(`  dilewati : ${dilewati} berkas (sudah ada)`);
  console.log('');
  console.log('  Lanjutkan: npm run seed-boundaries\n');
}

main().catch((error) => {
  console.error('\n  GAGAL:', error.message, '\n');
  process.exit(1);
});
