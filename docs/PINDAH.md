# Pindah ke komputer atau server lain

Ditulis untuk orang yang bukan tim IT. Ikuti urutannya; tiap langkah ada cara
memeriksanya sendiri, jadi kalau ada yang gagal ketahuannya di langkah itu juga, bukan
seminggu kemudian.

> **Satu hal yang wajib disiapkan lebih dulu di komputer tujuan: PostGIS.** Bukan
> PostgreSQL saja — ekstensinya juga. Tanpa itu, restore database akan gagal di tengah
> dengan pesan tentang tipe `geometry` yang tidak dikenal, dan aplikasinya menolak
> start.

---

## Yang harus ikut pindah

| | Apa | Cara |
|---|---|---|
| 1 | Folder aplikasi | salin foldernya, **tanpa** `node_modules` |
| 2 | Berkas `.env` | salin apa adanya (memuat sandi — jangan lewat chat/email) |
| 3 | Isi database `astra` | `pg_dump`, lihat di bawah |
| 4 | Isi database `astra_customers` | **hanya kalau memang perlu.** Ini PII. |
| 5 | Folder `DATA_DIR` (`C:/astra-data`) | berkas peta di `geo/`, arsip Excel di `uploads/` |

`node_modules` sengaja tidak ikut: isinya berbeda antar sistem operasi, dan menyalinnya
dari Windows ke Linux menghasilkan error yang membingungkan. `npm install` di tempat
baru membuatnya ulang.

---

## Langkah

### 1. Di komputer LAMA — ekspor database

```
pg_dump -U astra -Fc astra > astra.dump
```

`-Fc` (format custom) dipakai, bukan SQL polos: poligon kelurahan jadi jauh lebih kecil
dan restore-nya bisa memilih urutan objek sendiri.

Kalau data konsumen ikut pindah:

```
pg_dump -U astra -Fc astra_customers > astra_customers.dump
```

**Berkas `astra_customers.dump` memuat nama dan alamat konsumen.** Pindahkan lewat USB
atau folder jaringan, jangan lewat email atau chat. Hapus setelah selesai dipakai.

Kalau memang tidak perlu, lewati saja — aplikasinya jalan penuh tanpa itu, yang hilang
cuma daftar konsumen di panel kelurahan.

Periksa: `astra.dump` harus berukuran puluhan MB (poligonnya besar). Kalau cuma
beberapa KB, dumpnya gagal — jangan lanjut.

### 2. Di komputer BARU — pasang Node dan PostgreSQL + PostGIS

Lihat [README.md](../README.md) bagian "Memasang pertama kali", langkah 1 sampai 3. Ada
jalur tanpa hak admin di sana kalau installer-nya tidak bisa dipakai.

Periksa:

```
psql -U astra -d astra -c "SELECT PostGIS_Version()"
```

Harus keluar nomor versinya. Kalau error, **berhenti di sini** — langkah berikutnya
pasti gagal.

### 3. Salin folder aplikasi dan `.env`

Letakkan di mana saja. **Jangan di dalam OneDrive/Google Drive/Dropbox.**

### 4. Impor database

```
pg_restore -U astra -d astra --no-owner astra.dump
```

Kalau data konsumen ikut:

```
createdb -U astra astra_customers
pg_restore -U astra -d astra_customers --no-owner astra_customers.dump
```

`--no-owner` dipakai supaya kepemilikan objek mengikuti pengguna yang me-restore, bukan
nama pengguna di komputer lama yang mungkin tidak ada di sini.

Periksa:

```
psql -U astra -d astra -c "SELECT COUNT(*) FROM sales; SELECT COUNT(*) FROM coverage; SELECT COUNT(*) FROM villages WHERE geom_m IS NOT NULL"
```

Ketiganya harus sama dengan di komputer lama. Yang ketiga paling penting: kalau nol,
poligonnya tidak ikut dan jangkauan tidak akan pernah bisa dihitung.

### 5. Salin folder data

Salin seluruh `C:/astra-data` (atau isi `DATA_DIR` di `.env`) — kecuali `pgdata`, yang
milik server database dan sudah tergantikan oleh langkah 4.

Yang wajib ada: `geo/kelurahan.geojson`. Tanpa itu peta kosong di browser, meskipun
angka jangkauannya tetap benar (angkanya dari database, gambarnya dari berkas).

Kalau letaknya berubah di komputer baru, sesuaikan `DATA_DIR` di `.env`.

### 6. Pasang dependensi dan jalankan

```
npm install
npm start
```

Periksa: bukalah alamatnya, login, dan pastikan empat hal ini benar:

- **KPI teratas** angkanya sama dengan di komputer lama
- **Panel Analisis Performa** menampilkan persentase yang berbeda-beda antar pos —
  kalau SEMUA pos 0%, `coverage` tidak ikut terbawa, jalankan `npm run seed-coverage`
- **Halaman Master Pos Dealer** menampilkan koordinat, bukan kolom kosong
- **Peta** menggambar batas kelurahan — kalau kosong, `geo/kelurahan.geojson` belum ada

---

## Pindah ke VPS Linux

Sama persis sampai langkah 6, dengan empat tambahan.

**PostGIS dipasang lewat paket, jauh lebih mudah daripada di Windows:**

```
sudo apt install postgresql-17 postgresql-17-postgis-3
```

**Nama berkas peka huruf besar-kecil.** Windows menganggap `Kelurahan.geojson` dan
`kelurahan.geojson` sama; Linux tidak. Kalau peta kosong padahal berkasnya jelas ada,
ini penyebabnya.

**`DATA_DIR` pakai path Linux**, misalnya `/var/astra-data`.

**Server harus hidup lagi setelah reboot.** Di laptop, `start.bat` dijalankan orang. Di
VPS tidak ada yang menjalankannya. Buat systemd service:

```ini
# /etc/systemd/system/astra.service
[Unit]
Description=Astra Command Center
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/astra-command-center
ExecStart=/usr/bin/node src/server/index.js
Restart=always
User=astra

[Install]
WantedBy=multi-user.target
```

```
sudo systemctl enable --now astra
sudo systemctl status astra
```

**Kalau dibuka ke internet**, dua hal wajib sebelum itu:

1. HTTPS lewat Caddy atau Nginx di depannya, lalu `COOKIE_SECURE=1` di `.env`
2. PostgreSQL **jangan** dibuka ke internet — biarkan `listen_addresses = 'localhost'`

Tanpa nomor 1, sandi dan cookie sesi lewat sebagai teks polos.

---

## Backup rutin

```
pg_dump -U astra -Fc astra > astra-YYYY-MM-DD.dump
```

Sebulan sekali, atau setiap habis impor. Simpan di tempat lain, bukan di komputer yang
sama — backup yang ikut hilang bersama komputernya bukan backup.

`astra_customers` sengaja **tidak** ikut di backup rutin. Kalau memang perlu, buat
terpisah dan perlakukan seperti berkas rahasia. Itu alasan kedua database ini dipisah.

---

## Kalau macet

| Gejala | Sebabnya |
|---|---|
| `Tidak bisa menghubungi PostgreSQL` | servernya belum jalan, atau `DB_PASSWORD` di `.env` salah |
| `Database ini tidak punya ekstensi PostGIS` | `CREATE EXTENSION postgis;` belum dijalankan di database itu |
| `pg_restore` error soal tipe `geometry` | PostGIS belum dipasang SEBELUM restore. Pasang dulu, buang databasenya, ulangi. |
| `password authentication failed for user "astra"` | role belum dibuat, atau sandinya beda dari `.env` |
| `permission denied to create database` | role `astra` belum punya CREATEDB — `ALTER ROLE astra CREATEDB;` |
| Login gagal padahal sandinya benar | `.env` tidak ikut tersalin; `PASSWORD_HASH` kosong |
| Peta kosong tapi angkanya benar | `geo/kelurahan.geojson` tidak ada, atau `DATA_DIR` salah |
| Semua pos 0% jangkauan | tabel `coverage` kosong — `npm run seed-coverage` |
| `seed-coverage` bilang 0 outlet | kolom `geom_m` kosong — `npm run seed-regions` dulu |
| Angka penjualan nol | tabel `sales` kosong — dumpnya tidak terestore |
