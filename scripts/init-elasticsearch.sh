#!/bin/bash
# =============================================================================
# init-elasticsearch.sh — Initialize Elasticsearch indices for ProjectAchilles
# =============================================================================
# Creates the proper index mappings for results, defender, and risk-acceptance.
# Optionally seeds synthetic demo data for the Analytics dashboard.
#
# Usage:
#   ./scripts/init-elasticsearch.sh                          # reads from backend/.env
#   ./scripts/init-elasticsearch.sh --cloud-id "..." --api-key "..."
#   ./scripts/init-elasticsearch.sh --host http://localhost:9200
#   ./scripts/init-elasticsearch.sh --seed                   # init + 1000 synthetic results
#   ./scripts/init-elasticsearch.sh --seed --count 500       # custom count
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_ENV="$PROJECT_ROOT/backend/.env"

# Defaults
ES_HOST=""
ES_CLOUD_ID=""
ES_API_KEY=""
ES_USERNAME=""
ES_PASSWORD=""
SEED_DATA=false
SEED_COUNT=1000
INDEX_NAME="achilles-results-default"

# Read a value from a .env file
read_env_value() {
    local file="$1" key="$2"
    if [ -f "$file" ]; then
        grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d'=' -f2-
    fi
}

# Parse arguments
while [ $# -gt 0 ]; do
    case "$1" in
        --host)         ES_HOST="$2"; shift 2 ;;
        --cloud-id)     ES_CLOUD_ID="$2"; shift 2 ;;
        --api-key)      ES_API_KEY="$2"; shift 2 ;;
        --username)     ES_USERNAME="$2"; shift 2 ;;
        --password)     ES_PASSWORD="$2"; shift 2 ;;
        --seed)         SEED_DATA=true; shift ;;
        --count)        SEED_COUNT="$2"; shift 2 ;;
        --index)        INDEX_NAME="$2"; shift 2 ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Creates Elasticsearch index mappings for ProjectAchilles."
            echo "Reads connection settings from backend/.env if no flags are given."
            echo ""
            echo "Connection options:"
            echo "  --host URL        Elasticsearch node URL (e.g., http://localhost:9200)"
            echo "  --cloud-id ID     Elastic Cloud deployment ID"
            echo "  --api-key KEY     Elasticsearch API key"
            echo "  --username USER   Basic auth username"
            echo "  --password PASS   Basic auth password"
            echo ""
            echo "Options:"
            echo "  --seed            Also generate and upload synthetic demo data"
            echo "  --count N         Number of synthetic documents (default: 1000)"
            echo "  --index NAME      Results index name (default: achilles-results-default)"
            echo "  --help, -h        Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# If no connection flags, read from backend/.env
if [ -z "$ES_HOST" ] && [ -z "$ES_CLOUD_ID" ]; then
    if [ -f "$BACKEND_ENV" ]; then
        ES_HOST=$(read_env_value "$BACKEND_ENV" "ELASTICSEARCH_NODE")
        ES_CLOUD_ID=$(read_env_value "$BACKEND_ENV" "ELASTICSEARCH_CLOUD_ID")
        ES_API_KEY=$(read_env_value "$BACKEND_ENV" "ELASTICSEARCH_API_KEY")
        ES_USERNAME=$(read_env_value "$BACKEND_ENV" "ELASTICSEARCH_USERNAME")
        ES_PASSWORD=$(read_env_value "$BACKEND_ENV" "ELASTICSEARCH_PASSWORD")
    fi
fi

# Validate we have a connection
if [ -z "$ES_HOST" ] && [ -z "$ES_CLOUD_ID" ]; then
    echo "Error: No Elasticsearch connection configured."
    echo "Either pass --host/--cloud-id flags or set ELASTICSEARCH_* in backend/.env"
    exit 1
fi

# Build Python args as an array (safe for values with special characters)
PY_ARGS=(--init-indices)

if [ -n "$ES_CLOUD_ID" ]; then
    PY_ARGS+=(--cloud-id "$ES_CLOUD_ID")
fi
if [ -n "$ES_API_KEY" ]; then
    PY_ARGS+=(--api-key "$ES_API_KEY")
fi
if [ -n "$ES_HOST" ]; then
    PY_ARGS+=(--host "$ES_HOST")
fi

echo "Initializing Elasticsearch indices..."

# Ensure python3 is available
if ! command -v python3 &>/dev/null; then
    echo "Error: python3 is required but not found."
    exit 1
fi

# Try to install elasticsearch package if not present
NEED_VENV=false
if ! python3 -c "import elasticsearch" 2>/dev/null; then
    NEED_VENV=true
    VENV_DIR="$PROJECT_ROOT/.es-venv"
    if [ ! -d "$VENV_DIR" ]; then
        echo "  Installing elasticsearch Python package..."
        python3 -m venv "$VENV_DIR"
        "$VENV_DIR/bin/pip" install -q 'elasticsearch>=8.0,<9.0'
    fi
    PYTHON="$VENV_DIR/bin/python3"
else
    PYTHON="python3"
fi

# Run index initialization
$PYTHON "$SCRIPT_DIR/upload_to_elasticsearch.py" "${PY_ARGS[@]}"

# Seed data if requested
if $SEED_DATA; then
    echo ""
    echo "Generating $SEED_COUNT synthetic test results..."
    SEED_FILE="/tmp/achilles-seed-$$.ndjson"
    $PYTHON "$SCRIPT_DIR/generate_synthetic_data.py" -c "$SEED_COUNT" -o "$SEED_FILE"

    echo "Uploading to Elasticsearch..."
    UPLOAD_ARGS=(--file "$SEED_FILE" --index "$INDEX_NAME" --create-index)
    if [ -n "$ES_CLOUD_ID" ]; then
        UPLOAD_ARGS+=(--cloud-id "$ES_CLOUD_ID")
    fi
    if [ -n "$ES_API_KEY" ]; then
        UPLOAD_ARGS+=(--api-key "$ES_API_KEY")
    fi
    if [ -n "$ES_HOST" ]; then
        UPLOAD_ARGS+=(--host "$ES_HOST")
    fi

    $PYTHON "$SCRIPT_DIR/upload_to_elasticsearch.py" "${UPLOAD_ARGS[@]}"
    rm -f "$SEED_FILE"
    echo "  ✓ $SEED_COUNT synthetic results uploaded to $INDEX_NAME"
fi

echo ""
echo "Done. Indices are ready for use."
