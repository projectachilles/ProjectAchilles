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
| **API Key Rotation** | Zero-downtime via heartbeat; 5-minute dual-key grace period |
| **Timing Oracle Prevention** | Constant-time bcrypt comparison; dummy hash when no match |
| **Encrypted Credentials** | AES-256-GCM; key from machine ID (non-portable) |

## Binary Integrity

| Protection | Implementation |
|------------|---------------|
| **SHA256 Verification** | Checksum verified before execution |
| **Ed25519 Signatures** | Detached signatures on agent binaries |
| **Isolated Execution** | Temp directories (0700), cleaned after execution |

## Rate Limiting

| Endpoint | Limit |
|----------|-------|
| Enrollment | 5 / 15 min per IP |
| Device | 100 / 15 min per agent |
| Download | 10 / 15 min per IP |
| Rotation | 3 / 15 min per IP |

## Platform Hardening

- **File Permissions**: Binary 0700, config 0600, work dirs 0700
- **Windows ACLs**: SYSTEM + Administrators only via icacls
- **Heartbeat Jitter**: +/-5s randomization prevents thundering herd
