<#
.SYNOPSIS
    Astra Downloader Installer — professional setup wizard
#>

#Requires -Version 5.1

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

# Hide console
Add-Type -Name Window -Namespace Console -MemberDefinition '
[DllImport("Kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, Int32 nCmdShow);
'
[Console.Window]::ShowWindow([Console.Window]::GetConsoleWindow(), 0) | Out-Null

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.IO.Compression.FileSystem

$installPath = "$env:LOCALAPPDATA\AstraDownloader"
$ytDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
$ffmpegUrl = "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
$serverExeUrl = "https://raw.githubusercontent.com/SysAdminDoc/Astra-Deck/main/AstraDownloader.exe"
$serverIcoUrl = "https://raw.githubusercontent.com/SysAdminDoc/Astra-Deck/main/AstraDownloader.ico"
$uninstallExeUrl = "https://raw.githubusercontent.com/SysAdminDoc/Astra-Deck/main/Uninstall-AstraDownloader.exe"
$defaultDlPath = "$env:USERPROFILE\Videos\YouTube"

# ══════════════════════════════════════════════════════════════
# WPF INSTALLER GUI
# ══════════════════════════════════════════════════════════════

$xamlString = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        Title="Astra Downloader Setup" Width="520" Height="400"
        WindowStartupLocation="CenterScreen" Background="#0a0e14"
        ResizeMode="NoResize" WindowStyle="None" AllowsTransparency="True">
    <Border CornerRadius="12" Background="#0a0e14" BorderBrush="#2a3140" BorderThickness="1">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="*"/>
                <RowDefinition Height="Auto"/>
            </Grid.RowDefinitions>

            <!-- Title bar (draggable) -->
            <Border Grid.Row="0" Background="#0d1117" CornerRadius="12,12,0,0" Padding="20,14">
                <Grid>
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="*"/>
                        <ColumnDefinition Width="Auto"/>
                    </Grid.ColumnDefinitions>
                    <StackPanel>
                        <TextBlock Text="Astra Downloader" FontSize="16" FontWeight="Bold" Foreground="#e6edf3"/>
                        <TextBlock Text="Setup Wizard" FontSize="11" Foreground="#525a65" Margin="0,2,0,0"/>
                    </StackPanel>
                    <Button x:Name="btnClose" Grid.Column="1" Content="X" FontSize="14" FontWeight="Bold"
                            Foreground="#525a65" Background="Transparent" BorderThickness="0" Cursor="Hand"
                            Width="30" Height="30" VerticalAlignment="Top"/>
                </Grid>
            </Border>

            <!-- Content -->
            <Grid Grid.Row="1" Margin="28,20,28,8">
                <Grid.RowDefinitions>
                    <RowDefinition Height="Auto"/>
                    <RowDefinition Height="Auto"/>
                    <RowDefinition Height="*"/>
                    <RowDefinition Height="Auto"/>
                </Grid.RowDefinitions>

                <!-- Status text -->
                <TextBlock x:Name="statusTitle" Grid.Row="0" Text="Ready to install" FontSize="18" FontWeight="SemiBold" Foreground="#e6edf3" Margin="0,0,0,6"/>
                <TextBlock x:Name="statusDetail" Grid.Row="1" Text="Click Install to set up yt-dlp, ffmpeg, and the download server." FontSize="12" Foreground="#8b949e" TextWrapping="Wrap" Margin="0,0,0,16"/>

                <!-- Progress area -->
                <Border Grid.Row="2" Background="#0d1117" CornerRadius="10" Padding="16">
                    <Grid>
                        <Grid.RowDefinitions>
                            <RowDefinition Height="Auto"/>
                            <RowDefinition Height="*"/>
                        </Grid.RowDefinitions>
                        <!-- Progress bar -->
                        <Grid Grid.Row="0" Margin="0,0,0,12">
                            <Border Background="#1a2028" CornerRadius="4" Height="8"/>
                            <Border x:Name="progressFill" Background="#22c55e" CornerRadius="4" Height="8" HorizontalAlignment="Left" Width="0"/>
                        </Grid>
                        <!-- Log -->
                        <ScrollViewer x:Name="logScroll" Grid.Row="1" VerticalScrollBarVisibility="Auto">
                            <TextBlock x:Name="logText" Text="" Foreground="#525a65" FontFamily="Cascadia Code, Consolas" FontSize="11" TextWrapping="Wrap"/>
                        </ScrollViewer>
                    </Grid>
                </Border>

                <!-- Install path -->
                <StackPanel Grid.Row="3" Margin="0,12,0,0">
                    <TextBlock Text="Install location:" FontSize="10" Foreground="#525a65" Margin="0,0,0,4"/>
                    <TextBlock x:Name="pathText" FontSize="10" Foreground="#3b82f6" TextTrimming="CharacterEllipsis"/>
                </StackPanel>
            </Grid>

            <!-- Footer -->
            <Border Grid.Row="2" Padding="28,12,28,18">
                <Grid>
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="*"/>
                        <ColumnDefinition Width="Auto"/>
                    </Grid.ColumnDefinitions>
                    <Button x:Name="btnCancel" Content="Cancel" Grid.Column="0" HorizontalAlignment="Left"
                            Foreground="#8b949e" Background="#1a2028" BorderBrush="#2a3140" BorderThickness="1"
                            Padding="20,9" FontSize="12" FontWeight="SemiBold" Cursor="Hand"/>
                    <Button x:Name="btnInstall" Content="Install" Grid.Column="1"
                            Foreground="#0a0a0a" Background="#22c55e" BorderThickness="0"
                            Padding="28,9" FontSize="13" FontWeight="Bold" Cursor="Hand"/>
                </Grid>
            </Border>
        </Grid>
    </Border>
</Window>
"@

$xaml = [xml]$xamlString
$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)

$statusTitle = $window.FindName("statusTitle")
$statusDetail = $window.FindName("statusDetail")
$progressFill = $window.FindName("progressFill")
$logText = $window.FindName("logText")
$logScroll = $window.FindName("logScroll")
$pathText = $window.FindName("pathText")
$btnInstall = $window.FindName("btnInstall")
$btnCancel = $window.FindName("btnCancel")
$btnClose = $window.FindName("btnClose")

$pathText.Text = $installPath

# Draggable title bar
$window.FindName("btnClose").Add_Click({ $window.Close() })
$window.Add_MouseLeftButtonDown({ $window.DragMove() })

$btnCancel.Add_Click({ $window.Close() })

function Log { param([string]$msg)
    $logText.Text += "$msg`n"
    $logScroll.ScrollToEnd()
    $window.Dispatcher.Invoke([action]{}, [System.Windows.Threading.DispatcherPriority]::Render)
}

function Set-Progress { param([int]$pct)
    $maxW = $progressFill.Parent.ActualWidth
    if ($maxW -le 0) { $maxW = 440 }
    $progressFill.Width = ($pct / 100) * $maxW
    $window.Dispatcher.Invoke([action]{}, [System.Windows.Threading.DispatcherPriority]::Render)
}

function Download-WithUI { param([string]$Uri, [string]$OutFile)
    $job = Start-Job -ScriptBlock {
        param($u, $o); Invoke-WebRequest -Uri $u -OutFile $o -UseBasicParsing
    } -ArgumentList $Uri, $OutFile
    while ($job.State -eq 'Running') {
        $window.Dispatcher.Invoke([action]{}, [System.Windows.Threading.DispatcherPriority]::Background)
        Start-Sleep -Milliseconds 100
    }
    Receive-Job $job -ErrorAction Stop
    Remove-Job $job
}

$btnInstall.Add_Click({
    $btnInstall.IsEnabled = $false
    $btnInstall.Content = "Installing..."
    $btnCancel.IsEnabled = $false
    $statusTitle.Text = "Installing..."
    $statusDetail.Text = "This may take a minute. Downloading dependencies."

    try {
        # Create directories
        Log "Creating directories..."
        if (!(Test-Path $installPath)) { New-Item -ItemType Directory -Path $installPath -Force | Out-Null }
        if (!(Test-Path $defaultDlPath)) { New-Item -ItemType Directory -Path $defaultDlPath -Force | Out-Null }
        Log "  $installPath"
        Set-Progress 5

        # Download yt-dlp
        $ytdlpPath = Join-Path $installPath "yt-dlp.exe"
        if (!(Test-Path $ytdlpPath)) {
            Log "Downloading yt-dlp..."
            Download-WithUI -Uri $ytDlpUrl -OutFile $ytdlpPath
            Log "  Done"
        } else { Log "yt-dlp already installed" }
        Set-Progress 25

        # Download ffmpeg
        $ffmpegPath = Join-Path $installPath "ffmpeg.exe"
        if (!(Test-Path $ffmpegPath)) {
            Log "Downloading ffmpeg..."
            $ffmpegZip = Join-Path $installPath "ffmpeg.zip"
            Download-WithUI -Uri $ffmpegUrl -OutFile $ffmpegZip
            Log "  Extracting..."
            $zip = [System.IO.Compression.ZipFile]::OpenRead($ffmpegZip)
            $entry = $zip.Entries | Where-Object { $_.Name -eq "ffmpeg.exe" } | Select-Object -First 1
            if ($entry) { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $ffmpegPath, $true) }
            $zip.Dispose()
            Remove-Item $ffmpegZip -Force -ErrorAction SilentlyContinue
            Log "  Done"
        } else { Log "ffmpeg already installed" }
        Set-Progress 50

        # Download server exe + ico + uninstaller
        Log "Downloading Astra Downloader..."
        $exePath = Join-Path $installPath "AstraDownloader.exe"
        Download-WithUI -Uri $serverExeUrl -OutFile $exePath
        $icoPath = Join-Path $installPath "AstraDownloader.ico"
        Download-WithUI -Uri $serverIcoUrl -OutFile $icoPath
        Log "Downloading uninstaller..."
        $uninstPath = Join-Path $installPath "Uninstall-AstraDownloader.exe"
        Download-WithUI -Uri $uninstallExeUrl -OutFile $uninstPath
        Log "  Done"
        Set-Progress 65

        # Create config
        Log "Creating configuration..."
        $configPath = Join-Path $installPath "config.json"
        if (!(Test-Path $configPath)) {
            @{
                DownloadPath = $defaultDlPath
                AudioDownloadPath = ""
                YtDlpPath = $ytdlpPath
                FfmpegPath = $ffmpegPath
                ServerPort = 9751
                ServerToken = [guid]::NewGuid().ToString('N')
                EmbedMetadata = $true; EmbedThumbnail = $true; EmbedChapters = $true
                EmbedSubs = $false; SubLangs = "en"
                SponsorBlock = $false; SponsorBlockAction = "remove"
                ConcurrentFragments = 4; DownloadArchive = $true; AutoUpdateYtDlp = $true
                RateLimit = ""; Proxy = ""
                StartMinimized = $false; CloseToTray = $true
            } | ConvertTo-Json -Depth 3 | Set-Content $configPath -Encoding UTF8
        }
        Set-Progress 70

        # Desktop shortcut
        Log "Creating desktop shortcut..."
        $WshShell = New-Object -ComObject WScript.Shell
        $shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\Astra Downloader.lnk")
        $shortcut.TargetPath = $exePath
        $shortcut.WorkingDirectory = $installPath
        $shortcut.IconLocation = $icoPath
        $shortcut.Description = "Astra Deck Download Server"
        $shortcut.Save()
        Set-Progress 75

        # Startup task
        Log "Registering startup task..."
        try { Unregister-ScheduledTask -TaskName "AstraDownloader" -Confirm:$false -ErrorAction SilentlyContinue } catch {}
        try { Unregister-ScheduledTask -TaskName "MediaDL-Server" -Confirm:$false -ErrorAction SilentlyContinue } catch {}
        $action = New-ScheduledTaskAction -Execute $exePath -Argument "-Background" -WorkingDirectory $installPath
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Days 365)
        Register-ScheduledTask -TaskName "AstraDownloader" -Action $action -Trigger $trigger -Settings $settings -Description "Astra Deck download server" -Force | Out-Null
        Set-Progress 80

        # Protocol handlers
        Log "Registering protocol handlers..."
        foreach ($proto in @('ytdl', 'mediadl')) {
            $regPath = "HKCU:\Software\Classes\$proto"
            New-Item -Path "$regPath\shell\open\command" -Force | Out-Null
            Set-ItemProperty -Path $regPath -Name "(Default)" -Value "URL:$proto Protocol"
            Set-ItemProperty -Path $regPath -Name "URL Protocol" -Value ""
            Set-ItemProperty -Path "$regPath\shell\open\command" -Name "(Default)" -Value "`"$exePath`" `"%1`""
        }
        Set-Progress 85

        # Register in Add/Remove Programs
        Log "Registering in Apps & Features..."
        $uninstReg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AstraDownloader"
        New-Item -Path $uninstReg -Force | Out-Null
        Set-ItemProperty -Path $uninstReg -Name "DisplayName" -Value "Astra Downloader"
        Set-ItemProperty -Path $uninstReg -Name "DisplayIcon" -Value "$icoPath,0"
        Set-ItemProperty -Path $uninstReg -Name "UninstallString" -Value "`"$uninstPath`""
        Set-ItemProperty -Path $uninstReg -Name "InstallLocation" -Value $installPath
        Set-ItemProperty -Path $uninstReg -Name "Publisher" -Value "SysAdminDoc"
        Set-ItemProperty -Path $uninstReg -Name "DisplayVersion" -Value "1.0.0"
        Set-ItemProperty -Path $uninstReg -Name "NoModify" -Value 1 -Type DWord
        Set-ItemProperty -Path $uninstReg -Name "NoRepair" -Value 1 -Type DWord
        # Estimate size in KB
        $sizeKB = 0
        try { $sizeKB = [math]::Round((Get-ChildItem $installPath -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1024) } catch {}
        Set-ItemProperty -Path $uninstReg -Name "EstimatedSize" -Value $sizeKB -Type DWord
        Set-Progress 90

        # Kill old server, launch new
        Log "Starting server..."
        try {
            Get-NetTCPConnection -LocalPort 9751 -State Listen -ErrorAction SilentlyContinue |
                ForEach-Object { Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue } |
                Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 300
        } catch {}
        Start-Process -FilePath $exePath -WorkingDirectory $installPath
        Set-Progress 100

        Log ""
        Log "Installation complete!"
        $statusTitle.Text = "Installation Complete"
        $statusDetail.Text = "Astra Downloader is running in your system tray."
        $btnInstall.Content = "Close"
        $btnInstall.IsEnabled = $true
        $btnInstall.Background = [Windows.Media.BrushConverter]::new().ConvertFromString("#3b82f6")
        $btnInstall.Remove_Click($null)
        $btnInstall.Add_Click({ $window.Close() })

    } catch {
        Log ""
        Log "ERROR: $($_.Exception.Message)"
        $statusTitle.Text = "Installation Failed"
        $statusDetail.Text = $_.Exception.Message
        $progressFill.Background = [Windows.Media.BrushConverter]::new().ConvertFromString("#ef4444")
        $btnInstall.Content = "Close"
        $btnInstall.IsEnabled = $true
        $btnInstall.Add_Click({ $window.Close() })
    }
})

$window.ShowDialog() | Out-Null
