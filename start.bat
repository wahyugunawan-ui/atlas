@echo off
REM Jalankan Astra Command Center.
REM
REM Klik dua kali berkas ini. Jendela hitam yang muncul ADALAH servernya — biarkan
REM terbuka selama aplikasinya dipakai, dan tutup untuk mematikannya.
REM
REM Sengaja tidak memakai `start` atau menyembunyikan jendela: kalau ada yang salah,
REM pesannya harus terbaca. Server yang mati diam-diam di latar belakang jauh lebih
REM sulit ditolong daripada jendela yang menampilkan errornya.

cd /d "%~dp0"
title Astra Command Center

REM Letak folder data dan kredensial. Keduanya HARUS di luar OneDrive: yang pertama
REM karena berkas geo bisa terkunci di tengah pembacaan, yang kedua karena .env memuat
REM hash sandi, rahasia cookie, dan sandi database — dan folder tersinkron berarti
REM ketiganya ikut naik ke cloud pihak ketiga.
if not defined DATA_DIR set "DATA_DIR=C:\astra-data"
if not defined ACC_ENV_FILE set "ACC_ENV_FILE=%DATA_DIR%\.env"

if not exist "%ACC_ENV_FILE%" (
  echo.
  echo   Berkas kredensial belum ada:
  echo     %ACC_ENV_FILE%
  echo.
  echo   1. Salin .env.example ke situ
  echo   2. Isi DB_PASSWORD dengan sandi PostgreSQL
  echo   3. Jalankan: npm run set-password
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo   Memasang dependensi. Sekali saja, butuh beberapa menit...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   Pemasangan gagal. Periksa sambungan internet, lalu jalankan lagi.
    echo.
    pause
    exit /b 1
  )
)

node src/server/index.js

REM Sampai di sini berarti servernya berhenti. Kalau karena error, pesannya ada di
REM atas — pause menahan jendelanya supaya sempat terbaca.
echo.
echo   Server berhenti.
echo.
pause
