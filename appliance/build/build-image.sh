#!/usr/bin/env bash
# Run the Packer build of the appliance image. Called by `make image` inside
# the builder container, from appliance/, after the Makefile has refused a
# dirty tree and put the base image, the installer binary and repo.bundle in
# out/. Needs VER and COMMIT in the environment.
#
# The build user's password is generated here, per build, and only ever
# reaches Packer through the environment (PKR_VAR_ssh_password, a sensitive
# variable that Packer redacts from its log). It is never written to a file;
# the VM gets only its SHA-512 crypt hash (seed hashed_passwd).
#
# After Packer: zero and discard free space (it still holds deleted build
# files), refuse an image that contains the password or its hash, and
# run check-sealed. The qcow2 gets its final name in out/ only if all pass.
set -euo pipefail

: "${VER:?VER must be set}"
: "${COMMIT:?COMMIT must be set}"
OUT=$(pwd)/out
# A directory: appliance.pkr.hcl + plugins.pkr.hcl.
TEMPLATE=build
IMAGE=achilles-appliance-$VER.qcow2
BUILD_DIR=$OUT/packer-$VER
LOG=$OUT/packer.log
SERIAL=$OUT/serial.log

for f in ubuntu-24.04-server-cloudimg-amd64.img SHA256SUMS achilles-installer repo.bundle; do
	[ -f "$OUT/$f" ] || { echo "build-image: missing out/$f" >&2; exit 1; }
done

pw=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
[ "${#pw}" -eq 48 ] || { echo "build-image: could not generate a password" >&2; exit 1; }
hash=$(printf '%s' "$pw" | openssl passwd -6 -stdin)
case $hash in "\$6\$"*) ;; *) echo "build-image: could not hash the password" >&2; exit 1 ;; esac
export PKR_VAR_ssh_password=$pw PKR_VAR_ssh_password_hash=$hash

export PACKER_LOG=1 PACKER_LOG_PATH=$LOG CHECKPOINT_DISABLE=1
export PACKER_CACHE_DIR=$OUT/packer_cache

rm -rf "$BUILD_DIR"
rm -f "$LOG" "$SERIAL" "$OUT/$IMAGE"

start=$(date +%s)
rc=0
packer build -color=false -timestamp-ui \
	-var "version=$VER" -var "commit=$COMMIT" -var "out_dir=$OUT" \
	"$TEMPLATE" || rc=$?
unset PKR_VAR_ssh_password PKR_VAR_ssh_password_hash

# The password must never reach a file in out/. Packer redacts sensitive
# variables; check that it did, and that the serial console didn't show it.
leaked=0
for f in "$LOG" "$SERIAL"; do
	if [ -f "$f" ] && grep -qF -e "$pw" -e "$hash" "$f"; then
		echo "build-image: the build password appears in $f; deleting it" >&2
		rm -f "$f"
		leaked=1
	fi
done

# reject <why>: delete the unfinished image and fail.
reject() {
	echo "build-image: $1; the image is rejected" >&2
	rm -rf "$BUILD_DIR"
	exit 1
}

if [ "$rc" -ne 0 ]; then
	echo "build-image: packer build failed (exit $rc); log: $LOG" >&2
	rm -rf "$BUILD_DIR"
	exit "$rc"
fi
[ "$leaked" -eq 0 ] || reject "the build password leaked into a log"

img=$BUILD_DIR/$IMAGE
# Deleted build files (cloud-init's copy of the seed, old /etc/shadow
# versions) stay in free blocks. A discard frees only whole 64 KiB qcow2
# clusters, so first zero the free blocks of every ext filesystem, then let
# virt-sparsify discard what is now free.
echo "build-image: zeroing free space and sparsifying"
mapfile -t extfs < <(virt-filesystems -a "$img" --filesystems --no-title --csv -l |
	awk -F, '$3 ~ /^ext[234]$/ {print $1}')
[ "${#extfs[@]}" -gt 0 ] || reject "no ext filesystem found in the image"
gf=(guestfish -a "$img" run)
for fs in "${extfs[@]}"; do gf+=(: zerofree "$fs"); done
"${gf[@]}" || reject "zerofree failed"
virt-sparsify --in-place "$img" || reject "virt-sparsify failed"

# The qcow2 is not compressed (no disk_compression), so a byte grep sees
# every allocated cluster.
n=$(grep -acF -e "$pw" "$img" || true)
[ "$n" = 0 ] || reject "the build password is in the image ($n hits)"
n=$(grep -acF -e "$hash" "$img" || true)
[ "$n" = 0 ] || reject "the build password's hash is in the image ($n hits)"
pw='' hash=''
echo "build-image: no build password or hash in the image"

echo "build-image: check-sealed"
build/check-sealed.sh "$img" || reject "check-sealed failed"

mv "$img" "$OUT/$IMAGE"
rm -rf "$BUILD_DIR"
qemu-img info "$OUT/$IMAGE"
echo "build-image: out/$IMAGE built from $COMMIT in $(( $(date +%s) - start ))s"
