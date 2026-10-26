#!/usr/bin/env bash
# Smoke check for the appliance builder container. Run inside the container.
set -euo pipefail

packer version
qemu-system-x86_64 --version
test -f /usr/share/OVMF/OVMF_CODE_4M.fd
test -f /usr/share/OVMF/OVMF_VARS_4M.fd
test -c /dev/kvm
libguestfs-test-tool
echo "builder-smoke: OK"
