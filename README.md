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

Buka `.env`, isi `DB_PASSWORD` dengan sandi yang tadi dibuat. Lalu:

```
npm run set-password        pasang sandi login, sekali
npm run seed-regions        isi tabel kelurahan + poligonnya
npm run import -- data/agustus.xlsx 2026-08
npm run seed-outlets        koordinat + pengelompokan pos yang sudah dikurasi
npm run seed-coverage       hitung rasio jangkauan, ±3 detik
```

Selesai. Jalankan `start.bat`.

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
npm run set-password       ganti sandi login
npm run import -- <berkas> <YYYY-MM> [--konsumen]
npm run seed-regions       isi ulang tabel kelurahan dan poligonnya
npm run seed-coverage      hitung ulang SEMUA rasio jangkauan
npm run migrate-mysql      sekali jalan, dari versi MySQL lama
```

`--konsumen` menyimpan nama dan alamat konsumen. Tanpa itu, tidak ada satu pun PII yang
masuk ke server.

Menggeser pin satu pos lewat aplikasi **tidak** perlu `seed-coverage` — pos itu dihitung
ulang sendiri waktu disimpan.

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

Pindah ke laptop atau VPS lain: lihat **[PINDAH.md](docs/PINDAH.md)**.

Untuk yang mengembangkan: **[CLAUDE.md](CLAUDE.md)** (aturan kode),
**[ROADMAP.md](docs/ROADMAP.md)** (status), **[DECISIONS.md](docs/DECISIONS.md)** (kenapa begini).
