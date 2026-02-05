#!/bin/sh
# Generate runtime config from environment variables.
# This replaces Vite's build-time import.meta.env for Docker deployments.
# Reads CLERK_PUBLISHABLE_KEY from backend/.env (injected via docker-compose env_file).
cat <<EOF > /usr/share/nginx/html/env-config.js
window.__env__ = {
  VITE_CLERK_PUBLISHABLE_KEY: "${CLERK_PUBLISHABLE_KEY:-}",
  VITE_API_URL: "${VITE_API_URL:-}"
};
EOF
exec "$@"
