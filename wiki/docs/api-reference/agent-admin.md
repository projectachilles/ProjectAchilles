---
sidebar_position: 4
title: "Agent Admin Endpoints"
description: "REST API endpoints for agent administration — list agents, create tokens, manage tasks and schedules."
---

# Agent Admin Endpoints

## Endpoints

All endpoints require **Clerk JWT** authentication.

### List Agents

```
GET /api/agent/admin/agents
```

Returns all enrolled agents with status, system info, and tags.

### Create Enrollment Token

```
POST /api/agent/admin/tokens
```

**Body:**
```json
{
  "ttl_hours": 24,
  "max_uses": 10,
  "description": "Lab deployment batch"
}
```

### Create Task

```
POST /api/agent/admin/tasks
```

**Body:**
```json
{
  "agent_ids": ["agent-uuid-1", "agent-uuid-2"],
  "test_uuid": "test-uuid",
  "platform": "windows",
  "arch": "amd64",
  "es_index": "achilles-results-engagement1"
}
```

### Bulk Heartbeat Buckets

```
GET /api/agent/admin/agents/heartbeats?hours=24&org_id=<org>
```

Returns hourly heartbeat counts for **every** agent in one request — the data
behind the 24-hour sparkline column on the Agents page. Added in 2.1 to replace
one request per agent, which did not scale past a few dozen endpoints.

| Query | Default | Notes |
|-------|---------|-------|
| `hours` | `24` | Must be between 1 and 168; anything else returns `400` |
| `org_id` | — | Scopes the result to one organization |

**Response** — a map of agent id to an array of `hours` counts, oldest bucket
first. Agents with no heartbeats in the window are omitted:

```json
{
  "success": true,
  "data": {
    "8f2c...": [3, 4, 4, 4, 0, 0, 4, 4],
    "b71e...": [4, 4, 4, 4, 4, 4, 4, 4]
  }
}
```

Requires the `endpoints:agents:read` permission.

:::note Route ordering
This route is registered **before** `/agents/:id`, otherwise Express captures
`heartbeats` as an agent id and the endpoint 404s.
:::

### Retry a Task

```
POST /api/agent/admin/tasks/:id/retry
```

Re-dispatches a finished `execute_test` task as a brand-new pending task,
carrying over the test, platform, arch, and target agent, and incrementing the
retry counter. Added in 2.1 to back the **Retry** action in the task stream's
failed-task panel.

Returns `201` with the newly created task.

| Condition | Response |
|-----------|----------|
| Task is not `execute_test` | `400 — Only test execution tasks can be retried` |
| Task is still pending, assigned, or running | `400 — Cannot retry task in status: <status>` |
| Task does not exist | `404` |

Requires the `endpoints:tasks:create` permission. Command tasks are rejected by
the service itself, so this route cannot be used to sidestep the stricter
`endpoints:tasks:command` permission.

:::info Retry counting
The clone records `original_task_id` (the first task in the chain) and
`retry_count + 1`. Manual retries are deliberately **not** capped by
`max_retries` — that budget governs automatic retries only.
:::

### List Schedules

```
GET /api/agent/admin/schedules
```

### Create Schedule

```
POST /api/agent/admin/schedules
```

**Body:**
```json
{
  "test_uuid": "test-uuid",
  "frequency": "daily",
  "time": "09:00",
  "agent_ids": ["agent-uuid"],
  "platform": "windows",
  "arch": "amd64",
  "randomize": true
}
```
