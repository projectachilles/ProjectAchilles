#!/usr/bin/env bash
# Download the Ubuntu cloud image into <outdir> and verify it against the
# SHA256SUMS published in the same directory. Skips the download when the
# file already exists and verifies.
# Usage: fetch-base-image.sh <outdir> <base-url> <image-name>
set -euo pipefail

out=${1:?outdir}
url=${2:?base url}
img=${3:?image name}

cd "$out"

# Always refresh the checksum list: it is tiny and tells us what is current.
curl -fsSL -o SHA256SUMS "$url/SHA256SUMS"
line=$(grep -F " *$img" SHA256SUMS || true)
if [ -z "$line" ]; then
  echo "fetch-base-image: $img not listed in SHA256SUMS" >&2
  exit 1
fi

verify() { printf '%s\n' "$line" | sha256sum -c - >/dev/null 2>&1; }

if [ -f "$img" ] && verify; then
  echo "fetch-base-image: $img already present and verified"
  exit 0
fi

curl -fsSL --retry 3 -o "$img" "$url/$img"
if ! verify; then
  echo "fetch-base-image: checksum mismatch for $img" >&2
  rm -f "$img"
  exit 1
fi
echo "fetch-base-image: $img downloaded and verified"
