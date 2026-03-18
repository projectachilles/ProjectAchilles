---
sidebar_position: 4
title: "Agent Technical Security Report"
description: "Customer-facing technical brief on ProjectAchilles agent security controls and architecture."
---

# Agent Technical Security Report

## Overview

This report provides a technical overview of the security controls implemented in the ProjectAchilles agent for customer security review.

## Agent Architecture

The agent is a statically compiled Go binary that runs as a system service. It communicates with the backend exclusively over HTTPS using mutual authentication (API key + TLS).

## Security Controls

### Enrollment
- Token-based with configurable TTL and max uses
- Timing-oracle resistant authentication
- Rate limited (5 requests / 15 min)

### Communication
- TLS enforced for non-localhost servers
- Replay protection via timestamp validation (5-min window)
- All requests include agent ID and API key headers

### Credential Protection
- API key encrypted at rest with AES-256-GCM
- Encryption key derived from machine ID via HMAC-SHA256
- Credentials are non-portable (bound to specific machine)

### Binary Integrity
- SHA256 checksum verification on all downloaded binaries
- Ed25519 digital signatures on agent updates
- Public key distributed during enrollment

### Task Execution
- Binaries run in isolated temp directories (mode 0700)
- Directories cleaned after execution
- Exit codes and output captured for reporting

### Self-Updates
- Ed25519 signature verification before applying
- Atomic file replacement
- Service auto-restart after update

### Monitoring & Audit Trail
- 60-second heartbeat interval with system metrics
- All actions logged with timestamps
- Stale task detection for offline agents
