@echo off
REM Tutup lagi akses dari internet. JALANKAN SETELAH PITCH SELESAI.
REM
REM Aman dijalankan berulang: kalau memang sudah mati, tidak terjadi apa-apa.
REM
REM Dashboard tetap bisa dibuka dari laptop ini dan dari jaringan kantor seperti biasa;
REM yang ditutup cuma jalur dari internet.

setlocal

set "TS=%ProgramFiles%\Tailscale\tailscale.exe"

if not exist "%TS%" (
  echo   Tailscale tidak ditemukan. Tidak ada yang perlu dimatikan.
  exit /b 0
)

"%TS%" funnel --https=443 off

echo.
echo   Keadaan sekarang:
"%TS%" funnel status

echo.
echo   Kalau baris di atas berbunyi "No serve config", berarti sudah tertutup.
echo.
