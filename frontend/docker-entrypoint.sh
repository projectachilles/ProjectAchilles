#!/bin/sh
# Generate runtime config from environment variables.
# This replaces Vite's build-time import.meta.env for Docker deployments.
# Reads CLERK_PUBLISHABLE_KEY from backend/.env (injected via docker-compose env_file).
# I3: Use jq to safely JSON-encode env vars, preventing string breakout.
CLERK_KEY_JSON=$(printf '%s' "${CLERK_PUBLISHABLE_KEY:-}" | jq -Rs .)
API_URL_JSON=$(printf '%s' "${VITE_API_URL:-}" | jq -Rs .)
cat <<EOF > /usr/share/nginx/html/env-config.js
window.__env__ = {
  VITE_CLERK_PUBLISHABLE_KEY: ${CLERK_KEY_JSON},
  VITE_API_URL: ${API_URL_JSON}
};
EOF

# Rewrite nginx backend proxy for PaaS environments (e.g. Railway).
# Docker Compose uses the default "backend:3000" from nginx.conf.
# Set BACKEND_HOST to override (e.g. "backend.railway.internal").
if [ -n "${BACKEND_HOST}" ]; then
  BACKEND_PORT="${BACKEND_PORT:-3000}"
  # Read the container's DNS resolver for dynamic upstream resolution.
  # When proxy_pass uses a variable, nginx re-resolves DNS on each request
  # instead of caching it once at startup. This prevents stale IPs when the
  # backend redeploys and gets a new private network address.
  RESOLVER=$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf)
  RESOLVER=${RESOLVER:-127.0.0.11}
  sed -i "/index index.html;/a\\    resolver ${RESOLVER} valid=5s;" \
    /etc/nginx/conf.d/default.conf
  sed -i "s|proxy_pass http://backend:3000;|set \$backend_upstream http://${BACKEND_HOST}:${BACKEND_PORT};\n        proxy_pass \$backend_upstream;|g" \
    /etc/nginx/conf.d/default.conf
fi

exec "$@"
