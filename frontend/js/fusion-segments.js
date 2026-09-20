/**
 * Enam golongan Warlok di sisi layar: nama resmi, label pendek, dan warnanya.
 *
 * Kembaran dari `backend/core/fusion.js` SEGMENTS, dan sengaja dua salinan: aturan
 * proyek ini `frontend/` tidak pernah meng-import dari `backend/`, dan batas itu lebih
 * berharga daripada menghapus enam baris. Yang dijaga supaya keduanya tidak menyimpang
 * adalah `test/fusion-segments.test.js`, yang membandingkan kode dan bobotnya langsung
 * dari kedua berkas — pola yang sama dengan dua salinan haversine di geo.js.
 *
 * WARNA dipakai KONSISTEN di setiap representasi (daftar sidebar, donut, Venn, stacked
 * bar, heatmap). Warna yang berbeda antar-panel untuk golongan yang sama membuat
 * pembaca menghafal dua peta warna sekaligus, dan itu persis yang bikin dashboard
 * terasa sulit tanpa ada yang bisa menunjuk sebabnya.
 */
/**
 * NAMA PENDEK = NAMA PANJANG sejak 2026-09-20 (permintaan tim).
 *
 * Dulu `short` memakai istilah sendiri — 'Warlok', 'Setia Bengkel', 'Pembeli
 * Terverifikasi', 'Warga Terdaftar' — sementara `label` memakai nama resminya. Dua
 * nama untuk satu golongan berarti orang harus menghafal peta istilah sebelum bisa
 * membaca layar, dan dua panel yang menyebut hal yang sama terlihat menyebut hal yang
 * berbeda. `short` TIDAK dihapus: ia tetap jadi tempat memendekkan kalau suatu saat
 * ada layar yang benar-benar tidak muat, dan test/fusion-segments.test.js memang
 * mewajibkannya ada.
 */
export const SEGMENTS = {
  loyal_verified: {
    label: 'Warlok Loyal Verified', short: 'Warlok Loyal Verified', weight: 1.00, color: '#3B82F6',
  },
  service_near: {
    label: 'Warlok bengkel dekat', short: 'Warlok bengkel dekat', weight: 0.80, color: '#EC4899',
  },
  delivery_near: {
    label: 'Warlok kirim dekat', short: 'Warlok kirim dekat', weight: 0.75, color: '#A855F7',
  },
  registered_only: {
    label: 'Warga asli', short: 'Warga asli', weight: 0.55, color: '#94A3B8',
  },
  nomad: {
    label: 'Migran / Nomaden', short: 'Migran / Nomaden', weight: 0.20, color: '#F59E0B',
  },
  unverified: {
    label: 'Tak Terverifikasi', short: 'Tak Terverifikasi', weight: 0.05, color: '#EF4444',
  },
};

/** Warna sumber data, dipakai Venn dan panel Cakupan Sumber. */
export const SUMBER = {
  kirim: { label: 'A · Kirim', color: '#A855F7' },
  servis: { label: 'B · Servis', color: '#EC4899' },
  ktp: { label: 'C · KTP', color: '#38BDF8' },
};
