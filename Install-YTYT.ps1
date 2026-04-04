#requires -Version 5.1

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AppName = 'YTYT-Downloader'
$InstallRoot = Join-Path $env:LOCALAPPDATA $AppName
$DownloadRoot = Join-Path ([Environment]::GetFolderPath('MyVideos')) 'YouTube'
$ServerPort = 9751
$ServerVersion = '4.1.0'
$YtDlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
$FfmpegZipUrl = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
$DenoZipUrl = 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip'
$ConfigPath = Join-Path $InstallRoot 'config.json'
$ServerScriptPath = Join-Path $InstallRoot 'ytdl-server.ps1'
$WorkerScriptPath = Join-Path $InstallRoot 'ytdl-worker.ps1'
$LauncherVbsPath = Join-Path $InstallRoot 'start-server.vbs'
$StatusDir = Join-Path $InstallRoot 'status'
$LogDir = Join-Path $InstallRoot 'logs'
$TempDir = Join-Path $InstallRoot 'temp'
$BrandName = 'Astra Deck'
$InstallerTitle = 'Astra Deck Downloader Setup'
$StartupShortcutName = 'Astra Deck Downloader.lnk'
$DesktopDownloadsShortcutName = 'Astra Deck Downloads.lnk'

function Show-InstallerWelcome {
    try {
        $Host.UI.RawUI.WindowTitle = $InstallerTitle
    } catch {}

    Clear-Host
    $rule = '============================================================'
    Write-Host ''
    Write-Host $rule -ForegroundColor DarkGray
    Write-Host " $InstallerTitle" -ForegroundColor Cyan
    Write-Host ' One-time setup for local YouTube downloads' -ForegroundColor Gray
    Write-Host $rule -ForegroundColor DarkGray
    Write-Host ''
    Write-Host 'This setup installs everything automatically:' -ForegroundColor White
    Write-Host '  - yt-dlp' -ForegroundColor Gray
    Write-Host '  - ffmpeg and ffprobe' -ForegroundColor Gray
    Write-Host '  - the local Astra Deck download server' -ForegroundColor Gray
    Write-Host '  - auto-start on sign-in' -ForegroundColor Gray
    Write-Host ''
    Write-Host 'No extra choices are required. Just let it finish.' -ForegroundColor White
    Write-Host ''
}

function Write-Step {
    param([string]$Message)
    Write-Host "[${BrandName}] $Message" -ForegroundColor Cyan
}

function Write-Note {
    param([string]$Message)
    Write-Host ('  ' + $Message) -ForegroundColor Gray
}

function Write-SuccessSummary {
    param(
        [Parameter(Mandatory)][string]$DownloadPath
    )

    $rule = '============================================================'
    Write-Host ''
    Write-Host $rule -ForegroundColor DarkGray
    Write-Host " $BrandName downloader is ready." -ForegroundColor Green
    Write-Host $rule -ForegroundColor DarkGray
    Write-Host ''
    Write-Host (' Download folder: ' + $DownloadPath) -ForegroundColor Green
    Write-Host (' Local server:    http://127.0.0.1:' + $ServerPort) -ForegroundColor Green
    Write-Host ''
    Write-Host 'Next steps:' -ForegroundColor White
    Write-Host '  1. Go back to YouTube.' -ForegroundColor Gray
    Write-Host '  2. Click the Download button in Astra Deck.' -ForegroundColor Gray
    Write-Host '  3. Your files will save to the folder above.' -ForegroundColor Gray
    Write-Host ''
    Write-Host 'A desktop shortcut named "Astra Deck Downloads" was created for easy access.' -ForegroundColor Gray
    Write-Host ''
    Write-Host 'You can close this window.' -ForegroundColor Green
}

function Write-FriendlyFailure {
    param([Parameter(Mandatory)][string]$Message)

    $rule = '============================================================'
    Write-Host ''
    Write-Host $rule -ForegroundColor DarkGray
    Write-Host " $InstallerTitle could not finish." -ForegroundColor Red
    Write-Host $rule -ForegroundColor DarkGray
    Write-Host ''
    Write-Host (' Problem: ' + $Message) -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Try these steps:' -ForegroundColor White
    Write-Host '  1. Close this window.' -ForegroundColor Gray
    Write-Host '  2. Right-click the setup file and choose "Run with PowerShell" again.' -ForegroundColor Gray
    Write-Host '  3. If it still fails, reopen Astra Deck and run the setup again.' -ForegroundColor Gray
    Write-Host ''
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Invoke-FileDownload {
    param(
        [Parameter(Mandatory)][string]$Uri,
        [Parameter(Mandatory)][string]$OutFile
    )

    $parent = Split-Path -Parent $OutFile
    if ($parent) {
        Ensure-Directory $parent
    }

    try {
        Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile -Headers @{ 'User-Agent' = 'AstraDeckInstaller/4.0' }
    } catch {
        $wc = New-Object System.Net.WebClient
        $wc.Headers['User-Agent'] = 'AstraDeckInstaller/4.0'
        try {
            $wc.DownloadFile($Uri, $OutFile)
        } finally {
            $wc.Dispose()
        }
    }

    if (-not (Test-Path -LiteralPath $OutFile) -or (Get-Item -LiteralPath $OutFile).Length -le 0) {
        throw "Download failed for $Uri"
    }
}

function Get-ExistingConfig {
    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        return $null
    }

    try {
        return Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Stop-ExistingServer {
    $targets = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -and $_.CommandLine -like '*ytdl-server.ps1*' -and $_.CommandLine -like "*$InstallRoot*"
    }

    foreach ($target in $targets) {
        try {
            Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
        } catch {}
    }
}

function Remove-LegacyIntegration {
    foreach ($taskName in @('MediaDL-Server', 'YTYT-Server')) {
        try {
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
        } catch {}
    }

    foreach ($scheme in @('mediadl', 'ytdl', 'ytvlc', 'ytvlcq', 'ytmpv', 'ytdlplay')) {
        try {
            Remove-Item -LiteralPath ("HKCU:\Software\Classes\" + $scheme) -Recurse -Force -ErrorAction SilentlyContinue
        } catch {}
    }

    $startup = [Environment]::GetFolderPath('Startup')
    foreach ($name in @('YTYT-Server.lnk', 'MediaDL-Server.lnk', 'YTYT-Downloader Server.lnk', 'Astra Deck Downloader.lnk', 'Ollama.lnk')) {
        $path = Join-Path $startup $name
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
    }

    $desktop = [Environment]::GetFolderPath('Desktop')
    foreach ($name in @('Astra Deck Downloads.lnk')) {
        $path = Join-Path $desktop $name
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
    }
}

function Ensure-YtDlp {
    $target = Join-Path $InstallRoot 'yt-dlp.exe'
    Write-Step 'Installing yt-dlp...'
    Write-Note 'This is the download engine used by Astra Deck.'
    $tempTarget = Join-Path $TempDir 'yt-dlp.exe'
    try {
        Invoke-FileDownload -Uri $YtDlpUrl -OutFile $tempTarget
        Move-Item -LiteralPath $tempTarget -Destination $target -Force
    } catch {
        Remove-Item -LiteralPath $tempTarget -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $target) {
            Write-Warning 'Failed to refresh yt-dlp. Keeping the existing local copy.'
            return $target
        }

        $existing = Get-Command yt-dlp -ErrorAction SilentlyContinue
        if ($existing -and $existing.Source -and (Test-Path -LiteralPath $existing.Source)) {
            Copy-Item -LiteralPath $existing.Source -Destination $target -Force
            return $target
        }

        throw
    }
    return $target
}

function Ensure-Ffmpeg {
    $ffmpegTarget = Join-Path $InstallRoot 'ffmpeg.exe'
    $ffprobeTarget = Join-Path $InstallRoot 'ffprobe.exe'
    if ((Test-Path -LiteralPath $ffmpegTarget) -and (Test-Path -LiteralPath $ffprobeTarget)) {
        return
    }

    $existingFfmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
    $existingFfprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
    if ($existingFfmpeg -and $existingFfprobe -and
        $existingFfmpeg.Source -and $existingFfprobe.Source -and
        (Test-Path -LiteralPath $existingFfmpeg.Source) -and
        (Test-Path -LiteralPath $existingFfprobe.Source)) {
        Copy-Item -LiteralPath $existingFfmpeg.Source -Destination $ffmpegTarget -Force
        Copy-Item -LiteralPath $existingFfprobe.Source -Destination $ffprobeTarget -Force
        return
    }

    Write-Step 'Installing video tools...'
    Write-Note 'ffmpeg is used to combine and process downloads correctly.'
    $zipPath = Join-Path $TempDir 'ffmpeg.zip'
    Invoke-FileDownload -Uri $FfmpegZipUrl -OutFile $zipPath

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        foreach ($entryName in @('ffmpeg.exe', 'ffprobe.exe')) {
            $entry = $zip.Entries | Where-Object { $_.Name -eq $entryName } | Select-Object -First 1
            if (-not $entry) {
                throw "Could not find $entryName in ffmpeg archive."
            }

            $destination = Join-Path $InstallRoot $entryName
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
        }
    } finally {
        $zip.Dispose()
        Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    }
}

function Ensure-Deno {
    $denoTarget = Join-Path $InstallRoot 'deno.exe'
    if (Test-Path -LiteralPath $denoTarget) {
        return
    }

    $existing = Get-Command deno -ErrorAction SilentlyContinue
    if ($existing -and $existing.Source -and (Test-Path -LiteralPath $existing.Source)) {
        Copy-Item -LiteralPath $existing.Source -Destination $denoTarget -Force
        return
    }

    Write-Step 'Installing YouTube support runtime...'
    Write-Note 'This keeps the local downloader compatible with YouTube.'
    $zipPath = Join-Path $TempDir 'deno.zip'
    Invoke-FileDownload -Uri $DenoZipUrl -OutFile $zipPath

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $entry = $zip.Entries | Where-Object { $_.Name -eq 'deno.exe' } | Select-Object -First 1
        if (-not $entry) {
            throw 'Could not find deno.exe in Deno archive.'
        }

        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $denoTarget, $true)
    } finally {
        $zip.Dispose()
        Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    }
}

function Write-Config {
    param(
        [Parameter(Mandatory)][string]$Token,
        [Parameter(Mandatory)][string]$DownloadPath
    )

    $config = [ordered]@{
        version      = $ServerVersion
        port         = $ServerPort
        token        = $Token
        downloadPath = $DownloadPath
        installedAt  = [DateTime]::UtcNow.ToString('o')
    }

    $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
}

function Write-InstallerAssets {
    $workerScript = @'
param(
    [Parameter(Mandatory)][string]$DownloadId,
    [Parameter(Mandatory)][string]$Url,
    [Parameter(Mandatory)][string]$Quality,
    [Parameter(Mandatory)][string]$ConfigPath,
    [string]$CookieFile,
    [switch]$AudioOnly
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$statusDir = Join-Path $root 'status'
$logDir = Join-Path $root 'logs'
$statusPath = Join-Path $statusDir ($DownloadId + '.json')
$logPath = Join-Path $logDir ($DownloadId + '.log')
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$downloadPath = $config.downloadPath
$ytDlpPath = Join-Path $root 'yt-dlp.exe'
$denoPath = Join-Path $root 'deno.exe'

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Save-Status {
    param([pscustomobject]$State)
    $State.updatedAt = [DateTime]::UtcNow.ToString('o')
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $statusPath -Encoding UTF8
}

function Get-FormatSelector {
    param([string]$RequestedQuality)

    switch ($RequestedQuality) {
        '2160' { return 'bestvideo*[height<=2160]+bestaudio/best[height<=2160]/best' }
        '1440' { return 'bestvideo*[height<=1440]+bestaudio/best[height<=1440]/best' }
        '1080' { return 'bestvideo*[height<=1080]+bestaudio/best[height<=1080]/best' }
        '720'  { return 'bestvideo*[height<=720]+bestaudio/best[height<=720]/best' }
        '480'  { return 'bestvideo*[height<=480]+bestaudio/best[height<=480]/best' }
        default { return 'bestvideo*+bestaudio/best' }
    }
}

function Update-Title {
    param([pscustomobject]$State, [string]$Value)
    if (-not [string]::IsNullOrWhiteSpace($Value)) {
        $State.title = $Value.Trim()
        Save-Status $State
    }
}

function Parse-Line {
    param(
        [pscustomobject]$State,
        [string]$Line
    )

    if ([string]::IsNullOrWhiteSpace($Line)) {
        return
    }

    if ($Line.StartsWith('YTKitTitle:')) {
        Update-Title -State $State -Value $Line.Substring(11)
        return
    }

    if ($Line.StartsWith('YTKitFile:')) {
        $State.file = $Line.Substring(10).Trim()
        Save-Status $State
        return
    }

    if ($Line -match '\[download\]\s+(?<pct>\d+(?:\.\d+)?)%.*?at\s+(?<speed>.+?)\s+ETA\s+(?<eta>\S+)$') {
        $State.status = 'downloading'
        $State.progress = [double]$Matches['pct']
        $State.speed = $Matches['speed'].Trim()
        $State.eta = $Matches['eta'].Trim()
        Save-Status $State
        return
    }

    if ($Line -match '\[download\]\s+(?<pct>\d+(?:\.\d+)?)%') {
        $State.status = 'downloading'
        $State.progress = [double]$Matches['pct']
        Save-Status $State
        return
    }

    if ($Line -match 'has already been downloaded') {
        $State.status = 'done'
        $State.progress = 100
        $State.speed = ''
        $State.eta = ''
        Save-Status $State
        return
    }

    if ($Line -like '[Merger]*' -or $Line -like '[ExtractAudio]*') {
        $State.status = 'processing'
        if ($State.progress -lt 99) {
            $State.progress = 99
        }
        $State.speed = ''
        $State.eta = 'Finishing'
        Save-Status $State
    }
}

$state = [pscustomobject]@{
    id        = $DownloadId
    title     = 'Preparing download...'
    progress  = 0
    speed     = ''
    eta       = ''
    status    = 'preparing'
    error     = ''
    url       = $Url
    quality   = $Quality
    audioOnly = [bool]$AudioOnly
    file      = ''
    updatedAt = [DateTime]::UtcNow.ToString('o')
}

Save-Status $state
Ensure-Directory $downloadPath
Ensure-Directory $statusDir
Ensure-Directory $logDir

$args = @(
    '--newline',
    '--no-color',
    '--no-playlist',
    '--windows-filenames',
    '--js-runtimes', ('deno:' + $denoPath),
    '--remote-components', 'ejs:github',
    '--ffmpeg-location', $root,
    '--print', 'before_dl:YTKitTitle:%(title)s',
    '--print', 'after_move:YTKitFile:%(filepath)s',
    '-o', (Join-Path $downloadPath '%(title).180B [%(id)s].%(ext)s')
)

if ($CookieFile -and (Test-Path -LiteralPath $CookieFile)) {
    $args += @('--cookies', $CookieFile)
}

if ($AudioOnly) {
    $args += @('-x', '--audio-format', 'mp3', '--audio-quality', '0')
} else {
    $args += @('-f', (Get-FormatSelector -RequestedQuality $Quality))
}

$args += $Url

try {
    & $ytDlpPath @args 2>&1 | ForEach-Object {
        $line = [string]$_
        Add-Content -LiteralPath $logPath -Value $line
        Parse-Line -State $state -Line $line
    }

    if ($LASTEXITCODE -ne 0) {
        throw "yt-dlp exited with code $LASTEXITCODE"
    }

    $state.status = 'done'
    $state.progress = 100
    $state.speed = ''
    $state.eta = ''
    Save-Status $state
} catch {
    $state.status = 'failed'
    $state.error = $_.Exception.Message
    $state.speed = ''
    $state.eta = ''
    Save-Status $state
    Add-Content -LiteralPath $logPath -Value ('ERROR: ' + $_.Exception.Message)
} finally {
    if ($CookieFile -and (Test-Path -LiteralPath $CookieFile)) {
        Remove-Item -LiteralPath $CookieFile -Force -ErrorAction SilentlyContinue
    }
}
'@

    $serverScript = @'
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $root 'config.json'
$statusDir = Join-Path $root 'status'
$logDir = Join-Path $root 'logs'
$tempDir = Join-Path $root 'temp'
$workerPath = Join-Path $root 'ytdl-worker.ps1'
$serverLog = Join-Path $logDir 'server.log'

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Write-ServerLog {
    param([string]$Message)
    $line = ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
    Add-Content -LiteralPath $serverLog -Value $line
}

function Load-Config {
    return Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
}

function Send-Json {
    param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)][int]$StatusCode,
        [Parameter(Mandatory)]$Payload
    )

    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = 'application/json'
    $json = $Payload | ConvertTo-Json -Depth 10
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.OutputStream.Close()
}

function Read-Body {
    param([Parameter(Mandatory)]$Request)
    $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
    try {
        return $reader.ReadToEnd()
    } finally {
        $reader.Dispose()
    }
}

function Get-StatusObject {
    param([string]$Id)
    $path = Join-Path $statusDir ($Id + '.json')
    if (-not (Test-Path -LiteralPath $path)) {
        return $null
    }

    try {
        return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Get-ActiveStatuses {
    $active = @()
    foreach ($file in Get-ChildItem -LiteralPath $statusDir -Filter '*.json' -ErrorAction SilentlyContinue) {
        try {
            $state = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
            if ($state -and @('queued', 'preparing', 'downloading', 'processing') -contains $state.status) {
                $active += $state
            }
        } catch {}
    }
    return $active
}

function Test-YouTubeUrl {
    param([string]$Value)
    try {
        $uri = [Uri]$Value
        $hostname = $uri.Host.ToLowerInvariant()
        return (($hostname -in @('youtu.be', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com')) -or $hostname.EndsWith('.youtube.com'))
    } catch {
        return $false
    }
}

function Write-CookiesFile {
    param(
        [Parameter(Mandatory)]$Cookies,
        [Parameter(Mandatory)][string]$Path
    )

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('# Netscape HTTP Cookie File')
    foreach ($cookie in $Cookies) {
        if (-not $cookie.name -or -not $cookie.domain) {
            continue
        }

        $domain = ([string]$cookie.domain) -replace "[`r`n`t]", ''
        $includeSubdomains = if ($domain.StartsWith('.')) { 'TRUE' } else { 'FALSE' }
        $pathValue = if ($cookie.path) { ([string]$cookie.path) -replace "[`r`n`t]", '' } else { '/' }
        $secureValue = if ($cookie.secure) { 'TRUE' } else { 'FALSE' }
        $expiry = 0
        if ($cookie.expirationDate) {
            try {
                $expiry = [int64][Math]::Floor([double]$cookie.expirationDate)
            } catch {}
        }

        $cookieName = ([string]$cookie.name) -replace "[`r`n`t]", ''
        $cookieValue = ([string]$cookie.value) -replace "[`r`n`t]", ''
        if ([string]::IsNullOrWhiteSpace($domain) -or [string]::IsNullOrWhiteSpace($cookieName)) {
            continue
        }

        $lines.Add([string]::Join("`t", @(
            $domain,
            $includeSubdomains,
            $pathValue,
            $secureValue,
            [string]$expiry,
            $cookieName,
            $cookieValue
        )))
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($Path, $lines, $utf8NoBom)
}

Ensure-Directory $statusDir
Ensure-Directory $logDir
Ensure-Directory $tempDir

$config = Load-Config
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add(('http://127.0.0.1:{0}/' -f $config.port))

try {
    $listener.Start()
} catch {
    Write-ServerLog ('Server already running or failed to bind port: ' + $_.Exception.Message)
    exit 0
}

Write-ServerLog ('Server listening on 127.0.0.1:' + $config.port)

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
    } catch {
        break
    }

    try {
        $request = $context.Request
        $path = $request.Url.AbsolutePath.Trim('/')

        if ($path -eq 'health') {
            $payload = @{
                status    = 'ok'
                token     = $config.token
                version   = $config.version
                downloads = (Get-ActiveStatuses).Count
            }
            Send-Json -Context $context -StatusCode 200 -Payload $payload
            continue
        }

        if ($path -like 'status/*') {
            if ($request.Headers['X-Auth-Token'] -ne $config.token) {
                Send-Json -Context $context -StatusCode 401 -Payload @{ status = 'error'; error = 'Unauthorized' }
                continue
            }

            $downloadId = $path.Substring(7)
            $state = Get-StatusObject -Id $downloadId
            if ($state) {
                Send-Json -Context $context -StatusCode 200 -Payload $state
            } else {
                Send-Json -Context $context -StatusCode 200 -Payload @{
                    id       = $downloadId
                    status   = 'failed'
                    progress = 0
                    speed    = ''
                    eta      = ''
                    error    = 'Download not found'
                    title    = 'Unknown download'
                }
            }
            continue
        }

        if ($path -eq 'download') {
            if ($request.HttpMethod -ne 'POST') {
                Send-Json -Context $context -StatusCode 405 -Payload @{ status = 'error'; error = 'Method not allowed' }
                continue
            }

            if ($request.Headers['X-Auth-Token'] -ne $config.token) {
                Send-Json -Context $context -StatusCode 401 -Payload @{ status = 'error'; error = 'Unauthorized' }
                continue
            }

            $body = Read-Body -Request $request
            $payload = $body | ConvertFrom-Json
            $url = [string]$payload.url
            $quality = if ($payload.quality) { [string]$payload.quality } else { 'best' }
            $audioOnly = [bool]$payload.audioOnly

            if (-not (Test-YouTubeUrl -Value $url)) {
                Send-Json -Context $context -StatusCode 400 -Payload @{ status = 'error'; error = 'Only YouTube URLs are supported.' }
                continue
            }

            $duplicate = Get-ActiveStatuses | Where-Object { $_.url -eq $url -and [bool]$_.audioOnly -eq $audioOnly } | Select-Object -First 1
            if ($duplicate) {
                Send-Json -Context $context -StatusCode 200 -Payload @{ id = $duplicate.id; status = $duplicate.status; message = 'Already downloading' }
                continue
            }

            $downloadId = [Guid]::NewGuid().ToString('N').Substring(0, 12)
            $statusPath = Join-Path $statusDir ($downloadId + '.json')
            $cookiePath = $null

            if ($payload.cookies) {
                $cookiePath = Join-Path $tempDir ('cookies-' + $downloadId + '.txt')
                Write-CookiesFile -Cookies $payload.cookies -Path $cookiePath
            }

            $initial = [ordered]@{
                id        = $downloadId
                title     = 'Preparing download...'
                progress  = 0
                speed     = ''
                eta       = ''
                status    = 'queued'
                error     = ''
                url       = $url
                quality   = $quality
                audioOnly = $audioOnly
                file      = ''
                updatedAt = [DateTime]::UtcNow.ToString('o')
            }
            $initial | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $statusPath -Encoding UTF8

            $psArgs = @(
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', $workerPath,
                '-DownloadId', $downloadId,
                '-Url', $url,
                '-Quality', $quality,
                '-ConfigPath', $configPath
            )

            if ($audioOnly) {
                $psArgs += '-AudioOnly'
            }

            if ($cookiePath) {
                $psArgs += @('-CookieFile', $cookiePath)
            }

            Start-Process -FilePath 'powershell.exe' -ArgumentList $psArgs -WindowStyle Hidden | Out-Null
            Send-Json -Context $context -StatusCode 200 -Payload @{ id = $downloadId; status = 'queued' }
            continue
        }

        Send-Json -Context $context -StatusCode 404 -Payload @{ status = 'error'; error = 'Not found' }
    } catch {
        Write-ServerLog ('Request error: ' + $_.Exception.Message)
        try {
            Send-Json -Context $context -StatusCode 500 -Payload @{ status = 'error'; error = $_.Exception.Message }
        } catch {}
    }
}
'@

    Set-Content -LiteralPath $WorkerScriptPath -Value $workerScript -Encoding UTF8
    Set-Content -LiteralPath $ServerScriptPath -Value $serverScript -Encoding UTF8

    $launcherVbs = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$ServerScriptPath""", 0, False
"@
    Set-Content -LiteralPath $LauncherVbsPath -Value $launcherVbs -Encoding ASCII
}

function Register-MediaDLProtocol {
    $protocolRoot = 'HKCU:\Software\Classes\mediadl'
    $commandPath = Join-Path $protocolRoot 'shell\open\command'
    New-Item -Path $protocolRoot -Force | Out-Null
    New-Item -Path (Join-Path $protocolRoot 'shell') -Force | Out-Null
    New-Item -Path (Join-Path $protocolRoot 'shell\open') -Force | Out-Null
    New-Item -Path $commandPath -Force | Out-Null

    Set-Item -LiteralPath $protocolRoot -Value 'URL:MediaDL Protocol'
    Set-ItemProperty -LiteralPath $protocolRoot -Name 'URL Protocol' -Value '' -Force

    $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $command = "`"$wscript`" `"$LauncherVbsPath`" ""%1"""
    Set-Item -LiteralPath $commandPath -Value $command
}

function Register-StartupShortcut {
    $startupDir = [Environment]::GetFolderPath('Startup')
    $shortcutPath = Join-Path $startupDir $StartupShortcutName
    $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $wscript
    $shortcut.Arguments = "`"$LauncherVbsPath`""
    $shortcut.WorkingDirectory = $InstallRoot
    $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,25"
    $shortcut.Save()
}

function Register-DesktopDownloadsShortcut {
    param(
        [Parameter(Mandatory)][string]$TargetPath
    )

    $desktopDir = [Environment]::GetFolderPath('Desktop')
    if (-not $desktopDir) {
        return
    }

    $shortcutPath = Join-Path $desktopDir $DesktopDownloadsShortcutName
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $TargetPath
    $shortcut.WorkingDirectory = $TargetPath
    $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,3"
    $shortcut.Save()
}

function Start-LocalServer {
    Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\wscript.exe') -ArgumentList "`"$LauncherVbsPath`"" -WindowStyle Hidden | Out-Null
}

function Wait-ForServer {
    param([int]$Retries = 12)

    for ($i = 0; $i -lt $Retries; $i++) {
        Start-Sleep -Milliseconds 750
        try {
            $health = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $ServerPort) -Method Get -Headers @{ 'X-MDL-Client' = 'Installer' }
            if ($health.token) {
                return $true
            }
        } catch {}
    }

    return $false
}

try {
    Show-InstallerWelcome

    Write-Step 'Preparing Astra Deck downloader files...'
    Ensure-Directory $InstallRoot
    Ensure-Directory $DownloadRoot
    Ensure-Directory $StatusDir
    Ensure-Directory $LogDir
    Ensure-Directory $TempDir

    $existingConfig = Get-ExistingConfig
    $token = if ($existingConfig -and $existingConfig.token) { [string]$existingConfig.token } else { [Guid]::NewGuid().ToString('N') }
    $downloadPath = if ($existingConfig -and $existingConfig.downloadPath) { [string]$existingConfig.downloadPath } else { $DownloadRoot }
    Ensure-Directory $downloadPath
    Write-Note ('Downloads will be saved in: ' + $downloadPath)

    Write-Step 'Cleaning up old downloader integration...'
    Write-Note 'Removing older shortcuts and restarting the local download service.'
    Remove-LegacyIntegration
    Stop-ExistingServer

    Ensure-YtDlp | Out-Null
    Ensure-Ffmpeg
    Ensure-Deno

    Write-Step 'Finishing Astra Deck setup...'
    Write-Note 'Creating the local server, startup shortcut, and download folder shortcut.'
    Write-Config -Token $token -DownloadPath $downloadPath
    Write-InstallerAssets
    Register-MediaDLProtocol
    Register-StartupShortcut
    Register-DesktopDownloadsShortcut -TargetPath $downloadPath

    Write-Step 'Starting the local download service...'
    Write-Note 'This lets Astra Deck send downloads straight to yt-dlp.'
    Start-LocalServer

    if (Wait-ForServer) {
        Write-Step 'Setup complete.'
        Write-SuccessSummary -DownloadPath $downloadPath
    } else {
        throw 'The setup finished, but the local download service did not respond yet.'
    }
} catch {
    Write-FriendlyFailure -Message $_.Exception.Message
    exit 1
}
