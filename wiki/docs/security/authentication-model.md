---
sidebar_position: 2
title: "Authentication Model"
description: "ProjectAchilles three-tier authentication model — Clerk, agent API keys, and enrollment tokens."
---

# Authentication Model

## Three-Tier Model

### Tier 1: Clerk (Web UI)

All web routes require Clerk JWT authentication.

- Social login (Google, Microsoft, GitHub)
- Email/password authentication
- Short-lived tokens with automatic refresh
- Session isolation per user

### Tier 2: Agent API Keys

Agents authenticate with unique keys issued during enrollment.

- Separate from Clerk — agents do not need web credentials
- Keys bound to specific agent ID
- **Zero-downtime rotation** — new key delivered via heartbeat, old key valid for 5-minute grace period
- Stored encrypted at rest (AES-256-GCM with machine-bound key derivation)

### Tier 3: Enrollment Tokens

One-time or limited-use tokens for agent registration.

- Configurable TTL and maximum usage count
- Revocable through admin interface
- Timing-oracle resistant (constant-time bcrypt with dummy hash on miss)

### Tier 4: Integration Credentials

Third-party service credentials stored encrypted:

- Microsoft Defender: tenant/client/secret
- Slack webhook URL
- SMTP credentials
- All AES-256-GCM encrypted at rest in `~/.projectachilles/integrations.json`
