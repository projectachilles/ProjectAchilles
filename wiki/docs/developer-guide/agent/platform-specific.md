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

## Service Management

The agent installs as a native system service on each platform. The core interface is the same across all three:

```go
func Install(configPath string) error
func Uninstall() error
func ServiceStatus() Status
func RunService(cfg *config.Config, st *store.Store, version string) error
```

The `Status` struct provides consistent state information:

```go
type Status struct {
    Installed bool  // Service is registered with system
    Running   bool  // Service is currently active
    PID       int   // Process ID (0 if unknown/stopped)
}
```

### Service Lifecycle

```mermaid
graph TD
    A[Install] --> B[Create Service Definition]
    B --> C[Set Binary Permissions]
    C --> D[Register with System]
    D --> E[Start Service]

    F[RunService] --> G{Platform Check}
    G -->|Windows| H[SCM Handler]
    G -->|Linux/macOS| I[Direct Execution]

    H --> J[Signal Handling]
    I --> J
    J --> K[Run Poller Loop]

    L[Uninstall] --> M[Stop Service]
    M --> N[Unregister Service]
    N --> O[Remove Definition Files]
```

### Windows -- Service Control Manager

Windows uses the native SCM via `sc.exe` and the `golang.org/x/sys/windows/svc` package for the service handler.

Key behaviors:
- Creates a Windows service registered with the SCM
- Implements the full SCM lifecycle (start, stop, interrogate)
- Configures automatic restart on failure with exponential backoff
- Uses Task Scheduler as a fallback restart mechanism after updates (see below)
- Hardens the binary with `icacls` (SYSTEM + Administrators only, inherited permissions removed)

```bash
# What Install() does under the hood
sc.exe create achilles-agent binPath= "C:\path\to\achilles-agent.exe --run" start= auto
sc.exe failure achilles-agent reset= 86400 actions= restart/5000/restart/10000/restart/30000
icacls "C:\path\to\achilles-agent.exe" /inheritance:r /grant:r "SYSTEM:(F)" "Administrators:(F)"
```

:::info
On Windows, `RunService()` enters the SCM handler loop. The SCM sends control signals (stop, shutdown, interrogate) which the handler translates into context cancellation for the poller.
:::

**Restart after an update.** The handler exits with code 1. `sc failureflag 1` makes the SCM treat that as a failure, so its recovery actions restart the service. SCM recovery covers a service that **exits**, not one that **fails to start** (event 7000), so the agent also registers a one-time scheduled task, `AchillesAgentRestart`, that runs `sc.exe start` about two minutes later and then deletes itself. `fallbackRestartArgs()` (`internal/service/restart_task.go`) registers the task with PowerShell `Register-ScheduledTask`, using a `[DateTime]` trigger and passing the script as `-EncodedCommand`. Don't switch back to `schtasks /Create /SD <date>`: `/SD` parses dates in the machine's locale, so a US-formatted date fails on `dd/MM` locales ("Incorrect Start Date") or silently schedules the wrong month.

### Linux -- systemd

Linux uses systemd unit files placed in `/etc/systemd/system/`.

Key behaviors:
- Creates a unit file with `Restart=always` and `RestartSec=5`
- Declares `After=network-online.target` to wait for network availability
- Manages lifecycle via `systemctl enable`, `systemctl start`, etc.
- Restricts binary permissions to root-only (`0700`)

```ini
# Generated unit file: /etc/systemd/system/achilles-agent.service
[Unit]
Description=Achilles Security Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/achilles-agent --run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### macOS -- launchd

macOS uses launchd plist files placed in `/Library/LaunchDaemons/`.

Key behaviors:
- Creates a plist with `KeepAlive=true` for automatic restart
- Configures `RunAtLoad=true` for startup on boot
- Logs stdout/stderr to `/var/log/achilles-agent.log` and `/var/log/achilles-agent.err`
- Uses `launchctl load`/`unload` for service management

```xml
<!-- /Library/LaunchDaemons/com.achilles.agent.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.achilles.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/achilles-agent</string>
        <string>--run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/achilles-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/achilles-agent.err</string>
</dict>
</plist>
```

:::tip
On Linux and macOS, `RunService()` executes the poller loop directly in the foreground process. The service manager (systemd/launchd) handles restart-on-crash externally.
:::

## Auto-Update Flow

The agent checks for updates at a configurable interval. When a new version is available, it downloads, verifies, and replaces the running binary atomically.

### Cryptographic Verification

Updates are secured with a two-layer verification scheme:

1. **SHA256 hash** -- the downloaded binary's hash must match the server-provided hash.
2. **Ed25519 signature** -- the server signs the SHA256 hash with a private key. The agent verifies the signature using its configured public key.

```go
func verifySignature(hashBytes []byte, signatureHex string, publicKeyBase64 string) error
```

- Public keys are base64-encoded, signatures are hex-encoded
- The public key is set via the `update_public_key` config field during enrollment
- If no public key is configured, signature verification is skipped (not recommended for production)

:::warning
Without a configured `update_public_key`, the agent will accept any update that passes the SHA256 hash check. Always configure the public key in production deployments.
:::

### Update Process

```go
func CheckAndUpdate(ctx context.Context, client *httpclient.Client,
                   currentVersion string, cfg *config.Config, st *store.Store) (bool, error)
```

Steps:

1. **Version check** -- query `GET /api/agent/version` for the latest version metadata (version, SHA256 hash, size, signature). A `204` means up to date. Downgrades are refused unless the version is marked mandatory.
2. **Repeat-install guard** -- if the server offers the same artifact (version *and* SHA256) that was already installed while running the current version, and the agent still reports the old version, return `ErrRepeatedUpdate` without downloading. This stops a restart loop when a binary's embedded version doesn't match its registered version. The record lives in `state.json` (`last_applied_update`) so it survives the restart.
3. **Download** -- stream the new binary to a temporary file next to the current one.
4. **Hash verification** -- compute SHA256 of the downloaded file and compare against the server-provided hash (and size).
5. **Signature verification** -- verify the Ed25519 signature over the SHA256 hash bytes.
6. **Platform-specific replacement** -- swap the new binary into place and keep the previous one as `<path>.old` (see below).
7. **Launch check** (`installAndVerify`) -- run `<final path> --version` (30 s timeout). The binary must start and print `achilles-agent v<advertised version>`. On failure, `rollbackUpdate` moves the rejected binary aside, restores `<path>.old`, and returns `ErrLaunchCheckFailed`. The agent keeps running and the update task fails with the reason. The check runs at the **final path** so that path-scoped allowlists (e.g. a Defender ASR per-rule exclusion for the agent binary) apply to it.
8. **Restart** -- record the applied update, then return `(true, nil)` to signal the poller to exit. The service manager restarts the process, which loads the new binary.

:::tip Why the launch check exists
Endpoint security can refuse to execute a freshly built binary. The Defender ASR rule "block executables unless they meet a prevalence, age, or trusted list criterion" returns `ERROR_ACCESS_DENIED` to the service manager. Without the check, the agent exits for a restart that can never succeed and the endpoint goes dark. On Windows, an Access Denied failure message names the ASR rule and Defender event 1121.
:::

### Platform-Specific Binary Replacement

| Platform | Strategy | Reason |
|----------|----------|--------|
| Windows | Rename running `.exe` to `.exe.old`, rename temp file into place, harden ACL with `icacls` | Running `.exe` files can be renamed but not overwritten |
| Linux | Copy current to `.old`, atomic rename of temp file into place | POSIX allows replacing running executables |
| macOS | Ad-hoc code sign, copy current to `.old`, atomic rename | POSIX rename works; ad-hoc signing satisfies macOS Launch Constraints |

Every platform leaves the previous binary at `<path>.old`. `rollbackUpdate` (`internal/updater/verify_install.go`) relies on it and is cross-platform. Renaming works even when endpoint security blocks *executing* or *reading* the rejected file: this was checked on a Windows endpoint with ASR rule `01443614` in Block mode.

:::info
On macOS, the updated binary is re-signed with an ad-hoc signature using `rcodesign sign --code-signature-flags adhoc`. This is required because macOS Launch Constraints reject unsigned binaries loaded from `/Library/LaunchDaemons/`.
:::

## Uninstall Process

### Two-Phase Uninstall

The uninstaller uses a two-phase approach to ensure the backend is properly notified before the agent removes itself:

**Phase 1: Report to backend**
- Send an "uninstall initiated" result to the server while the agent's authentication credentials are still valid.
- This allows the backend to mark the agent as uninstalled and stop expecting heartbeats.

**Phase 2: System cleanup**
- Stop and unregister the system service.
- Optionally delete agent files based on the cleanup parameter.

```go
func Execute(ctx context.Context, client *httpclient.Client,
            task executor.Task, cfg *config.Config) error
```

### Cleanup Modes

The uninstall task payload controls the cleanup level:

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Soft delete** | `task.Payload.Command != "cleanup"` | Stop service, preserve files on disk |
| **Full cleanup** | `task.Payload.Command == "cleanup"` | Stop service, remove all files and directories |

### Platform-Specific Cleanup

**Windows:**
The running binary is locked by the OS and cannot be deleted by itself. The agent spawns a **detached `cmd.exe` process** that:
1. Waits for the agent process to exit
2. Removes the service via `sc delete`
3. Deletes the binary, work directory, and config files

```bash
# Simplified cleanup script spawned by the agent
ping -n 3 127.0.0.1 > nul
sc delete achilles-agent
del /f /q "C:\path\to\achilles-agent.exe"
rmdir /s /q "C:\path\to\workdir"
```

:::warning
On Windows, the detached cleanup process runs outside the agent's control. If the machine is shut down before cleanup completes, leftover files may remain. The backend should verify cleanup via the agent's absence from heartbeat checks.
:::

**Linux:**
- Direct file removal (POSIX allows deleting running executables)
- Removes the systemd unit file from `/etc/systemd/system/`
- Runs `systemctl daemon-reload` to refresh systemd
- Cleans up work directory and log files

**macOS:**
- Direct file removal (same POSIX behavior as Linux)
- Removes the launchd plist from `/Library/LaunchDaemons/`
- Runs `launchctl unload` before plist deletion
- Cleans up `/var/log/achilles-agent.{log,err}` and work directory

## Privilege Requirements

The `--install` and `--uninstall` CLI commands check for elevated privileges before attempting any operations:

| Platform | Check | Error Message |
|----------|-------|---------------|
| Linux/macOS | `os.Geteuid() == 0` | "install/uninstall requires administrator/root privileges" |
| Windows | `windows.GetCurrentProcessToken().IsElevated()` | "install/uninstall requires administrator/root privileges" |

Non-privileged users receive an explicit error instead of silent OS-level failures. The check is in `internal/service/elevate_unix.go` and `internal/service/elevate_windows.go`.

## Privilege Hardening

All platforms apply permission hardening during installation and after updates:

| Platform | Binary Permissions | Config Permissions |
|----------|-------------------|-------------------|
| Windows | SYSTEM + Administrators full control via `icacls`, inherited permissions removed | SYSTEM + Administrators read/write via `icacls` |
| Linux | `0700` (root execute only) | `0600` (root read/write only) |
| macOS | `0700` (root execute only) | `0600` (root read/write only) |
