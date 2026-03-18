---
sidebar_position: 6
title: "Agent Self-Updates"
description: "How ProjectAchilles agents automatically update to new versions with cryptographic verification."
---

# Agent Self-Updates

## How Self-Updates Work

1. During heartbeat, the backend includes the latest agent version information
2. If a newer version is available, the agent downloads the new binary
3. The agent verifies the binary's **Ed25519 signature** (detached signature of SHA256 hash)
4. The agent replaces itself with the new binary
5. The service manager (systemd/SCM/launchd) restarts the agent

## Version Management

Upload new agent versions through the web UI:

1. Navigate to **Agents** → **Versions**
2. Upload the new binary for each platform/architecture
3. The backend automatically signs the binary with its Ed25519 private key
4. Agents will pick up the update on their next heartbeat

## Security

- Binaries are signed with **Ed25519** — the server's private key signs the SHA256 hash
- The agent's public key (received during enrollment) verifies the signature
- **Unsigned or tampered binaries are rejected**
- Updates are delivered via HTTPS with TLS enforcement

## Zero-Downtime

The update process is designed for zero downtime:
1. New binary downloaded to a temporary location
2. Signature verified
3. Atomic rename replaces the old binary
4. Service restarts automatically
