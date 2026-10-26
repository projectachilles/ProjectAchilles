#!/usr/bin/env bash
# Appliance build, step 3: the repo checkout and the installer binary, in the
# layout install-onprem.sh produces. Runs as root in the Packer build VM.
# Needs ACHILLES_COMMIT; reads /tmp/repo.bundle and /tmp/achilles-installer.
set -euo pipefail

log() { echo "30-repo: $*"; }
die() { echo "30-repo: $*" >&2; exit 1; }

: "${ACHILLES_COMMIT:?ACHILLES_COMMIT must be set}"
REPO=/opt/projectachilles
ORIGIN=https://github.com/projectachilles/ProjectAchilles.git
BUNDLE=/tmp/repo.bundle
BIN_SRC=/tmp/achilles-installer

[ ! -e "$REPO" ] || die "$REPO already exists"
umask 022

log "cloning the bundle into $REPO"
# The bundle holds only HEAD (the build commit) and the v<x>.<y>.<z> tags
# merged into it (Makefile repo-bundle).
git -c advice.detachedHead=false clone --quiet "$BUNDLE" "$REPO"
git -C "$REPO" remote set-url origin "$ORIGIN"
git -C "$REPO" -c advice.detachedHead=false checkout --quiet --detach "$ACHILLES_COMMIT"
# Nothing of the build host's may ship: no branch refs, no branch config,
# no reflog naming them, no unreachable objects (`upgrade` works from tags;
# the next `git fetch` brings origin's branches).
git -C "$REPO" remote set-head origin -d 2>/dev/null || true
git -C "$REPO" for-each-ref --format='delete %(refname)' refs/heads/ refs/remotes/ |
	git -C "$REPO" update-ref --stdin
{ git -C "$REPO" config --local --name-only --get-regexp '^branch\.' || true; } |
	sed 's/\.[^.]*$//' | sort -u | while read -r sec; do
		git -C "$REPO" config --local --remove-section "$sec"
	done
log "expiring reflogs and repacking"
git -C "$REPO" reflog expire --expire=now --all
git -C "$REPO" gc --quiet --prune=now --aggressive

log "installing the installer binary"
install -m 0755 -o root -g root "$BIN_SRC" "$REPO/achilles-installer"
ln -sfn "$REPO/achilles-installer" /usr/local/bin/achilles-installer

chown root:root "$REPO"
chmod 0755 "$REPO"

# Assertions: the image must hold exactly the build commit, clean, with tags.
head=$(git -C "$REPO" rev-parse HEAD)
[ "$head" = "$ACHILLES_COMMIT" ] || die "HEAD is $head, expected $ACHILLES_COMMIT"
[ "$(git -C "$REPO" remote get-url origin)" = "$ORIGIN" ] || die "origin is not $ORIGIN"
[ -n "$(git -C "$REPO" tag -l)" ] || die "no tags in $REPO"
others=$(git -C "$REPO" for-each-ref --format='%(refname)' | grep -v '^refs/tags/' || true)
[ -z "$others" ] || die "refs other than tags left in $REPO: $others"
! git -C "$REPO" symbolic-ref -q HEAD >/dev/null || die "HEAD is not detached"
[ -z "$(git -C "$REPO" config --local --get-regexp '^branch\.' || true)" ] || die "branch config left"
[ -z "$(git -C "$REPO" reflog)" ] || die "reflog not empty"
counts=$(git -C "$REPO" count-objects -v)
stored=$(awk '$1 == "count:" || $1 == "in-pack:" {n += $2} END {print n}' <<<"$counts")
reachable=$(git -C "$REPO" rev-list --objects HEAD --tags | wc -l)
[ "$stored" -eq "$reachable" ] || die "$stored objects stored, $reachable reachable from HEAD and tags"
log "objects: $stored stored = $reachable reachable"
dirty=$(git -C "$REPO" status --porcelain --untracked-files=all)
[ -z "$dirty" ] || die "tree not clean: $dirty"
[ "$(stat -c '%U:%G %a' "$REPO")" = "root:root 755" ] || die "$REPO is not root:root 0755"
[ "$(stat -c '%a' "$REPO/achilles-installer")" = 755 ] || die "installer is not 0755"
"$REPO/achilles-installer" --version
log "done: $(git -C "$REPO" describe --tags --always) ($head)"
