-- Skema database `astra` — data bisnis + geometri kelurahan. TANPA PII.
--
-- PostgreSQL 17 + PostGIS. Nama tabel dan kolom bahasa Inggris, snake_case. Kode
-- wilayah selalu format BPS bertitik ('34.04.01.2001', '34.04'); jangan pernah
-- diturunkan dari nama.
--
-- Dijalankan tiap kali server start. Semua CREATE memakai IF NOT EXISTS, jadi aman
-- dipanggil berulang.
--
-- Panjang VARCHAR bukan tebakan: kode kelurahan BPS selalu 13 karakter, kode kota 5,
-- periode 7. Kolom kunci diberi panjang pas supaya indeksnya kecil; nama dan alamat
-- diberi kelonggaran karena datangnya dari Excel dan tidak ada yang menjamin panjangnya.

CREATE TABLE IF NOT EXISTS villages (
  village_code  VARCHAR(16) NOT NULL PRIMARY KEY,   -- 34.04.01.2001
  village_name  VARCHAR(120) NOT NULL,
  district_code VARCHAR(16),                        -- 34.04.01
  district_name VARCHAR(120),
  city_code     VARCHAR(8) NOT NULL,                -- 34.04
  city_name     VARCHAR(120) NOT NULL,
  province_code VARCHAR(4) NOT NULL,                -- 34
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,

  -- Batas kelurahan. Inilah alasan databasenya PostgreSQL dan bukan yang lain.
  --
  -- Dua kolom, bukan satu. `geom` kanonik dalam WGS84, apa adanya dari sumber.
  -- `geom_m` hasil proyeksi ke UTM 49S untuk hitungan yang satuannya meter — derajat
  -- bukan meter, dan radius 5 km tidak punya arti di ruang derajat.
  --
  -- UTM 49S dipilih karena seluruh wilayah cakupan (bujur 108,556–110,839) muat di
  -- satu zona. Kalau cakupannya nanti melebar melewati 114° BT, satu zona tidak cukup
  -- lagi dan hitungannya harus pindah ke tipe `geography`.
  geom          geometry(MultiPolygon, 4326),
  geom_m        geometry(MultiPolygon, 32749)
);

CREATE INDEX IF NOT EXISTS idx_villages_city ON villages (city_code);

-- Indeks spasial. Tanpa ini, ST_DWithin di seed jangkauan berubah jadi perbandingan
-- poligon penuh 78 x 3.466 kali, dan yang tadinya detik jadi menit.
CREATE INDEX IF NOT EXISTS idx_villages_geom_m ON villages USING GIST (geom_m);

-- Dealer: perusahaan yang menaungi satu atau lebih pos (outlet).
--
-- Dulu cuma dua kolom yang DIDUPLIKASI di tiap baris outlets yang sama dealernya —
-- tidak ada satu tempat untuk melihat "dealer ini alamatnya di mana", dan mengedit
-- nama dealer berarti mengedit tiap baris outlet satu per satu. Tabel ini yang jadi
-- satu tempat itu; outlets.dealer_code sekarang FOREIGN KEY ke sini, bukan sekadar
-- string yang kebetulan konsisten.
--
-- lat/lng SENGAJA nullable dan tidak punya sumber Excel — kantor pusat dealer bukan
-- sesuatu yang dikirim Astra tiap bulan, jadi diisi manual lewat halaman Master
-- Dealer kalau memang diperlukan. Tanpa geom_m tergenerasi seperti outlets: titik
-- dealer tidak pernah dipakai hitungan jangkauan PostGIS mana pun.
CREATE TABLE IF NOT EXISTS dealers (
  dealer_code VARCHAR(64) NOT NULL PRIMARY KEY,     -- turunan toDealerCode(nama)
  dealer_name VARCHAR(200) NOT NULL,
  address     VARCHAR(400),
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  updated_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS outlets (
  outlet_code VARCHAR(32) NOT NULL PRIMARY KEY,     -- kolom "Kode Dealer" di Excel
  outlet_name VARCHAR(200) NOT NULL,
  dealer_code VARCHAR(64) NOT NULL,                 -- pengelompokan; awalnya tebakan
  dealer_name VARCHAR(200) NOT NULL,
  address     VARCHAR(400),
  lat         DOUBLE PRECISION,                     -- NULL = belum di-pin
  lng         DOUBLE PRECISION,
  updated_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outlets_dealer ON outlets (dealer_code);

-- outlets.dealer_code jadi FK sungguhan ke dealers.dealer_code, bukan sekadar kolom
-- yang kebetulan konsisten.
--
-- NOT VALID, bukan ALTER TABLE ... ADD CONSTRAINT polos. Berkas ini dijalankan TIAP
-- KALI server start, termasuk di database production yang sudah punya puluhan outlet
-- SEBELUM tabel dealers pernah dibackfill (lihat scripts/backfill-dealers.js).
-- Constraint biasa akan gagal ditambahkan pertama kali karena dealer_code outlet lama
-- belum punya baris dealers-nya. NOT VALID membuat constraint berlaku untuk tulisan BARU
-- sejak sekarang tanpa memindai baris lama dulu — aman dijalankan berulang, sama
-- seperti seluruh CREATE TABLE IF NOT EXISTS di berkas ini. scripts/backfill-dealers.js
-- yang memvalidasinya terhadap data lama, sekali, secara eksplisit.
--
-- pg_constraint dicek manual karena Postgres tidak punya
-- ADD CONSTRAINT IF NOT EXISTS untuk foreign key.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_outlets_dealer') THEN
    ALTER TABLE outlets ADD CONSTRAINT fk_outlets_dealer
      FOREIGN KEY (dealer_code) REFERENCES dealers(dealer_code) NOT VALID;
  END IF;
END $$;

-- Titik outlet dalam UTM 49S, diturunkan dari lat/lng.
--
-- Kolom TERGENERASI, bukan diisi manual. Kalau diisi manual, memindahkan pin lewat
-- aplikasi berarti ada dua tempat yang harus diperbarui, dan yang terlupa akan
-- membuat jangkauan dihitung di lokasi lama tanpa gejala apa pun.
ALTER TABLE outlets
  ADD COLUMN IF NOT EXISTS geom_m geometry(Point, 32749)
  GENERATED ALWAYS AS (
    CASE WHEN lat IS NULL OR lng IS NULL THEN NULL
    ELSE ST_Transform(ST_SetSRID(ST_MakePoint(lng, lat), 4326), 32749) END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_outlets_geom_m ON outlets USING GIST (geom_m);

-- Satu baris per (periode, kelurahan, outlet).
--
-- dealer_code SENGAJA tidak ada di sini. Dia milik tabel outlets dan diambil lewat
-- JOIN. Kalau ikut disalin ke tiap baris, memperbaiki satu pengelompokan outlet
-- berarti menulis ulang ratusan ribu baris — dan yang lupa ditulis ulang jadi
-- diam-diam salah.
CREATE TABLE IF NOT EXISTS sales (
  period       VARCHAR(7) NOT NULL,                 -- 'YYYY-MM'
  village_code VARCHAR(16) NOT NULL,
  outlet_code  VARCHAR(32) NOT NULL,
  quantity     INTEGER NOT NULL,
  PRIMARY KEY (period, village_code, outlet_code),
  CONSTRAINT fk_sales_outlet FOREIGN KEY (outlet_code) REFERENCES outlets(outlet_code)
);

CREATE INDEX IF NOT EXISTS idx_sales_period ON sales (period);
CREATE INDEX IF NOT EXISTS idx_sales_outlet ON sales (outlet_code);

-- Baris yang tidak cocok JANGAN dibuang diam-diam.
CREATE TABLE IF NOT EXISTS unmatched (
  period        VARCHAR(7) NOT NULL,
  city_code     VARCHAR(8) NOT NULL,
  district_name VARCHAR(120) NOT NULL,
  village_name  VARCHAR(120) NOT NULL,
  row_count     INTEGER NOT NULL,
  PRIMARY KEY (period, city_code, district_name, village_name)
);

-- Nama kelurahan versi Excel yang sudah DIKONFIRMASI MANUSIA menunjuk kelurahan mana.
--
-- Isinya varian ejaan: TEGALREJO untuk Tegalreja, PABUARAN untuk Pabuwaran. Tanpa tabel
-- ini, tiap bulan baris yang sama gagal cocok lagi dan orang harus memeriksanya lagi.
--
-- Kuncinya (kota, kecamatan, nama) — sama persis dengan regionKey() di backend/core/region.js,
-- jadi satu alias tidak pernah bocor ke kecamatan lain yang kebetulan punya nama serupa.
--
-- Baris di sini TIDAK PERNAH lahir sendiri dari tebakan. backend/core/matching.js cuma
-- menyarankan; yang menulis ke sini hanya klik konfirmasi di halaman. Tebakan yang
-- diterima diam-diam akan menempelkan penjualan ke kelurahan yang salah tanpa satu pun
-- gejala di layar.
--
-- Foreign key ke villages disengaja: alias yang menunjuk kode yang tidak ada berarti
-- penjualan hilang ke kelurahan hantu, dan database yang menolaknya lebih baik daripada
-- pemeriksaan di aplikasi yang bisa terlewat di jalur kedua.
CREATE TABLE IF NOT EXISTS village_aliases (
  city_code     VARCHAR(8) NOT NULL,                -- 34.04
  district_name VARCHAR(120) NOT NULL,
  village_name  VARCHAR(120) NOT NULL,              -- ejaan seperti di Excel
  village_code  VARCHAR(16) NOT NULL,               -- kelurahan sungguhan yang dimaksud
  created_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (city_code, district_name, village_name),
  CONSTRAINT fk_alias_village FOREIGN KEY (village_code)
    REFERENCES villages(village_code) ON DELETE CASCADE
);

-- Jejak impor. Dengan satu akun bersama, ini satu-satunya cara mengetahui apa yang
-- terjadi dan kapan.
--
-- Kolom waktu TIMESTAMPTZ, bukan teks. Semula VARCHAR(32) berisi ISO-8601 — warisan
-- SQLite/MySQL yang memang tidak punya tipe waktu yang layak. Postgres punya, dan
-- selama kolomnya teks tiap hitungan selisih waktu gagal dengan "operator does not
-- exist: character varying - character varying". Urut dan tampilannya tetap sama:
-- ISO-8601 kebetulan urut secara abjad, jadi yang lama tidak pernah terlihat salah —
-- dia cuma menolak dihitung.
CREATE TABLE IF NOT EXISTS imports (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  ip          VARCHAR(64),
  file_name   VARCHAR(255),
  period      VARCHAR(7),
  rows_read   INTEGER,
  rows_used   INTEGER,
  new_outlets INTEGER,
  result      VARCHAR(16) NOT NULL,                 -- 'ok'|'gagal'|'berjalan'|'hapus'|'reset'
  message     TEXT
);

CREATE INDEX IF NOT EXISTS idx_imports_started ON imports (started_at DESC);

-- Rasio jangkauan: berapa bagian tiap kelurahan yang masuk radius tiap outlet.
--
-- Dihitung PostGIS lewat ST_Intersection/ST_Area — eksak terhadap poligon yang ada,
-- bukan diperkirakan dengan menyebar titik. Tetap disimpan, bukan dihitung tiap
-- permintaan datang: hasilnya tidak berubah sampai ada koordinat outlet yang disunting,
-- dan halaman mengirimkannya sekaligus ke browser.
--
-- Beberapa radius disimpan sekaligus. Menyimpan satu lalu menskalakannya untuk radius
-- lain terlihat hemat tapi salah: penskalaan hanya membesarkan rasio yang sudah ada dan
-- tidak pernah menambahkan kelurahan yang tadinya di luar jangkauan.
CREATE TABLE IF NOT EXISTS coverage (
  radius_m     INTEGER NOT NULL,
  outlet_code  VARCHAR(32) NOT NULL,
  village_code VARCHAR(16) NOT NULL,
  ratio        DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (radius_m, outlet_code, village_code),
  CONSTRAINT fk_coverage_outlet FOREIGN KEY (outlet_code)
    REFERENCES outlets(outlet_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coverage_outlet ON coverage (outlet_code);

-- Ring layanan tiap pos: desa/kelurahan mana yang masuk ring 1, 2, atau 3.
--
-- Menggantikan cara lama "dalam radius X km" yang menganggap jangkauan itu lingkaran.
-- Radius tidak tahu jalan, sungai, maupun gunung; tim yang tahu. Jadi ringnya
-- DITENTUKAN MANUSIA, bukan dihitung — dan itu satu-satunya alasan tabel ini ada.
--
-- Sejak 2026-08-31 per village_code, BUKAN LAGI district_code — permintaan Pakbos,
-- granularitas kecamatan dianggap terlalu kasar. Data ring versi kecamatan lama
-- DIHAPUS TOTAL waktu migrasi (lihat docs/DECISIONS.md), bukan diturunkan otomatis.
--
-- Dikunci ke village_code, TIDAK PERNAH ke nama — sama seperti alasan district_code
-- dulu: nama kelurahan berulang lintas kabupaten, kode BPS tidak.
--
-- Satu desa cuma boleh ada di SATU ring per pos — itu yang dijaga primary key. Ring
-- yang tumpang tindih membuat satu penjualan terhitung dua kali, dan totalnya tetap
-- terlihat masuk akal.
CREATE TABLE IF NOT EXISTS outlet_rings (
  outlet_code  VARCHAR(32) NOT NULL,
  village_code VARCHAR(16) NOT NULL,
  ring         SMALLINT NOT NULL CHECK (ring BETWEEN 1 AND 3),
  PRIMARY KEY (outlet_code, village_code),
  CONSTRAINT fk_rings_outlet FOREIGN KEY (outlet_code)
    REFERENCES outlets(outlet_code) ON DELETE CASCADE,
  CONSTRAINT fk_rings_village FOREIGN KEY (village_code)
    REFERENCES villages(village_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rings_outlet ON outlet_rings (outlet_code);

-- Versi skema. Satu baris saja — kuncinya konstanta, bukan sesuatu yang bertambah.
CREATE TABLE IF NOT EXISTS schema_version (
  id      SMALLINT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL
);
