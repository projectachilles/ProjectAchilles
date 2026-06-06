#!/usr/bin/env bash
# =============================================================================
# ProjectAchilles — DigitalOcean droplet bootstrap
# =============================================================================
# Thin wrapper that creates a DigitalOcean droplet (+ firewall, optionally a DNS
# A record) with doctl, then hands off to deploy-remote.sh to install the stack.
#
#   ./scripts/deploy-do.sh [path/to/deploy.config.env]
#
# Requires: doctl (https://docs.digitalocean.com/reference/doctl/) authenticated,
# or DO_API_TOKEN set in the config. An SSH key fingerprint registered in your
# DO account (DO_SSH_KEY_FINGERPRINT) is required so the script can log in.
#
# This is OPTIONAL convenience. For any other cloud or an existing server, use
# scripts/deploy-remote.sh directly.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${1:-${REPO_ROOT}/deploy.config.env}"

c_info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
c_ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
c_warn() { printf '\033[1;33m  !\033[0m %s\n' "$*"; }
die()    { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$CONFIG_FILE" ] || die "Config file not found: ${CONFIG_FILE}"
set -a
# shellcheck disable=SC1090
. "$CONFIG_FILE"
set +a

command -v doctl >/dev/null 2>&1 || die "doctl not installed — https://docs.digitalocean.com/reference/doctl/how-to/install/"

# Auth: prefer an explicit token from config, else assume doctl is already authed.
if [ -n "${DO_API_TOKEN:-}" ]; then
  export DIGITALOCEAN_ACCESS_TOKEN="$DO_API_TOKEN"
fi
doctl account get >/dev/null 2>&1 || die "doctl is not authenticated (set DO_API_TOKEN or run 'doctl auth init')"

DO_REGION="${DO_REGION:-nyc3}"
DO_SIZE="${DO_SIZE:-s-2vcpu-4gb}"
DO_IMAGE="${DO_IMAGE:-ubuntu-24-04-x64}"
DO_DROPLET_NAME="${DO_DROPLET_NAME:-achilles}"
DO_MANAGE_DNS="${DO_MANAGE_DNS:-false}"
[ -n "${DO_SSH_KEY_FINGERPRINT:-}" ] || die "DO_SSH_KEY_FINGERPRINT is required (doctl compute ssh-key list)"
[ -n "${ACHILLES_DOMAIN:-}" ] || die "ACHILLES_DOMAIN is required"

# ---------------------------------------------------------------------------
# Create (or reuse) the droplet
# ---------------------------------------------------------------------------
if doctl compute droplet get "$DO_DROPLET_NAME" >/dev/null 2>&1; then
  c_warn "Droplet '${DO_DROPLET_NAME}' already exists — reusing it"
else
  c_info "Creating droplet '${DO_DROPLET_NAME}' (${DO_SIZE}, ${DO_REGION}, ${DO_IMAGE})"
  doctl compute droplet create "$DO_DROPLET_NAME" \
    --region "$DO_REGION" \
    --size "$DO_SIZE" \
    --image "$DO_IMAGE" \
    --ssh-keys "$DO_SSH_KEY_FINGERPRINT" \
    --wait
  c_ok "Droplet created"
fi

DROPLET_IP="$(doctl compute droplet get "$DO_DROPLET_NAME" --format PublicIPv4 --no-header)"
[ -n "$DROPLET_IP" ] || die "Could not resolve droplet public IP"
c_ok "Droplet IP: ${DROPLET_IP}"

# ---------------------------------------------------------------------------
# Firewall — allow SSH + HTTP/HTTPS only
# ---------------------------------------------------------------------------
FW_NAME="${DO_DROPLET_NAME}-fw"
if ! doctl compute firewall list --format Name --no-header | grep -qx "$FW_NAME"; then
  c_info "Creating firewall '${FW_NAME}' (22, 80, 443)"
  DROPLET_ID="$(doctl compute droplet get "$DO_DROPLET_NAME" --format ID --no-header)"
  doctl compute firewall create \
    --name "$FW_NAME" \
    --droplet-ids "$DROPLET_ID" \
    --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:80,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:443,address:0.0.0.0/0,address:::/0 protocol:udp,ports:443,address:0.0.0.0/0,address:::/0" \
    --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0 protocol:udp,ports:all,address:0.0.0.0/0,address:::/0 protocol:icmp,address:0.0.0.0/0,address:::/0"
  c_ok "Firewall applied"
else
  c_warn "Firewall '${FW_NAME}' already exists — leaving as is"
fi

# ---------------------------------------------------------------------------
# Optional DNS A record (only if your domain is hosted on DigitalOcean)
# ---------------------------------------------------------------------------
if [ "$DO_MANAGE_DNS" = "true" ]; then
  # Split apex domain from record name: app.example.com -> name=app, zone=example.com
  ZONE="${ACHILLES_DOMAIN#*.}"
  RECORD="${ACHILLES_DOMAIN%%.*}"
  [ "$RECORD.$ZONE" = "$ACHILLES_DOMAIN" ] || { ZONE="$ACHILLES_DOMAIN"; RECORD="@"; }
  c_info "Ensuring DNS A record ${ACHILLES_DOMAIN} -> ${DROPLET_IP} (zone ${ZONE})"
  if doctl compute domain list --format Domain --no-header | grep -qx "$ZONE"; then
    EXISTING="$(doctl compute domain records list "$ZONE" --format ID,Type,Name --no-header | awk -v n="$RECORD" '$2=="A" && $3==n {print $1}')"
    if [ -n "$EXISTING" ]; then
      doctl compute domain records update "$ZONE" --record-id "$EXISTING" --record-data "$DROPLET_IP" --record-ttl 300 >/dev/null
    else
      doctl compute domain records create "$ZONE" --record-type A --record-name "$RECORD" --record-data "$DROPLET_IP" --record-ttl 300 >/dev/null
    fi
    c_ok "DNS record set"
  else
    c_warn "Domain '${ZONE}' is not managed in DigitalOcean DNS — create the A record at your DNS host manually"
  fi
else
  c_warn "DO_MANAGE_DNS=false — create an A record: ${ACHILLES_DOMAIN} -> ${DROPLET_IP}"
fi

# ---------------------------------------------------------------------------
# Hand off to the remote installer
# ---------------------------------------------------------------------------
c_info "Installing ProjectAchilles on the droplet"
# deploy-remote.sh derives SSH_USER/SSH_HOST from this user@host argument.
"${SCRIPT_DIR}/deploy-remote.sh" "${SSH_USER:-root}@${DROPLET_IP}" "$CONFIG_FILE"

c_ok "Done. Visit https://${ACHILLES_DOMAIN} once DNS has propagated."
