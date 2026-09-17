@echo off
REM Buka dashboard ke internet lewat Tailscale Funnel. Untuk pitch atau demo.
REM
REM Selama ini menyala, SIAPA PUN di internet bisa menjangkau halaman login — dan
REM kalau sandinya diketahui, seluruh data konsumen ikut terjangkau. Yang melindungi
REM cuma sandi tim, dan sandi itu dipakai bersama.
REM
REM Karena itu: NYALAKAN SEBELUM, MATIKAN SESUDAH. Jangan dibiarkan menyala karena
REM lupa. Matikan dengan ops\akses-luar-mati.bat.
REM
REM Laptop harus tetap menyala dan servernya jalan. Kalau laptopnya tidur, link mati.

setlocal

REM 3000, bukan 3100. Angka lama tidak pernah cocok dengan PORT di .env, jadi
REM pemeriksaan di bawah selalu menembak port yang salah.
if not defined PORT set "PORT=3000"
set "TS=%ProgramFiles%\Tailscale\tailscale.exe"

if not exist "%TS%" (
  echo.
  echo   Tailscale tidak ditemukan di %TS%
  echo   Pasang dari https://tailscale.com/download lalu jalankan lagi.
  echo.
  exit /b 1
)

echo.
echo   Memeriksa server lokal di port %PORT% ...
curl -s -o nul -w "  server menjawab: %%{http_code}\n" http://localhost:%PORT%/login
if errorlevel 1 (
  echo.
  echo   Server belum jalan. Jalankan start.bat dulu, baru berkas ini.
  echo.
  exit /b 1
)

echo.
"%TS%" funnel --bg %PORT%
if errorlevel 1 (
  echo.
  echo   Gagal menyalakan. Kalau pesannya "Funnel is not enabled on your tailnet",
  echo   buka link yang disebutkan di atas sekali untuk mengaktifkannya.
  echo.
  exit /b 1
)

echo.
echo   ================================================================
echo    SEDANG TERBUKA KE INTERNET. Matikan dengan:
echo    ops\akses-luar-mati.bat
echo   ================================================================
echo.
echo   Permintaan pertama bisa makan waktu 15 detik (pemanasan). Buka
echo   linknya sekali beberapa menit sebelum pitch supaya tidak menunggu
echo   di depan orang.
echo.
