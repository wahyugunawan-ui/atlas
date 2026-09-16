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

-- Kode "Kode Dealer" numerik dari sheet Dealer (mis. "11506") — beda dari
-- dealer_code (turunan nama, mis. "NUSANTARASAKTIGEJAYAN"). Dipakai
-- scripts/import-dealer-pos-rings.js membuat baris outlets "proxy" (lihat
-- kolom outlets.is_dealer_proxy) supaya Excel penjualan bulanan — yang cuma
-- menyebut identitas level dealer, bukan pos fisik — tetap bisa disambungkan
-- tanpa mengubah skema sales/customers. NULL untuk dealer yang dibuat manual
-- lewat halaman Master Dealer.
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS legacy_code VARCHAR(32);

CREATE TABLE IF NOT EXISTS outlets (
  outlet_code VARCHAR(32) NOT NULL PRIMARY KEY,     -- kode POS fisik ("Kode POS OCEAN"),
                                                     -- ATAU legacy_code dealer kalau
                                                     -- is_dealer_proxy true — lihat di bawah
  outlet_name VARCHAR(200) NOT NULL,
  dealer_code VARCHAR(64) NOT NULL,                 -- pengelompokan; awalnya tebakan
  dealer_name VARCHAR(200) NOT NULL,
  address     VARCHAR(400),
  lat         DOUBLE PRECISION,                     -- NULL = belum di-pin
  lng         DOUBLE PRECISION,
  updated_at  TIMESTAMPTZ
);

-- Baris "proxy": mewakili DEALER itu sendiri, bukan satu pos fisik sungguhan.
--
-- Excel penjualan bulanan Astra cuma menyebut identitas level dealer (kolom
-- "Kode Dealer", lihat komentar di backend/core/aggregate.js COLUMN.outletCode)
-- — bukan kode pos fisik ("Kode POS OCEAN") yang dipakai 109 baris outlets
-- sungguhan. Daripada mengubah skema sales/customers (dipakai banyak tempat),
-- satu baris proxy per dealer dibuat di sini, dikunci ke dealers.legacy_code,
-- supaya sales.outlet_code/customers.outlet_code yang memang levelnya dealer
-- langsung punya pasangan tanpa impor ulang.
--
-- DISEMBUNYIKAN dari katalog Master Pos Dealer (yang harus tetap sesuai jumlah
-- baris sheet POS sungguhan) dan dari hitungan "Jumlah Pos" — lihat
-- repository.js listDealers()/summary() dan frontend/js/app.js S.realOutlets.
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS is_dealer_proxy BOOLEAN NOT NULL DEFAULT false;

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

-- Ring milik DEALER (bukan lagi pos) dan Coverage milik POS: dua tabel di bawah ini
-- menggantikan `outlet_rings` (per pos, per kelurahan, ring 1-3) TOTAL, per 2026-08-31
-- sore — permintaan lanjutan yang membalik keputusan pagi harinya di tabel yang sama.
--
-- Kenapa dibalik lagi: pagi itu ring dipindah ke kelurahan karena kecamatan dianggap
-- terlalu kasar UNTUK SATU POS. Tapi satu DEALER menaungi banyak pos sekaligus, jadi
-- kecamatan justru pas untuk level dealer — dan pos sendiri mendapat konsep baru
-- (coverage, 8 slot bukan 3) di kecamatan yang sama, bukan kelurahan.
--
-- `outlet_rings` DIHAPUS TOTAL (lihat DROP TABLE di bawah), bukan dimigrasikan
-- otomatis — data ringnya baru saja dipulihkan dari cadangan pagi itu dan sengaja
-- tidak diturunkan ke skema baru; ring dealer diisi ulang lewat impor Excel
-- (scripts/import-dealer-pos-rings.js), lihat docs/DECISIONS.md.
DROP TABLE IF EXISTS outlet_rings;

-- Ring dealer: kecamatan mana yang masuk ring 1, 2, atau 3 milik satu dealer.
--
-- Ditentukan manusia (dari data cabang Astra), bukan dihitung — sama seperti alasan
-- outlet_rings dulu ada. Dikunci ke district_code, TIDAK PERNAH ke nama: nama
-- kecamatan berulang lintas kabupaten, kode BPS tidak.
--
-- Satu kecamatan cuma boleh ada di SATU ring per dealer — itu yang dijaga primary
-- key. Ring yang tumpang tindih membuat satu penjualan terhitung dua kali.
CREATE TABLE IF NOT EXISTS dealer_rings (
  dealer_code   VARCHAR(64) NOT NULL,
  district_code VARCHAR(16) NOT NULL,
  ring          SMALLINT NOT NULL CHECK (ring BETWEEN 1 AND 3),
  PRIMARY KEY (dealer_code, district_code),
  CONSTRAINT fk_dealer_rings_dealer FOREIGN KEY (dealer_code)
    REFERENCES dealers(dealer_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dealer_rings_dealer ON dealer_rings (dealer_code);

-- Coverage pos: kecamatan mana yang masuk coverage 1..8 milik satu pos.
--
-- Konsep BARU, bukan penggantian nama dari tabel `coverage` di bawah — itu rasio
-- jangkauan radius PostGIS lama, dipertahankan terpisah (lihat komentarnya).
-- Delapan slot, bukan tiga: satu pos bisa melayani kecamatan lebih beragam
-- daripada satu dealer per ring.
CREATE TABLE IF NOT EXISTS pos_coverage_district (
  outlet_code   VARCHAR(32) NOT NULL,
  district_code VARCHAR(16) NOT NULL,
  coverage_num  SMALLINT NOT NULL CHECK (coverage_num BETWEEN 1 AND 8),
  PRIMARY KEY (outlet_code, district_code),
  CONSTRAINT fk_pos_coverage_outlet FOREIGN KEY (outlet_code)
    REFERENCES outlets(outlet_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pos_coverage_outlet ON pos_coverage_district (outlet_code);

-- Sumber yang diimpor: 'sales' (Excel bulanan yang sudah ada), 'ktp', atau 'servis'.
--
-- Ditambah waktu penyatuan tiga sumber masuk (docs/FUSION.md Tahap C). Tanpa kolom
-- ini, Riwayat Impor mencampur tiga jenis berkas yang berbeda tanpa satu pun cara
-- membedakannya — dan "impor 19.000 baris" jadi kalimat yang tidak bisa ditindaklanjuti.
--
-- DEFAULT 'sales' supaya seluruh baris riwayat yang sudah ada tetap benar artinya:
-- sebelum kolom ini ada, satu-satunya yang bisa diimpor memang penjualan.
ALTER TABLE imports ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'sales';

-- ============================================================================
-- PENYATUAN TIGA SUMBER (docs/FUSION.md) — bagian yang BEBAS PII
-- ============================================================================
--
-- Tabel staging dan tabel fusinya ada di database `astra_customers`, bukan di sini:
-- Data KTP membawa nama+alamat, Data Servis membawa alamat, dan Data Pengiriman
-- membawa titik GPS rumah. Ketiganya PII. Yang boleh menyeberang ke database ini
-- cuma hasil agregatnya — cukup untuk seluruh angka di dashboard, tidak cukup untuk
-- mengenali siapa pun.

-- Ambang dan bobot yang boleh diubah operator tanpa deploy ulang.
--
-- KPI Jarak (pemisah "berdekatan" dari "berjauhan") sengaja TIDAK jadi konstanta di
-- kode: mengubahnya adalah keputusan bisnis, bukan keputusan teknis, dan orang yang
-- berhak mengubahnya tidak punya akses ke kode maupun cara men-deploy.
CREATE TABLE IF NOT EXISTS app_config (
  key        VARCHAR(64) NOT NULL PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by VARCHAR(64)
);

-- Nilai bawaan. ON CONFLICT DO NOTHING supaya menjalankan ulang skema tidak pernah
-- menimpa angka yang sudah disetel operator.
INSERT INTO app_config (key, value) VALUES
  ('kpi_jarak_m',           '50000'),
  ('confidence_solid_min',  '0.65'),
  ('confidence_rapuh_max',  '0.50'),
  ('retention_sehat_min',   '0.50'),
  ('retention_risiko_max',  '0.30'),
  ('weight_loyal_verified', '1.00'),
  ('weight_service_near',   '0.80'),
  ('weight_delivery_near',  '0.75'),
  ('weight_registered_only','0.55'),
  ('weight_nomad',          '0.20'),
  ('weight_unverified',     '0.05')
ON CONFLICT (key) DO NOTHING;

-- Hasil penggolongan, sudah diringkas per desa x dealer x golongan.
--
-- Tidak ada nomor mesin, nama, alamat, atau titik di sini — itu yang membuat
-- dashboard tetap hidup setelah `DROP DATABASE astra_customers`, persis seperti
-- panel lain yang tidak bergantung PII.
--
-- Sengaja TANPA foreign key. Ini potret historis: baris bulan lalu harus tetap ada
-- dan tetap benar meski dealernya kelak dihapus dari master. FK dengan CASCADE akan
-- menghapus sejarah diam-diam, dan sejarah yang hilang tanpa jejak justru yang
-- paling mahal di tabel seperti ini.
-- village_code MEMAKAI '' (teks kosong), bukan NULL, untuk pelanggan yang desanya
-- tidak diketahui — dan justru merekalah golongan "Tak Terverifikasi" yang harus
-- terhitung. Kolom NULL tidak bisa jadi bagian primary key di Postgres, jadi kalau
-- baris ini dibuang karena desanya kosong, dashboard kehilangan persis angka yang
-- jadi alasan fitur ini ada.
--
-- city_code tetap diisi walau desanya gagal tergeocode: kode kota datang dari kolom
-- Excel, bukan dari hasil pencocokan nama, jadi pelanggan tak terverifikasi tetap
-- bisa dihitung di kotanya yang benar pada Matriks Kota x Golongan.
CREATE TABLE IF NOT EXISTS segment_rollup (
  period         VARCHAR(7) NOT NULL,
  village_code   VARCHAR(16) NOT NULL,     -- '' = desa tidak diketahui
  city_code      VARCHAR(8),
  dealer_code    VARCHAR(64) NOT NULL,
  segment        VARCHAR(24) NOT NULL,
  customer_count INTEGER NOT NULL,
  weight_sum     NUMERIC(10,2) NOT NULL,   -- sumbangan golongan ini ke CW Sales
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (period, village_code, dealer_code, segment)
);

-- Untuk database yang tabelnya sudah terlanjur dibuat sebelum kolom ini ada.
ALTER TABLE segment_rollup ADD COLUMN IF NOT EXISTS city_code VARCHAR(8);

-- Siapa punya sumber apa — bahan diagram Venn dan panel Cakupan Sumber (3.1/3.2).
--
-- KENAPA TABEL SENDIRI, bukan kolom tambahan di segment_rollup. Yang disimpan di sini
-- dimensi yang BERBEDA: bukan "golongannya apa", tapi "sumber datanya apa saja yang
-- dimiliki". Satu golongan bisa datang dari kombinasi sumber yang berbeda —
-- "Migran/Nomaden" muncul baik dari pelanggan yang cuma punya servis (jauh) maupun
-- yang cuma punya kiriman (jauh), dan Venn HARUS memisah keduanya. Angka acuan di
-- gambar rancangan membuktikan itu: 199 (Kirim saja) + 228 (Servis saja) = 427,
-- persis jumlah Migran.
--
-- `segment` tetap ikut disimpan supaya satu tabel melayani dua panel sekaligus: Venn
-- memakainya untuk menempatkan tiap region, Cakupan Sumber mengabaikannya dan cukup
-- menjumlah per sumber.
--
-- KTP tidak punya kolomnya sendiri: baris KTP-lah yang mendefinisikan "satu
-- pelanggan ada", jadi semua baris di sini menurut definisi punya KTP.
CREATE TABLE IF NOT EXISTS source_overlap (
  period         VARCHAR(7) NOT NULL,
  city_code      VARCHAR(8) NOT NULL,     -- '' = kota tidak diketahui
  dealer_code    VARCHAR(64) NOT NULL,
  has_service    BOOLEAN NOT NULL,
  has_delivery   BOOLEAN NOT NULL,
  segment        VARCHAR(24) NOT NULL,
  customer_count INTEGER NOT NULL,
  PRIMARY KEY (period, city_code, dealer_code, has_service, has_delivery, segment)
);

CREATE INDEX IF NOT EXISTS idx_overlap_period ON source_overlap (period);

CREATE INDEX IF NOT EXISTS idx_rollup_period ON segment_rollup (period);
CREATE INDEX IF NOT EXISTS idx_rollup_dealer ON segment_rollup (dealer_code);

-- Versi skema. Satu baris saja — kuncinya konstanta, bukan sesuatu yang bertambah.
--
-- TIDAK dinaikkan waktu tabel penyatuan di atas ditambahkan: semuanya CREATE TABLE
-- IF NOT EXISTS yang tidak menyentuh tabel lama, jadi aplikasi versi lama masih bisa
-- membuka database ini dengan selamat — dia cuma tidak tahu tabel barunya. Menaikkan
-- versi justru akan membuat aplikasi lama MENOLAK database yang sebenarnya aman.
CREATE TABLE IF NOT EXISTS schema_version (
  id      SMALLINT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL
);
