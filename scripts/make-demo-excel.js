/**
 * Buat berkas Excel dummy untuk latihan atau demo: `npm run demo-excel`
 *
 *     npm run demo-excel -- C:\astra-data\demo\DEMO-September-2026.xlsx
 *
 * Isinya kelurahan dan pos SUNGGUHAN dari database supaya angka di layar masuk akal,
 * tapi nama dan alamat konsumennya dikarang seluruhnya — tidak satu pun PII asli
 * keluar dari database ke berkas ini.
 *
 * Sengaja tidak sempurna. Lima nama kelurahan dieja salah satu huruf dan satu pos
 * dibuat belum terdaftar, supaya yang ditunjukkan bukan cuma "impor berhasil" tapi juga
 * baris yang belum cocok, alat Cocokkan Nama, dan deteksi pos baru.
 *
 * PERIODENYA DIPILIH DI HALAMAN, bukan dari berkas ini. Jangan pilih bulan yang sudah
 * berisi data sungguhan: impor menghapus lalu menulis ulang periode yang dipilih, jadi
 * berkas demo yang diimpor ke bulan yang salah akan MENIMPA data asli bulan itu.
 */
const ExcelJS = require('exceljs');
const { config } = require('../backend/server/config');
const store = require('../backend/server/db');

const HEADER = ['Nama', 'Alamat', 'Kel', 'Kec', 'Kode Kota Konsumen', 'Kode Pos',
  'Kode Prov', 'Kode Dealer', 'NAMA Dealer', 'Alamat', 'Kelurahan', 'Kecamatan',
  'Kabupaten', 'Propinsi'];

/** Nama karangan. Sengaja terbaca sebagai contoh, bukan seperti nama orang sungguhan. */
const DEPAN = ['Budi', 'Siti', 'Agus', 'Dewi', 'Rizal', 'Ratna', 'Joko', 'Sari',
  'Bayu', 'Indah', 'Fajar', 'Wulan'];
const BELAKANG = ['Contoh', 'Simulasi', 'Percobaan', 'Demo', 'Uji', 'Sampel'];

/**
 * Nama kelurahan yang SENGAJA dieja salah.
 *
 * Supaya demonya bisa menunjukkan dua hal sekaligus: baris yang tidak cocok dilaporkan,
 * dan alat "Cocokkan Nama" punya sesuatu untuk dikerjakan. Tanpa ini berkasnya cocok
 * 100% dan setengah alur aplikasinya tidak terlihat.
 */
function ejaanSalah(nama) {
  // Vokal TERAKHIR diganti, bukan huruf di ujung kata.
  //
  // Versi pertama memakai .replace(/o$/,'a').replace(/a$/,'o') dan itu batal sendiri:
  // yang pertama mengubah "Reco" jadi "Reca", yang kedua mengembalikannya jadi "Reco".
  // Nama berakhiran konsonan tidak tersentuh sama sekali. Hasilnya berkas yang cocok
  // 100% padahal seharusnya menyisakan baris yang belum cocok — ketahuan cuma karena
  // berkasnya dijalankan lewat logika impor sungguhan sebelum diserahkan.
  const s = nama.toUpperCase();
  const posisi = Math.max(s.lastIndexOf('A'), s.lastIndexOf('E'), s.lastIndexOf('I'),
    s.lastIndexOf('O'), s.lastIndexOf('U'));
  if (posisi < 0) return `${s}A`;
  const ganti = { A: 'O', E: 'A', I: 'E', O: 'A', U: 'O' }[s[posisi]];
  return s.slice(0, posisi) + ganti + s.slice(posisi + 1);
}

async function main() {
  await store.open(config);
  const db = store.db();

  // Kelurahan yang punya penjualan: yang ini pasti cocok waktu diimpor.
  const villages = await store.all(db, `
    SELECT village_name AS kel, district_name AS kec, city_code AS kota
    FROM villages
    WHERE village_code IN (SELECT village_code FROM sales)
    ORDER BY random() LIMIT 60`);

  const outlets = await store.all(db, `
    SELECT outlet_code AS kode, outlet_name AS nama, address AS alamat
    FROM outlets ORDER BY random() LIMIT 12`);

  const rows = [];
  let n = 0;

  // --- baris yang cocok ---
  for (const v of villages) {
    const berapa = 3 + (n % 7);
    for (let i = 0; i < berapa; i++) {
      const o = outlets[n % outlets.length];
      rows.push([
        `${DEPAN[n % DEPAN.length]} ${BELAKANG[n % BELAKANG.length]}`,
        `Jl. Contoh No. ${(n % 200) + 1}`,
        v.kel, v.kec, v.kota, '50000', v.kota.slice(0, 2),
        o.kode, o.nama, o.alamat, 'Tamanagung', 'Muntilan', 'Kab. Magelang',
        'Jawa Tengah',
      ]);
      n++;
    }
  }

  // --- baris yang SENGAJA tidak cocok (ejaan) ---
  for (const v of villages.slice(0, 5)) {
    for (let i = 0; i < 3; i++) {
      const o = outlets[n % outlets.length];
      rows.push([
        `${DEPAN[n % DEPAN.length]} ${BELAKANG[n % BELAKANG.length]}`,
        `Jl. Contoh No. ${(n % 200) + 1}`,
        ejaanSalah(v.kel), v.kec, v.kota, '50000', v.kota.slice(0, 2),
        o.kode, o.nama, o.alamat, 'Tamanagung', 'Muntilan', 'Kab. Magelang',
        'Jawa Tengah',
      ]);
      n++;
    }
  }

  // --- satu pos yang belum terdaftar ---
  //
  // Supaya demonya menunjukkan "pos baru terdeteksi" — salah satu hal yang paling
  // sering ditanyakan waktu presentasi.
  for (let i = 0; i < 6; i++) {
    const v = villages[i];
    rows.push([
      `${DEPAN[i]} ${BELAKANG[i % BELAKANG.length]}`, `Jl. Contoh No. ${900 + i}`,
      v.kel, v.kec, v.kota, '50000', v.kota.slice(0, 2),
      'DEMO-01', 'POS SIMULASI - DEMO', 'Jl. Simulasi No. 1',
      'Tamanagung', 'Muntilan', 'Kab. Magelang', 'Jawa Tengah',
    ]);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(HEADER);
  rows.forEach((r) => ws.addRow(r));

  const out = process.argv[2];
  if (!out) {
    console.error('\n  Sebutkan tujuannya:');
    console.error('  npm run demo-excel -- C:\\astra-data\\demo\\DEMO-September-2026.xlsx\n');
    await store.close();
    process.exit(1);
  }
  await wb.xlsx.writeFile(out);

  console.log('');
  console.log(`  berkas        : ${out}`);
  console.log(`  baris data    : ${rows.length}`);
  console.log(`  kelurahan     : ${villages.length} (cocok) + 5 (ejaan sengaja salah)`);
  console.log(`  pos           : ${outlets.length} terdaftar + 1 baru (DEMO-01)`);
  console.log('');

  await store.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
