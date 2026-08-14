@echo off
REM Nyalakan PostgreSQL lalu aplikasinya. Dipakai Task Scheduler saat login.
REM
REM Beda dari start.bat: berkas ini tidak mengharapkan ada orang yang melihatnya.
REM Dia menyalakan database dulu kalau belum jalan, lalu aplikasinya, dan semua
REM keluarannya masuk berkas log — bukan ke jendela yang tidak ada yang membacanya.

setlocal

cd /d "%~dp0.."

if not defined DATA_DIR set "DATA_DIR=C:\astra-data"
if not defined ACC_ENV_FILE set "ACC_ENV_FILE=%DATA_DIR%\.env"
if not defined PGDATA set "PGDATA=%DATA_DIR%\pgdata"
if not defined PG_BIN set "PG_BIN=%USERPROFILE%\pg\pgsql\bin"
if not defined PGPORT set "PGPORT=5433"

set "BOOTLOG=%DATA_DIR%\logs\start-all.log"
if not exist "%DATA_DIR%\logs" mkdir "%DATA_DIR%\logs"

echo. >> "%BOOTLOG%"
echo ==== %DATE% %TIME% menyalakan ==== >> "%BOOTLOG%"

REM --- PostgreSQL ---
REM
REM `pg_ctl status` mengembalikan 0 kalau servernya jalan. Dipakai supaya menjalankan
REM berkas ini dua kali tidak pernah membuat dua server berebut folder data yang sama.
"%PG_BIN%\pg_ctl.exe" -D "%PGDATA%" status >nul 2>&1
if errorlevel 1 (
  echo Menyalakan PostgreSQL... >> "%BOOTLOG%"
  "%PG_BIN%\pg_ctl.exe" -D "%PGDATA%" -l "%DATA_DIR%\pg.log" -o "-p %PGPORT%" -w start >> "%BOOTLOG%" 2>&1
  if errorlevel 1 (
    echo GAGAL menyalakan PostgreSQL. Lihat %DATA_DIR%\pg.log >> "%BOOTLOG%"
    exit /b 1
  )
) else (
  echo PostgreSQL sudah jalan. >> "%BOOTLOG%"
)

REM --- Aplikasi ---
REM
REM Node mencatat sendiri ke DATA_DIR\logs lewat src/server/logger.js; yang di sini
REM cuma menangkap kegagalan yang terjadi SEBELUM logger sempat menyala.
echo Menyalakan aplikasi... >> "%BOOTLOG%"
node src/server/index.js >> "%BOOTLOG%" 2>&1

echo ==== %DATE% %TIME% aplikasi berhenti (kode %ERRORLEVEL%) ==== >> "%BOOTLOG%"
exit /b %ERRORLEVEL%
