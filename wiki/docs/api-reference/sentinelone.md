---
sidebar_position: 8
title: "SentinelOne Endpoints"
description: "REST API endpoints for the SentinelOne Singularity integration — alerts, cross-correlation, posture snapshots, sync, auto-resolve and automatic mitigation."
---

# SentinelOne Endpoints

All SentinelOne endpoints require Clerk authentication. Analytics endpoints
require the `analytics:dashboards:read` permission; integration endpoints
require `integrations:read` or `integrations:write`.

All analytics endpoints return `400 {"success": false, "error": "SentinelOne integration is not configured"}`
until the integration is configured.

:::info Docker-style backends only
The SentinelOne integration exists only in `backend/` (Docker Compose, the
public / on-prem server, Railway, Render, Fly.io). `GET /api/capabilities`
reports `sentinelone: true` there and `sentinelone: false` on Vercel, where
`backend-serverless/` mounts no SentinelOne routes at all.
:::

## Analytics Endpoints

Base path: `/api/analytics/sentinelone`

The alert, trend and correlation endpoints run the
[CrowdStrike analytics queries](./crowdstrike#analytics-endpoints) against the
`achilles-sentinelone` index. Both indexes share the same normalized alert
document shape, and the SentinelOne enrichment pass writes
`f0rtika.sentinelone_detected` / `_stage_detected` / `_prevented` on result
documents with the same rules, so the request parameters and response shapes
match the CrowdStrike endpoints. Only the differences are listed here.

| Difference from CrowdStrike | Detail |
|-----------------------------|--------|
| No ZTA score | There are no `/zta-score` routes. SentinelOne has no Zero Trust Assessment equivalent, so no posture score is invented. |
| `ztaScore` is always `null` | `/correlation/scores` returns the Defense Score series with `ztaScore: null` on every point. |
| Record-type filter | `GET /alerts` also accepts `sourceType` (see below). |
| Evidence flags | Technique coverage reads `f0rtika.sentinelone_*` flags instead of `f0rtika.crowdstrike_*`. |
| Posture endpoints | `/posture/policies`, `/posture/agent-health` and `/posture/exclusion-gaps` are SentinelOne-only (see [Posture](#posture)). |

### Alerts

```
GET /api/analytics/sentinelone/alerts/summary
GET /api/analytics/sentinelone/alerts
GET /api/analytics/sentinelone/alerts/trend
```

Same parameters and shapes as the
[CrowdStrike alert endpoints](./crowdstrike#alerts), including the
[`from` / `to` window](./crowdstrike#window-parameters) (`400 Invalid from/to`),
the [`source` and `severity` feed filters](./crowdstrike#alert-feed-filters)
(`400 Invalid source`), the `counts` object and the
[trend buckets](./crowdstrike#trend).

The alert documents contain both SentinelOne record types: **threats**
(`GET /web/api/v2.1/threats`) and **detection alerts**
(`GET /web/api/v2.1/cloud-detection/alerts`). SentinelOne severities are
`critical`, `high`, `medium`, `low`, `informational` and `unknown`. A threat
that carries no severity gets one from its confidence level
(`malicious` → `high`, `suspicious` → `medium`, `n/a` → `low`). Incident
statuses are `unresolved`, `in_progress` and `resolved`.

#### Record-type filter

`GET /alerts` accepts one more query parameter:

| Query param | Description |
|-------------|-------------|
| `sourceType` | `threats` or `cloud_detection_alerts`. Any other value is ignored (no filter, no error). |

`sourceType` is part of the main query, so unlike `source` and `severity` it
also narrows every count in `counts`. `/alerts/summary` and `/alerts/trend` do
not take it.

#### Prevention facet

`counts.byPrevention` (`prevented` / `detected_only` / `kill_failed`) is built
from the `prevention_action` recorded on each threat from its SentinelOne
mitigation report: a successful `quarantine` → `quarantined`, `kill` →
`process_killed`, `remediate` → `quarantined`; a failed kill, quarantine or
remediate → `kill_failed`; otherwise, when the report is empty, `blocked` if
the threat's mitigation status is `mitigated`. Detection alerts carry no
prevention action.

Only SentinelOne's own, immediate response counts: a report entry that started
more than 15 minutes after the threat was identified (`mitigationStartedAt` vs
`identifiedAt`) is a later manual or rule-driven response (an analyst
quarantining from the console, a STAR rule) and is ignored, so the stage stays
**detected**, not **prevented**. Entries without timestamps are kept.

Threats that Achilles [automatic mitigation](../user-guide/integrations/sentinelone-auto-resolve#automatic-mitigation)
killed or quarantined (an `enabled`, error-free `f0rtika.auto_mitigated`
receipt) are not SentinelOne preventions: they count under `detected_only`,
never `prevented`, and their alert items in `GET /alerts` carry no
`prevention_action`. This matches the enrichment pass and the Defense Score.

### Technique Coverage

```
GET /api/analytics/sentinelone/correlation/technique-coverage?from=<iso>&to=<iso>
```

Same execution set, evidence rule and response shape as the
[CrowdStrike Technique Coverage](./crowdstrike#technique-coverage), with the
`f0rtika.sentinelone_detected`, `f0rtika.sentinelone_stage_detected` and
`f0rtika.sentinelone_prevented` flags. Without `from`/`to` it defaults to the
last 30 days. `alerts` per row counts SentinelOne alerts.

Prevented means SentinelOne itself stopped the execution. A kill or quarantine
done by Achilles [automatic mitigation](../user-guide/integrations/sentinelone-auto-resolve#automatic-mitigation)
is never counted as prevented here (see
[Defense Score and coverage](../user-guide/integrations/sentinelone-auto-resolve#defense-score-and-coverage)).

### Cross-Correlation

```
GET /api/analytics/sentinelone/correlation/scores
GET /api/analytics/sentinelone/correlation/techniques
GET /api/analytics/sentinelone/correlation/detection-rate
GET /api/analytics/sentinelone/correlation/technique-coverage
GET /api/analytics/sentinelone/correlation/alerts-for-test
```

- **`/correlation/scores`** — Defense Score over time (`?days=<n>`, default
  90). Points are `{ date, defenseScore, ztaScore }` with `ztaScore` always
  `null`.
- **`/correlation/techniques`** — MITRE technique overlap between test results
  and SentinelOne alerts.
- **`/correlation/detection-rate`** — the legacy technique plus time-window
  heuristic (`?days=<n>` default 30, `?windowMinutes=<n>` default 60), kept
  for the CLI. See the
  [CrowdStrike Detection Rate](./crowdstrike#detection-rate) for the shape.
- **`/correlation/technique-coverage`** — evidence-based coverage that drives
  the Analytics tab (see [Technique Coverage](#technique-coverage)).
- **`/correlation/alerts-for-test`** — SentinelOne alerts matched to one test
  execution. `techniques` (comma-separated) and `timestamp` are required
  (`400 techniques and timestamp are required` otherwise); `windowMinutes`
  (default 30), `hostname`, `binaryName` and `bundleName` are optional.

### Posture

```
GET /api/analytics/sentinelone/posture/policies
GET /api/analytics/sentinelone/posture/agent-health?days=<n>
GET /api/analytics/sentinelone/posture/exclusion-gaps?from=<iso>&to=<iso>
```

These endpoints read the local snapshot in the `achilles-sentinelone-posture`
index; they never call the SentinelOne API. The posture pass writes that
snapshot after an alert sync, at most every 6 hours, using read-only `GET`s
(`/exclusions`, `/sites`, `/groups`, `/{accounts|sites|groups}/{id}/policy`,
`/agents`, `/agents/count`). Nothing in it is scored. When Elasticsearch is not
configured, or the pass has not run yet, they return empty results.

#### Policies

`GET /posture/policies` returns `{ "items": [ ... ] }`, one row per account,
site and group in scope (up to 10 accounts, 100 sites and 200 group policy
reads), sorted by level:

| Field | Description |
|-------|-------------|
| `level` | `account`, `site` or `group` |
| `scope_id`, `scope_name` | Id and name of the account / site / group |
| `site_id`, `site_name`, `account_id`, `group_id` | Parent ids where known |
| `inherits` | Groups only: `true` when the group uses its site's policy (not re-fetched) |
| `mitigation_mode`, `mitigation_mode_suspicious` | Policy action for threats / suspicious detections, e.g. `protect` or `detect` |
| `auto_mitigation_action` | The policy's own mitigation action |
| `anti_tampering_on`, `snapshots_on`, `agent_ui_on` | Policy toggles |
| `engines_on`, `engines_off` | Detection engines that are on / off |
| `policy_error` | Set (e.g. `HTTP 403`) when the token could not read this scope's policy |

#### Agent health

`GET /posture/agent-health?days=<n>` (default 30, clamped to 1–365):

```jsonc
{
  "latest": {
    "timestamp": "2026-10-25T06:00:00.000Z",
    "counts": { "total": 120, "active": 118, "infected": 0,
                "outdated": 4, "detect_only": 2, "disconnected": 1 },
    "counts_error": "HTTP 403"   // only when no count could be read
  },
  "trend": [ { "timestamp": "...", "counts": { /* same keys */ } } ]   // oldest first
}
```

Counts come from `GET /agents/count` with one filter each. A count that fails
falls back to the stored agent inventory, and is `null` when neither is
readable. `latest` is `null` until the first posture pass.

#### Exclusion gaps

`GET /posture/exclusion-gaps` takes the optional `from` / `to` window
(`routing.event_time`; absent = all time). It looks at missed tests (exit code
`101`, no `f0rtika.sentinelone_detected`, attack-simulation exclusions applied;
the latest 2,000 results), one per test and host, and flags those on a
SentinelOne-managed host whose on-disk test path is covered by a **path**
exclusion that applies to that host.

```jsonc
{
  "exclusionsTotal": 14,
  "byType": { "path": 9, "<other type>": 5 },   // keyed by the SentinelOne exclusion type
  "unmatchable": 5,          // non-path exclusions: results carry no file hash or signer
  "s1Agents": 120,           // stored agents, matched to results by hostname
  "missedOnS1Hosts": 6,
  "missedOnOtherHosts": 2,
  "flagged": [
    {
      "test_uuid": "<test-uuid>",
      "test_name": "…",
      "hostname": "WS-01",
      "os": "windows",
      "last_seen": "2026-10-24T10:00:00Z",
      "exclusions": [
        { "exclusion_id": "<id>", "value": "C:\\F0\\", "path_exclusion_type": "subfolders",
          "exclusion_mode": "…", "scope_name": "…" }
      ]
    }
  ]
}
```

Paths are matched against the agent work folders (`C:\F0\tasks\…` and `C:\F0\`
on Windows, `/opt/f0/tasks/…` and `/opt/f0/` elsewhere), honouring the
exclusion's OS, `file` / `folder` / `subfolders` type and `*` / `?` wildcards.

## Integration Endpoints

Base path: `/api/integrations/sentinelone`

### Configuration

```
GET    /api/integrations/sentinelone
POST   /api/integrations/sentinelone
DELETE /api/integrations/sentinelone
POST   /api/integrations/sentinelone/test
```

- **`GET /sentinelone`** (`integrations:read`) — masked settings. The API token
  is never returned, only `api_token_set`. Returns `configured`,
  `env_configured`, `base_url`, `label`, `permission_mode`,
  `poll_interval_minutes`, `backfill_days`, `sources`, `scope`, `filters`,
  `auto_resolve_mode` and `auto_mitigation`.
- **`POST /sentinelone`** (`integrations:write`) — save settings (partial
  update). `base_url` and `api_token` are required on the first save
  (`400` otherwise). The token is stored AES-256-GCM encrypted. A background
  sync starts after saving. Changing the console URL or scope clears the sync
  checkpoints. Saving with `permission_mode: "read_only"` switches automatic
  mitigation off and turns an `enabled` auto-resolve mode into `disabled`
  (`dry_run` is kept).
- **`DELETE /sentinelone`** (`integrations:write`) — remove the stored
  settings. Refused with `400` when the credentials come from environment
  variables. Data already in Elasticsearch is kept.
- **`POST /sentinelone/test`** (`integrations:write`) — authenticated read
  (`GET /threats?limit=1&countOnly=true`) in read-only mode. Uses the body's
  `base_url` / `api_token` / `scope` (`account_ids`, `site_ids`), falling back
  to the stored values. Always HTTP 200:
  `{ "success": true, "message": "Connected to SentinelOne (Read-only mode) — 42 threat(s) visible in scope" }`
  or `{ "success": false, "error": "..." }`.

**`POST /sentinelone` body** (every field optional on an edit):

```jsonc
{
  "base_url": "https://<tenant>.sentinelone.net",
  "api_token": "<api-token>",
  "label": "Production console",
  "permission_mode": "read_only",          // or "response"
  "poll_interval_minutes": 5,              // 1–1440
  "backfill_days": 365,                    // 1–365
  "sources": ["threats", "cloud_detection_alerts"],
  "scope": { "account_ids": ["<id>"], "site_ids": [], "group_ids": [] },
  "filters": {
    "severities": ["critical", "high"],
    "incident_statuses": ["unresolved", "in_progress"]
  }
}
```

| Field | Validation |
|-------|------------|
| `base_url` | An `https://` URL whose host is under `sentinelone.net` or `s1gov.net`, with no path, query, fragment, credentials or port other than 443; normalised to `https://<host>` and SSRF-checked (`400` otherwise) |
| `api_token` | 20–4096 characters |
| `label` | Up to 120 characters |
| `sources` | At least one of `threats`, `cloud_detection_alerts` |
| `scope.*_ids` | Up to 500 numeric id strings each |
| `filters.severities` | `critical`, `high`, `medium`, `low`, `informational`, `unknown` |
| `filters.incident_statuses` | `unresolved`, `in_progress`, `resolved` |

Schema failures return `400` with `error` and `details`. Auto-resolve and
automatic-mitigation settings are not part of this body; use their own routes
below.

### Sync

```
POST /api/integrations/sentinelone/sync
GET  /api/integrations/sentinelone/sync/status
```

- **`POST /sentinelone/sync`** (`integrations:write`) — start a manual sync.
  Body `{ "reset": true }` (optional) clears the checkpoints first, so the
  initial backfill runs again. Returns **`202`** at once and the sync runs in
  the background (a backfill can cover up to 365 days):

  ```json
  { "success": true, "data": { "started": true, "inProgress": true } }
  ```

  If a sync is already running, nothing new starts and `reset` is not applied:
  the response is `202` with `{ "started": false, "inProgress": true }`.
  Returns `400` when the integration is not configured. Poll
  `GET /sync/status` until `inProgress` is `false`.
- **`GET /sentinelone/sync/status`** (`integrations:read`) —

  | Field | Description |
  |-------|-------------|
  | `inProgress` | A sync is running |
  | `lastAttemptAt` | Start time of the last sync |
  | `lastThreatSync`, `lastAlertSync` | Incremental checkpoints per source |
  | `lastError` | `{ stage, message, at }` of the last failure, or `null` |
  | `lastSyncResult` | The last run: per-source `{ fetched, synced, filtered, errors }` under `threats` / `cloud_detection_alerts`, plus the `enrichment`, `autoMitigation`, `autoResolve` and (when it ran) `posture` pass results |

  The status is held in memory and resets when the backend restarts.

One sync runs these steps in order: poll each enabled source, the enrichment
(correlation) pass, automatic mitigation, auto-resolve, then the posture pass
when 6 hours have passed since the last one. The backend also starts a sync on
its own: a one-minute timer checks whether `poll_interval_minutes` has passed
since the last attempt.

### Auto-Resolve

```
GET /api/integrations/sentinelone/auto-resolve/status
PUT /api/integrations/sentinelone/auto-resolve/mode
GET /api/integrations/sentinelone/auto-resolve/receipts?limit=<n>&offset=<n>
```

- **`/auto-resolve/status`** (`integrations:read`) —
  `{ success, data: { mode, permission_mode, counts: { last24h, last7d, last30d }, lastAutoResolve } }`.
  `counts` are receipts (`f0rtika.auto_resolved: true`, any mode) by
  `auto_resolved_at`. `lastAutoResolve` is the last pass result
  (`mode`, `candidates`, `patched`, `wouldPatch`, `skipped`, `errors`,
  `durationMs`) or `null`.
- **`/auto-resolve/mode`** (`integrations:write`) — body
  `{ "mode": "disabled" | "dry_run" | "enabled" }`; returns
  `{ success, data: { mode } }`. `400` when the integration is not configured,
  or for `enabled` when the integration is not in Response mode.
- **`/auto-resolve/receipts`** (`integrations:read`) —
  `{ success, data: { items, total, limit, offset } }`, newest first.
  `limit` defaults to 20 (1–100), `offset` to 0. Each item has `alert_id`,
  `alert_title`, `severity`, `source_type`, `achilles_test_uuid`,
  `auto_resolved_at`, `auto_resolve_mode` and `auto_resolve_error`
  (`not_found`, `not_applied`, `invalid_id` or `null`).

### Automatic Mitigation

```
GET /api/integrations/sentinelone/auto-mitigation/status
PUT /api/integrations/sentinelone/auto-mitigation
GET /api/integrations/sentinelone/auto-mitigation/receipts?limit=<n>&offset=<n>
```

- **`/auto-mitigation/status`** (`integrations:read`) —
  `{ success, data: { mode, action, permission_mode, counts, lastAutoMitigation } }`.
  `mode` reads as `disabled` whenever the integration is not in Response mode.
  `lastAutoMitigation` is the last pass result (`mode`, `action`,
  `candidates`, `mitigated`, `wouldMitigate`, `skipped`, `errors`,
  `durationMs`) or `null`.
- **`PUT /auto-mitigation`** (`integrations:write`) — body
  `{ "mode"?: "disabled" | "dry_run" | "enabled", "action"?: "kill" | "quarantine" }`;
  at least one field is required. Returns `{ success, data: { mode, action } }`.
  Any mode other than `disabled` is refused with `400` unless the integration
  is in Response mode. No other action is accepted.
- **`/auto-mitigation/receipts`** (`integrations:read`) — same paging as the
  auto-resolve receipts. Each item has `alert_id`, `alert_title`, `severity`,
  `source_type`, `achilles_test_uuid`, `auto_mitigated_at`,
  `auto_mitigation_mode`, `auto_mitigation_action` and
  `auto_mitigation_error`.

### Mitigation audit trail

```
GET /api/integrations/sentinelone/actions/history?limit=<n>
```

`integrations:read`. The audit trail of automatic mitigation:
`{ success, data: [ ... ] }`, newest first, `limit` default 50 (1–200). Every
real mitigation attempt (success, refused by the permission boundary, or failed
at the API) is stored as a `doc_type: response_action` document in
`achilles-sentinelone`:

| Field | Description |
|-------|-------------|
| `timestamp` | When the attempt was made |
| `action_kind`, `action` | `threat_mitigation`, and `kill` or `quarantine` |
| `target_ids` | SentinelOne threat ids |
| `requested_by` | `achilles-auto-mitigation` |
| `permission_mode` | Mode at the time of the attempt |
| `outcome` | `success`, `rejected` or `failed` |
| `affected`, `error` | Count SentinelOne reported / error message |

When Elasticsearch is not configured, the last 200 records are kept in memory
instead.

:::note No manual response actions
There are no routes to kill, quarantine, remediate or isolate on demand. The
only writes to the console come from the opt-in auto-resolve and automatic
mitigation passes, which require Response mode. In read-only mode the API
client refuses every non-`GET` request before it is sent, and in Response mode
it only sends `POST /threats/mitigate/kill`, `POST /threats/mitigate/quarantine`,
`POST /threats/incident`, `POST /threats/notes` and
`POST /cloud-detection/alerts/incident`.
:::

See [SentinelOne Auto-Resolve and Automatic Mitigation](../user-guide/integrations/sentinelone-auto-resolve)
for the feature walkthrough.
