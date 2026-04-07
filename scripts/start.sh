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

# ngrok tunnel configuration (can be overridden via environment or .env file)
NGROK_CONFIG_MAIN="$HOME/.config/ngrok/ngrok.yml"
NGROK_CONFIG_TUNNELS="${NGROK_CONFIG_TUNNELS:-$HOME/.config/ngrok/achilles-tunnels.yml}"

# Load .env if present (for NGROK_*_DOMAIN overrides)
if [ -f "$PROJECT_ROOT/backend/.env" ]; then
    # Only load NGROK_ variables to avoid polluting environment
    eval "$(grep -E '^NGROK_' "$PROJECT_ROOT/backend/.env" 2>/dev/null | sed 's/^/export /')"
fi

# Tunnel domains - users should set these in backend/.env or environment
NGROK_FRONTEND_DOMAIN="${NGROK_FRONTEND_DOMAIN:-projectachilles.ngrok.app}"
NGROK_BACKEND_DOMAIN="${NGROK_BACKEND_DOMAIN:-achilles-agent.ngrok.app}"

# Check for command line arguments
KILL_EXISTING=false
DAEMON_MODE=false
STOP_DAEMON=false
TUNNEL_MODE=false
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
            echo "  --tunnel, -t            Start ngrok tunnels for external access"
            echo "  --backend-port=PORT     Specify backend port (default: 3000)"
            echo "  --frontend-port=PORT    Specify frontend port (default: 5173)"
            echo "  --help, -h              Show this help message"
            echo ""
            echo "Tunnel mode exposes:"
            echo "  Frontend: https://$NGROK_FRONTEND_DOMAIN"
            echo "  Backend:  https://$NGROK_BACKEND_DOMAIN"
            echo ""
            echo "Custom domains (set in backend/.env or environment):"
            echo "  NGROK_FRONTEND_DOMAIN=your-app.ngrok.app"
            echo "  NGROK_BACKEND_DOMAIN=your-api.ngrok.app"
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

# Kill existing processes if requested
if [ "$KILL_EXISTING" = true ]; then
    echo "Killing existing processes..."
    kill_port $BACKEND_PORT
    kill_port $FRONTEND_PORT
    # Also kill any existing ngrok processes for our tunnels
    pkill -f "ngrok.*achilles" 2>/dev/null || true
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

# Run Clerk check before starting servers
check_and_setup_clerk

# Validate tunnel mode requirements
if [ "$TUNNEL_MODE" = true ]; then
    if ! command -v ngrok &> /dev/null; then
        echo "Error: ngrok is required for tunnel mode but not installed."
        echo "Install with: yay -S ngrok  (or download from ngrok.com)"
        exit 1
    fi
    if [ ! -f "$NGROK_CONFIG_MAIN" ]; then
        echo "Error: ngrok main config not found at $NGROK_CONFIG_MAIN"
        echo "Run: ngrok config add-authtoken YOUR_TOKEN"
        exit 1
    fi

    # Generate tunnel config dynamically from environment variables
    NGROK_CONFIG_TUNNELS="/tmp/achilles-tunnels-$$.yml"
    cat > "$NGROK_CONFIG_TUNNELS" << EOF
# Auto-generated ngrok tunnel configuration
# Domains configured via NGROK_FRONTEND_DOMAIN and NGROK_BACKEND_DOMAIN

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
    echo "  Generated tunnel config for: $NGROK_FRONTEND_DOMAIN, $NGROK_BACKEND_DOMAIN"
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

# Start ngrok tunnels if requested
NGROK_PID=""
if [ "$TUNNEL_MODE" = true ]; then
    echo "Starting ngrok tunnels..."
    ngrok start --config "$NGROK_CONFIG_MAIN" --config "$NGROK_CONFIG_TUNNELS" --all > /tmp/ngrok-achilles.log 2>&1 &
    NGROK_PID=$!
    sleep 3

    # Verify tunnels are running
    if ! kill -0 $NGROK_PID 2>/dev/null; then
        echo "Error: Failed to start ngrok tunnels. Check /tmp/ngrok-achilles.log"
        exit 1
    fi

    # Verify both tunnels are active
    TUNNEL_COUNT=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -c "public_url" || echo "0")
    if [ "$TUNNEL_COUNT" -lt 2 ]; then
        echo "Warning: Expected 2 tunnels but found $TUNNEL_COUNT"
        echo "Check ngrok dashboard: http://127.0.0.1:4040"
    else
        echo "  ✓ Frontend tunnel: https://$NGROK_FRONTEND_DOMAIN"
        echo "  ✓ Backend tunnel:  https://$NGROK_BACKEND_DOMAIN"
        echo "  ✓ Inspect:         http://127.0.0.1:4040"
    fi
    echo ""

    # Set CORS to allow frontend tunnel domain
    export CORS_ORIGIN="https://$NGROK_FRONTEND_DOMAIN"
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
export VITE_API_URL="http://localhost:$BACKEND_PORT"
export VITE_BACKEND_PORT=$BACKEND_PORT

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
if [ "$TUNNEL_MODE" = true ]; then
echo "║   Frontend:  https://$NGROK_FRONTEND_DOMAIN                  ║"
echo "║   Backend:   https://$NGROK_BACKEND_DOMAIN                   ║"
echo "║   Inspect:   http://127.0.0.1:4040                                ║"
else
echo "║   Frontend:  http://localhost:$FRONTEND_PORT                              ║"
echo "║   Backend:   http://localhost:$BACKEND_PORT                               ║"
fi
echo "║                                                                   ║"
echo "╠═══════════════════════════════════════════════════════════════════╣"
echo "║   Modules:                                                        ║"
if [ "$TUNNEL_MODE" = true ]; then
echo "║     • Tests:      https://$NGROK_FRONTEND_DOMAIN/            ║"
echo "║     • Analytics:  https://$NGROK_FRONTEND_DOMAIN/analytics   ║"
echo "║     • Agent:      https://$NGROK_FRONTEND_DOMAIN/agent       ║"
else
echo "║     • Tests:      http://localhost:$FRONTEND_PORT/                        ║"
echo "║     • Analytics:  http://localhost:$FRONTEND_PORT/analytics               ║"
echo "║     • Agent:      http://localhost:$FRONTEND_PORT/agent                   ║"
fi
echo "║                                                                   ║"
echo "╠═══════════════════════════════════════════════════════════════════╣"

if [ "$DAEMON_MODE" = true ]; then
    # Save PIDs for later cleanup
    echo "$BACKEND_PID" > "$PID_FILE"
    echo "$FRONTEND_PID" >> "$PID_FILE"
    [ -n "$NGROK_PID" ] && echo "$NGROK_PID" >> "$PID_FILE"
    echo "║   Running in daemon mode. Use --stop to shut down.              ║"
    echo "╚═══════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "PIDs saved to $PID_FILE"
    [ "$TUNNEL_MODE" = true ] && echo "ngrok logs: /tmp/ngrok-achilles.log"
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
        # Also kill any child processes
        pkill -P $BACKEND_PID 2>/dev/null || true
        pkill -P $FRONTEND_PID 2>/dev/null || true
        exit 0
    }

    trap cleanup SIGINT SIGTERM EXIT

    # Wait for either process to exit
    wait
fi
