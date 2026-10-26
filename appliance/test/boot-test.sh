#!/usr/bin/env bash
# Boot test of an appliance image (spec 10.1). Run through
# `make -C appliance boot-test MODE=quick|full [IMAGE=out/<image>.qcow2]`,
# which builds the appliancetest installer and runs this script in the builder
# container, from appliance/.
#
#   boot-test.sh <image.qcow2> <test-binary> <quick|full>
#
# Needs BUILD_COMMIT: the commit the image was built from (the Makefile takes
# it from the image name).
#
# Two VMs boot from throwaway qcow2 overlays of the image, one at a time. Each
# overlay gets test/answers.json (first boot replays it instead of showing the
# console) and the appliancetest installer binary; the image itself is never
# written. Everything a run leaves is in out/boot-test/, which is emptied first.
#
# quick: first boot completes (SSH comes up), the served host key is the one
#   the handoff showed, the units are switched over, / fills the disk, the
#   checkout is clean at BUILD_COMMIT, both images carry its label, Docker
#   regenerated the IDs the seal removed, and after a reboot the console
#   getty runs and first boot doesn't. Finally the two VMs must not share a
#   machine-id, a host key or a Docker engine ID.
# full: also installs on VM1 (it must reuse the pre-built images), seeds a
#   marker into each data volume, backs it up, and restores that backup on
#   VM2, which was never installed. VM2 must come up the same way: Caddy
#   serving the frontend, the markers, the Caddy root CA, the pinned .env
#   values and the rendered Caddy config all equal to VM1's.
#
# Any failed check prints the VM's serial-log tail and exits 1.
set -euo pipefail

usage() { echo "usage: $0 <image.qcow2> <test-binary> <quick|full>" >&2; exit 2; }
[ $# -eq 3 ] || usage
IMAGE=$(realpath "$1")
TEST_BIN=$(realpath "$2")
MODE=$3
case $MODE in quick | full) ;; *) usage ;; esac
: "${BUILD_COMMIT:?BUILD_COMMIT must be set (the commit the image was built from)}"
[ -f "$IMAGE" ] || { echo "boot-test: no such image: $IMAGE" >&2; exit 2; }
[ -x "$TEST_BIN" ] || { echo "boot-test: no test binary: $TEST_BIN" >&2; exit 2; }

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ANSWERS=$HERE/answers.json
INSTALL_ENV=$HERE/install.env
WORK=$(pwd)/out/boot-test
# Overridable for debugging only; the spec's limit is 15 minutes.
SSH_WAIT=${SSH_WAIT:-900}
OVMF_CODE=/usr/share/OVMF/OVMF_CODE_4M.fd
OVMF_VARS=/usr/share/OVMF/OVMF_VARS_4M.fd

# Guest paths (installer/internal/firstboot).
ANSWERS_PATH=/var/lib/projectachilles/test-answers.json
HANDOFF_PATH=/var/lib/projectachilles/test-handoff.json
MARKER_PATH=/var/lib/projectachilles/firstboot.done
BIN_PATH=/opt/projectachilles/achilles-installer
REPO=/opt/projectachilles
COMPOSE="docker compose -f $REPO/docker-compose.server.yml"
LABEL=io.projectachilles.commit
BUILT_IMAGES=(achilles-server-backend achilles-server-frontend)
# What QEMU's user-mode network leases the guest; install.env binds Caddy to it.
GUEST_IP=10.0.2.15

PW=$(jq -er .password "$ANSWERS")
export SSHPASS=$PW

T0=$(date +%s)
CUR=""      # the VM the next failure is about
QEMU_PID="" # the running VM, if any

log() { printf '[%4ds] %s\n' "$(($(date +%s) - T0))" "$*"; }

fail() {
	echo "boot-test: FAIL${CUR:+ (vm$CUR)}: $*" >&2
	if [ -n "$CUR" ] && [ -f "$WORK/vm$CUR.serial.log" ]; then
		echo "---- vm$CUR serial log, last 60 lines ($WORK/vm$CUR.serial.log) ----" >&2
		# Without colour codes and spinner redraws.
		tail -n 300 "$WORK/vm$CUR.serial.log" | tr '\r' '\n' |
			sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | grep -v '^[[:space:]]*$' | tail -n 60 >&2 || true
		echo "---- end of serial log ----" >&2
	fi
	exit 1
}

kill_vm() {
	if [ -n "$QEMU_PID" ] && kill -0 "$QEMU_PID" 2>/dev/null; then
		kill "$QEMU_PID" 2>/dev/null || true
		wait "$QEMU_PID" 2>/dev/null || true
	fi
	QEMU_PID=""
}
trap kill_vm EXIT

port() { echo $((2220 + $1)); }

# A connection open when the guest resets gets no RST through QEMU's user
# network: the server-alive probes end it after 30s instead of never.
ssh_opts() {
	echo -o StrictHostKeyChecking=accept-new \
		-o "UserKnownHostsFile=$WORK/vm$1.known_hosts" \
		-o HostKeyAlgorithms=ssh-ed25519 \
		-o PreferredAuthentications=password -o PubkeyAuthentication=no \
		-o ConnectTimeout=5 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 \
		-o LogLevel=ERROR -p "$(port "$1")"
}

# vm_ssh I CMD: run CMD as achilles on VM I (no stdin).
vm_ssh() {
	local i=$1
	shift
	# shellcheck disable=SC2046 # ssh_opts is a list of words
	sshpass -e ssh $(ssh_opts "$i") achilles@127.0.0.1 "$@" </dev/null
}

# vm_root I SCRIPT: run SCRIPT as root on VM I through sudo (the admin has a
# password and no NOPASSWD). The password and then the script go on stdin;
# sudo -k always asks, so the password line is never read as a command, and
# the braces make bash read the whole script before running it with stdin
# from /dev/null.
vm_root() {
	local i=$1 script=$2
	# shellcheck disable=SC2046
	printf '%s\n{\nset -euo pipefail\n%s\n} </dev/null\n' "$PW" "$script" |
		sshpass -e ssh $(ssh_opts "$i") achilles@127.0.0.1 "sudo -k -S -p '' bash -s"
}

# vm_upload I SRC DEST: copy SRC to DEST (owned by achilles, mode 0600) on VM I.
vm_upload() {
	# shellcheck disable=SC2046
	sshpass -e ssh $(ssh_opts "$1") achilles@127.0.0.1 "umask 077 && cat >'$3'" <"$2"
}

prepare_vm() {
	local i=$1
	CUR=$i
	log "vm$i: overlay and injections"
	qemu-img create -q -f qcow2 -b "$IMAGE" -F qcow2 "$WORK/vm$i.qcow2" 100G
	cp "$OVMF_VARS" "$WORK/vm$i.vars.fd"
	# Staged so the guest gets root-owned files (an upload keeps owner and mode).
	local inj=$WORK/inject
	if [ ! -d "$inj" ]; then
		mkdir -p "$inj"
		install -m 0600 -o root -g root "$ANSWERS" "$inj/test-answers.json"
		install -m 0755 -o root -g root "$TEST_BIN" "$inj/achilles-installer"
	fi
	# --mkdir /opt/projectachilles is a no-op on an appliance image; it lets a
	# plain cloud image boot too, so the harness's own failure path is testable.
	virt-customize -q -a "$WORK/vm$i.qcow2" \
		--mkdir /var/lib/projectachilles --mkdir /opt/projectachilles \
		--upload "$inj/test-answers.json:$ANSWERS_PATH" \
		--upload "$inj/achilles-installer:$BIN_PATH" ||
		fail "virt-customize could not inject into the overlay"
}

start_vm() {
	local i=$1
	CUR=$i
	rm -f "$WORK/vm$i.known_hosts"
	log "vm$i: booting (UEFI, 4 vCPU, 8 GiB, ssh on port $(port "$i"))"
	qemu-system-x86_64 -enable-kvm -machine q35 -cpu host -m 8192 -smp 4 \
		-drive "if=pflash,format=raw,unit=0,readonly=on,file=$OVMF_CODE" \
		-drive "if=pflash,format=raw,unit=1,file=$WORK/vm$i.vars.fd" \
		-drive "file=$WORK/vm$i.qcow2,if=virtio,format=qcow2,discard=unmap" \
		-nic "user,model=virtio-net-pci,hostfwd=tcp::$(port "$i")-:22" \
		-serial "file:$WORK/vm$i.serial.log" -display none -monitor none \
		>"$WORK/vm$i.qemu.log" 2>&1 &
	QEMU_PID=$!
}

# wait_ssh I [BOOT_ID]: wait up to SSH_WAIT for a password login; with
# BOOT_ID, also for the VM to be on another boot (after a reboot).
wait_ssh() {
	local i=$1 old=${2:-} deadline=$(($(date +%s) + SSH_WAIT)) id
	while :; do
		kill -0 "$QEMU_PID" 2>/dev/null ||
			fail "QEMU exited: $(tail -n 5 "$WORK/vm$i.qemu.log" 2>/dev/null)"
		if id=$(vm_ssh "$i" cat /proc/sys/kernel/random/boot_id 2>/dev/null) &&
			[ -n "$id" ] && [ "$id" != "$old" ]; then
			return 0
		fi
		[ "$(date +%s)" -lt "$deadline" ] ||
			fail "no SSH login as achilles within ${SSH_WAIT}s (first boot never completed?)"
		sleep 5
	done
}

stop_vm() {
	local i=$1 n
	log "vm$i: powering off"
	vm_root "$i" "systemctl poweroff" >/dev/null 2>&1 || true
	for ((n = 0; n < 60; n++)); do
		kill -0 "$QEMU_PID" 2>/dev/null || break
		sleep 2
	done
	kill_vm
}

# indent I: prefix each line of stdin with the VM's tag.
indent() { sed "s/^/[vm$1]   /"; }

expect_eq() { # what got want
	[ "$2" = "$3" ] || fail "$1: got '$2', want '$3'"
	log "vm$CUR: ok: $1 = $3"
}

# --- quick checks ----------------------------------------------------------

declare -A MACHINE_ID FPR ENGINE_ID HANDOFF_IP

quick_checks() {
	local i=$1 out fp handoff
	log "vm$i: SSH is up: first boot completed"

	handoff=$(vm_root "$i" "cat $HANDOFF_PATH") || fail "no handoff file $HANDOFF_PATH"
	fp=$(ssh-keygen -lf "$WORK/vm$i.known_hosts" | awk '{print $2}')
	[ -n "$fp" ] || fail "no host key recorded in known_hosts"
	expect_eq "served ED25519 host key vs the handoff's" "$fp" "$(jq -r .Fingerprint <<<"$handoff")"
	FPR[$i]=$fp
	HANDOFF_IP[$i]=$(jq -r .IP <<<"$handoff")
	log "vm$i: handoff: $handoff"

	out=$(vm_ssh "$i" "systemctl is-enabled achilles-firstboot.service getty@tty1.service" || true)
	expect_eq "is-enabled achilles-firstboot, getty@tty1" "$(echo "$out" | paste -sd' ')" "disabled enabled"

	out=$(vm_ssh "$i" "df -B1 --output=size / | tail -n 1" | tr -d ' ')
	[ "$out" -gt $((90 * 1024 * 1024 * 1024)) ] || fail "/ is $out bytes, not larger than 90 GiB"
	log "vm$CUR: ok: / is $((out / 1024 / 1024 / 1024)) GiB"

	out=$(vm_root "$i" "git -C $REPO status --porcelain") || fail "git status failed"
	[ -z "$out" ] || fail "checkout not clean: $out"
	log "vm$CUR: ok: checkout clean"
	expect_eq "checkout HEAD" "$(vm_root "$i" "git -C $REPO rev-parse HEAD")" "$BUILD_COMMIT"
	for img in "${BUILT_IMAGES[@]}"; do
		expect_eq "$img label" \
			"$(vm_root "$i" "docker image inspect --format '{{ index .Config.Labels \"$LABEL\" }}' $img")" \
			"$BUILD_COMMIT"
	done
	out=$(vm_root "$i" "docker image ls --filter label=$LABEL --format '{{.Repository}}' | sort -u | paste -sd' '")
	expect_eq "images labelled $LABEL" "$out" "${BUILT_IMAGES[*]}"

	# Docker identity the seal removed must be back (regenerated at start).
	out=$(vm_ssh "$i" "systemctl is-active docker.service containerd.service" | paste -sd' ' || true)
	expect_eq "docker, containerd" "$out" "active active"
	out=$(vm_root "$i" "docker info --format '{{.ID}}'")
	[ -n "$out" ] || fail "docker info reports no engine ID"
	ENGINE_ID[$i]=$(vm_root "$i" "cat /var/lib/docker/engine-id") || fail "/var/lib/docker/engine-id missing"
	expect_eq "docker info engine ID vs /var/lib/docker/engine-id" "$out" "${ENGINE_ID[$i]}"
	vm_root "$i" "test -s /var/lib/containerd/io.containerd.grpc.v1.introspection/uuid" ||
		fail "containerd introspection uuid missing"
	vm_root "$i" "test -s /var/lib/docker/network/files/local-kv.db" ||
		fail "libnetwork local-kv.db missing"
	log "vm$CUR: ok: containerd uuid and libnetwork store regenerated"
	out=$(vm_root "$i" "docker network ls --format '{{.Name}}' | sort | paste -sd' '")
	expect_eq "docker networks" "$out" "bridge host none"

	MACHINE_ID[$i]=$(vm_ssh "$i" "cat /etc/machine-id")
	[ -n "${MACHINE_ID[$i]}" ] || fail "/etc/machine-id is empty"

	# Reboot: SSH (same host key: known_hosts would refuse another) and the
	# getty come back, and first boot stays done.
	local marker boot replays
	marker=$(vm_ssh "$i" "cat $MARKER_PATH") || fail "no first-boot marker"
	[ -n "$marker" ] || fail "the first-boot marker $MARKER_PATH is empty"
	# The two probes used after the reboot must see this boot's first boot,
	# or "did not run again" would prove nothing.
	out=$(vm_ssh "$i" "systemctl show -P InvocationID achilles-firstboot.service")
	[ -n "$out" ] || fail "achilles-firstboot has no invocation on the first boot"
	replays="journalctl -b 0 -q -o cat -u achilles-firstboot.service | grep -c appliancetest-first-boot-answers || true"
	out=$(vm_root "$i" "$replays")
	[ "$out" -ge 1 ] || fail "the journal shows no answers-file replay on the first boot"
	log "vm$CUR: ok: first boot ran from the answers file ($out start(s))"
	boot=$(vm_ssh "$i" cat /proc/sys/kernel/random/boot_id)
	log "vm$i: rebooting"
	vm_root "$i" "reboot" >/dev/null 2>&1 || true
	wait_ssh "$i" "$boot"
	log "vm$i: back after the reboot"
	out=$(vm_ssh "$i" "systemctl is-active getty@tty1.service" || true)
	expect_eq "getty@tty1 after reboot" "$out" "active"
	vm_ssh "$i" "test -s /etc/issue.d/50-achilles.issue" || fail "/etc/issue.d/50-achilles.issue missing"
	log "vm$CUR: ok: console banner present"
	out=$(vm_ssh "$i" "cat $MARKER_PATH") || fail "no first-boot marker after the reboot"
	[ -n "$out" ] || fail "the first-boot marker $MARKER_PATH is empty after the reboot"
	[ "$out" = "$marker" ] || fail "first-boot marker changed: '$out', was '$marker'"
	log "vm$CUR: ok: first-boot marker after reboot = $(paste -sd' ' <<<"$marker")"
	out=$(vm_ssh "$i" "systemctl show -P InvocationID achilles-firstboot.service")
	expect_eq "achilles-firstboot runs this boot" "${out:-none}" "none"
	out=$(vm_root "$i" "$replays")
	expect_eq "first-boot answer replays this boot" "$out" "0"
}

# --- full mode ---------------------------------------------------------------

# compose_running I: every long-running compose service (restart policy other
# than "no"; es-seed is a one-shot) is running, within 5 minutes.
compose_running() {
	local i=$1 want got n
	want=$(vm_root "$i" "$COMPOSE config --format json" |
		jq -r '.services | to_entries[] | select((.value.restart // "no") != "no") | .key' | sort | paste -sd' ')
	[ -n "$want" ] || fail "compose lists no long-running services"
	for ((n = 0; n < 30; n++)); do
		got=$(vm_root "$i" "$COMPOSE ps --status running --format '{{.Service}}'" | sort | paste -sd' ')
		[ "$got" = "$want" ] && break
		sleep 10
	done
	vm_root "$i" "$COMPOSE ps -a --format '{{.Service}}: {{.State}} {{.Status}}'" | indent "$i"
	expect_eq "running compose services" "$got" "$want"
}

# backend_health I: if the backend container turns healthy within 5 minutes,
# the API must answer through Caddy. Placeholder Clerk keys may keep it
# unhealthy, which spec 10.1 allows.
backend_health() {
	local i=$1 st n
	for ((n = 0; n < 30; n++)); do
		st=$(vm_root "$i" "docker inspect --format '{{.State.Health.Status}}' \$($COMPOSE ps -q backend)")
		[ "$st" = starting ] || break
		sleep 10
	done
	if [ "$st" = healthy ]; then
		st=$(vm_root "$i" "curl -fsk --max-time 20 https://achilles.test/api/health") ||
			fail "the backend is healthy but https://achilles.test/api/health failed"
		log "vm$CUR: ok: https://achilles.test/api/health: $st"
	else
		log "vm$CUR: WARN: backend health is '$st' (allowed with placeholder Clerk keys, spec 10.1)"
		vm_root "$i" "$COMPOSE logs --tail 15 backend" | indent "$i" || true
	fi
}

# caddy_frontend I: Caddy serves the frontend at https://achilles.test/ (HTTP
# 200, within 2 minutes). Unconditional: unlike the API, it doesn't depend on
# the placeholder Clerk keys. achilles.test resolves through the engine's
# /etc/hosts entry.
caddy_frontend() {
	local i=$1 code n
	for ((n = 0; n < 24; n++)); do
		code=$(vm_root "$i" "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 https://achilles.test/ || true")
		[ "$code" = 200 ] && break
		sleep 5
	done
	expect_eq "Caddy serves the frontend: HTTP status of https://achilles.test/" "$code" "200"
}

DATA_MARKER_PATH=/root/.projectachilles/boot-test-marker
ES_MARKER_DOC=http://localhost:9200/boot-test-marker/_doc/1
ES_MARKER_SRC=http://localhost:9200/boot-test-marker/_source/1

# seed_markers I: write DATA_MARKER into the achilles-data volume (through the
# backend) and into Elasticsearch (esdata), then read both back.
seed_markers() {
	local i=$1
	vm_root "$i" "$COMPOSE exec -T backend sh -c 'printf %s $DATA_MARKER > $DATA_MARKER_PATH'" ||
		fail "could not write the marker into the achilles-data volume"
	vm_root "$i" "$COMPOSE exec -T elasticsearch curl -fsS -XPUT '$ES_MARKER_DOC?refresh=true' -H 'Content-Type: application/json' -d '{\"marker\":\"$DATA_MARKER\"}' >/dev/null && $COMPOSE exec -T elasticsearch curl -fsS -XPOST http://localhost:9200/_flush >/dev/null" ||
		fail "could not index the marker document in Elasticsearch"
	check_markers "$i"
}

# check_markers I: both markers read back as DATA_MARKER (ES within 3 minutes:
# it may still be recovering its indices after a start).
check_markers() {
	local i=$1 out n
	out=$(vm_root "$i" "$COMPOSE exec -T backend cat $DATA_MARKER_PATH") || out=""
	expect_eq "achilles-data volume marker" "$out" "$DATA_MARKER"
	for ((n = 0; n < 36; n++)); do
		out=$(vm_root "$i" "$COMPOSE exec -T elasticsearch curl -fsS '$ES_MARKER_SRC'" 2>/dev/null | jq -r .marker 2>/dev/null) || out=""
		[ "$out" = "$DATA_MARKER" ] && break
		sleep 5
	done
	expect_eq "esdata marker document" "$out" "$DATA_MARKER"
}

# stack_state I: what a restore must reproduce, one "name value" per line:
# the root .env's COMPOSE_PROJECT_NAME and ACHILLES_DOMAIN, a hash of
# backend/.env's ENCRYPTION_SECRET (re-generating it would make the restored
# settings unreadable), and the SHA-256 of each rendered Caddy snippet and of
# Caddy's exported internal root CA (from the caddy-data volume).
stack_state() {
	# shellcheck disable=SC2016 # expanded on the VM
	vm_root "$1" "cd $REPO"' && for k in COMPOSE_PROJECT_NAME ACHILLES_DOMAIN; do
		printf ".env:%s %s\n" "$k" "$(sed -n "s/^$k=//p" .env | tail -n 1)"
	done
	printf "backend/.env:ENCRYPTION_SECRET sha256:%s\n" "$(sed -n "s/^ENCRYPTION_SECRET=//p" backend/.env | tail -n 1 | sha256sum | cut -c1-16)"
	sha256sum deploy/caddy/rendered/* deploy/caddy/certs/root-ca.crt | awk "{print \$2, \$1}"'
}

# build_probe I: a trivial build works, and BuildKit wrote its worker ID
# (removed by the seal) again. Prints the worker ID.
build_probe() {
	local i=$1 wid
	vm_root "$i" "printf 'FROM caddy:2.10.0-alpine\nRUN true\n' | docker build -q -t boot-test:probe - >/dev/null && docker image rm -f boot-test:probe >/dev/null" ||
		fail "a trivial docker build failed"
	wid=$(vm_root "$i" "cat /var/lib/docker/buildkit/containerd-overlayfs/workerid") ||
		fail "BuildKit workerid missing after a build"
	[ -n "$wid" ] || fail "BuildKit workerid is empty"
	log "vm$CUR: ok: docker build works; BuildKit worker ID $wid" >&2
	echo "$wid"
}

full_install_backup() {
	local i=$1 out
	expect_eq "VM address (install.env CADDY_BIND_IP)" "${HANDOFF_IP[$i]}" "$GUEST_IP"
	vm_upload "$i" "$INSTALL_ENV" /tmp/install.env
	log "vm$i: achilles-installer install (log: $WORK/vm$i.install.log)"
	if ! vm_root "$i" "achilles-installer install --repo $REPO --config /tmp/install.env --yes 2>&1" \
		>"$WORK/vm$i.install.log" 2>&1; then
		tail -n 40 "$WORK/vm$i.install.log" >&2
		fail "achilles-installer install failed"
	fi
	indent "$i" <"$WORK/vm$i.install.log"
	grep -q 'Using the pre-built images' "$WORK/vm$i.install.log" ||
		fail "the install rebuilt the images (no 'Using the pre-built images' line)"
	log "vm$CUR: ok: the install reused the pre-built images"
	compose_running "$i"
	out=$(vm_root "$i" "docker network ls --filter label=com.docker.compose.project=achilles-server --format '{{.Name}}'")
	[ -n "$out" ] || fail "no network of compose project achilles-server"
	log "vm$CUR: ok: compose network(s): $(echo "$out" | paste -sd' ')"
	caddy_frontend "$i"
	backend_health "$i"
	WORKER_ID[$i]=$(build_probe "$i")
	DATA_MARKER="boot-test-$BUILD_COMMIT-$(date +%s)-$RANDOM"
	seed_markers "$i"
	STATE1=$(stack_state "$i") || fail "could not read the stack's state"
	grep -qx '.env:COMPOSE_PROJECT_NAME achilles-server' <<<"$STATE1" ||
		fail "VM1's .env does not pin achilles-server: $STATE1"
	grep -qx '.env:ACHILLES_DOMAIN achilles.test' <<<"$STATE1" ||
		fail "VM1's .env has another ACHILLES_DOMAIN: $STATE1"
	grep -q '^deploy/caddy/rendered/' <<<"$STATE1" || fail "VM1 has no rendered Caddy config"
	indent "$i" <<<"$STATE1"
	log "vm$CUR: ok: recorded .env values, rendered Caddy config and root CA"

	log "vm$i: achilles-installer backup"
	out=$(vm_root "$i" "achilles-installer backup 2>&1") || { echo "$out" >&2; fail "backup failed"; }
	indent "$i" <<<"$out"
	BACKUP_REMOTE=$(echo "$out" | sed -n 's/^Backup written: //p')
	[ -n "$BACKUP_REMOTE" ] || fail "backup printed no 'Backup written:' path"
	BACKUP_LOCAL=$WORK/$(basename "$BACKUP_REMOTE")
	vm_root "$i" "cat '$BACKUP_REMOTE'" >"$BACKUP_LOCAL" || fail "could not copy the backup out"
	out=$(tar -tf "$BACKUP_LOCAL") || fail "the copied backup is not a readable tar archive"
	grep -qE '^(\./)?MANIFEST$' <<<"$out" || fail "the copied backup has no MANIFEST"
	# install --config copies the config into the checkout, so the backup has it.
	grep -qE '^(\./)?files/deploy\.config\.env$' <<<"$out" || fail "the backup has no deploy.config.env"
	log "vm$CUR: ok: backup copied out: $BACKUP_LOCAL ($(du -h "$BACKUP_LOCAL" | cut -f1))"
}

full_restore() {
	local i=$1 out dest
	WORKER_ID[$i]=$(build_probe "$i")
	dest=/tmp/$(basename "$BACKUP_LOCAL")
	vm_upload "$i" "$BACKUP_LOCAL" "$dest"
	log "vm$i: achilles-installer restore (never installed)"
	if ! out=$(vm_root "$i" "achilles-installer restore '$dest' --yes 2>&1"); then
		indent "$i" <<<"$out" >&2
		fail "restore on the never-installed VM failed"
	fi
	indent "$i" <<<"$out"
	grep -q '^No containers for compose project achilles-server' <<<"$out" ||
		fail "restore did not take the never-installed path (no 'No containers' line)"
	grep -q 'Re-running the installer with the restored' <<<"$out" ||
		fail "restore did not re-run the engine on the restored config"
	grep -q 'Using the pre-built images' <<<"$out" ||
		fail "the restore's engine run rebuilt the images (no 'Using the pre-built images' line)"
	log "vm$CUR: ok: restore skipped the stop and re-ran the engine on the pre-built images"
	compose_running "$i"
	out=$(vm_root "$i" "docker network ls --filter label=com.docker.compose.project=achilles-server --format '{{.Name}}'")
	[ -n "$out" ] || fail "no network of compose project achilles-server"
	log "vm$CUR: ok: compose network(s): $(echo "$out" | paste -sd' ')"
	caddy_frontend "$i"
	backend_health "$i"
	check_markers "$i"
	out=$(stack_state "$i") || fail "could not read the stack's state"
	indent "$i" <<<"$out"
	[ "$out" = "$STATE1" ] || fail "VM2's .env values, rendered Caddy config or root CA differ from VM1's: $(diff <(echo "$STATE1") <(echo "$out") || true)"
	log "vm$CUR: ok: .env values, rendered Caddy config and Caddy root CA equal VM1's"
}

# --- main ------------------------------------------------------------------

declare -A WORKER_ID
DATA_MARKER=""
STATE1=""
BACKUP_LOCAL=""
BACKUP_REMOTE=""

rm -rf "$WORK"
mkdir -p "$WORK"
log "boot-test $MODE: $(basename "$IMAGE"), build commit $BUILD_COMMIT"

for i in 1 2; do
	prepare_vm "$i"
	start_vm "$i"
	t=$(date +%s)
	wait_ssh "$i"
	log "vm$i: SSH after $(($(date +%s) - t))s"
	quick_checks "$i"
	if [ "$MODE" = full ]; then
		if [ "$i" = 1 ]; then full_install_backup "$i"; else full_restore "$i"; fi
	fi
	stop_vm "$i"
done
CUR=""

[ "${MACHINE_ID[1]}" != "${MACHINE_ID[2]}" ] || fail "both VMs have machine-id ${MACHINE_ID[1]}"
[ "${FPR[1]}" != "${FPR[2]}" ] || fail "both VMs have host key ${FPR[1]}"
[ "${ENGINE_ID[1]}" != "${ENGINE_ID[2]}" ] || fail "both VMs have Docker engine ID ${ENGINE_ID[1]}"
log "ok: machine-ids differ: ${MACHINE_ID[1]} / ${MACHINE_ID[2]}"
log "ok: host keys differ: ${FPR[1]} / ${FPR[2]}"
log "ok: Docker engine IDs differ: ${ENGINE_ID[1]} / ${ENGINE_ID[2]}"
if [ "$MODE" = full ]; then
	[ "${WORKER_ID[1]}" != "${WORKER_ID[2]}" ] || fail "both VMs have BuildKit worker ID ${WORKER_ID[1]}"
	log "ok: BuildKit worker IDs differ: ${WORKER_ID[1]} / ${WORKER_ID[2]}"
fi
log "boot-test $MODE: PASS ($(basename "$IMAGE"))"
