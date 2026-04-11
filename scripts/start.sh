#!/bin/bash

# ProjectAchilles - Continuous Security Testing platform
# Smart startup with port detection and fallback

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Default ports
BACKEND_PORT=3000
FRONTEND_PORT=5173

# Port range for fallback
BACKEND_PORT_MAX=3020
FRONTEND_PORT_MAX=5190

# Function to check if a port is in use
is_port_in_use() {
    local port=$1
    if command -v lsof &> /dev/null; then
        lsof -i:"$port" &> /dev/null
    elif command -v ss &> /dev/null; then
        ss -tuln | grep -q ":$port "
    elif command -v netstat &> /dev/null; then
        netstat -tuln | grep -q ":$port "
    else
        # Fallback: try to connect
        (echo >/dev/tcp/localhost/"$port") &>/dev/null
    fi
}

# Function to find an available port
find_available_port() {
    local start_port=$1
    local max_port=$2
    local port=$start_port

    while [ $port -le $max_port ]; do
        if ! is_port_in_use $port; then
            echo $port
            return 0
        fi
        ((port++))
    done

    # No available port found
    echo -1
    return 1
}

# Function to kill process on a port
kill_port() {
    local port=$1
    if command -v lsof &> /dev/null; then
        local pid=$(lsof -t -i:"$port" 2>/dev/null)
        if [ -n "$pid" ]; then
            kill $pid 2>/dev/null || true
            sleep 1
        fi
    fi
}

echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║                                                                   ║"
echo "║    █████╗  ██████╗██╗  ██╗██╗██╗     ██╗     ███████╗███████╗   ║"
echo "║   ██╔══██╗██╔════╝██║  ██║██║██║     ██║     ██╔════╝██╔════╝   ║"
echo "║   ███████║██║     ███████║██║██║     ██║     █████╗  ███████╗   ║"
echo "║   ██╔══██║██║     ██╔══██║██║██║     ██║     ██╔══╝  ╚════██║   ║"
echo "║   ██║  ██║╚██████╗██║  ██║██║███████╗███████╗███████╗███████║   ║"
echo "║   ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝╚══════╝   ║"
echo "║                                                                   ║"
echo "║   ACHILLES - Continuous Security Testing Platform                            ║"
echo "║                                                                   ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo ""

# PID file for daemon mode
PID_FILE="$PROJECT_ROOT/.achilles.pid"

# Tunnel configuration
NGROK_CONFIG_MAIN="$HOME/.config/ngrok/ngrok.yml"
TUNNEL_PROVIDER="${TUNNEL_PROVIDER:-}"  # "cloudflare" or "ngrok" — auto-detected if empty

# Load .env if present (for NGROK_*_DOMAIN overrides)
if [ -f "$PROJECT_ROOT/backend/.env" ]; then
    eval "$(grep -E '^NGROK_' "$PROJECT_ROOT/backend/.env" 2>/dev/null | sed 's/^/export /')"
fi

# ngrok custom domains (only used when TUNNEL_PROVIDER=ngrok)
NGROK_FRONTEND_DOMAIN="${NGROK_FRONTEND_DOMAIN:-projectachilles.ngrok.app}"
NGROK_BACKEND_DOMAIN="${NGROK_BACKEND_DOMAIN:-achilles-agent.ngrok.app}"

# Cloudflare tunnel state (populated at runtime)
CF_FRONTEND_URL=""
CF_BACKEND_URL=""
CF_FRONTEND_PID=""
CF_BACKEND_PID=""

# Check for command line arguments
KILL_EXISTING=false
DAEMON_MODE=false
STOP_DAEMON=false
TUNNEL_MODE=false
RESTART_SERVERS=false
for arg in "$@"; do
    case $arg in
        --kill|-k)
            KILL_EXISTING=true
            ;;
        --daemon|-d)
            DAEMON_MODE=true
            ;;
        --stop|-s)
            STOP_DAEMON=true
            ;;
        --tunnel|-t)
            TUNNEL_MODE=true
            ;;
        --restart-servers|-r)
            RESTART_SERVERS=true
            DAEMON_MODE=true
            ;;
        --backend-port=*)
            BACKEND_PORT="${arg#*=}"
            ;;
        --frontend-port=*)
            FRONTEND_PORT="${arg#*=}"
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --kill, -k              Kill existing processes on default ports"
            echo "  --daemon, -d            Run in daemon mode (background, no blocking)"
            echo "  --stop, -s              Stop daemon processes"
            echo "  --restart-servers, -r   Restart backend/frontend, keep tunnels running"
            echo "  --tunnel, -t            Start tunnels for external access"
            echo "  --backend-port=PORT     Specify backend port (default: 3000)"
            echo "  --frontend-port=PORT    Specify frontend port (default: 5173)"
            echo "  --help, -h              Show this help message"
            echo ""
            echo "Tunnel mode (--tunnel):"
            echo "  Auto-detects: Cloudflare (free, no account) or ngrok"
            echo "  Override with: TUNNEL_PROVIDER=cloudflare|ngrok"
            echo ""
            echo "  Cloudflare: random HTTPS URLs, no setup needed"
            echo "  ngrok:      custom domains via NGROK_FRONTEND_DOMAIN / NGROK_BACKEND_DOMAIN"
            echo ""
            exit 0
            ;;
    esac
done

# Handle --stop flag
if [ "$STOP_DAEMON" = true ]; then
    if [ -f "$PID_FILE" ]; then
        echo "Stopping daemon processes..."
        while read -r pid; do
            if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
                # Also kill child processes
                pkill -P "$pid" 2>/dev/null || true
                echo "  Stopped PID $pid"
            fi
        done < "$PID_FILE"
        rm -f "$PID_FILE"
        echo "Daemon stopped."
    else
        echo "No daemon PID file found. Servers may not be running."
    fi
    exit 0
fi

# Handle --restart-servers flag: kill only backend/frontend, preserve tunnels
if [ "$RESTART_SERVERS" = true ]; then
    echo "Restarting servers (keeping tunnels alive)..."
    TUNNEL_PIDS_TO_KEEP=()

    if [ -f "$PID_FILE" ]; then
        while read -r pid; do
            if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                # Check if this is a tunnel process (cloudflared or ngrok)
                local_comm=$(cat "/proc/$pid/comm" 2>/dev/null || ps -p "$pid" -o comm= 2>/dev/null || echo "")
                if [[ "$local_comm" == "cloudflared" ]] || [[ "$local_comm" == "ngrok" ]]; then
                    TUNNEL_PIDS_TO_KEEP+=("$pid")
                    echo "  Keeping tunnel PID $pid ($local_comm)"
                else
                    kill "$pid" 2>/dev/null || true
                    pkill -P "$pid" 2>/dev/null || true
                    echo "  Stopped server PID $pid"
                fi
            fi
        done < "$PID_FILE"
    fi

    # Also kill by port as a safety net (PID file may be stale)
    kill_port $BACKEND_PORT
    kill_port $FRONTEND_PORT
    sleep 1

    # Recover tunnel URLs from logs
    if [ ${#TUNNEL_PIDS_TO_KEEP[@]} -gt 0 ]; then
        TUNNEL_MODE=true
        TUNNEL_PROVIDER="cloudflare"
        CF_BACKEND_URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' /tmp/cf-backend.log 2>/dev/null | head -1) || true
        CF_FRONTEND_URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' /tmp/cf-frontend.log 2>/dev/null | head -1) || true
        TUNNEL_FRONTEND_URL="$CF_FRONTEND_URL"
        TUNNEL_BACKEND_URL="$CF_BACKEND_URL"

        if [ -n "$TUNNEL_FRONTEND_URL" ]; then
            export CORS_ORIGIN="$TUNNEL_FRONTEND_URL"
            echo "  Tunnel URLs preserved:"
            echo "    Dashboard: $TUNNEL_FRONTEND_URL"
            echo "    Agent API: $TUNNEL_BACKEND_URL"
        fi

        # Recover tunnel PIDs
        CF_BACKEND_PID="${TUNNEL_PIDS_TO_KEEP[0]:-}"
        CF_FRONTEND_PID="${TUNNEL_PIDS_TO_KEEP[1]:-}"

        # Set AGENT_SERVER_URL from tunnel
        if [ -n "$TUNNEL_BACKEND_URL" ]; then
            export AGENT_SERVER_URL="$TUNNEL_BACKEND_URL"
        fi
    fi

    echo ""
fi

# Kill existing processes if requested
if [ "$KILL_EXISTING" = true ]; then
    echo "Killing existing processes..."
    kill_port $BACKEND_PORT
    kill_port $FRONTEND_PORT
    # Also kill any existing tunnel processes
    pkill -f "ngrok.*achilles" 2>/dev/null || true
    pkill -f "cloudflared tunnel" 2>/dev/null || true
fi

# =============================================================================
# Dependency Management — auto-detect platform and install prerequisites
# =============================================================================

detect_platform() {
    PA_OS="unknown"
    PA_DISTRO=""
    PA_PKG_MGR=""
    PA_IS_WSL=false

    case "$(uname -s)" in
        Linux*)
            PA_OS="linux"
            if grep -qi microsoft /proc/version 2>/dev/null; then
                PA_IS_WSL=true
            fi
            if [ -f /etc/os-release ]; then
                . /etc/os-release
                PA_DISTRO="$ID"
            fi
            case "$PA_DISTRO" in
                ubuntu|debian|pop|linuxmint|elementary|kali|raspbian|zorin)
                    PA_PKG_MGR="apt"
                    ;;
                fedora|rhel|centos|rocky|alma)
                    PA_PKG_MGR="dnf"
                    ;;
                arch|manjaro|endeavouros|garuda)
                    PA_PKG_MGR="pacman"
                    ;;
                opensuse*|sles)
                    PA_PKG_MGR="zypper"
                    ;;
            esac
            ;;
        Darwin*)
            PA_OS="macos"
            if command -v brew &>/dev/null; then
                PA_PKG_MGR="brew"
            fi
            ;;
    esac
}

# --- Per-package install functions, dispatched as install_<pkg>_<mgr> ---

install_node_apt() {
    echo "  Installing Node.js 22.x via NodeSource..."
    if ! command -v curl &>/dev/null; then
        sudo apt-get update -qq
        sudo apt-get install -y -qq curl ca-certificates
    fi
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y -qq nodejs
}
install_node_dnf() {
    echo "  Installing Node.js 22.x..."
    sudo dnf module install -y nodejs:22/common 2>/dev/null || {
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
        sudo dnf install -y nodejs
    }
}
install_node_pacman() {
    echo "  Installing Node.js and npm..."
    sudo pacman -Sy --noconfirm nodejs npm
}
install_node_zypper() {
    echo "  Installing Node.js 22.x via NodeSource..."
    if ! command -v curl &>/dev/null; then
        sudo zypper install -y curl ca-certificates
    fi
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
    sudo zypper install -y nodejs
}
install_node_brew() {
    echo "  Installing Node.js 22 via Homebrew..."
    brew install node@22
    brew link --overwrite node@22 2>/dev/null || true
}

install_git_apt()    { sudo apt-get update -qq && sudo apt-get install -y -qq git; }
install_git_dnf()    { sudo dnf install -y git; }
install_git_pacman() { sudo pacman -Sy --noconfirm git; }
install_git_zypper() { sudo zypper install -y git; }
install_git_brew()   { brew install git; }

# Go install — tarball from go.dev for distros that ship outdated versions
GO_INSTALL_VERSION="1.24.2"

install_go_tarball() {
    local arch
    arch=$(uname -m)
    case "$arch" in
        x86_64)  arch="amd64" ;;
        aarch64) arch="arm64" ;;
        armv*)   arch="armv6l" ;;
    esac

    echo "  Installing Go ${GO_INSTALL_VERSION} (${arch}) from go.dev..."
    if ! command -v curl &>/dev/null; then
        case "$PA_PKG_MGR" in
            apt)    sudo apt-get install -y -qq curl ca-certificates ;;
            dnf)    sudo dnf install -y curl ;;
            zypper) sudo zypper install -y curl ca-certificates ;;
        esac
    fi

    # Remove previous Go installation at /usr/local/go if present
    if [ -d /usr/local/go ]; then
        echo "  Removing existing /usr/local/go..."
        sudo rm -rf /usr/local/go
    fi

    curl -fsSL "https://go.dev/dl/go${GO_INSTALL_VERSION}.linux-${arch}.tar.gz" \
        | sudo tar -C /usr/local -xz

    # Make available in this session
    export PATH="/usr/local/go/bin:$PATH"

    echo "  Installed to /usr/local/go"
    echo "  Tip: add to your shell profile — export PATH=/usr/local/go/bin:\$PATH"
}

install_go_apt()    { install_go_tarball; }
install_go_zypper() { install_go_tarball; }
install_go_dnf() {
    echo "  Trying dnf first..."
    sudo dnf install -y golang
    # dnf may ship an older version — check it
    local go_minor
    go_minor=$(go version 2>/dev/null | awk '{print $3}' | sed 's/go//' | cut -d. -f2)
    if [ "${go_minor:-0}" -lt 24 ]; then
        echo "  dnf provided Go $(go version 2>/dev/null | awk '{print $3}') (too old) — switching to tarball..."
        install_go_tarball
    fi
}
install_go_pacman() {
    echo "  Installing Go..."
    sudo pacman -Sy --noconfirm go
}
install_go_brew() {
    echo "  Installing Go via Homebrew..."
    brew install go
}

# cloudflared install — direct binary from GitHub releases (no repo keys needed)
install_cloudflared_binary() {
    local arch
    arch=$(uname -m)
    case "$arch" in
        x86_64)  arch="amd64" ;;
        aarch64) arch="arm64" ;;
        armv*)   arch="arm" ;;
    esac

    echo "  Installing cloudflared (${arch})..."
    local url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}"
    curl -fsSL "$url" -o /tmp/cloudflared
    sudo install -m 755 /tmp/cloudflared /usr/local/bin/cloudflared
    rm -f /tmp/cloudflared
}

install_cloudflared() {
    if [ "$PA_OS" = "macos" ] && [ "$PA_PKG_MGR" = "brew" ]; then
        echo "  Installing cloudflared via Homebrew..."
        brew install cloudflare/cloudflare/cloudflared
    else
        install_cloudflared_binary
    fi
}

# Wait for a cloudflare tunnel URL to appear in a log file.
# Polls for up to 20 seconds, returns the URL or exits 1.
wait_for_cf_url() {
    local log_file="$1"
    local elapsed=0
    while [ $elapsed -lt 20 ]; do
        local url
        url=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$log_file" 2>/dev/null | head -1)
        if [ -n "$url" ]; then
            echo "$url"
            return 0
        fi
        sleep 1
        ((elapsed++))
    done
    return 1
}

check_and_install_deps() {
    detect_platform

    # Build display label
    local platform_label="$PA_OS"
    if $PA_IS_WSL; then
        platform_label="WSL"
        [ -n "$PA_DISTRO" ] && platform_label="WSL ($PA_DISTRO)"
    elif [ "$PA_OS" = "linux" ] && [ -n "$PA_DISTRO" ]; then
        platform_label="$PA_DISTRO"
    elif [ "$PA_OS" = "macos" ]; then
        platform_label="macOS"
    fi
    echo "Checking dependencies (platform: $platform_label)..."

    local missing=()

    # --- git ---
    if command -v git &>/dev/null; then
        echo "  git $(git --version | awk '{print $3}') ✓"
    else
        echo "  git — not found"
        missing+=("git")
    fi

    # --- node (try loading nvm first if node isn't on PATH) ---
    if ! command -v node &>/dev/null && [ -s "$HOME/.nvm/nvm.sh" ]; then
        echo "  nvm detected but not loaded — sourcing..."
        export NVM_DIR="$HOME/.nvm"
        . "$NVM_DIR/nvm.sh"
    fi

    if command -v node &>/dev/null; then
        local node_major
        node_major=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$node_major" -lt 22 ] 2>/dev/null; then
            echo "  Node.js $(node -v) — upgrade needed (22+ required)"
            missing+=("node")
        else
            echo "  Node.js $(node -v) ✓"
        fi
    else
        echo "  Node.js — not found"
        missing+=("node")
    fi

    # --- npm (ships with node, but verify) ---
    if command -v npm &>/dev/null; then
        echo "  npm $(npm -v) ✓"
    elif [[ ! " ${missing[*]} " =~ " node " ]]; then
        echo "  npm — not found (unusual — Node.js present without npm)"
        missing+=("npm")
    fi

    # --- Go (optional but auto-installed — needed for agent/test builds) ---
    if command -v go &>/dev/null; then
        local go_ver go_minor
        go_ver=$(go version | awk '{print $3}' | sed 's/go//')
        go_minor=$(echo "$go_ver" | cut -d. -f2)
        if [ "${go_minor:-0}" -lt 24 ] 2>/dev/null; then
            echo "  Go $go_ver — upgrade needed (1.24+ required)"
            missing+=("go")
        else
            echo "  Go $go_ver ✓"
        fi
    else
        echo "  Go — not found (needed for agent/test builds)"
        missing+=("go")
    fi

    echo ""

    # All present — nothing to do
    if [ ${#missing[@]} -eq 0 ]; then
        return 0
    fi

    # --- Can we auto-install? ---
    if [ -z "$PA_PKG_MGR" ]; then
        echo "Missing: ${missing[*]}"
        echo ""
        if [ "$PA_OS" = "macos" ]; then
            echo "Homebrew is required to install dependencies on macOS."
            echo "Install it with:"
            echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
        else
            echo "Could not detect a supported package manager ($PA_DISTRO)."
            echo "Please install manually: Node.js 22+, npm, git, Go 1.24+"
        fi
        exit 1
    fi

    # --- Prompt (unless non-interactive / piped) ---
    echo "Missing: ${missing[*]}"
    if [ -t 0 ] && [ -t 1 ]; then
        read -rp "Install now using $PA_PKG_MGR? [Y/n] " response
        case "${response:-Y}" in
            [Nn]*)
                echo "Skipping. Install manually and re-run."
                exit 1
                ;;
        esac
    else
        echo "Non-interactive shell — installing automatically..."
    fi
    echo ""

    # --- Deduplicate node/npm (installing node also installs npm) ---
    local need_node=false
    local need_git=false
    local need_go=false
    for dep in "${missing[@]}"; do
        case "$dep" in
            node|npm) need_node=true ;;
            git)      need_git=true ;;
            go)       need_go=true ;;
        esac
    done

    if $need_git; then
        echo "Installing git..."
        "install_git_${PA_PKG_MGR}"
    fi
    if $need_node; then
        echo "Installing Node.js 22..."
        "install_node_${PA_PKG_MGR}"
    fi
    if $need_go; then
        echo "Installing Go..."
        "install_go_${PA_PKG_MGR}"
    fi

    # --- Verify ---
    echo ""
    echo "Verifying installation..."
    local failed=false

    # Required — block startup if missing
    if ! command -v git &>/dev/null; then
        echo "  ✗ git — installation failed"
        failed=true
    else
        echo "  git $(git --version | awk '{print $3}') ✓"
    fi
    if ! command -v node &>/dev/null; then
        echo "  ✗ Node.js — installation failed"
        failed=true
    else
        echo "  Node.js $(node -v) ✓"
    fi
    if ! command -v npm &>/dev/null; then
        echo "  ✗ npm — installation failed"
        failed=true
    else
        echo "  npm $(npm -v) ✓"
    fi

    # Optional — warn but continue
    if ! command -v go &>/dev/null; then
        echo "  ⚠ Go — installation failed (agent/test builds will be unavailable)"
    else
        local go_installed_ver
        go_installed_ver=$(go version | awk '{print $3}' | sed 's/go//')
        echo "  Go $go_installed_ver ✓"
    fi

    if $failed; then
        echo ""
        echo "Required dependencies failed to install. Please install manually and re-run."
        exit 1
    fi
    echo ""
}

# Run dependency check before anything else that needs node/npm/git
check_and_install_deps

# =============================================================================
# Clerk Authentication — detect, guide, validate, and write keys
# =============================================================================

BACKEND_ENV="$PROJECT_ROOT/backend/.env"
BACKEND_ENV_EXAMPLE="$PROJECT_ROOT/backend/.env.example"
FRONTEND_ENV="$PROJECT_ROOT/frontend/.env"
FRONTEND_ENV_EXAMPLE="$PROJECT_ROOT/frontend/.env.example"

# Read a value from a .env file (returns empty if not found or commented)
read_env_value() {
    local file="$1" key="$2"
    if [ -f "$file" ]; then
        grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d'=' -f2-
    fi
}

# Write or update a key in a .env file
write_env_value() {
    local file="$1" key="$2" value="$3"
    if [ ! -f "$file" ]; then
        touch "$file"
    fi
    if grep -qE "^#?\s*${key}=" "$file" 2>/dev/null; then
        sed -i "s|^#*\s*${key}=.*|${key}=${value}|" "$file"
    else
        echo "${key}=${value}" >> "$file"
    fi
}

# Open a URL in the user's browser (platform-aware)
open_browser() {
    local url="$1"
    if $PA_IS_WSL; then
        powershell.exe Start "'$url'" 2>/dev/null || wslview "$url" 2>/dev/null || true
    elif [ "$PA_OS" = "macos" ]; then
        open "$url" 2>/dev/null || true
    elif [ "$PA_OS" = "linux" ]; then
        xdg-open "$url" 2>/dev/null || true
    fi
}

# Validate Clerk key format. Returns 0 if valid, 1 if invalid.
# Sets CLERK_KEY_ENV to "test" or "live" on success.
validate_clerk_key_format() {
    local key="$1" type="$2"  # type: "pk" or "sk"
    if [[ "$key" =~ ^${type}_(test|live)_.+ ]]; then
        CLERK_KEY_ENV="${BASH_REMATCH[1]}"
        return 0
    fi
    return 1
}

# Extract the Clerk Frontend API domain from a publishable key.
# pk_test_<base64-encoded-domain>$ → domain string
extract_clerk_domain() {
    local pk="$1"
    local payload="${pk#pk_test_}"
    payload="${payload#pk_live_}"
    # base64 decode, strip trailing $ and whitespace
    local domain
    domain=$(echo "$payload" | base64 -d 2>/dev/null | tr -d '$\n\r ' )
    echo "$domain"
}

# Test connectivity to a Clerk app via its JWKS endpoint.
# Returns 0 if reachable, 1 if not.
validate_clerk_connectivity() {
    local pk="$1"
    local domain
    domain=$(extract_clerk_domain "$pk")

    if [ -z "$domain" ]; then
        echo "  Could not decode Clerk domain from publishable key"
        return 1
    fi

    local url="https://${domain}/.well-known/jwks.json"
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null)

    if [ "$http_code" = "200" ]; then
        return 0
    else
        echo "  Could not reach Clerk app at $domain (HTTP $http_code)"
        echo "  Check that your publishable key is correct"
        return 1
    fi
}

# Prompt user for Clerk keys interactively
prompt_clerk_keys() {
    local pk_input sk_input

    while true; do
        echo ""
        read -rp "  Publishable Key: " pk_input

        if [ -z "$pk_input" ]; then
            echo "  Key cannot be empty"
            continue
        fi

        if ! validate_clerk_key_format "$pk_input" "pk"; then
            echo "  Invalid format — must start with pk_test_ or pk_live_"
            continue
        fi
        local pk_env="$CLERK_KEY_ENV"
        echo "  ✓ Format valid ($pk_env environment)"
        break
    done

    while true; do
        echo ""
        read -rsp "  Secret Key (hidden): " sk_input
        echo ""

        if [ -z "$sk_input" ]; then
            echo "  Key cannot be empty"
            continue
        fi

        if ! validate_clerk_key_format "$sk_input" "sk"; then
            echo "  Invalid format — must start with sk_test_ or sk_live_"
            continue
        fi
        local sk_env="$CLERK_KEY_ENV"
        echo "  ✓ ${sk_input:0:12}... confirmed ($sk_env environment)"

        # Warn on environment mismatch
        if [ "$pk_env" != "$sk_env" ]; then
            echo ""
            echo "  ⚠ Warning: publishable key is $pk_env but secret key is $sk_env"
            echo "    Keys should be from the same environment"
        fi
        break
    done

    # Connectivity test
    echo ""
    echo "  Validating keys with Clerk API..."
    if validate_clerk_connectivity "$pk_input"; then
        echo "  ✓ Clerk app is reachable"
    else
        echo ""
        read -rp "  Keys could not be verified. Use them anyway? [y/N] " use_anyway
        case "${use_anyway:-N}" in
            [Yy]*) ;;
            *)
                echo "  Retrying..."
                prompt_clerk_keys
                return
                ;;
        esac
    fi

    # Write to both env files
    echo ""
    echo "  Writing to backend/.env and frontend/.env..."
    write_env_value "$BACKEND_ENV" "CLERK_PUBLISHABLE_KEY" "$pk_input"
    write_env_value "$BACKEND_ENV" "CLERK_SECRET_KEY" "$sk_input"
    write_env_value "$FRONTEND_ENV" "VITE_CLERK_PUBLISHABLE_KEY" "$pk_input"
    echo "  ✓ Authentication configured"
}

check_and_setup_clerk() {
    echo "Checking Clerk authentication..."

    # Ensure backend .env exists
    if [ ! -f "$BACKEND_ENV" ]; then
        if [ -f "$BACKEND_ENV_EXAMPLE" ]; then
            cp "$BACKEND_ENV_EXAMPLE" "$BACKEND_ENV"
            echo "  Created backend/.env from .env.example"
        else
            touch "$BACKEND_ENV"
        fi
    fi

    # Ensure frontend .env exists
    if [ ! -f "$FRONTEND_ENV" ]; then
        if [ -f "$FRONTEND_ENV_EXAMPLE" ]; then
            cp "$FRONTEND_ENV_EXAMPLE" "$FRONTEND_ENV"
        else
            touch "$FRONTEND_ENV"
        fi
    fi

    # Auto-generate secrets if missing or placeholder
    local session_secret encryption_secret
    session_secret=$(read_env_value "$BACKEND_ENV" "SESSION_SECRET")
    encryption_secret=$(read_env_value "$BACKEND_ENV" "ENCRYPTION_SECRET")

    if [ -z "$session_secret" ]; then
        write_env_value "$BACKEND_ENV" "SESSION_SECRET" "$(openssl rand -base64 32)"
        echo "  Generated SESSION_SECRET"
    fi
    if [ -z "$encryption_secret" ] || [ "$encryption_secret" = "change-me-to-a-secure-random-string" ]; then
        write_env_value "$BACKEND_ENV" "ENCRYPTION_SECRET" "$(openssl rand -base64 32)"
        echo "  Generated ENCRYPTION_SECRET"
    fi

    # Read current keys
    local pk sk fe_pk
    pk=$(read_env_value "$BACKEND_ENV" "CLERK_PUBLISHABLE_KEY")
    sk=$(read_env_value "$BACKEND_ENV" "CLERK_SECRET_KEY")
    fe_pk=$(read_env_value "$FRONTEND_ENV" "VITE_CLERK_PUBLISHABLE_KEY")

    # Check if keys look like real values (not placeholders)
    local pk_valid=false sk_valid=false
    if [[ -n "$pk" && "$pk" != "pk_test_..." && "$pk" =~ ^pk_(test|live)_.{10,} ]]; then
        pk_valid=true
    fi
    if [[ -n "$sk" && "$sk" != "sk_test_..." && "$sk" =~ ^sk_(test|live)_.{10,} ]]; then
        sk_valid=true
    fi

    if $pk_valid && $sk_valid; then
        # Keys look real — validate connectivity silently
        if validate_clerk_connectivity "$pk" 2>/dev/null; then
            echo "  Clerk keys ✓"
            # Sync frontend .env if needed
            if [ "$fe_pk" != "$pk" ]; then
                write_env_value "$FRONTEND_ENV" "VITE_CLERK_PUBLISHABLE_KEY" "$pk"
                echo "  Synced frontend/.env with backend publishable key"
            fi
            echo ""
            return 0
        else
            echo "  ⚠ Clerk keys present but could not verify connectivity"
            echo "    (This may be a network issue — proceeding anyway)"
            if [ "$fe_pk" != "$pk" ]; then
                write_env_value "$FRONTEND_ENV" "VITE_CLERK_PUBLISHABLE_KEY" "$pk"
            fi
            echo ""
            return 0
        fi
    fi

    # Keys are missing or placeholder — interactive setup needed
    echo "  ✗ No valid Clerk keys configured"

    # Non-interactive mode: can't prompt, just fail with instructions
    if ! [ -t 0 ] || ! [ -t 1 ]; then
        echo ""
        echo "  Clerk authentication is required. Set these in backend/.env:"
        echo "    CLERK_PUBLISHABLE_KEY=pk_test_your_key"
        echo "    CLERK_SECRET_KEY=sk_test_your_key"
        echo "  And in frontend/.env:"
        echo "    VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key"
        echo ""
        echo "  Get keys from: https://dashboard.clerk.com"
        exit 1
    fi

    # Interactive guided setup
    echo ""
    echo "  ╭──────────────────────────────────────────────────────╮"
    echo "  │  Clerk Setup (free account — takes ~2 minutes)       │"
    echo "  │                                                      │"
    echo "  │  1. Sign up or log in at clerk.com                   │"
    echo "  │  2. Create a new application (Development mode)      │"
    echo "  │  3. Go to \"API Keys\" in the sidebar                  │"
    echo "  │  4. Copy both keys below (pk_test_ and sk_test_)     │"
    echo "  ╰──────────────────────────────────────────────────────╯"
    echo ""
    read -rp "  Press Enter to open Clerk in your browser (or S to skip): " clerk_action

    case "$clerk_action" in
        [Ss]*)
            echo ""
            echo "  ⚠ Skipping Clerk setup — authentication will not work"
            echo "    Run this script again to configure Clerk later"
            echo ""
            return 0
            ;;
        *)
            open_browser "https://dashboard.clerk.com"
            echo ""
            echo "  Open https://dashboard.clerk.com in your browser"
            echo "  (If it didn't open automatically, copy the URL above)"
            echo ""
            echo "  Complete steps 1-3, then paste your keys below."
            prompt_clerk_keys
            echo ""
            ;;
    esac
}

# Skip setup checks during --restart-servers (config unchanged, just reload)
if [ "$RESTART_SERVERS" != true ]; then

# Run Clerk check before starting servers
check_and_setup_clerk

# =============================================================================
# Clerk RBAC — session token claims + admin role
# =============================================================================

CLERK_RBAC_FLAG="$PROJECT_ROOT/.clerk-rbac-configured"

check_and_setup_clerk_rbac() {
    # Only run once — skip if already configured in a previous run
    if [ -f "$CLERK_RBAC_FLAG" ]; then
        return 0
    fi

    local sk
    sk=$(read_env_value "$BACKEND_ENV" "CLERK_SECRET_KEY")
    if [ -z "$sk" ]; then
        return 0
    fi

    # Non-interactive — skip
    if ! [ -t 0 ] || ! [ -t 1 ]; then
        return 0
    fi

    echo "Configuring Clerk RBAC..."
    echo ""
    echo "  ╭──────────────────────────────────────────────────────────────╮"
    echo "  │  Session Token Setup (required for role-based access)        │"
    echo "  │                                                              │"
    echo "  │  1. Open dashboard.clerk.com → Configure → Sessions         │"
    echo "  │  2. Click \"Edit\" on the session token                        │"
    echo "  │  3. Add this custom claim:                                   │"
    echo "  │                                                              │"
    echo "  │     \"metadata\": \"{{user.public_metadata}}\"                    │"
    echo "  │                                                              │"
    echo "  │  4. Click Save                                               │"
    echo "  ╰──────────────────────────────────────────────────────────────╯"
    echo ""

    open_browser "https://dashboard.clerk.com"

    read -rp "  Press Enter after you've added the claim (or S to skip): " rbac_response
    case "$rbac_response" in
        [Ss]*)
            echo "  Skipped — RBAC features may not work correctly"
            echo ""
            return 0
            ;;
    esac

    # Set admin role on the first user
    echo ""
    echo "  Setting admin role on your user account..."
    read -rp "  Your email address (used to sign up with Clerk): " admin_email

    if [ -z "$admin_email" ]; then
        echo "  Skipped — set admin role manually in Clerk Dashboard → Users"
        echo ""
        touch "$CLERK_RBAC_FLAG"
        return 0
    fi

    # Look up user by email
    local user_response user_id
    user_response=$(curl -s --max-time 10 \
        -H "Authorization: Bearer $sk" \
        "https://api.clerk.com/v1/users?email_address=$admin_email" 2>/dev/null) || true

    user_id=$(echo "$user_response" | python3 -c "
import sys, json
try:
    users = json.load(sys.stdin)
    if isinstance(users, list) and len(users) > 0:
        print(users[0]['id'])
except: pass
" 2>/dev/null) || true

    if [ -z "$user_id" ]; then
        echo "  ⚠ User not found — sign in to the app first, then re-run with -r"
        echo "    Or set the role manually: Clerk Dashboard → Users → your user → Public metadata"
        echo "    Add: {\"role\": \"admin\"}"
        echo ""
        touch "$CLERK_RBAC_FLAG"
        return 0
    fi

    # Set public_metadata with admin role
    local meta_code
    meta_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
        -X PATCH "https://api.clerk.com/v1/users/$user_id/metadata" \
        -H "Authorization: Bearer $sk" \
        -H "Content-Type: application/json" \
        -d '{"public_metadata": {"role": "admin"}}' 2>/dev/null) || true

    if [ "$meta_code" = "200" ]; then
        echo "  ✓ Admin role set for $admin_email ($user_id)"
    else
        echo "  ⚠ Could not set admin role (HTTP $meta_code)"
        echo "    Set manually: Clerk Dashboard → Users → $admin_email → Public metadata"
        echo "    Add: {\"role\": \"admin\"}"
    fi

    touch "$CLERK_RBAC_FLAG"
    echo ""
}

check_and_setup_clerk_rbac

# =============================================================================
# Elasticsearch — detect, optionally configure, initialize indices
# =============================================================================

check_and_setup_elasticsearch() {
    echo "Checking Elasticsearch..."

    local es_cloud_id es_node es_api_key
    es_cloud_id=$(read_env_value "$BACKEND_ENV" "ELASTICSEARCH_CLOUD_ID")
    es_node=$(read_env_value "$BACKEND_ENV" "ELASTICSEARCH_NODE")
    es_api_key=$(read_env_value "$BACKEND_ENV" "ELASTICSEARCH_API_KEY")

    # Case 1: Not configured — offer to configure or skip
    if [ -z "$es_cloud_id" ] && [ -z "$es_node" ]; then
        echo "  Not configured (Analytics will prompt for setup in the UI)"

        # Offer interactive configuration if TTY available
        if [ -t 0 ] && [ -t 1 ]; then
            echo ""
            read -rp "  Configure Elasticsearch now? [Cloud / Local Docker / Skip (default)] " es_choice
            case "$es_choice" in
                [Cc]*)
                    echo ""
                    read -rp "  Cloud ID: " es_cloud_id
                    read -rp "  API Key: " es_api_key

                    if [ -n "$es_cloud_id" ] && [ -n "$es_api_key" ]; then
                        write_env_value "$BACKEND_ENV" "ELASTICSEARCH_CLOUD_ID" "$es_cloud_id"
                        write_env_value "$BACKEND_ENV" "ELASTICSEARCH_API_KEY" "$es_api_key"
                        write_env_value "$BACKEND_ENV" "ELASTICSEARCH_INDEX_PATTERN" "achilles-results-*"
                        echo "  ✓ Elastic Cloud credentials saved to backend/.env"
                    else
                        echo "  Skipped — both Cloud ID and API Key are required"
                        echo ""
                        return 0
                    fi
                    ;;
                [Ll]*)
                    echo "  Use: docker compose --profile elasticsearch up -d"
                    echo "  Then configure at Analytics → Setup with: http://elasticsearch:9200"
                    echo ""
                    return 0
                    ;;
                *)
                    echo ""
                    return 0
                    ;;
            esac
        else
            echo ""
            return 0
        fi
    fi

    # At this point ES is configured — test connectivity
    local es_url=""
    local curl_auth=""

    if [ -n "$es_cloud_id" ]; then
        # For Elastic Cloud, we can't easily derive the URL from the cloud ID
        # (it's a base64-encoded compound value). Test via the Python script instead.
        echo "  Elastic Cloud configured (Cloud ID: ${es_cloud_id:0:20}...)"
    elif [ -n "$es_node" ]; then
        es_url="$es_node"
        if [ -n "$es_api_key" ]; then
            curl_auth="-H \"Authorization: ApiKey $es_api_key\""
        fi

        # Quick connectivity test
        local http_code
        http_code=$(eval curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$curl_auth" "$es_url" 2>/dev/null) || true
        if [ "$http_code" != "200" ]; then
            echo "  ⚠ Could not connect to $es_url (HTTP $http_code)"
            echo "    Check credentials in backend/.env — starting anyway"
            echo ""
            return 0
        fi
    fi

    # Check if indices exist (only for direct node connections)
    if [ -n "$es_url" ]; then
        local index_count
        index_count=$(eval curl -s --max-time 5 "$curl_auth" "$es_url/_cat/indices/achilles-*?h=index" 2>/dev/null | wc -l) || true
        index_count=$((index_count + 0))  # ensure numeric

        if [ "$index_count" -gt 0 ]; then
            local doc_count
            doc_count=$(eval curl -s --max-time 5 "$curl_auth" "$es_url/_cat/indices/achilles-*?h=docs.count" 2>/dev/null | awk '{s+=$1} END {print s+0}') || true
            echo "  ✓ Connected ($index_count indices, $doc_count documents)"
            echo ""
            return 0
        fi

        # No indices — offer to initialize
        echo "  ✓ Connected to $es_url"
        echo "  ✗ No achilles-* indices found"
    else
        # Elastic Cloud — can't check indices with curl, delegate to init script
        echo "  Checking indices..."
    fi

    if [ -t 0 ] && [ -t 1 ]; then
        echo ""
        read -rp "  Initialize Elasticsearch indices? [Y/n] " init_response
        case "${init_response:-Y}" in
            [Nn]*)
                echo "  Skipped. Run ./scripts/init-elasticsearch.sh later."
                echo ""
                return 0
                ;;
        esac

        read -rp "  Seed with synthetic demo data? [y/N] " seed_response
        local seed_flag=""
        case "${seed_response:-N}" in
            [Yy]*) seed_flag="--seed" ;;
        esac

        echo ""
        "$SCRIPT_DIR/init-elasticsearch.sh" $seed_flag
    fi

    echo ""
}

check_and_setup_elasticsearch

# =============================================================================
# Test Library — check if the default repo needs authentication
# =============================================================================

check_and_setup_test_library() {
    local repo_url github_token
    repo_url=$(read_env_value "$BACKEND_ENV" "TESTS_REPO_URL")
    github_token=$(read_env_value "$BACKEND_ENV" "GITHUB_TOKEN")

    # If TESTS_REPO_URL is explicitly set with a token, nothing to do
    if [ -n "$repo_url" ] && [ -n "$github_token" ]; then
        echo "Checking test library..."
        echo "  ✓ Configured ($repo_url)"
        echo ""
        return 0
    fi

    # The default repo is https://github.com/ubercylon8/f0_library.git (hardcoded in server.ts)
    # Test if it's accessible without auth
    local test_url="${repo_url:-https://github.com/ubercylon8/f0_library.git}"
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$test_url/info/refs?service=git-upload-pack" 2>/dev/null) || true

    if [ "$http_code" = "200" ]; then
        # Repo is public — no token needed
        echo "Checking test library..."
        echo "  ✓ Public repo accessible (no token needed)"
        echo ""
        return 0
    fi

    # Repo needs authentication
    if [ -n "$github_token" ]; then
        # Token already set, let the backend handle it
        echo "Checking test library..."
        echo "  Token configured"
        echo ""
        return 0
    fi

    echo "Checking test library..."
    echo "  ✗ Test library requires authentication"

    # Non-interactive — just warn
    if ! [ -t 0 ] || ! [ -t 1 ]; then
        echo "    Set GITHUB_TOKEN in backend/.env to sync the test library"
        echo ""
        return 0
    fi

    echo ""
    echo "  The security test library (f0_library) currently requires a GitHub"
    echo "  token for access. This is a temporary restriction — the repo will"
    echo "  become fully public soon."
    echo ""
    echo "  You can get a read-only token from the project maintainer, or skip"
    echo "  to use the platform without the test library."
    echo ""
    read -rp "  GitHub Token (hidden, or S to skip): " -s gh_response
    echo ""

    case "$gh_response" in
        [Ss])
            echo "  Skipped — Test Browser will show 'No tests in library'"
            echo ""
            return 0
            ;;
        "")
            echo "  Skipped"
            echo ""
            return 0
            ;;
        *)
            write_env_value "$BACKEND_ENV" "GITHUB_TOKEN" "$gh_response"
            # Also ensure the repo URL is set explicitly
            if [ -z "$repo_url" ]; then
                write_env_value "$BACKEND_ENV" "TESTS_REPO_URL" "https://github.com/ubercylon8/f0_library.git"
                write_env_value "$BACKEND_ENV" "TESTS_REPO_BRANCH" "main"
            fi
            echo "  ✓ Token saved to backend/.env"
            echo ""
            ;;
    esac
}

check_and_setup_test_library

fi  # end of RESTART_SERVERS != true (skip setup checks)

# Validate and configure tunnel provider (skip during restart — tunnels are already running)
if [ "$TUNNEL_MODE" = true ] && [ "$RESTART_SERVERS" != true ]; then
    # Auto-detect provider if not set
    if [ -z "$TUNNEL_PROVIDER" ]; then
        if command -v cloudflared &>/dev/null; then
            TUNNEL_PROVIDER="cloudflare"
        elif command -v ngrok &>/dev/null && [ -f "$NGROK_CONFIG_MAIN" ]; then
            TUNNEL_PROVIDER="ngrok"
        fi
    fi

    # If still no provider, offer to install cloudflared (free, no account)
    if [ -z "$TUNNEL_PROVIDER" ]; then
        echo "No tunnel provider found."
        echo "  Cloudflare Tunnel: free, no account needed, HTTPS"
        echo "  ngrok:             requires account + auth token"
        echo ""
        if [ -t 0 ] && [ -t 1 ]; then
            read -rp "Install Cloudflare Tunnel (cloudflared)? [Y/n] " response
            case "${response:-Y}" in
                [Nn]*)
                    echo "Install a tunnel provider manually and re-run with --tunnel."
                    exit 1
                    ;;
            esac
            install_cloudflared
            if command -v cloudflared &>/dev/null; then
                TUNNEL_PROVIDER="cloudflare"
                echo "  ✓ cloudflared installed"
            else
                echo "  ✗ cloudflared installation failed"
                exit 1
            fi
        else
            echo "Non-interactive mode — install cloudflared manually."
            exit 1
        fi
    fi

    echo "Tunnel provider: $TUNNEL_PROVIDER"

    # Provider-specific validation
    if [ "$TUNNEL_PROVIDER" = "ngrok" ]; then
        if ! command -v ngrok &>/dev/null; then
            echo "Error: ngrok not found. Install from ngrok.com or use TUNNEL_PROVIDER=cloudflare"
            exit 1
        fi
        if [ ! -f "$NGROK_CONFIG_MAIN" ]; then
            echo "Error: ngrok config not found at $NGROK_CONFIG_MAIN"
            echo "Run: ngrok config add-authtoken YOUR_TOKEN"
            exit 1
        fi

        # Generate tunnel config dynamically
        NGROK_CONFIG_TUNNELS="/tmp/achilles-tunnels-$$.yml"
        cat > "$NGROK_CONFIG_TUNNELS" << EOF
version: 3
endpoints:
  - name: achilles-frontend
    url: https://$NGROK_FRONTEND_DOMAIN
    upstream:
      url: $FRONTEND_PORT
  - name: achilles-backend
    url: https://$NGROK_BACKEND_DOMAIN
    upstream:
      url: $BACKEND_PORT
EOF
        echo "  ngrok domains: $NGROK_FRONTEND_DOMAIN, $NGROK_BACKEND_DOMAIN"
    fi
fi

# Find available ports
echo "Checking port availability..."

if is_port_in_use $BACKEND_PORT; then
    echo "  Port $BACKEND_PORT is in use, finding alternative..."
    BACKEND_PORT=$(find_available_port $BACKEND_PORT $BACKEND_PORT_MAX)
    if [ "$BACKEND_PORT" -eq -1 ]; then
        echo "Error: Could not find available port for backend (tried $BACKEND_PORT-$BACKEND_PORT_MAX)"
        echo "Use --kill to terminate existing processes"
        exit 1
    fi
    echo "  Using port $BACKEND_PORT for backend"
else
    echo "  Backend port $BACKEND_PORT is available"
fi

if is_port_in_use $FRONTEND_PORT; then
    echo "  Port $FRONTEND_PORT is in use, finding alternative..."
    FRONTEND_PORT=$(find_available_port $FRONTEND_PORT $FRONTEND_PORT_MAX)
    if [ "$FRONTEND_PORT" -eq -1 ]; then
        echo "Error: Could not find available port for frontend (tried $FRONTEND_PORT-$FRONTEND_PORT_MAX)"
        echo "Use --kill to terminate existing processes"
        exit 1
    fi
    echo "  Using port $FRONTEND_PORT for frontend"
else
    echo "  Frontend port $FRONTEND_PORT is available"
fi

echo ""

# Start tunnels if requested (skip during restart — tunnels are preserved)
if [ "$RESTART_SERVERS" != true ]; then
NGROK_PID=""
TUNNEL_FRONTEND_URL=""
TUNNEL_BACKEND_URL=""
fi
if [ "$TUNNEL_MODE" = true ] && [ "$RESTART_SERVERS" != true ]; then
    if [ "$TUNNEL_PROVIDER" = "cloudflare" ]; then
        echo "Starting Cloudflare tunnels..."

        # Start backend tunnel
        cloudflared tunnel --url "http://localhost:$BACKEND_PORT" --no-autoupdate --protocol http2 > /tmp/cf-backend.log 2>&1 &
        CF_BACKEND_PID=$!

        # Start frontend tunnel
        cloudflared tunnel --url "http://localhost:$FRONTEND_PORT" --no-autoupdate --protocol http2 > /tmp/cf-frontend.log 2>&1 &
        CF_FRONTEND_PID=$!

        # Wait for URLs to be assigned
        echo "  Waiting for tunnel URLs..."
        CF_BACKEND_URL=$(wait_for_cf_url /tmp/cf-backend.log) || true
        CF_FRONTEND_URL=$(wait_for_cf_url /tmp/cf-frontend.log) || true

        if [ -z "$CF_BACKEND_URL" ] || [ -z "$CF_FRONTEND_URL" ]; then
            echo "  ⚠ Timed out waiting for tunnel URLs"
            [ -z "$CF_BACKEND_URL" ] && echo "    Backend tunnel failed — check /tmp/cf-backend.log"
            [ -z "$CF_FRONTEND_URL" ] && echo "    Frontend tunnel failed — check /tmp/cf-frontend.log"
            echo "  Continuing without tunnels..."
            TUNNEL_MODE=false
        else
            echo "  ✓ Dashboard:  $CF_FRONTEND_URL"
            echo "  ✓ Agent API:  $CF_BACKEND_URL"
            TUNNEL_FRONTEND_URL="$CF_FRONTEND_URL"
            TUNNEL_BACKEND_URL="$CF_BACKEND_URL"
        fi
        echo ""

    elif [ "$TUNNEL_PROVIDER" = "ngrok" ]; then
        echo "Starting ngrok tunnels..."
        ngrok start --config "$NGROK_CONFIG_MAIN" --config "$NGROK_CONFIG_TUNNELS" --all > /tmp/ngrok-achilles.log 2>&1 &
        NGROK_PID=$!
        sleep 3

        if ! kill -0 $NGROK_PID 2>/dev/null; then
            echo "Error: Failed to start ngrok tunnels. Check /tmp/ngrok-achilles.log"
            exit 1
        fi

        TUNNEL_COUNT=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -c "public_url" || echo "0")
        if [ "$TUNNEL_COUNT" -lt 2 ]; then
            echo "Warning: Expected 2 tunnels but found $TUNNEL_COUNT"
            echo "Check ngrok dashboard: http://127.0.0.1:4040"
        else
            echo "  ✓ Frontend tunnel: https://$NGROK_FRONTEND_DOMAIN"
            echo "  ✓ Backend tunnel:  https://$NGROK_BACKEND_DOMAIN"
            echo "  ✓ Inspect:         http://127.0.0.1:4040"
        fi
        TUNNEL_FRONTEND_URL="https://$NGROK_FRONTEND_DOMAIN"
        TUNNEL_BACKEND_URL="https://$NGROK_BACKEND_DOMAIN"
        echo ""
    fi

    # Set CORS to allow frontend tunnel domain
    if [ -n "$TUNNEL_FRONTEND_URL" ]; then
        export CORS_ORIGIN="$TUNNEL_FRONTEND_URL"
    fi

    # Set AGENT_SERVER_URL so enrollment one-liners use the backend tunnel URL
    # (the backend's /agent/config endpoint reads this to generate install commands)
    # Also update backend/.env in case it has an old value — dotenv reads .env files
    # but does NOT override existing env vars, so export must come first.
    if [ -n "$TUNNEL_BACKEND_URL" ]; then
        export AGENT_SERVER_URL="$TUNNEL_BACKEND_URL"
        if [ -f "$BACKEND_ENV" ] && grep -qE "^AGENT_SERVER_URL=" "$BACKEND_ENV"; then
            sed -i "s|^AGENT_SERVER_URL=.*|AGENT_SERVER_URL=${TUNNEL_BACKEND_URL}|" "$BACKEND_ENV"
        fi
    fi

    # Register tunnel URL with Clerk's allowed_origins (API-only, no dashboard UI)
    if [ -n "$TUNNEL_FRONTEND_URL" ]; then
        CLERK_SK_FOR_TUNNEL=$(read_env_value "$BACKEND_ENV" "CLERK_SECRET_KEY")
        if [ -n "$CLERK_SK_FOR_TUNNEL" ]; then
            echo "Registering tunnel with Clerk allowed_origins..."
            CLERK_PATCH_HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
                -X PATCH https://api.clerk.com/v1/instance \
                -H "Authorization: Bearer $CLERK_SK_FOR_TUNNEL" \
                -H "Content-type: application/json" \
                -d "{\"allowed_origins\": [\"$TUNNEL_FRONTEND_URL\"]}" 2>/dev/null)
            if [ "$CLERK_PATCH_HTTP_CODE" = "200" ] || [ "$CLERK_PATCH_HTTP_CODE" = "204" ]; then
                echo "  ✓ Clerk allowed_origins updated with $TUNNEL_FRONTEND_URL"
            else
                echo "  ⚠ Could not update Clerk allowed_origins (HTTP $CLERK_PATCH_HTTP_CODE)"
                echo "    You may need to run manually:"
                echo "    curl -X PATCH https://api.clerk.com/v1/instance \\"
                echo "      -H \"Authorization: Bearer \$CLERK_SECRET_KEY\" \\"
                echo "      -H \"Content-type: application/json\" \\"
                echo "      -d '{\"allowed_origins\": [\"$TUNNEL_FRONTEND_URL\"]}'"
            fi
            echo ""
        fi
    fi
fi

# Check if npm dependencies are installed
if [ ! -d "$PROJECT_ROOT/backend/node_modules" ]; then
    echo "Installing backend dependencies..."
    (cd "$PROJECT_ROOT/backend" && npm install)
fi

if [ ! -d "$PROJECT_ROOT/frontend/node_modules" ]; then
    echo "Installing frontend dependencies..."
    (cd "$PROJECT_ROOT/frontend" && npm install)
fi

# Export ports as environment variables for the apps
export PORT=$BACKEND_PORT
export VITE_BACKEND_PORT=$BACKEND_PORT

# VITE_API_URL tells the frontend to make direct requests to the backend
# instead of using Vite's /api proxy. In tunnel mode, the proxy is required
# (the browser can't reach localhost on the remote server), so leave it unset.
if [ "$TUNNEL_MODE" = true ]; then
    # Clear VITE_API_URL from frontend/.env if present — Vite reads .env files
    # directly at startup, bypassing shell env vars. A hardcoded localhost URL
    # in .env would make the browser send requests to the user's local machine.
    if [ -f "$FRONTEND_ENV" ] && grep -qE "^VITE_API_URL=" "$FRONTEND_ENV"; then
        sed -i 's|^VITE_API_URL=.*|# VITE_API_URL= # cleared for tunnel mode|' "$FRONTEND_ENV"
    fi
    export VITE_API_URL=""
else
    export VITE_API_URL="http://localhost:$BACKEND_PORT"
fi

# Prevent git from prompting for credentials in background processes.
# The backend's git sync uses GITHUB_TOKEN in the URL when available;
# without this, git writes credential prompts to /dev/tty, bypassing
# stdout/stderr redirection and leaking into the user's terminal.
export GIT_TERMINAL_PROMPT=0

# Start backend in background
echo "Starting backend server on port $BACKEND_PORT..."
cd "$PROJECT_ROOT/backend"
if [ "$DAEMON_MODE" = true ]; then
    # Build and use compiled server for daemon mode (tsx watch exits in non-interactive shells)
    if [ ! -f "dist/server.js" ] || [ "src/server.ts" -nt "dist/server.js" ]; then
        echo "  Building backend..."
        npm run build > /dev/null 2>&1
    fi
    nohup env PORT=$BACKEND_PORT npm run start > "$PROJECT_ROOT/.backend.log" 2>&1 &
else
    PORT=$BACKEND_PORT npm run dev &
fi
BACKEND_PID=$!
cd "$PROJECT_ROOT"

# Wait for backend to start
sleep 2

# Start frontend with custom port and backend proxy config
echo "Starting frontend server on port $FRONTEND_PORT..."
echo "  (proxying /api to backend on port $BACKEND_PORT)"
cd "$PROJECT_ROOT/frontend"
if [ "$DAEMON_MODE" = true ]; then
    # Run vite directly for daemon mode (npm exits in non-interactive shells)
    nohup env VITE_BACKEND_PORT=$BACKEND_PORT node node_modules/vite/bin/vite.js --port $FRONTEND_PORT > "$PROJECT_ROOT/.frontend.log" 2>&1 &
else
    VITE_BACKEND_PORT=$BACKEND_PORT npm run dev -- --port $FRONTEND_PORT &
fi
FRONTEND_PID=$!
cd "$PROJECT_ROOT"

echo ""
echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║   ProjectAchilles is running!                                     ║"
echo "╠═══════════════════════════════════════════════════════════════════╣"
echo "║                                                                   ║"
if [ "$TUNNEL_MODE" = true ] && [ -n "$TUNNEL_FRONTEND_URL" ]; then
echo "║   Dashboard:   $TUNNEL_FRONTEND_URL"
echo "║   Agent API:   $TUNNEL_BACKEND_URL"
if [ "$TUNNEL_PROVIDER" = "ngrok" ]; then
echo "║   Inspect:     http://127.0.0.1:4040"
fi
echo "║"
echo "║   Local:"
echo "║     Frontend:  http://localhost:$FRONTEND_PORT"
echo "║     Backend:   http://localhost:$BACKEND_PORT"
else
echo "║   Frontend:  http://localhost:$FRONTEND_PORT"
echo "║   Backend:   http://localhost:$BACKEND_PORT"
fi
echo "║                                                                   ║"
echo "╠═══════════════════════════════════════════════════════════════════╣"
if [ "$TUNNEL_MODE" = true ] && [ -n "$TUNNEL_BACKEND_URL" ]; then
echo "║   Agent enrollment URL (use this in agent config):                ║"
echo "║     $TUNNEL_BACKEND_URL"
echo "╠═══════════════════════════════════════════════════════════════════╣"
fi

if [ "$DAEMON_MODE" = true ]; then
    # Save PIDs for later cleanup
    echo "$BACKEND_PID" > "$PID_FILE"
    echo "$FRONTEND_PID" >> "$PID_FILE"
    [ -n "$NGROK_PID" ] && echo "$NGROK_PID" >> "$PID_FILE"
    [ -n "$CF_BACKEND_PID" ] && echo "$CF_BACKEND_PID" >> "$PID_FILE"
    [ -n "$CF_FRONTEND_PID" ] && echo "$CF_FRONTEND_PID" >> "$PID_FILE"
    echo "║   Running in daemon mode. Use --stop to shut down.              ║"
    echo "╚═══════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "PIDs saved to $PID_FILE"
    if [ "$TUNNEL_MODE" = true ]; then
        [ "$TUNNEL_PROVIDER" = "ngrok" ] && echo "ngrok logs: /tmp/ngrok-achilles.log"
        [ "$TUNNEL_PROVIDER" = "cloudflare" ] && echo "Cloudflare logs: /tmp/cf-backend.log, /tmp/cf-frontend.log"
    fi
    exit 0
else
    echo "║   Press Ctrl+C to stop                                            ║"
    echo "╚═══════════════════════════════════════════════════════════════════╝"
    echo ""

    # Handle cleanup on exit
    cleanup() {
        echo ""
        echo "Shutting down servers..."
        kill $BACKEND_PID 2>/dev/null || true
        kill $FRONTEND_PID 2>/dev/null || true
        [ -n "$NGROK_PID" ] && kill $NGROK_PID 2>/dev/null || true
        [ -n "$CF_BACKEND_PID" ] && kill $CF_BACKEND_PID 2>/dev/null || true
        [ -n "$CF_FRONTEND_PID" ] && kill $CF_FRONTEND_PID 2>/dev/null || true
        # Also kill any child processes
        pkill -P $BACKEND_PID 2>/dev/null || true
        pkill -P $FRONTEND_PID 2>/dev/null || true
        exit 0
    }

    trap cleanup SIGINT SIGTERM EXIT

    # Wait for either process to exit
    wait
fi
