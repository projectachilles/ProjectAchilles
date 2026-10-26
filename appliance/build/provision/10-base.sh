#!/usr/bin/env bash
# Appliance build, step 1: base packages, unattended security updates, UTC.
# Runs as root in the Packer build VM (sudo -E).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

log() { echo "10-base: $*"; }

# cloud-init (user, password, growpart) must be finished before apt runs.
log "waiting for cloud-init"
cloud-init status --wait >/dev/null || {
	rc=$?
	# 2 = finished with recoverable errors (degraded); anything else is fatal.
	[ "$rc" -eq 2 ] || { cloud-init status --long >&2; exit "$rc"; }
	log "cloud-init finished degraded (rc 2); continuing"
}

# Keep apt's daily timers out of the way for the rest of the build.
systemctl stop apt-daily.timer apt-daily-upgrade.timer \
	apt-daily.service apt-daily-upgrade.service unattended-upgrades.service 2>/dev/null || true

apt_get() { apt-get -y -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confold "$@"; }

log "apt upgrade"
apt_get update
apt_get dist-upgrade
apt_get install --no-install-recommends \
	linux-cloud-tools-virtual open-vm-tools cloud-guest-utils console-setup kbd \
	iputils-ping unattended-upgrades
apt_get autoremove --purge

# Unattended upgrades: the security pocket only, never an automatic reboot.
# `#clear` drops the stock origins (release pocket, ESM) from 50unattended-upgrades.
log "configuring unattended-upgrades"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat >/etc/apt/apt.conf.d/51achilles-unattended-upgrades <<'EOF'
// ProjectAchilles appliance: security updates only, no automatic reboot.
#clear Unattended-Upgrade::Allowed-Origins;
#clear Unattended-Upgrade::Origins-Pattern;
Unattended-Upgrade::Allowed-Origins {
	"${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
EOF
# Assert the effective config: exactly one origin (security), no patterns.
got=$(apt-config dump | grep -E '^Unattended-Upgrade::(Allowed-Origins|Origins-Pattern|Automatic-Reboot)')
# shellcheck disable=SC2016 # literal apt variables, expanded by unattended-upgrades
want='Unattended-Upgrade::Allowed-Origins "";
Unattended-Upgrade::Allowed-Origins:: "${distro_id}:${distro_codename}-security";
Unattended-Upgrade::Automatic-Reboot "false";'
if [ "$got" != "$want" ]; then
	printf '10-base: unexpected unattended-upgrades config:\n%s\n' "$got" >&2
	exit 1
fi
systemctl enable unattended-upgrades.service

log "timezone UTC"
timedatectl set-timezone UTC
[ "$(timedatectl show -p Timezone --value)" = UTC ]

log "done"
