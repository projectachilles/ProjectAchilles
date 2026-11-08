#!/usr/bin/env bash
# Stack tests: backend + lab endpoint via docker-compose.lab.yml.
# Needs a working backend/.env (Clerk keys). Runs under its own compose
# project (achilles-labtest), so it never touches another install's volumes.
# It enrolls one agent named lab-endpoint into that project's database;
# remove everything with: docker compose -p achilles-labtest down -v
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

if [ ! -f backend/.env ]; then
  echo "SKIP: backend/.env is missing (copy backend/.env.example and add Clerk keys)"
  exit 0
fi

CTR="achilles-lab-endpoint"
AGENT_VERSION="$(sed -n 's/^VERSION := //p' agent/Makefile)"
DC=(docker compose -p achilles-labtest -f docker-compose.yml -f docker-compose.lab.yml)

fail() { echo "FAIL $1: $2" >&2; exit 1; }
pass() { echo "PASS $1"; }
cleanup() { "${DC[@]}" rm -sf lab-endpoint >/dev/null 2>&1 || true; docker volume rm achilles-labtest_lab-endpoint-data >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Fresh endpoint state for every run; the backend keeps running.
cleanup
"${DC[@]}" up -d --build backend lab-endpoint >/dev/null

for _ in $(seq 1 90); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$("${DC[@]}" ps -q backend)" 2>/dev/null)" = "healthy" ] && break
  sleep 2
done

backend_sh() { "${DC[@]}" exec -T backend sh -c "$1"; }

forwarder_reaches_backend() {
  local out
  out="$(docker exec "$CTR" curl -sf http://localhost:3000/api/health)" || fail "${FUNCNAME[0]}" "health check failed"
  grep -q 'ok' <<<"$out" || fail "${FUNCNAME[0]}" "unexpected body: $out"
  pass "${FUNCNAME[0]}"
}

hostname_is_lab_endpoint() {
  local got
  got="$(docker exec "$CTR" hostname)"
  [ "$got" = "lab-endpoint" ] || fail "${FUNCNAME[0]}" "got '$got'"
  pass "${FUNCNAME[0]}"
}

enrolls_and_heartbeats() {
  local token row
  token="$(backend_sh "node --input-type=module -e \"const m = await import('/app/dist/services/agent/enrollment.service.js'); const t = await m.createToken('default', 'lab-endpoint-test', 1, 1); console.log(t.token); process.exit(0)\"" | tail -1)"
  [ -n "$token" ] || fail "${FUNCNAME[0]}" "could not create a token"
  local out
  out="$(docker exec "$CTR" enroll "$token" 2>&1)" || fail "${FUNCNAME[0]}" "enroll failed: $out"
  for _ in $(seq 1 45); do
    docker logs "$CTR" 2>&1 | grep -qF "Starting agent v${AGENT_VERSION} (server=http://localhost:3000" && break
    sleep 2
  done
  docker logs "$CTR" 2>&1 | grep -qF "Starting agent v${AGENT_VERSION} (server=http://localhost:3000" \
    || fail "${FUNCNAME[0]}" "agent did not start: $(docker logs --tail 20 "$CTR" 2>&1)"
  for _ in $(seq 1 45); do
    row="$(backend_sh "node -e \"const D = require('better-sqlite3'); const db = new D('/root/.projectachilles/agents.db', { readonly: true }); const r = db.prepare(\\\"SELECT os, arch FROM agents WHERE hostname = 'lab-endpoint' AND last_heartbeat IS NOT NULL\\\").get(); console.log(r ? r.os + '/' + r.arch : '')\"")"
    [ "$row" = "linux/amd64" ] && break
    sleep 2
  done
  [ "$row" = "linux/amd64" ] || fail "${FUNCNAME[0]}" "no heartbeat row for lab-endpoint (got '$row')"
  pass "${FUNCNAME[0]}"
}

sinkhole_is_isolated() {
  docker exec "$CTR" sh -c 'echo "127.0.0.1 api.openai.com" >> /etc/hosts'
  [ "$(docker exec "$CTR" getent ahostsv4 api.openai.com | awk 'NR==1{print $1}')" = "127.0.0.1" ] \
    || fail "${FUNCNAME[0]}" "sinkhole not applied in the endpoint"
  if [ "$(backend_sh 'getent ahostsv4 api.openai.com' | awk 'NR==1{print $1}')" = "127.0.0.1" ]; then
    fail "${FUNCNAME[0]}" "sinkhole leaked into the backend"
  fi
  pass "${FUNCNAME[0]}"
}

recreate_keeps_enrollment() {
  # Recreate, not just restart: the enrolled key is encrypted with the
  # machine ID, which must survive a new container (e.g. after a rebuild).
  "${DC[@]}" rm -sf lab-endpoint >/dev/null 2>&1
  local since
  since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "${DC[@]}" up -d lab-endpoint >/dev/null 2>&1
  for _ in $(seq 1 15); do
    docker logs --since "$since" "$CTR" 2>&1 | grep -q 'Starting agent' && break
    sleep 2
  done
  local logs
  logs="$(docker logs --since "$since" "$CTR" 2>&1)"
  grep -q 'Starting agent' <<<"$logs" || fail "${FUNCNAME[0]}" "agent did not start after recreate: $logs"
  ! grep -q 'Not enrolled yet' <<<"$logs" || fail "${FUNCNAME[0]}" "enrollment lost on recreate"
  pass "${FUNCNAME[0]}"
}

forwarder_reaches_backend
hostname_is_lab_endpoint
enrolls_and_heartbeats
sinkhole_is_isolated
recreate_keeps_enrollment
