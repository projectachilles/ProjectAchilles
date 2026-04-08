#!/bin/bash
# =============================================================================
# ProjectAchilles — Deployment Secrets Generator
# =============================================================================
# Generates all required deployment secrets for ProjectAchilles.
# Outputs KEY=value lines (pipeable), or formats for specific deploy targets.
#
# Usage:
#   ./scripts/generate-secrets.sh                        # All secrets, plain output
#   ./scripts/generate-secrets.sh --target fly --format flyctl
#   ./scripts/generate-secrets.sh --target vercel --env-file .env.production
#   ./scripts/generate-secrets.sh --help
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# -----------------------------------------------------------------------------
# Defaults
# -----------------------------------------------------------------------------
TARGET="all"
FORMAT="plain"
ENV_FILE=""

# -----------------------------------------------------------------------------
# Usage
# -----------------------------------------------------------------------------
usage() {
    cat <<'USAGE'
Usage: generate-secrets.sh [OPTIONS]

Generate deployment secrets for ProjectAchilles.

Options:
  --target TARGET   Deployment target: docker, railway, render, fly, vercel, all
                    (default: all)
  --format FORMAT   Output format: plain, flyctl, railway
                    (default: plain)
  --env-file PATH   Append secrets to a file instead of (only) printing to stdout
  --help            Show this help message

Targets:
  docker, railway, render, fly
      Generates: SESSION_SECRET, ENCRYPTION_SECRET, CLI_AUTH_SECRET

  vercel
      Generates: SESSION_SECRET, ENCRYPTION_SECRET, CLI_AUTH_SECRET,
                 SIGNING_PRIVATE_KEY_B64, SIGNING_PUBLIC_KEY_B64

  all
      Generates all of the above (includes Ed25519 signing keys)

Formats:
  plain     KEY=value lines (default, pipeable)
  flyctl    flyctl secrets set KEY=value KEY=value ...
  railway   railway variables set KEY=value KEY=value ...

Examples:
  # Generate all secrets to stdout
  ./scripts/generate-secrets.sh

  # Generate Fly.io secrets as a flyctl command
  ./scripts/generate-secrets.sh --target fly --format flyctl

  # Generate Vercel secrets and append to .env.production
  ./scripts/generate-secrets.sh --target vercel --env-file .env.production
USAGE
}

# -----------------------------------------------------------------------------
# Argument parsing
# -----------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)
            TARGET="${2:-}"
            if [[ -z "$TARGET" ]]; then
                echo "Error: --target requires a value" >&2
                exit 1
            fi
            shift 2
            ;;
        --format)
            FORMAT="${2:-}"
            if [[ -z "$FORMAT" ]]; then
                echo "Error: --format requires a value" >&2
                exit 1
            fi
            shift 2
            ;;
        --env-file)
            ENV_FILE="${2:-}"
            if [[ -z "$ENV_FILE" ]]; then
                echo "Error: --env-file requires a path" >&2
                exit 1
            fi
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Error: unknown option '$1'" >&2
            echo "Run with --help for usage." >&2
            exit 1
            ;;
    esac
done

# Validate --target
case "$TARGET" in
    docker|railway|render|fly|vercel|all) ;;
    *)
        echo "Error: invalid target '$TARGET'. Must be one of: docker, railway, render, fly, vercel, all" >&2
        exit 1
        ;;
esac

# Validate --format
case "$FORMAT" in
    plain|flyctl|railway) ;;
    *)
        echo "Error: invalid format '$FORMAT'. Must be one of: plain, flyctl, railway" >&2
        exit 1
        ;;
esac

# Validate openssl is available
if ! command -v openssl &>/dev/null; then
    echo "Error: openssl is required but not found in PATH" >&2
    exit 1
fi

# -----------------------------------------------------------------------------
# Secret generation helpers
# -----------------------------------------------------------------------------
generate_random_secret() {
    openssl rand -base64 32
}

generate_ed25519_keys() {
    local tmpdir
    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' RETURN

    # Generate Ed25519 private key (PEM)
    openssl genpkey -algorithm Ed25519 -out "$tmpdir/private.pem" 2>/dev/null

    # Extract public key (PEM)
    openssl pkey -in "$tmpdir/private.pem" -pubout -out "$tmpdir/public.pem" 2>/dev/null

    # Convert to DER and base64 encode (single line, no wrapping)
    openssl pkey -in "$tmpdir/private.pem" -outform DER 2>/dev/null | base64 -w 0
    echo  # newline separator
    openssl pkey -in "$tmpdir/public.pem" -pubin -outform DER 2>/dev/null | base64 -w 0
    echo  # trailing newline
}

# -----------------------------------------------------------------------------
# Determine which secrets to generate
# -----------------------------------------------------------------------------
needs_signing_keys() {
    [[ "$TARGET" == "vercel" || "$TARGET" == "all" ]]
}

# -----------------------------------------------------------------------------
# Generate secrets
# -----------------------------------------------------------------------------
declare -a KEYS=()
declare -a VALUES=()

SESSION_SECRET="$(generate_random_secret)"
ENCRYPTION_SECRET="$(generate_random_secret)"
CLI_AUTH_SECRET="$(generate_random_secret)"

KEYS+=("SESSION_SECRET")        VALUES+=("$SESSION_SECRET")
KEYS+=("ENCRYPTION_SECRET")     VALUES+=("$ENCRYPTION_SECRET")
KEYS+=("CLI_AUTH_SECRET")       VALUES+=("$CLI_AUTH_SECRET")

if needs_signing_keys; then
    ED25519_OUTPUT="$(generate_ed25519_keys)"
    SIGNING_PRIVATE_KEY_B64="$(echo "$ED25519_OUTPUT" | sed -n '1p')"
    SIGNING_PUBLIC_KEY_B64="$(echo "$ED25519_OUTPUT" | sed -n '2p')"

    KEYS+=("SIGNING_PRIVATE_KEY_B64")  VALUES+=("$SIGNING_PRIVATE_KEY_B64")
    KEYS+=("SIGNING_PUBLIC_KEY_B64")   VALUES+=("$SIGNING_PUBLIC_KEY_B64")
fi

# -----------------------------------------------------------------------------
# Format and output
# -----------------------------------------------------------------------------
format_output() {
    case "$FORMAT" in
        plain)
            for i in "${!KEYS[@]}"; do
                echo "${KEYS[$i]}=${VALUES[$i]}"
            done
            ;;
        flyctl)
            local pairs=""
            for i in "${!KEYS[@]}"; do
                pairs+=" ${KEYS[$i]}=${VALUES[$i]}"
            done
            echo "flyctl secrets set${pairs}"
            ;;
        railway)
            local pairs=""
            for i in "${!KEYS[@]}"; do
                pairs+=" ${KEYS[$i]}=${VALUES[$i]}"
            done
            echo "railway variables set${pairs}"
            ;;
    esac
}

OUTPUT="$(format_output)"

if [[ -n "$ENV_FILE" ]]; then
    # Resolve relative paths against the current working directory
    if [[ "$ENV_FILE" != /* ]]; then
        ENV_FILE="$(pwd)/$ENV_FILE"
    fi

    # Ensure parent directory exists
    mkdir -p "$(dirname "$ENV_FILE")"

    # Append a blank line separator if the file already has content
    if [[ -f "$ENV_FILE" ]] && [[ -s "$ENV_FILE" ]]; then
        echo "" >> "$ENV_FILE"
    fi

    # Always write plain KEY=value to the env file, regardless of --format
    for i in "${!KEYS[@]}"; do
        echo "${KEYS[$i]}=${VALUES[$i]}" >> "$ENV_FILE"
    done

    # Print what was written
    echo "Wrote to $ENV_FILE:"
    for i in "${!KEYS[@]}"; do
        echo "  ${KEYS[$i]}=${VALUES[$i]}"
    done
else
    echo "$OUTPUT"
fi
