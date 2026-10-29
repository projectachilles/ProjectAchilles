---
sidebar_position: 9
title: "Sophos Endpoints"
description: "REST API endpoints for the Sophos Central integration: alerts, SIEM events, XDR detections, Health Check posture, sync and auto-resolve."
---

# Sophos Endpoints

All Sophos endpoints require Clerk authentication. Analytics endpoints require
the `analytics:dashboards:read` permission; integration endpoints require
`integrations:read` or `integrations:write`.

All analytics endpoints return `400 {"success": false, "error": "Sophos integration is not configured"}`
until the integration is configured.

:::info[Docker-style backends only]
The Sophos integration exists only in `backend/` (Docker Compose, the public /
on-prem server, Railway, Render, Fly.io). `GET /api/capabilities` reports
`sophos: true` there and `sophos: false` on Vercel, where `backend-serverless/`
mounts no Sophos routes.
:::

## Analytics Endpoints

Base path: `/api/analytics/sophos`

The alert, trend and correlation endpoints run the
[CrowdStrike analytics queries](./crowdstrike#analytics-endpoints) against the
`achilles-sophos` index. All vendors share the same normalized alert document
shape, and the Sophos enrichment pass writes `f0rtika.sophos_detected` /
`_stage_detected` / `_prevented` on result documents with the same rules, so
parameters and response shapes match. Only the differences are listed here.

| Difference from CrowdStrike | Detail |
|-----------------------------|--------|
| Posture score | `/correlation/scores` carries the Achilles average of the Sophos Health Check scores in `ztaScore` (the field name is kept for compatibility). |
| Record-type filter | `GET /alerts` also accepts `sourceType`. |
| Techniques | Come only from XDR detections; rows without XDR have `mitre_techniques: []`. |
| Evidence flags | Technique coverage reads `f0rtika.sophos_*`. |
| Posture endpoints | `/posture/health-check`, `/posture/endpoint-health`, `/posture/policies`, `/posture/exclusion-gaps` are Sophos-only. |

### Alerts

```
GET /api/analytics/sophos/alerts/summary
GET /api/analytics/sophos/alerts
GET /api/analytics/sophos/alerts/trend
```

Same parameters and shapes as the
[CrowdStrike alert endpoints](./crowdstrike#alerts), including the
[`from` / `to` window](./crowdstrike#window-parameters), the
[`source` and `severity` feed filters](./crowdstrike#alert-feed-filters) and the
`counts` object. Severities are normalized to `critical`, `high`, `medium`,
`low`, `informational` (the raw Sophos value is kept in `severity_raw`).

| Query param | Description |
|-------------|-------------|
| `sourceType` | `alert` (Common Alert), `xdr_detection` or `siem_event`. Any other value is ignored. |

`sourceType` narrows every count in `counts`; `/alerts/summary` and
`/alerts/trend` don't take it.

`counts.byPrevention` (`prevented` / `detected_only` / `kill_failed`) is built
from the `prevention_action` recorded from Sophos' own response: a successful
file remedy → `quarantined`, process remedy → `process_killed`, a block with no
remedy items (AMSI, blocklist, prevented exploit, legacy cleanup) → `blocked`;
a failed cleanup → `kill_failed` (detection only). XDR detections never carry a
prevention action. A cleanup or action more than 15 minutes after the detection
is ignored.

### Technique Coverage and Cross-Correlation

```
GET /api/analytics/sophos/correlation/scores
GET /api/analytics/sophos/correlation/techniques
GET /api/analytics/sophos/correlation/detection-rate
GET /api/analytics/sophos/correlation/technique-coverage
GET /api/analytics/sophos/correlation/alerts-for-test
```

Same execution set, evidence rule and response shapes as the
[CrowdStrike Technique Coverage](./crowdstrike#technique-coverage) (default
window: last 30 days) and the
[SentinelOne cross-correlation endpoints](./sentinelone#cross-correlation).
`/correlation/alerts-for-test` requires `techniques` and `timestamp` (`400`
otherwise); `windowMinutes` (default 30), `hostname`, `binaryName` and
`bundleName` are optional. `/correlation/scores` points are
`{ date, defenseScore, ztaScore }` with `ztaScore` the day's last Health Check
headline, `null` on days without one.

### Posture

```
GET /api/analytics/sophos/posture/health-check?days=<n>
GET /api/analytics/sophos/posture/endpoint-health
GET /api/analytics/sophos/posture/policies
GET /api/analytics/sophos/posture/exclusion-gaps?from=<iso>&to=<iso>
```

These endpoints read the local snapshots in `achilles-sophos`; they never call
Sophos. The posture pass writes them after a sync, at most every 6 hours, with
read-only requests. When Elasticsearch isn't configured or the pass hasn't run
they return empty results.

- **`/posture/health-check`** (`days` default 30, clamped to 1-365): `{ latest,
  trend }`. `latest` holds the `headline` (the **Achilles average of Sophos
  Health Check scores**), the `categories` (protection, policy, exclusions,
  tamper protection as `protection`, `policy`, `exclusions`,
  `tamper_protection`, each with its `score` and `computer` / `server` /
  `global` split) and `items`, the flagged counts from Sophos (counts, not device
  names). `trend` is `[ { date, score } ]`, oldest first, and starts with 30 days imported from
  Sophos' history at the first sync.
- **`/posture/endpoint-health`**: `{ total, notSeen7d, outOfDate, tamperOff,
  isolated, healthBad, healthSuspicious, xdrInstalled }`.
- **`/posture/policies`**: `{ items: [ { id, name, type, enabled, appliesTo,
  deviations: [ { key, value, recommended } ] } ] }`.
- **`/posture/exclusion-gaps`**: `{ critical, gaps, notes }`. `critical`
  entries have `kind` (`certificate_allow`, `folder_exclusion`,
  `agent_process_exclusion`), `value` and `detail`. `gaps` are unprotected
  tests on hosts whose path an exclusion or allowed item covers (`hostname`,
  `path`, `lastRunAt`, `exclusion`, `testUuid`). `from` / `to` are optional.

## Integration Endpoints

Base path: `/api/integrations/sophos`

### Configuration

```
GET    /api/integrations/sophos
POST   /api/integrations/sophos
DELETE /api/integrations/sophos
POST   /api/integrations/sophos/test
```

- **`GET /sophos`** (`integrations:read`): masked settings. The secret is never
  returned, only `client_secret_set`, plus `configured` and `env_configured`.
- **`POST /sophos`** (`integrations:write`): save settings (partial update).
  `client_id` and `client_secret` are required on the first save, and a changed
  `client_id` requires its `client_secret` (`400` otherwise). Refused with
  `400` while the credentials come from `SOPHOS_*` environment variables. A
  background sync starts after saving; changing the client ID clears the
  checkpoints. Saving `permission_mode: "read_only"` turns an `enabled`
  auto-resolve mode into `disabled` (`dry_run` is kept).
- **`DELETE /sophos`** (`integrations:write`): remove the stored settings.
  Refused with `400` for env-configured credentials. Data in Elasticsearch is
  kept.
- **`POST /sophos/test`** (`integrations:write`): signs in with the body's
  `client_id` / `client_secret` (the stored secret is only used with the stored
  client ID), identifies the tenant, rejects partner and organization
  credentials, and probes each capability once. Always HTTP 200:

  ```jsonc
  { "success": true, "region": "eu01", "tenantId": "<tenant-id>",
    "capabilities": { "alerts": "available", "siem": "available",
      "health_check": "available", "xdr_graphql": "forbidden", "xdr_rest": "unknown" } }
  ```

  or `{ "success": false, "error": "..." }`. A capability is `available`,
  `forbidden` (the role is too low), `not_licensed` (Sophos said so
  explicitly) or `unknown`.

**`POST /sophos` body** (every field optional on an edit):

```jsonc
{
  "client_id": "<client-id>",
  "client_secret": "<client-secret>",
  "label": "Production tenant",
  "permission_mode": "read_only",      // or "response"
  "poll_interval_minutes": 5,          // 1-1440
  "detection_backfill_days": 30        // 1-90
}
```

| Field | Validation |
|-------|------------|
| `client_id` | 8-200 characters |
| `client_secret` | 8-4096 characters |
| `label` | Up to 120 characters |
| `permission_mode` | `read_only` or `response` |

Schema failures return `400` with `error` and `details`. Auto-resolve is not
part of this body; use its own route.

With `REQUIRE_ORG_ISOLATION=true`, `POST`, `DELETE`, `/test`, `/sync` and
`PUT /auto-resolve/mode` return `403` (the Sophos configuration is
deployment-wide); use the `SOPHOS_*` environment variables.

### Sync

```
POST /api/integrations/sophos/sync
GET  /api/integrations/sophos/sync/status
```

- **`POST /sophos/sync`** (`integrations:write`): start a manual sync. Body
  `{ "reset": true }` (optional) clears the checkpoints first, so the initial
  backfill runs again (`403` with `REQUIRE_ORG_ISOLATION=true`). Returns
  **`202`** at once and runs in the background:

  ```json
  { "success": true, "data": { "started": true, "inProgress": true } }
  ```

  If a sync is already running nothing new starts and `reset` isn't applied:
  `202` with `{ "started": false, "inProgress": true }`. `400` when not
  configured.
- **`GET /sophos/sync/status`** (`integrations:read`):

  | Field | Description |
  |-------|-------------|
  | `inProgress` | A sync is running |
  | `lastAttemptAt` | Start time of the last sync |
  | `lastSiemSync`, `lastAlertSync`, `lastDetectionSync` | Checkpoint per source |
  | `syncGap` | `{ from, to }` when SIEM events were missed (Sophos keeps 24 h), else `null` |
  | `lastError` | `{ stage, message, at }` of the last failure, or `null` |
  | `lastSyncResult` | The last run's per-source counts plus the enrichment and auto-resolve pass results |

  The in-memory status resets on restart; checkpoints and the gap are filled
  from the persisted settings.

### Auto-Resolve

```
GET /api/integrations/sophos/auto-resolve/status
PUT /api/integrations/sophos/auto-resolve/mode
GET /api/integrations/sophos/auto-resolve/receipts?limit=<n>&offset=<n>
```

- **`/auto-resolve/status`** (`integrations:read`): `{ success, data: { mode,
  permission_mode, counts, dry_run_counts, lastAutoResolve } }`. `counts` are
  real resolutions (`f0rtika.auto_resolved: true`) per `last24h` / `last7d` /
  `last30d`; `dry_run_counts` are dry-run receipts, counted separately.
  `lastAutoResolve` is the last pass result or `null`.
- **`/auto-resolve/mode`** (`integrations:write`): body `{ "mode":
  "disabled" | "dry_run" | "enabled" }`; returns `{ success, data: { mode } }`.
  `400` when not configured, or for `enabled` unless the integration is in
  Response mode.
- **`/auto-resolve/receipts`** (`integrations:read`): `{ success, data: { items,
  total, limit, offset } }`, newest first, including dry-run receipts. `limit`
  defaults to 20 (1-100). Each item has `alert_id`, `alert_title`, `severity`,
  `source_type`, `achilles_test_uuid`, `auto_resolved_at`,
  `auto_resolve_dry_run_at`, `auto_resolve_mode` and `auto_resolve_error`
  (`not_found`, `not_actionable`, `invalid_id` or `null`).

:::note[No manual response actions]
There are no routes to isolate, scan, clean or allow-list on demand. The only
writes to Sophos come from the opt-in auto-resolve pass, which requires
Response mode: `POST /common/v1/alerts/{id}/actions` with `acknowledge`, and the
GraphQL `detectionUpdateResolutionInfo` mutation with `TRUE_POSITIVE_BENIGN`. In
read-only mode the API client refuses everything else before it is sent.
:::

See [Sophos Auto-Resolve](../user-guide/integrations/sophos-auto-resolve) for
the feature walkthrough.
