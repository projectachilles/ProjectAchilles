---
sidebar_position: 7
title: "Defender Endpoints"
description: "REST API endpoints for the Microsoft Defender integration — Secure Score, alerts, control profiles, cross-correlation, and auto-resolve."
---

# Defender Endpoints

All Defender endpoints require Clerk authentication. Analytics endpoints require
the `analytics:dashboards:read` permission; integration endpoints require
`integrations:read` or `integrations:write`.

All analytics endpoints return
`400 {"success": false, "error": "Defender integration is not configured"}`
until the integration is configured.

On Vercel (`backend-serverless/`) the Defender routes exist, with these
differences: no `POST /correlation/alerts-for-tests`, no `elasticsearch` field
in the save response, no
[Elasticsearch readiness](./overview.md#edr-elasticsearch-readiness) route, and
no `REQUIRE_ORG_ISOLATION` check on the settings writes.

## Analytics Endpoints

Base path: `/api/analytics/defender`

### Secure Score

```
GET /api/analytics/defender/secure-score
GET /api/analytics/defender/secure-score/trend
```

Current Microsoft Secure Score with category breakdown, and its history over
time (`/trend?days=<n>`, default 90).

### Alerts

```
GET /api/analytics/defender/alerts/summary
GET /api/analytics/defender/alerts
GET /api/analytics/defender/alerts/trend
```

- **`/alerts/summary`** — alert counts broken down by severity and status.
- **`/alerts`**: the alert list, paged (`page`, `pageSize`) and sortable
  (`sortField`, `sortOrder` `asc` or `desc`, default `desc`), filterable by
  `status`, free-text `search`, `techniques` (comma-separated), severity, source
  and time range.
- **`/alerts/trend`**: alert volume bucketed over time (`?days=<n>`, default
  30).

### Controls

```
GET /api/analytics/defender/controls
GET /api/analytics/defender/controls/by-category
GET /api/analytics/defender/controls/correlation
GET /api/analytics/defender/controls/correlations
```

- **`/controls`**: Defender control profiles with compliance status. Optional
  `category` and `deprecated` (`true` or `false`) filters.
- **`/controls/by-category`** — controls grouped by category.
- **`/controls/correlation`**: one control (`controlTitle`, required, `400`
  without it) linked to the alerts and techniques it covers (control ↔ alert
  linking). Optional `days`, default 30.
- **`/controls/correlations`** — the same for up to 20 controls in one query:
  repeat `title[]=` (or a single `title=`), plus optional `days` (1–365,
  default 30). Returns `[{ title, coveredTechniques, alertCount }]` in the
  order given. The Analytics top-controls card uses this one. No title, more
  than 20 titles, an empty title or one longer than 300 characters, or a `days`
  outside 1–365 returns `400`.

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
    "byProduct": { "Microsoft Defender for Endpoint": 30 }   // Defender only
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
GET /api/analytics/defender/correlation/technique-coverage?from=<iso>&to=<iso>
```

Evidence-based per-technique coverage. One response drives both the Detection
Rate tile and the Technique Coverage card, so they cannot disagree.

**Execution set.** Results documents with `routing.event_time` in the window,
excluding the attack-simulation exclusions (cyber-hygiene controls and skipped
bundle stages) and any result whose exit code is not in
`0, 1, 101, 105, 126, 127, 259, 999`. These are the same eligibility clauses
the enrichment pass uses. A run Defender stopped by killing the agent is one
whole-test result: it counts in `overall` but never in a `byTechnique` row,
because no stage exercised a technique.

**Host scope.** Only the hosts Defender covers are counted: the hosts that
raised a Defender alert in the last 90 days. A host where Defender is installed
but has never alerted is left out. With no such host, every tested host counts.
`scope` says which applied (see
[CrowdStrike Technique Coverage](./crowdstrike#technique-coverage)).

**Evidence rule.** The enrichment pass only ever writes these flags as `true`;
a missing flag means no match. Per execution, detected is any of:

- `f0rtika.defender_stage_detected: true` — the alert evidence named this
  stage's own binary;
- `f0rtika.defender_detected: true` on a result that is **not** a bundle control
  (`f0rtika.is_bundle_control` is not `true`). On a bundle stage this flag only
  means the bundle was matched, so a stage counts only by its own stage flag and
  is never credited because a sibling stage was caught;
- the result's own prevention (below): a prevention counts as detected.

Prevented is judged by the result's own evidence, any of:

- `f0rtika.defender_stage_prevented: true`: an alert naming this stage carried the
  action. On results enriched before that flag existed:
  `f0rtika.defender_stage_detected: true` plus a `f0rtika.defender_prevention_action` of
  `quarantined`, `process_killed` or `blocked`;
- `f0rtika.defender_prevented: true` on a result that is **not** a bundle control.
  On a bundle stage this flag is run-wide (a sibling stage's prevention sets it
  on every stage), so it is not used there;
- `f0rtika.edr_terminated_vendors` contains `defender`: Defender killed the agent
  mid-run.

Detected-only is detected and not prevented; missed is the rest.

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
  ],
  "scope": { "source": "alerts", "hosts": 4 } // alerts | fleet; hosts with a counted result
}
```

`overall` counts distinct executions, while one execution that exercises
several techniques appears in each of their rows, so the rows can sum past the
totals. `byTechnique` lists detected techniques first, then by executions
descending. `alerts` is the number of distinct Defender alerts in the window tagged
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
GET /api/analytics/defender/correlation/scores
GET /api/analytics/defender/correlation/techniques
GET /api/analytics/defender/correlation/detection-rate
GET /api/analytics/defender/correlation/technique-coverage
GET /api/analytics/defender/correlation/alerts-for-test
POST /api/analytics/defender/correlation/alerts-for-tests
```

- **`/correlation/scores`**: Defense Score vs. Secure Score over time
  (`?days=<n>`, default 90).
- **`/correlation/techniques`** — MITRE technique overlap between test results
  and Defender alerts.
- **`/correlation/detection-rate`** — the legacy technique plus time-window
  **per-execution detection rate** (see below), kept for the CLI.
- **`/correlation/technique-coverage`** — evidence-based coverage that drives
  the Analytics tab (see [Technique Coverage](#technique-coverage)).
- **`/correlation/alerts-for-test`** — per-test evidence correlation; returns
  the Defender alerts matched to a specific test execution (powers the alert
  drawer drill-down). `techniques` (comma-separated) and `timestamp` are
  required (`400 techniques and timestamp are required` otherwise);
  `windowMinutes` (default 30), `hostname`, `binaryName` and `bundleName` are
  optional.
- **`POST /correlation/alerts-for-tests`** — the same lookup for many
  executions at once; the Executions view uses it for all stages of a row.
  Body `{ "items": [{ "techniques": ["T1059"], "timestamp": "…", "windowMinutes": 30,
  "hostname": "…", "binaryName": "<uuid>.exe", "bundleName": "…" }] }`, at most
  100 items. Returns `{ "results": [ … ], "errors": [ … ] }` in input order. An
  item that fails validation (same rules as the GET parameters) gets `null` in
  `results` and its reason in `errors`; the other items are still answered.
  `null` with no error means that item's search failed. A missing or empty
  `items`, or more than 100, is a `400`.
  It runs one Elasticsearch `msearch` per fallback tier (evidence, then technique
  plus host) rather than up to three searches per item, and needs the same read
  permission as the GET. Clients should fall back to the GET per item on `404`
  (older backends, the serverless backend).

  An item may carry `runStartedAt` (ISO time, the result's `run_started_at`;
  `400 Invalid runStartedAt` when it is not a date). With it, an alert counts
  only through evidence of that run: a process item that started from 60 s
  before the start to 60 s after `timestamp`, or a file item (or a process item
  with no start time) that Defender added from 60 s before the start to 30
  minutes after `timestamp`. An alert that names the test (a test binary, or a
  path holding the test's uuid or its bundle-name token) only in an earlier
  run's evidence is left out. With it the alert lookup also finds an alert
  whose recorded activity (first to last) overlaps the run, from 5 minutes
  before the start to 30 minutes after `timestamp`, not only one created or
  updated near `timestamp`; an alert found only that way is listed only through
  evidence of that run. Without it the older name-based rule applies. Each
  alert in the response carries `attributed_control_ids` (every stage it has
  evidence for, in this run when a run is given; `attributed_control_id` is the
  first of them) and `stage_actions` (stage to the strongest action on that
  stage's own evidence). `total` is the number of alerts returned. The GET form
  takes no `runStartedAt`. The serverless backend returns only
  `attributed_control_ids`, by name.

#### Detection Rate

```
GET /api/analytics/defender/correlation/detection-rate?days=<n>&windowMinutes=<n>
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

See [Analytics → Microsoft Defender](../user-guide/analytics/microsoft-defender#detection-rate)
for the full metric definition.

## Integration Endpoints

Base path: `/api/integrations/defender`

The Defender configuration is deployment-wide: these routes ignore the caller's
Clerk organization. With `REQUIRE_ORG_ISOLATION=true`, `POST /defender`,
`DELETE /defender` and `PUT /defender/auto-resolve/mode` return `403`; set the
`DEFENDER_*` environment variables instead. Reads, `/test`, `/parse-pfx` and
`/sync` stay available.

### Configuration

```
GET    /api/integrations/defender
POST   /api/integrations/defender
DELETE /api/integrations/defender
POST   /api/integrations/defender/test
POST   /api/integrations/defender/parse-pfx
```

- **`GET /defender`** (`integrations:read`): masked settings (no secrets):
  `configured`, `tenant_id` and `client_id` masked as `****` plus the last four
  characters, `auth_method`, `client_secret_set`, `cert_thumbprint_set`, `label`
  and `env_configured`. `{ "configured": false }` when nothing is saved.
- **`POST /defender`** (`integrations:write`): save credentials (partial
  update). Stored AES-256-GCM encrypted. On the first save `tenant_id` and
  `client_id` are required, plus `client_secret`, or `cert_thumbprint` and
  `private_key_pem` for certificate auth (`400` otherwise). A background sync
  starts after saving. The response includes `elasticsearch`: the [Elasticsearch readiness](./overview.md#edr-elasticsearch-readiness) of the key, checked (and the index created) before responding.
- **`DELETE /defender`** (`integrations:write`): remove the stored
  credentials. Refused with `400` when they come from the `DEFENDER_*`
  environment variables.
- **`POST /defender/test`** (`integrations:write`): acquire a token from
  Microsoft with the body's values, falling back to the stored ones. Always
  HTTP 200: `{ "success": true, "message": "..." }` or
  `{ "success": false, "error": "..." }`.
- **`POST /defender/parse-pfx`** (`integrations:write`): `multipart/form-data`
  with a `pfx` file (up to 4 MB) and an optional `passphrase`. Returns
  `{ success, data: { thumbprint, private_key_pem, subject_cn, not_after } }`
  to pass to `/test` and `POST /defender`. Nothing is saved.

**`POST /defender` body:**
```json
{
  "tenant_id": "...",
  "client_id": "...",
  "client_secret": "...",
  "label": "Production tenant"
}
```

For certificate auth, send `"auth_method": "certificate"` with
`cert_thumbprint` and `private_key_pem` instead of `client_secret`.
`auth_method` defaults to `client_secret`.

### Sync

```
POST /api/integrations/defender/sync
GET  /api/integrations/defender/sync/status
```

- **`POST /defender/sync`** (`integrations:write`): run a full sync from
  Microsoft Graph and return its result when it finishes
  (`{ success, data }`). `400` when Defender is not configured.
- **`GET /defender/sync/status`** (`integrations:read`): `lastScoreSync`,
  `lastControlSync`, `lastAlertSync`, `lastSyncResult`, `lastAttemptAt` and
  `lastError`.

### Auto-Resolve

```
GET /api/integrations/defender/auto-resolve/status
PUT /api/integrations/defender/auto-resolve/mode
GET /api/integrations/defender/auto-resolve/receipts?limit=<n>&offset=<n>
```

- **`/auto-resolve/status`** (`integrations:read`):
  `{ success, data: { mode, counts: { last24h, last7d, last30d }, lastAutoResolve } }`.
  `lastAutoResolve` is the last pass result or `null`.
- **`/auto-resolve/mode`** (`integrations:write`): set the mode; body
  `{ "mode": "disabled" | "dry_run" | "enabled" }`. `400` when Defender is not
  configured.
- **`/auto-resolve/receipts`** (`integrations:read`):
  `{ success, data: { items, total, limit, offset } }`, newest first. `limit`
  defaults to 20 (1–100), `offset` to 0. Each item has `alert_id`,
  `alert_title`, `severity`, `achilles_test_uuid`, `auto_resolved_at`,
  `auto_resolve_mode` and `auto_resolve_error`.

See [Defender Auto-Resolve](../user-guide/integrations/defender-auto-resolve)
for the feature walkthrough.
