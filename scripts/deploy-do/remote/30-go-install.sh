#!/usr/bin/env bash
# Installs Go on the backend droplet so the agent's in-app build flow works.
# (`go mod tidy` and `go build` are spawned by backend's agentBuild.service.ts.)
#
# Required env:
#   GO_VERSION  — default 1.24.0 (matches agent/go.mod)

set -euo pipefail
IFS=$'\n\t'

GO_VERSION="${GO_VERSION:-1.25.0}"

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

# Pre-create the achilles user's Go cache + config dirs. Toolchain auto-download
# writes to ~/go/pkg/sumdb and ~/.cache/go-build; telemetry writes to ~/.config/go.
# Without these existing, Go invocations fail ENOENT before reading any env vars.
sudo -u achilles bash -c 'mkdir -p ~/go/{bin,pkg,src} ~/.cache/go-build ~/.config/go'

# Disable Go telemetry via the OFFICIAL persistent command (writes a sentinel
# to ~/.config/go/telemetry/mode that Go checks before doing any telemetry
# work). GOTELEMETRY env var alone is insufficient — the upload-token
# machinery still tries to write its persistence file at startup.
sudo -u achilles -H bash -c 'cd /tmp && /usr/local/bin/go telemetry off' || true

# Add GOTOOLCHAIN + GOPATH + GOCACHE to the backend systemd unit so child
# spawn()s use them. GOTOOLCHAIN=local pins to whatever we just installed —
# avoids surprise toolchain auto-downloads at request time.
mkdir -p /etc/systemd/system/projectachilles-backend.service.d
cat > /etc/systemd/system/projectachilles-backend.service.d/go-toolchain.conf <<'EOF'
[Service]
Environment=GOTOOLCHAIN=local
Environment=GOPATH=/home/achilles/go
Environment=GOCACHE=/home/achilles/.cache/go-build
# Go 1.23+ tries to write ~/.config/go/telemetry/local/upload.token, which fails
# under systemd's ProtectHome=read-only. Disabling telemetry short-circuits it.
Environment=GOTELEMETRY=off
EOF
systemctl daemon-reload

log "installed: $(/usr/local/bin/go version)"
