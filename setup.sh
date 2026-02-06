#!/bin/bash
# =============================================================================
# ProjectAchilles — Interactive Setup Wizard
# =============================================================================
# Configures backend/.env for Docker or local development.
# Uses whiptail/dialog for TUI, falls back to plain text prompts.
#
# Usage:
#   ./setup.sh              # Interactive TUI
#   ./setup.sh --non-interactive  # Use existing .env, generate missing secrets
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/backend/.env"
ENV_EXAMPLE="$SCRIPT_DIR/backend/.env.example"
BACKTITLE="Project Achilles Setup"

# =============================================================================
# TUI Backend Detection
# =============================================================================

TUI=""
if command -v whiptail &>/dev/null; then
    TUI="whiptail"
elif command -v dialog &>/dev/null; then
    TUI="dialog"
fi

# Notify about TUI mode
if [[ -z "$TUI" ]]; then
    echo "Tip: Install 'whiptail' for a better experience (apt install whiptail)"
    echo "Using plain-text prompts."
    echo ""
fi

# Check required dependencies
if ! command -v openssl &>/dev/null; then
    echo "Error: 'openssl' is required but not found."
    echo "Install with: sudo apt install openssl  (or your package manager)"
    exit 1
fi

NON_INTERACTIVE=false
if [[ "${1:-}" == "--non-interactive" ]]; then
    NON_INTERACTIVE=true
fi

# =============================================================================
# TUI Helpers (whiptail/dialog with plain-text fallback)
# =============================================================================

show_msgbox() {
    local title="$1" text="$2"
    if [[ -n "$TUI" ]]; then
        $TUI --backtitle "$BACKTITLE" --title "$title" --msgbox "$text" 14 72
    else
        echo ""
        echo "=== $title ==="
        echo -e "$text"
        echo ""
    fi
}

show_yesno() {
    local title="$1" text="$2"
    if [[ -n "$TUI" ]]; then
        if $TUI --backtitle "$BACKTITLE" --title "$title" --yesno "$text" 10 72; then
            return 0
        else
            return 1
        fi
    else
        echo ""
        echo "=== $title ==="
        echo -e "$text"
        while true; do
            read -rp "[y/n]: " yn
            case "$yn" in
                [Yy]*) return 0 ;;
                [Nn]*) return 1 ;;
                *) echo "Please answer y or n." ;;
            esac
        done
    fi
}

show_inputbox() {
    local title="$1" text="$2" default="${3:-}"
    if [[ -n "$TUI" ]]; then
        result=$($TUI --backtitle "$BACKTITLE" --title "$title" \
            --inputbox "$text" 10 72 "$default" 3>&1 1>&2 2>&3) || true
        echo "$result"
    else
        echo "" >&2
        echo "=== $title ===" >&2
        echo -e "$text" >&2
        if [[ -n "$default" ]]; then
            read -rp "[$default]: " result
            echo "${result:-$default}"
        else
            read -rp "> " result
            echo "$result"
        fi
    fi
}

show_passwordbox() {
    local title="$1" text="$2"
    if [[ -n "$TUI" ]]; then
        result=$($TUI --backtitle "$BACKTITLE" --title "$title" \
            --passwordbox "$text" 10 72 3>&1 1>&2 2>&3) || true
        echo "$result"
    else
        echo "" >&2
        echo "=== $title ===" >&2
        echo -e "$text" >&2
        read -rsp "> " result
        echo "" >&2
        echo "$result"
    fi
}

show_radiolist() {
    local title="$1" text="$2"
    shift 2
    # Remaining args: tag description on/off ...
    if [[ -n "$TUI" ]]; then
        local count=$(( $# / 3 ))
        result=$($TUI --backtitle "$BACKTITLE" --title "$title" \
            --radiolist "$text" 18 72 "$count" "$@" 3>&1 1>&2 2>&3) || true
        echo "$result"
    else
        echo "" >&2
        echo "=== $title ===" >&2
        echo "$text" >&2
        local i=1
        while [[ $# -ge 3 ]]; do
            local tag="$1" desc="$2" state="$3"
            local marker=""
            [[ "$state" == "ON" ]] && marker=" (default)" || true
            echo "  $i) $tag — $desc$marker" >&2
            shift 3
            ((i++))
        done
        read -rp "Choice [1]: " choice
        choice="${choice:-1}"
        # Re-parse to get the tag for the chosen index
        echo "$choice"
    fi
}

# =============================================================================
# .env Read/Write Helpers
# =============================================================================

# Read a value from the env file (returns empty string if not found or commented)
env_get() {
    local key="$1"
    if [[ -f "$ENV_FILE" ]]; then
        grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2-
    fi
}

# Set a value in the env file (adds if missing, updates if present)
env_set() {
    local key="$1" value="$2"
    if [[ -f "$ENV_FILE" ]] && grep -qE "^#?\s*${key}=" "$ENV_FILE"; then
        # Update existing (commented or not)
        sed -i "s|^#*\s*${key}=.*|${key}=${value}|" "$ENV_FILE"
    else
        echo "${key}=${value}" >> "$ENV_FILE"
    fi
}

# Comment out a key in the env file
env_comment() {
    local key="$1"
    if [[ -f "$ENV_FILE" ]]; then
        sed -i "s|^${key}=|# ${key}=|" "$ENV_FILE"
    fi
}

# =============================================================================
# Backup existing .env
# =============================================================================

backup_env() {
    if [[ -f "$ENV_FILE" ]]; then
        local backup="${ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$ENV_FILE" "$backup"
        echo "Backed up existing .env to: $backup"
    fi
}

# =============================================================================
# Step Functions
# =============================================================================

detect_environment() {
    HAS_DOCKER=false
    HAS_NODE=false
    HAS_EXISTING_ENV=false

    command -v docker &>/dev/null && HAS_DOCKER=true || true
    command -v node &>/dev/null && HAS_NODE=true || true
    [[ -f "$ENV_FILE" ]] && HAS_EXISTING_ENV=true || true
}

step_welcome() {
    local detected=""
    $HAS_DOCKER && detected="${detected}Docker: found\n" || detected="${detected}Docker: not found\n"
    $HAS_NODE && detected="${detected}Node.js: found\n" || detected="${detected}Node.js: not found\n"
    $HAS_EXISTING_ENV && detected="${detected}Existing .env: found\n" || detected="${detected}Existing .env: not found\n"

    show_msgbox "Project Achilles Setup" \
        "This wizard configures your environment for deployment.\n\nDetected:\n${detected}\nPress OK to continue."
}

step_deployment_mode() {
    local default_mode="docker"
    $HAS_DOCKER || default_mode="local"

    if [[ -n "$TUI" ]]; then
        DEPLOY_MODE=$($TUI --backtitle "$BACKTITLE" --title "Deployment Mode" \
            --radiolist "How will you run ProjectAchilles?" 12 72 2 \
            "docker" "Docker Compose (recommended)" "$( [[ $default_mode == docker ]] && echo ON || echo OFF )" \
            "local"  "Local development (Node.js)"   "$( [[ $default_mode == local ]]  && echo ON || echo OFF )" \
            3>&1 1>&2 2>&3) || DEPLOY_MODE="$default_mode"
    else
        echo ""
        echo "=== Deployment Mode ==="
        echo "  1) docker — Docker Compose (recommended)"
        echo "  2) local  — Local development (Node.js)"
        read -rp "Choice [1]: " choice
        case "${choice:-1}" in
            2) DEPLOY_MODE="local" ;;
            *) DEPLOY_MODE="docker" ;;
        esac
    fi
}

step_clerk_keys() {
    local existing_pub existing_sec
    existing_pub=$(env_get "CLERK_PUBLISHABLE_KEY")
    existing_sec=$(env_get "CLERK_SECRET_KEY")

    # If keys already look real, offer to keep them
    if [[ "$existing_pub" == pk_* && "$existing_sec" == sk_* ]]; then
        if show_yesno "Clerk Authentication" \
            "Clerk keys already configured.\n\nPublishable: ${existing_pub:0:20}...\n\nKeep existing keys?"; then
            CLERK_PUB="$existing_pub"
            CLERK_SEC="$existing_sec"
            return
        fi
    fi

    CLERK_PUB=$(show_inputbox "Clerk Authentication" \
        "Enter your Clerk Publishable Key\n(Get it from dashboard.clerk.com -> API Keys)" \
        "${existing_pub:-pk_test_}")

    CLERK_SEC=$(show_passwordbox "Clerk Authentication" \
        "Enter your Clerk Secret Key")

    # Validate format
    if [[ -n "$CLERK_PUB" && "$CLERK_PUB" != pk_* ]]; then
        show_msgbox "Warning" "Publishable key should start with 'pk_'. Proceeding anyway."
    fi
    if [[ -n "$CLERK_SEC" && "$CLERK_SEC" != sk_* ]]; then
        show_msgbox "Warning" "Secret key should start with 'sk_'. Proceeding anyway."
    fi
}

step_elasticsearch() {
    if [[ -n "$TUI" ]]; then
        ES_MODE=$($TUI --backtitle "$BACKTITLE" --title "Elasticsearch (Analytics)" \
            --radiolist "How should analytics be configured?\n\nLocal Docker adds ~2GB RAM usage." 16 72 4 \
            "local"       "Local instance (Docker Compose profile)"  OFF \
            "cloud"       "Elastic Cloud (Cloud ID + API Key)"       OFF \
            "self-hosted" "Self-hosted instance (URL + credentials)" OFF \
            "skip"        "Skip — configure later"                   ON  \
            3>&1 1>&2 2>&3) || ES_MODE="skip"
    else
        echo ""
        echo "=== Elasticsearch (Analytics) ==="
        echo "  1) local       — Local Docker instance (~2GB RAM)"
        echo "  2) cloud       — Elastic Cloud"
        echo "  3) self-hosted — Self-hosted URL"
        echo "  4) skip        — Configure later"
        read -rp "Choice [4]: " choice
        case "${choice:-4}" in
            1) ES_MODE="local" ;;
            2) ES_MODE="cloud" ;;
            3) ES_MODE="self-hosted" ;;
            *) ES_MODE="skip" ;;
        esac
    fi

    ES_NODE="" ES_CLOUD_ID="" ES_API_KEY="" ES_USERNAME="" ES_PASSWORD="" ES_INDEX=""

    case "$ES_MODE" in
        local)
            ES_NODE="http://elasticsearch:9200"
            ES_INDEX="achilles-results-*"
            ;;
        cloud)
            ES_CLOUD_ID=$(show_inputbox "Elastic Cloud" \
                "Enter your Elastic Cloud ID" \
                "$(env_get 'ELASTICSEARCH_CLOUD_ID')")
            ES_API_KEY=$(show_passwordbox "Elastic Cloud" \
                "Enter your Elasticsearch API Key")
            ES_INDEX=$(show_inputbox "Index Pattern" \
                "Index pattern for analytics queries" \
                "$(env_get 'ELASTICSEARCH_INDEX_PATTERN' || echo 'achilles-results-*')")
            ;;
        self-hosted)
            ES_NODE=$(show_inputbox "Self-hosted Elasticsearch" \
                "Enter the Elasticsearch URL" \
                "$(env_get 'ELASTICSEARCH_NODE' || echo 'https://localhost:9200')")
            ES_API_KEY=$(show_passwordbox "Self-hosted Elasticsearch" \
                "Enter API Key (leave empty for basic auth)")
            if [[ -z "$ES_API_KEY" ]]; then
                ES_USERNAME=$(show_inputbox "Self-hosted Elasticsearch" \
                    "Enter username" \
                    "$(env_get 'ELASTICSEARCH_USERNAME' || echo 'elastic')")
                ES_PASSWORD=$(show_passwordbox "Self-hosted Elasticsearch" \
                    "Enter password")
            fi
            ES_INDEX=$(show_inputbox "Index Pattern" \
                "Index pattern for analytics queries" \
                "$(env_get 'ELASTICSEARCH_INDEX_PATTERN' || echo 'achilles-results-*')")
            ;;
    esac
}

step_test_repo() {
    local existing_token existing_url
    existing_token=$(env_get "GITHUB_TOKEN")
    existing_url=$(env_get "TESTS_REPO_URL")

    if [[ -n "$existing_token" && "$existing_token" != "ghp_xxxxx" ]]; then
        if show_yesno "Test Repository" \
            "GitHub token already configured.\n\nKeep existing settings?"; then
            GITHUB_TOKEN="$existing_token"
            TESTS_REPO_URL="${existing_url:-https://github.com/ubercylon8/f0_library.git}"
            return
        fi
    fi

    GITHUB_TOKEN=$(show_passwordbox "Test Repository" \
        "Enter GitHub Personal Access Token\n(Required for private test repos)\n\nGenerate at: github.com/settings/tokens")

    TESTS_REPO_URL=$(show_inputbox "Test Repository" \
        "Repository URL" \
        "${existing_url:-https://github.com/ubercylon8/f0_library.git}")
}

step_generate_secrets() {
    # Generate secrets if not already set
    ENCRYPTION_SECRET=$(env_get "ENCRYPTION_SECRET")
    SESSION_SECRET=$(env_get "SESSION_SECRET")

    if [[ -z "$ENCRYPTION_SECRET" || "$ENCRYPTION_SECRET" == "change-me-to-a-secure-random-string" ]]; then
        ENCRYPTION_SECRET=$(openssl rand -base64 32)
    fi
    if [[ -z "$SESSION_SECRET" || "$SESSION_SECRET" == "change-me-to-a-secure-random-string" ]]; then
        SESSION_SECRET=$(openssl rand -base64 32)
    fi

    if ! $NON_INTERACTIVE; then
        show_msgbox "Secrets Generated" \
            "Cryptographic secrets generated:\n\n  ENCRYPTION_SECRET: (set)\n  SESSION_SECRET: (set)\n\nThese are stored in backend/.env only."
    fi
}

step_seed_data() {
    SEED_DATA=false
    if [[ "$ES_MODE" == "local" ]]; then
        if show_yesno "Seed Analytics Data" \
            "Seed Elasticsearch with ~1000 sample test results?\n\nThis populates the analytics dashboard immediately.\nThe es-seed container handles this automatically on first start."; then
            SEED_DATA=true
        fi
    fi
}

# =============================================================================
# Write Configuration
# =============================================================================

write_env() {
    backup_env

    # Start from example if no .env exists
    if [[ ! -f "$ENV_FILE" ]]; then
        cp "$ENV_EXAMPLE" "$ENV_FILE"
    fi

    # --- Authentication ---
    [[ -n "${CLERK_PUB:-}" ]] && env_set "CLERK_PUBLISHABLE_KEY" "$CLERK_PUB" || true
    [[ -n "${CLERK_SEC:-}" ]] && env_set "CLERK_SECRET_KEY" "$CLERK_SEC" || true

    # --- Secrets ---
    env_set "SESSION_SECRET" "$SESSION_SECRET"
    env_set "ENCRYPTION_SECRET" "$ENCRYPTION_SECRET"

    # --- CORS (depends on deploy mode) ---
    if [[ "$DEPLOY_MODE" == "docker" ]]; then
        env_set "CORS_ORIGIN" "http://localhost"
        env_set "NODE_ENV" "production"
    else
        env_set "CORS_ORIGIN" "http://localhost:5173"
        env_set "NODE_ENV" "development"
    fi

    # --- Test Repository ---
    [[ -n "${GITHUB_TOKEN:-}" ]] && env_set "GITHUB_TOKEN" "$GITHUB_TOKEN" || true
    [[ -n "${TESTS_REPO_URL:-}" ]] && env_set "TESTS_REPO_URL" "$TESTS_REPO_URL" || true

    # --- Elasticsearch ---
    # Clear all ES vars first, then set only the relevant ones
    env_comment "ELASTICSEARCH_NODE"
    env_comment "ELASTICSEARCH_CLOUD_ID"
    env_comment "ELASTICSEARCH_API_KEY"
    env_comment "ELASTICSEARCH_USERNAME"
    env_comment "ELASTICSEARCH_PASSWORD"
    env_comment "ELASTICSEARCH_INDEX_PATTERN"

    case "${ES_MODE:-skip}" in
        local)
            env_set "ELASTICSEARCH_NODE" "$ES_NODE"
            env_set "ELASTICSEARCH_INDEX_PATTERN" "$ES_INDEX"
            ;;
        cloud)
            [[ -n "$ES_CLOUD_ID" ]] && env_set "ELASTICSEARCH_CLOUD_ID" "$ES_CLOUD_ID" || true
            [[ -n "$ES_API_KEY" ]]  && env_set "ELASTICSEARCH_API_KEY" "$ES_API_KEY" || true
            [[ -n "$ES_INDEX" ]]    && env_set "ELASTICSEARCH_INDEX_PATTERN" "$ES_INDEX" || true
            ;;
        self-hosted)
            [[ -n "$ES_NODE" ]]     && env_set "ELASTICSEARCH_NODE" "$ES_NODE" || true
            [[ -n "$ES_API_KEY" ]]  && env_set "ELASTICSEARCH_API_KEY" "$ES_API_KEY" || true
            [[ -n "$ES_USERNAME" ]] && env_set "ELASTICSEARCH_USERNAME" "$ES_USERNAME" || true
            [[ -n "$ES_PASSWORD" ]] && env_set "ELASTICSEARCH_PASSWORD" "$ES_PASSWORD" || true
            [[ -n "$ES_INDEX" ]]    && env_set "ELASTICSEARCH_INDEX_PATTERN" "$ES_INDEX" || true
            ;;
    esac
}

show_summary() {
    local docker_cmd="docker compose up -d"
    [[ "${ES_MODE:-skip}" == "local" ]] && docker_cmd="docker compose --profile elasticsearch up -d" || true

    local summary="Configuration saved to: backend/.env\n\n"

    if [[ "$DEPLOY_MODE" == "docker" ]]; then
        summary+="To start:\n"
        summary+="  $docker_cmd\n\n"
        summary+="Dashboard: http://localhost\n"
    else
        summary+="To start:\n"
        summary+="  ./start.sh\n\n"
        summary+="Dashboard: http://localhost:5173\n"
    fi

    if [[ "${ES_MODE:-skip}" == "local" ]]; then
        summary+="\nElasticsearch: http://localhost:9200"
        if [[ "$SEED_DATA" == true ]]; then
            summary+="\nSeed data: es-seed container will load ~1000 records on first start"
        fi
    fi

    summary+="\n--- Tunnel (optional) ---"
    summary+="\nngrok tunnels are pre-configured for external access."
    summary+="\nSet these in backend/.env if you want to use your own domains:"
    summary+="\n  NGROK_FRONTEND_DOMAIN=projectachilles.ngrok.app"
    summary+="\n  NGROK_BACKEND_DOMAIN=achilles-agent.ngrok.app"
    summary+="\n  AGENT_SERVER_URL=https://achilles-agent.ngrok.app"
    summary+="\nThen start with: ./start.sh --tunnel"

    show_msgbox "Setup Complete" "$summary"
}

# =============================================================================
# Main
# =============================================================================

main() {
    detect_environment

    if $NON_INTERACTIVE; then
        echo "Running in non-interactive mode..."
        DEPLOY_MODE="docker"
        ES_MODE="skip"
        SEED_DATA=false
        step_generate_secrets
        if [[ -f "$ENV_FILE" ]]; then
            write_env
            echo "Secrets generated and written to $ENV_FILE"
        else
            echo "No existing .env found. Copy .env.example first:"
            echo "  cp backend/.env.example backend/.env"
            exit 1
        fi
        return
    fi

    step_welcome
    step_deployment_mode
    step_clerk_keys
    step_elasticsearch
    step_test_repo
    step_generate_secrets
    step_seed_data
    write_env
    show_summary
}

main "$@"
