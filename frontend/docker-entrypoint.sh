#!/bin/sh
# Generate runtime config from environment variables.
# This replaces Vite's build-time import.meta.env for Docker deployments.
# CLERK_PUBLISHABLE_KEY comes from the container environment: docker compose
# fills it from the ROOT .env (or the shell), not backend/.env. Compose also
# passes VITE_CLERK_PUBLISHABLE_KEY, the name used in frontend/.env, so accept
# that as a fallback.
# I3: JSON-encode env vars so a value can't break out of its string literal.
# Busybox awk, not jq: installing jq meant `apk add` at build time, which
# fails on hosts whose egress firewall blocks dl-cdn.alpinelinux.org.
# Output matches `jq -Rs .`: escapes \ and ", control characters as \b \t \n
# \f \r or \u00XX (DEL as \u007f), keeps a trailing newline. The trailing "x" sentinel stops
# awk from dropping a final newline; END strips it again.
json_string() {
  printf '%sx' "$1" | awk '
    BEGIN {
      for (i = 1; i < 32; i++) esc[sprintf("%c", i)] = sprintf("\\u%04x", i)
      esc[sprintf("%c", 127)] = "\\u007f"
      esc["\b"] = "\\b"; esc["\t"] = "\\t"; esc["\n"] = "\\n"
      esc["\f"] = "\\f"; esc["\r"] = "\\r"
      esc["\\"] = "\\\\"; esc["\""] = "\\\""
    }
    { s = s (NR > 1 ? "\n" : "") $0 }
    END {
      s = substr(s, 1, length(s) - 1)
      out = ""
      for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        out = out ((c in esc) ? esc[c] : c)
      }
      printf "\"%s\"", out
    }'
}
CLERK_KEY_JSON=$(json_string "${CLERK_PUBLISHABLE_KEY:-${VITE_CLERK_PUBLISHABLE_KEY:-}}")
API_URL_JSON=$(json_string "${VITE_API_URL:-}")
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
  # Nginx requires IPv6 addresses in square brackets
  case "$RESOLVER" in *:*) RESOLVER="[${RESOLVER}]" ;; esac
  sed -i "/index index.html;/a\\    resolver ${RESOLVER} valid=5s;" \
    /etc/nginx/conf.d/default.conf
  sed -i "s|proxy_pass http://backend:3000;|set \$backend_upstream http://${BACKEND_HOST}:${BACKEND_PORT};\n        proxy_pass \$backend_upstream;|g" \
    /etc/nginx/conf.d/default.conf
elif [ -n "${VITE_API_URL}" ]; then
  # Direct CORS mode: frontend calls backend via VITE_API_URL, so the
  # /api/ and /ws proxy blocks are unused. Remove them to prevent nginx
  # from failing to resolve the hardcoded "backend" upstream at startup.
  # This is needed on Fly.io, Render Starter, and any PaaS without a
  # "backend" DNS name on the internal network.
  sed -i '/location \/api\//,/}/d' /etc/nginx/conf.d/default.conf
  sed -i '/location \/ws/,/}/d' /etc/nginx/conf.d/default.conf
fi

exec "$@"
