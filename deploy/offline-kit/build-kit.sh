#!/usr/bin/env bash
# Builds the offline kit: everything a Docker Compose install would download
# on a first start, on one folder you can copy to USB sticks.
#
#   deploy/offline-kit/build-kit.sh [options] [TEST_UUID ...]
#
#   TEST_UUID        tests whose Go modules are pre-downloaded, so Build works
#                    offline (the library itself is always included)
#   --arch LIST      comma-separated: amd64,arm64 (default: both)
#   --library-ref B  test library branch to include (default: main; another
#                    branch also needs TESTS_REPO_BRANCH=B in backend/.env,
#                    or the backend's Sync fails)
#   --out DIR        output folder (default: deploy/offline-kit/out)
#
# Everything comes from HEAD: the images are built from a clean copy of the
# commit, so uncommitted changes and untracked files are never in the kit.
#
# Needs Docker with buildx, network access, and QEMU (binfmt) to build an
# architecture other than this machine's. Output: DIR/achilles-kit/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/deploy/offline-kit"
cd "$ROOT"

ARCHES="amd64,arm64"
LIBRARY_REF="main"
OUT="$HERE/out"
TESTS=()
TESTS_REPO_URL="https://github.com/ubercylon8/f0_library.git"  # server.ts DEFAULT_TESTS_REPO_URL
ORIGIN_URL="https://github.com/projectachilles/ProjectAchilles.git"
BUILDER="achilles-kit"
PROJECT="projectachilles"  # compose project of a checkout named ProjectAchilles

while [ $# -gt 0 ]; do
  case "$1" in
    --arch) ARCHES="${2:?}"; shift 2 ;;
    --library-ref) LIBRARY_REF="${2:?}"; shift 2 ;;
    --out) OUT="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) TESTS+=("$1"); shift ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'build-kit: %s\n' "$*" >&2; exit 1; }

for t in "${TESTS[@]}"; do
  [[ "$t" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || die "not a test UUID: $t"
done
IFS=',' read -ra ARCH_LIST <<<"$ARCHES"
for a in "${ARCH_LIST[@]}"; do
  case "$a" in amd64|arm64) ;; *) die "unsupported --arch: $a" ;; esac
done

if [ -n "$(git status --porcelain)" ]; then
  echo "build-kit: WARNING: uncommitted changes and untracked files are not in the kit (it is built from HEAD)" >&2
fi
COMMIT="$(git rev-parse HEAD)"
TAG="$(git describe --exact-match --tags HEAD 2>/dev/null || true)"
# One library commit for every architecture and retry, recorded in KIT-INFO;
# the image build checks it out exactly (and a new commit busts its cache).
LIBRARY_COMMIT="$(git ls-remote "$TESTS_REPO_URL" "refs/heads/$LIBRARY_REF" | awk '{print $1}')"
[ -n "$LIBRARY_COMMIT" ] || die "test library branch '$LIBRARY_REF' not found in $TESTS_REPO_URL"

KIT="$OUT/achilles-kit"
STAGE="$OUT/.stage"
rm -rf "$KIT" "$STAGE"
mkdir -p "$KIT/images" "$STAGE"

log "Packing the source at ${TAG:-${COMMIT:0:12}}"
SRC="$STAGE/ProjectAchilles"
git init -q "$SRC"
git -C "$SRC" fetch -q --depth 1 "file://$ROOT" "$COMMIT"
git -C "$SRC" checkout -q -b main FETCH_HEAD
[ -z "$TAG" ] || git -C "$SRC" tag "$TAG"
git -C "$SRC" remote add origin "$ORIGIN_URL"
tar -czf "$KIT/ProjectAchilles.tar.gz" -C "$STAGE" ProjectAchilles
AGENT_VERSION="$(sed -n 's/^VERSION[[:space:]]*:\{0,1\}=[[:space:]]*//p' "$SRC/agent/Makefile" | head -1)"
[ -n "$AGENT_VERSION" ] || die "no VERSION in agent/Makefile"

# A docker-container builder: can export tarballs for any platform without
# touching the local image store.
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  docker buildx create --name "$BUILDER" --driver docker-container >/dev/null
fi

bake() {
  ARCH="$1" OUT="$KIT/images" PROJECT="$PROJECT" GIT_COMMIT="$COMMIT" \
  TESTS_REPO_URL="$TESTS_REPO_URL" TESTS_REPO_REF="$LIBRARY_REF" TESTS_REPO_COMMIT="$LIBRARY_COMMIT" \
  KIT_TESTS="${TESTS[*]}" AGENT_VERSION="$AGENT_VERSION" \
    bash -c 'cd "$0" && exec docker buildx bake "$@"' "$SRC" \
    --builder "$BUILDER" --allow "fs.write=$KIT/images" -f deploy/offline-kit/docker-bake.hcl "${@:2}"
}

# One image at a time, each retried: in parallel, several `npm ci` runs on a
# slow connection time out (seen at about 0.7 MB/s). A retry reuses every
# step that already finished (buildx cache).
build_image() { # ARCH TARGET
  local attempt
  for attempt in 1 2 3; do
    log "Building $2 ($1), attempt $attempt"
    bake "$1" "$2" && return 0
  done
  die "$2 ($1) failed 3 times"
}

for a in "${ARCH_LIST[@]}"; do
  for t in elasticsearch es-seed backend frontend wiki; do build_image "$a" "$t"; done
done
build_image amd64 lab-endpoint

cat >"$KIT/images/IMAGES" <<EOF
$PROJECT-backend:latest
$PROJECT-frontend:latest
$PROJECT-wiki:latest
$PROJECT-es-seed:latest
$PROJECT-lab-endpoint:latest
docker.elastic.co/elasticsearch/elasticsearch:8.17.0
EOF
echo "$COMMIT" >"$KIT/images/COMMIT"

cp "$SRC/deploy/offline-kit/kit.sh" "$SRC/deploy/offline-kit/kit.ps1" "$SRC/deploy/offline-kit/START-HERE.md" "$KIT/"
chmod +x "$KIT/kit.sh"
cat >"$KIT/KIT-INFO.txt" <<EOF
ProjectAchilles offline kit
Built:          $(date -u +%Y-%m-%dT%H:%MZ)
Source:         $COMMIT${TAG:+ ($TAG)}
Agent:          $AGENT_VERSION
Test library:   $TESTS_REPO_URL $LIBRARY_REF at $LIBRARY_COMMIT
Preloaded Go modules for: ${TESTS[*]:-none}
Architectures:  ${ARCH_LIST[*]} (lab endpoint: amd64)
EOF

(cd "$KIT" && find . -type f ! -name SHA256SUMS | sed 's|^\./||' | LC_ALL=C sort | xargs sha256sum >SHA256SUMS)
rm -rf "$STAGE"

log "Kit ready: $KIT"
du -sh "$KIT"/images/* "$KIT/ProjectAchilles.tar.gz" | sed 's|'"$KIT"'/||'
du -sh "$KIT"
