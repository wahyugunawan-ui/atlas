# FUSION — Penyatuan Tiga Sumber Data & Golongan Warlok

Spesifikasi teknis Tahap 2 (proses backend) dan Tahap 3 (tampilan) untuk
ATLAS. Ditulis untuk tim engineering yang akan membangunnya, dan untuk
stakeholder yang perlu tahu alasan di balik tiap keputusan.

Status: **rancangan disetujui, implementasi bertahap belum selesai.**
Bagian mana yang sudah jadi dicatat di ROADMAP.md, bukan di sini — dokumen
ini menjelaskan bentuk akhir yang dituju, bukan keadaan hari ini.

---

## 0. Ringkasan

Hari ini ATLAS menjawab satu pertanyaan: **di mana penjualan terjadi.**
Sumbernya tunggal — data penjualan bulanan dari CDB.

Tiga sumber baru (Data KTP, Data Servis, Data Pengiriman) disatukan lewat
satu kunci, **Nomor Mesin**, supaya sistem bisa menjawab pertanyaan yang
jauh lebih tajam:

1. Seberapa yakin kita terhadap lokasi tiap pelanggan?
2. Apakah penjualan tinggi di satu wilayah ditopang basis pelanggan yang
   solid, atau rapuh?

Jawabannya berbentuk **Golongan Warlok** — enam kelas keyakinan lokasi,
masing-masing berbobot — yang lalu diringkas jadi tiga metrik: CW Sales,
Confidence Ratio, dan Retention Index.

### Prinsip yang mengikat seluruh rancangan

| # | Prinsip | Konsekuensi konkret |
|---|---|---|
| P1 | **Non-destruktif** terhadap sistem berjalan | Tabel `sales`, `outlets`, `dealers`, `villages` tidak diubah strukturnya. Sumber baru masuk sebagai tabel baru. Rute `/api/*` lama tidak disentuh; yang baru memakai awalan `/api/v1/*`. |
| P2 | **Nomor Mesin boleh kotor** | Tiap tabel sumber menyimpan baris apa adanya + kolom status. Baris bernomor mesin kosong/ganda tidak dibuang diam-diam dan tidak ikut mencemari tabel fusi. |
| P3 | **Dua mekanisme masuk, satu pipeline** | KTP & Servis: batch bulanan (pola `importer.js` yang sudah ada). Pengiriman: event realtime. Keduanya bermuara ke fungsi klasifikasi yang SAMA. |
| P4 | **PII tetap terkurung** | KTP, Servis, dan Pengiriman semuanya memuat data pribadi (nama, alamat, titik rumah). Semuanya tinggal di database `astra_customers`. Yang menyeberang ke `astra` hanya agregat tanpa identitas. |
| P5 | **Pakai yang sudah ada** | Konversi nama desa → koordinat, pencocokan tiga tingkat, jarak haversine, dan tabel alias semuanya SUDAH ADA di kodebase. Rancangan ini merangkainya, bukan membangun ulang. |
| P6 | **Ambang bukan konstanta kode** | KPI Jarak dan ambang status disimpan di tabel konfigurasi, diubah admin lewat halaman Pengaturan, tanpa deploy ulang. |

### Apa yang sudah ada dan dipakai ulang (penting)

Sebelum menulis satu baris kode baru, ini inventaris yang relevan — semua
sudah berjalan di produksi hari ini:

| Kebutuhan rancangan | Sudah ada sebagai | Letak |
|---|---|---|
| Tabel referensi desa + koordinat | `villages` — 8.999 desa, Jateng (33) + DIY (34) lengkap; `village_code` PK kode BPS bertitik, `lat`/`lng` centroid, `geom` (4326), `geom_m` (32749) | `backend/server/schema.sql` |
| Kunci pencocokan tiga tingkat | `regionKey(cityCode, districtName, villageName)`, `normalizeName()`, `toDottedCityCode()` | `backend/core/region.js` |
| Pencocokan miring (typo) | `levenshtein()`, `maxDistance()`, `suggestVillages()` | `backend/core/matching.js` |
| Koreksi manusia atas nama yang meleset | tabel `village_aliases` (menang atas hasil otomatis) | `backend/server/schema.sql` |
| Laporan baris tak cocok | tabel `unmatched` + `repository.unmatchedWithSuggestions()` | `backend/server/repository.js` |
| Jarak haversine (meter) | `distanceMeters(lat1, lng1, lat2, lng2)` | `backend/core/coverage.js` dan `frontend/js/geo.js` |
| Lingkaran radius di peta | `circle(lng, lat, meters, sides)` | `frontend/js/geo.js` |
| Impor bulanan idempoten + kunci + audit | `runImport()`, `importLock`, tabel `imports` | `backend/server/importer.js` |
| Kurungan PII + pembatas laju + jejak akses | database `astra_customers`, `piiLimiter`, `repo.logCustomerAccess()` | `backend/server/routes.js` |

**Utang yang harus dibereskan lebih dulu:** `distanceMeters()` ada dua
salinan identik (`backend/core/coverage.js` dan `frontend/js/geo.js`).
Rancangan ini menambah pemanggil ketiga di sisi server. Sebelum itu,
ekstrak satu modul murni `backend/core/geo.js` dan buat `coverage.js`
mengimpornya — tiga salinan rumus yang sama adalah tiga kesempatan untuk
menyimpang diam-diam.

---

## Tahap 1 — Input (konteks tetap)

Bagian ini tidak dirancang ulang; dicatat karena Tahap 2 bergantung pada
bentuk persisnya. Nama kolom di bawah dibaca langsung dari berkas contoh
yang diberikan, bukan disalin dari ingatan — termasuk kejanggalannya.

### 1.1 Data KTP (dahulu "Data Konsumen")

Berkas contoh: `CDB Full Agustus 2026 ... Data KTP.xlsx`, 20 kolom:

```
 1 No. Rangka      6 Kode Kota     11 Alamat (dealer) 16 Kode Mesin
 2 Nama            7 Kode Pos      12 Kelurahan       17 No. Mesi     <-- terpotong
 3 Alamat          8 Kode Prov     13 Kecamatan       18 No Mesin     <-- PRIMARY KEY
 4 Kel             9 Kode Dealer   14 Kabupaten       19 Tgl Mohon
 5 Kec            10 NAMA Dealer   15 Propinsi        20 (kosong)
```

Tiga jebakan yang wajib ditangani parser, bukan diasumsikan bersih:

- **Kolom 17 `No. Mesi` dan kolom 18 `No Mesin` berdampingan.** Judul
  kolom 17 terpotong di sumbernya. Kunci yang dipakai adalah **kolom 18**.
  Pencocokan judul harus persis (`No Mesin`), bukan "mengandung kata
  mesin" — kalau tidak, parser bisa memilih kolom yang salah tanpa error.
- **`Alamat` muncul dua kali** (kolom 3 = alamat konsumen, kolom 11 =
  alamat dealer). Ambil berdasarkan posisi relatif terhadap tetangganya,
  bukan berdasarkan nama.
- **Kolom 20 tanpa judul.** Diabaikan, tapi keberadaannya tidak boleh
  menggeser indeks kolom lain.

Empat–lima kolom pertama adalah tambahan dibanding template lama (A–N)
yang dipakai importer hari ini. Template lama harus tetap bisa diimpor:
deteksi versi template dari ada/tidaknya judul `No Mesin`, dan tolak
dengan pesan jelas kalau template lama dipakai untuk fitur yang butuh
nomor mesin.

Lokasi pelanggan di sumber ini **hanya teks** (`Kel`, `Kec`) — belum
berkoordinat. Inilah yang membuat langkah 2.1a wajib ada.

### 1.2 Data Servis

Berkas contoh: `Data Servis Konsumen Agustus.xlsx`, 7 kolom:

```
1 engineno   2 No Rangka   3 Alamat   4 Kecamatan   5 Kabupaten   6 Kelurahan   7 Jenis Service
```

Judulnya `engineno` (satu kata, huruf kecil) dan `Jenis Service` (bukan
"Servis"). Pencocokan judul dinormalkan lebih dulu (huruf kecil, spasi
dan titik dibuang) supaya variasi ejaan antar-bulan tidak memecahkan
impor. Sama seperti KTP, lokasinya teks — butuh 2.1a.

### 1.3 Data Pengiriman

Berbeda sendiri: masuk **realtime** dari perangkat lapangan, bukan
unggahan bulanan. Templatenya dirancang sekarang, integrasinya menyusul.

```
Timestamp Pengiriman | Nomor Mesin | Latitude | Longitude | Akurasi GPS (m)
Lokasi | URL Bukti Foto | Nama Deliveryman | Catatan
```

Ini satu-satunya sumber yang koordinatnya **asli dari GPS** — tidak lewat
konversi desa, dan karena itu satu-satunya yang bisa menyanggah atau
membenarkan dua sumber lain di level presisi rumah.

### 1.4 Dampak struktural pada halaman

- Halaman **Import** jadi grid tiga panel: kiri "Periode Tersimpan"
  (checklist status 3 jenis data per bulan, klik → detail + tombol
  hapus), tengah progres 4 tahap yang sudah ada, kanan "Riwayat Impor".
  Ketiganya juga dijangkau lewat dropdown hover pada menu Import Data,
  memakai pola flyout menu Master yang sudah ada.
- Menu **Data Konsumen** (satu halaman) jadi menu **Data** dengan tiga
  sub-halaman: "berdasarkan KTP", "Lokasi Service", "berdasarkan Lokasi
  Delivery" — pola yang sama persis dengan menu Master.

---

## Tahap 2 — Proses backend

### 2.1 Skema data & normalisasi

#### Keputusan pertama: semuanya PII, jadi semuanya di `astra_customers`

Aturan proyek: nama dan alamat konsumen hanya boleh ada di database
`astra_customers`, dan `DROP DATABASE astra_customers` harus mematikan
fiturnya sambil meninggalkan sisanya jalan penuh.

Ketiga sumber baru melanggar batas itu kalau ditaruh sembarangan:

- KTP membawa **nama + alamat**.
- Servis membawa **alamat**.
- Pengiriman membawa **titik GPS rumah + foto bukti** — bentuk PII yang
  paling tajam dari ketiganya, karena menunjuk satu rumah, bukan satu
  desa.

Maka: **seluruh tabel staging dan tabel fusi tinggal di
`astra_customers`.** Yang menyeberang ke `astra` cuma satu tabel agregat
tanpa identitas (`segment_rollup`, 2.1d). Konsekuensinya lurus dan
memang diinginkan: buang database PII, dashboard Confidence Fusion tetap
menampilkan angka agregat historis, tapi drill-down per Nomor Mesin dan
perhitungan ulang mati — persis seperti fitur PII lain hari ini.

Nomor mesin sendiri diperlakukan sebagai **kuasi-identitas** (menunjuk
satu kendaraan, karena itu satu orang), jadi tidak ikut ke `astra`.

#### 2.1a Tabel staging (database `astra_customers`)

Tiga tabel, satu per sumber, bentuknya mengikuti sumbernya apa adanya
ditambah kolom hasil olahan. Kolom `resolve_status` inilah yang menjawab
prinsip P2: baris kotor tetap tersimpan, tetapi tertandai.

```sql
CREATE TABLE IF NOT EXISTS customer_ktp (
  period          VARCHAR(7)  NOT NULL,          -- 'YYYY-MM'
  engine_no       VARCHAR(32),                   -- kolom 18, boleh NULL
  frame_no        VARCHAR(32),
  name            VARCHAR(200),
  address         VARCHAR(400),
  village_text    VARCHAR(120),                  -- kolom 'Kel' apa adanya
  district_text   VARCHAR(120),                  -- kolom 'Kec' apa adanya
  city_code       VARCHAR(8),
  dealer_code     VARCHAR(64),
  request_date    DATE,
  village_code    VARCHAR(16),                   -- hasil 2.1c, NULL kalau gagal
  resolve_status  VARCHAR(16) NOT NULL,          -- lihat tabel status di bawah
  row_no          INT         NOT NULL,          -- nomor baris di berkas asal
  PRIMARY KEY (period, row_no)
);
CREATE INDEX IF NOT EXISTS idx_ktp_engine ON customer_ktp (engine_no);

CREATE TABLE IF NOT EXISTS service_visit (
  period          VARCHAR(7)  NOT NULL,
  engine_no       VARCHAR(32),
  frame_no        VARCHAR(32),
  address         VARCHAR(400),
  village_text    VARCHAR(120),
  district_text   VARCHAR(120),
  city_text       VARCHAR(120),
  service_type    VARCHAR(80),
  village_code    VARCHAR(16),
  resolve_status  VARCHAR(16) NOT NULL,
  row_no          INT         NOT NULL,
  PRIMARY KEY (period, row_no)
);
CREATE INDEX IF NOT EXISTS idx_service_engine ON service_visit (engine_no);

CREATE TABLE IF NOT EXISTS delivery_ping (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  engine_no     VARCHAR(32),
  sent_at       TIMESTAMPTZ NOT NULL,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  accuracy_m    INT,
  location_text VARCHAR(200),
  photo_url     VARCHAR(500),
  courier_name  VARCHAR(120),
  note          TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ping_engine ON delivery_ping (engine_no, sent_at DESC);
```

Kenapa PK `(period, row_no)` dan bukan `engine_no`: karena nomor mesin
justru yang tidak bisa dipercaya unik di sumbernya. Baris tetap masuk dan
bisa dirujuk balik ke baris ke-berapa di berkas mana — itu yang dibutuhkan
operator waktu memperbaiki data di Excel.

`delivery_ping` sengaja **append-only** (satu baris per kedatangan, tidak
di-upsert): riwayat pengiriman adalah fakta berstempel waktu, dan mesin
yang sama bisa menerima lebih dari satu kiriman.

Nilai `resolve_status`:

| Nilai | Arti |
|---|---|
| `ok` | nama wilayah cocok, `village_code` terisi |
| `alias` | cocok lewat `village_aliases` (koreksi manusia) |
| `fuzzy` | cocok lewat kemiripan, di bawah ambang `maxDistance()` |
| `unmatched` | nama wilayah tidak ditemukan — inilah bahan "Tak Terverifikasi" |
| `no_engine` | nomor mesin kosong/tidak valid — baris tidak ikut fusi |
| `duplicate` | nomor mesin ganda dalam satu periode; lihat aturan di bawah |

**Nomor mesin ganda.** Dalam satu periode, dua baris KTP dengan nomor
mesin sama berarti salah satu salah ketik atau satu unit tercatat dua
kali. Aturannya: baris **pertama** (row_no terkecil) dipakai untuk fusi,
sisanya ditandai `duplicate` dan dilaporkan ke operator dengan jumlah dan
nomornya — pola yang sama dengan `unmatched` hari ini. Diam-diam memilih
salah satu tanpa melapor adalah cara paling halus untuk kehilangan data.

Untuk Servis, ganda itu **wajar** (satu motor servis beberapa kali) dan
tidak ditandai duplikat sama sekali; yang dipakai fusi adalah kunjungan
yang **paling dekat** ke titik KTP (lihat 2.3, kasus batas 2).

#### 2.1b Tabel fusi (database `astra_customers`)

Satu baris per nomor mesin — inilah "satu pelanggan" dalam pengertian
sistem ini.

```sql
CREATE TABLE IF NOT EXISTS customer_fusion (
  engine_no          VARCHAR(32) PRIMARY KEY,
  period             VARCHAR(7)  NOT NULL,       -- periode KTP-nya
  village_code       VARCHAR(16),                -- desa KTP (acuan semua jarak)
  city_code          VARCHAR(8),
  dealer_code        VARCHAR(64),
  outlet_code        VARCHAR(32),
  ktp_lat            DOUBLE PRECISION,
  ktp_lng            DOUBLE PRECISION,
  service_lat        DOUBLE PRECISION,
  service_lng        DOUBLE PRECISION,
  service_count      INT         NOT NULL DEFAULT 0,
  delivery_lat       DOUBLE PRECISION,
  delivery_lng       DOUBLE PRECISION,
  delivery_count     INT         NOT NULL DEFAULT 0,
  dist_service_m     INT,                        -- NULL = tidak ada/tak tergeocode
  dist_delivery_m    INT,
  segment            VARCHAR(24) NOT NULL,       -- kode golongan, lihat 2.3
  weight             NUMERIC(4,2) NOT NULL,
  kpi_radius_m       INT         NOT NULL,       -- ambang yang BERLAKU saat dihitung
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fusion_village ON customer_fusion (village_code);
CREATE INDEX IF NOT EXISTS idx_fusion_dealer  ON customer_fusion (dealer_code);
CREATE INDEX IF NOT EXISTS idx_fusion_segment ON customer_fusion (segment);
```

`kpi_radius_m` disimpan **per baris**, bukan cuma di konfigurasi global.
Tanpa itu, mengubah KPI Jarak membuat seluruh angka lama tidak bisa
dijelaskan lagi ("kenapa dulu dia Warlok?"). Dengan itu, tiap baris
membawa bukti ambang yang dipakainya — dan pipeline bisa tahu persis
baris mana yang basi setelah ambang berubah (2.3a).

#### 2.1c Konversi nama desa → koordinat

Ini yang diminta sebagai "layanan referensi wilayah". **Tabel dan logika
intinya sudah ada**; yang belum ada cuma pembungkusnya.

Yang sudah ada:

- `villages` — 8.999 desa DIY + Jateng, `village_code` (kode BPS
  bertitik) sebagai PK, plus `lat`/`lng` centroid dan poligon `geom_m`.
  Diisi `npm run seed-regions` dari `kelurahan.geojson` + CSV referensi.
- `regionKey(cityCode, districtName, villageName)` — kunci pencocokan
  **tiga tingkat**. Dua tingkat tidak cukup: 171 dari 3.466 nama desa
  bertabrakan kalau kecamatannya diabaikan.
- `village_aliases` — koreksi manusia, ditumpuk di atas hasil otomatis.
- `suggestVillages()` — usulan berbasis Levenshtein, ambang
  `maxDistance(len) = max(2, floor(len/3))`.

Strategi pencocokan, berurutan — berhenti di yang pertama cocok:

```
1. village_aliases[city_code|district|village]   -> status 'alias'
2. regionKey exact (tiga tingkat)                -> status 'ok'
3. suggestVillages() jarak <= maxDistance        -> status 'fuzzy'
4. gagal                                         -> status 'unmatched'
```

Usulan **tidak pernah diterapkan otomatis** pada tingkat 3 kalau
kandidatnya lebih dari satu dengan jarak sama — itu aturan yang sudah
berlaku di impor penjualan hari ini, dan alasannya masih sama: tebakan
yang salah dan senyap lebih mahal daripada baris yang jujur mengaku
tidak cocok. Baris `unmatched` muncul di panel koreksi, operator memilih
sekali, dan pilihannya masuk `village_aliases` — sesudah itu tidak
pernah ditanyakan lagi.

**Cache.** Tidak perlu tabel cache baru. Jumlah kombinasi (kota,
kecamatan, desa) terbatas dan nyaris statis, dan hasilnya sudah tersimpan
permanen di dua tempat: `village_code` pada baris staging, dan
`village_aliases` untuk koreksi. Konversi dilakukan sekali per baris saat
impor, bukan tiap kali halaman dibuka.

**Catatan akurasi yang harus diketahui tim.** `villages.lat`/`lng` adalah
rata-rata titik sudut poligon, dibulatkan 6 desimal — bukan
`ST_Centroid`, dan untuk desa berbentuk cekung (memanjang mengikuti
sungai atau pantai) titik itu **bisa jatuh di luar wilayahnya sendiri**.
Untuk pengukuran jarak sekelas 50 km hal ini tidak berpengaruh. Kalau
kelak KPI Jarak diperketat ke skala 1–5 km, ganti sumber titik ke
`ST_PointOnSurface(geom_m)` (dijamin di dalam poligon) — dan itu satu
perubahan di satu query, bukan perombakan.

#### 2.1d Tabel agregat lintas-database (database `astra`)

Satu-satunya hasil yang menyeberang keluar dari database PII:

```sql
CREATE TABLE IF NOT EXISTS segment_rollup (
  period         VARCHAR(7)  NOT NULL,
  village_code   VARCHAR(16) NOT NULL,
  dealer_code    VARCHAR(64) NOT NULL,
  segment        VARCHAR(24) NOT NULL,
  customer_count INT         NOT NULL,
  weight_sum     NUMERIC(10,2) NOT NULL,   -- sumbangan golongan ini ke CW Sales
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (period, village_code, dealer_code, segment)
);
```

Tidak ada nomor mesin, nama, alamat, atau titik di sini — cukup untuk
seluruh KPI, matriks, peringkat, dan peta agregat di Tahap 3, dan tidak
cukup untuk mengenali siapa pun.

#### 2.1e Tabel konfigurasi (database `astra`)

```sql
CREATE TABLE IF NOT EXISTS app_config (
  key        VARCHAR(64) PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by VARCHAR(64)
);
```

Kunci awal: `kpi_jarak_m` (bawaan `50000`), `confidence_solid_min`
(bawaan `0.65`), `confidence_rapuh_max` (bawaan `0.50`),
`retention_sehat_min` (bawaan `0.50`), `retention_risiko_max`
(bawaan `0.30`).

### 2.2 Pipeline pemrosesan

Dua jalur berdampingan, satu fungsi klasifikasi.

```
  JALUR A — BATCH BULANAN                         JALUR B — REALTIME
  (Data KTP, Data Servis)                         (Data Pengiriman)

  unggah .xlsx                                    POST /api/v1/pengiriman/ping
      |                                                   |
      v                                                   v
  importLock.begin()  <-- kunci yang SAMA           validasi + token
      |                   dipakai impor penjualan          |
      v                                                   v
  baca + cek judul kolom                          simpan ke delivery_ping
      |                                            (append-only, selalu jadi)
      v                                                   |
  konversi desa (2.1c)                                    v
      |                                            tandai engine_no "kotor"
      v                                                   |
  transaksi tunggal:                                      v
    DELETE ... WHERE period = ?                    debounce 60 detik
    INSERT staging baru                                   |
      |                                                   |
      +---------------------+-----------------------------+
                            |
                            v
                 fuseEngines(daftar engine_no)
                 (murni: input baris, output golongan)
                            |
                            v
                 upsert customer_fusion
                            |
                            v
                 rollup -> segment_rollup (DB astra)
                            |
                            v
                 tutup baris audit di tabel imports
```

**Jalur A** mengikuti `runImport()` yang sudah ada apa adanya: satu
`store.transaction()`, `DELETE FROM ... WHERE period = ?` lalu tulis
ulang (idempoten — impor ulang bulan yang sama tidak menggandakan),
`BATCH = 500` baris per perintah (batas 65.535 parameter `pg`), baris
audit di tabel `imports` dibuka `berjalan` dan ditutup `ok`/`gagal`.
Kunci impor **dibagi** dengan impor penjualan dan impor pos yang sudah
ada — tiga impor tidak boleh jalan bersamaan karena ketiganya menyentuh
periode yang sama.

**Jalur B — rekomendasi: micro-batch, bukan per-kedatangan.** Tiap ping
disimpan seketika (tidak boleh hilang), tetapi klasifikasi ulang
ditunda dan digabung dalam jendela 60 detik. Alasannya angka: satu ping
memicu satu perhitungan jarak (mikrodetik) tetapi juga satu pembacaan
baris KTP + Servis, satu upsert fusi, dan satu penulisan ulang
`segment_rollup` untuk desa bersangkutan. Pada jam sibuk pengiriman,
puluhan ping per menit dari satu kota yang sama akan menulis ulang baris
rollup yang sama berkali-kali — beban yang seluruhnya mubazir karena
hasil akhirnya sama. Jendela 60 detik menurunkannya ke satu penulisan,
dengan harga keterlambatan yang tidak terasa di dashboard yang dibaca
per jam. Kalau kelak dibutuhkan seketika, jendela tinggal diperkecil;
angkanya ada di `app_config`, bukan di kode.

**Spatial matching.** Semua jarak memakai haversine
`distanceMeters(lat1, lng1, lat2, lng2)` (bola R = 6.371.000 m, hasil
dalam meter) dari modul bersama `backend/core/geo.js` hasil ekstraksi.
Dua pasangan yang diukur:

- `dist_service_m` = jarak titik desa KTP ↔ titik desa Servis
- `dist_delivery_m` = jarak titik desa KTP ↔ titik GPS Pengiriman

Perhatikan asimetrinya, dan sebutkan ini ke pengguna di UI: dua jarak
pertama adalah **desa ke desa** (presisi kilometer, sebesar ukuran desa
itu sendiri), sedangkan yang melibatkan pengiriman adalah **desa ke
titik rumah** (presisi meter di satu sisi saja). Pada ambang 50 km
perbedaan presisi ini tidak menggeser hasil; pada ambang 5 km, ia
dominan. Itu alasan tambahan kenapa ambangnya dibuat parameter, bukan
angka mati.

### 2.3 Aturan penentuan Golongan Warlok

Nama resmi dipakai di database dan dokumen; label pendek dipakai di
layar, karena sidebar hanya selebar 164 px dan nama panjang pasti
terpotong.

| Kode (DB) | Nama resmi | Label UI | Bobot | Kondisi (KTP selalu ada) |
|---|---|---|---|---|
| `loyal_verified` | Warlok Loyal Verified | Warlok | 1,00 | Servis berdekatan **dan** Kirim berdekatan |
| `service_near` | Warlok ke Bengkel dekat | Setia Bengkel | 0,80 | Servis berdekatan; Kirim jauh/tidak ada |
| `delivery_near` | Warlok kirim dekat | Pembeli Terverifikasi | 0,75 | Kirim berdekatan; Servis jauh/tidak ada |
| `registered_only` | Warga asli | Warga Terdaftar | 0,55 | Tidak ada Servis maupun Kirim |
| `nomad` | Migran / Nomaden | Migran / Nomaden | 0,20 | Servis dan/atau Kirim ada dan tergeocode, tapi melebihi KPI Jarak |
| `unverified` | Tak Terverifikasi | Tak Terverifikasi | 0,05 | Servis dan/atau Kirim ada, tapi gagal dikonversi ke koordinat |

Bobot disimpan di `app_config` juga (kunci `weight_<kode>`), bukan
dipatok di kode — permintaan eksplisit agar dapat dikustom.

#### Urutan evaluasi (wajib berurutan, berhenti di yang pertama cocok)

Beberapa kondisi bisa terpenuhi bersamaan; tanpa urutan yang pasti
hasilnya ambigu. Urutannya:

```
fuseEngine(ktp, services[], pings[], kpi_m):

  0. ktp.village_code == NULL            -> unverified   (0,05)
        // acuan jaraknya sendiri tidak ada; semua pengukuran mustahil

  1. tidak ada services DAN tidak ada pings -> registered_only (0,55)

  2. hitung:
       dS = services yang tergeocode ? min(jarak ke KTP) : NULL
       dD = pings yang valid          ? min(jarak ke KTP) : NULL
       adaGagal = ada service/ping yang TIDAK tergeocode

  3. dS != NULL && dS <= kpi_m && dD != NULL && dD <= kpi_m -> loyal_verified (1,00)
  4. dS != NULL && dS <= kpi_m                              -> service_near   (0,80)
  5. dD != NULL && dD <= kpi_m                              -> delivery_near  (0,75)
  6. (dS != NULL || dD != NULL)                             -> nomad          (0,20)
  7. adaGagal                                               -> unverified     (0,05)
```

Langkah 6 mendahului 7 dengan sengaja: pelanggan yang satu sumbernya
terukur-jauh dan sumber lain gagal tergeocode tetap **Migran**, bukan
**Tak Terverifikasi** — karena kita sudah punya bukti positif bahwa dia
beraktivitas jauh dari alamat KTP-nya. "Tak Terverifikasi" disediakan
hanya untuk keadaan kita benar-benar buta.

#### Tiga kasus batas, dengan angka

Memakai KPI Jarak bawaan 50 km:

**Kasus 1 — persis di ambang.** KTP desa Sinduadi, Servis desa Muntilan,
jarak terhitung **50.000 m tepat**. Perbandingannya `<=`, jadi ini
**berdekatan** → `service_near`. Ambang yang inklusif dipilih supaya
pembulatan koordinat 6 desimal (≈ 11 cm) tidak pernah jadi penentu
golongan seseorang.

**Kasus 2 — dua desa servis dalam satu bulan.** Satu nomor mesin servis
di Sleman (8 km dari KTP) dan di Cilacap (140 km dari KTP). Aturan:
dipakai yang **terdekat** (8 km) → `service_near`. Alasannya: pertanyaan
yang dijawab golongan ini adalah "apakah pelanggan ini punya ikatan
dengan wilayah KTP-nya", dan satu servis jauh saat bepergian tidak
menghapus bukti bahwa dia rutin servis dekat rumah. Kunjungan yang jauh
tidak hilang — tetap tersimpan di `service_visit` dan tampil utuh di
drill-down 3.4. (Alternatif "ambil yang paling sering" ditolak karena
pada data satu bulan mayoritas mesin hanya punya satu kunjungan, jadi
modusnya tidak bermakna.)

**Kasus 3 — ping datang sebelum KTP-nya diimpor.** Pengiriman realtime
bisa mendahului impor bulanan. Ping tetap disimpan di `delivery_ping`,
tetapi **tidak** membuat baris `customer_fusion` dan **tidak** dihitung
sebagai `unverified`. Nomor mesin itu masuk daftar tunggu dan
diklasifikasi pada batch berikutnya begitu baris KTP-nya ada. Alasannya:
memasukkannya sebagai Tak Terverifikasi akan menggelembungkan angka
merah di dashboard karena alasan administratif (urutan impor), bukan
karena kualitas data — dan angka yang salah sebabnya lebih berbahaya
daripada angka yang belum muncul. Jumlah yang menunggu ditampilkan
sebagai catatan kecil di halaman Import, bukan disembunyikan.

### 2.3a KPI Jarak — ambang yang dapat dikustom

Satu radius toleransi tunggal, dipakai seragam untuk kedua pasangan
jarak (KTP↔Servis dan KTP↔Kirim). Bawaan **50 km**.

**Lingkup: global, dengan pengecualian per provinsi (opsional).**
Pilihan yang dipertimbangkan:

| Opsi | Untung | Rugi |
|---|---|---|
| Global tunggal | satu angka, mudah dijelaskan, tiap pergeseran hasil punya satu sebab | kepadatan desa di Kota Yogyakarta dan pegunungan Wonosobo diperlakukan sama padahal 50 km berarti hal yang sangat berbeda di keduanya |
| Per provinsi | mengakui perbedaan geografi dengan tambahan kompleksitas kecil (2 nilai untuk DIY + Jateng) | dua angka harus dijelaskan ke pengguna |
| Per kabupaten | paling akurat | 40 angka untuk dirawat, dan tiap perbandingan antar-kota jadi membandingkan dua penggaris berbeda — merusak justru perbandingan yang jadi tujuan dashboard ini |

**Rekomendasi: global sebagai nilai berlaku, dengan override per
provinsi yang tersedia tapi kosong secara bawaan.** Per kabupaten
ditolak: dashboard ini dibaca dengan cara membandingkan kota satu sama
lain, dan itu hanya sah kalau penggarisnya sama.

Disimpan di `app_config.kpi_jarak_m`. Tiap perubahan menulis `updated_by`
dan `updated_at`.

**Soal "role admin".** Rancangan awal menyebut perubahan ini dibatasi role
admin. Aplikasi ini TIDAK punya sistem peran sama sekali — satu sandi
dipakai bersama seluruh tim (lihat `backend/server/auth.js`), dan
menambahkan peran adalah pekerjaan tersendiri yang belum diminta. Sampai
peran benar-benar ada, yang dipakai adalah pengaman yang SUDAH terbukti di
rute perusak lain di proyek ini: konfirmasi yang harus diketik persis
(`?confirm=<radiusKm>`), sama seperti hapus periode dan reset master pos.
Mengubah ambang ini membuat seluruh golongan tersimpan tidak sebanding
lagi, jadi ia pantas diperlakukan seperti penghapusan data, bukan seperti
ganti setelan biasa.

**Konsekuensi perubahan ambang terhadap data lama.** Karena tiap baris
`customer_fusion` menyimpan `kpi_radius_m` yang dipakainya, sistem selalu
tahu baris mana yang dihitung dengan ambang lama.

Rekomendasi: **perhitungan ulang menyeluruh, dijalankan sebagai tugas
latar, dengan konfirmasi di muka.** Bukan otomatis diam-diam, dan bukan
"hanya berlaku untuk data baru". Alasannya: membiarkan dua ambang hidup
berdampingan membuat satu kolom `segment` berisi angka yang tidak
sebanding — Semarang dihitung 50 km, Solo 10 km, dan tidak ada apa pun di
layar yang memberi tahu pembaca soal itu. Dialog konfirmasi menyebutkan
berapa baris akan dihitung ulang dan perkiraan lamanya; selama proses
berjalan dashboard menampilkan penanda "sedang dihitung ulang".

Contoh yang diminta: pada KPI 50 km, mesin dengan jarak KTP↔Servis 32 km
adalah **berdekatan** → `service_near` (0,80). Diperketat ke 10 km, mesin
yang sama jadi **berjauhan**; kalau dia juga tidak punya Kirim yang
dekat, golongannya jatuh ke `nomad` (0,20). Pipeline menanganinya lewat
`POST /api/v1/fusion/recalculate` dengan `scope: "kpi_jarak_changed"`,
yang memilih baris `WHERE kpi_radius_m <> <nilai baru>` dan memprosesnya
per potongan — bukan mengosongkan lalu menghitung dari nol, supaya
dashboard tidak pernah kosong di tengah proses.

### 2.4 Metrik turunan

#### Confidence-Weighted Sales (CW Sales)

Jumlah pelanggan yang ditimbang keyakinan lokasinya:

```
CW Sales = Σ ( n_golongan × bobot_golongan )
```

Satu nomor mesin = satu unit terjual, jadi satuannya tetap "unit", cuma
sudah dikoreksi keyakinan. Contoh satu kota dengan 5.299 pelanggan:

| Golongan | n | bobot | sumbangan |
|---|---:|---:|---:|
| Warlok Loyal Verified | 661 | 1,00 | 661,0 |
| Warlok ke Bengkel dekat | 1.584 | 0,80 | 1.267,2 |
| Warlok kirim dekat | 984 | 0,75 | 738,0 |
| Warga asli | 1.441 | 0,55 | 792,6 |
| Migran / Nomaden | 427 | 0,20 | 85,4 |
| Tak Terverifikasi | 202 | 0,05 | 10,1 |
| **Total** | **5.299** | | **3.554,3** |

#### Confidence Ratio

```
Confidence Ratio = CW Sales / jumlah pelanggan
```

Contoh di atas: 3.554,3 / 5.299 = **67,1 %**. Nilainya selalu antara
0,05 (semua tak terverifikasi) dan 1,00 (semua Warlok penuh), jadi bisa
langsung dibaca sebagai "seberapa yakin kita terhadap wilayah ini".

Ambang status (dipakai untuk warna hijau/kuning/merah di seluruh Tahap 3,
tersimpan di `app_config`):

| Status | Rentang | Warna |
|---|---|---|
| solid | ≥ 65 % | hijau `#22C55E` |
| sedang | 50 % – 65 % | kuning `#F59E0B` |
| rapuh | < 50 % | merah `#EF4444` |

#### Retention Index (level dealer)

```
Retention Index = ( n_loyal_verified + n_service_near ) / n_total_dealer
```

Yang diukur: berapa bagian pelanggan dealer ini yang **kembali servis di
dekat rumahnya**. Dua golongan itu dipilih karena keduanya berarti ada
kunjungan servis yang terverifikasi dekat KTP; `delivery_near` sengaja
tidak ikut, karena pengiriman terjadi sekali di awal dan tidak
membuktikan apa pun tentang pelanggan yang kembali.

| Status | Rentang | Arti |
|---|---|---|
| sehat | ≥ 50 % | mayoritas pelanggan kembali ke jaringan servis di wilayahnya |
| waspada | 30 % – 50 % | separuh basis pelanggan tidak terlihat lagi setelah membeli |
| berisiko | < 30 % | dealer menjual banyak tetapi nyaris tidak menahan siapa pun |

Ambang 50 % dipilih sebagai titik "mayoritas", dan 30 % sebagai titik di
mana dua dari tiga pelanggan hilang dari pantauan — keduanya tersimpan di
`app_config` dan wajib ditinjau ulang setelah satu kuartal data nyata,
karena ini angka rancangan, bukan angka hasil pengukuran.

#### Disimpan atau dihitung saat diakses?

**Rekomendasi: disimpan (`segment_rollup`), dihitung saat pipeline
jalan.** Bukan on-the-fly.

| | Tersimpan (dipilih) | On-the-fly |
|---|---|---|
| Waktu buka halaman | satu query agregat ringan pada tabel kecil | join lintas-database `astra` ↔ `astra_customers` per permintaan |
| Kesegaran | setua batch/micro-batch terakhir (menit) | selalu mutakhir |
| Ketergantungan PII | dashboard tetap hidup tanpa database PII | dashboard mati total tanpa database PII |

Baris terakhir yang menentukan: on-the-fly melanggar aturan bahwa
mematikan database PII harus meninggalkan sisanya jalan penuh.
Keterlambatan hitungan menit tidak berarti apa-apa untuk angka yang
bergerak bulanan.

### 2.5 Kontrak API internal

Rute baru memakai awalan `/api/v1/` supaya rute lama di `/api/*` tidak
tersentuh sama sekali (P1). Semua rute di belakang autentikasi yang sudah
ada (middleware tolak-secara-bawaan; permintaan tanpa sesi valid dapat
401 JSON).

**Koordinat desa**

Nama field memakai bahasa Inggris mengikuti nama kolomnya, aturan proyek
yang sudah berlaku di seluruh `/api` — contoh JSON di brief aslinya
memakai bahasa Indonesia, dan itu sengaja tidak diikuti supaya tidak ada
penerjemahan di tengah yang bisa salah. Nama PARAMETER tetap Indonesia,
karena yang mengetiknya orang.

```
GET /api/v1/wilayah/koordinat?kecamatan=MLATI&desa=SINDUADI[&kota=34.04]
200 {
  "villageCode": "34.04.01.2001", "villageName": "Sinduadi",
  "districtName": "Mlati", "districtCode": "34.04.01",
  "cityCode": "34.04", "cityName": "SLEMAN", "provinceCode": "34",
  "lat": -7.7612, "lng": 110.3583,
  "match": "ok",          // ok | alias | fuzzy
  "source": "villages"
}
409 { "error": "Nama ini ada di lebih dari satu kabupaten. Sebutkan parameter kota.",
      "match": "ambiguous", "candidates": [ ... ] }
404 { "error": "Desa tidak ditemukan.", "match": "unmatched",
      "suggestions": [ { "villageCode": "...", "villageName": "Tegalreja", "editDistance": 1 } ] }
```

Parameter `kota` OPSIONAL. Importer selalu mengirimnya (kode kota ada di
kolom Excel) dan mendapat resolusi deterministik lewat kunci tiga
tingkat. Operator yang mengetik manual boleh tidak mengirimnya — namanya
dicari ke seluruh desa, dan kalau ternyata ada di lebih dari satu
kabupaten, jawabannya 409 berikut kandidatnya, bukan salah satu yang
dipilih diam-diam.

Mengembalikan usulan pada 404 adalah inti kegunaannya: operator yang
mengoreksi nama butuh kandidat, bukan sekadar penolakan.

**KPI Jarak**

```
GET /api/v1/konfigurasi/kpi-jarak
200 { "radius_km": 50, "cakupan": "global", "override": [],
      "diperbarui_pada": "...", "diperbarui_oleh": "admin" }

PUT /api/v1/konfigurasi/kpi-jarak            (role admin)
{ "radius_km": 10, "cakupan": "global" }
200 { "radius_km": 10, "baris_perlu_hitung_ulang": 5299 }
```

`PUT` **tidak** langsung menghitung ulang — ia mengembalikan berapa baris
terdampak supaya UI bisa meminta konfirmasi, lalu pemanggilan
`recalculate` menyusul sebagai langkah terpisah dan eksplisit.

**Perhitungan ulang**

```
POST /api/v1/fusion/recalculate
{ "scope": "monthly_batch" | "realtime_delta" | "kpi_jarak_changed",
  "periode": "2026-08" }
202 { "tugas_id": "...", "baris_antre": 5299 }
```

Mengembalikan 202 (diterima, belum selesai) karena pekerjaan ini bisa
berjalan menit-menitan; kemajuannya dibaca lewat riwayat impor yang sudah
ada.

**Hasil golongan & metrik**

```
GET /api/v1/segmentasi?kota=&dealer=&segmentasi=&page=1&limit=50
200 { "data": [...], "meta": { "total": 5299, "confidence_ratio": 0.671,
      "cw_sales": 3554.3, "kpi_jarak_terpakai_km": 50 } }

GET /api/v1/metrik/kota/{kota_id}
200 { "kota": "SLEMAN", "raw_sales": 5299, "cw_sales": 3554.3,
      "confidence_ratio": 0.671,
      "breakdown_segmentasi": { "loyal_verified": 661, ... } }

GET /api/v1/metrik/dealer/{dealer_code}
200 { ..., "retention_index": 0.42, "status": "waspada" }
```

**Ping pengiriman (masuk dari sistem lain)**

```
POST /api/v1/pengiriman/ping
{ "engineNo": "...", "sentAt": "2026-09-16T10:00:00Z", "lat": -7.76, "lng": 110.35,
  "accuracyM": 8, "locationText": "...", "photoUrl": "...",
  "courierName": "...", "note": "" }
201 { "stored": true, "id": 12345 }
400 { "error": "lat dan lng harus angka." }
```

Ia **selalu** menyimpan lebih dulu dan memvalidasi belakangan — ping yang
nomor mesinnya belum dikenal TETAP tersimpan (kasus batas 3). Yang
benar-benar wajib cuma koordinat berupa angka, karena kolomnya memang
angka.

**Autentikasi, keadaan sekarang vs tujuan.** Karena pemanggilnya kelak
mesin dan bukan orang, rute ini semestinya memakai token layanan
tersendiri (bukan cookie sesi) berikut pembatas laju sendiri. Itu BELUM
dibuat: untuk sekarang rutenya ikut sesi yang sama dengan rute lain.
Alasannya, brief menyebut integrasi sistem lapangan menyusul ("buatkan
dulu templatenya") — dan membuka satu jalur publik ber-token sebelum ada
yang memakainya berarti menambah permukaan serangan yang menganggur.
Token layanan dikerjakan bersama integrasinya.

**Drill-down satu mesin — rute PII**

```
GET /api/v1/mesin/{engine_no}
```

Wajib lewat `piiLimiter` **dan** memanggil `repo.logCustomerAccess()`,
sama seperti dua rute `/api/customers*` yang ada. Rute PII baru tanpa
keduanya membuka jalan penyedotan yang tidak meninggalkan jejak.

### 2.6 Diagram alur menyeluruh

```
 SUMBER                  KONVERSI & UKUR              KEPUTUSAN            KELUARAN
 ------                  ---------------              ---------            --------

 Data KTP (bulanan)                                                     +-----------------+
   Kel/Kec teks  ---> [2.1c cocokkan 3 tingkat] --+                     | customer_fusion |
                       alias > exact > fuzzy      |                     |  (DB PII)       |
                            |                     |                     +--------+--------+
                       gagal? -> unmatched        |                              |
                                                  v                              v
 Data Servis (bulanan)                    +---------------+            +-----------------+
   Kel/Kec teks  ---> [2.1c sama] ------> | titik KTP     |            | segment_rollup  |
                                          | titik Servis  |            |  (DB astra)     |
 Data Pengiriman (realtime)               | titik Kirim   |            +--------+--------+
   lat/lng GPS  ------ tanpa konversi --> +-------+-------+                     |
                                                  |                             v
                                                  v                     +-----------------+
                                          [2.2 haversine]               | Tahap 3         |
                                          dS = KTP<->Servis             | KPI, Venn,      |
                                          dD = KTP<->Kirim              | matriks,        |
                                                  |                     | peringkat, peta |
                                                  v                     +-----------------+
                                          [2.3a KPI Jarak]
                                           bawaan 50 km
                                           dari app_config
                                                  |
                                                  v
                                          [2.3 urutan aturan 0..7]
                                           -> 1 dari 6 golongan + bobot
                                                  |
                                                  +--> [2.4 CW Sales, Confidence Ratio,
                                                        Retention Index]
```

---

## Tahap 3 — Tampilan

### 3.1 Peta multi-layer

Peta hari ini menggambar 18.000 titik penjualan sebagai **circle layer**
MapLibre (`jual-titik`), bukan penanda DOM — penanda DOM hanya dipakai
untuk ratusan pos/dealer. Tiga jenis titik baru mengikuti aturan yang
sama: circle/symbol layer, bukan DOM.

| Titik | Layer | Bentuk & warna | Alasan |
|---|---|---|---|
| KTP | `ktp-titik` (circle) | isian warna dealer, **tanpa outline** | menyatu dengan bahasa visual titik penjualan yang sudah ada |
| Servis | `servis-titik` (symbol, ikon 6×6 px) | kotak merah sangat kecil | bentuk berbeda terbaca walau warnanya bertumpuk |
| Pengiriman | `kirim-titik` (circle) | lingkaran kecil, isian kosong, **outline kuning** | kosong-berpinggir langsung terbaca beda dari dua yang padat |

Bentuk kotak tidak bisa dibuat oleh `circle` layer; pakai symbol layer
dengan ikon yang didaftarkan sekali lewat `map.addImage()`, bukan berkas
gambar dari jaringan (aturan proyek: tidak ada aset dari internet).

**Dua saluran informasi yang tidak boleh bertabrakan.** Warna sudah
dipakai untuk **dealer** (registry warna stabil, tidak bergeser saat
filter berubah). Karena itu **golongan** memakai saluran lain: bentuk,
outline, dan opacity — bukan warna. Satu titik bisa memberi tahu dealer
mana dan golongan apa sekaligus tanpa pembaca harus menghafal dua peta
warna.

**Toggle.** Tiga baris baru di panel Opsi Peta (`opt-titik-ktp`,
`opt-titik-servis`, `opt-titik-kirim`), mengikuti pola `toggle-row` +
`redrawMap()` yang ada. Kombinasi apa pun boleh, termasuk semua mati
(peta menampilkan wilayah saja). Saat kombinasi berubah, layer
disembunyikan lewat `visibility`, bukan dibongkar-pasang — supaya tidak
ada kedip dan posisi titik tidak pernah bergeser antar-kombinasi.

**Radius KPI sebagai alat verifikasi.** Saat pengguna membuka drill-down
satu Nomor Mesin, peta menggambar lingkaran radius KPI Jarak di sekitar
titik KTP-nya memakai `circle(lng, lat, meters)` yang sudah ada di
`frontend/js/geo.js`, plus garis penghubung ke titik Servis dan Kirim.
Dengan itu alasan penggolongan bisa dilihat, bukan cuma dibaca.

> **Terbuka, perlu dikonfirmasi:** brief menyebut "penempatan dengan ID
> nomor mesin yang sama tidak boleh beda lokasi". Ditafsirkan di sini
> sebagai: koordinat tiap titik deterministik dan tidak di-jitter, jadi
> titik yang sama selalu muncul di tempat yang sama pada kombinasi
> toggle mana pun. Kalau yang dimaksud adalah ketiga titik satu mesin
> harus ditarik ke satu lokasi, itu keputusan berbeda dan menghapus
> justru informasi yang jadi tujuan fitur ini.

### 3.2 Halaman baru: Confidence Fusion

Nama menu: **Confidence Fusion**. Judul halaman: "ATLAS Confidence Fusion
Dashboard — Controlling Quality of Data".

**Satu layar, tanpa scroll halaman.** Pembungkus terluar `height: 100vh;
overflow: hidden`. Kepadatan dicapai lewat ukuran font kecil (7–11 px
untuk label dan isi, 13–17 px untuk angka KPI) dan padding ketat
(6–14 px) — bukan dengan mengurangi informasi. Wajib pas di 1366×768 dan
1600×900. Latar `#f4f6fb`, sudut panel 9–10 px, border 1 px `#e2e8f0`.

```
+----------+--------------------------------------------------------------+
| SIDEBAR  |  [KPI Pelanggan]  [KPI CW Sales]  [KPI Confidence Ratio]      |
| 164px    +--------------------------------------------------------------+
|          |  Tampilan Peta  |  Irisan Sumber (Venn) |  Matriks Kota x Gol |
| ATLAS    |                 |                       |                     |
| filter x4+--------------------------------------------------------------+
| Reset/LIVE| Peringkat Kota |  Peringkat Dealer     |  Cakupan Sumber     |
| 6 golongan|                 |  (flex 1.2)           |                     |
| donut    |                 |                       |                     |
| footer   |                 |                       |                     |
+----------+--------------------------------------------------------------+
```

Baris kedua `flex: 1`, baris ketiga `flex: 1.15` (sedikit lebih tinggi),
jarak antarblok 7–8 px.

**Sidebar (164 px).** Kicker "ATLAS" (8 px, biru `#3b82f6`, letter-spacing
lebar), judul "Confidence Fusion Dashboard" (11 px bold), subjudul
"Controlling Quality of Data" (7,5 px, `#94a3b8`). Lalu empat combobox
bertumpuk (Kota, Dealer, Golongan, Punya Sumber), baris tombol Reset +
LIVE, daftar 6 golongan dengan hitungan, donut, dan footer ringkas
(jumlah pelanggan · kota · dealer).

Keempat combobox memakai `fillCombo(name, label, pairs, allLabel,
onPick)` yang sudah ada — komponen yang sama dengan bilah filter
halaman peta, termasuk kotak pencariannya yang muncul otomatis kalau
pilihan lebih dari delapan.

**Tiga kartu KPI.** Latar gradien tipis abu→putih, garis aksen vertikal
2,5 px di sisi kiri dengan glow senada, label kapital 7,5 px, angka
17 px bold, sub-label 7,5 px berwarna aksen.

| Kartu | Isi | Sub-label | Aksen |
|---|---|---|---|
| PELANGGAN TERFILTER | jumlah hasil filter | "dari [total]" | biru `#3B82F6` |
| CW SALES | rumus 2.4 | "terkoreksi keyakinan" | ungu `#A855F7` |
| CONFIDENCE RATIO | persentase | "solid"/"sedang"/"rapuh" | mengikuti status (hijau/kuning/merah) |

**Panel Tampilan Peta.** Pada tahap ini berisi placeholder bertuliskan
bahwa peta akan menampilkan sebaran titik yang sama seperti halaman
Insight & Peta, dengan filter yang sinkron dengan sidebar. Peta
sungguhannya memakai spesifikasi 3.1.

**Panel Irisan Sumber (Venn).** SVG tiga lingkaran (A · Kirim `#A855F7`,
B · Servis `#EC4899`, C · KTP `#38BDF8`), opacity isian ±10 %, dibungkus
kotak garis putus-putus merah `#EF4444` yang mewakili "Tak
Terverifikasi" — data di luar irisan mana pun. Tujuh region (A, B, C,
A∩C, B∩C, A∩B∩C, dan luar-irisan) masing-masing menampilkan angkanya
langsung, dengan warna teks berbeda supaya terbaca di atas isian
transparan. Irisan tiga lingkaran ditonjolkan sebagai bulatan solid biru
"Warlok" di pusat. Hover pada satu region meredupkan region lain dan
memunculkan kotak info di bawah diagram (nama region, golongan yang
berkorespondensi, jumlah).

Tidak ada pustaka Venn yang di-vendor, dan ApexCharts tidak
menyediakannya — panel ini **SVG inline buatan sendiri**, dengan
geometri statis (posisi lingkaran tetap) dan hanya angkanya yang
dinamis. Itu pilihan sadar: Venn proporsional-akurat untuk tiga himpunan
adalah masalah geometri yang jauh lebih mahal daripada nilainya di sini,
dan pembacanya toh membaca angkanya, bukan luasnya.

**Panel Matriks Kota × Golongan.** Tabel heatmap ringkas: baris = kota
(diurutkan total terbesar, hanya yang punya data), kolom = 6 golongan
(header berupa titik warna kecil, bukan teks, demi ruang), kolom
terakhir Confidence Ratio berwarna status. Tiap sel berlatar warna
golongannya dengan opacity proporsional terhadap nilai maksimum seluruh
tabel; angka ditulis kalau > 0. Header sticky saat panel digulir
sendiri.

**Panel Peringkat Kota & Peringkat Dealer.** Kotak pencarian +
tiga tombol sortir eksklusif (Σ total, % Confidence Ratio, ★ jumlah
Warlok). Daftar bergulir **di dalam panel**, bukan memperpanjang halaman.
Tiap baris: nama, total, Confidence Ratio berwarna, dan stacked bar 8 px
berisi proporsi 6 golongan; angka ditulis di dalam segmen bila lebarnya
≥ 18 %. Klik baris = terapkan sebagai filter (cross-filter); klik ulang
membatalkan. Panel Dealer diberi lebar sedikit lebih besar (flex 1,2)
karena nama dealer panjang, dan menampilkan kota di belakang nama
("Nama Dealer · Nama Kota").

> **Kota dealer itu kota siapa?** Rancangan awal menganggap tiap dealer
> punya satu kota. Data Agustus 2026 membantahnya, dan skemanya juga:
> `dealers` maupun `outlets` TIDAK punya kolom kota sama sekali. Yang
> ditampilkan karena itu **kota asal pembeli terbanyak** dealer tersebut.
> Dominasinya terukur beragam — 94%, 88%, 53%, 45%, 42% — jadi
> persentasenya (`citySharePct`) ikut dikembalikan API dan ditampilkan di
> layar begitu di bawah 60%. Menulis "· Bantul" untuk dealer yang cuma 45%
> pembelinya dari Bantul, tanpa menyebut angkanya, adalah setengah
> kebenaran yang terbaca sebagai fakta.
>
> Satu jebakan baca yang harus diingat: kalau filter Kota sedang aktif,
> `citySharePct` selalu 100% — bukan karena dealernya memang terpusat, tapi
> karena angkanya memang sudah disaring ke kota itu saja. Persentase ini
> hanya bermakna waktu filter Kota = Semua.
>
> Menurunkan kota dealer dari koordinat posnya ditolak: cuma 55 dari 78
> dealer punya pos berkoordinat, jadi 23 dealer akan kehilangan labelnya
> demi ketepatan yang toh tidak bisa dicapai seluruhnya.

> Catatan flexbox yang sudah pernah menggigit proyek ini: elemen yang
> menggulir harus `flex-1 overflow-y-auto min-h-0` di dalam induk
> `h-full min-h-0`. Tanpa `min-h-0`, tinggi tak terbatas membuat gulir
> otomatis diam-diam tidak jalan.

**Panel Cakupan Sumber.** Tiga checkbox (A · Kirim, B · Servis, C · KTP)
+ pencarian. Daftar otomatis berpindah per-dealer bila filter Dealer
aktif, per-kota bila tidak. Tiap entri: nama, total, lalu satu bar tipis
(7 px) per sumber yang dicentang dengan jumlah + persentase di ujung
kanan. Semua checkbox dilepas → pesan bahwa minimal satu sumber harus
dicentang.

**Palet golongan — sama di seluruh komponen**, tanpa pengecualian
(donut, Venn, stacked bar, heatmap, sidebar):

| Golongan | Warna |
|---|---|
| Warlok Loyal Verified | `#3B82F6` |
| Warlok ke Bengkel dekat | `#EC4899` |
| Warlok kirim dekat | `#A855F7` |
| Warga asli | `#94A3B8` |
| Migran / Nomaden | `#F59E0B` |
| Tak Terverifikasi | `#EF4444` |

Warna sumber (Venn + Cakupan Sumber): A · Kirim `#A855F7`, B · Servis
`#EC4899`, C · KTP `#38BDF8`.

**Donut sidebar.** Diameter ±104 px, berlubang di tengah, angka ditulis
pada potongan yang ≥ 7 %, total besar di pusat dengan label "pelanggan".
Hover pada potongan meredupkan yang lain — dan hover pada baris daftar
golongan di atasnya ikut menyorot potongan yang sama (satu state hover
dipakai bersama).

**Cross-filtering.** Seluruh panel membaca satu sumber kebenaran filter
dan diperbarui serentak, baik filter diubah lewat combobox maupun lewat
klik pada elemen visual. Mengubah Kota otomatis mereset Dealer ke
"Semua" (daftar dealer bergantung kota), tidak sebaliknya. Golongan dan
Punya Sumber independen. Tombol Reset menampilkan jumlah filter aktif
dalam kurung dan mati saat tidak ada yang aktif.

Ini dibangun di atas model filter yang sudah ada: slot baru
`S.filters.fusion`, dibaca lewat `pageFilters()`/`activeRows()`, dengan
satu entri baru di peta `REPAINT` pada `filter-bar.js`.

**Indikator KPI Jarak.** Dashboard selalu menampilkan radius yang sedang
berlaku (mis. "KPI Jarak: 50 km") dengan tautan ke halaman Pengaturan
bagi admin. Angka yang lahir dari sebuah ambang tidak boleh tampil tanpa
menyebut ambangnya.

### 3.3 Peringkat & perbandingan

Aturan warna status dipakai identik di peringkat, matriks, dan KPI —
diambil dari `app_config`, bukan ditulis ulang per komponen: Confidence
Ratio ≥ 65 % hijau, 50–65 % kuning, < 50 % merah; Retention Index ≥ 50 %
hijau, 30–50 % kuning, < 30 % merah (2.4).

### 3.4 Detail per Nomor Mesin

Drill-down dari peta atau tabel, memakai panel geser yang sudah ada
sebagai polanya. Isinya:

- **Riwayat tiga sumber**: kapan KTP terdaftar berikut desa hasil
  konversi, seluruh kunjungan servis (semuanya, bukan hanya yang
  terdekat), dan seluruh ping pengiriman berikut akurasi GPS-nya.
- **Golongan akhir + alasannya dalam kalimat**, dengan jarak nyata
  dibanding ambang yang berlaku:

  > "Servis berjarak 22 km dari KTP (KPI Jarak: 50 km) → berdekatan.
  > Kirim tidak ditemukan. → **Warlok ke Bengkel dekat** (bobot 0,80)."

- **Peta mini** berisi titik KTP, Servis, Kirim, lingkaran radius KPI,
  dan garis penghubung (3.1).

Halaman ini menampilkan nama dan alamat, jadi ia **rute PII**: lewat
`piiLimiter` dan tercatat di `logCustomerAccess()`.

### 3.5 Mode Live / wallboard

Tombol LIVE di sidebar (di samping Reset). Aktif: filter Kota berpindah
otomatis berurutan ke tiap kota (termasuk kembali ke "Semua") pada
interval tetap ±3,5 detik, dan Dealer ikut direset tiap perpindahan.
Tombol berubah merah dengan ikon ▶ → ■ supaya statusnya terbaca tanpa
membaca teks. Cocok dipasang di TV ruang marketing.

Pola intervalnya mengikuti gulir otomatis yang sudah ada di panel
Performa/Wilayah (`startLive*`/`stopLive*`, kelas `.live-nyala`),
termasuk kebiasaan menghentikan interval saat panelnya tidak terlihat —
interval yang tertinggal di panel tersembunyi adalah bug yang sudah
pernah terjadi di proyek ini.

### 3.6 Dampak struktural pada navigasi

- Menu **Data** dengan tiga sub-halaman ("berdasarkan KTP", "Lokasi
  Service", "berdasarkan Lokasi Delivery"), memakai pola flyout menu
  Master: tombol `#nav-data` di dalam pembungkus, panel `.pilih-panel`
  yang diposisikan `position: fixed` dari `getBoundingClientRect()`
  (karena baris nav punya `overflow-x-auto` yang akan memotong panel
  absolut), dan daftar sub-halaman `TAB_DATA` yang terpisah dari daftar
  `switchTab`.
- Tiap halaman baru butuh lima hal, dan kelimanya diperiksa tes:
  `<section id="tab-*">`, tombol `#nav-*`, entri di array `switchTab()`,
  slot `S.filters.*`, dan entri `REPAINT`. Tiap fungsi yang dipanggil
  dari `onclick=` wajib terdaftar di peta `HANDLERS` — `test/page.test.js`
  menolak nama yang hilang maupun yang tinggal nama.

---

## 4. Rencana implementasi bertahap

Urutannya dipilih supaya tiap tahap bisa diuji sendiri dan tidak ada
tahap yang menyentuh produksi sebelum tahap sebelumnya terbukti.

| Tahap | Isi | Selesai berarti |
|---|---|---|
| A. Fondasi | ekstrak `backend/core/geo.js` dari `coverage.js`; tabel `app_config` + KPI Jarak; migrasi tabel staging/fusi/rollup | `npm test` hijau, skema idempoten (jalan dua kali aman) |
| B. Konversi wilayah | pembungkus resolver desa (2.1c) + `GET /api/v1/wilayah/koordinat` | tes: exact, alias, fuzzy, gagal → keempat status benar |
| C. Ingest | importer KTP template baru, importer Servis, endpoint ping | impor ulang bulan yang sama tidak menggandakan; baris kotor terlaporkan |
| D. Fusi | `fuseEngine()` murni + batch + micro-batch + `segment_rollup` | tes tabel keputusan: 6 golongan + 3 kasus batas 2.3 |
| E. API | segmentasi, metrik kota/dealer, recalculate, drill-down PII | rute PII lewat `piiLimiter` + tercatat di access log |
| F. UI | menu Data, layer peta baru, halaman Confidence Fusion, drill-down, mode Live | pas di 1366×768 tanpa scroll halaman |

Aturan tes proyek berlaku di tiap tahap: tiap logika baru meninggalkan
satu tes yang runnable, dan tesnya **diuji mutasi** — rusakkan satu hal,
pastikan tepat ada tes yang merah. `fuseEngine()` dirancang sebagai
fungsi murni (input baris, output golongan) persis supaya tabel
keputusan 2.3 bisa diuji tanpa database.

## 5. Keputusan yang masih terbuka

1. **Penempatan titik satu nomor mesin di peta** — tafsir di 3.1 perlu
   dikonfirmasi pemilik produk.
2. **Ambang Retention Index** (50 % / 30 %) adalah angka rancangan, bukan
   hasil pengukuran. Wajib ditinjau setelah satu kuartal data nyata.
3. **Override KPI Jarak per provinsi** disediakan di skema tetapi kosong
   secara bawaan; keputusan memakainya menunggu bukti bahwa DIY dan
   Jateng memang berperilaku berbeda.
4. **Sumber titik desa** tetap `villages.lat/lng` (rata-rata sudut).
   Pindah ke `ST_PointOnSurface(geom_m)` jadi wajib kalau KPI Jarak
   diperketat ke skala satuan kilometer.
5. **Retensi `delivery_ping`** belum ditentukan. Tabel ini tumbuh
   selamanya dan memuat titik rumah — ia butuh kebijakan hapus otomatis
   seperti arsip unggahan (90 hari) yang sudah ada.
