# Migrasi ke aplikasi web production

## Context

Dashboard di `md-command-center-uji/Index.html` sudah benar dan sudah pakai data asli
(51 dealer, 78 POS, 18.512 unit, 97% kelurahan cocok). Tapi bentuknya masih percobaan:
satu berkas HTML 1.565 baris, dibuka lewat server statis Python, datanya dibangun
dengan `node bikin_agregat.js` di laptop, dan seluruh 2,9 MB data konsumen (nama +
alamat) ikut ter-download ke browser siapa pun yang membuka halamannya.

Yang dibangun sekarang: satu aplikasi Node yang bisa dipasang di server, dengan login,
upload Excel bulanan lewat web, dan data konsumen yang hanya keluar sepotong-sepotong
lewat API. Apps Script dipensiunkan — tapi logika murninya (`agregasi`, `kunciMapping`,
`normalNama`, `kodeKotaBertitik`) dipindah apa adanya jadi modul Node, jadi tidak ada
logika yang ditulis ulang dan seluruh tes yang sudah ada tetap berlaku.

**Keputusan yang sudah diambil:** upload Excel lewat web; data konsumen diambil
per-kelurahan lewat API; frontend dipecah jadi modul tanpa build step; jalan dulu di
laptop, VPS menyusul — jadi kemudahan pindah server jadi syarat rancangan, bukan
bonus.

---

## Hosting: laptop dulu, VPS menyusul

Tidak ada tim IT di tim mereka. Itu bukan detail kecil — itu yang memutuskan seluruh
bentuk deployment. Semua yang butuh orang untuk merawat (Docker, nginx, systemd,
sertifikat yang kedaluwarsa tiap 90 hari) dikeluarkan dari rencana. Yang tersisa harus
bisa dijalankan orang yang tidak tahu apa itu terminal.

**Cara pindah server = menyalin satu folder.** Ini syarat, dan syarat ini yang
membentuk tiga aturan di bawah:

1. **Semua yang berubah antar mesin ada di `.env`** — port, letak folder data, sandi.
   Tidak ada path atau alamat yang ditulis di dalam kode.
2. **Semua data ada di satu folder `data/`** — tidak ada yang nyangkut di registry,
   folder AppData, atau database di luar folder proyek.
3. **Tidak ada langkah pasang selain `npm install`** — tidak ada modul native yang
   perlu dikompilasi, tidak ada layanan yang perlu didaftarkan.

Pindah dari laptop ke VPS jadinya: salin folder → `npm install` → `npm start`. Tiga
perintah, dan dua di antaranya sama di Windows maupun Linux.

### Jalan di laptop — yang harus kamu sadari

**Aplikasinya mati saat laptop tidur atau dibawa pulang.** Ini risiko ketersediaan yang
jauh lebih besar daripada semua kekhawatiran "akses bersamaan" di bawah. Kalau tim
mengandalkan dashboard ini untuk rapat mingguan, laptopmu jadi bagian dari
infrastruktur mereka. Itu alasan sebenarnya untuk pindah ke VPS — bukan performa.

**Rekan mengaksesnya lewat IP LAN kantor**, misal `http://192.168.1.20:3000`. Perlu
dipastikan: Windows Firewall harus mengizinkan port itu (satu dialog saat pertama
jalan), dan alamat IP laptop bisa berubah tiap sambung ulang WiFi — minta IP statis ke
jaringan kantor, atau catat ulang IP-nya tiap ganti.

**Tanpa HTTPS, cookie sesi terkirim polos di LAN.** Di jaringan kantor yang dipercaya
ini biasanya diterima, tapi harus disebut, tidak disembunyikan. Cookie-nya tetap
dipasang `httpOnly` dan `SameSite=Lax`; flag `Secure` dinyalakan lewat `.env` begitu
ada HTTPS, bukan diubah di kode.

**Nyalakan BitLocker.** Berkas `data/` memuat nama dan alamat 17.620 konsumen, dan
laptop bisa hilang. Di Windows 11 ini satu tombol, dan ini pengaman termurah di seluruh
rencana ini.

### Kalau nanti pindah ke VPS

Sewa **di Indonesia** (Biznet, IDCloudHost, Alibaba Jakarta). Bukan soal kecepatan:
data ini memuat PII, dan VPS berdatacenter luar negeri mengubah "server mana yang
murah" jadi pertanyaan UU PDP No. 27/2022 soal transfer data pribadi — pertanyaan yang
tidak enak muncul belakangan.

Spesifikasi yang cukup: **1 vCPU, 1 GB RAM, 20 GB disk** (±Rp 100–150 rb/bulan). Untuk
5–20 pembaca itu berlebih. Yang berubah dibanding laptop cuma dua: pasang HTTPS lewat
Caddy (satu berkas konfigurasi 3 baris, sertifikatnya perbarui sendiri otomatis), dan
nyalakan `COOKIE_SECURE=1` di `.env`.

---

## Kekhawatiranmu soal akses bersamaan — mana yang nyata

Kamu benar mencurigainya, tapi cuma satu dari tiga yang benar-benar berisiko — dan
selama jalan di laptop, ketiganya kalah penting dibanding "laptopnya lagi tidur".

**Satu akun dipakai banyak orang sekaligus — bukan masalah.** Sesi login itu cookie di
masing-masing browser. Sepuluh orang login dengan sandi yang sama menghasilkan sepuluh
sesi yang saling tidak tahu satu sama lain. Tidak ada yang saling menendang.

**Server tumbang karena ramai — bukan masalah pada skala ini.** Node melayani ribuan
permintaan per detik; 20 orang membuka dashboard yang isinya berkas JSON statis tidak
terasa. Yang berat justru sekali di awal (±5 MB geojson per pengguna), dan itu di-cache
browser setelah muat pertama.

**Data tidak sinkron saat impor — INI yang nyata.** Kalau dua orang meng-upload Excel
bersamaan, atau ada yang membuka dashboard tepat saat berkas sedang ditulis, yang
terbaca bisa berkas setengah jadi. Tiga penangkalnya kecil semua:

1. **Satu transaksi database** — `BEGIN` … `COMMIT`. Pembaca melihat keadaan sebelum
   impor atau sesudahnya, tidak pernah yang di tengah. Gagal di tengah = rollback
   otomatis, data lama utuh. Ini yang mengerjakan pekerjaan berat, dan ini gratis
   karena datang dari SQLite.
2. **Kunci sekali-jalan di aplikasi** — impor kedua ditolak dengan pesan "sedang ada
   impor berjalan", bukan menunggu sampai timeout database. Ini soal pesan error yang
   bisa dimengerti orang non-IT, bukan soal keamanan data.
3. **Mode WAL** — pembaca tidak diblokir penulis, jadi orang yang sedang membuka
   dashboard tidak merasakan apa pun saat impor berjalan.

Kunci di poin 2 hanya berlaku dalam satu proses Node, dan ditandai `ponytail:` di
kodenya. Kalaupun suatu saat dijalankan multi-proses, yang jebol cuma kualitas pesan
error — integritas datanya tetap dijaga poin 1. Untuk 20 pengguna, satu proses sudah
lebih dari cukup.

**Yang tidak terselesaikan oleh teknologi:** satu akun bersama berarti tidak ada yang
tahu *siapa* yang meng-upload berkas yang salah. Ini bukan bug yang bisa ditambal; ini
konsekuensi dari keputusan "satu akun". Peredamnya murah dan tetap dipasang: tiap impor
mencatat waktu, IP, nama berkas, jumlah baris, dan hasilnya ke tabel `impor` — bisa
dilihat lewat halaman riwayat, jadi berguna bukan cuma saat forensik. Itu memberi 80%
manfaat jejak audit tanpa membangun manajemen pengguna. Sebutkan keterbatasan ini saat
pitching — lebih baik kamu yang menyebut duluan.

---

## Database: SQLite lewat `node:sqlite`

**Dua berkas `.db`, nol dependensi baru.** Node 24 yang terpasang di mesin ini sudah
memuat `node:sqlite` di dalam dirinya — tidak ada paket npm, tidak ada modul native yang
perlu dikompilasi, tidak ada server database yang perlu dipasang dan dirawat. Syarat
"pindah server = salin folder" tetap utuh: databasenya ikut tersalin karena dia cuma
berkas di dalam `data/`.

Postgres/MySQL sengaja tidak dipilih. Bukan karena tidak mampu, tapi karena keduanya
menambah proses yang harus dinyalakan, di-backup, dan diperbaiki kalau mati — sementara
di tim itu tidak ada orang IT yang bisa melakukannya.

### Kenapa dua berkas, bukan satu

```
data/astra.db       agregat, master POS/dealer, jejak impor   — boleh di-backup bebas
data/konsumen.db    nama + alamat konsumen                     — PII, ditangani khusus
```

Ini mempertahankan sifat yang selama ini dijaga `test_halaman.js`: **mencabut PII cukup
dengan menghapus satu berkas**, dan dashboard tetap jalan tanpanya — cuma tab Data
Konsumen yang menghilang. Kalau semua ditaruh di satu berkas, tiap backup rutin
otomatis membawa serta 17.620 nama dan alamat, dan "hapus PII" berubah jadi operasi
yang bisa salah. `ATTACH` tersedia kalau suatu saat perlu di-join.

### Skema

```sql
-- astra.db
CREATE TABLE agregat (              -- satu baris per (periode, kelurahan, pos)
  periode  TEXT NOT NULL,           -- '2026-08'
  kode_kel TEXT NOT NULL,           -- kode BPS bertitik: '34.04.01.2001'
  kode_pos TEXT NOT NULL REFERENCES pos(kode_pos),
  jumlah   INTEGER NOT NULL,
  PRIMARY KEY (periode, kode_kel, kode_pos)
);
CREATE INDEX idx_agregat_periode ON agregat(periode);
-- kode_dealer SENGAJA tidak disimpan di sini. Dia milik tabel `pos` dan diambil
-- lewat JOIN. Kalau ikut disalin ke tiap baris agregat, memperbaiki satu
-- pengelompokan POS berarti harus menulis ulang ratusan ribu baris — dan yang
-- lupa ditulis ulang jadi diam-diam salah.

CREATE TABLE pos (                  -- pengganti dealer_grup.csv + dealer_koordinat.csv
  kode_pos TEXT PRIMARY KEY,
  nama_pos TEXT NOT NULL,
  kode_dealer TEXT NOT NULL,
  nama_dealer TEXT NOT NULL,
  lat REAL, lng REAL,               -- NULL = belum di-pin, ditampilkan apa adanya
  diubah_pada TEXT
);

CREATE TABLE impor (                -- jejak audit, pengganti impor.log
  id INTEGER PRIMARY KEY, waktu TEXT, ip TEXT, berkas TEXT, periode TEXT,
  baris_dibaca INTEGER, baris_terpakai INTEGER, hasil TEXT, pesan TEXT
);

-- konsumen.db
CREATE TABLE konsumen (
  id TEXT PRIMARY KEY, periode TEXT NOT NULL, kode_kel TEXT NOT NULL,
  kode_pos TEXT NOT NULL, nama TEXT NOT NULL, alamat TEXT NOT NULL
);
CREATE INDEX idx_konsumen_kel ON konsumen(kode_kel);
CREATE TABLE akses (waktu TEXT, ip TEXT, kode_kel TEXT, jumlah INTEGER);
```

**Yang TIDAK masuk database:** `kelurahan.geojson` (3,6 MB), `kota.geojson`, dan
`cakupan.pmtiles` (28 MB). Itu blob statis yang nyaris tidak pernah berubah dan
disajikan langsung sebagai berkas — browser meng-cache-nya, dan SQLite tidak menambah
apa pun selain lapisan di tengah.

### Yang berubah jadi lebih baik karena ada DB

- **Impor jadi satu transaksi.** `BEGIN` → hapus periode itu → sisipkan → `COMMIT`.
  Gagal di tengah = otomatis rollback, data lama utuh. Ini lebih kuat daripada trik
  tulis-ke-tmp-lalu-rename, dan sekaligus memenuhi aturan "impor harus idempoten" di
  CLAUDE.md: impor ulang bulan yang sama menghasilkan keadaan yang sama, bukan dobel.
- **Mode WAL**: pembaca tidak pernah diblokir penulis. Orang yang sedang membuka
  dashboard tidak merasakan apa pun saat ada impor berjalan.
- **Riwayat antar bulan jadi ada dengan sendirinya.** Chart tren bulanan yang selama ini
  tidak mungkin karena modelnya tidak menyimpan waktu, sekarang cuma soal `GROUP BY
  periode`.
- **Master data POS→dealer bisa disunting lewat web** tanpa mengedit CSV dan
  menjalankan ulang script. Pengelompokan dealer yang sekarang masih hasil tebakan nama
  jadi bisa dibetulkan tim sendiri.

**Batasnya, supaya jelas:** SQLite hanya mengizinkan satu penulis pada satu waktu, dan
databasenya harus di disk lokal — jangan pernah taruh `data/` di OneDrive atau share
jaringan, karena penguncian berkasnya tidak bekerja benar di situ dan database bisa
rusak. Folder proyek sekarang ada di dalam OneDrive; folder `data/` harus keluar dari
sana (diatur lewat `DATA_DIR` di `.env`). Untuk 20 pembaca dan satu impor per bulan,
batas satu-penulis itu tidak akan pernah tersentuh.

---

## Struktur folder

Folder baru `astra-command-center/` sejajar dengan folder yang ada. `md-command-center-uji`
dibiarkan utuh sampai versi baru terbukti jalan.

```
astra-command-center/
├── package.json
├── .env.example              SANDI_HASH, RAHASIA_COOKIE, PORT, DATA_DIR, COOKIE_SECURE
├── .gitignore                data/ dan .env tidak pernah masuk git
├── mulai.bat                 klik dua kali → jalan, menampilkan alamat LAN
├── README.md                 cara jalan lokal, cara impor Excel bulanan
├── PINDAH.md                 langkah pindah ke server lain
├── server/
│   ├── index.js              Express: rute, static, penanganan error
│   ├── auth.js               scrypt + cookie bertanda tangan HMAC
│   ├── db.js                 buka node:sqlite, WAL, jalankan skema, query
│   ├── skema.sql             CREATE TABLE IF NOT EXISTS + PRAGMA user_version
│   └── impor.js              upload → agregasi → satu transaksi (+ kunci)
├── logika/                   MURNI, tanpa I/O — dipakai server, CLI, dan tes
│   ├── agregasi.js           dari Code.js: normalNama, kunciMapping,
│   │                         kodeKotaBertitik, agregasi, gabungAgregat, KOL
│   ├── grup.js               dipindah apa adanya dari uji/grup.js
│   ├── warna.js              registry + ramp — dipakai browser juga
│   └── csv.js                parser CSV sadar-kutip (dari bikin_agregat.js)
├── publik/                   yang benar-benar dikirim ke browser
│   ├── masuk.html            halaman login
│   ├── index.html            markup dashboard saja, tanpa <script> panjang
│   ├── js/                   util.js data.js warna.js peta.js tabel.js
│   │                         ringkasan.js app.js
│   ├── css/tailwind.css      hasil build sekali, BUKAN CDN
│   └── vendor/               maplibre-gl, pmtiles, apexcharts, phosphor, font
├── skrip/
│   ├── impor_cli.js          impor dari terminal, untuk debugging
│   ├── pindah_csv.js         sekali jalan: dealer_grup.csv + koordinat → tabel pos
│   └── bikin_sandi.js        hasilkan SANDI_HASH untuk .env
├── tes/
│   ├── test_agregasi.js test_warna.js test_geo.js
│   ├── test_riwayat.js  test_cari.js  test_halaman.js
│   ├── test_auth.js          BARU
│   └── test_impor.js         BARU — pakai SQLite :memory:
└── data/                     DI LUAR GIT, DI LUAR OneDrive
    ├── astra.db              agregat, master POS/dealer, jejak impor
    ├── konsumen.db           PII — hapus berkas ini, fiturnya mati, sisanya jalan
    ├── geo/                  kelurahan.geojson, kota.geojson, cakupan.pmtiles
    └── unggahan/             arsip xlsx asli
```

**`data/` harus di luar OneDrive.** Folder proyek sekarang ada di dalam
`OneDrive\Dokumen`, dan SQLite tidak aman di folder yang disinkronkan — penguncian
berkasnya tidak bekerja seperti seharusnya dan database bisa rusak. Letaknya diatur
lewat `DATA_DIR` di `.env`; bawaannya sesuatu seperti `C:\astra-data`.

Pemisahan yang penting: **`logika/` tidak boleh meng-`require('fs')`.** Itu yang
membuat fungsi yang sama bisa dites di Node, dijalankan server, dan (untuk `warna.js`)
di-import browser tanpa duplikasi. Aturan ini yang sudah berlaku di `Code.js` sekarang;
di sini cuma dijadikan batas folder.

---

## Pilihan teknis

| Kebutuhan | Pilihan | Alasan |
|---|---|---|
| HTTP server | Express | Bisa saja `node:http`, tapi range request untuk PMTiles, penyajian berkas statis yang aman dari path traversal, dan ETag itu justru bagian yang gampang salah. `serve-static` sudah benar. |
| Sandi | `node:crypto` scrypt | Stdlib. Tidak perlu bcrypt/argon2. |
| Sesi | Cookie HMAC stateless | Tanpa penyimpanan sesi: restart server tidak menendang siapa pun, dan banyak pengguna serentak jalan sendirinya. |
| Upload | `multer` | Batas ukuran + tulis ke disk. Standar dan membosankan. |
| Baca .xlsx | `exceljs` | Tim menerima .xlsx dari Astra. Memaksa mereka export CSV tiap bulan menambah satu langkah yang bisa salah. (`xlsx`/SheetJS dihindari: sudah tidak dirilis di npm.) |
| Basemap | Berkas `.pmtiles` statis + `pmtiles` JS | Menghapus proses `pmtiles serve` terpisah. Express melayani range request; browser mengambil potongan yang perlu saja. |
| Database | `node:sqlite` | Sudah ada di dalam Node 24 — nol paket npm, nol modul native, nol server yang harus dirawat. Databasenya berkas biasa di dalam `data/`, jadi pindah server tetap "salin folder". |
| Migrasi skema | `CREATE TABLE IF NOT EXISTS` + `PRAGMA user_version` | Skemanya lima tabel. Framework migrasi untuk lima tabel adalah biaya tanpa hasil. |
| Build frontend | tidak ada | Kecuali satu perintah Tailwind CLI saat kelas CSS berubah. |
| Docker | tidak dipakai | Tidak ada tim IT yang bisa memperbaikinya kalau rusak. Satu proses Node tanpa modul native sudah portabel dengan salin-folder. |

**Semua library CDN di-download ke `publik/vendor/`.** Bukan preferensi: jaringan
kantor bisa memblokir CDN, dan dashboard yang mati karena unpkg tidak terjangkau adalah
kegagalan yang sangat memalukan di hari pertama. Ini juga memperbaiki satu bug yang
sekarang ditambal: Tailwind CDN menerapkan CSS setelah render pertama, itu sebabnya
kanvas MapLibre pernah salah ukuran dan butuh `resize()` manual.

---

## Rute

```
GET  /masuk                halaman login
POST /masuk                {sandi} → set cookie; dibatasi 5 percobaan/menit per IP
POST /keluar               hapus cookie
GET  /                     dashboard (tanpa cookie → redirect /masuk)

GET  /api/agregat                  agregat + daftar POS + periode (bentuk JSON-nya
                                   sama persis dengan agregat.json sekarang, jadi
                                   frontend tidak perlu diubah)
GET  /api/geo/:nama                kelurahan.geojson | kota.geojson (immutable, cache 1 th)
GET  /api/peta/cakupan.pmtiles     range request
GET  /api/konsumen?kode=34.04.01.2001   konsumen di SATU kelurahan; dicatat ke tabel akses
GET  /api/pos                      master POS→dealer + koordinat
PUT  /api/pos/:kode                perbaiki pengelompokan atau koordinat satu POS
POST /api/impor                    multipart .xlsx + periode → agregasi → satu transaksi
GET  /api/impor/riwayat            daftar impor terakhir, dari tabel `impor`
```

Semua di bawah `/api` dan `/` butuh cookie sah. `/masuk` dan `/publik/vendor` tidak.

**`/api/konsumen` wajib punya `kode`.** Tanpa parameter, dijawab 400 — bukan
dikembalikan semuanya. Ini satu-satunya hal yang mencegah satu akun bersama menyedot
seluruh basis data konsumen dalam satu permintaan.

---

## Tahapan

**Fase 0 — kerangka.** Buat folder, `package.json`, pindahkan `logika/` dan `tes/`.
Selesai kalau enam tes yang sudah ada hijau dari lokasi barunya, tanpa satu baris pun
logika berubah.

**Fase 1 — login.** `auth.js`, `masuk.html`, `skrip/bikin_sandi.js`, pembatas
percobaan. `tes/test_auth.js`: sandi salah ditolak, cookie yang dipalsukan ditolak,
cookie kedaluwarsa ditolak, perbandingan tanda tangan pakai `timingSafeEqual`.

**Fase 2 — frontend dipecah + library di-lokal-kan.** Skrip inline 1.100 baris dipecah
jadi tujuh modul ES sesuai kelompok fungsi yang sudah ada di berkas itu (warna, peta,
tabel, ringkasan, data, util, app). Semua tag CDN diganti berkas di `vendor/`. Tailwind
di-build sekali ke `publik/css/tailwind.css`.

Catatan: markup memakai `onclick="namaFungsi()"`, sedangkan fungsi di dalam modul ES
tidak otomatis global. Ditangani dengan satu panggilan `expose({...})` di `app.js` yang
mendaftar fungsi handler ke `window` — daftarnya eksplisit, jadi terbaca. `test_halaman.js`
perlu disesuaikan untuk membaca berkas modul, bukan skrip inline; penjaganya (handler
ada, id ada, tanpa PII bocor, semua di-escape) tetap sama.

**Fase 3 — database + API data.** `server/db.js` dan `skema.sql`; buka SQLite dengan
`PRAGMA journal_mode=WAL` dan `foreign_keys=ON`. `skrip/pindah_csv.js` mengisi tabel
`pos` dari `dealer_grup.csv` + dua berkas koordinat yang sudah ada, sekali jalan. Lalu
`/api/agregat` dan `/api/konsumen` dilayani dari query.

Bentuk JSON `/api/agregat` dibuat sama persis dengan `agregat.json` yang sekarang —
jadi frontend hasil Fase 2 langsung jalan tanpa diubah, dan kalau ada yang rusak,
penyebabnya pasti di server, bukan di dua tempat sekaligus. Yang berubah di frontend
cuma tab Data Konsumen: memuat saat kelurahan diklik, bukan sekaligus di awal.

**Fase 4 — impor lewat web.** Halaman upload, `impor.js` dengan kunci sekali-jalan dan
satu transaksi, arsip .xlsx asli, catatan ke tabel `impor`. `tes/test_impor.js` pakai
database `:memory:`, jadi cepat dan tidak menyentuh disk. Yang dijaga: dua impor
bersamaan → yang kedua ditolak; impor yang gagal di tengah meninggalkan data lama utuh
(rollback); impor ulang periode yang sama tidak menggandakan baris; nama berkas dari
pengguna tidak bisa keluar dari folder tujuan.

**Fase 5 — sunting master data.** Tabel `pos` bisa disunting lewat web: memindahkan POS
ke dealer lain, memperbaiki koordinat yang salah, mem-pin POS yang belum punya titik.
Ini yang membuat pengelompokan dealer — yang sekarang masih hasil tebakan dari nama —
bisa dibetulkan tim sendiri tanpa menyentuh kode. Setelah disimpan, agregat tidak perlu
dihitung ulang: `kode_dealer` dibaca dari tabel `pos` saat query, bukan dibekukan di
dalam baris agregat.

**Fase 6 — bisa dijalankan orang non-IT.** Ini fase yang paling gampang diremehkan,
padahal penggunanya tidak punya tim IT.

- `mulai.bat` — klik dua kali, server jalan, dan **jendelanya menampilkan alamat yang
  harus dibuka rekan** (`http://192.168.x.x:3000`), bukan cuma "listening on 3000".
  Alamat IP LAN-nya dideteksi sendiri lewat `os.networkInterfaces()`.
- Kalau `.env` belum ada, `mulai.bat` menuntun membuatnya dan menanyakan sandi sekali,
  lalu menyimpan hash-nya. Tidak ada langkah manual mengedit berkas konfigurasi.
- Kalau port sudah dipakai atau Node belum terpasang, pesannya menyebut apa yang harus
  dilakukan — bukan stack trace.
- README.md dengan tiga bagian saja: cara jalan, cara impor Excel bulanan, cara pindah
  ke server lain.
- `PINDAH.md` — langkah salin folder → `npm install` → `npm start`, plus daftar hal yang
  berubah di `.env`. Ditulis sekarang selagi semuanya masih segar, bukan nanti saat
  sudah lupa.

Docker sengaja tidak dipakai: memang bikin portabel, tapi menambah satu hal yang tidak
ada yang bisa memperbaiki kalau rusak. Salin-folder sudah cukup portabel untuk satu
proses Node tanpa modul native. Tambahkan Docker kalau nanti benar-benar diserahkan ke
tim IT Astra.

---

## Berkas yang jadi rujukan

| Baru | Diambil dari |
|---|---|
| `logika/agregasi.js` | `md-command-center-uji/Code.js` — fungsi murni, buang wrapper `SpreadsheetApp` |
| `logika/grup.js` | `md-command-center-uji/grup.js` apa adanya |
| `logika/csv.js` | fungsi `bacaCsv()` di `bikin_agregat.js:41-58` (duplikat di `bikin_konsumen.js`) |
| `logika/warna.js` | `Index.html:333-467` |
| `publik/js/peta.js` | `Index.html:650-1000` |
| `publik/js/ringkasan.js` | `Index.html:1108-1295` |
| `publik/js/tabel.js` | `Index.html:1045-1100, 1353-1409` |
| `server/impor.js` | alur `main()` di `bikin_agregat.js` + `bikin_konsumen.js` |

---

## Verifikasi

- **Tes**: `npm test` menjalankan delapan berkas di `tes/`. Enam yang lama harus hijau
  tanpa perubahan logika; dua yang baru menutupi auth dan impor.
- **Uji mutasi** untuk `test_auth.js` dan `test_impor.js`, sesuai standar yang sudah
  dipakai: rusakkan perbandingan tanda tangan, matikan kunci impor, ganti `COMMIT` jadi
  auto-commit per baris — tiap kerusakan harus membuat tepat satu tes merah.
- **Impor bersamaan**: dua `curl -F` ke `/api/impor` serentak; yang kedua dapat 409, dan
  `SELECT SUM(jumlah) FROM agregat WHERE periode='2026-08'` tetap 18.512 — bukan dobel.
- **Impor gagal di tengah**: upload .xlsx yang rusak separuh; jumlah baris di database
  harus persis sama dengan sebelum impor.
- **Impor ulang**: impor berkas yang sama dua kali berturut-turut; totalnya tidak
  berubah. Ini aturan idempoten di CLAUDE.md, sekarang dijaga tes.
- **Sunting master POS**: pindahkan satu POS ke dealer lain lewat `/api/pos/:kode`, muat
  ulang dashboard — warnanya ikut pindah tanpa impor ulang.
- **Akses bersamaan**: 20 permintaan paralel ke `/api/agregat` (`autocannon` atau
  `curl` di loop); semuanya 200, tidak ada yang timeout.
- **PII tidak bocor**: `GET /api/konsumen` tanpa `kode` harus 400. `grep` di seluruh
  respons `/api/agregat` tidak boleh memuat nama atau alamat.
- **PII bisa dicabut**: hentikan server, hapus `data/konsumen.db`, jalankan lagi.
  Dashboard harus jalan penuh dengan tab Data Konsumen hilang sendiri — bukan error.
  Ini sifat yang selama ini dijaga `test_halaman.js`; sekarang diuji ke servernya.
- **Tanpa login**: `curl` ke `/api/agregat` tanpa cookie harus 401, bukan data.
- **Browser**: buka dashboard, bandingkan angkanya dengan versi `md-command-center-uji`
  — 51 dealer, 78 POS, 18.512 unit, 3.027 kelurahan terlayani harus sama persis.
- **Tanpa internet**: matikan koneksi keluar, muat ulang halaman. Harus tetap jalan
  penuh — kalau tidak, masih ada CDN yang tertinggal.
- **Uji pindah server**: hentikan server, salin folder proyek **dan** `data/` ke lokasi
  lain, jalankan `npm install && npm start`, buka dashboard. Angkanya harus sama persis.
  Kalau ada yang perlu disetel manual selain `.env`, syarat portabilitasnya belum
  terpenuhi. Lakukan ini di Fase 6, bukan nanti saat benar-benar pindah.
  (Server harus dimatikan dulu: mode WAL meninggalkan berkas `-wal` dan `-shm` di
  samping `.db`, dan menyalin saat masih jalan bisa menghasilkan database yang rusak.
  `PINDAH.md` harus menyebut ini di baris pertama.)
- **Diakses dari komputer lain**: buka `http://<ip-laptop>:3000` dari laptop rekan di
  WiFi kantor yang sama. Ini menguji hal yang tidak muncul di `localhost`: firewall
  Windows dan `app.listen` yang harus mengikat `0.0.0.0`, bukan `127.0.0.1`.

## Di luar cakupan

- Manajemen pengguna (banyak akun, peran, jejak audit per orang) — keputusanmu satu
  akun; peredamnya tabel `impor`.
- Backup otomatis. Untuk sekarang: salin `data/*.db` saat server mati, sebelum tiap
  impor bulanan. Kalau nanti perlu otomatis, `VACUUM INTO` bisa menyalin database yang
  sedang jalan dengan aman — satu baris, tapi belum ada yang memintanya.
- Chart tren antar bulan. Datanya sekarang tersedia (kolom `periode`), tapi baru berguna
  setelah ada minimal 3 bulan riwayat. Ditambahkan waktu datanya sudah ada.
- Nasib Spreadsheet dan Apps Script yang lama. Rencana ini menganggapnya pensiun. Kalau
  ternyata tim masih memakai spreadsheet itu untuk hal lain, konfirmasi sebelum Fase 0.
- 433 baris di luar 15 kabupaten cakupan dan 29 nama kelurahan yang perlu verifikasi
  manual — masih terbuka, tidak berubah oleh migrasi ini.
