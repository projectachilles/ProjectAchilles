#!/usr/bin/env bash
# Appliance build, step 2: Docker CE + compose plugin from Docker's apt repo,
# so the `docker` phase of deploy-server.sh is a no-op on the appliance.
# Runs as root in the Packer build VM (sudo -E).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

log() { echo "20-docker: $*"; }

# Docker's release signing key (https://docs.docker.com/engine/install/ubuntu/).
DOCKER_KEY_FPR=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
KEYRING=/etc/apt/keyrings/docker.asc

log "adding Docker's apt repository"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL --retry 3 https://download.docker.com/linux/ubuntu/gpg -o "$KEYRING.tmp"
GNUPGHOME=$(mktemp -d)
export GNUPGHOME
fprs=$(gpg --show-keys --with-colons "$KEYRING.tmp" 2>/dev/null | awk -F: '$1 == "fpr" {print $10}')
rm -rf "$GNUPGHOME"
if ! grep -qx "$DOCKER_KEY_FPR" <<<"$fprs"; then
	echo "20-docker: Docker apt key fingerprint mismatch (got: $fprs)" >&2
	exit 1
fi
install -m 0644 "$KEYRING.tmp" "$KEYRING"
rm -f "$KEYRING.tmp"

# shellcheck source=/dev/null
codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
echo "deb [arch=amd64 signed-by=$KEYRING] https://download.docker.com/linux/ubuntu $codename stable" \
	>/etc/apt/sources.list.d/docker.list

apt_get() { apt-get -y -o DPkg::Lock::Timeout=600 "$@"; }
apt_get update
apt_get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now containerd.service docker.service
docker version
docker compose version
log "done"
