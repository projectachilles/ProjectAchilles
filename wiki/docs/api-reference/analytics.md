---
sidebar_position: 4
title: "Analytics Endpoints"
description: "REST API endpoints for ProjectAchilles analytics — defense scores, heatmaps, trends, and executions."
---

# Analytics Endpoints

Endpoints under `/api/analytics/*` query the Elasticsearch-backed view of test results. All require `analytics:dashboards:read` permission (or higher); the configuration endpoints require `analytics:settings:read` / `analytics:settings:write`.

:::tip Use the Programmatic Access guide for examples
This page is the **parameter reference**. For curl examples, common recipes (CI gates, SIEM forwarders, drift detection), and a walkthrough of the three score variants, read the [Programmatic Access guide](./programmatic-access.md).
:::

## Shared filter parameters

Most endpoints accept the same filter vocabulary. Pass any combination:

| Param | Type | Description |
|-------|------|-------------|
| `from` | string | Start of window. Accepts ISO-8601 (`2026-04-23T00:00:00Z`), calendar dates (`2026-04-23`), or Elasticsearch date math (`now-30d`). |
| `to` | string | End of window. Same formats as `from`. |
| `org` | string | Filter by organization UUID (Clerk org id). |
| `tests` | string | Comma-separated test UUIDs. |
| `techniques` | string | Comma-separated MITRE ATT&CK technique IDs (e.g. `T1486,T1059`). |
| `hostnames` | string | Comma-separated hostnames. |
| `categories` | string | Comma-separated test categories. |
| `severities` | string | Comma-separated severities: `low`, `medium`, `high`, `critical`. |
| `threatActors` | string | Comma-separated threat-actor names. |
| `tags` | string | Comma-separated tags. |
| `errorNames` | string | Comma-separated error names (resolved from exit codes). |
| `errorCodes` | string | Comma-separated exit codes. |
| `bundleNames` | string | Comma-separated bundle test names. |
| `result` | string | One of: `all`, `protected`, `unprotected`, `inconclusive`. |
| `scoringMode` | string | `all-stages` (default — bundle protected only if every stage protected) or `any-stage` (bundle protected if any stage protected). |

:::warning Default time window is 7 days
If you don't pass `from`/`to`, every endpoint applies a **`now-7d`** date filter. The dashboard UI defaults to **Last 30 days** — so the same query that fills the UI may return zero rows when called from the API without explicit dates. Always pass `from` (and optionally `to`) when scripting against the API.
:::

## Endpoints

### Defense Score

```
GET /api/analytics/defense-score
```

Returns the aggregate defense score and breakdown counts for the filtered window.

**Response shape:**

```jsonc
{
  "score": 54.59,            // EDR-protected OR Defender-detected, risk-accepted excluded
  "realScore": 53.21,        // EDR-protected only, risk-accepted excluded
  "rawScore": 53.83,         // EDR-protected OR Defender-detected, WITHOUT risk-acceptance exclusion
  "protectedCount": 1391,    // strictly EDR-protected
  "detectedCount": 36,       // Defender caught (EDR missed)
  "unprotectedCount": 1187,  // neither
  "totalExecutions": 2614,   // = protected + detected + unprotected
  "riskAcceptedCount": 37    // excluded from totalExecutions
}
```

See the [guide](./programmatic-access.md#6-defense-score--what-the-fields-mean) for when to use each score variant.

### Defense Score Trend

```
GET /api/analytics/defense-score/trend
```

Returns the score over time for trend visualization.

**Additional parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `interval` | string | Histogram bucket size (e.g. `day`, `hour`). |
| `windowDays` | number | Rolling window size, 1–90 days, applied per bucket. |

### Defense Score by Test / Technique / Org / Severity / Category / Hostname

```
GET /api/analytics/defense-score/by-test
GET /api/analytics/defense-score/by-technique
GET /api/analytics/defense-score/by-org
GET /api/analytics/defense-score/by-severity
GET /api/analytics/defense-score/by-category
GET /api/analytics/defense-score/by-category-subcategory
GET /api/analytics/defense-score/by-hostname
```

All accept the shared filter parameters and return protected/unprotected counts grouped by the named dimension.

### Recent Executions

```
GET /api/analytics/executions
```

Flat list of recent test executions, enriched with catalog metadata. Returns at most `limit` rows.

**Additional parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | Max rows returned (default 50). |

**Response:** array of `EnrichedTestExecution` (8 fields per row: `test_uuid`, `test_name`, `hostname`, `is_protected`, `org`, `timestamp`, `error_code`, `error_name`).

### Paginated Executions

```
GET /api/analytics/executions/paginated
```

Filtered, grouped, paginated execution results. Accepts every shared filter plus pagination controls.

**Additional parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (1-indexed, default 1). |
| `pageSize` | number | Results per page (default 25). |
| `sortField` | string | Field to sort by. |
| `sortOrder` | string | `asc` or `desc`. |
| `grouped` | boolean | If true, groups results by bundle/standalone identity. |

**Response shape** depends on the `grouped` parameter:

#### Default — flat (`grouped=false` or omitted)

```jsonc
{
  "data": [
    { /* one EnrichedTestExecution per ES document — ~20 fields incl. test_uuid, test_name,
         hostname, is_protected, timestamp, error_code, error_name, category, severity,
         techniques, tactics, score, bundle_id, control_id, is_bundle_control,
         defender_detected, … */ }
  ],
  "pagination": { "page": 1, "pageSize": 25, "totalItems": 480, "totalPages": 20, "hasNext": true, "hasPrevious": false }
}
```

One row per actual execution. Bundle tests appear as multiple rows (one per control, with `is_bundle_control: true` and a `control_id`). Best for SIEM forwarding, CSV exports, or any per-execution analysis.

#### `?grouped=true` — bundle-aware grouping

```jsonc
{
  "groups": [
    {
      "groupKey": "standalone::<test_uuid>::<hostname>::<event_time_ms>",
      "type": "standalone" | "bundle",
      "representative": { /* one EnrichedTestExecution */ },
      "members": [ /* all matching docs in this group */ ],
      "protectedCount": 3,
      "unprotectedCount": 1,
      "totalCount": 4,
      "defenderDetected": true
    }
  ],
  "pagination": { "page": 1, "pageSize": 25, "totalGroups": 142, "totalDocuments": 480, "totalPages": 6, "hasNext": true, "hasPrevious": false }
}
```

One row per "run" — bundle tests collapse from N controls into a single entry. Best for dashboards and rollups where you want to count "one bundle run" rather than N control checks.

### Coverage Aggregates

```
GET /api/analytics/host-test-matrix       — heatmap data (host × test)
GET /api/analytics/technique-distribution — protected/unprotected per MITRE technique
GET /api/analytics/test-coverage          — protected/unprotected per test
GET /api/analytics/threat-actor-coverage  — coverage broken down by threat actor
GET /api/analytics/error-rate             — error count and rate over the window
GET /api/analytics/error-rate/trend       — error rate over time
GET /api/analytics/results-by-error-type  — breakdown by error code/name
```

All accept the shared filter parameters.

### Counts and Catalogs

```
GET /api/analytics/unique-hostnames       — distinct host count
GET /api/analytics/unique-tests           — distinct test count
GET /api/analytics/canonical-test-count   — count of canonical (deduped) tests
GET /api/analytics/organizations          — known organizations
GET /api/analytics/available-tests        — all tests with any execution
GET /api/analytics/executed-test-uuids    — every test UUID that has been executed
GET /api/analytics/available-techniques   — MITRE techniques with any data
GET /api/analytics/available-hostnames    — hostnames seen in results
GET /api/analytics/available-categories
GET /api/analytics/available-severities
GET /api/analytics/available-threat-actors
GET /api/analytics/available-tags
GET /api/analytics/available-error-names
GET /api/analytics/available-error-codes
GET /api/analytics/available-bundle-names
```

These power the filter dropdowns in the UI. They accept the shared filter parameters but most ignore date filters by default so the dropdowns stay populated.

### Archive Operations

```
POST /api/analytics/executions/archive          — archive by group keys
POST /api/analytics/executions/archive-by-date  — archive everything before a date
```

Require `analytics:executions:archive` permission. See the [Programmatic Access guide](./programmatic-access.md) for the response envelope and idempotency notes.

### Index Management

```
GET  /api/analytics/indices       — list configured indices
POST /api/analytics/index/create  — create a new index (requires analytics:index:create)
```

### Configure Elasticsearch

```
GET  /api/analytics/settings      — fetch current settings (masked)
POST /api/analytics/settings      — save settings (requires analytics:settings:write)
POST /api/analytics/settings/test — test a candidate configuration
```

Stored encrypted at rest (AES-256-GCM) in `~/.projectachilles/analytics.json` on filesystem deployments, or in Vercel Blob on serverless.

## See also

- [Programmatic Access guide](./programmatic-access.md) — curl examples, alerting recipes, SIEM-forwarder pattern, time-window gotcha
- [Overview & Authentication](./overview.md) — auth model
- [Bundle Results](./bundle-results.md) — schema for multi-control bundle test responses
