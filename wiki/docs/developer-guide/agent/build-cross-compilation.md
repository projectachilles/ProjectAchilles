---
sidebar_position: 3
title: "Build & Cross-Compilation"
description: "Build the Go agent for multiple platforms using make targets and cross-compilation."
---

# Build & Cross-Compilation

## Build Commands

```bash
cd agent

# Build all platforms
make build-all

# Build specific platform
GOOS=windows GOARCH=amd64 go build -o achilles-agent-windows-amd64.exe .
GOOS=linux GOARCH=amd64 go build -o achilles-agent-linux-amd64 .
GOOS=darwin GOARCH=amd64 go build -o achilles-agent-darwin-amd64 .
GOOS=darwin GOARCH=arm64 go build -o achilles-agent-darwin-arm64 .
```

## Version Injection

The version is set via LDFLAGS:

```bash
go build -ldflags "-X main.version=1.2.3" .
```

## Build Targets

| Target | Command |
|--------|---------|
| All platforms | `make build-all` |
| Windows + sign | `make sign-windows` |
| macOS + sign | `make sign-darwin` |
| Run tests | `go test ./...` |
| Validate compilation | `go build ./...` |
