# Agent API Key Security Analysis

**Date:** 2026-02-14
**Scope:** Difficulty of recovering/decrypting an agent API key

## Key Generation

- **Format:** `ak_` prefix + 64 hex characters (from `crypto.randomBytes(32)`)
- **Total length:** 67 characters
- **Entropy:** 256 bits from OS CSPRNG
- **Source:** `backend/src/services/agent/enrollment.service.ts`

## Attack Surface 1: Server-side (SQLite Database)

The `api_key_hash` column stores a **bcrypt-12** hash.

| Factor | Value |
|--------|-------|
| Search space | 2^256 possible keys |
| Hash cost | 2^12 = 4,096 Blowfish iterations per attempt |
| GPU acceleration | bcrypt is memory-hard — ~10-100x slower on GPUs vs MD5/SHA |
| Estimated rate (high-end GPU cluster) | ~50,000 bcrypt-12/sec |
| Time to exhaust keyspace | ~10^65 years |

**Verdict: Computationally impossible.** Even with every computer on Earth, the heat death of the universe arrives first. Bcrypt is almost overkill here — the 256-bit entropy alone makes brute force infeasible even with a fast hash like SHA-256. The bcrypt serves as defense-in-depth against a hypothetical future weakness in the key generation.

## Attack Surface 2: Agent-side (On-disk Config)

The key is encrypted with **AES-256-GCM**, derived from:

```
key = HMAC-SHA256(salt="achilles-agent-config-v1", message=machineID)
```

This is the **weaker** of the two surfaces, but still strong:

| Factor | Assessment |
|--------|------------|
| AES-256-GCM | No known practical attacks |
| Key derivation | HMAC-SHA256 — cryptographically sound but **no stretching** (single pass) |
| Machine ID as secret | Depends on platform — typically a UUID in `/etc/machine-id` or registry |
| Salt | **Static, hardcoded** (`"achilles-agent-config-v1"`) |

The agent-side encryption is **machine-binding**, not traditional secrecy. The goal is to ensure a stolen config file is useless on a different machine. This is a common pattern in endpoint agents (similar to DPAPI on Windows).

- **If attacker has root on the agent host:** Trivial — read machine ID, derive key, decrypt. But at that point they already own the machine, so the API key is the least of the concerns.
- **If attacker has only the encrypted config file (stolen backup, etc.):** They need to guess/obtain the machine ID. Machine IDs are UUIDs (128-bit) — not brute-forceable. But they're not secret in the traditional sense (readable by any local user, sometimes leaked in logs).

## Attack Surface 3: Network Interception

The key travels as `Authorization: Bearer ak_...` over HTTP. If TLS is properly configured, this is a non-issue. If not (e.g., dev environment on plain HTTP), the key is trivially captured.

## Overall Assessment

| Scenario | Difficulty |
|----------|------------|
| Brute-force from bcrypt hash | **Impossible** (256-bit key + bcrypt-12) |
| Decrypt stolen config file without machine access | **Very hard** (need machine ID) |
| Decrypt config with root on same machine | **Trivial** (by design — it's machine-binding, not secrecy) |
| Network sniff without TLS | **Trivial** |
| Network sniff with TLS | **Infeasible** |
| Timing side-channel on auth endpoint | **Mitigated** (dummy hash comparison on unknown agents) |

## Additional Mitigations Present

- **Timing oracle protection:** Always runs `bcrypt.compare` even for unknown agents (uses a dummy hash)
- **Replay protection:** RFC3339 timestamp validation with 5-minute skew tolerance
- **Key rotation:** Grace-period model — both old and new keys valid for 5 minutes during rotation
- **Uniform error responses:** Same 401 message for all failure modes (prevents enumeration)

## Minor Hardening Opportunity (Low Priority)

The agent-side key derivation uses a single HMAC pass with no key stretching. Since the machine ID has decent entropy (~128 bits for a UUID), this is fine in practice. But if machine IDs were ever predictable (e.g., sequential VM IDs in a cloud environment), the lack of stretching (like PBKDF2 or Argon2) would make enumeration faster. Not a vulnerability, just a potential improvement.

## Relevant Source Files

| Component | File |
|-----------|------|
| Key generation & hashing | `backend/src/services/agent/enrollment.service.ts` |
| Database schema | `backend/src/services/agent/database.ts` |
| Auth middleware | `backend/src/middleware/agentAuth.middleware.ts` |
| Agent-side encryption | `agent/internal/config/keyprotect.go` |
| Agent HTTP client | `agent/internal/httpclient/client.go` |
| Agent config loading | `agent/internal/config/config.go` |
