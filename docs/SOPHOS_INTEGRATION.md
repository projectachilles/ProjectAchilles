# Sophos Integration for ProjectAchilles

## Overview

This adds a native **Sophos Central (Intercept X)** integration to ProjectAchilles, comparable to the SentinelOne integration. User documentation lives in the wiki: [Sophos integration](../wiki/docs/user-guide/integrations/sophos.md), [auto-resolve](../wiki/docs/user-guide/integrations/sophos-auto-resolve.md), [Analytics tab](../wiki/docs/user-guide/analytics/sophos.md), the [API reference](../wiki/docs/api-reference/sophos.md) and the endpoint guide, [Endpoint Prerequisites](../wiki/docs/deployment/endpoint-prerequisites.md#sophos-intercept-x).

The integration runs on the Docker-style backends (`backend/`). Vercel deployments (`backend-serverless/`) don't include it, and `GET /api/capabilities` reports `sophos: false` there, which hides it in the UI.

- **Data sources:** Common Alerts (`/common/v1/alerts`), SIEM events (`/siem/v1/events`, which Sophos keeps for 24 hours) and XDR detections (GraphQL at `api.taegis.sophos.com`, REST v1 fallback). ATT&CK techniques come only from XDR detections (Sophos EDR, XDR or MDR licence).
- **Posture:** the Sophos Account Health Check, shown as the Achilles average of its category scores, plus endpoint health, threat-protection policy deviations and exclusion / allow-list gaps.
- **One tenant per install:** partner and organization credentials are rejected.
- **Permission modes:**
  - **Read-only (default):** only `GET` requests and read-only GraphQL queries; every write is blocked client-side.
  - **Response:** lets the opt-in auto-resolve pass acknowledge Common Alerts and mark XDR detections `TRUE_POSITIVE_BENIGN`. There are no manual response actions.
- **Auto-resolve is OFF by default** (off, dry run, on).
- **Rate limit:** Achilles uses at most 50 of the tenant's 100 requests per minute.
- **Secret storage:** the client secret is stored AES-256-GCM encrypted and is never returned to the frontend or written to logs.

## Configuration

1. In Sophos Central go to **Global Settings → API Credentials Management** (tenant level) and add a credential:
   - **Read-only mode:** `Service Principal Read-Only`.
   - **Response mode:** `Service Principal Management` or `Super Admin` (the write role is still being confirmed).
2. Copy the **client ID** and the **client secret** (shown once).
3. In ProjectAchilles go to **Settings → Integrations → Sophos** and fill in the client ID and secret.
4. Click **Test Connection** (it shows the data region and one line per capability), then **Save Settings**.

Alternatively set `SOPHOS_CLIENT_ID`, `SOPHOS_CLIENT_SECRET`, and optionally `SOPHOS_PERMISSION_MODE` (`read_only` or `response`) and `SOPHOS_LABEL`. While they are set, the UI can't save or disconnect.

## ProjectAchilles permissions

Saving or testing the integration needs `integrations:write`, which the **admin** role has. A user without a role gets `HTTP 403 {"success":false,"error":"Insufficient permissions"}` from ProjectAchilles itself, not from Sophos. With `REQUIRE_ORG_ISOLATION=true` (multi-tenant) every Sophos write route, including manual **Sync now**, returns 403 from the UI: use the environment variables.

## Security notes

- **Least privilege:** use a `Service Principal Read-Only` credential unless you use auto-resolve; give the admin role only to users who manage integrations.
- **Never exempt the tests in Sophos.** Don't allow the Achilles signing certificate, exclude `C:\F0` or the agent process, or add Server Lockdown allowances for the agent. The Sophos tab flags these as critical. See the endpoint guide.
- **The client never reads the per-endpoint tamper-protection password**, and never sends clean, allow-list, isolation or scan actions.
- **Response mode lets ProjectAchilles write to your Sophos tenant.** Keep it read-only unless you use auto-resolve.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Test Connection: "use a tenant API credential" | A partner or organization credential | Create the credential at tenant level |
| A capability shows `forbidden` | The credential's role is too low | Raise the role (see the `403` message) |
| XDR detections `not licensed` | No Sophos EDR / XDR / MDR licence | Expected; alerts, SIEM evidence and posture still work |
| "Sophos sync gap" warning | Achilles hasn't polled for more than about 23 hours and Sophos keeps only 24 hours of SIEM events | Restore polling; the gap clears after a reset or a clean poll 24 hours later |
| Save returns 400 about environment variables | `SOPHOS_*` env credentials are set | Change the env vars, or remove them to configure from the UI |
| Save or Sync returns 403 | `REQUIRE_ORG_ISOLATION=true` | Configure with the `SOPHOS_*` env vars |
| Auto-resolve pass stops with `403` | The credential can't acknowledge or resolve | Give it Service Principal Management or Super Admin |
