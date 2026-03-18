---
sidebar_position: 5
title: "Agent Device Endpoints"
description: "REST API endpoints used by the Go agent — enrollment, heartbeat, task polling, and result reporting."
---

# Agent Device Endpoints

## Authentication

Device endpoints use **agent API key** authentication via headers:

```
X-Agent-Key: <api-key>
X-Agent-ID: <agent-id>
X-Request-Timestamp: <RFC3339 UTC timestamp>
```

### Enroll

```
POST /api/agent/enroll
```

**Auth:** Enrollment token (in body)

**Body:**
```json
{
  "token": "enrollment-token-string",
  "hostname": "WORKSTATION-01",
  "os": "windows",
  "arch": "amd64",
  "agent_version": "1.0.0"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "agent_id": "uuid",
    "api_key": "generated-key",
    "public_key": "base64-ed25519-public-key"
  }
}
```

### Heartbeat

```
POST /api/agent/heartbeat
```

**Auth:** Agent key

Reports system metrics and receives commands (key rotation, uninstall).

### Poll Tasks

```
GET /api/agent/tasks
```

**Auth:** Agent key

Returns pending tasks for this agent.

### Report Result

```
POST /api/agent/tasks/:id/result
```

**Auth:** Agent key

Reports execution result. Accepts optional `bundle_results` field for per-control fan-out.

### Check for Updates

```
GET /api/agent/update
```

**Auth:** Agent key

Returns latest agent version info with download URL and Ed25519 signature.
