# Roadmap

Berkas pelacak. Satu tempat untuk menjawab "sudah sampai mana" dan "kenapa berhenti".
Diperbarui tiap akhir sesi kerja. Jangan hapus entri lama — coret atau pindahkan.

Rencana lengkapnya ada di `PLAN.md`. Keputusan arsitektur di `DECISIONS.md`.

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
| 5 | Sunting master outlet | sebagian | pin koordinat sudah; pindah dealer belum |
| 6 | Bisa dijalankan orang non-IT | **selesai** | `start.bat`, README.md, PINDAH.md |

---

## Sedang dikerjakan

Tidak ada. Yang tersisa ada di "Belum dikerjakan" di bawah.

## Selesai

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

- `dealer_grup.csv` masih hasil tebakan dari nama outlet (bagian sebelum " - ").
  Melanggar aturan "jangan turunkan identitas dari nama" di CLAUDE.md. Peredamnya:
  hasilnya jadi tabel yang bisa disunting manusia, bukan aturan yang tertanam di kode.
  Beres saat Fase 5.
- 433 baris data di luar 15 kabupaten cakupan — belum diputuskan dilebarkan atau
  dibuang.
- 132 baris / 29 nama kelurahan belum cocok dan perlu verifikasi manual.
- 52 dari 78 outlet bermarker abu karena kuota 8 warna. Bukan bug — hasil validasi
  palet. Perlu dijelaskan ke pengguna, bukan diperbaiki.
