---
sidebar_position: 8
title: "CrowdStrike Endpoints"
description: "REST API endpoints for the CrowdStrike Falcon integration — ZTA posture score, alerts, cross-correlation, and auto-resolve."
---

# CrowdStrike Endpoints

All CrowdStrike endpoints require Clerk authentication. Analytics endpoints
require the `analytics:dashboards:read` permission; integration endpoints
require `integrations:read` or `integrations:write`.

All analytics endpoints are guarded by `requireCrowdStrikeConfigured()` and
return `400` when the integration is not configured.

## Analytics Endpoints

Base path: `/api/analytics/crowdstrike`

### ZTA Posture Score

```
GET /api/analytics/crowdstrike/zta-score
GET /api/analytics/crowdstrike/zta-score/trend
```

Current Zero Trust Assessment posture score (average `assessment.overall`,
0–100, with OS / sensor-config sub-scores and device spread), and its daily
snapshot history over time.

ZTA requires **Falcon Insight** licensing and the
`Zero Trust Assessment: read` scope. When unlicensed, the score endpoints
return the not-licensed state rather than an error — the rest of the
integration is unaffected.

| Query param (`/trend`) | Default | Description |
|------------------------|---------|-------------|
| `days` | 90 | Number of daily snapshots to return |

Each trend point carries `date`, `overallScore`, `osScore`, `sensorConfigScore`
and `deviceCount`. `score` is kept as an alias of `overallScore` for the CLI.

### Alerts

```
GET /api/analytics/crowdstrike/alerts/summary
GET /api/analytics/crowdstrike/alerts
GET /api/analytics/crowdstrike/alerts/trend
```

- **`/alerts/summary`** — alert counts broken down by severity
  (`informational` / `low` / `medium` / `high` / `critical`) and status
  (`new` / `in_progress` / `reopened` / `closed`).
- **`/alerts`** — the alert list, paged and filterable by severity, status,
  free-text search, and MITRE techniques.
- **`/alerts/trend`** — alert volume bucketed over time (`?days=<n>`).

### Window parameters

The alert, trend and coverage endpoints accept an optional ISO-8601 window,
which the Analytics tab fills from the header date picker.

| Query param | Description |
|-------------|-------------|
| `from` | Window start (ISO-8601). Must be sent together with `to`. |
| `to` | Window end (ISO-8601). |

Each bound must be strict ISO-8601: a date (`2026-10-20`, read as UTC
midnight) or a date-time with seconds, an optional fraction and an explicit
zone (`2026-10-20T10:00:00Z`, `2026-10-20T10:00:00.000+02:00`). Both bounds are
normalised to UTC (`toISOString()`) before querying. Free-form dates
(`Oct 20 2026`, `2026/10/20`), bare numbers or epoch millis, and date-times
without seconds or a zone are rejected.

When both are absent, the endpoints behave exactly as before (the CLI and the
drawers rely on this), except `technique-coverage`, which then defaults to the
last 30 days. A value that is not strict ISO-8601, only one of the pair, or
`from >= to` returns `400 {"success": false, "error": "Invalid from/to"}`.

#### Alert feed filters

`GET /alerts` also accepts:

| Query param | Description |
|-------------|-------------|
| `source` | `all` (default), `test` (alerts linked to an Achilles test, `f0rtika.achilles_correlated: true`) or `organic` (everything else, including alerts with no correlation field). Anything else returns `400 Invalid source`. |
| `severity` | One severity or a comma-separated list, e.g. `high,critical`. |

The response carries a `counts` object (also returned by `/alerts/summary`)
that backs the feed's filter segments and summary strip:

```jsonc
{
  "data": [ /* alerts */ ],
  "total": 42, "page": 1, "pageSize": 25,
  "counts": {
    "bySource":   { "all": 120, "test": 31, "organic": 89 },   // ignores source and severity
    "bySeverity": { "high": 12, "medium": 40 },                 // honours source, ignores severity
    "autoResolved": 7,   // alerts Achilles really resolved (mode enabled, no error); honours source
    "linkedOpen": 4,
    "byPrevention": { "prevented": 8, "detected_only": 20, "kill_failed": 1 }   // CrowdStrike only
  }
}
```

Every count sees the window, `search`, techniques and status filters. Source
and severity filter only the listed alerts, and the counts treat them like this:

- `bySource` ignores both source and severity, so `bySource.all` equals the
  alerts tile for the same window and the source segments stay stable while you
  click through them.
- The summary strip (`bySeverity`, `autoResolved` and the vendor facet) honours
  source and ignores severity, so the whole strip describes one population.
- Severity applies only to the rows and to `total` (pagination).

`linkedOpen` is linked alerts that are not closed/resolved, over the window
only.

Each linked alert carries `achilles_test_uuid` and, when it can be resolved,
`achilles_test_name` plus `achilles_test_kind`: `bundle` when the uuid is a
bundle (the name is its `bundle_name`), otherwise `test`. The feed links
bundles to the Executions view with the `bundleNames` filter and standalone
tests with the `tests` filter.

#### Trend

`GET /alerts/trend` with `from`/`to` ignores `days` and buckets by **day** when
the window is 90 days or shorter, otherwise by **week**. Every point carries:

| Field | Description |
|-------|-------------|
| `count` | Total alerts in the bucket |
| `linked` | Alerts linked to an Achilles test; `count - linked` is the organic remainder |
| `interval` | `day` or `week`, the bucket width of the series |

### Technique Coverage

```
GET /api/analytics/crowdstrike/correlation/technique-coverage?from=<iso>&to=<iso>
```

Evidence-based per-technique coverage. One response drives both the Detection
Rate tile and the Technique Coverage card, so they cannot disagree.

**Execution set.** Results documents with `routing.event_time` in the window,
excluding the attack-simulation exclusions (cyber-hygiene controls and skipped
bundle stages) and any result whose exit code is not in
`0, 1, 101, 105, 126, 127, 259, 999`. These are the same eligibility clauses
the enrichment pass uses.

**Evidence rule.** The enrichment pass only ever writes these flags as `true`;
a missing flag means no match. Per execution, detected is any of:

- `f0rtika.crowdstrike_stage_detected: true` — the alert evidence named this
  stage's own binary;
- `f0rtika.crowdstrike_detected: true` on a result that is **not** a bundle control
  (`f0rtika.is_bundle_control` is not `true`). On a bundle stage this flag only
  means the bundle was matched, so a stage counts only by its own stage flag and
  is never credited because a sibling stage was caught;
- `f0rtika.crowdstrike_prevented: true` — a vendor-confirmed prevention counts as
  detected.

Prevented is `f0rtika.crowdstrike_prevented: true`; detected-only is detected and
not prevented; missed is the rest.

```jsonc
{
  "overall": {
    "executions": 87,          // distinct executions, not technique observations
    "prevented": 20,
    "detectedOnly": 12,
    "missed": 55,
    "detectionRate": 36.8,     // (prevented + detectedOnly) / executions, 1 dp
    "preventionRate": 23.0,    // prevented / executions, 1 dp
    "testedTechniques": 13,
    "detectedTechniques": 5
  },
  "byTechnique": [
    { "technique": "T1574.002", "name": "DLL Side-Loading", "executions": 5,
      "prevented": 3, "detectedOnly": 1, "missed": 1, "alerts": 6 }
  ]
}
```

`overall` counts distinct executions, while one execution that exercises
several techniques appears in each of their rows, so the rows can sum past the
totals. `byTechnique` lists detected techniques first, then by executions
descending. `alerts` is the number of distinct CrowdStrike alerts in the window tagged
with that technique id or any of its sub-techniques (`T1574` counts `T1574.002`
alerts), the same rule as the alert drawer, so a row's count matches what its
drawer lists. Parent-technique alerts are not counted on a sub-technique row.

:::note[Not the same as /correlation/detection-rate]
[`/correlation/detection-rate`](#detection-rate) (below) is the older technique plus time-window
heuristic and is kept for the CLI. The Analytics tab now uses
`technique-coverage`, so its numbers can differ from the heuristic.
:::

### Cross-Correlation

```
GET /api/analytics/crowdstrike/correlation/scores
GET /api/analytics/crowdstrike/correlation/techniques
GET /api/analytics/crowdstrike/correlation/detection-rate
GET /api/analytics/crowdstrike/correlation/technique-coverage
GET /api/analytics/crowdstrike/correlation/alerts-for-test
```

- **`/correlation/scores`** — Defense Score vs. ZTA posture score over time
  (`?days=<n>`).
- **`/correlation/techniques`** — MITRE technique overlap between test results
  and CrowdStrike alerts.
- **`/correlation/detection-rate`** — the legacy technique plus time-window
  **per-execution detection rate** (see below), kept for the CLI.
- **`/correlation/technique-coverage`** — evidence-based coverage that drives
  the Analytics tab (see [Technique Coverage](#technique-coverage)).
- **`/correlation/alerts-for-test`** — per-test evidence correlation; returns
  the CrowdStrike alerts matched to a specific test execution, with stage and
  bundle attribution (powers the alert drawer drill-down).

#### Detection Rate

```
GET /api/analytics/crowdstrike/correlation/detection-rate?days=<n>&windowMinutes=<n>
```

| Query param | Default | Description |
|-------------|---------|-------------|
| `days` | 30 | Look-back window for executions and alerts |
| `windowMinutes` | 60 | Correlation window — an execution is correlated if an alert for its technique falls within ±`windowMinutes` |

**Response:**

```jsonc
{
  "overall": {
    "detectionRate": 23.1,        // per-execution %, the headline metric
    "totalExecutions": 87,
    "correlatedExecutions": 20,
    "testedTechniques": 13,       // drill-down context
    "detectedTechniques": 3
  },
  "byTechnique": [
    { "technique": "T1574.002", "testExecutions": 5, "correlatedExecutions": 5, "detected": true }
  ]
}
```

See [Analytics → CrowdStrike Falcon](../user-guide/analytics/crowdstrike#detection-rate)
for the full metric definition.

## Integration Endpoints

Base path: `/api/integrations/crowdstrike`

### Configuration

```
GET    /api/integrations/crowdstrike
POST   /api/integrations/crowdstrike
DELETE /api/integrations/crowdstrike
POST   /api/integrations/crowdstrike/test
```

- **`GET /crowdstrike`** — returns whether CrowdStrike is configured, with
  secrets masked (`integrations:read`). The response includes the selected
  `region` plus a server-derived, display-only `base_url` resolved from that
  region.
- **`POST /crowdstrike`** — save credentials. Stored AES-256-GCM encrypted. The response includes `elasticsearch`: the [Elasticsearch readiness](./overview.md#edr-elasticsearch-readiness) of the key, checked (and the index created) before responding.
  Kicks off a background sync after saving (`integrations:write`).
- **`DELETE /crowdstrike`** — remove the stored configuration
  (`integrations:write`).
- **`POST /crowdstrike/test`** — validate credentials against the Falcon API
  (real token acquisition plus a `limit:1` alerts query).

**`POST /crowdstrike` body:**
```json
{
  "region": "us-1",
  "clientId": "...",
  "clientSecret": "...",
  "label": "Production Falcon"
}
```

`region` must be one of `us-1` (default), `us-2`, `eu-1`, or `us-gov-1` —
custom base URLs are not accepted; the API base URL is derived server-side
from the region. See
[Integrations → CrowdStrike Falcon](../user-guide/integrations/crowdstrike#cloud-regions).

### Sync

```
POST /api/integrations/crowdstrike/sync
GET  /api/integrations/crowdstrike/sync/status
```

- **`POST /crowdstrike/sync`** — trigger an immediate sync from the Falcon API
  (alerts + ZTA, followed by enrichment and an auto-resolve pass).
- **`GET /crowdstrike/sync/status`** — last sync timestamps for alerts and
  ZTA, plus `zta_status` (`ok` / `not_licensed`).

### Auto-Resolve

```
GET /api/integrations/crowdstrike/auto-resolve/status
PUT /api/integrations/crowdstrike/auto-resolve/mode
GET /api/integrations/crowdstrike/auto-resolve/receipts?limit=<n>&offset=<n>
```

- **`/auto-resolve/status`** — current mode plus recent receipt counts.
- **`/auto-resolve/mode`** — set the mode; body
  `{ "mode": "disabled" | "dry_run" | "enabled" }`.
- **`/auto-resolve/receipts`** — paginated receipt history.

See [CrowdStrike Auto-Resolve](../user-guide/integrations/crowdstrike-auto-resolve)
for the feature walkthrough.
