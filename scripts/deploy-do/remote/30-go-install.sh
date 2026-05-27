#!/usr/bin/env bash
# Installs Go on the backend droplet so the agent's in-app build flow works.
# (`go mod tidy` and `go build` are spawned by backend's agentBuild.service.ts.)
#
# Required env:
#   GO_VERSION  — default 1.24.0 (matches agent/go.mod)

set -euo pipefail
IFS=$'\n\t'

GO_VERSION="${GO_VERSION:-1.24.0}"

log() { printf '[go-install] %s\n' "$*" >&2; }

if command -v go >/dev/null 2>&1 && go version 2>/dev/null | grep -q "go${GO_VERSION}"; then
    log "go ${GO_VERSION} already installed: $(go version)"
    exit 0
fi

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)  GOARCH=amd64 ;;
    aarch64) GOARCH=arm64 ;;
    *)       log "unsupported arch: $ARCH"; exit 1 ;;
esac

URL="https://go.dev/dl/go${GO_VERSION}.linux-${GOARCH}.tar.gz"
log "downloading $URL"
cd /tmp
curl -fsSL "$URL" -o go.tgz

# Atomic-ish: remove old install dir, extract fresh
rm -rf /usr/local/go
tar -C /usr/local -xzf go.tgz
rm -f go.tgz

# Symlink into a stable system-wide path so systemd's default PATH finds it.
ln -sf /usr/local/go/bin/go /usr/local/bin/go
ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt

log "installed: $(/usr/local/bin/go version)"
