@echo off
REM Backup database. Dipakai Task Scheduler tiap hari.
REM
REM Yang di-backup cuma database `astra`. Database `astra_customers` yang memuat nama
REM dan alamat konsumen SENGAJA tidak ikut: backup yang berkeliaran adalah cara PII
REM bocor tanpa ada yang menyadarinya, dan itulah alasan kedua database ini dipisah
REM sejak awal. Kalau memang perlu, buat terpisah dan perlakukan sebagai berkas rahasia.
REM
REM Koordinat dan pengelompokan dealer hasil kurasi manusia HANYA ada di database —
REM tidak ada di berkas Excel mana pun. Itu yang benar-benar hilang kalau disknya
REM rusak, dan itu yang dijaga berkas ini.

setlocal

if not defined DATA_DIR set "DATA_DIR=C:\astra-data"
if not defined ACC_ENV_FILE set "ACC_ENV_FILE=%DATA_DIR%\.env"
if not defined PG_BIN set "PG_BIN=%USERPROFILE%\pg\pgsql\bin"
if not defined BACKUP_DIR set "BACKUP_DIR=%DATA_DIR%\backup"
if not defined BACKUP_KEEP set "BACKUP_KEEP=14"

REM Kredensial dibaca dari .env, bukan ditulis di sini. Berkas ini masuk git; .env tidak.
for /f "usebackq tokens=1,* delims==" %%A in ("%ACC_ENV_FILE%") do (
  if /i "%%A"=="DB_USER"     set "PGUSER=%%B"
  if /i "%%A"=="DB_PASSWORD" set "PGPASSWORD=%%B"
  if /i "%%A"=="DB_NAME"     set "PGDATABASE=%%B"
  if /i "%%A"=="DB_PORT"     set "PGPORT=%%B"
  if /i "%%A"=="DB_HOST"     set "PGHOST=%%B"
)
if not defined PGDATABASE set "PGDATABASE=astra"

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
set "LOG=%DATA_DIR%\logs\backup.log"
if not exist "%DATA_DIR%\logs" mkdir "%DATA_DIR%\logs"

REM Tanggal ISO dari PowerShell, bukan dari %DATE% — format %DATE% ikut setelan
REM regional Windows, dan nama berkas yang urutannya berubah antar mesin membuat
REM "backup terbaru" jadi tebakan.
for /f %%D in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "HARI=%%D"
set "TUJUAN=%BACKUP_DIR%\astra-%HARI%.dump"

echo. >> "%LOG%"
echo ==== %HARI% backup dimulai ==== >> "%LOG%"

REM spatial_ref_sys DIKECUALIKAN. Itu tabel milik PostGIS sendiri, berisi daftar
REM sistem koordinat dunia, dan pengguna aplikasi tidak punya hak menulisinya.
REM Kalau ikut di-dump, tiap pemulihan berakhir dengan "permission denied" dan
REM "errors ignored on restore" — dua baris merah yang membuat orang mengira
REM pemulihannya gagal padahal datanya lengkap. Isinya sudah ada di server tujuan
REM lewat CREATE EXTENSION postgis, dan proyek ini cuma memakai EPSG bawaan
REM (4326 dan 32749).
REM --no-comments membuang pernyataan COMMENT ON, termasuk komentar milik
REM ekstensi PostGIS yang hanya boleh diubah pemiliknya (postgres). Skema
REM proyek ini tidak memakai COMMENT ON sama sekali — penjelasannya ada sebagai
REM komentar SQL di berkas skema — jadi tidak ada yang hilang, dan pemulihannya
REM jadi bersih tanpa satu baris merah pun.
"%PG_BIN%\pg_dump.exe" -Fc --exclude-table=spatial_ref_sys --no-comments -f "%TUJUAN%" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo GAGAL. Berkas backup TIDAK dibuat. >> "%LOG%"
  exit /b 1
)

REM Dump yang ada tapi rusak lebih berbahaya daripada tidak ada dump sama sekali —
REM orang merasa aman padahal tidak. pg_restore --list membaca daftar isinya tanpa
REM memulihkan apa pun; kalau berkasnya cacat, di sinilah ketahuannya.
"%PG_BIN%\pg_restore.exe" --list "%TUJUAN%" >nul 2>>"%LOG%"
if errorlevel 1 (
  echo GAGAL: berkas dump tidak bisa dibaca pg_restore. Dibuang. >> "%LOG%"
  del "%TUJUAN%"
  exit /b 1
)

for %%F in ("%TUJUAN%") do echo Berhasil: %%~nxF (%%~zF byte) >> "%LOG%"

REM Buang yang lebih tua dari BACKUP_KEEP hari.
forfiles /p "%BACKUP_DIR%" /m astra-*.dump /d -%BACKUP_KEEP% /c "cmd /c del @path & echo Dibuang: @file >> \"%LOG%\"" 2>nul

echo ==== selesai ==== >> "%LOG%"
exit /b 0
