<#
.SYNOPSIS
    YTYT-Downloader Installer - Professional setup wizard for VLC streaming and video downloading
.DESCRIPTION
    Installs and configures:
    - yt-dlp (auto-download)
    - ffmpeg (auto-download)
    - VLC protocol handler (ytvlc://)
    - Download protocol handler (ytdl://)
    - Userscript for YouTube integration
.NOTES
    Author: SysAdminDoc
    Version: 2.0.0
    Repository: https://github.com/SysAdminDoc/YTYT-Downloader
#>

#Requires -Version 5.1

# ============================================
# HIDE CONSOLE WINDOW
# ============================================
Add-Type -Name Window -Namespace Console -MemberDefinition '
[DllImport("Kernel32.dll")]
public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, Int32 nCmdShow);
'
$consolePtr = [Console.Window]::GetConsoleWindow()
[Console.Window]::ShowWindow($consolePtr, 0) | Out-Null

# ============================================
# CONFIGURATION
# ============================================
$script:AppName = "YTYT-Downloader"
$script:AppVersion = "2.0.0"
$script:InstallPath = "$env:LOCALAPPDATA\YTYT-Downloader"
$script:YtDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
$script:DefaultDownloadPath = "$env:USERPROFILE\Videos\YouTube"
$script:GitHubRepo = "https://github.com/SysAdminDoc/YTYT-Downloader"
$script:UserscriptUrl = "https://github.com/SysAdminDoc/YTYT-Downloader/raw/refs/heads/main/src/YTYT_downloader.user.js"
$script:YTKitUrl = "https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/YTKit.user.js"

# Image URLs
$script:IconUrl = "https://raw.githubusercontent.com/SysAdminDoc/YTYT-Downloader/refs/heads/main/images/icons/ytyticn.ico"
$script:LogoUrl = "https://raw.githubusercontent.com/SysAdminDoc/YTYT-Downloader/refs/heads/main/images/ytytfull.png"
$script:IconPngUrl = "https://raw.githubusercontent.com/SysAdminDoc/YTYT-Downloader/refs/heads/main/images/icons/ytyticn-128x128.png"

# Browser icon URLs
$script:BrowserIcons = @{
    Chrome  = "https://raw.githubusercontent.com/SysAdminDoc/YTYT-Downloader/refs/heads/main/images/browsers/chrome.png"
    Firefox = "https://raw.githubusercontent.com/SysAdminDoc/YTYT-Downloader/refs/heads/main/images/browsers/firefox.png"
    Edge    = "https://raw.githubusercontent.com/SysAdminDoc/YTYT-Downloader/refs/heads/main/images/browsers/edge.png"
    Safari  = "https://raw.githubusercontent.com/SysAdminDoc/YTYT-Downloader/refs/heads/main/images/browsers/safari.png"
    Opera   = "https://raw.githubusercontent.com/SysAdminDoc/YTYT-Downloader/refs/heads/main/images/browsers/opera.png"
}

# Userscript manager links by browser
$script:UserscriptManagers = @{
    Chrome = @{
        Tampermonkey = "https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo"
        Violentmonkey = "https://chrome.google.com/webstore/detail/violent-monkey/jinjaccalgkegednnccohejagnlnfdag"
    }
    Firefox = @{
        Tampermonkey = "https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/"
        Greasemonkey = "https://addons.mozilla.org/en-US/firefox/addon/greasemonkey/"
        Violentmonkey = "https://addons.mozilla.org/firefox/addon/violentmonkey/"
    }
    Edge = @{
        Tampermonkey = "https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd"
        Violentmonkey = "https://microsoftedge.microsoft.com/addons/detail/eeagobfjdenkkddmbclomhiblgggliao"
    }
    Safari = @{
        Tampermonkey = "https://apps.apple.com/us/app/tampermonkey/id6738342400"
    }
    Opera = @{
        Tampermonkey = "https://addons.opera.com/en/extensions/details/tampermonkey-beta/"
    }
}

# ============================================
# ASSEMBLIES
# ============================================
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ============================================
# HELPER FUNCTIONS
# ============================================
function Download-Image {
    param([string]$Url, [string]$OutPath)
    try {
        $webClient = New-Object System.Net.WebClient
        $webClient.Headers.Add("User-Agent", "Mozilla/5.0")
        $webClient.DownloadFile($Url, $OutPath)
        $webClient.Dispose()
        return $true
    } catch {
        return $false
    }
}

function Get-BitmapImageFromFile {
    param([string]$Path)
    if (Test-Path $Path) {
        $bitmap = New-Object System.Windows.Media.Imaging.BitmapImage
        $bitmap.BeginInit()
        $bitmap.UriSource = New-Object System.Uri($Path, [System.UriKind]::Absolute)
        $bitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $bitmap.EndInit()
        $bitmap.Freeze()
        return $bitmap
    }
    return $null
}

function Get-BitmapImageFromUrl {
    param([string]$Url)
    try {
        $webClient = New-Object System.Net.WebClient
        $webClient.Headers.Add("User-Agent", "Mozilla/5.0")
        $imageData = $webClient.DownloadData($Url)
        $webClient.Dispose()
        
        $stream = New-Object System.IO.MemoryStream(,$imageData)
        $bitmap = New-Object System.Windows.Media.Imaging.BitmapImage
        $bitmap.BeginInit()
        $bitmap.StreamSource = $stream
        $bitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $bitmap.EndInit()
        $bitmap.Freeze()
        return $bitmap
    } catch {
        return $null
    }
}

# ============================================
# PRE-FLIGHT CHECKS
# ============================================
$tempDir = Join-Path $env:TEMP "YTYT-Installer"
if (!(Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir -Force | Out-Null }

# ============================================
# AUTO-UNINSTALL PREVIOUS VERSION
# ============================================
function Uninstall-Previous {
    # Force kill related processes
    @("yt-dlp", "ffmpeg", "ffprobe", "vlc") | ForEach-Object {
        Get-Process -Name $_ -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
    
    # Remove protocol handlers
    @("ytvlc", "ytvlcq", "ytdl", "ytmpv", "ytdlplay") | ForEach-Object {
        Remove-Item -Path "HKCU:\Software\Classes\$_" -Recurse -Force -ErrorAction SilentlyContinue
    }
    
    # Remove install directory
    if (Test-Path $script:InstallPath) {
        Remove-Item -Path $script:InstallPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    
    # Remove desktop shortcut
    $shortcutPath = "$env:USERPROFILE\Desktop\YouTube Download.lnk"
    if (Test-Path $shortcutPath) {
        Remove-Item $shortcutPath -Force -ErrorAction SilentlyContinue
    }
    
    # Remove startup shortcut
    $startupPath = [Environment]::GetFolderPath('Startup')
    $serverShortcut = Join-Path $startupPath "YTYT-Server.lnk"
    if (Test-Path $serverShortcut) {
        Remove-Item $serverShortcut -Force -ErrorAction SilentlyContinue
    }
}

# Run auto-uninstall silently
Uninstall-Previous

# Download icon for window
$iconPath = Join-Path $tempDir "ytyt.ico"
Download-Image -Url $script:IconUrl -OutPath $iconPath | Out-Null

# Check for VLC
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

# ============================================
# XAML GUI DEFINITION
# ============================================
[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="YTYT-Downloader Setup" Height="980" Width="900"
        WindowStartupLocation="CenterScreen" ResizeMode="CanMinimize"
        WindowState="Normal"
        Background="#0a0a0a">
    <Window.Resources>
        <!-- Color Palette -->
        <SolidColorBrush x:Key="BgDark" Color="#0a0a0a"/>
        <SolidColorBrush x:Key="BgCard" Color="#141414"/>
        <SolidColorBrush x:Key="BgHover" Color="#1f1f1f"/>
        <SolidColorBrush x:Key="Border" Color="#2a2a2a"/>
        <SolidColorBrush x:Key="TextPrimary" Color="#fafafa"/>
        <SolidColorBrush x:Key="TextSecondary" Color="#a1a1aa"/>
        <SolidColorBrush x:Key="TextMuted" Color="#71717a"/>
        <SolidColorBrush x:Key="AccentGreen" Color="#22c55e"/>
        <SolidColorBrush x:Key="AccentGreenHover" Color="#16a34a"/>
        <SolidColorBrush x:Key="AccentOrange" Color="#f97316"/>
        <SolidColorBrush x:Key="AccentRed" Color="#ef4444"/>
        <SolidColorBrush x:Key="AccentBlue" Color="#3b82f6"/>
        
        <!-- Base Button Style -->
        <Style x:Key="BaseButton" TargetType="Button">
            <Setter Property="Background" Value="{StaticResource AccentGreen}"/>
            <Setter Property="Foreground" Value="#0a0a0a"/>
            <Setter Property="BorderThickness" Value="0"/>
            <Setter Property="Padding" Value="24,12"/>
            <Setter Property="FontFamily" Value="Segoe UI"/>
            <Setter Property="FontSize" Value="14"/>
            <Setter Property="FontWeight" Value="SemiBold"/>
            <Setter Property="Cursor" Value="Hand"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border Background="{TemplateBinding Background}" 
                                CornerRadius="8" 
                                Padding="{TemplateBinding Padding}">
                            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                        </Border>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
            <Style.Triggers>
                <Trigger Property="IsMouseOver" Value="True">
                    <Setter Property="Background" Value="{StaticResource AccentGreenHover}"/>
                </Trigger>
                <Trigger Property="IsEnabled" Value="False">
                    <Setter Property="Opacity" Value="0.5"/>
                </Trigger>
            </Style.Triggers>
        </Style>
        
        <!-- Secondary Button -->
        <Style x:Key="SecondaryButton" TargetType="Button" BasedOn="{StaticResource BaseButton}">
            <Setter Property="Background" Value="{StaticResource BgCard}"/>
            <Setter Property="Foreground" Value="{StaticResource TextPrimary}"/>
            <Setter Property="BorderBrush" Value="{StaticResource Border}"/>
            <Setter Property="BorderThickness" Value="1"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border Background="{TemplateBinding Background}" 
                                BorderBrush="{TemplateBinding BorderBrush}"
                                BorderThickness="{TemplateBinding BorderThickness}"
                                CornerRadius="8" 
                                Padding="{TemplateBinding Padding}">
                            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                        </Border>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
            <Style.Triggers>
                <Trigger Property="IsMouseOver" Value="True">
                    <Setter Property="Background" Value="{StaticResource BgHover}"/>
                </Trigger>
            </Style.Triggers>
        </Style>
        
        <!-- Danger Button -->
        <Style x:Key="DangerButton" TargetType="Button" BasedOn="{StaticResource BaseButton}">
            <Setter Property="Background" Value="{StaticResource AccentRed}"/>
            <Setter Property="Foreground" Value="White"/>
            <Style.Triggers>
                <Trigger Property="IsMouseOver" Value="True">
                    <Setter Property="Background" Value="#dc2626"/>
                </Trigger>
            </Style.Triggers>
        </Style>
        
        <!-- Browser Icon Button -->
        <Style x:Key="BrowserButton" TargetType="Button">
            <Setter Property="Background" Value="Transparent"/>
            <Setter Property="BorderThickness" Value="0"/>
            <Setter Property="Padding" Value="8"/>
            <Setter Property="Cursor" Value="Hand"/>
            <Setter Property="Width" Value="72"/>
            <Setter Property="Height" Value="72"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border x:Name="border" Background="{StaticResource BgCard}" 
                                BorderBrush="{StaticResource Border}" BorderThickness="2"
                                CornerRadius="12" Padding="12">
                            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                        </Border>
                        <ControlTemplate.Triggers>
                            <Trigger Property="IsMouseOver" Value="True">
                                <Setter TargetName="border" Property="BorderBrush" Value="{StaticResource AccentGreen}"/>
                                <Setter TargetName="border" Property="Background" Value="{StaticResource BgHover}"/>
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
        
        <!-- TextBox Style -->
        <Style TargetType="TextBox">
            <Setter Property="Background" Value="{StaticResource BgCard}"/>
            <Setter Property="Foreground" Value="{StaticResource TextPrimary}"/>
            <Setter Property="BorderBrush" Value="{StaticResource Border}"/>
            <Setter Property="BorderThickness" Value="1"/>
            <Setter Property="Padding" Value="12,10"/>
            <Setter Property="FontFamily" Value="Segoe UI"/>
            <Setter Property="FontSize" Value="14"/>
            <Setter Property="CaretBrush" Value="{StaticResource TextPrimary}"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="TextBox">
                        <Border Background="{TemplateBinding Background}" 
                                BorderBrush="{TemplateBinding BorderBrush}"
                                BorderThickness="{TemplateBinding BorderThickness}"
                                CornerRadius="8">
                            <ScrollViewer x:Name="PART_ContentHost" Margin="{TemplateBinding Padding}"/>
                        </Border>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
            <Style.Triggers>
                <Trigger Property="IsFocused" Value="True">
                    <Setter Property="BorderBrush" Value="{StaticResource AccentGreen}"/>
                </Trigger>
            </Style.Triggers>
        </Style>
        
        <!-- CheckBox Style -->
        <Style TargetType="CheckBox">
            <Setter Property="Foreground" Value="{StaticResource TextPrimary}"/>
            <Setter Property="FontFamily" Value="Segoe UI"/>
            <Setter Property="FontSize" Value="14"/>
            <Setter Property="Cursor" Value="Hand"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="CheckBox">
                        <StackPanel Orientation="Horizontal">
                            <Border x:Name="checkbox" Width="20" Height="20" 
                                    Background="{StaticResource BgCard}" 
                                    BorderBrush="{StaticResource Border}" 
                                    BorderThickness="2" CornerRadius="4"
                                    VerticalAlignment="Center">
                                <Path x:Name="checkmark" Data="M3,7 L6,10 L11,4" 
                                      Stroke="{StaticResource AccentGreen}" StrokeThickness="2"
                                      Visibility="Collapsed" Margin="2"/>
                            </Border>
                            <ContentPresenter Margin="10,0,0,0" VerticalAlignment="Center"/>
                        </StackPanel>
                        <ControlTemplate.Triggers>
                            <Trigger Property="IsChecked" Value="True">
                                <Setter TargetName="checkmark" Property="Visibility" Value="Visible"/>
                                <Setter TargetName="checkbox" Property="BorderBrush" Value="{StaticResource AccentGreen}"/>
                            </Trigger>
                            <Trigger Property="IsMouseOver" Value="True">
                                <Setter TargetName="checkbox" Property="BorderBrush" Value="{StaticResource AccentGreen}"/>
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
        
        <!-- Label Style -->
        <Style TargetType="Label">
            <Setter Property="Foreground" Value="{StaticResource TextPrimary}"/>
            <Setter Property="FontFamily" Value="Segoe UI"/>
            <Setter Property="FontSize" Value="14"/>
            <Setter Property="Padding" Value="0"/>
        </Style>
    </Window.Resources>
    
    <Grid>
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
            <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>
        
        <!-- Header -->
        <Border Grid.Row="0" Background="{StaticResource BgCard}" BorderBrush="{StaticResource Border}" BorderThickness="0,0,0,1">
            <Grid Margin="32,24">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="Auto"/>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>
                
                <Image x:Name="imgLogo" Grid.Column="0" Width="180" Height="60" Stretch="Uniform" Margin="0,0,24,0"/>
                
                <StackPanel Grid.Column="1" VerticalAlignment="Center">
                    <TextBlock Text="Setup Wizard" FontSize="24" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}" FontFamily="Segoe UI"/>
                    <TextBlock x:Name="txtSubtitle" Text="Stream to VLC and download with yt-dlp" FontSize="14" Foreground="{StaticResource TextSecondary}" FontFamily="Segoe UI" Margin="0,4,0,0"/>
                </StackPanel>
                
                <TextBlock Grid.Column="2" Text="v2.0.0" FontSize="12" Foreground="{StaticResource TextMuted}" VerticalAlignment="Top" FontFamily="Segoe UI Semibold"/>
            </Grid>
        </Border>
        
        <!-- Main Content - TabControl without visible tabs -->
        <TabControl x:Name="tabWizard" Grid.Row="1" Background="Transparent" BorderThickness="0" Padding="0">
            <TabControl.ItemContainerStyle>
                <Style TargetType="TabItem">
                    <Setter Property="Visibility" Value="Collapsed"/>
                </Style>
            </TabControl.ItemContainerStyle>
            
            <!-- Step 1: Welcome / Base Tools -->
            <TabItem x:Name="tabStep1">
                <Grid Margin="24,16">
                    <Grid.RowDefinitions>
                        <RowDefinition Height="Auto"/>
                        <RowDefinition Height="*"/>
                        <RowDefinition Height="Auto"/>
                    </Grid.RowDefinitions>
                    
                    <!-- Header Row -->
                    <StackPanel Grid.Row="0" Margin="0,0,0,16">
                        <!-- Step Indicator -->
                        <StackPanel Orientation="Horizontal" HorizontalAlignment="Center" Margin="0,0,0,16">
                            <Ellipse Width="32" Height="32" Fill="{StaticResource AccentGreen}"/>
                            <TextBlock Text="1" Foreground="#0a0a0a" FontWeight="Bold" FontSize="14" Margin="-22,7,0,0"/>
                            <Rectangle Width="60" Height="2" Fill="{StaticResource Border}" VerticalAlignment="Center" Margin="8,0"/>
                            <Ellipse Width="32" Height="32" Fill="{StaticResource BgCard}" Stroke="{StaticResource Border}" StrokeThickness="2"/>
                            <TextBlock Text="2" Foreground="{StaticResource TextMuted}" FontWeight="Bold" FontSize="14" Margin="-22,7,0,0"/>
                            <Rectangle Width="60" Height="2" Fill="{StaticResource Border}" VerticalAlignment="Center" Margin="8,0"/>
                            <Ellipse Width="32" Height="32" Fill="{StaticResource BgCard}" Stroke="{StaticResource Border}" StrokeThickness="2"/>
                            <TextBlock Text="3" Foreground="{StaticResource TextMuted}" FontWeight="Bold" FontSize="14" Margin="-22,7,0,0"/>
                        </StackPanel>
                        <TextBlock Text="Step 1: Install Base Tools" FontSize="20" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}" HorizontalAlignment="Center"/>
                    </StackPanel>
                    
                    <!-- Two Column Layout -->
                    <Grid Grid.Row="1">
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*"/>
                            <ColumnDefinition Width="16"/>
                            <ColumnDefinition Width="320"/>
                        </Grid.ColumnDefinitions>
                        
                        <!-- Left Column: Configuration -->
                        <StackPanel Grid.Column="0">
                            <!-- VLC Status -->
                            <Border Background="{StaticResource BgCard}" BorderBrush="{StaticResource Border}" BorderThickness="1" CornerRadius="8" Padding="16" Margin="0,0,0,12">
                                <Grid>
                                    <Grid.ColumnDefinitions>
                                        <ColumnDefinition Width="Auto"/>
                                        <ColumnDefinition Width="*"/>
                                        <ColumnDefinition Width="Auto"/>
                                    </Grid.ColumnDefinitions>
                                    <Ellipse x:Name="vlcIndicator" Width="10" Height="10" Fill="{StaticResource AccentRed}" VerticalAlignment="Center" Margin="0,0,12,0"/>
                                    <StackPanel Grid.Column="1" VerticalAlignment="Center">
                                        <TextBlock Text="VLC Media Player" FontSize="13" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}"/>
                                        <TextBlock x:Name="txtVlcStatus" Text="Not detected" FontSize="11" Foreground="{StaticResource TextSecondary}"/>
                                    </StackPanel>
                                    <Button x:Name="btnInstallVlc" Content="Install" Grid.Column="2" Style="{StaticResource SecondaryButton}" Padding="12,6"/>
                                </Grid>
                            </Border>
                            
                            <!-- VLC Path -->
                            <TextBlock Text="VLC Path" FontSize="12" Foreground="{StaticResource TextSecondary}" Margin="0,0,0,6"/>
                            <Grid Margin="0,0,0,12">
                                <Grid.ColumnDefinitions>
                                    <ColumnDefinition Width="*"/>
                                    <ColumnDefinition Width="Auto"/>
                                </Grid.ColumnDefinitions>
                                <TextBox x:Name="txtVlcPath" Grid.Column="0" FontSize="12"/>
                                <Button x:Name="btnBrowseVlc" Content="..." Grid.Column="1" Style="{StaticResource SecondaryButton}" Margin="8,0,0,0" Padding="12,8" Width="40"/>
                            </Grid>
                            
                            <!-- Download Path -->
                            <TextBlock Text="Download Folder" FontSize="12" Foreground="{StaticResource TextSecondary}" Margin="0,0,0,6"/>
                            <Grid Margin="0,0,0,16">
                                <Grid.ColumnDefinitions>
                                    <ColumnDefinition Width="*"/>
                                    <ColumnDefinition Width="Auto"/>
                                </Grid.ColumnDefinitions>
                                <TextBox x:Name="txtDownloadPath" Grid.Column="0" FontSize="12"/>
                                <Button x:Name="btnBrowseDownload" Content="..." Grid.Column="1" Style="{StaticResource SecondaryButton}" Margin="8,0,0,0" Padding="12,8" Width="40"/>
                            </Grid>
                            
                            <!-- Options -->
                            <TextBlock Text="Options" FontSize="12" Foreground="{StaticResource TextSecondary}" Margin="0,0,0,8"/>
                            <Border Background="{StaticResource BgCard}" BorderBrush="{StaticResource Border}" BorderThickness="1" CornerRadius="8" Padding="16">
                                <StackPanel>
                                    <CheckBox x:Name="chkAutoUpdate" Content="Auto-update yt-dlp before downloads" IsChecked="True" Margin="0,0,0,8"/>
                                    <CheckBox x:Name="chkNotifications" Content="Show toast notifications" IsChecked="True" Margin="0,0,0,8"/>
                                    <CheckBox x:Name="chkDesktopShortcut" Content="Create desktop shortcut" IsChecked="False"/>
                                </StackPanel>
                            </Border>
                        </StackPanel>
                        
                        <!-- Right Column: Installation Log -->
                        <Border Grid.Column="2" Background="{StaticResource BgCard}" BorderBrush="{StaticResource Border}" BorderThickness="1" CornerRadius="8" Padding="12">
                            <Grid>
                                <Grid.RowDefinitions>
                                    <RowDefinition Height="Auto"/>
                                    <RowDefinition Height="*"/>
                                </Grid.RowDefinitions>
                                <TextBlock Text="Installation Log" FontSize="12" Foreground="{StaticResource TextSecondary}" Margin="0,0,0,8"/>
                                <ScrollViewer x:Name="statusScroll" Grid.Row="1" VerticalScrollBarVisibility="Auto">
                                    <TextBlock x:Name="txtStatus" Text="Ready to install..." Foreground="{StaticResource TextMuted}" TextWrapping="Wrap" FontFamily="Cascadia Code, Consolas" FontSize="11"/>
                                </ScrollViewer>
                            </Grid>
                        </Border>
                    </Grid>
                    
                    <!-- Progress Bar Row -->
                    <Border Grid.Row="2" Background="{StaticResource BgCard}" CornerRadius="4" Height="6" Margin="0,16,0,0">
                        <Border x:Name="progressFill" Background="{StaticResource AccentGreen}" CornerRadius="4" HorizontalAlignment="Left" Width="0"/>
                    </Border>
                </Grid>
            </TabItem>
            
            <!-- Step 2: Install Userscript Manager -->
            <TabItem x:Name="tabStep2">
                <ScrollViewer VerticalScrollBarVisibility="Auto">
                    <StackPanel Margin="32,24">
                        <!-- Step Indicator -->
                        <StackPanel Orientation="Horizontal" HorizontalAlignment="Center" Margin="0,0,0,32">
                            <Ellipse Width="32" Height="32" Fill="{StaticResource AccentGreen}"/>
                            <Path Data="M8,12 L11,15 L16,9" Stroke="#0a0a0a" StrokeThickness="2" Margin="-26,8,0,0"/>
                            <Rectangle Width="60" Height="2" Fill="{StaticResource AccentGreen}" VerticalAlignment="Center" Margin="8,0"/>
                            <Ellipse Width="32" Height="32" Fill="{StaticResource AccentGreen}"/>
                            <TextBlock Text="2" Foreground="#0a0a0a" FontWeight="Bold" FontSize="14" Margin="-22,7,0,0"/>
                            <Rectangle Width="60" Height="2" Fill="{StaticResource Border}" VerticalAlignment="Center" Margin="8,0"/>
                            <Ellipse Width="32" Height="32" Fill="{StaticResource BgCard}" Stroke="{StaticResource Border}" StrokeThickness="2"/>
                            <TextBlock Text="3" Foreground="{StaticResource TextMuted}" FontWeight="Bold" FontSize="14" Margin="-22,7,0,0"/>
                        </StackPanel>
                        
                        <TextBlock Text="Step 2: Install a Userscript Manager" FontSize="20" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}" Margin="0,0,0,8"/>
                        <TextBlock Text="Select your browser to see compatible userscript manager extensions." FontSize="14" Foreground="{StaticResource TextSecondary}" Margin="0,0,0,24" TextWrapping="Wrap"/>
                        
                        <!-- Browser Selection -->
                        <TextBlock Text="Select Your Browser" FontSize="13" Foreground="{StaticResource TextSecondary}" Margin="0,0,0,16"/>
                        <StackPanel Orientation="Horizontal" HorizontalAlignment="Center" Margin="0,0,0,24">
                            <Button x:Name="btnChrome" Style="{StaticResource BrowserButton}" ToolTip="Chrome / Chromium" Margin="8">
                                <Image x:Name="imgChrome" Width="40" Height="40" Stretch="Uniform"/>
                            </Button>
                            <Button x:Name="btnFirefox" Style="{StaticResource BrowserButton}" ToolTip="Firefox" Margin="8">
                                <Image x:Name="imgFirefox" Width="40" Height="40" Stretch="Uniform"/>
                            </Button>
                            <Button x:Name="btnEdge" Style="{StaticResource BrowserButton}" ToolTip="Microsoft Edge" Margin="8">
                                <Image x:Name="imgEdge" Width="40" Height="40" Stretch="Uniform"/>
                            </Button>
                            <Button x:Name="btnSafari" Style="{StaticResource BrowserButton}" ToolTip="Safari" Margin="8">
                                <Image x:Name="imgSafari" Width="40" Height="40" Stretch="Uniform"/>
                            </Button>
                            <Button x:Name="btnOpera" Style="{StaticResource BrowserButton}" ToolTip="Opera" Margin="8">
                                <Image x:Name="imgOpera" Width="40" Height="40" Stretch="Uniform"/>
                            </Button>
                        </StackPanel>
                        
                        <!-- Selected Browser Info -->
                        <Border x:Name="pnlBrowserLinks" Background="{StaticResource BgCard}" BorderBrush="{StaticResource Border}" BorderThickness="1" CornerRadius="12" Padding="24" Visibility="Collapsed">
                            <StackPanel>
                                <TextBlock x:Name="txtSelectedBrowser" Text="Chrome / Chromium" FontSize="18" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}" Margin="0,0,0,16"/>
                                <TextBlock Text="Compatible Userscript Managers:" FontSize="13" Foreground="{StaticResource TextSecondary}" Margin="0,0,0,12"/>
                                <StackPanel x:Name="pnlManagerLinks">
                                    <!-- Dynamically populated -->
                                </StackPanel>
                            </StackPanel>
                        </Border>
                        
                        <!-- Instructions -->
                        <Border Background="{StaticResource BgCard}" BorderBrush="{StaticResource AccentOrange}" BorderThickness="1" CornerRadius="12" Padding="20" Margin="0,24,0,0">
                            <StackPanel Orientation="Horizontal">
                                <TextBlock Text="!" FontSize="20" Foreground="{StaticResource AccentOrange}" FontWeight="Bold" Margin="0,0,16,0" VerticalAlignment="Top"/>
                                <StackPanel>
                                    <TextBlock Text="Important" FontSize="14" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}" Margin="0,0,0,4"/>
                                    <TextBlock Text="Install a userscript manager extension in your browser before proceeding to the next step. Tampermonkey is recommended for most users." FontSize="13" Foreground="{StaticResource TextSecondary}" TextWrapping="Wrap"/>
                                </StackPanel>
                            </StackPanel>
                        </Border>
                    </StackPanel>
                </ScrollViewer>
            </TabItem>
            
            <!-- Step 3: Install Userscript -->
            <TabItem x:Name="tabStep3">
                <ScrollViewer VerticalScrollBarVisibility="Auto">
                    <StackPanel Margin="32,24">
                        <!-- Step Indicator -->
                        <StackPanel Orientation="Horizontal" HorizontalAlignment="Center" Margin="0,0,0,32">
                            <Ellipse Width="32" Height="32" Fill="{StaticResource AccentGreen}"/>
                            <Path Data="M8,12 L11,15 L16,9" Stroke="#0a0a0a" StrokeThickness="2" Margin="-26,8,0,0"/>
                            <Rectangle Width="60" Height="2" Fill="{StaticResource AccentGreen}" VerticalAlignment="Center" Margin="8,0"/>
                            <Ellipse Width="32" Height="32" Fill="{StaticResource AccentGreen}"/>
                            <Path Data="M8,12 L11,15 L16,9" Stroke="#0a0a0a" StrokeThickness="2" Margin="-26,8,0,0"/>
                            <Rectangle Width="60" Height="2" Fill="{StaticResource AccentGreen}" VerticalAlignment="Center" Margin="8,0"/>
                            <Ellipse Width="32" Height="32" Fill="{StaticResource AccentGreen}"/>
                            <TextBlock Text="3" Foreground="#0a0a0a" FontWeight="Bold" FontSize="14" Margin="-22,7,0,0"/>
                        </StackPanel>
                        
                        <TextBlock Text="Step 3: Install a Userscript" FontSize="20" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}" Margin="0,0,0,8"/>
                        <TextBlock Text="Choose a userscript to install. Both options use the same protocol handlers configured during installation." FontSize="14" Foreground="{StaticResource TextSecondary}" Margin="0,0,0,24" TextWrapping="Wrap"/>
                        
                        <!-- Two Userscript Options Side by Side -->
                        <Grid HorizontalAlignment="Center">
                            <Grid.ColumnDefinitions>
                                <ColumnDefinition Width="280"/>
                                <ColumnDefinition Width="24"/>
                                <ColumnDefinition Width="280"/>
                            </Grid.ColumnDefinitions>
                            
                            <!-- YTYT-Downloader (Minimal) -->
                            <Border Grid.Column="0" Background="{StaticResource BgCard}" BorderBrush="{StaticResource Border}" BorderThickness="1" CornerRadius="16" Padding="24">
                                <StackPanel HorizontalAlignment="Center">
                                    <Border Background="#22c55e" CornerRadius="40" Width="64" Height="64" Margin="0,0,0,16">
                                        <TextBlock Text="DL" FontSize="24" FontWeight="Bold" Foreground="White" HorizontalAlignment="Center" VerticalAlignment="Center"/>
                                    </Border>
                                    <TextBlock Text="YTYT-Downloader" FontSize="16" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}" HorizontalAlignment="Center" Margin="0,0,0,4"/>
                                    <TextBlock Text="Download Buttons Only" FontSize="12" Foreground="{StaticResource AccentGreen}" HorizontalAlignment="Center" Margin="0,0,0,12"/>
                                    <TextBlock Text="Minimal userscript that adds Video, MP3, Transcript download buttons and VLC streaming to YouTube." FontSize="12" Foreground="{StaticResource TextSecondary}" TextWrapping="Wrap" TextAlignment="Center" Margin="0,0,0,16" Height="54"/>
                                    <Button x:Name="btnInstallUserscript" Content="Install YTYT" Style="{StaticResource BaseButton}" Padding="24,12" FontSize="14"/>
                                </StackPanel>
                            </Border>
                            
                            <!-- YTKit (Full Featured) -->
                            <Border Grid.Column="2" Background="{StaticResource BgCard}" BorderBrush="#8b5cf6" BorderThickness="2" CornerRadius="16" Padding="24">
                                <StackPanel HorizontalAlignment="Center">
                                    <Border CornerRadius="40" Width="64" Height="64" Margin="0,0,0,16">
                                        <Border.Background>
                                            <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
                                                <GradientStop Color="#8b5cf6" Offset="0"/>
                                                <GradientStop Color="#ec4899" Offset="1"/>
                                            </LinearGradientBrush>
                                        </Border.Background>
                                        <TextBlock Text="YT" FontSize="24" FontWeight="Bold" Foreground="White" HorizontalAlignment="Center" VerticalAlignment="Center"/>
                                    </Border>
                                    <TextBlock Text="YTKit" FontSize="16" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}" HorizontalAlignment="Center" Margin="0,0,0,4"/>
                                    <TextBlock Text="Full Featured Suite" FontSize="12" Foreground="#a78bfa" HorizontalAlignment="Center" Margin="0,0,0,12"/>
                                    <TextBlock Text="Complete YouTube customization: downloads, themes, video/channel hiding, playback enhancements, and more." FontSize="12" Foreground="{StaticResource TextSecondary}" TextWrapping="Wrap" TextAlignment="Center" Margin="0,0,0,16" Height="54"/>
                                    <Button x:Name="btnInstallYTKit" Content="Install YTKit" Style="{StaticResource SecondaryButton}" Padding="24,12" FontSize="14"/>
                                </StackPanel>
                            </Border>
                        </Grid>
                        
                        <!-- Success Message -->
                        <Border Background="#14532d" BorderBrush="{StaticResource AccentGreen}" BorderThickness="1" CornerRadius="12" Padding="20" Margin="0,24,0,0">
                            <StackPanel Orientation="Horizontal">
                                <TextBlock Text="OK" FontSize="16" Foreground="{StaticResource AccentGreen}" FontWeight="Bold" Margin="0,0,16,0" VerticalAlignment="Top"/>
                                <StackPanel>
                                    <TextBlock Text="Setup Complete!" FontSize="14" FontWeight="SemiBold" Foreground="{StaticResource AccentGreen}" Margin="0,0,0,4"/>
                                    <TextBlock Text="After installing either userscript, visit any YouTube video. You'll see download buttons next to the like/share buttons." FontSize="13" Foreground="#86efac" TextWrapping="Wrap"/>
                                </StackPanel>
                            </StackPanel>
                        </Border>
                        
                        <!-- Alternate Install -->
                        <TextBlock Text="Alternative: Manual Installation" FontSize="13" Foreground="{StaticResource TextSecondary}" Margin="0,24,0,8"/>
                        <Border Background="{StaticResource BgCard}" BorderBrush="{StaticResource Border}" BorderThickness="1" CornerRadius="12" Padding="16">
                            <StackPanel>
                                <TextBlock TextWrapping="Wrap" FontSize="13" Foreground="{StaticResource TextSecondary}">
                                    <Run>If the automatic install doesn't work, you can drag the userscript file into your userscript manager:</Run>
                                </TextBlock>
                                <Button x:Name="btnOpenFolder" Content="Open Install Folder" Style="{StaticResource SecondaryButton}" Margin="0,12,0,0" Padding="16,10" HorizontalAlignment="Left"/>
                            </StackPanel>
                        </Border>
                    </StackPanel>
                </ScrollViewer>
            </TabItem>
            
            <!-- Uninstall Tab -->
            <TabItem x:Name="tabUninstall">
                <StackPanel Margin="32,24" VerticalAlignment="Center" HorizontalAlignment="Center">
                    <Image x:Name="imgUninstallIcon" Width="80" Height="80" Margin="0,0,0,24"/>
                    <TextBlock Text="Uninstall YTYT-Downloader" FontSize="24" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}" HorizontalAlignment="Center" Margin="0,0,0,8"/>
                    <TextBlock Text="This will remove all installed components and protocol handlers." FontSize="14" Foreground="{StaticResource TextSecondary}" HorizontalAlignment="Center" Margin="0,0,0,32" TextWrapping="Wrap" MaxWidth="400" TextAlignment="Center"/>
                    
                    <Border Background="{StaticResource BgCard}" BorderBrush="{StaticResource Border}" BorderThickness="1" CornerRadius="12" Padding="24" Margin="0,0,0,24">
                        <StackPanel>
                            <TextBlock Text="The following will be removed:" FontSize="13" Foreground="{StaticResource TextSecondary}" Margin="0,0,0,12"/>
                            <TextBlock Text="[X] Protocol handlers (ytvlc://, ytdl://, etc.)" Foreground="{StaticResource TextMuted}" FontFamily="Cascadia Code, Consolas" FontSize="12" Margin="0,4"/>
                            <TextBlock Text="[X] yt-dlp and ffmpeg executables" Foreground="{StaticResource TextMuted}" FontFamily="Cascadia Code, Consolas" FontSize="12" Margin="0,4"/>
                            <TextBlock Text="[X] Configuration files" Foreground="{StaticResource TextMuted}" FontFamily="Cascadia Code, Consolas" FontSize="12" Margin="0,4"/>
                            <TextBlock Text="[X] Desktop and startup shortcuts" Foreground="{StaticResource TextMuted}" FontFamily="Cascadia Code, Consolas" FontSize="12" Margin="0,4"/>
                            <TextBlock Text="[!] Userscript must be removed manually from browser" Foreground="{StaticResource AccentOrange}" FontFamily="Cascadia Code, Consolas" FontSize="12" Margin="0,12,0,0"/>
                        </StackPanel>
                    </Border>
                    
                    <StackPanel Orientation="Horizontal" HorizontalAlignment="Center">
                        <Button x:Name="btnCancelUninstall" Content="Cancel" Style="{StaticResource SecondaryButton}" Margin="0,0,12,0" Padding="24,12"/>
                        <Button x:Name="btnConfirmUninstall" Content="Uninstall" Style="{StaticResource DangerButton}" Padding="24,12"/>
                    </StackPanel>
                </StackPanel>
            </TabItem>
        </TabControl>
        
        <!-- Footer -->
        <Border Grid.Row="2" Background="{StaticResource BgCard}" BorderBrush="{StaticResource Border}" BorderThickness="0,1,0,0">
            <Grid Margin="32,16">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="Auto"/>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>
                
                <Button x:Name="btnUninstall" Content="Uninstall" Style="{StaticResource SecondaryButton}" Padding="16,10" Grid.Column="0"/>
                
                <StackPanel Grid.Column="2" Orientation="Horizontal">
                    <Button x:Name="btnBack" Content="Back" Style="{StaticResource SecondaryButton}" Padding="20,10" Margin="0,0,12,0" Visibility="Collapsed"/>
                    <Button x:Name="btnNext" Content="Install Base Tools" Style="{StaticResource BaseButton}" Padding="20,10"/>
                </StackPanel>
            </Grid>
        </Border>
    </Grid>
</Window>
"@

# ============================================
# LOAD WINDOW
# ============================================
$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)

# Set window icon
if (Test-Path $iconPath) {
    $window.Icon = [System.Windows.Media.Imaging.BitmapFrame]::Create([System.Uri]::new($iconPath))
}

# ============================================
# GET CONTROLS
# ============================================
$imgLogo = $window.FindName("imgLogo")
$txtSubtitle = $window.FindName("txtSubtitle")
$tabWizard = $window.FindName("tabWizard")

# Step 1 controls
$vlcIndicator = $window.FindName("vlcIndicator")
$txtVlcStatus = $window.FindName("txtVlcStatus")
$btnInstallVlc = $window.FindName("btnInstallVlc")
$txtVlcPath = $window.FindName("txtVlcPath")
$btnBrowseVlc = $window.FindName("btnBrowseVlc")
$txtDownloadPath = $window.FindName("txtDownloadPath")
$btnBrowseDownload = $window.FindName("btnBrowseDownload")
$chkAutoUpdate = $window.FindName("chkAutoUpdate")
$chkNotifications = $window.FindName("chkNotifications")
$chkDesktopShortcut = $window.FindName("chkDesktopShortcut")
$txtStatus = $window.FindName("txtStatus")
$statusScroll = $window.FindName("statusScroll")
$progressFill = $window.FindName("progressFill")

# Step 2 controls
$btnChrome = $window.FindName("btnChrome")
$btnFirefox = $window.FindName("btnFirefox")
$btnEdge = $window.FindName("btnEdge")
$btnSafari = $window.FindName("btnSafari")
$btnOpera = $window.FindName("btnOpera")
$imgChrome = $window.FindName("imgChrome")
$imgFirefox = $window.FindName("imgFirefox")
$imgEdge = $window.FindName("imgEdge")
$imgSafari = $window.FindName("imgSafari")
$imgOpera = $window.FindName("imgOpera")
$pnlBrowserLinks = $window.FindName("pnlBrowserLinks")
$txtSelectedBrowser = $window.FindName("txtSelectedBrowser")
$pnlManagerLinks = $window.FindName("pnlManagerLinks")

# Step 3 controls
$btnInstallUserscript = $window.FindName("btnInstallUserscript")
$btnInstallYTKit = $window.FindName("btnInstallYTKit")
$btnOpenFolder = $window.FindName("btnOpenFolder")

# Uninstall controls
$imgUninstallIcon = $window.FindName("imgUninstallIcon")
$btnCancelUninstall = $window.FindName("btnCancelUninstall")
$btnConfirmUninstall = $window.FindName("btnConfirmUninstall")

# Footer controls
$btnUninstall = $window.FindName("btnUninstall")
$btnBack = $window.FindName("btnBack")
$btnNext = $window.FindName("btnNext")

# ============================================
# LOAD IMAGES
# ============================================
$logoImage = Get-BitmapImageFromUrl -Url $script:LogoUrl
if ($logoImage) { $imgLogo.Source = $logoImage }

$iconImage = Get-BitmapImageFromUrl -Url $script:IconPngUrl
if ($iconImage) { 
    $imgUninstallIcon.Source = $iconImage
}

# Load browser icons
$imgChrome.Source = Get-BitmapImageFromUrl -Url $script:BrowserIcons.Chrome
$imgFirefox.Source = Get-BitmapImageFromUrl -Url $script:BrowserIcons.Firefox
$imgEdge.Source = Get-BitmapImageFromUrl -Url $script:BrowserIcons.Edge
$imgSafari.Source = Get-BitmapImageFromUrl -Url $script:BrowserIcons.Safari
$imgOpera.Source = Get-BitmapImageFromUrl -Url $script:BrowserIcons.Opera

# ============================================
# SET DEFAULTS
# ============================================
if ($vlcFound) {
    $txtVlcPath.Text = $vlcFound
    $vlcIndicator.Fill = [System.Windows.Media.Brushes]::LimeGreen
    $txtVlcStatus.Text = "Detected: $vlcFound"
    $btnInstallVlc.Visibility = "Collapsed"
} else {
    $txtVlcPath.Text = ""
    $txtVlcStatus.Text = "Not detected - click Install VLC or browse manually"
}
$txtDownloadPath.Text = $script:DefaultDownloadPath

# Track wizard state
$script:CurrentStep = 1
$script:BaseToolsInstalled = $false

# ============================================
# HELPER FUNCTIONS
# ============================================
function Update-Status {
    param([string]$Message)
    $txtStatus.Text = $txtStatus.Text + "`n" + $Message
    $statusScroll.ScrollToEnd()
    $window.Dispatcher.Invoke([action]{}, [System.Windows.Threading.DispatcherPriority]::Render)
}

function Set-Progress {
    param([int]$Value)
    $maxWidth = $progressFill.Parent.ActualWidth
    if ($maxWidth -le 0) { $maxWidth = 700 }
    $progressFill.Width = ($Value / 100) * $maxWidth
    $window.Dispatcher.Invoke([action]{}, [System.Windows.Threading.DispatcherPriority]::Render)
}

function Update-WizardButtons {
    switch ($script:CurrentStep) {
        1 {
            $btnBack.Visibility = "Collapsed"
            if ($script:BaseToolsInstalled) {
                $btnNext.Content = "Next: Userscript Manager"
            } else {
                $btnNext.Content = "Install Base Tools"
            }
        }
        2 {
            $btnBack.Visibility = "Visible"
            $btnNext.Content = "Next: Install Userscript"
        }
        3 {
            $btnBack.Visibility = "Visible"
            $btnNext.Content = "Finish"
        }
        4 {
            $btnBack.Visibility = "Collapsed"
            $btnNext.Visibility = "Collapsed"
        }
    }
}

function Show-BrowserLinks {
    param([string]$Browser)
    
    $pnlBrowserLinks.Visibility = "Visible"
    $txtSelectedBrowser.Text = $Browser
    $pnlManagerLinks.Children.Clear()
    
    $managers = $script:UserscriptManagers[$Browser]
    foreach ($manager in $managers.GetEnumerator()) {
        $linkPanel = New-Object System.Windows.Controls.StackPanel
        $linkPanel.Orientation = "Horizontal"
        $linkPanel.Margin = "0,8,0,0"
        
        $bullet = New-Object System.Windows.Controls.TextBlock
        $bullet.Text = ">"
        $bullet.Foreground = [System.Windows.Media.Brushes]::LimeGreen
        $bullet.FontFamily = New-Object System.Windows.Media.FontFamily("Cascadia Code, Consolas")
        $bullet.Margin = "0,0,8,0"
        $bullet.VerticalAlignment = "Center"
        
        $link = New-Object System.Windows.Controls.TextBlock
        $link.Cursor = [System.Windows.Input.Cursors]::Hand
        $link.VerticalAlignment = "Center"
        
        $hyperlink = New-Object System.Windows.Documents.Hyperlink
        $hyperlink.Inlines.Add($manager.Key)
        $hyperlink.Foreground = [System.Windows.Media.Brushes]::DodgerBlue
        $hyperlink.TextDecorations = $null
        $url = $manager.Value
        $hyperlink.Add_Click({ Start-Process $url }.GetNewClosure())
        $hyperlink.Add_MouseEnter({ $this.TextDecorations = [System.Windows.TextDecorations]::Underline })
        $hyperlink.Add_MouseLeave({ $this.TextDecorations = $null })
        
        $link.Inlines.Add($hyperlink)
        
        $linkPanel.Children.Add($bullet)
        $linkPanel.Children.Add($link)
        $pnlManagerLinks.Children.Add($linkPanel)
    }
}

# ============================================
# EVENT HANDLERS
# ============================================

# Browse VLC
$btnBrowseVlc.Add_Click({
    $dialog = New-Object Microsoft.Win32.OpenFileDialog
    $dialog.Filter = "VLC|vlc.exe|All Files|*.*"
    $dialog.Title = "Select VLC executable"
    if ($dialog.ShowDialog()) {
        $txtVlcPath.Text = $dialog.FileName
        $vlcIndicator.Fill = [System.Windows.Media.Brushes]::LimeGreen
        $txtVlcStatus.Text = "Selected: $($dialog.FileName)"
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

# Install VLC via winget
$btnInstallVlc.Add_Click({
    $wingetPath = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetPath) {
        Update-Status "Installing VLC via winget..."
        $btnInstallVlc.IsEnabled = $false
        try {
            Start-Process -FilePath "winget" -ArgumentList "install", "--id", "VideoLAN.VLC", "--accept-package-agreements", "--accept-source-agreements", "-h" -Wait -NoNewWindow
            Start-Sleep -Seconds 2
            foreach ($path in $vlcPaths) {
                if (Test-Path $path) {
                    $txtVlcPath.Text = $path
                    $vlcIndicator.Fill = [System.Windows.Media.Brushes]::LimeGreen
                    $txtVlcStatus.Text = "Installed: $path"
                    $btnInstallVlc.Visibility = "Collapsed"
                    Update-Status "VLC installed successfully!"
                    break
                }
            }
        } catch {
            Update-Status "Error installing VLC: $($_.Exception.Message)"
        }
        $btnInstallVlc.IsEnabled = $true
    } else {
        [System.Windows.MessageBox]::Show("winget is not available. Please install VLC manually from https://www.videolan.org/vlc/", "YTYT-Downloader", "OK", "Warning")
        Start-Process "https://www.videolan.org/vlc/"
    }
})

# Browser buttons
$btnChrome.Add_Click({ Show-BrowserLinks -Browser "Chrome" })
$btnFirefox.Add_Click({ Show-BrowserLinks -Browser "Firefox" })
$btnEdge.Add_Click({ Show-BrowserLinks -Browser "Edge" })
$btnSafari.Add_Click({ Show-BrowserLinks -Browser "Safari" })
$btnOpera.Add_Click({ Show-BrowserLinks -Browser "Opera" })

# Install Userscript button (YTYT-Downloader minimal)
$btnInstallUserscript.Add_Click({
    Start-Process $script:UserscriptUrl
})

# Install YTKit button (Full featured)
$btnInstallYTKit.Add_Click({
    Start-Process $script:YTKitUrl
})

# Open folder button
$btnOpenFolder.Add_Click({
    if (Test-Path $script:InstallPath) {
        $userscriptPath = Join-Path $script:InstallPath "YTYT-Downloader.user.js"
        if (Test-Path $userscriptPath) {
            Start-Process explorer.exe -ArgumentList "/select,`"$userscriptPath`""
        } else {
            Start-Process explorer.exe -ArgumentList $script:InstallPath
        }
    } else {
        [System.Windows.MessageBox]::Show("Install folder not found. Please complete Step 1 first.", "YTYT-Downloader", "OK", "Warning")
    }
})

# Back button
$btnBack.Add_Click({
    if ($script:CurrentStep -eq 4) {
        $script:CurrentStep = 1
        $tabWizard.SelectedIndex = 0
    } elseif ($script:CurrentStep -gt 1) {
        $script:CurrentStep--
        $tabWizard.SelectedIndex = $script:CurrentStep - 1
    }
    Update-WizardButtons
})

# Uninstall button (show uninstall tab)
$btnUninstall.Add_Click({
    $script:CurrentStep = 4
    $tabWizard.SelectedIndex = 3
    Update-WizardButtons
})

# Cancel uninstall
$btnCancelUninstall.Add_Click({
    $script:CurrentStep = 1
    $tabWizard.SelectedIndex = 0
    $btnNext.Visibility = "Visible"
    Update-WizardButtons
})

# Confirm uninstall
$btnConfirmUninstall.Add_Click({
    $result = [System.Windows.MessageBox]::Show(
        "Are you sure you want to uninstall YTYT-Downloader?`n`nThis will remove all components and cannot be undone.",
        "Confirm Uninstall",
        "YesNo",
        "Warning"
    )
    
    if ($result -eq "Yes") {
        try {
            # Force kill yt-dlp and ffmpeg processes
            Get-Process -Name "yt-dlp" -ErrorAction SilentlyContinue | Stop-Process -Force
            Get-Process -Name "ffmpeg" -ErrorAction SilentlyContinue | Stop-Process -Force
            Start-Sleep -Milliseconds 500
            
            # Remove protocol handlers
            Remove-Item -Path "HKCU:\Software\Classes\ytvlc" -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -Path "HKCU:\Software\Classes\ytvlcq" -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -Path "HKCU:\Software\Classes\ytdl" -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -Path "HKCU:\Software\Classes\ytmpv" -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -Path "HKCU:\Software\Classes\ytdlplay" -Recurse -Force -ErrorAction SilentlyContinue
            
            # Remove install directory
            if (Test-Path $script:InstallPath) {
                Remove-Item -Path $script:InstallPath -Recurse -Force
            }
            
            # Remove desktop shortcut
            $shortcutPath = "$env:USERPROFILE\Desktop\YouTube Download.lnk"
            if (Test-Path $shortcutPath) {
                Remove-Item $shortcutPath -Force
            }
            
            # Remove startup shortcut
            $startupPath = [Environment]::GetFolderPath('Startup')
            $serverShortcut = Join-Path $startupPath "YTYT-Server.lnk"
            if (Test-Path $serverShortcut) {
                Remove-Item $serverShortcut -Force
            }
            
            [System.Windows.MessageBox]::Show(
                "YTYT-Downloader has been uninstalled successfully.`n`nRemember to also remove the userscript from your browser's userscript manager.",
                "Uninstall Complete",
                "OK",
                "Information"
            )
            $window.Close()
        } catch {
            [System.Windows.MessageBox]::Show("Error during uninstall: $($_.Exception.Message)", "Error", "OK", "Error")
        }
    }
})

# Next button (main action button)
$btnNext.Add_Click({
    switch ($script:CurrentStep) {
        1 {
            if (-not $script:BaseToolsInstalled) {
                # Run installation
                $btnNext.IsEnabled = $false
                $btnBack.IsEnabled = $false
                $txtStatus.Text = "Starting installation..."
                Set-Progress 0
                
                try {
                    # Step 1: Create directories
                    Update-Status "Creating directories..."
                    Set-Progress 5
                    
                    if (!(Test-Path $script:InstallPath)) {
                        New-Item -ItemType Directory -Path $script:InstallPath -Force | Out-Null
                    }
                    Update-Status "  [OK] Install path: $($script:InstallPath)"
                    
                    $dlPath = $txtDownloadPath.Text
                    if (!(Test-Path $dlPath)) {
                        New-Item -ItemType Directory -Path $dlPath -Force | Out-Null
                    }
                    Update-Status "  [OK] Download path: $dlPath"
                    Set-Progress 10
                    
                    # Step 2: Download yt-dlp
                    Update-Status "Downloading yt-dlp..."
                    $ytdlpPath = Join-Path $script:InstallPath "yt-dlp.exe"
                    Invoke-WebRequest -Uri $script:YtDlpUrl -OutFile $ytdlpPath -UseBasicParsing
                    Update-Status "  [OK] Downloaded yt-dlp"
                    Set-Progress 25
                    
                    # Step 3: Download ffmpeg
                    Update-Status "Downloading ffmpeg (this may take a moment)..."
                    $ffmpegZipUrl = "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
                    $ffmpegZip = Join-Path $script:InstallPath "ffmpeg.zip"
                    $ffmpegPath = Join-Path $script:InstallPath "ffmpeg.exe"
                    
                    if (!(Test-Path $ffmpegPath)) {
                        try {
                            Invoke-WebRequest -Uri $ffmpegZipUrl -OutFile $ffmpegZip -UseBasicParsing
                            Update-Status "  [OK] Downloaded ffmpeg archive"
                            Update-Status "  Extracting ffmpeg..."
                            
                            Add-Type -AssemblyName System.IO.Compression.FileSystem
                            $zip = [System.IO.Compression.ZipFile]::OpenRead($ffmpegZip)
                            $ffmpegEntry = $zip.Entries | Where-Object { $_.Name -eq "ffmpeg.exe" } | Select-Object -First 1
                            if ($ffmpegEntry) {
                                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($ffmpegEntry, $ffmpegPath, $true)
                            }
                            $zip.Dispose()
                            Remove-Item $ffmpegZip -Force -ErrorAction SilentlyContinue
                            Update-Status "  [OK] Extracted ffmpeg"
                        } catch {
                            Update-Status "  [!] Warning: Could not download ffmpeg"
                            Update-Status "      You can install manually via: winget install ffmpeg"
                        }
                    } else {
                        Update-Status "  [OK] ffmpeg already exists"
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
                    Update-Status "  [OK] Configuration saved"
                    Set-Progress 45
                    
                    # Step 5: Create handlers
                    Update-Status "Creating protocol handlers..."
                    
                    # VLC Handler
                    $vlcHandler = @'
param([string]$url)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$configPath = Join-Path $PSScriptRoot "config.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$videoUrl = $url -replace '^ytvlc://', ''
$videoUrl = [System.Uri]::UnescapeDataString($videoUrl)

$videoId = $null
if ($videoUrl -match '[?&]v=([^&]+)') { $videoId = $matches[1] }
elseif ($videoUrl -match 'youtu\.be/([^?]+)') { $videoId = $matches[1] }

$isLive = $false
try {
    $webClient = New-Object System.Net.WebClient
    $webClient.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
    $pageContent = $webClient.DownloadString("https://www.youtube.com/watch?v=$videoId")
    if ($pageContent -match '"isLiveNow"\s*:\s*true') { $isLive = $true }
    $webClient.Dispose()
} catch { }

$videoTitle = "YouTube Video"
try {
    $titleOutput = & $config.YtDlpPath --get-title $videoUrl 2>$null
    if ($titleOutput) { $videoTitle = $titleOutput }
} catch { }

if ($isLive) {
    $vlcArgs = @("--no-video-title-show", "--meta-title=`"$videoTitle (LIVE)`"", $videoUrl)
    Start-Process -FilePath $config.VlcPath -ArgumentList $vlcArgs
} else {
    if ($config.AutoUpdate) {
        Start-Process -FilePath $config.YtDlpPath -ArgumentList "--update" -NoNewWindow -Wait -ErrorAction SilentlyContinue
    }
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
    }
}

if ($config.Notifications) {
    $iconPath = Join-Path $PSScriptRoot "icon.ico"
    $notify = New-Object System.Windows.Forms.NotifyIcon
    if (Test-Path $iconPath) {
        $notify.Icon = New-Object System.Drawing.Icon($iconPath)
    } else {
        $notify.Icon = [System.Drawing.SystemIcons]::Information
    }
    $notify.BalloonTipTitle = "YTYT-Downloader"
    $notify.BalloonTipText = "Playing: $videoTitle"
    $notify.Visible = $true
    $notify.ShowBalloonTip(3000)
    Start-Sleep -Seconds 3
    $notify.Dispose()
}
'@
                    $vlcHandler | Set-Content (Join-Path $script:InstallPath "ytvlc-handler.ps1") -Encoding UTF8
                    Update-Status "  [OK] VLC handler"
                    Set-Progress 50
                    
                    # Download Handler with Progress UI
                    $dlHandler = @'
param([string]$url)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

# Set console encoding to UTF-8 for proper character display
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$configPath = Join-Path $PSScriptRoot "config.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$videoUrl = $url -replace '^ytdl://', ''
$videoUrl = [System.Uri]::UnescapeDataString($videoUrl)

$audioOnly = $videoUrl -match "ytyt_audio_only=1|ytkit_audio_only=1"
$videoUrl = $videoUrl -replace "[&?]ytyt_audio_only=1", ""
$videoUrl = $videoUrl -replace "[&?]ytkit_audio_only=1", ""

# Extract video ID using comprehensive regex
$videoId = $null
$pattern = "(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^`"&?\/ ]{11})"
if ($videoUrl -match $pattern) {
    $videoId = $matches[1]
}

$iconPath = Join-Path $PSScriptRoot "icon.ico"
$progressFile = Join-Path $env:TEMP "ytyt_progress_$([guid]::NewGuid().ToString('N')).txt"

$form = New-Object System.Windows.Forms.Form
$form.Text = "YTYT Download"
$form.Size = New-Object System.Drawing.Size(420, 140)
$form.FormBorderStyle = "None"
$form.StartPosition = "Manual"
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 18, 18)
$form.TopMost = $true
$form.ShowInTaskbar = $false

# Stack windows if multiple downloads are running
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$baseX = $screen.Right - 436
$baseY = $screen.Bottom - 156

# Use temp file to track window positions
$stackFile = Join-Path $env:TEMP "ytyt_stack.txt"
$script:mySlot = 0

# Find an available slot (0-5)
for ($i = 0; $i -lt 6; $i++) {
    $slotFile = Join-Path $env:TEMP "ytyt_slot_$i.lock"
    if (!(Test-Path $slotFile)) {
        $script:mySlot = $i
        $videoId | Out-File $slotFile -Force
        break
    }
}

$offsetY = $script:mySlot * 150
$newY = $baseY - $offsetY
if ($newY -lt 50) { $newY = 50 }

$form.Location = New-Object System.Drawing.Point($baseX, $newY)

$script:dragStart = $null
$form.Add_MouseDown({ param($s,$e) if ($e.Button -eq "Left") { $script:dragStart = $e.Location } })
$form.Add_MouseMove({ param($s,$e) if ($script:dragStart) { $form.Location = [System.Drawing.Point]::new(($form.Location.X + $e.X - $script:dragStart.X), ($form.Location.Y + $e.Y - $script:dragStart.Y)) } })
$form.Add_MouseUp({ $script:dragStart = $null })

$lblHeader = New-Object System.Windows.Forms.Label
$lblHeader.Text = "YTYT Download"
$lblHeader.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$lblHeader.ForeColor = [System.Drawing.Color]::FromArgb(34, 197, 94)
$lblHeader.Location = New-Object System.Drawing.Point(16, 10)
$lblHeader.AutoSize = $true
$form.Controls.Add($lblHeader)

$btnMin = New-Object System.Windows.Forms.Label
$btnMin.Text = "_"
$btnMin.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$btnMin.ForeColor = [System.Drawing.Color]::Gray
$btnMin.Location = New-Object System.Drawing.Point(365, 8)
$btnMin.Size = New-Object System.Drawing.Size(20, 20)
$btnMin.Cursor = "Hand"
$btnMin.Add_Click({ $form.Hide() })
$btnMin.Add_MouseEnter({ $btnMin.ForeColor = [System.Drawing.Color]::White })
$btnMin.Add_MouseLeave({ $btnMin.ForeColor = [System.Drawing.Color]::Gray })
$form.Controls.Add($btnMin)

$btnClose = New-Object System.Windows.Forms.Label
$btnClose.Text = "X"
$btnClose.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$btnClose.ForeColor = [System.Drawing.Color]::Gray
$btnClose.Location = New-Object System.Drawing.Point(390, 10)
$btnClose.Size = New-Object System.Drawing.Size(20, 20)
$btnClose.Cursor = "Hand"
$btnClose.Add_Click({ $script:cancelled = $true; $form.Close() })
$btnClose.Add_MouseEnter({ $btnClose.ForeColor = [System.Drawing.Color]::Red })
$btnClose.Add_MouseLeave({ $btnClose.ForeColor = [System.Drawing.Color]::Gray })
$form.Controls.Add($btnClose)

$picThumb = New-Object System.Windows.Forms.PictureBox
$picThumb.Size = New-Object System.Drawing.Size(96, 54)
$picThumb.Location = New-Object System.Drawing.Point(16, 38)
$picThumb.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
$picThumb.SizeMode = "Zoom"
$form.Controls.Add($picThumb)

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "Fetching video info..."
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI Emoji", 9)
$lblTitle.ForeColor = [System.Drawing.Color]::White
$lblTitle.Location = New-Object System.Drawing.Point(120, 38)
$lblTitle.Size = New-Object System.Drawing.Size(280, 20)
$form.Controls.Add($lblTitle)

$pnlBg = New-Object System.Windows.Forms.Panel
$pnlBg.Size = New-Object System.Drawing.Size(230, 8)
$pnlBg.Location = New-Object System.Drawing.Point(120, 64)
$pnlBg.BackColor = [System.Drawing.Color]::FromArgb(50, 50, 50)
$form.Controls.Add($pnlBg)

$pnlFill = New-Object System.Windows.Forms.Panel
$pnlFill.Size = New-Object System.Drawing.Size(0, 8)
$pnlFill.Location = New-Object System.Drawing.Point(0, 0)
$pnlFill.BackColor = [System.Drawing.Color]::FromArgb(34, 197, 94)
$pnlBg.Controls.Add($pnlFill)

$lblPct = New-Object System.Windows.Forms.Label
$lblPct.Text = "0%"
$lblPct.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$lblPct.ForeColor = [System.Drawing.Color]::FromArgb(34, 197, 94)
$lblPct.Location = New-Object System.Drawing.Point(358, 61)
$lblPct.Size = New-Object System.Drawing.Size(45, 16)
$lblPct.TextAlign = "MiddleRight"
$form.Controls.Add($lblPct)

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = "Preparing..."
$lblStatus.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(150, 150, 150)
$lblStatus.Location = New-Object System.Drawing.Point(120, 80)
$lblStatus.Size = New-Object System.Drawing.Size(200, 16)
$form.Controls.Add($lblStatus)

$lblSpeed = New-Object System.Windows.Forms.Label
$lblSpeed.Text = ""
$lblSpeed.Font = New-Object System.Drawing.Font("Segoe UI", 8)
$lblSpeed.ForeColor = [System.Drawing.Color]::Gray
$lblSpeed.Location = New-Object System.Drawing.Point(120, 100)
$lblSpeed.Size = New-Object System.Drawing.Size(80, 14)
$form.Controls.Add($lblSpeed)

$lblEta = New-Object System.Windows.Forms.Label
$lblEta.Text = ""
$lblEta.Font = New-Object System.Drawing.Font("Segoe UI", 8)
$lblEta.ForeColor = [System.Drawing.Color]::Gray
$lblEta.Location = New-Object System.Drawing.Point(210, 100)
$lblEta.Size = New-Object System.Drawing.Size(80, 14)
$form.Controls.Add($lblEta)

$tray = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path $iconPath) { $tray.Icon = New-Object System.Drawing.Icon($iconPath) }
else { $tray.Icon = [System.Drawing.SystemIcons]::Application }
$tray.Text = "YTYT Download"
$tray.Visible = $true
$tray.Add_Click({ param($s,$e) if ($e.Button -eq "Left") { if ($form.Visible) { $form.Hide() } else { $form.Show(); $form.Activate() } } })

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.Items.Add("Show", $null, { $form.Show(); $form.Activate() }) | Out-Null
$menu.Items.Add("-") | Out-Null
$menu.Items.Add("Cancel", $null, { $script:cancelled = $true }) | Out-Null
$menu.Items.Add("Close", $null, { $form.Close() }) | Out-Null
$tray.ContextMenuStrip = $menu

if ($audioOnly) {
    $pnlFill.BackColor = [System.Drawing.Color]::MediumPurple
    $lblPct.ForeColor = [System.Drawing.Color]::MediumPurple
}

$script:cancelled = $false
$script:job = $null
$script:step = 0
$script:lastLine = 0
$script:retryCount = 0
$script:maxRetries = 3

# Force TLS 1.2 for YouTube
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

# Load thumbnail from img.youtube.com using WebClient
if ($videoId) {
    $thumbFile = Join-Path $env:TEMP "ytyt_thumb_$videoId.jpg"
    try {
        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        
        # Try maxresdefault first
        try {
            $wc.DownloadFile("https://img.youtube.com/vi/$videoId/maxresdefault.jpg", $thumbFile)
        } catch {
            # Fallback to hqdefault
            $wc.DownloadFile("https://img.youtube.com/vi/$videoId/hqdefault.jpg", $thumbFile)
        }
        $wc.Dispose()
        
        if (Test-Path $thumbFile) {
            # Load into MemoryStream to avoid file locking
            $bytes = [System.IO.File]::ReadAllBytes($thumbFile)
            $ms = New-Object System.IO.MemoryStream(,$bytes)
            $picThumb.Image = [System.Drawing.Image]::FromStream($ms)
            # Delete temp file immediately since we loaded into memory
            Remove-Item $thumbFile -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({
    try {
        if ($script:step -eq 0) {
            $lblStatus.Text = "Fetching video info..."
            $script:step = 1
        }
        elseif ($script:step -eq 1) {
            # Get title with proper UTF-8 encoding
            try {
                # Set console encoding to UTF-8 for yt-dlp output
                $prevEncoding = [Console]::OutputEncoding
                [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
                $titleResult = & $config.YtDlpPath --get-title --no-warnings --no-playlist --encoding utf-8 $videoUrl 2>$null
                [Console]::OutputEncoding = $prevEncoding
                if ($titleResult) {
                    $lblTitle.Text = $titleResult.Trim()
                    $tray.Text = "DL: " + $titleResult.Substring(0, [Math]::Min(45, $titleResult.Length))
                }
            } catch {}
            $script:step = 2
        }
        elseif ($script:step -eq 2) {
            # Start download as background job
            $lblStatus.Text = "Starting download..."
            
            $ffLoc = Split-Path $config.FfmpegPath -Parent
            $outTpl = Join-Path $config.DownloadPath "%(title)s.%(ext)s"
            $ytdlp = $config.YtDlpPath
            
            # Clear progress file
            "" | Set-Content $progressFile -Force
            
            if ($audioOnly) {
                $outTpl = Join-Path $config.DownloadPath "%(title)s.mp3"
                $lblStatus.Text = "Downloading audio..."
                $script:job = Start-Job -ScriptBlock {
                    param($ytdlp, $ffLoc, $outTpl, $vUrl, $outFile)
                    & $ytdlp -f bestaudio --extract-audio --audio-format mp3 --audio-quality 0 --newline --progress --ffmpeg-location $ffLoc -o $outTpl $vUrl 2>&1 | ForEach-Object { $_ | Out-File $outFile -Append -Encoding utf8; $_ }
                } -ArgumentList $ytdlp, $ffLoc, $outTpl, $videoUrl, $progressFile
            } else {
                $lblStatus.Text = "Downloading..."
                $script:job = Start-Job -ScriptBlock {
                    param($ytdlp, $ffLoc, $outTpl, $vUrl, $outFile)
                    & $ytdlp -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]" --merge-output-format mp4 --newline --progress --ffmpeg-location $ffLoc -o $outTpl $vUrl 2>&1 | ForEach-Object { $_ | Out-File $outFile -Append -Encoding utf8; $_ }
                } -ArgumentList $ytdlp, $ffLoc, $outTpl, $videoUrl, $progressFile
            }
            $script:step = 3
        }
        elseif ($script:step -eq 3) {
            # Read progress from file
            if (Test-Path $progressFile) {
                try {
                    $content = Get-Content $progressFile -Raw -ErrorAction SilentlyContinue
                    if ($content) {
                        # Find all percentage matches and use the last one
                        $allMatches = [regex]::Matches($content, '\[download\]\s+(\d+\.?\d*)%')
                        if ($allMatches.Count -gt 0) {
                            $lastMatch = $allMatches[$allMatches.Count - 1]
                            $pct = [double]$lastMatch.Groups[1].Value
                            $pnlFill.Width = [int](($pct / 100) * 230)
                            $lblPct.Text = [math]::Round($pct).ToString() + "%"
                        }
                        
                        # Get speed and ETA from last occurrence
                        if ($content -match '(?s).*of\s+~?(\d+\.?\d*\w+)\s+at\s+(\S+)\s+ETA\s+(\S+)') {
                            $lblStatus.Text = "Downloading ($($matches[1]))..."
                            $lblSpeed.Text = $matches[2]
                            $lblEta.Text = "ETA " + $matches[3]
                        }
                        
                        if ($content -match 'already been downloaded') {
                            $lblStatus.Text = "Already downloaded"
                            $pnlFill.Width = 230
                            $lblPct.Text = "100%"
                        }
                        elseif ($content -match '\[Merger\]|Merging formats') {
                            $lblStatus.Text = "Merging..."
                            $lblSpeed.Text = ""; $lblEta.Text = ""
                        }
                        elseif ($content -match '\[ExtractAudio\]') {
                            $lblStatus.Text = "Extracting audio..."
                        }
                    }
                } catch {}
            }
            
            # Check if cancelled
            if ($script:cancelled -and $script:job) {
                Stop-Job -Job $script:job -ErrorAction SilentlyContinue
                Remove-Job -Job $script:job -Force -ErrorAction SilentlyContinue
                $script:step = 4
                return
            }
            
            # Check if job completed
            if ($script:job -and $script:job.State -ne "Running") {
                $script:step = 4
            }
        }
        elseif ($script:step -eq 4) {
            $timer.Stop()
            
            # Get job result
            $jobOutput = ""
            if ($script:job) {
                $jobOutput = Receive-Job -Job $script:job -ErrorAction SilentlyContinue | Out-String
                Remove-Job -Job $script:job -Force -ErrorAction SilentlyContinue
            }
            
            # Cleanup progress file
            if (Test-Path $progressFile) { Remove-Item $progressFile -Force -ErrorAction SilentlyContinue }
            
            if ($script:cancelled) {
                $lblStatus.Text = "Cancelled"
                $lblStatus.ForeColor = [System.Drawing.Color]::Orange
                $tray.ShowBalloonTip(2000, "YTYT", "Cancelled", "Warning")
            } else {
                # Check for success indicators
                $progressContent = ""
                if (Test-Path $progressFile) { $progressContent = Get-Content $progressFile -Raw -ErrorAction SilentlyContinue }
                $allOutput = $jobOutput + $progressContent
                
                $success = ($allOutput -match "100%|has already been downloaded|Merging formats into|DelayedMuxer")
                
                if ($success) {
                    $pnlFill.Width = 230
                    $lblPct.Text = "100%"
                    $lblStatus.Text = "Complete!"
                    $lblStatus.ForeColor = [System.Drawing.Color]::LimeGreen
                    $lblSpeed.Text = ""; $lblEta.Text = ""
                    $tray.ShowBalloonTip(3000, "YTYT", "Download complete!", "Info")
                    $ct = New-Object System.Windows.Forms.Timer
                    $ct.Interval = 4000
                    $ct.Add_Tick({ $ct.Stop(); $form.Close() })
                    $ct.Start()
                } else {
                    # Retry logic
                    $script:retryCount++
                    if ($script:retryCount -lt $script:maxRetries) {
                        $lblStatus.Text = "Retrying ($($script:retryCount)/$($script:maxRetries))..."
                        $lblStatus.ForeColor = [System.Drawing.Color]::Orange
                        $pnlFill.Width = 0
                        $lblPct.Text = "0%"
                        $lblSpeed.Text = ""; $lblEta.Text = ""
                        $script:step = 2  # Go back to start download
                        $timer.Start()
                    } else {
                        $lblStatus.Text = "Failed after $($script:maxRetries) attempts"
                        $lblStatus.ForeColor = [System.Drawing.Color]::Red
                        $tray.ShowBalloonTip(3000, "YTYT", "Download failed", "Error")
                    }
                }
            }
        }
    } catch {
        $lblStatus.Text = "Error: $_"
        $lblStatus.ForeColor = [System.Drawing.Color]::Red
    }
})

$form.Add_Shown({ $timer.Start() })

# Position timer - check for lower available slots and move window down
$posTimer = New-Object System.Windows.Forms.Timer
$posTimer.Interval = 2000
$posTimer.Add_Tick({
    # Check if a lower slot is available
    for ($i = 0; $i -lt $script:mySlot; $i++) {
        $checkSlot = Join-Path $env:TEMP "ytyt_slot_$i.lock"
        if (!(Test-Path $checkSlot)) {
            # Lower slot available - claim it and move down
            $oldSlotFile = Join-Path $env:TEMP "ytyt_slot_$($script:mySlot).lock"
            if (Test-Path $oldSlotFile) { Remove-Item $oldSlotFile -Force -ErrorAction SilentlyContinue }
            
            $script:mySlot = $i
            $videoId | Out-File $checkSlot -Force
            
            # Recalculate position
            $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
            $baseY = $screen.Bottom - 156
            $newY = $baseY - ($script:mySlot * 150)
            if ($newY -lt 50) { $newY = 50 }
            
            $form.Location = New-Object System.Drawing.Point($form.Location.X, $newY)
            break
        }
    }
})
$posTimer.Start()

$form.Add_FormClosed({
    $timer.Stop()
    $posTimer.Stop()
    if ($script:job) { 
        Stop-Job -Job $script:job -ErrorAction SilentlyContinue
        Remove-Job -Job $script:job -Force -ErrorAction SilentlyContinue 
    }
    if (Test-Path $progressFile) { Remove-Item $progressFile -Force -ErrorAction SilentlyContinue }
    # Release slot for window stacking
    $slotFile = Join-Path $env:TEMP "ytyt_slot_$($script:mySlot).lock"
    if (Test-Path $slotFile) { Remove-Item $slotFile -Force -ErrorAction SilentlyContinue }
    $tray.Visible = $false
    $tray.Dispose()
})

[System.Windows.Forms.Application]::Run($form)
'@
                    $dlHandler | Set-Content (Join-Path $script:InstallPath "ytdl-handler.ps1") -Encoding UTF8
                    Update-Status "  [OK] Download handler (with progress UI)"
                    Set-Progress 55
                    
                    # VLC Queue Handler
                    $vlcQueueHandler = @'
param([string]$url)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$configPath = Join-Path $PSScriptRoot "config.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$videoUrl = $url -replace '^ytvlcq://', ''
$videoUrl = [System.Uri]::UnescapeDataString($videoUrl)

$videoTitle = "YouTube Video"
try {
    $titleOutput = & $config.YtDlpPath --get-title $videoUrl 2>$null
    if ($titleOutput) { $videoTitle = $titleOutput }
} catch { }

$vlcProcess = Get-Process -Name "vlc" -ErrorAction SilentlyContinue
$streams = & $config.YtDlpPath -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]" -g $videoUrl 2>$null

if ($streams) {
    $streamArray = $streams -split "`n" | Where-Object { $_ -match "^http" }
    if ($vlcProcess) {
        $vlcArgs = @("--playlist-enqueue", "--no-video-title-show", "--meta-title=`"$videoTitle`"")
    } else {
        $vlcArgs = @("--no-video-title-show", "--meta-title=`"$videoTitle`"")
    }
    if ($streamArray.Count -ge 2) {
        $vlcArgs += "`"$($streamArray[0])`""
        $vlcArgs += "--input-slave=`"$($streamArray[1])`""
    } else {
        $vlcArgs += "`"$($streamArray[0])`""
    }
    Start-Process -FilePath $config.VlcPath -ArgumentList $vlcArgs
}

if ($config.Notifications) {
    $iconPath = Join-Path $PSScriptRoot "icon.ico"
    $notify = New-Object System.Windows.Forms.NotifyIcon
    if (Test-Path $iconPath) {
        $notify.Icon = New-Object System.Drawing.Icon($iconPath)
    } else {
        $notify.Icon = [System.Drawing.SystemIcons]::Information
    }
    $notify.BalloonTipTitle = "YTYT-Downloader"
    $notify.BalloonTipText = if ($vlcProcess) { "Added to queue: $videoTitle" } else { "Playing: $videoTitle" }
    $notify.Visible = $true
    $notify.ShowBalloonTip(2000)
    Start-Sleep -Seconds 2
    $notify.Dispose()
}
'@
                    $vlcQueueHandler | Set-Content (Join-Path $script:InstallPath "ytvlcq-handler.ps1") -Encoding UTF8
                    Update-Status "  [OK] VLC queue handler"
                    Set-Progress 60
                    
                    # Download icon for notifications
                    Update-Status "Downloading application icon..."
                    $notifyIconPath = Join-Path $script:InstallPath "icon.ico"
                    Download-Image -Url $script:IconUrl -OutPath $notifyIconPath | Out-Null
                    Update-Status "  [OK] Application icon"
                    Set-Progress 65
                    
                    # Step 6: Create VBS launchers
                    Update-Status "Creating silent launchers..."
                    $vbsTemplate = @'
Set objShell = CreateObject("WScript.Shell")
objShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{SCRIPT}"" """ & WScript.Arguments(0) & """", 0, False
'@
                    @("ytvlc", "ytvlcq", "ytdl") | ForEach-Object {
                        $vbs = $vbsTemplate -replace '{SCRIPT}', (Join-Path $script:InstallPath "$_-handler.ps1")
                        $vbs | Set-Content (Join-Path $script:InstallPath "$_-launcher.vbs") -Encoding ASCII
                    }
                    Update-Status "  [OK] Silent launchers created"
                    Set-Progress 70
                    
                    # Step 7: Register protocols
                    Update-Status "Registering URL protocols..."
                    
                    # ytvlc://
                    $protocolRoot = "HKCU:\Software\Classes\ytvlc"
                    New-Item -Path $protocolRoot -Force | Out-Null
                    Set-ItemProperty -Path $protocolRoot -Name "(Default)" -Value "URL:YTVLC Protocol"
                    Set-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value ""
                    New-Item -Path "$protocolRoot\shell\open\command" -Force | Out-Null
                    Set-ItemProperty -Path "$protocolRoot\shell\open\command" -Name "(Default)" -Value "wscript.exe `"$(Join-Path $script:InstallPath 'ytvlc-launcher.vbs')`" `"%1`""
                    
                    # ytvlcq://
                    $protocolRoot = "HKCU:\Software\Classes\ytvlcq"
                    New-Item -Path $protocolRoot -Force | Out-Null
                    Set-ItemProperty -Path $protocolRoot -Name "(Default)" -Value "URL:YTVLCQ Protocol"
                    Set-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value ""
                    New-Item -Path "$protocolRoot\shell\open\command" -Force | Out-Null
                    Set-ItemProperty -Path "$protocolRoot\shell\open\command" -Name "(Default)" -Value "wscript.exe `"$(Join-Path $script:InstallPath 'ytvlcq-launcher.vbs')`" `"%1`""
                    
                    # ytdl://
                    $protocolRoot = "HKCU:\Software\Classes\ytdl"
                    New-Item -Path $protocolRoot -Force | Out-Null
                    Set-ItemProperty -Path $protocolRoot -Name "(Default)" -Value "URL:YTDL Protocol"
                    Set-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value ""
                    New-Item -Path "$protocolRoot\shell\open\command" -Force | Out-Null
                    Set-ItemProperty -Path "$protocolRoot\shell\open\command" -Name "(Default)" -Value "wscript.exe `"$(Join-Path $script:InstallPath 'ytdl-launcher.vbs')`" `"%1`""
                    
                    Update-Status "  [OK] Registered: ytvlc://, ytvlcq://, ytdl://"
                    Set-Progress 80
                    
                    # Step 8: Create userscript
                    Update-Status "Creating userscript..."
                    $userscript = @'
// ==UserScript==
// @name         YTYT-Downloader
// @namespace    https://github.com/SysAdminDoc/ytyt-downloader
// @version      2.0.0
// @description  Stream YouTube to VLC or download video/audio/transcript with yt-dlp
// @author       SysAdminDoc
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// @homepageURL  https://github.com/SysAdminDoc/ytyt-downloader
// @supportURL   https://github.com/SysAdminDoc/ytyt-downloader/issues
// ==/UserScript==

(function() {
    'use strict';
    const DEFAULT_SETTINGS = { showVLC: false, showVideo: true, showAudio: true, showTranscript: true };
    function getSettings() { try { const s = GM_getValue('ytyt_settings', null); if (s) return { ...DEFAULT_SETTINGS, ...JSON.parse(s) }; } catch (e) {} return { ...DEFAULT_SETTINGS }; }
    function saveSettings(s) { try { GM_setValue('ytyt_settings', JSON.stringify(s)); } catch (e) {} }
    let settings = getSettings();

    const styleSheet = document.createElement('style');
    styleSheet.textContent = '.ytyt-container{position:relative!important;display:inline-flex!important;align-items:center!important}.ytyt-settings-panel{position:absolute!important;top:100%!important;right:0!important;margin-top:8px!important;background:#1f2937!important;border:1px solid #374151!important;border-radius:12px!important;padding:16px!important;min-width:200px!important;z-index:9999!important;box-shadow:0 10px 25px rgba(0,0,0,0.5)!important}.ytyt-settings-title{margin:0 0 12px 0!important;color:#f3f4f6!important;font-size:14px!important;font-weight:600!important}.ytyt-settings-item{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:8px 0!important;color:#d1d5db!important;font-size:13px!important}.ytyt-toggle{position:relative!important;width:40px!important;height:22px!important;background:#374151!important;border-radius:11px!important;cursor:pointer!important;transition:background 0.2s!important}.ytyt-toggle.active{background:#22c55e!important}.ytyt-toggle::after{content:""!important;position:absolute!important;top:2px!important;left:2px!important;width:18px!important;height:18px!important;background:white!important;border-radius:50%!important;transition:left 0.2s!important}.ytyt-toggle.active::after{left:20px!important}';
    (document.head || document.documentElement).appendChild(styleSheet);

    function createSvg(d, f='white') { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '20'); s.setAttribute('height', '20'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); p.setAttribute('fill', f); s.appendChild(p); return s; }
    function getCurrentVideoId() { const u = new URLSearchParams(window.location.search).get('v'); if (u) return u; const m = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/); return m ? m[1] : null; }
    function getCurrentVideoUrl() { const id = getCurrentVideoId(); return id ? 'https://www.youtube.com/watch?v=' + id : null; }
    function openInVLC() { const u = getCurrentVideoUrl(); if (u) window.location.href = 'ytvlc://' + encodeURIComponent(u); }
    function downloadVideo() { const u = getCurrentVideoUrl(); if (u) window.location.href = 'ytdl://' + encodeURIComponent(u); }
    function downloadAudio() { const u = getCurrentVideoUrl(); if (u) window.location.href = 'ytdl://' + encodeURIComponent(u) + '?ytyt_audio_only=1'; }

    async function downloadTranscript() {
        const videoId = getCurrentVideoId(); if (!videoId) return;
        try {
            const response = await fetch(window.location.href); const html = await response.text();
            const tracksMatch = html.match(/"captionTracks":\s*(\[.*?\])/s); let captionTracks = [];
            if (tracksMatch) { try { let j = tracksMatch[1], d = 0, e = 0; for (let i = 0; i < j.length; i++) { if (j[i] === '[') d++; if (j[i] === ']') d--; if (d === 0) { e = i + 1; break; } } captionTracks = JSON.parse(j.substring(0, e)); } catch (e) {} }
            if (captionTracks.length === 0) { alert('No transcript available.'); return; }
            let track = captionTracks.find(t => t.languageCode === 'en' || t.languageCode?.startsWith('en')) || captionTracks[0];
            if (!track?.baseUrl) { alert('Could not find transcript URL.'); return; }
            const transcriptXml = await (await fetch(track.baseUrl)).text();
            const xmlDoc = new DOMParser().parseFromString(transcriptXml, 'text/xml');
            const textElements = xmlDoc.querySelectorAll('text'); if (textElements.length === 0) { alert('Transcript is empty.'); return; }
            let title = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent || document.title.replace(' - YouTube', '') || 'transcript';
            title = title.replace(/[<>:"/\\|?*]/g, '').trim();
            let txt = 'Transcript: ' + title + '\nVideo: ' + getCurrentVideoUrl() + '\n' + '='.repeat(50) + '\n\n';
            textElements.forEach(el => { const s = parseFloat(el.getAttribute('start') || 0); const t = el.textContent.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/\n/g, ' ').trim(); if (t) { const m = Math.floor(s / 60), sec = Math.floor(s % 60); txt += '[' + m.toString().padStart(2, '0') + ':' + sec.toString().padStart(2, '0') + '] ' + t + '\n'; } });
            const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = title + '_transcript.txt'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        } catch (error) { alert('Failed to download transcript.'); }
    }

    function buttonsExist() { return document.querySelector('.ytyt-container') !== null; }
    function removeButtons() { document.querySelectorAll('.ytyt-container').forEach(el => el.remove()); }

    function createSettingsPanel() {
        const panel = document.createElement('div'); panel.className = 'ytyt-settings-panel';
        const title = document.createElement('div'); title.className = 'ytyt-settings-title'; title.textContent = 'YTYT Settings'; panel.appendChild(title);
        [{ key: 'showVLC', label: 'VLC Button' }, { key: 'showVideo', label: 'Video Download' }, { key: 'showAudio', label: 'Audio Download' }, { key: 'showTranscript', label: 'Transcript' }].forEach(({ key, label }) => {
            const item = document.createElement('div'); item.className = 'ytyt-settings-item';
            const labelSpan = document.createElement('span'); labelSpan.textContent = label; item.appendChild(labelSpan);
            const toggle = document.createElement('div'); toggle.className = 'ytyt-toggle' + (settings[key] ? ' active' : ''); toggle.dataset.setting = key;
            toggle.addEventListener('click', (e) => { e.stopPropagation(); settings[key] = !settings[key]; toggle.classList.toggle('active'); saveSettings(settings); removeButtons(); setTimeout(createButtons, 100); });
            item.appendChild(toggle); panel.appendChild(item);
        });
        return panel;
    }

    function createButton(cls, ttl, bg, hv, icon, lbl, onClick) {
        const btn = document.createElement('button'); btn.className = cls; btn.title = ttl;
        btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:36px;margin-left:8px;border-radius:18px;border:none;background:'+bg+';color:white;font-family:"Roboto","Arial",sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:background 0.2s;';
        btn.onmouseenter = () => { btn.style.background = hv; }; btn.onmouseleave = () => { btn.style.background = bg; };
        btn.appendChild(createSvg(icon)); btn.appendChild(document.createTextNode(' ' + lbl));
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
        return btn;
    }

    function createButtons() {
        if (!getCurrentVideoId() || buttonsExist()) return buttonsExist();
        const selectors = ['#top-level-buttons-computed', 'ytd-menu-renderer.ytd-watch-metadata #top-level-buttons-computed', '#actions ytd-menu-renderer #top-level-buttons-computed'];
        let actionBar = null; for (const sel of selectors) { actionBar = document.querySelector(sel); if (actionBar && actionBar.offsetParent !== null) break; }
        if (!actionBar) return false;

        const container = document.createElement('div'); container.className = 'ytyt-container';
        if (settings.showVLC) container.appendChild(createButton('ytyt-vlc-btn', 'Stream in VLC', '#f97316', '#ea580c', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z', 'VLC', openInVLC));
        if (settings.showVideo) container.appendChild(createButton('ytyt-video-btn', 'Download Video', '#22c55e', '#16a34a', 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z', 'Video', downloadVideo));
        if (settings.showAudio) container.appendChild(createButton('ytyt-audio-btn', 'Download MP3', '#8b5cf6', '#7c3aed', 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z', 'MP3', downloadAudio));
        if (settings.showTranscript) container.appendChild(createButton('ytyt-transcript-btn', 'Download Transcript', '#3b82f6', '#2563eb', 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z', 'TXT', downloadTranscript));

        const settingsBtn = document.createElement('button'); settingsBtn.className = 'ytyt-settings-btn'; settingsBtn.title = 'YTYT Settings';
        settingsBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;margin-left:8px;border-radius:50%;border:none;background:#374151;cursor:pointer;transition:background 0.2s;';
        settingsBtn.onmouseenter = () => { settingsBtn.style.background = '#4b5563'; }; settingsBtn.onmouseleave = () => { settingsBtn.style.background = '#374151'; };
        settingsBtn.appendChild(createSvg('M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z', '#9ca3af'));
        let panelVisible = false, settingsPanel = null;
        settingsBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation();
            if (panelVisible && settingsPanel) { settingsPanel.remove(); settingsPanel = null; panelVisible = false; }
            else { settingsPanel = createSettingsPanel(); container.appendChild(settingsPanel); panelVisible = true;
                const closePanel = (evt) => { if (settingsPanel && !settingsPanel.contains(evt.target) && evt.target !== settingsBtn) { settingsPanel.remove(); settingsPanel = null; panelVisible = false; document.removeEventListener('click', closePanel); } };
                setTimeout(() => document.addEventListener('click', closePanel), 10); }
        });
        container.appendChild(settingsBtn); actionBar.appendChild(container); return true;
    }

    let retryCount = 0;
    function tryCreateButtons() { if (createButtons()) { retryCount = 0; return; } if (retryCount < 15) { retryCount++; setTimeout(tryCreateButtons, Math.min(500 * Math.pow(1.5, retryCount - 1), 3000)); } else retryCount = 0; }
    let currentVideoId = null;
    function handleNavigation() { const newId = getCurrentVideoId(); if (newId !== currentVideoId) { currentVideoId = newId; removeButtons(); retryCount = 0; if (newId) setTimeout(tryCreateButtons, 500); } else if (newId && !buttonsExist()) tryCreateButtons(); }
    function init() { handleNavigation(); new MutationObserver(() => { if (getCurrentVideoId() && !buttonsExist()) { clearTimeout(window.ytytDebounce); window.ytytDebounce = setTimeout(handleNavigation, 300); } }).observe(document.body || document.documentElement, { childList: true, subtree: true }); window.addEventListener('yt-navigate-finish', () => setTimeout(handleNavigation, 500)); window.addEventListener('yt-navigate-start', removeButtons); window.addEventListener('popstate', () => setTimeout(handleNavigation, 500)); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    window.addEventListener('load', () => setTimeout(handleNavigation, 1000));
})();
'@
                    $userscript | Set-Content (Join-Path $script:InstallPath "YTYT-Downloader.user.js") -Encoding UTF8
                    Update-Status "  [OK] Userscript created"
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
                        Update-Status "  [OK] Desktop shortcut created"
                    }
                    
                    Set-Progress 100
                    Update-Status ""
                    Update-Status "========================================"
                    Update-Status "Base tools installation complete!"
                    Update-Status "========================================"
                    
                    $script:BaseToolsInstalled = $true
                    $btnNext.Content = "Next: Userscript Manager"
                    
                } catch {
                    Update-Status ""
                    Update-Status "[ERROR] $($_.Exception.Message)"
                    [System.Windows.MessageBox]::Show("Installation failed:`n`n$($_.Exception.Message)", "Error", "OK", "Error")
                }
                
                $btnNext.IsEnabled = $true
                $btnBack.IsEnabled = $true
            } else {
                # Move to step 2
                $script:CurrentStep = 2
                $tabWizard.SelectedIndex = 1
                Update-WizardButtons
            }
        }
        2 {
            # Move to step 3
            $script:CurrentStep = 3
            $tabWizard.SelectedIndex = 2
            Update-WizardButtons
        }
        3 {
            # Finish - close window
            $window.Close()
        }
    }
})

# Initialize
Update-WizardButtons

# Show the window
$window.ShowDialog() | Out-Null

# Cleanup temp files
Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
