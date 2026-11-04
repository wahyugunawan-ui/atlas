# Rencana revisi panel dan interaksi ATLAS

**Tujuan:** menyelesaikan daftar revisi memakai data sekarang. Integrasi Excel dan
definisi kontribusi kabupaten terhadap region ditunda sesuai instruksi pengguna.

**Arsitektur:** tetap modul frontend ES yang sama, tanpa dependensi baru atau
perubahan database. Kecamatan asal dealer tetap bermakna lokasi dealer. Filter
Kecamatan peta menjadi pilihan geografis tersendiri, tersinkron dengan panel dan
klik poligon. Ring dipakai sebagai penyaring peta; statistik selalu menyebut basis
perhitungannya dan tidak otomatis berubah menjadi 100% akibat sorotan satu ring.

**Spesifikasi:** daftar revisi dan persetujuan eksekusi dalam percakapan 2026-11-03.
Semua label/komentar Indonesia, pengenal Inggris, angka berhenti di kecamatan,
escape nilai data, PII dan backend tidak diubah.

- [ ] Tes gagal dahulu untuk tren kontribusi, breakdown dealer, pemilihan kecamatan,
  undo, ring sebagai filter, dan panel/menu yang diubah.
- [ ] Tambahkan fungsi murni statistik panel dan sejarah pilihan filter di modul
  yang ada. Undo menyimpan filter, panel terpilih, dan ring; maksimum 50 langkah.
- [ ] Perbarui panel kecamatan: tanpa kode, label kontribusi ke kabupaten, tren %,
  daftar Total Dealer dan Detail ring. Bagian region tetap ditunda.
- [ ] Perbarui summary kabupaten: tanpa kode, daftar dealer + total + kontribusi
  dan rincian ring/pelanggaran. Ringkasan atas mengikuti panel aktif.
- [ ] Sembunyikan Confidence Fusion, ganti analisis wilayah menjadi Statistik Ring
  Dealer, samakan warna marker dealer/pos, dan saring semua lapisan analisis peta
  saat ring dipilih (lapisan referensi basemap tetap sebagai orientasi).
- [ ] Jalankan tes relevan, bangun CSS, uji mutasi dan browser; catat batas tes DB
  bila PostgreSQL belum tersedia. Perbarui PRD/DECISIONS/ROADMAP dengan hasil nyata.

**Fokus pemeriksaan:** pembagi tren bukan total kecamatan sendiri; nol tanpa NaN;
nama dealer berbahaya ter-escape; ring kosong membuat peta kosong; undo tidak
menambah langkah baru atau mengembalikan panel yang salah.
