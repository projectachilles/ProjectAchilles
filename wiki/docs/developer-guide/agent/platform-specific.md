---
sidebar_position: 2
title: "Platform-Specific Code"
description: "How the Go agent handles cross-platform differences using build tags."
---

# Platform-Specific Code

## Build Tags

Platform-specific code uses Go build tags:

```go
//go:build darwin
// +build darwin

package service
```

### Files by Platform

| File Pattern | Platforms |
|-------------|----------|
| `*_darwin.go` | macOS (amd64, arm64) |
| `*_linux.go` | Linux (amd64) |
| `*_windows.go` | Windows (amd64) |

### Platform Differences

| Feature | Windows | Linux | macOS |
|---------|---------|-------|-------|
| Service manager | SCM (`sc.exe`) | systemd | launchd (plist) |
| System info | WMI/native | `/proc`, `/etc` | sysctl, vm_stat |
| Binary update | temp file + rename | atomic rename | atomic rename |
| Code signing | Authenticode | None | Ad-hoc (rcodesign) |
| File permissions | ACLs via `icacls` | Unix permissions | Unix permissions |

## CGO

CGO is **disabled** for all builds to produce static, cross-platform binaries:

```makefile
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ./...
```
