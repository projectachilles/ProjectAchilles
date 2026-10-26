#!/usr/bin/env bash
# Offline check that an appliance image is sealed: no identity, no credentials,
# no install state, and the right units enabled. Read-only (guestfish --ro).
# Run inside the builder container: make check-sealed IMAGE=out/<image>
#
# Exit codes: 0 sealed, 1 at least one check failed, 2 usage or tool error.
set -uo pipefail

usage() { echo "usage: $0 <image>" >&2; exit 2; }
[ $# -eq 1 ] || usage
IMG=$1
[ -f "$IMG" ] || { echo "check-sealed: no such image: $IMG" >&2; exit 2; }
command -v guestfish >/dev/null || { echo "check-sealed: guestfish not found" >&2; exit 2; }

BIN=/opt/projectachilles/achilles-installer
MARKER=appliancetest-first-boot-answers
WANTS="/etc/systemd/system/*.wants"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# One guestfish session collects everything. A leading '-' makes a failing
# command (for example a missing path) non-fatal; `echo @@key` delimits output.
start=$(date +%s)
guestfish --ro -a "$IMG" -i >"$tmp/out" 2>"$tmp/err" <<EOS
echo @@ssh_host_keys
-glob-expand /etc/ssh/ssh_host_*
echo @@machine_id
-filesize /etc/machine-id
echo @@cloud_disabled
-is-file /etc/cloud/cloud-init.disabled
echo @@netplan_cloud
-glob-expand /etc/netplan/50-cloud-init.yaml
echo @@netplan_isfile
-is-file /etc/netplan/50-achilles.yaml
echo @@netplan_stat
-stat /etc/netplan/50-achilles.yaml
echo @@getty
-glob-expand $WANTS/getty@tty1.service
echo @@ssh_socket
-glob-expand $WANTS/ssh.socket
echo @@ssh_service
-glob-expand $WANTS/ssh.service
echo @@sshd_alias
-glob-expand /etc/systemd/system/sshd.service
echo @@firstboot_unit
-glob-expand $WANTS/achilles-firstboot.service
echo @@issue_unit
-glob-expand $WANTS/achilles-issue.service
echo @@growroot_unit
-glob-expand $WANTS/achilles-growroot.service
echo @@marker
-is-file /var/lib/projectachilles/firstboot.done
echo @@answers
-is-file /var/lib/projectachilles/test-answers.json
echo @@backend_env
-exists /opt/projectachilles/backend/.env
echo @@root_env
-exists /opt/projectachilles/.env
echo @@deploy_config
-exists /opt/projectachilles/deploy.config.env
echo @@caddy_rendered
-exists /opt/projectachilles/deploy/caddy/rendered
echo @@etc_pa
-exists /etc/projectachilles
echo @@docker_volumes
-ls /var/lib/docker/volumes
echo @@engine_id
-exists /var/lib/docker/engine-id
echo @@seal_pending
-exists /var/lib/projectachilles-seal-pending
echo @@installer
-is-file $BIN
echo @@shadow
-cat /etc/shadow
echo @@group
-cat /etc/group
echo @@cloud_sudoers
-exists /etc/sudoers.d/90-cloud-init-users
echo @@nopasswd
-sh "grep -RhE '^[^#]*(NOPASSWD|!authenticate)' /etc/sudoers /etc/sudoers.d; echo SUDO_GREP_RC=\$?"
echo @@keys_root
-find /root
echo @@keys_home
-find /home
echo @@installer_mode
-download $BIN $tmp/installer.bin
echo @@end
EOS
rc=$?
if [ $rc -ne 0 ] || ! grep -qx '@@end' "$tmp/out"; then
	echo "check-sealed: guestfish failed (exit $rc)" >&2
	cat "$tmp/err" >&2
	exit 2
fi
# Commands run with '-' so a missing path is not fatal. Anything on stderr
# other than "No such file or directory" is a real tool error, never "clean".
unexpected=$(grep -v 'No such file or directory' "$tmp/err" | grep -v '^[[:space:]]*$')
if [ -n "$unexpected" ]; then
	echo "check-sealed: unexpected guestfish errors:" >&2
	echo "$unexpected" >&2
	exit 2
fi

# sec <key>: the output between @@key and the next marker.
sec() { awk -v k="@@$1" '/^@@/ { on = ($0 == k); next } on' "$tmp/out"; }

fails=0
ok() { echo "ok: $1"; }
fail() { echo "FAIL: $1 ($2)"; fails=$((fails + 1)); }
# expect_true <key> <what> <detail-if-false>
expect_true() { if [ "$(sec "$1")" = true ]; then ok "$2"; else fail "$2" "$3"; fi; }
expect_false() { if [ "$(sec "$1")" = false ]; then ok "$2"; else fail "$2" "$3"; fi; }
# expect_none <key> <what>: section must be empty
expect_none() {
	local v; v=$(sec "$1")
	if [ -z "$v" ]; then ok "$2"; else fail "$2" "found: $(echo "$v" | tr '\n' ' ')"; fi
}
expect_some() {
	local v; v=$(sec "$1")
	if [ -n "$v" ]; then ok "$2"; else fail "$2" "not enabled: no symlink in $WANTS"; fi
}

# identity
expect_none ssh_host_keys "no /etc/ssh/ssh_host_* keys"
mid=$(sec machine_id)
if [ "$mid" = 0 ]; then ok "/etc/machine-id is empty"
else fail "/etc/machine-id is empty" "${mid:-missing}"; fi

# cloud-init
expect_true cloud_disabled "cloud-init disabled (/etc/cloud/cloud-init.disabled)" "marker file missing"
expect_none netplan_cloud "no /etc/netplan/50-cloud-init.yaml"

# netplan
if [ "$(sec netplan_isfile)" = true ]; then
	mode=$(sec netplan_stat | awk '$1 == "mode:" {print $2}')
	if [ -n "$mode" ] && [ $((mode & 4095)) -eq 384 ]; then
		ok "/etc/netplan/50-achilles.yaml is mode 0600"
	else
		fail "/etc/netplan/50-achilles.yaml is mode 0600" "mode $(printf '%o' $((mode & 4095)) 2>/dev/null)"
	fi
else
	fail "/etc/netplan/50-achilles.yaml is mode 0600" "file missing"
fi

# units
expect_none getty "getty@tty1 not enabled"
expect_none ssh_socket "ssh.socket not enabled"
expect_none ssh_service "ssh.service not enabled"
expect_none sshd_alias "sshd.service alias absent (ssh not enabled)"
expect_some firstboot_unit "achilles-firstboot.service enabled"
expect_some issue_unit "achilles-issue.service enabled"
expect_some growroot_unit "achilles-growroot.service enabled"

# no install state
expect_false marker "no first-boot marker (/var/lib/projectachilles/firstboot.done)" "marker present"
expect_false answers "no test answers file" "/var/lib/projectachilles/test-answers.json present"
expect_false backend_env "no backend/.env" "present"
expect_false root_env "no root .env" "present"
expect_false deploy_config "no deploy.config.env" "present"
expect_false caddy_rendered "no deploy/caddy/rendered/" "present"
expect_false etc_pa "no /etc/projectachilles" "present"
vols=$(sec docker_volumes | grep -vxE 'backingFsBlockDev|metadata\.db')
if [ -z "$vols" ]; then ok "no Docker volumes"; else fail "no Docker volumes" "$(echo "$vols" | tr '\n' ' ')"; fi
expect_false engine_id "no Docker engine-id (/var/lib/docker/engine-id)" "present: shared by every clone"
expect_false seal_pending "shutdown-time seal completed (no /var/lib/projectachilles-seal-pending)" "marker present: seal-final failed or never ran"

# installer binary
if [ "$(sec installer)" = true ]; then
	ok "installer binary present ($BIN)"
	if [ ! -f "$tmp/installer.bin" ]; then
		echo "check-sealed: could not read $BIN from the image" >&2; exit 2
	fi
	n=$(grep -ac "$MARKER" "$tmp/installer.bin")
	if [ "$n" = 0 ]; then ok "installer binary is not the test build"
	else fail "installer binary is not the test build" "contains $MARKER"; fi
else
	fail "installer binary present ($BIN)" "missing"
	fail "installer binary is not the test build" "binary missing"
fi

# credentials
for u in achilles root; do
	line=$(sec shadow | awk -F: -v u="$u" '$1 == u {print $2; found=1} END {if (!found) print "@@missing"}')
	case $line in
		@@missing) fail "$u password locked" "user missing" ;;
		'!'* | '*'*) ok "$u password locked" ;;
		*) fail "$u password locked" "shadow field does not start with ! or *" ;;
	esac
done
if sec group | awk -F: '$1 == "sudo" {n = split($4, m, ","); for (i = 1; i <= n; i++) if (m[i] == "achilles") f = 1} END {exit !f}'; then
	ok "achilles is in group sudo"
else
	fail "achilles is in group sudo" "not a member"
fi
expect_false cloud_sudoers "no /etc/sudoers.d/90-cloud-init-users" "present"
src=$(sec nopasswd)
case $(echo "$src" | grep -x 'SUDO_GREP_RC=[0-9]*') in
	SUDO_GREP_RC=0 | SUDO_GREP_RC=1) ;;
	*) echo "check-sealed: sudoers grep did not run cleanly in the image" >&2; exit 2 ;;
esac
hits=$(echo "$src" | grep -vx 'SUDO_GREP_RC=[0-9]*')
if [ -z "$hits" ]; then ok "no NOPASSWD or !authenticate in sudoers"
else fail "no NOPASSWD or !authenticate in sudoers" "$(echo "$hits" | tr '\n' ' ')"; fi
keys=$( { sec keys_root; sec keys_home; } | grep -E '(^|/)authorized_keys2?$')
if [ -z "$keys" ]; then ok "no authorized_keys under /root or /home"
else fail "no authorized_keys under /root or /home" "$(echo "$keys" | tr '\n' ' ')"; fi

echo "check-sealed: $fails failure(s) in $(( $(date +%s) - start ))s"
[ "$fails" -eq 0 ]
