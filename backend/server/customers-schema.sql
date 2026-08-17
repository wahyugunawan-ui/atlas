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
