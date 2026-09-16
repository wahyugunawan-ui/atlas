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
Description=ATLAS - Astra Motor Geospasial Marketing Intelligence
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/atlas
ExecStart=/usr/bin/node backend/server/index.js
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

## Kalau tidak ada yang pernah login (server sungguhan)

`ops/install-tasks.ps1` memasang tugas yang jalan saat **pengguna login**. Itu
cukup untuk laptop yang memang dipakai orang. Untuk komputer yang dibiarkan
menyala tanpa ada yang login, PostgreSQL dan aplikasi harus jadi **Windows
service** — dan itu butuh hak admin sekali di awal.

PostgreSQL punya perintahnya sendiri:

```
pg_ctl register -N postgresql-astra -D C:/astra-data/pgdata -o "-p 5433"
sc start postgresql-astra
```

Untuk aplikasinya, Node tidak punya padanannya. Yang biasa dipakai:
[NSSM](https://nssm.cc) — unduh, lalu:

```
nssm install Atlas "C:\Program Files
odejs
ode.exe" backend\server\index.js
nssm set Atlas AppDirectory C:/atlas
nssm set Atlas AppEnvironmentExtra ACC_ENV_FILE=C:/astra-data/.env
nssm start Atlas
```

Setelah keduanya jadi service, buang tugas terjadwalnya supaya tidak ada dua yang
berebut port yang sama:

```
powershell -ExecutionPolicy Bypass -File ops\install-tasks.ps1 -Uninstall
```

---

## Backup rutin

Sudah otomatis kalau `ops/install-tasks.ps1` dipasang: tiap hari jam 19:00,
disimpan 14 hari di `C:/astra-data/backup`. Menjalankannya sekarang juga:

```
ops/backup.bat
```

Perintah dumpnya memakai tiga hal yang penting dan gampang terlewat:

- `--exclude-table=spatial_ref_sys` — tabel milik PostGIS yang tidak boleh ditulis
  pengguna aplikasi. Kalau ikut, tiap pemulihan berakhir dengan baris merah
  "permission denied" yang membuat orang mengira pemulihannya gagal.
- `--no-comments` — membuang `COMMENT ON EXTENSION postgis` yang hanya boleh
  diubah superuser. Skema proyek ini tidak memakai `COMMENT ON` sama sekali.
- `pg_restore --list` setelahnya — membaca daftar isi dump tanpa memulihkan apa
  pun. Dump yang cacat ketahuan hari itu, bukan waktu benar-benar dibutuhkan.

**Salin keluar dari komputer itu.** Backup yang ikut hilang bersama komputernya
bukan backup. Yang benar-benar tidak bisa dibuat ulang dari Excel: koordinat pos
dan pengelompokan dealer hasil kurasi manusia.

### Uji pemulihannya, jangan cuma percaya

Backup yang belum pernah dipulihkan itu harapan, bukan backup. Sekali sebulan:

```
createdb -U astra astra_uji_pulih
pg_restore -U astra -d astra_uji_pulih --no-owner astra-YYYY-MM-DD.dump
psql -U astra -d astra_uji_pulih -c "SELECT COUNT(*) FROM sales; SELECT COUNT(*) FROM villages WHERE geom_m IS NOT NULL"
dropdb -U astra astra_uji_pulih
```

Angkanya harus sama dengan database asli, dan `pg_restore` tidak boleh
mengeluarkan satu baris pun. Sudah diuji: 3.466 kelurahan, 9.609 penjualan,
21.336 baris jangkauan, geometri utuh 14.272 km².

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
