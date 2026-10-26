# Windows appliance image build. All tooling runs in one builder container.
SHELL := /bin/bash
.DEFAULT_GOAL := help

REPO     := $(abspath $(CURDIR)/..)
OUT      := $(CURDIR)/out
VER      ?= $(shell git describe --tags --always --dirty)
COMMIT   := $(shell git rev-parse HEAD)
BUILDER  := achilles-appliance-builder:local
BASE_URL := https://cloud-images.ubuntu.com/releases/noble/release
BASE_IMG := ubuntu-24.04-server-cloudimg-amd64.img

# Run a command in the builder. Same absolute path inside as on the host.
# Container targets must end with: && $(CHOWN) (run via a second docker call or
# inside the container) so out/ stays removable without sudo.
DOCKER_RUN = docker run --rm --user root --device /dev/kvm \
	-v $(REPO):$(REPO) -w $(REPO)/appliance \
	-e VER="$(VER)" -e COMMIT="$(COMMIT)" $(BUILDER)
CHOWN = chown -R $(shell id -u):$(shell id -g) $(OUT)

.PHONY: help builder builder-smoke check-space base-image installer-bin \
	installer-testbin image check-sealed boot-test vhdx clean

help:
	@echo "targets: builder builder-smoke check-space base-image installer-bin"
	@echo "         installer-testbin image check-sealed boot-test vhdx clean"

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

image:
	@echo "image: not implemented yet (Task 5)" >&2; exit 1

check-sealed:
	@echo "check-sealed: not implemented yet (Task 6)" >&2; exit 1

boot-test:
	@echo "boot-test: not implemented yet (Task 7)" >&2; exit 1

vhdx:
	@echo "vhdx: not implemented yet (Task 8)" >&2; exit 1

clean:
	rm -rf $(OUT)
