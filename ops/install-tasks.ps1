# Daftarkan dua tugas terjadwal: nyalakan aplikasi saat login, dan backup tiap hari.
#
# TIDAK BUTUH HAK ADMIN. Tugas yang berjalan sebagai pengguna yang sedang login bisa
# dibuat siapa saja untuk dirinya sendiri. Konsekuensinya jujur: aplikasinya menyala
# saat orang itu LOGIN, bukan saat komputernya menyala. Untuk laptop yang memang
# dipakai orang, itu sama saja. Untuk server yang tidak pernah ada yang login,
# PostgreSQL dan aplikasi harus didaftarkan sebagai Windows service — dan ITU butuh
# admin sekali di awal. Langkahnya ada di docs/PINDAH.md.
#
# Jalankan sekali:  powershell -ExecutionPolicy Bypass -File ops\install-tasks.ps1
# Membatalkan:      powershell -ExecutionPolicy Bypass -File ops\install-tasks.ps1 -Uninstall

param(
    [switch]$Uninstall,
    [string]$BackupTime = '19:00'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$startAll = Join-Path $root 'ops\start-all.bat'
$backup = Join-Path $root 'ops\backup.bat'

$namaApp = 'Astra Command Center'
$namaBackup = 'Astra Command Center - Backup'

function Remove-TaskIfExists([string]$name) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "  dibuang: $name"
    }
}

if ($Uninstall) {
    Remove-TaskIfExists $namaApp
    Remove-TaskIfExists $namaBackup
    Write-Host "`n  Selesai. Aplikasi tidak lagi menyala sendiri saat login.`n"
    exit 0
}

foreach ($f in @($startAll, $backup)) {
    if (-not (Test-Path $f)) { throw "Tidak ada $f" }
}

Remove-TaskIfExists $namaApp
Remove-TaskIfExists $namaBackup

# --- aplikasi: menyala saat login, dan dihidupkan ulang kalau mati ---
#
# RestartCount/RestartInterval itu pengganti supervisor yang paling sederhana yang
# tersedia tanpa admin. Kalau prosesnya mati — bug, kehabisan memori, database yang
# hilang — Windows menyalakannya lagi setelah satu menit, sampai tiga kali. Tanpa ini,
# aplikasinya cuma hilang dan tim tidak punya siapa pun untuk menyalakannya kembali.
$aksiApp = New-ScheduledTaskAction -Execute 'cmd.exe' `
    -Argument "/c `"$startAll`"" -WorkingDirectory $root
$pemicuApp = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$setelanApp = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable
Register-ScheduledTask -TaskName $namaApp -Action $aksiApp -Trigger $pemicuApp `
    -Settings $setelanApp -Description 'Nyalakan PostgreSQL dan Astra Command Center' | Out-Null
Write-Host "  dipasang: $namaApp (saat login, dihidupkan ulang kalau mati)"

# --- backup harian ---
#
# StartWhenAvailable menyusul backup yang terlewat karena laptopnya mati pada jamnya.
# Tanpa itu, laptop yang dimatikan tiap sore berarti backup yang tidak pernah jalan.
$aksiBackup = New-ScheduledTaskAction -Execute 'cmd.exe' `
    -Argument "/c `"$backup`"" -WorkingDirectory $root
$pemicuBackup = New-ScheduledTaskTrigger -Daily -At $BackupTime
$setelanBackup = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $namaBackup -Action $aksiBackup -Trigger $pemicuBackup `
    -Settings $setelanBackup -Description 'pg_dump database astra, simpan 14 hari' | Out-Null
Write-Host "  dipasang: $namaBackup (tiap hari $BackupTime)"

Write-Host ""
Write-Host "  Periksa:  Get-ScheduledTask -TaskName 'Astra*'"
Write-Host "  Coba backup sekarang:  Start-ScheduledTask -TaskName '$namaBackup'"
Write-Host ""
Write-Host "  CATATAN: keduanya berjalan saat PENGGUNA INI login, bukan saat komputer"
Write-Host "  menyala. Untuk server yang tidak pernah ada yang login, daftarkan"
Write-Host "  PostgreSQL dan aplikasi sebagai Windows service — lihat docs/PINDAH.md."
Write-Host ""
