#!/usr/bin/env bash
# =============================================================================
# ProjectAchilles — on-box server installer
# =============================================================================
# Installs ProjectAchilles as a publicly-reachable OR on-prem service behind a
# Caddy reverse proxy with working TLS. Run this ON the target server.
#
#   ./scripts/deploy-server.sh [--render-only] [path/to/deploy.config.env]
#
# Hybrid: reads deploy.config.env (default: repo-root/deploy.config.env) and
# prompts for any required value left blank — when running interactively. In a
# non-interactive shell (no TTY), missing required values are a hard error so
# agent-driven runs fail loudly instead of hanging.
#
# Idempotent: safe to re-run to apply config changes or upgrade.
#
# Environment (set by the achilles-installer TUI, or by hand):
#   ACHILLES_PROGRESS=1        also print machine-readable progress lines:
#                              ::phase <id> <title> | ::ok <id> | ::warn <msg>
#                              | ::fail <id> <msg>
#   ACHILLES_NONINTERACTIVE=1  never prompt, even with a TTY
#   ACHILLES_RENDER_ONLY=1     same as --render-only: write every rendered file
#                              (env files, Caddy snippets, CA, bootstrap
#                              scripts) and stop before Docker install/build/up
#   ACHILLES_FIREWALL_TEST=1   test hook: run the firewall phase even in
#                              render-only mode
#   ACHILLES_INSTALLER_BIN     achilles-installer binary, needed for
#                              TLS_MODE=achilles-ca (default: repo root)
#   ACHILLES_HOSTS_FILE_OVERRIDE  test hook: hosts file for HOSTS_ENTRY
#                              (default: /etc/hosts)
#   ACHILLES_FORCE_BUILD=1     rebuild the backend/frontend images even when
#                              images built from this commit exist
#
# HOSTS_ENTRY=true makes the config phase keep exactly one
# "<CADDY_BIND_IP> <ACHILLES_DOMAIN> # projectachilles" line in /etc/hosts
# (replacing an older one). The values are always validated, but render-only
# never writes the hosts file (unless ACHILLES_HOSTS_FILE_OVERRIDE points it
# at a test file). Any other value leaves the file alone.
#
# Phases, in order: config, validate, docker, ca, caddy-render, backend-env,
# root-env, firewall, up, ca-export, bootstrap, renew-timer. `ca`, `bootstrap`
# and `renew-timer` run only for achilles-ca, `ca-export` only for internal,
# `firewall` only when LAN_SUBNETS is set; render-only skips docker, up,
# ca-export, renew-timer and firewall (unless ACHILLES_FIREWALL_TEST=1).
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CADDY_DIR="${REPO_ROOT}/deploy/caddy"
RENDERED_DIR="${CADDY_DIR}/rendered"
ONPREM_DIR="${REPO_ROOT}/deploy/onprem"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.server.yml"
# Test overrides: point the CA and the systemd units at temp dirs.
CA_DIR="${ACHILLES_CA_DIR_OVERRIDE:-/etc/projectachilles/ca}"
SYSTEMD_DIR="${ACHILLES_SYSTEMD_DIR:-/etc/systemd/system}"
# Root-owned copies of what the renewal timer runs as root (never the repo,
# which the install user may be able to write).
LIB_DIR="${ACHILLES_LIB_DIR_OVERRIDE:-/usr/local/lib/projectachilles}"
RENEW_UNIT="achilles-ca-renew"

flag_on() { case "${1:-}" in 1|true|yes) return 0 ;; esac; return 1; }
PROGRESS=0;       flag_on "${ACHILLES_PROGRESS:-}" && PROGRESS=1
NONINTERACTIVE=0; flag_on "${ACHILLES_NONINTERACTIVE:-}" && NONINTERACTIVE=1
RENDER_ONLY=0;    flag_on "${ACHILLES_RENDER_ONLY:-}" && RENDER_ONLY=1
FORCE_BUILD=0;    flag_on "${ACHILLES_FORCE_BUILD:-}" && FORCE_BUILD=1

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
# Colour only on a terminal (stdout for c_info/c_ok/c_warn, stderr for
# c_err), so piped or logged output carries no escape sequences.
if [ -t 1 ]; then
  C_BLUE=$'\033[1;34m' C_GREEN=$'\033[1;32m' C_YELLOW=$'\033[1;33m' C_OFF=$'\033[0m'
else
  C_BLUE='' C_GREEN='' C_YELLOW='' C_OFF=''
fi
if [ -t 2 ]; then C_RED=$'\033[1;31m' C_ERR_OFF=$'\033[0m'; else C_RED='' C_ERR_OFF=''; fi
c_info()  { printf '%s==>%s %s\n' "$C_BLUE" "$C_OFF" "$*"; }
c_ok()    { printf '%s  ✓%s %s\n' "$C_GREEN" "$C_OFF" "$*"; }
c_warn()  { printf '%s  !%s %s\n' "$C_YELLOW" "$C_OFF" "$*"; }
c_err()   { printf '%serror:%s %s\n' "$C_RED" "$C_ERR_OFF" "$*" >&2; }

# Progress protocol (stdout, one event per line). Silent unless
# ACHILLES_PROGRESS=1, so human output is unchanged without it. With it, the
# protocol line replaces the human line for phase/warn/fail (the front end
# renders the event), so nothing is printed twice.
CURRENT_PHASE="config"
FAIL_REPORTED=0
proto() {
  [ "$PROGRESS" = 1 ] || return 0
  local line="$*"
  printf '%s\n' "${line//$'\n'/ }"
}
phase() { CURRENT_PHASE="$1"; proto "::phase $1 $2"; [ "$PROGRESS" = 1 ] || c_info "$2"; }
ok()    { proto "::ok $1"; }
warn()  { proto "::warn $*"; [ "$PROGRESS" = 1 ] || c_warn "$*"; }
fail()  { local id="$1"; shift; FAIL_REPORTED=1; proto "::fail ${id} $*"; [ "$PROGRESS" = 1 ] || c_err "$*"; exit 1; }
die()   { fail "$CURRENT_PHASE" "$*"; }
# Anything else that aborts the run (a failing command under set -e) still
# reports which phase it was in.
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$FAIL_REPORTED" = 0 ]; then
    proto "::fail ${CURRENT_PHASE} exited with status ${rc}"
  fi
}
trap on_exit EXIT

is_tty()  { [ -t 0 ] && [ -t 1 ]; }
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
as_root() { if [ -n "$SUDO" ]; then "$SUDO" "$@"; else "$@"; fi; }

# True for an IPv4 (a.b.c.d/0-32) or IPv6 (hex and colons, /0-128) CIDR.
valid_cidr() {
  local addr="${1%%/*}" len="${1#*/}" o
  [ "$addr" != "$1" ] || return 1
  case "$len" in ''|*[!0-9]*) return 1 ;; esac
  if [[ "$addr" == *:* ]]; then
    [[ "$addr" =~ ^[0-9A-Fa-f:]+$ ]] && [ "$len" -le 128 ] && return 0
    return 1
  fi
  [[ "$addr" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  [ "$len" -le 32 ] || return 1
  local IFS=.
  for o in $addr; do [ "$((10#$o))" -le 255 ] || return 1; done
  return 0
}

gen_secret() { openssl rand -base64 32; }

# Prompt for a value when missing (interactive only). $1=var name, $2=prompt,
# $3=secret(yes/no). Errors out in non-interactive shells.
prompt_var() {
  local var="$1" msg="$2" secret="${3:-no}" cur
  cur="${!var:-}"
  [ -n "$cur" ] && return 0
  if [ "$NONINTERACTIVE" = 1 ]; then
    die "required value '$var' is empty and ACHILLES_NONINTERACTIVE=1 forbids prompting. Set it in ${CONFIG_FILE}."
  fi
  if ! is_tty; then
    die "required value '$var' is empty and no TTY is available. Set it in ${CONFIG_FILE}."
  fi
  if [ "$secret" = "yes" ]; then
    read -r -s -p "  $msg: " cur; echo
  else
    read -r -p "  $msg: " cur
  fi
  [ -n "$cur" ] || die "'$var' is required."
  printf -v "$var" '%s' "$cur"
}

# Copies $1 to $2 as root:root 0755, only when the content differs.
install_root_copy() {
  cmp -s "$1" "$2" && return 0
  as_root install -o root -g root -m 0755 "$1" "$2" || fail "$CURRENT_PHASE" "could not install $2"
}

# Root-only reads of the CA dir; direct under the test override.
ca_as_root() {
  if [ -n "${ACHILLES_CA_DIR_OVERRIDE:-}" ]; then "$@"; else as_root "$@"; fi
}

# ca_intermediate_sum: the intermediate's SHA-256, empty when there is none.
# The `ca` phase compares it before and after `ca init` (CA_CHANGED).
CA_CHANGED=0
ca_intermediate_sum() {
  local f="${CA_DIR}/caddy/intermediate.crt"
  ca_as_root test -f "$f" || return 0
  ca_as_root sha256sum "$f" | cut -d' ' -f1
}

# Runs achilles-installer; as root for the real CA dir (keys are root-only).
installer() {
  if [ -n "${ACHILLES_CA_DIR_OVERRIDE:-}" ]; then
    "$ACHILLES_INSTALLER_BIN" "$@"
  else
    as_root "$ACHILLES_INSTALLER_BIN" "$@"
  fi
}

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
CONFIG_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --render-only) RENDER_ONLY=1 ;;
    -h|--help) sed -n '2,43p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) [ -z "$CONFIG_FILE" ] || die "unexpected argument: $1"; CONFIG_FILE="$1" ;;
  esac
  shift
done
CONFIG_FILE="${CONFIG_FILE:-${REPO_ROOT}/deploy.config.env}"

# ---------------------------------------------------------------------------
# 1. Load config
# ---------------------------------------------------------------------------
phase config "Loading configuration"
if [ -f "$CONFIG_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a
  c_ok "Loaded ${CONFIG_FILE}"
else
  [ "$NONINTERACTIVE" = 0 ] || die "No config file at ${CONFIG_FILE} and ACHILLES_NONINTERACTIVE=1 forbids prompting."
  warn "No config file at ${CONFIG_FILE} — will prompt for required values"
  is_tty || die "No config file and no TTY. Copy deploy.config.env.example to ${CONFIG_FILE} and fill it in."
fi

# Defaults
TLS_MODE="${TLS_MODE:-acme-http}"
ES_MODE="${ES_MODE:-self}"
TESTS_REPO_BRANCH="${TESTS_REPO_BRANCH:-main}"
AGENT_REPO_BRANCH="${AGENT_REPO_BRANCH:-main}"
ELASTICSEARCH_INDEX_PATTERN="${ELASTICSEARCH_INDEX_PATTERN:-achilles-results-*}"
SEED_ES="${SEED_ES:-false}"
CADDY_BIND_IP="${CADDY_BIND_IP:-}"
CA_INCLUDE_IP="${CA_INCLUDE_IP:-false}"
ACHILLES_INSTALLER_BIN="${ACHILLES_INSTALLER_BIN:-${REPO_ROOT}/achilles-installer}"
CA_ROTATE="${CA_ROTATE:-false}"

# HOSTS_ENTRY=true: keep exactly one "<ip> <domain> # projectachilles" line in
# the hosts file, replacing any earlier one in place. The values are checked
# first so nothing but an address and a hostname can reach the file.
HOSTS_FILE="${ACHILLES_HOSTS_FILE_OVERRIDE:-/etc/hosts}"
HOSTS_MARK="# projectachilles"
update_hosts() {
  local line="$1" src="$HOSTS_FILE" tmp
  [ -e "$src" ] || src=/dev/null
  tmp="$(mktemp)"
  if ! awk -v line="$line" -v mark="$HOSTS_MARK" '
      function ours(s,  n) {
        n = length(mark)
        return length(s) > n && substr(s, length(s) - n + 1) == mark && substr(s, length(s) - n, 1) ~ /[ \t]/
      }
      ours($0) { if (!done) { print line; done = 1 }; next }
      { print }
      END { if (!done) print line }
    ' "$src" > "$tmp"; then
    rm -f "$tmp"
    die "could not read ${HOSTS_FILE}"
  fi
  if cmp -s "$tmp" "$HOSTS_FILE"; then
    rm -f "$tmp"
    c_ok "${HOSTS_FILE} already maps ${ACHILLES_DOMAIN}"
    return 0
  fi
  if ! as_root tee "$HOSTS_FILE" < "$tmp" > /dev/null; then
    rm -f "$tmp"
    die "could not write ${HOSTS_FILE}"
  fi
  rm -f "$tmp"
  c_ok "Mapped ${ACHILLES_DOMAIN} in ${HOSTS_FILE}"
}
if [ "${HOSTS_ENTRY:-}" = true ]; then
  hosts_ip="${CADDY_BIND_IP#\[}"; hosts_ip="${hosts_ip%\]}"
  hosts_name="${ACHILLES_DOMAIN:-}"; hosts_name="${hosts_name%.}"
  if [ -z "$hosts_ip" ] || [ -z "$hosts_name" ]; then
    die "HOSTS_ENTRY=true needs ACHILLES_DOMAIN and CADDY_BIND_IP set in ${CONFIG_FILE}."
  fi
  [[ "$hosts_ip" =~ ^[0-9A-Fa-f:.]+$ ]] \
    || die "HOSTS_ENTRY=true: CADDY_BIND_IP '${CADDY_BIND_IP}' is not an IP address."
  [[ "$hosts_name" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] \
    || die "HOSTS_ENTRY=true: ACHILLES_DOMAIN '${ACHILLES_DOMAIN}' is not a hostname."
  # Like the firewall phase, render-only leaves the host alone; the override
  # lets tests exercise the write against a temp file.
  if [ "$RENDER_ONLY" = 0 ] || [ -n "${ACHILLES_HOSTS_FILE_OVERRIDE:-}" ]; then
    update_hosts "${hosts_ip} ${hosts_name} ${HOSTS_MARK}"
  else
    c_ok "Render-only: not writing ${HOSTS_FILE}"
  fi
fi
ok config

# ---------------------------------------------------------------------------
# 2. Collect + validate required values
# ---------------------------------------------------------------------------
phase validate "Validating settings"
prompt_var ACHILLES_DOMAIN "Public domain (e.g. achilles.example.com)"
prompt_var CLERK_PUBLISHABLE_KEY "Clerk publishable key (pk_live_...)"
prompt_var CLERK_SECRET_KEY "Clerk secret key (sk_live_...)" yes

case "$TLS_MODE" in
  acme-http)
    prompt_var ACME_EMAIL "Email for Let's Encrypt" ;;
  acme-dns)
    prompt_var ACME_EMAIL "Email for Let's Encrypt"
    prompt_var CADDY_DNS_PROVIDER "Caddy DNS provider (e.g. cloudflare)"
    CADDY_DNS_MODULE="${CADDY_DNS_MODULE:-github.com/caddy-dns/${CADDY_DNS_PROVIDER}}"
    prompt_var CADDY_DNS_TOKEN "DNS provider API token" yes ;;
  internal)
    : ;;
  byo)
    [ -f "${CADDY_DIR}/certs/cert.pem" ] || die "TLS_MODE=byo: ${CADDY_DIR}/certs/cert.pem not found"
    [ -f "${CADDY_DIR}/certs/key.pem" ]  || die "TLS_MODE=byo: ${CADDY_DIR}/certs/key.pem not found" ;;
  achilles-ca)
    prompt_var CADDY_BIND_IP "LAN IP for Caddy to listen on (e.g. 10.0.5.20)"
    prompt_var CA_ZONE "DNS zone the CA may issue for (e.g. corp.example.com)"
    domain_lc="${ACHILLES_DOMAIN,,}"; domain_lc="${domain_lc%.}"
    zone_lc="${CA_ZONE,,}"; zone_lc="${zone_lc%.}"
    case "$domain_lc" in
      "$zone_lc"|*".${zone_lc}") : ;;
      *) die "ACHILLES_DOMAIN '${ACHILLES_DOMAIN}' is outside CA_ZONE '${CA_ZONE}': the CA can only issue certificates in that zone." ;;
    esac
    case "$CA_INCLUDE_IP" in
      true|false) : ;;
      *) die "Invalid CA_INCLUDE_IP='${CA_INCLUDE_IP}' (expected: true | false)" ;;
    esac
    case "$CA_ROTATE" in
      true|false) : ;;
      *) die "Invalid CA_ROTATE='${CA_ROTATE}' (expected: true | false)" ;;
    esac ;;
  *)
    die "Invalid TLS_MODE='${TLS_MODE}' (expected: acme-http | acme-dns | internal | byo | achilles-ca)" ;;
esac

case "$ES_MODE" in
  self) : ;;
  cloud)
    prompt_var ELASTICSEARCH_CLOUD_ID "Elastic Cloud ID"
    prompt_var ELASTICSEARCH_API_KEY "Elastic Cloud API key" yes ;;
  *) die "Invalid ES_MODE='${ES_MODE}' (expected: self | cloud)" ;;
esac

# LAN_SUBNETS: comma-separated CIDRs the firewall phase opens 80/443 to.
# Parsed into LAN_CIDRS (trimmed, empty entries dropped); shape-checked here so
# a typo can't reach ufw/firewall-cmd.
LAN_CIDRS=()
if [ -n "${LAN_SUBNETS:-}" ]; then
  IFS=',' read -r -a _lan_raw <<< "$LAN_SUBNETS"
  for _c in "${_lan_raw[@]}"; do
    _c="${_c//[[:space:]]/}"
    [ -n "$_c" ] || continue
    valid_cidr "$_c" || die "invalid LAN_SUBNETS entry '${_c}' (expected CIDR like 10.0.5.0/24)"
    LAN_CIDRS+=("$_c")
  done
fi

PUBLIC_URL="https://${ACHILLES_DOMAIN}"

# CADDY_BIND_IP: bare for `ca init --ip`, bracketed when IPv6 for compose's
# port syntax. Empty = compose publishes on every IPv4 and IPv6 address.
BIND_IP_BARE="${CADDY_BIND_IP#\[}"; BIND_IP_BARE="${BIND_IP_BARE%\]}"
case "$BIND_IP_BARE" in
  *:*) CADDY_BIND_IP_ENV="[${BIND_IP_BARE}]" ;;
  *)   CADDY_BIND_IP_ENV="$BIND_IP_BARE" ;;
esac

CADDY_IMAGE="caddy:2.10.0-alpine"
[ "$TLS_MODE" = "acme-dns" ] && CADDY_IMAGE="projectachilles-caddy:dns-${CADDY_DNS_PROVIDER}"

# Blank secrets: reuse the value an earlier run wrote to backend/.env, else
# generate one. Never regenerate on a re-run: settings the backend encrypted
# with ENCRYPTION_SECRET would become unreadable.
existing_secret() {
  [ -f "${REPO_ROOT}/backend/.env" ] || return 0
  sed -n "s/^$1=//p" "${REPO_ROOT}/backend/.env" | tail -n1
}
SESSION_SECRET="${SESSION_SECRET:-$(existing_secret SESSION_SECRET)}"
ENCRYPTION_SECRET="${ENCRYPTION_SECRET:-$(existing_secret ENCRYPTION_SECRET)}"
CLI_AUTH_SECRET="${CLI_AUTH_SECRET:-$(existing_secret CLI_AUTH_SECRET)}"
SESSION_SECRET="${SESSION_SECRET:-$(gen_secret)}"
ENCRYPTION_SECRET="${ENCRYPTION_SECRET:-$(gen_secret)}"
CLI_AUTH_SECRET="${CLI_AUTH_SECRET:-$(gen_secret)}"

# Compose names containers and volumes <project>_<name>, and left alone takes
# the project from the checkout's directory name, so a dev clone and
# /opt/projectachilles would share one project and its volumes. The root .env
# pins it: achilles-server on a fresh install, the directory name (what
# compose used) on an install from before this setting, so its volumes stay.
PREV_PROJECT=""
if [ -f "${REPO_ROOT}/.env" ]; then
  PREV_PROJECT="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "${REPO_ROOT}/.env" | tail -n1)"
  if [ -z "$PREV_PROJECT" ] && grep -q '^# Generated by deploy-server.sh' "${REPO_ROOT}/.env"; then
    PREV_PROJECT="$(basename "$REPO_ROOT" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-' | sed 's/^[-_]*//')"
  fi
fi
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-${PREV_PROJECT:-achilles-server}}"
[[ "$COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] \
  || die "COMPOSE_PROJECT_NAME '${COMPOSE_PROJECT_NAME}' must be lowercase letters, digits, '-' or '_', starting with a letter or digit."
if [ -n "$PREV_PROJECT" ] && [ "$COMPOSE_PROJECT_NAME" != "$PREV_PROJECT" ]; then
  die "COMPOSE_PROJECT_NAME is '${COMPOSE_PROJECT_NAME}' but this install runs as '${PREV_PROJECT}' (its data is in the ${PREV_PROJECT}_* volumes). Remove COMPOSE_PROJECT_NAME from ${CONFIG_FILE} to keep using them."
fi
c_ok "Settings validated — domain=${ACHILLES_DOMAIN}, TLS=${TLS_MODE}, ES=${ES_MODE}"
ok validate

# ---------------------------------------------------------------------------
# 3. Install Docker if needed
# ---------------------------------------------------------------------------
if [ "$RENDER_ONLY" = 0 ]; then
  phase docker "Checking Docker"
  if ! command -v docker >/dev/null 2>&1; then
    warn "Docker not found — installing via get.docker.com"
    curl -fsSL https://get.docker.com | $SUDO sh
    c_ok "Docker installed"
  else
    c_ok "Docker present ($(docker --version))"
  fi
  if ! docker compose version >/dev/null 2>&1; then
    die "Docker Compose v2 plugin not available. Install 'docker-compose-plugin' and re-run."
  fi
  DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="$SUDO docker"
  # Never take over another checkout's stack: `up` would recreate its
  # containers from this compose file and mount its volumes.
  OTHER_DIR="$($DOCKER ps -a --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" \
    --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null \
    | grep -vxF -e "$REPO_ROOT" -e '' | head -n1 || true)"
  if [ -n "$OTHER_DIR" ]; then
    die "Compose project '${COMPOSE_PROJECT_NAME}' already belongs to ${OTHER_DIR}. Set COMPOSE_PROJECT_NAME to another name in ${CONFIG_FILE}, or run the installer from that directory."
  fi
  ok docker
fi

# ---------------------------------------------------------------------------
# 4. ProjectAchilles CA (achilles-ca only)
# ---------------------------------------------------------------------------
if [ "$TLS_MODE" = "achilles-ca" ]; then
  phase ca "Preparing the ProjectAchilles CA"
  if [ ! -f "$ACHILLES_INSTALLER_BIN" ] || [ ! -x "$ACHILLES_INSTALLER_BIN" ]; then
    fail ca "achilles-installer binary not found or not executable at ${ACHILLES_INSTALLER_BIN}; set ACHILLES_INSTALLER_BIN to its path."
  fi
  inter_before="$(ca_intermediate_sum)"
  ca_args=(ca init --dir "$CA_DIR" --zone "$CA_ZONE" --ip "$BIND_IP_BARE")
  if [ "$CA_INCLUDE_IP" = true ]; then ca_args+=(--include-ip); fi
  # CA_ROTATE replaces only a root whose constraints differ, so re-runs with
  # the flag still set keep the root they rotated to.
  if [ "$CA_ROTATE" = true ]; then ca_args+=(--rotate --if-changed); fi
  ca_args+=(--label "${ORGANIZATION_NAME:-$ACHILLES_DOMAIN}")
  installer "${ca_args[@]}" || fail ca "achilles-installer ca init failed (see the output above)."
  [ "$(ca_intermediate_sum)" = "$inter_before" ] || CA_CHANGED=1
  c_ok "CA ready in ${CA_DIR}"
  ok ca
fi

# ---------------------------------------------------------------------------
# 5. Render Caddy snippets into deploy/caddy/rendered/ (gitignored)
# ---------------------------------------------------------------------------
phase caddy-render "Configuring Caddy TLS (${TLS_MODE})"
GLOBAL_SRC="${CADDY_DIR}/global.caddy"
SITES_SRC="${CADDY_DIR}/sites-extra.caddy"
if [ "$TLS_MODE" = "achilles-ca" ]; then
  GLOBAL_SRC="${CADDY_DIR}/extras/achilles-ca.global.caddy"
  SITES_SRC="${CADDY_DIR}/extras/achilles-ca.sites.caddy"
fi
# Created here so Docker never creates it (root-owned and empty: Caddy would
# fail on the missing imports).
mkdir -p "$RENDERED_DIR"
cp "${CADDY_DIR}/tls-modes/${TLS_MODE}.caddy" "${RENDERED_DIR}/tls.caddy"
cp "$GLOBAL_SRC" "${RENDERED_DIR}/global.caddy"
cp "$SITES_SRC" "${RENDERED_DIR}/sites-extra.caddy"
c_ok "Wrote ${RENDERED_DIR}/{tls,global,sites-extra}.caddy"
ok caddy-render

# ---------------------------------------------------------------------------
# 6. Write backend/.env (single source of truth for app config)
# ---------------------------------------------------------------------------
phase backend-env "Writing backend/.env"
{
  echo "# Generated by deploy-server.sh on $(date -u +%FT%TZ) — do not commit."
  echo "NODE_ENV=production"
  echo "PORT=3000"
  echo "CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY}"
  echo "CLERK_SECRET_KEY=${CLERK_SECRET_KEY}"
  echo "SESSION_SECRET=${SESSION_SECRET}"
  echo "ENCRYPTION_SECRET=${ENCRYPTION_SECRET}"
  echo "CLI_AUTH_SECRET=${CLI_AUTH_SECRET}"
  echo "CORS_ORIGIN=${PUBLIC_URL}"
  echo "AGENT_SERVER_URL=${PUBLIC_URL}"
  [ -n "${ORGANIZATION_NAME:-}" ] && echo "ORGANIZATION_NAME=${ORGANIZATION_NAME}"
  if [ "$ES_MODE" = "self" ]; then
    echo "ELASTICSEARCH_NODE=http://elasticsearch:9200"
  else
    echo "ELASTICSEARCH_CLOUD_ID=${ELASTICSEARCH_CLOUD_ID}"
    echo "ELASTICSEARCH_API_KEY=${ELASTICSEARCH_API_KEY}"
  fi
  echo "ELASTICSEARCH_INDEX_PATTERN=${ELASTICSEARCH_INDEX_PATTERN}"
  [ -n "${TESTS_REPO_URL:-}" ]  && echo "TESTS_REPO_URL=${TESTS_REPO_URL}"
  [ -n "${TESTS_REPO_URL:-}" ]  && echo "TESTS_REPO_BRANCH=${TESTS_REPO_BRANCH}"
  [ -n "${AGENT_REPO_URL:-}" ]  && echo "AGENT_REPO_URL=${AGENT_REPO_URL}"
  [ -n "${AGENT_REPO_URL:-}" ]  && echo "AGENT_REPO_BRANCH=${AGENT_REPO_BRANCH}"
  [ -n "${GITHUB_TOKEN:-}" ]    && echo "GITHUB_TOKEN=${GITHUB_TOKEN}"
} > "${REPO_ROOT}/backend/.env"
chmod 600 "${REPO_ROOT}/backend/.env"
c_ok "Wrote backend/.env (mode 600)"
ok backend-env

# ---------------------------------------------------------------------------
# 7. Write root .env (compose interpolation)
# ---------------------------------------------------------------------------
phase root-env "Writing root .env"
COMPOSE_PROFILES=""
[ "$ES_MODE" = "self" ] && COMPOSE_PROFILES="elasticsearch"
{
  echo "# Generated by deploy-server.sh on $(date -u +%FT%TZ) — do not commit."
  echo "ACHILLES_DOMAIN=${ACHILLES_DOMAIN}"
  echo "ACME_EMAIL=${ACME_EMAIL:-}"
  echo "CADDY_IMAGE=${CADDY_IMAGE}"
  echo "CADDY_DNS_PROVIDER=${CADDY_DNS_PROVIDER:-}"
  echo "CADDY_DNS_TOKEN=${CADDY_DNS_TOKEN:-}"
  echo "CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY}"
  echo "VITE_CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY}"
  echo "SEED_ES=${SEED_ES}"
  echo "COMPOSE_PROFILES=${COMPOSE_PROFILES}"
  # Empty unless set: compose then publishes on every IPv4 and IPv6 address.
  echo "CADDY_BIND_IP=${CADDY_BIND_IP_ENV}"
  echo "COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}"
  # Only achilles-ca mounts a CA; other modes fall back to deploy/caddy/no-ca.
  if [ "$TLS_MODE" = "achilles-ca" ]; then
    echo "ACHILLES_CA_DIR=${CA_DIR}"
  fi
} > "${REPO_ROOT}/.env"
chmod 600 "${REPO_ROOT}/.env"
c_ok "Wrote .env (mode 600)"
ok root-env

# ---------------------------------------------------------------------------
# 7b. Host firewall (LAN installs only)
# ---------------------------------------------------------------------------
# Opens 80/tcp, 443/tcp and 443/udp to each LAN subnet on a host whose firewall
# is ALREADY active. Never enables a firewall and never touches port 22.
FW_PORTS=("80 tcp" "443 tcp" "443 udp")

# Every firewall-tool call runs as `as_root env LC_ALL=C ...` (env after sudo,
# so it survives) because we parse English output ("Status: active", ALLOW).
fw_ufw()  { as_root env LC_ALL=C ufw "$@"; }
fw_fcmd() { as_root env LC_ALL=C firewall-cmd "$@"; }

# Root's PATH has /usr/sbin; the invoking user's may not (Debian).
# shellcheck disable=SC2016  # $1 is expanded by the inner sh, on purpose
root_has() { as_root sh -c 'command -v "$1" >/dev/null 2>&1' _ "$1"; }

# ufw_ipv6_enabled: /etc/default/ufw IPV6=no means ufw rejects IPv6 rules.
UFW_DEFAULTS="${ACHILLES_UFW_DEFAULTS_OVERRIDE:-/etc/default/ufw}"
ufw_ipv6_enabled() {
  local v
  v="$(as_root cat "$UFW_DEFAULTS" 2>/dev/null | sed -n 's/^IPV6=//p' | tail -n1 | tr -d '"[:space:]')" || true
  [ "${v,,}" != "no" ]
}

# Returns 0 when `ufw status` already lists ALLOW for $1/$2 from $3. IPv6 rules
# print as `80/tcp (v6)   ALLOW   2001:db8::/32`, so match fields, not columns.
ufw_has_rule() {
  fw_ufw status 2>/dev/null | awk -v want="$1/$2" -v cidr="$3" '
    $1 == want { a = 0; c = 0
      for (i = 2; i <= NF; i++) { if ($i == "ALLOW") a = 1; if ($i == cidr) c = 1 }
      if (a && c) found = 1 }
    END { exit !found }'
}

firewall_ufw() {
  local cidr entry port proto v6_ok=1
  ufw_ipv6_enabled || v6_ok=0
  for cidr in "${LAN_CIDRS[@]}"; do
    if [[ "$cidr" == *:* ]] && [ "$v6_ok" = 0 ]; then
      warn "ufw has IPV6=no; skipping IPv6 subnet ${cidr}"
      continue
    fi
    for entry in "${FW_PORTS[@]}"; do
      read -r port proto <<< "$entry"
      if ufw_has_rule "$port" "$proto" "$cidr"; then
        c_ok "ufw: ${port}/${proto} from ${cidr} already allowed"
      else
        fw_ufw allow from "$cidr" to any port "$port" proto "$proto" comment projectachilles >/dev/null \
          || fail firewall "ufw allow ${port}/${proto} from ${cidr} failed"
        c_ok "ufw: allowed ${port}/${proto} from ${cidr}"
      fi
    done
  done
}

firewall_firewalld() {
  local cidr entry port proto family rule added=0
  for cidr in "${LAN_CIDRS[@]}"; do
    family=ipv4; [[ "$cidr" == *:* ]] && family=ipv6
    for entry in "${FW_PORTS[@]}"; do
      read -r port proto <<< "$entry"
      rule="rule family=\"${family}\" source address=\"${cidr}\" port port=\"${port}\" protocol=\"${proto}\" accept"
      if fw_fcmd --permanent "--query-rich-rule=${rule}" >/dev/null 2>&1; then
        c_ok "firewalld: ${port}/${proto} from ${cidr} already allowed"
      else
        fw_fcmd --permanent "--add-rich-rule=${rule}" >/dev/null \
          || fail firewall "firewall-cmd add rule ${port}/${proto} from ${cidr} failed"
        added=1
        c_ok "firewalld: allowed ${port}/${proto} from ${cidr}"
      fi
    done
  done
  if [ "$added" = 1 ]; then
    fw_fcmd --reload >/dev/null || fail firewall "firewall-cmd --reload failed"
  fi
}

if [ "${#LAN_CIDRS[@]}" -gt 0 ] && { [ "$RENDER_ONLY" = 0 ] || [ "${ACHILLES_FIREWALL_TEST:-}" = 1 ]; }; then
  phase firewall "Opening 80/443 to the LAN subnets"
  ufw_active=0; firewalld_active=0
  if root_has ufw && [ "$(fw_ufw status 2>/dev/null | head -n1)" = "Status: active" ]; then
    ufw_active=1
  fi
  if root_has firewall-cmd && [ "$(fw_fcmd --state 2>/dev/null || true)" = "running" ]; then
    firewalld_active=1
  fi
  if [ "$ufw_active" = 1 ]; then
    [ "$firewalld_active" = 0 ] || warn "firewalld is also active; only ufw rules were added"
    firewall_ufw
  elif [ "$firewalld_active" = 1 ]; then
    firewall_firewalld
  else
    warn "No active host firewall — ports are reachable from any network that can route to ${CADDY_BIND_IP:-this host}"
  fi
  ok firewall
fi

# ---------------------------------------------------------------------------
# 8. Bring the stack up
# ---------------------------------------------------------------------------
# prebuilt_images_current: succeeds when the backend and frontend images were
# built from the checked-out commit (their io.projectachilles.commit label,
# set by docker-compose.server.yml) and nothing under backend/ or frontend/
# differs from it, so `up` can skip the rebuild. The appliance ships them
# pre-built; a re-run on any server benefits too.
prebuilt_images_current() {
  [ "$FORCE_BUILD" = 0 ] && [ -n "$ACHILLES_GIT_COMMIT" ] || return 1
  local dirty svc label
  dirty="$(git -C "$REPO_ROOT" status --porcelain -- backend frontend 2>/dev/null)" || return 1
  [ -z "$dirty" ] || return 1
  for svc in backend frontend; do
    label="$($DOCKER image inspect --format '{{ index .Config.Labels "io.projectachilles.commit" }}' \
      "${COMPOSE_PROJECT_NAME}-${svc}" 2>/dev/null)" || return 1
    [ "$label" = "$ACHILLES_GIT_COMMIT" ] || return 1
  done
}

if [ "$RENDER_ONLY" = 0 ]; then
  phase up "Building and starting the stack (this can take several minutes)"
  # Compose stamps the images with it (label, and the backend's GIT_COMMIT
  # build arg that /api/health reports). Empty outside a git checkout.
  ACHILLES_GIT_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
  export ACHILLES_GIT_COMMIT
  if [ "$TLS_MODE" = "acme-dns" ]; then
    c_info "Building custom Caddy image with DNS plugin (${CADDY_DNS_MODULE})"
    $DOCKER build -t "$CADDY_IMAGE" \
      --build-arg "CADDY_DNS_MODULE=${CADDY_DNS_MODULE}" \
      "${CADDY_DIR}"
    c_ok "Built ${CADDY_IMAGE}"
  fi
  if prebuilt_images_current; then
    c_ok "Using the pre-built images for ${ACHILLES_GIT_COMMIT:0:12}"
    ( cd "$REPO_ROOT" && $DOCKER compose -f "$COMPOSE_FILE" up -d )
  else
    ( cd "$REPO_ROOT" && $DOCKER compose -f "$COMPOSE_FILE" up -d --build )
  fi
  c_ok "Containers started"
  # `up` leaves a running Caddy alone when only the bind-mounted CA files
  # changed (rotation, `ca init --rotate`, `ca renew`), and Caddy reads them
  # only at start. Restart it, with its cached leaves deleted, when the
  # intermediate is newer than the container: the timer's own check
  # (ca-renew.sh), so a re-run with nothing changed restarts nothing. When
  # this run's `ca` phase changed the intermediate (a rotation, or a CA created
  # for an install that ran another TLS mode), always do it (--force): `up`
  # may have recreated Caddy, so its start time is fresh, but the caddy-data
  # volume still caches leaves from the previous CA.
  if [ "$TLS_MODE" = "achilles-ca" ]; then
    caddy_ca_check=(env "ACHILLES_CA_DIR=${CA_DIR}" "ACHILLES_REPO_ROOT=${REPO_ROOT}"
      /bin/sh "${SCRIPT_DIR}/ca-renew.sh" --restart-only)
    [ "$CA_CHANGED" = 0 ] || caddy_ca_check+=(--force)
    ca_as_root "${caddy_ca_check[@]}" || fail up "could not restart Caddy onto the current CA (see the output above)."
  fi
  ok up
fi

# ---------------------------------------------------------------------------
# 9. Post-install: export internal root CA when relevant
# ---------------------------------------------------------------------------
if [ "$RENDER_ONLY" = 0 ] && [ "$TLS_MODE" = "internal" ]; then
  phase ca-export "Exporting Caddy internal root CA for agents/browsers"
  ROOT_CA_SRC="/data/caddy/pki/authorities/local/root.crt"
  ROOT_CA_DST="${CADDY_DIR}/certs/root-ca.crt"
  for _ in $(seq 1 15); do
    if $DOCKER compose -f "$COMPOSE_FILE" exec -T caddy test -f "$ROOT_CA_SRC" 2>/dev/null; then
      $DOCKER compose -f "$COMPOSE_FILE" exec -T caddy cat "$ROOT_CA_SRC" > "$ROOT_CA_DST"
      c_ok "Root CA written to ${ROOT_CA_DST}"
      break
    fi
    sleep 2
  done
  [ -s "$ROOT_CA_DST" ] || warn "Root CA not exported yet — re-run after Caddy finishes starting: docker compose -f $COMPOSE_FILE exec caddy cat $ROOT_CA_SRC"
  ok ca-export
fi

# ---------------------------------------------------------------------------
# 10. Endpoint bootstrap scripts, root fingerprint pinned (achilles-ca only)
# ---------------------------------------------------------------------------
if [ "$TLS_MODE" = "achilles-ca" ]; then
  phase bootstrap "Rendering endpoint bootstrap scripts"
  installer ca bootstrap --dir "$CA_DIR" --host "$ACHILLES_DOMAIN" --out "$ONPREM_DIR" \
    || fail bootstrap "achilles-installer ca bootstrap failed (see the output above)."
  ok bootstrap
fi

# ---------------------------------------------------------------------------
# 11. Weekly intermediate-CA renewal timer (achilles-ca only)
# ---------------------------------------------------------------------------
# scripts/ca-renew.sh renews when < 180 days remain, and restarts Caddy (which
# reads the CA files only at start) whenever the intermediate is newer than the
# running container. The service runs as root, so it runs
# root-owned copies of ca-renew.sh and achilles-installer in LIB_DIR: the repo
# copies may be writable by the (non-root) install user, and running them
# would hand that user root. Copies and units are rewritten only when their
# content changes, so a re-run does not reload systemd.
if [ "$RENDER_ONLY" = 0 ] && [ "$TLS_MODE" = "achilles-ca" ]; then
  phase renew-timer "Installing the weekly CA renewal timer"
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemctl not found: no renewal timer installed. Run ${SCRIPT_DIR}/ca-renew.sh weekly yourself."
  else
    # Always (re)asserted: root:root 0755 even if the directory already exists.
    as_root install -d -o root -g root -m 0755 "$LIB_DIR" \
      || fail renew-timer "could not create ${LIB_DIR}"
    install_root_copy "$ACHILLES_INSTALLER_BIN" "${LIB_DIR}/achilles-installer"
    install_root_copy "${SCRIPT_DIR}/ca-renew.sh" "${LIB_DIR}/ca-renew.sh"
    unit_tmp="$(mktemp -d)"
    cat > "${unit_tmp}/${RENEW_UNIT}.service" <<EOF
# Installed by ProjectAchilles scripts/deploy-server.sh; re-running it rewrites this file.
[Unit]
Description=Renew the ProjectAchilles intermediate CA when it nears expiry
Wants=docker.service
After=docker.service

[Service]
Type=oneshot
Environment="ACHILLES_INSTALLER_BIN=${LIB_DIR}/achilles-installer"
Environment="ACHILLES_CA_DIR=${CA_DIR}"
Environment="ACHILLES_REPO_ROOT=${REPO_ROOT}"
ExecStart=/bin/sh "${LIB_DIR}/ca-renew.sh"
EOF
    cat > "${unit_tmp}/${RENEW_UNIT}.timer" <<EOF
# Installed by ProjectAchilles scripts/deploy-server.sh; re-running it rewrites this file.
[Unit]
Description=Weekly ProjectAchilles intermediate CA renewal check

[Timer]
OnCalendar=weekly
Persistent=true

[Install]
WantedBy=timers.target
EOF
    units_changed=0
    for f in "${RENEW_UNIT}.service" "${RENEW_UNIT}.timer"; do
      if ! cmp -s "${unit_tmp}/${f}" "${SYSTEMD_DIR}/${f}"; then
        as_root install -m 0644 "${unit_tmp}/${f}" "${SYSTEMD_DIR}/${f}" \
          || fail renew-timer "could not install ${SYSTEMD_DIR}/${f}"
        units_changed=1
      fi
    done
    rm -rf "$unit_tmp"
    if [ "$units_changed" = 1 ]; then
      as_root systemctl daemon-reload || fail renew-timer "systemctl daemon-reload failed"
    fi
    if ! systemctl is-enabled --quiet "${RENEW_UNIT}.timer" || ! systemctl is-active --quiet "${RENEW_UNIT}.timer"; then
      as_root systemctl enable --now "${RENEW_UNIT}.timer" \
        || fail renew-timer "could not enable ${RENEW_UNIT}.timer"
    elif [ "$units_changed" = 1 ]; then
      as_root systemctl restart "${RENEW_UNIT}.timer" \
        || fail renew-timer "could not restart ${RENEW_UNIT}.timer"
    fi
    c_ok "${RENEW_UNIT}.timer active (weekly)"
  fi
  ok renew-timer
fi

if [ "$RENDER_ONLY" = 1 ]; then
  echo
  c_ok "Render-only run complete: config files written; Docker was not touched."
  exit 0
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo
c_ok "ProjectAchilles is deploying at ${PUBLIC_URL}"
echo
echo "Next steps:"
if [ "$TLS_MODE" = "achilles-ca" ]; then
  echo "  • DNS: ensure ${ACHILLES_DOMAIN} resolves to ${BIND_IP_BARE} for every endpoint."
else
  echo "  • DNS: ensure an A record points ${ACHILLES_DOMAIN} at this server's IP."
fi
case "$TLS_MODE" in
  acme-http) echo "  • TLS: Caddy will fetch a Let's Encrypt cert once DNS + ports 80/443 are reachable." ;;
  acme-dns)  echo "  • TLS: Caddy will fetch a Let's Encrypt cert via DNS-01 (no inbound 80/443 needed)." ;;
  internal)  echo "  • TLS: self-signed. Install deploy/caddy/certs/root-ca.crt in browsers, and in each"
             echo "         endpoint's OS trust store (Windows: LocalMachine\\Root) BEFORE running the"
             echo "         agent with --enroll: enrollment trusts only the OS trust store." ;;
  byo)       echo "  • TLS: using your cert at deploy/caddy/certs/. Ensure clients trust its issuing CA." ;;
  achilles-ca)
             echo "  • TLS: ProjectAchilles CA for ${CA_ZONE}. Endpoints must trust its root BEFORE --enroll:"
             echo "         run ${ONPREM_DIR}/bootstrap-windows.ps1 (or: sudo bash bootstrap-unix.sh <TOKEN>) on each endpoint."
             echo "         It fetches http://${ACHILLES_DOMAIN}/ca/root.cer and checks the pinned fingerprint."
             echo "         Fleets: distribute ${CA_DIR}/public/root.cer by GPO (trust only, no tokens)." ;;
esac
echo "  • Logs:    docker compose -f docker-compose.server.yml logs -f"
echo "  • Status:  docker compose -f docker-compose.server.yml ps"
if [ "$TLS_MODE" = "achilles-ca" ]; then
  # The CA dir is root-only (0700), so reading the root needs sudo.
  echo "  • Health:  sudo curl -s --cacert ${CA_DIR}/public/root.crt ${PUBLIC_URL}/api/health"
else
  echo "  • Health:  curl -sk ${PUBLIC_URL}/api/health"
fi
