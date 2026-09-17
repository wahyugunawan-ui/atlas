-- Skema database `astra_customers` — BERISI PII: nama dan alamat konsumen.
--
-- Sengaja DATABASE terpisah, bukan sekadar tabel lain di database yang sama. Itu yang
-- membuat "cabut PII" berarti satu perintah — DROP DATABASE astra_customers — dan yang
-- membuat backup database utama tidak pernah membawa serta belasan ribu nama dan
-- alamat. Di versi SQLite sifat ini dijaga dengan berkas terpisah; di PostgreSQL,
-- database terpisah adalah padanannya.
--
-- Aplikasi harus tetap jalan penuh kalau database ini tidak ada — yang hilang cuma
-- daftar konsumen di panel kelurahan. Dijaga oleh test/import.test.js.
--
-- Tidak ada geometri di sini, dan memang tidak boleh ada. Yang berhubungan dengan peta
-- semuanya di database `astra` yang bebas di-backup.

CREATE TABLE IF NOT EXISTS customers (
  id           VARCHAR(32) NOT NULL PRIMARY KEY,   -- '2026-08-000001'
  period       VARCHAR(7) NOT NULL,
  village_code VARCHAR(16) NOT NULL,
  outlet_code  VARCHAR(32) NOT NULL,
  name         VARCHAR(200) NOT NULL,
  address      VARCHAR(400) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_village ON customers (village_code, period);
CREATE INDEX IF NOT EXISTS idx_customers_period ON customers (period);

-- Tiap permintaan data konsumen dicatat. Dengan satu akun bersama, ini yang membedakan
-- "diakses wajar" dari "disedot".
CREATE TABLE IF NOT EXISTS access_log (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at           TIMESTAMPTZ NOT NULL,
  ip           VARCHAR(64),
  village_code VARCHAR(16),
  row_count    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_access_at ON access_log (at DESC);

-- ============================================================================
-- PENYATUAN TIGA SUMBER (docs/FUSION.md)
-- ============================================================================
--
-- Ketiga sumber di bawah ini ada DI SINI, bukan di database `astra`, karena ketiganya
-- PII: KTP membawa nama+alamat, Servis membawa alamat, dan Pengiriman membawa titik
-- GPS rumah berikut foto buktinya — bentuk yang paling tajam dari ketiganya, karena
-- menunjuk satu rumah, bukan satu desa. Nomor mesin ikut diperlakukan sebagai
-- kuasi-identitas: dia menunjuk satu kendaraan, dan karena itu satu orang.
--
-- Yang keluar dari sini cuma agregat tanpa identitas, ke tabel `segment_rollup` di
-- database `astra`. DROP DATABASE astra_customers tetap harus meninggalkan dashboard
-- hidup dengan angka historisnya.

-- Kolom `resolve_status` inilah yang membuat baris kotor tetap tersimpan tapi tidak
-- ikut mencemari fusi: 'ok' | 'alias' | 'fuzzy' | 'unmatched' | 'no_engine' |
-- 'duplicate'. Baris yang tidak cocok TIDAK dibuang diam-diam — itu aturan yang sama
-- dengan tabel `unmatched` di impor penjualan.
--
-- Primary key (period, row_no), BUKAN engine_no: justru nomor mesin yang tidak bisa
-- dipercaya unik di sumbernya. Dengan nomor baris, operator bisa dirujuk balik ke
-- baris ke-berapa di berkas mana — itu yang dia butuhkan waktu memperbaiki Excel.
CREATE TABLE IF NOT EXISTS customer_ktp (
  period         VARCHAR(7) NOT NULL,
  engine_no      VARCHAR(32),
  frame_no       VARCHAR(32),
  name           VARCHAR(200),
  address        VARCHAR(400),
  village_text   VARCHAR(120),               -- kolom 'Kel' apa adanya dari Excel
  district_text  VARCHAR(120),               -- kolom 'Kec' apa adanya dari Excel
  city_code      VARCHAR(8),
  dealer_code    VARCHAR(64),
  request_date   DATE,
  village_code   VARCHAR(16),                -- hasil konversi; NULL kalau gagal
  resolve_status VARCHAR(16) NOT NULL,
  row_no         INTEGER NOT NULL,
  PRIMARY KEY (period, row_no)
);

CREATE INDEX IF NOT EXISTS idx_ktp_engine ON customer_ktp (engine_no);

-- Nomor mesin ganda di sini WAJAR dan tidak ditandai duplikat: satu motor memang bisa
-- servis berkali-kali. Yang dipakai fusi adalah kunjungan yang paling DEKAT ke titik
-- KTP, bukan yang pertama — lihat kasus batas 2 di docs/FUSION.md.
CREATE TABLE IF NOT EXISTS service_visit (
  period         VARCHAR(7) NOT NULL,
  engine_no      VARCHAR(32),
  frame_no       VARCHAR(32),
  address        VARCHAR(400),
  village_text   VARCHAR(120),
  district_text  VARCHAR(120),
  city_text      VARCHAR(120),
  service_type   VARCHAR(80),
  village_code   VARCHAR(16),
  resolve_status VARCHAR(16) NOT NULL,
  row_no         INTEGER NOT NULL,
  PRIMARY KEY (period, row_no)
);

CREATE INDEX IF NOT EXISTS idx_service_engine ON service_visit (engine_no);

-- Append-only, dan tidak di-upsert: riwayat pengiriman adalah fakta berstempel waktu,
-- dan satu mesin bisa menerima lebih dari satu kiriman. Ping yang nomor mesinnya belum
-- dikenal TETAP disimpan — dia menunggu batch berikutnya, bukan ditolak (kasus batas 3).
--
-- Satu-satunya sumber yang koordinatnya asli dari GPS, jadi satu-satunya yang presisi
-- rumah. Dua sumber lain cuma setepat centroid desanya.
-- `period` = periode PEMBELIAN motornya (periode Data KTP-nya), BUKAN bulan pingnya
-- tiba. Bedanya menentukan, dan sempat jadi alasan tabel ini tidak bisa dihapus per
-- bulan sama sekali: satu motor yang dibeli Agustus bisa menerima ping di September,
-- dan menurunkan periodenya dari `sent_at` akan membuang ping bulan itu untuk motor
-- yang dibeli bulan lain. Salah, dan tidak bisa dibatalkan.
--
-- Boleh NULL, dan itu disengaja: ping yang nomor mesinnya belum dikenal TETAP disimpan
-- (lihat komentar di atas). Periodenya menyusul waktu Data KTP-nya masuk; menolak
-- pingnya berarti kehilangan satu-satunya bukti koordinat rumah yang pernah lewat.
CREATE TABLE IF NOT EXISTS delivery_ping (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  engine_no     VARCHAR(32),
  period        VARCHAR(7),
  sent_at       TIMESTAMPTZ NOT NULL,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  accuracy_m    INTEGER,
  location_text VARCHAR(200),
  photo_url     VARCHAR(500),
  courier_name  VARCHAR(120),
  note          TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CREATE TABLE IF NOT EXISTS di atas TIDAK menambah kolom ke tabel yang sudah ada, dan
-- proyek ini belum punya penjalan migrasi bernomor (lihat catatan di db.js). Jadi
-- kolomnya ditambahkan eksplisit di sini. Idempoten, dan runSchema() menjalankan berkas
-- ini di SETIAP kali server menyala (openCustomers di db.js) — jadi database yang sudah
-- terlanjur ada ikut mendapatkannya tanpa ada yang perlu menjalankan apa pun manual.
ALTER TABLE delivery_ping ADD COLUMN IF NOT EXISTS period VARCHAR(7);

CREATE INDEX IF NOT EXISTS idx_ping_engine ON delivery_ping (engine_no, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_ping_period ON delivery_ping (period);

-- Satu baris per nomor mesin — inilah "satu pelanggan" dalam pengertian sistem ini.
--
-- `kpi_radius_m` disimpan PER BARIS, bukan cuma di app_config. Tanpa itu, mengubah
-- KPI Jarak membuat angka lama tidak bisa dijelaskan lagi ("kenapa dulu dia Warlok?"),
-- dan pipeline tidak punya cara tahu baris mana yang sudah basi setelah ambang berubah.
CREATE TABLE IF NOT EXISTS customer_fusion (
  engine_no       VARCHAR(32) NOT NULL PRIMARY KEY,
  period          VARCHAR(7) NOT NULL,        -- periode KTP-nya
  village_code    VARCHAR(16),                -- desa KTP: acuan SEMUA jarak di bawah
  city_code       VARCHAR(8),
  dealer_code     VARCHAR(64),
  outlet_code     VARCHAR(32),
  ktp_lat         DOUBLE PRECISION,
  ktp_lng         DOUBLE PRECISION,
  service_lat     DOUBLE PRECISION,
  service_lng     DOUBLE PRECISION,
  service_count   INTEGER NOT NULL DEFAULT 0,
  delivery_lat    DOUBLE PRECISION,
  delivery_lng    DOUBLE PRECISION,
  delivery_count  INTEGER NOT NULL DEFAULT 0,
  dist_service_m  INTEGER,                    -- NULL = tidak ada / tak tergeocode
  dist_delivery_m INTEGER,
  segment         VARCHAR(24) NOT NULL,
  weight          NUMERIC(4,2) NOT NULL,
  kpi_radius_m    INTEGER NOT NULL,           -- ambang yang BERLAKU saat dihitung
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fusion_village ON customer_fusion (village_code);
CREATE INDEX IF NOT EXISTS idx_fusion_dealer ON customer_fusion (dealer_code);
CREATE INDEX IF NOT EXISTS idx_fusion_segment ON customer_fusion (segment);
