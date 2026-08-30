/**
 * Impor massal pos dari Excel: pratinjau lalu terapkan, dua langkah terpisah.
 *
 * Beda dari impor penjualan bulanan (importer.js), yang sengaja TIDAK menimpa kurasi
 * manusia untuk dealer/koordinat: impor ini MEMANG dimaksudkan menimpa
 * outlet_name/address kalau beda dari Excel — pengamannya pratinjau eksplisit + satu
 * tombol konfirmasi di frontend, bukan perlindungan diam-diam di sini.
 *
 * Token pratinjau disimpan di memori proses (bukan database): fitur ini dipakai
 * sesekali oleh segelintir orang di kantor yang sama, dan kedaluwarsa 1 jam sudah
 * cukup mencegah "Terapkan" dipencet berhari-hari kemudian terhadap data yang sudah
 * banyak berubah. Restart server membuang pratinjau yang belum diterapkan — itu benar:
 * lebih baik diminta unggah ulang daripada menerapkan sesuatu yang sudah basi.
 */
const crypto = require('crypto');
const store = require('./db');
const importLock = require('./import-lock');
const repo = require('./repository');
const { readTable } = require('./importer');
const { diffOutletImport, groupByCode } = require('../core/pos-diff');

const TOKEN_TTL_MS = 60 * 60 * 1000;

/** token -> { rows, diff, expiresAt } */
const previews = new Map();

function pruneExpired() {
  const now = Date.now();
  previews.forEach((entry, token) => {
    if (entry.expiresAt < now) previews.delete(token);
  });
}

/**
 * Sheet "Dealer" AHM: kolom judulnya sendiri yang dicari, bukan posisi kolom tetap —
 * urutannya tidak dijamin sama di tiap unduhan.
 */
function findColumns(header) {
  const cells = (header || []).map((c) => String(c || '').toLowerCase().trim());
  const outletCode = cells.findIndex((c) => c.includes('kode'));
  const outletName = cells.findIndex((c) => c.includes('nama'));
  const address = cells.findIndex((c) => c.includes('alamat'));
  if (outletCode < 0 || outletName < 0 || address < 0) {
    throw new Error(
      'Berkas ini sepertinya bukan sheet Dealer AHM — kolom Kode, Nama, dan Alamat ' +
      'tidak ketemu semuanya di baris judul.');
  }
  return { outletCode, outletName, address };
}

/** Baca berkas, bandingkan dengan outlets yang ada, simpan hasilnya sebagai token. */
async function previewOutletImport(file) {
  const table = await readTable(file);
  if (!table.length) throw new Error('Berkas kosong.');

  const columns = findColumns(table[0]);
  const rows = table.slice(1)
    .filter((r) => r.some((cell) => cell !== ''))
    .map((r) => ({
      outletCode: r[columns.outletCode] || '',
      outletName: r[columns.outletName] || '',
      address: r[columns.address] || '',
    }));

  const known = await repo.listOutletsForImport();
  const diff = diffOutletImport(rows, known);

  pruneExpired();
  const previewToken = crypto.randomBytes(16).toString('hex');
  previews.set(previewToken, { rows, diff, expiresAt: Date.now() + TOKEN_TTL_MS });

  return { previewToken, ...diff };
}

/**
 * Terapkan HANYA outlet_code yang ada di `diff.changed` — `added` tetap sekadar
 * laporan (lihat backend/core/pos-diff.js), dan outlet yang sudah sama tidak perlu
 * ditulis ulang.
 */
async function commitOutletImport(previewToken) {
  pruneExpired();
  const entry = previews.get(previewToken);
  if (!entry) {
    const error = new Error('Pratinjau ini sudah tidak berlaku. Unggah ulang berkasnya.');
    error.code = 'KEDALUWARSA';
    throw error;
  }

  importLock.begin();
  try {
    const { byCode } = groupByCode(entry.rows);
    const codes = [...new Set(entry.diff.changed.map((c) => c.outletCode))];
    const now = new Date().toISOString();
    let applied = 0;

    await store.transaction(store.db(), async (conn) => {
      for (const code of codes) {
        const pilihan = (byCode.get(code) || [])[0];
        if (!pilihan) continue;
        await conn.query(`
          UPDATE outlets SET outlet_name = ?, address = ?, updated_at = ?
          WHERE outlet_code = ?`,
        [pilihan.outletName, pilihan.address, now, code]);
        applied++;
      }
    });

    previews.delete(previewToken);
    return { applied, summary: entry.diff };
  } finally {
    importLock.end();
  }
}

module.exports = { previewOutletImport, commitOutletImport, findColumns };
