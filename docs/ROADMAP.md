# Roadmap

Berkas pelacak. Satu tempat untuk menjawab "sudah sampai mana" dan "kenapa berhenti".
Diperbarui tiap akhir sesi kerja. Jangan hapus entri lama — coret atau pindahkan.

Apa yang produk ini harus bisa ada di [PRD.md](PRD.md). Keputusan arsitektur di
[DECISIONS.md](DECISIONS.md).

> **Catatan untuk entri lama.** Sejak 2026-08-17 folder `src/` jadi `backend/` dan
> `public/` jadi `frontend/`. Entri di bawah masih memakai nama lama dan **sengaja tidak
> ditulis ulang** — ini catatan berurut waktu, dan merapikannya berarti memalsukan
> catatan. Struktur yang berlaku sekarang ada di `PRD.md` dan `CLAUDE.md`.

---

## Aturan penamaan

Nama berkas, fungsi, variabel, tabel, dan kolom: **bahasa Inggris**, gaya web
profesional (`camelCase` untuk fungsi/variabel, `PascalCase` untuk class,
`snake_case` untuk kolom database, `kebab-case` untuk berkas frontend dan rute).

Komentar dan dokumentasi: **bahasa Indonesia**. Pesan yang dilihat pengguna juga
Indonesia — penggunanya tim channel Astra, bukan developer.

Istilah wilayah memakai terjemahan resmi BPS supaya konsisten:

| Indonesia | Inggris (dipakai di kode) |
|---|---|
| kelurahan / desa | `village` |
| kecamatan | `district` |
| kabupaten / kota | `city` (kode BPS 4 digit, `34.04`) |
| provinsi | `province` |
| dealer | `dealer` |
| pos / outlet | `outlet` |
| periode | `period` |

---

## Status fase

| # | Fase | Status | Catatan |
|---|---|---|---|
| 0 | Kerangka + logika inti | **selesai** | 4 berkas tes hijau, 15/15 mutasi tertangkap |
| 1 | Login | **selesai** | 6 berkas tes hijau, 15/15 mutasi auth tertangkap |
| 2 | Frontend jadi modul + vendor lokal | **selesai** | 7 berkas tes hijau, nol permintaan keluar |
| 3 | ~~SQLite~~ ~~MySQL~~ PostgreSQL + PostGIS | **selesai** | 2026-08-13, jangkauan dihitung di database |
| 4 | Impor Excel lewat web | **selesai** | 10/11 mutasi tertangkap |
| 5 | Sunting master outlet | **selesai** | pin koordinat, alamat, dan pindah dealer |
| 6 | Bisa dijalankan orang non-IT | **selesai** | `start.bat`, README.md, PINDAH.md |

---

## Sedang dikerjakan

**Penyatuan tiga sumber data (FUSION).** Rancangan lengkap ada di
`docs/FUSION.md`. Tahap A (fondasi), B (resolver nama desa → koordinat),
C (impor Data KTP & Data Servis, plus rute ping pengiriman), D (mesin
penggolongan + ringkasan ke `segment_rollup`), dan E (dua belas rute
`/api/v1/*`) sudah selesai. Yang tersisa tinggal Tahap F: layarnya —
menu Data dengan tiga sub-halaman, tiga jenis titik baru di peta, dan
halaman Confidence Fusion.

**Sudah diuji dengan data sungguhan (2026-09-16).** Data Agustus 2026
diimpor lewat CLI: 19.598 baris KTP dan 186.471 baris Servis. Rantai
A–E terbukti jalan ujung ke ujung — 99,9% desa KTP tercocokkan, dan
`segment_rollup` terisi 11.089 baris dengan Confidence Ratio 55,4%.
Dua cacat ketahuan dan sudah diperbaiki (seluruh kolom tanggal hilang
karena format `'DDMMYYYY`, dan empat kabupaten Jateng dicari di wilayah
kotanya); detailnya di DECISIONS.md. Yang perlu dipahami pembaca
dashboard: pada bulan pertama golongan "Warga asli" mendominasi (93%)
dan itu BUKAN tanda data buruk — servis adalah data seluruh populasi
motor, sedangkan KTP kohort satu bulan.

Halaman Import belum diubah (masih belum ada tombol unggah Data KTP/
Servis), jadi impor berikutnya masih lewat alat lain sampai Tahap F
potongan berikutnya selesai.

Satu bagian rancangan yang SENGAJA ditunda: micro-batch 60 detik untuk
ping realtime (2.2 jalur B). Belum ada produsen ping-nya, jadi yang
ditambahkan sekarang cuma timer latar yang tidak pernah dipakai —
dikerjakan bersama integrasi sistem lapangan. Penggolongan ulang untuk
sekarang dipicu impor bulanan.

Selain itu kosong secara kode — ring dealer (1-3)/coverage pos (1-8), impor Master Dealer &
Pos dari Excel, perbaikan sambungan penjualan bulanan ke dealer, ringkasan
atas Insight jadi kontekstual + grid responsif, perbaikan `offline-html`,
bawaan Opsi Peta (Satelit + live dashboard Performa Pos), DAN kartu
dealer/pos + layout Insight 70/30 + navbar 4 tombol/flyout Master (semua
2026-08-31, lihat enam entri terbaru di **Selesai**) sudah selesai dan 27/27
berkas tes hijau. **Belum diverifikasi visual di browser oleh manusia** —
API dan test suite sudah dicek lewat curl/otomatis (termasuk kolom "Pos
Dealer" Data Konsumen, sudah dikonfirmasi tidak lagi "[object Object]" lewat
query database langsung), tapi klik-per-klik UI belum pernah dicoba di
browser sungguhan: editor ring dealer, editor coverage pos, dua grup Opsi
Peta, tombol quick-access "Edit ring"/"Edit coverage", Master Pos Dealer
(harus 109 baris), Master Dealer ("Jumlah Pos" harus tidak ikut menghitung
78 baris proxy), blok ringkasan atas per skenario filter (kota/dealer/pos)
di berbagai lebar layar, basemap Satelit bawaan, live-scroll Performa
Pos/Penjualan Wilayah yang auto-mulai sendiri, kartu dealer/pos versi baru
di kedua mode peta, grid 70/30 Insight, dan flyout Master. Ini yang paling
perlu dicek berikutnya sebelum dianggap benar-benar tuntas.

**Yang menunggu di luar kode:** 17-18 nama kecamatan di kolom KEC COVER sheet POS
tidak cocok/ambigu (kemungkinan salah ketik sumber, mis. "KALOGONDANG") — lihat
DECISIONS.md untuk daftarnya, menunggu perbaikan Excel + impor ulang dengan
`--no-reset` (supaya penjualan yang sudah ada tidak ikut terhapus).

---

## Belum dikerjakan

### Perluasan cakupan se-Indonesia (butuh migrasi `geography` dulu)

Ditanyakan 17 Agustus: kalau seluruh Indonesia disiapkan sekaligus, masih kuat?
**Kuat — kecuali proyeksinya.** Angkanya sudah diukur, jadi keputusan nanti tidak
perlu menurunkan ulang apa pun.

**Yang tidak jadi masalah:**

| | terukur (8.999) | proyeksi (83.700) |
|---|---|---|
| Tabel `villages` | 50 MB | ~0,45 GB — Postgres santai |
| Tabel `coverage` | 4,9 MB | tidak ikut membesar; ditentukan jumlah POS |
| Berkas peta ke browser | 3,57 MB | tetap 3,57 MB |
| `/api/summary` | 2,31 MB | tetap 2,31 MB |

Dua baris terakhir itu hasil pekerjaan 17 Agustus: browser sudah tidak terikat pada
besarnya database. Menambah Papua tidak menambah satu byte pun ke halaman.

**Penghalangnya: UTM 49S cuma sahih di 108-114 BT.** Jarak 1.000 m yang sebenarnya,
diukur ulang di UTM 49S:

    Yogyakarta  110,4 BT   1.000 m    0,0%
    Jakarta     106,8 BT   1.002 m   +0,2%
    Banjarmasin 114,6 BT   1.002 m   +0,2%
    Makassar    119,4 BT   1.010 m   +1,0%
    Ambon       128,2 BT   1.047 m   +4,7%
    Jayapura    140,7 BT   1.152 m  +15,2%

Radius "5 km" di Papua sebenarnya 5,76 km — dan seperti biasa di proyek ini, tanpa
satu pun error. Poligonnya sah, angkanya keluar, cuma salah.

**Jalan keluarnya sudah diuji:** ganti `geom_m` ke tipe `geography` (sahih di mana
pun). Dampaknya ke angka yang sudah dilaporkan **cuma 0,06 poin**:

    UTM 49S (sekarang)  14,81%
    geography           14,75%

Per kelurahan bisa beda sampai 0,95 poin, tapi di agregat saling menghapus.

**Kenapa belum dikerjakan.** Jaringan dealer Astra ada di Jateng + DIY. Se-Indonesia
menyelesaikan 29 baris pembeli luar provinsi yang secara analitis memang di luar
radius pos mana pun. Unduhannya ~400 MB (perkiraan dari 32 MB untuk 40 kabupaten,
dikali 514 kabupaten se-Indonesia), dan migrasi `geography` adalah perubahan skema
yang perlu diuji ulang menyeluruh.

**Kapan baru perlu.** UTM 49S masih sahih sampai 114 BT — mencakup SELURUH Jawa dan
Bali. Melebar ke Jawa Timur atau Jawa Barat cukup unduh provinsinya lalu
`seed-boundaries` + `export-geo`, tanpa migrasi apa pun. Yang menuntut `geography`
cuma perluasan ke Sulawesi ke timur.

**Yang belum diukur** dan harus diukur kalau migrasi ini dikerjakan: kecepatan
`geography` dibanding UTM planar. Operasi elipsoid biasanya lebih lambat;
`seed-coverage` sekarang 4 detik, belum tahu jadi berapa.

### Sisanya

- **31 nama / 136 baris menunggu dikonfirmasi manusia** di Master Kelurahan &rarr;
  Cocokkan Nama. Alatnya sudah ada dan sarannya sudah dihitung; yang belum adalah
  KEPUTUSANNYA, dan itu memang bukan pekerjaan program. 29 baris sisanya pembeli luar
  provinsi yang sudah diputuskan dibiarkan.
- **Belum ada penjalan migrasi skema.** `schema.sql` cuma `CREATE TABLE IF NOT
  EXISTS`, jadi perubahan tipe kolom hanya berlaku untuk database yang belum ada.
  Ditandai `ponytail:` di `db.js`. Baru mendesak saat ada mesin kedua — dan jadi
  prasyarat kalau migrasi `geography` di atas dikerjakan.
- **HTTPS belum dipakai.** Mekanismenya ada di `index.js` dan menolak start kalau
  sertifikatnya salah tulis; sertifikatnya yang belum ada.
- **Tugas terjadwal jalan saat login, bukan saat komputer menyala.** Untuk server yang
  tidak pernah ada yang login, PostgreSQL dan aplikasi harus jadi Windows service —
  butuh admin sekali, langkahnya di `PINDAH.md`.
- **Belum ada CI, dan Node 20 belum diuji langsung** meski `engines` mengizinkannya.

---

## Selesai

### Spesifikasi FUSION (penyatuan 3 sumber) + fondasi Tahap A (2026-09-16)

Detail rancangan di `docs/FUSION.md`; alasan tiap keputusan arsitekturnya
di DECISIONS.md entri "[2026-09-16] Penyatuan tiga sumber data".

**Selesai dan diuji otomatis (32/32 berkas tes):**
- Spesifikasi teknis lengkap Tahap 2 (skema, pipeline batch + realtime,
  tabel keputusan 6 golongan, KPI Jarak yang dapat dikustom, rumus CW
  Sales/Confidence Ratio/Retention Index, kontrak API, diagram alur) dan
  Tahap 3 (peta multi-layer, halaman Confidence Fusion, peringkat,
  drill-down per Nomor Mesin, mode Live).
- Tahap A fondasi: `backend/core/geo.js` diekstrak dari `coverage.js`
  (haversine tidak lagi punya dua salinan tanpa penjaga), tabel
  `app_config` + `segment_rollup` di database `astra`, dan empat tabel
  penyatuan di database PII `astra_customers`.
- Uji baru: dua salinan haversine (frontend ESM dan backend CJS)
  dibandingkan pada empat pasang koordinat — diuji mutasi, mengganti
  jari-jari bola ke WGS84 menggeser hasil 148 m, jauh di atas ambang.
- Tahap B: `backend/core/village-resolver.js` (murni, tanpa I/O) yang
  mengubah nama Kelurahan/Kecamatan jadi kode wilayah dengan empat status
  (ok/alias/fuzzy/unmatched), `repo.resolveVillageByName()`, dan rute
  `GET /api/v1/wilayah/koordinat` — rute `/v1` pertama di proyek ini,
  rute lama tidak disentuh. Tebakan yang ambigu ditolak, alias manusia
  menimpa segalanya; keduanya diuji mutasi.
- Tahap C: impor Data KTP dan Data Servis (satu mekanisme, dua spesifikasi
  kolom) plus rute ping pengiriman. Kolom dicari lewat judul yang
  dicocokkan PERSIS — berkas KTP punya `No. Mesi` (terpotong) tepat di
  sebelah `No Mesin` yang asli, dan `Alamat`/`Kelurahan` milik dealer
  yang gampang tertukar dengan milik konsumen. Ganda/tanpa nomor mesin
  ditandai dan dilaporkan berikut nomor barisnya, tidak dibuang diam-diam.
  Kolom `imports.source` ditambahkan supaya Riwayat Impor bisa
  membedakan tiga jenis berkas.
- Tahap D: `backend/core/fusion.js` (murni) berisi tabel keputusan enam
  golongan berikut rumus CW Sales dan Confidence Ratio, plus
  `backend/server/fusion-store.js` yang menjalankannya dan meringkas ke
  `segment_rollup`. Penggolongan jalan otomatis sesudah tiap impor, dan
  kegagalannya tidak membatalkan impor. Ketiga kasus batas di
  spesifikasi diuji; tabel keputusannya diuji mutasi (urutan aturan
  ditukar, ambang jadi eksklusif, servis terjauh dipakai — ketiganya
  merah).
- Tahap E: dua belas rute `/api/v1/*` — hasil golongan tersaring,
  metrik per kota dan per dealer (berikut Retention Index), peringkat,
  baca/ubah KPI Jarak, perhitungan ulang, dan drill-down per nomor mesin.
  Yang terakhir itu rute PII: lewat `piiLimiter` dan tercatat di
  `access_log`, sama seperti `/customers`. Ambang warna statusnya diuji
  mutasi (ambang digeser inklusif/eksklusif dan kosakata rasio/retensi
  ditukar — semuanya merah).

- Tahap F potongan 1: menu "Data" (flyout tiga sub-halaman: berdasarkan
  KTP / Lokasi Service / berdasarkan Lokasi Delivery), tab baru
  "Confidence Fusion", dan kerangka ketiga halamannya. Dashboardnya sudah
  menampilkan angka SUNGGUHAN dari `/api/v1/segmentasi` dan
  `/api/v1/peringkat` — KPI, daftar enam golongan, peringkat kota dan
  dealer. Daftar golongan punya dua salinan (frontend/backend) yang
  dijaga tes anti-menyimpang.

- Tahap F potongan 2: donut proporsi golongan di sidebar dan panel
  **Matriks Kota × Golongan** (heatmap 49 kota × 6 golongan, kepekatan sel
  dihitung terhadap nilai terbesar seluruh tabel, kolom terakhir
  Confidence Ratio berwarna status). Rute baru `GET /api/v1/matriks`;
  pivotnya di rute, bukan SQL, supaya menambah golongan ketujuh kelak
  tidak diam-diam menghilangkan kolom. Diverifikasi atas data sungguhan:
  jumlah seluruh baris matriks 19.598 — sama persis dengan total
  segmentasi, jadi pivotnya tidak bocor.

- Tahap F potongan 3: panel **Venn irisan sumber data**, berikut tabel
  `source_overlap` yang menopangnya (dimensi kepemilikan sumber, terpisah
  dari dimensi golongan). Rute baru `GET /api/v1/irisan`. Diverifikasi
  atas data sungguhan dengan rekonsiliasi delapan baris: jumlah seluruh
  region = 19.598 = total segmentasi, dan tiap region cocok persis dengan
  golongannya (Migran 10 terpecah jadi servis-saja 10). Tabel yang sama
  nanti dipakai panel Cakupan Sumber.
- **Bilah filter halaman Confidence Fusion disambungkan** — sebelumnya
  terpasang tapi memanggil semua rutenya dengan `{}`, jadi mengganti Kota
  atau Dealer memuat ulang dan menampilkan angka yang sama persis. Ikut
  memperbaiki cacat keempat dari keluarga "dua kosakata kode dealer":
  menyaring per dealer menghitung **0** konsumen sebelum diterjemahkan,
  **1.032** sesudah (ASTRA MOTOR CENTER YOGYAKARTA, data Agustus 2026).
  Periode rentang diciutkan ke batas atas, dan saringan Pos/Karesidenan
  yang tidak berlaku di halaman ini sekarang dikatakan lewat pita kuning,
  bukan didiamkan. Lihat `docs/DECISIONS.md`.

- Tahap F potongan 4: panel **Cakupan Sumber** — berapa persen pelanggan
  tiap kota (atau tiap dealer, begitu Kota dipilih) yang punya tiap sumber
  data. Ternyata BUKAN cuma menggambar: tabelnya punya kolomnya, tapi tidak
  ada rute yang mengeluarkannya per entitas, jadi `repo.fusionSourceCoverage()`
  + `GET /api/v1/cakupan-sumber` ikut dibuat. Direkonsiliasi atas data
  sungguhan: 57 kota berjumlah 19.598 = total segmentasi, servis 1.292 sama
  dengan angka Venn, dan kota 34.04 berjumlah 2.829 baik lewat daftar per-kota
  maupun per-dealernya (39/39 nama dealer terisi). Lihat `docs/DECISIONS.md`.

- **Halaman Confidence Fusion kosong — diperbaiki.** Dilaporkan pengguna:
  `switchTab()` tidak pernah memanggil penggambar untuk `fusion`, `servis`,
  dan `kirim`, jadi ketiganya cuma terisi kalau filter kebetulan disentuh.
  Rusak sejak potongan 1 dan lolos dari semua tes, karena yang rusak bukan
  modulnya melainkan sambungan antar modul.
- **Filter Pos sekarang dipahami**, dan Peringkat Kota/Dealer akhirnya
  menuruti filter. Pos diterjemahkan jadi daftar kelurahan lewat `coverage`
  saat ditanya (tidak disalin ke rollup, supaya tidak basi waktu cakupan pos
  disunting). `source_overlap` dapat kolom `village_code` + primary key baru
  supaya Venn dan Cakupan Sumber ikut tersaring. Diverifikasi silang: POS
  BUTUH memberi 439 dari 19.598 di `segment_rollup` MAUPUN `source_overlap`.
  Lihat `docs/DECISIONS.md`.

- **Tiga lapisan titik di peta (KTP/Servis/Kirim) + lingkaran KPI Jarak.**
  Toggle baru "Titik Tiga Sumber" di Opsi Peta. Titiknya DISEBAR berbenih
  tetap di dalam poligon kelurahan, karena yang tersimpan adalah centroid
  kelurahan — kalau digambar apa adanya, seribu orang menumpuk di satu
  piksel. Keterangan itu ikut ditulis di layar supaya tidak dibaca sebagai
  alamat. Rute `GET /api/v1/peta/titik` menjawab HITUNGAN per kelurahan,
  bukan koordinat, jadi tidak ada PII yang menyeberang; titik GPS rumah
  sungguhan disisakan untuk telusur per Nomor Mesin yang sudah berpagar PII.
  Data Agustus: 10.373 baris, KTP 19.582 (= 19.598 − 16 tanpa kelurahan),
  servis 1.291, kirim 0. Lihat `docs/DECISIONS.md` untuk dua penyimpangan
  dari spesifikasi yang disengaja.

- **Checkbox pilih-sumber + pencarian di panel Cakupan Sumber.** Tiga
  checkbox (A · Kirim, B · Servis, C · KTP) dan kotak cari. Kendalinya duduk
  di LUAR bagian yang digambar ulang — kalau ikut dibangun ulang tiap
  ketikan, fokus kotak cari hilang setiap huruf. Jawaban server yang terakhir
  disimpan, jadi mencentang tidak menembak permintaan baru. Sekalian
  memperbaiki keputusan diam-diam sebelumnya: bar KTP dulu saya sembunyikan
  sendiri, sekarang jadi pilihan pembaca (mati secara bawaan, dengan alasan
  tertulis). Diuji lewat handler yang sungguhan dengan `document` tiruan;
  5 mutasi, semuanya merah.

- **Telusur satu Nomor Mesin** — panel geser PII di halaman Confidence Fusion:
  identitas, alasan golongan dalam kalimat (jarak nyata vs ambang yang
  TERSIMPAN di baris itu), riwayat servis dan pengiriman, plus diagram
  skematik posisi terhadap lingkaran KPI Jarak. Pintu masuknya kotak cari,
  karena klik-dari-peta mustahil tanpa menaruh nomor mesin di lapisan titik —
  konsekuensi keputusan PII sebelumnya, dan itu benar. Panel mengosongkan
  isinya saat ditutup. Tesnya menemukan bug sungguhan: `Number(null)` = 0
  membuat KTP tanpa koordinat dihitung terhadap khatulistiwa. Lihat
  `docs/DECISIONS.md`.

- **Perbaikan: "terjadi kesalahan di server" saat mengganti Kota/Dealer/Pos.**
  Kolom `city_code`/`dealer_code`/`village_code` ambigu di `fusionRows()`
  karena join ke `villages` dan `dealers`. Ketiga saringan gagal, dan sudah
  rusak sejak filter dinyatakan selesai — verifikasi saya waktu itu memakai
  `fusionTotals()` (tanpa join) dan SQL tulisan tangan, dua-duanya jalur yang
  memang bekerja. Sekarang semua query fusion memakai alias `r` dan semua
  penyusun WHERE memberi awalan `r.`. Dijaga `test/fusion-filter-sql.test.js`,
  tes pertama di jalur ini yang benar-benar menyentuh Postgres.

- **Halaman Fusion jadi grid tanpa gulir + peta sungguhan di dalamnya.**
  Kerangka grid STATIS di index.html dengan slot bernama; `renderFusion()`
  mengisi tiap slot, tidak lagi menimpa satu wadah besar. Itu bukan sekadar
  tata letak: selama halaman digambar dengan satu `innerHTML`, menaruh peta di
  dalamnya mustahil — perubahan filter berikutnya akan mencabut elemen `#map`
  dan mematikan MapLibre. Petanya SATU instance yang dipinjam-pindahkan
  (`pinjamPetaKeFusion`/`kembalikanPeta`), bukan instance kedua. Baris 1:
  Summary · Peta (2 kolom) · Golongan (dua mode: Final/Venn). Baris 2: Matriks
  (2 kolom) · Peringkat kota · Peringkat dealer. Cakupan Sumber jadi tombol.
  Lihat `docs/DECISIONS.md`.

- **Telusur satu mesin digambar di peta sungguhan** — lingkaran KPI Jarak
  berpusat di titik KTP mesin itu, plus garis penghubung ke titik Servis dan
  Kirim, di atas lapisan titik massal. Baru mungkin setelah halaman Fusion
  punya blok peta: sebelumnya panel dan peta ada di dua halaman berbeda.
  Bukan pelanggaran keputusan PII sebelumnya — koordinatnya dari jawaban
  telusur yang sudah berpagar, satu mesin saja, hanya saat dibuka sengaja.
  Jejaknya dihapus saat panel ditutup dan saat pencarian gagal. Lihat
  `docs/DECISIONS.md`.

- **Titik Servis jadi KOTAK** sesuai spesifikasi — penyimpangan yang saya catat
  dua slice lalu, sekarang ditutup. Alasan penundaannya hilang setelah terbukti
  `addLayers()` jalan di dalam `S.map.on('load')`, jadi `addImage()` aman di
  situ. Ikonnya dibangkitkan dari piksel (`ikonKotak()`), bukan berkas gambar.
  `icon-allow-overlap` + `icon-ignore-placement` wajib: tanpa keduanya lapisan
  symbol membuang ikon yang bertumpuk dan ~1.300 titik servis tampak hilang.
  Id lapisan sengaja tetap `servis-titik` supaya toggle dan `redrawMap` tidak
  putus. Lihat `docs/DECISIONS.md`.

- **Saringan Karesidenan dipatuhi halaman Fusion.** Diterjemahkan jadi DAFTAR
  kode kota di sisi layar, bukan dengan memindahkan petanya ke server —
  `KARESIDENAN` punya satu pemilik tunggal di `config.js`, dan menyalinnya
  berarti dua salinan pemetaan yang sama (kelas cacat yang sudah berkali-kali
  muncul di proyek ini). Server memvalidasi tiap kode dengan regex `CITY`,
  mengikuti pola `outlets` yang sudah ada. Kota eksplisit menang atas
  karesidenan. Daftar kota dipasang di KETUJUH penyusun WHERE, dan tes
  database memeriksa ketujuhnya — memasangnya di sebagian saja menghasilkan
  halaman setengah tersaring tanpa satu pun galat.
- **Penciutan rentang periode akhirnya dikatakan.** `fusionFilter` selalu
  membuang batas bawah (rollup per satu bulan), tapi dulu itu cuma tertulis di
  komentar: orang memilih Juni–Agustus, mendapat Agustus, tanpa penjelasan.
  Pita kuning yang tadinya menganggur karena karesidenan sudah didukung kini
  dipakai untuk mengatakannya.

- **Mode Live/wallboard.** Tombol LIVE memutar filter Kota tiap 3,5 detik,
  termasuk kembali ke "Semua"; Dealer ikut direset tiap perpindahan lewat
  aturan eksklusivitas `setScope()`. Berhenti sendiri begitu keluar tab Fusion.
  Beda dari dua mode live yang sudah ada — keduanya cuma menggulir piksel,
  yang ini menembak lima permintaan tiap langkah, jadi ada penjaga agar ketukan
  tidak menumpuk. Versi pertamanya sempat memutus tes lain lewat impor
  `filter-bar.js`; diperbaiki dengan memanggil `syncFilterBar` lewat `window`
  sesuai konvensi yang sudah ada. Lihat `docs/DECISIONS.md`.

- **Halaman Import jadi tiga panel + checklist jenis data per periode.**
  Kiri "Periode Tersimpan" (warna beda, checklist Penjualan/KTP/Servis, klik
  untuk rincian + impor ulang + hapus), tengah progres 4 tahap, kanan "Riwayat
  Impor". Empat kolom, bukan tiga — wizardnya mengambil dua supaya tetap
  lapang. Checklist dibaca dari TABEL DATANYA, bukan dari log impor: periode
  2026-09 tercatat "ok" di log tapi tabel `sales`-nya kosong, jadi log akan
  mencentang data yang sudah tidak ada. Tiga keadaan dibedakan — ada, kosong,
  dan tidak bisa diperiksa (database PII tidak tersedia). Lihat
  `docs/DECISIONS.md`.

- **Dropdown hover menu "Import Data"** dengan tiga opsi yang menggulir ke
  bagiannya (Periode Tersimpan / Proses Impor / Riwayat Impor). Salinan KETIGA
  pola flyout, disengaja: kode ini memuat keputusan eksplisit menolak abstraksi
  bersama, dan rencana refactor saya dibatalkan karena itu. Import juga beda
  sifat — satu halaman tiga bagian, jadi menggulir, bukan berpindah tab. Lihat
  `docs/DECISIONS.md`.

- **Tombol unggah Data KTP dan Data Servis** di halaman Import — kedua rute
  impor itu tidak lagi harus dipanggil lewat alat baris perintah. Alurnya
  SENGAJA terpisah dari wizard 4 tahap: panel hasil tahap 3 khusus penjualan,
  dan memakainya untuk KTP/Servis akan menampilkan field penjualan bernilai
  kosong. Ringkasannya memakai field yang benar-benar dikembalikan server, dan
  menandai selisih dibaca-vs-terpakai supaya baris yang tidak cocok tidak
  lewat diam-diam.
- **Penjaga baru `test/handlers-terikat.test.js`.** Menangkap kelas cacat yang
  sudah dua kali lolos dalam satu sesi: nama didaftarkan di HANDLERS tapi tidak
  pernah di-import app.js, yang berarti ReferenceError saat modul dimuat dan
  SELURUH halaman mati. Dibuktikan: `page.test.js` tetap hijau terhadap cacat
  yang sama. Lihat `docs/DECISIONS.md`.

**Seluruh baris "F. UI" di tabel tahapan `docs/FUSION.md` sekarang sudah
terpenuhi** — menu Data, layer peta baru, halaman Confidence Fusion,
drill-down, dan mode Live. Khusus "layer peta baru", §3.1 meminta tepat tiga
lapisan dan ketiganya ada: `ktp-titik` (isian warna dealer), `servis-titik`
(symbol ikon kotak lewat `map.addImage()`), dan `kirim-titik` (isian kosong,
outline kuning). Di luar spesifikasi ikut ada lapisan radius KPI Jarak dan
empat lapisan telusur satu Nomor Mesin.

Butir ini sempat tertulis sebagai "F UI sisa: layer peta baru" — sudah tidak
benar sejak ketiga lapisan itu jadi. Klaim basi kedua yang ditemukan dengan cara
yang sama: membaca ulang ROADMAP sebelum melaporkan sisa pekerjaan.

- **Filter jadi SAMA di seluruh halaman** (permintaan tim). Membalik keputusan
  2026-08-29 yang memisahkannya per halaman; yang lama tidak dihapus, dan
  `test/filters.test.js` bagian 4 dibalik supaya menjaga aturan baru. Data
  Konsumen kini ikut periode aktif — dulu sengaja tanpa batas periode.
- **Dua subhalaman Data akhirnya berisi.** "Lokasi Service" dan "Lokasi
  Delivery" selama ini cuma panel "belum dibuat" — bukan rusak, memang belum
  pernah dikerjakan. Sekarang membaca `GET /api/v1/servis` dan
  `/api/v1/pengiriman`, dua rute PII berpagar `piiLimiter` + pencatatan akses.
  Diverifikasi: 186.471 baris servis, penjepitan offset benar, tabel
  Pengiriman kosong dan dikatakan demikian.
- **Hapus data per jenis** di panel Periode Tersimpan, konfirmasi ketik ulang
  periode. Pengiriman sengaja tidak bisa dihapus per bulan (tidak punya kolom
  periode) dan tombolnya tidak dirender. Lihat `docs/DECISIONS.md`.

**Belum dikerjakan (sisa Tahap F, lihat tabel tahapan di `docs/FUSION.md`):**
- `deletePeriod()` (hapus periode penuh) masih hanya membuang `sales`,
  `unmatched`, dan `customers` — Data KTP dan Servis bulan itu TIDAK ikut
  terhapus, jadi checklist tetap mencentangnya sesudah "hapus periode".
  Ditemukan waktu membangun hapus-per-jenis; sengaja tidak diperluas diam-diam
  karena memperbesar daya rusak satu rute yang sudah ada adalah keputusan
  tersendiri.
- Cross-filtering penuh di sidebar (mode Live-nya sudah jadi, lihat di atas)
- Jalan ke dropdown "Import Data" untuk layar sentuh — panelnya sekarang hanya
  terbuka saat hover, karena tombolnya sendiri langsung membuka halamannya.
- Kolom periode untuk `delivery_ping` — tanpa itu Data Pengiriman tidak bisa
  masuk checklist "Periode Tersimpan", karena ping tidak bisa diatribusikan ke
  bulan mana pun tanpa mengarang.

### Rebranding ke ATLAS + polesan UI/UX korporat Astra Motor (2026-09-14 malam)

Detail penuh di DECISIONS.md entri "[2026-09-14] Rebranding ke ATLAS +
polesan UI/UX korporat Astra Motor".

**Selesai dan diuji otomatis (27/27 berkas tes):**
- Nama produk resmi berganti dari "Astra Command Center" jadi "ATLAS:
  Astra Motor Geospasial Marketing Intelligence" — package.json, judul
  halaman, README/PRD, dokumen operasional, script, dan pesan konsol.
- Navbar: ikon motor → ikon peta + wordmark "ATLAS / Marketing
  Intelligence"; tombol "Fit" → "Fokuskan".
- Kontrol zoom peta (MapLibre) dipindah dari pojok kanan-atas ke kiri-
  bawah — sebelumnya tertutup panel Opsi Peta yang menempati pojok yang
  sama; bayangan panel-panel di atas peta diperkecil supaya tidak lagi
  terasa "melebihi" kotak peta.
- Aksen merah Astra Motor ditambahkan di navbar (garis bawah) dan tab
  aktif; tombol navy yang sebelumnya diulang manual di 12+ tempat
  disatukan jadi satu class `.btn-primary`.

**SENGAJA TIDAK diganti** (dikonfirmasi user): nama folder Windows
`astra-command-center` (langkah manual diberikan untuk dilakukan sendiri
nanti), nama database `astra`/`astra_customers`, env var `ACC_ENV_FILE`.

**PERINGATAN**: kalau Scheduled Task Windows sudah pernah dipasang dengan
nama lama, harus dihapus manual dulu sebelum menjalankan
`ops/install-tasks.ps1` versi baru — lihat DECISIONS.md untuk detail,
supaya tidak ada dua tugas berjalan berdampingan berebut port.

**Belum:**
- **Verifikasi visual di browser** — kelima perubahan ini murni dari
  audit kode + tiga agen Explore, belum pernah dicoba langsung di layar
  sungguhan.
- **Rekonsiliasi drift lama** antara `<style>` inline `index.html` dan
  duplikatnya di `frontend/styles/app.css` (yang belakangan diketahui
  sudah jadi kode mati untuk aturan custom-nya) — dicatat di DECISIONS.md,
  di luar cakupan sesi ini.

### Revisi lanjutan #3: gaya panel biru di mode biasa, kartu pos/dealer tidak lagi menggulir, block summary baru di strip bawah layar penuh (2026-09-14 malam lanjutan #3)

Detail penuh di DECISIONS.md entri "[2026-09-14] Revisi lanjutan #3: gaya
panel biru dipakai juga di mode biasa, kartu pos/dealer tidak lagi
menggulir, block summary baru di strip bawah layar penuh".

**Selesai dan diuji otomatis (27/27 berkas tes):**
- Gaya "panel biru lengkung" bilah filter (sebelumnya cuma layar penuh)
  sekarang jadi gaya dasar bilah filter di KEDUA mode — satu node DOM yang
  dipindah, bukan dua rule warna terpisah yang harus disamakan.
- Kartu ringkas dealer/pos (strip bawah layar penuh & panel kiri w-96 mode
  biasa) tidak lagi menggulir horizontal — grid sel statnya turun ke baris
  berikutnya sendiri di ruang sempit, bukan dipaksa satu baris.
- Font di panel kiri (rincian dealer/kota/kelurahan) mode biasa dirampingkan
  supaya lebih banyak informasi muat tanpa perlu menggulir.
- Block summary baru ditambahkan di atas strip info dealer/pos (layar
  penuh) — angka yang sama dengan ringkasan atas peta mode biasa,
  sebelumnya hilang begitu masuk layar penuh. Strip info dealer/pos sendiri
  dipersempit (130px→100px) karena kartu 2 barisnya (revisi sebelumnya)
  menyisakan banyak ruang kosong di tinggi lama.

**Belum:**
- **Verifikasi visual di browser** — ketiga revisi ini murni dari audit
  kode + satu agen Explore, termasuk ukuran pas (100px, gap, ukuran font)
  yang belum diukur langsung di layar sungguhan.

### Revisi lanjutan #2: durasi auto-Fit, kartu pos 2 baris, tombol Keluar, gaya bilah filter, layar penuh responsif, sticky Performa mode biasa (2026-09-14 malam lanjutan #2)

Detail penuh di DECISIONS.md entri "[2026-09-14] Revisi lanjutan #2: durasi
auto-Fit, kartu pos 2 baris, tombol Keluar, gaya bilah filter, layar penuh
responsif, sticky Performa mode biasa".

**Selesai dan diuji otomatis (27/27 berkas tes):**
- Animasi auto-"Fit" diperlambat (900ms, sebelumnya 400ms) — sengaja
  dibalik dari niat semula, permintaan eksplisit pengguna supaya "bisa
  dinikmati".
- Kartu ringkas dealer/pos di strip bawah layar penuh (130px) jadi 2 baris
  (judul+subjudul+Tutup di baris 1, semua sel stat di baris 2) — sebelumnya
  satu baris dengan gulir horizontal panjang, khusus pos yang datanya
  banyak (Coverage 1-8 + 3 AVG).
- Tombol "Keluar" (layar penuh) dipindah ke sebelah bilah filter lewat
  relokasi node (`moveExitButton()`), bukan duplikasi — di mode biasa
  tombol yang sama balik jadi "Layar penuh" di posisi semula.
- Bilah filter layar penuh diberi gaya gradasi biru transparan sendiri,
  dibedakan dari kaca putih panel lain dan navy navbar.
- Tata letak layar penuh jadi responsif (satu kolom bertumpuk, CSS `@media
  (max-width: 900px)`) di layar sempit/HP — tanpa tombol show/hide baru.
- Mode BIASA "ANALISIS PERFORMA POS DEALER": ringkasan+sort-by+papan 5
  kelompok sekarang tetap diam, cuma daftar pos yang bergulir — pola yang
  sama seperti sudah diterapkan lebih dulu untuk versi layar penuhnya.

**Belum:**
- **Verifikasi visual di browser** — keenam revisi ini murni dari
  perencanaan Plan Mode + satu agen Explore, belum pernah diklik langsung
  di layar sungguhan (termasuk cek lebar HP untuk item responsif).

### Revisi lanjutan: panel dealer diperluas, auto-Fit, treemap jadi popup, kontras panel, flyout tidak terpotong (2026-09-14 malam lanjutan)

Detail penuh di DECISIONS.md entri "[2026-09-14] Revisi lanjutan: panel
dealer diperluas ke pos/dropdown, auto-Fit, treemap jadi popup, kontras
panel, flyout tidak terpotong".

**Selesai dan diuji otomatis (27/27 berkas tes):**
- Klik marker POS & pilih Dealer/Pos dari dropdown filter (mode biasa)
  sekarang JUGA langsung membuka panel gabungan (sebelumnya cuma klik
  marker dealer).
- Peta auto-"Fit" ke tampilan baru tiap kali filter/scope berubah (reset,
  klik titik, dropdown Kota/Kares/Kabupaten/Dealer/Pos, klik kelurahan) —
  animasi lebih pendek & tanpa toast dibanding tombol Fit manual.
- "Proporsi Penjualan" jadi popup saja (dialog tengah layar, bukan penuh
  layar), dipicu satu tombol di bilah filter — kartu inline dihapus.
- Kontras panel yang melayang di atas peta (Opsi Peta, panel kiri layar
  penuh, rincian kelurahan) dipertegas — sebelumnya nyaris menyatu dengan
  basemap terang.
- **Bug diperbaiki**: flyout "Master" di navbar terpotong oleh pembungkus
  `overflow-x-auto` baris tombol nav — diperbaiki lewat `position:fixed`
  dihitung dari posisi tombol, tanpa menyentuh combobox filter lain.

**Belum:**
- **Verifikasi visual di browser** — kelima revisi murni dari audit kode +
  tiga agen Explore, belum pernah diklik langsung.

### Tujuh perbaikan: scope-bar, kerapatan, navbar+flyout hover, Opsi Peta accordion, dealer detail gabungan, bug auto-scroll (2026-09-14 malam)

Detail penuh di DECISIONS.md entri "[2026-09-14] Tujuh perbaikan: hapus
scope-bar, kerapatan layout, navbar+flyout hover, Opsi Peta accordion,
dealer detail gabungan, bug auto-scroll".

**Selesai dan diuji otomatis (27/27 berkas tes):**
- Blok "Heatmap dihitung terhadap:" dihapus (dua tombolnya duplikat dari
  tempat lain).
- Jarak antar-blok halaman Insight dirapatkan (padding/gap Tailwind).
- Navbar lebih ramping; flyout "Master" bisa dibuka lewat hover (di samping
  klik yang sudah ada), z-index dinaikkan supaya tidak tertutup peta layar
  penuh.
- Opsi Peta jadi 6 grup accordion (`<details>`) dengan status buka/tutup
  awal yang dikonfirmasi user; Batas Wilayah jadi grup sendiri (baru).
- Klik marker dealer di mode BIASA langsung membuka ringkasan + rincian per
  kelurahan dalam satu panel (`#kelurahanDetailPanel`) — sebelumnya perlu
  dua klik. Mode layar penuh tidak berubah.
- **Bug diperbaiki**: auto-scroll Analisis Penjualan Wilayah & daftar
  Analisis Performa Pos (layar penuh) yang tombolnya menyala tapi tidak
  bergerak — akar masalah CSS (elemen yang digulir tidak pernah punya
  tinggi terbatas), diperbaiki lewat struktur flex, bukan ganti target di
  JS. Sekaligus: ringkasan+sort-by Performa Pos sekarang tetap diam,
  cuma daftarnya yang bergulir.

**Belum:**
- **Verifikasi visual di browser** — ketujuh perubahan di atas murni dari
  audit kode statis + tiga agen Explore, belum pernah diklik langsung.
  Perlu dicek terutama: flyout hover (tidak "kedip"), 6 grup accordion
  (status awal benar, semua kontrol masih berfungsi), panel dealer gabungan
  di mode biasa, dan auto-scroll dua panel di layar penuh benar-benar
  bergerak sekarang.

### Peta layar penuh: grid tata letak tetap (kiri/kanan/strip bawah), bukan lagi panel melayang + blur (2026-09-14 sore)

Menggantikan pendekatan entri di bawah ("kotak fokus dinamis" + blur) di
hari yang sama — pengguna kirim mockup eksplisit dan minta tata letak grid
tetap: kolom kiri/kanan tidak melayang, strip info dealer di bawah peta
ukuran TETAP 130px (bukan menyesuaikan isi), tombol Fit/Edit ring pindah
ke pojok kotak peta. Detail penuh di DECISIONS.md entri "[2026-09-14] Peta
layar penuh: dibatalkan jadi grid tetap...".

**Selesai dan diuji otomatis (27/27 berkas tes):** `#map-shell.penuh` jadi
CSS Grid 3 kolom x 3 baris (`grid-template-areas`), panel kiri/kanan/atas/
bawah jadi kolom/baris grid sungguhan (bukan lagi `position:absolute`
melayang), strip info dealer tetap 130px melebar sekolom peta, tombol
Fit/Edit ring/Layar penuh + `#ring-bar`/`#mapError` diberi `grid-area:map`
supaya kotak konteks absolute-nya jadi kotak peta (bukan seluruh layar).
Seluruh sistem blur ("kotak fokus" + `focusBoxInsets()`/`syncFocusBleed()`)
dari entri sebelumnya DIHAPUS. Fit dikembalikan ke padding angka tetap.

**Belum:** Verifikasi visual di browser — terutama strip 130px (muat tanpa
kepotong?) dan posisi tombol di pojok kotak peta.

### Peta layar penuh: kotak fokus dinamis, bug bingkai putih diperbaiki (2026-09-14)

Permintaan pengguna dengan mockup: peta layar penuh dianggap punya "kotak
kosong putih" di pinggir, dan diminta jadi peta penuh layar dengan area
blur ("kotak fokus") di bagian yang bebas panel. Detail penuh di
DECISIONS.md entri "[2026-09-14] Peta layar penuh: hilangkan bingkai
putih, tambah 'kotak fokus' blur, Fit dihitung dari posisi panel
sungguhan".

**Selesai dan diuji otomatis (27/27 berkas tes):**
- Bug bingkai putih di `#map-shell.penuh` diperbaiki (sisa `bg-white
  border shadow-sm` Tailwind yang tidak pernah dilepas untuk state layar
  penuh).
- `focusBoxInsets()` baru (`map.js`) — hitung jarak top/bottom/left/right
  dari posisi panel yang SEDANG tampil, dipakai bareng oleh:
  - `syncFocusBleed()` baru — 4 elemen blur (`.focus-bleed`) menutupi
    bagian bebas-panel di luar kotak fokus.
  - `fitToScope()` — padding `fitBounds()` sekarang objek
    `{top,bottom,left,right}` sungguhan di layar penuh, bukan angka tetap.
- Dipanggil ulang di semua titik yang bisa mengubah panel mana yang
  tampil: `toggleFullscreen()`, `renderAll()`, buka/tutup panel rincian
  dealer/kelurahan, dan resize jendela.

**Belum:**
- **Verifikasi visual di browser** — terutama transisi kotak fokus waktu
  panel kiri berganti isi dan waktu jendela diubah ukuran.

### Kartu dealer/pos di peta diganti metrik kontribusi; navbar 4 tombol + flyout Master (2026-08-31 malam)

Empat permintaan sekaligus, direncanakan lewat Plan Mode (tiga agen Explore
paralel + dua pertanyaan konfirmasi sebelum menulis rencana). Detail penuh
di DECISIONS.md entri "[2026-08-31] Kartu dealer/pos di peta diganti metrik
kontribusi; navbar disederhanakan jadi 4 tombol + flyout Master".

**Selesai dan diuji otomatis (27/27 berkas tes, `npm run css` dijalankan
ulang untuk kelas grid baru):**
- Kartu info dealer/pos (`#kartu-dealer`/`#fs-kartu`, `dealerCardHtml()` di
  `render.js`): trio Total/%dalam/%luar jangkauan (radius lama) diganti
  Pos/AVG Kontribusi/AVG Posisi Relatif/AVG Acuan Bisnis + pecahan %ring
  1/2/3/luar (scope dealer) atau %coverage 1-8 (scope pos, disaring ke
  penjualan pos itu sendiri).
- Blok Analisis Performa Pos Dealer & Analisis Penjualan Wilayah di halaman
  Insight disusun sebaris 2 kolom, porsi 70/30 (`grid-cols-1 xl:grid-cols-10`
  + `xl:col-span-7`/`xl:col-span-3`, stack 1 kolom di bawah `xl`).
- Judul halaman "Insight Distribusi Geospasial / Sebaran penjualan..."
  dihapus.
- Navbar atas dari 6 tombol datar jadi 4 (Insight & Peta, Import Data, Data
  Konsumen, Master) — Master Dealer/Master Pos Dealer/Master Kelurahan
  dipindah ke flyout baru (`toggleMasterMenu()`, gaya `.pilih-panel` yang
  sudah ada, logika buka/tutup sendiri).
- Auto-scroll panel layar penuh peta (Analisis Performa Pos & Penjualan
  Wilayah) yang juga diminta di pesan yang sama — **sudah selesai** dari
  entri di atas ("Bawaan Opsi Peta..."), tidak ada kode baru untuk ini.

**Ditanya balik ke pengguna, dikonfirmasi:** field "Pos" di kartu dealer =
nama pos aktif/jumlah pos (bukan daftar chip, itu dipertahankan terpisah);
item flyout "Master Kecamatan" = halaman "Master Kelurahan" yang sudah ada,
bukan halaman baru.

**Belum:**
- **Verifikasi visual di browser** — kartu dealer/pos di kedua scope &
  kedua mode, grid 70/30 di berbagai lebar layar, dan flyout Master
  (buka/tutup, klik-luar, Escape, highlight submenu aktif) belum pernah
  dicoba langsung. Backend tidak disentuh sesi ini, jadi cukup refresh
  browser (hard refresh) — tidak perlu restart server.

### Bawaan Opsi Peta: Satelit + live dashboard Performa Pos auto-mulai (2026-08-31 malam)

Permintaan eksplisit soal tampilan bawaan waktu halaman dibuka. Sebagian besar
sudah sesuai dari perubahan sesi sebelumnya (nama toggle, status On/Off
kelurahan/kecamatan/kota, titik dealer/pos terpisah, Lingkaran Radius sudah
tidak ada) — dua yang diubah: basemap bawaan jadi Satelit, dan panel Analisis
Performa Pos Dealer kini auto-mulai gulir otomatis (sama seperti Analisis
Penjualan Wilayah yang sudah begitu). Detail di DECISIONS.md entri
"[2026-08-31] Bawaan Opsi Peta saat halaman dibuka...".

**Selesai dan diuji otomatis (27/27 berkas tes):**
- `S.basemap` bawaan `'satelit'`; diterapkan lewat `setBasemap()` di penangan
  `load` peta, di belakang loader.
- `toggleLivePerforma()` dipecah jadi `startLivePerforma()`/
  `stopLivePerforma()`/`autoStartPerforma()`, mengikuti pola `liveWilayah`
  yang sudah ada; `S.livePerformaPaused` state baru.
- `closePerformaFull()` memakai `stopLivePerforma()` langsung (bukan
  `toggleLivePerforma()`) supaya panel normal tetap auto-mulai lagi sesudah
  modal ditutup.

**Ditanya balik, tidak diubah:** warna batas Kecamatan (pengguna pilih tetap
pink `#db2777`); default toggle Titik Pos (tidak disebut di permintaan,
dibiarkan On seperti sebelumnya).

**Belum:**
- **Verifikasi visual di browser** — basemap Satelit benar tampil saat
  halaman dibuka, dan kedua panel live-scroll (Performa Pos, Penjualan
  Wilayah) benar bergulir sendiri tanpa diklik, belum pernah dicoba langsung.

### `npm run offline-html` diperbaiki — `API_STUB` ketinggalan 9 fungsi (2026-08-31 malam)

Pengguna bertanya cara menyimpan progres jadi HTML (fitur `offline-html` yang
sudah ada). Dicoba jalan, gagal: `API_STUB` di `prototype/build-offline.js`
belum tahu 9 fungsi baru yang ditambahkan `api.js` sepanjang sesi ini (ring
dealer/coverage pos, CRUD Master Dealer, impor Master Pos). Detail di
DECISIONS.md entri "[2026-08-31] `API_STUB` di `build-offline.js`
disamakan lagi dengan `api.js` asli".

**Selesai:** 9 stub ditambahkan (`fetchDistricts` resolve kosong, 8 lainnya —
semua aksi tulis — ditolak lewat `tolak()` seperti pola yang sudah ada).
`npm run offline-html` dijalankan ulang dan berhasil: `prototype/astra-offline.html`
11,7 MB. `npm test` tetap 27/27 hijau.

**Belum:** Berkas HTML hasilnya sendiri belum dibuka/diklik di browser oleh
manusia untuk verifikasi visual (editor ring/coverage/dealer di dalamnya
seharusnya menampilkan pesan "tidak bisa dilakukan di berkas demo").

### Ringkasan atas Insight jadi kontekstual per filter + grid responsif (2026-08-31 malam)

Blok ringkasan paling atas halaman Insight (dulu 4 kartu tetap: Dealer Aktif,
Total Penjualan, Kelurahan Terlayani, Kelurahan Kosong) diganti isinya
mengikuti filter aktif (kota/dealer/pos, field beda-beda per level — lihat
DECISIONS.md entri "[2026-08-31] Ringkasan atas halaman Insight jadi
kontekstual per filter"), lalu grid-nya (dipakai bareng panel jangkauan yang
sudah ada) diganti `auto-fill` → `auto-fit` supaya baris dengan sel lebih
sedikit tidak menyisakan ruang kosong di kanan (DECISIONS.md entri
"[2026-08-31] Grid ringkasan: `auto-fill` diganti `auto-fit`...").

**Selesai dan diuji otomatis (27/27 berkas tes):**
- `renderKpi()` (4 kartu statis) dihapus, diganti `renderTopSummary()` +
  `topScopeSummary()` di `frontend/js/render.js`.
- `dealerScopeBaseCells()` baru, dipakai bareng kartu atas dan panel jangkauan
  supaya sel skenario dealer tidak dobel ditulis.
- `frontend/index.html`: markup 4 `.stat-card` diganti satu
  `<div id="ringkas-utama">` kosong; kelas `.stat-card` yang jadi tidak
  terpakai dihapus dari `app.css`, `npm run css` dijalankan ulang.
- `summaryGridHtml()`: `grid-template-columns` ganti kata kunci `auto-fit`.

**Belum:**
- **Verifikasi visual di browser** — belum pernah diklik/dilihat langsung di
  browser sungguhan, termasuk cek tiap skenario filter (kota/dealer/pos) dan
  lebar layar sempit/lebar.

### Outlet "proxy dealer": penjualan bulanan tersambung ke dealer, bukan pos fisik (2026-08-31 malam)

Setelah entri di bawah (Master Pos pindah ke 109 kode fisik), pengguna
mengimpor Excel penjualan bulanan sungguhan — ternyata cuma menyebut identitas
level DEALER, bukan pos fisik, dan kolom "Pos Dealer" di Data Konsumen
menampilkan "[object Object]". Detail penuh di `DECISIONS.md` entri
"[2026-08-31] Outlet 'proxy dealer'...".

**Selesai dan diuji otomatis (27/27 berkas tes):**
- **Bug nyata diperbaiki**: `readXlsx()` di `importer.js` tidak pernah membuka
  sel formula ExcelJS (cuma rich-text) — kolom nama dealer di Excel sungguhan
  berisi VLOOKUP, jadi setiap nama "baru" tertulis "[object Object]" ke
  database. `backend/core/excel-coords.js` `cellText()` diperluas menangani
  formula DAN rich-text sekaligus; `importer.js` memakainya.
- Skema: `dealers.legacy_code` (kode "Kode Dealer" numerik) dan
  `outlets.is_dealer_proxy` (penanda baris yang mewakili dealer, bukan pos
  fisik) — dua kolom baru, `ALTER TABLE ADD COLUMN IF NOT EXISTS`.
- `scripts/import-dealer-pos-rings.js`: Fase D baru (upsert baris proxy per
  dealer — sekaligus memperbaiki baris "[object Object]" yang sudah terlanjur
  ada), flag `--no-reset` (perbaiki tanpa membuang sales/customers yang sudah
  diimpor), kolom Kel/Kec sheet POS sekarang dipakai mempertajam pencocokan
  kecamatan coverage.
- Backend: `listDealers()` "Jumlah Pos" tidak lagi ikut menghitung baris
  proxy; `summary()` mengirim penanda proxy ke frontend.
- Frontend: `S.realOutlets` (katalog pos fisik saja) dipakai Master Pos
  Dealer & dropdown filter Pos; `S.outlets`/`S.outletByCode` TETAP penuh
  (dipakai resolusi nama & filter konsumen per dealer).
- Perbaikan sampingan: `scripts/export-geo.js` di folder proyek aktif
  ternyata ketinggalan perbaikan `kota.geojson` 404 DAN pembersihan
  `tulisKelurahanRing()` dari sesi sebelumnya (sempat dikerjakan di lokasi
  folder yang salah) — dua-duanya disamakan sekarang.
- Dijalankan terhadap database sungguhan: 78 baris proxy diperbaiki, 1 baris
  dealer "hantu" (`OBJECTOBJECT`) dihapus, 9.949 baris `sales` dan 18.9xx
  baris `customers` yang sudah diimpor tidak tersentuh sama sekali.

**Belum:**
- **Verifikasi visual di browser** — lihat catatan di "Sedang dikerjakan".
- 17-18 nama kecamatan coverage masih tidak cocok (typo sumber, lihat
  DECISIONS.md).
- Sistem input penjualan PER-POS (bukan per-dealer) belum ada — direncanakan
  setelah format database ini dianggap final oleh tim.

### Ring dealer (1-3) & Coverage pos (1-8) menggantikan ring per pos+kelurahan, impor Master Dealer/Pos dari Excel (2026-08-31 sore)

Membalik arah keputusan pagi harinya di entri di bawah ("ring per desa") — bukan
pembatalan, evolusi: ring naik level ke DEALER (kecamatan cocok untuk cakupan
sebesar itu), POS mendapat konsep baru coverage (kecamatan, 8 slot). Detail penuh
di `DECISIONS.md` entri "[2026-08-31] Ring pindah ke DEALER+kecamatan, Coverage
baru milik POS (1-8)".

**Selesai dan diuji otomatis (26/26 berkas tes):**
- Skema: `outlet_rings` dihapus total, diganti `dealer_rings` + `pos_coverage_district`.
- Backend: `saveDealerRings`/`allDealerRings`, `savePosCoverage`/`allPosCoverage`,
  rute `PUT /dealers/:code/rings` dan `PUT /outlets/:code/coverage`.
- Frontend: editor ring/coverage digeneralisasi satu mesin (`rings.js`
  `createGroupEditor`), peta pakai layer `kec-isi` baru (bukan lagi `kel-ring-*`),
  Opsi Peta dapat dua grup ("Tampilan Ring Dealer", "Tampilan Coverage POS")
  aktif/nonaktif ikut scope. Agregasi dealer dapat pecahan Ring1/2/3/Coverage
  gabungan (ring menang kalau tumpang tindih); agregasi pos dapat pecahan Coverage
  1-8. Master Dealer dapat 3 kolom Ring baru; Master Pos kehilangan 3 kolom Ring,
  dapat 1 kolom Coverage ringkas.
- Skrip baru `scripts/import-dealer-pos-rings.js`: Master Dealer (78, dari sheet
  "Dealer"), Master Pos (109, dari sheet "POS", level FISIK — menggantikan skema
  lama yang levelnya cabang), ring dealer (dari "Ring dealer.xls", format biner
  lama, dibaca dependency baru `xlsx`/SheetJS), coverage pos (dari kolom KEC COVER
  1-8 sheet POS). Hasil bersih: 78/78 dealer, 109/109 pos, 1.361 baris ring, 610
  baris coverage (17 kecamatan sumber tidak cocok, dilaporkan bukan dibuang).

**Belum:**
- **Verifikasi visual di browser** — lihat catatan di "Sedang dikerjakan" di atas.
- Data penjualan kosong (reset saat migrasi kode pos) — perlu impor ulang lewat
  Import Data dengan 109 kode pos baru.
- 17 kecamatan tidak cocok di sumber Excel (lihat DECISIONS.md) — perlu perbaikan
  manual di Excel lalu impor ulang.
- `xlsx` (SheetJS) punya kerentanan HIGH tanpa perbaikan di registry npm — dampaknya
  kecil (skrip CLI sekali-jalan, bukan bagian server), tapi belum dipantau berkala.
- Tidak ada tes otomatis untuk `import-dealer-pos-rings.js` sendiri (beda dari
  `fill-pos-coordinates.js` yang punya test-nya) — baru diverifikasi manual.

### Permintaan Pakbos: Kares, ring per desa, blok Performa dirombak, peta dirapikan (2026-08-31)

Dua putaran permintaan langsung Pakbos, dikerjakan sekaligus karena saling terkait
(ring pindah level mengubah blok Performa; filter Kares dan eksklusivitas kota/
dealer/pos sama-sama menyentuh `filters.js`). Detail keputusan arsitekturnya ada di
`DECISIONS.md` (lima entri baru 2026-08-31) — di sini cuma daftar apa yang berubah.

**Selesai dan diuji otomatis (26/26 berkas tes, termasuk kasus baru):**
- Filter Provinsi → **Kares** (3 pilihan tetap: Yogyakarta/Banyumas/Kedu), kota di
  luar 14 kab/kota gabungan disembunyikan dari dropdown Kota (cascading).
- Kota/dealer/pos **dibalik jadi eksklusif** (membatalkan keputusan 2026-08-30 —
  lihat DECISIONS.md untuk kenapa).
- Ring layanan pos pindah dari **kecamatan ke desa/kelurahan** (`outlet_rings.
  village_code`), data lama dihapus total. Poligon edit ring baru
  (`kelurahan-ring.geojson`, diekspor `scripts/export-geo.js`) — ~3,2 MB, TERNYATA
  bukan masalah ukuran seperti dikhawatirkan sebelumnya.
- Blok **Analisis Performa Pos Dealer** dirombak: pindah ke baris penuh di bawah
  Proporsi Penjualan, satu baris satu pos, metrik radius diganti %ring 1/2/3/luar-
  ring, ditambah %Sales Contribution + Kelompok Relative Position + Kelompok
  Business Reference (semua relatif terhadap total seluruh pos yang tampil), board
  ringkas 5-kelompok, dan dua kriteria sort (total sales / peringkat per ring) yang
  jalan di panel biasa, layar penuh peta, dan tampilan besar.
- Titik **dealer baru** di peta (koordinat dari `Dealer & POS (dgn koordinat
  dealer).xlsx`, sekarang di 51/52 dealer lewat `scripts/import-dealer-coordinates.js`
  — jalankan `node scripts/import-dealer-coordinates.js` lagi kalau Excel-nya
  diperbarui), lengkap dengan jalan pintas Edit Ring dari titik dealer.
- Legenda peta: istilah "Dynamic/Static Relative Tiering", "No Sales", "bottom...top"
  (HANYA di legenda, badge Terbawah...Teratas di tempat lain tidak berubah), mode
  Static disederhanakan 6→5 kelas, dan mode heatmap otomatis ikut filter Kota (masih
  bisa diganti manual).
- Popup treemap Proporsi Penjualan (tampilan lebih besar, edge-to-edge).
- Opsi Peta: "Batas dan Nama Kelurahan/Desa" (gabung dua toggle lama), "Batas dan
  Nama Kecamatan" (pink, lepas total dari mode edit ring), "Batas dan Nama Kota"
  (baru, ada label kota sekarang), "Titik Dealer"/"Titik Pos" (dipisah), default
  Titik Penjualan ON dan Lingkaran Radius OFF (dibalik dari sebelumnya). Batas mode
  edit ring jadi kuning tebal, layer terpisah dari batas kecamatan referensi.

**Sudah diverifikasi manual di browser** (user memberi sandi login, dites lewat
Playwright sungguhan terhadap server yang sudah direstart dengan kode terbaru):
Kares + cascading Kota, eksklusivitas kota/dealer/pos, board 5-kelompok, sort by
ring + label peringkat, legenda Dynamic/Static + auto-switch + override manual,
titik dealer (51) & pos (78) di peta, alur Edit Ring dari titik dealer (dealer 1-pos
langsung masuk mode edit; dealer multi-pos — dicoba NUSANTARA SAKTI 8 pos —
memunculkan pemilih), klik desa TANPA riwayat penjualan dalam mode edit ring tetap
menampilkan namanya (bukan kode mentah), batas ring kuning tebal di semua ~9.000
desa, Master Pos Dealer tidak error dengan kolom ring baru (semuanya "—", sesuai
keputusan mulai kosong).

**Dua bug ditemukan dan diperbaiki selama verifikasi** — dicatat supaya tidak
terulang: (1) `frontend/css/app.css` (build output Tailwind) belum di-`npm run css`
ulang sesudah kelas `grid-cols-5` dipakai pertama kali di template literal JS —
board 5-kelompok tampil sebagai daftar bertumpuk, bukan 5 kolom, sampai build
dijalankan ulang; (2) `S.performanceCriteria` default salah ketik `'percent'`
(sisa dari draft awal, seharusnya `'units'`) — sortnya tetap jalan benar (fallback
ke units di `sortPerformance`), tapi tombol kriterianya tidak ada yang menyala di
tampilan awal.

### Ringkasan kontekstual per filter, Radius diganti Tampilkan Ring (2026-08-31, putaran keempat Pakbos)

Datang lagi mid-sesi lewat pesan baru. Detail keputusan di `DECISIONS.md` (dua entri
baru). Kali ini SEMPAT di-`git commit` dulu sebelum dikerjakan (checkpoint atas
permintaan user) — commit `08ba74d` menandai akhir putaran ketiga.

- Ringkasan "Dalam radius X km" di atas daftar Performa Pos Dealer GANTI TOTAL jadi
  tiga bentuk menurut filter aktif: Kota/Semua (jumlah desa, total sales, AVG
  kontribusi, AVG posisi relatif), Dealer (+jumlah pos dealer, +AVG acuan bisnis),
  Pos (total penjualan + jumlah desa & %kontribusi per ring 1/2/3). Diverifikasi
  langsung di browser untuk ketiga mode + mode Semua.
- "Radius jangkauan" (3/5/7/10 km) dan "Lingkaran Radius" di Opsi Peta DIHAPUS BERSIH
  (bukan disembunyikan) — diganti "Tampilkan Ring 1/2/3" yang menyorot desa milik pos
  terpilih, berbagi lapisan peta dengan mode edit ring. Diverifikasi: penetapan ring
  sungguhan (dicoba isi manual satu desa lewat `openRingChooser`/`assignRing`/
  `saveRingEdit`, tersimpan ke database, lalu dihapus lagi sesudah diverifikasi supaya
  data ring tetap kosong sesuai keputusan Bagian D) langsung muncul di ringkasan Pos
  DAN di tombol Ring yang bisa disorot — jalur ujung-ke-ujung (assign -> simpan ->
  baca lewat scopeSummary DAN paintRingView) sudah terbukti nyambung.
- `S.radiusM`/`splitByCoverage`/`coverage.js` SENGAJA tidak disentuh (masih dipakai
  kartu rekap dealer & tooltip kelurahan) — sekarang diam-diam terkunci 5 km karena
  pemilihnya sudah tidak ada. Kalau dua tempat itu nanti juga perlu ganti ke ring,
  itu permintaan baru, bukan bagian dari yang dikerjakan di sini.

### Blok baru Analisis Penjualan Wilayah, ikon dealer segitiga (2026-08-31, putaran ketiga Pakbos)

Datang mid-sesi lewat pesan baru waktu verifikasi putaran kedua sedang berjalan.
Detail keputusan di `DECISIONS.md` (dua entri baru).

- Blok baru **Analisis Penjualan Wilayah** — satu baris satu DESA (nama, kecamatan/
  kota, total sales, %kontribusi, posisi relatif), basis kontribusi relatif terhadap
  `activeRows()` apa adanya (otomatis jadi "relatif dealer/pos yang difilter" waktu
  itu aktif). SELALU tampil di halaman biasa (bawah Performa Pos Dealer); di layar
  penuh peta GANTI TEMPAT dengan Performa Pos Dealer tergantung filter (dealer/pos →
  Wilayah, kota/semua → Performa) — satu slot, dua grup toggle.
- Auto-loop SENDIRI (bukan tombol Live manual) — mulai begitu ada isinya, tombol
  Pause menghentikan. Diverifikasi: pause/resume ganti ikon dengan benar, panel
  benar-benar tergulir sendiri (ketangkap kamera di tengah animasi gulir).
- Titik dealer di peta jadi **segitiga** (`clip-path`), bukan lingkaran — beda jelas
  dari titik pos yang tetap bulat. Diverifikasi visual di screenshot.
- Sekalian diperbaiki: bug tersisa dari verifikasi putaran kedua —
  `map.js` sempat memanggil `openRingChooser` dengan 3 argumen (kode, NAMA dari
  properti fitur geojson, event asli) tapi `rings.js` belum menerima argumen nama
  itu, jadi `event` di dalam fungsi salah menerima string bukan MouseEvent. Sudah
  diperbaiki DAN diverifikasi manfaatnya: nama desa tanpa riwayat penjualan sekarang
  benar-benar tampil (sebelum perbaikan ini ditulis, belum pernah ada baris yang
  bisa membuktikannya).
- Diuji otomatis: `test/sales-stats.test.js` (kasus `contributionsByVillage`,
  `contributionsByOutlet` lama dipastikan tidak berubah perilaku sesudah
  di-refactor jadi pemanggil `contributionsByField`), `test/page.test.js` (id
  markup baru, auto-loop dua-state, panel-switching layar penuh).

### Panel wilayah jadi 4 blok: Overview, Sales, Distribution, Business Reference (2026-08-30)

Permintaan tim: rombak panel info kelurahan/kota/dealer jadi 4 blok berjenjang
(Identitas Wilayah → Actual Sales → Sales Contribution → Relative Sales Position →
Business Reference), dengan dua mode heatmap dan benchmark bisnis yang bisa
dikonfigurasi. Spesifikasi aslinya ditulis untuk WebGIS generik (menyebut
"OpenSearch" untuk batas wilayah, mengasumsikan infrastruktur admin/audit-log yang
tidak ada di sini) — sebelum menulis rencana, kodenya diaudit dulu: heatmap
TERNYATA sudah persentil-based (`colors.js`), tapi filter kota/dealer/pos berbagi
satu slot (mutually exclusive), dan tidak ada tabel/klasifikasi kontribusi %
sama sekali. Lima bagian, lima commit, tiap bagian lulus tes penuh sebelum lanjut.

**1. Filter jadi tiga slot independen (`21c8787`).** `cityCode`/`dealerCode`/
`outletCode` masing-masing slot sendiri di `S.filters[page]`, di-AND-kan — bukan lagi
`scopeKind`/`scopeCode` tunggal yang saling menghapus. Digeneralisasi ke pos juga
(bukan cuma kota+dealer yang diminta): mengecualikan satu dari tiga field lebih
rumit daripada memperlakukan ketiganya seragam, dan polanya sudah ada dari
`province` yang independen sejak awal. `clearScope(kind)` sekarang bisa
menargetkan satu slot saja — empat pemanggil lama diperbaiki sesuai maksud
aslinya (tiga di antaranya ternyata cuma bermaksud melepas satu slot, bukan
mereset semuanya). Diverifikasi: pilih kabupaten DAN dealer sekaligus, keduanya
tetap aktif, dan mengganti salah satu benar-benar mengubah angka (bukti AND
sungguhan).

**2. `sales-stats.js` + config Business Reference (`951bfd0`).** Modul murni baru,
gaya sama dengan `colors.js`: `contributionPercent`/`contributionsForRows`
(kontribusi % kelurahan terhadap total KOTANYA SENDIRI, bukan global),
`relativePosition` (bungkus `percentileBreaks`/`classOf` yang SUDAH ADA, label
baru Terbawah/Bawah/Tengah/Atas/Teratas), `fixedContributionClass` (6 kelas
interval tetap dari spek), `referenceGap`/`referenceRatio`. `businessReferencePercent`
baru di `config.js` (`BUSINESS_REFERENCE_PERCENT`, default 1%, env var biasa —
bukan rahasia), dikirim lewat `summary()`. Tanpa UI admin atau audit log —
keputusan "config sederhana", lihat DECISIONS.md.

**3. Panel kelurahan jadi 4 blok (`0f19e79`).** `openVillageDetail()` dirombak:
kartu ringkas 4 angka di atas (Total, Kontribusi, badge Posisi Relatif, Acuan
Bisnis), grafik tren bulanan ApexCharts (kalau rentang periode aktif >1 bulan dan
ada datanya — kalau tidak, "Data belum tersedia atau filter cuma satu bulan"),
blok Distribution (Peringkat X/Y di kota, Rata-rata Kota) di atas daftar
"Penjualan per Pos" yang sudah ada, blok Business Reference (Selisih/Rasio
terhadap acuan) di bawahnya. Panel dilebarkan w-80 → w-96. Konsumen dan tautan
"kembali ke dealer" tidak berubah, cuma posisinya bergeser.

**4. Panel ringkasan kota (baru) + kartu ringkas dealer (`96355c5`).**
`openCitySummary(cityCode)` baru, dipicu dari dropdown Kabupaten waktu tidak ada
kelurahan spesifik aktif. `openDealerDetail()` dapat baris ringkas gaya sama di
atas breakdown kota→kelurahan yang sudah ada. `renderAll()` diperluas:
`S.panelView.kind === 'city'` digambar ulang seperti `'dealer'` yang sudah ada,
plus aturan baru — kelurahan yang sedang terbuka jadi di luar filter kota aktif →
panel berganti jadi ringkasan kota itu. Panel yang ditutup manual tetap tertutup
(tidak ada logika "selalu tampil selama filter aktif" yang membukanya lagi sendiri).

**5. Peta ganti default + dua mode heatmap (`107e624`).** `paintChoropleth()`
tidak lagi mewarnai dari unit mentah — sumbernya sekarang Kontribusi Penjualan.
**Ini perubahan visual nyata terhadap peta yang sudah dipakai tim sehari-hari,
dikonfirmasi dan disetujui, bukan efek samping.** Toggle baru di panel Opsi Peta:
"Per Peringkat Relatif" (bawaan, mesin persentil yang SAMA dengan sebelumnya, cuma
input beda) dan "Per Nilai Kontribusi" (6 kelas interval tetap dari spek).
`classRanges()` dapat parameter formatter opsional (backward-compatible) supaya
legenda bisa menampilkan label persen.

**Tes**: dari 24 jadi 26 berkas hijau (`business-reference.test.js`,
`sales-stats.test.js` baru; `filters.test.js`, `colors.test.js`, `coverage-store.test.js`
diperluas). Semua logika baru diuji mutasi.

**Diverifikasi di browser terhadap data production sungguhan** di tiap bagian —
bukan cuma `npm test`. Contoh: kelurahan Pondokrejo (Sleman) → kontribusi 0,09%,
posisi Terbawah, acuan 9% dari 1%, selisih -0,91 poin — cocok hitungan manual.
Kabupaten Sleman → 86 kelurahan, kontribusi rata-rata 1,16%, distribusi ~17/kelompok
(seperlima dari 86, sesuai kuantil). Mode heatmap: kedua mode menghasilkan warna
dan legenda yang berbeda dan konsisten dengan angka aslinya.

**Sengaja di luar cakupan** (sesuai penutup spek sendiri): Market Potential, Sales
Gap, Coverage Gap, Opportunity Score, Recommended Action — tahap berikutnya, bukan
bagian dari 4 blok ini. Audit log perubahan Business Reference dan UI admin untuk
mengubahnya — di luar cakupan sesuai keputusan "config sederhana".

### Master Dealer terpisah dari Master Pos, impor massal pos, skrip koordinat (2026-08-30)

Dipicu oleh `Dealer & POS_.xlsx` dari AHM. Audit sebelum mulai (dicatat di rencana,
bukan tebakan): sheet "Dealer" (78 baris) sudah 100% identik dengan `outlets` — nol
yang perlu diubah hari ini. Sheet "POS" (109 baris) pakai kode internal AHM yang lebih
rinci dari `outlet_code` kita, jadi cuma dipakai mengisi koordinat kosong, bukan
menggantikan `outlets`. Lima bagian, lima commit, tiap bagian lulus tes penuh sebelum
lanjut ke berikutnya.

**1. Tabel `dealers` + FK.** `dealer_code`/`dealer_name` di `outlets` tadinya cuma
string yang DIDUPLIKASI, tidak ada master sungguhan. Tabel `dealers` baru + FK
`NOT VALID` (aman untuk 79 outlet lama yang belum pernah divalidasi — `schema.sql`
jalan tiap server start, termasuk di production yang sudah punya isi) +
`scripts/backfill-dealers.js` yang mengisinya sekali dan memvalidasi FK-nya. Sekalian
memperbaiki `runSchema()`: splitter lama memecah blok `DO $$...$$` di tengah karena
tidak mengerti dollar-quoting — `ADD CONSTRAINT` di skema ini tidak akan pernah jalan
tanpa perbaikan itu. Dijalankan terhadap `C:\astra-data`: 52 dealer diisi dari 79
outlet, FK tervalidasi, nol anomali nama bercabang.

**2. `resolveDealer()` pindah sumber + CRUD dealer.** Pencarian nama dealer pindah
dari menebak-nebak `outlets` ke membaca `dealers` langsung, dan meng-upsert baris
`dealers` untuk kode manapun yang ditulis ke `outlets.dealer_code` — wajib begitu FK
aktif. Tiga jalur tulis diperbaiki: `resolveDealer()` sendiri, jalur `patch.dealerCode`
langsung di `updateOutlet()` (skrip/tes), dan `resolveGroups()` di `importer.js` untuk
outlet baru hasil tebakan impor bulanan. `listDealers`/`createDealer`/`updateDealer`/
`deleteDealer` di `repository.js` + rute `/api/dealers`. Kode dealer sendiri tidak
pernah bisa diedit manual (selalu turunan `toDealerCode()`); hapus ditolak selama
dealer masih punya pos; rename ditolak kalau namanya sudah dipakai dealer lain;
koordinat dealer divalidasi tanpa batas wilayah peta (`cekKoordinatBebas`) — kantor
pusat dealer boleh di luar DIY+Jateng.

**3. Halaman Master Dealer.** Tab baru, tabel Kode | Nama | Alamat | Koordinat |
Jumlah Pos | Aksi, CRUD lengkap. `S.dealerNames` sekarang dari `data.dealers`, bukan
ditebak dari `S.outlets` — dealer baru yang belum punya pos ikut muncul di dropdown
"Dealer induk" pada editor pos.

**4. Impor massal pos dari Excel.** Tombol "Impor dari Excel" di Master Pos: baca
sheet "Dealer", diff per field (`backend/core/pos-diff.js`, murni), pratinjau
eksplisit + satu tombol "Terapkan Perubahan" — TIDAK ada auto-apply diam-diam, sesuai
keputusan tim. Beda dari impor penjualan bulanan (yang sengaja tidak menimpa kurasi
dealer/koordinat): impor ini MEMANG dimaksudkan menimpa nama/alamat pos kalau beda
dari Excel. Kode pos yang belum ada di database cuma dilaporkan (`added`), tidak
pernah dibuat — sheet ini tidak punya dealer induk untuk dijadikan outlet baru yang
valid. Token pratinjau di memori proses, kedaluwarsa 1 jam. Kunci sekali-jalan yang
tadinya privat ke `importer.js` dipindah ke `backend/server/import-lock.js` supaya
commit pos dan impor bulanan saling menolak lewat kunci yang sama — keduanya menulis
`outlets`.

**5. `scripts/fill-pos-coordinates.js`.** Baca sheet "POS", kelompokkan per Kode AHM
Dealer (= `outlet_code` kita), kandidat pertama mengisi `lat`/`lng` yang MASIH KOSONG
(`AND lat IS NULL` di UPDATE-nya sendiri, bukan cuma dicek di JS), sisanya + baris
yang gagal diparse dilaporkan penuh — bukan cuma angka.

**Diverifikasi di browser terhadap data sungguhan** (bukan cuma `npm test`): tambah
dealer, edit alamat, hapus yang kosong, hapus yang masih punya pos ditolak dengan
pesan yang benar. Sheet "Dealer" `Dealer & POS_.xlsx` menghasilkan pratinjau NOL
perubahan — bukti hidup diff-nya benar. Satu perubahan uji diterapkan lalu
dikembalikan lewat alur "Terapkan Perubahan" yang sama. `fill-pos-coordinates`
dijalankan terhadap database production: cuma `DEMO-01` (baris demo) yang belum punya
koordinat, tidak ada di sheet POS, dilaporkan — tidak ada yang ditulis.

**Tes**: 24/24 berkas hijau (naik dari 19). Berkas baru: `dealers-schema`,
`dealers-crud`, `pos-diff`, `pos-import`, `fill-pos-coordinates`. Semua logika baru
diuji mutasi. Satu pengecualian dicatat eksplisit sebagai `ponytail:` di kodenya:
jendela balapan `AND lat IS NULL` di `fill-pos-coordinates.js` tidak disimulasikan
tesnya (butuh mock `store.run` untuk menyuntik tulisan konkuren) — jalur non-balapan
sudah teruji lewat `SELECT ... WHERE lat IS NULL` yang mendahuluinya.

**Belum dikerjakan / sengaja di luar cakupan**: pos baru dari sheet POS/Dealer tidak
pernah dibuat otomatis (butuh dealer induk, tidak ada di kedua sheet); tidak ada alur
"pindahkan pos dulu" otomatis waktu hapus dealer yang masih terisi.

### Bilah filter dipadatkan supaya muat satu baris (2026-08-30)

Diminta tim: bilahnya melipat jadi dua baris di layar mereka, dan mereka mau ukurannya
diperkecil supaya pas. Sebelumnya sudah dibuat muat satu baris di layar penuh; ini
menyelesaikannya untuk mode biasa juga.

Diukur di browser: seluruh bilah **990 px**, sementara layar tim ~980 px — meleset
tipis, dan satu piksel kelebihan sudah cukup membuatnya melipat.

Yang dipangkas cuma jarak dan tinggi, bukan isinya:

| | sebelum | sesudah |
|---|---|---|
| Tinggi pil dan kotak bulan | 32 px | 28 px |
| Jarak di dalam pil | 8 px | 6 px |
| Jarak antar kendali | 10 px | 8 px |
| Padding bilah | 16/24 px | 12/16 px |
| Nilai pil | 13 px, maks 170 px | 12 px, maks 140 px |

Label sumbu (`PROVINSI`, `KABUPATEN`, …) dan nilainya tetap utuh — itu yang membuat
pilnya terbaca sekali lihat, dan memangkasnya berarti membuang hal yang jadi alasan
bentuk pil ini dipilih.

Hasilnya **865 px** dan tinggi bilah 49 px jadi 41 px. Diperiksa di beberapa lebar:
tetap satu baris sampai 880 px, dan di 700 px melipat dengan rapi tanpa memaksa halaman
menggulir mendatar.

**Tes**: 19/19 hijau. Tiga mutasi tertangkap — tinggi pil, tinggi kotak bulan, dan jarak
antar kendali yang dikembalikan. Yang dijaga ukurannya, bukan hasil ukurnya: gejalanya
baru terlihat di layar yang lebih sempit dari layar yang dipakai mengetes.

### Dropdown terpotong di layar penuh — penyebab yang sebenarnya (2026-08-30)

Dikejar tiga kali; dua yang pertama ke arah yang salah. Ditulis lengkap karena yang
berharga di sini bukan perbaikannya (satu selektor), tapi kenapa dua tebakan sebelumnya
masuk akal dan tetap salah.

**Tebakan 1 — ruang di bawah kurang.** Panelnya dibuat mengikuti ruang yang tersedia dan
membuka ke atas kalau perlu. Perbaikan yang benar pada dirinya sendiri, tapi bukan ini.

**Tebakan 2 — `backdrop-filter` di atas kanvas WebGL.** Masuk akal, tidak bisa
direproduksi di sini, dan tetap dikerjakan karena latar padat lebih terbaca. Bukan ini
juga.

**Penyebab sebenarnya, terlihat dari DevTools yang dikirim tim:** badge `scroll` di
`#fs-filter-host`. Aturan `#map-shell.penuh .map-panel { overflow-y: auto }` memberi
tiap panel melayang gulirannya sendiri waktu layar penuh — masuk akal untuk panel berisi
daftar, dan **salah untuk rumah bilah filter**: dia cuma wadah, dan `overflow` di situ
memotong dropdown yang membuka ke bawah tepat di batas kotak bilahnya.

Kenapa tidak pernah ketahuan: semua pemeriksaan sebelumnya dilakukan di mode **biasa**,
dan bug-nya cuma ada di mode **layar penuh**. Foto pertama dari tim juga mode biasa —
yang di situ memang masalah lain (panel kelurahan menutupi tombol). Baru foto ketiga,
yang jelas-jelas layar penuh dan disertai DevTools, yang menunjukkannya.

Perbaikannya satu selektor: `.map-panel:not(#fs-filter-host)`.

**Sekalian: bilah filter di layar penuh jadi satu baris.** Rumahnya diletakkan di tengah
(`left-1/2` + translate), jadi lebar yang "tersedia" cuma separuh layar dan bilahnya
melipat dua baris padahal layarnya luas. `width: max-content` memberinya lebar satu baris
penuh; `max-width: calc(100vw - 3rem)` menjaganya tetap melipat sendiri kalau layarnya
memang sempit — tanpa media query.

**Tes**: 19/19 hijau. Dua mutasi tertangkap: rumah bilah yang kembali ikut aturan
overflow, dan lebar `max-content` yang dibuang.

### Dropdown hilang di atas peta, dan panel kanan yang harus digulir (2026-08-30)

Dua keluhan yang datang setelah perbaikan sebelumnya belum menyelesaikannya.

**Dropdown filter hilang begitu menimpa peta.** Perbaikan sebelumnya — tinggi mengikuti
ruang, membuka ke atas kalau perlu — tidak menyelesaikannya, dan gejalanya tidak bisa
direproduksi di Chromium tanpa GPU: di sana panelnya tergambar benar di atas peta.

Tersangka yang tersisa: **`backdrop-filter`**. Efek kaca itu harus mengambil sampel dari
apa yang ada di belakangnya, dan yang di belakang panel ini adalah kanvas WebGL peta —
lapisan tersendiri yang dikompositkan GPU. Sebagian driver menggambarnya jadi kosong,
dan panelnya hilang tanpa satu pun error di konsol. Latarnya sekarang **padat**.

Bukan cuma menghindari bug: daftar 39 kabupaten di atas peta yang ramai memang lebih
terbaca dengan latar padat. Kaca tetap dipakai panel yang ada DI DALAM peta — yang
bermasalah hanya yang di luar dan menimpanya.

Karena penyebabnya bergantung driver dan tidak bisa direproduksi di sini, yang menjaga
di tes adalah bentuk gayanya: `.pilih-panel` tidak boleh punya `backdrop-filter` lagi.
Itu penjaga yang lebih lemah dari biasanya, dan ditulis begitu dengan sadar.

**Panel Opsi Peta harus digulir untuk melihat sisanya.** Diukur di browser: isinya
887 px sementara yang muat 462 px — 427 px tersembunyi. Tim memintanya terlihat semua
tanpa perlu layar penuh.

Dua legenda (kelas heatmap dan 51 dealer) yang membuatnya panjang. Keduanya dilipat
dengan `<details>` bawaan HTML — nol baris JavaScript, keyboard ikut jalan sendiri — dan
tertutup secara bawaan: yang dipakai tiap saat adalah sakelar di atasnya, sementara
legenda dibuka waktu ada yang perlu dibaca. Baris sakelar ikut dipadatkan dari 7 px jadi
4 px; tujuh sakelar dikali 6 px yang dihemat persis menutup selisih terakhir.

Hasilnya 466 px isi untuk 466 px ruang — muat tanpa digulir sama sekali.

**Tes**: 19/19 hijau. Tiga mutasi tertangkap: kaca dikembalikan ke dropdown, legenda
tidak lagi dilipat, dan lipatan yang terbuka secara bawaan.

### Tiga perbaikan tampilan dari mencoba langsung (2026-08-30)

Tiga hal yang cuma ketahuan waktu aplikasinya dipakai di layar sungguhan, bukan dari
membaca kode.

**Panel rincian kelurahan menutupi tombol peta.** Panelnya dan tombol "Layar penuh"
plus "Fit" sama-sama `absolute top-6 left-6` di dalam `#map-shell` — begitu satu
kelurahan diklik, kedua tombol itu tertutup dan tidak bisa ditekan sama sekali.
Panelnya turun ke `top-20`, mengikuti pola yang sudah dipakai panel performa layar
penuh. Dijaga tes yang membandingkan posisi keduanya, bukan mengecek satu angka.

**"Pas-kan" jadi "Fit".** Diminta tim: istilah yang lazim dipakai di peta web. Label
tombolnya bahasa Inggris, penjelasan di tooltip-nya tetap Indonesia.

**Dropdown filter keluar layar di jendela pendek.** Panelnya selalu membuka ke bawah
setinggi tetap 268 px. Begitu ruang di bawah tombolnya sempit — jendela pendek, atau
bilah filter melipat jadi dua baris sehingga tombolnya turun — daftarnya jatuh keluar
layar dan yang terlihat cuma kotak pencariannya. **Tidak ada error, tidak ada gejala
lain; dropdown-nya sekadar terlihat kosong.**

Diukur ulang di browser: pada jendela setinggi 300 px, panel lamanya 324 px — habis
keluar layar. Sekarang tingginya dipotong ke ruang yang benar-benar ada (jadi 116 px di
kasus itu, tetap bisa digulir), panelnya membuka ke ATAS kalau ruang di atas lebih
lega, dan diratakan ke kanan kalau tombolnya ada di ujung kanan bilah.

**Tes**: 19/19 hijau. Tiga mutasi tertangkap: tinggi daftar yang kembali tetap, panel
yang berhenti menimbang tinggi jendela, dan panel kelurahan yang kembali menempati
sudut yang sama dengan tombol peta.

### Panel performa dan tata letak: urut, live, layar penuh, tabel tanpa ruang kosong (2026-08-30)

Empat item minor plus satu mayor dari daftar revisi, semuanya soal tampilan.

**Tombol urut di Analisis Performa Pos.** Daftarnya ternyata **sudah** urut persentase
terkecil sejak awal — tapi tidak ada yang menuliskannya di layar, jadi tidak ada yang
tahu, dan tidak ada yang bisa membaliknya waktu ingin melihat pos yang paling baik.
Tombolnya menjawab dua-duanya: menyebutkan urutan yang berlaku, sekaligus membaliknya.

**Peta pindah ke bawah empat blok ringkasan.** Sebelumnya peta baru terlihat sesudah
menggulir melewati treemap dan panel performa — dua panel setinggi layar. Sekarang angka
dan petanya terbaca bersamaan.

**Tabel mengisi tinggi yang tersisa, tanpa angka ajaib.** Ketiga tabel master dulu
dibatasi `max-h-[calc(100vh-320px)]`; 320 dan 360 itu tebakan tinggi kepala halaman
waktu markupnya ditulis. Tiap kali ada yang ditambah di atas tabel — bilah filter,
tombol reset, baris navigasi halaman — tebakan itu meleset dan menyisakan ruang kosong
di bawah tabel. Sekarang tingginya dihitung browser lewat flexbox: section setinggi
`<main>`, kepala halaman seukuran isinya, sisanya untuk tabel. Menambah apa pun di atas
tabel tidak perlu menyentuh satu angka pun lagi.

**Gulir otomatis (live) dan tampilan besar.** Dua-duanya untuk layar yang diproyeksikan
waktu rapat. Gulirnya per piksel, bukan per baris — gerakan yang meloncat antar baris
membuat orang kehilangan tempat bacanya — dan berhenti sendiri kalau daftarnya sudah
muat seluruhnya, karena menggulir yang sudah muat cuma membuat layar bergetar.

Tampilan besarnya digambar `renderPerformance()` yang sama dengan panel biasa dan panel
layar penuh peta: tiga salinan, satu sumber. Kalau masing-masing menghitung sendiri,
tiga angka berbeda bisa tampil bersamaan dan tidak ada yang tahu mana yang benar.

**Tes**: 19/19 hijau. Empat mutasi tertangkap: tampilan besar yang menghitung daftarnya
sendiri, interval gulir yang bocor waktu tampilannya ditutup, tombol urut yang cuma
mengganti tulisan tanpa membalik urutan, dan tinggi tabel yang kembali dipatok angka
ajaib.

**Satu kesalahan tertangkap sendiri saat mengerjakan:** `scopeLabel` dipakai di
`render.js` tanpa di-import. Itu `ReferenceError` yang baru muncul waktu tampilan
besarnya dibuka, dan **tidak satu pun tes menangkapnya** — `page.test.js` memeriksa
handler dan id, bukan pengenal yang tidak terdefinisi. Batas nyata dari tes yang ada;
yang menangkapnya kali ini pembacaan kode, bukan tes.

### Edit ring di peta: batas kecamatan, kuas ring (2026-08-29)

Langkah kedua dari tiga. Yang belum: agregasi ring menggantikan agregasi radius.

**Batas kecamatan diturunkan dari poligon kelurahan**, bukan disimpan sendiri —
`ST_Union` per `district_code` di `npm run export-geo`. Tidak ada tabel kecamatan dan
tidak perlu ada: kecamatan itu kumpulan kelurahan, dan menyimpan batasnya terpisah
berarti dua sumber yang bisa menyimpang.

Disederhanakan **sesudah** union, bukan sebelum. Menyederhanakan tiap kelurahan dulu
membuat tepi yang bersebelahan tidak lagi berimpit, dan union-nya meninggalkan celah
tipis di antara kecamatan.

**SELURUH 654 kecamatan diekspor**, bukan cuma yang punya penjualan. Ring justru dipakai
menandai wilayah yang BELUM digarap — menyaringnya ke yang sudah ada penjualan membuat
kecamatan yang paling ingin ditandai orang justru tidak bisa diklik.

**Berkasnya dimuat hanya saat mode edit ring dinyalakan.** 3,03 MB untuk 654 kecamatan
(222 titik rata-rata — isinya murni koordinat, tidak ada yang bisa dihemat lagi tanpa
merusak bentuknya). Sebagian besar sesi tidak pernah menyunting ring, jadi memuatnya di
awal berarti semua orang membayar untuk yang dipakai sedikit. Presisi diturunkan dari 6
desimal ke 5: 0,1 m tidak berarti apa-apa untuk bentuk yang sudah disederhanakan 250 m.

**Satu kecamatan dulu, baru ringnya.** Klik satu kecamatan di peta, muncul pemilih kecil
di titik klik berisi nama, kode, statusnya sekarang, dan tombol Ring 1/2/3 plus "Lepas
dari ring".

Versi pertama kebalikannya: pilih ring sebagai **kuas**, lalu sapu banyak kecamatan
sekaligus. Itu lebih cepat untuk mengisi borongan, dan tim menolaknya. Alasannya masuk
akal — yang dipikirkan orang waktu melihat peta adalah "kecamatan ini masuk ring
berapa", bukan "ring 2 isinya kecamatan mana saja". Urutan kendalinya sekarang mengikuti
urutan pikirannya, dan harganya diterima sadar: mengisi 20 kecamatan jadi 40 klik, bukan
21.

Memilih ring lain untuk kecamatan yang sudah punya ring akan MEMINDAHKANNYA, bukan
menambah — satu kecamatan tidak pernah bisa ada di dua ring, aturan yang sama dijaga
primary key di database.

Perubahannya ditahan di browser sampai Simpan ditekan. Tanpa itu, tiap klik jadi satu
permintaan ke server dan Batal berarti membalikkan puluhan klik satu per satu.

**Tombolnya ada di TIGA tempat**, dan itu bukan berlebihan — versi pertama cuma
menaruhnya di bilah ruang lingkup, dan tim langsung bertanya "tombol tambah ring-nya
mana". Bilah itu ada di atas halaman; orang yang baru mengklik marker sedang melihat
peta, dan tombol di luar layar sama saja dengan tidak ada.

- **Di atas peta**, sebaris dengan "Layar penuh" dan "Pas-kan" — untuk yang datang dari
  mengklik marker.
- **Kolom Aksi di Master Pos Dealer**, di baris yang sama dengan tiga kolom ringnya —
  untuk yang datang dari melihat pos mana yang ringnya masih kosong. Tombol ini
  mengantar ke peta, bukan membuka pemilih sendiri: ringnya memang dipilih di peta.
- **Bilah ruang lingkup**, tempat aslinya.

Ketiganya hanya muncul waktu lingkupnya **satu pos** — ring melekat pada pos, dan
tombol yang muncul untuk dealer akan menyesatkan.

**Sakelar "Nama Kecamatan" di Opsi Peta.** Terpisah dari mode edit ring — orang perlu
tahu nama kecamatan waktu MEMBACA peta, bukan cuma waktu menyuntingnya. Berkas batasnya
tetap dimuat saat diminta, jadi yang tidak pernah menyalakannya tidak membayar 3 MB.
Satu tempat yang memutuskan tampil atau tidak (`redrawMap`), dari sakelar dan mode edit
sekaligus: kalau masing-masing menyetel sendiri, keluar dari mode edit akan mematikan
lapisan yang sengaja dinyalakan orang lewat opsi peta.

Namanya baru muncul di atas zoom 8,5 — sama seperti nama kelurahan yang muncul di atas
zoom 10,5. Enam ratus lima puluh empat label sekaligus di seluruh Jateng cuma jadi
kabut abu-abu.

**Tetap TIGA ring, bukan jumlah bebas.** Ditanyakan tim, lalu diputuskan tidak: daftar
revisi aslinya menyebut tepat tiga ("ring 1, ring 2, ring 3, serta di luar ketiga
ring"), dan menambah ring 4/5 berarti melepas `CHECK (ring BETWEEN 1 AND 3)` plus
membangun UI kelola ring untuk sesuatu yang belum tentu dipakai. Gampang ditambah nanti
kalau ternyata perlu.

**Diperiksa di browser sungguhan**: tombol muncul hanya setelah satu pos dipilih, batas
kecamatan dimuat dalam 0,3 detik, kuas memberi dan melepas dengan benar, memindahkan
ring memindahkan (0/1/0 jadi 0/0/1, bukan 0/1/1), tombol "Lepas dari ring" cuma muncul
kalau kecamatannya memang sedang punya ring, Simpan menutup bilahnya, dan kolom di
Master Pos Dealer langsung ikut berubah tanpa memuat ulang halaman.

### Fondasi ring: tabel, rute, dan tiga kolom (2026-08-29)

Langkah pertama dari tiga. Yang sudah ada: tempat menyimpan ring, cara mengisinya lewat
API, dan tiga kolom di Master Pos Dealer. Yang **belum**: memilihnya lewat peta, dan
agregasi ring menggantikan agregasi radius.

**Ring melekat pada POS, bukan dealer** — keputusan tim. Ring itu jarak dari satu titik
fisik, dan dua pos milik dealer yang sama di kota berbeda tidak punya kecamatan
tetangga yang sama.

**Dikunci ke `district_code`, tidak pernah ke nama.** Diukur di database: 654 kecamatan
di cakupan, tapi cuma **624 nama berbeda** — 30 nama dipakai lebih dari satu kabupaten.
Menyimpan nama berarti ring satu pos diam-diam ikut menarik kecamatan di kabupaten lain,
dan angkanya tetap terlihat wajar.

**Satu kecamatan cuma boleh di SATU ring per pos**, dijaga primary key
`(outlet_code, district_code)`. Ring yang tumpang tindih membuat satu penjualan
terhitung dua kali, dan totalnya tetap masuk akal dilihat sekilas.

**Menyimpan ring MENGGANTI seluruhnya, bukan menambal.** Halaman selalu mengirim
gambaran lengkap ring satu pos. Menambal berarti kecamatan yang dibuang orang di layar
tetap tinggal di database.

Kolomnya menampilkan **jumlah dan nama kecamatannya** — tiga nama pertama ditulis
penuh, sisanya diringkas "+N lagi", nama lengkapnya di tooltip. Versi pertama cuma
menampilkan jumlah; tim memintanya disebutkan namanya. Batas tiga nama itu bukan
selera: satu ring bisa memuat belasan kecamatan, dan tanpa batas satu baris tabel bisa
setinggi sepuluh baris lain sampai tabelnya berhenti bisa dipindai.

Daftar kecamatan (654 baris, ~40 KB) ikut dikirim di `/api/summary`. Tidak bisa
diturunkan dari daftar kelurahan yang sudah ada di sana: kelurahan disaring ke yang
punya penjualan, sementara ring justru sering menandai kecamatan yang belum ada
penjualannya sama sekali.

Yang kosong ditulis tanda hubung bukan angka nol — "belum diisi" dan "benar-benar nol"
dua hal berbeda.

**Tes**: 19/19 hijau. Empat mutasi tertangkap: simpan yang menambal alih-alih mengganti,
kecamatan asing yang dilewati diam-diam, primary key yang dilonggarkan sampai satu
kecamatan bisa masuk dua ring, dan nomor ring di luar 1–3. Ring juga ikut dikosongkan
waktu master pos direset — lewat `ON DELETE CASCADE`, dan itu ikut diperiksa.

### Master Pos Dealer: reset, kata-kata, dan subtitel yang selalu nol (2026-08-29)

Bagian kedua revisi pra-present HO, kecuali kolom ring yang menunggu fondasi ring.

**Reset master pos dan dealer.** Tombol di kepala halaman, konfirmasi harus diketik
`RESET` persis — pola yang sama dengan hapus periode, karena yang hilang di sini justru
lebih banyak. Angkanya disebut SEBELUM ditekan ("79 pos · 52 dealer · 19.216 unit akan
hilang"), bukan sesudah.

Yang ikut terhapus dan kenapa tidak bisa tidak:

- **Penjualan, semua bulan.** `sales.outlet_code` menunjuk `outlets` lewat foreign key.
  Pos tidak bisa hilang sementara penjualannya tinggal — itu bukan "reset yang lebih
  aman", itu database yang menolak.
- **Data konsumen.** Membiarkannya berarti nama dan alamat tertinggal untuk penjualan
  yang sudah tidak ada di layar mana pun. Aturan yang sama sudah berlaku di
  `deletePeriod()`.
- Jejaknya masuk riwayat impor (`result = 'reset'`), dan arsip Excel tidak ikut dihapus
  — itu jalan pulihnya, bulan per bulan.

**Kata-kata:** "Sunting" → "Edit", "Peta" → "Lihat di peta", opsi terakhir dropdown
dealer induk → "+ tambahkan dealer induk".

**Dropdown dealer induk ternyata sudah ada** sejak Fase 5 — lengkap dengan opsi
"dealer baru". Yang diminta tim cuma kata-katanya.

**Bug lama diperbaiki:** subtitel halaman selalu berbunyi "0 pos dari 0 dealer".
`#pos-count` dan `#pos-dealer-count` ada di markup tapi tidak pernah diisi satu baris
kode pun. Sekarang angkanya mengikuti daftar yang benar-benar tampil, jadi menyaring
dealer tidak membuat subtitelnya membantah tabel di bawahnya.

**Satu tes hampa ditemukan dan diperbaiki.** Assertion "coverage ikut dikosongkan waktu
reset" tidak pernah bisa merah: impor tidak pernah membuat baris jangkauan (itu tugas
`seed-coverage`), jadi tabelnya kosong dan assertion-nya lewat begitu saja. Sekarang
barisnya diisi tangan dulu. Sesudah diperbaiki, membuang `DELETE FROM outlets` langsung
merah; membuang `DELETE FROM coverage` tetap hijau dan itu memang benar — `ON DELETE
CASCADE` yang mengerjakannya. Mutan ekuivalen, dicatat di kodenya.

**Tes**: 19/19 hijau. Mutasi tertangkap: PII tertinggal, reset di database kosong yang
mengaku berhasil, jejak tidak dicatat, `outlets` tidak dikosongkan, konfirmasi dilepas,
dan konfirmasi yang tidak lagi peka huruf besar-kecil.

Yang terakhir sempat lolos karena alasan yang salah: dengan `.toUpperCase()`,
permintaannya melewati penjaga lalu gagal di repositori — dan itu juga 400. Statusnya
sama, artinya beda jauh. Tesnya sekarang memeriksa pesannya, bukan cuma statusnya.

### Perombakan filter: bilah tetap, rentang periode, satu slot lingkup (2026-08-29)

Bagian pertama revisi pra-present HO. Lima hal sekaligus, karena semuanya menyentuh
tempat yang sama.

**1. Nilai filter pindah dari DOM ke objek per halaman.** Sebelumnya sumber kebenaran
filter adalah nilai `<select>`. Satu set `<select>` tidak bisa menyimpan empat halaman
sekaligus, jadi nilainya sekarang di `S.filters[halaman]` dan `<select>` jadi cermin.
Efek sampingnya yang paling berharga: `filters.js` jadi **bebas DOM** dan bisa
di-`import()` langsung oleh tes Node — `test/filters.test.js` lahir dari situ.

**2. Kebocoran antar-halaman tertutup.** Dulu `renderOutletTable()` dan
`renderVillageTable()` menyaring barisnya dengan dropdown halaman sendiri tapi
menghitung kolom angkanya dengan `activeRows()` milik halaman Peta. Memfilter di Peta
diam-diam mengubah angka di Master Pos. Sekarang `activeRows()` mengikuti
`S.filterPage`, dan `switchTab()` menyetelnya SEBELUM tabelnya digambar.

**3. Periode jadi rentang: bulan dan tahun, dua dropdown per ujung.** Tanpa tombol
"1 bulan" — diminta tim setelah versi pertama dicoba. Bentuknya berubah tiga kali dalam
satu sesi, tiap kali karena tim mencoba yang sebelumnya:

1. Dua `<select>` daftar bulan + tombol sakelar "1 bulan" → "langsung isi MM YY saja,
   tombolnya tidak perlu".
2. Dua `<input type="month">` bawaan browser, dibatasi `min`/`max` ke periode yang sudah
   diimpor → "biasa aja, gaperlu ngikutin bulan tahun yang udah keupload". `min`/`max`
   dilepas.
3. `<input type="month">` masih menyisakan masalah: **tahunnya cuma bisa diketik**,
   tidak ada daftarnya. Sekarang tiap ujung punya dua `<select>`: bulan (Jan–Des) dan
   tahun (2020 sampai tahun depan), dalam satu pil.

Daftar tahunnya daftar biasa, **tidak** diturunkan dari periode yang sudah diimpor.
Memilih tanda hubung (`—`) di salah satu dropdown berarti "tanpa batas di sisi itu".

Efek samping yang bagus dari langkah 3: `<select>` jalan di semua browser, jadi catatan
"`type="month"` cuma didukung Chrome dan Edge" ikut hilang bersama masalahnya.

**3b. Rentang itu sampai ke database.** `/api/customers/browse` dan
`/api/customers` menerima `periodFrom`/`periodTo`; `period` yang lama tetap diterima dan
diterjemahkan jadi rentang satu bulan — tanpa itu tautan lama akan lolos validasi lunak
`/browse` sebagai "tanpa saringan" dan mengembalikan seluruh basis data konsumen.
`customersInVillage()` tanda tangannya diubah jadi argumen OBJEK supaya panggilan
posisional lama gagal keras, bukan melebar diam-diam.

**4. Bilah keluar dari area gulir.** Ditaruh di antara `<nav>` dan `<main>`, tanpa
`position: sticky` — `<main>` satu-satunya scroller, jadi yang di luarnya memang tidak
pernah bergerak. Mode layar penuh **memindahkan node bilahnya** (`appendChild`), bukan
mencerminkannya; `fs-periode`/`fs-kota`/`fs-dealer`/`fs-pos`, `FS_MIRROR`, dan
`mirrorFilter()` dibuang seluruhnya.

**5. Bug lama: pencarian di dalam dropdown mati sejak hari pertama.** Ada dua
`fillSelect`. Yang dipakai `app.js` berasal dari `dom.js` dan tidak menyimpan apa-apa;
yang menyimpan `S.allOptions` ada di `select-search.js` dan tidak pernah di-import siapa
pun — sementara `S.allOptions` sendiri tidak pernah dideklarasikan. Mengetik satu huruf
di "cari kota" melempar `TypeError`.

**6. `<select>` diganti dropdown sendiri; pencariannya masuk ke dalam panel.** Diminta
tim setelah versi pertama dicoba: kotak cari tidak lagi berdiri di sebelah dropdown, dia
di dalamnya. `<select>` bawaan tidak bisa memuat apa pun, jadi `select-search.js`
dibuang dan diganti `combobox.js` — tombol pil, panel kaca, kotak cari di atas daftar.
Kotak carinya muncul hanya kalau daftarnya lebih dari 8 baris; provinsi (2 pilihan)
tidak dapat. `fillSelect` di `dom.js` ikut hilang karena tidak ada lagi yang memakainya.

Yang dijaga tetap sama seperti dulu: **yang tersimpan selalu KODE**, tidak pernah teks
yang diketik. Kotak cari cuma menyaring; memilih harus menekan barisnya. Daftarnya
menempel di elemen hostnya (`el._combo`), bukan di objek global berkunci id — pelajaran
langsung dari `S.allOptions`, dan `test/page.test.js` menjaga keduanya.

**7. Tampilan bilah: dari rata jadi punya bidang sendiri.** Diminta tim — "terlalu flat,
mau menarik tapi tetap simple". Tanpa warna baru dan tanpa font baru:

- Bilahnya dapat gradien setipis `#ffffff → #f6f8fc` plus garis rambut bawah, jadi dia
  terbaca sebagai **rak** di bawah nav navy, bukan sambungan kosong.
- Tiap filter jadi pil dengan nama sumbunya di dalam (10px, uppercase, tracking lebar) —
  perangkat yang sudah dipakai kartu KPI, bukan perangkat baru.
- Periode memakai **JetBrains Mono**. Dia satu-satunya filter yang berupa koordinat,
  bukan nama, dan mono di aplikasi ini sudah berarti "ini angka".
- **Pil MENYALA navy kalau filternya benar-benar menyempitkan tampilan.** Karena
  kabupaten, dealer, dan pos berbagi satu slot, mustahil ada dua yang menyala bersamaan
  — aturan yang jadi dasar seluruh perombakan ini akhirnya jadi sesuatu yang terlihat,
  dan "kok kabupaten saya hilang?" menjawab dirinya sendiri.

Bilahnya juga turun dari dua baris jadi satu: tiga `<input>` cari yang berdiri sendiri
hilang, dan empat pil lebih rapat daripada empat `<select>` plus pemisahnya.

**Yang HILANG dan itu disengaja:** drill-down "klik dealer lalu klik salah satu posnya".
Kota, dealer, dan pos berbagi satu slot, jadi mengklik pos membuang dealernya. Dipilih
sadar oleh tim supaya aturannya sama untuk klik peta dan untuk dropdown.

**Diperiksa di browser sungguhan** (Playwright, nol error konsol): bilah tetap terlihat
setelah menggulir 600 px, filter tiap halaman berdiri sendiri, Data Konsumen mulai tanpa
batas periode sementara halaman lain mulai di bulan terakhir, klik peta menyamakan
bilahnya, layar penuh memindahkan bilah dengan nilai utuh, dan kotak pencarian dropdown
akhirnya bekerja.

**Satu bug ditemukan saat pemeriksaan browser itu dan sudah diperbaiki:** `applyScope()`
mengubah state lalu memanggil `renderAll()`, dan `renderAll()` belum menyamakan bilah —
peta sudah berpindah sementara dropdown masih menunjukkan filter yang lama. Tes tidak
menangkapnya karena `filters.test.js` sengaja bebas DOM dan `page.test.js` memeriksa
markup, bukan perilaku. Dicatat di sini karena itu batas nyata dari kedua tes tersebut.

**Tes**: 19/19 berkas hijau. Mutasi tertangkap: 11/11 di `filters.test.js`, 4/5 di
repositori (satu mutan EKUIVALEN: titik pada awalan kode provinsi, sama seperti yang
sudah dicatat untuk penyaring kota), 3/3 di rute.

### Salinan offline: satu berkas HTML untuk dibawa keluar kantor (2026-08-19)

Diminta untuk keadaan tanpa WiFi — link Tailscale tidak menolong kalau memang tidak
ada jaringan sama sekali. `npm run offline-html` menulis `prototype/astra-offline.html`
(~10 MB), dobel-klik langsung jalan, tanpa server, database, maupun login.

**Bukan `prototype/build.js` yang lama.** Yang itu dibuat untuk proposal 13 Agustus,
menarik library dari CDN (mati tanpa internet — persis kebalikan dari kebutuhannya),
dan memakai implementasi terpisah di `prototype/src/` dengan angka karangan yang sudah
menyimpang dari aplikasi sungguhan. `build-offline.js` menggabung **modul frontend
yang sungguhan** (`frontend/js/*.js`) jadi satu skrip biasa — mirip bukan karena
ditiru, memang kode yang sama.

**Tiga hal berbeda dari aplikasi, disengaja:**

1. Nama dan alamat konsumen **dikarang**, dibangkitkan saat halaman dibuka dari baris
   penjualan yang sudah ditanam — bukan disimpan terpisah, supaya jumlah konsumen per
   kelurahan otomatis sama dengan angka penjualannya. Angka penjualannya sendiri
   **asli**. Berkas ini berpindah tangan tanpa login dan tanpa pembatas laju; 18 ribu
   nama asli di dalamnya risiko yang tidak sebanding dengan manfaat demonya.
2. Basemap peta jalan tidak ikut (`.pmtiles` 27 MB, butuh range request yang tidak
   ada di `file://`). Latarnya polos; poligon kelurahan berwarna tetap utuh.
3. Tombol yang menulis (impor, simpan pos, hapus periode, cocokkan nama) menolak
   dengan pesan jelas di UI, bukan diam.

**Dua bug ketemu waktu membangun, dan keduanya gagal dengan diam:**

Modul digabung ke satu lingkup datar di percobaan pertama, dan `dom.js` +
`select-search.js` sama-sama mengekspor `fillSelect` — yang belakangan menimpa yang
duluan. Gejalanya menunjuk ke berkas yang salah. Diperbaiki: tiap modul dibungkus IIFE
dengan lingkupnya sendiri, persis seperti bundler sungguhan.

Kejadian `load` MapLibre tidak pernah tertembak. Tambalan basemap pertama menimpa
`window.setBasemap` SESUDAH peta dibuat — terlambat, karena style AWAL sudah memuat
sumber vektor `pmtiles://...`, dan MapLibre menunggu sumber itu sebelum menembakkan
`load`. `boot()` diam-diam berhenti sebelum sempat memanggil `renderAll()` — KPI tetap
0 tanpa satu pun error di konsol. Diperbaiki dengan menukar sumbernya di teks `map.js`
SEBELUM digabung.

**`prototype/astra-offline.html` DI LUAR GIT** — memuat angka penjualan asli.
`test/page.test.js` menjaga baris itu tetap ada di `.gitignore`; mutasi yang
menghapusnya merah.

Diverifikasi penuh di browser: boot selesai (78 marker, treemap, 53 dealer), panel
rincian dealer → kabupaten → kelurahan jalan, 59 nama konsumen karangan muncul untuk
Wedomartani — persis sama dengan 59 unit penjualannya — dan tombol simpan pos menolak
dengan pesan yang tampil di UI, bukan diam.

18/18 tes, 1/1 mutasi tertangkap.

### Tooltip sebaran di peta, dan lingkaran radius yang akhirnya ikut berubah (2026-08-18)

Dua permintaan sekaligus. Yang kedua ternyata bug yang sudah lama diam.

**Lingkaran radius tidak pernah berubah.** Menekan 3 km atau 10 km mengubah `S.radiusM`,
`S.coverage`, label, dan SELURUH persentase di layar — tapi lingkaran di peta digambar
dengan konstanta `RADIUS_METERS` yang selalu 5.000. Tidak ada error. Yang terjadi cuma
peta dan angka menceritakan dua hal berbeda, dan lingkaran itu justru yang dipakai orang
untuk mempercayai angkanya. Diukur setelah diperbaiki: tombol 3/5/7/10 km menghasilkan
jari-jari **3,00 / 5,00 / 7,00 / 10,00 km**; sebelumnya keempatnya 5,00.

Konstantanya dibiarkan hidup sebagai nilai awal, dengan catatan tegas untuk tidak
memakainya menggambar atau menghitung.

**Sebaran per kelurahan dan kabupaten sekarang terbaca tanpa klik.** Arahkan kursor ke
poligon mana pun: nama kelurahan, unit, % jangkauan, lalu kabupatennya beserta jumlah
kelurahan dan persentasenya. Panel rincian tetap untuk menelusuri berurutan; tooltip
untuk pertanyaan yang muncul sambil melihat peta.

**Mengikuti ruang lingkup yang sedang aktif, dan itu yang paling penting.** Tooltip
membaca `activeRows()` — sumber yang sama dengan warna poligon di bawahnya. Kalau dia
membaca `S.sales` langsung, poligon bisa gelap karena satu dealer sementara tooltipnya
menyebut total semua dealer: dua angka bertentangan di layar yang sama, tanpa error.
Dijaga `test/page.test.js`, dan mutasinya merah.

Diverifikasi silang di browser: tooltip menyebut "Kabupaten Temanggung 7 penjualan di 6
kelurahan · 0%", panel rincian menyebut "Kabupaten Temanggung 6 kel 0% 7". Sama persis.

**Dua kesalahan pengukuran saya sendiri, yang keduanya sempat terlihat seperti bug:**

1. Lingkaran radius terbaca "KOSONG" — sumbernya `Feature` tunggal, bukan
   `FeatureCollection`, jadi `data.features[0]` memang undefined. Kodenya benar sejak
   awal; pembacaan saya yang salah.
2. Angka Temanggung terlihat mencurigakan mirip periode demo. Dicek ke panel: memang
   angka Agustus, kebetulan berdekatan.

Keduanya dikejar sampai tuntas alih-alih dianggap wajar, dan itu memang yang seharusnya
— tapi patut dicatat bahwa dua "temuan" pertama saya ternyata bukan temuan.

Tooltip dipasang ke `mousemove`, bukan `mouseenter`. Satu kelurahan bisa selebar layar
di zoom rendah, dan tooltip yang diam di titik masuk akan tertinggal jauh dari kursor
lalu terbaca seperti milik kelurahan sebelah.

`KF-PETA-15` dan `KF-PETA-16` baru di PRD. 18/18 tes, 3/3 mutasi tertangkap.

### Panel rincian dealer: sebaran per kabupaten lalu kelurahan (2026-08-18)

Klik dealer sebelumnya cuma menjawab satu pertanyaan — berapa persen di dalam radius —
lalu berhenti. Pertanyaan yang selalu datang sesudahnya, *"di kelurahan mana saja?"*,
tidak terjawab di mana pun.

**Diukur dulu, dan hasilnya mengubah bentuknya.** Dealer terbesar menyentuh 1.157
kelurahan, tapi 677 di antaranya (59%) cuma satu unit; yang ≥5 unit cuma 62. Daftar
datar sepanjang itu isinya hampir seluruhnya "1 unit" — panjang, tapi tidak menjawab
apa pun. Jadi tingkat pertamanya **kabupaten** (23 baris untuk dealer itu), kelurahannya
mekar waktu diklik.

**Nol permintaan ke server untuk tiga tingkat pertama.** `S.sales` di browser sudah
memuat `{village, dealer, units}` dan `S.coverage` sudah memuat rasio per (pos,
kelurahan), jadi seluruh hitungan dealer → kabupaten → kelurahan murni di halaman.
Nama konsumen baru diambil waktu satu kelurahan diklik — dan itu bukan pilihan
rancangan, `/api/customers` menolak permintaan tanpa kode kelurahan. Diperiksa di
browser: membuka panel dan memekarkan kabupaten menghasilkan **nol** permintaan, klik
satu kelurahan menghasilkan **tepat satu**.

Hitungannya di `dealerBreakdown()` yang murni, memakai ulang `splitByCoverage()` yang
sama dengan seluruh aplikasi — bukan disalin. Aturan "kelurahan tanpa poligon
dikeluarkan dari persentase" itu halus dan sudah pernah salah; satu-satunya cara
memastikan tidak menyimpang adalah tidak punya salinan keduanya.

**Dua hal yang cuma ketahuan karena dibuka di browser, bukan dari tes:**

1. **Nama kabupaten terpotong jadi "Kabupat…"** di panel selebar 320 px, karena satu
   baris dijejali nama, bilah, persen, dan unit. Cilacap dan Cirebon jadi tidak bisa
   dibedakan — menghapus satu-satunya hal yang membuat baris itu berguna. Bilahnya
   diturunkan ke baris kedua.
2. **Jadwal sembunyi panel yang tidak bisa dibatalkan.** `closeVillageDetail()`
   memasang `hidden` lewat `setTimeout` 300 ms supaya animasi gesernya selesai dulu.
   Panel yang dibuka di dalam jendela itu disembunyikan lagi oleh jadwal lama —
   panelnya tampak tidak terbuka sama sekali, tanpa pesan. Gejalanya bergantung waktu,
   jadi kadang muncul kadang tidak. Timernya sekarang disimpan dan dibatalkan tiap
   panel dibuka.

**Angkanya diperiksa bersambung, bukan cuma terlihat masuk akal:** total di panel
(2.099) sama persis dengan total di kartu dealer, dan sama dengan jumlah 23 kabupaten.
Selisih dari ukuran awal saya (2.169) ternyata tepat 70 — total dealer itu di periode
demo, karena SQL awal saya tidak menyaring periode. Cocok sampai satuannya.

6/6 mutasi tertangkap: dikelompokkan per kecamatan, jangkauan dihitung dari seluruh
baris dealer, dua pengurutan dibuang, jangkauan kabupaten dipaksa nol, dan kelurahan
tanpa poligon dimasukkan ke penyebut. Yang keempat awalnya LOLOS — tesnya tidak pernah
memeriksa `inside` tingkat kabupaten sama sekali.

18/18 tes.

### Centang simpan data konsumen dibuang; impor lewat halaman selalu menyimpan (2026-08-18)

Menggantikan entri beberapa jam sebelumnya yang baru menyalakannya secara bawaan.
Pemilik proyek menegaskan: pilihannya tidak perlu ada, datanya wajib.

**Yang dibuang cuma pilihannya. Jaminan sisi server tidak berubah sedikit pun:**
`runImport` tanpa `withCustomers` tetap tidak menyentuh `astra_customers`, database
konsumen tetap terpisah, `DROP DATABASE` tetap mencabut semuanya, dan pembatas laju
serta catatan akses tetap berlaku. Jalur mengimpor tanpa PII masih ada — sekarang hanya
lewat `npm run import` tanpa `--konsumen`.

**Jebakan terbesarnya arah nilai bawaan, dan hampir terpasang terbalik.** Halaman tidak
lagi mengirim field `withCustomers` sama sekali, sementara rutenya berbunyi
`String(field) === '1'`. Kalau dibiarkan, hasilnya kebalikan persis dari yang diminta:
halaman yang tidak mengirim apa-apa berarti TIDAK PERNAH menyimpan — impor tetap
berjalan mulus, angka penjualannya tetap benar, dan tab Data Konsumen diam-diam kosong
selamanya. Tidak ada error, tidak ada tes merah.

Diperbaiki jadi `!== '0'` dan dikurung dalam fungsi bernama `simpanKonsumen()` yang
diekspor supaya bisa diuji langsung. Absennya field = simpan; hanya `0` yang eksplisit
yang mematikannya, dan itu yang menjaga jalur CLI dan tes tetap bisa mengimpor tanpa PII.

**Pemberitahuannya sengaja TIDAK ikut dibuang.** Pengunggah tidak lagi bisa menolak di
halaman, jadi setidaknya dia berhak tahu apa yang terjadi. Centangnya diganti satu baris
keterangan, dan `test/page.test.js` menjaga keterangan itu tetap ada: menghapus pilihan
boleh, menghapus pemberitahuan tidak.

Empat mutasi diuji, empat tertangkap — arah nilai bawaan dibalik, `api.js` mengirim
`withCustomers=0` lagi, pemberitahuan dihapus, dan centang dihidupkan setengah jalan.

`KF-IMPOR-16` ditulis ulang; `KF-IMPOR-17` dan `KF-IMPOR-18` baru. 18/18 tes.

### Centang simpan data konsumen jadi menyala secara bawaan (2026-08-18)

Sebelumnya mati secara bawaan — opt-in. Diubah setelah pemilik proyek menyebut alasan
yang sederhana dan benar: tim **memang** memerlukan nama dan alamat tiap bulan, jadi
default mati berarti tiap bulan ada peluang lupa lalu harus impor ulang.

**Yang berubah cuma kenyamanannya, bukan jaminannya.** Tiga sifat yang menjadi dasar
seluruh penanganan PII di proyek ini tidak tersentuh:

- datanya tetap masuk database TERPISAH `astra_customers`, jadi `DROP DATABASE` masih
  mencabut semuanya tanpa menyunting satu baris kode (`KNF-PRIVASI-2`)
- server tetap tidak menyimpan apa pun kalau permintaannya tidak meminta — itu jaminan
  di sisi server, bukan di centang, dan tetap dijaga `test/import.test.js`
- pembatas laju dan catatan akses tetap berlaku

**CLI sengaja TIDAK ikut berubah.** `npm run import` tetap butuh `--konsumen` eksplisit:
perintah yang menyimpan data pribadi tanpa diminta adalah kejutan yang salah arah, dan
CLI dipakai untuk skrip serta perbaikan cepat. Tapi bedanya jadi jebakan sendiri — orang
yang terbiasa dengan halaman akan mengira keduanya sama, lalu bingung kenapa tab Data
Konsumen kosong. Jadi CLI sekarang menyebutkannya di layar tiap kali dijalankan tanpa
flag itu.

**Dijaga karena gagalnya diam.** Kalau atribut `checked` hilang waktu markup dirapikan,
impor bulan berikutnya berjalan mulus, angkanya benar, dan tidak ada satu pun error —
yang hilang cuma data konsumen, dan baru ketahuan berminggu kemudian waktu ada yang
mencari nama yang tidak pernah tersimpan. `test/page.test.js` memeriksa atribut itu ADA,
dan memeriksa labelnya masih menjelaskan cara mematikannya: dengan default menyala, itu
satu-satunya petunjuk bahwa menolak menyimpan PII masih mungkin.

`KF-IMPOR-11` diperbarui bunyinya (dari "hanya tersimpan kalau diminta eksplisit" jadi
jaminan sisi server), `KF-IMPOR-16` baru. 18/18 tes, 2/2 mutasi tertangkap.

### Hapus satu bulan (2026-08-18)

Untuk bulan yang salah diimpor: berkas keliru, periode salah pilih, atau data uji yang
ikut masuk. Impor ulang sudah menimpa periode yang sama, jadi ini bukan untuk
memperbaiki isi — ini untuk membuang bulan yang memang tidak seharusnya ada.

Logika hapusnya sudah ada dan sudah teruji: importer memakainya untuk idempotensi.
Yang baru cuma jalur dan pengamannya.

**Dua keputusan yang diambil pemilik proyek:**

1. **Berkas Excel di arsip TIDAK ikut dihapus.** Dia satu-satunya jalan pulih kalau
   salah hapus — impor ulang berkas yang sama mengembalikan keadaan persis seperti
   semula. Ditukar dengan: PII di arsip belum hilang saat itu juga, dan baru terbuang
   lewat retensi 90 hari. Jalan pulihnya diuji, bukan cuma dijanjikan di komentar.
2. **Konfirmasinya mengetik ulang periodenya**, bukan dialog ya/tidak. Tombolnya
   bersebelahan dengan "impor ulang bulan ini" di kartu yang sama, dan yang satu
   membuang 18.915 baris.

**Urutan PII dulu, dan itu bukan kebetulan.** Dua database berbeda, jadi tidak mungkin
satu transaksi. Kalau penjualan dihapus lebih dulu lalu langkah kedua gagal, yang
tersisa adalah nama dan alamat untuk bulan yang sudah hilang dari layar — PII yang tidak
terlihat siapa pun dan tidak ada yang tahu masih ada. Kebalikannya jauh lebih ringan:
penjualan tanpa PII, dan itu keadaan normal untuk impor tanpa `--konsumen`.

Jejaknya masuk tabel `imports` dengan `result = 'hapus'`, bukan tabel sendiri. Satu akun
dipakai bersama, dan tempat orang mencari "apa yang terjadi pada data" adalah riwayat
impor. Penghapusan yang dicatat di tempat lain sama saja dengan tidak dicatat.

**Uji mutasi menangkap satu tes yang tidak menjaga apa-apa.** Mutasi yang mencabut
pemeriksaan konfirmasi di server awalnya LOLOS: di `server-auth.test.js` database belum
terbuka, jadi permintaan yang lolos penjaga pun berakhir 400 — dari kegagalan query,
bukan dari penolakan. Memeriksa status saja membuat tesnya hijau walaupun penjaganya
dicabut. Diperbaiki jadi memeriksa pesannya. 6/6 setelah itu.

`KF-IMPOR-12` sampai `KF-IMPOR-15` baru di PRD. 18/18 tes, dan dialognya dicoba di
browser sampai gerbang ketiknya — tanpa benar-benar menghapus data Agustus.

### Siap diakses dari luar untuk pitch: trust proxy (2026-08-17)

Kebutuhannya sederhana — teman bisa membuka dashboard waktu pitch. Vercel dibahas dan
**ditolak**: batas body 4,5 MB (Excel sekarang sudah 2,3–3,4 MB), filesystem read-only
mematikan arsip unggahan dan log, dan pembatas PII yang disimpan di memori proses jadi
tidak berfungsi di banyak instance. Jalannya Tailscale Funnel — sudah terpasang di
laptop, memberi HTTPS asli, dan bisa dimatikan lagi dengan satu perintah.

**Yang ditemukan sambil menyiapkan, dan hampir merusak pitch-nya:** aplikasi belum
menyetel `trust proxy`. Di belakang proksi lokal seluruh permintaan tiba dari
`127.0.0.1`, jadi tiga hal rusak sekaligus — pembatas login 5/menit ditanggung bersama
(satu orang salah ketik sandi mengunci semua orang), pembatas PII 30/menit ditanggung
bersama, dan catatan akses PII merekam `127.0.0.1` alih-alih pengunjungnya.

Disetel `'loopback'`, **bukan `true`**. `true` berarti header itu dipercaya dari mana
pun termasuk dari LAN yang sama, dan siapa pun bisa menuliskan IP palsu tiap permintaan
untuk melewati pembatas PII. Pembatas yang bisa dilewati begitu sama saja dengan tidak
ada. Bedanya itu yang dijaga `test/server-auth.test.js`; dua-duanya tertangkap uji
mutasi.

`KNF-PRIVASI-6` baru di PRD.

### Citra satelit tidak pernah muncul — satu lapisan lupa dimatikan (2026-08-17)

Laporannya "render opsi peta satelit masih lama". Ternyata bukan lambat sama sekali:
citranya **tidak pernah muncul**, dan yang terlihat lapisan abu-abu rata.

Dua hipotesis pertama saya gugur oleh pengukuran saya sendiri, lagi:

1. **Jaringan lambat ke Esri** — salah. Ubin di atas Jawa datang dalam 34–162 ms,
   12–18 KB.
2. **`getStyle()` menyalin GeoJSON 4.003 kelurahan tiap kali tombol ditekan** — salah.
   `GeoJSONSource.serialize()` memakai `extend` dangkal; `data` cuma referensi.

Basemap satelitnya diukur terpisah di halaman uji tanpa lapisan aplikasi: **613 ms
sampai diam, 28 ubin.** Cepat. Jadi masalahnya di aplikasi, dan bukti terakhirnya
datang dari daftar lapisan yang masih menyala waktu mode Satelit aktif:

```
polos, bm-satelit, background, kel-isi, ...
                   ^^^^^^^^^^
```

**`setBasemap()` mencari lapisan basemap dengan menyaring `layer.source ===
'protomaps'`, dan lapisan pertama tema itu bertipe `background` — yang di MapLibre
memang TIDAK punya `source`.** Dia lolos dari penyaring, tidak pernah ikut dimatikan,
warnanya `#a3a3a3` pekat, dan posisinya DI ATAS lapisan citra satelit.

Jadi ubinnya diminta, dijawab **200 OK**, lalu tertutup rapat. Tidak ada error, tidak
ada ubin gagal, tidak ada satu pun tes yang merah. Menyembunyikan satu lapisan itu di
konsol langsung memunculkan seluruh citra.

**Mode Polos juga salah selama ini** dan tidak ada yang melaporkannya: yang tampil
`#a3a3a3` milik tema, bukan `#eef1f6` milik kita. Itu justru yang membuat kalimat
laporannya tepat secara harfiah — "cuma kaya yang polos" — Satelit dan Polos memang
menampilkan lapisan yang sama persis.

**Perbaikannya menghapus tebakannya, bukan menambal penyaringnya.** Daftar id lapisan
basemap ditangkap dari tema waktu peta dibuat: tema yang membuat lapisannya, jadi tema
yang tahu daftar lengkapnya. Menambahkan `|| l.type === 'background'` ke penyaring
akan terlihat memperbaiki, tapi ikut mematikan lapisan `polos` milik kita sendiri.

Efek sampingnya `getStyle()` hilang dari jalur ini — dia menserialisasi 66 lapisan tiap
tombol ditekan, walaupun itu bukan penyebab keluhannya.

Dijaga `test/page.test.js`: tema sungguhan dimuat dan dipastikan masih punya lapisan
background tanpa `source` (kalau premisnya hilang, tesnya merah dan penjaganya boleh
dibuang), penyaring `source === 'protomaps'` tidak boleh dipasang lagi, dan daftarnya
harus datang dari tema. Komentar dibuang dulu sebelum diperiksa — catatan di `map.js`
MENGUTIP penyaring lama supaya orang berikutnya tahu kenapa dia salah, dan penjaga yang
menembak kutipan itu akan menghukum dokumentasi yang mencegah bugnya terulang.

18/18 tes, 2/2 mutasi tertangkap, dan ketiga basemap diperiksa satu per satu di browser.

**KF-PETA-11 di PRD naik dari `belum dijaga`** jadi dijaga `test/page.test.js`.

### PRD ditulis mundur, struktur jadi backend/ + frontend/ (2026-08-17)

Proyek ini dibangun tanpa PRD. Enam dokumen yang ada semuanya menjawab "bagaimana",
"kenapa", atau "kapan" — tidak satu pun menjawab **apa yang produk ini harus bisa**.
Untuk tahu itu, orang harus membaca 1.600 baris lalu menyimpulkan sendiri.

**`docs/PLAN.md` bukan cuma kosong, dia menyesatkan.** Isinya SQLite, folder `logika/`
`publik/` `tes/`, tabel `agregat` `pos` `kode_kel`. Tidak satu pun masih benar — dan
`CLAUDE.md` menunjuknya sebagai "rencana lengkap". Dipindah ke
`docs/archive/PLAN-2026-08-12.md` dengan tabel "yang di sini sudah tidak benar" di
kepalanya. **Isinya sengaja tidak disunting**: dokumen sejarah yang dirapikan berhenti
jadi dokumen sejarah.

**Yang paling mahal hilangnya bukan daftar fitur, tapi definisi angkanya.** Tidak ada
satu tempat pun yang menuliskan apa arti "jangkauan", kenapa penyebut "Kelurahan Kosong"
4.003 dan bukan 8.999, atau kenapa satu baris Excel = satu unit tanpa dedupe. Semuanya
ada, terserak di komentar kode. Salah paham di situ menghasilkan angka yang terlihat
benar lalu dilaporkan ke manajemen. Itu bagian 3 di PRD.

**68 kebutuhan ber-ID, masing-masing menyebut berkas tes yang menjaganya** — 49
fungsional, 19 non-fungsional. Delapan ditandai `belum dijaga` apa adanya: treemap,
basemap satelit, pin cepat, lompat ke peta, dan empat kebutuhan non-fungsional yang
memang diukur manual. Daftar itu berguna justru karena jujur. Dijaga
`docs.test.js`: berkas tes yang disebut harus ada, ID tidak boleh kembar, berkas kode
yang disebut harus ada, dan dokumen aktif tidak boleh menunjuk PLAN.md lagi.

**Struktur folder diubah** setelah pertanyaan "harusnya ada folder backend/frontend
biar langsung kelihatan?". Diperiksa dulu sebelum dijawab: `public/js/` ternyata tidak
meng-import apa pun dari `src/` — nol. Jadi masalahnya murni nama yang tidak berbicara,
bukan front dan back yang tercampur, dan pemotongannya aman.

```
backend/core/     <- src/core        frontend/         <- public
backend/server/   <- src/server      frontend/styles/  <- src/styles
```

`src/styles/` memang salah tempat: dia sumber frontend yang duduk di sisi backend.

**Dua hal yang ditemukan justru karena diverifikasi, bukan diasumsikan:**

1. **Tiga path lolos dari penggantian teks** karena dirakit per segmen
   (`path.join(ROOT, 'src', 'server', ...)`, bukan `'src/server/...'`). `npm test`
   langsung merah di tiga berkas — itu memang gunanya menjalankan tes lebih dulu.
2. **Angka jangkauan di ROADMAP ternyata basi.** Tertulis 7,6 / 15,1 / 23,5 / 34,2;
   yang sungguhan **7,5 / 14,8 / 23,0 / 33,5**. Waktu ekspansi Jateng + DIY selesai,
   cuma angka 5 km yang diperbarui dan tiga sisanya tertinggal. Ketahuan karena tiap
   angka di PRD diukur ulang ke database, bukan disalin dari sini.

Entri lama di ROADMAP dan DECISIONS **tetap memakai `src/` dan `public/`** dan sengaja
tidak ditulis ulang — ini catatan berurut waktu, dan merapikannya berarti memalsukan
catatan. Penandanya ditaruh di kepala kedua berkas.

18/18 tes, 6/6 mutasi penjaga dokumen tertangkap.

**Yang belum diverifikasi:** tampilan dashboard sesudah pindah folder, karena sesi
browser habis dan sandinya tidak ada pada saya. Diganti pemeriksaan yang tidak butuh
login — 53 aset dan import ES ditelusuri ke berkas di disk, nol hilang, dan
`/css`, `/vendor` dicek langsung ke server. Sisanya perlu satu kali klik manusia.

### "Tambah Kelurahan" diganti alat pencocokan nama (2026-08-17)

Dua permintaan: warna tombol tambah yang nyaru, dan konsep tambah kelurahan yang
seharusnya memilih kelurahan yang sudah ada supaya poligonnya langsung ikut.

**Warnanya memang salah.** Empat tombol buatan saya memakai `bg-slate-900` generik
sementara seluruh tombol aksi lain memakai `var(--astra-navy)`. Diperbaiki, dan
diperiksa di browser: `rgb(11, 47, 107)`, sama persis dengan tombol Tambah Pos.

**Konsepnya juga salah, dan itu baru ketahuan setelah 8.999 kelurahan masuk.** Fitur
"Tambah Kelurahan" dibuat waktu database cuma memuat 3.466 kelurahan, saat nama yang
tidak cocok memang sering berarti kelurahan yang belum ada. Sekarang tidak lagi.
Diukur pada 50 nama / 165 baris yang tersisa:

| | nama | baris |
|---|---|---|
| Punya padanan dekat di kabupaten yang sama | 31 | 136 |
| — di antaranya saran teratas sekecamatan | 29 | |
| Tidak ada yang mirip (pembeli luar provinsi) | 19 | 29 |

**82% cuma beda ejaan:** TEGALREJO/Tegalreja (18 baris), PABUARAN/Pabuwaran (11),
KEWAYUHAN/Kuwayuhan (7), TIRTA RAHAYU/Tirtorahayu (7). Membuat kelurahan baru untuk
nama-nama itu justru menghasilkan duplikat tanpa poligon — persis kebalikan dari yang
dibutuhkan. Jadi fiturnya dibuang, bukan ditambal, dan diganti tabel `village_aliases`
+ modal Cocokkan Nama.

**Yang dijaga paling ketat: program MENYARANKAN, orang MEMUTUSKAN.** `src/core/matching.js`
menghitung kemiripan dan mengurutkannya, tapi hasilnya tidak pernah sampai ke importer.
Yang masuk indeks pencocokan hanya alias yang sudah diklik manusia. Uji mutasi yang
membuat importer memakai saran terbaiknya sendiri langsung merah — tanpa itu, penjualan
bisa menempel ke kelurahan yang salah tanpa satu pun gejala di layar.

**Kecamatan menang atas jarak** dalam peringkat saran. Cilacap punya dua "Tambakreja" di
kecamatan berbeda; jarak sunting saja tidak bisa memisahkan mereka, dan mengurutkan
dengan jarak saja akan menyodorkan kelurahan yang salah di posisi pertama — tempat yang
paling mungkin diklik tanpa dibaca. Levenshtein ditulis sendiri, bukan memakai ekstensi
`fuzzystrmatch`: `CREATE EXTENSION` butuh superuser, dan tim ini tidak punya orang IT.

**Alias berlaku pada impor berikutnya, bukan surut.** Baris penjualan yang sudah tertulis
tidak diubah dari sini — impor ulang berkas yang sama sudah cukup dan jalur itu sudah
teruji idempoten. Jalur kedua yang mengubah data penjualan adalah jalur yang biasanya
menyimpang. Modalnya menyebut ini apa adanya, bukan menyembunyikannya.

**Dua bug ditemukan sambil mengerjakan, dua-duanya tidak terkait permintaan:**

1. **Byte NUL asli di `tables.js`.** Penanda `DEALER_BARU` ditulis sebagai byte NUL
   sungguhan, bukan escape — tak terlihat di editor, membuat grep menganggap berkasnya
   biner, dan alat apa pun yang menormalkan encoding akan memakannya tanpa suara. Begitu
   hilang, penandanya jadi teks biasa "baru" dan dealer bernama "baru" menabraknya.
2. **CSS Tailwind tidak ikut terbangun.** Modal barunya memakai kelas yang belum pernah
   ada di halaman (`max-w-3xl`, `max-h-[55vh]`), dan kelas yang tidak ada di CSS
   terkompilasi TIDAK melempar error — dia cuma tidak berlaku. Kotaknya jadi 1504x3244
   piksel dengan separuh isinya di atas layar dan tidak bisa dijangkau. Cuma ketahuan
   karena diperiksa di browser; `npm test` hijau sepanjang waktu itu. **Setelah mengubah
   kelas Tailwind di HTML atau JS, `npm run css` wajib dijalankan.**

18/18 berkas tes, 6/6 mutasi tertangkap. Round trip simpan-batalkan diuji di browser
terhadap database sungguhan, dan database dikembalikan ke keadaan semula (0 alias) —
50 keputusan pencocokan itu milik pengguna, bukan milik saya.

### Seluruh Jateng + DIY disiapkan di database (2026-08-17)

Pertanyaannya: bisakah data kelurahan dan poligonnya disiapkan sekaligus supaya
ekspansi tidak perlu menyetel geo lagi — atau tidak efisien? Diukur dulu, baru dijawab:

| | 3.466 (sebelum) | se-Indonesia | |
|---|---|---|---|
| Tabel `villages` | 5,7 MB | ~135 MB | aman |
| `kelurahan.geojson` ke browser | 3,5 MB | ~84 MB | tidak mungkin |
| `villages` di `/api/summary` | 0,6 MB | ~15 MB per halaman | tidak mungkin |

Jadi: **murah di database, mustahil diteruskan apa adanya ke browser.** Rancangannya
jadi "database lengkap, browser cuma menerima yang berarti". Cakupan yang dipilih Jateng
+ DIY lengkap — 93% baris yang belum cocok ada di Jawa Tengah.

**Hasilnya: 3.466 -> 8.999 kelurahan, 15 -> 40 kabupaten/kota.** Baris yang belum cocok
turun dari 349 nama / 568 baris jadi **50 nama / 165 baris**; kecocokan impor naik dari
97,0% ke **99,1%**, dan 403 baris penjualan yang tadinya hilang sekarang terhitung.

**geopandas ternyata tidak diperlukan sama sekali** — pembalikan dari asumsi lama yang
dua kali jadi penghalang. Kolom `path` di berkas sumber array JSON biasa, bukan WKB,
jadi Node membacanya dan PostGIS yang mengurus validasi, proyeksi, dan penyederhanaan.
Dependensi Python + GDAL 100 MB hilang dari jalur ini.

**Tiga temuan yang tidak akan ketahuan tanpa mengukur:**

1. **Karimunjawa.** Penjaga arah koordinat berbunyi di berkas Jepara. Yang tertangkap
   bukan kesalahan: empat kelurahan Karimunjawa memang kepulauan di Laut Jawa 90 km
   di utara pesisir, di lintang -5,7. Tebakan batas utara saya (-6,0) yang salah, bukan
   datanya. Sekarang batasnya diukur dari 8.999 kelurahan: lintang -8,212..-5,725.
2. **Penyaring "kota yang punya penjualan" ternyata tidak menyaring apa pun** — 38 dari
   40 kota punya setidaknya satu penjualan. Diganti kriteria yang berarti: kelurahan
   yang punya penjualan ATAU masuk radius pos. 4.003 dari 8.999.
3. **KPI "Kelurahan Kosong" berubah makna diam-diam.** Tanpa penyaring, dia melonjak
   439 -> 5.673: dari "kelurahan di wilayah kita yang belum ada penjualan" jadi
   "kelurahan di seluruh Jawa Tengah yang tidak kita jual". Benar secara hitungan,
   tidak berguna secara bisnis, dan di layar terlihat seperti kemunduran drastis.
   Setelah disaring: **677**, dan itu justru metrik yang lebih tajam daripada 439 lama.

**Angka jangkauan turun 15,1% -> 14,8%, dan itu BENAR.** 403 baris yang tadinya tak
terlihat sekarang terhitung, sebagian besar di kota tanpa pos sama sekali — jadi memang
di luar jangkauan. Yang 15,1% dulu terlihat lebih bagus karena diam-diam mengabaikan
568 baris. Poligon detail penuh sendiri tidak menggeser angkanya: dihitung ulang dengan
geometri baru sebelum impor, hasilnya tetap 7,6 / 15,1 / 23,5 / 34,2.

Halaman siap dalam 1,4 detik, `/api/summary` 2,31 MB — lebih kecil daripada sebelum
ekspansi meski database 2,6x lebih besar. 17/17 tes, 8/8 mutasi tertangkap.

**Sisa 165 baris yang belum cocok bukan lagi soal cakupan** — 116 Jateng + 20 DIY itu
ketidakcocokan EJAAN NAMA di kota yang kelurahannya sudah ada, dan 29 sisanya pembeli
luar provinsi yang memang dibiarkan.

### Tambah data di Master Pos Dealer dan Master Kelurahan (2026-08-17)

Sebelumnya outlet dan kelurahan HANYA lahir dari impor bulanan. Pos yang sudah buka
harus menunggu sebulan sebelum bisa dipetakan.

**Tambah pos dealer** lurus dan aman: kolom `geom_m` outlet dibuat database dari
lat/lng, jadi pos berkoordinat langsung dihitung jangkauannya. Kodenya diketik manusia,
tidak dibuatkan server — kode itu harus sama dengan yang dipakai Astra di Excel, dan
kalau beda, impor berikutnya membuat outlet KEDUA untuk pos yang sama dan penjualannya
terbelah tanpa gejala. Kode yang sudah dipakai ditolak dengan menyebut pemakainya.

> **Bagian "tambah kelurahan" di bawah SUDAH DIBUANG** pada hari yang sama, setelah
> seluruh Jateng + DIY masuk database berpoligon membuat premisnya tidak berlaku lagi.
> Lihat entri "Tambah Kelurahan diganti alat pencocokan nama" di atas. Yang tetap
> berlaku dan sengaja dipertahankan: penanganan `hasGeom` / `noBoundary` yang dijelaskan
> di sini, sekarang sebagai jaring pengaman yang tidak bergantung pada fitur mana pun.

**Tambah kelurahan punya jebakan yang harus diputuskan sadar,** dan keputusannya
diambil pemilik proyek: kelurahan yang ditambah manual TIDAK punya poligon — batas
wilayah datang dari pipeline geo, bukan ketikan. Tanpa poligon rasio jangkauannya
selalu 0, dan nol itu ambigu: "0% terjangkau" dan "belum bisa dihitung" terlihat sama
persis di layar.

Kalau ikut masuk penyebut, tiap kelurahan baru MENURUNKAN persentase jangkauan — dan
turunnya tampak seperti temuan bisnis ("jangkauan memburuk") padahal cuma data belum
lengkap. Jadi: `summary()` menandainya lewat `hasGeom`, `splitByCoverage()`
mengeluarkannya dari hitungan, dan jumlah unitnya dilaporkan TERPISAH di panel. Dua-duanya
perlu — dikeluarkan tanpa dilaporkan berarti datanya hilang diam-diam, sama buruknya.

Dibuktikan di browser: menambah kelurahan tanpa poligon, persentase tetap 15,1%.

7/7 mutasi tertangkap, termasuk mutasi yang memasukkan kelurahan tanpa batas ke
penyebut dan yang membuang unitnya tanpa melaporkan.

**Yang TIDAK dikerjakan, dan perlu disebut:** ini bukan perluasan cakupan. Dari 349
nama yang belum cocok, **319 nama / 433 baris ada di 39 kota yang tidak tercakup sama
sekali** (Klaten 95 baris, Kudus 55, Wonogiri 31, Sukoharjo 30 ...). Menambahnya satu
per satu lewat form menghasilkan 319 kelurahan tanpa poligon — datanya terhitung, tapi
tidak satu pun ikut jangkauan. Perluasan yang benar lewat pipeline geo; lihat
"Belum dikerjakan".

### Impor Excel: 245 detik jadi 5,7 detik (2026-08-17)

Keluhannya "upload Excel masih lama banget". Riwayat impor menunjukkan pola yang
langsung menunjuk sebabnya:

| berkas | baris | durasi |
|---|---|---|
| CSV | 19.080 | **0 detik** |
| XLSX | 19.080 | **245–287 detik** |

Isi dan hasilnya sama persis. Jadi bukan databasenya, bukan jaringannya, bukan
ukuran datanya — sesuatu di jalur pembacaan xlsx.

**Sebabnya satu baris:** `for (let i = 1; i <= sheet.columnCount; i++)`.

`columnCount` itu GETTER yang memindai ulang seluruh sheet tiap kali dibaca, bukan
angka tersimpan. Ditulis di kondisi loop, dia dievaluasi sekali per kolom per baris —
19.081 x 14 = 267 ribu pemindaian penuh. Diukur langsung:

    i <= sheet.columnCount   20.659 ms per 2.000 baris   (~197 detik)
    batas diangkat           2 ms per 2.000 baris        (~19 ms)

Membaca berkasnya sendiri cuma 1 detik. Seluruh sisanya loop itu.

**Dua tebakan saya yang salah sebelum sampai ke sana**, dicatat karena keduanya
terdengar masuk akal: pertama saya kira `getCell()` yang lambat, kedua saya kira dia
memburuk karena `getCell()` membuat sel yang belum ada. Keduanya dibantah pengukuran
sendiri — `getCell` di rentang baris mana pun tetap 1 ms per 2.000 baris. Yang
membedakan profil pertama dari uji-uji berikutnya ternyata cuma satu: di profil
pertama batas loopnya inline, di sisanya saya kebetulan mengangkatnya ke variabel.

**Diverifikasi identik, bukan cuma cepat.** Seluruh 19.081 baris x 14 kolom
dibandingkan lama vs baru: sama persis. Impor ulang menghasilkan 9.609 baris sales,
18.512 unit, 349 unmatched — sama seperti sebelumnya.

`row.values` dipakai menggantikan `getCell()` sekalian: bukan demi kecepatan (keduanya
sama cepat setelah batasnya diangkat) tapi karena `getCell()` MEMBUAT sel yang belum
ada, jadi sekadar membaca ikut menggemukkan struktur di memori.

**Penjaganya `test/xlsx.test.js`**, dan yang dijaga bukan kecepatannya — tes waktu itu
rapuh, merah di mesin sibuk dan hijau di mesin cepat meski kodenya salah. Yang dijaga:
POLA-nya tidak muncul lagi di kode, dan kolom kosong tidak menggeser indeks. 2/2 mutasi
tertangkap.

### Fase 5 tuntas: memindahkan pos ke dealer lain (2026-08-16)

Pengelompokan dealer awalnya tebakan dari nama pos — bagian sebelum " - ". CLAUDE.md
melarang identitas diturunkan dari nama, dan peredam yang dijanjikan adalah "hasilnya
jadi tabel yang bisa disunting manusia". Separuhnya sudah ada sejak lama (koordinat
dan alamat); separuh yang justru melanggar aturannya belum.

**Kode dealer ditentukan server, tidak pernah datang dari browser.** Halaman mengirim
NAMA; `resolveDealer()` di `repository.js` yang memutuskan kodenya. Nama yang sudah
dipakai dealer lain MEMAKAI ULANG kode dealer itu — jadi "pindahkan pos ini ke
NUSANTARA SAKTI" benar-benar menggabungkan, bukan membuat dealer kedua bernama sama
persis. Pencocokannya tanpa memandang besar-kecil huruf dan spasi berlebih.

**Uji mutasi 5/6.** Tiga yang awalnya lolos ternyata karena DATA UJINYA lemah, bukan
kodenya benar: dealer sasarannya punya kode yang kebetulan turunan namanya, jadi dua
jalur yang berbeda menghasilkan jawaban yang sama. Diganti memakai dealer yang kodenya
`DIKURASI` sementara namanya "Sudah Diperiksa" — keadaan yang memang ada di data
sungguhan karena `seed-outlets.js` memasang kode dari CSV kurasi. Satu lagi lolos
karena outletnya belum punya koordinat sehingga cabang hitung-ulang jangkauan tidak
pernah terjangkau.

Yang keenam mutan yang tertutup lapisan pertama di `resolveGroups()` — sudah tercatat
di `importer.js` sejak dulu, bukan celah baru.

### Dokumen: karakter kontrol dan penjaganya (2026-08-16)

Lima karakter tak terlihat menyelinap ke dalam perintah di `README.md` dan
`docs/PINDAH.md`, dari escape backslash-a dan backslash-b di skrip penyunting: `C:/astra-data`
jadi `C:` + karakter bel, `ops/backup.bat` jadi `ops` + backspace + `ackup.bat`.

Yang rusak justru perintah yang disalin-tempel orang non-IT untuk menyiapkan server.
Tidak kelihatan di editor mana pun, tidak mengubah tampilan di GitHub, dan gagalnya
tanpa menyebut sebab.

Semua diganti jadi garis miring biasa (`C:/astra-data`) yang tidak punya escape sama
sekali, dan `test/docs.test.js` sekarang menolak karakter kontrol di berkas teks mana
pun, plus memeriksa tautan antar dokumen dan keberadaan berkas yang disebut README.
Sudah dibuktikan merah dengan menyuntikkan satu karakter BEL.

Ini kejadian kedua — `.env.example` kena backslash-a lebih dulu. Karena itu penjaganya tes,
bukan kehati-hatian.

Dan tesnya langsung membuktikan diri: beberapa menit setelah dipasang, dia menolak
commit ini sendiri — tiga karakter kontrol baru, di dalam paragraf yang sedang
menjelaskan bahaya karakter kontrol. Kesalahan yang sama, penulis yang sama, lima
menit setelah menuliskan bahayanya. Itu alasan paling jelas kenapa ini harus jadi
tes dan bukan kehati-hatian.

### Kolom waktu jadi TIMESTAMPTZ (2026-08-16)

Empat kolom waktu (`imports.started_at`, `imports.finished_at`, `outlets.updated_at`,
`access_log.at`) masih `VARCHAR(32)` berisi ISO-8601 — warisan SQLite/MySQL. Ketahuan
dari `pg.log`: satu query yang menghitung lama impor gagal dengan `operator does not
exist: character varying - character varying`. Skema diperbaiki, database yang ada
diubah dengan tangan, 13/13 berkas tes tetap lolos. Sisi JavaScript tidak berubah.
Alasan dan perintah ALTER-nya di `DECISIONS.md` entri 2026-08-16.

**Yang ditemukan tapi TIDAK diperbaiki:**

- **Belum ada penjalan migrasi.** `schema.sql` cuma `CREATE TABLE IF NOT EXISTS`, jadi
  perubahan tipe kolom tidak pernah sampai ke database yang sudah ada. Sekarang
  ditambal dengan ALTER manual sekali di satu mesin. Mesin kedua yang databasenya
  sudah berisi akan diam-diam jalan dengan tipe lama. Catatan di `db.js:21`.
- **Satu baris `imports` id=2 tersangkut `result = 'berjalan'`** sejak 2026-08-15
  16:01 — impor yang prosesnya mati sebelum sempat menutup barisnya. Tidak mengganggu
  apa pun selain terlihat di riwayat, tapi berarti impor yang mati kasar tidak punya
  yang membereskannya. Pembersih baris tersangkut saat start belum ada.

### Pengerasan operasional — dari "jalan waktu ditunggui" ke "bisa ditinggal" (2026-08-14)

Pertanyaannya "apakah ini sudah production ready". Jawabannya waktu itu: fungsinya
matang, operasinya belum. Sembilan hal dikerjakan; dua di antaranya sudah menggigit
sendiri di sesi yang sama.

**Yang paling penting, dan bukan soal kode:**

1. **Commit pertama.** Repo git punya nol commit — 74 berkas untracked, tidak ada satu
   pun titik pulih. `DECISIONS.md` mencatat kejadian di proyek ini sendiri: pekerjaan
   yang belum di-commit pernah hilang permanen dan `Code.js` ditulis ulang dari awal.
2. **`.env` keluar dari OneDrive.** Hash sandi, rahasia cookie, dan sandi database ikut
   tersinkron ke cloud Microsoft. Sekarang dicari berurutan lewat `ACC_ENV_FILE` →
   `.env.path` → `DATA_DIR/.env` → proyek, dan `validate()` meneriakkannya kalau
   berkasnya ada di folder tersinkron. `set-password` menulis ke berkas yang
   BENAR-BENAR dipakai — kalau tidak, gejalanya "sandi tersimpan" tapi sandi lama
   masih berlaku.
3. **Auto-start tanpa hak admin.** `ops/install-tasks.ps1` memasang tugas terjadwal
   yang menyalakan PostgreSQL lalu aplikasinya saat login, dan menghidupkan ulang
   sampai 3x kalau prosesnya mati. Dibuktikan: aplikasi dimatikan paksa, tugasnya
   dijalankan, port 3100 hidup lagi.
4. **Backup harian yang pemulihannya sudah diuji.** `ops/backup.bat`, 19:00, simpan 14
   hari. Dua hal ketemu waktu mengujinya sungguhan: `spatial_ref_sys` dan
   `COMMENT ON EXTENSION postgis` membuat tiap pemulihan berakhir dengan baris merah
   walaupun datanya lengkap — persis yang membuat orang panik saat benar-benar
   memulihkan. Dengan `--exclude-table` dan `--no-comments`, pemulihannya **nol error**
   dan tiap tabel cocok persis: 3.466 kelurahan, 9.609 penjualan, 21.336 jangkauan,
   geometri utuh 14.272 km².

**Sisanya:**

5. **Penanganan crash tingkat proses.** Satu promise gagal tanpa `.catch()` menjatuhkan
   Node, dan tidak ada yang menghidupkannya. Sengaja TIDAK memanggil `process.exit()`
   di penangannya: nasihat umum "matikan saja, keadaannya tidak bisa dipercaya" benar
   kalau ada supervisor — di laptop tim tanpa orang IT, mati berarti mati sampai ada
   yang menyadarinya.
6. **Log ke berkas.** 17 `console.*` yang hilang begitu jendela ditutup. `logger.js`
   menyadap `console` — bukan menyediakan API baru — supaya semua titik panggil yang
   sudah ada dan yang nanti ditulis ikut tercatat tanpa disentuh. Ditulis SINKRON:
   stream menahan baris di buffer, dan yang tertahan saat proses mati justru baris yang
   paling dibutuhkan. Disimpan 30 hari.
7. **Pembatas laju di rute PII.** `/api/customers/browse` mengirim 500 baris per
   permintaan tanpa throttle — 37 permintaan menyedot 18.512 baris. Sekarang 30 per
   menit, memakai ulang `RateLimiter` dari `auth.js`, dan ikut dipasang di
   `/api/customers`.
8. **Retensi arsip unggahan.** `uploads/` menyimpan tiap Excel selamanya, dan Excel itu
   memuat PII mentah. Sekarang 90 hari, dibersihkan waktu ada unggahan baru — bukan
   lewat penjadwal terpisah, karena penjadwal yang harus dipasang orang adalah
   penjadwal yang lupa dipasang.
9. **Dukungan HTTPS opsional.** Aktif hanya kalau `SSL_CERT`/`SSL_KEY` menunjuk berkas
   yang ada; salah tulis membuat server MENOLAK start, bukan diam-diam turun ke HTTP.
   TIDAK membuat sertifikat sendiri: layar peringatan merah mengajari orang menekan
   "lanjutkan saja".

**Verifikasi:** 13/13 berkas tes hijau (dua berkas baru: `hardening.test.js`,
`db.test.js`), **8/8 mutasi tertangkap** untuk perilaku baru, browser bersih di kelima
halaman lewat proses yang dinyalakan Task Scheduler, dan pemulihan backup cocok persis.

**Satu yang saya rusak sendiri dan perbaiki:** menghapus `.env` dari proyek memutus
`npm test` — semua tes database gagal karena tidak ada kredensial. Ditambal dengan
`.env.path`, berkas penunjuk berisi satu baris path (bukan rahasia, tetap di-gitignore).

**Yang masih belum, dan sengaja tidak diklaim:**

- **HTTPS belum benar-benar dipakai.** Mekanismenya ada, sertifikatnya tidak. Di LAN
  tertutup ini risiko yang diterima sadar; di VPS nanti Caddy yang mengurusnya.
- **Tugas terjadwal jalan saat LOGIN, bukan saat komputer menyala.** Untuk server yang
  tidak pernah ada yang login, PostgreSQL dan aplikasi harus jadi Windows service —
  butuh admin sekali. Langkahnya ditulis di `PINDAH.md`, belum dijalankan.
- **Node 20 masih belum diuji langsung** meski `engines` mengizinkannya.
- **Belum ada CI.** Tes jalan kalau ada yang ingat menjalankannya.
- **Proyeknya sendiri masih di dalam OneDrive** — 228 MB dan 6.177 berkas
  `node_modules` ikut tersinkron terus-menerus. Rahasianya sudah keluar; foldernya
  belum, dan itu keputusan pemilik proyek.

### Struktur folder dirapikan untuk produksi (2026-08-13)

Yang diubah, dan alasannya masing-masing:

- **Dokumen pindah ke `docs/`.** Akar sekarang cuma `README.md` (pintu masuk) dan
  `CLAUDE.md` (dibaca dari akar, tidak bisa dipindah). Semua tautan silang diperbarui
  dan diperiksa otomatis — nol tautan putus.
- **`test/test-db.js` -> `test/helpers/db.js`.** Dia helper, bukan tes, dan duduk di
  folder yang konvensinya "berkas di sini adalah tes".
- **`mysql2` pindah ke devDependencies.** Cuma dipakai `scripts/migrate-mysql.js`
  sekali jalan; di dependencies dia ikut terpasang di tiap server produksi selamanya.
- **`engines.node` 22.5.0 -> 20.11.0.** Batas lama dipilih karena `node:sqlite`, yang
  sudah tidak dipakai. Angka barunya berdasar: Express minta >=18, dan tidak ada API
  Node baru yang dipakai. **Belum diuji langsung di Node 20** — hanya diturunkan dari
  syarat dependensi.
- **`.gitignore` diperbaiki.** Sebelumnya mengabaikan `public/css/tailwind.css` yang
  tidak pernah ada, sementara artefak build sungguhan (`public/css/app.css`) TIDAK
  diabaikan. Ditambah `.env.*`, sampah OS, dan folder editor.
- **`.gitattributes` baru.** Ini yang menahan akhiran baris saat clone; `.editorconfig`
  hanya mengatur editor.
- **`.editorconfig` dan `.nvmrc` baru.**
- **Berkas `prototype/index.html - Shortcut.lnk` dibuang.**

**Satu bug ketemu sambil merapikan:** `start.bat` seluruhnya berakhiran LF. Itu berkas
yang diklik dua kali oleh tim tanpa orang IT, dan cmd.exe bisa salah membaca baris
terakhir. Sudah diubah ke CRLF dan dikunci lewat `.gitattributes`.

**Yang SENGAJA tidak diubah:** `prototype/` tetap di dalam proyek meski 5,8 MB — dia
memakai `src/core/coverage.js` yang sama dengan aplikasi, dan itulah yang membuat angka
di proposal tidak bisa menyimpang dari angka di aplikasi. Memindahkannya keluar
memutus impor itu.

### Halaman Data Konsumen (2026-08-13)

Halaman kelima. Sebelumnya konsumen cuma bisa dilihat lewat panel rincian kelurahan di
peta — harus klik poligon satu per satu. Sekarang ada tabelnya sendiri dengan penyaring
periode, kota, dealer, dan pencarian nama/alamat.

Isinya persis apa yang diunggah dari Excel: nama, alamat, kelurahan, kabupaten/kota,
pos dealer, periode.

**Penyaringannya dikerjakan SERVER, bukan browser.** Beda dari Master Kelurahan dan
Master Pos Dealer yang seluruh datanya memang dikirim ke browser sejak awal. 18 ribu
nama dan alamat tidak pernah dikirim sekaligus: `GET /api/customers/browse` memotong di
500 baris, melaporkan jumlah sebenarnya terpisah, dan mencatat tiap akses ke
`access_log`.

**Rute BARU, bukan pelonggaran rute lama.** `/api/customers` tetap menolak permintaan
tanpa kode kelurahan dan tetap diuji begitu. Jaminan yang sudah ada tidak diubah, cuma
didampingi jalur kedua yang batasnya berbeda dan tertulis.

Jumlah sebenarnya SELALU disebut di layar ("menampilkan 500 dari 18.512"). Tabel yang
diam-diam terpotong membuat orang menyimpulkan dari sebagian data tanpa tahu.

**Ada tombol Sebelumnya/Berikutnya.** Server menerima `offset`, dan tiga hal yang
gagalnya diam ikut ditangani:

- **`ORDER BY ... , id`** — tanpa pemecah seri, dua konsumen bernama sama urutannya
  tidak dijamin, dan urutan yang berubah antar permintaan membuat satu baris muncul dua
  kali di halaman 2 sementara baris lain tidak pernah terlihat.
- **Mengubah penyaring selalu kembali ke halaman 1** — kalau tidak, hasil baru yang cuma
  30 baris akan tampak kosong karena offsetnya masih di baris 1.500.
- **Offset yang lewat ujung dijepit ke AWAL halaman terakhir**, bukan ke baris terakhir.
  Dijepit ke `total-1` memberi satu baris sendirian, yang terlihat seperti datanya habis.

Tesnya menelusuri seluruh halaman dan memastikan **tiap baris terlihat tepat sekali**.
Datanya sengaja memuat baris kembar lebih banyak daripada satu halaman supaya derefan
nama yang sama MELINTASI batas halaman — dengan 300 baris kembar semuanya muat di
halaman pertama, serinya tidak pernah terbelah dan menghapus pemecah seri tidak membuat
satu tes pun merah. Sudah dicoba, dan itu sebabnya jumlahnya dinaikkan.

**Uji mutasi: 6/6 untuk paginasi, 4/5 untuk penelusuran** — yang kelima mutan
EKUIVALEN: titik setelah kode kota di `LIKE '34.04.%'` tidak menentukan perilaku selama
kode BPS lebar-tetap, jadi tidak ada data yang bisa membedakannya. Dicatat di kodenya,
bukan ditutupi dengan tes yang mengarang data mustahil.

### Pindah ke PostgreSQL + PostGIS, jangkauan dihitung eksak (2026-08-13)

Beberapa jam setelah pindah ke MySQL, muncul pertanyaan apakah PostgreSQL lebih cocok
"untuk mapping". **Premisnya perlu diluruskan dulu:** untuk aplikasi ini apa adanya
waktu itu, MySQL dan PostgreSQL sama saja — nol fungsi `ST_*`, nol kolom geometri,
poligon ada di berkas, hitungan di JavaScript. Yang membuat PostgreSQL unggul adalah
PostGIS, dan itu baru berlaku kalau hitungannya benar-benar dipindahkan ke sana.
Itulah yang dikerjakan; kalau tidak, ini cuma tukar mesin tanpa hasil.

**Hitungan jangkauan sekarang satu query.** `ST_Intersection` / `ST_Area` di UTM 49S,
eksak terhadap poligon yang ada, 2,8 detik untuk 78 outlet x 4 radius. Menggantikan
sampling Monte Carlo 1.000 titik per kelurahan.

**Angkanya cocok dengan cara lama sampai 0,1 poin:**

| radius | sampling (MySQL) | PostGIS |
|---|---|---|
| 3 km | 7,6% | 7,6% |
| 5 km | 15,1% | 15,1% |
| 7 km | 23,4% | 23,5% |
| 10 km | 34,1% | 34,2% |

Dua cara yang tidak berbagi satu baris kode pun mendarat di tempat yang sama. Itu
bukti terkuat yang bisa didapat bahwa dua-duanya benar.

**`src/core/coverage.js` sengaja DIPERTAHANKAN**, bukan sisa yang lupa dibuang.
Prototipe proposal memakainya (tidak punya database), dan sekarang dia jadi pembanding
independen di `test/coverage-postgis.test.js`.

**Tes silangnya menguji BIAS, bukan kesamaan per kelurahan.** Sampling memang berderau:
kelurahan yang tepinya dipotong lingkaran bisa meleset 3 poin, dan menjalankan sampling
dua kali dengan benih berbeda menghasilkan selisih sebesar itu juga. Yang tidak boleh
ada adalah bias sistematis. Diukur: bias -0,01 poin, rerata selisih 0,41 poin, sedangkan
derau sampling terhadap dirinya sendiri 0,34 poin. Batas tesnya diturunkan dari angka
ini, bukan ditebak.

**Empat jebakan yang ketahuan, semuanya gagal dengan diam:**

1. **Postgres menurunkan huruf semua alias yang tidak dikutip.** `AS outletCode` jadi
   kolom `outletcode`, dan `row.outletCode` jadi `undefined` — tanpa error, kolomnya
   cuma kosong di layar. Kena 25 alias di seluruh proyek. Semuanya sekarang dikutip.
2. **`pg` mengembalikan bigint dan numeric sebagai string.** Jebakan yang sama persis
   seperti DECIMAL di MySQL kemarin, penyebabnya beda, akibatnya identik: `'3' + '4'`
   jadi `'34'`. Ditangani sekali lewat `pg.types.setTypeParser`.
3. **`ST_Buffer` bawaannya membuat segi-32**, luasnya 0,65% lebih kecil daripada
   lingkaran, dan selalu ke arah yang sama sehingga biasnya tidak pernah saling
   menghapus — persis sebesar galat yang mau dihilangkan dengan pindah ke PostGIS.
   `quad_segs=32` menurunkannya ke 0,04%, dan tesnya mengukur langsung terhadap pi*r².
4. **`insertId` tidak ada di Postgres.** Tanpa `RETURNING id`, baris "berjalan" di
   riwayat impor tidak pernah bisa ditutup jadi 'ok' atau 'gagal'.

**Verifikasi:** 12/12 berkas tes hijau, **12/12 mutasi tertangkap** (termasuk
quad_segs dilepas, proyeksi diganti derajat, dan alias tidak dikutip), API mengembalikan
semua field camelCase utuh dengan tipe angka, dan di browser: filter dealer, klik baris
panel performa, `applyScope('kota')` semuanya mengubah KPI + jangkauan + panel
bersamaan. Konsol bersih, nol permintaan gagal.

**Data lama pindah utuh** lewat `npm run migrate-mysql` — 3.466 kelurahan, 78 outlet,
9.609 baris penjualan, 18.512 konsumen. Tabel `coverage` sengaja tidak ikut; dia
dihitung ulang PostGIS. Data MySQL belum dihapus.

**Dipasang tanpa hak admin.** Installer EDB butuh admin, jadi dipakai arsip ZIP binari
PostgreSQL 17.10 + bundle PostGIS 3.6.2 yang tinggal disalin, lalu `initdb` dan
`pg_ctl` seperti mysqld kemarin. Langkahnya ada di README.md.

**Yang jadi lebih repot:** `pg_dump`/`pg_restore` sekarang mensyaratkan PostGIS sudah
terpasang di server tujuan SEBELUM restore, kalau tidak gagal di tengah dengan pesan
tentang tipe `geometry`. Ditulis di PINDAH.md lengkap dengan gejalanya.

### Database pindah dari SQLite ke MySQL (2026-08-13)

Diminta pakai MySQL. Ganti total, SQLite dilepas — bukan dua jalur yang harus
dirawat bersamaan.

**Dua database, bukan dua berkas.** `astra` dan `astra_customers`. Sifat yang dijaga
sama persis seperti dulu: mencabut PII = satu perintah (`DROP DATABASE
astra_customers`), dan aplikasinya tetap jalan penuh tanpa itu. Yang berubah cuma
perintahnya, dari menghapus berkas jadi DROP DATABASE. Tesnya ikut berubah dan tetap
menguji sifat yang sama.

**Semuanya jadi async.** `node:sqlite` sinkron, mysql2 tidak, dan membungkusnya jadi
sinkron tidak mungkin dilakukan dengan benar. Konsekuensinya merambat ke `repository`,
`importer`, `coverage-store`, rute, dan semua skrip seed. Itu memang harga pindah ke
MySQL, dan lebih baik dibayar sekali daripada disembunyikan.

**Dua jebakan MySQL yang ketahuan lewat uji mutasi:**

1. `SUM(quantity)` bertipe DECIMAL, dan bawaannya mysql2 mengembalikan DECIMAL sebagai
   **string**. `'3' + '4'` jadi `'34'` di frontend tanpa satu pun error. Diperbaiki
   dengan `decimalNumbers: true`; matikan lagi dan `import.test.js` langsung merah.
2. Transaksi cuma berlaku pada SATU koneksi. `store.transaction(pool, fn)` sekarang
   mengambil satu koneksi dan mengopernya ke `fn` — BEGIN di satu koneksi pool dan
   INSERT di koneksi lain bukan transaksi yang sama, dan gagalnya tidak terlihat
   sampai ada yang perlu di-rollback.

Ada satu lagi yang tadinya lolos: menghapus `COMMIT` tidak membuat satu tes pun merah,
karena pool memakai koneksi yang sama sepanjang tes dan koneksi itu melihat tulisannya
sendiri. Ditambal dengan `queryOutsidePool()` di `test/test-db.js` — memeriksa lewat
koneksi kedua. Sekarang **5/5 mutasi MySQL tertangkap**.

**Tes tidak lagi memakai folder sementara.** Tiap berkas tes memakai database sendiri
(`astra_test_import`, `astra_test_coverage`), dibuang di awal dan di akhir. Butuh
hak tambahan untuk pengguna aplikasi:

```sql
GRANT ALL PRIVILEGES ON `astra\_test\_%`.* TO 'astra'@'%';
```

**Data lama pindah utuh.** `npm run migrate-sqlite` — 3.466 kelurahan, 78 outlet,
9.609 baris penjualan, 21.310 baris jangkauan, 18.512 konsumen. Jumlah tiap tabel
dicocokkan setelah pindah; kalau ada yang tidak sama skrip menolak menyatakan berhasil.

**Diverifikasi ujung ke ujung, bukan cuma dianggap jalan:** 10/10 berkas tes hijau,
API menghasilkan angka jangkauan yang sama persis dengan sebelum pindah (3 km 7,6% /
5 km 15,1% / 7 km 23,4% / 10 km 34,1%), 22 aset halaman tanpa satu pun 404, dan di
browser sungguhan: filter dealer, klik baris panel performa, dan `applyScope('kota')`
semuanya mengubah KPI, jangkauan, dan panel bersamaan — konsol bersih.

**Yang jadi lebih repot, dan tidak disembunyikan:** "pindah server = salin folder"
sudah tidak berlaku. Sekarang ada langkah `mysqldump` dan `mysql <`. Itu ditulis
lengkap di `PINDAH.md`, dengan cara memeriksa tiap langkah.

### Bisa dijalankan orang non-IT — fase 6 (2026-08-13)

- **`start.bat`** — klik dua kali. Menolak jalan kalau `.env` belum ada, dan
  menjalankan `npm install` sendiri kalau `node_modules` belum ada. Sengaja tidak
  menyembunyikan jendelanya: server yang mati diam-diam di latar belakang jauh lebih
  sulit ditolong daripada jendela yang menampilkan errornya.
- **`../README.md`** — cara menjalankan sehari-hari, memasang pertama kali (Node + MySQL),
  dan tabel gejala-penyebab untuk masalah yang paling sering.
- **`PINDAH.md`** — pindah ke laptop lain dan ke VPS Linux, tiap langkah ada cara
  memeriksanya sendiri. Termasuk systemd service, dan peringatan bahwa dump
  `astra_customers` memuat PII dan tidak boleh lewat email atau chat.
- **`.env.example`** — bagian MySQL lengkap dengan perintah `CREATE USER`/`GRANT`.
- `validate()` sekarang juga menolak start kalau `DB_USER` kosong.

### Analisis jangkauan dan UI prototipe masuk ke aplikasi (2026-08-13)

Empat masukan meeting yang dibangun di prototipe sekarang jalan di aplikasi asli
dengan data sungguhan.

**Analisis jangkauan jadi fungsi utama.** `src/core/coverage.js` — murni, tanpa I/O,
**dipakai bersama aplikasi dan prototipe** supaya angka di proposal dan angka di
aplikasi tidak bisa menyimpang. Rasionya: berapa bagian luas tiap kelurahan yang masuk
lingkaran radius, dihitung dengan sampling 1.000 titik per kelurahan.

Disimpan di tabel `coverage` (21.310 baris untuk 4 radius), diisi
`npm run seed-coverage` dalam 8 detik. **Menyunting koordinat satu outlet lewat
aplikasi memicu hitung ulang outlet itu sendiri** — kalau tidak, jangkauannya masih
menggambarkan lokasi yang sudah tidak dipakai, dan angkanya tetap tampak wajar.

**Angka nyata dari data asli:**

| Radius | Penjualan dalam jangkauan |
|---|---|
| 3 km | 7,7% |
| **5 km** | **15,1%** |
| 7 km | 23,4% |
| 10 km | 34,1% |

Outlet terendah 0%, tertinggi 52,8%. Jauh di bawah data sintetis prototipe (32,3% pada
5 km) karena pembangkitnya memusatkan penjualan di sekitar outlet, sedangkan konsumen
sungguhan jauh lebih menyebar. Itu temuan, bukan bug.

**Yang lain ikut pindah:** panel Analisis Performa menggantikan Peringkat Dealer,
kartu rekap dealer dengan chip per pos, `applyScope()` sebagai satu pintu untuk semua
klik, titik penjualan yang ikut filter, marker tiga tingkat (terpilih / sedealer /
abu), layar penuh, tombol Pas-kan, dan modal sunting pos dengan "ambil dari peta".

**Skema naik ke versi 2** dengan migrasi maju. Databasenya versi lebih baru daripada
aplikasinya ditolak — menulisinya dengan aplikasi lama bisa merusak data yang belum
dikenal.

**Verifikasi**: 10 berkas tes hijau, 9/9 mutasi jangkauan tertangkap, 0 error konsol
di semua tab dan interaksi. Diuji lewat browser: memindahkan pin outlet benar-benar
menulis ulang barisnya di tabel `coverage`, dan koordinat tertukar ditolak server.

**Perintah baru:** `npm run seed-coverage`

### Fase 3 + 4 + UI mengikuti prototipe (2026-08-13)

Aplikasi asli sekarang memakai tampilan dan alur dari prototipe proposal, dengan data
sungguhan dari SQLite.

**Database.** `node:sqlite`, dua berkas: `astra.db` (villages, outlets, sales,
unmatched, imports) dan `customers.db` (PII, terpisah). Mode WAL. `dealer_code` tidak
disimpan di tabel `sales` — diambil lewat JOIN ke `outlets`, jadi memperbaiki satu
pengelompokan langsung terlihat di seluruh dashboard tanpa impor ulang.

**Impor.** `npm run import -- <berkas> <YYYY-MM> [--konsumen]` dan tombol unggah di
web memakai mesin yang sama. Satu transaksi; gagal di tengah berarti rollback. Impor
ulang bulan yang sama mengganti, bukan menggandakan. Data konsumen hanya ikut
tersimpan kalau diminta secara eksplisit — bawaannya mati.

**Kecamatan akhirnya benar.** `kelurahan.geojson` tidak punya field kecamatan sama
sekali; tabel Master Kelurahan selama ini menampilkan `nama_kota` di bawah judul
"Kecamatan". Sekarang digabungkan dari `referensi_kelurahan.csv` lewat
`npm run seed-regions` — 3.466 kelurahan, kecamatan lengkap, nol yang kosong.

**Frontend** dipindah dari prototipe jadi 14 modul: heatmap persentil yang dihitung
ulang mengikuti filter, basemap satelit, titik penjualan, panel kelurahan terbagi dua
judul, klik POS yang menghitung ulang seluruh heatmap, 51 warna dealer, tab Import.

**Diverifikasi dengan data asli lewat browser**: 51 dealer, 18.512 unit, 3.027
kelurahan terlayani, 439 kosong — sama persis dengan pipeline lama. 78 marker, 51
warna. Unggah berkas 19.080 baris lewat web: 18.512 masuk (97,0%), 568 tidak cocok,
0 error konsol.

**Uji mutasi 10 dari 11 tertangkap.** Yang bertahan disengaja: klausa SQL yang
melindungi pengelompokan hasil kurasi adalah lapisan KEDUA — lapisan pertama ada di
`resolveGroups()` dan sudah diuji. Menghapus salah satunya tidak membuat tes merah
karena keduanya menjamin hal yang sama; alasannya ditulis di `importer.js`.

**Keputusan yang diambil sesi ini:**

- Spreadsheet ditunda. SQLite saja dulu; sambungan ke Google ditambahkan kalau memang
  diminta, dan pilihan mana pun masih terbuka.
- Kolom **nomor mesin** dan **bukti foto rumah** disembunyikan. Berkas bulanan dari
  Astra cuma punya 14 kolom dan tidak satu pun berisi nomor mesin; foto menunggu
  aplikasi mobile. Kolomnya sudah dirancang dan tinggal dinyalakan lewat
  `SHOW_ENGINE_NUMBER` / `SHOW_HOUSE_PHOTO` di `config.js`.
- Pencarian di dalam dropdown **dipertahankan**, tidak ikut dibuang seperti di
  prototipe. Dengan 51 dealer dan 78 pos, menggulir daftar sepanjang itu lebih lambat
  daripada mengetik tiga huruf.

**Perintah baru:**

```
npm run seed-regions    isi tabel wilayah dari geojson + referensi BPS (sekali)
npm run seed-outlets    pindahkan koordinat dan pengelompokan yang sudah dikurasi
npm run import -- <berkas> <YYYY-MM> [--konsumen]
```

### Prototipe proposal (2026-08-12)

Hasil meeting 12 Agustus. Berdiri sendiri di `prototype/`, tidak menyentuh aplikasi
asli. Lihat `prototype/README.md`.

Satu berkas `index.html` 5,4 MB, dibangun `node prototype/build.js` dari
`prototype/src/`. Bisa dobel-klik atau diseret ke Netlify. Geografi asli, **angka
penjualan dan data konsumen karangan** — Netlify memberi URL publik.

Yang berubah dari dashboard sekarang, semuanya permintaan meeting:

- 51 dealer, 51 warna berbeda; nama selalu menempel di sebelah warna
- semua kolom "Aksi" jadi angka penjualan/pelanggan
- tab **Import Data** baru: pilih periode → unggah → proses → tinjau & sunting →
  simpan; plus daftar periode tersimpan (satu bulan satu sheet)
- basemap **Satelit**; isian kelurahan otomatis jadi setengah tembus di atasnya
- klik POS = klik kotak: heatmap dihitung ulang hanya dari penjualan pos itu
- panel kelurahan dibagi dua judul: **Penjualan per Pos** dan **Konsumen**
- legenda berbasis **persentil**, dihitung ulang mengikuti filter
- **titik penjualan**: 19.174 titik acak di dalam kelurahannya, lapisan `circle`
- Data Konsumen: kolom **No. Mesin** dan **Bukti Foto**
- Master Kelurahan: kecamatan diperbaiki, kolom provinsi, urut provinsi → kabupaten →
  kecamatan → kelurahan, kolom dirapatkan
- Master Pos: tombol **Lihat Peta** yang memicu heatmap per pos

**Tiga bug di aplikasi asli ditemukan dan diperbaiki** — lihat bagian di bawah.

**Empat masalah tertangkap saat membangun prototipe:**

1. Batas kabupaten hasil dissolve sendiri jadi jaring merah: poligon kelurahan
   disederhanakan sendiri-sendiri, jadi tetangga tidak berbagi titik yang persis sama
   dan ratusan batas DALAM ikut lolos. Diganti `kota.geojson` yang sudah dihasilkan
   pipeline Python dengan dissolve geometri sungguhan.
2. Berkas hasil 10,3 MB; separuhnya data konsumen. Dipindah jadi dirakit di browser
   dari baris fakta, dengan benih tetap. Turun jadi 5,4 MB.
3. Legenda persentil menampilkan rentang mustahil ("2–1") waktu filternya sempit dan
   keempat batas jatuh di angka yang sama. Rentangnya sekarang diambil dari nilai yang
   benar-benar jatuh di tiap kelas, dan kelas kosong ditandai "—".
4. `setTreemapView` tidak pernah dipanggil saat boot, jadi tombol dan state bisa
   berbeda — dua sumber kebenaran untuk satu hal.

**Perlu diputuskan kalau proposalnya diterima:** permintaan "output ke spreadsheet,
sheet baru per bulan" menghidupkan kembali Spreadsheet sebagai penyimpan, sedangkan
Fase 3 sudah diputuskan SQLite. Spreadsheet sebagai tujuan ekspor, atau sebagai sumber
kebenaran? Keduanya bisa; dua-duanya sekaligus tidak.

### Perbaikan bug Fase 2 (2026-08-12)

Tiga handler di dalam HTML yang **dibangun JavaScript** tidak ikut terganti waktu
modularisasi: `openKelurahanDetail`, `pilihEntitas`, `showKonsumenDetail`. Klik
kelurahan di peta, klik kotak treemap, dan tombol Detail konsumen semuanya mati.

`page.test.js` meloloskannya karena hanya memindai `index.html`. Sekarang memindai
markup statis **dan** template literal di seluruh modul. Diuji dengan mengembalikan
satu nama basi — tesnya merah.

### Fase 2 — frontend jadi modul + library lokal (2026-08-12)

`Index.html` 1.565 baris jadi `public/index.html` 236 baris markup + 13 modul ES
(1.404 baris). Nama fungsi, variabel, dan state jadi bahasa Inggris; komentar tetap
Indonesia.

| Modul | Isi |
|---|---|
| `config.js` | sumber data, basemap, konstanta |
| `state.js` | objek `S` bersama |
| `dom.js` | `esc`, `formatNumber`, `$`, `toast`, `bbox`, `quantileBreaks`, `sumBy` |
| `colors.js` `geo.js` | murni, dipakai tes Node juga |
| `filters.js` | `activeRows()`, riwayat, tombol kembali |
| `map.js` `outlets.js` | peta, lapisan, marker, jangkauan |
| `customers.js` | PII, hanya hidup kalau berkasnya ada |
| `render.js` `tables.js` | KPI, legenda, treemap, peringkat, tabel, tab |
| `select-search.js` `app.js` | dropdown pencarian, boot, `HANDLERS` |

**Library diturunkan ke `public/vendor/`** (2,9 MB): MapLibre 5, PMTiles, ApexCharts,
protomaps-themes-base, ikon Phosphor, font Manrope + JetBrains Mono. Tailwind dibangun
sekali ke `public/css/app.css` (32 KB). `npm run vendor` dijalankan otomatis sesudah
`npm install`, jadi pindah server tetap "salin folder → npm install → npm start".

**Basemap tidak lagi butuh proses terpisah.** Dulu menunjuk `pmtiles serve` di port
8788 — satu program lagi yang harus dinyalakan orang. Sekarang berkas `.pmtiles`
disajikan apa adanya dan `pmtiles.js` mengambil potongan lewat Range request.

**Diverifikasi di browser**: 51 dealer, 18.512 unit, 3.027 kelurahan terlayani, 439
kosong, 78 marker dalam 9 warna dengan pembagian yang identik dengan sebelum migrasi
(8 biru Nusantara Sakti, 6 oranye Kompo Motor, 52 abu). Peta, label kelurahan, batas
kota merah, legenda, dan treemap semuanya tampil. **Nol permintaan keluar** —
dihitung dari network log, bukan dari membaca markup.

**Tes baru**: `test/page.test.js`. Selain penjaga lama (handler ada, id ada, escape,
PII terkurung), ada dua yang khusus untuk struktur modul: setiap `import` harus
menunjuk nama yang benar-benar diekspor, dan satu modul tidak boleh mendeklarasikan
nama yang juga di-import. Yang kedua ditambahkan setelah `circle` bentrok dan
mematikan seluruh halaman dengan satu baris di konsol.

**Empat bug tertangkap saat migrasi**, semuanya kelas "gagal diam":

1. Tailwind **tidak menulis ulang `url()`** di CSS yang di-`@import`. Font dan ikon
   akan 404 dan halaman tetap tampil — cuma ikonnya jadi kotak. CSS vendor akhirnya
   ditautkan terpisah dari markup.
2. Glyph label peta diambil dari `demotiles.maplibre.org`. Diblokir = peta tetap ada,
   namanya hilang. Sekarang diunduh sekali oleh `npm run vendor`.
3. Rename global menyentuh **isi string dan teks**: `'filter-kota'` (id elemen di
   markup) jadi `'filter-cities'`, dan kata "konsumen" di kalimat Indonesia jadi
   "customers". Diperbaiki dengan pemindai yang membedakan kode dari string, komentar,
   dan literal regex.
4. `defer` pada tag library membuatnya jalan **setelah** skrip inline. Hilang sendiri
   begitu skripnya jadi `type="module"`.

### Fase 1 — login (2026-08-12)

- `src/server/auth.js` — scrypt (`node:crypto`) untuk sandi, cookie HMAC stateless
  untuk sesi, `RateLimiter` per IP. Tanpa dependensi kriptografi dari npm.
- `src/server/app.js` — Express 5. Penjaganya ditulis "tolak semua kecuali yang
  terdaftar", jadi rute baru otomatis terlindungi kalau lupa didaftarkan.
- `src/server/config.js` — satu-satunya pembaca `.env`. Menolak start kalau
  `PASSWORD_HASH` kosong atau `DATA_DIR` jatuh di folder yang disinkronkan.
- `public/login.html` — berdiri sendiri, tanpa Tailwind dan tanpa font dari internet.
  Halaman login harus tampil benar meskipun build CSS belum jalan.
- `scripts/set-password.js` — `npm run set-password`, menanyakan sandi tanpa
  menampilkannya, menulis hash ke `.env`.
- `src/server/index.js` — mengikat `0.0.0.0` dan mencetak alamat LAN yang harus dibuka
  rekan, bukan cuma nomor port.

**Tes**: 6 berkas hijau. `auth.test.js` menguji fungsinya, `server-auth.test.js`
menembak rutenya lewat HTTP sungguhan — dua hal berbeda, dan yang kedua yang menangkap
"middleware-nya lupa dipasang".

Uji mutasi 15/15 tertangkap. Dua celah ditemukan dan ditutup:

- daftar putih rute diuji dengan `/login` saja, jadi mengubahnya jadi
  `startsWith('/log')` lolos — sekarang `/logs`, `/login-lama`, `/loginx` ikut diuji
- perbandingan timing-safe **tidak punya perilaku yang bisa diamati**: mengganti
  `timingSafeEqual` dengan `!==` menolak pemalsuan yang sama persis. Dijaga dengan
  pemeriksaan sumber — satu-satunya di proyek ini, dan disengaja, karena alternatifnya
  bukan pemeriksaan yang lebih baik melainkan tidak ada pemeriksaan sama sekali.

**Diuji di browser sungguhan**: sandi salah → "Sandi salah.", sandi benar → dialihkan
ke `/`. Chrome memperingatkan form sandi tanpa field username; ditambahkan field
tersembunyi supaya password manager mau menyimpan — tim yang tidak bisa mengandalkan
browser akan menulis sandinya di tempat yang lebih buruk.

**Catatan**: `/` masih 404 sampai Fase 2 selesai. 404-nya sudah berupa halaman yang
bisa dibaca orang, bukan "Cannot GET /".

### Fase 0 — kerangka + logika inti (2026-08-12)

- Struktur `src/core` (murni, tanpa I/O), `public/js`, `test/`.
- Logika inti dipindah dari `md-command-center-uji/Code.js` dengan nama Inggris:
  `normalizeName`, `toDottedCityCode`, `regionKey`, `aggregate`, `mergeAggregates`.
- `src/core/grouping.js` dibuat murni — bagian baca/tulis berkasnya dikeluarkan ke
  pemanggil. Ini yang membuatnya bisa dipakai server maupun CLI tanpa duplikasi.
- `colors.js` dan `geo.js` ditaruh di `public/js/` sebagai ES module, bukan di
  `src/core/`. Keduanya murni presentasi dan harus di-import browser; menaruhnya di
  `src/core` berarti menyalinnya dua kali. Tesnya meng-`import()` berkas yang sama
  persis dengan yang dikirim ke browser, jadi tidak ada salinan yang bisa menyimpang.
- `public/js/package.json` berisi `{"type":"module"}` — menandai folder itu ESM.
  Tanpa itu Node mewarisi `"type":"commonjs"` dari akar dan tesnya gagal parse.

**Tes**: 4 berkas hijau (`aggregate`, `colors`, `csv`, `geo`). Uji mutasi 15/15
tertangkap; dua celah ditemukan dan ditutup di putaran pertama:

- urutan baris fakta tidak diuji karena data ujinya kebetulan sudah terurut
- pemisah nama `" - "` vs `"-"` tidak diuji karena belum ada nama berhubung di data

**Bukti terhadap data asli**: logika baru dijalankan atas
`Heatmap4 - INPUT UTAMA.csv` (19.080 baris) dan hasilnya identik dengan
`agregat.json` bangunan logika lama di kelima metrik — 18.512 unit, 9.609 baris
fakta, 78 outlet, 51 dealer, 3.027 kelurahan dilayani, cocok 97,0%.

**Belum diport** (menunggu frontend ada, Fase 2): `test_halaman.js`,
`test_riwayat.js`, `test_cari.js` di `md-command-center-uji/`. Ketiganya menguji
markup dan interaksi halaman, jadi tidak ada yang bisa diuji sampai halamannya
dipecah. JANGAN dianggap hilang — tiga berkas itu yang menjaga "handler markup
benar-benar ada", "PII bisa dicabut", dan "semua nilai dari Excel di-escape".

## Diblokir

Belum ada.

---

## Perubahan bentuk data yang perlu diingat

**`aggregate()` tidak lagi mengembalikan `dealer_code`.** Baris agregat sekarang
`[period, villageCode, outletCode, quantity]` — empat kolom, bukan lima. Dealer
diambil lewat JOIN ke tabel `outlets` saat query.

Alasannya: kalau `dealer_code` ikut disalin ke tiap baris agregat, memperbaiki satu
pengelompokan outlet berarti harus menulis ulang ratusan ribu baris, dan yang lupa
ditulis ulang jadi diam-diam salah. Ini konsekuensi langsung dari keputusan memakai
database — lihat DECISIONS.md.

**Kolom 5 di Excel itu kode pos surat, bukan kode outlet.** Dinamai `postalCode` dan
tidak pernah dipakai sebagai identitas. Kode outlet ada di kolom 7, yang di Excel
diberi judul "Kode Dealer" — judul yang menyesatkan dan sudah pernah membuat kode
lama salah selama berminggu-minggu. Penamaan di sini sengaja mengikuti kenyataan,
bukan judul kolomnya.

---

## Utang yang dibawa dari versi percobaan

- ~~`dealer_grup.csv` masih hasil tebakan dari nama outlet.~~ **Beres 2026-08-16.**
  Tebakannya masih jadi isian awal — itu memang perannya — tapi sekarang bisa
  diperbaiki lewat halaman Master Pos Dealer, dan perbaikannya tidak ditimpa impor
  bulanan. Peredam yang dijanjikan CLAUDE.md akhirnya benar-benar ada.
- 433 baris data di luar 15 kabupaten cakupan — belum diputuskan dilebarkan atau
  dibuang.
- 132 baris / 29 nama kelurahan belum cocok dan perlu verifikasi manual.
- 52 dari 78 outlet bermarker abu karena kuota 8 warna. Bukan bug — hasil validasi
  palet. Perlu dijelaskan ke pengguna, bukan diperbaiki.
