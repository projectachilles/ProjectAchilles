---
sidebar_position: 3
title: "Analytics Endpoints"
description: "REST API endpoints for ProjectAchilles analytics — defense scores, heatmaps, trends, and executions."
---

# Analytics Endpoints

## Endpoints

### Defense Score

```
GET /api/analytics/defense-score
```

Returns the aggregate defense score with breakdowns.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `index` | string | Target ES index (optional) |
| `technique` | string | Filter by MITRE technique |
| `hostname` | string | Filter by hostname |
| `dateFrom` | string | Start date (ISO 8601) |
| `dateTo` | string | End date (ISO 8601) |

### Defense Score Trend

```
GET /api/analytics/defense-score/trend
```

Returns the defense score over time for trend visualization.

### Host-Test Matrix

```
GET /api/analytics/host-test-matrix
```

Returns the host x test heatmap data for the matrix visualization.

### Technique Distribution

```
GET /api/analytics/technique-distribution
```

Returns technique coverage breakdown.

### Paginated Executions

```
GET /api/analytics/executions/paginated
```

Returns paginated execution results with advanced filtering.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (1-indexed) |
| `pageSize` | number | Results per page |
| `sort` | string | Sort field |
| `order` | string | `asc` or `desc` |
| `technique` | string | Filter by technique |
| `hostname` | string | Filter by hostname |
| `exitCode` | number | Filter by exit code |

### Configure Elasticsearch

```
POST /api/analytics/settings
```

Save Elasticsearch connection credentials.
