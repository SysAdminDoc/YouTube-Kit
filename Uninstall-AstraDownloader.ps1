<#
.SYNOPSIS
    Astra Downloader Uninstaller — removes all installed components
#>

$ErrorActionPreference = 'Continue'

# Self-elevate
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $selfPath = if ($PSCommandPath) { $PSCommandPath } else {
        [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    }
    if ($selfPath -match '\.exe$' -and $selfPath -notmatch '(?i)powershell|pwsh') {
        Start-Process -FilePath $selfPath -Verb RunAs
    } elseif ($selfPath) {
        Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$selfPath`""
    }
    exit
}

Add-Type -AssemblyName PresentationFramework

$installPath = "$env:LOCALAPPDATA\AstraDownloader"

$result = [System.Windows.MessageBox]::Show(
    "Uninstall Astra Downloader?`n`nThis will remove:`n- Server application and all data`n- Desktop shortcut`n- Startup task`n- Protocol handlers (ytdl://, mediadl://)`n- Registry entries`n`nYour downloaded videos will NOT be deleted.",
    "Uninstall Astra Downloader",
    "OKCancel",
    "Warning"
)
if ($result -ne "OK") { exit }

try {
    # 1. Kill running processes
    # Kill by name
    Get-Process -Name "AstraDownloader*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    # Kill by port (anything listening on 9751)
    try {
        Get-NetTCPConnection -LocalPort 9751 -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object { Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue } |
            Stop-Process -Force -ErrorAction SilentlyContinue
    } catch {}
    # Kill any yt-dlp/ffmpeg spawned by the server
    Get-Process -Name "yt-dlp" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Process -Name "ffmpeg" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500

    # 2. Remove scheduled tasks
    try { Unregister-ScheduledTask -TaskName "AstraDownloader" -Confirm:$false -ErrorAction SilentlyContinue } catch {}
    try { Unregister-ScheduledTask -TaskName "MediaDL-Server" -Confirm:$false -ErrorAction SilentlyContinue } catch {}

    # 3. Remove protocol handlers
    foreach ($proto in @('ytdl', 'mediadl')) {
        $regPath = "HKCU:\Software\Classes\$proto"
        if (Test-Path $regPath) { Remove-Item -Path $regPath -Recurse -Force -ErrorAction SilentlyContinue }
    }

    # 4. Remove Add/Remove Programs registry entry
    $uninstReg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AstraDownloader"
    if (Test-Path $uninstReg) { Remove-Item -Path $uninstReg -Recurse -Force -ErrorAction SilentlyContinue }

    # 5. Remove desktop shortcut
    $desktopShortcut = "$env:USERPROFILE\Desktop\Astra Downloader.lnk"
    if (Test-Path $desktopShortcut) { Remove-Item $desktopShortcut -Force -ErrorAction SilentlyContinue }

    # 6. Remove startup folder shortcut (legacy fallback)
    $startupPath = [Environment]::GetFolderPath('Startup')
    foreach ($name in @("AstraDownloader.lnk", "MediaDL-Server.lnk")) {
        $s = Join-Path $startupPath $name
        if (Test-Path $s) { Remove-Item $s -Force -ErrorAction SilentlyContinue }
    }

    # 7. Remove install directory (everything except downloaded videos)
    if (Test-Path $installPath) {
        Remove-Item -Path $installPath -Recurse -Force -ErrorAction SilentlyContinue
    }

    [System.Windows.MessageBox]::Show(
        "Astra Downloader has been uninstalled.`n`nYour downloaded videos were not removed.",
        "Uninstall Complete",
        "OK",
        "Information"
    )

} catch {
    [System.Windows.MessageBox]::Show("Uninstall error: $($_.Exception.Message)", "Error", "OK", "Error")
}
