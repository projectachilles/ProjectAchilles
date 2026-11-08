#!/usr/bin/env bash
# Proves a built kit installs with no network: a separate Docker engine runs
# in a container with --network none, so any image build, pull, git clone or
# Go module download fails the test. Run build-kit.sh first.
#
#   bash deploy/offline-kit/tests/kit.test.sh [KIT_DIR]    # amd64: full install
#   KIT_ARCH=arm64 bash deploy/offline-kit/tests/kit.test.sh  # arm64: load + smoke (emulated)
#
# KIT_DIR defaults to deploy/offline-kit/out/achilles-kit. Needs bash, python3
# and openssl on the host; the inner engine is reached through a socket in a
# temporary folder, so this machine's own images and volumes are never used.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
KIT="$(cd "${1:-$ROOT/deploy/offline-kit/out/achilles-kit}" && pwd)"
ARCH="${KIT_ARCH:-amd64}"
DIND_IMAGE="docker:29-dind"
NAME="achilles-kittest-dind"

fail() { echo "FAIL $1: $2" >&2; exit 1; }
pass() { echo "PASS $1"; }

[ -f "$KIT/SHA256SUMS" ] || fail setup "no kit at $KIT (run deploy/offline-kit/build-kit.sh)"
read -r -a KIT_TESTS <<<"$(sed -n 's/^Preloaded Go modules for: //p' "$KIT/KIT-INFO.txt" | sed 's/^none$//')"

# Compose and kit.sh run on this host against the inner engine; bind-mount
# sources are paths the inner engine resolves in its own filesystem, so the
# work folder is mounted at the same absolute path inside it.
hostdocker() { env -u DOCKER_HOST docker "$@"; }
WORK="$(mktemp -d "${TMPDIR:-/tmp}/achilles-kittest.XXXXXX")"
cleanup() {
  hostdocker exec "$NAME" sh -c "rm -rf '$WORK'/home" >/dev/null 2>&1 || true
  hostdocker rm -fv "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT
hostdocker rm -fv "$NAME" >/dev/null 2>&1 || true
mkdir -p "$WORK/sock" "$WORK/home"
docker run -d --privileged --name "$NAME" --network none \
  -v "$WORK:$WORK" -e DOCKER_TLS_CERTDIR= "$DIND_IMAGE" \
  dockerd --host "unix://$WORK/sock/docker.sock" --group "$(id -g)" >/dev/null
export DOCKER_HOST="unix://$WORK/sock/docker.sock"
for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 1; done
docker info >/dev/null 2>&1 || fail setup "inner engine did not start: $(hostdocker logs --tail 20 "$NAME" 2>&1)"

kit_loads() {
  local out
  out="$(KIT_ARCH="$ARCH" "$KIT/kit.sh" --dest "$WORK/home" 2>&1)" || fail "${FUNCNAME[0]}" "$out"
  [ -f "$WORK/home/ProjectAchilles/docker-compose.lab.yml" ] || fail "${FUNCNAME[0]}" "source not unpacked"
  [ "$(git -C "$WORK/home/ProjectAchilles" rev-parse HEAD)" = "$(cat "$KIT/images/COMMIT")" ] \
    || fail "${FUNCNAME[0]}" "source is not the commit the images were built from"
  pass "${FUNCNAME[0]}"
}

# ---------------------------------------------------------------- arm64 ----
images_are_arm64() {
  local img arch
  while read -r img; do
    [ -n "$img" ] || continue
    arch="$(docker image inspect --format '{{.Architecture}}' "$img")"
    case "$img" in
      *-lab-endpoint:*) [ "$arch" = amd64 ] || fail "${FUNCNAME[0]}" "$img is $arch, want amd64" ;;
      *) [ "$arch" = arm64 ] || fail "${FUNCNAME[0]}" "$img is $arch, want arm64" ;;
    esac
  done <"$KIT/images/IMAGES"
  pass "${FUNCNAME[0]}"
}

arm64_backend_runs() {
  local out
  out="$(docker run --rm --entrypoint go projectachilles-backend version)" || fail "${FUNCNAME[0]}" "go did not run"
  [[ "$out" == *" linux/arm64" ]] || fail "${FUNCNAME[0]}" "go is $out"
  docker run --rm --entrypoint node projectachilles-backend -e "require('better-sqlite3')" \
    || fail "${FUNCNAME[0]}" "better-sqlite3 does not load"
  docker run --rm --entrypoint sh projectachilles-backend -c 'test -d /data/f0_library/tests_source' \
    || fail "${FUNCNAME[0]}" "no preloaded test library"
  pass "${FUNCNAME[0]}"
}

if [ "$ARCH" = arm64 ]; then
  kit_loads
  images_are_arm64
  arm64_backend_runs
  exit 0
fi

# ---------------------------------------------------------------- amd64 ----
SRC="$WORK/home/ProjectAchilles"
DC=(docker compose --project-directory "$SRC" -f "$SRC/docker-compose.yml" -f "$SRC/docker-compose.lab.yml" --profile elasticsearch)
CTR="achilles-lab-endpoint"
backend_sh() { "${DC[@]}" exec -T backend sh -c "$1"; }

configure() {
  # What setup.sh / the Windows installer write, with throwaway values.
  local pk
  pk="pk_test_$(printf 'kit-test.clerk.accounts.dev$' | base64 | tr -d '=')"
  cat >"$SRC/backend/.env" <<EOF
CLERK_PUBLISHABLE_KEY=$pk
CLERK_SECRET_KEY=sk_test_kittest
ENCRYPTION_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
CLI_AUTH_SECRET=$(openssl rand -hex 32)
EOF
  printf 'CLERK_PUBLISHABLE_KEY=%s\nCORS_ORIGIN=http://localhost\n' "$pk" >"$SRC/.env"
}

stack_starts_without_network() {
  local out
  out="$("${DC[@]}" up -d 2>&1)" || fail "${FUNCNAME[0]}" "compose up failed (something tried to build or pull?): $out"
  for _ in $(seq 1 90); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$("${DC[@]}" ps -q backend)" 2>/dev/null)" = healthy ] && break
    sleep 2
  done
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$("${DC[@]}" ps -q backend)")" = healthy ] \
    || fail "${FUNCNAME[0]}" "backend not healthy: $("${DC[@]}" logs --tail 30 backend 2>&1)"
  pass "${FUNCNAME[0]}"
}

seed_loads_es() {
  local id state code count
  id="$("${DC[@]}" ps -aq es-seed)"
  for _ in $(seq 1 90); do
    state="$(docker inspect -f '{{.State.Status}}' "$id")"
    [ "$state" = exited ] && break
    sleep 2
  done
  code="$(docker inspect -f '{{.State.ExitCode}}' "$id")"
  [ "$state" = exited ] && [ "$code" = 0 ] || fail "${FUNCNAME[0]}" "es-seed $state/$code: $(docker logs --tail 20 "$id" 2>&1)"
  count="$(backend_sh "wget -qO- 'http://elasticsearch:9200/achilles-results-*/_count'" | python3 -c 'import json,sys; print(json.load(sys.stdin)["count"])')"
  [ "$count" -ge 1000 ] || fail "${FUNCNAME[0]}" "only $count seeded results"
  pass "${FUNCNAME[0]}"
}

library_is_preloaded() {
  local logs
  logs="$("${DC[@]}" logs backend 2>&1)"
  grep -q 'Repository already exists' <<<"$logs" || fail "${FUNCNAME[0]}" "backend did not find the preloaded library"
  ! grep -q 'Cloning repository' <<<"$logs" || fail "${FUNCNAME[0]}" "backend tried to clone"
  backend_sh 'test -d /app/data/f0_library/tests_source' || fail "${FUNCNAME[0]}" "library is not on the repo-cache volume"
  pass "${FUNCNAME[0]}"
}

tests_build_offline() {
  local uuid out
  [ ${#KIT_TESTS[@]} -gt 0 ] || { echo "SKIP ${FUNCNAME[0]}: the kit preloads no tests"; return 0; }
  for uuid in "${KIT_TESTS[@]}"; do
    out="$(backend_sh "cd /app && node --input-type=module -e \"
      const { BuildService } = await import('/app/dist/services/tests/buildService.js');
      const { TestsSettingsService } = await import('/app/dist/services/tests/settings.js');
      const svc = new BuildService(new TestsSettingsService(), ['/root/.projectachilles/custom-tests', '/data/f0_library/tests_source']);
      const info = await svc.buildAndSign('$uuid');
      console.log('BUILT ' + info.filename + ' ' + info.fileSize);
      process.exit(0);\" 2>&1")" || fail "${FUNCNAME[0]}" "$uuid: $(tail -20 <<<"$out")"
    grep -q '^BUILT ' <<<"$out" || fail "${FUNCNAME[0]}" "$uuid: $(tail -20 <<<"$out")"
  done
  pass "${FUNCNAME[0]}"
}

lab_endpoint_enrolls() {
  local token out row
  token="$(backend_sh "node --input-type=module -e \"const m = await import('/app/dist/services/agent/enrollment.service.js'); const t = await m.createToken('default', 'kit-test', 1, 1); console.log(t.token); process.exit(0)\"" | tail -1)"
  [ -n "$token" ] || fail "${FUNCNAME[0]}" "could not create a token"
  out="$(docker exec "$CTR" enroll "$token" 2>&1)" || fail "${FUNCNAME[0]}" "enroll failed: $out"
  for _ in $(seq 1 45); do
    row="$(backend_sh "node -e \"const D = require('better-sqlite3'); const db = new D('/root/.projectachilles/agents.db', { readonly: true }); const r = db.prepare(\\\"SELECT os, arch FROM agents WHERE hostname = 'lab-endpoint' AND last_heartbeat IS NOT NULL\\\").get(); console.log(r ? r.os + '/' + r.arch : '')\"")"
    [ "$row" = linux/amd64 ] && break
    sleep 2
  done
  [ "$row" = linux/amd64 ] || fail "${FUNCNAME[0]}" "no heartbeat from lab-endpoint (got '$row')"
  pass "${FUNCNAME[0]}"
}

kit_loads
configure
stack_starts_without_network
seed_loads_es
library_is_preloaded
tests_build_offline
lab_endpoint_enrolls
