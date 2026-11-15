---
sidebar_position: 3
title: "Agent Security"
description: "Agent communication security hardening — TLS enforcement, replay protection, key rotation, and credential encryption."
---

# Agent Security

## Security Hardening Summary

The agent-server communication channel has been hardened through a dedicated internal audit covering 9 findings (all resolved).

## Transport Security

| Protection | Implementation |
|------------|---------------|
| **TLS Enforcement** | `skip_tls_verify` blocked for non-localhost; `--allow-insecure` override required |
| **Replay Protection** | `X-Request-Timestamp` with 5-minute skew window; payload-level defense-in-depth |

## Authentication

| Protection | Implementation |
|------------|---------------|
| **API Key Rotation** | Zero-downtime via heartbeat; 5-minute delivery window, resolved by which key the agent presents rather than by elapsed time |
| **Timing Oracle Prevention** | Constant-time bcrypt comparison; dummy hash when no match |
| **Key Digests** | After a key has passed bcrypt once, the server stores an HMAC-SHA256 digest bound to that key hash, so later requests skip bcrypt. Never trusted while a rotation is pending |
| **Encrypted Credentials** | AES-256-GCM; key derived from the machine ID with PBKDF2-SHA256 (non-portable) |

## Binary Integrity

| Protection | Implementation |
|------------|---------------|
| **SHA256 Verification** | Checksum and size verified before execution |
| **Download Scope** | An agent can download a test binary only for a task it currently holds |
| **Ed25519 Signatures** | The server signs the SHA256 of each agent update; the agent verifies it before installing |
| **Update Launch Check** | After an update is swapped in, the agent runs the new binary with `--version`; on failure it restores the previous binary |
| **Version Match** | The server registers an agent binary only when its embedded version equals the registered version |
| **Isolated Execution** | Temp directories (0700), cleaned after execution; the test's binaries are removed from the artifact folder after each run |
| **Trusted Results File** | `bundle_results.json` is read only from a folder other users cannot write to |

## Rate Limiting

| Endpoint | Limit |
|----------|-------|
| Enrollment | 300 / 15 min per IP |
| Device | 30 / min per IP + agent ID |
| Failed authentication (unknown agent IDs) | 60 / min per IP |
| Download | 300 / 15 min per IP |
| Rotation | 3 / 15 min per IP |

The enrollment and download budgets are sized for a fleet rollout behind one NAT address. See [Routes & Middleware](../developer-guide/backend/routes-middleware#rate-limiting-strategy).

## Platform Hardening

- **File Permissions**: Binary 0700, config 0600, work dirs 0700
- **Install Folder**: The agent installs into `C:\F0` (Windows) or `/opt/f0` (Linux, macOS)
- **Windows ACLs**: SYSTEM + Administrators only via icacls (well-known SIDs), on the binary, the config and the agent folder with its work dir. The agent re-applies the folder lock at every start (agent 0.7.1 and later)
- **Heartbeat Jitter**: +/-5s randomization prevents thundering herd
