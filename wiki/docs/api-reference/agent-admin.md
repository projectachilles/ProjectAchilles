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

### Create Tasks for Several Tests

```
POST /api/agent/admin/tasks/batch
```

Creates the tasks for 1 to 50 tests in one all-or-nothing request, under a
single pre-execution notice. Body: `{ "org_id": "...", "requests": [ ... ] }`,
where each request has the Create Task fields. See
[Several tests under one notice](./alerting#several-tests-under-one-notice).
Requires `endpoints:tasks:create`. Not available on Vercel deployments, which
have no pre-execution notices; there the UI creates one task per test instead.

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

:::note[Route ordering]
This route is registered **before** `/agents/:id`, otherwise Express captures
`heartbeats` as an agent id and the endpoint 404s.
:::

### Test Recency

```
GET /api/agent/admin/tasks/test-recency?test_uuids=<uuid>[,<uuid>...]
```

When each given test last ran on each agent, for the target picker's "Not run in" filter.
Requires `endpoints:tasks:read`; limited to the caller's organization like the task lists.
Up to 100 test UUIDs; a missing or malformed list returns `400`.

```json
{ "runs": [ { "agent_id": "…", "test_uuid": "…", "last_run_at": "2026-10-20T09:30:00Z", "queued": false } ] }
```

- One row per agent and test that has at least one task. An agent with no row never received the test.
- `last_run_at` is the latest run that produced a result. A run that failed without one (agent offline, timeout), expired or was cancelled does not count, unless an EDR was later shown to have stopped it.
- `queued` is true while a run of the test is pending or in progress on the agent.

Not available on the Vercel backend (`testRunRecency` is absent from `/api/capabilities`).

### List Tasks (Grouped)

```
GET /api/agent/admin/tasks/grouped
```

Returns tasks grouped by batch, newest first, for the Tasks page. Besides the usual
status, type, search and paging filters it accepts:

| Query | Notes |
|-------|-------|
| `breakdown` | Only tasks whose finished outcome matches one key of the 7-day breakdown. Implies `execute_test` tasks and the last 7 days. An unknown shape returns `400 — Invalid breakdown` |

Breakdown keys:

| Key | Matches |
|-----|---------|
| `exit:<code>` | Finished runs that ended with that exit code |
| `stage:<code>` | Multi-stage runs whose result is decided by a stage with that code |
| `edr-stopped` | Runs ended by an EDR that stopped the agent |
| `failed:offline`, `failed:timeout`, `failed:other` | Failed runs, by reason |

`<code>` is an integer of up to 10 digits and may be negative (`exit:-1`).

The metrics response (`GET /api/agent/admin/metrics`) carries the same keys in
`task_outcomes_7d.breakdown`, one row per breakdown key (several rows can share an outcome):

```json
{ "key": "exit:126", "outcome": "protected", "code": 126, "name": "ExecutionPrevented", "count": 12 }
```

Pass a row's `key` back as `breakdown` to list the tasks behind its `count`. The type-pill counts (`type_counts`) ignore `breakdown`.

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

:::info[Retry counting]
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

**Body** (a one-off run on 2026-10-29, each machine at its own random time):
```json
{
  "agent_ids": ["agent-uuid"],
  "org_id": "default",
  "test_uuid": "test-uuid",
  "test_name": "Test name",
  "binary_name": "test-uuid.exe",
  "metadata": {
    "category": "", "subcategory": "", "severity": "", "techniques": [], "tactics": [],
    "threat_actor": "", "target": [], "complexity": "", "tags": [], "score": null, "integrations": []
  },
  "schedule_type": "once",
  "schedule_config": { "date": "2026-10-29", "time": "09:00", "randomize_mode": "per_machine" },
  "timezone": "Europe/London"
}
```

`schedule_type` is `once`, `daily`, `weekly` or `monthly`. `schedule_config` takes:
- `once`: `date` and `time`;
- `daily`: `time`;
- `weekly`: `days` (0 = Sunday … 6 = Saturday) and `time`;
- `monthly`: `dayOfMonth` and `time`.

Every type also takes an optional `randomize_mode`:
- `fixed` (the default) runs at `time`.
- `fleet` runs all agents together at one random time.
- `per_machine` gives each agent its own random time.

The random times fall within weekdays 09:00–17:00 or weekends at any time, in `timezone`. A randomized `once` uses only what's left of the window when `date` is today. It returns `400` if today's window has already closed.

Leave the `metadata` fields empty to take them from the test library. `randomize_mode` on `once` is not supported by the Vercel (serverless) backend.
