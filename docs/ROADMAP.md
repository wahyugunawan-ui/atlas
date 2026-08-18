# Roadmap

Berkas pelacak. Satu tempat untuk menjawab "sudah sampai mana" dan "kenapa berhenti".
Diperbarui tiap akhir sesi kerja. Jangan hapus entri lama — coret atau pindahkan.

Apa yang produk ini harus bisa ada di [PRD.md](PRD.md). Keputusan arsitektur di
[DECISIONS.md](DECISIONS.md).

> **Catatan untuk entri lama.** Sejak 2026-08-17 folder `src/` jadi `backend/` dan
> `public/` jadi `frontend/`. Entri di bawah masih memakai nama lama dan **sengaja tidak
> ditulis ulang** — ini catatan berurut waktu, dan merapikannya berarti memalsukan
> catatan. Struktur yang berlaku sekarang ada di `PRD.md` dan `CLAUDE.md`.

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
| 5 | Sunting master outlet | **selesai** | pin koordinat, alamat, dan pindah dealer |
| 6 | Bisa dijalankan orang non-IT | **selesai** | `start.bat`, README.md, PINDAH.md |

---

## Sedang dikerjakan

Tidak ada.

---

## Belum dikerjakan

### Perluasan cakupan se-Indonesia (butuh migrasi `geography` dulu)

Ditanyakan 17 Agustus: kalau seluruh Indonesia disiapkan sekaligus, masih kuat?
**Kuat — kecuali proyeksinya.** Angkanya sudah diukur, jadi keputusan nanti tidak
perlu menurunkan ulang apa pun.

**Yang tidak jadi masalah:**

| | terukur (8.999) | proyeksi (83.700) |
|---|---|---|
| Tabel `villages` | 50 MB | ~0,45 GB — Postgres santai |
| Tabel `coverage` | 4,9 MB | tidak ikut membesar; ditentukan jumlah POS |
| Berkas peta ke browser | 3,57 MB | tetap 3,57 MB |
| `/api/summary` | 2,31 MB | tetap 2,31 MB |

Dua baris terakhir itu hasil pekerjaan 17 Agustus: browser sudah tidak terikat pada
besarnya database. Menambah Papua tidak menambah satu byte pun ke halaman.

**Penghalangnya: UTM 49S cuma sahih di 108-114 BT.** Jarak 1.000 m yang sebenarnya,
diukur ulang di UTM 49S:

    Yogyakarta  110,4 BT   1.000 m    0,0%
    Jakarta     106,8 BT   1.002 m   +0,2%
    Banjarmasin 114,6 BT   1.002 m   +0,2%
    Makassar    119,4 BT   1.010 m   +1,0%
    Ambon       128,2 BT   1.047 m   +4,7%
    Jayapura    140,7 BT   1.152 m  +15,2%

Radius "5 km" di Papua sebenarnya 5,76 km — dan seperti biasa di proyek ini, tanpa
satu pun error. Poligonnya sah, angkanya keluar, cuma salah.

**Jalan keluarnya sudah diuji:** ganti `geom_m` ke tipe `geography` (sahih di mana
pun). Dampaknya ke angka yang sudah dilaporkan **cuma 0,06 poin**:

    UTM 49S (sekarang)  14,81%
    geography           14,75%

Per kelurahan bisa beda sampai 0,95 poin, tapi di agregat saling menghapus.

**Kenapa belum dikerjakan.** Jaringan dealer Astra ada di Jateng + DIY. Se-Indonesia
menyelesaikan 29 baris pembeli luar provinsi yang secara analitis memang di luar
radius pos mana pun. Unduhannya ~400 MB (perkiraan dari 32 MB untuk 40 kabupaten,
dikali 514 kabupaten se-Indonesia), dan migrasi `geography` adalah perubahan skema
yang perlu diuji ulang menyeluruh.

**Kapan baru perlu.** UTM 49S masih sahih sampai 114 BT — mencakup SELURUH Jawa dan
Bali. Melebar ke Jawa Timur atau Jawa Barat cukup unduh provinsinya lalu
`seed-boundaries` + `export-geo`, tanpa migrasi apa pun. Yang menuntut `geography`
cuma perluasan ke Sulawesi ke timur.

**Yang belum diukur** dan harus diukur kalau migrasi ini dikerjakan: kecepatan
`geography` dibanding UTM planar. Operasi elipsoid biasanya lebih lambat;
`seed-coverage` sekarang 4 detik, belum tahu jadi berapa.

### Sisanya

- **31 nama / 136 baris menunggu dikonfirmasi manusia** di Master Kelurahan &rarr;
  Cocokkan Nama. Alatnya sudah ada dan sarannya sudah dihitung; yang belum adalah
  KEPUTUSANNYA, dan itu memang bukan pekerjaan program. 29 baris sisanya pembeli luar
  provinsi yang sudah diputuskan dibiarkan.
- **Belum ada penjalan migrasi skema.** `schema.sql` cuma `CREATE TABLE IF NOT
  EXISTS`, jadi perubahan tipe kolom hanya berlaku untuk database yang belum ada.
  Ditandai `ponytail:` di `db.js`. Baru mendesak saat ada mesin kedua — dan jadi
  prasyarat kalau migrasi `geography` di atas dikerjakan.
- **HTTPS belum dipakai.** Mekanismenya ada di `index.js` dan menolak start kalau
  sertifikatnya salah tulis; sertifikatnya yang belum ada.
- **Tugas terjadwal jalan saat login, bukan saat komputer menyala.** Untuk server yang
  tidak pernah ada yang login, PostgreSQL dan aplikasi harus jadi Windows service —
  butuh admin sekali, langkahnya di `PINDAH.md`.
- **Belum ada CI, dan Node 20 belum diuji langsung** meski `engines` mengizinkannya.

---

## Selesai

### Centang simpan data konsumen dibuang; impor lewat halaman selalu menyimpan (2026-08-18)

Menggantikan entri beberapa jam sebelumnya yang baru menyalakannya secara bawaan.
Pemilik proyek menegaskan: pilihannya tidak perlu ada, datanya wajib.

**Yang dibuang cuma pilihannya. Jaminan sisi server tidak berubah sedikit pun:**
`runImport` tanpa `withCustomers` tetap tidak menyentuh `astra_customers`, database
konsumen tetap terpisah, `DROP DATABASE` tetap mencabut semuanya, dan pembatas laju
serta catatan akses tetap berlaku. Jalur mengimpor tanpa PII masih ada — sekarang hanya
lewat `npm run import` tanpa `--konsumen`.

**Jebakan terbesarnya arah nilai bawaan, dan hampir terpasang terbalik.** Halaman tidak
lagi mengirim field `withCustomers` sama sekali, sementara rutenya berbunyi
`String(field) === '1'`. Kalau dibiarkan, hasilnya kebalikan persis dari yang diminta:
halaman yang tidak mengirim apa-apa berarti TIDAK PERNAH menyimpan — impor tetap
berjalan mulus, angka penjualannya tetap benar, dan tab Data Konsumen diam-diam kosong
selamanya. Tidak ada error, tidak ada tes merah.

Diperbaiki jadi `!== '0'` dan dikurung dalam fungsi bernama `simpanKonsumen()` yang
diekspor supaya bisa diuji langsung. Absennya field = simpan; hanya `0` yang eksplisit
yang mematikannya, dan itu yang menjaga jalur CLI dan tes tetap bisa mengimpor tanpa PII.

**Pemberitahuannya sengaja TIDAK ikut dibuang.** Pengunggah tidak lagi bisa menolak di
halaman, jadi setidaknya dia berhak tahu apa yang terjadi. Centangnya diganti satu baris
keterangan, dan `test/page.test.js` menjaga keterangan itu tetap ada: menghapus pilihan
boleh, menghapus pemberitahuan tidak.

Empat mutasi diuji, empat tertangkap — arah nilai bawaan dibalik, `api.js` mengirim
`withCustomers=0` lagi, pemberitahuan dihapus, dan centang dihidupkan setengah jalan.

`KF-IMPOR-16` ditulis ulang; `KF-IMPOR-17` dan `KF-IMPOR-18` baru. 18/18 tes.

### Centang simpan data konsumen jadi menyala secara bawaan (2026-08-18)

Sebelumnya mati secara bawaan — opt-in. Diubah setelah pemilik proyek menyebut alasan
yang sederhana dan benar: tim **memang** memerlukan nama dan alamat tiap bulan, jadi
default mati berarti tiap bulan ada peluang lupa lalu harus impor ulang.

**Yang berubah cuma kenyamanannya, bukan jaminannya.** Tiga sifat yang menjadi dasar
seluruh penanganan PII di proyek ini tidak tersentuh:

- datanya tetap masuk database TERPISAH `astra_customers`, jadi `DROP DATABASE` masih
  mencabut semuanya tanpa menyunting satu baris kode (`KNF-PRIVASI-2`)
- server tetap tidak menyimpan apa pun kalau permintaannya tidak meminta — itu jaminan
  di sisi server, bukan di centang, dan tetap dijaga `test/import.test.js`
- pembatas laju dan catatan akses tetap berlaku

**CLI sengaja TIDAK ikut berubah.** `npm run import` tetap butuh `--konsumen` eksplisit:
perintah yang menyimpan data pribadi tanpa diminta adalah kejutan yang salah arah, dan
CLI dipakai untuk skrip serta perbaikan cepat. Tapi bedanya jadi jebakan sendiri — orang
yang terbiasa dengan halaman akan mengira keduanya sama, lalu bingung kenapa tab Data
Konsumen kosong. Jadi CLI sekarang menyebutkannya di layar tiap kali dijalankan tanpa
flag itu.

**Dijaga karena gagalnya diam.** Kalau atribut `checked` hilang waktu markup dirapikan,
impor bulan berikutnya berjalan mulus, angkanya benar, dan tidak ada satu pun error —
yang hilang cuma data konsumen, dan baru ketahuan berminggu kemudian waktu ada yang
mencari nama yang tidak pernah tersimpan. `test/page.test.js` memeriksa atribut itu ADA,
dan memeriksa labelnya masih menjelaskan cara mematikannya: dengan default menyala, itu
satu-satunya petunjuk bahwa menolak menyimpan PII masih mungkin.

`KF-IMPOR-11` diperbarui bunyinya (dari "hanya tersimpan kalau diminta eksplisit" jadi
jaminan sisi server), `KF-IMPOR-16` baru. 18/18 tes, 2/2 mutasi tertangkap.

### Hapus satu bulan (2026-08-18)

Untuk bulan yang salah diimpor: berkas keliru, periode salah pilih, atau data uji yang
ikut masuk. Impor ulang sudah menimpa periode yang sama, jadi ini bukan untuk
memperbaiki isi — ini untuk membuang bulan yang memang tidak seharusnya ada.

Logika hapusnya sudah ada dan sudah teruji: importer memakainya untuk idempotensi.
Yang baru cuma jalur dan pengamannya.

**Dua keputusan yang diambil pemilik proyek:**

1. **Berkas Excel di arsip TIDAK ikut dihapus.** Dia satu-satunya jalan pulih kalau
   salah hapus — impor ulang berkas yang sama mengembalikan keadaan persis seperti
   semula. Ditukar dengan: PII di arsip belum hilang saat itu juga, dan baru terbuang
   lewat retensi 90 hari. Jalan pulihnya diuji, bukan cuma dijanjikan di komentar.
2. **Konfirmasinya mengetik ulang periodenya**, bukan dialog ya/tidak. Tombolnya
   bersebelahan dengan "impor ulang bulan ini" di kartu yang sama, dan yang satu
   membuang 18.915 baris.

**Urutan PII dulu, dan itu bukan kebetulan.** Dua database berbeda, jadi tidak mungkin
satu transaksi. Kalau penjualan dihapus lebih dulu lalu langkah kedua gagal, yang
tersisa adalah nama dan alamat untuk bulan yang sudah hilang dari layar — PII yang tidak
terlihat siapa pun dan tidak ada yang tahu masih ada. Kebalikannya jauh lebih ringan:
penjualan tanpa PII, dan itu keadaan normal untuk impor tanpa `--konsumen`.

Jejaknya masuk tabel `imports` dengan `result = 'hapus'`, bukan tabel sendiri. Satu akun
dipakai bersama, dan tempat orang mencari "apa yang terjadi pada data" adalah riwayat
impor. Penghapusan yang dicatat di tempat lain sama saja dengan tidak dicatat.

**Uji mutasi menangkap satu tes yang tidak menjaga apa-apa.** Mutasi yang mencabut
pemeriksaan konfirmasi di server awalnya LOLOS: di `server-auth.test.js` database belum
terbuka, jadi permintaan yang lolos penjaga pun berakhir 400 — dari kegagalan query,
bukan dari penolakan. Memeriksa status saja membuat tesnya hijau walaupun penjaganya
dicabut. Diperbaiki jadi memeriksa pesannya. 6/6 setelah itu.

`KF-IMPOR-12` sampai `KF-IMPOR-15` baru di PRD. 18/18 tes, dan dialognya dicoba di
browser sampai gerbang ketiknya — tanpa benar-benar menghapus data Agustus.

### Siap diakses dari luar untuk pitch: trust proxy (2026-08-17)

Kebutuhannya sederhana — teman bisa membuka dashboard waktu pitch. Vercel dibahas dan
**ditolak**: batas body 4,5 MB (Excel sekarang sudah 2,3–3,4 MB), filesystem read-only
mematikan arsip unggahan dan log, dan pembatas PII yang disimpan di memori proses jadi
tidak berfungsi di banyak instance. Jalannya Tailscale Funnel — sudah terpasang di
laptop, memberi HTTPS asli, dan bisa dimatikan lagi dengan satu perintah.

**Yang ditemukan sambil menyiapkan, dan hampir merusak pitch-nya:** aplikasi belum
menyetel `trust proxy`. Di belakang proksi lokal seluruh permintaan tiba dari
`127.0.0.1`, jadi tiga hal rusak sekaligus — pembatas login 5/menit ditanggung bersama
(satu orang salah ketik sandi mengunci semua orang), pembatas PII 30/menit ditanggung
bersama, dan catatan akses PII merekam `127.0.0.1` alih-alih pengunjungnya.

Disetel `'loopback'`, **bukan `true`**. `true` berarti header itu dipercaya dari mana
pun termasuk dari LAN yang sama, dan siapa pun bisa menuliskan IP palsu tiap permintaan
untuk melewati pembatas PII. Pembatas yang bisa dilewati begitu sama saja dengan tidak
ada. Bedanya itu yang dijaga `test/server-auth.test.js`; dua-duanya tertangkap uji
mutasi.

`KNF-PRIVASI-6` baru di PRD.

### Citra satelit tidak pernah muncul — satu lapisan lupa dimatikan (2026-08-17)

Laporannya "render opsi peta satelit masih lama". Ternyata bukan lambat sama sekali:
citranya **tidak pernah muncul**, dan yang terlihat lapisan abu-abu rata.

Dua hipotesis pertama saya gugur oleh pengukuran saya sendiri, lagi:

1. **Jaringan lambat ke Esri** — salah. Ubin di atas Jawa datang dalam 34–162 ms,
   12–18 KB.
2. **`getStyle()` menyalin GeoJSON 4.003 kelurahan tiap kali tombol ditekan** — salah.
   `GeoJSONSource.serialize()` memakai `extend` dangkal; `data` cuma referensi.

Basemap satelitnya diukur terpisah di halaman uji tanpa lapisan aplikasi: **613 ms
sampai diam, 28 ubin.** Cepat. Jadi masalahnya di aplikasi, dan bukti terakhirnya
datang dari daftar lapisan yang masih menyala waktu mode Satelit aktif:

```
polos, bm-satelit, background, kel-isi, ...
                   ^^^^^^^^^^
```

**`setBasemap()` mencari lapisan basemap dengan menyaring `layer.source ===
'protomaps'`, dan lapisan pertama tema itu bertipe `background` — yang di MapLibre
memang TIDAK punya `source`.** Dia lolos dari penyaring, tidak pernah ikut dimatikan,
warnanya `#a3a3a3` pekat, dan posisinya DI ATAS lapisan citra satelit.

Jadi ubinnya diminta, dijawab **200 OK**, lalu tertutup rapat. Tidak ada error, tidak
ada ubin gagal, tidak ada satu pun tes yang merah. Menyembunyikan satu lapisan itu di
konsol langsung memunculkan seluruh citra.

**Mode Polos juga salah selama ini** dan tidak ada yang melaporkannya: yang tampil
`#a3a3a3` milik tema, bukan `#eef1f6` milik kita. Itu justru yang membuat kalimat
laporannya tepat secara harfiah — "cuma kaya yang polos" — Satelit dan Polos memang
menampilkan lapisan yang sama persis.

**Perbaikannya menghapus tebakannya, bukan menambal penyaringnya.** Daftar id lapisan
basemap ditangkap dari tema waktu peta dibuat: tema yang membuat lapisannya, jadi tema
yang tahu daftar lengkapnya. Menambahkan `|| l.type === 'background'` ke penyaring
akan terlihat memperbaiki, tapi ikut mematikan lapisan `polos` milik kita sendiri.

Efek sampingnya `getStyle()` hilang dari jalur ini — dia menserialisasi 66 lapisan tiap
tombol ditekan, walaupun itu bukan penyebab keluhannya.

Dijaga `test/page.test.js`: tema sungguhan dimuat dan dipastikan masih punya lapisan
background tanpa `source` (kalau premisnya hilang, tesnya merah dan penjaganya boleh
dibuang), penyaring `source === 'protomaps'` tidak boleh dipasang lagi, dan daftarnya
harus datang dari tema. Komentar dibuang dulu sebelum diperiksa — catatan di `map.js`
MENGUTIP penyaring lama supaya orang berikutnya tahu kenapa dia salah, dan penjaga yang
menembak kutipan itu akan menghukum dokumentasi yang mencegah bugnya terulang.

18/18 tes, 2/2 mutasi tertangkap, dan ketiga basemap diperiksa satu per satu di browser.

**KF-PETA-11 di PRD naik dari `belum dijaga`** jadi dijaga `test/page.test.js`.

### PRD ditulis mundur, struktur jadi backend/ + frontend/ (2026-08-17)

Proyek ini dibangun tanpa PRD. Enam dokumen yang ada semuanya menjawab "bagaimana",
"kenapa", atau "kapan" — tidak satu pun menjawab **apa yang produk ini harus bisa**.
Untuk tahu itu, orang harus membaca 1.600 baris lalu menyimpulkan sendiri.

**`docs/PLAN.md` bukan cuma kosong, dia menyesatkan.** Isinya SQLite, folder `logika/`
`publik/` `tes/`, tabel `agregat` `pos` `kode_kel`. Tidak satu pun masih benar — dan
`CLAUDE.md` menunjuknya sebagai "rencana lengkap". Dipindah ke
`docs/archive/PLAN-2026-08-12.md` dengan tabel "yang di sini sudah tidak benar" di
kepalanya. **Isinya sengaja tidak disunting**: dokumen sejarah yang dirapikan berhenti
jadi dokumen sejarah.

**Yang paling mahal hilangnya bukan daftar fitur, tapi definisi angkanya.** Tidak ada
satu tempat pun yang menuliskan apa arti "jangkauan", kenapa penyebut "Kelurahan Kosong"
4.003 dan bukan 8.999, atau kenapa satu baris Excel = satu unit tanpa dedupe. Semuanya
ada, terserak di komentar kode. Salah paham di situ menghasilkan angka yang terlihat
benar lalu dilaporkan ke manajemen. Itu bagian 3 di PRD.

**68 kebutuhan ber-ID, masing-masing menyebut berkas tes yang menjaganya** — 49
fungsional, 19 non-fungsional. Delapan ditandai `belum dijaga` apa adanya: treemap,
basemap satelit, pin cepat, lompat ke peta, dan empat kebutuhan non-fungsional yang
memang diukur manual. Daftar itu berguna justru karena jujur. Dijaga
`docs.test.js`: berkas tes yang disebut harus ada, ID tidak boleh kembar, berkas kode
yang disebut harus ada, dan dokumen aktif tidak boleh menunjuk PLAN.md lagi.

**Struktur folder diubah** setelah pertanyaan "harusnya ada folder backend/frontend
biar langsung kelihatan?". Diperiksa dulu sebelum dijawab: `public/js/` ternyata tidak
meng-import apa pun dari `src/` — nol. Jadi masalahnya murni nama yang tidak berbicara,
bukan front dan back yang tercampur, dan pemotongannya aman.

```
backend/core/     <- src/core        frontend/         <- public
backend/server/   <- src/server      frontend/styles/  <- src/styles
```

`src/styles/` memang salah tempat: dia sumber frontend yang duduk di sisi backend.

**Dua hal yang ditemukan justru karena diverifikasi, bukan diasumsikan:**

1. **Tiga path lolos dari penggantian teks** karena dirakit per segmen
   (`path.join(ROOT, 'src', 'server', ...)`, bukan `'src/server/...'`). `npm test`
   langsung merah di tiga berkas — itu memang gunanya menjalankan tes lebih dulu.
2. **Angka jangkauan di ROADMAP ternyata basi.** Tertulis 7,6 / 15,1 / 23,5 / 34,2;
   yang sungguhan **7,5 / 14,8 / 23,0 / 33,5**. Waktu ekspansi Jateng + DIY selesai,
   cuma angka 5 km yang diperbarui dan tiga sisanya tertinggal. Ketahuan karena tiap
   angka di PRD diukur ulang ke database, bukan disalin dari sini.

Entri lama di ROADMAP dan DECISIONS **tetap memakai `src/` dan `public/`** dan sengaja
tidak ditulis ulang — ini catatan berurut waktu, dan merapikannya berarti memalsukan
catatan. Penandanya ditaruh di kepala kedua berkas.

18/18 tes, 6/6 mutasi penjaga dokumen tertangkap.

**Yang belum diverifikasi:** tampilan dashboard sesudah pindah folder, karena sesi
browser habis dan sandinya tidak ada pada saya. Diganti pemeriksaan yang tidak butuh
login — 53 aset dan import ES ditelusuri ke berkas di disk, nol hilang, dan
`/css`, `/vendor` dicek langsung ke server. Sisanya perlu satu kali klik manusia.

### "Tambah Kelurahan" diganti alat pencocokan nama (2026-08-17)

Dua permintaan: warna tombol tambah yang nyaru, dan konsep tambah kelurahan yang
seharusnya memilih kelurahan yang sudah ada supaya poligonnya langsung ikut.

**Warnanya memang salah.** Empat tombol buatan saya memakai `bg-slate-900` generik
sementara seluruh tombol aksi lain memakai `var(--astra-navy)`. Diperbaiki, dan
diperiksa di browser: `rgb(11, 47, 107)`, sama persis dengan tombol Tambah Pos.

**Konsepnya juga salah, dan itu baru ketahuan setelah 8.999 kelurahan masuk.** Fitur
"Tambah Kelurahan" dibuat waktu database cuma memuat 3.466 kelurahan, saat nama yang
tidak cocok memang sering berarti kelurahan yang belum ada. Sekarang tidak lagi.
Diukur pada 50 nama / 165 baris yang tersisa:

| | nama | baris |
|---|---|---|
| Punya padanan dekat di kabupaten yang sama | 31 | 136 |
| — di antaranya saran teratas sekecamatan | 29 | |
| Tidak ada yang mirip (pembeli luar provinsi) | 19 | 29 |

**82% cuma beda ejaan:** TEGALREJO/Tegalreja (18 baris), PABUARAN/Pabuwaran (11),
KEWAYUHAN/Kuwayuhan (7), TIRTA RAHAYU/Tirtorahayu (7). Membuat kelurahan baru untuk
nama-nama itu justru menghasilkan duplikat tanpa poligon — persis kebalikan dari yang
dibutuhkan. Jadi fiturnya dibuang, bukan ditambal, dan diganti tabel `village_aliases`
+ modal Cocokkan Nama.

**Yang dijaga paling ketat: program MENYARANKAN, orang MEMUTUSKAN.** `src/core/matching.js`
menghitung kemiripan dan mengurutkannya, tapi hasilnya tidak pernah sampai ke importer.
Yang masuk indeks pencocokan hanya alias yang sudah diklik manusia. Uji mutasi yang
membuat importer memakai saran terbaiknya sendiri langsung merah — tanpa itu, penjualan
bisa menempel ke kelurahan yang salah tanpa satu pun gejala di layar.

**Kecamatan menang atas jarak** dalam peringkat saran. Cilacap punya dua "Tambakreja" di
kecamatan berbeda; jarak sunting saja tidak bisa memisahkan mereka, dan mengurutkan
dengan jarak saja akan menyodorkan kelurahan yang salah di posisi pertama — tempat yang
paling mungkin diklik tanpa dibaca. Levenshtein ditulis sendiri, bukan memakai ekstensi
`fuzzystrmatch`: `CREATE EXTENSION` butuh superuser, dan tim ini tidak punya orang IT.

**Alias berlaku pada impor berikutnya, bukan surut.** Baris penjualan yang sudah tertulis
tidak diubah dari sini — impor ulang berkas yang sama sudah cukup dan jalur itu sudah
teruji idempoten. Jalur kedua yang mengubah data penjualan adalah jalur yang biasanya
menyimpang. Modalnya menyebut ini apa adanya, bukan menyembunyikannya.

**Dua bug ditemukan sambil mengerjakan, dua-duanya tidak terkait permintaan:**

1. **Byte NUL asli di `tables.js`.** Penanda `DEALER_BARU` ditulis sebagai byte NUL
   sungguhan, bukan escape — tak terlihat di editor, membuat grep menganggap berkasnya
   biner, dan alat apa pun yang menormalkan encoding akan memakannya tanpa suara. Begitu
   hilang, penandanya jadi teks biasa "baru" dan dealer bernama "baru" menabraknya.
2. **CSS Tailwind tidak ikut terbangun.** Modal barunya memakai kelas yang belum pernah
   ada di halaman (`max-w-3xl`, `max-h-[55vh]`), dan kelas yang tidak ada di CSS
   terkompilasi TIDAK melempar error — dia cuma tidak berlaku. Kotaknya jadi 1504x3244
   piksel dengan separuh isinya di atas layar dan tidak bisa dijangkau. Cuma ketahuan
   karena diperiksa di browser; `npm test` hijau sepanjang waktu itu. **Setelah mengubah
   kelas Tailwind di HTML atau JS, `npm run css` wajib dijalankan.**

18/18 berkas tes, 6/6 mutasi tertangkap. Round trip simpan-batalkan diuji di browser
terhadap database sungguhan, dan database dikembalikan ke keadaan semula (0 alias) —
50 keputusan pencocokan itu milik pengguna, bukan milik saya.

### Seluruh Jateng + DIY disiapkan di database (2026-08-17)

Pertanyaannya: bisakah data kelurahan dan poligonnya disiapkan sekaligus supaya
ekspansi tidak perlu menyetel geo lagi — atau tidak efisien? Diukur dulu, baru dijawab:

| | 3.466 (sebelum) | se-Indonesia | |
|---|---|---|---|
| Tabel `villages` | 5,7 MB | ~135 MB | aman |
| `kelurahan.geojson` ke browser | 3,5 MB | ~84 MB | tidak mungkin |
| `villages` di `/api/summary` | 0,6 MB | ~15 MB per halaman | tidak mungkin |

Jadi: **murah di database, mustahil diteruskan apa adanya ke browser.** Rancangannya
jadi "database lengkap, browser cuma menerima yang berarti". Cakupan yang dipilih Jateng
+ DIY lengkap — 93% baris yang belum cocok ada di Jawa Tengah.

**Hasilnya: 3.466 -> 8.999 kelurahan, 15 -> 40 kabupaten/kota.** Baris yang belum cocok
turun dari 349 nama / 568 baris jadi **50 nama / 165 baris**; kecocokan impor naik dari
97,0% ke **99,1%**, dan 403 baris penjualan yang tadinya hilang sekarang terhitung.

**geopandas ternyata tidak diperlukan sama sekali** — pembalikan dari asumsi lama yang
dua kali jadi penghalang. Kolom `path` di berkas sumber array JSON biasa, bukan WKB,
jadi Node membacanya dan PostGIS yang mengurus validasi, proyeksi, dan penyederhanaan.
Dependensi Python + GDAL 100 MB hilang dari jalur ini.

**Tiga temuan yang tidak akan ketahuan tanpa mengukur:**

1. **Karimunjawa.** Penjaga arah koordinat berbunyi di berkas Jepara. Yang tertangkap
   bukan kesalahan: empat kelurahan Karimunjawa memang kepulauan di Laut Jawa 90 km
   di utara pesisir, di lintang -5,7. Tebakan batas utara saya (-6,0) yang salah, bukan
   datanya. Sekarang batasnya diukur dari 8.999 kelurahan: lintang -8,212..-5,725.
2. **Penyaring "kota yang punya penjualan" ternyata tidak menyaring apa pun** — 38 dari
   40 kota punya setidaknya satu penjualan. Diganti kriteria yang berarti: kelurahan
   yang punya penjualan ATAU masuk radius pos. 4.003 dari 8.999.
3. **KPI "Kelurahan Kosong" berubah makna diam-diam.** Tanpa penyaring, dia melonjak
   439 -> 5.673: dari "kelurahan di wilayah kita yang belum ada penjualan" jadi
   "kelurahan di seluruh Jawa Tengah yang tidak kita jual". Benar secara hitungan,
   tidak berguna secara bisnis, dan di layar terlihat seperti kemunduran drastis.
   Setelah disaring: **677**, dan itu justru metrik yang lebih tajam daripada 439 lama.

**Angka jangkauan turun 15,1% -> 14,8%, dan itu BENAR.** 403 baris yang tadinya tak
terlihat sekarang terhitung, sebagian besar di kota tanpa pos sama sekali — jadi memang
di luar jangkauan. Yang 15,1% dulu terlihat lebih bagus karena diam-diam mengabaikan
568 baris. Poligon detail penuh sendiri tidak menggeser angkanya: dihitung ulang dengan
geometri baru sebelum impor, hasilnya tetap 7,6 / 15,1 / 23,5 / 34,2.

Halaman siap dalam 1,4 detik, `/api/summary` 2,31 MB — lebih kecil daripada sebelum
ekspansi meski database 2,6x lebih besar. 17/17 tes, 8/8 mutasi tertangkap.

**Sisa 165 baris yang belum cocok bukan lagi soal cakupan** — 116 Jateng + 20 DIY itu
ketidakcocokan EJAAN NAMA di kota yang kelurahannya sudah ada, dan 29 sisanya pembeli
luar provinsi yang memang dibiarkan.

### Tambah data di Master Pos Dealer dan Master Kelurahan (2026-08-17)

Sebelumnya outlet dan kelurahan HANYA lahir dari impor bulanan. Pos yang sudah buka
harus menunggu sebulan sebelum bisa dipetakan.

**Tambah pos dealer** lurus dan aman: kolom `geom_m` outlet dibuat database dari
lat/lng, jadi pos berkoordinat langsung dihitung jangkauannya. Kodenya diketik manusia,
tidak dibuatkan server — kode itu harus sama dengan yang dipakai Astra di Excel, dan
kalau beda, impor berikutnya membuat outlet KEDUA untuk pos yang sama dan penjualannya
terbelah tanpa gejala. Kode yang sudah dipakai ditolak dengan menyebut pemakainya.

> **Bagian "tambah kelurahan" di bawah SUDAH DIBUANG** pada hari yang sama, setelah
> seluruh Jateng + DIY masuk database berpoligon membuat premisnya tidak berlaku lagi.
> Lihat entri "Tambah Kelurahan diganti alat pencocokan nama" di atas. Yang tetap
> berlaku dan sengaja dipertahankan: penanganan `hasGeom` / `noBoundary` yang dijelaskan
> di sini, sekarang sebagai jaring pengaman yang tidak bergantung pada fitur mana pun.

**Tambah kelurahan punya jebakan yang harus diputuskan sadar,** dan keputusannya
diambil pemilik proyek: kelurahan yang ditambah manual TIDAK punya poligon — batas
wilayah datang dari pipeline geo, bukan ketikan. Tanpa poligon rasio jangkauannya
selalu 0, dan nol itu ambigu: "0% terjangkau" dan "belum bisa dihitung" terlihat sama
persis di layar.

Kalau ikut masuk penyebut, tiap kelurahan baru MENURUNKAN persentase jangkauan — dan
turunnya tampak seperti temuan bisnis ("jangkauan memburuk") padahal cuma data belum
lengkap. Jadi: `summary()` menandainya lewat `hasGeom`, `splitByCoverage()`
mengeluarkannya dari hitungan, dan jumlah unitnya dilaporkan TERPISAH di panel. Dua-duanya
perlu — dikeluarkan tanpa dilaporkan berarti datanya hilang diam-diam, sama buruknya.

Dibuktikan di browser: menambah kelurahan tanpa poligon, persentase tetap 15,1%.

7/7 mutasi tertangkap, termasuk mutasi yang memasukkan kelurahan tanpa batas ke
penyebut dan yang membuang unitnya tanpa melaporkan.

**Yang TIDAK dikerjakan, dan perlu disebut:** ini bukan perluasan cakupan. Dari 349
nama yang belum cocok, **319 nama / 433 baris ada di 39 kota yang tidak tercakup sama
sekali** (Klaten 95 baris, Kudus 55, Wonogiri 31, Sukoharjo 30 ...). Menambahnya satu
per satu lewat form menghasilkan 319 kelurahan tanpa poligon — datanya terhitung, tapi
tidak satu pun ikut jangkauan. Perluasan yang benar lewat pipeline geo; lihat
"Belum dikerjakan".

### Impor Excel: 245 detik jadi 5,7 detik (2026-08-17)

Keluhannya "upload Excel masih lama banget". Riwayat impor menunjukkan pola yang
langsung menunjuk sebabnya:

| berkas | baris | durasi |
|---|---|---|
| CSV | 19.080 | **0 detik** |
| XLSX | 19.080 | **245–287 detik** |

Isi dan hasilnya sama persis. Jadi bukan databasenya, bukan jaringannya, bukan
ukuran datanya — sesuatu di jalur pembacaan xlsx.

**Sebabnya satu baris:** `for (let i = 1; i <= sheet.columnCount; i++)`.

`columnCount` itu GETTER yang memindai ulang seluruh sheet tiap kali dibaca, bukan
angka tersimpan. Ditulis di kondisi loop, dia dievaluasi sekali per kolom per baris —
19.081 x 14 = 267 ribu pemindaian penuh. Diukur langsung:

    i <= sheet.columnCount   20.659 ms per 2.000 baris   (~197 detik)
    batas diangkat           2 ms per 2.000 baris        (~19 ms)

Membaca berkasnya sendiri cuma 1 detik. Seluruh sisanya loop itu.

**Dua tebakan saya yang salah sebelum sampai ke sana**, dicatat karena keduanya
terdengar masuk akal: pertama saya kira `getCell()` yang lambat, kedua saya kira dia
memburuk karena `getCell()` membuat sel yang belum ada. Keduanya dibantah pengukuran
sendiri — `getCell` di rentang baris mana pun tetap 1 ms per 2.000 baris. Yang
membedakan profil pertama dari uji-uji berikutnya ternyata cuma satu: di profil
pertama batas loopnya inline, di sisanya saya kebetulan mengangkatnya ke variabel.

**Diverifikasi identik, bukan cuma cepat.** Seluruh 19.081 baris x 14 kolom
dibandingkan lama vs baru: sama persis. Impor ulang menghasilkan 9.609 baris sales,
18.512 unit, 349 unmatched — sama seperti sebelumnya.

`row.values` dipakai menggantikan `getCell()` sekalian: bukan demi kecepatan (keduanya
sama cepat setelah batasnya diangkat) tapi karena `getCell()` MEMBUAT sel yang belum
ada, jadi sekadar membaca ikut menggemukkan struktur di memori.

**Penjaganya `test/xlsx.test.js`**, dan yang dijaga bukan kecepatannya — tes waktu itu
rapuh, merah di mesin sibuk dan hijau di mesin cepat meski kodenya salah. Yang dijaga:
POLA-nya tidak muncul lagi di kode, dan kolom kosong tidak menggeser indeks. 2/2 mutasi
tertangkap.

### Fase 5 tuntas: memindahkan pos ke dealer lain (2026-08-16)

Pengelompokan dealer awalnya tebakan dari nama pos — bagian sebelum " - ". CLAUDE.md
melarang identitas diturunkan dari nama, dan peredam yang dijanjikan adalah "hasilnya
jadi tabel yang bisa disunting manusia". Separuhnya sudah ada sejak lama (koordinat
dan alamat); separuh yang justru melanggar aturannya belum.

**Kode dealer ditentukan server, tidak pernah datang dari browser.** Halaman mengirim
NAMA; `resolveDealer()` di `repository.js` yang memutuskan kodenya. Nama yang sudah
dipakai dealer lain MEMAKAI ULANG kode dealer itu — jadi "pindahkan pos ini ke
NUSANTARA SAKTI" benar-benar menggabungkan, bukan membuat dealer kedua bernama sama
persis. Pencocokannya tanpa memandang besar-kecil huruf dan spasi berlebih.

**Uji mutasi 5/6.** Tiga yang awalnya lolos ternyata karena DATA UJINYA lemah, bukan
kodenya benar: dealer sasarannya punya kode yang kebetulan turunan namanya, jadi dua
jalur yang berbeda menghasilkan jawaban yang sama. Diganti memakai dealer yang kodenya
`DIKURASI` sementara namanya "Sudah Diperiksa" — keadaan yang memang ada di data
sungguhan karena `seed-outlets.js` memasang kode dari CSV kurasi. Satu lagi lolos
karena outletnya belum punya koordinat sehingga cabang hitung-ulang jangkauan tidak
pernah terjangkau.

Yang keenam mutan yang tertutup lapisan pertama di `resolveGroups()` — sudah tercatat
di `importer.js` sejak dulu, bukan celah baru.

### Dokumen: karakter kontrol dan penjaganya (2026-08-16)

Lima karakter tak terlihat menyelinap ke dalam perintah di `README.md` dan
`docs/PINDAH.md`, dari escape backslash-a dan backslash-b di skrip penyunting: `C:/astra-data`
jadi `C:` + karakter bel, `ops/backup.bat` jadi `ops` + backspace + `ackup.bat`.

Yang rusak justru perintah yang disalin-tempel orang non-IT untuk menyiapkan server.
Tidak kelihatan di editor mana pun, tidak mengubah tampilan di GitHub, dan gagalnya
tanpa menyebut sebab.

Semua diganti jadi garis miring biasa (`C:/astra-data`) yang tidak punya escape sama
sekali, dan `test/docs.test.js` sekarang menolak karakter kontrol di berkas teks mana
pun, plus memeriksa tautan antar dokumen dan keberadaan berkas yang disebut README.
Sudah dibuktikan merah dengan menyuntikkan satu karakter BEL.

Ini kejadian kedua — `.env.example` kena backslash-a lebih dulu. Karena itu penjaganya tes,
bukan kehati-hatian.

Dan tesnya langsung membuktikan diri: beberapa menit setelah dipasang, dia menolak
commit ini sendiri — tiga karakter kontrol baru, di dalam paragraf yang sedang
menjelaskan bahaya karakter kontrol. Kesalahan yang sama, penulis yang sama, lima
menit setelah menuliskan bahayanya. Itu alasan paling jelas kenapa ini harus jadi
tes dan bukan kehati-hatian.

### Kolom waktu jadi TIMESTAMPTZ (2026-08-16)

Empat kolom waktu (`imports.started_at`, `imports.finished_at`, `outlets.updated_at`,
`access_log.at`) masih `VARCHAR(32)` berisi ISO-8601 — warisan SQLite/MySQL. Ketahuan
dari `pg.log`: satu query yang menghitung lama impor gagal dengan `operator does not
exist: character varying - character varying`. Skema diperbaiki, database yang ada
diubah dengan tangan, 13/13 berkas tes tetap lolos. Sisi JavaScript tidak berubah.
Alasan dan perintah ALTER-nya di `DECISIONS.md` entri 2026-08-16.

**Yang ditemukan tapi TIDAK diperbaiki:**

- **Belum ada penjalan migrasi.** `schema.sql` cuma `CREATE TABLE IF NOT EXISTS`, jadi
  perubahan tipe kolom tidak pernah sampai ke database yang sudah ada. Sekarang
  ditambal dengan ALTER manual sekali di satu mesin. Mesin kedua yang databasenya
  sudah berisi akan diam-diam jalan dengan tipe lama. Catatan di `db.js:21`.
- **Satu baris `imports` id=2 tersangkut `result = 'berjalan'`** sejak 2026-08-15
  16:01 — impor yang prosesnya mati sebelum sempat menutup barisnya. Tidak mengganggu
  apa pun selain terlihat di riwayat, tapi berarti impor yang mati kasar tidak punya
  yang membereskannya. Pembersih baris tersangkut saat start belum ada.

### Pengerasan operasional — dari "jalan waktu ditunggui" ke "bisa ditinggal" (2026-08-14)

Pertanyaannya "apakah ini sudah production ready". Jawabannya waktu itu: fungsinya
matang, operasinya belum. Sembilan hal dikerjakan; dua di antaranya sudah menggigit
sendiri di sesi yang sama.

**Yang paling penting, dan bukan soal kode:**

1. **Commit pertama.** Repo git punya nol commit — 74 berkas untracked, tidak ada satu
   pun titik pulih. `DECISIONS.md` mencatat kejadian di proyek ini sendiri: pekerjaan
   yang belum di-commit pernah hilang permanen dan `Code.js` ditulis ulang dari awal.
2. **`.env` keluar dari OneDrive.** Hash sandi, rahasia cookie, dan sandi database ikut
   tersinkron ke cloud Microsoft. Sekarang dicari berurutan lewat `ACC_ENV_FILE` →
   `.env.path` → `DATA_DIR/.env` → proyek, dan `validate()` meneriakkannya kalau
   berkasnya ada di folder tersinkron. `set-password` menulis ke berkas yang
   BENAR-BENAR dipakai — kalau tidak, gejalanya "sandi tersimpan" tapi sandi lama
   masih berlaku.
3. **Auto-start tanpa hak admin.** `ops/install-tasks.ps1` memasang tugas terjadwal
   yang menyalakan PostgreSQL lalu aplikasinya saat login, dan menghidupkan ulang
   sampai 3x kalau prosesnya mati. Dibuktikan: aplikasi dimatikan paksa, tugasnya
   dijalankan, port 3100 hidup lagi.
4. **Backup harian yang pemulihannya sudah diuji.** `ops/backup.bat`, 19:00, simpan 14
   hari. Dua hal ketemu waktu mengujinya sungguhan: `spatial_ref_sys` dan
   `COMMENT ON EXTENSION postgis` membuat tiap pemulihan berakhir dengan baris merah
   walaupun datanya lengkap — persis yang membuat orang panik saat benar-benar
   memulihkan. Dengan `--exclude-table` dan `--no-comments`, pemulihannya **nol error**
   dan tiap tabel cocok persis: 3.466 kelurahan, 9.609 penjualan, 21.336 jangkauan,
   geometri utuh 14.272 km².

**Sisanya:**

5. **Penanganan crash tingkat proses.** Satu promise gagal tanpa `.catch()` menjatuhkan
   Node, dan tidak ada yang menghidupkannya. Sengaja TIDAK memanggil `process.exit()`
   di penangannya: nasihat umum "matikan saja, keadaannya tidak bisa dipercaya" benar
   kalau ada supervisor — di laptop tim tanpa orang IT, mati berarti mati sampai ada
   yang menyadarinya.
6. **Log ke berkas.** 17 `console.*` yang hilang begitu jendela ditutup. `logger.js`
   menyadap `console` — bukan menyediakan API baru — supaya semua titik panggil yang
   sudah ada dan yang nanti ditulis ikut tercatat tanpa disentuh. Ditulis SINKRON:
   stream menahan baris di buffer, dan yang tertahan saat proses mati justru baris yang
   paling dibutuhkan. Disimpan 30 hari.
7. **Pembatas laju di rute PII.** `/api/customers/browse` mengirim 500 baris per
   permintaan tanpa throttle — 37 permintaan menyedot 18.512 baris. Sekarang 30 per
   menit, memakai ulang `RateLimiter` dari `auth.js`, dan ikut dipasang di
   `/api/customers`.
8. **Retensi arsip unggahan.** `uploads/` menyimpan tiap Excel selamanya, dan Excel itu
   memuat PII mentah. Sekarang 90 hari, dibersihkan waktu ada unggahan baru — bukan
   lewat penjadwal terpisah, karena penjadwal yang harus dipasang orang adalah
   penjadwal yang lupa dipasang.
9. **Dukungan HTTPS opsional.** Aktif hanya kalau `SSL_CERT`/`SSL_KEY` menunjuk berkas
   yang ada; salah tulis membuat server MENOLAK start, bukan diam-diam turun ke HTTP.
   TIDAK membuat sertifikat sendiri: layar peringatan merah mengajari orang menekan
   "lanjutkan saja".

**Verifikasi:** 13/13 berkas tes hijau (dua berkas baru: `hardening.test.js`,
`db.test.js`), **8/8 mutasi tertangkap** untuk perilaku baru, browser bersih di kelima
halaman lewat proses yang dinyalakan Task Scheduler, dan pemulihan backup cocok persis.

**Satu yang saya rusak sendiri dan perbaiki:** menghapus `.env` dari proyek memutus
`npm test` — semua tes database gagal karena tidak ada kredensial. Ditambal dengan
`.env.path`, berkas penunjuk berisi satu baris path (bukan rahasia, tetap di-gitignore).

**Yang masih belum, dan sengaja tidak diklaim:**

- **HTTPS belum benar-benar dipakai.** Mekanismenya ada, sertifikatnya tidak. Di LAN
  tertutup ini risiko yang diterima sadar; di VPS nanti Caddy yang mengurusnya.
- **Tugas terjadwal jalan saat LOGIN, bukan saat komputer menyala.** Untuk server yang
  tidak pernah ada yang login, PostgreSQL dan aplikasi harus jadi Windows service —
  butuh admin sekali. Langkahnya ditulis di `PINDAH.md`, belum dijalankan.
- **Node 20 masih belum diuji langsung** meski `engines` mengizinkannya.
- **Belum ada CI.** Tes jalan kalau ada yang ingat menjalankannya.
- **Proyeknya sendiri masih di dalam OneDrive** — 228 MB dan 6.177 berkas
  `node_modules` ikut tersinkron terus-menerus. Rahasianya sudah keluar; foldernya
  belum, dan itu keputusan pemilik proyek.

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

- ~~`dealer_grup.csv` masih hasil tebakan dari nama outlet.~~ **Beres 2026-08-16.**
  Tebakannya masih jadi isian awal — itu memang perannya — tapi sekarang bisa
  diperbaiki lewat halaman Master Pos Dealer, dan perbaikannya tidak ditimpa impor
  bulanan. Peredam yang dijanjikan CLAUDE.md akhirnya benar-benar ada.
- 433 baris data di luar 15 kabupaten cakupan — belum diputuskan dilebarkan atau
  dibuang.
- 132 baris / 29 nama kelurahan belum cocok dan perlu verifikasi manual.
- 52 dari 78 outlet bermarker abu karena kuota 8 warna. Bukan bug — hasil validasi
  palet. Perlu dijelaskan ke pengguna, bukan diperbaiki.
