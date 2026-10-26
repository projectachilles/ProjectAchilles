# Windows appliance image build

Builds the sealed Ubuntu 24.04 ProjectAchilles VM image. Packer, QEMU, OVMF and
libguestfs all run inside one builder container, so local and CI builds use
identical tools.

## Prerequisites

- Docker, able to run containers with `--device /dev/kvm`
- `/dev/kvm` on the host (hardware virtualisation)
- Go (host) for the installer binaries
- At least 40 GB free in `appliance/out/`

No qemu, packer or libguestfs is needed on the host.

## Targets

Run from the repo root with `make -C appliance <target>`.

| Target | What it does |
|--------|--------------|
| `builder` | Build the `achilles-appliance-builder:local` image (about 5 min first time) |
| `builder-smoke` | Check packer, qemu, OVMF, `/dev/kvm` and libguestfs in the container |
| `check-space` | Fail unless 40 GB are free in `appliance/out` |
| `base-image` | Download the Ubuntu 24.04 cloud image, verify against `SHA256SUMS` (about 600 MB) |
| `installer-bin` | Build `out/achilles-installer` (host Go) |
| `installer-testbin` | Build `out/achilles-installer-test` (`-tags appliancetest`) |
| `out-ownership-check` | Prove container targets leave `out/` owned by you (`DOCKER_RUN_OUT`) |
| `image` | Build the qcow2 (later task) |
| `check-sealed` | Assert the image is sealed (later task) |
| `boot-test` | Boot-test the image under UEFI (later task) |
| `vhdx` | Produce the Hyper-V zip (later task) |
| `clean` | Remove `appliance/out/` |

`VER` defaults to `git describe --tags --always --dirty`; override with
`make VER=x.y.z ...`.

## Disk use

`out/` needs about 40 GB at peak: base image (about 600 MB), the 80 GB sparse
qcow2 (a few GB real), and the converted VHDX. Full build time is roughly
20-40 minutes with KVM.
