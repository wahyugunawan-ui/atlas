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
| KF-IMPOR-11 | Data konsumen hanya tersimpan kalau diminta eksplisit | `test/import.test.js` |

### KF-PETA — Insight & Peta

| ID | Kebutuhan | Dijaga |
|---|---|---|
| KF-PETA-1 | Peta choropleth kelurahan diwarnai menurut volume penjualan | `test/page.test.js` |
| KF-PETA-2 | Empat KPI: Dealer Aktif, Total Penjualan, Kelurahan Terlayani, Kelurahan Kosong | `test/page.test.js` |
| KF-PETA-3 | Penyaring periode, kabupaten, dealer, dan pos; seluruh panel ikut berubah | `test/colors.test.js` |
| KF-PETA-4 | Warna dealer **stabil terhadap penyaring** — dealer yang bertahan tidak berganti warna | `test/colors.test.js` |
| KF-PETA-5 | Panel performa pos menampilkan persen penjualan di dalam radius terpilih | `test/coverage-split.test.js` |
| KF-PETA-6 | Radius bisa diganti antara 3/5/7/10 km tanpa hitung ulang | `test/coverage-store.test.js` |
| KF-PETA-7 | Penjualan di kelurahan tanpa poligon dikeluarkan dari persentase DAN dilaporkan terpisah | `test/coverage-split.test.js` |
| KF-PETA-8 | Halaman bisa membedakan "0% terjangkau" dari "jangkauan belum pernah dihitung" | `test/coverage-split.test.js` |
| KF-PETA-9 | Klik kelurahan membuka rincian: daftar pos dan porsinya | `test/page.test.js` |
| KF-PETA-10 | Treemap kontribusi dealer dan pos | belum dijaga |
| KF-PETA-11 | Basemap bisa diganti antara peta lokal, citra satelit, dan polos | `test/page.test.js` |
| KF-PETA-12 | Basemap yang tidak dipilih dimatikan **seluruhnya**, termasuk lapisan yang tidak punya `source` | `test/page.test.js` |

**KF-PETA-11 satu-satunya fitur yang butuh internet**, dan itu disengaja: citra
satelitnya dari Esri, diminta di meeting. Peta lokal (PMTiles) tetap jalan penuh tanpa
jaringan keluar, jadi menutup internet mendegradasi satu pilihan basemap — bukan
mematikan halaman.

**KF-PETA-12 kelihatan seperti detail teknis, tapi dia yang pernah rusak.** Daftar
lapisan basemap ditangkap dari tema waktu peta dibuat, tidak pernah dicari ulang dengan
menyaring `layer.source`: lapisan bertipe `background` tidak punya `source`, jadi
penyaring seperti itu melewatkannya dan lapisan abu-abu pekat tetap menutupi citra
satelit di bawahnya — dengan ubin yang dijawab 200 OK dan tanpa satu pun error.

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

Belum dijaga tes; langkahnya di [PINDAH.md](PINDAH.md). KNF-PORTABEL-4 sebagian dijaga
`test/page.test.js` yang menolak aset dari internet.

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
