---
sidebar_position: 3
title: "Build & Cross-Compilation"
description: "Build the Go agent for multiple platforms using make targets and cross-compilation."
---

# Build & Cross-Compilation

## Build Commands

```bash
cd agent

# Build all platforms into dist/ and write dist/SHA256SUMS
make build-all

# Build one platform (what the Makefile runs)
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=0.7.4" -o dist/achilles-agent-windows-amd64.exe .
GOOS=linux   GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=0.7.4" -o dist/achilles-agent-linux-amd64 .
GOOS=darwin  GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=0.7.4" -o dist/achilles-agent-darwin-amd64 .
GOOS=darwin  GOARCH=arm64 CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=0.7.4" -o dist/achilles-agent-darwin-arm64 .
```

CGO is disabled, so every binary is static and can be cross-compiled from any host. The Go version is set in `agent/go.mod`.

## Version Injection

The version is set via LDFLAGS. The Makefile takes it from its `VERSION` variable:

```bash
go build -ldflags "-X main.version=1.2.3" .
make build-all VERSION=1.2.3
```

:::warning[The embedded version must match the registered version]
The server refuses to register an agent binary whose embedded version differs from the version it is registered as, and refuses a binary built without `-X main.version` (it reports the default from `main.go`, which cannot be verified). A mismatch would make agents install the update, restart with the old version number and install it again in a loop. See [Self-Updates](../../user-guide/agent-management/self-updates).
:::

## Build Targets

| Target | Command |
|--------|---------|
| All platforms + checksums | `make build-all` |
| One platform | `make build-windows`, `make build-linux`, `make build-darwin-amd64`, `make build-darwin-arm64` |
| Windows + sign | `make sign-windows` |
| macOS + sign | `make sign-darwin` |
| Checksums (`dist/SHA256SUMS`) | `make checksum` |
| Remove `dist/` | `make clean` |
| Run tests | `go test ./...` |
| Validate compilation | `go build ./...` |

Official agent releases are built by the `release-agent.yml` workflow when an `agent-v<version>` tag is pushed. See [CI/CD](../ci-cd#releases).
