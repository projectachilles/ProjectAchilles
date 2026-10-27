---
sidebar_position: 4
title: "Analytics Endpoints"
description: "REST API endpoints for ProjectAchilles analytics — defense scores, heatmaps, trends, and executions."
---

# Analytics Endpoints

Endpoints under `/api/analytics/*` query the Elasticsearch-backed view of test results. All require `analytics:dashboards:read` permission (or higher); the configuration endpoints require `analytics:settings:read` / `analytics:settings:write`.

:::tip[Use the Programmatic Access guide for examples]
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
| `basis` | string | `executions` (default) or `latest`. Selects how the Defense Score endpoints count; see [Score basis](#score-basis). Anything else returns `400 Invalid basis`. |
| `scoringMode` | string | `all-stages` (default — bundle protected only if every stage protected) or `any-stage` (bundle protected if any stage protected). |

:::warning[Default time window is 7 days]
If you don't pass `from`/`to`, every endpoint applies a **`now-7d`** date filter. The dashboard UI defaults to **Last 30 days** — so the same query that fills the UI may return zero rows when called from the API without explicit dates. Always pass `from` (and optionally `to`) when scripting against the API.
:::

## Score basis

`basis` chooses what the Defense Score counts.

- **`executions`** (default) -- every execution in the window counts once.
- **`latest`** -- the share of **test × endpoint pairs** whose most recent conclusive result in the window was blocked or detected. A pair is keyed by organization + test UUID + hostname. In `any-stage` scoring mode, a non-cyber-hygiene bundle on a host is one pair, protected if any stage of its latest run is.

Under `latest`:

- The date range sets the freshness window. It is capped at 365 days (All time becomes "last 365d").
- Outcome filters (`result`, `errorCodes`, `errorNames`) select the pairs whose latest result matches. `result=protected|unprotected` follows the pair's verdict, the same rule the score counts: a Defender- or CrowdStrike-detected `101` is protected, and an `any-stage` bundle pair matches exactly one of the two. `errorCodes` and `errorNames` match any code or name in the latest result, so a bundle pair whose latest run mixes `101` and `126` matches both `errorCodes=101` and `errorCodes=126`.
- The server keeps each fetched pair set for up to 30 seconds and reuses it across requests with the same filters (outcome filters aside), so a relative range such as `now-7d` can be up to 30 seconds stale.
- Under `latest`, `from`/`to` accept `now`, `now-<n><unit>` (units `d`, `h`, `w`, `m` or `M`, where `m`/`M` = 30 days) and ISO dates. ES date math such as `now/d` is rejected, as is an unparseable or reversed range, with `400 Invalid date range`.
- `result=inconclusive` yields no pairs under `latest`, because only conclusive results are scored.
- These endpoints accept `basis=latest`: `/defense-score`, `/defense-score/trend`, `/defense-score/by-category-subcategory`, `/defense-score/by-hostname`, `/technique-distribution`, `/test-coverage`. Their counts become pairs. For `test-coverage`, pairs are grouped by test name; each pair is one host × test, so each count is a number of hosts. `technique-distribution` always scores **per stage**, even with `scoringMode=any-stage`. Each bundle control is its own pair, judged by its own latest result, so a technique shows unprotected when its own stage got through, even if another stage of the same bundle was stopped.
- These endpoints are executions-only and ignore `basis=latest`: `by-test`, `by-technique`, `by-severity`, `by-category`, `by-org`, `threat-actor-coverage`.

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

**With `basis=latest`** the response adds two fields and changes the meaning of the counts:

```jsonc
{
  "basis": "latest",
  "pairCount": 212,          // test × endpoint pairs in the window
  "totalExecutions": 212,    // equals pairCount
  "score": 71.23,            // null when there are no pairs
  "realScore": 68.40,        // strict score: blocked only
  "rawScore": 70.75          // score before risk acceptances
  // protectedCount, detectedCount, unprotectedCount, riskAcceptedCount count pairs
}
```

### Defense Score Trend

```
GET /api/analytics/defense-score/trend
```

Returns the score over time for trend visualization.

**Additional parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `interval` | string | Histogram bucket size (e.g. `day`, `hour`). |
| `windowDays` | number | Rolling window size, 1–90 days, applied per bucket. An explicit value is honoured and clamped to [1, 90]. Ignored under `basis=latest`. |

Trend lines extend to now. A rolling window with no data returns `score: null` rather than `0`, so charts show a gap.

With `basis=latest` each point is the same latest-result calculation as of that UTC day (weekly points for ranges over 90 days). The last point always equals the `/defense-score` tile for the same range, and points can have `score: null` when the window holds no pairs.

`realScore` / `realTotal` / `realProtected` on trend points keep their existing meaning on both bases: the raw, pre-risk-acceptance series, present only when risk-acceptance exclusions exist. This differs from `realScore` on `/defense-score` under `latest`, which is the strict, blocked-only score.

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

Bundle-control rows may also carry an optional `control_description` (plain-language "what this stage does", from the control's `description` in `bundle_results.json`). It is omitted when empty, so older runs do not have it. Members of a multi-stage run are returned in stage order ("Stage 2" before "Stage 10"; validators not named "Stage N" follow, sorted by validator then `control_id`).

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
GET /api/analytics/error-rate/trend       — error rate over time (rolling window defaults to the range length, capped at 365 days; explicit `windowDays` is clamped to 1–90; empty windows return `errorRate: null`)
GET /api/analytics/results-by-error-type  — breakdown by error code/name
```

All accept the shared filter parameters. `technique-distribution`, `test-coverage` and `threat-actor-coverage` also accept `basis=latest`. Under `latest`, `threat-actor-coverage` also returns `pairCount` and `lastTestedAt` per actor.

### Technique Outcomes

```
GET /api/analytics/technique-outcomes
```

Accepts the shared filter parameters. Returns one entry per technique with `protected`, `detected`, `unprotected` and `lastTestedAt`. It always uses the latest-result basis, scores each stage on its own (like `technique-distribution`), and is not capped. The `basis` parameter is ignored. It feeds the ATT&CK outcome matrix on the Security Dashboard.

### Chain Depth

```
GET /api/analytics/chain-depth
```

Accepts the shared filter parameters. For each multi-stage (non-cyber-hygiene) chain, it takes the latest run on each host and reports the stage where it was blocked. Response fields: `chains`, `buckets` (`[{ stage, blocked, alertedNotBlocked, bundleNames }]`), `endToEnd`, `endToEndAlerted`, `endToEndBundleNames`, `endToEndAlertedBundleNames`, `endToEndUndetectedBundleNames`, `inconclusive`, `blockedBeforeRun`, `blockedBeforeRunBundleNames`, and `stageErrors`. There are always four buckets, `stage` 1, 2, 3 and 4, where 4 means "4+" (blocked at stage 4 or later). `alertedNotBlocked` counts the bucket's chains where an EDR (Defender or CrowdStrike) detected a stage without blocking it. `endToEndAlerted` has the same alerted-not-blocked meaning for the chains that ran end to end. `endToEndAlertedBundleNames` and `endToEndUndetectedBundleNames` list the bundles behind those two groups; a bundle appears in both when its chains differ by host. Chains whose latest run had a stage error or a pre-execution block are counted in `inconclusive` only, which splits into `blockedBeforeRun` (a stage was blocked before it ran, exit 260; the technique was not evaluated; `blockedBeforeRunBundleNames` lists the bundles) and `stageErrors` (for example exit 999). A run with both counts as `blockedBeforeRun`. Runs where an EDR killed the agent mid-test (see [Exit Codes & Outcomes](/docs/user-guide/analytics/exit-codes-and-outcomes#agent-terminated-by-the-edr)) carry no stages: they are counted in `chains` and in the new `agentTerminated` count, with `agentTerminatedBundleNames` listing their bundles, and are never placed in a stage bucket (the UI shows "Stopped by EDR, stage unknown: N"). A blocked chain's stage is its lowest-numbered blocked stage (from the `Stage N` validator), so a chain that keeps running after a block, such as LockBit `298cc137`, counts where it was first stopped, and `alertedNotBlocked` counts only detections on stages before that one. Runs without stage numbers fall back to the number of stages that ran, which gives the same stage for chains that stop at the first block.

The row endpoints (`GET /api/analytics/executions` and `/executions/paginated`) add `edr_terminated` (`true` for a run proven to be killed by the EDR), `edr_terminated_vendors` (`defender`, `crowdstrike`, `sentinelone`), `edr_terminated_alert_ids` (the alert ids that are the evidence) and `stages_unknown`. These rows are Protected as a whole and are excluded from the technique endpoints.

### Test Results

```
GET /api/analytics/test-results
```

Accepts the shared filter parameters, except that the date range, `basis` and `scoringMode` are fixed. For each test (or bundle) it takes the latest result on each host over the last 90 days and scores it like the Defense Score tile in any-stage mode (blocked or detected counts as protected). Returns an array of `{ testUuid, pairCount, protectedCount, hostCount, lastRunAt }`. `pairCount` is the number of test x host pairs, `protectedCount` how many of them are protected, and `hostCount` the distinct hosts. Cyber-hygiene control results are folded into their bundle's `testUuid`. It feeds the Fleet result column of the test library.

### Execution Activity

```
GET /api/analytics/execution-activity?days=14
```

Takes the organization and `days` (1 to 90, default 14); it does not use the shared filters. Returns `days[]` (daily protected, got-through and inconclusive counts per result document, one entry per UTC day, zero-filled), `lastExecutionAt` (all time), `executions7d`, `protectedPct7d` and `endpointsTested7d`. It feeds the testing cadence card.

Only real test results are counted: upload confirmations (exit 200) and Skipped bundle stages (exit 0 on a bundle-control document) are left out everywhere, including `lastExecutionAt`. Protected means conclusive and blocked or detected; got through means conclusive and not protected; anything else is inconclusive. The `*7d` numbers cover the last 7 UTC days including today, the same days as the last seven bars.

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
