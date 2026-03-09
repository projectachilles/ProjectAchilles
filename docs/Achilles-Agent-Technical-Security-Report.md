# Achilles Agent — Technical Security Report

**Document Classification:** Customer-Facing Technical Brief
**Version:** 1.0 | **Date:** March 2026
**Product:** ProjectAchilles Agent v0.6

---

## 1. Executive Summary

The Achilles Agent is a lightweight, purpose-built binary deployed to endpoints for continuous security validation. It executes authorized security tests, reports results, and self-updates — all under strict cryptographic controls. This document details the technical safeguards ensuring the agent operates securely, transparently, and with minimal footprint on customer infrastructure.

**Key security properties:**

- **Statically compiled Go binary** — zero runtime dependencies, no interpreter, no DLL/shared library attack surface
- **Machine-bound encrypted credentials** — API keys encrypted at rest with AES-256-GCM, bound to hardware identity
- **Ed25519-signed updates** — binary integrity verified cryptographically before any self-update
- **Zero-downtime key rotation** — dual-key grace period model enables seamless credential cycling
- **Immutable audit trail** — every lifecycle event logged in an append-only event store

---

## 2. Agent Architecture

### 2.1 Binary Properties

| Property | Detail |
|----------|--------|
| Language | Go 1.24 (compiled, memory-safe) |
| Linking | Fully static (`CGO_ENABLED=0`) |
| Platforms | Windows (amd64), Linux (amd64), macOS (amd64 + arm64) |
| Size | ~8–12 MB per platform |
| Symbols | Stripped (`-s -w` LDFLAGS) — no debug info in production binaries |
| Code Signing | Authenticode (Windows), ad-hoc codesign (macOS) |

The agent has **no external dependencies** — no Python, .NET, Java, or shared libraries required. This eliminates an entire class of supply-chain and dependency-confusion attacks. Static compilation also means the exact binary that was built, signed, and verified is what runs on the endpoint.

### 2.2 Service Installation

The agent installs as a native system service with auto-restart on failure:

| Platform | Service Manager | Restart Policy | Binary Permissions |
|----------|----------------|----------------|-------------------|
| Windows | SCM (`sc.exe`) | 3 retries, 10s delay | SYSTEM + Administrators only (icacls) |
| Linux | systemd | `Restart=always`, 10s | `0700` (owner rwx) |
| macOS | launchd | `KeepAlive=true` | `0700` + ad-hoc codesign |

Binary permissions are enforced at **three points**: installation, update, and every startup (retroactive hardening). On Windows, inherited ACLs are explicitly stripped, leaving only `SYSTEM(RX)` and `Administrators(F)`.

---

## 3. Enrollment & Authentication

### 3.1 One-Time Enrollment

Enrollment uses a **single-use, time-limited token** model:

1. Administrator generates an enrollment token via the management console
2. Token is **bcrypt-12 hashed** before storage — the plaintext is shown once and never persisted
3. Agent presents the token during enrollment over HTTPS
4. Server validates the token, registers the agent, and returns: Agent ID, API Key, Organization ID, Ed25519 update verification public key
5. Token use-count is atomically incremented (TOCTOU-safe) and cannot be reused beyond its limit

**Anti-enumeration:** Even when no valid tokens exist, the server performs a constant-time bcrypt comparison against a dummy hash, preventing timing-based token discovery.

### 3.2 Ongoing Authentication

Every agent request includes:

| Header | Purpose |
|--------|---------|
| `Authorization: Bearer ak_<key>` | API key authentication |
| `X-Agent-ID` | Agent identity binding |
| `X-Agent-Version` | Version tracking |
| `X-Request-Timestamp` | Replay protection (±5 min clock skew tolerance) |

The server always executes `bcrypt.compare()` regardless of whether the agent exists, ensuring **constant-time rejection** that reveals no information about registered agent IDs.

**Rate limiting:** Agent endpoints are rate-limited to 100 requests per 15-minute window per agent (not per IP), preventing resource exhaustion even when agents share a network proxy.

### 3.3 API Key Rotation

The platform supports both **manual** and **automatic** key rotation with a zero-downtime dual-key model:

1. A new API key is generated and stored as "pending" alongside the active key
2. During a **5-minute grace period**, both keys authenticate successfully
3. The new key is delivered to the agent via its next heartbeat response
4. The agent persists the new key (encrypted) and begins using it immediately
5. Once the agent uses the new key, the old key is retired

Automatic rotation can be configured on a 30–365 day interval and processes up to 5 agents per cycle to avoid burst load.

---

## 4. Communication Security

### 4.1 Transport Layer

- **TLS 1.2+ enforced** for all remote server communication (Go's default TLS stack)
- **HTTPS-only validation**: the agent rejects `http://` server URLs for non-localhost targets at startup
- **Redirect downgrade protection**: HTTP→HTTPS downgrades are blocked at both enrollment and runtime
- **Custom CA support**: customers can provide their own CA certificate for environments with internal PKI

### 4.2 Data in Transit

| Data Flow | Content | Protection |
|-----------|---------|------------|
| Heartbeat (every 60s) | Status, CPU/memory/disk metrics, version | TLS + API key auth |
| Task poll (every 30s ± jitter) | Task assignments | TLS + API key auth |
| Result submission | Exit code, stdout/stderr (1 MB cap), timing | TLS + API key auth |
| Binary download | Test binaries | TLS + SHA-256 integrity check |

**Thundering-herd mitigation:** All polling intervals include ±5 second random jitter to prevent synchronized bursts when many agents restart simultaneously.

---

## 5. Credential Protection at Rest

### 5.1 Machine-Bound Key Encryption

Agent API keys are **never stored in plaintext** on disk. The encryption scheme:

| Component | Specification |
|-----------|--------------|
| KDF | PBKDF2-SHA256, 210,000 iterations (OWASP 2023 recommendation) |
| Cipher | AES-256-GCM (authenticated encryption) |
| Salt | 16 bytes, random per encryption |
| Nonce | 12 bytes (GCM default), random per encryption |
| Binding | Machine hardware ID (see below) |

The encryption key is derived from a **platform-specific machine identifier**:

| Platform | Source | Stability |
|----------|--------|-----------|
| Windows | `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` | Persistent across reboots |
| Linux | `/etc/machine-id` (systemd) | Persistent, unique per install |
| macOS | `IOPlatformUUID` (hardware UUID) | Tied to hardware |

This ensures that **configuration files copied to a different machine cannot be decrypted** — a stolen config file is useless without the original hardware. The agent must re-enroll on a new machine.

### 5.2 Configuration File Security

- **Location:** `/opt/f0/achilles-agent.yaml` (Linux/macOS) or `C:\F0\achilles-agent.yaml` (Windows)
- **Permissions:** `0600` (Unix) or `SYSTEM + Administrators` only (Windows)
- **Content:** Server URL, Agent ID, encrypted API key, org ID, update public key
- **No secrets in cleartext:** Legacy plaintext keys are auto-migrated to encrypted format on first load

---

## 6. Binary Integrity & Update Security

### 6.1 Code Signing

| Platform | Method | Tool | Certificate |
|----------|--------|------|-------------|
| Windows | Authenticode | `osslsigncode` | Customer-managed PKCS#12 (PFX) |
| macOS | Ad-hoc signature | `rcodesign` | None required (satisfies Launch Constraints) |
| Linux | — | — | Not applicable |

Certificate passwords are **never passed as command-line arguments** (which would be visible in `/proc/PID/cmdline`). Instead, passwords are written to temporary files with mode `0600` and deleted immediately after use.

### 6.2 Ed25519 Signed Updates

Self-updates are protected by a **detached Ed25519 signature scheme**:

1. The server computes a SHA-256 hash of the new binary
2. The hash is signed with an Ed25519 private key (auto-generated, stored with `0600` permissions)
3. During enrollment, the agent receives the corresponding **public key**
4. Before applying any update, the agent **verifies the signature** against the downloaded binary's hash
5. Signature verification failure **blocks the update** with a clear error

This provides defense-in-depth: even if TLS were compromised, a man-in-the-middle cannot inject a malicious binary without the Ed25519 private key.

### 6.3 Update Application

| Platform | Strategy | Rollback |
|----------|----------|----------|
| Windows | Rename current → `.old`, rename new → current | Restore `.old` on failure |
| Linux | Atomic POSIX rename (overwrites in-place) | — |
| macOS | Atomic rename + re-codesign | — |

After update, the agent exits cleanly and the service manager (SCM/systemd/launchd) restarts it automatically. Windows includes a **Task Scheduler fallback** that fires after 2 minutes if the SCM restart does not trigger.

---

## 7. Task Execution & Isolation

### 7.1 Execution Model

1. Agent polls for tasks → server assigns one task at a time (no parallel execution)
2. Binary downloaded with **SHA-256 and file-size verification** before execution
3. Binary placed in isolated temp directory, permissions set to `0700`
4. Executed with configurable timeout (default 5 minutes)
5. **stdout/stderr captured** (capped at 1 MB each) and reported with exit code

### 7.2 Process Management

| Platform | Isolation | Timeout Enforcement |
|----------|-----------|-------------------|
| Windows | **Job Object** (`KILL_ON_JOB_CLOSE`) — all child processes terminated atomically | Hard kill on timeout |
| Linux/macOS | Context-based timeout | `SIGTERM` + 10s `WaitDelay` → `SIGKILL` |

The Windows Job Object ensures that **no orphaned child processes** survive after a test completes or times out — a critical safety property for security tests that may spawn sub-processes.

---

## 8. Monitoring & Audit Trail

### 8.1 Heartbeat Telemetry

Every 60 seconds (± jitter), the agent reports:

- **Operational status**: idle or executing (with current task ID)
- **System metrics**: hostname, OS, architecture, uptime, CPU %, memory MB, disk free MB
- **Version**: current agent version

The server uses heartbeats for **offline detection** (3-minute threshold), version tracking, and fleet health dashboards.

### 8.2 Immutable Event Log

All agent lifecycle events are recorded in an **append-only audit table**:

| Event | Trigger |
|-------|---------|
| `enrolled` | Agent successfully enrolled |
| `came_online` | Agent heartbeat after >180s offline gap |
| `went_offline` | No heartbeat for 180 seconds |
| `task_completed` | Test execution finished |
| `task_failed` | Test execution failed or timed out |
| `version_updated` | Agent binary updated |
| `key_rotated` | API key rotation completed |
| `status_changed` | Agent status modified by admin |
| `decommissioned` | Agent permanently retired |

### 8.3 Remote Uninstall

Administrators can remotely uninstall any agent:

1. Agent receives uninstall task and **reports acknowledgment while still authenticated**
2. Platform-specific cleanup: stop service, remove service registration
3. Optional file cleanup (configurable `cleanup` flag)
4. Agent exits cleanly without restarting

---

## 9. Security Audit Summary

The agent has undergone a dedicated security review. All findings rated **Medium or above have been remediated**:

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | TLS verification bypass without safeguard | High | **Remediated** — HTTPS enforced for remote; `--allow-insecure` required for override |
| 2 | No API key rotation mechanism | High | **Remediated** — Dual-key zero-downtime rotation |
| 3 | No replay attack protection | Medium-High | **Remediated** — Request timestamp validation (±5 min) |
| 4 | Enrollment token timing oracle | Medium | **Remediated** — Constant-time bcrypt comparison |
| 5 | Unsigned agent updates | Medium | **Remediated** — Ed25519 detached signatures |
| 6 | Rate limiting gaps on sensitive endpoints | Medium | **Remediated** — Per-endpoint rate limits |
| 8 | Plaintext credential storage on disk | Medium | **Remediated** — AES-256-GCM + machine-bound key |
| 9 | Overly permissive file permissions | Medium | **Remediated** — Platform-specific hardening at install, update, and startup |

---

## 10. Summary of Security Controls

| Layer | Control |
|-------|---------|
| **Binary** | Static Go compilation, no dependencies, stripped symbols, code-signed |
| **Transport** | TLS 1.2+, HTTPS-only enforcement, redirect downgrade protection |
| **Authentication** | Bcrypt-12 hashed keys, constant-time comparison, replay protection |
| **Credentials at Rest** | AES-256-GCM with PBKDF2 (210K iterations), machine-hardware-bound |
| **Key Lifecycle** | Automatic rotation (30–365 day cycles), zero-downtime dual-key model |
| **Update Integrity** | SHA-256 + Ed25519 signature verification, atomic binary swap |
| **Process Isolation** | Windows Job Objects, configurable timeouts, graceful shutdown |
| **File System** | `0700`/`0600` permissions (Unix), SYSTEM+Admins ACL (Windows) |
| **Audit** | Append-only event log, heartbeat history, task result archive |
| **Fleet Management** | Remote uninstall, offline detection, stale task cleanup |

---

*For questions about the Achilles Agent security architecture, contact your ProjectAchilles account representative.*
