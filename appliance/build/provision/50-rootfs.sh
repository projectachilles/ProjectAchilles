#!/usr/bin/env bash
# Appliance build, step 5: install appliance/rootfs (first-boot, banner and
# growroot units, the login hook, the default netplan), hand the network to
# our netplan file instead of cloud-init, and set which units start.
# Runs as root in the Packer build VM. Reads /tmp/rootfs.
set -euo pipefail

log() { echo "50-rootfs: $*"; }
die() { echo "50-rootfs: $*" >&2; exit 1; }

SRC=/tmp/rootfs
NETPLAN=/etc/netplan/50-achilles.yaml
UNITS=(achilles-firstboot.service achilles-issue.service achilles-growroot.service)

[ -d "$SRC/etc" ] || die "$SRC/etc missing (rootfs upload)"
umask 022

# Plain `cp -R` (no -a/-p): files and new directories land root-owned with
# the uploaded mode masked by umask, and existing directories such as /etc
# keep their own owner and mode.
log "copying $SRC to /"
cp -R "$SRC/." /
# git does not keep these modes; set them explicitly.
chmod 0600 "$NETPLAN"
chmod 0755 /usr/local/lib/projectachilles /usr/local/lib/projectachilles/growroot.sh
for u in "${UNITS[@]}"; do chmod 0644 "/etc/systemd/system/$u"; done
chmod 0644 /etc/profile.d/achilles-appliance.sh

log "taking the network away from cloud-init"
rm -f /etc/netplan/50-cloud-init.yaml
cat >/etc/cloud/cloud.cfg.d/99-achilles-no-network.cfg <<'EOF'
# ProjectAchilles appliance: /etc/netplan/50-achilles.yaml owns the network.
network: {config: disabled}
EOF
touch /etc/cloud/cloud-init.disabled
netplan generate

log "enabling the appliance units"
systemctl daemon-reload
systemctl enable "${UNITS[@]}"
# First boot owns tty1 (Conflicts=getty@tty1) and enables SSH itself.
systemctl disable getty@tty1.service ssh.socket ssh.service

# Assertions.
[ "$(stat -c '%a' "$NETPLAN")" = 600 ] || die "$NETPLAN is not 0600"
for u in "${UNITS[@]}"; do
	[ -f "/etc/systemd/system/$u" ] || die "/etc/systemd/system/$u missing"
	[ "$(systemctl is-enabled "$u")" = enabled ] || die "$u not enabled"
done
for u in getty@tty1.service ssh.socket ssh.service; do
	state=$(systemctl is-enabled "$u" 2>/dev/null || true)
	case $state in
	enabled | enabled-runtime) die "$u is $state" ;;
	esac
done
[ ! -e /etc/systemd/system/sshd.service ] || die "sshd.service alias still present"
[ ! -e /etc/netplan/50-cloud-init.yaml ] || die "50-cloud-init.yaml still present"
log "done"
