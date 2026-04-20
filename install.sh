#!/bin/bash
# Leassh Agent Installer for Linux
# Usage: curl -fsSL https://leassh.com/install.sh | sudo bash
# Or with pairing code (from https://leassh.com/setup):
#   curl -fsSL https://leassh.com/install.sh | sudo LEASSH_CODE=your-code bash

set -euo pipefail

# ---------------------------------------------------------------------------
# Colors and helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
AMBER='\033[38;5;214m'
RESET='\033[0m'

info()  { printf "${GREEN}[OK]${RESET} %s\n" "$1"; }
warn()  { printf "${YELLOW}[WARN]${RESET} %s\n" "$1"; }
error() { printf "${RED}[ERROR]${RESET} %s\n" "$1"; }
step()  { printf "${CYAN}%s${RESET}\n" "$1"; }

cat <<'LOGO'

  _                        _
 | | ___  __ _ ___ ___| |__
 | |/ _ \/ _` / __/ __| '_ \
 | |  __/ (_| \__ \__ \ | | |
 |_|\___|\__,_|___/___/_| |_|

 Agent Installer for Linux

LOGO

# ---------------------------------------------------------------------------
# 1. Check root privileges (v0.1.3+)
# ---------------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
    error "This installer must be run as root (use sudo)."
    echo ""
    echo "  curl -fsSL https://leassh.com/install.sh | sudo bash"
    exit 1
fi

info "Running as root"

# ---------------------------------------------------------------------------
# 2. Detect OS and architecture
# ---------------------------------------------------------------------------
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Linux)  PLATFORM="linux"  ;;
    Darwin) PLATFORM="darwin" ;;
    *)
        error "Unsupported operating system: $OS"
        exit 1
        ;;
esac

case "$ARCH" in
    x86_64|amd64)
        if [ "$PLATFORM" = "darwin" ]; then
            error "Intel Mac binaries are not available yet. If you have an Apple Silicon Mac (M1/M2/M3), use that instead, or run under Rosetta."
            exit 1
        fi
        ARCH_SUFFIX="x64"
        ;;
    aarch64|arm64)   ARCH_SUFFIX="arm64" ;;
    *)
        error "Unsupported architecture: $ARCH"
        exit 1
        ;;
esac

info "Detected $PLATFORM ($ARCH_SUFFIX)"

# ---------------------------------------------------------------------------
# 3. Gather configuration
# ---------------------------------------------------------------------------
DEFAULT_NAME="$(hostname -s 2>/dev/null || hostname)"

# Pairing code: set via LEASSH_CODE env var or prompted interactively
CODE="${LEASSH_CODE:-}"

# Interactive prompts (skip if stdin is not a terminal — e.g. piped install)
if [ -t 0 ]; then
    if [ -z "$CODE" ]; then
        printf "Pairing code (from https://leassh.com/setup): "
        read -r CODE_INPUT
        CODE="${CODE_INPUT}"
    fi

    printf "Friendly name for this computer [%s]: " "$DEFAULT_NAME"
    read -r NAME_INPUT
    NAME="${NAME_INPUT:-$DEFAULT_NAME}"
else
    NAME="${LEASSH_NAME:-$DEFAULT_NAME}"
fi

if [ -z "$CODE" ]; then
    error "A pairing code is required. Get one at https://leassh.com/setup"
    echo "  Set it via: curl -fsSL https://leassh.com/install.sh | sudo LEASSH_CODE=your-code bash"
    exit 1
fi

echo ""
printf "  Pairing code : ${CYAN}%s${RESET}\n" "$CODE"
printf "  Name         : ${CYAN}%s${RESET}\n" "$NAME"
echo ""

# ---------------------------------------------------------------------------
# 4. Create installation directory
# ---------------------------------------------------------------------------
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/leassh"
DATA_DIR="/var/lib/leassh"

for dir in "$CONFIG_DIR" "$DATA_DIR"; do
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        info "Created $dir"
    fi
done

# ---------------------------------------------------------------------------
# 5. Download the agent binary
# ---------------------------------------------------------------------------
DOWNLOAD_URL="https://github.com/cgoberg/releases/releases/latest/download/leassh-agent-${PLATFORM}-${ARCH_SUFFIX}.tar.gz"
BINARY_PATH="${INSTALL_DIR}/leassh-agent"
TMP_DIR="$(mktemp -d)"

step "Downloading agent from $DOWNLOAD_URL ..."

if command -v curl &>/dev/null; then
    curl -fsSL "$DOWNLOAD_URL" -o "${TMP_DIR}/leassh.tar.gz"
elif command -v wget &>/dev/null; then
    wget -q "$DOWNLOAD_URL" -O "${TMP_DIR}/leassh.tar.gz"
else
    error "Neither curl nor wget found. Install one and try again."
    rm -rf "$TMP_DIR"
    exit 1
fi

# Extract the tarball
tar -xzf "${TMP_DIR}/leassh.tar.gz" -C "$TMP_DIR"

# Find and install the binary
if [ -f "${TMP_DIR}/leassh-agent" ]; then
    mv "${TMP_DIR}/leassh-agent" "$BINARY_PATH"
elif [ -f "${TMP_DIR}/leassh" ]; then
    mv "${TMP_DIR}/leassh" "$BINARY_PATH"
else
    # Grab the first executable we find
    FOUND_BIN=$(find "$TMP_DIR" -type f -executable | head -1)
    if [ -n "$FOUND_BIN" ]; then
        mv "$FOUND_BIN" "$BINARY_PATH"
    else
        error "Could not find agent binary in the downloaded archive."
        rm -rf "$TMP_DIR"
        exit 1
    fi
fi

rm -rf "$TMP_DIR"
chmod +x "$BINARY_PATH"
info "Installed to $BINARY_PATH"

# ---------------------------------------------------------------------------
# 6. Run agent setup
# ---------------------------------------------------------------------------
step "Running agent setup..."

if "$BINARY_PATH" --setup --pair "$CODE" "$NAME"; then
    info "Agent setup complete"
else
    error "Agent setup failed."
    echo "  Try running manually: $BINARY_PATH --setup --pair $CODE $NAME"
    exit 1
fi

# ---------------------------------------------------------------------------
# 7. Install and start the service
# ---------------------------------------------------------------------------
step "Installing system service..."

if [ "$PLATFORM" = "linux" ]; then
    # systemd service
    cat > /etc/systemd/system/leassh-agent.service <<EOF
[Unit]
Description=Leassh Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${BINARY_PATH} --run
Restart=on-failure
RestartSec=10
User=root
WorkingDirectory=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable leassh-agent
    systemctl start leassh-agent
    info "systemd service installed and started"

elif [ "$PLATFORM" = "darwin" ]; then
    # launchd plist
    PLIST_PATH="/Library/LaunchDaemons/com.leassh.agent.plist"
    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.leassh.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BINARY_PATH}</string>
    <string>--run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${DATA_DIR}</string>
  <key>StandardOutPath</key>
  <string>/var/log/leassh-agent.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/leassh-agent.log</string>
</dict>
</plist>
EOF

    launchctl load -w "$PLIST_PATH"
    info "launchd service installed and started"
fi

# ---------------------------------------------------------------------------
# 8. Verify
# ---------------------------------------------------------------------------
step "Verifying service..."
sleep 2

if [ "$PLATFORM" = "linux" ]; then
    if systemctl is-active --quiet leassh-agent; then
        info "Leassh Agent service is running"
    else
        warn "Service not active yet. Check: systemctl status leassh-agent"
    fi
elif [ "$PLATFORM" = "darwin" ]; then
    if launchctl list com.leassh.agent &>/dev/null; then
        info "Leassh Agent service is running"
    else
        warn "Service not active yet. Check: sudo launchctl list com.leassh.agent"
    fi
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
printf "${AMBER}============================================${RESET}\n"
printf "${GREEN}  Leassh Agent installed successfully!${RESET}\n"
printf "${AMBER}============================================${RESET}\n"
echo ""
echo "  Device '$NAME' will appear in your dashboard shortly."
echo "  Dashboard: https://leassh.com/family"
echo ""
echo "  Manage the service:"
if [ "$PLATFORM" = "linux" ]; then
    echo "    Start:   sudo systemctl start leassh-agent"
    echo "    Stop:    sudo systemctl stop leassh-agent"
    echo "    Status:  sudo systemctl status leassh-agent"
    echo "    Logs:    sudo journalctl -u leassh-agent -f"
else
    echo "    Start:   sudo launchctl load /Library/LaunchDaemons/com.leassh.agent.plist"
    echo "    Stop:    sudo launchctl unload /Library/LaunchDaemons/com.leassh.agent.plist"
    echo "    Logs:    tail -f /var/log/leassh-agent.log"
fi
echo "    Remove:  sudo $BINARY_PATH --uninstall"
echo ""
