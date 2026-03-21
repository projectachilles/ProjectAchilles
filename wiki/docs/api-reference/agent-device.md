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

Reports system metrics and agent status. The backend uses heartbeats to determine online/offline state and detect reconnection events.

**Body:**
```json
{
  "timestamp": "2026-03-21T14:30:00Z",
  "status": "idle",
  "current_task": null,
  "system": {
    "hostname": "WORKSTATION-01",
    "os": "windows",
    "arch": "amd64",
    "uptime_seconds": 86400,
    "cpu_percent": 15,
    "memory_mb": 4096,
    "disk_free_mb": 50000,
    "process_cpu_percent": 2,
    "process_memory_mb": 25
  },
  "agent_version": "0.5.11",
  "last_task_completed": "task-uuid-or-null",
  "reconnect_reason": "service_restart",
  "process_start_time": "2026-03-21T14:29:55Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | ISO 8601 UTC timestamp |
| `status` | string | `idle` or `executing` |
| `current_task` | string\|null | UUID of currently executing task |
| `system` | object | Host and process metrics |
| `agent_version` | string | Current agent binary version |
| `last_task_completed` | string\|null | UUID of last completed task |
| `reconnect_reason` | string\|undefined | Why the agent was offline (only sent on first heartbeat after a gap): `service_restart`, `network_recovery`, `machine_reboot`, `update_restart` |
| `process_start_time` | string\|undefined | ISO 8601 timestamp of when the agent process started (sent with reconnect_reason) |

**Response:**
```json
{
  "success": true,
  "data": {
    "acknowledged": true,
    "server_time": "2026-03-21T14:30:01Z",
    "new_api_key": "optional-rotated-key"
  }
}
```

The `new_api_key` field is only present when the server has initiated an API key rotation for this agent.

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
