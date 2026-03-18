---
sidebar_position: 1
title: "Overview & Authentication"
description: "API overview, authentication model, and common patterns for the ProjectAchilles REST API."
---

# Overview & Authentication

All endpoints are served from the backend at `/api/*`.

## Authentication

### Web Endpoints (Clerk JWT)

Most endpoints require a Clerk JWT in the Authorization header:

```bash
curl -H 'Authorization: Bearer <clerk-jwt>' https://backend.example.com/api/browser/tests
```

### Agent Device Endpoints

Agent endpoints use an API key issued during enrollment:

```bash
curl -H 'X-Agent-Key: <api-key>' -H 'X-Agent-ID: <agent-id>' https://backend.example.com/api/agent/heartbeat
```

## Response Format

### Success
```json
{ "success": true, "data": { ... } }
```

### Error
```json
{ "success": false, "error": "Error message" }
```

## Rate Limits

| Endpoint Group | Limit |
|---------------|-------|
| Enrollment | 5 / 15 min per IP |
| Device (heartbeat, tasks) | 100 / 15 min per agent |
| Binary download | 10 / 15 min per IP |
| Key rotation | 3 / 15 min per IP |
| Auth | 20 / 15 min per IP |

## Route Groups

| Prefix | Auth | Purpose |
|--------|------|---------|
| `/api/browser/*` | Clerk | Test browser |
| `/api/analytics/*` | Clerk | Elasticsearch analytics |
| `/api/analytics/defender/*` | Clerk | Defender analytics |
| `/api/agent/admin/*` | Clerk | Agent management |
| `/api/agent/*` | Agent key | Device endpoints |
| `/api/tests/*` | Clerk | Build system, certificates |
| `/api/integrations/*` | Clerk | Defender, alerting config |
