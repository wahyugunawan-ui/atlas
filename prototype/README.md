# Prototipe UI/UX

Satu berkas `index.html` yang berdiri sendiri, dibuat untuk proposal 13 Agustus 2026.
Isinya hasil meeting 12 Agustus.

**Ini bukan aplikasi.** Tidak ada server, tidak ada database, tidak ada login. Yang
ditunjukkan bentuk dan alurnya. Aplikasi yang sebenarnya ada di `../src` dan
`../frontend`.

## Cara memakai

**Kirim ke orang lain** — kirim `index.html` saja. Dobel-klik untuk membuka.

**Upload ke Netlify** — seret `index.html` ke [netlify.com/drop](https://app.netlify.com/drop).

Butuh internet: peta satelit, peta dasar, dan library-nya diambil dari CDN.

## Fungsi utamanya: analisis jangkauan

Panel kanan menjawab pertanyaan pokok produk ini: **berapa bagian penjualan tiap pos
yang berada di dalam radius jangkauan.**

Alamat konsumen tidak punya koordinat — yang ada cuma kelurahannya. Jadi yang dihitung
bukan "berapa persen konsumen", tapi:

```
untuk tiap (pos, kelurahan): rasio = luas kelurahan yang masuk lingkaran / luas kelurahan
untuk tiap pos:              dalam jangkauan = Σ (unit × rasio kelurahannya)
```

Asumsinya konsumen tersebar merata di dalam kelurahannya. Itu salah di kelurahan yang
setengahnya sawah, tapi jauh lebih dekat ke kenyataan daripada jarak ke titik tengah —
yang memberi jawaban biner "semua masuk" atau "semua keluar" untuk seluruh kelurahan
sekaligus. Asumsinya tertulis di panelnya, bukan cuma di sini.

**Rasionya memakai geografi dan koordinat outlet yang ASLI.** Hanya angka penjualannya
yang sintetis.

Radius bisa diganti di Opsi Peta: 3, 5, 7, atau 10 km. Keempatnya **dihitung sungguhan**
saat build, bukan diskalakan dari satu angka — percobaan pertama memakai slider bebas
yang menskalakan rasio 5 km menurut luas lingkaran, dan hasilnya 36,8% untuk 10 km
padahal jawabannya 55,1%. Penskalaan cuma bisa membesarkan rasio yang sudah ada, tidak
pernah menambahkan kelurahan yang tadinya di luar jangkauan.

| Radius | Dalam jangkauan | Kelurahan terjangkau |
|---|---|---|
| 3 km | 19,0% | 668 |
| **5 km** | **32,3%** | **1.162** |
| 7 km | 43,6% | 1.637 |
| 10 km | 55,1% | 2.266 |

Cara menghitungnya: sampling 1.000 titik per kelurahan. `geo-kelurahan/radius.py`
mengerjakan hal yang sama dengan geometri tepat, tapi geopandas menarik GDAL (±100 MB)
dan tidak terpasang. Sampling meleset 1,3 poin dari nilai sebenarnya — jauh lebih kecil
daripada galat asumsi "tersebar merata" yang dipakai kedua cara. Angka itu diukur, bukan
ditebak; lihat `src/coverage.test.js`.

## Yang bisa dicoba saat demo

- **Klik apa saja** — marker di peta, blok treemap, baris panel performa, poligon
  kelurahan. Semuanya memindahkan ruang lingkup, dan titik penjualan, KPI, heatmap,
  serta panel performa ikut berpindah bersamaan.
- **Titik Penjualan** di Opsi Peta — 19 ribu titik. Pilih satu dealer: titik dealer lain
  hilang dan markernya jadi abu. Pilih satu pos: pos lain milik dealer yang sama tetap
  berwarna tapi lebih kecil.
- **Kartu rekap dealer** — muncul begitu satu dealer atau satu pos dipilih. Isinya
  total, bagian dalam jangkauan, bagian di luar, dan chip untuk tiap pos di bawah
  dealer itu. Chipnya bisa diklik untuk langsung pindah ke pos tersebut, dan tombol
  **Lihat Data Konsumen** pindah ke tab konsumen dengan filter dealer sudah terpasang.

  Angkanya dihitung untuk SELURUH pos dealer itu, tidak ikut dipersempit filter pos —
  yang ditanyakan kartu ini memang rekap dealernya, bukan pos yang sedang dibuka.

- **Pas-kan** — tombol di kiri atas peta. Membawa peta ke data yang sedang tampil,
  bukan selalu ke seluruh wilayah. Kalau satu pos dipilih, yang dipas-kan adalah pos itu
  **beserta seluruh kelurahan yang dilayaninya** — jadi sekali klik langsung kelihatan
  seberapa jauh pelanggannya menyebar, yang justru pertanyaan pokoknya.

- **Layar penuh** — tombol di kiri atas peta. Filter, opsi peta, analisis performa, dan
  kartu rekap dealer semuanya ikut. Escape untuk keluar. Kartunya memakai versi ringkas
  di sini: bentuk yang sama seperti di halaman biasa setinggi 245 px dan menutupi
  sebagian besar peta yang justru sedang dilihat.
- **Sunting pos** — di tabel Master Pos Dealer atau di panel rincian sebelah peta. Bisa
  memperbaiki alamat dan koordinat, termasuk **"ambil dari peta"** untuk merapikan pin
  yang melenceng. Tersimpan di browser, bertahan setelah halaman dimuat ulang, dan bisa
  dikembalikan ke bawaan.

## Data di dalamnya

| Bagian | Asli? |
|---|---|
| Batas 3.466 kelurahan, nama kecamatan/kabupaten/provinsi | **asli** (BPS) |
| Nama 78 outlet, 51 dealer, koordinatnya | **asli** |
| Angka penjualan | **karangan** |
| Nama, alamat, nomor mesin konsumen | **karangan** |
| Titik penjualan di peta | **diacak** di dalam kelurahannya |

**Angka penjualannya sengaja karangan.** URL Netlify bisa dibuka siapa saja, termasuk
mesin pengindeks. Penjualan Astra per kelurahan per dealer di alamat publik adalah
masalah yang tidak enak muncul belakangan. Sebarannya dibuat menyerupai aslinya —
±19.000 unit, dealer besar tetap besar — jadi tampilannya sama meyakinkannya.

Pembangkitnya berbenih tetap. Dua kali build menghasilkan angka yang sama persis,
supaya tangkapan layar di proposal cocok dengan yang tampil saat demo.

## Membangun ulang

```
node prototype/build.js
```

Membaca:

- `C:/astra-data/geo/kelurahan.geojson` — batas kelurahan (atur lewat `DATA_DIR`)
- `C:/astra-data/geo/kota.geojson` — batas kabupaten
- `C:/astra-data/geo/agregat.json` — nama dan koordinat outlet
- `../geo-kelurahan/output/referensi_kelurahan.csv` — nama kecamatan

Menulis `index.html` (±5 MB).

**Jangan sunting `index.html` langsung.** Itu hasil build; suntingannya hilang di build
berikutnya. Tampilan dasarnya diambil dari `../frontend/index.html`, sehingga perubahan
tampilan aplikasi ikut masuk saat build berikutnya. Logika demo dan data sintetis ada
di `src/`:

| Berkas | Isi |
|---|---|
| `src/app.js` | seluruh logika |
| `src/data.js` | pembangkit data sintetis |

## Yang perlu disebut saat presentasi

**Titik penjualan diacak di dalam kelurahannya.** Alamat konsumen belum punya
koordinat, jadi titik-titik itu menunjukkan sebaran, bukan lokasi rumah. Halaman sudah
memberi catatan di sudut peta waktu lapisan itu dinyalakan, tapi lebih baik kamu yang
menyebut duluan.

**Bukti foto rumah belum ada.** Kolomnya sudah disiapkan, isinya menunggu aplikasi
mobile. Ditampilkan apa adanya — sebagian "ada", sebagian "belum" — bukan diisi gambar
palsu.

**51 dealer dapat 51 warna berbeda**, sesuai permintaan meeting. Dari warna ke-9 ke
atas, mata tidak bisa membedakannya dengan andal — itu sebabnya nama dealer selalu
ditempel di sebelah warnanya di legenda, tabel, treemap, dan tooltip. Warna di sini
penanda cepat, bukan satu-satunya sumber informasi.

## Yang belum diputuskan

**Excel per bulan ke sheet baru di spreadsheet** (permintaan meeting) menghidupkan
kembali Google Spreadsheet sebagai penyimpan, sedangkan aplikasi yang sedang dibangun
sudah diputuskan memakai SQLite. Untuk prototipe tidak masalah — yang ditampilkan cuma
alurnya. Tapi kalau proposalnya diterima, ini harus diputuskan: spreadsheet sebagai
tujuan ekspor (aplikasi tetap pegang data), atau spreadsheet sebagai sumber kebenaran
(aplikasi jadi pembaca). Keduanya bisa; yang tidak bisa adalah dua-duanya sekaligus.
