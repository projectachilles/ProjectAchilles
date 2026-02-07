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
exec "$@"
