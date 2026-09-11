# TUTOR.md — panduan pemasangan, untuk dibaca dan dijalankan oleh Claude Code

Berkas ini bukan untuk dibaca manusia. Ini naskah kerja untukmu (Claude Code), yang
sedang jalan di komputer seseorang **non-IT** yang baru saja mengekstrak zip proyek ini
dan memasang VS Code. Dia tidak tahu apa itu terminal, database, atau environment
variable — dan tidak punya siapa pun untuk bertanya kalau kamu tidak menjelaskan.

Ikuti fase-fase di bawah berurutan. Jangan lompat fase karena "kelihatannya sudah
beres" — cek betulan dengan perintah yang disebutkan.

## Cara bicara ke pengguna ini

- Jelaskan istilah sebelum dipakai. Bukan "jalankan migrasi", tapi "aplikasi ini akan
  membuat tabel-tabelnya sendiri di database, sekali saja".
- Sebelum menjalankan apa pun yang mengubah komputernya (memasang program, membuat
  database, menulis berkas di luar folder proyek), katakan apa yang akan terjadi dan
  tunggu dia bilang "ya".
- **Jangan pernah minta dia mengetik sandi di chat ini.** Kalau sebuah langkah butuh
  sandi (lihat Fase 4), suruh dia jalankan sendiri di jendela terminal, dan sandi
  database sebaiknya kamu yang buatkan acak — dia tidak perlu mengingatnya sama sekali.
- Kalau sebuah perintah gagal, tempelkan pesan errornya, cocokkan ke tabel di bagian
  Troubleshooting di bawah sebelum menebak-nebak.
- Referensi lengkap ada di [README.md](../README.md) kalau sesuatu di luar dugaan
  terjadi dan panduan ini tidak menjawabnya.

---

## Fase 0 — Pastikan posisi

Cek `package.json`, `README.md`, dan `CLAUDE.md` ada di folder saat ini — itu tandanya
kamu sedang berada di dalam folder proyek yang diekstrak, bukan di satu tingkat di
atasnya atau di dalam sub-folder.

Cek juga apakah path folder ini mengandung `OneDrive`. Kalau ya, beri tahu pengguna:
folder tersinkron bisa mengunci berkas di tengah proses dan bikin pemasangan gagal
setengah jalan. Sarankan dia memindahkan folder hasil ekstrak zip ke path lokal
sederhana, misalnya `C:\astra-command-center`, sebelum lanjut — lalu buka folder itu
lagi di VS Code.

## Fase 1 — Node.js

Jalankan `node -v`. Butuh **20.11 atau lebih baru** (lihat `engines` di `package.json`).

Kalau belum terpasang atau versinya kurang:
1. Suruh pengguna buka [nodejs.org](https://nodejs.org), unduh versi **LTS**, jalankan
   installer-nya dengan pilihan bawaan (Next/Next/Install) — tidak butuh hak admin
   untuk versi installer standar di sebagian besar komputer, tapi kalau muncul
   pemberitahuan permission ditolak IT, itu artinya dia perlu diinstal lain waktu oleh
   yang punya hak admin.
2. Setelah dia bilang selesai, buka ulang jendela terminal (PATH baru belum kebaca di
   jendela lama) dan cek lagi `node -v`.

Jangan lanjut ke fase berikutnya sebelum ini lolos.

## Fase 2 — PostgreSQL + PostGIS

Tanyakan dulu: **"Apakah kamu punya hak admin di komputer ini (bisa pasang program
tanpa diblokir)?"** Jawabannya menentukan jalur mana yang dipakai.

### Kalau ADA hak admin

1. Unduh installer dari
   [postgresql.org/download/windows](https://www.postgresql.org/download/windows/)
   (versi 17), pengguna jalankan sendiri.
2. Di akhir installer, **Stack Builder** akan muncul otomatis — pilih PostGIS dari
   daftar kategori "Spatial Extensions" dan pasang.
3. Verifikasi dengan `psql --version` di terminal baru.

### Kalau TIDAK ADA hak admin

Jalur ini tidak butuh installer sama sekali, jadi kamu bisa jalankan sebagian besar
langkahnya sendiri lewat command line setelah pengguna mengunduh dua berkas:

1. Minta dia unduh **PostgreSQL Binaries** (arsip ZIP, bukan installer) dari
   [enterprisedb.com/download-postgresql-binaries](https://www.enterprisedb.com/download-postgresql-binaries),
   pilih Windows x86-64, versi 17.
2. Minta dia unduh **PostGIS bundle** yang cocok dari
   `download.osgeo.org/postgis/windows/pg17/`.
3. Ekstrak PostgreSQL ke `C:\Users\<nama>\pg` (atau lokasi lain tanpa spasi di
   namanya), lalu ekstrak PostGIS dan salin isinya ke dalam folder `pgsql` hasil
   ekstrak PostgreSQL — menimpa `bin`, `lib`, `share`.
4. Jalankan:
   ```
   pgsql\bin\initdb -D C:/astra-data/pgdata -U postgres --encoding=UTF8
   pgsql\bin\pg_ctl -D C:/astra-data/pgdata -l C:/astra-data/pg.log start
   ```
5. Verifikasi dengan `pgsql\bin\psql -U postgres -c "SELECT version();"`.

Ini jalur yang sudah terbukti jalan penuh (dipakai di laptop pengembangan), jadi ikuti
persis — jangan improvisasi langkahnya.

## Fase 3 — Role dan database

Buat sandi database acak sendiri (jangan tanya pengguna) — dia tidak akan pernah perlu
mengetiknya, cuma tersimpan di `.env`:

```
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Simpan hasilnya, lalu coba jalankan (ganti `<sandi>` dengan hasil di atas):

```sql
psql -U postgres -c "CREATE ROLE astra LOGIN PASSWORD '<sandi>' CREATEDB;"
psql -U postgres -c "CREATE DATABASE astra OWNER astra ENCODING 'UTF8';"
psql -U postgres -d astra -c "CREATE EXTENSION postgis;"
psql -U postgres -d template1 -c "CREATE EXTENSION postgis;"
```

Kalau `psql` minta sandi postgres dan macet (terminal ini tidak interaktif), jangan
dipaksa — sebutkan ke pengguna empat baris SQL di atas dan minta dia jalankan sendiri
lewat `psql -U postgres`, lalu tempel satu-satu.

## Fase 3.5 — Kalau ada file dump database (`astra.dump`, mungkin juga `astra_customers.dump`)

Cek apakah folder ini disertai file `.dump`. Kalau **tidak ada**, lewati seluruh fase
ini dan lanjut ke Fase 4 seperti biasa.

Kalau **ada**, itu berarti pengirim sudah menyalin isi databasenya supaya temanmu tidak
perlu impor ulang dari nol. Ini menggantikan `seed-regions`, `seed-coverage`, dan impor
manual di Fase 4 — jangan jalankan langkah-langkah itu kalau restore di sini berhasil.

`astra_customers.dump` berisi **nama dan alamat konsumen sungguhan** kalau disertakan.
Beri tahu pengguna itu sebelum lanjut, dan sebutkan bahwa file `.dump` sebaiknya
dihapus dari laptopnya setelah proses restore ini selesai (bukan cuma dipindah ke
Recycle Bin — hapus permanen, karena isinya PII).

Restore `astra` (wajib ada):
```
pg_restore -h 127.0.0.1 -U astra -d astra --clean --if-exists --no-owner astra.dump
```

Kalau ada juga `astra_customers.dump`, database-nya belum ada (server sengaja tidak
membuatnya di awal) — buat dulu, baru restore:
```
psql -U postgres -c "CREATE DATABASE astra_customers OWNER astra ENCODING 'UTF8';"
pg_restore -h 127.0.0.1 -U astra -d astra_customers --clean --if-exists --no-owner astra_customers.dump
```

Kedua perintah `pg_restore` di atas akan minta sandi role `astra` — pakai sandi acak
yang kamu buat sendiri di Fase 3 (isi via `PGPASSWORD`, atau minta pengguna tempel
manual kalau macet karena non-interaktif, sama seperti di Fase 3).

Setelah restore sukses, lanjut ke Fase 4 tapi **lewati** `npm run seed-regions` dan
`npm run seed-coverage` — datanya sudah ikut di dalam dump.

## Fase 4 — Siapkan aplikasi

```
npm install
```

Ini otomatis mengunduh library frontend (`vendor`) dan membangun CSS (`css`) —
butuh koneksi internet sekali di awal.

Salin `.env.example` ke `C:/astra-data/.env` (lokasi ini yang dibaca `start.bat`
secara default, jadi tidak perlu `.env.path` kecuali pengguna nanti memindahkan
folder data). Isi:

- `DB_PASSWORD` = sandi acak dari Fase 3
- `DATA_DIR=C:/astra-data`

Lalu jalankan (**lewati kalau sudah restore dump di Fase 3.5**):

```
npm run seed-regions
```

**Set sandi login aplikasi — kamu TIDAK bisa menjalankan ini sendiri**, karena
perintahnya menunggu ketikan sandi tersembunyi dan tool-mu tidak punya input
interaktif. Minta pengguna:

1. Buka jendela terminal baru sendiri di folder proyek ini (klik kanan folder di
   VS Code → "Open in Integrated Terminal", atau buka Command Prompt biasa lalu
   pindah ke folder ini).
2. Ketik `npm run set-password`, isi sandi yang dia pilih sendiri (minimal 8
   karakter), ini yang dipakai bersama seluruh timnya untuk login ke aplikasi.
3. Kembali ke sini dan bilang sudah selesai. Jangan tanya sandinya apa.

Setelah dia konfirmasi, lanjutkan sendiri (**lewati kalau sudah restore dump di Fase 3.5**):

```
npm run seed-coverage
```

(Aman dijalankan meski belum ada data pos/dealer — hasilnya nol dan tidak error.
Import data penjualan sesungguhnya dilakukan lewat halaman **Import Data** di
browser setelah aplikasi jalan, bukan lewat command line — itu satu-satunya jalur
yang otomatis menyimpan nama & alamat konsumen, yang memang dibutuhkan tim tiap
bulan.)

Lewati `npm run seed-outlets` — itu cuma untuk memindahkan data dari versi lama
proyek ini (`md-command-center-uji`), yang tidak ikut di dalam zip.

## Fase 5 — Jalankan

Suruh pengguna klik dua kali **`start.bat`** di folder proyek. Jendela hitam yang
muncul adalah servernya — jangan ditutup selama aplikasi dipakai. Buka
`http://localhost:3000` di browser, login dengan sandi dari Fase 4.

Kalau mau menguji dulu tanpa data sungguhan, buatkan data latihan:

```
npm run demo-excel -- C:\astra-data\demo\DEMO-latihan.xlsx
```

lalu dia unggah lewat halaman Import Data, pilih bulan yang belum ada datanya.

## Fase 6 — Opsional: nyala otomatis

Tanyakan apakah dia mau aplikasi ini otomatis nyala tiap kali dia login ke Windows,
dan otomatis di-backup tiap hari. Kalau ya:

```
powershell -ExecutionPolicy Bypass -File ops\install-tasks.ps1
```

Tidak butuh hak admin. Batal dengan menambahkan `-Uninstall`.

---

## Troubleshooting cepat

| Gejala | Sebabnya biasanya |
|---|---|
| `Tidak bisa menghubungi PostgreSQL` | servernya belum jalan (`pg_ctl start`), atau `DB_PASSWORD` di `.env` salah |
| `Database ini tidak punya ekstensi PostGIS` | `CREATE EXTENSION postgis;` belum dijalankan di database itu |
| `Port 3000 sedang dipakai` | servernya sudah jalan di jendela lain |
| Peta kosong, kelurahan tidak muncul | `npm run seed-regions` belum dijalankan |
| Semua pos 0% jangkauan | `npm run seed-coverage` belum dijalankan, atau pos belum punya koordinat |
| `Tidak menemukan berkas .env` | jalankan lewat `start.bat` (bukan `node backend/server/index.js` langsung), atau cek lokasi `.env` |
| `node` tidak dikenali setelah dipasang | jendela terminal lama belum baca PATH baru — buka jendela baru |

Kalau tidak ada di tabel ini, buka [README.md](../README.md) bagian "Kalau ada yang
salah" — lebih lengkap.
