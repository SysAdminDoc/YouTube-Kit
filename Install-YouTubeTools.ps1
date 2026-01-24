<#
.SYNOPSIS
    YouTube Tools Installer - One-click setup for VLC streaming and video downloading
.DESCRIPTION
    Installs and configures:
    - yt-dlp (auto-download)
    - VLC protocol handler (ytvlc://)
    - Download protocol handler (ytdl://)
    - Userscript for YouTube integration
.NOTES
    Author: Maven Imaging
    Version: 1.0.1
#>

#Requires -Version 5.1

# ============================================
# CONFIGURATION
# ============================================
$script:AppName = "YouTube Tools"
$script:InstallPath = "$env:LOCALAPPDATA\YouTubeTools"
$script:YtDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
$script:DefaultDownloadPath = "$env:USERPROFILE\Videos\YouTube"

# ============================================
# PRE-FLIGHT: INSTALL VLC IF NEEDED
# ============================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  YouTube Tools Installer" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$vlcPaths = @(
    "${env:ProgramFiles}\VideoLAN\VLC\vlc.exe",
    "${env:ProgramFiles(x86)}\VideoLAN\VLC\vlc.exe",
    "$env:LOCALAPPDATA\Programs\VideoLAN\VLC\vlc.exe"
)

$vlcFound = $null
foreach ($path in $vlcPaths) {
    if (Test-Path $path) {
        $vlcFound = $path
        break
    }
}

if (-not $vlcFound) {
    Write-Host "  VLC Media Player not detected" -ForegroundColor Yellow
    Write-Host "  Installing via winget..." -ForegroundColor Yellow
    Write-Host ""
    
    $wingetPath = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetPath) {
        try {
            winget install --id VideoLAN.VLC --accept-package-agreements --accept-source-agreements -h
            Write-Host ""
            Write-Host "  VLC installed successfully!" -ForegroundColor Green
            
            # Re-check for VLC
            Start-Sleep -Seconds 2
            foreach ($path in $vlcPaths) {
                if (Test-Path $path) {
                    $vlcFound = $path
                    break
                }
            }
        } catch {
            Write-Host "  Error installing VLC: $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "  winget not available. Please install VLC manually:" -ForegroundColor Yellow
        Write-Host "  https://www.videolan.org/vlc/" -ForegroundColor Cyan
    }
} else {
    Write-Host "  VLC detected: $vlcFound" -ForegroundColor Green
}

Write-Host ""

# ============================================
# GUI SETUP
# ============================================
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName System.Windows.Forms

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="YouTube Tools Installer" Height="620" Width="550"
        WindowStartupLocation="CenterScreen" ResizeMode="NoResize"
        Background="#020617">
    <Window.Resources>
        <Style TargetType="Label">
            <Setter Property="Foreground" Value="#e2e8f0"/>
            <Setter Property="FontFamily" Value="Segoe UI"/>
        </Style>
        <Style TargetType="TextBox">
            <Setter Property="Background" Value="#0f172a"/>
            <Setter Property="Foreground" Value="#e2e8f0"/>
            <Setter Property="BorderBrush" Value="#334155"/>
            <Setter Property="Padding" Value="8,6"/>
            <Setter Property="FontFamily" Value="Segoe UI"/>
        </Style>
        <Style TargetType="Button">
            <Setter Property="Background" Value="#22c55e"/>
            <Setter Property="Foreground" Value="#020617"/>
            <Setter Property="BorderThickness" Value="0"/>
            <Setter Property="Padding" Value="16,10"/>
            <Setter Property="FontFamily" Value="Segoe UI"/>
            <Setter Property="FontWeight" Value="SemiBold"/>
            <Setter Property="Cursor" Value="Hand"/>
        </Style>
        <Style TargetType="CheckBox">
            <Setter Property="Foreground" Value="#e2e8f0"/>
            <Setter Property="FontFamily" Value="Segoe UI"/>
        </Style>
    </Window.Resources>
    <Grid Margin="24">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
            <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>

        <!-- Header -->
        <StackPanel Grid.Row="0" Margin="0,0,0,20">
            <TextBlock Text="YouTube Tools" FontSize="28" FontWeight="Bold" Foreground="#22c55e" FontFamily="Segoe UI"/>
            <TextBlock Text="Stream to VLC &amp; Download with yt-dlp" FontSize="14" Foreground="#94a3b8" FontFamily="Segoe UI"/>
        </StackPanel>

        <!-- VLC Path -->
        <StackPanel Grid.Row="1" Margin="0,0,0,16">
            <Label Content="VLC Path" Padding="0,0,0,4"/>
            <Grid>
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>
                <TextBox x:Name="txtVlcPath" Grid.Column="0"/>
                <Button x:Name="btnBrowseVlc" Content="Browse" Grid.Column="1" Margin="8,0,0,0" Background="#334155" Foreground="#e2e8f0"/>
            </Grid>
        </StackPanel>

        <!-- Download Path -->
        <StackPanel Grid.Row="2" Margin="0,0,0,16">
            <Label Content="Download Folder" Padding="0,0,0,4"/>
            <Grid>
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>
                <TextBox x:Name="txtDownloadPath" Grid.Column="0"/>
                <Button x:Name="btnBrowseDownload" Content="Browse" Grid.Column="1" Margin="8,0,0,0" Background="#334155" Foreground="#e2e8f0"/>
            </Grid>
        </StackPanel>

        <!-- Options -->
        <StackPanel Grid.Row="3" Margin="0,0,0,16">
            <Label Content="Options" Padding="0,0,0,8"/>
            <CheckBox x:Name="chkAutoUpdate" Content="Auto-update yt-dlp on each download" IsChecked="True" Margin="0,4"/>
            <CheckBox x:Name="chkNotifications" Content="Show toast notifications" IsChecked="True" Margin="0,4"/>
            <CheckBox x:Name="chkDesktopShortcut" Content="Create desktop shortcut for manual downloads" IsChecked="False" Margin="0,4"/>
        </StackPanel>

        <!-- Status -->
        <StackPanel Grid.Row="4" Margin="0,0,0,16">
            <Label Content="Status" Padding="0,0,0,4"/>
            <Border Background="#0f172a" BorderBrush="#334155" BorderThickness="1" CornerRadius="4" Padding="12">
                <ScrollViewer x:Name="statusScroll" Height="100" VerticalScrollBarVisibility="Auto">
                    <TextBlock x:Name="txtStatus" Text="Ready to install..." Foreground="#94a3b8" TextWrapping="Wrap" FontFamily="Consolas" FontSize="12"/>
                </ScrollViewer>
            </Border>
        </StackPanel>

        <!-- Progress -->
        <ProgressBar x:Name="progressBar" Grid.Row="5" Height="6" Background="#0f172a" Foreground="#22c55e" BorderThickness="0" Margin="0,0,0,16" Value="0" Maximum="100"/>

        <!-- Buttons -->
        <StackPanel Grid.Row="6" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,8,0,0">
            <Button x:Name="btnUninstall" Content="Uninstall" Background="#dc2626" Foreground="White" Margin="0,0,12,0"/>
            <Button x:Name="btnInstall" Content="Install YouTube Tools"/>
        </StackPanel>
    </Grid>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)

# Get controls
$txtVlcPath = $window.FindName("txtVlcPath")
$txtDownloadPath = $window.FindName("txtDownloadPath")
$btnBrowseVlc = $window.FindName("btnBrowseVlc")
$btnBrowseDownload = $window.FindName("btnBrowseDownload")
$chkAutoUpdate = $window.FindName("chkAutoUpdate")
$chkNotifications = $window.FindName("chkNotifications")
$chkDesktopShortcut = $window.FindName("chkDesktopShortcut")
$txtStatus = $window.FindName("txtStatus")
$statusScroll = $window.FindName("statusScroll")
$progressBar = $window.FindName("progressBar")
$btnInstall = $window.FindName("btnInstall")
$btnUninstall = $window.FindName("btnUninstall")

# Set defaults
if ($vlcFound) {
    $txtVlcPath.Text = $vlcFound
}
$txtDownloadPath.Text = $script:DefaultDownloadPath

# Helper to update status
function Update-Status {
    param([string]$Message)
    $txtStatus.Text = $txtStatus.Text + "`n" + $Message
    $statusScroll.ScrollToEnd()
    $window.Dispatcher.Invoke([action]{}, [System.Windows.Threading.DispatcherPriority]::Render)
}

function Set-Progress {
    param([int]$Value)
    $progressBar.Value = $Value
    $window.Dispatcher.Invoke([action]{}, [System.Windows.Threading.DispatcherPriority]::Render)
}

# Browse VLC
$btnBrowseVlc.Add_Click({
    $dialog = New-Object Microsoft.Win32.OpenFileDialog
    $dialog.Filter = "VLC|vlc.exe|All Files|*.*"
    $dialog.Title = "Select VLC executable"
    if ($dialog.ShowDialog()) {
        $txtVlcPath.Text = $dialog.FileName
    }
})

# Browse Download folder
$btnBrowseDownload.Add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Select download folder"
    $dialog.SelectedPath = $txtDownloadPath.Text
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $txtDownloadPath.Text = $dialog.SelectedPath
    }
})

# Install button
$btnInstall.Add_Click({
    $btnInstall.IsEnabled = $false
    $btnUninstall.IsEnabled = $false
    $txtStatus.Text = "Starting installation..."
    Set-Progress 0

    try {
        # Step 1: Create directories
        Update-Status "Creating directories..."
        Set-Progress 10
        
        if (!(Test-Path $script:InstallPath)) {
            New-Item -ItemType Directory -Path $script:InstallPath -Force | Out-Null
        }
        Update-Status "  Install path: $($script:InstallPath)"
        
        $dlPath = $txtDownloadPath.Text
        if (!(Test-Path $dlPath)) {
            New-Item -ItemType Directory -Path $dlPath -Force | Out-Null
        }
        Update-Status "  Download path: $dlPath"
        Set-Progress 15

        # Step 2: Download yt-dlp
        Update-Status "Downloading yt-dlp..."
        $ytdlpPath = Join-Path $script:InstallPath "yt-dlp.exe"
        Invoke-WebRequest -Uri $script:YtDlpUrl -OutFile $ytdlpPath -UseBasicParsing
        Update-Status "  Downloaded yt-dlp successfully"
        Set-Progress 25

        # Step 3: Download ffmpeg (required for merging video+audio)
        Update-Status "Downloading ffmpeg..."
        $ffmpegZipUrl = "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
        $ffmpegZip = Join-Path $script:InstallPath "ffmpeg.zip"
        $ffmpegPath = Join-Path $script:InstallPath "ffmpeg.exe"
        
        if (!(Test-Path $ffmpegPath)) {
            try {
                Invoke-WebRequest -Uri $ffmpegZipUrl -OutFile $ffmpegZip -UseBasicParsing
                Update-Status "  Extracting ffmpeg..."
                
                # Extract ffmpeg.exe from the zip
                Add-Type -AssemblyName System.IO.Compression.FileSystem
                $zip = [System.IO.Compression.ZipFile]::OpenRead($ffmpegZip)
                $ffmpegEntry = $zip.Entries | Where-Object { $_.Name -eq "ffmpeg.exe" } | Select-Object -First 1
                if ($ffmpegEntry) {
                    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($ffmpegEntry, $ffmpegPath, $true)
                }
                $zip.Dispose()
                Remove-Item $ffmpegZip -Force -ErrorAction SilentlyContinue
                Update-Status "  Downloaded ffmpeg successfully"
            } catch {
                Update-Status "  Warning: Could not download ffmpeg. Downloads may fail."
                Update-Status "  You can install ffmpeg manually via: winget install ffmpeg"
            }
        } else {
            Update-Status "  ffmpeg already exists"
        }
        Set-Progress 40

        # Step 4: Save config
        Update-Status "Saving configuration..."
        $config = @{
            VlcPath = $txtVlcPath.Text
            DownloadPath = $dlPath
            AutoUpdate = $chkAutoUpdate.IsChecked
            Notifications = $chkNotifications.IsChecked
            SponsorBlock = $true
            YtDlpPath = $ytdlpPath
            FfmpegPath = $ffmpegPath
        }
        $config | ConvertTo-Json | Set-Content (Join-Path $script:InstallPath "config.json") -Encoding UTF8
        Set-Progress 50

        # Step 5: Create VLC handler
        Update-Status "Creating VLC handler..."
        $vlcHandler = @'
param([string]$url)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Net.Http

$configPath = Join-Path $PSScriptRoot "config.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$videoUrl = $url -replace '^ytvlc://', ''
$videoUrl = [System.Uri]::UnescapeDataString($videoUrl)

# Extract video ID
$videoId = $null
if ($videoUrl -match '[?&]v=([^&]+)') { $videoId = $matches[1] }
elseif ($videoUrl -match 'youtu\.be/([^?]+)') { $videoId = $matches[1] }

# Check if this is a live stream by fetching page
# IMPORTANT: Only check for "isLiveNow":true which means CURRENTLY broadcasting
# Past livestreams (VODs) have "isLive":true but "isLiveNow":false
$isLive = $false
try {
    $webClient = New-Object System.Net.WebClient
    $webClient.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
    $pageContent = $webClient.DownloadString("https://www.youtube.com/watch?v=$videoId")
    
    # Only treat as live if isLiveNow is true (currently broadcasting)
    if ($pageContent -match '"isLiveNow"\s*:\s*true') {
        $isLive = $true
    }
    $webClient.Dispose()
} catch {
    # If we can't check, assume not live
}

# Get video title for notification
$videoTitle = "YouTube Video"
try {
    $titleOutput = & $config.YtDlpPath --get-title $videoUrl 2>$null
    if ($titleOutput) { $videoTitle = $titleOutput }
} catch { }

if ($isLive) {
    # For live streams, pass URL directly to VLC (VLC handles it natively)
    $vlcArgs = @(
        "--no-video-title-show",
        "--meta-title=`"$videoTitle (LIVE)`"",
        $videoUrl
    )
    Start-Process -FilePath $config.VlcPath -ArgumentList $vlcArgs
    
    if ($config.Notifications) {
        $notify = New-Object System.Windows.Forms.NotifyIcon
        $notify.Icon = [System.Drawing.SystemIcons]::Information
        $notify.BalloonTipTitle = "YouTube Tools - VLC"
        $notify.BalloonTipText = "Live Stream: $videoTitle"
        $notify.Visible = $true
        $notify.ShowBalloonTip(4000)
        Start-Sleep -Seconds 4
        $notify.Dispose()
    }
} else {
    # For regular videos, use yt-dlp to get direct stream URLs
    
    # Fetch SponsorBlock segments
    $sponsorSegments = @()
    if ($videoId -and $config.SponsorBlock) {
        try {
            $sbUrl = "https://sponsor.ajay.app/api/skipSegments?videoID=$videoId&categories=[%22sponsor%22,%22selfpromo%22,%22interaction%22,%22intro%22,%22outro%22]"
            $response = Invoke-RestMethod -Uri $sbUrl -TimeoutSec 5 -ErrorAction SilentlyContinue
            if ($response) {
                $sponsorSegments = $response | ForEach-Object { 
                    [PSCustomObject]@{
                        Start = [math]::Round($_.segment[0], 1)
                        End = [math]::Round($_.segment[1], 1)
                        Category = $_.category
                    }
                }
            }
        } catch { }
    }

    if ($config.AutoUpdate) {
        Start-Process -FilePath $config.YtDlpPath -ArgumentList "--update" -NoNewWindow -Wait -ErrorAction SilentlyContinue
    }

    # Get both video and audio stream URLs
    $streams = & $config.YtDlpPath -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]" -g $videoUrl 2>$null

    if ($streams) {
        $streamArray = $streams -split "`n" | Where-Object { $_ -match "^http" }
        
        # Build VLC arguments
        $vlcArgs = @("--no-video-title-show", "--meta-title=`"$videoTitle`"")
        
        if ($streamArray.Count -ge 2) {
            $vlcArgs += "`"$($streamArray[0])`""
            $vlcArgs += "--input-slave=`"$($streamArray[1])`""
        } else {
            $vlcArgs += "`"$($streamArray[0])`""
        }
        
        Start-Process -FilePath $config.VlcPath -ArgumentList $vlcArgs
        
        if ($config.Notifications) {
            $notify = New-Object System.Windows.Forms.NotifyIcon
            $notify.Icon = [System.Drawing.SystemIcons]::Information
            $notify.BalloonTipTitle = "YouTube Tools - VLC"
            
            if ($sponsorSegments.Count -gt 0) {
                $skipInfo = ($sponsorSegments | ForEach-Object { "$($_.Category): $($_.Start)s-$($_.End)s" }) -join ", "
                $notify.BalloonTipText = "Playing: $videoTitle`nSponsor segments found: $($sponsorSegments.Count)"
            } else {
                $notify.BalloonTipText = "Playing: $videoTitle"
            }
            
            $notify.Visible = $true
            $notify.ShowBalloonTip(4000)
            Start-Sleep -Seconds 4
            $notify.Dispose()
        }
    } else {
        [System.Windows.Forms.MessageBox]::Show("Failed to get stream URL. The video may be unavailable or restricted.", "YouTube Tools", "OK", "Error")
    }
}
'@
        $vlcHandler | Set-Content (Join-Path $script:InstallPath "ytvlc-handler.ps1") -Encoding UTF8
        Set-Progress 55

        # Step 5b: Create VLC Queue handler (adds to existing VLC playlist)
        Update-Status "Creating VLC queue handler..."
        $vlcQueueHandler = @'
param([string]$url)
Add-Type -AssemblyName System.Windows.Forms

$configPath = Join-Path $PSScriptRoot "config.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$videoUrl = $url -replace '^ytvlcq://', ''
$videoUrl = [System.Uri]::UnescapeDataString($videoUrl)

# Extract video ID
$videoId = $null
if ($videoUrl -match '[?&]v=([^&]+)') { $videoId = $matches[1] }
elseif ($videoUrl -match 'youtu\.be/([^?]+)') { $videoId = $matches[1] }

# Get video title
$videoTitle = "YouTube Video"
try {
    $titleOutput = & $config.YtDlpPath --get-title $videoUrl 2>$null
    if ($titleOutput) { $videoTitle = $titleOutput }
} catch { }

# Check if VLC is running
$vlcProcess = Get-Process -Name "vlc" -ErrorAction SilentlyContinue

if ($vlcProcess) {
    # VLC is running - use playlist-enqueue to add to existing instance
    # Get stream URL
    $streams = & $config.YtDlpPath -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]" -g $videoUrl 2>$null
    
    if ($streams) {
        $streamArray = $streams -split "`n" | Where-Object { $_ -match "^http" }
        
        $vlcArgs = @("--playlist-enqueue", "--no-video-title-show", "--meta-title=`"$videoTitle`"")
        
        if ($streamArray.Count -ge 2) {
            $vlcArgs += "`"$($streamArray[0])`""
            $vlcArgs += "--input-slave=`"$($streamArray[1])`""
        } else {
            $vlcArgs += "`"$($streamArray[0])`""
        }
        
        Start-Process -FilePath $config.VlcPath -ArgumentList $vlcArgs
        
        if ($config.Notifications) {
            $notify = New-Object System.Windows.Forms.NotifyIcon
            $notify.Icon = [System.Drawing.SystemIcons]::Information
            $notify.BalloonTipTitle = "YouTube Tools - VLC Queue"
            $notify.BalloonTipText = "Added to queue: $videoTitle"
            $notify.Visible = $true
            $notify.ShowBalloonTip(2000)
            Start-Sleep -Seconds 2
            $notify.Dispose()
        }
    }
} else {
    # VLC not running - start it with this video
    $streams = & $config.YtDlpPath -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]" -g $videoUrl 2>$null
    
    if ($streams) {
        $streamArray = $streams -split "`n" | Where-Object { $_ -match "^http" }
        
        $vlcArgs = @("--no-video-title-show", "--meta-title=`"$videoTitle`"")
        
        if ($streamArray.Count -ge 2) {
            $vlcArgs += "`"$($streamArray[0])`""
            $vlcArgs += "--input-slave=`"$($streamArray[1])`""
        } else {
            $vlcArgs += "`"$($streamArray[0])`""
        }
        
        Start-Process -FilePath $config.VlcPath -ArgumentList $vlcArgs
        
        if ($config.Notifications) {
            $notify = New-Object System.Windows.Forms.NotifyIcon
            $notify.Icon = [System.Drawing.SystemIcons]::Information
            $notify.BalloonTipTitle = "YouTube Tools - VLC"
            $notify.BalloonTipText = "Playing: $videoTitle"
            $notify.Visible = $true
            $notify.ShowBalloonTip(2000)
            Start-Sleep -Seconds 2
            $notify.Dispose()
        }
    } else {
        [System.Windows.Forms.MessageBox]::Show("Failed to get stream URL.", "YouTube Tools", "OK", "Error")
    }
}
'@
        $vlcQueueHandler | Set-Content (Join-Path $script:InstallPath "ytvlcq-handler.ps1") -Encoding UTF8
        Set-Progress 60

        # Step 6: Create Download handler
        Update-Status "Creating download handler..."
        $dlHandler = @'
param([string]$url)
Add-Type -AssemblyName System.Windows.Forms

$configPath = Join-Path $PSScriptRoot "config.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$videoUrl = $url -replace '^ytdl://', ''
$videoUrl = [System.Uri]::UnescapeDataString($videoUrl)

if ($config.AutoUpdate) {
    Start-Process -FilePath $config.YtDlpPath -ArgumentList "--update" -NoNewWindow -Wait -ErrorAction SilentlyContinue
}

if ($config.Notifications) {
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = [System.Drawing.SystemIcons]::Information
    $notify.BalloonTipTitle = "YouTube Tools"
    $notify.BalloonTipText = "Starting download..."
    $notify.Visible = $true
    $notify.ShowBalloonTip(2000)
}

$outputTemplate = Join-Path $config.DownloadPath "%(title)s.%(ext)s"
$ffmpegLocation = Split-Path $config.FfmpegPath -Parent

# Check for audio-only flag in URL
$audioOnly = $videoUrl -match "ytkit_audio_only=1"
$videoUrl = $videoUrl -replace "[&?]ytkit_audio_only=1", ""

if ($audioOnly) {
    # Audio-only download
    $outputTemplate = Join-Path $config.DownloadPath "%(title)s.mp3"
    $arguments = @(
        "-f", "bestaudio"
        "--extract-audio"
        "--audio-format", "mp3"
        "--audio-quality", "0"
        "--ffmpeg-location", "`"$ffmpegLocation`""
        "-o", "`"$outputTemplate`""
        $videoUrl
    )
    if ($config.Notifications) {
        $notify.BalloonTipText = "Downloading audio..."
    }
} else {
    # Video download
    $arguments = @(
        "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]"
        "--merge-output-format", "mp4"
        "--ffmpeg-location", "`"$ffmpegLocation`""
        "-o", "`"$outputTemplate`""
        $videoUrl
    )
}

$process = Start-Process -FilePath $config.YtDlpPath -ArgumentList $arguments -NoNewWindow -Wait -PassThru

if ($config.Notifications) {
    Start-Sleep -Seconds 1
    if ($process.ExitCode -eq 0) {
        $notify.BalloonTipText = "Download complete!"
        $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    } else {
        $notify.BalloonTipText = "Download may have failed"
        $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
    }
    $notify.ShowBalloonTip(3000)
    Start-Sleep -Seconds 3
    $notify.Dispose()
}
'@
        $dlHandler | Set-Content (Join-Path $script:InstallPath "ytdl-handler.ps1") -Encoding UTF8
        Set-Progress 65

        # Step 6b: Create MPV handler
        Update-Status "Creating MPV handler..."
        $mpvHandler = @'
param([string]$url)
Add-Type -AssemblyName System.Windows.Forms

$configPath = Join-Path $PSScriptRoot "config.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$videoUrl = $url -replace '^ytmpv://', ''
$videoUrl = [System.Uri]::UnescapeDataString($videoUrl)

# Try to find MPV in common locations
$mpvPaths = @(
    "C:\Program Files\mpv\mpv.exe",
    "C:\Program Files (x86)\mpv\mpv.exe",
    "$env:LOCALAPPDATA\Programs\mpv\mpv.exe",
    "$env:SCOOP\apps\mpv\current\mpv.exe",
    (Get-Command mpv -ErrorAction SilentlyContinue).Source
) | Where-Object { $_ -and (Test-Path $_) }

if ($mpvPaths.Count -eq 0) {
    [System.Windows.Forms.MessageBox]::Show("MPV not found. Please install MPV from https://mpv.io/installation/", "YouTube Tools", "OK", "Error")
    exit
}

$mpvPath = $mpvPaths[0]

if ($config.AutoUpdate) {
    Start-Process -FilePath $config.YtDlpPath -ArgumentList "--update" -NoNewWindow -Wait -ErrorAction SilentlyContinue
}

# MPV can play YouTube URLs directly with ytdl support, or we can get streams
$ytdlpPath = $config.YtDlpPath
Start-Process -FilePath $mpvPath -ArgumentList "--ytdl-raw-options=format=bestvideo[height<=1080]+bestaudio/best[height<=1080]", "`"$videoUrl`""

if ($config.Notifications) {
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = [System.Drawing.SystemIcons]::Information
    $notify.BalloonTipTitle = "YouTube Tools"
    $notify.BalloonTipText = "Streaming in MPV..."
    $notify.Visible = $true
    $notify.ShowBalloonTip(3000)
    Start-Sleep -Seconds 3
    $notify.Dispose()
}
'@
        $mpvHandler | Set-Content (Join-Path $script:InstallPath "ytmpv-handler.ps1") -Encoding UTF8

        # Step 6c: Create Download-then-Play handler
        Update-Status "Creating download & play handler..."
        $dlPlayHandler = @'
param([string]$url)
Add-Type -AssemblyName System.Windows.Forms

$configPath = Join-Path $PSScriptRoot "config.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$videoUrl = $url -replace '^ytdlplay://', ''
$videoUrl = [System.Uri]::UnescapeDataString($videoUrl)

if ($config.AutoUpdate) {
    Start-Process -FilePath $config.YtDlpPath -ArgumentList "--update" -NoNewWindow -Wait -ErrorAction SilentlyContinue
}

# Get video title for filename
$videoTitle = "video"
try {
    $titleOutput = & $config.YtDlpPath --get-title $videoUrl 2>$null
    if ($titleOutput) { 
        # Sanitize filename
        $videoTitle = $titleOutput -replace '[\\/:*?"<>|]', '_'
    }
} catch { }

$outputPath = Join-Path $config.DownloadPath "$videoTitle.mp4"
$ffmpegLocation = Split-Path $config.FfmpegPath -Parent

if ($config.Notifications) {
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = [System.Drawing.SystemIcons]::Information
    $notify.BalloonTipTitle = "YouTube Tools"
    $notify.BalloonTipText = "Downloading: $videoTitle..."
    $notify.Visible = $true
    $notify.ShowBalloonTip(2000)
}

# Download the video
$arguments = @(
    "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]"
    "--merge-output-format", "mp4"
    "--ffmpeg-location", "`"$ffmpegLocation`""
    "-o", "`"$outputPath`""
    $videoUrl
)

$process = Start-Process -FilePath $config.YtDlpPath -ArgumentList $arguments -NoNewWindow -Wait -PassThru

if ($process.ExitCode -eq 0 -and (Test-Path $outputPath)) {
    # Open in VLC
    Start-Process -FilePath $config.VlcPath -ArgumentList "`"$outputPath`""
    
    if ($config.Notifications) {
        $notify.BalloonTipText = "Playing: $videoTitle"
        $notify.ShowBalloonTip(3000)
        Start-Sleep -Seconds 3
        $notify.Dispose()
    }
} else {
    if ($config.Notifications) {
        $notify.BalloonTipText = "Download failed"
        $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Error
        $notify.ShowBalloonTip(3000)
        Start-Sleep -Seconds 3
        $notify.Dispose()
    }
}
'@
        $dlPlayHandler | Set-Content (Join-Path $script:InstallPath "ytdlplay-handler.ps1") -Encoding UTF8

        # Step 6d: Create Local Embed Server
        Update-Status "Creating embed server..."
        $embedServer = @'
# YouTube Tools - Local Embed Server
# Provides stream URLs to the browser for in-page playback

param(
    [int]$Port = 9547
)

$configPath = Join-Path $PSScriptRoot "config.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json

# Create HTTP listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

Write-Host "YouTube Tools Embed Server running on http://localhost:$Port"
Write-Host "Press Ctrl+C to stop"

# Cache for stream URLs (video ID -> URLs + timestamp)
$cache = @{}
$cacheTimeout = 3600 # 1 hour in seconds

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        # CORS headers
        $response.Headers.Add("Access-Control-Allow-Origin", "https://www.youtube.com")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
        
        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }
        
        $path = $request.Url.LocalPath
        $query = [System.Web.HttpUtility]::ParseQueryString($request.Url.Query)
        
        $result = @{ success = $false; error = "Unknown endpoint" }
        
        switch ($path) {
            "/stream" {
                $videoUrl = $query["url"]
                $videoId = $query["id"]
                
                if (-not $videoUrl -and -not $videoId) {
                    $result = @{ success = $false; error = "Missing url or id parameter" }
                } else {
                    if ($videoId -and -not $videoUrl) {
                        $videoUrl = "https://www.youtube.com/watch?v=$videoId"
                    }
                    
                    # Check cache
                    $cacheKey = $videoId
                    if (-not $cacheKey) {
                        if ($videoUrl -match '[?&]v=([^&]+)') { $cacheKey = $matches[1] }
                    }
                    
                    $cached = $cache[$cacheKey]
                    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                    
                    if ($cached -and ($now - $cached.timestamp) -lt $cacheTimeout) {
                        $result = $cached.data
                    } else {
                        # Get stream URL using yt-dlp
                        # IMPORTANT: Request a PROGRESSIVE format (combined video+audio)
                        # Browsers cannot play separate DASH streams
                        # Format priority: 720p mp4 > 1080p mp4 > best progressive > any best
                        $formatString = "best[height<=1080][ext=mp4]/best[ext=mp4]/best[height<=1080]/best"
                        
                        $streamUrl = & $config.YtDlpPath -f $formatString -g --no-playlist $videoUrl 2>$null
                        $title = & $config.YtDlpPath --get-title --no-playlist $videoUrl 2>$null
                        $duration = & $config.YtDlpPath --get-duration --no-playlist $videoUrl 2>$null
                        
                        # Get format info to check if it's combined
                        $formatInfo = & $config.YtDlpPath -f $formatString --print "%(format_id)s %(ext)s %(acodec)s %(vcodec)s" --no-playlist $videoUrl 2>$null
                        
                        if ($streamUrl) {
                            # Take only the first URL (in case multiple are returned)
                            $streamUrl = ($streamUrl -split "`n" | Where-Object { $_ -match "^http" } | Select-Object -First 1)
                            
                            $result = @{
                                success = $true
                                videoId = $cacheKey
                                title = $title
                                duration = $duration
                                videoUrl = $streamUrl
                                audioUrl = $null  # Combined stream, no separate audio needed
                                formatInfo = $formatInfo
                            }
                            
                            # Cache result
                            $cache[$cacheKey] = @{ timestamp = $now; data = $result }
                        } else {
                            $result = @{ success = $false; error = "Failed to get stream URL. Video may be restricted." }
                        }
                    }
                }
            }
            "/sponsorblock" {
                $videoId = $query["id"]
                if (-not $videoId) {
                    $result = @{ success = $false; error = "Missing id parameter" }
                } else {
                    try {
                        $sbUrl = "https://sponsor.ajay.app/api/skipSegments?videoID=$videoId&categories=[%22sponsor%22,%22selfpromo%22,%22interaction%22,%22intro%22,%22outro%22]"
                        $segments = Invoke-RestMethod -Uri $sbUrl -TimeoutSec 5
                        $result = @{
                            success = $true
                            segments = $segments | ForEach-Object {
                                @{
                                    start = $_.segment[0]
                                    end = $_.segment[1]
                                    category = $_.category
                                }
                            }
                        }
                    } catch {
                        $result = @{ success = $true; segments = @() }
                    }
                }
            }
            "/status" {
                $result = @{ 
                    success = $true
                    version = "1.0"
                    ytdlp = (Test-Path $config.YtDlpPath)
                    cacheSize = $cache.Count
                }
            }
            default {
                $result = @{ success = $false; error = "Unknown endpoint: $path" }
            }
        }
        
        $json = $result | ConvertTo-Json -Depth 10
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
        $response.ContentType = "application/json"
        $response.ContentLength64 = $buffer.Length
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
        $response.Close()
        
    } catch {
        Write-Host "Error: $_"
    }
}

$listener.Stop()
'@
        $embedServer | Set-Content (Join-Path $script:InstallPath "embed-server.ps1") -Encoding UTF8

        # Create server launcher VBS
        $serverVbs = @'
Set objShell = CreateObject("WScript.Shell")
objShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & Replace(WScript.ScriptFullName, "embed-server-launcher.vbs", "embed-server.ps1") & """", 0, False
'@
        $serverVbs | Set-Content (Join-Path $script:InstallPath "embed-server-launcher.vbs") -Encoding ASCII

        # Create startup shortcut for embed server
        $startupPath = [Environment]::GetFolderPath('Startup')
        $shortcutPath = Join-Path $startupPath "YouTubeToolsServer.lnk"
        $WScriptShell = New-Object -ComObject WScript.Shell
        $shortcut = $WScriptShell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = "wscript.exe"
        $shortcut.Arguments = "`"$(Join-Path $script:InstallPath 'embed-server-launcher.vbs')`""
        $shortcut.WorkingDirectory = $script:InstallPath
        $shortcut.Description = "YouTube Tools Embed Server"
        $shortcut.Save()
        Update-Status "  Created startup shortcut for embed server"

        Set-Progress 75

        # Step 7: Create VBS launchers (completely hidden PowerShell)
        Update-Status "Creating silent launchers..."
        
        $vbsTemplate = @'
Set objShell = CreateObject("WScript.Shell")
objShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{SCRIPT}"" """ & WScript.Arguments(0) & """", 0, False
'@
        
        # Create VBS launcher for each handler
        @("ytvlc", "ytvlcq", "ytdl", "ytmpv", "ytdlplay") | ForEach-Object {
            $vbs = $vbsTemplate -replace '{SCRIPT}', (Join-Path $script:InstallPath "$_-handler.ps1")
            $vbs | Set-Content (Join-Path $script:InstallPath "$_-launcher.vbs") -Encoding ASCII
        }

        # Step 8: Register protocols
        Update-Status "Registering protocol handlers..."
        
        # ytvlc:// protocol
        $regPath = "HKCU:\Software\Classes\ytvlc"
        New-Item -Path $regPath -Force | Out-Null
        Set-ItemProperty -Path $regPath -Name "(Default)" -Value "URL:YouTube VLC Stream"
        Set-ItemProperty -Path $regPath -Name "URL Protocol" -Value ""
        New-Item -Path "$regPath\shell\open\command" -Force | Out-Null
        $handlerCmd = "wscript.exe `"$(Join-Path $script:InstallPath 'ytvlc-launcher.vbs')`" `"%1`""
        Set-ItemProperty -Path "$regPath\shell\open\command" -Name "(Default)" -Value $handlerCmd
        Update-Status "  Registered ytvlc:// protocol"

        # ytvlcq:// protocol (Add to VLC queue)
        $regPath = "HKCU:\Software\Classes\ytvlcq"
        New-Item -Path $regPath -Force | Out-Null
        Set-ItemProperty -Path $regPath -Name "(Default)" -Value "URL:YouTube VLC Queue"
        Set-ItemProperty -Path $regPath -Name "URL Protocol" -Value ""
        New-Item -Path "$regPath\shell\open\command" -Force | Out-Null
        $handlerCmd = "wscript.exe `"$(Join-Path $script:InstallPath 'ytvlcq-launcher.vbs')`" `"%1`""
        Set-ItemProperty -Path "$regPath\shell\open\command" -Name "(Default)" -Value $handlerCmd
        Update-Status "  Registered ytvlcq:// protocol"

        # ytdl:// protocol
        $regPath = "HKCU:\Software\Classes\ytdl"
        New-Item -Path $regPath -Force | Out-Null
        Set-ItemProperty -Path $regPath -Name "(Default)" -Value "URL:YouTube Download"
        Set-ItemProperty -Path $regPath -Name "URL Protocol" -Value ""
        New-Item -Path "$regPath\shell\open\command" -Force | Out-Null
        $handlerCmd = "wscript.exe `"$(Join-Path $script:InstallPath 'ytdl-launcher.vbs')`" `"%1`""
        Set-ItemProperty -Path "$regPath\shell\open\command" -Name "(Default)" -Value $handlerCmd
        Update-Status "  Registered ytdl:// protocol"

        # ytmpv:// protocol (MPV player)
        $regPath = "HKCU:\Software\Classes\ytmpv"
        New-Item -Path $regPath -Force | Out-Null
        Set-ItemProperty -Path $regPath -Name "(Default)" -Value "URL:YouTube MPV Stream"
        Set-ItemProperty -Path $regPath -Name "URL Protocol" -Value ""
        New-Item -Path "$regPath\shell\open\command" -Force | Out-Null
        $handlerCmd = "wscript.exe `"$(Join-Path $script:InstallPath 'ytmpv-launcher.vbs')`" `"%1`""
        Set-ItemProperty -Path "$regPath\shell\open\command" -Name "(Default)" -Value $handlerCmd
        Update-Status "  Registered ytmpv:// protocol"

        # ytdlplay:// protocol (Download then play in VLC)
        $regPath = "HKCU:\Software\Classes\ytdlplay"
        New-Item -Path $regPath -Force | Out-Null
        Set-ItemProperty -Path $regPath -Name "(Default)" -Value "URL:YouTube Download & Play"
        Set-ItemProperty -Path $regPath -Name "URL Protocol" -Value ""
        New-Item -Path "$regPath\shell\open\command" -Force | Out-Null
        $handlerCmd = "wscript.exe `"$(Join-Path $script:InstallPath 'ytdlplay-launcher.vbs')`" `"%1`""
        Set-ItemProperty -Path "$regPath\shell\open\command" -Name "(Default)" -Value $handlerCmd
        Update-Status "  Registered ytdlplay:// protocol"
        Set-Progress 85

        # Step 8: Create userscript
        Update-Status "Creating userscript..."
        $userscript = @'
// ==UserScript==
// @name         YouTube Tools - VLC & Download
// @namespace    https://github.com/maven-imaging/youtube-tools
// @version      1.3.0
// @description  Stream YouTube to VLC or download with yt-dlp - buttons in action bar
// @author       YouTube Tools
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    GM_addStyle(`
        .yt-tools-vlc-btn {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            padding: 0 16px !important;
            height: 36px !important;
            margin-left: 8px !important;
            border-radius: 18px !important;
            border: none !important;
            background: #f97316 !important;
            color: white !important;
            font-family: "Roboto", "Arial", sans-serif !important;
            font-size: 14px !important;
            font-weight: 500 !important;
            cursor: pointer !important;
        }
        .yt-tools-vlc-btn:hover { background: #ea580c !important; }
        .yt-tools-vlc-btn svg { width: 20px !important; height: 20px !important; fill: white !important; }
        .yt-tools-dl-btn {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            padding: 0 16px !important;
            height: 36px !important;
            margin-left: 8px !important;
            border-radius: 18px !important;
            border: none !important;
            background: #22c55e !important;
            color: white !important;
            font-family: "Roboto", "Arial", sans-serif !important;
            font-size: 14px !important;
            font-weight: 500 !important;
            cursor: pointer !important;
        }
        .yt-tools-dl-btn:hover { background: #16a34a !important; }
        .yt-tools-dl-btn svg { width: 20px !important; height: 20px !important; fill: white !important; }
    `);

    function createSvg(pathD) {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathD);
        path.setAttribute('fill', 'white');
        svg.appendChild(path);
        return svg;
    }

    function getCurrentVideoUrl() {
        var urlParams = new URLSearchParams(window.location.search);
        var videoId = urlParams.get('v');
        if (videoId) return 'https://www.youtube.com/watch?v=' + videoId;
        var shortsMatch = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
        if (shortsMatch) return 'https://www.youtube.com/watch?v=' + shortsMatch[1];
        return null;
    }

    function openInVLC() {
        var url = getCurrentVideoUrl();
        if (url) window.location.href = 'ytvlc://' + encodeURIComponent(url);
    }

    function downloadVideo() {
        var url = getCurrentVideoUrl();
        if (url) window.location.href = 'ytdl://' + encodeURIComponent(url);
    }

    function createButtons() {
        document.querySelectorAll('.yt-tools-vlc-btn, .yt-tools-dl-btn').forEach(function(el) { el.remove(); });
        if (!getCurrentVideoUrl()) return;

        var actionBar = document.querySelector('#top-level-buttons-computed');
        if (!actionBar) return;

        var vlcBtn = document.createElement('button');
        vlcBtn.className = 'yt-tools-vlc-btn';
        vlcBtn.title = 'Stream in VLC Player';
        vlcBtn.appendChild(createSvg('M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z'));
        vlcBtn.appendChild(document.createTextNode(' VLC'));
        vlcBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); openInVLC(); });

        var dlBtn = document.createElement('button');
        dlBtn.className = 'yt-tools-dl-btn';
        dlBtn.title = 'Download with yt-dlp';
        dlBtn.appendChild(createSvg('M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z'));
        dlBtn.appendChild(document.createTextNode(' DL'));
        dlBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); downloadVideo(); });

        actionBar.appendChild(vlcBtn);
        actionBar.appendChild(dlBtn);
    }

    function tryCreate(n) {
        if (n <= 0) return;
        createButtons();
        if (!document.querySelector('.yt-tools-vlc-btn') && getCurrentVideoUrl()) {
            setTimeout(function() { tryCreate(n - 1); }, 1000);
        }
    }

    setTimeout(function() { tryCreate(5); }, 2000);

    var lastUrl = location.href;
    new MutationObserver(function() {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(function() { tryCreate(5); }, 1500);
        }
    }).observe(document.body, { subtree: true, childList: true });

    window.addEventListener('yt-navigate-finish', function() { setTimeout(function() { tryCreate(5); }, 1000); });
})();
'@
        $userscript | Set-Content (Join-Path $script:InstallPath "YouTubeTools.user.js") -Encoding UTF8
        Update-Status "  Created YouTubeTools.user.js"
        Set-Progress 90

        # Step 9: Desktop shortcut (optional)
        if ($chkDesktopShortcut.IsChecked) {
            Update-Status "Creating desktop shortcut..."
            $WshShell = New-Object -ComObject WScript.Shell
            $shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\YouTube Download.lnk")
            $shortcut.TargetPath = "powershell.exe"
            $shortcut.Arguments = "-ExecutionPolicy Bypass -WindowStyle Hidden -Command `"Add-Type -AssemblyName System.Windows.Forms; `$url = [System.Windows.Forms.Clipboard]::GetText(); if (`$url -match 'youtube|youtu.be') { Start-Process 'ytdl://' + `$url }`""
            $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,175"
            $shortcut.Save()
            Update-Status "  Created desktop shortcut"
        }

        Set-Progress 100
        Update-Status ""
        Update-Status "========================================" 
        Update-Status "Installation complete!"
        Update-Status "========================================" 
        Update-Status ""
        Update-Status "Next step: Install the userscript"
        Update-Status "Location: $($script:InstallPath)\YouTubeTools.user.js"

        $result = [System.Windows.MessageBox]::Show(
            "Installation complete!`n`nWould you like to open the folder containing the userscript?`n`nYou'll need to drag YouTubeTools.user.js into Tampermonkey to install it.",
            "YouTube Tools",
            "YesNo",
            "Information"
        )
        if ($result -eq "Yes") {
            Start-Process explorer.exe -ArgumentList "/select,`"$(Join-Path $script:InstallPath 'YouTubeTools.user.js')`""
        }

    } catch {
        Update-Status ""
        Update-Status "ERROR: $($_.Exception.Message)"
        [System.Windows.MessageBox]::Show("Installation failed:`n`n$($_.Exception.Message)", "Error", "OK", "Error")
    }

    $btnInstall.IsEnabled = $true
    $btnUninstall.IsEnabled = $true
})

# Uninstall button
$btnUninstall.Add_Click({
    $result = [System.Windows.MessageBox]::Show(
        "This will remove YouTube Tools and unregister the protocol handlers.`n`nContinue?",
        "Uninstall YouTube Tools",
        "YesNo",
        "Warning"
    )

    if ($result -eq "Yes") {
        $txtStatus.Text = "Uninstalling..."
        Set-Progress 0

        try {
            # Remove protocol handlers
            Remove-Item -Path "HKCU:\Software\Classes\ytvlc" -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -Path "HKCU:\Software\Classes\ytvlcq" -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -Path "HKCU:\Software\Classes\ytdl" -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -Path "HKCU:\Software\Classes\ytmpv" -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -Path "HKCU:\Software\Classes\ytdlplay" -Recurse -Force -ErrorAction SilentlyContinue
            Update-Status "Removed protocol handlers"
            Set-Progress 33

            # Remove install directory
            if (Test-Path $script:InstallPath) {
                Remove-Item -Path $script:InstallPath -Recurse -Force
                Update-Status "Removed install directory"
            }
            Set-Progress 66

            # Remove desktop shortcut
            $shortcutPath = "$env:USERPROFILE\Desktop\YouTube Download.lnk"
            if (Test-Path $shortcutPath) {
                Remove-Item $shortcutPath -Force
                Update-Status "Removed desktop shortcut"
            }
            Set-Progress 100

            Update-Status ""
            Update-Status "Uninstallation complete!"
            [System.Windows.MessageBox]::Show("YouTube Tools has been uninstalled.`n`nRemember to also remove the userscript from Tampermonkey.", "Uninstall Complete", "OK", "Information")
        } catch {
            Update-Status "ERROR: $($_.Exception.Message)"
        }
    }
})

# Show the window
$window.ShowDialog() | Out-Null
