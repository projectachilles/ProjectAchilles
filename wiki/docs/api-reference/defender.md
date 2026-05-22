---
sidebar_position: 7
title: "Defender Endpoints"
description: "REST API endpoints for the Microsoft Defender integration — Secure Score, alerts, control profiles, cross-correlation, and auto-resolve."
---

# Defender Endpoints

All Defender endpoints require Clerk authentication. Analytics endpoints require
the `analytics:dashboards:read` permission; integration endpoints require
`integrations:read` or `integrations:write`.

## Analytics Endpoints

Base path: `/api/analytics/defender`

### Secure Score

```
GET /api/analytics/defender/secure-score
GET /api/analytics/defender/secure-score/trend
```

Current Microsoft Secure Score with category breakdown, and its history over
time.

### Alerts

```
GET /api/analytics/defender/alerts/summary
GET /api/analytics/defender/alerts
GET /api/analytics/defender/alerts/trend
```

- **`/alerts/summary`** — alert counts broken down by severity and status.
- **`/alerts`** — the alert list, filterable by severity and time range.
- **`/alerts/trend`** — alert volume bucketed over time.

### Controls

```
GET /api/analytics/defender/controls
GET /api/analytics/defender/controls/by-category
GET /api/analytics/defender/controls/correlation
```

- **`/controls`** — Defender control profiles with compliance status.
- **`/controls/by-category`** — controls grouped by category.
- **`/controls/correlation`** — controls linked to the alerts and techniques
  they cover (control ↔ alert linking).

### Cross-Correlation

```
GET /api/analytics/defender/correlation/scores
GET /api/analytics/defender/correlation/techniques
GET /api/analytics/defender/correlation/detection-rate
GET /api/analytics/defender/correlation/alerts-for-test
```

- **`/correlation/scores`** — Defense Score vs. Secure Score over time.
- **`/correlation/techniques`** — MITRE technique overlap between test results
  and Defender alerts.
- **`/correlation/detection-rate`** — the headline **per-execution detection
  rate** (see below).
- **`/correlation/alerts-for-test`** — per-test evidence correlation; returns
  the Defender alerts matched to a specific test execution (powers the alert
  drawer drill-down).

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

### Configuration

```
GET  /api/integrations/defender
POST /api/integrations/defender
POST /api/integrations/defender/test
```

- **`GET /defender`** — returns whether Defender is configured (no secrets).
- **`POST /defender`** — save credentials. Stored AES-256-GCM encrypted.
- **`POST /defender/test`** — validate credentials against Microsoft Graph.

**`POST /defender` body:**
```json
{
  "tenantId": "...",
  "clientId": "...",
  "clientSecret": "..."
}
```

### Sync

```
POST /api/integrations/defender/sync
GET  /api/integrations/defender/sync/status
```

- **`POST /defender/sync`** — trigger an immediate sync from Microsoft Graph.
- **`GET /defender/sync/status`** — last sync timestamps for scores and alerts.

### Auto-Resolve

```
GET /api/integrations/defender/auto-resolve/status
PUT /api/integrations/defender/auto-resolve/mode
GET /api/integrations/defender/auto-resolve/receipts?limit=<n>&offset=<n>
```

- **`/auto-resolve/status`** — current mode plus recent receipt counts.
- **`/auto-resolve/mode`** — set the mode; body `{ "mode": "disabled" | "dry_run" | "enabled" }`.
- **`/auto-resolve/receipts`** — paginated receipt history.

See [Defender Auto-Resolve](../user-guide/integrations/defender-auto-resolve)
for the feature walkthrough.
