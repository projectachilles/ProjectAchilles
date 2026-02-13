# Agent Communication Security Findings

Audit date: 2026-02-13
Auditor: Internal security review

## Summary

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | SkipTLSVerify no production guard | HIGH | **Fixed** |
| 2 | No API key rotation | HIGH | **Fixed** |
| 3 | No replay attack protection | MED-HIGH | **Fixed** |
| 4 | Enrollment token timing oracle | MEDIUM | Open |
| 5 | Agent updates lack signature verification | MEDIUM | Open |
| 6 | Rate limiting gaps on expensive endpoints | MEDIUM | Open |
| 7 | Hostname disclosure in heartbeat payloads | LOW-MED | Open |

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

### Future Work

Agent-side automated key rotation (requires trusted push channel, e.g., mTLS or signed rotation commands).

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
**Status:** Open

### Description

The enrollment endpoint iterates over candidate tokens using `bcrypt.compare()` and breaks on first match. An attacker could potentially distinguish "no tokens match" (fast — zero bcrypt operations when no candidates exist) from "tokens exist but don't match" (slow — N bcrypt operations). This leaks information about whether valid tokens exist.

### Affected Files

- `backend/src/services/agent/enrollment.service.ts` (lines 68-82)

### Current Mitigations

- Enrollment tokens are short-lived (default 24h TTL)
- Tokens are single-use by default
- The timing difference requires network-level measurement precision

### Recommended Fix

Always perform at least one `bcrypt.compare()` against a dummy hash when no candidates are found, similar to the pattern already used in `agentAuth.middleware.ts` (the `DUMMY_HASH` approach).

---

## Finding 5: Agent Updates Lack Signature Verification

**Severity:** MEDIUM
**Status:** Open
**MITRE ATT&CK:** T1195.002 (Supply Chain Compromise: Compromise Software Supply Chain)

### Description

The agent self-update mechanism downloads new binaries from the server and replaces itself, but only verifies the SHA256 hash. If the server is compromised, an attacker could serve a malicious binary with a matching hash in the `agent_versions` table.

### Affected Files

- `agent/internal/updater/` (update logic)
- `backend/src/services/agent/` (version publishing)

### Current Mitigations

- TLS encryption protects the download channel (when properly configured)
- SHA256 hash verification prevents corruption in transit

### Recommended Fix

Sign agent binaries with the code signing certificate and verify the signature before applying the update. The signing infrastructure already exists for Windows (osslsigncode) and macOS (rcodesign) builds.

---

## Finding 6: Rate Limiting Gaps on Expensive Endpoints

**Severity:** MEDIUM
**Status:** Open
**MITRE ATT&CK:** T1499 (Endpoint Denial of Service)

### Description

Several agent endpoints involve expensive operations (bcrypt hashing, database writes) but lack per-IP or per-agent rate limiting:
- `POST /api/agent/enroll` — bcrypt comparison against all valid tokens
- `POST /api/agent/heartbeat` — bcrypt verification + DB write on every call
- `POST /admin/agents/:id/rotate-key` — bcrypt hash generation

### Affected Files

- `backend/src/middleware/` (rate limiting middleware)
- `backend/src/api/agent/` (route handlers)

### Current Mitigations

- Agent heartbeats are naturally throttled by `heartbeat_interval` (default 60s)
- Enrollment tokens expire and are single-use

### Recommended Fix

Add express-rate-limit middleware on agent endpoints:
- Enrollment: 5 attempts per IP per 15 minutes
- Heartbeat: 10 requests per agent per minute
- Key rotation: 3 attempts per admin per hour

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
