#!/usr/bin/env bash
# ProjectAchilles offline kit loader (macOS, Linux). Run it from the kit folder:
#
#   ./kit.sh [--dest DIR]     (default DIR: your home folder)
#
# It checks the files, loads the images for this machine into Docker and
# unpacks the source to DIR/ProjectAchilles. Nothing is downloaded.
set -euo pipefail

KIT="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME"
while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="${2:?--dest needs a folder}"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker Desktop (or the docker service) and run this again."

# KIT_ARCH=amd64|arm64 overrides the detection (tests, or a mixed setup).
case "${KIT_ARCH:-$(docker info --format '{{.Architecture}}')}" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "unsupported architecture: $(docker info --format '{{.Architecture}}')" ;;
esac
say "Docker architecture: $ARCH"

if command -v sha256sum >/dev/null; then SHA=(sha256sum); else SHA=(shasum -a 256); fi
say "Checking the kit files"
(cd "$KIT" && grep -E " (\*)?(images/$ARCH/|images/lab-endpoint\.tar|ProjectAchilles\.tar\.gz)" SHA256SUMS | "${SHA[@]}" -c --quiet -) \
  || die "a kit file is damaged or incomplete. Copy the kit again."

say "Loading the images (a few minutes)"
for f in "$KIT"/images/"$ARCH"/*.tar "$KIT"/images/lab-endpoint.tar; do
  echo "  $(basename "$f")"
  docker load -q -i "$f" >/dev/null || die "docker load failed for $f"
done
while read -r img; do
  [ -n "$img" ] || continue
  docker image inspect "$img" >/dev/null 2>&1 || die "image $img is missing after loading"
done <"$KIT/images/IMAGES"

if [ -e "$DEST/ProjectAchilles" ]; then
  say "$DEST/ProjectAchilles already exists, leaving it as it is"
  echo "  The images were built from commit $(cat "$KIT/images/COMMIT"). Compose uses them"
  echo "  whatever version that folder holds; to match exactly, rename it and run this again."
else
  say "Unpacking the source to $DEST/ProjectAchilles"
  mkdir -p "$DEST"
  tar -xzf "$KIT/ProjectAchilles.tar.gz" -C "$DEST"
fi

cat <<EOF

Done. Next:
  cd "$DEST/ProjectAchilles"
  ./scripts/setup.sh                     # follow the prompts; it starts the stack
  docker compose -f docker-compose.yml -f docker-compose.lab.yml up -d   # adds the lab endpoint
EOF
