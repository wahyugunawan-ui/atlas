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

/** Tiga jenis data yang bisa dipertanggungjawabkan per periode. */
export const JENIS_DATA = [
  { kunci: 'sales', label: 'Penjualan', field: 'units' },
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
