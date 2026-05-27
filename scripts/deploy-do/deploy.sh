#!/usr/bin/env bash
# ProjectAchilles Digital Ocean demo deployer.
# Spins up backend + frontend on one droplet behind Caddy with auto-TLS,
# Elasticsearch on a second droplet inside a private VPC.
# Resumable via state file at ~/.config/projectachilles-deploy/<tenant>.state.json.
#
# Usage:
#   ./deploy.sh --tenant <slug>          Start (or resume) a deploy
#   ./deploy.sh --tenant <slug> --resume Same as above, explicit
#   ./deploy.sh --tenant <slug> --status Show state file contents
#   ./deploy.sh --tenant <slug> --reset  Wipe state file (drop tracking, NOT droplets)
#   ./deploy.sh --help                   Print this help

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/state.sh
source "$SCRIPT_DIR/lib/state.sh"
# shellcheck source=lib/clerk.sh
source "$SCRIPT_DIR/lib/clerk.sh"
# shellcheck source=lib/dns.sh
source "$SCRIPT_DIR/lib/dns.sh"
# shellcheck source=lib/doctl.sh
source "$SCRIPT_DIR/lib/doctl.sh"
# shellcheck source=lib/ssh.sh
source "$SCRIPT_DIR/lib/ssh.sh"
# shellcheck source=lib/validate.sh
source "$SCRIPT_DIR/lib/validate.sh"

# ─────────────────────────────────────────────────────────────────────────────
# Argument parsing
# ─────────────────────────────────────────────────────────────────────────────
TENANT=""
MODE="resume"   # resume | status | reset

usage() {
    # Print contiguous '#' lines from line 2 (the docstring banner).
    awk 'NR>=2 { if ($0 ~ /^#/) { sub(/^# ?/, ""); print } else exit }' "${BASH_SOURCE[0]}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --tenant)  TENANT="$(slugify "$2")"; shift 2 ;;
        --resume)  MODE="resume"; shift ;;
        --status)  MODE="status"; shift ;;
        --reset)   MODE="reset";  shift ;;
        --help|-h) usage; exit 0 ;;
        *)         fail "Unknown argument: $1 (try --help)" ;;
    esac
done

[[ -n "$TENANT" ]] || fail "Required: --tenant <slug> (try --help)"

# ─────────────────────────────────────────────────────────────────────────────
# Status / reset early exits
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "status" ]]; then
    state_dump "$TENANT"
    exit 0
fi

if [[ "$MODE" == "reset" ]]; then
    log_warn "About to delete the state file for tenant '$TENANT'."
    log_warn "This does NOT delete the droplets — they remain on DO unless you remove them manually."
    if confirm "Proceed with state reset?"; then
        state_reset "$TENANT"
        log_success "State reset."
    else
        log_info "Cancelled."
    fi
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Phase dispatcher
# ─────────────────────────────────────────────────────────────────────────────
# Each phase is a function `phase_<name>` that runs only if not already
# completed. On success it calls `state_mark_phase $TENANT <name>`.

PHASES=(
    preflight
    collect
    provision
    bootstrap
    install_es
    dns_wait
    install_backend
    caddy_tls
    verify
)

run_phase() {
    local name="$1"
    if state_phase_complete "$TENANT" "$name"; then
        log_info "Phase $C_DIM$name$C_RESET already complete, skipping."
        return 0
    fi
    log_step "Phase: $name"
    "phase_$name"
    state_mark_phase "$TENANT" "$name"
}

# ─────────────────────────────────────────────────────────────────────────────
# Phase implementations (each in its own file under lib/phases/)
# ─────────────────────────────────────────────────────────────────────────────
# shellcheck source=lib/phases/preflight.sh
source "$SCRIPT_DIR/lib/phases/preflight.sh"
# shellcheck source=lib/phases/collect.sh
source "$SCRIPT_DIR/lib/phases/collect.sh"
# shellcheck source=lib/phases/provision.sh
source "$SCRIPT_DIR/lib/phases/provision.sh"
# shellcheck source=lib/phases/bootstrap.sh
source "$SCRIPT_DIR/lib/phases/bootstrap.sh"
# shellcheck source=lib/phases/install_es.sh
source "$SCRIPT_DIR/lib/phases/install_es.sh"
# shellcheck source=lib/phases/dns_wait.sh
source "$SCRIPT_DIR/lib/phases/dns_wait.sh"
# shellcheck source=lib/phases/install_backend.sh
source "$SCRIPT_DIR/lib/phases/install_backend.sh"
# shellcheck source=lib/phases/caddy_tls.sh
source "$SCRIPT_DIR/lib/phases/caddy_tls.sh"
# shellcheck source=lib/phases/verify.sh
source "$SCRIPT_DIR/lib/phases/verify.sh"

# ─────────────────────────────────────────────────────────────────────────────
# Header
# ─────────────────────────────────────────────────────────────────────────────
state_init "$TENANT" >/dev/null
last=$(state_last_phase "$TENANT")
log_info "Tenant: ${C_BOLD}$TENANT${C_RESET}"
log_info "State:  $(state_file_for "$TENANT")"
if [[ -n "$last" ]]; then
    log_info "Resuming after last completed phase: ${C_BOLD}$last${C_RESET}"
else
    log_info "Starting fresh deploy."
fi

# ─────────────────────────────────────────────────────────────────────────────
# Trap: on interrupt, leave the state file intact so a re-run picks up.
# ─────────────────────────────────────────────────────────────────────────────
on_interrupt() {
    echo
    log_warn "Interrupted. State file preserved; re-run to resume from last completed phase."
    exit 130
}
trap on_interrupt INT TERM

# ─────────────────────────────────────────────────────────────────────────────
# Main loop
# ─────────────────────────────────────────────────────────────────────────────
for phase in "${PHASES[@]}"; do
    run_phase "$phase"
done

log_success "Deploy complete for tenant '$TENANT'."
