---
sidebar_position: 1
title: "Architecture"
description: "Go agent architecture — internal packages, CLI entry points, and execution model."
---

# Architecture

## Overview

The agent is a single Go binary (`achilles-agent`) that runs as a system service. It follows the standard Go project layout with `internal/` for private packages.

## Component Architecture

The following diagram shows how the major agent subsystems relate at runtime:

```mermaid
graph TD
    A[Poller.Run] --> B[Heartbeat Timer]
    A --> C[Poll Timer]
    A --> D[Update Ticker]
    A --> E[Signal Handler]

    B --> F[Send Heartbeat]
    F --> G[Collect System Info]
    F --> H[Report Agent Status]
    F --> I[Reconnect Reason Detection]

    B -->|Success| J[Drain Result Queue]
    B -->|Failure| K[Backoff State]
    K -->|Increase Interval| B

    C --> L[Fetch Task]
    L --> M[Execute Async]
    M --> N[Report Result]
    N -->|Failure| O[Enqueue Locally]

    D --> P[Check Updates]
    P --> Q[Apply & Exit]

    E --> R[Graceful Shutdown]
    R --> S[Wait for Tasks]
```

The **Poller** is the central event loop. It drives three independent cycles (heartbeat, task polling, update checking) and listens for OS signals to coordinate graceful shutdown.

## CLI Entry Points

```bash
achilles-agent --enroll <token> --server <url>   # Register with backend
achilles-agent --install                         # Copy to the install folder and register the system service
achilles-agent --run                             # Run the polling loop in the foreground
achilles-agent --status                          # Show diagnostics
achilles-agent --reload                          # Tell the running service to re-read its config (no restart)
achilles-agent --uninstall                       # Remove service
achilles-agent --version                         # Print version and exit
```

Other flags: `--config <path>` (default `C:\F0\achilles-agent.yaml` on Windows, `/opt/f0/achilles-agent.yaml` elsewhere) and `--allow-insecure` (allows `skip_tls_verify` for remote servers; not recommended).

:::tip
Pass `--install` together with `--enroll` to register and install as a service in a single step:
```bash
achilles-agent --enroll TOKEN --server https://server.com --install
```
:::

## Internal Packages

| Package | Purpose |
|---------|---------|
| `config` | Configuration file management |
| `enrollment` | Token-based registration flow |
| `executor` | Test binary download, verify, execute |
| `httpclient` | HTTP client with auth headers and TLS |
| `poller` | Heartbeat and task polling loop |
| `queue` | File-backed result queue for resilient reporting |
| `reporter` | Result reporting to backend |
| `service` | OS service management |
| `status` | `--status` diagnostics |
| `store` | Persistent agent state (`state.json`) |
| `sysinfo` | Platform-specific system information |
| `uninstaller` | Uninstall and per-platform cleanup |
| `updater` | Self-update mechanism and post-install launch check |
| `winacl` | `icacls` arguments that restrict agent files to SYSTEM and Administrators |

## Runtime Services

### Enrollment (`internal/enrollment`)

Handles one-time agent registration. Collects system information (hostname, OS, architecture), posts to `/api/agent/enroll` with the enrollment token, and saves the returned configuration (agent ID, API key, polling intervals). Enforces HTTPS and includes redirect downgrade protection to prevent HTTPS-to-HTTP attacks.

### Poller (`internal/poller`)

The main runtime event loop. Manages three concurrent cycles:

- **Heartbeat timer** -- sends system metrics (CPU, memory, disk, uptime) to the backend at the configured heartbeat interval. Uses `time.Timer` (not `time.Ticker`) for adaptive interval control — intervals increase during extended server outages via backoff state and snap back to normal on first successful heartbeat. After each successful heartbeat, the local result queue is drained.
- **Poll timer** -- fetches pending tasks and dispatches them for async execution. Also uses `time.Timer` with adaptive intervals that follow the same backoff progression as heartbeat.
- **Update ticker** -- checks the server for new agent versions and applies them atomically.

**Concurrency model:** single-threaded main loop with an atomic busy flag ensuring only one task executes at a time. Tasks run in goroutines. Graceful shutdown waits up to 30 seconds for in-flight tasks before exiting.

### Executor (`internal/executor`)

Downloads, verifies, and runs security test binaries or shell commands.

```mermaid
graph LR
    A[Receive Task] --> B[Download Binary]
    B --> C[Verify SHA256 + Size]
    C --> D[Set Permissions]
    D --> E[Execute with Timeout]
    E --> F[Capture Output]
    F --> G[Parse Bundle Results]
    G --> H[Cleanup Temp Files<br/>and test binaries]
```

Key safety measures:
- Binary integrity verification (SHA256 hash + file size)
- Isolated temporary directories under the configured work directory
- Process timeout enforcement with configurable limits
- Job Objects on Windows for reliable process tree termination
- Output capture capped at 1 MB to prevent memory exhaustion
- Custom environment variable injection for cloud credentials
- `bundle_results.json` is read only from a trusted folder (one that other users cannot write to or replace with a link)

**Test leftovers** (`cleanup.go`): orchestrators extract their stage binaries into the shared artifact folder (`C:\F0` on Windows, `/tmp/F0` on Linux and macOS) and rarely remove them. After each run the agent removes that test's binaries (`<uuid>.exe`, `<uuid>-<control>.exe`, or the same names without extension). At startup it sweeps `task-*` and `cmd-*` folders in the work directory and UUID-named test binaries older than one hour. Only UUID-named files match: the agent binary, its config and log, the result queue and the state store are never touched.

**Blocked launches**: when the operating system refuses to start the test binary (access denied, for example a Defender ASR rule or an EDR block), the agent reports exit code 260, "blocked before execution".

### HTTP Client (`internal/httpclient`)

Provides authenticated communication with the backend. Every request includes:

```
Authorization: Bearer <agent_key>
X-Agent-ID: <agent_id>
X-Agent-Version: <version>
X-Request-Timestamp: <RFC3339>
```

Features exponential backoff retry on 429/5xx responses (1s, 2s, 4s intervals), custom CA certificate support, and HTTPS downgrade protection. Short JSON requests have a 30-second timeout. Streaming downloads (test binaries, agent updates) use a separate budget, `max_download_timeout` (5 minutes by default).

### Reporter (`internal/reporter`)

Delivers task execution results to the server with reliability guarantees. Retries up to 3 times with exponential backoff (2s, 4s, 8s). If all retries are exhausted, the result is written to the local result queue and sent after the next successful heartbeat. A result the server rejects as invalid (a permanent error) is not retried. Reports all results regardless of exit code -- the exit code **is** the result.

### Store (`internal/store`)

Persistent agent state stored as JSON in `state.json` within the work directory:

```go
type State struct {
    AgentID                 string         `json:"agent_id"`
    LastTaskID              string         `json:"last_task_id,omitempty"`
    LastHeartbeat           *time.Time     `json:"last_heartbeat,omitempty"`
    Version                 string         `json:"version"`
    LastSuccessfulHeartbeat *time.Time     `json:"last_successful_heartbeat,omitempty"`
    LastAppliedUpdate       *AppliedUpdate `json:"last_applied_update,omitempty"`
}
```

`LastAppliedUpdate` records the version, SHA256 and from-version of the last self-update. The agent uses it to refuse to install the same artifact again (see [Self-Update](#self-update)).

Thread-safe read/write with mutex protection. Atomic updates via callback functions. Directories created with secure permissions (`0700`).

### System Info (`internal/sysinfo`)

Cross-platform system metrics collection for heartbeat payloads:

| Metric | Linux | macOS | Windows |
|--------|-------|-------|---------|
| CPU usage | `/proc/stat` | `sysctl` | `GetSystemTimes` |
| Memory | `syscall.Sysinfo` | `vm_stat` | `GlobalMemoryStatusEx` |
| Uptime | `syscall.Sysinfo` | `sysctl` | Win32 API |
| Disk free | Standard `syscall` | Standard `syscall` | Standard `syscall` |

### Status (`internal/status`)

Diagnostics and health reporting via `--status`. Displays agent identification, service state (running/stopped, PID), network connectivity (reachability, latency, last heartbeat), configuration details, and security status (key encryption, certificate validation).

## Configuration System

### Config Struct

All agent settings are held in a single struct:

```go
type Config struct {
    ServerURL         string        // Server endpoint
    PollInterval      time.Duration // Task polling frequency
    HeartbeatInterval time.Duration // Status reporting frequency
    AgentID           string        // Unique agent identifier
    AgentKey          string        // Authentication credential (in-memory only)
    AgentKeyEncrypted string        // Encrypted credential (on-disk)
    OrgID             string        // Organization identifier
    WorkDir           string        // Task execution directory
    LogFile           string        // Log output path
    MaxExecutionTime  time.Duration // Task timeout limit
    MaxBinarySize     int64         // Binary download size limit
    MaxDownloadTimeout time.Duration // Timeout for binary and update downloads
    UpdateInterval    time.Duration // Self-update check frequency
    CACert            string        // Custom CA certificate
    SkipTLSVerify     bool          // Disable TLS verification (restricted)
    UpdatePublicKey   string        // Public key for update verification
}
```

:::warning
`AgentKey` is never written to disk. The on-disk representation is always `AgentKeyEncrypted`. If a plaintext `AgentKey` is found during `Load()`, it is automatically encrypted and the plaintext is removed.
:::

### Credential Protection (PBKDF2)

Agent API keys are encrypted at rest using machine-bound keys derived through PBKDF2:

```mermaid
graph TD
    A[Load Config File] --> B{AgentKeyEncrypted exists?}
    B -->|Yes| C[Decrypt with machine key]
    B -->|No| D{AgentKey plaintext exists?}
    D -->|Yes| E[Encrypt and save]
    D -->|No| F[Return config]
    C --> G{Legacy encryption?}
    G -->|Yes| H[Migrate to v2 format]
    G -->|No| F
    E --> F
    H --> F
```

**Current (v2) format:**
- PBKDF2-SHA256 with 210,000 iterations (OWASP 2023 recommendation)
- AES-256-GCM authenticated encryption
- Random salt per encryption operation
- On-disk format: `v2:` + base64(salt + nonce + ciphertext + tag)

**Legacy (v1) format:**
- Single-pass HMAC-SHA256 derivation with fixed context string
- Supported for backward compatibility; automatically migrated to v2 on load

### Machine ID Sources

The encryption key is derived from a stable, platform-specific machine identifier:

| Platform | Source |
|----------|--------|
| Linux | `/etc/machine-id` (systemd standard) |
| macOS | `IOPlatformUUID` from IORegistry |
| Windows | `MachineGuid` from Windows registry |

:::info
Machine ID binding means an encrypted config file is not portable between hosts. Re-enrollment is required if the agent binary is moved to a different machine.
:::

## Security Model

### Transport Security
- HTTPS is **required** for all remote server communication; `ValidateServerURL()` rejects plaintext HTTP to non-localhost addresses.
- `SkipTLSVerify` is restricted to localhost connections or when an explicit override is set via `ValidateTLSConfig()`.
- Custom CA certificates can be provided for environments with internal PKI.
- The HTTP client includes HTTPS downgrade protection to prevent redirect-based attacks.

### File Permissions
- **Unix (Linux/macOS):** config files `0600` (owner read/write), binaries `0700` (owner execute)
- **Windows:** `icacls` restricts access to SYSTEM and Administrators (by well-known SID); inherited permissions are removed. At startup the agent also locks its folder (`C:\F0`, including the work dir) the way `bootstrap-windows.ps1` does

### Process Isolation
- Each task executes in an isolated temporary directory
- Windows uses Job Objects for reliable process tree termination
- Output capture is capped at 1 MB
- Configurable execution timeout (`MaxExecutionTime`)

### Binary Integrity
- Downloaded test binaries are verified against SHA256 hash + expected file size before execution
- Agent updates are verified with Ed25519 cryptographic signatures over the SHA256 hash

### Self-Update \{#self-update}

An update that goes wrong can take a whole fleet offline, so the updater has several safeguards. Do not remove any of them.

- **Launch check** (`updater/verify_install.go`): after the new binary is swapped in, the agent runs `<final path> --version`. If that fails or reports a different version than the server advertised, the previous binary (`<path>.old`) is restored and the update fails. The check runs at the final path so that path-scoped allowlists apply.
- **Repeat-install guard**: `last_applied_update` in `state.json` stops the agent from installing the same artifact again after a restart.
- **Server side**: the backend only registers a binary whose embedded version equals the version it is registered as.
- **Windows restart**: besides Service Control Manager recovery, a fallback scheduled task (`AchillesAgentRestart`) restarts the service if it fails to start.

User-facing description: [Self-Updates](../../user-guide/agent-management/self-updates).

## Resilience Features

### Adaptive Backoff

The heartbeat and poll timers use adaptive intervals that increase during extended server outages (60s → 5min → 15min → 30min cap). On first successful heartbeat, intervals snap back to normal. This reduces wasted network requests while maintaining fast recovery.

### Local Result Queue

When result reporting fails after all retries, the result is persisted as a JSON file in `{WorkDir}/queue/`. The queue drains automatically after each successful heartbeat. Maximum 100 files, FIFO order, restricted permissions (0600).

### Disconnect Reason Detection

When a heartbeat fails, the agent records a real-time **disconnect context**:
- HTTP error classification (DNS failure, connection refused, timeout, TLS error, etc.)
- Network adapter state check (per-platform: sysfs on Linux, GetAdaptersAddresses on Windows, ifconfig on macOS)
- System metrics snapshot (disk free, memory, CPU at time of failure)

On reconnection, the agent derives a specific reason from this context and sends a `reconnect_context` object:
- If the process restarted: checks for version change (update), OS uptime (reboot), or resource pressure (OOM/disk)
- If the process was running: uses the network adapter state and HTTP error type

The backend enriches `went_offline` events with last-known heartbeat metrics (`probable_cause`) and merges agent context + backend inference into the final `came_online` event details.

Possible reasons: `service_restart`, `machine_reboot`, `update_restart`, `network_adapter_disabled`, `server_unreachable`, `dns_failure`, `network_unreachable`, `connection_timeout`, `tls_error`, `disk_pressure_crash`, `memory_pressure_crash`, `network_recovery`.

## Execution Model

1. Agent starts, loads its encrypted config and sweeps stale test leftovers
2. Enters the polling loop: heartbeat every 60 s, task poll every 30 s, update check every hour (defaults; intervals get +/- 5 s of jitter)
3. Each cycle: send heartbeat, check for tasks, check for updates
4. If task assigned: download binary -> verify -> execute -> report
5. If update available: download -> verify signature -> atomic replace -> launch check -> restart
