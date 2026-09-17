@echo off
REM Tutup lagi akses dari internet. JALANKAN SETELAH PITCH SELESAI.
REM
REM Aman dijalankan berulang: kalau memang sudah mati, tidak terjadi apa-apa.
REM
REM Dashboard tetap bisa dibuka dari laptop ini dan dari jaringan kantor seperti biasa;
REM yang ditutup cuma jalur dari internet.

setlocal

tasklist /fi "imagename eq cloudflared.exe" | find /i "cloudflared.exe" >nul
if errorlevel 1 (
  echo.
  echo   Tidak ada cloudflared yang jalan. Akses dari internet memang sudah tertutup.
  echo.
  exit /b 0
)

taskkill /im cloudflared.exe /f >nul 2>&1

echo.
echo   Keadaan sekarang:
tasklist /fi "imagename eq cloudflared.exe" | find /i "cloudflared.exe" >nul
if errorlevel 1 (
  echo   tertutup - cloudflared sudah berhenti.
) else (
  echo   MASIH JALAN. Coba jalankan lagi berkas ini, atau tutup jendelanya manual.
)

echo.
echo   Link trycloudflare.com yang lama sekarang mati dan TIDAK bisa dipakai lagi.
echo   Kalau nanti dibuka lagi, linknya akan berbeda.
echo.
