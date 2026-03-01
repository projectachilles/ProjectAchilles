#!/bin/bash

# ProjectAchilles - Unified Security Platform
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
echo "║   ACHILLES - Unified Security Platform                            ║"
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
if [ ! -d "backend/node_modules" ]; then
    echo "Installing backend dependencies..."
    cd backend && npm install && cd ..
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "Installing frontend dependencies..."
    cd frontend && npm install && cd ..
fi

# Export ports as environment variables for the apps
export PORT=$BACKEND_PORT
export VITE_API_URL="http://localhost:$BACKEND_PORT"
export VITE_BACKEND_PORT=$BACKEND_PORT

# Start backend in background
echo "Starting backend server on port $BACKEND_PORT..."
cd backend
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
cd ..

# Wait for backend to start
sleep 2

# Start frontend with custom port and backend proxy config
echo "Starting frontend server on port $FRONTEND_PORT..."
echo "  (proxying /api to backend on port $BACKEND_PORT)"
cd frontend
if [ "$DAEMON_MODE" = true ]; then
    # Run vite directly for daemon mode (npm exits in non-interactive shells)
    nohup env VITE_BACKEND_PORT=$BACKEND_PORT node node_modules/vite/bin/vite.js --port $FRONTEND_PORT > "$PROJECT_ROOT/.frontend.log" 2>&1 &
else
    VITE_BACKEND_PORT=$BACKEND_PORT npm run dev -- --port $FRONTEND_PORT &
fi
FRONTEND_PID=$!
cd ..

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
