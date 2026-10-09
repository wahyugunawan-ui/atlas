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

Yang tertulis di sini adalah **setup yang benar-benar berjalan** di VPS review
(Hostinger KVM 1, Ubuntu 26.04, 2026-10-09). Alamatnya
`https://187-77-121-178.sslip.io`; masuk ke servernya cukup `ssh atlas` (alias di
`~/.ssh/config` laptop, kunci `~/.ssh/astra_atlas`).

```
Internet ─443/80─► Caddy (HTTPS otomatis) ─► 127.0.0.1:3100 atlas.service ─► 127.0.0.1:5432 PostgreSQL
ufw: hanya 22, 80, 443 · fail2ban menjaga SSH · SSH hanya pakai kunci
/opt/atlas       kode (git clone, milik user atlas)
/var/lib/atlas   DATA_DIR: .env (0600), geo/, uploads/, logs/, backup/
```

### Yang gampang terlewat

- **Server bind ke `0.0.0.0:3100`** (`backend/server/index.js`). Di VPS, port 3100
  tertutup dari luar **hanya karena ufw**. Jangan matikan ufw, dan jangan
  `ufw allow 3100`. Pintu masuknya Caddy.
- **SSH: nilai PERTAMA yang menang.** Image Hostinger membawa
  `sshd_config.d/50-cloud-init.conf` berisi `PasswordAuthentication yes`. Karena itu
  pengerasannya ditaruh di `00-atlas.conf` (terbaca lebih dulu). Cek hasil akhirnya
  dengan `sshd -T | grep passwordauth`, bukan dengan membaca berkasnya.
- **Versi PostgreSQL.** Ubuntu 26.04 membawa PG 18 + PostGIS 3.6 di repo bawaannya.
  Dump dari laptop (PG 17) aman di-restore ke versi yang LEBIH BARU, tapi tidak
  sebaliknya.
- **`CREATE EXTENSION postgis` sebagai `postgres`** sebelum restore. Role `astra`
  bukan superuser. Dump `astra_customers` ikut membawa perintah ekstensi itu, dan
  errornya aman diabaikan karena skema konsumen tidak memakai PostGIS.
- **Swap 2 GB wajib.** Impor `Dealer & POS` memakan RAM sampai 2,7 GB (exceljs
  memuat seluruh workbook).
- **`.env` jangan di-`source` utuh dari bash.** `PASSWORD_HASH` mengandung `$`. Skrip
  yang butuh nilai DB membaca baris `DB_*` saja dengan `grep`.
- **Geo yang diupload cukup empat:** `kelurahan.geojson`, `kecamatan.geojson`,
  `kota.geojson`, `cakupan.pmtiles`. **`konsumen.json` JANGAN ikut.** Berkas lama itu
  berisi nama dan alamat asli dan sudah tidak dipakai frontend.
- **Nama berkas peka huruf besar-kecil** di Linux.

### Langkah ringkas

1. Dasar: `apt full-upgrade`, `timedatectl set-timezone Asia/Jakarta`,
   `unattended-upgrades`, swap 2 GB, user sistem `atlas` (home `/var/lib/atlas`,
   shell nologin)
2. Keamanan: `00-atlas.conf` (PasswordAuthentication no, PermitRootLogin
   prohibit-password), `ufw` deny incoming + allow 22/80/443, `fail2ban` untuk sshd.
   Uji login kunci dari sesi KEDUA sebelum menutup sesi pertama.
3. Runtime: `postgresql-18 postgresql-18-postgis-3 caddy` dari repo Ubuntu; Node 24
   dari NodeSource (repo Ubuntu baru punya Node 22)
4. Database: role `astra` LOGIN CREATEDB dengan sandi `openssl rand -hex 16`; buat
   `astra` + `astra_customers`; postgis di `astra`; `pg_restore --no-owner`; cocokkan
   jumlah baris dengan sumbernya; **hapus berkas dump dari server**
5. Aplikasi: `git clone` ke `/opt/atlas`, `npm ci` sebagai `atlas`, tulis
   `/var/lib/atlas/.env` (`PORT=3100`, `DATA_DIR=/var/lib/atlas`, `COOKIE_SECURE=1`,
   `DB_*`), lalu sandi login diketik sendiri oleh pemiliknya:
   `ssh -t atlas "cd /opt/atlas && sudo -u atlas -H env ACC_ENV_FILE=/var/lib/atlas/.env npm run set-password"`
6. `/etc/systemd/system/atlas.service`: `User=atlas`,
   `Environment=ACC_ENV_FILE=/var/lib/atlas/.env`, `Restart=always`, `RestartSec=5`,
   `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`, `ProtectHome`
7. `/etc/caddy/Caddyfile`:

   ```
   187-77-121-178.sslip.io {
   	encode zstd gzip
   	request_body {
   		max_size 100MB
   	}
   	header {
   		Strict-Transport-Security "max-age=31536000"
   		X-Content-Type-Options nosniff
   		X-Frame-Options DENY
   		Referrer-Policy same-origin
   		X-Robots-Tag "noindex, nofollow"
   		-Server
   	}
   	respond /robots.txt "User-agent: *
   Disallow: /" 200
   	reverse_proxy 127.0.0.1:3100
   }
   ```

   Ganti nama host di baris pertama kalau nanti memakai domain sendiri; sertifikat
   diurus Caddy.
8. Backup: `/usr/local/bin/atlas-backup` (pg_dump `astra` + `pg_restore --list`, gagal
   kalau berkasnya < 1 MB, simpan 14 hari) dijalankan `atlas-backup.timer` tiap
   19:00. `astra_customers` sengaja tidak ikut.

### Pemakaian sehari-hari

| Perlu | Perintah |
|---|---|
| Update ke kode terbaru di GitHub | `ssh atlas atlas-deploy` |
| Lihat log aplikasi | `ssh atlas journalctl -u atlas -f` |
| Status semua layanan | `ssh atlas systemctl status atlas caddy postgresql` |
| Backup sekarang / cek jadwal | `ssh atlas systemctl start atlas-backup` / `systemctl list-timers` |
| Ganti sandi login | perintah `set-password` di langkah 5, lalu `systemctl restart atlas` |

### Cara memeriksanya dari luar

- `https://…/login` → 200, sertifikat Let's Encrypt
- `curl -s -o /dev/null -w '%{http_code}' https://…/api/outlets` → 401
- `https://…/data/kelurahan.geojson` tanpa login → 302 ke `/login`
- POST `/login` salah 6x → yang keenam 429
- `systemctl reboot` → situs hidup lagi tanpa disentuh

**Hati-hati menguji port dari laptop.** `Test-NetConnection` dari laptop melaporkan
3100 dan 5432 "terbuka", tapi port 9999 yang tidak dipakai apa pun juga dilaporkan
sama. Ada perangkat di jaringan laptop (WARP atau antivirus) yang menerima koneksinya
lebih dulu. Ukurannya: aplikasi tidak pernah menjawab HTTP di 3100 dari luar.

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
