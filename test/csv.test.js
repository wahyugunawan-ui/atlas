/**
 * Uji parser CSV.
 *
 * Ini bukan tes formalitas. Parser polos `split(',')` pernah memecah alamat berisi
 * koma, menggeser seluruh baris, dan menghasilkan kode outlet palsu — lalu membuat
 * kesimpulan bahwa data tidak punya outlet sama sekali. Kasus itu ada di bawah.
 */
const assert = require('assert');
const { parseCsv, stripBom } = require('../backend/core/csv');

function test() {
  // --- kasus yang dulu merusak segalanya ---
  const withComma = 'kode,nama,alamat\n' +
    'O01,ASTRA MOTOR SLEMAN,"Jl. Magelang Km. 7, Sleman"\n';
  const rows = parseCsv(withComma);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1].length, 3,
    'koma di dalam tanda kutip memecah baris jadi empat kolom');
  assert.strictEqual(rows[1][2], 'Jl. Magelang Km. 7, Sleman');
  assert.strictEqual(rows[1][0], 'O01', 'kolom kode tergeser');

  // --- kutip ganda di dalam kutip ---
  const escaped = 'a,b\n"dia bilang ""halo""",2\n';
  assert.strictEqual(parseCsv(escaped)[1][0], 'dia bilang "halo"');

  // --- pemisah titik koma, umum di ekspor Excel Indonesia ---
  const semicolon = 'kode;nama;jumlah\nO01;ASTRA;3\n';
  const semi = parseCsv(semicolon);
  assert.strictEqual(semi[1].length, 3);
  assert.strictEqual(semi[1][1], 'ASTRA');

  // Baris judul dengan koma di dalam kutip tidak boleh membuat pemisahnya salah
  // tebak: judulnya punya 2 titik koma dan 1 koma, jadi titik koma yang menang.
  const mixed = 'kode;nama;"kota, provinsi"\nO01;ASTRA;"Sleman, DIY"\n';
  assert.strictEqual(parseCsv(mixed)[1][2], 'Sleman, DIY');

  // --- CRLF dan baris kosong ---
  const crlf = 'a,b\r\n1,2\r\n\r\n3,4\r\n';
  const crlfRows = parseCsv(crlf);
  assert.strictEqual(crlfRows.length, 3, 'baris kosong harus dibuang');
  assert.strictEqual(crlfRows[1][1], '2', 'carriage return ikut masuk ke nilai');

  // --- baris terakhir tanpa newline ---
  assert.strictEqual(parseCsv('a,b\n1,2')[1][1], '2');

  // --- BOM ---
  assert.strictEqual(stripBom('﻿kode,nama').slice(0, 4), 'kode',
    'BOM dari Excel harus dibuang, kalau tidak nama kolom pertama tidak akan cocok');

  console.log('OK csv — koma dalam kutip, kutip ganda, titik koma, CRLF, BOM');
}

test();
