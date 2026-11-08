#!/usr/bin/env bash
# The lab overlay must merge with the server install's compose file
# (docker-compose.server.yml, used by the installer and cloud servers).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL $1: $2" >&2; exit 1; }
pass() { echo "PASS $1"; }

# Throwaway values: only what docker-compose.server.yml requires to render.
export ACHILLES_DOMAIN=lab.example.test
DC=(docker compose -p achilles-labtest-server -f docker-compose.server.yml -f docker-compose.lab.yml)

# backend/.env is gitignored; the server file reads it, so provide an empty one if absent.
created_env=0
if [ ! -f backend/.env ]; then touch backend/.env; created_env=1; fi
trap '[ "$created_env" = 1 ] && rm -f backend/.env' EXIT

server_overlay_config() {
  local services json
  services="$("${DC[@]}" config --services)" || fail "${FUNCNAME[0]}" "compose config failed"
  grep -qx 'lab-endpoint' <<<"$services" || fail "${FUNCNAME[0]}" "no lab-endpoint service"
  json="$("${DC[@]}" config --format json)"
  local env_url
  env_url="$(sed -n 's/^AGENT_SERVER_URL=//p' backend/.env | tail -1)"
  python3 - "$json" "$env_url" <<'PY' || fail "server_overlay_config" "merged config is not usable"
import json, sys
cfg = json.loads(sys.argv[1])["services"]
env_url = sys.argv[2] or None
backend, lab = cfg["backend"], cfg["lab-endpoint"]
# depends_on: service_healthy needs a backend healthcheck in this file too.
assert backend.get("healthcheck"), "backend has no healthcheck"
# The overlay must not change the URL real agents are given at enrollment.
assert backend.get("environment", {}).get("AGENT_SERVER_URL") == env_url, backend.get("environment", {}).get("AGENT_SERVER_URL")
assert lab["environment"]["LAB_FORWARD_TO"] == "backend:3000"
assert lab["platform"] == "linux/amd64"
PY
  pass "${FUNCNAME[0]}"
}

server_overlay_config
