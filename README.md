# Astra Command Center

Dashboard analisis distribusi dealer motor untuk tim channel. Menampilkan sebaran
penjualan per kelurahan di peta, dan menghitung **berapa persen penjualan tiap pos
dealer yang berada di dalam radius jangkauannya** — itu fungsi utamanya.

Jangkauannya dihitung PostGIS di dalam database, dari irisan poligon kelurahan dengan
lingkaran radius. Karena itu databasenya PostgreSQL dan bukan yang lain.

---

## Menjalankan sehari-hari

Klik dua kali **`start.bat`**. Jendela hitam yang muncul adalah servernya; biarkan
terbuka. Buka alamat yang ditampilkan di jendela itu:

```
Buka di laptop ini          : http://localhost:3000
Buka dari komputer sekantor : http://192.168.1.14:3000
```

Menutup jendela = mematikan server. Rekan sekantor tidak perlu memasang apa pun —
cukup membuka alamat kedua di browser.

Sandinya satu, dipakai bersama. Ganti dengan `npm run set-password`.

---

## Memasang pertama kali

Butuh dua hal: **Node 20 atau lebih baru** dan **PostgreSQL 17 dengan PostGIS**.

### 1. Node

Unduh dari [nodejs.org](https://nodejs.org) (versi LTS), pasang dengan pilihan bawaan.
Dikembangkan dan diuji di Node 24; batas minimalnya 20.11 (lihat `engines` di
`package.json`).

### 2. PostgreSQL + PostGIS

Cara biasa: unduh installer dari
[postgresql.org/download/windows](https://www.postgresql.org/download/windows/), lalu
tambahkan PostGIS lewat Stack Builder yang muncul di akhir pemasangan.

**Kalau tidak punya hak admin di komputer itu**, installer-nya tidak bisa dipakai.
Jalur tanpa admin:

1. Unduh **PostgreSQL Binaries** (arsip ZIP, bukan installer) dari
   [enterprisedb.com/download-postgresql-binaries](https://www.enterprisedb.com/download-postgresql-binaries),
   pilih Windows x86-64. Ekstrak ke mana saja, misalnya `C:\Users\<nama>\pg`.
2. Unduh **PostGIS bundle** yang cocok versinya dari
   `download.osgeo.org/postgis/windows/pg17/`, ekstrak, lalu salin seluruh isinya ke
   dalam folder `pgsql` hasil langkah 1 (menimpa `bin`, `lib`, `share`).
3. Siapkan dan jalankan:

```
pgsql\bin\initdb -D C:/astra-data/pgdata -U postgres --encoding=UTF8
pgsql\bin\pg_ctl -D C:/astra-data/pgdata -l C:/astra-data/pg.log start
```

Cara ini yang dipakai di laptop pengembangan sekarang, dan terbukti jalan penuh —
termasuk PostGIS dengan GEOS dan PROJ.

### 3. Database dan penggunanya

Sebagai superuser (`psql -U postgres`):

```sql
CREATE ROLE astra LOGIN PASSWORD 'ganti-dengan-sandi-panjang-acak' CREATEDB;
CREATE DATABASE astra OWNER astra ENCODING 'UTF8';
\c astra
CREATE EXTENSION postgis;

-- supaya database uji ikut punya PostGIS tanpa superuser tiap kali
\c template1
CREATE EXTENSION postgis;
```

Tabelnya tidak perlu dibuat manual — aplikasi membuatnya sendiri waktu start, dan
menolak jalan kalau PostGIS tidak ada.

Database `astra_customers` sengaja **tidak** dibuat di sini. Dia baru dibuat waktu ada
impor pertama yang menyertakan data konsumen. Server yang memang tidak menyimpan PII
tidak boleh diam-diam mulai menyimpannya.

### 4. Aplikasi

```
npm install
copy .env.example .env
```

**Letakkan `.env` di luar folder proyek** kalau proyeknya ada di dalam
OneDrive/Google Drive — berkas itu memuat sandi. Yang disarankan
`C:/astra-data/.env`, lalu buat berkas `.env.path` di folder proyek yang isinya
satu baris: `C:/astra-data/.env`.

Buka `.env`, isi `DB_PASSWORD` dengan sandi yang tadi dibuat. Lalu:

```
npm run set-password        pasang sandi login, sekali
npm run seed-regions        isi tabel kelurahan + poligonnya
npm run import -- data/agustus.xlsx 2026-08
npm run seed-outlets        koordinat + pengelompokan pos yang sudah dikurasi
npm run seed-coverage       hitung rasio jangkauan, ±3 detik
```

Selesai. Jalankan `start.bat`.

### 5. Supaya jalan sendiri (disarankan)

```
powershell -ExecutionPolicy Bypass -File ops\install-tasks.ps1
```

Memasang dua tugas terjadwal, **tanpa perlu hak admin**:

- **Astra Command Center** — menyalakan PostgreSQL lalu aplikasinya setiap kali
  pengguna ini login, dan menghidupkannya ulang (sampai 3x) kalau prosesnya mati.
- **Astra Command Center - Backup** — `pg_dump` tiap hari jam 19:00 ke
  `C:/astra-data/backup`, disimpan 14 hari, dan tiap hasilnya diperiksa dengan
  `pg_restore --list` supaya berkas yang cacat ketahuan hari itu juga.

Membatalkan: tambahkan `-Uninstall` di perintah yang sama.

Keduanya jalan saat **pengguna login**, bukan saat komputer menyala. Untuk server
yang tidak pernah ada yang login, PostgreSQL dan aplikasi harus didaftarkan sebagai
Windows service — itu butuh hak admin sekali, langkahnya di [PINDAH.md](docs/PINDAH.md).

---

## Data

| Di mana | Isinya | Boleh di-backup bebas? |
|---|---|---|
| PostgreSQL `astra` | agregat penjualan, master pos/dealer, jejak impor, rasio jangkauan, **poligon kelurahan** | ya |
| PostgreSQL `astra_customers` | **nama dan alamat konsumen** | tidak — ini PII |
| `DATA_DIR` (`C:/astra-data`) | berkas peta untuk digambar, arsip Excel yang diunggah | arsipnya memuat PII |

Poligonnya ada di dua tempat dengan tugas berbeda: kolom `geom_m` di database untuk
**dihitung**, berkas `geo/kelurahan.geojson` untuk **digambar** di browser. Keduanya
diisi dari sumber yang sama oleh `npm run seed-regions`.

**Mencabut PII sepenuhnya:** `DROP DATABASE astra_customers;`. Aplikasinya tetap jalan
penuh — yang hilang cuma daftar konsumen di panel kelurahan. Itu bukan efek samping,
itu memang cara kerjanya, dan dijaga oleh tes.

Impor **idempoten**: mengimpor bulan yang sama dua kali tidak menggandakan apa pun,
dan tidak menyentuh bulan lain. Suntingan yang dibuat lewat halaman Master Pos Dealer
(koordinat, alamat, pengelompokan dealer) **tidak** ditimpa impor berikutnya.

---

## Perintah

```
npm start                  jalankan server (sama dengan start.bat)
npm test                   semua tes — butuh PostgreSQL jalan
npm run css                bangun ulang CSS — WAJIB setelah mengubah kelas Tailwind
ops/backup.bat             backup sekarang juga
ops\install-tasks.ps1      pasang auto-start + backup harian
npm run set-password       ganti sandi login
npm run import -- <berkas> <YYYY-MM> [--konsumen]
npm run fetch-boundaries   unduh berkas batas wilayah Jateng + DIY (sekali)
npm run seed-boundaries    muat 8.999 kelurahan + poligonnya ke database
npm run export-geo         segarkan berkas peta untuk browser
npm run seed-regions       isi ulang tabel kelurahan dan poligonnya
npm run seed-coverage      hitung ulang SEMUA rasio jangkauan
```

`--konsumen` menyimpan nama dan alamat konsumen. Tanpa itu, tidak ada satu pun PII yang
masuk ke server.

Menggeser pin satu pos lewat aplikasi **tidak** perlu `seed-coverage` — pos itu dihitung
ulang sendiri waktu disimpan.

### Kalau penjualan melebar ke kabupaten baru

Tidak perlu menambah kelurahan satu per satu. Database sudah memuat **seluruh Jawa
Tengah + DI Yogyakarta** (8.999 kelurahan, 40 kabupaten/kota) beserta poligonnya,
jadi kabupaten baru yang muncul di Excel langsung cocok sendiri. Setelah impor:

```
npm run export-geo     # kelurahan baru ikut tergambar di peta
npm run seed-coverage  # hitung jangkauan kalau ada pos di sana
```

Yang dikirim ke browser tetap disaring ke kelurahan yang punya penjualan atau masuk
radius sebuah pos — 4.003 dari 8.999. Database lengkap tidak membuat halaman berat.

### Kalau ada nama kelurahan yang belum cocok

Buka **Master Kelurahan** &rarr; tombol **Cocokkan Nama** (angkanya menunjukkan berapa
yang menunggu). Hampir semuanya cuma beda ejaan dari kelurahan yang sudah ada:
`TEGALREJO` untuk Tegalreja, `PABUARAN` untuk Pabuwaran.

Aplikasi menyarankan padanan terdekat beserta selisih hurufnya, **tapi tidak pernah
mencocokkan sendiri.** Periksa kecamatannya, baru tekan Cocokkan. Salah pilih bisa
dibatalkan lewat tombol silang di baris yang sama.

Pencocokan **berlaku pada impor berikutnya** — baris yang sudah tersimpan tidak berubah
sendiri. Untuk menerapkannya ke bulan yang sedang dilihat, impor ulang berkas Excel yang
sama; mengimpor ulang berkas yang sama aman dan tidak menggandakan data.

Nama yang tidak punya saran sama sekali biasanya pembeli dari luar Jawa Tengah + DIY.
Itu memang dibiarkan, dan tetap dilaporkan sebagai belum cocok.

---

## Kalau ada yang salah

| Gejala | Sebabnya biasanya |
|---|---|
| `Tidak bisa menghubungi PostgreSQL` | servernya belum jalan, atau `DB_PASSWORD` di `.env` salah |
| `Database ini tidak punya ekstensi PostGIS` | `CREATE EXTENSION postgis;` belum dijalankan di database itu |
| `Port 3000 sedang dipakai` | servernya sudah jalan di jendela lain |
| Rekan tidak bisa membuka alamatnya | firewall Windows memblokir port; izinkan Node di jaringan privat |
| Peta kosong, kelurahan tidak muncul | `npm run seed-regions` belum dijalankan |
| Semua pos 0% jangkauan | `npm run seed-coverage` belum dijalankan, atau pos belum punya koordinat |
| `npm test` gagal semua di berkas yang menyentuh database | PostgreSQL belum jalan, atau role `astra` belum punya CREATEDB |
| `Tidak menemukan berkas .env` | jalankan lewat `start.bat`, atau buat `.env.path` berisi letak `.env` |
| Aplikasi mati sendiri dan tidak hidup lagi | tugas terjadwal belum dipasang — jalankan `ops\install-tasks.ps1` |
| Ingin tahu apa yang terjadi kemarin | `C:/astra-data/logs/server-YYYY-MM-DD.log`, disimpan 30 hari |
| Kode sudah diperbaiki tapi perilakunya tidak berubah | server masih memegang kode lama — **restart dulu**, lihat di bawah |
| Tata letak berantakan setelah mengubah tampilan | kelas Tailwind baru belum ikut terbangun — jalankan `npm run css` |

### Setelah kode diperbarui, RESTART

Node memuat kode sekali saja waktu start. Selama server masih jalan, perbaikan
apa pun di berkas `.js` tidak berpengaruh — aplikasinya tetap menjalankan kode
yang dimuat saat dinyalakan. Gejalanya menyesatkan: perbaikannya benar, tesnya
hijau, tapi lewat browser perilakunya tidak berubah sama sekali.

Tutup jendela `start.bat` lalu buka lagi. Kalau memakai tugas terjadwal:

```
Stop-ScheduledTask  -TaskName 'Astra Command Center'
Start-ScheduledTask -TaskName 'Astra Command Center'
```

Pindah ke laptop atau VPS lain: lihat **[PINDAH.md](docs/PINDAH.md)**.

Untuk yang mengembangkan, mulai dari **[PRD.md](docs/PRD.md)** — apa yang aplikasi ini
harus bisa dan arti tiap angkanya. Lalu **[CLAUDE.md](CLAUDE.md)** (aturan kode),
**[ROADMAP.md](docs/ROADMAP.md)** (status), **[DECISIONS.md](docs/DECISIONS.md)** (kenapa begini).
