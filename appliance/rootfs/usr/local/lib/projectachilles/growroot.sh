#!/bin/sh
# Grow the root partition and its ext4 filesystem to fill the disk.
# cloud-init is disabled in the appliance image, so nothing else does this
# after an admin enlarges the VHDX. A failed grow must never block first
# boot: every path logs to stdout (the journal) and the script exits 0.

log() { echo "growroot: $*"; }

src=$(findmnt -no SOURCE /) || src=""
if [ -z "$src" ] || [ ! -b "$src" ]; then
    log "root source '$src' is not a block device; nothing to grow"
    exit 0
fi

name=$(basename "$(readlink -f "$src")")
disk=$(lsblk -no PKNAME "$src" 2>/dev/null | head -n 1)
partfile="/sys/class/block/$name/partition"
if [ -z "$disk" ] || [ ! -r "$partfile" ]; then
    log "$src is not a plain partition; skipping"
    exit 0
fi
part=$(cat "$partfile")

out=$(growpart "/dev/$disk" "$part" 2>&1)
rc=$?
log "growpart /dev/$disk $part exited $rc: $out"
case $rc in
0) ;;
1)
    case $out in
    *NOCHANGE*) log "partition already fills the disk" ;;
    *) log "growpart failed; continuing" ;;
    esac
    ;;
*) log "growpart failed; continuing" ;;
esac

fstype=$(findmnt -no FSTYPE /)
if [ "$fstype" = "ext4" ]; then
    # resize2fs is a no-op when the filesystem already fills the partition.
    if out=$(resize2fs "$src" 2>&1); then
        log "resize2fs ok: $out"
    else
        log "resize2fs failed: $out"
    fi
else
    log "root filesystem is '$fstype', not ext4; skipping resize2fs"
fi
exit 0
