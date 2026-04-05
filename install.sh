#!/bin/bash
# Leassh Agent Installer for macOS and Linux
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

 Agent Installer for macOS / Linux

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
    Darwin) PLATFORM="macos"  ;;
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
BINARY_URL="https://releases.leassh.com/agent/latest/leassh-agent-${PLATFORM}-${ARCH_SUFFIX}"
BINARY_PATH="${INSTALL_DIR}/leassh-agent"

step "Downloading agent from $BINARY_URL ..."

if command -v curl &>/dev/null; then
    curl -fsSL "$BINARY_URL" -o "$BINARY_PATH"
elif command -v wget &>/dev/null; then
    wget -q "$BINARY_URL" -O "$BINARY_PATH"
else
    error "Neither curl nor wget found. Install one and try again."
    exit 1
fi

chmod +x "$BINARY_PATH"
info "Downloaded to $BINARY_PATH"

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

elif [ "$PLATFORM" = "macos" ]; then
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
    <string>/var/log/leassh-agent.err</string>
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
elif [ "$PLATFORM" = "macos" ]; then
    if launchctl list | grep -q com.leassh.agent; then
        info "Leassh Agent service is running"
    else
        warn "Service not detected yet. Check: launchctl list | grep leassh"
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
echo "  Dashboard: https://$SERVER/fleet"
echo ""

if [ "$PLATFORM" = "linux" ]; then
    echo "  Manage the service:"
    echo "    Start:   sudo systemctl start leassh-agent"
    echo "    Stop:    sudo systemctl stop leassh-agent"
    echo "    Status:  sudo systemctl status leassh-agent"
    echo "    Logs:    sudo journalctl -u leassh-agent -f"
    echo "    Remove:  sudo $BINARY_PATH --uninstall"
elif [ "$PLATFORM" = "macos" ]; then
    echo "  Manage the service:"
    echo "    Stop:    sudo launchctl unload /Library/LaunchDaemons/com.leassh.agent.plist"
    echo "    Start:   sudo launchctl load /Library/LaunchDaemons/com.leassh.agent.plist"
    echo "    Logs:    tail -f /var/log/leassh-agent.log"
    echo "    Remove:  sudo $BINARY_PATH --uninstall"
fi

echo ""
