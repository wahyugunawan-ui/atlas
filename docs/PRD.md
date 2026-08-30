# PRD — Astra Command Center

Apa yang produk ini harus bisa, buat siapa, dan angkanya berarti apa.

Ditulis mundur dari sistem yang sudah berjalan (2026-08-17), bukan dari niat awal. Tiap
angka di sini diukur dari database dan kode, bukan dikutip dari dokumen lama — sebagian
angka di ROADMAP sudah tertinggal.

---

## 1. Peta dokumen

Baca sesuai pertanyaannya. Jangan baca semuanya.

| Pertanyaan | Dokumen |
|---|---|
| **Produk ini harus bisa apa?** | **berkas ini** |
| Bagaimana cara menjalankan dan merawatnya? | [../README.md](../README.md) |
| Aturan apa yang berlaku waktu menulis kode di sini? | [../CLAUDE.md](../CLAUDE.md) |
| Kenapa pilihan teknisnya begitu? | [DECISIONS.md](DECISIONS.md) |
| Apa yang sudah dikerjakan, kapan, dan apa yang belum? | [ROADMAP.md](ROADMAP.md) |
| Bagaimana pindah ke server lain? | [PINDAH.md](PINDAH.md) |
| Dulu rencananya apa? | [archive/PLAN-2026-08-12.md](archive/PLAN-2026-08-12.md) — **sudah tidak berlaku** |

Developer baru: `README.md` → berkas ini → `CLAUDE.md`. Tiga itu cukup untuk mulai.
`DECISIONS.md` dibaca waktu hendak mengubah keputusan, bukan di awal.

---

## 2. Pengguna dan masalah

**Penggunanya** tim channel Astra Motor: 5–20 orang, latar belakang keuangan dan
penjualan, bukan teknis. Satu akun dipakai bersama.

**Tidak ada tim IT di tim mereka.** Itu bukan latar belakang — itu batasan paling
mengikat di seluruh dokumen ini, dan hampir semua keputusan di bagian 5 berasal
langsung darinya. Apa pun yang butuh orang untuk merawatnya waktu rusak (Docker, nginx,
sertifikat yang kedaluwarsa tiap 90 hari, klaster database) berada di luar cakupan
BUKAN karena teknisnya sulit, tapi karena tidak ada yang bisa memperbaikinya jam 8 pagi
sebelum rapat.

**Masalahnya:** tiap bulan Astra mengirim satu berkas Excel berisi ±19.000 baris
penjualan motor, satu baris per unit terjual, lengkap dengan kelurahan pembeli dan pos
dealer yang menjualnya. Yang ingin dijawab tim:

- Kelurahan mana yang penjualannya besar, dan mana yang kosong?
- Berapa bagian wilayah yang benar-benar terjangkau pos yang ada?
- Kalau mau buka pos baru, di mana lubangnya?
- Dealer mana yang tumbuh, mana yang tidak?

Sebelum ada aplikasi ini, jawabannya dirakit manual dengan pivot table dan tidak ada
petanya sama sekali.

---

## 3. Definisi angka

Bagian paling penting di dokumen ini. Angka-angka ini masuk laporan ke manajemen, dan
salah paham di sini menghasilkan angka yang **terlihat benar**.

### unit

Satu baris Excel = satu unit terjual. **Tanpa dedupe per konsumen** — satu orang yang
membeli dua motor terhitung dua, dan itu memang yang diinginkan karena yang diukur
distribusi barang, bukan jumlah kepala. Keputusan ini ada di `DECISIONS.md`
[2026-08-09].

Yang disimpan agregat per `(periode, kelurahan, pos)`, bukan baris per konsumen.

### pos dan dealer

| | |
|---|---|
| **pos** (`outlet`) | Titik fisik penjualan. Kodenya datang dari Excel Astra dan **harus sama persis** dengan yang dipakai Astra — kalau beda, impor berikutnya membuat pos kedua dan penjualannya terbelah tanpa gejala apa pun. |
| **dealer** | Pengelompokan beberapa pos di bawah satu badan usaha. |

`dealer_code` **ditentukan server** dari nama, tidak pernah dikirim browser. Nama dealer
yang sama memakai ulang kode yang sudah ada, supaya tidak muncul dua dealer bernama
persis sama. Pengelompokan awalnya tebakan dari nama pos, dan tim bisa membetulkannya
sendiri lewat halaman Master Pos Dealer.

Sejak 2026-08-30, dealer punya tabelnya sendiri (`dealers`) dan halamannya sendiri
(Master Dealer) — alamat dan koordinat kantor dealer disimpan di situ, terpisah dari
pos. `outlets.dealer_code` menunjuk ke sana lewat FOREIGN KEY sungguhan, bukan lagi
kolom string yang kebetulan konsisten.

### jangkauan (coverage)

**Berapa bagian LUAS sebuah kelurahan yang masuk lingkaran radius sebuah pos.** Bukan
jarak titik-tengah kelurahan ke pos.

Bedanya besar dan disengaja: kelurahan yang luas dan memanjang bisa titik tengahnya di
luar radius padahal separuh wilayahnya di dalam. Dihitung PostGIS dengan
`ST_Intersection` / `ST_Area`, jadi eksak terhadap poligon yang ada.

**"Eksak" ada batasnya dan batas itu harus disebut:** poligonnya sudah disederhanakan,
dan asumsi "konsumen tersebar merata di dalam kelurahannya" tetap berlaku. Yang hilang
cuma derau hitungan; galat modelnya jauh lebih besar dan itu tidak bisa dihilangkan
dengan geometri yang lebih teliti. Kalimat asumsi ini tetap dipasang di panel, bukan
disembunyikan.

### kelurahan terlayani dan kelurahan kosong

Penyebutnya **bukan** 8.999 kelurahan yang ada di database, tapi **4.003**: yang punya
penjualan ATAU masuk radius sebuah pos.

Ini keputusan produk, bukan optimasi. Tanpa penyaring, "Kelurahan Kosong" melonjak
439 → 5.673 dan berubah makna diam-diam: dari *"kelurahan di wilayah kita yang belum ada
penjualan"* jadi *"kelurahan di seluruh Jawa Tengah yang tidak kita jual"*. Angka kedua
benar secara hitungan, tidak berguna secara bisnis, dan di layar terlihat seperti
kemunduran drastis.

### kelurahan tanpa poligon

**Dikeluarkan dari persentase jangkauan dan dilaporkan terpisah** — tidak dihitung
sebagai "di luar jangkauan".

Alasannya: tanpa poligon rasionya selalu 0, dan nol itu ambigu. "0% terjangkau" dan
"belum bisa dihitung" terlihat sama persis di layar, dan yang kedua akan menurunkan
persentase tanpa sebab yang terlihat — turunnya tampak seperti temuan bisnis padahal
cuma data belum lengkap.

Sekarang tidak ada satu pun jalur yang membuat kelurahan tanpa poligon. Penanganannya
tetap ada sebagai jaring pengaman: kebenaran angka tidak boleh bergantung pada fitur
mana yang kebetulan sedang ada.

### belum cocok (unmatched)

Baris Excel yang nama kelurahannya tidak ketemu padanannya. **Tidak pernah dibuang
diam-diam** — jumlah dan namanya selalu dilaporkan.

Pencocokan **tiga tingkat**: kabupaten → kecamatan → kelurahan. Dua tingkat tidak cukup;
diuji atas 3.466 kelurahan, `kode_kota + nama` tabrakan di 171 tempat (Cilacap punya dua
"Tambakreja"), tiga tingkat nol tabrakan.

### periode

`YYYY-MM`. Satuan impor sekaligus **satuan idempotensi**: mengimpor ulang periode yang
sama menghapus dan menulis ulang periode itu saja, dan tidak menyentuh bulan lain.

### kode wilayah

Kode BPS/Kemendagri **bertitik**: `34.04.01.2001` untuk kelurahan, `34.04` untuk
kabupaten/kota. **Tidak pernah diturunkan dari nama.** Nama bisa beda ejaan antar
berkas; kode tidak.

---

## 4. Kebutuhan fungsional

Format: ID, pernyataan, lalu penjaganya. `belum dijaga` berarti benar-benar belum ada
tes untuknya — ditulis apa adanya supaya daftarnya berguna.

### KF-AUTH — masuk dan sesi

| ID | Kebutuhan | Dijaga |
|---|---|---|
| KF-AUTH-1 | Masuk dengan satu sandi bersama; berhasil = cookie sesi berlaku 12 jam | `test/auth.test.js` |
| KF-AUTH-2 | Semua rute selain `/login` dan aset publik menolak permintaan tanpa sesi sah, termasuk rute yang tidak dikenal | `test/server-auth.test.js` |
| KF-AUTH-3 | Percobaan masuk dibatasi 5 per menit per IP | `test/auth.test.js`, `test/server-auth.test.js` |
| KF-AUTH-4 | Sandi disimpan sebagai hash scrypt bersalt; perbandingan tanda tangan timing-safe | `test/auth.test.js` |
| KF-AUTH-5 | Cookie `HttpOnly` + `SameSite=Lax`; cookie palsu dan kedaluwarsa ditolak | `test/auth.test.js`, `test/server-auth.test.js` |

Sesi **stateless** (cookie bertanda tangan HMAC): restart server tidak menendang
siapa pun, dan banyak orang login bersamaan jalan dengan sendirinya.

### KF-IMPOR — Excel bulanan masuk

| ID | Kebutuhan | Dijaga |
|---|---|---|
| KF-IMPOR-1 | Unggah `.xlsx` atau `.csv` lewat halaman, pilih periode `YYYY-MM` | `test/import.test.js`, `test/xlsx.test.js`, `test/csv.test.js` |
| KF-IMPOR-2 | **Idempoten** — impor ulang periode yang sama tidak menggandakan apa pun | `test/import.test.js` |
| KF-IMPOR-3 | Satu transaksi — gagal di tengah meninggalkan data lama utuh, bukan setengah | `test/import.test.js` |
| KF-IMPOR-4 | Kunci sekali-jalan — impor kedua yang bersamaan ditolak dengan pesan yang bisa dimengerti orang non-IT | `test/import.test.js` |
| KF-IMPOR-5 | Baris yang tidak cocok dilaporkan jumlah dan namanya, tidak dibuang | `test/import.test.js`, `test/aggregate.test.js` |
| KF-IMPOR-6 | Pos yang baru muncul di Excel dibuat otomatis; pengelompokan dealernya ditebak dari nama | `test/import.test.js` |
| KF-IMPOR-7 | **Suntingan manusia tidak ditimpa impor** — koordinat hasil pin dan perpindahan dealer bertahan | `test/import.test.js` |
| KF-IMPOR-8 | Nama berkas dari pengguna tidak bisa keluar dari folder tujuan | `test/import.test.js` |
| KF-IMPOR-9 | Tiap impor tercatat: waktu, IP, nama berkas, jumlah baris, hasil — termasuk yang gagal | `test/import.test.js` |
| KF-IMPOR-10 | Berkas asli diarsipkan; arsip yang lewat 90 hari dibuang sendiri | `test/hardening.test.js` |
| KF-IMPOR-11 | Server tidak menyimpan data konsumen kalau permintaannya tidak meminta | `test/import.test.js` |
| KF-IMPOR-16 | Impor lewat halaman **selalu** menyimpan nama dan alamat — tidak ada pilihan untuk menolak | `test/page.test.js` |
| KF-IMPOR-17 | Absennya field `withCustomers` berarti **simpan**; hanya `0` yang eksplisit mematikannya | `test/server-auth.test.js` |
| KF-IMPOR-18 | Halaman impor tetap memberitahukan bahwa data pribadi ikut tersimpan | `test/page.test.js` |
| KF-IMPOR-12 | Satu periode bisa dihapus seluruhnya — penjualan, daftar belum cocok, dan data konsumennya | `test/import.test.js` |
| KF-IMPOR-13 | Menghapus periode **wajib mengetik ulang periodenya**, dan itu diperiksa di server, bukan cuma di layar | `test/server-auth.test.js` |
| KF-IMPOR-14 | Berkas Excel di arsip **tidak** ikut terhapus — impor ulang berkas yang sama memulihkan keadaannya persis | `test/import.test.js` |
| KF-IMPOR-15 | Penghapusan periode tercatat di riwayat impor | `test/import.test.js` |

**KF-IMPOR-14 adalah jalan pulih satu-satunya, dan itu keputusan sadar.** "Hapus bulan"
tidak menghapus berkas Excel-nya, jadi salah klik masih bisa dibatalkan dengan mengimpor
ulang berkas yang sama — dan idempotensi (`KF-IMPOR-2`) yang membuat hasilnya persis
sama. Konsekuensinya PII di arsip belum hilang saat itu juga; dia terbuang lewat
retensi 90 hari (`KNF-PRIVASI-5`).

### KF-FILTER — bilah penyaring

Satu bilah kendali yang sama untuk semua halaman, tapi nilainya berdiri sendiri di tiap
halaman. Ditambahkan 2026-08-29 atas permintaan tim menjelang presentasi HO.

| ID | Kebutuhan | Dijaga |
|---|---|---|
| KF-FILTER-1 | Bilah penyaring selalu terlihat, tidak ikut menggulir bersama isi halaman | `test/page.test.js` |
| KF-FILTER-2 | Bilah muncul di semua halaman kecuali Import Data | `test/page.test.js` |
| KF-FILTER-3 | Nilai penyaring **terpisah per halaman** — menyaring di Insight & Peta tidak mengubah angka di halaman lain | `test/filters.test.js` |
| KF-FILTER-4 | Periode berupa **rentang** "bulan dari" – "bulan sampai"; bulan dan tahun dua-duanya dipilih dari daftar | `test/page.test.js` |
| KF-FILTER-5 | Ujung rentang yang menyilang diseret, bukan ditolak — isian tidak pernah jadi jalan buntu | `test/filters.test.js` |
| KF-FILTER-11 | Memilih tanda hubung berarti "tanpa batas di sisi itu", bukan hasil kosong | `test/filters.test.js` |
| KF-FILTER-13 | Daftar tahun tidak dibatasi periode yang sudah diimpor | `test/page.test.js` |
| KF-FILTER-6 | Periode, provinsi, kabupaten, dealer, dan pos **semuanya independen** dan di-AND-kan — sejak 2026-08-30, bukan lagi hanya satu dari kabupaten/dealer/pos yang aktif | `test/filters.test.js` |
| KF-FILTER-7 | Memilih ulang nilai yang sama mematikan SLOT ITU SAJA, lewat dropdown maupun klik di peta — slot lain tidak ikut terpengaruh | `test/filters.test.js` |
| KF-FILTER-8 | Rentang periode berlaku sampai ke database untuk halaman Data Konsumen | `test/import.test.js` |
| KF-FILTER-9 | Rentang periode terbalik ditolak `/api/customers` (400) dan menghasilkan nol baris di `/api/customers/browse` | `test/server-auth.test.js` |
| KF-FILTER-10 | Dropdown kabupaten, dealer, dan pos punya kotak pencarian DI DALAM panelnya | `test/page.test.js` |
| KF-FILTER-12 | Filter yang sedang menyempitkan tampilan terlihat berbeda dari yang tidak | `test/page.test.js` |

**KF-FILTER-6 berubah 2026-08-30.** Sampai saat itu, kabupaten/dealer/pos berbagi satu
slot `{scopeKind, scopeCode}` dan dijamin saling eksklusif oleh BENTUK DATANYA (dua
lingkup aktif bersamaan tidak bisa direpresentasikan sama sekali) — bukan kode penjaga.
Panel ringkasan gabungan kota+dealer butuh keduanya aktif sekaligus, jadi slotnya
dipecah jadi tiga field independen (`cityCode`/`dealerCode`/`outletCode`), di-AND-kan
seperti `province` yang sudah independen sejak awal. Alasan lengkapnya di
`docs/DECISIONS.md`. Konsekuensinya: drill-down "klik dealer lalu klik salah satu
posnya di kota yang sama" sekarang MUNGKIN, dan itu memang yang diminta.

**KF-FILTER-3 menutup kebocoran yang sudah ada sejak lama**, bukan cuma menambah fitur.
Sebelumnya tabel Master Pos dan Master Kelurahan menyaring barisnya dengan penyaringnya
sendiri tapi menghitung kolom angkanya dengan penyaring halaman Peta — dua halaman
menjawab pertanyaan yang sama dengan angka yang berbeda.

### KF-PETA — Insight & Peta

| ID | Kebutuhan | Dijaga |
|---|---|---|
| KF-PETA-1 | Peta choropleth kelurahan diwarnai menurut **Kontribusi Penjualan** (% terhadap total kotanya sendiri) — sejak 2026-08-30, bukan lagi unit mentah | `test/sales-stats.test.js`, `test/colors.test.js` |
| KF-PETA-2 | Empat KPI: Dealer Aktif, Total Penjualan, Kelurahan Terlayani, Kelurahan Kosong | `test/page.test.js` |
| KF-PETA-3 | Penyaring periode, kabupaten, dealer, dan pos; seluruh panel ikut berubah (aturannya di KF-FILTER) | `test/colors.test.js` |
| KF-PETA-4 | Warna dealer **stabil terhadap penyaring** — dealer yang bertahan tidak berganti warna | `test/colors.test.js` |
| KF-PETA-5 | Panel performa pos menampilkan persen penjualan di dalam radius terpilih | `test/coverage-split.test.js` |
| KF-PETA-6 | Radius bisa diganti antara 3/5/7/10 km tanpa hitung ulang | `test/coverage-store.test.js` |
| KF-PETA-7 | Penjualan di kelurahan tanpa poligon dikeluarkan dari persentase DAN dilaporkan terpisah | `test/coverage-split.test.js` |
| KF-PETA-8 | Halaman bisa membedakan "0% terjangkau" dari "jangkauan belum pernah dihitung" | `test/coverage-split.test.js` |
| KF-PETA-9 | Klik kelurahan membuka rincian: daftar pos dan porsinya | `test/page.test.js` |
| KF-PETA-10 | Treemap kontribusi dealer dan pos | belum dijaga |
| KF-PETA-11 | Basemap bisa diganti antara peta lokal, citra satelit, dan polos | `test/page.test.js` |
| KF-PETA-12 | Basemap yang tidak dipilih dimatikan **seluruhnya**, termasuk lapisan yang tidak punya `source` | `test/page.test.js` |
| KF-PETA-13 | Klik dealer bisa dibuka jadi sebaran per kabupaten lalu per kelurahan, lengkap dengan unit dan % jangkauannya | `test/coverage-split.test.js` |
| KF-PETA-14 | Sebaran itu dihitung di browser — nol permintaan ke server sampai satu kelurahan diklik | `test/coverage-split.test.js` |
| KF-PETA-15 | Kursor di atas kelurahan menampilkan unit dan % jangkauannya, plus angka kabupatennya — tanpa klik | `test/page.test.js` |
| KF-PETA-16 | Lingkaran radius di peta mengikuti radius yang dipilih (3/5/7/10 km), bukan nilai tetap | `test/page.test.js` |
| KF-PETA-17 | Nama dan batas kecamatan bisa dinyalakan sendiri lewat Opsi Peta, terpisah dari mode edit ring | `test/page.test.js` |
| KF-PETA-18 | Peta berada tepat di bawah empat blok ringkasan | belum dijaga |
| KF-PETA-19 | Daftar performa pos bisa dibalik urutannya (persentase terkecil / terbesar) | `test/page.test.js` |
| KF-PETA-20 | Daftar performa bisa digulir otomatis berulang, untuk layar yang diproyeksikan | `test/page.test.js` |
| KF-PETA-21 | Daftar performa bisa dibuka layar penuh; isinya dari sumber yang sama dengan panel biasa | `test/page.test.js` |
| KF-PETA-22 | Tabel master mengisi tinggi yang tersisa, tanpa sisa ruang kosong di bawahnya | `test/page.test.js` |
| KF-PETA-23 | Panel rincian kelurahan tidak menutupi tombol kendali peta | `test/page.test.js` |
| KF-PETA-24 | Panel Opsi Peta muat seluruhnya tanpa digulir; legenda dilipat | `test/page.test.js` |
| KF-PETA-25 | Di layar penuh, bilah filter satu baris dan dropdown-nya tidak terpotong wadahnya | `test/page.test.js` |
| KF-FILTER-15 | Bilah filter muat satu baris di layar ~980 px, dan melipat rapi kalau lebih sempit | `test/page.test.js` |
| KF-FILTER-14 | Dropdown filter selalu muat di layar: tingginya mengikuti ruang yang ada, membuka ke atas kalau perlu | `test/page.test.js` |

**KF-PETA-11 satu-satunya fitur yang butuh internet**, dan itu disengaja: citra
satelitnya dari Esri, diminta di meeting. Peta lokal (PMTiles) tetap jalan penuh tanpa
jaringan keluar, jadi menutup internet mendegradasi satu pilihan basemap — bukan
mematikan halaman.

**KF-PETA-12 kelihatan seperti detail teknis, tapi dia yang pernah rusak.** Daftar
lapisan basemap ditangkap dari tema waktu peta dibuat, tidak pernah dicari ulang dengan
menyaring `layer.source`: lapisan bertipe `background` tidak punya `source`, jadi
penyaring seperti itu melewatkannya dan lapisan abu-abu pekat tetap menutupi citra
satelit di bawahnya — dengan ubin yang dijawab 200 OK dan tanpa satu pun error.

### KF-PANEL — Panel wilayah: Overview, Sales, Distribution, Business Reference

Ditambahkan 2026-08-30. Panel kelurahan/kota/dealer dirombak jadi 4 blok berjenjang:
Identitas Wilayah → Actual Sales → Sales Contribution → Relative Sales Position →
Business Reference.

| ID | Kebutuhan | Dijaga |
|---|---|---|
| KF-PANEL-1 | Kontribusi Penjualan kelurahan dihitung terhadap total KOTANYA SENDIRI, bukan total gabungan lintas kota | `test/sales-stats.test.js` |
| KF-PANEL-2 | Kota/kelurahan tanpa penjualan sama sekali menampilkan "Data belum tersedia", bukan 0% atau `NaN` | `test/sales-stats.test.js` |
| KF-PANEL-3 | Posisi Relatif: 5 label (Terbawah/Bawah/Tengah/Atas/Teratas), dihitung dari kuantil sebaran Kontribusi Penjualan yang sedang aktif | `test/sales-stats.test.js` |
| KF-PANEL-4 | Panel kelurahan: kartu ringkas 4 angka (Total, Kontribusi, Posisi Relatif, Business Reference), grafik tren bulanan kalau rentang periode >1 bulan dan ada datanya, Peringkat X/Y di kota, Rata-rata Kota | `test/page.test.js` |
| KF-PANEL-5 | Grafik tren bulanan TIDAK ditampilkan (bukan grafik kosong) kalau data cuma satu bulan | `test/page.test.js` |
| KF-PANEL-6 | Panel ringkasan kota (baru): total, jumlah kelurahan berpenjualan, rata-rata Kontribusi, distribusi 5 kelompok Posisi Relatif — dipicu memilih kota tanpa kelurahan spesifik aktif | `test/page.test.js` |
| KF-PANEL-7 | Panel dealer: kartu ringkas gaya sama (total, kelurahan ber-sales, rata-rata Kontribusi) di atas breakdown kota→kelurahan yang sudah ada | `test/page.test.js` |
| KF-PANEL-8 | Kelurahan yang sedang dibuka jadi di luar filter kota aktif → panel berganti jadi ringkasan kota itu, bukan tetap menampilkan kelurahan di luar cakupan | belum dijaga otomatis (diverifikasi manual) |
| KF-PANEL-9 | Panel kota/dealer yang ditutup manual TIDAK terbuka lagi sendiri selama filter masih aktif | belum dijaga otomatis (diverifikasi manual) |
| KF-PANEL-10 | Business Reference: nilai acuan bisa dikonfigurasi lewat `BUSINESS_REFERENCE_PERCENT` di `.env`, default 1% | `test/business-reference.test.js` |
| KF-PANEL-11 | Reference Gap (selisih poin persentase) dan Reference Ratio (%) dihitung terhadap benchmark AKTIF, bukan hardcode 1% | `test/sales-stats.test.js` |
| KF-PANEL-12 | Business Reference TIDAK memengaruhi Posisi Relatif maupun klasifikasi heatmap kuantil — dua indikator yang sengaja dipisah (data-driven vs business-driven) | `test/sales-stats.test.js` |
| KF-PANEL-13 | Peta: dua mode heatmap — "Per Peringkat Relatif" (persentil, bawaan) dan "Per Nilai Kontribusi" (6 kelas interval tetap) | `test/colors.test.js` |
| KF-PANEL-14 | Legenda peta berubah bentuk sesuai mode heatmap aktif (5 kelas persentil vs 6 kelas interval tetap) | belum dijaga otomatis (diverifikasi manual) |

**KF-PANEL-8 dan KF-PANEL-9 belum ada tes otomatisnya** — logikanya di `renderAll()`
(`app.js`), yang butuh DOM/MapLibre untuk diuji penuh. Diverifikasi manual di browser
terhadap data production: pilih kota A → panel kota A; buka kelurahan di kota A →
panel kelurahan; ganti ke kota B → panel otomatis berganti jadi ringkasan kota B.
**Sengaja di luar cakupan** (disebut eksplisit di spek sendiri sebagai tahap
berikutnya): Market Potential, Sales Gap, Coverage Gap, Opportunity Score, Recommended
Action. Juga di luar cakupan: audit log dan UI admin untuk mengubah Business
Reference — lihat `docs/DECISIONS.md`.

### KF-POS — Master Pos Dealer

| ID | Kebutuhan | Dijaga |
|---|---|---|
| KF-POS-1 | Tabel seluruh pos beserta dealer induk, alamat, dan koordinatnya | `test/page.test.js` |
| KF-POS-2 | Sunting alamat, koordinat, dan dealer induk satu pos | `test/import.test.js` |
| KF-POS-3 | Memindahkan pos ke dealer lain langsung terlihat di seluruh halaman **tanpa impor ulang** | `test/import.test.js` |
| KF-POS-4 | Kode dealer ditentukan server; nama dealer yang sama memakai ulang kodenya | `test/import.test.js` |
| KF-POS-5 | Memindahkan pin menghitung ulang jangkauan **pos itu saja**, bukan semuanya | `test/coverage-store.test.js` |
| KF-POS-6 | Menyunting alamat TIDAK memicu hitung ulang jangkauan | `test/coverage-store.test.js` |
| KF-POS-7 | Tambah pos baru; kode yang sudah dipakai ditolak dengan menyebut pemakainya | `test/import.test.js` |
| KF-POS-8 | Pos baru berkoordinat langsung punya jangkauan, tanpa menunggu `seed-coverage` | `test/import.test.js` |
| KF-POS-9 | Pin cepat lewat tempel koordinat dari Google Maps | belum dijaga |
| KF-POS-10 | Reset master pos: pos, dealer, penjualan, dan data konsumen dikosongkan sekaligus | `test/import.test.js` |
| KF-POS-11 | Reset wajib konfirmasi diketik persis; huruf kecil ditolak | `test/server-auth.test.js` |
| KF-POS-12 | Reset tercatat di riwayat impor, dan arsip Excel tidak ikut dihapus | `test/import.test.js` |
| KF-POS-13 | Subtitel halaman menyebut jumlah pos dan dealer yang benar-benar tampil | belum dijaga |
| KF-POS-14 | Tiap pos punya tiga ring layanan berisi kecamatan, dikunci ke kode BPS bukan nama | `test/import.test.js` |
| KF-POS-15 | Satu kecamatan hanya boleh ada di SATU ring per pos | `test/import.test.js` |
| KF-POS-16 | Menyimpan ring mengganti seluruhnya, bukan menambal; kecamatan asing ditolak | `test/import.test.js` |
| KF-POS-17 | Tiga kolom menampilkan JUMLAH kecamatan tiap ring | `test/page.test.js` |
| KF-POS-18 | Ring dipilih dengan mengklik SATU kecamatan di peta, lalu menentukan ringnya | `test/page.test.js` |
| KF-POS-19 | Batas kecamatan dimuat hanya saat mode edit ring, bukan saat halaman dibuka | `test/page.test.js` |
| KF-POS-20 | Kolom ring menyebut NAMA kecamatannya, dibatasi dan diringkas supaya tabel tetap bisa dipindai | `test/page.test.js` |
| KF-POS-21 | Impor massal dari Excel (sheet "Dealer" AHM): pratinjau diff per field SEBELUM diterapkan, tidak pernah auto-apply | `test/pos-diff.test.js`, `test/pos-import.test.js` |
| KF-POS-22 | Impor massal MEMANG menimpa nama/alamat yang beda dari Excel — beda dari impor bulanan yang melindungi kurasi dealer/koordinat | `test/pos-diff.test.js` |
| KF-POS-23 | Kode pos di Excel yang belum ada di database dilaporkan saja, tidak pernah dibuat otomatis | `test/pos-diff.test.js`, `test/pos-import.test.js` |
| KF-POS-24 | Baris Excel dengan kode pos ganda: kandidat pertama dipakai, sisanya dilaporkan sebagai peringatan | `test/pos-diff.test.js` |
| KF-POS-25 | Terapkan perubahan atomik (satu baris gagal membatalkan semuanya), dan menolak selagi impor bulanan sedang berjalan | `test/pos-import.test.js` |

### KF-DEALER — Master Dealer

| ID | Kebutuhan | Dijaga |
|---|---|---|
| KF-DEALER-1 | Tabel seluruh dealer beserta alamat, koordinat, dan jumlah pos yang menunjuknya | `test/dealers-crud.test.js` |
| KF-DEALER-2 | Tambah dealer baru tanpa pos sama sekali — langsung muncul di dropdown "Dealer induk" editor pos | `test/dealers-crud.test.js` |
| KF-DEALER-3 | Sunting alamat dan koordinat dealer; koordinat TIDAK dibatasi rentang wilayah peta (kantor dealer boleh di luar DIY+Jateng) | `test/dealers-crud.test.js` |
| KF-DEALER-4 | Kode dealer selalu turunan nama, tidak bisa diedit manual; ganti nama tidak mengganti kode | `test/dealers-crud.test.js` |
| KF-DEALER-5 | Hapus dealer ditolak selama masih punya pos, pesan menyebut jumlahnya | `test/dealers-crud.test.js` |
| KF-DEALER-6 | Rename ke nama yang sudah dipakai dealer lain ditolak — tidak diam-diam digabung | `test/dealers-crud.test.js` |
| KF-DEALER-7 | `outlets.dealer_code` dijamin menunjuk dealer yang ada lewat FOREIGN KEY, bukan disiplin kode saja | `test/dealers-schema.test.js` |

### KF-KELURAHAN — Master Kelurahan

| ID | Kebutuhan | Dijaga |
|---|---|---|
| KF-KELURAHAN-1 | Tabel kelurahan urut provinsi → kabupaten → kecamatan → kelurahan | `test/page.test.js` |
| KF-KELURAHAN-2 | Daftar nama yang belum cocok beserta saran kelurahan yang mungkin dimaksud | `test/matching.test.js`, `test/import.test.js` |
| KF-KELURAHAN-3 | **Saran tidak pernah dipakai sendiri** — hanya yang dikonfirmasi manusia yang tersimpan | `test/import.test.js` |
| KF-KELURAHAN-4 | Peringkat saran mendahulukan kecamatan yang sama di atas jarak ejaan yang lebih pendek | `test/matching.test.js` |
| KF-KELURAHAN-5 | Alias berlaku pada impor berikutnya; baris yang sudah tersimpan tidak berubah sendiri | `test/import.test.js` |
| KF-KELURAHAN-6 | Alias yang salah pilih bisa dibatalkan | `test/import.test.js` |
| KF-KELURAHAN-7 | Alias tidak bisa menunjuk kelurahan yang tidak ada, maupun kabupaten yang berbeda | `test/import.test.js` |
| KF-KELURAHAN-8 | Klik kelurahan melompat ke posisinya di peta | belum dijaga |

### KF-KONSUMEN — Data Konsumen

| ID | Kebutuhan | Dijaga |
|---|---|---|
| KF-KONSUMEN-1 | Telusuri konsumen dengan penyaring periode, kabupaten, kelurahan, pos, dan kata kunci | `test/import.test.js` |
| KF-KONSUMEN-2 | Hasil **selalu dipotong 500**, dan jumlah sebenarnya dilaporkan terpisah | `test/import.test.js` |
| KF-KONSUMEN-3 | `/api/customers` **wajib** punya parameter `village`; tanpa itu 400, bukan semuanya | `test/server-auth.test.js` |
| KF-KONSUMEN-4 | Tiap akses ke data konsumen dicatat | `test/import.test.js` |
| KF-KONSUMEN-5 | Tanpa database konsumen, tabnya hilang sendiri dan sisanya jalan penuh | `test/import.test.js` |

---

## 5. Kebutuhan non-fungsional

### KNF-PRIVASI

| ID | Kebutuhan | Dijaga |
|---|---|---|
| KNF-PRIVASI-1 | Nama dan alamat konsumen **hanya** ada di database `astra_customers` | `test/import.test.js`, `test/aggregate.test.js` |
| KNF-PRIVASI-2 | `DROP DATABASE astra_customers` mematikan fiturnya dan meninggalkan sisanya jalan penuh — **tanpa menyunting satu baris kode** | `test/import.test.js` |
| KNF-PRIVASI-3 | Tidak ada PII di `/api/summary` maupun di berkas yang dikirim ke browser | `test/import.test.js`, `test/page.test.js` |
| KNF-PRIVASI-4 | Rute yang mengembalikan PII dibatasi 30 permintaan per menit per IP | `test/server-auth.test.js` |
| KNF-PRIVASI-6 | Di belakang proksi lokal, `req.ip` tetap IP pengunjung — dan `X-Forwarded-For` hanya dipercaya dari loopback | `test/server-auth.test.js` |
| KNF-PRIVASI-5 | Arsip unggahan memuat PII, jadi dibuang setelah 90 hari | `test/hardening.test.js` |

Dasarnya bukan cuma kehati-hatian: datanya PII menurut UU PDP No. 27/2022, dan satu akun
dipakai bersama — jadi tidak boleh ada satu permintaan pun yang bisa menyedot seluruh
basis data konsumen.

### KNF-KINERJA

| ID | Kebutuhan | Terukur |
|---|---|---|
| KNF-KINERJA-1 | Halaman siap dalam ≤3 detik di jaringan kantor | 1,4 detik |
| KNF-KINERJA-2 | `/api/summary` satu permintaan, ≤5 MB | 2,31 MB |
| KNF-KINERJA-3 | Impor 19.000 baris selesai ≤30 detik | 5,7 detik |
| KNF-KINERJA-4 | Hitung ulang seluruh jangkauan ≤60 detik | ±4 detik |

Belum dijaga tes — diukur manual. Kalau nanti melar, yang paling mungkin jadi
penyebabnya `/api/summary`, karena dia satu-satunya yang tumbuh mengikuti jumlah baris
penjualan.

### KNF-PORTABEL

| ID | Kebutuhan |
|---|---|
| KNF-PORTABEL-1 | Pindah server = salin folder → `npm install` → `npm start`. Tidak ada langkah lain. |
| KNF-PORTABEL-2 | Semua yang berubah antar mesin ada di `.env`. Tidak ada path atau alamat di dalam kode. |
| KNF-PORTABEL-3 | Tidak ada modul native yang perlu dikompilasi. |
| KNF-PORTABEL-4 | Semua library CDN diunduh ke `frontend/vendor/` — jaringan kantor bisa memblokir CDN. |

| KNF-PORTABEL-5 | `npm run offline-html` menulis satu berkas HTML mandiri (~10 MB) yang jalan lewat `file://` tanpa server, database, atau internet — untuk dibawa keluar jaringan kantor. Angka penjualan asli, nama konsumen dikarang, tombol yang menulis menolak dengan pesan jelas. | `test/page.test.js` |

Belum dijaga tes; langkahnya di [PINDAH.md](PINDAH.md). KNF-PORTABEL-4 sebagian dijaga
`test/page.test.js` yang menolak aset dari internet. KNF-PORTABEL-5 dijaga sebagian:
berkas hasil build WAJIB ada di `.gitignore` (dia memuat angka penjualan asli), dan itu
yang diperiksa otomatis; alur bootnya sendiri diverifikasi manual di browser tiap kali
`prototype/build-offline.js` berubah.

### KNF-KEAMANAN

| ID | Kebutuhan | Dijaga |
|---|---|---|
| KNF-KEAMANAN-1 | Semua nilai di-escape sebelum masuk `innerHTML` — sumbernya Excel, tidak dipercaya | `test/page.test.js` |
| KNF-KEAMANAN-2 | Rahasia tidak pernah tersimpan di folder proyek kalau proyeknya di dalam OneDrive | `test/hardening.test.js` |
| KNF-KEAMANAN-3 | Berjalan tanpa HTTPS; `COOKIE_SECURE` dinyalakan lewat `.env`, bukan diubah di kode | belum dijaga |

**KNF-KEAMANAN-3 adalah utang yang diketahui.** Di LAN kantor tertutup ini diterima,
tapi disebut apa adanya di layar start dan di README — bukan disembunyikan.

### KNF-KETERSEDIAAN

| ID | Kebutuhan | Dijaga |
|---|---|---|
| KNF-KETERSEDIAAN-1 | `uncaughtException` tidak pernah `process.exit()` — di laptop tanpa supervisor, mati berarti mati sampai ada yang menyadarinya | belum dijaga |
| KNF-KETERSEDIAAN-2 | Catatan (log) tertulis sinkron dan disimpan 30 hari | `test/hardening.test.js` |
| KNF-KETERSEDIAAN-3 | Auto-start dan backup harian lewat Task Scheduler, tanpa butuh hak admin | belum dijaga |

**Risiko ketersediaan terbesar bukan teknis:** aplikasinya mati waktu laptopnya tidur
atau dibawa pulang. Itu alasan sebenarnya untuk pindah ke VPS — bukan performa.

---

## 6. Batas dan angka tetap

Sebagiannya keputusan produk, bukan detail teknis. Ditulis di sini supaya mengubahnya
adalah keputusan sadar.

| Nilai | Angka | Letaknya | Kenapa |
|---|---|---|---|
| Radius jangkauan | 3, 5, 7, 10 km | `backend/server/coverage-store.js` | 5 km acuan proyek; sisanya supaya pengaruh radius bisa ditunjukkan tanpa hitung ulang |
| Radius bawaan | 5 km | `backend/server/coverage-store.js` | |
| Rasio minimum disimpan | 0,001 | `backend/server/coverage-store.js` | tanpa ambang, tiap pos punya baris untuk tiap kelurahan yang lingkarannya sempat menyentuh |
| Ketelitian lingkaran | 32 segmen per kuadran | `backend/server/coverage-store.js` | bawaan PostGIS (8) menghasilkan lingkaran 0,65% terlalu kecil |
| Batas hasil telusur konsumen | 500 baris | `backend/server/repository.js` | satu akun bersama tidak boleh bisa menyedot seluruh basis data |
| Batas ukuran unggahan | 25 MB | `backend/server/routes.js` | Excel bulanan ±3 MB |
| Retensi arsip unggahan | 90 hari | `backend/server/routes.js` | arsipnya memuat PII |
| Retensi catatan (log) | 30 hari | `backend/server/logger.js` | |
| Umur sesi | 12 jam | `backend/server/auth.js` | satu hari kerja, tidak lebih |
| Pembatas login | 5 per menit per IP | `backend/server/app.js` | |
| Pembatas rute PII | 30 per menit per IP | `backend/server/routes.js` | |
| Baris per batch tulis | 500 | `backend/server/importer.js` | |
| Penyederhanaan poligon peta | 50 m | `scripts/export-geo.js` | hanya untuk yang digambar; hitungan jangkauan tetap pakai poligon detail penuh |
| Proyeksi metrik | UTM 49S (EPSG:32749) | `backend/server/schema.sql` | seluruh cakupan muat di satu zona; **pecah kalau melewati 114° BT** |

---

## 7. Di luar cakupan

Bukan "belum sempat" — ini sengaja tidak dikerjakan, beserta alasannya.

| Tidak dikerjakan | Kenapa |
|---|---|
| **Manajemen pengguna** (banyak akun, peran, jejak audit per orang) | Keputusan pemilik proyek: satu akun. Konsekuensinya tidak ada yang tahu *siapa* yang mengunggah berkas salah; peredamnya tabel `imports` yang mencatat waktu, IP, dan hasil. Keterbatasan ini disebut duluan waktu presentasi, bukan ditutupi. |
| **Docker** | Bikin portabel, tapi menambah satu hal yang tidak ada yang bisa memperbaiki kalau rusak. Salin-folder sudah cukup untuk satu proses Node tanpa modul native. Ditambahkan kalau nanti benar-benar diserahkan ke tim IT Astra. |
| **Chart tren antar bulan** | Datanya sudah tersedia (kolom `period`), tapi baru berguna setelah ada minimal 3 bulan riwayat. Sekarang baru 1. |
| **Perluasan se-Indonesia** | Butuh migrasi ke tipe `geography` dulu: UTM 49S pecah di timur 120° BT — Jayapura, 1.000 m terbaca 1.152 m. Lihat ROADMAP "Belum dikerjakan". |
| **Alias yang berlaku surut** | Alias berlaku pada impor berikutnya. Menulis ulang baris penjualan lama langsung dari alias berarti jalur kedua yang mengubah data penjualan, dan jalur kedua itu yang biasanya menyimpang. Impor ulang berkas yang sama sudah cukup dan jalurnya sudah teruji idempoten. |
| **Menambah kelurahan lewat form** | Pernah ada, dibuang 2026-08-17. Setelah seluruh Jateng + DIY masuk berpoligon, membuat kelurahan baru tanpa poligon hampir selalu jawaban yang salah — 82% nama yang tidak cocok ternyata varian ejaan dari kelurahan yang sudah ada. |
| **Penjalan migrasi skema** | `schema.sql` cuma `CREATE TABLE IF NOT EXISTS`. Baru mendesak saat ada mesin kedua, dan jadi prasyarat kalau migrasi `geography` dikerjakan. Ditandai `ponytail:` di `db.js`. |

---

## 8. Baseline terukur — 2026-08-17

Bertanggal supaya perubahan berikutnya bisa dibandingkan, bukan dikira-kira.

| | |
|---|---|
| Dealer | 51 |
| Pos | 78, semuanya sudah punya koordinat |
| Unit terjual | 18.915 |
| Baris Excel dibaca | 19.080 |
| **Kecocokan impor** | **99,1%** |
| Kelurahan terlayani | 3.326 |
| Kelurahan di database | 8.999, di 40 kabupaten/kota (Jateng + DIY lengkap) |
| Kelurahan dikirim ke browser | 4.003 — yang punya penjualan atau masuk radius |
| Baris jangkauan tersimpan | 22.682, di 4 radius |
| Periode tersimpan | 1 (2026-08) |
| Menunggu dicocokkan manusia | 50 nama / 165 baris — 31 nama punya saran, 19 pembeli luar provinsi |
| Berkas tes | 18, semuanya hijau |

Jangkauan pada radius 3 / 5 / 7 / 10 km: **7,5% / 14,8% / 23,0% / 33,5%**.

Dihitung persis seperti yang dilakukan halaman (`splitByCoverage()` di
`frontend/js/filters.js`): `Σ(unit × rasio) / Σ(unit)`, dengan kelurahan tanpa poligon
dikeluarkan dari kedua sisi.

**Angka ini menggantikan 7,6 / 15,1 / 23,5 / 34,2 yang masih tertulis di ROADMAP.**
Set lama itu diukur sebelum seluruh Jateng + DIY masuk; waktu ekspansinya selesai cuma
angka 5 km yang diperbarui, tiga sisanya tertinggal. Ditemukan waktu menulis PRD ini
karena tiap angka diukur ulang, bukan disalin.

Turunnya dari 15,1% ke 14,8% **benar**: 403 baris yang tadinya hilang sekarang ikut
terhitung, sebagian besar di kabupaten yang belum punya pos sama sekali. Yang 15,1%
terlihat lebih bagus karena diam-diam mengabaikan 568 baris.
