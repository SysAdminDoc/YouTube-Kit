<#
.SYNOPSIS
    YTYT-Downloader Installer - Professional setup wizard for VLC streaming and video downloading
.DESCRIPTION
    Installs and configures:
    - yt-dlp (auto-download)
    - ffmpeg (auto-download)
    - VLC protocol handler (ytvlc://)
    - Download protocol handler (ytdl://)
    - Ollama local LLM (optional, for use with Chapterizer)
    - Userscript/extension for YouTube integration
.NOTES
    Author: SysAdminDoc
    Version: 2.5.0
    Repository: https://github.com/SysAdminDoc/YouTube-Kit
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
$script:AppVersion = "2.5.0"
$script:InstallPath = "$env:LOCALAPPDATA\YTYT-Downloader"
$script:YtDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
$script:DefaultDownloadPath = "$env:USERPROFILE\Videos\YouTube"
$script:GitHubRepo = "https://github.com/SysAdminDoc/YouTube-Kit"
$script:YTKitUrl = "https://github.com/SysAdminDoc/YouTube-Kit/raw/refs/heads/main/YTKit.user.js"

# Ollama Configuration
$script:OllamaInstallerUrl = "https://ollama.com/download/OllamaSetup.exe"
$script:OllamaModels = [ordered]@{
    "qwen3:32b"    = "128K context, hybrid reasoning (20 GB) - Recommended"
}

# Image URLs
$script:IconUrl = "https://raw.githubusercontent.com/SysAdminDoc/YouTube-Kit/main/images/icons/ytyticn.ico"
$script:LogoUrl = "https://raw.githubusercontent.com/SysAdminDoc/YouTube-Kit/main/images/ytytfull.png"
$script:IconPngUrl = "https://raw.githubusercontent.com/SysAdminDoc/YouTube-Kit/main/images/icons/ytyticn-128x128.png"

# Browser icon URLs
# ScriptVault (userscript manager extension)
$script:ScriptVaultUrl = "https://chromewebstore.google.com/detail/scriptvault/jlhdbkeijcbgnonpfkfkkkhfmbeejkgh"

# ============================================
# ASSEMBLIES
# ============================================
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

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
    
    # Kill MediaDL server (PowerShell listening on port 9751)
    try {
        $serverProcs = Get-NetTCPConnection -LocalPort 9751 -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object { Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue }
        $serverProcs | Stop-Process -Force -ErrorAction SilentlyContinue
    } catch {}
    
    # Remove MediaDL-Server scheduled task
    try { Unregister-ScheduledTask -TaskName "MediaDL-Server" -Confirm:$false -ErrorAction SilentlyContinue } catch {}
    
    Start-Sleep -Milliseconds 500
    
    # Remove protocol handlers
    @("ytvlc", "ytvlcq", "ytdl", "ytmpv", "ytdlplay", "mediadl") | ForEach-Object {
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
    
    # Remove startup shortcuts (including Ollama)
    $startupPath = [Environment]::GetFolderPath('Startup')
    @("YTYT-Server.lnk", "MediaDL-Server.lnk", "Ollama.lnk") | ForEach-Object {
        $s = Join-Path $startupPath $_
        if (Test-Path $s) { Remove-Item $s -Force -ErrorAction SilentlyContinue }
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

# Check for Ollama
$ollamaPaths = @(
    "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
    "$env:ProgramFiles\Ollama\ollama.exe",
    "$env:USERPROFILE\AppData\Local\Programs\Ollama\ollama.exe"
)
$script:OllamaFound = $null
foreach ($path in $ollamaPaths) {
    if (Test-Path $path) {
        $script:OllamaFound = $path
        break
    }
}
# Also check PATH
if (-not $script:OllamaFound) {
    $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
    if ($ollamaCmd) { $script:OllamaFound = $ollamaCmd.Source }
}

# Check if Ollama is running and get installed models
$script:OllamaRunning = $false
$script:OllamaInstalledModels = @()
if ($script:OllamaFound) {
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($response.models) {
            $script:OllamaRunning = $true
            $script:OllamaInstalledModels = $response.models | ForEach-Object { $_.name }
        }
    } catch {
        $script:OllamaRunning = $false
    }
}

# ============================================
# XAML GUI DEFINITION
# ============================================
[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="YTYT-Downloader Setup" Width="900"
        WindowStartupLocation="CenterScreen" ResizeMode="CanResizeWithGrip"
        WindowState="Normal" SizeToContent="Manual"
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
        
        <!-- ComboBox Toggle Button Template (required for dark dropdown) -->
        <ControlTemplate x:Key="ComboBoxToggleButton" TargetType="ToggleButton">
            <Grid>
                <Grid.ColumnDefinitions>
                    <ColumnDefinition/>
                    <ColumnDefinition Width="20"/>
                </Grid.ColumnDefinitions>
                <Border x:Name="Border" Grid.ColumnSpan="2" Background="#141414" BorderBrush="#2a2a2a" BorderThickness="1" CornerRadius="6"/>
                <Border Grid.Column="0" Background="#141414" BorderBrush="Transparent" BorderThickness="0" CornerRadius="6,0,0,6" Margin="1"/>
                <Path x:Name="Arrow" Grid.Column="1" Fill="#a1a1aa" HorizontalAlignment="Center" VerticalAlignment="Center" Data="M0,0 L4,4 L8,0 Z"/>
            </Grid>
            <ControlTemplate.Triggers>
                <Trigger Property="IsMouseOver" Value="True">
                    <Setter TargetName="Border" Property="Background" Value="#1f1f1f"/>
                    <Setter TargetName="Border" Property="BorderBrush" Value="#22c55e"/>
                </Trigger>
                <Trigger Property="IsChecked" Value="True">
                    <Setter TargetName="Border" Property="Background" Value="#1f1f1f"/>
                </Trigger>
            </ControlTemplate.Triggers>
        </ControlTemplate>
        
        <!-- ComboBox Full Template -->
        <ControlTemplate x:Key="ComboBoxTemplate" TargetType="ComboBox">
            <Grid>
                <ToggleButton Name="ToggleButton" Template="{StaticResource ComboBoxToggleButton}" 
                              Focusable="False" ClickMode="Press"
                              IsChecked="{Binding Path=IsDropDownOpen, Mode=TwoWay, RelativeSource={RelativeSource TemplatedParent}}"/>
                <ContentPresenter Name="ContentSite" IsHitTestVisible="False" 
                                  Content="{TemplateBinding SelectionBoxItem}" 
                                  ContentTemplate="{TemplateBinding SelectionBoxItemTemplate}" 
                                  ContentTemplateSelector="{TemplateBinding ItemTemplateSelector}" 
                                  Margin="8,3,25,3" VerticalAlignment="Center" HorizontalAlignment="Left"/>
                <Popup Name="Popup" Placement="Bottom" IsOpen="{TemplateBinding IsDropDownOpen}" 
                       AllowsTransparency="True" Focusable="False" PopupAnimation="Slide">
                    <Grid Name="DropDown" SnapsToDevicePixels="True" 
                          MinWidth="{TemplateBinding ActualWidth}" MaxHeight="{TemplateBinding MaxDropDownHeight}">
                        <Border x:Name="DropDownBorder" Background="#141414" BorderThickness="1" BorderBrush="#2a2a2a" CornerRadius="6">
                            <Border.Effect>
                                <DropShadowEffect Color="Black" BlurRadius="12" ShadowDepth="3" Opacity="0.6"/>
                            </Border.Effect>
                        </Border>
                        <ScrollViewer Margin="4,6,4,6" SnapsToDevicePixels="True">
                            <StackPanel IsItemsHost="True" KeyboardNavigation.DirectionalNavigation="Contained"/>
                        </ScrollViewer>
                    </Grid>
                </Popup>
            </Grid>
        </ControlTemplate>
        
        <!-- ComboBox Style -->
        <Style TargetType="ComboBox">
            <Setter Property="Foreground" Value="#fafafa"/>
            <Setter Property="Background" Value="#141414"/>
            <Setter Property="BorderBrush" Value="#2a2a2a"/>
            <Setter Property="FontFamily" Value="Segoe UI"/>
            <Setter Property="FontSize" Value="13"/>
            <Setter Property="Height" Value="34"/>
            <Setter Property="SnapsToDevicePixels" Value="True"/>
            <Setter Property="ScrollViewer.HorizontalScrollBarVisibility" Value="Auto"/>
            <Setter Property="ScrollViewer.VerticalScrollBarVisibility" Value="Auto"/>
            <Setter Property="Template" Value="{StaticResource ComboBoxTemplate}"/>
        </Style>
        
        <!-- ComboBoxItem Style -->
        <Style TargetType="ComboBoxItem">
            <Setter Property="Foreground" Value="#fafafa"/>
            <Setter Property="Background" Value="Transparent"/>
            <Setter Property="Padding" Value="8,6"/>
            <Setter Property="FontFamily" Value="Segoe UI"/>
            <Setter Property="FontSize" Value="13"/>
            <Setter Property="Cursor" Value="Hand"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="ComboBoxItem">
                        <Border x:Name="Bd" Background="{TemplateBinding Background}" Padding="{TemplateBinding Padding}" CornerRadius="4" Margin="0,1">
                            <ContentPresenter/>
                        </Border>
                        <ControlTemplate.Triggers>
                            <Trigger Property="IsHighlighted" Value="True">
                                <Setter TargetName="Bd" Property="Background" Value="#1f1f1f"/>
                            </Trigger>
                            <Trigger Property="IsMouseOver" Value="True">
                                <Setter TargetName="Bd" Property="Background" Value="#1f1f1f"/>
                            </Trigger>
                            <Trigger Property="IsSelected" Value="True">
                                <Setter TargetName="Bd" Property="Background" Value="#22c55e"/>
                                <Setter Property="Foreground" Value="#0a0a0a"/>
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>

        <!-- Dark Scrollbar -->
        <Style TargetType="ScrollBar">
            <Setter Property="Background" Value="Transparent"/>
            <Setter Property="Width" Value="10"/>
            <Setter Property="MinWidth" Value="10"/>
        </Style>
        <Style x:Key="ScrollThumb" TargetType="Thumb">
            <Setter Property="Background" Value="#333333"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Thumb">
                        <Border Background="{TemplateBinding Background}" CornerRadius="5" Margin="1"/>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
            <Style.Triggers>
                <Trigger Property="IsMouseOver" Value="True">
                    <Setter Property="Background" Value="#555555"/>
                </Trigger>
            </Style.Triggers>
        </Style>
        <Style TargetType="ScrollViewer">
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="ScrollViewer">
                        <Grid>
                            <Grid.ColumnDefinitions>
                                <ColumnDefinition Width="*"/>
                                <ColumnDefinition Width="Auto"/>
                            </Grid.ColumnDefinitions>
                            <ScrollContentPresenter Grid.Column="0"/>
                            <ScrollBar x:Name="PART_VerticalScrollBar" Grid.Column="1"
                                       Value="{TemplateBinding VerticalOffset}" Maximum="{TemplateBinding ScrollableHeight}"
                                       ViewportSize="{TemplateBinding ViewportHeight}"
                                       Visibility="{TemplateBinding ComputedVerticalScrollBarVisibility}"
                                       Background="Transparent" Width="10">
                                <ScrollBar.Template>
                                    <ControlTemplate TargetType="ScrollBar">
                                        <Track x:Name="PART_Track" IsDirectionReversed="True">
                                            <Track.Thumb>
                                                <Thumb Style="{StaticResource ScrollThumb}"/>
                                            </Track.Thumb>
                                        </Track>
                                    </ControlTemplate>
                                </ScrollBar.Template>
                            </ScrollBar>
                        </Grid>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
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
                
                <TextBlock Grid.Column="2" Text="v2.5.0" FontSize="12" Foreground="{StaticResource TextMuted}" VerticalAlignment="Top" FontFamily="Segoe UI Semibold"/>
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
                <ScrollViewer VerticalScrollBarVisibility="Auto">
                <Grid Margin="24,16">
                    <Grid.RowDefinitions>
                        <RowDefinition Height="Auto"/>
                        <RowDefinition Height="Auto"/>
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
                            <!-- VLC Streaming (Optional) -->
                            <TextBlock Text="VLC Streaming (Optional)" FontSize="12" Foreground="{StaticResource TextSecondary}" Margin="0,0,0,8"/>
                            <Border Background="{StaticResource BgCard}" BorderBrush="{StaticResource Border}" BorderThickness="1" CornerRadius="8" Padding="16" Margin="0,0,0,12">
                                <StackPanel>
                                    <Grid Margin="0,0,0,8">
                                        <Grid.ColumnDefinitions>
                                            <ColumnDefinition Width="Auto"/>
                                            <ColumnDefinition Width="*"/>
                                            <ColumnDefinition Width="Auto"/>
                                        </Grid.ColumnDefinitions>
                                        <Ellipse x:Name="vlcIndicator" Width="10" Height="10" Fill="{StaticResource AccentRed}" VerticalAlignment="Center" Margin="0,0,10,0"/>
                                        <StackPanel Grid.Column="1" VerticalAlignment="Center">
                                            <TextBlock Text="VLC Media Player" FontSize="12" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}"/>
                                            <TextBlock x:Name="txtVlcStatus" Text="Not detected" FontSize="10" Foreground="{StaticResource TextSecondary}"/>
                                        </StackPanel>
                                        <Button x:Name="btnInstallVlc" Content="Install" Grid.Column="2" Style="{StaticResource SecondaryButton}" Padding="10,4" FontSize="11"/>
                                    </Grid>
                                    <CheckBox x:Name="chkInstallVlc" Content="Enable VLC streaming (install via winget if needed)" IsChecked="False" Margin="0,0,0,6"/>
                                    <TextBlock Text="VLC Path" FontSize="11" Foreground="{StaticResource TextMuted}" Margin="0,0,0,4"/>
                                    <Grid>
                                        <Grid.ColumnDefinitions>
                                            <ColumnDefinition Width="*"/>
                                            <ColumnDefinition Width="Auto"/>
                                        </Grid.ColumnDefinitions>
                                        <TextBox x:Name="txtVlcPath" Grid.Column="0" FontSize="11"/>
                                        <Button x:Name="btnBrowseVlc" Content="..." Grid.Column="1" Style="{StaticResource SecondaryButton}" Margin="8,0,0,0" Padding="10,6" Width="36"/>
                                    </Grid>
                                </StackPanel>
                            </Border>
                            
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
                            
                            <!-- AI Enhancement (Ollama) -->
                            <TextBlock Text="AI Enhancement (Local LLM)" FontSize="12" Foreground="{StaticResource TextSecondary}" Margin="0,12,0,8"/>
                            <Border Background="{StaticResource BgCard}" BorderBrush="{StaticResource Border}" BorderThickness="1" CornerRadius="8" Padding="16">
                                <StackPanel>
                                    <Grid Margin="0,0,0,8">
                                        <Grid.ColumnDefinitions>
                                            <ColumnDefinition Width="Auto"/>
                                            <ColumnDefinition Width="*"/>
                                            <ColumnDefinition Width="Auto"/>
                                        </Grid.ColumnDefinitions>
                                        <Ellipse x:Name="ollamaIndicator" Width="10" Height="10" Fill="{StaticResource AccentRed}" VerticalAlignment="Center" Margin="0,0,10,0"/>
                                        <StackPanel Grid.Column="1" VerticalAlignment="Center">
                                            <TextBlock Text="Ollama (Local AI)" FontSize="12" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}"/>
                                            <TextBlock x:Name="txtOllamaStatus" Text="Not detected" FontSize="10" Foreground="{StaticResource TextSecondary}"/>
                                        </StackPanel>
                                        <Button x:Name="btnInstallOllama" Content="Install" Grid.Column="2" Style="{StaticResource SecondaryButton}" Padding="10,4" FontSize="11"/>
                                    </Grid>
                                    <CheckBox x:Name="chkInstallOllama" Content="Install Ollama + AI models for chapters" IsChecked="False" Margin="0,0,0,6"/>
                                    <TextBlock Text="Models to install (select one or more)" FontSize="11" Foreground="{StaticResource TextMuted}" Margin="0,0,0,4"/>
                                    <StackPanel x:Name="pnlOllamaModels" Margin="8,0,0,0"/>
                                    <TextBlock x:Name="txtOllamaModelInfo" Text="Local AI model for use with Chapterizer (AI chapters, summaries, filler detection, and more)" FontSize="10" Foreground="{StaticResource TextMuted}" TextWrapping="Wrap" Margin="0,6,0,0"/>
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
                </ScrollViewer>
            </TabItem>
            
            <!-- Step 2: Install ScriptVault -->
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

                        <TextBlock Text="Step 2: Install ScriptVault" FontSize="20" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}" Margin="0,0,0,8"/>
                        <TextBlock Text="ScriptVault is a Chrome MV3 userscript manager that runs YTKit with full cookie and download support." FontSize="14" Foreground="{StaticResource TextSecondary}" Margin="0,0,0,24" TextWrapping="Wrap"/>

                        <!-- ScriptVault Card -->
                        <Border Background="{StaticResource BgCard}" BorderBrush="#8b5cf6" BorderThickness="2" CornerRadius="16" Padding="24" HorizontalAlignment="Center">
                            <StackPanel HorizontalAlignment="Center">
                                <Border CornerRadius="40" Width="64" Height="64" Margin="0,0,0,16">
                                    <Border.Background>
                                        <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
                                            <GradientStop Color="#8b5cf6" Offset="0"/>
                                            <GradientStop Color="#3b82f6" Offset="1"/>
                                        </LinearGradientBrush>
                                    </Border.Background>
                                    <TextBlock Text="SV" FontSize="24" FontWeight="Bold" Foreground="White" HorizontalAlignment="Center" VerticalAlignment="Center"/>
                                </Border>
                                <TextBlock Text="ScriptVault" FontSize="18" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}" HorizontalAlignment="Center" Margin="0,0,0,4"/>
                                <TextBlock Text="Chrome MV3 Userscript Manager" FontSize="12" Foreground="#a78bfa" HorizontalAlignment="Center" Margin="0,0,0,12"/>
                                <TextBlock Text="Full GM_cookie, GM_xmlhttpRequest, GM_download support. Required for YTKit authenticated downloads." FontSize="12" Foreground="{StaticResource TextSecondary}" TextWrapping="Wrap" TextAlignment="Center" Margin="0,0,0,16" MaxWidth="320"/>
                                <Button x:Name="btnInstallScriptVault" Content="Get ScriptVault on Chrome Web Store" Style="{StaticResource BaseButton}" Padding="24,12" FontSize="14"/>
                            </StackPanel>
                        </Border>

                        <!-- Instructions -->
                        <Border Background="{StaticResource BgCard}" BorderBrush="{StaticResource AccentOrange}" BorderThickness="1" CornerRadius="12" Padding="20" Margin="0,24,0,0">
                            <StackPanel Orientation="Horizontal">
                                <TextBlock Text="!" FontSize="20" Foreground="{StaticResource AccentOrange}" FontWeight="Bold" Margin="0,0,16,0" VerticalAlignment="Top"/>
                                <StackPanel>
                                    <TextBlock Text="Important" FontSize="14" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}" Margin="0,0,0,4"/>
                                    <TextBlock Text="Install ScriptVault in Chrome/Edge before proceeding. Enable the optional 'cookies' permission for authenticated YouTube downloads." FontSize="13" Foreground="{StaticResource TextSecondary}" TextWrapping="Wrap"/>
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
                        
                        <TextBlock Text="Step 3: Install YTKit" FontSize="20" FontWeight="SemiBold" Foreground="{StaticResource TextPrimary}" Margin="0,0,0,8"/>
                        <TextBlock Text="Install the YTKit userscript in ScriptVault to add downloads, themes, and more to YouTube." FontSize="14" Foreground="{StaticResource TextSecondary}" Margin="0,0,0,24" TextWrapping="Wrap"/>

                        <!-- YTKit -->
                        <Border Background="{StaticResource BgCard}" BorderBrush="#8b5cf6" BorderThickness="2" CornerRadius="16" Padding="24" HorizontalAlignment="Center">
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
                                <TextBlock Text="Full Featured YouTube Suite" FontSize="12" Foreground="#a78bfa" HorizontalAlignment="Center" Margin="0,0,0,12"/>
                                <TextBlock Text="Downloads, themes, SponsorBlock, ad blocking, video/channel hiding, playback enhancements, and more." FontSize="12" Foreground="{StaticResource TextSecondary}" TextWrapping="Wrap" TextAlignment="Center" Margin="0,0,0,16" MaxWidth="320"/>
                                <Button x:Name="btnInstallYTKit" Content="Install YTKit in ScriptVault" Style="{StaticResource SecondaryButton}" Padding="24,12" FontSize="14"/>
                            </StackPanel>
                        </Border>
                        
                        <!-- Success Message -->
                        <Border Background="#14532d" BorderBrush="{StaticResource AccentGreen}" BorderThickness="1" CornerRadius="12" Padding="20" Margin="0,24,0,0">
                            <StackPanel Orientation="Horizontal">
                                <TextBlock Text="OK" FontSize="16" Foreground="{StaticResource AccentGreen}" FontWeight="Bold" Margin="0,0,16,0" VerticalAlignment="Top"/>
                                <StackPanel>
                                    <TextBlock Text="Setup Complete!" FontSize="14" FontWeight="SemiBold" Foreground="{StaticResource AccentGreen}" Margin="0,0,0,4"/>
                                    <TextBlock Text="After installing YTKit in ScriptVault, visit any YouTube video. You'll see download buttons next to the like/share buttons." FontSize="13" Foreground="#86efac" TextWrapping="Wrap"/>
                                </StackPanel>
                            </StackPanel>
                        </Border>
                    </StackPanel>
                </ScrollViewer>
            </TabItem>
            
            <!-- Uninstall Tab -->
            <TabItem x:Name="tabUninstall">
                <ScrollViewer VerticalScrollBarVisibility="Auto">
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
                            <TextBlock Text="[!] Ollama and AI models are installed separately" Foreground="{StaticResource AccentOrange}" FontFamily="Cascadia Code, Consolas" FontSize="12" Margin="0,8,0,0"/>
                            <TextBlock Text="    Run: ollama rm model-name  to remove models" Foreground="{StaticResource TextMuted}" FontFamily="Cascadia Code, Consolas" FontSize="10" Margin="0,2,0,0"/>
<TextBlock Text="[!] Userscript must be removed manually from browser" Foreground="{StaticResource AccentOrange}" FontFamily="Cascadia Code, Consolas" FontSize="12" Margin="0,4,0,0"/>
                        </StackPanel>
                    </Border>
                    
                    <StackPanel Orientation="Horizontal" HorizontalAlignment="Center">
                        <Button x:Name="btnCancelUninstall" Content="Cancel" Style="{StaticResource SecondaryButton}" Margin="0,0,12,0" Padding="24,12"/>
                        <Button x:Name="btnConfirmUninstall" Content="Uninstall" Style="{StaticResource DangerButton}" Padding="24,12"/>
                    </StackPanel>
                </StackPanel>
                </ScrollViewer>
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

# Size window to full monitor height (with taskbar clearance)
$screenHeight = [System.Windows.SystemParameters]::WorkArea.Height
$window.Height = [Math]::Min($screenHeight, 1200)
$window.MinHeight = 600

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
$chkInstallVlc = $window.FindName("chkInstallVlc")
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
$btnInstallScriptVault = $window.FindName("btnInstallScriptVault")

# Step 3 controls
$btnInstallYTKit = $window.FindName("btnInstallYTKit")

# Uninstall controls
$imgUninstallIcon = $window.FindName("imgUninstallIcon")
$btnCancelUninstall = $window.FindName("btnCancelUninstall")
$btnConfirmUninstall = $window.FindName("btnConfirmUninstall")

# Footer controls
$btnUninstall = $window.FindName("btnUninstall")
$btnBack = $window.FindName("btnBack")
$btnNext = $window.FindName("btnNext")

# Ollama controls
$ollamaIndicator = $window.FindName("ollamaIndicator")
$txtOllamaStatus = $window.FindName("txtOllamaStatus")
$btnInstallOllama = $window.FindName("btnInstallOllama")
$chkInstallOllama = $window.FindName("chkInstallOllama")
$txtOllamaModelInfo = $window.FindName("txtOllamaModelInfo")
$pnlOllamaModels = $window.FindName("pnlOllamaModels")

# ============================================
# LOAD IMAGES
# ============================================
$logoImage = Get-BitmapImageFromUrl -Url $script:LogoUrl
if ($logoImage) { $imgLogo.Source = $logoImage }

$iconImage = Get-BitmapImageFromUrl -Url $script:IconPngUrl
if ($iconImage) { 
    $imgUninstallIcon.Source = $iconImage
}

# ============================================
# SET DEFAULTS
# ============================================
if ($vlcFound) {
    $txtVlcPath.Text = $vlcFound
    $vlcIndicator.Fill = [System.Windows.Media.Brushes]::LimeGreen
    $txtVlcStatus.Text = "Detected: $vlcFound"
    $btnInstallVlc.Visibility = "Collapsed"
    $chkInstallVlc.IsChecked = $true
} else {
    $txtVlcPath.Text = ""
    $txtVlcStatus.Text = "Not detected - check box below to install"
}
$txtDownloadPath.Text = $script:DefaultDownloadPath

# Set Ollama defaults - create checkboxes for each model
$script:OllamaModelCheckboxes = @{}
$isFirst = $true
foreach ($entry in $script:OllamaModels.GetEnumerator()) {
    $cb = New-Object System.Windows.Controls.CheckBox
    $cb.Content = "$($entry.Key) - $($entry.Value)"
    $cb.Foreground = [System.Windows.Media.Brushes]::White
    $cb.FontSize = 11
    $cb.Margin = "0,2,0,2"
    $cb.Tag = $entry.Key
    # Pre-check the recommended model (first one) by default
    if ($isFirst) { $cb.IsChecked = $true; $isFirst = $false }
    $pnlOllamaModels.Children.Add($cb) | Out-Null
    $script:OllamaModelCheckboxes[$entry.Key] = $cb
}

if ($script:OllamaFound) {
    $ollamaIndicator.Fill = [System.Windows.Media.Brushes]::LimeGreen
    if ($script:OllamaRunning) {
        $modelCount = $script:OllamaInstalledModels.Count
        $txtOllamaStatus.Text = "Running ($modelCount model(s) installed)"
        $btnInstallOllama.Visibility = "Collapsed"
        $chkInstallOllama.IsChecked = $true
        # Pre-check already installed models, uncheck others
        foreach ($entry in $script:OllamaModelCheckboxes.GetEnumerator()) {
            $modelName = $entry.Key
            $alreadyInstalled = $false
            foreach ($installed in $script:OllamaInstalledModels) {
                if ($installed -like "$modelName*") { $alreadyInstalled = $true; break }
            }
            $entry.Value.IsChecked = $alreadyInstalled
            if ($alreadyInstalled) { $entry.Value.Content = "$modelName - INSTALLED" }
        }
    } else {
        $txtOllamaStatus.Text = "Installed (not running - will start during install)"
        $btnInstallOllama.Visibility = "Collapsed"
        $chkInstallOllama.IsChecked = $true
    }
} else {
    $txtOllamaStatus.Text = "Not detected - check box below to install"
}

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

function Install-VlcViaWinget {
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $wingetCmd) { return $false }
    try {
        Invoke-ProcessWithUI -FilePath "winget" -Arguments "install", "--id", "VideoLAN.VLC", "--accept-package-agreements", "--accept-source-agreements", "-h"
        Start-Sleep -Seconds 2
        foreach ($path in $vlcPaths) {
            if (Test-Path $path) {
                $txtVlcPath.Text = $path
                $vlcIndicator.Fill = [System.Windows.Media.Brushes]::LimeGreen
                $txtVlcStatus.Text = "Installed: $path"
                $btnInstallVlc.Visibility = "Collapsed"
                $chkInstallVlc.IsChecked = $true
                return $true
            }
        }
    } catch {
        Update-Status "  [!] VLC install failed: $($_.Exception.Message)"
    }
    return $false
}

# Non-blocking process execution — pumps WPF dispatcher while waiting
function Invoke-ProcessWithUI {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [int]$TimeoutSeconds = 300
    )
    $proc = Start-Process -FilePath $FilePath -ArgumentList $Arguments -NoNewWindow -PassThru
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not $proc.HasExited -and (Get-Date) -lt $deadline) {
        $window.Dispatcher.Invoke([action]{}, [System.Windows.Threading.DispatcherPriority]::Background)
        Start-Sleep -Milliseconds 100
    }
    if (-not $proc.HasExited) {
        Update-Status "  [!] Process timed out after ${TimeoutSeconds}s"
        $proc.Kill()
    }
}

# Non-blocking BITS download with real progress reporting in the GUI.
# Uses Start-BitsTransfer -Asynchronous while pumping the WPF dispatcher.
function Invoke-DownloadWithUI {
    param(
        [string]$Uri,
        [string]$OutFile
    )
    Import-Module BitsTransfer -ErrorAction Stop
    $fileName = [System.IO.Path]::GetFileName($OutFile)
    $bitsJob = Start-BitsTransfer -Source $Uri -Destination $OutFile -Asynchronous -DisplayName $fileName
    $lastPct = -1
    while ($bitsJob.JobState -eq 'Transferring' -or $bitsJob.JobState -eq 'Connecting' -or $bitsJob.JobState -eq 'TransientError') {
        $window.Dispatcher.Invoke([action]{}, [System.Windows.Threading.DispatcherPriority]::Background)
        if ($bitsJob.BytesTotal -gt 0) {
            $pct = [int](($bitsJob.BytesTransferred / $bitsJob.BytesTotal) * 100)
            if ($pct -ne $lastPct -and $pct -gt 0) {
                $lastPct = $pct
                $recvMB = [math]::Round($bitsJob.BytesTransferred / 1MB, 1)
                $totalMB = [math]::Round($bitsJob.BytesTotal / 1MB, 1)
                Update-Status "  [$fileName] ${recvMB}MB / ${totalMB}MB ($pct%)"
            }
        }
        Start-Sleep -Milliseconds 250
    }
    if ($bitsJob.JobState -eq 'Transferred') {
        Complete-BitsTransfer -BitsJob $bitsJob
    } else {
        $errMsg = $bitsJob.JobState
        Remove-BitsTransfer -BitsJob $bitsJob -ErrorAction SilentlyContinue
        throw "BITS download failed: $errMsg"
    }
}

function Update-WizardButtons {
    switch ($script:CurrentStep) {
        1 {
            $btnBack.Visibility = "Collapsed"
            if ($script:BaseToolsInstalled) {
                $btnNext.Content = "Next: ScriptVault"
            } else {
                $btnNext.Content = "Install Base Tools"
            }
        }
        2 {
            $btnBack.Visibility = "Visible"
            $btnNext.Content = "Next: Install YTKit"
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
        $result = Install-VlcViaWinget
        if ($result) { Update-Status "VLC installed successfully!" }
        $btnInstallVlc.IsEnabled = $true
    } else {
        Start-Process "https://www.videolan.org/vlc/"
    }
})

# ScriptVault button
$btnInstallScriptVault.Add_Click({ Start-Process $script:ScriptVaultUrl })

# Install Ollama manually
$btnInstallOllama.Add_Click({
    $wingetPath = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetPath) {
        Update-Status "Installing Ollama via winget..."
        $btnInstallOllama.IsEnabled = $false
        try {
            Invoke-ProcessWithUI -FilePath "winget" -Arguments "install", "--id", "Ollama.Ollama", "--accept-package-agreements", "--accept-source-agreements", "-h"
            Start-Sleep -Seconds 3
            # Re-check for Ollama
            foreach ($path in $ollamaPaths) {
                if (Test-Path $path) {
                    $script:OllamaFound = $path
                    $ollamaIndicator.Fill = [System.Windows.Media.Brushes]::LimeGreen
                    $txtOllamaStatus.Text = "Installed: $path"
                    $btnInstallOllama.Visibility = "Collapsed"
                    $chkInstallOllama.IsChecked = $true
                    Update-Status "  [OK] Ollama installed"
                    break
                }
            }
            if (-not $script:OllamaFound) {
                $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
                if ($ollamaCmd) {
                    $script:OllamaFound = $ollamaCmd.Source
                    $ollamaIndicator.Fill = [System.Windows.Media.Brushes]::LimeGreen
                    $txtOllamaStatus.Text = "Installed via PATH"
                    $btnInstallOllama.Visibility = "Collapsed"
                    $chkInstallOllama.IsChecked = $true
                }
            }
        } catch {
            Update-Status "  [!] Error installing Ollama: $($_.Exception.Message)"
        }
        $btnInstallOllama.IsEnabled = $true
    } else {
        Start-Process "https://ollama.com/download"
    }
})

# Install YTKit button - opens GitHub page
$btnInstallYTKit.Add_Click({
    Start-Process $script:YTKitUrl
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

# Confirm uninstall - immediate action, no confirmation dialog
$btnConfirmUninstall.Add_Click({
    try {
        # Force kill related processes
        @("yt-dlp", "ffmpeg", "ffprobe", "vlc") | ForEach-Object {
            Get-Process -Name $_ -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        }

        # Kill MediaDL server (PowerShell listening on port 9751)
        try {
            $serverProcs = Get-NetTCPConnection -LocalPort 9751 -State Listen -ErrorAction SilentlyContinue |
                ForEach-Object { Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue }
            $serverProcs | Stop-Process -Force -ErrorAction SilentlyContinue
        } catch {}

        # Remove MediaDL-Server scheduled task
        try { Unregister-ScheduledTask -TaskName "MediaDL-Server" -Confirm:$false -ErrorAction SilentlyContinue } catch {}

        Start-Sleep -Milliseconds 500

        # Remove protocol handlers
        @("ytvlc", "ytvlcq", "ytdl", "ytmpv", "ytdlplay", "mediadl") | ForEach-Object {
            Remove-Item -Path "HKCU:\Software\Classes\$_" -Recurse -Force -ErrorAction SilentlyContinue
        }

        # Remove install directory
        if (Test-Path $script:InstallPath) {
            Remove-Item -Path $script:InstallPath -Recurse -Force
        }

        # Remove desktop shortcut
        $shortcutPath = "$env:USERPROFILE\Desktop\YouTube Download.lnk"
        if (Test-Path $shortcutPath) {
            Remove-Item $shortcutPath -Force
        }

        # Remove startup shortcuts (including Ollama)
        $startupPath = [Environment]::GetFolderPath('Startup')
        @("YTYT-Server.lnk", "MediaDL-Server.lnk", "Ollama.lnk") | ForEach-Object {
            $s = Join-Path $startupPath $_
            if (Test-Path $s) { Remove-Item $s -Force -ErrorAction SilentlyContinue }
        }

        Update-Status "YTYT-Downloader uninstalled successfully."
        Update-Status "Remember to also remove YTKit from ScriptVault."
        $window.Close()
    } catch {
        Update-Status "Error during uninstall: $($_.Exception.Message)"
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
                    Invoke-DownloadWithUI -Uri $script:YtDlpUrl -OutFile $ytdlpPath
                    Update-Status "  [OK] Downloaded yt-dlp"
                    Set-Progress 25
                    
                    # Step 3: Download ffmpeg
                    Update-Status "Downloading ffmpeg (this may take a moment)..."
                    $ffmpegZipUrl = "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
                    $ffmpegZip = Join-Path $script:InstallPath "ffmpeg.zip"
                    $ffmpegPath = Join-Path $script:InstallPath "ffmpeg.exe"
                    
                    if (!(Test-Path $ffmpegPath)) {
                        try {
                            Invoke-DownloadWithUI -Uri $ffmpegZipUrl -OutFile $ffmpegZip
                            Update-Status "  [OK] Downloaded ffmpeg archive"
                            Update-Status "  Extracting ffmpeg..."
                            
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
                        VlcEnabled = [bool]$chkInstallVlc.IsChecked
                        DownloadPath = $dlPath
                        AutoUpdate = $chkAutoUpdate.IsChecked
                        Notifications = $chkNotifications.IsChecked
                        SponsorBlock = $true
                        YtDlpPath = $ytdlpPath
                        FfmpegPath = $ffmpegPath
                        ServerToken = [guid]::NewGuid().ToString('N')
                        ServerPort = 9751
                        OllamaEnabled = [bool]$chkInstallOllama.IsChecked
                        OllamaModels = @($script:OllamaModelCheckboxes.GetEnumerator() | Where-Object { $_.Value.IsChecked } | ForEach-Object { $_.Key })
                    }
                    $config | ConvertTo-Json | Set-Content (Join-Path $script:InstallPath "config.json") -Encoding UTF8
                    Update-Status "  [OK] Configuration saved"
                    Set-Progress 45
                    
                    # Step 5: Create handlers
                    Update-Status "Creating protocol handlers..."
                    
                    # VLC handlers (only if VLC enabled)
                    if ($chkInstallVlc.IsChecked) {
                        # Auto-install VLC via winget if not found
                        $vlcPath = $txtVlcPath.Text
                        if (-not $vlcPath -or -not (Test-Path $vlcPath)) {
                            Update-Status "  Installing VLC via winget..."
                            $result = Install-VlcViaWinget
                            if ($result) {
                                $vlcPath = $txtVlcPath.Text
                                Update-Status "  [OK] VLC installed: $vlcPath"
                            } else {
                                $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
                                if (-not $wingetCmd) {
                                    Update-Status "  [!] winget not available - install VLC manually from videolan.org"
                                }
                            }
                        }
                        
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
    $response = Invoke-WebRequest -Uri "https://www.youtube.com/watch?v=$videoId" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    if ($response.Content -match '"isLiveNow"\s*:\s*true') { $isLive = $true }
} catch { <# Live detection failed — default to non-live, which is safe #> }

$videoTitle = "YouTube Video"
try {
    $titleOutput = & $config.YtDlpPath --get-title $videoUrl 2>$null
    if ($titleOutput) { $videoTitle = $titleOutput }
} catch { <# Title fetch failed — proceed with default title #> }

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
                    } # end VLC handler conditional
                    Set-Progress 50
                    
                    # Download Handler with Progress UI
                    $dlHandler = @'
param([string]$url)

# =========================================================================
# LOGGING (rotate at 512KB, keep tail 500 lines)
# =========================================================================
$logFile = Join-Path $PSScriptRoot "ytdl-debug.log"
if ((Test-Path $logFile) -and (Get-Item $logFile -ErrorAction SilentlyContinue).Length -gt 512KB) {
    try { $keep = Get-Content $logFile -Tail 500; $keep | Set-Content $logFile -Encoding utf8 } catch {}
}
function Write-Log { param([string]$msg) "$(Get-Date -Format 'HH:mm:ss') $msg" | Out-File $logFile -Append -Encoding utf8 }
Write-Log "=== Handler started ==="
Write-Log "Raw URL param: $url"

try {

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Win11 rounded corners
try {
    Add-Type -MemberDefinition '[DllImport("dwmapi.dll",PreserveSig=true)] public static extern int DwmSetWindowAttribute(IntPtr hwnd,int attr,ref int val,int sz);' -Name 'DwmApi' -Namespace 'Win32' -ErrorAction Stop | Out-Null
} catch {}

# =========================================================================
# CONFIG
# =========================================================================
$configPath = Join-Path $PSScriptRoot "config.json"
if (!(Test-Path $configPath)) {
    Write-Log "ERROR: config.json not found"
    [System.Windows.Forms.MessageBox]::Show("config.json not found at:`n$configPath", "YTYT Error")
    exit 1
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json
Write-Log "Config loaded. yt-dlp: $($config.YtDlpPath)"

# Ensure download path exists
if ($config.DownloadPath -and !(Test-Path $config.DownloadPath)) {
    try { New-Item -ItemType Directory -Path $config.DownloadPath -Force | Out-Null; Write-Log "Created download dir: $($config.DownloadPath)" } catch {}
}

# =========================================================================
# URL PARSING
# =========================================================================
$videoUrl = [System.Uri]::UnescapeDataString(($url -replace '^ytdl://', ''))

$audioOnly = $videoUrl -match "yt(?:yt|kit)_audio_only=1"
$videoUrl = $videoUrl -replace "[&?]yt(?:yt|kit)_audio_only=1", ""

$referer = $null
if ($videoUrl -match "ytyt_referer=([^&]+)") {
    $referer = [System.Uri]::UnescapeDataString($matches[1])
    $videoUrl = $videoUrl -replace "[&?]ytyt_referer=[^&]+", ""
}

$pageTitle = $null
if ($videoUrl -match "ytyt_title=([^&]+)") {
    $raw = [System.Uri]::UnescapeDataString($matches[1])
    $pageTitle = (($raw -replace '[<>:"/\\|?*]','_') -replace '_+','_').Trim('_. ')
    if ($pageTitle.Length -gt 120) { $pageTitle = $pageTitle.Substring(0,120).TrimEnd('_. ') }
    $videoUrl = $videoUrl -replace "[&?]ytyt_title=[^&]+", ""
}

$videoUrl = $videoUrl -replace "[?&]$", ""
$isDirect = $videoUrl -match "fbcdn\.net|\.mp4\?|\.webm\?"

Write-Log "URL: $videoUrl"
Write-Log "Audio: $audioOnly | Direct: $isDirect | Referer: $referer | Title: $pageTitle"

# =========================================================================
# DUPLICATE PREVENTION (URL hash lock)
# =========================================================================
$urlHash = [System.BitConverter]::ToString(
    [System.Security.Cryptography.SHA256]::Create().ComputeHash(
        [System.Text.Encoding]::UTF8.GetBytes("$videoUrl|$audioOnly")
    )
).Substring(0,11) -replace '-',''
$dupLock = Join-Path $env:TEMP "ytyt_dl_$urlHash.lock"
if (Test-Path $dupLock) {
    # Check if the owning process is still alive
    $ownerPid = (Get-Content $dupLock -Raw -ErrorAction SilentlyContinue) -replace '\s',''
    if ($ownerPid -match '^\d+$' -and (Get-Process -Id ([int]$ownerPid) -ErrorAction SilentlyContinue)) {
        Write-Log "Duplicate download blocked (PID $ownerPid already downloading this URL)"
        exit 0
    }
    Remove-Item $dupLock -Force -ErrorAction SilentlyContinue
}
"$PID" | Out-File $dupLock -Force

$videoId = $null
if ($videoUrl -match "(?:youtube\.com/(?:[^/]+/.+/|(?:v|e(?:mbed)?)/|.*[?&]v=)|youtu\.be/)([a-zA-Z0-9_-]{11})") {
    $videoId = $matches[1]
}

$iconPath = Join-Path $PSScriptRoot "icon.ico"
$progressFile = Join-Path $env:TEMP "ytyt_progress_$([guid]::NewGuid().ToString('N')).txt"

# =========================================================================
# FORM - 390x48, bottom-left stacked
# =========================================================================
$form = New-Object System.Windows.Forms.Form
$form.Text = "YTYT"; $form.Size = New-Object System.Drawing.Size(390,48)
$form.FormBorderStyle = "None"; $form.StartPosition = "Manual"
$form.BackColor = [System.Drawing.Color]::FromArgb(18,18,18)
$form.TopMost = $true; $form.ShowInTaskbar = $false
$form.GetType().GetProperty("DoubleBuffered",[System.Reflection.BindingFlags]"Instance,NonPublic").SetValue($form,$true,$null)

$form.Add_HandleCreated({
    try { $v=2; [Win32.DwmApi]::DwmSetWindowAttribute($form.Handle,33,[ref]$v,4) | Out-Null } catch {}
})

# =========================================================================
# SLOT STACKING (PID-tracked, stale cleanup)
# =========================================================================
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$script:mySlot = 0

for ($i = 0; $i -lt 6; $i++) {
    $sf = Join-Path $env:TEMP "ytyt_slot_$i.lock"
    if (Test-Path $sf) {
        $c = (Get-Content $sf -Raw -ErrorAction SilentlyContinue) -replace '\s',''
        if ($c -match '^\d+$') {
            if (-not (Get-Process -Id ([int]$c) -ErrorAction SilentlyContinue)) {
                Remove-Item $sf -Force -ErrorAction SilentlyContinue
                Write-Log "Cleaned stale slot $i (PID $c dead)"
            }
        } elseif ((Get-Date) - (Get-Item $sf -ErrorAction SilentlyContinue).LastWriteTime -gt [TimeSpan]::FromMinutes(30)) {
            Remove-Item $sf -Force -ErrorAction SilentlyContinue
        }
    }
}

for ($i = 0; $i -lt 6; $i++) {
    $sf = Join-Path $env:TEMP "ytyt_slot_$i.lock"
    if (!(Test-Path $sf)) { $script:mySlot = $i; "$PID" | Out-File $sf -Force; break }
}

$baseX = $screen.Left + 16
$newY = [Math]::Max(50, $screen.Bottom - 64 - ($script:mySlot * 56))
$form.Location = New-Object System.Drawing.Point($baseX, $newY)

# Draggable
$script:dragStart = $null
$form.Add_MouseDown({ param($s,$e) if ($e.Button -eq "Left") { $script:dragStart = $e.Location } })
$form.Add_MouseMove({ param($s,$e) if ($script:dragStart) { $form.Location = [System.Drawing.Point]::new(($form.Location.X+$e.X-$script:dragStart.X),($form.Location.Y+$e.Y-$script:dragStart.Y)) } })
$form.Add_MouseUp({ $script:dragStart = $null })

# =========================================================================
# CONTROLS
# =========================================================================
$accentColor = if ($audioOnly) { [System.Drawing.Color]::MediumPurple } else { [System.Drawing.Color]::FromArgb(34,197,94) }
$dimColor = [System.Drawing.Color]::FromArgb(100,100,100)

# Determine initial title text (no "Fetching..." flash if title already known)
$initTitle = if ($pageTitle) { if ($pageTitle.Length -gt 32) { $pageTitle.Substring(0,30) + "..." } else { $pageTitle } } else { "Fetching..." }

$pnlAccent = New-Object System.Windows.Forms.Panel
$pnlAccent.Size = New-Object System.Drawing.Size(3,48)
$pnlAccent.Location = New-Object System.Drawing.Point(0,0)
$pnlAccent.BackColor = $accentColor
$form.Controls.Add($pnlAccent)

$picThumb = New-Object System.Windows.Forms.PictureBox
$picThumb.Size = New-Object System.Drawing.Size(36,36)
$picThumb.Location = New-Object System.Drawing.Point(8,6)
$picThumb.BackColor = [System.Drawing.Color]::FromArgb(30,30,30)
$picThumb.SizeMode = "Zoom"
$form.Controls.Add($picThumb)

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = $initTitle
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI Emoji",8)
$lblTitle.ForeColor = [System.Drawing.Color]::White
$lblTitle.Location = New-Object System.Drawing.Point(48,4)
$lblTitle.Size = New-Object System.Drawing.Size(200,16)
$form.Controls.Add($lblTitle)

# Shared tooltip (reused, not leaked)
$script:toolTip = New-Object System.Windows.Forms.ToolTip
if ($pageTitle) { $script:toolTip.SetToolTip($lblTitle, $pageTitle) }

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = "Preparing..."
$lblStatus.Font = New-Object System.Drawing.Font("Segoe UI",7.5)
$lblStatus.ForeColor = $dimColor
$lblStatus.Location = New-Object System.Drawing.Point(48,22)
$lblStatus.Size = New-Object System.Drawing.Size(120,14)
$form.Controls.Add($lblStatus)

$pnlBg = New-Object System.Windows.Forms.Panel
$pnlBg.Size = New-Object System.Drawing.Size(90,6)
$pnlBg.Location = New-Object System.Drawing.Point(174,27)
$pnlBg.BackColor = [System.Drawing.Color]::FromArgb(40,40,40)
$form.Controls.Add($pnlBg)

$pnlFill = New-Object System.Windows.Forms.Panel
$pnlFill.Size = New-Object System.Drawing.Size(0,6)
$pnlFill.Location = New-Object System.Drawing.Point(0,0)
$pnlFill.BackColor = $accentColor
$pnlBg.Controls.Add($pnlFill)

$lblSpeed = New-Object System.Windows.Forms.Label
$lblSpeed.Text = ""; $lblSpeed.Font = New-Object System.Drawing.Font("Segoe UI",7)
$lblSpeed.ForeColor = $dimColor
$lblSpeed.Location = New-Object System.Drawing.Point(174,6)
$lblSpeed.Size = New-Object System.Drawing.Size(90,14)
$form.Controls.Add($lblSpeed)

$lblPct = New-Object System.Windows.Forms.Label
$lblPct.Text = "0%"
$lblPct.Font = New-Object System.Drawing.Font("Segoe UI",8,[System.Drawing.FontStyle]::Bold)
$lblPct.ForeColor = $accentColor
$lblPct.Location = New-Object System.Drawing.Point(268,15)
$lblPct.Size = New-Object System.Drawing.Size(38,16)
$lblPct.TextAlign = "MiddleRight"
$form.Controls.Add($lblPct)

$btnClose = New-Object System.Windows.Forms.Label
$btnClose.Text = "X"
$btnClose.Font = New-Object System.Drawing.Font("Segoe UI",8,[System.Drawing.FontStyle]::Bold)
$btnClose.ForeColor = $dimColor
$btnClose.Location = New-Object System.Drawing.Point(326,4)
$btnClose.Size = New-Object System.Drawing.Size(52,40)
$btnClose.TextAlign = "MiddleCenter"; $btnClose.Cursor = "Hand"
$btnClose.Add_Click({ $script:cancelled = $true; $script:closing = $true; $form.Close() })
$btnClose.Add_MouseEnter({ $btnClose.ForeColor = [System.Drawing.Color]::Red })
$btnClose.Add_MouseLeave({ $btnClose.ForeColor = $dimColor })
$form.Controls.Add($btnClose)

$pnlSep = New-Object System.Windows.Forms.Panel
$pnlSep.Size = New-Object System.Drawing.Size(1,32)
$pnlSep.Location = New-Object System.Drawing.Point(322,8)
$pnlSep.BackColor = [System.Drawing.Color]::FromArgb(40,40,40)
$form.Controls.Add($pnlSep)

# =========================================================================
# TRAY ICON
# =========================================================================
$tray = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path $iconPath) { $tray.Icon = New-Object System.Drawing.Icon($iconPath) }
else { $tray.Icon = [System.Drawing.SystemIcons]::Application }
$tray.Text = "YTYT Download"; $tray.Visible = $true
$tray.Add_Click({ param($s,$e) if ($e.Button -eq "Left") { if ($form.Visible) { $form.Hide() } else { $form.Show(); $form.Activate() } } })

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.Items.Add("Show", $null, { $form.Show(); $form.Activate() }) | Out-Null
$menu.Items.Add("-") | Out-Null
$menu.Items.Add("Open folder", $null, { Start-Process "explorer.exe" $config.DownloadPath }) | Out-Null
$menu.Items.Add("Cancel", $null, { $script:cancelled = $true }) | Out-Null
$menu.Items.Add("Close", $null, { $script:closing = $true; $form.Close() }) | Out-Null
$tray.ContextMenuStrip = $menu

# =========================================================================
# STATE
# =========================================================================
$script:cancelled = $false
$script:closing = $false
$script:job = $null
$script:titleJob = $null
$script:thumbJob = $null
$script:step = 0          # 0=start, 1=monitor, 2=complete
$script:retryCount = 0
$script:maxRetries = 3
$script:targetPct = 0
$script:displayPct = 0
$script:finalFile = ""
$script:titleSet = [bool]$pageTitle  # true if pageTitle already applied to label

[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
$ytdlpPath = $config.YtDlpPath

# =========================================================================
# ASYNC TITLE FETCH
# =========================================================================
if ($isDirect -and $pageTitle) {
    $script:fetchedTitle = $pageTitle
} else {
    $script:fetchedTitle = if ($pageTitle) { $pageTitle } else { $null }
    $tArgs = @('--get-title','--no-warnings','--no-playlist','--encoding','utf-8')
    if ($referer) { $tArgs += '--referer'; $tArgs += $referer }
    $tArgs += $videoUrl
    $script:titleJob = Start-Job -ScriptBlock {
        param($exe,$a)
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        & $exe @a 2>$null
    } -ArgumentList $ytdlpPath, $tArgs
}

# =========================================================================
# ASYNC THUMBNAIL FETCH
# =========================================================================
if ($videoId) {
    $script:thumbJob = Start-Job -ScriptBlock {
        param($vid,$tmp)
        $f = Join-Path $tmp "ytyt_thumb_$vid.jpg"
        try {
            $wc = New-Object System.Net.WebClient
            $wc.Headers.Add("User-Agent","Mozilla/5.0")
            $wc.DownloadFile("https://img.youtube.com/vi/$vid/mqdefault.jpg",$f)
            $wc.Dispose(); return $f
        } catch { return $null }
    } -ArgumentList $videoId, $env:TEMP
} elseif (-not $isDirect) {
    $thArgs = @('--get-thumbnail','--no-warnings','--no-playlist')
    if ($referer) { $thArgs += '--referer'; $thArgs += $referer }
    $thArgs += $videoUrl
    $script:thumbJob = Start-Job -ScriptBlock {
        param($exe,$a,$tmp)
        $u = & $exe @a 2>$null | Select-Object -First 1
        if ($u -and $u -match '^https?://') {
            $f = Join-Path $tmp "ytyt_thumb_$([guid]::NewGuid().ToString('N').Substring(0,8)).jpg"
            try {
                $wc = New-Object System.Net.WebClient
                $wc.Headers.Add("User-Agent","Mozilla/5.0")
                $wc.DownloadFile($u,$f); $wc.Dispose(); return $f
            } catch { return $null }
        }
        return $null
    } -ArgumentList $ytdlpPath, $thArgs, $env:TEMP
}

# =========================================================================
# yt-dlp AUTO-UPDATE (throttled: once per day via timestamp file)
# =========================================================================
if ($config.AutoUpdate) {
    $updateStamp = Join-Path $PSScriptRoot ".last_update"
    $shouldUpdate = $true
    if (Test-Path $updateStamp) {
        $lastUpdate = (Get-Item $updateStamp -ErrorAction SilentlyContinue).LastWriteTime
        if ($lastUpdate -and ((Get-Date) - $lastUpdate).TotalHours -lt 24) { $shouldUpdate = $false }
    }
    if ($shouldUpdate) {
        Start-Job -ScriptBlock { param($exe,$stamp) & $exe --update 2>&1 | Out-Null; "" | Set-Content $stamp -Force } -ArgumentList $ytdlpPath, $updateStamp | Out-Null
    }
}

# =========================================================================
# HELPER: Kill yt-dlp child processes of a job
# =========================================================================
function Kill-JobChildren {
    param($job)
    if (-not $job) { return }
    try {
        # Get the PowerShell host process for this job
        $jobPid = $null
        if ($job.ChildJobs -and $job.ChildJobs[0]) {
            # Try to find the process via WMI parent PID lookup
            $jobProcs = Get-CimInstance Win32_Process -Filter "Name='yt-dlp.exe'" -ErrorAction SilentlyContinue |
                Where-Object { $_.ParentProcessId -and (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue) }
            foreach ($p in $jobProcs) {
                try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
                Write-Log "Killed child yt-dlp.exe PID $($p.ProcessId)"
            }
        }
        # Also kill any ffmpeg spawned by the job
        Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.ParentProcessId -and (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue) } |
            ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
    } catch { Write-Log "Kill-JobChildren error: $_" }
}

# =========================================================================
# MAIN TIMER - 3-step state machine
# =========================================================================
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 400
$timer.Add_Tick({
    if ($script:closing) { return }
    try { try {

    # ---- SMOOTH PROGRESS ANIMATION ----
    if ($script:displayPct -lt $script:targetPct) {
        $diff = $script:targetPct - $script:displayPct
        $script:displayPct = [Math]::Min($script:targetPct, $script:displayPct + [Math]::Max(0.5, $diff * 0.3))
        $pnlFill.Width = [int](($script:displayPct / 100) * 90)
        $lblPct.Text = [math]::Round($script:displayPct).ToString() + "%"
    }

    # ---- COLLECT ASYNC TITLE ----
    if ($script:titleJob -and $script:titleJob.State -ne "Running") {
        try {
            $r = Receive-Job -Job $script:titleJob -ErrorAction SilentlyContinue
            if ($r) {
                $script:fetchedTitle = if ($r -is [array]) { ($r -join ' ').Trim() } else { "$r".Trim() }
                Write-Log "Async title: $($script:fetchedTitle)"
                $script:titleSet = $false  # Force re-render with better title
            }
            Remove-Job -Job $script:titleJob -Force -ErrorAction SilentlyContinue
        } catch {}
        $script:titleJob = $null
    }

    # ---- COLLECT ASYNC THUMBNAIL ----
    if ($script:thumbJob -and $script:thumbJob.State -ne "Running") {
        try {
            $tf = Receive-Job -Job $script:thumbJob -ErrorAction SilentlyContinue
            if ($tf -and (Test-Path $tf)) {
                $b = [System.IO.File]::ReadAllBytes($tf)
                $ms = New-Object System.IO.MemoryStream(,$b)
                $picThumb.Image = [System.Drawing.Image]::FromStream($ms)
                # Note: MemoryStream must stay open while Image is in use (GDI+ requirement)
                Remove-Item $tf -Force -ErrorAction SilentlyContinue
            }
            Remove-Job -Job $script:thumbJob -Force -ErrorAction SilentlyContinue
        } catch {}
        $script:thumbJob = $null
    }

    # ---- UPDATE TITLE LABEL ----
    if ($script:fetchedTitle -and -not $script:titleSet) {
        $t = $script:fetchedTitle
        $script:titleSet = $true
        $script:toolTip.SetToolTip($lblTitle, $t)
        $lblTitle.Text = if ($t.Length -gt 32) { $t.Substring(0,30) + "..." } else { $t }
        $tt = "DL: " + $(if ($t.Length -gt 58) { $t.Substring(0,58) } else { $t })
        try { $tray.Text = $tt } catch {}
    }

    # ================================================================
    # STEP 0: START DOWNLOAD
    # ================================================================
    if ($script:step -eq 0) {
        $lblStatus.Text = "Starting..."
        $ffLoc = Split-Path $config.FfmpegPath -Parent
        $ytdlp = $config.YtDlpPath

        if (!(Test-Path $ytdlp)) {
            $lblStatus.Text = "yt-dlp not found!"; $lblStatus.ForeColor = [System.Drawing.Color]::Red
            $timer.Stop(); return
        }

        "" | Set-Content $progressFile -Force

        if ($audioOnly) {
            $outTpl = if ($isDirect -and $pageTitle) { Join-Path $config.DownloadPath "$pageTitle.mp3" }
                      else { Join-Path $config.DownloadPath "%(title)s.mp3" }
            $lblStatus.Text = "Downloading audio..."

            if ($isDirect) {
                $tmp = Join-Path $config.DownloadPath "mediadl_temp_$([guid]::NewGuid().ToString('N')).mp4"
                $script:job = Start-Job -ScriptBlock {
                    param($exe,$ff,$vUrl,$tmp,$out,$pf,$ref)
                    $a = @('--newline','--progress','-o',$tmp)
                    if ($ref) { $a += '--referer'; $a += $ref }
                    $a += $vUrl
                    & $exe @a 2>&1 | ForEach-Object { $_ | Out-File $pf -Append -Encoding utf8; $_ }
                    if (Test-Path $tmp) {
                        "[extract] Extracting audio..." | Out-File $pf -Append -Encoding utf8
                        & $ff -i $tmp -vn -acodec libmp3lame -q:a 0 -y $out 2>&1 | Out-Null
                        if (Test-Path $out) {
                            Remove-Item $tmp -Force -ErrorAction SilentlyContinue
                            "[download] 100% audio extraction complete" | Out-File $pf -Append -Encoding utf8
                        }
                    }
                } -ArgumentList $ytdlp,$config.FfmpegPath,$videoUrl,$tmp,$outTpl,$progressFile,$referer
            } else {
                $script:job = Start-Job -ScriptBlock {
                    param($exe,$ff,$out,$vUrl,$pf,$ref)
                    $a = @('-f','bestaudio','--extract-audio','--audio-format','mp3','--audio-quality','0','--newline','--progress','--ffmpeg-location',$ff,'-o',$out)
                    if ($ref) { $a += '--referer'; $a += $ref }
                    $a += $vUrl
                    & $exe @a 2>&1 | ForEach-Object { $_ | Out-File $pf -Append -Encoding utf8; $_ }
                } -ArgumentList $ytdlp,$ffLoc,$outTpl,$videoUrl,$progressFile,$referer
            }
        } else {
            $outTpl = if ($isDirect -and $pageTitle) { Join-Path $config.DownloadPath "$pageTitle.%(ext)s" }
                      else { Join-Path $config.DownloadPath "%(title)s.%(ext)s" }
            $lblStatus.Text = "Downloading..."
            $script:job = Start-Job -ScriptBlock {
                param($exe,$ff,$out,$vUrl,$pf,$ref,$direct)
                $a = if ($direct) { @('--newline','--progress','--ffmpeg-location',$ff,'-o',$out) }
                     else { @('-f','bestvideo[height<=1080]+bestaudio/best[height<=1080]/best','--merge-output-format','mp4','--newline','--progress','--ffmpeg-location',$ff,'-o',$out) }
                if ($ref) { $a += '--referer'; $a += $ref }
                $a += $vUrl
                & $exe @a 2>&1 | ForEach-Object { $_ | Out-File $pf -Append -Encoding utf8; $_ }
            } -ArgumentList $ytdlp,$ffLoc,$outTpl,$videoUrl,$progressFile,$referer,$isDirect
        }
        $script:step = 1
    }

    # ================================================================
    # STEP 1: MONITOR PROGRESS
    # ================================================================
    elseif ($script:step -eq 1) {
        if (Test-Path $progressFile) {
            try {
                # Read only last 4KB to avoid reading a huge file every tick
                $fs = $null
                $content = ""
                try {
                    $fs = [System.IO.File]::Open($progressFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                    $tailSize = [Math]::Min(4096, $fs.Length)
                    if ($tailSize -gt 0) {
                        $fs.Seek(-$tailSize, [System.IO.SeekOrigin]::End) | Out-Null
                        $buf = New-Object byte[] $tailSize
                        $fs.Read($buf, 0, $tailSize) | Out-Null
                        $content = [System.Text.Encoding]::UTF8.GetString($buf)
                    }
                } finally { if ($fs) { $fs.Close() } }

                if ($content) {
                    $allM = [regex]::Matches($content, '\[download\]\s+(\d+\.?\d*)%')
                    if ($allM.Count -gt 0) {
                        $script:targetPct = [double]$allM[$allM.Count-1].Groups[1].Value
                    }
                    if ($content -match '(?s).*of\s+~?(\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)') {
                        $lblStatus.Text = "$($matches[1])"
                        $lblSpeed.Text = "$($matches[2]) | $($matches[3])"
                    }
                    if ($content -match 'already been downloaded') {
                        $lblStatus.Text = "Already exists"; $script:targetPct = 100
                    }
                    elseif ($content -match '\[Merger\]|Merging formats') {
                        $lblStatus.Text = "Merging..."; $lblSpeed.Text = ""
                    }
                    elseif ($content -match '\[ExtractAudio\]|\[extract\]') {
                        $lblStatus.Text = "Extracting..."
                    }
                    if ($content -match '\[Merger\] Merging formats into "(.+)"') { $script:finalFile = $matches[1] }
                    elseif ($content -match '\[download\] Destination: (.+)') { $script:finalFile = $matches[1] }
                }
            } catch {}
        }

        if ($script:cancelled -and $script:job) {
            Kill-JobChildren $script:job
            try { Stop-Job -Job $script:job -ErrorAction SilentlyContinue; Remove-Job -Job $script:job -Force -ErrorAction SilentlyContinue } catch {}
            $script:step = 2; return
        }

        if ($script:job -and $script:job.State -ne "Running") {
            Write-Log "Job finished: $($script:job.State)"
            $script:step = 2
        }
    }

    # ================================================================
    # STEP 2: COMPLETION / RETRY
    # ================================================================
    elseif ($script:step -eq 2) {
        $timer.Stop()

        $jobOutput = ""
        if ($script:job) {
            try {
                $raw = Receive-Job -Job $script:job -ErrorAction SilentlyContinue
                if ($raw) {
                    $jobOutput = $raw | Out-String
                    if ($jobOutput) {
                        $tail = [Math]::Min(500, $jobOutput.Length)
                        Write-Log "Job output (tail): $($jobOutput.Substring([Math]::Max(0, $jobOutput.Length - $tail)))"
                    }
                }
            } catch { Write-Log "Job receive error: $_" }
            try { Remove-Job -Job $script:job -Force -ErrorAction SilentlyContinue } catch {}
        }

        $progressContent = ""
        if (Test-Path $progressFile) {
            try { $progressContent = Get-Content $progressFile -Tail 50 -ErrorAction SilentlyContinue | Out-String } catch {}
            if (-not $progressContent) { $progressContent = "" }
            Remove-Item $progressFile -Force -ErrorAction SilentlyContinue
        }

        if ($script:cancelled) {
            $lblStatus.Text = "Cancelled"; $lblStatus.ForeColor = [System.Drawing.Color]::Orange
            if ($tray) { try { $tray.ShowBalloonTip(2000,"YTYT","Cancelled","Warning") } catch {} }
            Write-Log "Cancelled"
        } else {
            $all = "$jobOutput$progressContent"
            $ok = $all -match "100%|has already been downloaded|Merging formats into|DelayedMuxer|audio extraction complete"

            if ($ok) {
                $script:targetPct = 100; $script:displayPct = 100
                $pnlFill.Width = 90; $lblPct.Text = "100%"
                $lblStatus.Text = "Complete!"; $lblStatus.ForeColor = [System.Drawing.Color]::LimeGreen
                $lblSpeed.Text = ""; $pnlAccent.BackColor = [System.Drawing.Color]::LimeGreen
                if ($tray) { try { $tray.ShowBalloonTip(3000,"YTYT","Download complete!","Info") } catch {} }
                Write-Log "Complete! File: $($script:finalFile)"

                if ($script:finalFile -and (Test-Path $script:finalFile)) {
                    $lblStatus.Cursor = "Hand"
                    $lblStatus.Text = "Complete! (click)"
                    $f_ = $script:finalFile
                    $lblStatus.Add_Click({ try { Start-Process "explorer.exe" "/select,`"$f_`"" } catch {} })
                }

                $ct = New-Object System.Windows.Forms.Timer
                $ct.Interval = 5000
                $ct.Add_Tick({ $ct.Stop(); $script:closing = $true; $timer.Stop(); $posTimer.Stop(); $form.Close() })
                $ct.Start()
            } else {
                $script:retryCount++
                if ($all.Length -gt 0) {
                    Write-Log "Failed ($($script:retryCount)/$($script:maxRetries)): $($all.Substring(0,[Math]::Min(300,$all.Length)))"
                } else { Write-Log "Failed ($($script:retryCount)/$($script:maxRetries)): no output" }

                if ($script:retryCount -lt $script:maxRetries) {
                    $lblStatus.Text = "Retry $($script:retryCount)/$($script:maxRetries)..."
                    $lblStatus.ForeColor = [System.Drawing.Color]::Orange
                    $script:targetPct = 0; $script:displayPct = 0
                    $pnlFill.Width = 0; $lblPct.Text = "0%"; $lblSpeed.Text = ""
                    $script:step = 0
                    $timer.Start()
                } else {
                    $lblStatus.Text = "Failed"; $lblStatus.ForeColor = [System.Drawing.Color]::Red
                    if ($tray) { try { $tray.ShowBalloonTip(3000,"YTYT","Download failed","Error") } catch {} }
                    Write-Log "Failed after $($script:maxRetries) attempts"
                }
            }
        }
    }

    } catch {
        Write-Log "Timer error: $_"
        try { $lblStatus.Text = "Error"; $lblStatus.ForeColor = [System.Drawing.Color]::Red } catch {}
    }
    } catch {}
})

$form.Add_Shown({ $timer.Start() })

# =========================================================================
# SLOT REPOSITION TIMER
# =========================================================================
$posTimer = New-Object System.Windows.Forms.Timer
$posTimer.Interval = 2000
$posTimer.Add_Tick({
    if ($script:closing) { return }
    try {
    for ($i = 0; $i -lt $script:mySlot; $i++) {
        $sf = Join-Path $env:TEMP "ytyt_slot_$i.lock"
        if (!(Test-Path $sf)) {
            $old = Join-Path $env:TEMP "ytyt_slot_$($script:mySlot).lock"
            if (Test-Path $old) { Remove-Item $old -Force -ErrorAction SilentlyContinue }
            $script:mySlot = $i
            "$PID" | Out-File $sf -Force
            $s_ = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
            $form.Location = New-Object System.Drawing.Point($form.Location.X, [Math]::Max(50, $s_.Bottom-64-($script:mySlot*56)))
            break
        }
    }
    } catch {}
})
$posTimer.Start()

# =========================================================================
# CLEANUP
# =========================================================================
$form.Add_FormClosed({
    $script:closing = $true
    try { $timer.Stop() } catch {}
    try { $posTimer.Stop() } catch {}
    # Kill child processes before stopping jobs
    Kill-JobChildren $script:job
    foreach ($j in @($script:job, $script:titleJob, $script:thumbJob)) {
        if ($j) { try { Stop-Job $j -ErrorAction SilentlyContinue; Remove-Job $j -Force -ErrorAction SilentlyContinue } catch {} }
    }
    if (Test-Path $progressFile) { Remove-Item $progressFile -Force -ErrorAction SilentlyContinue }
    # Clean slot lock
    $sf = Join-Path $env:TEMP "ytyt_slot_$($script:mySlot).lock"
    if (Test-Path $sf) { Remove-Item $sf -Force -ErrorAction SilentlyContinue }
    # Clean duplicate lock
    if (Test-Path $dupLock) { Remove-Item $dupLock -Force -ErrorAction SilentlyContinue }
    # Dispose tray
    if ($tray) { try { $tray.Visible = $false } catch {}; try { $tray.Dispose() } catch {} }
    # Dispose shared tooltip
    try { $script:toolTip.Dispose() } catch {}
    Write-Log "=== Handler closed ==="
})

# =========================================================================
# RUN (global exception swallowing)
# =========================================================================
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)
[System.Windows.Forms.Application]::add_ThreadException({ param($s,$e) try { Write-Log "Swallowed: $($e.Exception.Message)" } catch {} })
[System.Windows.Forms.Application]::Run($form)

} catch {
    Write-Log "FATAL: $_"
    Write-Log $_.ScriptStackTrace
}
'@
                    $dlHandler | Set-Content (Join-Path $script:InstallPath "ytdl-handler.ps1") -Encoding UTF8
                    Update-Status "  [OK] Download handler (with progress UI)"
                    Set-Progress 55
                    
                    # VLC Queue Handler (only if VLC enabled)
                    if ($chkInstallVlc.IsChecked) {
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
} catch { <# Title fetch failed — proceed with default title #> }

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
                    } # end VLC queue handler conditional
                    Set-Progress 60
                    
                    # Download icon for notifications
                    Update-Status "Downloading application icon..."
                    $notifyIconPath = Join-Path $script:InstallPath "icon.ico"
                    Download-Image -Url $script:IconUrl -OutPath $notifyIconPath | Out-Null
                    Update-Status "  [OK] Application icon"
                    Set-Progress 65
                    
                    # Step 6: Create VBS launchers
                    Update-Status "Creating silent launchers..."
                    
                    # Embed MediaDL HTTP Server
                    Update-Status "  Writing MediaDL server..."
                    $serverScript = @'
# ytdl-server.ps1 - Hidden HTTP API server for MediaDL v3.2
# Runs on 127.0.0.1:9751, manages downloads with progress tracking
# Primary: direct stream download from browser-extracted URLs (universal, no cookies needed)
# Fallback: yt-dlp for non-YouTube sites or when streams unavailable

param([switch]$Debug)

$ErrorActionPreference = 'Continue'
$PORT = 9751
$MAX_CONCURRENT = 3
$CLEANUP_MINUTES = 5
$ZOMBIE_MINUTES = 10
$SERVER_VERSION = "3.2"

$logFile = Join-Path $PSScriptRoot "server.log"
$ytdlpConf = Join-Path $PSScriptRoot "yt-dlp.conf"

function Write-Log {
    param([string]$msg)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    if ($Debug) { Write-Host $line }
    try { $line | Out-File $logFile -Append -Encoding utf8 -ErrorAction SilentlyContinue } catch {}
}

if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 1MB) {
    $lines = Get-Content $logFile -Tail 200
    $lines | Set-Content $logFile -Encoding utf8
}

Write-Log "=== Server v$SERVER_VERSION starting on port $PORT ==="

$configPath = Join-Path $PSScriptRoot "config.json"
if (!(Test-Path $configPath)) { Write-Log "FATAL: config.json not found"; exit 1 }
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$authToken = $config.ServerToken
if (-not $authToken) {
    $authToken = [guid]::NewGuid().ToString('N')
    $config | Add-Member -NotePropertyName ServerToken -NotePropertyValue $authToken -Force
    $config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
}

if (!(Test-Path $config.YtDlpPath)) { Write-Log "WARN: yt-dlp not found at $($config.YtDlpPath) (direct downloads still work)" }

# Ensure yt-dlp.conf exists (no runtime restriction - let yt-dlp use built-in quickjs)
if (!(Test-Path $ytdlpConf)) {
    "" | Set-Content $ytdlpConf -Encoding UTF8
    Write-Log "Created yt-dlp.conf"
} else {
    # Fix legacy configs that restricted JS runtimes to deno,node (breaks when neither is installed)
    $confContent = Get-Content $ytdlpConf -Raw -ErrorAction SilentlyContinue
    if ($confContent -match '--js-runtimes\s+deno,node') {
        $confContent = $confContent -replace '--js-runtimes\s+deno,node', ''
        $confContent.Trim() | Set-Content $ytdlpConf -Encoding UTF8
        Write-Log "Fixed yt-dlp.conf: removed JS runtime restriction"
    }
}

# Ensure download directory exists
if ($config.DownloadPath -and !(Test-Path $config.DownloadPath)) {
    New-Item -ItemType Directory -Path $config.DownloadPath -Force | Out-Null
}

$downloads = @{}
$nextId = 0

# --- Duplicate & Existing File Detection ---
function Find-ExistingFile {
    param([string]$url, [string]$videoId, [bool]$audioOnly)
    if (-not $config.DownloadPath -or !(Test-Path $config.DownloadPath)) { return $null }
    if (-not $videoId) {
        if ($url -match '[?&]v=([a-zA-Z0-9_-]{11})') { $videoId = $Matches[1] }
        elseif ($url -match 'youtu\.be/([a-zA-Z0-9_-]{11})') { $videoId = $Matches[1] }
    }
    if (-not $videoId) { return $null }

    $ext = if ($audioOnly) { "*.mp3" } else { "*.mp4" }
    $files = Get-ChildItem -Path $config.DownloadPath -Filter $ext -File -ErrorAction SilentlyContinue
    foreach ($f in $files) {
        if ($f.Name -match "\[$videoId\]" -or $f.Name -match $videoId) {
            return $f.FullName
        }
    }
    return $null
}

function Test-AlreadyDownloading {
    param([string]$url)
    foreach ($dl in $downloads.Values) {
        if ($dl.url -eq $url -and ($dl.status -eq 'downloading' -or $dl.status -eq 'merging' -or $dl.status -eq 'extracting')) {
            return $true
        }
    }
    return $false
}

# --- Response Helpers ---
function New-JsonResponse {
    param($context, $data, [int]$status = 200)
    $json = $data | ConvertTo-Json -Depth 5 -Compress
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
    $context.Response.StatusCode = $status
    $context.Response.ContentType = "application/json; charset=utf-8"
    $origin = $context.Request.Headers["Origin"]
    $allowedOrigin = if ($origin -match '^chrome-extension://') { $origin } else { "null" }
    $context.Response.Headers.Add("Access-Control-Allow-Origin", $allowedOrigin)
    $context.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
    $context.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, X-Auth-Token, X-MDL-Client")
    $context.Response.ContentLength64 = $buffer.Length
    try {
        $context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
        $context.Response.OutputStream.Close()
    } catch { Write-Log "Response write error: $_" }
}

function Read-RequestBody {
    param($request)
    try {
        $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
        $body = $reader.ReadToEnd()
        $reader.Close()
        return $body
    } catch { return $null }
}

# --- Safe Filename ---
function Get-SafeFilename {
    param([string]$title, [string]$videoId)
    $safe = $title -replace '[<>:"/\\|?*]', '_' -replace '_+', '_'
    $safe = $safe.Trim('_. ')
    if ($safe.Length -gt 120) { $safe = $safe.Substring(0, 120).TrimEnd('_. ') }
    if ($videoId) { $safe = "$safe [$videoId]" }
    return $safe
}

# --- Cookie Writer (Netscape format for yt-dlp) ---
function Write-CookieFile {
    param($cookies)
    if (-not $cookies -or $cookies.Count -eq 0) { return $null }
    $cookieFile = Join-Path $env:TEMP "mdl_cookies_$([guid]::NewGuid().ToString('N').Substring(0,8)).txt"
    $lines = @("# Netscape HTTP Cookie File", "# Generated by MediaDL server from GM_cookie data", "")
    foreach ($c in $cookies) {
        $domain = $c.domain
        $inclSub = if ($domain -and $domain.StartsWith('.')) { "TRUE" } else { "FALSE" }
        $path = if ($c.path) { $c.path } else { "/" }
        $secure = if ($c.secure) { "TRUE" } else { "FALSE" }
        $expires = if ($c.expirationDate) { [int]$c.expirationDate } else { 0 }
        $lines += "$domain`t$inclSub`t$path`t$secure`t$expires`t$($c.name)`t$($c.value)"
    }
    [System.IO.File]::WriteAllText($cookieFile, ($lines -join "`n"), [System.Text.UTF8Encoding]::new($false))
    Write-Log "Wrote $($cookies.Count) cookies to $cookieFile"
    return $cookieFile
}

# --- Download Start ---
function Start-Download {
    param([hashtable]$params)

    $script:nextId++
    $id = "dl_$($script:nextId)_$([guid]::NewGuid().ToString('N').Substring(0,6))"
    $progressFile = Join-Path $env:TEMP "mdl_progress_$id.txt"
    "" | Set-Content $progressFile -Force

    $url = $params.url
    $title = $params.title
    $audioOnly = $params.audioOnly -eq $true
    $referer = $params.referer
    $streams = $params.streams
    $cookies = $params.cookies
    $isDirect = $url -match "fbcdn\.net|\.mp4\?|\.webm\?"

    # Cookie strategy for yt-dlp: prefer --cookies-from-browser chrome (reads Chrome's cookie DB directly)
    # Falls back to cookie file from GM_cookie data if provided
    $cookieFile = Write-CookieFile $cookies
    $isYouTube = $url -match 'youtube\.com|youtu\.be'

    $ffLoc = Split-Path $config.FfmpegPath -Parent
    $ffmpegExe = $config.FfmpegPath

    # --- DIRECT STREAM DOWNLOAD (primary path for YouTube) ---
    # The userscript extracts pre-authenticated stream URLs from the page.
    # These URLs have auth signatures embedded - no cookies/login needed on the server.
    # Works universally across all browser types.
    # Uses WebClient for YouTube CDN URLs (BITS struggles with long auth URLs).
    # Falls back to BITS if WebClient fails.
    if ($streams) {
        $safeName = Get-SafeFilename -title $streams.title -videoId $streams.videoId
        Write-Log "[$id] Direct stream: '$($streams.title)' audio=$audioOnly"

        if ($audioOnly -and $streams.audioUrl) {
            $outFile = Join-Path $config.DownloadPath "$safeName.mp3"
            $job = Start-Job -ScriptBlock {
                param($audioUrl, $outFile, $ffmpeg, $progressFile, $title)
                function Invoke-StreamDownload {
                    param([string]$Url, [string]$Dest, [string]$ProgFile, [string]$Label)
                    # WebClient first (reliable for YouTube CDN URLs), BITS fallback for non-CDN
                    try {
                        "[$Label] Downloading..." | Out-File $ProgFile -Append -Encoding utf8
                        $wc = New-Object System.Net.WebClient
                        $wc.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                        $wc.Headers.Add("Referer", "https://www.youtube.com/")
                        $wc.DownloadFile($Url, $Dest)
                        return $true
                    } catch {
                        "[$Label] WebClient failed ($($_.Exception.Message)), trying BITS..." | Out-File $ProgFile -Append -Encoding utf8
                        try {
                            Import-Module BitsTransfer -ErrorAction Stop
                            $bitsHeaders = "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36`r`nReferer: https://www.youtube.com/"
                            Start-BitsTransfer -Source $Url -Destination $Dest -CustomHeaders $bitsHeaders -Priority Foreground -ErrorAction Stop
                            return $true
                        } catch {
                            "ERROR: Download failed: $($_.Exception.Message)" | Out-File $ProgFile -Append -Encoding utf8
                            return $false
                        }
                    }
                }
                try {
                    "[$title] Downloading audio stream..." | Out-File $progressFile -Encoding utf8
                    $tempAudio = "$outFile.tmp_audio"
                    if (Invoke-StreamDownload -Url $audioUrl -Dest $tempAudio -ProgFile $progressFile -Label $title) {
                        "[download] 100% audio downloaded" | Out-File $progressFile -Append -Encoding utf8
                        "[extract] Converting to MP3..." | Out-File $progressFile -Append -Encoding utf8
                        & $ffmpeg -y -i $tempAudio -vn -acodec libmp3lame -q:a 0 $outFile 2>&1 | Out-Null
                        if (Test-Path $outFile) {
                            Remove-Item $tempAudio -Force -ErrorAction SilentlyContinue
                            "[download] 100% audio extraction complete" | Out-File $progressFile -Append -Encoding utf8
                        } else {
                            "ERROR: ffmpeg conversion failed" | Out-File $progressFile -Append -Encoding utf8
                        }
                    }
                } catch {
                    "ERROR: $($_.Exception.Message)" | Out-File $progressFile -Append -Encoding utf8
                }
            } -ArgumentList $streams.audioUrl, $outFile, $ffmpegExe, $progressFile, $safeName
        }
        elseif ($streams.combined) {
            $outFile = Join-Path $config.DownloadPath "$safeName.mp4"
            $job = Start-Job -ScriptBlock {
                param($videoUrl, $outFile, $progressFile, $title)
                function Invoke-StreamDownload {
                    param([string]$Url, [string]$Dest, [string]$ProgFile, [string]$Label)
                    # WebClient first (reliable for YouTube CDN URLs), BITS fallback for non-CDN
                    try {
                        "[$Label] Downloading..." | Out-File $ProgFile -Append -Encoding utf8
                        $wc = New-Object System.Net.WebClient
                        $wc.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                        $wc.Headers.Add("Referer", "https://www.youtube.com/")
                        $wc.DownloadFile($Url, $Dest)
                        return $true
                    } catch {
                        "[$Label] WebClient failed ($($_.Exception.Message)), trying BITS..." | Out-File $ProgFile -Append -Encoding utf8
                        try {
                            Import-Module BitsTransfer -ErrorAction Stop
                            $bitsHeaders = "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36`r`nReferer: https://www.youtube.com/"
                            Start-BitsTransfer -Source $Url -Destination $Dest -CustomHeaders $bitsHeaders -Priority Foreground -ErrorAction Stop
                            return $true
                        } catch {
                            "ERROR: Download failed: $($_.Exception.Message)" | Out-File $ProgFile -Append -Encoding utf8
                            return $false
                        }
                    }
                }
                try {
                    "[$title] Downloading combined stream..." | Out-File $progressFile -Encoding utf8
                    if (Invoke-StreamDownload -Url $videoUrl -Dest $outFile -ProgFile $progressFile -Label $title) {
                        "[download] 100% of combined stream" | Out-File $progressFile -Append -Encoding utf8
                    }
                } catch {
                    "ERROR: $($_.Exception.Message)" | Out-File $progressFile -Append -Encoding utf8
                }
            } -ArgumentList $streams.videoUrl, $outFile, $progressFile, $safeName
        }
        elseif ($streams.videoUrl -and $streams.audioUrl) {
            $outFile = Join-Path $config.DownloadPath "$safeName.mp4"
            $job = Start-Job -ScriptBlock {
                param($videoUrl, $audioUrl, $outFile, $ffmpeg, $progressFile, $title)
                function Invoke-StreamDownload {
                    param([string]$Url, [string]$Dest, [string]$ProgFile, [string]$Label)
                    # WebClient first (reliable for YouTube CDN URLs), BITS fallback for non-CDN
                    try {
                        "[$Label] Downloading..." | Out-File $ProgFile -Append -Encoding utf8
                        $wc = New-Object System.Net.WebClient
                        $wc.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                        $wc.Headers.Add("Referer", "https://www.youtube.com/")
                        $wc.DownloadFile($Url, $Dest)
                        return $true
                    } catch {
                        "[$Label] WebClient failed ($($_.Exception.Message)), trying BITS..." | Out-File $ProgFile -Append -Encoding utf8
                        try {
                            Import-Module BitsTransfer -ErrorAction Stop
                            $bitsHeaders = "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36`r`nReferer: https://www.youtube.com/"
                            Start-BitsTransfer -Source $Url -Destination $Dest -CustomHeaders $bitsHeaders -Priority Foreground -ErrorAction Stop
                            return $true
                        } catch {
                            "ERROR: Download failed: $($_.Exception.Message)" | Out-File $ProgFile -Append -Encoding utf8
                            return $false
                        }
                    }
                }
                try {
                    $tempVideo = "$outFile.tmp_video"
                    $tempAudio = "$outFile.tmp_audio"

                    "[$title] Downloading video stream..." | Out-File $progressFile -Encoding utf8
                    $vidOk = Invoke-StreamDownload -Url $videoUrl -Dest $tempVideo -ProgFile $progressFile -Label $title
                    if ($vidOk) {
                        "[download] 50% - video complete" | Out-File $progressFile -Append -Encoding utf8
                    } else { return }

                    "[$title] Downloading audio stream..." | Out-File $progressFile -Append -Encoding utf8
                    $audOk = Invoke-StreamDownload -Url $audioUrl -Dest $tempAudio -ProgFile $progressFile -Label $title
                    if ($audOk) {
                        "[download] 80% - audio complete" | Out-File $progressFile -Append -Encoding utf8
                    } else { return }

                    "[Merger] Merging formats into `"$outFile`"" | Out-File $progressFile -Append -Encoding utf8
                    & $ffmpeg -y -i $tempVideo -i $tempAudio -c:v copy -c:a aac -movflags +faststart $outFile 2>&1 | Out-Null
                    Start-Sleep -Milliseconds 500

                    if (Test-Path $outFile) {
                        "[download] 100% merge complete" | Out-File $progressFile -Append -Encoding utf8
                        Start-Sleep -Milliseconds 200
                        Remove-Item $tempVideo -Force -ErrorAction SilentlyContinue
                        Remove-Item $tempAudio -Force -ErrorAction SilentlyContinue
                    } else {
                        "ERROR: ffmpeg merge failed" | Out-File $progressFile -Append -Encoding utf8
                    }
                } catch {
                    "ERROR: $($_.Exception.Message)" | Out-File $progressFile -Append -Encoding utf8
                }
            } -ArgumentList $streams.videoUrl, $streams.audioUrl, $outFile, $ffmpegExe, $progressFile, $safeName
        }
        else {
            Write-Log "[$id] Streams object incomplete, falling back to yt-dlp"
            $streams = $null
        }
    }

    # --- YT-DLP FALLBACK (non-YouTube sites, or when streams unavailable) ---
    if (-not $streams) {
        if ($isDirect -and $title) {
            $safeName = $title -replace '[<>:"/\\|?*]', '_' -replace '_+', '_'
            $safeName = $safeName.Trim('_. ')
            if ($safeName.Length -gt 120) { $safeName = $safeName.Substring(0, 120).TrimEnd('_. ') }
            $ext = if ($audioOnly) { "mp3" } else { "%(ext)s" }
            $outTpl = Join-Path $config.DownloadPath "$safeName.$ext"
        } else {
            $ext = if ($audioOnly) { "mp3" } else { "%(ext)s" }
            $outTpl = Join-Path $config.DownloadPath "%(title)s.$ext"
        }

        Write-Log "[$id] yt-dlp fallback: url=$($url.Substring(0, [Math]::Min(80, $url.Length)))... audio=$audioOnly"

        if ($audioOnly -and $isDirect) {
            $tempVideo = Join-Path $config.DownloadPath "mdl_temp_$([guid]::NewGuid().ToString('N')).mp4"
            $job = Start-Job -ScriptBlock {
                param($ytdlp, $ffmpeg, $vUrl, $tempVideo, $outMp3, $outFile, $ref, $ckFile, $isYT)
                $dlArgs = @('--newline', '--progress', '-o', $tempVideo)
                if ($ref) { $dlArgs += '--referer'; $dlArgs += $ref }
                if ($isYT) { $dlArgs += '--cookies-from-browser'; $dlArgs += 'chrome' }
                elseif ($ckFile -and (Test-Path $ckFile)) { $dlArgs += '--cookies'; $dlArgs += $ckFile }
                $dlArgs += $vUrl
                & $ytdlp @dlArgs 2>&1 | ForEach-Object { $_ | Out-File $outFile -Append -Encoding utf8 }
                if (Test-Path $tempVideo) {
                    "[extract] Extracting audio..." | Out-File $outFile -Append -Encoding utf8
                    & $ffmpeg -i $tempVideo -vn -acodec libmp3lame -q:a 0 -y $outMp3 2>&1 | Out-Null
                    if (Test-Path $outMp3) {
                        Remove-Item $tempVideo -Force -ErrorAction SilentlyContinue
                        "[download] 100% audio extraction complete" | Out-File $outFile -Append -Encoding utf8
                    }
                }
                if ($ckFile -and (Test-Path $ckFile)) { Remove-Item $ckFile -Force -ErrorAction SilentlyContinue }
            } -ArgumentList $config.YtDlpPath, $config.FfmpegPath, $url, $tempVideo, $outTpl, $progressFile, $referer, $cookieFile, $isYouTube
        }
        elseif ($audioOnly) {
            $job = Start-Job -ScriptBlock {
                param($ytdlp, $ffLoc, $outTpl, $vUrl, $outFile, $ref, $ckFile, $isYT)
                $a = @('-f', 'bestaudio', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0',
                       '--newline', '--progress', '--ffmpeg-location', $ffLoc, '-o', $outTpl)
                if ($ref) { $a += '--referer'; $a += $ref }
                if ($isYT) { $a += '--cookies-from-browser'; $a += 'chrome' }
                elseif ($ckFile -and (Test-Path $ckFile)) { $a += '--cookies'; $a += $ckFile }
                $a += $vUrl
                & $ytdlp @a 2>&1 | ForEach-Object { $_ | Out-File $outFile -Append -Encoding utf8 }
                if ($ckFile -and (Test-Path $ckFile)) { Remove-Item $ckFile -Force -ErrorAction SilentlyContinue }
            } -ArgumentList $config.YtDlpPath, $ffLoc, $outTpl, $url, $progressFile, $referer, $cookieFile, $isYouTube
        }
        elseif ($isDirect) {
            $job = Start-Job -ScriptBlock {
                param($ytdlp, $ffLoc, $outTpl, $vUrl, $outFile, $ref, $ckFile, $isYT)
                $a = @('--newline', '--progress', '--ffmpeg-location', $ffLoc, '-o', $outTpl)
                if ($ref) { $a += '--referer'; $a += $ref }
                if ($isYT) { $a += '--cookies-from-browser'; $a += 'chrome' }
                elseif ($ckFile -and (Test-Path $ckFile)) { $a += '--cookies'; $a += $ckFile }
                $a += $vUrl
                & $ytdlp @a 2>&1 | ForEach-Object { $_ | Out-File $outFile -Append -Encoding utf8 }
                if ($ckFile -and (Test-Path $ckFile)) { Remove-Item $ckFile -Force -ErrorAction SilentlyContinue }
            } -ArgumentList $config.YtDlpPath, $ffLoc, $outTpl, $url, $progressFile, $referer, $cookieFile, $isYouTube
        }
        else {
            $job = Start-Job -ScriptBlock {
                param($ytdlp, $ffLoc, $outTpl, $vUrl, $outFile, $ref, $ckFile, $isYT)
                $a = @('-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
                       '--merge-output-format', 'mp4', '--newline', '--progress',
                       '--ffmpeg-location', $ffLoc, '-o', $outTpl)
                if ($ref) { $a += '--referer'; $a += $ref }
                if ($isYT) { $a += '--cookies-from-browser'; $a += 'chrome' }
                elseif ($ckFile -and (Test-Path $ckFile)) { $a += '--cookies'; $a += $ckFile }
                $a += $vUrl
                & $ytdlp @a 2>&1 | ForEach-Object { $_ | Out-File $outFile -Append -Encoding utf8 }
                if ($ckFile -and (Test-Path $ckFile)) { Remove-Item $ckFile -Force -ErrorAction SilentlyContinue }
            } -ArgumentList $config.YtDlpPath, $ffLoc, $outTpl, $url, $progressFile, $referer, $cookieFile, $isYouTube
        }
    }

    $dlTitle = if ($streams) { $streams.title } elseif ($title) { $title } else { "Unknown" }

    $downloads[$id] = @{
        id = $id; url = $url; title = $dlTitle
        audioOnly = $audioOnly; status = "downloading"; progress = 0
        speed = ""; eta = ""; job = $job; progressFile = $progressFile
        startTime = (Get-Date); filename = ""; mode = if ($streams) { "direct" } else { "ytdlp" }
    }

    Write-Log "[$id] Started (mode=$($downloads[$id].mode))"
    return $id
}

function Update-Downloads {
    foreach ($id in @($downloads.Keys)) {
        $dl = $downloads[$id]
        if ($dl.status -eq 'complete' -or $dl.status -eq 'failed' -or $dl.status -eq 'cancelled') { continue }
        if (-not $dl.job) { continue }

        if (Test-Path $dl.progressFile) {
            try {
                $content = Get-Content $dl.progressFile -Raw -ErrorAction SilentlyContinue
                if ($content) {
                    $pctMatches = [regex]::Matches($content, '\[download\]\s+(\d+\.?\d*)%')
                    if ($pctMatches.Count -gt 0) {
                        $dl.progress = [double]$pctMatches[$pctMatches.Count - 1].Groups[1].Value
                    }
                    if ($content -match '(?s).*of\s+~?(\d+\.?\d*\w+)\s+at\s+(\S+)\s+ETA\s+(\S+)') {
                        $dl.speed = $matches[2]; $dl.eta = $matches[3]
                    }
                    if ($content -match '\[Merger\]|Merging formats|merge complete') { $dl.status = "merging" }
                    elseif ($content -match '\[ExtractAudio\]|\[extract\]|Converting to MP3') { $dl.status = "extracting" }
                    elseif ($content -match 'already been downloaded') { $dl.progress = 100; $dl.status = "complete" }
                    if ($content -match '\[download\] Destination: (.+)') { $dl.filename = $matches[1] }
                    elseif ($content -match '\[Merger\] Merging formats into "(.+)"') { $dl.filename = $matches[1] }
                }
            } catch {}
        }

        if ($dl.job.State -ne "Running") {
            $output = ""
            try { $output = Receive-Job -Job $dl.job -ErrorAction SilentlyContinue | Out-String } catch {}
            $allOutput = $output
            if (Test-Path $dl.progressFile) {
                try { $allOutput += Get-Content $dl.progressFile -Raw -ErrorAction SilentlyContinue } catch {}
            }

            if ($allOutput -match "100%|has already been downloaded|Merging formats into|DelayedMuxer|audio extraction complete|merge complete") {
                $dl.status = "complete"; $dl.progress = 100
                Write-Log "[$id] Complete (mode=$($dl.mode))"
            } else {
                $dl.status = "failed"
                $snippet = if ($allOutput.Length -gt 300) { $allOutput.Substring(0, 300) } else { $allOutput }
                Write-Log "[$id] Failed: $snippet"
            }

            try { Remove-Job -Job $dl.job -Force -ErrorAction SilentlyContinue } catch {}
            if (Test-Path $dl.progressFile) { Remove-Item $dl.progressFile -Force -ErrorAction SilentlyContinue }
        }
    }
}

function Reap-Zombies {
    $cutoff = (Get-Date).AddMinutes(-$ZOMBIE_MINUTES)
    foreach ($id in @($downloads.Keys)) {
        $dl = $downloads[$id]
        if ($dl.status -ne 'downloading' -and $dl.status -ne 'merging' -and $dl.status -ne 'extracting') { continue }

        # Reap immediately if job is dead but status wasn't updated
        if ($dl.job -and $dl.job.State -ne "Running") {
            Write-Log "[$id] Zombie reaped (job dead, started $($dl.startTime.ToString('HH:mm:ss')))"
            $dl.status = "failed"
            try { Remove-Job -Job $dl.job -Force -ErrorAction SilentlyContinue } catch {}
            if ($dl.progressFile -and (Test-Path $dl.progressFile)) {
                Remove-Item $dl.progressFile -Force -ErrorAction SilentlyContinue
            }
            continue
        }

        # Force-kill jobs stuck past the timeout
        if ($dl.startTime -lt $cutoff) {
            Write-Log "[$id] Zombie reaped (timeout, started $($dl.startTime.ToString('HH:mm:ss')))"
            $dl.status = "failed"
            if ($dl.job) {
                try { Stop-Job -Job $dl.job -ErrorAction SilentlyContinue } catch {}
                try { Remove-Job -Job $dl.job -Force -ErrorAction SilentlyContinue } catch {}
            }
            if ($dl.progressFile -and (Test-Path $dl.progressFile)) {
                Remove-Item $dl.progressFile -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

function Clean-OldDownloads {
    $cutoff = (Get-Date).AddMinutes(-$CLEANUP_MINUTES)
    foreach ($id in @($downloads.Keys)) {
        $dl = $downloads[$id]
        if (($dl.status -eq 'complete' -or $dl.status -eq 'failed' -or $dl.status -eq 'cancelled') -and $dl.startTime -lt $cutoff) {
            $downloads.Remove($id)
        }
    }
}

# --- HTTP Listener ---
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$PORT/")

try { $listener.Start() }
catch { Write-Log "FATAL: Cannot start listener on port $PORT - $_"; exit 1 }

Write-Log "Server listening on http://127.0.0.1:$PORT"

$lastCleanup = Get-Date

while ($listener.IsListening) {
    try {
        $result = $listener.BeginGetContext($null, $null)
        while (-not $result.AsyncWaitHandle.WaitOne(2000)) {
            Update-Downloads
            Reap-Zombies
            if ((Get-Date) -gt $lastCleanup.AddMinutes(1)) {
                Clean-OldDownloads
                $lastCleanup = Get-Date
            }
        }

        $context = $listener.EndGetContext($result)
        $req = $context.Request
        $method = $req.HttpMethod
        $path = $req.Url.AbsolutePath.TrimEnd('/')

        Write-Log "REQ: $method $path"

        if ($method -eq 'OPTIONS') {
            New-JsonResponse $context @{ ok = $true }
            continue
        }

        if ($path -ne '/health') {
            $token = $req.Headers["X-Auth-Token"]
            if ($token -ne $authToken) {
                New-JsonResponse $context @{ error = "Unauthorized" } 401
                continue
            }
        }

        switch -Regex ($path) {
            '^/health$' {
                $active = ($downloads.Values | Where-Object { $_.status -eq 'downloading' -or $_.status -eq 'merging' -or $_.status -eq 'extracting' }).Count
                $resp = @{
                    status = "ok"; version = $SERVER_VERSION; port = $PORT
                    downloads = $active; token_required = $true
                }
                $clientId = $req.Headers["X-MDL-Client"]
                if ($clientId -eq "MediaDL") {
                    $resp.token = $authToken
                }
                New-JsonResponse $context $resp
            }
            '^/download$' {
                if ($method -ne 'POST') {
                    New-JsonResponse $context @{ error = "Method not allowed" } 405
                    break
                }
                $body = Read-RequestBody $req
                if (-not $body) { New-JsonResponse $context @{ error = "Empty body" } 400; break }
                try { $params = $body | ConvertFrom-Json } catch { New-JsonResponse $context @{ error = "Invalid JSON" } 400; break }
                if (-not $params.url) { New-JsonResponse $context @{ error = "Missing url" } 400; break }

                # Check for duplicate in-progress download
                if (Test-AlreadyDownloading $params.url) {
                    New-JsonResponse $context @{ status = "downloading"; message = "Already downloading" }
                    break
                }

                # Check for existing file
                $vid = if ($params.streams) { $params.streams.videoId } else { $null }
                $existing = Find-ExistingFile -url $params.url -videoId $vid -audioOnly ($params.audioOnly -eq $true)
                if ($existing) {
                    Write-Log "File already exists: $existing"
                    New-JsonResponse $context @{ status = "complete"; message = "Already downloaded"; filename = $existing }
                    break
                }

                $active = ($downloads.Values | Where-Object { $_.status -eq 'downloading' -or $_.status -eq 'merging' -or $_.status -eq 'extracting' }).Count
                if ($active -ge $MAX_CONCURRENT) {
                    New-JsonResponse $context @{ error = "Too many concurrent downloads"; active = $active } 429
                    break
                }

                # Convert streams from PSCustomObject to hashtable for Start-Job
                $streamsHt = $null
                if ($params.streams) {
                    $streamsHt = @{}
                    $params.streams.PSObject.Properties | ForEach-Object { $streamsHt[$_.Name] = $_.Value }
                }

                # Convert cookies array for cookie file writer
                $cookiesArr = $null
                if ($params.cookies) {
                    $cookiesArr = @()
                    foreach ($c in $params.cookies) {
                        $cht = @{}
                        $c.PSObject.Properties | ForEach-Object { $cht[$_.Name] = $_.Value }
                        $cookiesArr += $cht
                    }
                }

                $ht = @{
                    url = $params.url; title = $params.title
                    audioOnly = $params.audioOnly; referer = $params.referer
                    streams = $streamsHt; cookies = $cookiesArr
                }
                $id = Start-Download $ht
                New-JsonResponse $context @{ id = $id; status = "downloading" }
            }
            '^/status/(.+)$' {
                $id = $matches[1]
                if ($downloads.ContainsKey($id)) {
                    $dl = $downloads[$id]
                    New-JsonResponse $context @{
                        id = $dl.id; status = $dl.status; progress = [math]::Round($dl.progress, 1)
                        speed = $dl.speed; eta = $dl.eta; title = $dl.title; filename = $dl.filename
                    }
                } else { New-JsonResponse $context @{ error = "Not found" } 404 }
            }
            '^/queue$' {
                $list = @()
                foreach ($dl in $downloads.Values) {
                    $list += @{
                        id = $dl.id; status = $dl.status; progress = [math]::Round($dl.progress, 1)
                        title = $dl.title; speed = $dl.speed; eta = $dl.eta; mode = $dl.mode
                    }
                }
                New-JsonResponse $context @{ downloads = $list; count = $list.Count }
            }
            '^/cancel/(.+)$' {
                if ($method -ne 'DELETE') { New-JsonResponse $context @{ error = "Method not allowed" } 405; break }
                $id = $matches[1]
                if ($downloads.ContainsKey($id)) {
                    $dl = $downloads[$id]
                    if ($dl.job) {
                        try { Stop-Job -Job $dl.job -ErrorAction SilentlyContinue; Remove-Job -Job $dl.job -Force -ErrorAction SilentlyContinue } catch {}
                    }
                    $dl.status = "cancelled"
                    if (Test-Path $dl.progressFile) { Remove-Item $dl.progressFile -Force -ErrorAction SilentlyContinue }
                    New-JsonResponse $context @{ id = $id; cancelled = $true }
                } else { New-JsonResponse $context @{ error = "Not found" } 404 }
            }
            '^/shutdown$' {
                Write-Log "Shutdown requested"
                New-JsonResponse $context @{ status = "shutting_down" }
                $listener.Stop()
            }
            default { New-JsonResponse $context @{ error = "Not found"; path = $path } 404 }
        }
    }
    catch {
        Write-Log "Loop error: $_"
        Start-Sleep -Milliseconds 500
    }
}

foreach ($dl in $downloads.Values) {
    if ($dl.job) {
        try { Stop-Job -Job $dl.job -ErrorAction SilentlyContinue; Remove-Job -Job $dl.job -Force } catch {}
    }
    if ($dl.progressFile -and (Test-Path $dl.progressFile)) {
        Remove-Item $dl.progressFile -Force -ErrorAction SilentlyContinue
    }
}
Write-Log "=== Server stopped ==="
'@
                    $serverScript | Set-Content (Join-Path $script:InstallPath "ytdl-server.ps1") -Encoding UTF8
                    Update-Status "  [OK] MediaDL server written"
                    
                    $vbsTemplate = @'
Set objShell = CreateObject("WScript.Shell")
objShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{SCRIPT}"" """ & WScript.Arguments(0) & """", 0, False
'@
                    # Always create download launcher
                    $vbs = $vbsTemplate -replace '{SCRIPT}', (Join-Path $script:InstallPath "ytdl-handler.ps1")
                    $vbs | Set-Content (Join-Path $script:InstallPath "ytdl-launcher.vbs") -Encoding ASCII
                    
                    # VLC launchers only if VLC enabled
                    if ($chkInstallVlc.IsChecked) {
                        @("ytvlc", "ytvlcq") | ForEach-Object {
                            $vbs = $vbsTemplate -replace '{SCRIPT}', (Join-Path $script:InstallPath "$_-handler.ps1")
                            $vbs | Set-Content (Join-Path $script:InstallPath "$_-launcher.vbs") -Encoding ASCII
                        }
                    }
                    Update-Status "  [OK] Silent launchers created"
                    Set-Progress 70
                    
                    # Step 6b: Install MediaDL HTTP Server
                    Update-Status "Installing MediaDL server..."
                    
                    $serverLauncher = Join-Path $script:InstallPath "ytdl-server-launcher.vbs"
                    
                    # Server launcher VBS (runs completely hidden)
                    $serverVbs = @'
Set objShell = CreateObject("WScript.Shell")
strPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
strCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & strPath & "\ytdl-server.ps1"""
objShell.Run strCmd, 0, False
'@
                    $serverVbs | Set-Content $serverLauncher -Encoding ASCII
                    
                    # Register server as startup task (runs hidden on login)
                    $taskName = "MediaDL-Server"
                    $taskRegistered = $false
                    try {
                        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
                        $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$serverLauncher`""
                        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
                        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Days 365)
                        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "MediaDL background server for browser downloads" -Force -ErrorAction Stop | Out-Null
                        Update-Status "  [OK] Server registered as startup task"
                        $taskRegistered = $true
                    } catch {
                        Update-Status "  [INFO] Scheduled task requires admin - using startup folder instead"
                    }
                    if (-not $taskRegistered) {
                        # Scheduled task needs admin - use startup folder instead
                        $startupFolder = [Environment]::GetFolderPath('Startup')
                        $shortcutPath = Join-Path $startupFolder "MediaDL-Server.lnk"
                        $ws = New-Object -ComObject WScript.Shell
                        $sc = $ws.CreateShortcut($shortcutPath)
                        $sc.TargetPath = "wscript.exe"
                        $sc.Arguments = "`"$serverLauncher`""
                        $sc.WindowStyle = 7  # Minimized
                        $sc.Description = "MediaDL background server"
                        $sc.Save()
                        Update-Status "  [OK] Server added to startup folder"
                    }
                    
                    # Start the server now (kill any existing instance first)
                    try {
                        $existingProcs = Get-NetTCPConnection -LocalPort 9751 -State Listen -ErrorAction SilentlyContinue |
                            ForEach-Object { Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue }
                        $existingProcs | Stop-Process -Force -ErrorAction SilentlyContinue
                        Start-Sleep -Milliseconds 300
                    } catch {}
                    
                    try {
                        Start-Process -FilePath "wscript.exe" -ArgumentList "`"$serverLauncher`"" -ErrorAction SilentlyContinue
                        Update-Status "  [OK] Server started (port $($config.ServerPort))"
                    } catch {
                        Update-Status "  [WARN] Server start failed - will start on next login"
                    }
                    
                    Set-Progress 73
                    
                    # Step 7: Register protocols
                    Update-Status "Registering URL protocols..."
                    
                    # VLC protocols (only if VLC enabled)
                    if ($chkInstallVlc.IsChecked) {
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
                    }
                    
                    # ytdl:// (always)
                    $protocolRoot = "HKCU:\Software\Classes\ytdl"
                    New-Item -Path $protocolRoot -Force | Out-Null
                    Set-ItemProperty -Path $protocolRoot -Name "(Default)" -Value "URL:YTDL Protocol"
                    Set-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value ""
                    New-Item -Path "$protocolRoot\shell\open\command" -Force | Out-Null
                    Set-ItemProperty -Path "$protocolRoot\shell\open\command" -Name "(Default)" -Value "wscript.exe `"$(Join-Path $script:InstallPath 'ytdl-launcher.vbs')`" `"%1`""
                    
                    # mediadl:// (server auto-start protocol — fires the VBS launcher)
                    $protocolRoot = "HKCU:\Software\Classes\mediadl"
                    New-Item -Path $protocolRoot -Force | Out-Null
                    Set-ItemProperty -Path $protocolRoot -Name "(Default)" -Value "URL:MediaDL Protocol"
                    Set-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value ""
                    New-Item -Path "$protocolRoot\shell\open\command" -Force | Out-Null
                    Set-ItemProperty -Path "$protocolRoot\shell\open\command" -Name "(Default)" -Value "wscript.exe `"$(Join-Path $script:InstallPath 'ytdl-server-launcher.vbs')`""

                    $registeredProtocols = "ytdl://, mediadl://"
                    if ($chkInstallVlc.IsChecked) { $registeredProtocols = "ytvlc://, ytvlcq://, ytdl://, mediadl://" }
                    Update-Status "  [OK] Registered: $registeredProtocols"
                    Set-Progress 80
                    
                    Set-Progress 85
                    
                    # Step 9: Ollama + AI Models (optional)
                    if ($chkInstallOllama.IsChecked) {
                        $selectedModels = @($script:OllamaModelCheckboxes.GetEnumerator() | Where-Object { $_.Value.IsChecked } | ForEach-Object { $_.Key })
                        if ($selectedModels.Count -eq 0) { $selectedModels = @("qwen3:32b") }
                        
                        # Install Ollama if not present
                        if (-not $script:OllamaFound) {
                            Update-Status "Installing Ollama (Local AI runtime)..."
                            Set-Progress 87
                            $wingetPath = Get-Command winget -ErrorAction SilentlyContinue
                            if ($wingetPath) {
                                try {
                                    Invoke-ProcessWithUI -FilePath "winget" -Arguments "install", "--id", "Ollama.Ollama", "--accept-package-agreements", "--accept-source-agreements", "-h"
                                    Start-Sleep -Seconds 3
                                    # Re-check for Ollama after install
                                    foreach ($path in $ollamaPaths) {
                                        if (Test-Path $path) {
                                            $script:OllamaFound = $path
                                            break
                                        }
                                    }
                                    if (-not $script:OllamaFound) {
                                        $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
                                        if ($ollamaCmd) { $script:OllamaFound = $ollamaCmd.Source }
                                    }
                                    if ($script:OllamaFound) {
                                        Update-Status "  [OK] Ollama installed: $($script:OllamaFound)"
                                    } else {
                                        Update-Status "  [!] Ollama install may need a restart to complete"
                                        Update-Status "      Download manually from: https://ollama.com/download"
                                    }
                                } catch {
                                    Update-Status "  [!] Winget install failed: $($_.Exception.Message)"
                                    Update-Status "      Download manually from: https://ollama.com/download"
                                }
                            } else {
                                # Direct download fallback
                                try {
                                    Update-Status "  Downloading Ollama installer..."
                                    $ollamaSetup = Join-Path $env:TEMP "OllamaSetup.exe"
                                    Invoke-DownloadWithUI -Uri $script:OllamaInstallerUrl -OutFile $ollamaSetup
                                    Update-Status "  Running Ollama installer (silent)..."
                                    Invoke-ProcessWithUI -FilePath $ollamaSetup -Arguments "/SILENT"
                                    Start-Sleep -Seconds 3
                                    Remove-Item $ollamaSetup -Force -ErrorAction SilentlyContinue
                                    foreach ($path in $ollamaPaths) {
                                        if (Test-Path $path) {
                                            $script:OllamaFound = $path
                                            break
                                        }
                                    }
                                    if ($script:OllamaFound) {
                                        Update-Status "  [OK] Ollama installed: $($script:OllamaFound)"
                                    }
                                } catch {
                                    Update-Status "  [!] Download failed: $($_.Exception.Message)"
                                }
                            }
                        } else {
                            Update-Status "Ollama already installed: $($script:OllamaFound)"
                        }
                        Set-Progress 90
                        
                        # Ensure Ollama service is running
                        if ($script:OllamaFound) {
                            Update-Status "Starting Ollama service..."
                            try {
                                # Try to reach the API first
                                $apiUp = $false
                                try {
                                    $null = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 2 -ErrorAction Stop
                                    $apiUp = $true
                                } catch {}
                                
                                if (-not $apiUp) {
                                    # Start Ollama serve in background
                                    $psi = New-Object System.Diagnostics.ProcessStartInfo
                                    $psi.FileName = $script:OllamaFound
                                    $psi.Arguments = "serve"
                                    $psi.CreateNoWindow = $true
                                    $psi.UseShellExecute = $false
                                    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
                                    [System.Diagnostics.Process]::Start($psi) | Out-Null
                                    Start-Sleep -Seconds 4
                                    # Verify it started
                                    try {
                                        $null = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 3 -ErrorAction Stop
                                        $apiUp = $true
                                        Update-Status "  [OK] Ollama service started"
                                    } catch {
                                        Update-Status "  [!] Ollama service may need manual start"
                                    }
                                } else {
                                    Update-Status "  [OK] Ollama service already running"
                                }
                            } catch {
                                Update-Status "  [!] Could not start Ollama: $($_.Exception.Message)"
                            }
                            Set-Progress 92
                            
                            # Ensure Ollama starts on login (startup shortcut)
                            try {
                                $startupDir = [Environment]::GetFolderPath('Startup')
                                $shortcutPath = Join-Path $startupDir "Ollama.lnk"
                                if (-not (Test-Path $shortcutPath)) {
                                    $ws = New-Object -ComObject WScript.Shell
                                    $shortcut = $ws.CreateShortcut($shortcutPath)
                                    $shortcut.TargetPath = $script:OllamaFound
                                    $shortcut.Arguments = "serve"
                                    $shortcut.WindowStyle = 7  # Minimized
                                    $shortcut.Description = "Ollama AI Server"
                                    $shortcut.Save()
                                    Update-Status "  [OK] Ollama set to auto-start on login"
                                }
                            } catch {
                                Update-Status "  [i] Could not add startup entry (non-critical)"
                            }
                            
                            # Pull all selected models
                            $pulledModels = @()
                            $modelIdx = 0
                            foreach ($selectedModel in $selectedModels) {
                                $modelIdx++
                                # Check if model is already installed
                                $modelInstalled = $false
                                try {
                                    $tagResponse = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 3 -ErrorAction SilentlyContinue
                                    if ($tagResponse.models) {
                                        foreach ($m in $tagResponse.models) {
                                            if ($m.name -like "$selectedModel*") {
                                                $modelInstalled = $true
                                                break
                                            }
                                        }
                                    }
                                } catch {}
                                
                                if ($modelInstalled) {
                                    Update-Status "  [OK] Model '$selectedModel' already installed ($modelIdx/$($selectedModels.Count))"
                                    $pulledModels += $selectedModel
                                } else {
                                    Update-Status "Pulling AI model: $selectedModel ($modelIdx/$($selectedModels.Count)) - large download, may take 5-15 minutes..."
                                    Set-Progress (92 + [int]($modelIdx / $selectedModels.Count * 3))
                                    try {
                                        $pullBody = @{ name = $selectedModel; stream = $false } | ConvertTo-Json
                                        Invoke-RestMethod -Uri "http://localhost:11434/api/pull" -Method Post -Body $pullBody -ContentType "application/json" -TimeoutSec 1800 -ErrorAction Stop | Out-Null
                                        Update-Status "  [OK] Model '$selectedModel' ready"
                                        $pulledModels += $selectedModel
                                    } catch {
                                        # Streaming response may cause parse error but still succeed
                                        Start-Sleep -Seconds 2
                                        $verified = $false
                                        try {
                                            $tagResponse = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 3 -ErrorAction SilentlyContinue
                                            if ($tagResponse.models) {
                                                foreach ($m in $tagResponse.models) {
                                                    if ($m.name -like "$selectedModel*") { $verified = $true; break }
                                                }
                                            }
                                        } catch {}
                                        
                                        if ($verified) {
                                            Update-Status "  [OK] Model '$selectedModel' ready"
                                            $pulledModels += $selectedModel
                                        } else {
                                            Update-Status "  [!] Model '$selectedModel' pull may still be in progress"
                                            Update-Status "      Run manually: ollama pull $selectedModel"
                                        }
                                    }
                                }
                            }
                            
                            # Update Ollama indicator
                            $window.Dispatcher.Invoke([action]{
                                $ollamaIndicator.Fill = [System.Windows.Media.Brushes]::LimeGreen
                                $txtOllamaStatus.Text = "Ready with $($pulledModels.Count) model(s)"
                            }, [System.Windows.Threading.DispatcherPriority]::Render)
                        }
                    }
                    Set-Progress 96
                    
                    Set-Progress 98
                    
                    # Step 11: Desktop shortcut (optional)
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
                    Update-Status "Installation complete!"
                    Update-Status ""
                    Update-Status "  Installed: yt-dlp, ffmpeg, ytdl:// protocol"
                    Update-Status "  MediaDL Server: http://127.0.0.1:9751 (auto-start on login)"
                    if ($chkInstallVlc.IsChecked) {
                        Update-Status "  VLC: ytvlc://, ytvlcq:// protocols"
                    }
                    if ($chkInstallOllama.IsChecked) {
                        Update-Status "  AI: Ollama + $($selectedModels -join ', ')"
                        Update-Status "      Ollama ready at localhost:11434 (for use with Chapterizer)"
                    }
                    Update-Status ""
                    Update-Status "  Install YTKit in ScriptVault to connect to the server."
                    Update-Status "========================================"
                    
                    $script:BaseToolsInstalled = $true
                    $btnNext.Content = "Next: ScriptVault"
                    
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
