# CLAUDE.md

## Konteks

Dashboard analisis distribusi dealer motor untuk tim channel Astra. Pengguna non-IT,
5–20 orang, dan **tidak ada tim IT di tim mereka** — itu yang menentukan hampir semua
keputusan teknis di sini.

Aplikasi web Node biasa. Jalan di laptop dulu, VPS menyusul. Menggantikan versi Google
Apps Script di `../md-command-center-uji/` (dibiarkan utuh sampai versi ini terbukti).

**Baca [ROADMAP.md](docs/ROADMAP.md) dulu sebelum mulai kerja.** Rencana lengkap ada di
`docs/PLAN.md`, keputusan arsitektur di `docs/DECISIONS.md`.

## Aturan penamaan

Nama berkas, fungsi, variabel, tabel, kolom: **bahasa Inggris**. Komentar,
dokumentasi, dan pesan untuk pengguna: **bahasa Indonesia**.

| Bagian | Gaya | Contoh |
|---|---|---|
| fungsi, variabel | `camelCase` | `buildColorRegistry`, `outletCode` |
| class | `PascalCase` | `ImportLock` |
| konstanta modul | `SCREAMING_SNAKE` | `MAX_MAP_HUES`, `DEALER_PALETTE` |
| kolom & tabel database | `snake_case` | `outlet_code`, `village_code` |
| berkas frontend, rute | `kebab-case` | `map-layers.js`, `/api/outlets` |
| berkas modul Node | `kebab-case` | `src/core/aggregate.js` |

Istilah wilayah memakai terjemahan resmi BPS: kelurahan/desa → `village`, kecamatan →
`district`, kabupaten/kota → `city`, provinsi → `province`, pos/outlet → `outlet`.

## Aturan wajib

- **PII terkurung.** Nama dan alamat konsumen hanya boleh ada di database
  `astra_customers`. `DROP DATABASE astra_customers` harus mematikan fiturnya dan
  meninggalkan sisanya jalan penuh — tanpa menyunting satu baris kode.
- **`/api/customers` wajib punya parameter `village`.** Tanpa itu 400, bukan
  dikembalikan semuanya. Ini satu-satunya hal yang mencegah satu akun bersama menyedot
  seluruh basis data konsumen dalam satu permintaan.
- **`src/core/` tidak boleh meng-`require('fs')`, `pg`, atau apa pun yang
  menyentuh dunia luar.** Kemurnian itu yang membuat fungsi yang sama bisa dipakai
  server, CLI, dan tes tanpa duplikasi.
- **`src/core/coverage.js` TIDAK dibuang meski jangkauan sekarang dihitung PostGIS.**
  Dia dipakai prototipe proposal yang tidak punya database, dan jadi pembanding
  independen di `test/coverage-postgis.test.js`. Dua cara yang saling mengoreksi
  lebih bernilai daripada satu cara tanpa pembanding.
- Escape semua nilai sebelum masuk `innerHTML` — sumbernya Excel, tidak dipercaya.
- Kode wilayah = kode BPS/Kemendagri **bertitik** (`34.04.01.2001`, `34.04`). JANGAN
  diturunkan dari nama.
- Pencocokan kelurahan **tiga tingkat**: `city → district → village`. Dua tingkat
  tabrakan di 171 tempat dari 3.466 kelurahan cakupan.
- Baris yang tidak cocok JANGAN dibuang diam-diam — laporkan jumlah dan namanya.
- Impor idempoten: hapus baris periode X, tulis ulang, di dalam satu transaksi.
- Semua library dari CDN di-download ke `public/vendor/`. Jaringan kantor bisa
  memblokir CDN.
- `data/` harus di luar OneDrive: berkas geo bisa terkunci di tengah pembacaan.
- **Semua query database async.** `pg` mengembalikan Promise; tidak ada pembungkus
  sinkron. `store.transaction(pool, fn)` mengoper SATU koneksi ke `fn` — perintah di
  dalamnya WAJIB memakai koneksi itu, bukan pool, kalau tidak transaksinya palsu.
- **Alias SQL camelCase WAJIB dikutip:** `outlet_code AS "outletCode"`. Postgres
  menurunkan huruf semua pengenal yang tidak dikutip, jadi tanpa kutip fieldnya jadi
  `outletcode` dan pembacanya dapat `undefined` — tanpa error, kolomnya cuma kosong
  di layar.
- **Placeholder ditulis `?`**, diterjemahkan jadi `$n` oleh `toPositional()` di
  `db.js`. Penulisan borongan pakai `store.bulkValues(rows)`. Jangan campur `?` dan
  `$n` dalam satu query.
- **Rahasia tidak pernah di folder proyek** kalau proyeknya di dalam OneDrive.
  `.env` dicari lewat `ACC_ENV_FILE` → `.env.path` → `DATA_DIR/.env` → proyek.
  `config.envFile` menyebut yang benar-benar dipakai, dan `set-password` menulis ke
  situ — bukan ke `.env` di proyek begitu saja.
- **Rute yang mengembalikan PII wajib lewat `piiLimiter`** di `routes.js`, dan tiap
  aksesnya dicatat lewat `repo.logCustomerAccess`. Rute PII baru tanpa keduanya
  membuka jalan penyedotan yang tidak meninggalkan jejak.
- **Jangan `process.exit()` di penangan `uncaughtException`.** Di laptop tanpa
  supervisor, mati berarti mati sampai ada yang menyadarinya.

## Struktur

```
src/core/       logika murni, tanpa I/O — aggregate, region, grouping, csv, coverage
src/server/     Express, auth, db, importer, skema SQL
src/styles/     sumber Tailwind; hasilnya ke public/css/app.css
public/         yang dikirim ke browser; public/js juga di-import tes
public/vendor/  library hasil unduhan. DI LUAR GIT, dibangun `npm run vendor`.
test/           *.test.js dijalankan `npm test`; test/helpers/ bukan tes
scripts/        perkakas baris perintah dan seed
ops/            skrip operasional: auto-start, backup, tugas terjadwal
docs/           ROADMAP (status), DECISIONS (kenapa), PINDAH (pindah server), PLAN
prototype/      berkas proposal mandiri. Ikut memakai src/core/coverage.js.
data/           geo + arsip unggahan. DI LUAR GIT, DI LUAR OneDrive.
```

Akar sengaja cuma memuat `README.md` (pintu masuk) dan berkas ini. Dokumen lain di
`docs/`.

Datanya sendiri di PostgreSQL + PostGIS: database `astra` (tanpa PII, termasuk
poligon kelurahan di kolom `geom_m`) dan `astra_customers` (PII). Tes memakai
`astra_test_<label>` yang dibuat dan dibuang sendiri, mewarisi PostGIS dari
`template1`.

## Perintah

```
npm test          semua tes
npm start         jalankan server
node test/aggregate.test.js    satu berkas saja, waktu sedang memperbaiki
npm run seed-regions           isi kelurahan + poligonnya (wajib sebelum jangkauan)
npm run seed-coverage          hitung ulang semua rasio jangkauan dengan PostGIS
```

## Standar tes

Tiap logika baru meninggalkan satu tes yang runnable. Bukan cuma hijau — **diuji
mutasi**: rusakkan satu hal, pastikan tepat ada tes yang merah. Tes yang tidak pernah
merah tidak menjaga apa pun.

Sudah pernah terjadi di proyek ini: `test_halaman.js` versi lama memeriksa nama field
PII versi rekan (`nama_konsumen`), jadi implementasi baru yang memakai `k.nama` lolos
tanpa satu pun tes merah. Yang dijaga harus sifatnya, bukan bentuk kodenya.

## Dokumentasi wajib

Di **akhir** setiap sesi kerja:

- Perbarui [ROADMAP.md](docs/ROADMAP.md): status fase, pindahkan dari "Sedang dikerjakan"
  ke "Selesai", tambahkan yang baru ditemukan, isi "Diblokir" kalau ada.
- Keputusan arsitektur baru → tambah entri di `docs/DECISIONS.md`. Jangan hapus yang lama.
- Tulis apa adanya. Kalau ada yang belum selesai atau ada bug yang ditemukan tapi
  belum diperbaiki, CATAT — jangan tulis seolah semuanya beres.
