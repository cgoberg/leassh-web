# Leassh Agent Installer for Windows
# Usage: Run as Administrator in PowerShell
#   $env:LEASSH_CODE='YOUR-CODE'; irm https://leassh.com/install.ps1 | iex
#
# Get your pairing code at: https://leassh.com/setup

$ErrorActionPreference = "Stop"

$Logo = @"

  _                        _
 | | ___  __ _ ___ ___| |__
 | |/ _ \/ _` / __/ __| '_ \
 | |  __/ (_| \__ \__ \ | | |
 |_|\___|\__,_|___/___/_| |_|

 Agent Installer for Windows

"@

Write-Host $Logo -ForegroundColor DarkYellow

# ---------------------------------------------------------------------------
# 1. Check administrator privileges
# ---------------------------------------------------------------------------
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)

if (-not $currentPrincipal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)) {
    Write-Host "ERROR: This installer must be run as Administrator." -ForegroundColor Red
    Write-Host ""
    Write-Host "Right-click PowerShell and choose 'Run as Administrator', then try again."
    exit 1
}

Write-Host "[OK] Running as Administrator" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2. Gather configuration
# ---------------------------------------------------------------------------
$Code = $env:LEASSH_CODE
if ([string]::IsNullOrWhiteSpace($Code)) {
    $Code = Read-Host "Pairing code (from https://leassh.com/setup)"
}
if ([string]::IsNullOrWhiteSpace($Code)) {
    Write-Host "ERROR: A pairing code is required. Get one at https://leassh.com/setup" -ForegroundColor Red
    exit 1
}

$DefaultName = $env:COMPUTERNAME
$Name = $env:LEASSH_NAME
if ([string]::IsNullOrWhiteSpace($Name)) {
    $Name = Read-Host "Friendly name for this computer [$DefaultName]"
    if ([string]::IsNullOrWhiteSpace($Name)) { $Name = $DefaultName }
}

Write-Host ""
Write-Host "  Pairing code : $($Code.Substring(0, [Math]::Min(6, $Code.Length)))..." -ForegroundColor Cyan
Write-Host "  Name         : $Name" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# 3. Create installation directory
# ---------------------------------------------------------------------------
$InstallDir = "C:\Program Files\Leassh"

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Write-Host "[OK] Created $InstallDir" -ForegroundColor Green
} else {
    Write-Host "[OK] $InstallDir already exists" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 4. Download the agent binary
# ---------------------------------------------------------------------------
$BinaryUrl = "https://github.com/leassh/leassh/releases/latest/download/leassh-agent-windows-x64.tar.gz"
$TempDir   = Join-Path $env:TEMP "leassh-install"
$TarPath   = Join-Path $TempDir "leassh-agent-windows-x64.tar.gz"
$BinaryPath = Join-Path $InstallDir "leassh-agent.exe"

if (-not (Test-Path $TempDir)) {
    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
}

Write-Host "Downloading agent from $BinaryUrl ..." -ForegroundColor Yellow

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $BinaryUrl -OutFile $TarPath -UseBasicParsing
    Write-Host "[OK] Downloaded archive" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to download agent binary." -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Download manually from: $BinaryUrl" -ForegroundColor Yellow
    Write-Host "Place the .exe at: $BinaryPath" -ForegroundColor Yellow
    exit 1
}

# Extract the tarball (requires tar, available on Windows 10 1803+)
Write-Host "Extracting..." -ForegroundColor Yellow
try {
    tar -xzf $TarPath -C $TempDir

    $ExtractedExe = Get-ChildItem -Path $TempDir -Filter "*.exe" -Recurse | Select-Object -First 1
    if ($ExtractedExe) {
        Copy-Item -Path $ExtractedExe.FullName -Destination $BinaryPath -Force
    } else {
        $ExtractedBin = Get-ChildItem -Path $TempDir -Recurse |
            Where-Object { $_.Name -match "^leassh" -and -not $_.Name.EndsWith(".tar.gz") } |
            Select-Object -First 1
        if ($ExtractedBin) {
            Copy-Item -Path $ExtractedBin.FullName -Destination $BinaryPath -Force
        } else {
            Write-Host "ERROR: Could not find agent binary in the downloaded archive." -ForegroundColor Red
            exit 1
        }
    }
    Write-Host "[OK] Installed to $BinaryPath" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to extract archive." -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    exit 1
} finally {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# 5. Run agent setup (pair with server)
# ---------------------------------------------------------------------------
Write-Host "Running agent setup..." -ForegroundColor Yellow

try {
    $result = & $BinaryPath --setup --pair $Code $Name 2>&1
    Write-Host $result
    Write-Host "[OK] Agent setup complete" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Agent setup failed." -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Try running manually:" -ForegroundColor Yellow
    Write-Host "  & `"$BinaryPath`" --setup --pair $Code $Name" -ForegroundColor Yellow
    exit 1
}

# ---------------------------------------------------------------------------
# 6. Verify the service is running
# ---------------------------------------------------------------------------
Write-Host "Verifying service..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

$service = Get-Service -Name "LeasshAgent" -ErrorAction SilentlyContinue

if ($null -ne $service -and $service.Status -eq "Running") {
    Write-Host "[OK] Leassh Agent service is running" -ForegroundColor Green
} else {
    Write-Host "[WARN] Service not detected yet — it may take a moment to register." -ForegroundColor Yellow
    Write-Host "  Check status with: Get-Service LeasshAgent" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 7. Add to PATH
# ---------------------------------------------------------------------------
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
if ($machinePath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$machinePath;$InstallDir", "Machine")
    Write-Host "[OK] Added $InstallDir to system PATH" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "============================================" -ForegroundColor DarkYellow
Write-Host "  Leassh Agent installed successfully!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor DarkYellow
Write-Host ""
Write-Host "  Device '$Name' will appear in your dashboard shortly."
Write-Host "  Dashboard: https://leassh.com/family"
Write-Host ""
Write-Host "  Manage the service:"
Write-Host "    Start:   Start-Service LeasshAgent"
Write-Host "    Stop:    Stop-Service LeasshAgent"
Write-Host "    Status:  Get-Service LeasshAgent"
Write-Host "    Remove:  & `"$BinaryPath`" --uninstall"
Write-Host ""
