#!/bin/bash
# Leassh Agent Installer for Linux
# Usage: curl -fsSL https://leassh.com/install.sh | sudo bash
# Or with family code:
#   LEASSH_TOKEN=your-code curl -fsSL https://leassh.com/install.sh | sudo bash

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
# 1. Check root privileges
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
    Darwin)
        OS="darwin"
        error "macOS binaries coming soon. For now, build from source."
        echo ""
        echo "  See: https://github.com/leassh/leassh"
        exit 1
        ;;
    *)
        error "Unsupported operating system: $OS"
        exit 1
        ;;
esac

case "$ARCH" in
    x86_64|amd64)   ARCH_SUFFIX="x64"   ;;
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
DEFAULT_SERVER="api.leassh.com"
DEFAULT_NAME="$(hostname -s 2>/dev/null || hostname)"

# Interactive prompts (skip if stdin is not a terminal)
if [ -t 0 ]; then
    printf "Leassh server address [%s]: " "$DEFAULT_SERVER"
    read -r SERVER_INPUT
    SERVER="${SERVER_INPUT:-$DEFAULT_SERVER}"

    if [ -z "${LEASSH_TOKEN:-}" ]; then
        printf "Family/device token (from your Leassh dashboard): "
        read -r TOKEN_INPUT
        LEASSH_TOKEN="${TOKEN_INPUT}"
    fi

    printf "Friendly name for this computer [%s]: " "$DEFAULT_NAME"
    read -r NAME_INPUT
    NAME="${NAME_INPUT:-$DEFAULT_NAME}"
else
    SERVER="${LEASSH_SERVER:-$DEFAULT_SERVER}"
    NAME="${LEASSH_NAME:-$DEFAULT_NAME}"
fi

TOKEN="${LEASSH_TOKEN:-}"

if [ -z "$TOKEN" ]; then
    error "A token is required. Find it in your Leassh dashboard under Devices > Add Device."
    echo "  Set it via: LEASSH_TOKEN=your-code curl -fsSL https://leassh.com/install.sh | sudo bash"
    exit 1
fi

echo ""
printf "  Server : ${CYAN}%s${RESET}\n" "$SERVER"
printf "  Token  : ${CYAN}%.6s...${RESET}\n" "$TOKEN"
printf "  Name   : ${CYAN}%s${RESET}\n" "$NAME"
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
VERSION="v0.1.0"
DOWNLOAD_URL="https://github.com/leassh/leassh/releases/download/${VERSION}/leassh-${PLATFORM}-${ARCH_SUFFIX}.tar.gz"
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

if "$BINARY_PATH" --setup "$SERVER" "$TOKEN" "$NAME"; then
    info "Agent setup complete"
else
    error "Agent setup failed."
    echo "  Try running manually: $BINARY_PATH --setup $SERVER <token> $NAME"
    exit 1
fi

# ---------------------------------------------------------------------------
# 7. Install and start the service
# ---------------------------------------------------------------------------
step "Installing system service..."

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

# ---------------------------------------------------------------------------
# 8. Verify
# ---------------------------------------------------------------------------
step "Verifying service..."
sleep 2

if systemctl is-active --quiet leassh-agent; then
    info "Leassh Agent service is running"
else
    warn "Service not active yet. Check: systemctl status leassh-agent"
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
echo "  Dashboard: https://$SERVER/fleet"
echo ""
echo "  Manage the service:"
echo "    Start:   sudo systemctl start leassh-agent"
echo "    Stop:    sudo systemctl stop leassh-agent"
echo "    Status:  sudo systemctl status leassh-agent"
echo "    Logs:    sudo journalctl -u leassh-agent -f"
echo "    Remove:  sudo $BINARY_PATH --uninstall"
echo ""
