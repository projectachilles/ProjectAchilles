#!/usr/bin/env bash
# =============================================================================
# ProjectAchilles — remote installer over SSH
# =============================================================================
# Copies this repo to a remote host and runs deploy-server.sh there. This is
# the entry point for an ON-PREM server you provide via SSH.
#
#   ./scripts/deploy-remote.sh [user@host] [path/to/deploy.config.env]
#
# If user@host is omitted, SSH_USER/SSH_HOST/SSH_PORT from the config file are
# used. The config file (which holds your secrets) is copied to the remote and
# consumed by deploy-server.sh, then the stack is built and started remotely.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

c_info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
c_ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
die()    { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

TARGET="${1:-}"
CONFIG_FILE="${2:-${REPO_ROOT}/deploy.config.env}"

[ -f "$CONFIG_FILE" ] || die "Config file not found: ${CONFIG_FILE} (copy deploy.config.env.example)"
set -a
# shellcheck disable=SC1090
. "$CONFIG_FILE"
set +a

SSH_PORT="${SSH_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/opt/projectachilles}"

if [ -n "$TARGET" ]; then
  SSH_USER="${TARGET%@*}"
  SSH_HOST="${TARGET#*@}"
fi
SSH_USER="${SSH_USER:-root}"
[ -n "${SSH_HOST:-}" ] || die "No SSH host. Pass user@host or set SSH_HOST in ${CONFIG_FILE}."

SSH_DEST="${SSH_USER}@${SSH_HOST}"
SSH_OPTS=(-p "$SSH_PORT" -o StrictHostKeyChecking=accept-new)

c_info "Target: ${SSH_DEST}:${REMOTE_DIR} (port ${SSH_PORT})"

# Wait for SSH to come up (useful right after droplet creation).
c_info "Waiting for SSH"
for _ in $(seq 1 30); do
  if ssh "${SSH_OPTS[@]}" -o ConnectTimeout=5 "$SSH_DEST" true 2>/dev/null; then
    c_ok "SSH reachable"; break
  fi
  sleep 5
done
ssh "${SSH_OPTS[@]}" -o ConnectTimeout=5 "$SSH_DEST" true 2>/dev/null || die "Cannot SSH to ${SSH_DEST}"

# Ensure rsync exists remotely (fresh Ubuntu images sometimes lack it).
ssh "${SSH_OPTS[@]}" "$SSH_DEST" 'command -v rsync >/dev/null 2>&1 || (sudo apt-get update -qq && sudo apt-get install -y -qq rsync)' || true

c_info "Syncing repository to remote"
ssh "${SSH_OPTS[@]}" "$SSH_DEST" "mkdir -p '${REMOTE_DIR}'"
rsync -az --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'build' \
  --exclude 'frontend/node_modules' \
  --exclude 'backend/node_modules' \
  --exclude 'backend-serverless/node_modules' \
  --exclude '*.log' \
  --exclude '.env' \
  --exclude 'backend/.env' \
  "${REPO_ROOT}/" "${SSH_DEST}:${REMOTE_DIR}/"

# Send the config (with secrets) separately so --delete/.env excludes don't drop it.
c_info "Copying deploy config"
scp -P "$SSH_PORT" -o StrictHostKeyChecking=accept-new \
  "$CONFIG_FILE" "${SSH_DEST}:${REMOTE_DIR}/deploy.config.env"
ssh "${SSH_OPTS[@]}" "$SSH_DEST" "chmod 600 '${REMOTE_DIR}/deploy.config.env'"
c_ok "Repository and config in place"

c_info "Running installer on remote (streaming output)"
ssh "${SSH_OPTS[@]}" -t "$SSH_DEST" \
  "cd '${REMOTE_DIR}' && chmod +x scripts/deploy-server.sh && ./scripts/deploy-server.sh '${REMOTE_DIR}/deploy.config.env'"

c_ok "Remote deployment finished — https://${ACHILLES_DOMAIN}"
