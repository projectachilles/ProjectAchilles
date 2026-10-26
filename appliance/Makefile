# Windows appliance image build. All tooling runs in one builder container.
SHELL := /bin/bash
.DEFAULT_GOAL := help

REPO     := $(abspath $(CURDIR)/..)
OUT      := $(CURDIR)/out
COMMIT   := $(shell git rev-parse HEAD)
BUILDER  := achilles-appliance-builder:local
BASE_URL := https://cloud-images.ubuntu.com/releases/noble/release
BASE_IMG := ubuntu-24.04-server-cloudimg-amd64.img
HOST_UID := $(shell id -u)
HOST_GID := $(shell id -g)

# The appliance version is the platform release tag it was built from (spec
# 9): describe only v<x>.<y>.<z> tags, never agent-v* ones, which share
# commits with platform releases. Computed once (:=).
DESCRIBED := $(shell git describe --tags --match 'v[0-9]*.[0-9]*.[0-9]*' --always --dirty)
ifndef VER
VER := $(DESCRIBED)
endif
# Expanded by `image`: a VER from the environment or the command line must
# equal $(DESCRIBED), or the image would be named, versioned and stamped
# (-X main.version, ACHILLES_VERSION) with it. ALLOW_VER_OVERRIDE=1 allows it.
VER_CHECK = $(if $(filter 1,$(ALLOW_VER_OVERRIDE)),,$(if $(filter $(DESCRIBED),$(VER)),,$(error \
	VER=$(VER) is not this commit's version $(DESCRIBED) (git describe). Unset VER, \
	or set ALLOW_VER_OVERRIDE=1 to build an image named and stamped $(VER))))

IMAGE ?= out/achilles-appliance-$(VER).qcow2

# Run a command in the builder. Same absolute path inside as on the host.
DOCKER_RUN = docker run --rm --user root --device /dev/kvm \
	-v $(REPO):$(REPO) -w $(REPO)/appliance \
	-e VER="$(VER)" -e COMMIT="$(COMMIT)" $(BUILDER)
# Same, for targets that write to out/: always chown out/ back to the invoking
# user afterwards (even on failure) and keep the command's exit code, so
# `make clean` works without sudo. Usage: $(DOCKER_RUN_OUT) <cmd...>
DOCKER_RUN_OUT = $(DOCKER_RUN) bash -c \
	'"$$@"; rc=$$?; chown -R $(HOST_UID):$(HOST_GID) out; exit $$rc' _

.PHONY: help builder builder-smoke check-space base-image installer-bin \
	installer-testbin out-ownership-check image repo-bundle check-sealed boot-test vhdx clean

help:
	@echo "targets: builder builder-smoke check-space base-image installer-bin"
	@echo "         installer-testbin out-ownership-check image repo-bundle check-sealed"
	@echo "         boot-test vhdx clean"

$(OUT):
	mkdir -p $(OUT)

builder:
	docker build -t $(BUILDER) -f build/Dockerfile.builder build

builder-smoke:
	$(DOCKER_RUN) build/builder-smoke.sh

check-space: | $(OUT)
	@free_kb=$$(df -Pk $(OUT) | awk 'NR==2 {print $$4}'); \
	if [ "$$free_kb" -lt 41943040 ]; then \
		echo "need at least 40 GB free in appliance/out" >&2; exit 1; \
	fi

base-image: | $(OUT)
	build/fetch-base-image.sh $(OUT) $(BASE_URL) $(BASE_IMG)

installer-bin: | $(OUT)
	$(MAKE) -C ../installer build VERSION=$(VER)
	cp ../installer/dist/achilles-installer-linux-amd64 $(OUT)/achilles-installer

installer-testbin: | $(OUT)
	cd ../installer && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
		go build -trimpath -tags appliancetest \
		-ldflags "-X main.version=$(VER)" -o $(OUT)/achilles-installer-test .

# Proves DOCKER_RUN_OUT leaves out/ files owned by the invoking user.
out-ownership-check: | $(OUT)
	rm -f $(OUT)/.ownership-check
	$(DOCKER_RUN_OUT) touch out/.ownership-check
	@owner=$$(stat -c %u $(OUT)/.ownership-check); rm -f $(OUT)/.ownership-check; \
	if [ "$$owner" != "$(HOST_UID)" ]; then \
		echo "out/ file owned by uid $$owner, expected $(HOST_UID)" >&2; exit 1; \
	fi; echo "out-ownership-check: OK"

# Sealed qcow2 from the committed HEAD: refuses a dirty tree (the image holds
# a clean checkout of exactly $(COMMIT)) and a VER that is not its describe
# (VER_CHECK), rebuilds the installer binary for this commit, writes
# repo.bundle, then runs Packer in the builder (build/build-image.sh, which
# also runs check-sealed before naming the image).
image:
	$(VER_CHECK)
	@case "$(VER)" in *-dirty) \
		echo "commit your changes: the image must hold a clean checkout" >&2; exit 1 ;; esac
	@git diff --quiet HEAD -- || { \
		echo "commit your changes: the image must hold a clean checkout" >&2; exit 1; }
	$(MAKE) builder check-space base-image installer-bin repo-bundle VER=$(VER)
	$(DOCKER_RUN_OUT) build/build-image.sh

# out/repo.bundle: the build commit (as HEAD; a bare SHA gives the bundle no
# ref to clone) and the platform release tags merged into it, which
# `upgrade` and describe need. Nothing else of the build host's: no stash,
# no local branches, no agent-v* tags, and no local-only tags (they could
# carry private commits). Asserts the bundle holds exactly those refs.
BUNDLE_TAGS = git tag --merged HEAD -l 'v[0-9]*.[0-9]*.[0-9]*'
repo-bundle: | $(OUT)
	rm -f $(OUT)/repo.bundle
	git bundle create $(OUT)/repo.bundle HEAD $$($(BUNDLE_TAGS) | sed 's|^|refs/tags/|')
	@heads=$$(git bundle list-heads $(OUT)/repo.bundle); \
	echo "$$heads" | grep -qx '$(COMMIT) HEAD' || { echo "repo.bundle: HEAD is not $(COMMIT)" >&2; exit 1; }; \
	got=$$(echo "$$heads" | awk '{print $$2}' | sort); \
	want=$$( { echo HEAD; $(BUNDLE_TAGS) | sed 's|^|refs/tags/|'; } | sort); \
	[ "$$got" = "$$want" ] || { echo "repo.bundle: refs are not HEAD + the v* tags merged into it:" >&2; \
		diff <(echo "$$want") <(echo "$$got") >&2; exit 1; }; \
	echo "repo.bundle: HEAD + $$(echo "$$want" | grep -c '^refs/tags/') tags"

# Offline inspection of IMAGE (path relative to appliance/; defaults to the
# image `make image` builds for this VER). Exit 1 = not sealed.
check-sealed:
	@test -n "$(IMAGE)" || { echo "usage: make check-sealed IMAGE=out/<image>" >&2; exit 2; }
	$(DOCKER_RUN) build/check-sealed.sh $(IMAGE)

# Boot-test IMAGE in two throwaway VMs (test/boot-test.sh; spec 10.1).
# MODE=quick: first boot, identity, image reuse labels, reboot. MODE=full also
# installs, backs up and restores (10-40 min). The build commit comes from the
# image name (<ver> = git describe: ...-g<sha>, or a tag); unknown names fall
# back to HEAD. Override with BUILD_COMMIT=<sha>.
MODE ?= quick
boot-test: installer-testbin
	@case "$(MODE)" in quick|full) ;; *) \
		echo "usage: make boot-test MODE=quick|full [IMAGE=out/<image>.qcow2]" >&2; exit 2 ;; esac
	@test -f "$(IMAGE)" || { echo "boot-test: no image $(IMAGE)" >&2; exit 2; }
	@bc='$(BUILD_COMMIT)'; \
	if [ -z "$$bc" ]; then \
		v=$$(basename "$(IMAGE)" .qcow2); v=$${v#achilles-appliance-}; ref=$$v; \
		if [[ $$v =~ -g([0-9a-f]{7,40})$$ ]]; then ref=$${BASH_REMATCH[1]}; fi; \
		bc=$$(git rev-parse --verify -q "$$ref^{commit}") || { \
			bc=$(COMMIT); echo "boot-test: no commit in the image name; expecting HEAD"; }; \
	fi; \
	echo "boot-test: $(IMAGE), MODE=$(MODE), build commit $$bc"; \
	$(DOCKER_RUN_OUT) env BUILD_COMMIT="$$bc" test/boot-test.sh "$(IMAGE)" out/achilles-installer-test "$(MODE)"

# Hyper-V package from IMAGE: dynamic VHDX, zipped, with a SHA-256 of the zip.
# Outputs in out/: ProjectAchilles-<ver>.vhdx, ProjectAchilles-<ver>-hyperv.zip,
# appliance-SHA256SUMS (zip only, relative name, so `sha256sum -c` works in out/).
vhdx:
	@test -f "$(IMAGE)" || { echo "vhdx: no image $(IMAGE)" >&2; exit 2; }
	$(DOCKER_RUN_OUT) bash -euo pipefail -c ' \
		rm -f out/ProjectAchilles-$(VER).vhdx out/ProjectAchilles-$(VER)-hyperv.zip out/appliance-SHA256SUMS; \
		qemu-img convert -O vhdx -o subformat=dynamic "$(IMAGE)" out/ProjectAchilles-$(VER).vhdx; \
		qemu-img check out/ProjectAchilles-$(VER).vhdx; \
		zip -j out/ProjectAchilles-$(VER)-hyperv.zip out/ProjectAchilles-$(VER).vhdx; \
		cd out && sha256sum ProjectAchilles-$(VER)-hyperv.zip > appliance-SHA256SUMS'

clean:
	rm -rf $(OUT)
