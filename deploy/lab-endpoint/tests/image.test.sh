#!/usr/bin/env bash
# Image-level tests for the lab endpoint (no backend needed).
# Run from anywhere: bash deploy/lab-endpoint/tests/image.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

IMAGE="achilles-lab-endpoint:test"
CTR="achilles-lab-endpoint"
AGENT_VERSION="$(sed -n 's/^VERSION := //p' agent/Makefile)"

fail() { echo "FAIL $1: $2" >&2; exit 1; }
pass() { echo "PASS $1"; }
cleanup() { docker rm -f "$CTR" >/dev/null 2>&1 || true; }
trap cleanup EXIT

run_in_image() { docker run --rm --platform linux/amd64 "$IMAGE" "$@"; }

build() {
  docker build --platform linux/amd64 \
    --build-arg AGENT_VERSION="$AGENT_VERSION" \
    -f deploy/lab-endpoint/Dockerfile -t "$IMAGE" . >/dev/null
}

version_matches_makefile() {
  local got
  got="$(run_in_image achilles-agent --version)"
  [ "$got" = "achilles-agent v${AGENT_VERSION}" ] || fail "${FUNCNAME[0]}" "got '$got'"
  pass "${FUNCNAME[0]}"
}

vendor_default_sshd() {
  local cfg
  cfg="$(run_in_image cat /etc/ssh/sshd_config)"
  grep -qx 'PermitRootLogin yes' <<<"$cfg" || fail "${FUNCNAME[0]}" "no 'PermitRootLogin yes'"
  grep -qx 'MaxAuthTries 6' <<<"$cfg" || fail "${FUNCNAME[0]}" "no 'MaxAuthTries 6'"
  pass "${FUNCNAME[0]}"
}

modprobe_not_hardened() {
  run_in_image sh -c 'test -d /etc/modprobe.d' || fail "${FUNCNAME[0]}" "/etc/modprobe.d missing"
  if run_in_image sh -c "grep -rqE 'cramfs|usb-storage|usb_storage' /etc/modprobe.d"; then
    fail "${FUNCNAME[0]}" "a cramfs/usb-storage blacklist is already present"
  fi
  pass "${FUNCNAME[0]}"
}

unenrolled_waits() {
  cleanup
  docker run -d --platform linux/amd64 --name "$CTR" "$IMAGE" >/dev/null
  sleep 8
  [ "$(docker inspect -f '{{.State.Running}}' "$CTR")" = "true" ] || fail "${FUNCNAME[0]}" "container exited"
  local logs
  logs="$(docker logs "$CTR" 2>&1)"
  grep -q 'Not enrolled yet' <<<"$logs" || fail "${FUNCNAME[0]}" "no waiting message: $logs"
  grep -qF 'docker exec achilles-lab-endpoint enroll <TOKEN>' <<<"$logs" || fail "${FUNCNAME[0]}" "no enroll command: $logs"
  pass "${FUNCNAME[0]}"
}

enroll_passes_args() {
  # Reuses the running container from unenrolled_waits.
  local out
  if out="$(docker exec "$CTR" enroll bogus http://example.com:3000 2>&1)"; then
    fail "${FUNCNAME[0]}" "enroll succeeded against a plaintext remote URL"
  fi
  grep -q 'plaintext HTTP' <<<"$out" || fail "${FUNCNAME[0]}" "unexpected output: $out"
  pass "${FUNCNAME[0]}"
}

lab_files_are_lf_in_git() {
  # Git for Windows defaults to core.autocrlf=true; files copied into the
  # image must still be checked out with LF.
  local f bad=""
  while IFS= read -r f; do
    git check-attr eol -- "$f" | grep -q 'eol: lf$' || bad="$bad $f"
  done < <(git ls-files deploy/lab-endpoint; ls deploy/lab-endpoint/enroll deploy/lab-endpoint/sshd_config.vendor-default)
  [ -z "$bad" ] || fail "${FUNCNAME[0]}" "not forced to LF:$bad"
  pass "${FUNCNAME[0]}"
}

builds_from_crlf_checkout() {
  # Simulate a CRLF checkout: the image must still start and enroll must run.
  local ctx out
  ctx="$(mktemp -d)"
  mkdir -p "$ctx/deploy"
  cp -r deploy/lab-endpoint "$ctx/deploy/"
  rsync -a --exclude dist agent/ "$ctx/agent/"
  for f in enroll entrypoint.sh sshd_config.vendor-default; do
    sed -i 's/$/\r/' "$ctx/deploy/lab-endpoint/$f"
  done
  docker build --platform linux/amd64 --build-arg AGENT_VERSION="$AGENT_VERSION" \
    -f "$ctx/deploy/lab-endpoint/Dockerfile" -t achilles-lab-endpoint:crlf "$ctx" >/dev/null 2>&1 \
    || { rm -rf "$ctx"; fail "${FUNCNAME[0]}" "build failed"; }
  rm -rf "$ctx"
  out="$(docker run --rm --platform linux/amd64 achilles-lab-endpoint:crlf enroll 2>&1 || true)"
  grep -q 'usage: enroll' <<<"$out" || fail "${FUNCNAME[0]}" "enroll broken by CRLF: $out"
  docker run --rm --platform linux/amd64 achilles-lab-endpoint:crlf cat /etc/ssh/sshd_config | grep -qx 'PermitRootLogin yes' \
    || fail "${FUNCNAME[0]}" "sshd_config keeps CR line endings"
  pass "${FUNCNAME[0]}"
}

build
lab_files_are_lf_in_git
builds_from_crlf_checkout
version_matches_makefile
vendor_default_sshd
modprobe_not_hardened
unenrolled_waits
enroll_passes_args
