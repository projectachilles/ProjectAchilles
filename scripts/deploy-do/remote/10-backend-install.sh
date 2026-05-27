#!/usr/bin/env bash
# Installs Node 22, builds the frontend SPA, installs the backend, configures
# Caddy with auto-TLS, and starts the backend as a systemd unit.
#
# Pre-requisite: /home/achilles/ProjectAchilles/ has been rsync'd by the caller
# (rsync excludes node_modules/, dist/, .env). This script does `npm ci` here.
#
# Required env:
#   SPA_FQDN              (e.g. demo.acmecorp.com)
#   AGENT_FQDN            (e.g. agent.demo.acmecorp.com)
#   CORS_ORIGIN           (e.g. https://demo.acmecorp.com)
#   CLERK_PUBLISHABLE_KEY
#   CLERK_SECRET_KEY
#   ES_PRIVATE_IP
#   ES_API_KEY
#   ACME_EMAIL

set -euo pipefail
IFS=$'\n\t'

: "${SPA_FQDN:?}"; : "${AGENT_FQDN:?}"; : "${CORS_ORIGIN:?}"
: "${CLERK_PUBLISHABLE_KEY:?}"; : "${CLERK_SECRET_KEY:?}"
: "${ES_PRIVATE_IP:?}"; : "${ES_API_KEY:?}"
: "${ACME_EMAIL:?}"

log() { printf '[backend-install] %s\n' "$*" >&2; }

REPO=/home/achilles/ProjectAchilles
SECRETS_DIR=/etc/projectachilles
SECRETS_FILE="$SECRETS_DIR/secrets.env"
DATA_DIR=/home/achilles/.projectachilles

# ── Node 22 from NodeSource ─────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1 || ! node --version | grep -q '^v22\.'; then
    log "installing Node 22"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs build-essential
fi
log "node: $(node --version), npm: $(npm --version)"

# ── Build deps ──────────────────────────────────────────────────────────────
# osslsigncode: Authenticode signing for Windows .exe validators in test bundles
apt-get install -y -qq sqlite3 git ca-certificates osslsigncode

# ── Caddy from official repo ────────────────────────────────────────────────
if ! command -v caddy >/dev/null 2>&1; then
    log "installing Caddy"
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
    curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
fi
log "caddy: $(caddy version 2>/dev/null | head -1)"

# ── Ownership of rsynced repo ───────────────────────────────────────────────
chown -R achilles:achilles "$REPO"
mkdir -p "$DATA_DIR"
chown -R achilles:achilles "$DATA_DIR"

# Create the in-repo data/ dir for the git-sync test library. It's gitignored
# locally so rsync skips it; backend's syncService.ts calls fs.mkdir without
# recursive:true so the first Sync click fails with ENOENT until this exists.
mkdir -p "$REPO/data"
chown achilles:achilles "$REPO/data"

# Default useradd creates /home/achilles as mode 750 — caddy user can't traverse
# into it, so all SPA requests return 403. Open just the +x bit on the home dir.
chmod 755 /home/achilles

# ── Backend install + build ─────────────────────────────────────────────────
log "running npm ci in backend"
sudo -u achilles -H bash -c "cd $REPO/backend && npm ci --omit=dev=false"
log "building backend (tsc)"
sudo -u achilles -H bash -c "cd $REPO/backend && npm run build"

# ── Frontend .env (build-time) ──────────────────────────────────────────────
cat > "$REPO/frontend/.env" <<EOF
VITE_CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY}
VITE_API_URL=https://${AGENT_FQDN}
EOF
chown achilles:achilles "$REPO/frontend/.env"

log "running npm ci in frontend"
sudo -u achilles -H bash -c "cd $REPO/frontend && npm ci"
log "building frontend SPA (vite build)"
sudo -u achilles -H bash -c "cd $REPO/frontend && npm run build"

# Generate runtime env-config.js so SPA can read window.__env__ at runtime too.
clerk_json=$(printf '%s' "$CLERK_PUBLISHABLE_KEY" | jq -Rs .)
api_json=$(printf '%s' "https://$AGENT_FQDN" | jq -Rs .)
cat > "$REPO/frontend/dist/env-config.js" <<EOF
window.__env__ = {
  VITE_CLERK_PUBLISHABLE_KEY: ${clerk_json},
  VITE_API_URL: ${api_json}
};
EOF
chown achilles:achilles "$REPO/frontend/dist/env-config.js"

# ── Secrets file (mode 0600) ────────────────────────────────────────────────
mkdir -p "$SECRETS_DIR"
chmod 750 "$SECRETS_DIR"

# Generate per-tenant secrets if not yet present.
if [[ ! -f "$SECRETS_FILE" ]]; then
    SESSION_SECRET=$(openssl rand -base64 32)
    ENCRYPTION_SECRET=$(openssl rand -base64 32)
    CLI_AUTH_SECRET=$(openssl rand -base64 32)
    cat > "$SECRETS_FILE" <<EOF
SESSION_SECRET=${SESSION_SECRET}
ENCRYPTION_SECRET=${ENCRYPTION_SECRET}
CLI_AUTH_SECRET=${CLI_AUTH_SECRET}
CLERK_SECRET_KEY=${CLERK_SECRET_KEY}
ELASTICSEARCH_API_KEY=${ES_API_KEY}
EOF
    chmod 600 "$SECRETS_FILE"
    chown achilles:achilles "$SECRETS_FILE"
    log "secrets generated → $SECRETS_FILE"
else
    log "preserving existing secrets at $SECRETS_FILE"
fi

# ── Backend .env (non-secret config) ────────────────────────────────────────
cat > "$REPO/backend/.env" <<EOF
NODE_ENV=production
PORT=3000

# Authentication (publishable key only; secret key in $SECRETS_FILE)
CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY}

# CORS — set explicitly (closes bancocaribe issue #5)
CORS_ORIGIN=${CORS_ORIGIN}

# Agent communication URL
AGENT_SERVER_URL=https://${AGENT_FQDN}

# Elasticsearch — read pattern with wildcard, write resolver strips trailing *
# (Setting non-wildcard explicitly closes bancocaribe issue #2.)
ELASTICSEARCH_NODE=http://${ES_PRIVATE_IP}:9200
ELASTICSEARCH_INDEX_PATTERN=achilles-results
EOF
chmod 644 "$REPO/backend/.env"
chown achilles:achilles "$REPO/backend/.env"

# ── systemd unit ───────────────────────────────────────────────────────────
cat > /etc/systemd/system/projectachilles-backend.service <<EOF
[Unit]
Description=ProjectAchilles Backend
Documentation=https://github.com/anthropics/ProjectAchilles
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=achilles
Group=achilles
WorkingDirectory=${REPO}/backend
EnvironmentFile=${REPO}/backend/.env
EnvironmentFile=${SECRETS_FILE}
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${DATA_DIR} ${REPO}/backend ${REPO}/data /home/achilles/.config /home/achilles/.cache /home/achilles/go
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictNamespaces=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable projectachilles-backend >/dev/null

# ── Caddyfile ──────────────────────────────────────────────────────────────
cat > /etc/caddy/Caddyfile <<EOF
{
    email ${ACME_EMAIL}
}

# ── SPA (static files served by Caddy) ─────────────────────────────────────
${SPA_FQDN} {
    root * ${REPO}/frontend/dist
    encode gzip zstd

    # Cache hashed assets aggressively
    @assets path /assets/*
    header @assets Cache-Control "public, max-age=31536000, immutable"

    # SPA fallback: serve index.html for unknown routes
    try_files {path} /index.html
    file_server

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
        # Hide server identity
        -Server
    }
}

# ── Backend API (reverse proxy to localhost:3000) ──────────────────────────
${AGENT_FQDN} {
    encode gzip

    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto https
        flush_interval -1
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        -Server
    }
}
EOF

# Validate Caddyfile before swapping
if ! caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    log "Caddyfile validation failed"
    caddy validate --config /etc/caddy/Caddyfile >&2 || true
    exit 1
fi

# Start backend FIRST (so reverse proxy has something to talk to)
log "starting projectachilles-backend"
systemctl restart projectachilles-backend
sleep 3
systemctl --no-pager --quiet is-active projectachilles-backend \
    || { log "backend service failed to start"; journalctl -u projectachilles-backend -n 50 --no-pager >&2; exit 1; }
log "backend service active"

# Now start Caddy (which will trigger ACME for both FQDNs)
log "reloading caddy (ACME issuance will begin)"
systemctl enable --now caddy >/dev/null 2>&1 || true
systemctl reload caddy 2>/dev/null || systemctl restart caddy
log "caddy active"

# ── SQLite nightly backup cron ─────────────────────────────────────────────
mkdir -p ${DATA_DIR}/backups
chown -R achilles:achilles ${DATA_DIR}/backups

cat > /etc/cron.d/projectachilles-sqlite-backup <<EOF
# Nightly SQLite backup, 7-day retention
MAILTO=
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 2 * * * achilles  test -f ${DATA_DIR}/agents.db && sqlite3 ${DATA_DIR}/agents.db ".backup '${DATA_DIR}/backups/agents-\$(date +\%Y\%m\%d).db'" 2>/dev/null
40 2 * * * achilles  find ${DATA_DIR}/backups -name 'agents-*.db' -mtime +7 -delete 2>/dev/null
EOF
chmod 644 /etc/cron.d/projectachilles-sqlite-backup

log "backend install complete"
