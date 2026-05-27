#!/usr/bin/env bash
# Shared logging, colors, and path helpers for deploy-do scripts.
# Source this file from any deploy-do script.

if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
    readonly C_RESET=$'\033[0m'
    readonly C_RED=$'\033[31m'
    readonly C_GREEN=$'\033[32m'
    readonly C_YELLOW=$'\033[33m'
    readonly C_BLUE=$'\033[34m'
    readonly C_CYAN=$'\033[36m'
    readonly C_BOLD=$'\033[1m'
    readonly C_DIM=$'\033[2m'
else
    readonly C_RESET=""
    readonly C_RED=""
    readonly C_GREEN=""
    readonly C_YELLOW=""
    readonly C_BLUE=""
    readonly C_CYAN=""
    readonly C_BOLD=""
    readonly C_DIM=""
fi

log_info()    { printf '%s[*]%s %s\n' "$C_BLUE"   "$C_RESET" "$*" >&2; }
log_step()    { printf '\n%s[+]%s %s%s%s\n' "$C_CYAN" "$C_RESET" "$C_BOLD" "$*" "$C_RESET" >&2; }
log_success() { printf '%s[✓]%s %s\n' "$C_GREEN"  "$C_RESET" "$*" >&2; }
log_warn()    { printf '%s[!]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
log_error()   { printf '%s[✗]%s %s\n' "$C_RED"    "$C_RESET" "$*" >&2; }

# fail <message>  — log error, exit 1
fail() {
    log_error "$*"
    exit 1
}

# require_cmd <binary> <install-hint>  — error if binary missing
require_cmd() {
    local cmd="$1"
    local hint="${2:-}"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        if [[ -n "$hint" ]]; then
            fail "'$cmd' not found in PATH. Install: $hint"
        else
            fail "'$cmd' not found in PATH."
        fi
    fi
}

# confirm <prompt> [default-y]  — interactive yes/no prompt
confirm() {
    local prompt="$1"
    local default="${2:-n}"
    local reply
    if [[ "$default" == "y" ]]; then
        read -rp "$prompt [Y/n] " reply
        reply=${reply:-y}
    else
        read -rp "$prompt [y/N] " reply
        reply=${reply:-n}
    fi
    [[ "$reply" =~ ^[Yy]([Ee][Ss])?$ ]]
}

# Convert tenant slug to a safe form: lowercase, alnum + hyphens only.
slugify() {
    echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g; s/^-//; s/-$//'
}

# Validate FQDN format (loose — allows xn-- IDNs).
is_valid_fqdn() {
    local fqdn="$1"
    [[ "$fqdn" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]]
}

# Project root (deploy-do/.. = scripts/.. = repo root)
__deploy_do_dir() {
    # Resolve directory of this lib file, then go up two levels.
    local source_file="${BASH_SOURCE[0]}"
    # Handle symlinks
    while [[ -L "$source_file" ]]; do
        source_file="$(readlink "$source_file")"
    done
    cd -- "$(dirname -- "$source_file")/.." && pwd
}

readonly DEPLOY_DO_DIR="$(__deploy_do_dir)"
readonly REPO_ROOT="$(cd -- "$DEPLOY_DO_DIR/../.." && pwd)"

readonly STATE_DIR="${PROJECTACHILLES_DEPLOY_STATE_DIR:-$HOME/.config/projectachilles-deploy}"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
