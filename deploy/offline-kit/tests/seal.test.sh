#!/usr/bin/env bash
# The kit's checksum list and kit digest (seal-kit.sh), and the comparison
# START-HERE.md gives attendees. Works on a small stand-in kit, so it needs no
# built kit and no network. The Windows line runs in a PowerShell container
# and is skipped (loudly) without Docker.
#
#   bash deploy/offline-kit/tests/seal.test.sh [case ...]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="$ROOT/deploy/offline-kit"
SEAL="$HERE/seal-kit.sh"
PWSH_IMAGE="mcr.microsoft.com/powershell:7.4-ubuntu-22.04"

fail() { echo "FAIL $1: $2" >&2; exit 1; }
pass() { echo "PASS $1"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A stand-in kit with the real loaders and the layout build-kit.sh produces.
new_kit() { # NAME -> path of a sealed kit; the seal output is in $WORK/NAME.log
  local kit="$WORK/$1/achilles-kit"
  mkdir -p "$kit/images/amd64"
  cp "$HERE/kit.sh" "$HERE/kit.ps1" "$HERE/START-HERE.md" "$kit/"
  echo backend >"$kit/images/amd64/backend.tar"
  echo lab >"$kit/images/lab-endpoint.tar"
  echo source >"$kit/ProjectAchilles.tar.gz"
  "$SEAL" "$kit" >"$WORK/$1.log" || fail new_kit "seal-kit.sh failed"
  echo "$kit"
}
sha() { sha256sum "$1" | awk '{print $1}'; }
# What someone with write access to the stick does: change a file, then make
# the checksum list agree with it.
reseal_like_an_attacker() { (cd "$1" && find . -type f ! -name SHA256SUMS | sed 's|^\./||' | LC_ALL=C sort | xargs sha256sum >SHA256SUMS); }

seal_writes_the_list_and_the_digest_outside_the_kit() {
  local kit digest_file
  kit="$(new_kit seal)"
  digest_file="$WORK/seal/achilles-kit.sha256"
  (cd "$kit" && sha256sum -c --quiet SHA256SUMS) || fail "${FUNCNAME[0]}" "SHA256SUMS does not verify"
  for f in kit.sh kit.ps1 START-HERE.md images/amd64/backend.tar images/lab-endpoint.tar ProjectAchilles.tar.gz; do
    grep -q " $f\$" "$kit/SHA256SUMS" || fail "${FUNCNAME[0]}" "$f is not in SHA256SUMS"
  done
  [ -f "$digest_file" ] || fail "${FUNCNAME[0]}" "no digest file next to the kit folder"
  [ "$(awk '{print $1}' "$digest_file")" = "$(sha "$kit/SHA256SUMS")" ] || fail "${FUNCNAME[0]}" "the digest file is not the SHA-256 of SHA256SUMS"
  grep -q "$(sha "$kit/SHA256SUMS")" "$WORK/seal.log" || fail "${FUNCNAME[0]}" "the digest is not printed"
  [ -z "$(find "$kit" -name '*.sha256')" ] || fail "${FUNCNAME[0]}" "the digest file is inside the kit"
  pass "${FUNCNAME[0]}"
}

build_kit_seals_last() {
  # build-kit.sh needs a full image build, so check the wiring instead: it
  # calls seal-kit.sh on the kit folder and writes no checksum list itself.
  grep -q '^"\$HERE/seal-kit.sh" "\$KIT"$' "$HERE/build-kit.sh" || fail "${FUNCNAME[0]}" "build-kit.sh does not run seal-kit.sh on the kit"
  ! grep -q '>SHA256SUMS' "$HERE/build-kit.sh" || fail "${FUNCNAME[0]}" "build-kit.sh still writes SHA256SUMS itself"
  [ "$(grep -n 'seal-kit.sh' "$HERE/build-kit.sh" | tail -1 | cut -d: -f1)" -gt "$(grep -n 'KIT-INFO.txt' "$HERE/build-kit.sh" | tail -1 | cut -d: -f1)" ] \
    || fail "${FUNCNAME[0]}" "the kit is sealed before its last file is written"
  pass "${FUNCNAME[0]}"
}

check_accepts_a_faithful_copy() {
  local kit
  kit="$(new_kit faithful)"
  cp -r "$kit" "$WORK/faithful/stick"
  "$SEAL" --check "$WORK/faithful/stick" "$WORK/faithful/achilles-kit.sha256" >/dev/null || fail "${FUNCNAME[0]}" "digest file refused"
  "$SEAL" --check "$WORK/faithful/stick" "$(sha "$kit/SHA256SUMS")" >/dev/null || fail "${FUNCNAME[0]}" "digest value refused"
  pass "${FUNCNAME[0]}"
}

check_refuses_changed_copies() {
  local kit digest stick what
  kit="$(new_kit changed)"
  digest="$WORK/changed/achilles-kit.sha256"
  for what in image+list loader+list damaged extra-file; do
    stick="$WORK/changed/stick-$what"
    cp -r "$kit" "$stick"
    case "$what" in
      # The loader's own check passes in the first two cases: the list agrees.
      image+list) echo evil >"$stick/images/amd64/backend.tar"; reseal_like_an_attacker "$stick" ;;
      loader+list) echo 'echo evil' >>"$stick/kit.sh"; reseal_like_an_attacker "$stick" ;;
      damaged) echo truncated >"$stick/ProjectAchilles.tar.gz" ;;
      extra-file) echo evil >"$stick/images/amd64/extra.tar" ;;
    esac
    if "$SEAL" --check "$stick" "$digest" >/dev/null 2>&1; then fail "${FUNCNAME[0]}" "accepted a copy with: $what"; fi
  done
  if "$SEAL" --check "$kit" not-a-digest >/dev/null 2>&1; then fail "${FUNCNAME[0]}" "accepted a value that is not a digest"; fi
  pass "${FUNCNAME[0]}"
}

# The lines START-HERE.md gives (English and Spanish must be the same).
start_here_cmd() { # LABEL -> the command
  local cmds
  cmds="$(grep -F -- "- $1: \`" "$HERE/START-HERE.md" | grep SHA256SUMS | sed -E 's/^[^`]*`(.*)`$/\1/' | sort -u)"
  [ "$(grep -F -- "- $1: \`" "$HERE/START-HERE.md" | grep -c SHA256SUMS)" = 2 ] && [ "$(printf '%s\n' "$cmds" | grep -c .)" = 1 ] \
    || fail start_here_cmd "expected one identical '$1' digest line in English and Spanish"
  printf '%s\n' "$cmds"
}

# Runs a documented line in a kit copy and says whether a reader following the
# text would accept it: first value = the kit digest, second = the list's line.
reader_accepts() { # OUTPUT DIGEST
  local values
  values="$(grep -oE '[0-9a-f]{64}' <<<"$1")"
  [ "$(sed -n 1p <<<"$values")" = "$2" ] && [ "$(sed -n 2p <<<"$values")" = "$(sed -n 3p <<<"$values")" ] && [ "$(grep -c . <<<"$values")" = 3 ]
}

start_here_unix_lines_tell_a_changed_kit() {
  local kit digest label cmd out
  kit="$(new_kit unix)"
  digest="$(sha "$kit/SHA256SUMS")"
  cp -r "$kit" "$WORK/unix/loader"; echo 'echo evil' >>"$WORK/unix/loader/kit.sh"
  cp -r "$kit" "$WORK/unix/list"; echo evil >"$WORK/unix/list/images/amd64/backend.tar"; reseal_like_an_attacker "$WORK/unix/list"
  for label in macOS Linux; do
    cmd="$(start_here_cmd "$label")"
    out="$(cd "$kit" && eval "$cmd")" || fail "${FUNCNAME[0]}" "$label line fails: $cmd"
    reader_accepts "$out" "$digest" || fail "${FUNCNAME[0]}" "$label line does not confirm a faithful copy: $out"
    out="$(cd "$WORK/unix/loader" && eval "$cmd")"
    ! reader_accepts "$out" "$digest" || fail "${FUNCNAME[0]}" "$label line accepts a changed loader"
    out="$(cd "$WORK/unix/list" && eval "$cmd")"
    ! reader_accepts "$out" "$digest" || fail "${FUNCNAME[0]}" "$label line accepts a changed image with a matching list"
  done
  pass "${FUNCNAME[0]}"
}

start_here_windows_line_tells_a_changed_kit() {
  local kit digest cmd out
  if ! docker info >/dev/null 2>&1; then echo "SKIP ${FUNCNAME[0]}: Docker is not running (the PowerShell line was NOT checked)"; return 0; fi
  kit="$(new_kit win)"
  digest="$(sha "$kit/SHA256SUMS")"
  cp -r "$kit" "$WORK/win/loader"; echo '# evil' >>"$WORK/win/loader/kit.ps1"
  cmd="$(start_here_cmd 'Windows (PowerShell)')"
  out="$(docker run --rm -v "$kit":/kit:ro -w /kit "$PWSH_IMAGE" pwsh -NoProfile -Command "$cmd" | tr -d '\r')" \
    || fail "${FUNCNAME[0]}" "the line fails: $cmd"
  reader_accepts "$out" "$digest" || fail "${FUNCNAME[0]}" "does not confirm a faithful copy: $out"
  out="$(docker run --rm -v "$WORK/win/loader":/kit:ro -w /kit "$PWSH_IMAGE" pwsh -NoProfile -Command "$cmd" | tr -d '\r')"
  ! reader_accepts "$out" "$digest" || fail "${FUNCNAME[0]}" "accepts a changed loader"
  pass "${FUNCNAME[0]}"
}

docs_say_what_the_check_covers() {
  grep -q 'finds a damaged copy' "$HERE/START-HERE.md" && grep -q 'detecta una copia dañada' "$HERE/START-HERE.md" \
    || fail "${FUNCNAME[0]}" "START-HERE.md does not say the built-in check is for damaged copies"
  grep -q 'kit digest' "$HERE/README.md" && grep -q 'seal-kit.sh --check' "$HERE/README.md" \
    || fail "${FUNCNAME[0]}" "README.md does not explain the kit digest"
  pass "${FUNCNAME[0]}"
}

cases=("$@")
[ ${#cases[@]} -gt 0 ] || cases=(seal_writes_the_list_and_the_digest_outside_the_kit build_kit_seals_last check_accepts_a_faithful_copy check_refuses_changed_copies start_here_unix_lines_tell_a_changed_kit start_here_windows_line_tells_a_changed_kit docs_say_what_the_check_covers)
for c in "${cases[@]}"; do "$c"; done
