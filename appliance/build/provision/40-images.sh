#!/usr/bin/env bash
# Appliance build, step 4: pre-build backend and frontend and pull every other
# image docker-compose.server.yml needs, so the first install reuses them
# (deploy-server.sh prebuilt_reuse_blocker) and works offline. The stack is
# never started: no `up`, no volumes. Runs as root in the Packer build VM.
set -euo pipefail

log() { echo "40-images: $*"; }
die() { echo "40-images: $*" >&2; exit 1; }

: "${ACHILLES_COMMIT:?ACHILLES_COMMIT must be set}"
REPO=/opt/projectachilles
PROJECT=achilles-server
COMPOSE_FILE=docker-compose.server.yml
BUILT=("$PROJECT-backend" "$PROJECT-frontend")
REQUIRED=(caddy:2.10.0-alpine docker.elastic.co/elasticsearch/elasticsearch:8.17.0 python:3.12-slim)

cd "$REPO"
[ ! -e backend/.env ] || die "backend/.env already exists"
[ ! -e .env ] || die ".env already exists"

# Minimum for `docker compose config`, found by running it: the backend's
# env_file must exist (an empty file will do) and ACHILLES_DOMAIN must be set
# (`:?`). Everything else has a default. Nothing goes in a root .env.
cleanup() { rm -f "$REPO/backend/.env"; }
trap cleanup EXIT
: >backend/.env
export ACHILLES_DOMAIN=appliance.invalid
compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"; }
compose config --quiet

log "building backend and frontend at $ACHILLES_COMMIT"
ACHILLES_GIT_COMMIT=$ACHILLES_COMMIT compose build backend frontend

log "pulling the remaining images"
mapfile -t images < <(compose --profile elasticsearch config --images | sort -u)
[ "${#images[@]}" -gt 0 ] || die "compose listed no images"
for img in "${images[@]}"; do
	case " ${BUILT[*]} " in
	*" $img "*) continue ;;
	esac
	docker pull --quiet "$img"
done
for img in "${REQUIRED[@]}"; do
	docker image inspect "$img" >/dev/null || die "required image $img missing"
done

log "pruning the build cache"
docker builder prune -af

cleanup
trap - EXIT

# Assertions: nothing left in the tree, nothing started, labels match.
for f in backend/.env .env deploy.config.env deploy/caddy/rendered; do
	[ ! -e "$f" ] || die "$f left behind"
done
dirty=$(git status --porcelain --untracked-files=all)
[ -z "$dirty" ] || die "tree not clean: $dirty"
[ -z "$(docker ps -aq)" ] || die "containers exist; the stack must never start in the image"
[ -z "$(docker volume ls -q)" ] || die "docker volumes exist"
for img in "${BUILT[@]}"; do
	label=$(docker image inspect --format '{{ index .Config.Labels "io.projectachilles.commit" }}' "$img")
	[ "$label" = "$ACHILLES_COMMIT" ] || die "$img label is '$label', expected $ACHILLES_COMMIT"
done
docker image ls
log "done"
