/**
 * Checklist jenis data per periode — bagian yang MURNI.
 *
 * Dipisah dari import.js supaya bisa diuji tanpa browser. Yang dijaga di sini satu
 * hal yang gampang salah dan tidak kelihatan salah: membedakan TIGA keadaan, bukan
 * dua.
 *
 *   ada           jumlahnya > 0
 *   kosong        diperiksa, memang tidak ada barisnya
 *   tak diketahui hitungannya `null` — database PII tidak tersedia
 *
 * Menyamakan "tak diketahui" dengan "kosong" membuat layar berkata data tidak ada,
 * padahal yang benar adalah kita tidak bisa memeriksanya. Itu bukan sekadar kurang
 * tepat: orang bisa mengimpor ulang sebulan penuh karena mengira datanya hilang.
 */

/**
 * Jenis data yang bisa dipertanggungjawabkan per periode — yaitu yang benar-benar
 * DIIMPOR orang sebagai berkas.
 *
 * "Penjualan" DIBUANG 2026-09-21 (permintaan tim). Sampai 2026-09-19 dia memang satu
 * jenis impor tersendiri dengan berkasnya sendiri. Sejak impor penjualan dipensiunkan,
 * angka penjualan DITURUNKAN dari impor Data KTP — jadi menampilkannya di sini sebagai
 * jenis data ketiga membuat orang mengira ada satu berkas lagi yang harus diunggah,
 * padahal tidak ada. Angkanya sendiri tidak hilang; ia tetap tampil di Sales Analytics,
 * yang memang tempatnya.
 *
 * Konsekuensinya penyebut checklist turun dari 3 jadi 2 ("2 dari 2 jenis data
 * tersimpan"), dan itu memang jumlah berkas yang sebenarnya diminta tiap bulan.
 */
export const JENIS_DATA = [
  { kunci: 'ktp', label: 'Data KTP', field: 'ktpRows' },
  { kunci: 'servis', label: 'Data Servis', field: 'servisRows' },
];

/**
 * Status satu jenis data.
 *
 * @returns {'ada'|'kosong'|'tak-diketahui'}
 */
export function statusJenis(nilai) {
  if (nilai === null || nilai === undefined) return 'tak-diketahui';
  return Number(nilai) > 0 ? 'ada' : 'kosong';
}

/**
 * Checklist lengkap satu baris periode.
 *
 * @param {Object} baris satu elemen dari /api/periods
 * @returns {Array<{kunci, label, status, jumlah}>}
 */
export function checklistPeriode(baris) {
  const p = baris || {};
  return JENIS_DATA.map((j) => {
    const nilai = p[j.field];
    return {
      kunci: j.kunci,
      label: j.label,
      status: statusJenis(nilai),
      // Jumlah hanya bermakna kalau memang diketahui.
      jumlah: nilai === null || nilai === undefined ? null : Number(nilai) || 0,
    };
  });
}

/**
 * Ringkasan hasil impor Data KTP / Data Servis.
 *
 * Field-nya mengikuti apa yang BENAR-BENAR dikembalikan `runSourceImport()`
 * (`rowsRead`, `rowsUsed`, `unmatchedNames`) — bukan field panel penjualan seperti
 * "Pos baru", yang kalau dipakai di sini akan tampil `undefined` dan terlihat resmi.
 *
 * `perluPerhatian` menegakkan satu aturan proyek: baris yang tidak cocok JANGAN
 * dibuang diam-diam. Selisih dibaca-vs-terpakai dihitung dan ditandai, supaya impor
 * yang membuang separuh berkasnya tidak lewat sebagai "berhasil" begitu saja.
 */
export function ringkasHasilSumber(hasil) {
  const h = hasil || {};
  const dibaca = Number(h.rowsRead) || 0;
  const terpakai = Number(h.rowsUsed) || 0;
  const namaTakCocok = Number(h.unmatchedNames) || 0;
  return {
    dibaca,
    terpakai,
    terbuang: Math.max(0, dibaca - terpakai),
    namaTakCocok,
    perluPerhatian: namaTakCocok > 0 || terpakai < dibaca,
  };
}

/**
 * Ringkasan satu kalimat untuk kepala kartu periode.
 *
 * Menyebut yang ADA saja. Kalau ada yang tidak bisa diperiksa, itu disebut terpisah
 * — bukan dicampur jadi "2 dari 3", karena angka pecahan seperti itu menyembunyikan
 * bahwa salah satu penyebutnya sebenarnya tidak diketahui.
 */
export function ringkasChecklist(daftar) {
  const isi = daftar || [];
  const ada = isi.filter((x) => x.status === 'ada').length;
  const takTahu = isi.filter((x) => x.status === 'tak-diketahui').length;
  if (!isi.length) return 'Tidak ada jenis data yang diperiksa.';
  if (takTahu === isi.length) return 'Tidak bisa diperiksa.';
  const pokok = `${ada} dari ${isi.length - takTahu} jenis data tersimpan`;
  return takTahu ? `${pokok} · ${takTahu} tidak bisa diperiksa` : pokok;
}
