# Leassh Agent Installer for Windows
# Usage: Run as Administrator
#   powershell -ExecutionPolicy Bypass -Command "& { iwr -useb https://leassh.com/install-windows.ps1 | iex }"
# Or with family code:
#   powershell -ExecutionPolicy Bypass -Command "& { $env:LEASSH_TOKEN='your-code'; iwr -useb https://leassh.com/install-windows.ps1 | iex }"

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
$DefaultServer = "api.leassh.com"
$DefaultName   = $env:COMPUTERNAME

# Server address
$Server = Read-Host "Leassh server address [$DefaultServer]"
if ([string]::IsNullOrWhiteSpace($Server)) { $Server = $DefaultServer }

# Family/device token
$Token = $env:LEASSH_TOKEN
if ([string]::IsNullOrWhiteSpace($Token)) {
    $Token = Read-Host "Family/device token (from your Leassh dashboard)"
}
if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Host "ERROR: A token is required. Find it in your Leassh dashboard under Devices > Add Device." -ForegroundColor Red
    exit 1
}

# Device friendly name
$Name = Read-Host "Friendly name for this computer [$DefaultName]"
if ([string]::IsNullOrWhiteSpace($Name)) { $Name = $DefaultName }

Write-Host ""
Write-Host "  Server : $Server" -ForegroundColor Cyan
Write-Host "  Token  : $($Token.Substring(0, [Math]::Min(6, $Token.Length)))..." -ForegroundColor Cyan
Write-Host "  Name   : $Name" -ForegroundColor Cyan
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
$BinaryUrl  = "https://releases.leassh.com/agent/latest/leassh-agent-windows-x64.exe"
$BinaryPath = Join-Path $InstallDir "leassh-agent.exe"

Write-Host "Downloading agent from $BinaryUrl ..." -ForegroundColor Yellow

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $BinaryUrl -OutFile $BinaryPath -UseBasicParsing
    Write-Host "[OK] Downloaded to $BinaryPath" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to download agent binary." -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "You can download manually from: $BinaryUrl" -ForegroundColor Yellow
    Write-Host "Place it at: $BinaryPath" -ForegroundColor Yellow
    exit 1
}

# ---------------------------------------------------------------------------
# 5. Run agent setup
# ---------------------------------------------------------------------------
Write-Host "Running agent setup..." -ForegroundColor Yellow

try {
    $setupArgs = "--setup", $Server, $Token, $Name
    $result = & $BinaryPath @setupArgs 2>&1
    Write-Host $result
    Write-Host "[OK] Agent setup complete" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Agent setup failed." -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Try running manually:" -ForegroundColor Yellow
    Write-Host "  & `"$BinaryPath`" --setup $Server <token> $Name" -ForegroundColor Yellow
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
    Write-Host "[WARN] Service not detected yet. It may take a moment to register." -ForegroundColor Yellow
    Write-Host "  Check status with: Get-Service LeasshAgent" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 7. Add to PATH
# ---------------------------------------------------------------------------
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
if ($machinePath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable(
        "Path", "$machinePath;$InstallDir", "Machine"
    )
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
Write-Host "  Dashboard: https://$Server/fleet"
Write-Host ""
Write-Host "  Manage the service:"
Write-Host "    Start:   Start-Service LeasshAgent"
Write-Host "    Stop:    Stop-Service LeasshAgent"
Write-Host "    Status:  Get-Service LeasshAgent"
Write-Host "    Remove:  & `"$BinaryPath`" --uninstall"
Write-Host ""
