@echo off
REM Buka dashboard ke internet lewat Cloudflare Tunnel. Untuk pitch atau demo.
REM
REM Ini PENGGANTI SEMENTARA dari akses-luar-nyala.bat (Tailscale Funnel), dipakai
REM karena Tailscale belum terpasang dan butuh akun. Lihat docs/DECISIONS.md.
REM
REM Selama ini menyala, SIAPA PUN di internet bisa menjangkau halaman login — dan
REM kalau sandinya diketahui, seluruh data konsumen ikut terjangkau. Yang melindungi
REM cuma sandi tim, dan sandi itu dipakai bersama.
REM
REM Karena itu: NYALAKAN SEBELUM, MATIKAN SESUDAH. Jangan dibiarkan menyala karena
REM lupa. Matikan dengan ops\akses-luar-cloudflare-mati.bat.
REM
REM BEDA PENTING dari Tailscale: linknya ACAK dan BERGANTI setiap kali berkas ini
REM dijalankan. Jadi linknya harus dikirim ulang ke orang tiap sesi. Jangan ditulis
REM di undangan rapat jauh-jauh hari.
REM
REM Laptop harus tetap menyala dan servernya jalan. Kalau laptopnya tidur, link mati.

setlocal

if not defined PORT set "PORT=3000"
set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not exist "%CF%" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"

if not exist "%CF%" (
  echo.
  echo   cloudflared tidak ditemukan.
  echo   Pasang dengan: winget install --id Cloudflare.cloudflared -e
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
echo   ================================================================
echo    Linknya muncul di bawah, barisnya berbunyi trycloudflare.com
echo    Biarkan jendela ini TERBUKA selama dipakai.
echo    Menutup jendela ini = menutup akses dari internet.
echo   ================================================================
echo.

"%CF%" tunnel --url http://localhost:%PORT%
