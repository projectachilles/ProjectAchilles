#!/usr/bin/env bash
# Writes the kit's checksum list and the kit digest, or checks a copy of the
# kit against a digest you trust. build-kit.sh runs the first form.
#
#   deploy/offline-kit/seal-kit.sh KIT_DIR
#       writes KIT_DIR/SHA256SUMS (every file in the kit) and, NEXT TO the kit
#       folder, <kit folder name>.sha256: the SHA-256 of SHA256SUMS. Prints it.
#   deploy/offline-kit/seal-kit.sh --check KIT_DIR DIGEST|DIGEST_FILE
#       for the organiser, from this checkout: checks a copy (a USB stick)
#       against the digest: SHA256SUMS first, then every file it lists, and
#       that the copy holds no file it doesn't list.
#
# SHA256SUMS travels with the kit, and so do kit.sh and kit.ps1. By itself it
# only shows a damaged copy: someone who can write to the stick can replace
# the files, the list and the loaders together. The kit digest is the one
# value that must reach people another way (a slide, the handout).
set -euo pipefail

die() { printf 'seal-kit: %s\n' "$*" >&2; exit 1; }
if command -v sha256sum >/dev/null; then SHA=(sha256sum); else SHA=(shasum -a 256); fi
digest_of() { "${SHA[@]}" "$1" | awk '{print $1}'; }
list_files() { (cd "$1" && find . -type f ! -name SHA256SUMS | sed 's|^\./||' | LC_ALL=C sort); }

if [ "${1:-}" = "--check" ]; then
  [ $# -eq 3 ] || die "usage: seal-kit.sh --check KIT_DIR DIGEST|DIGEST_FILE"
  KIT="$(cd "$2" && pwd)" || die "no kit folder: $2"
  want="$3"
  [ ! -f "$want" ] || want="$(awk 'NR==1 {print $1}' "$want")"
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "not a SHA-256 digest: $3"
  [ -f "$KIT/SHA256SUMS" ] || die "no SHA256SUMS in $KIT"
  got="$(digest_of "$KIT/SHA256SUMS")"
  [ "$got" = "$want" ] || die "SHA256SUMS in $KIT is not the one this kit was built with (digest $got). Do not use this copy."
  (cd "$KIT" && "${SHA[@]}" -c --quiet SHA256SUMS) || die "a file in $KIT does not match SHA256SUMS. Do not use this copy."
  extra="$(comm -13 <(sed -E 's/^[0-9a-f]{64} [ *]//' "$KIT/SHA256SUMS" | LC_ALL=C sort) <(list_files "$KIT"))"
  [ -z "$extra" ] || die "files in $KIT that the kit was not built with: $(echo $extra)"
  echo "OK: $KIT matches kit digest $want"
  exit 0
fi

[ $# -eq 1 ] || die "usage: seal-kit.sh KIT_DIR"
KIT="$(cd "$1" && pwd)" || die "no kit folder: $1"
(cd "$KIT" && list_files . | tr '\n' '\0' | xargs -0 "${SHA[@]}" >SHA256SUMS)
DIGEST="$(digest_of "$KIT/SHA256SUMS")"
# Outside the kit folder on purpose: a copy of the kit must not carry it.
DIGEST_FILE="$(dirname "$KIT")/$(basename "$KIT").sha256"
printf '%s  SHA256SUMS\n' "$DIGEST" >"$DIGEST_FILE"
cat <<MSG

Kit digest (SHA-256 of SHA256SUMS): $DIGEST
Saved to: $DIGEST_FILE (not part of the kit)
Give this value to the people who install from a copy by another way than the
copy itself (a slide, the printed handout). START-HERE.md shows how they
compare it. To check a stick yourself:
  deploy/offline-kit/seal-kit.sh --check <stick>/$(basename "$KIT") $DIGEST_FILE
MSG
