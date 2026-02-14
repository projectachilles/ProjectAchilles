# Agent Communication Security Findings

Audit date: 2026-02-13
Auditor: Internal security review

## Summary

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | SkipTLSVerify no production guard | HIGH | **Fixed** |
| 2 | No API key rotation | HIGH | **Fixed** |
| 3 | No replay attack protection | MED-HIGH | **Fixed** |
| 4 | Enrollment token timing oracle | MEDIUM | **Fixed** |
| 5 | Agent updates lack signature verification | MEDIUM | **Fixed** |
| 6 | Rate limiting gaps on expensive endpoints | MEDIUM | **Fixed** |
| 7 | Hostname disclosure in heartbeat payloads | LOW-MED | Open |
| 8 | Plaintext credential storage in agent config | MEDIUM | **Fixed** |
| 9 | Overpermissive file permissions on agent binary and work dirs | MEDIUM | **Fixed** |

---

## Finding 1: SkipTLSVerify No Production Guard

**Severity:** HIGH
**Status:** Fixed (commit `2600cc6`)
**MITRE ATT&CK:** T1557 (Adversary-in-the-Middle)

### Description

The agent config field `skip_tls_verify: true` disables all TLS certificate verification. There was no guard preventing this from being enabled against remote (non-localhost) servers in production, enabling man-in-the-middle attacks on agent-server communication.

### Affected Files

- `agent/internal/config/config.go`
- `agent/main.go`

### Fix

Added `ValidateTLSConfig()` method that blocks `skip_tls_verify` for non-localhost servers. A new `--allow-insecure` CLI flag provides an explicit override for legitimate self-signed certificate scenarios, with a warning logged at startup.

---

## Finding 2: No API Key Rotation

**Severity:** HIGH
**Status:** Fixed (commit `49c710a`)
**MITRE ATT&CK:** T1528 (Steal Application Access Token)

### Description

Agent API keys were generated once at enrollment and could never be rotated. A compromised key required full decommissioning and re-enrollment of the agent.

### Affected Files

- `backend/src/services/agent/enrollment.service.ts`
- `backend/src/api/agent/heartbeat.routes.ts`
- `backend/src/services/agent/database.ts`

### Fix

Added `POST /admin/agents/:id/rotate-key` admin endpoint. Generates a new `ak_`-prefixed key, bcrypt-hashes it, immediately invalidates the old key, and returns the new plaintext key exactly once. The admin must update the agent's config file with the new key out-of-band.

### Enhancement: Key Rotation UI

A frontend dialog was added to the Endpoints → Agents page, accessible via the agent action dropdown ("Rotate API Key"). Uses a two-phase flow: confirmation with warning → one-time display of the new key with copy-to-clipboard. This removes the operational friction of requiring curl for key rotation.

### Enhancement: Automated Key Delivery via Heartbeat

Zero-downtime key rotation was implemented using a grace-period dual-key model:

1. **Admin rotates key** → server stores the new key as "pending" (bcrypt hash + AES-256-GCM encrypted plaintext). The old key remains active.
2. **Grace period (5 min)** → both old and new keys authenticate. Each heartbeat response includes the new plaintext key in `new_api_key`.
3. **Agent auto-receives** → the agent parses the heartbeat response, updates `cfg.AgentKey` in memory, and calls `cfg.Persist()` to save the encrypted key to disk. Zero manual intervention.
4. **Promotion** → when the agent authenticates with the new key (or the grace period expires), the server promotes the pending key to primary and clears pending columns.

**Backwards compatibility**: Old agents (pre-rotation-support) ignore `new_api_key` in the heartbeat response. After the 5-minute grace period, the pending key is promoted and the old key stops working — identical to the previous immediate-rotation behavior, but with a 5-minute buffer.

---

## Finding 3: No Replay Attack Protection

**Severity:** MED-HIGH
**Status:** Fixed (commit `a159bc8`)
**MITRE ATT&CK:** T1557.002 (ARP Cache Poisoning), T1040 (Network Sniffing)

### Description

No timestamp validation or nonce tracking on agent requests. Captured requests (e.g., heartbeats, task results) could be replayed indefinitely.

### Affected Files

- `agent/internal/httpclient/client.go`
- `backend/src/middleware/agentAuth.middleware.ts`
- `backend/src/api/agent/heartbeat.routes.ts`

### Fix

Two-layer timestamp validation:
1. **Header layer:** Agent sends `X-Request-Timestamp` (RFC3339 UTC) on every request. Auth middleware rejects timestamps with >5 minute skew. Missing header triggers a warning but allows the request for backwards compatibility.
2. **Payload layer:** Heartbeat handler validates `payload.timestamp` is within 5 minutes of server time (defense-in-depth).

### Future Work

Nonce tracking (per-agent monotonic counter or UUID) to fully prevent replay of requests within the 5-minute window.

---

## Finding 4: Enrollment Token Timing Oracle

**Severity:** MEDIUM
**Status:** Fixed (commit `594d932`)
**MITRE ATT&CK:** T1110.001 (Brute Force: Password Guessing)

### Description

The enrollment endpoint iterates over candidate tokens using `bcrypt.compare()` and breaks on first match. An attacker could potentially distinguish "no tokens match" (fast — zero bcrypt operations when no candidates exist) from "tokens exist but don't match" (slow — N bcrypt operations). This leaks information about whether valid tokens exist.

### Affected Files

- `backend/src/services/agent/enrollment.service.ts`

### Fix

Added a pre-computed `DUMMY_HASH` constant. When no candidate tokens are found, `bcrypt.compare()` runs against the dummy hash before rejecting, ensuring at least one bcrypt operation always executes. This is the same pattern already used in `agentAuth.middleware.ts` (M2).

---

## Finding 5: Agent Updates Lack Signature Verification

**Severity:** MEDIUM
**Status:** Fixed (commit `e45df86`)
**MITRE ATT&CK:** T1195.002 (Supply Chain Compromise: Compromise Software Supply Chain)

### Description

The agent self-update mechanism downloads new binaries from the server and replaces itself, but only verifies the SHA256 hash. If the server is compromised, an attacker could serve a malicious binary with a matching hash in the `agent_versions` table.

### Affected Files

- `backend/src/services/agent/signing.service.ts` (new — Ed25519 keypair management)
- `backend/src/services/agent/update.service.ts` (sign on register, include sig in response)
- `backend/src/services/agent/enrollment.service.ts` (return public key at enrollment)
- `backend/src/services/agent/database.ts` (migration: `binary_signature` column)
- `backend/src/types/agent.ts` (type updates)
- `agent/internal/config/config.go` (`UpdatePublicKey` field)
- `agent/internal/enrollment/enrollment.go` (save public key)
- `agent/internal/updater/verify.go` (new — Ed25519 verification)
- `agent/internal/updater/updater.go` (verify before apply)

### Fix

Ed25519 detached signatures. Server auto-generates a signing keypair on first use (`~/.projectachilles/signing/`), signs the SHA256 hash of each binary during version registration, and includes the hex signature in version check responses. Agent receives the raw 32-byte public key (base64) during enrollment and saves it to config. Before applying updates, the agent verifies the Ed25519 signature over the downloaded binary's SHA256 hash.

**Backwards compatibility:**
| Scenario | Behavior |
|----------|----------|
| Old agent + new server | Agent ignores `signature` and `update_public_key` fields |
| New agent + old server | `UpdatePublicKey` empty → warns, allows update |
| New agent + new server (no sig) | `Signature` empty → warns, allows update |
| New agent + new server | Full Ed25519 verification |

---

## Finding 6: Rate Limiting Gaps on Expensive Endpoints

**Severity:** MEDIUM
**Status:** Fixed (commit `8302335`)
**MITRE ATT&CK:** T1499 (Endpoint Denial of Service)

### Description

Several agent endpoints involve expensive operations (bcrypt hashing, database writes) but lack per-IP or per-agent rate limiting:
- `POST /api/agent/enroll` — bcrypt comparison against all valid tokens
- `POST /api/agent/heartbeat` — bcrypt verification + DB write on every call
- `POST /admin/agents/:id/rotate-key` — bcrypt hash generation

### Affected Files

- `backend/src/api/agent/heartbeat.routes.ts`

### Fix

The audit found that enrollment (5/15min per IP), agent device endpoints (100/15min per agent), and downloads (10/15min per IP) were already rate-limited. Only the key rotation endpoint was missing a dedicated limiter.

Added `keyRotationLimiter`: 3 requests per 15 minutes per IP, applied to `POST /admin/agents/:id/rotate-key`. This prevents bcrypt-based CPU exhaustion through rapid rotation attempts.

**Rate limiting inventory:**
| Endpoint | Limiter | Budget |
|----------|---------|--------|
| `POST /enroll` | `enrollmentLimiter` | 5/15min per IP |
| `GET /download` | `downloadLimiter` | 10/15min per IP |
| Agent device endpoints | `agentDeviceLimiter` | 100/15min per agent |
| `POST /rotate-key` | `keyRotationLimiter` | 3/15min per IP |

---

## Finding 7: Hostname Disclosure in Heartbeat Payloads

**Severity:** LOW-MED
**Status:** Open
**MITRE ATT&CK:** T1082 (System Information Discovery)

### Description

Agent heartbeats include the system hostname in plaintext (`payload.system.hostname`). This is stored in the database and exposed via admin API endpoints. If the server is compromised, the attacker gains an inventory of all internal hostnames.

### Affected Files

- `agent/internal/sysinfo/` (system info collection)
- `backend/src/services/agent/heartbeat.service.ts` (storage)

### Current Mitigations

- Admin endpoints require Clerk authentication
- Organization-scoped access via `requireAgentOrgAccess` middleware
- TLS encryption protects data in transit

### Recommended Fix

Consider hashing or truncating hostnames for display purposes, while retaining the full hostname in an encrypted field accessible only to authorized admins. Alternatively, accept the risk given the existing access controls and focus on strengthening server-side security.

---

## Finding 8: Plaintext Credential Storage in Agent Config

**Severity:** MEDIUM
**Status:** Fixed
**MITRE ATT&CK:** T1552.001 (Unsecured Credentials: Credentials In Files)

### Description

The agent API key (`agent_key`) was stored in plaintext in the YAML config file (e.g. `C:\F0\achilles-agent.yaml`). While `os.WriteFile` used mode `0600`, Windows ignores Unix mode bits — the file was readable by any local user. Even on Unix systems, a disclosed config file (via backup, forensic image, or LFI) would expose the key immediately, allowing agent impersonation from any machine.

### Affected Files

- `agent/internal/config/config.go`
- `agent/internal/config/secure_windows.go` (new)
- `agent/internal/config/secure_unix.go` (new)
- `agent/internal/config/keyprotect.go` (new)
- `agent/internal/config/machineid_linux.go` (new)
- `agent/internal/config/machineid_darwin.go` (new)
- `agent/internal/config/machineid_windows.go` (new)

### Fix

Two-layer defense:

1. **Platform-specific file permissions:** On Windows, `icacls` strips inherited permissions and grants only `NT AUTHORITY\SYSTEM` and `BUILTIN\Administrators` read/write access. On Unix, explicit `os.Chmod(0600)` is called after every write as defense-in-depth.

2. **Machine-bound encryption:** The agent key is encrypted with AES-256-GCM before writing to disk. The encryption key is derived via `HMAC-SHA256(salt="achilles-agent-config-v1", message=machineID)` where the machine ID comes from `/etc/machine-id` (Linux), `IOPlatformUUID` (macOS), or the Windows registry `MachineGuid`. This makes the config file useless if copied to another machine.

### Backwards Compatibility

| Scenario | Behavior |
|----------|----------|
| Old config (plaintext `agent_key`) | Auto-encrypts on first load, re-saves with `agent_key_encrypted` |
| New config (`agent_key_encrypted`) | Decrypts normally |
| Config moved to different machine | Decryption fails with clear error; agent must re-enroll |
| Machine ID unavailable (e.g. Docker) | Falls back to plaintext with warning |

---

## Finding 9: Overpermissive File Permissions on Agent Binary and Work Directories

**Severity:** MEDIUM
**Status:** Fixed
**MITRE ATT&CK:** T1222.002 (File and Directory Permissions Modification: Linux and Mac File and Directory Permissions Modification)

### Description

The agent binary was set to `0755` (`-rwxr-xr-x`) on Linux and macOS, allowing any local user to read and execute it. On Windows, the binary inherited directory permissions with no explicit ACL restriction. The same pattern applied to the task work directory (`0755`) and log file (`0644`).

Since the agent runs exclusively as a root-level system service (systemd, launchd, SCM/SYSTEM), no unprivileged user needs access. The overpermissive settings allow a local attacker to:
- Reverse-engineer the binary to learn the agent-server protocol
- Execute a rogue instance to probe behavior and discover server URLs
- Read test execution output from the work directory
- Read operational logs for reconnaissance

### Affected Files

- `agent/internal/updater/update_linux.go`
- `agent/internal/updater/update_darwin.go`
- `agent/internal/updater/update_windows.go`
- `agent/internal/executor/executor.go`
- `agent/internal/service/service_linux.go`
- `agent/internal/service/service_darwin.go`
- `agent/internal/service/service_windows.go`
- `agent/main.go`

### Fix

Applied least-privilege permissions across all agent file operations:

| Resource | Before | After | Rationale |
|----------|--------|-------|-----------|
| Agent binary (update) | `0755` | `0700` | Only root executes via service manager |
| Agent binary (install) | Inherited | `0700` / icacls | Harden admin-placed binary at install time |
| Test binary (download) | `0755` | `0700` | Only root executes test payloads |
| Work directory | `0755` | `0700` | Test output not world-readable |
| Log file | `0644` | `0640` | Operational logs restricted to owner + group |
| Windows binary (update) | Inherited | icacls: SYSTEM(RX) + Admins(F) | Explicit ACL, strip inherited permissions |
| Windows binary (install) | Inherited | icacls: SYSTEM(RX) + Admins(F) | Same |

**Three enforcement points:**
1. **At install time** — `platformInstall()` hardens the binary before starting the service, catching admin-placed binaries with default download permissions
2. **At update time** — `applyUpdate()` hardens the new binary before atomic rename
3. **At runtime** — executor and log file creation use restricted modes
