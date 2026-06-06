#!/usr/bin/env bash
# =============================================================================
# ProjectAchilles — on-box server installer
# =============================================================================
# Installs ProjectAchilles as a publicly-reachable OR on-prem service behind a
# Caddy reverse proxy with working TLS. Run this ON the target server.
#
#   ./scripts/deploy-server.sh [path/to/deploy.config.env]
#
# Hybrid: reads deploy.config.env (default: repo-root/deploy.config.env) and
# prompts for any required value left blank — when running interactively. In a
# non-interactive shell (no TTY), missing required values are a hard error so
# agent-driven runs fail loudly instead of hanging.
#
# Idempotent: safe to re-run to apply config changes or upgrade.
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${1:-${REPO_ROOT}/deploy.config.env}"
CADDY_DIR="${REPO_ROOT}/deploy/caddy"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.server.yml"

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
c_info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
c_ok()    { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
c_warn()  { printf '\033[1;33m  !\033[0m %s\n' "$*"; }
c_err()   { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; }
die()     { c_err "$*"; exit 1; }

is_tty()  { [ -t 0 ] && [ -t 1 ]; }
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"

gen_secret() { openssl rand -base64 32; }

# Prompt for a value when missing (interactive only). $1=var name, $2=prompt,
# $3=secret(yes/no). Errors out in non-interactive shells.
prompt_var() {
  local var="$1" msg="$2" secret="${3:-no}" cur
  cur="${!var:-}"
  [ -n "$cur" ] && return 0
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

# ---------------------------------------------------------------------------
# 1. Load config
# ---------------------------------------------------------------------------
c_info "Loading configuration"
if [ -f "$CONFIG_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a
  c_ok "Loaded ${CONFIG_FILE}"
else
  c_warn "No config file at ${CONFIG_FILE} — will prompt for required values"
  is_tty || die "No config file and no TTY. Copy deploy.config.env.example to ${CONFIG_FILE} and fill it in."
fi

# Defaults
TLS_MODE="${TLS_MODE:-acme-http}"
ES_MODE="${ES_MODE:-self}"
TESTS_REPO_BRANCH="${TESTS_REPO_BRANCH:-main}"
AGENT_REPO_BRANCH="${AGENT_REPO_BRANCH:-main}"
ELASTICSEARCH_INDEX_PATTERN="${ELASTICSEARCH_INDEX_PATTERN:-achilles-results-*}"
SEED_ES="${SEED_ES:-false}"

# ---------------------------------------------------------------------------
# 2. Collect + validate required values
# ---------------------------------------------------------------------------
c_info "Validating settings"
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
  *)
    die "Invalid TLS_MODE='${TLS_MODE}' (expected: acme-http | acme-dns | internal | byo)" ;;
esac

case "$ES_MODE" in
  self) : ;;
  cloud)
    prompt_var ELASTICSEARCH_CLOUD_ID "Elastic Cloud ID"
    prompt_var ELASTICSEARCH_API_KEY "Elastic Cloud API key" yes ;;
  *) die "Invalid ES_MODE='${ES_MODE}' (expected: self | cloud)" ;;
esac

PUBLIC_URL="https://${ACHILLES_DOMAIN}"

# Auto-generate any blank secrets
SESSION_SECRET="${SESSION_SECRET:-$(gen_secret)}"
ENCRYPTION_SECRET="${ENCRYPTION_SECRET:-$(gen_secret)}"
CLI_AUTH_SECRET="${CLI_AUTH_SECRET:-$(gen_secret)}"
c_ok "Settings validated — domain=${ACHILLES_DOMAIN}, TLS=${TLS_MODE}, ES=${ES_MODE}"

# ---------------------------------------------------------------------------
# 3. Install Docker if needed
# ---------------------------------------------------------------------------
c_info "Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  c_warn "Docker not found — installing via get.docker.com"
  curl -fsSL https://get.docker.com | $SUDO sh
  c_ok "Docker installed"
else
  c_ok "Docker present ($(docker --version))"
fi
if ! docker compose version >/dev/null 2>&1; then
  die "Docker Compose v2 plugin not available. Install 'docker-compose-plugin' and re-run."
fi
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="$SUDO docker"

# ---------------------------------------------------------------------------
# 4. Render Caddy TLS snippet
# ---------------------------------------------------------------------------
c_info "Configuring Caddy TLS (${TLS_MODE})"
cp "${CADDY_DIR}/tls-modes/${TLS_MODE}.caddy" "${CADDY_DIR}/tls.caddy"
c_ok "Wrote ${CADDY_DIR}/tls.caddy"

CADDY_IMAGE="caddy:2.10.0-alpine"
if [ "$TLS_MODE" = "acme-dns" ]; then
  c_info "Building custom Caddy image with DNS plugin (${CADDY_DNS_MODULE})"
  CADDY_IMAGE="projectachilles-caddy:dns-${CADDY_DNS_PROVIDER}"
  $DOCKER build -t "$CADDY_IMAGE" \
    --build-arg "CADDY_DNS_MODULE=${CADDY_DNS_MODULE}" \
    "${CADDY_DIR}"
  c_ok "Built ${CADDY_IMAGE}"
fi

# ---------------------------------------------------------------------------
# 5. Write backend/.env (single source of truth for app config)
# ---------------------------------------------------------------------------
c_info "Writing backend/.env"
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

# ---------------------------------------------------------------------------
# 6. Write root .env (compose interpolation)
# ---------------------------------------------------------------------------
c_info "Writing root .env"
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
} > "${REPO_ROOT}/.env"
chmod 600 "${REPO_ROOT}/.env"
c_ok "Wrote .env (mode 600)"

# ---------------------------------------------------------------------------
# 7. Bring the stack up
# ---------------------------------------------------------------------------
c_info "Building and starting the stack (this can take several minutes)"
( cd "$REPO_ROOT" && $DOCKER compose -f "$COMPOSE_FILE" up -d --build )
c_ok "Containers started"

# ---------------------------------------------------------------------------
# 8. Post-install: export internal root CA when relevant
# ---------------------------------------------------------------------------
if [ "$TLS_MODE" = "internal" ]; then
  c_info "Exporting Caddy internal root CA for agents/browsers"
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
  [ -s "$ROOT_CA_DST" ] || c_warn "Root CA not exported yet — re-run after Caddy finishes starting: docker compose -f $COMPOSE_FILE exec caddy cat $ROOT_CA_SRC"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo
c_ok "ProjectAchilles is deploying at ${PUBLIC_URL}"
echo
echo "Next steps:"
echo "  • DNS: ensure an A record points ${ACHILLES_DOMAIN} at this server's IP."
case "$TLS_MODE" in
  acme-http) echo "  • TLS: Caddy will fetch a Let's Encrypt cert once DNS + ports 80/443 are reachable." ;;
  acme-dns)  echo "  • TLS: Caddy will fetch a Let's Encrypt cert via DNS-01 (no inbound 80/443 needed)." ;;
  internal)  echo "  • TLS: self-signed. Install deploy/caddy/certs/root-ca.crt in browsers, and set the"
             echo "         agent's ca_cert to that file (or fetch via your config) to trust the server." ;;
  byo)       echo "  • TLS: using your cert at deploy/caddy/certs/. Ensure clients trust its issuing CA." ;;
esac
echo "  • Logs:    docker compose -f docker-compose.server.yml logs -f"
echo "  • Status:  docker compose -f docker-compose.server.yml ps"
echo "  • Health:  curl -sk ${PUBLIC_URL}/api/health"
