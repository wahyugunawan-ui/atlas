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

if not exist ".env" (
  echo.
  echo   Berkas .env belum ada.
  echo.
  echo   1. Salin .env.example jadi .env
  echo   2. Isi DB_PASSWORD dengan sandi MySQL
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
