---
sidebar_position: 7
title: "Defender Endpoints"
description: "REST API endpoints for Microsoft Defender integration — Secure Score, alerts, and cross-correlation."
---

# Defender Endpoints

## Analytics Endpoints

### Secure Score

```
GET /api/analytics/defender/secure-score
```

Current Secure Score with category breakdown.

### Secure Score Trend

```
GET /api/analytics/defender/secure-score/trend
```

### Alerts

```
GET /api/analytics/defender/alerts
```

Defender alerts with filtering by severity and time range.

### Controls

```
GET /api/analytics/defender/controls
```

Control profiles with compliance status.

### Cross-Correlation

```
GET /api/analytics/defender/cross-correlation
```

Defense Score vs Secure Score correlation and MITRE technique overlap.

## Integration Endpoints

### Get Config Status

```
GET /api/integrations/defender/config
```

Returns whether Defender is configured.

### Save Config

```
POST /api/integrations/defender/config
```

**Body:**
```json
{
  "tenantId": "...",
  "clientId": "...",
  "clientSecret": "..."
}
```

### Trigger Sync

```
POST /api/integrations/defender/sync
```

Manually trigger a Defender data sync.
