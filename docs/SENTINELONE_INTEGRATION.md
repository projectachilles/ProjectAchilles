# SentinelOne Integration for ProjectAchilles

> This version of ProjectAchilles, including the SentinelOne integration, was developed as a contribution to the project by **Max Garcia** and **Joan Cruz**.

## Overview

This contribution adds a native **SentinelOne (Singularity XDR)** integration to ProjectAchilles, at feature parity with the existing CrowdStrike integration. User documentation lives in the wiki: [SentinelOne integration](../wiki/docs/user-guide/integrations/sentinelone.md), [auto-resolve and automatic mitigation](../wiki/docs/user-guide/integrations/sentinelone-auto-resolve.md), [Analytics tab](../wiki/docs/user-guide/analytics/sentinelone.md) and the [API reference](../wiki/docs/api-reference/sentinelone.md).

The integration runs on the Docker-style backends (`backend/`). Vercel deployments (`backend-serverless/`) don't include it, and `GET /api/capabilities` reports `sentinelone: false` there, which hides it in the UI.

- **Data sources:** Threats (`/web/api/v2.1/threats`) and Detection alerts (`/web/api/v2.1/cloud-detection/alerts`).
- **Permission modes:**
  - **Read-only (default):** only `GET` requests are made; every write is blocked server-side.
  - **Response:** lets the opt-in auto-resolve and automatic-mitigation (kill / quarantine) passes write to the console. Manual response actions are not part of this release.
- **Automatic mitigation is OFF by default** and can only be enabled through an explicit option in the integration configuration. Auto-resolve is also off by default.
- **Polling and backfill:** configurable polling interval (minutes) and initial backfill (up to 365 days, depending on console retention).
- **Segmentation (optional):** filter by Account IDs, Site IDs, Group IDs, severity and incident status.
- **Token storage:** the API token is stored encrypted with AES-256-GCM. It is never returned to the frontend or written to logs, and it is sent to SentinelOne as `Authorization: ApiToken <token>`.

## Configuration

1. In the SentinelOne console go to **Settings → Users → Service Users** and create a Service User:
   - **Read-only mode:** `Viewer` role on the accounts/sites in scope (recommended).
   - **Response mode:** a role allowing incident status changes and threat mitigation (e.g. `IR Team` / `SOC`).
2. Generate an API token for that Service User (**Actions → Generate API Token**).
3. In ProjectAchilles go to **Settings → Integrations → SentinelOne** and fill in:
   - **Console URL:** `https://<your-console>.sentinelone.net` (or `*.s1gov.net`).
   - **API Token:** paste the raw token only, without the `ApiToken` prefix, quotes or whitespace.
   - **Segmentation:** use IDs that match the Service User's scope. A Site-scoped token filtered by Account ID will be rejected by SentinelOne.
4. Click **Test Connection**, then **Save Settings**.

## ProjectAchilles permissions

Saving or testing the integration needs `integrations:write`, which the **admin** role has. A user without a role gets `HTTP 403 {"success":false,"error":"Insufficient permissions"}` from ProjectAchilles itself, not from SentinelOne. Roles are set up as described in the [local quick start](../wiki/docs/getting-started/quick-start-local.md) (Clerk session-token claim plus the `admin` role in `public_metadata`); the installer creates the first admin for you.

## Security notes

- **Use `public_metadata`, never `unsafe_metadata`, for roles.** `public_metadata` can only be written from the Clerk Dashboard or the backend Secret Key, so users cannot grant themselves a role.
- **Role changes take effect on the next token refresh (about 60 s).** To revoke access immediately, also revoke the user's sessions in Clerk.
- **Least privilege:**
  - Give the admin role only to users who manage integrations; an admin can switch the integration to Response mode.
  - Use a `Viewer` Service User for Read-only mode.
  - Use `SOC` / `IR Team` only when auto-resolve or automatic mitigation is actually needed.
- **Protect the `.env` file.** It holds the encryption key used for stored tokens. Restrict its file permissions and never commit it.
- **Response mode lets ProjectAchilles write to your EDR console.** Keep it read-only unless you use auto-resolve or automatic mitigation, and limit who holds the admin role.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `403` with a ~52-byte body `{"success":false,"error":"Insufficient permissions"}` | The ProjectAchilles user has no admin role | Give the user the admin role (see *ProjectAchilles permissions*) |
| `403` with a SentinelOne error body (e.g. code `4030010`) | Service User role or scope is insufficient | Check the role and that the Account/Site IDs match the token's scope |
| Only Detection alerts fail | Console license or role lacks the Detection alerts module | Uncheck *Detection alerts* or adjust the license/role |
| `401` | Invalid or expired token, or the `ApiToken` prefix was pasted | Regenerate the token and paste the raw value only |

## Credits

SentinelOne integration and related changes contributed by **Max Garcia** and **Joan Cruz**.
