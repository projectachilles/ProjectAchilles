---
sidebar_position: 5
title: "Agent Device Endpoints"
description: "REST API endpoints used by the Go agent — enrollment, heartbeat, task polling, and result reporting."
---

# Agent Device Endpoints

## Authentication

Device endpoints use **agent key** authentication via headers. The key is the `agent_key` returned by enrollment (it starts with `ak_`):

```
Authorization: Bearer ak_<agent-key>
X-Agent-ID: <agent-id>
X-Agent-Version: <agent version>
X-Request-Timestamp: <RFC3339 UTC timestamp>
```

`X-Request-Timestamp` is required; a request without it, or whose timestamp is more than 5 minutes from the server's clock, is refused. Every
authentication failure returns the same `401` (`Invalid agent credentials`).

Rate limit: 30 requests per minute per agent (IP + agent id). Enrollment, `/config` and
`/download` take no agent key.

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
  "agent_version": "0.7.4"
}
```

`os` is `windows`, `linux` or `darwin`; `arch` is `amd64` or `arm64`.

**Response** (`201`):
```json
{
  "success": true,
  "data": {
    "agent_id": "uuid",
    "agent_key": "generated-key",
    "org_id": "default",
    "server_url": "https://backend.example.com",
    "poll_interval": 30,
    "update_public_key": "base64-ed25519-public-key"
  }
}
```

The agent joins the organization of the enrollment token. Rate limit: 300 per 15 minutes per IP.

### Server URL and Agent Download

```
GET /api/agent/config
GET /api/agent/download?os=<os>&arch=<arch>
```

**Auth:** none. `/config` returns `{ "server_url": "..." }` (the backend's `AGENT_SERVER_URL`).
`/download` streams the latest registered agent binary for that platform; a missing or invalid
`os` or `arch` returns `400`. Rate limit: 300 per 15 minutes per IP.

### Heartbeat

```
POST /api/agent/heartbeat
```

**Auth:** Agent key

Reports system metrics and agent status. The backend uses heartbeats to determine online/offline state and detect reconnection events.

**Body:**
```json
{
  "timestamp": "2026-11-15T14:30:00Z",
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
  "agent_version": "0.7.4",
  "last_task_completed": "task-uuid-or-null",
  "reconnect_reason": "service_restart",
  "process_start_time": "2026-11-15T14:29:55Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | ISO 8601 UTC timestamp. More than 5 minutes from the server's clock returns `400` |
| `status` | string | `idle`, `executing`, `updating`, `error` or `offline` |
| `current_task` | string\|null | UUID of currently executing task |
| `system` | object | Host and process metrics. `total_memory_mb`, `process_cpu_percent` and `process_memory_mb` are optional |
| `agent_version` | string | Current agent binary version |
| `last_task_completed` | string\|null | UUID of last completed task |
| `reconnect_reason` | string\|undefined | Why the agent was offline (only sent on first heartbeat after a gap): `service_restart`, `network_recovery`, `machine_reboot`, `update_restart`, `network_adapter_disabled`, `dns_failure`, `server_unreachable`, `network_unreachable`, `connection_timeout`, `connection_reset`, `tls_error`, `disk_pressure_crash`, `memory_pressure_crash`, `unknown` |
| `process_start_time` | string\|undefined | ISO 8601 timestamp of when the agent process started (sent with reconnect_reason) |
| `reconnect_context` | object\|undefined | Details of the gap: `reason`, `offline_duration_seconds`, `failure_count`, and optional `detail`, `first_failure_at`, `network_state`, `system_at_failure`, `process_start_time` |

**Response:**
```json
{
  "success": true,
  "data": {
    "acknowledged": true,
    "server_time": "2026-11-15T14:30:01Z",
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

Returns the next task for this agent and assigns it, or `204` when there is none. A task
held by a [pre-execution notice](./alerting#pre-execution-notices) is not handed out until the notice is released.

### Update Task Status

```
PATCH /api/agent/tasks/:id/status
```

**Auth:** Agent key

Body: `{ "status": "downloading", "error": "optional message" }`. `status` is one of `pending`,
`assigned`, `downloading`, `executing`, `completed`, `failed`, `expired`.

### Download a Test Binary

```
GET /api/agent/binary/:name?test_uuid=<uuid>
```

**Auth:** Agent key

Streams the test binary named in the task payload. The agent must hold a task for that test
(`assigned`, `downloading` or `executing`); otherwise the answer is `404` (`Binary not found`),
the same as for a binary that does not exist.

### Report Result

```
POST /api/agent/tasks/:id/result
```

**Auth:** Agent key

Reports the execution result. The server writes test results to Elasticsearch and evaluates alert thresholds.

**Body:**
```json
{
  "task_id": "task-uuid",
  "test_uuid": "test-uuid",
  "exit_code": 126,
  "stdout": "",
  "stderr": "",
  "started_at": "2026-11-15T14:30:00Z",
  "completed_at": "2026-11-15T14:30:42Z",
  "execution_duration_ms": 42000,
  "binary_sha256": "sha256-hex",
  "hostname": "WORKSTATION-01",
  "os": "windows",
  "arch": "amd64"
}
```

All of these fields are required for every task type (including `update_agent`); a body that
misses one returns `400`. `error` and `bundle_results` are optional. `bundle_results` carries the
per-control results of a bundle test; see [Bundle Results Protocol](./bundle-results).

A task of another agent returns `403`. Reporting a status or result for a task that is already
finished returns `200` with `"idempotent": true` and the header `F0-Task-State: terminal-idempotent`,
so the agent stops retrying.

### Check for Updates

```
GET /api/agent/version
```

**Auth:** Agent key

Returns the latest registered version for the agent's platform (`version`, `sha256`, `size`, `mandatory`, and the Ed25519 `signature` when the binary has one),
or `204` when there is none or it equals the `X-Agent-Version` header.

```
GET /api/agent/update
```

**Auth:** Agent key

Streams the latest agent binary for the agent's platform (`os` and `arch` query parameters override it).
