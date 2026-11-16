---
sidebar_position: 2
title: "Authentication Model"
description: "ProjectAchilles authentication model: Clerk, API keys and CLI tokens, agent keys, enrollment tokens and integration credentials."
---

# Authentication Model

## Three-Tier Model

### Tier 1: Clerk (Web UI)

All web routes require Clerk JWT authentication.

- Social login (Google, Microsoft, GitHub)
- Email/password authentication
- Short-lived tokens with automatic refresh
- Session isolation per user

Permissions come from a role (`admin`, `operator`, `analyst` or `explorer`) in
each user's Clerk public metadata, which the session token carries as the
`metadata` claim. A user with no role is read-only (`explorer`). When the claim
isn't configured, the backend looks the role up in Clerk for browser sessions
only (cached for a minute). Setup: [Clerk Setup](../deployment/clerk-setup#session-token-claim).

#### API keys and CLI tokens

Two bearer credentials stand in for a signed-in user. Neither has MFA or a
session step-up, so both are kept away from user and key management.

- **API keys** (`pa_...`, created under **Settings → API keys**) carry a scope
  instead of a role: `read` (every permission ending in `:read`), `read-write`
  (the `operator` permissions) or `admin` (the `admin` permissions without
  `settings:users:manage`). An `admin` key can run a shell command on any
  agent, so treat it like an admin password. API keys are not available on
  Vercel. See [Programmatic access](../api-reference/programmatic-access).
- **CLI tokens** are issued to the `achilles` CLI after a browser sign-in. The
  access token lasts one hour and is bound to the deployment: its audience is
  the server's `AGENT_SERVER_URL`, so a token from another install is refused
  even when both share a `CLI_AUTH_SECRET`. Changing `AGENT_SERVER_URL`
  invalidates outstanding access tokens; the CLI gets a new one on its next
  refresh. A token stops working when its user is removed or their role changes.

#### Actions that need a browser session

These are refused (403, `This action requires a signed-in user session`) for
API keys and CLI tokens, whatever their scope or role:

- everything under `/api/api-keys` (list, create, revoke);
- every change under `/api/users` (invite, change role, remove). An admin's CLI
  session can still list users and invitations;
- approving a CLI sign-in code (`POST /api/cli/auth/verify`);
- changing the console identity (`PUT` and `DELETE /api/settings/identity`).

So a leaked key or token can't create more keys or admins, and revoking it
contains the incident.

### Tier 2: Agent API Keys

Agents authenticate with unique keys issued during enrollment.

- Separate from Clerk — agents do not need web credentials
- Keys bound to specific agent ID
- The server stores only a bcrypt hash of each key
- **Zero-downtime rotation** — new key delivered via heartbeat; the rotation resolves on which key the agent presents, not on a timer, so an agent that was offline through the grace period is never locked out
- On the endpoint, the key is stored encrypted at rest (AES-256-GCM with machine-bound key derivation)
- Failed authentications with an unknown agent ID are limited to 60 per minute per IP address

### Tier 3: Enrollment Tokens

One-time or limited-use tokens for agent registration.

- Configurable TTL and maximum usage count
- Revocable through admin interface
- Timing-oracle resistant (constant-time bcrypt with dummy hash on miss)

### Tier 4: Integration Credentials

Third-party service credentials stored encrypted:

- Microsoft Defender: tenant/client/secret
- CrowdStrike Falcon: client ID/secret
- SentinelOne: API token
- Sophos Central: client ID/secret
- Slack webhook URL
- SMTP credentials
- All AES-256-GCM encrypted at rest in `~/.projectachilles/integrations.json`
