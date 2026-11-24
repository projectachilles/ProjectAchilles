---
sidebar_position: 4
title: "Agent Technical Security Report"
description: "Technical brief on ProjectAchilles agent security controls and architecture, for an organization's security review."
---

# Agent Technical Security Report

## Overview

This report provides a technical overview of the security controls implemented in the ProjectAchilles agent for an organization's security review.

## Agent Architecture

The agent is a statically compiled Go binary that runs as a system service. It communicates with the backend exclusively over HTTPS. The server is authenticated by its TLS certificate and the agent by its API key.

## Security Controls

### Enrollment
- Token-based with configurable TTL and max uses
- Timing-oracle resistant authentication
- Rate limited (300 requests / 15 min per IP)

### Communication
- TLS enforced for non-localhost servers
- Replay protection via timestamp validation (5-min window)
- All requests include the agent ID (`X-Agent-ID`) and the API key (`Authorization: Bearer`)
- Zero-downtime API key rotation, delivered through the heartbeat

### Credential Protection
- API key encrypted at rest with AES-256-GCM
- Encryption key derived from the machine ID with PBKDF2-SHA256 (210,000 iterations)
- Credentials are non-portable (bound to specific machine)

### Binary Integrity
- SHA256 checksum verification on all downloaded binaries
- A test binary can be downloaded only by an agent that holds a task for that test
- Ed25519 digital signatures on agent updates
- Public key distributed during enrollment

### Task Execution
- Binaries run in isolated temp directories (mode 0700)
- Directories cleaned after execution; before and after every run the agent empties the shared artifact folder and the decoy folder, keeping its own files and undo files (names containing `cleanup`, `restore`, `backup` or `state`). With an unknown agent path it deletes only the test's own binaries. Symlinks and junctions are removed as links, never followed. Stale leftovers are also swept at startup
- On Windows the agent folder (`C:\F0`) is restricted to SYSTEM and Administrators
- Exit codes and output captured for reporting

### Self-Updates
- Ed25519 signature verification before applying
- Atomic file replacement, with the previous binary kept for rollback
- Launch check: the new binary must start and report the expected version, or the previous one is restored
- The agent does not install the same artifact twice
- Service auto-restart after update

### Monitoring & Audit Trail
- 60-second heartbeat interval with system metrics
- All actions logged with timestamps
- Stale task detection for offline agents
