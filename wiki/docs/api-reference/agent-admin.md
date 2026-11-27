---
sidebar_position: 4
title: "Agent Admin Endpoints"
description: "REST API endpoints for agent administration — list agents, create tokens, manage tasks and schedules."
---

# Agent Admin Endpoints

## Endpoints

All endpoints are under `/api/agent/admin` and take a **Clerk JWT**, a CLI token or an
[API key](./programmatic-access.md). Each route also checks one permission, shown with it.

### Organization scope \{#organization-scope}

- A caller with an organization (a Clerk organization session, or an API key created in one) only sees and changes its own organization's agents, tasks, schedules and enrollment tokens. Lists ignore any other `org_id`.
- An `org_id` in the query or body that is not the caller's returns `403`.
- An agent, task or schedule of another organization returns the same `404` as an id that does not exist.
- A caller without an organization (a single-organization install) sees everything and can filter lists with `?org_id=`. With `REQUIRE_ORG_ISOLATION=true` such a caller gets `403` (`Organization isolation required. Configure Clerk Organizations.`)
- Settings shared by the whole install (auto-rotation, agent versions) can only be changed by a caller that is **not** in an organization; an organization caller gets `403`.

### List Agents

```
GET /api/agent/admin/agents
```

`endpoints:agents:read`. Returns `{ "agents": [...], "total": n }` with status, system info and tags.

| Query | Notes |
|-------|-------|
| `status` | `active`, `disabled`, `decommissioned` or `uninstalled` |
| `os` | `windows`, `linux` or `darwin` |
| `hostname` | Hostname filter |
| `tag` | Agents carrying this tag |
| `online_only`, `stale_only` | `true` to filter |
| `limit`, `offset` | Paging |
| `org_id` | Only for callers without an organization |

### Other Agent Routes

| Method | Path | Permission | Notes |
|--------|------|------------|-------|
| `GET` | `/agents/:id` | `endpoints:agents:read` | One agent |
| `PATCH` | `/agents/:id` | `endpoints:agents:write` | Body: `status` (`active` or `disabled`) and/or `tags` |
| `DELETE` | `/agents/:id` | `endpoints:agents:delete` | Decommissions the agent |
| `POST` | `/agents/:id/rotate-key` | `endpoints:agents:write` | Returns the new `agent_key` once; the agent picks it up on its next heartbeat. 3 per 15 minutes per IP |
| `GET` | `/agents/:id/heartbeats?days=7` | `endpoints:agents:read` | Heartbeat history, `days` 1 to 30 |
| `GET` | `/agents/:id/events` | `endpoints:agents:read` | Agent events; `limit` (50), `offset`, `event_type` |
| `GET` | `/tags` | `endpoints:agents:read` | Tags in use, with agent counts |
| `POST` | `/tags/bulk` | `endpoints:agents:write` | Body: `agent_ids` (1 to 500), `add` and/or `remove` (up to 20 each). Returns `{ "updated": n }` |
| `POST` | `/agents/:id/tags` | `endpoints:agents:write` | Body: `{ "tag": "..." }` |
| `DELETE` | `/agents/:id/tags/:tag` | `endpoints:agents:delete` | Removes one tag |
| `GET` | `/metrics` | `endpoints:agents:read` | Fleet and task counts, including `task_outcomes_7d` |
| `GET` | `/metrics/fleet-health` | `endpoints:agents:read` | Fleet health metrics |
| `GET` | `/settings/auto-rotation` | `endpoints:agents:write` | Key auto-rotation settings |
| `PUT` | `/settings/auto-rotation` | `endpoints:agents:write` | Body: `enabled`, `intervalDays` (30 to 365). Install-wide |

A tag is 1 to 32 characters: lowercase letters, digits and `. _ : -`, starting with a letter or digit.

### Enrollment Tokens

```
POST /api/agent/admin/tokens
```

`endpoints:tokens:create`.

**Body:**
```json
{
  "org_id": "default",
  "ttl_hours": 24,
  "max_uses": 10,
  "metadata": { "description": "Lab deployment batch" }
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `org_id` | required | The organization the enrolled agents will belong to. Must be the caller's organization (`403` otherwise) |
| `ttl_hours` | `24` | 1 to 720 |
| `max_uses` | `1` | 1 to 1000 |
| `metadata` | `{}` | String key/value pairs |

Returns `201` with `token` (shown once), `id`, `expires_at` and `max_uses`.

```
GET    /api/agent/admin/tokens?org_id=<org>
DELETE /api/agent/admin/tokens/:id
```

The list needs `endpoints:tokens:create` and a required `org_id`; it returns the active tokens of that organization, never the token value. Revoking needs `endpoints:tokens:delete`; another organization's token returns `404`.

### Create Task

```
POST /api/agent/admin/tasks
```

`endpoints:tasks:create`.

**Body:**
```json
{
  "org_id": "default",
  "agent_ids": ["agent-uuid-1", "agent-uuid-2"],
  "test_uuid": "7659eeba-f315-440e-9882-4aa015d68b27",
  "test_name": "Test name",
  "binary_name": "7659eeba-f315-440e-9882-4aa015d68b27.exe",
  "target_index": "achilles-results-engagement1"
}
```

| Field | Notes |
|-------|-------|
| `org_id`, `agent_ids`, `test_uuid`, `test_name`, `binary_name` | Required. Every agent must belong to the caller's organization (`404` (`Agent not found`) otherwise) |
| `test_uuid` | The test's id as the Test Library shows it (UUID). Anything else is a `400` |
| `binary_name` | A file name, with no folder in it: the `filename` of the test's build (`GET /api/tests/builds/:uuid`). The server sends each agent the binary its build record lists for the agent's OS |
| `execution_timeout` | Seconds, optional |
| `arguments` | Array of strings, optional |
| `priority` | 0 to 10, optional |
| `max_retries` | 0 to 5, optional |
| `metadata` | Optional test metadata (`category`, `subcategory`, `techniques`, `tactics`, `threat_actor`, `target`, `complexity`, `tags`, `score`, `integrations`). `severity` is optional and no longer sent by the console |
| `target_index` | Optional results index. Must match `achilles-results-...` (lowercase letters, digits, `.`, `_`, `-`; up to 200 characters), else `400` |

Returns `201` with `{ "task_ids": [...] }`, one task per agent. When
[pre-execution notices](./alerting#pre-execution-notices) are on, the tasks are held until the notice is sent.

### Other Task Routes

| Method | Path | Permission | Notes |
|--------|------|------------|-------|
| `POST` | `/tasks/command` | `endpoints:tasks:command` | Runs a shell command on the agents. Body: `org_id`, `agent_ids`, `command`, optional `execution_timeout`, `priority` |
| `POST` | `/tasks/update` | `endpoints:tasks:create` | Asks agents to update themselves. Body: `org_id`, `agent_ids` |
| `POST` | `/tasks/uninstall` | `endpoints:agents:delete` | Asks agents to uninstall. Body: `org_id`, `agent_ids`, optional `cleanup` |
| `GET` | `/tasks` | `endpoints:tasks:read` | Flat list. Query: `agent_id`, `status`, `type`, `search`, `limit`, `offset` |
| `GET` | `/tasks/:id` | `endpoints:tasks:read` | One task |
| `POST` | `/tasks/:id/cancel` | `endpoints:tasks:cancel` | `400` (`Cannot cancel task in status: <status>`) for a task that can no longer be cancelled |
| `DELETE` | `/tasks/:id` | `endpoints:tasks:delete` | See [Delete a Task](#delete-a-task) |
| `PATCH` | `/tasks/:id/notes` | `endpoints:tasks:notes` | Body: `{ "content": "..." }` |
| `POST` | `/ingestion/retry` | `endpoints:tasks:create` | Retries results that did not reach Elasticsearch |
| `POST` | `/catalog/reload` | `tests:sync:execute` | Re-reads the test library into the task catalog |

Task responses never include the task's environment variables (`payload.env_vars`).

### Delete a Task \{#delete-a-task}

```
DELETE /api/agent/admin/tasks/:id
```

Only a `completed`, `failed` or `expired` task can be deleted. Any other status returns
`409` (`Only a completed, failed or expired task can be deleted (this one is <status>); cancel it instead`).
The deleted task is not discarded: its full row is kept in an archive with the time and the user who deleted it.
Task lists never show archived tasks.

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
behind the 24-hour sparkline column on the Agents page.

| Query | Default | Notes |
|-------|---------|-------|
| `hours` | `24` | Must be between 1 and 168; anything else returns `400` |
| `org_id` | — | Scopes the result to one organization (only for callers without an organization; see [Organization scope](#organization-scope)) |

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
GET /api/agent/admin/tasks/test-recency[?test_uuids=<uuid>[,<uuid>...]]
```

Run history for the target picker's "Not run" filter. Requires `endpoints:tasks:read`;
limited to the caller's organization like the task lists. `test_uuids` is optional
(up to 100); a malformed list returns `400`. Each user may call it 30 times a
minute (`429` after that); the console calls it once when a run dialog opens.

```json
{
  "success": true,
  "data": {
    "runs":   [ { "agent_id": "…", "test_uuid": "…", "last_run_at": "2026-10-20T09:30:00Z", "queued": false } ],
    "agents": [ { "agent_id": "…", "last_run_at": "2026-11-02T14:05:00Z", "queued": false } ]
  }
}
```

- `runs`: one row per agent and requested test that has at least one task. Empty without `test_uuids`.
- `agents`: one row per agent that has at least one test task, over every test.
- An agent with no row never received the test (or any test).
- `last_run_at` is the latest run that produced a result. A run that failed without one (agent offline, timeout), expired or was cancelled does not count, unless an EDR was later shown to have stopped it.
- `queued` is true while a run is pending or in progress on the agent.

Not available on the Vercel backend (`testRunRecency` is absent from `/api/capabilities`).

### Task Activity

```
GET /api/agent/admin/tasks/activity?tz=America/Santo_Domingo
```

Tasks per day over the last 30 days, by creation time, for the strip on the Tasks page. Needs `endpoints:tasks:read`; an organization caller counts its own organization's tasks only. Not available on the Vercel backend (`activityStrip` is `false` in `/api/capabilities`).

| Query | Notes |
|-------|-------|
| `tz` | The IANA time zone the days are cut in. Default `UTC`. An unknown, empty or repeated value returns `400 — Invalid tz` |
| `type`, `search` | As for [List Tasks (Grouped)](#list-tasks-grouped). The status filter and `breakdown` are not taken: the response splits each day by outcome itself |

```json
{
  "success": true,
  "data": {
    "interval": "day",
    "timeZone": "America/Santo_Domingo",
    "buckets": [
      { "from": "2026-11-26T04:00:00.000Z", "to": "2026-11-27T03:59:59.999Z", "unprotected": 2, "failed": 0, "noVerdict": 1, "inProgress": 3, "protected": 6, "completed": 4 }
    ]
  }
}
```

- `buckets` are whole local days (a day can be 23 or 25 hours when the clocks change), oldest first, zero-filled; the first starts at or before 30 days ago.
- A task counts as the Tasks page's run timeline counts it: in progress while pending, assigned, downloading or executing; a security test by its outcome (protected, unprotected, else no verdict); any other task completed when it ended with exit code 0 (or no result), else failed.
- A day's `from` and `to`, passed to the grouped list as `from` and `to` with the same `type`, list exactly the tasks it counted. With a `search` the two differ: this endpoint counts the tasks that match, the grouped list shows each matching run whole (within the day), so a search by host name lists that run's other hosts too.
- Only the part of each result the count needs is read (no output, no cyber-hygiene controls). Not cached.

### List Tasks (Grouped)

```
GET /api/agent/admin/tasks/grouped
```

Returns tasks grouped by run, newest first, for the Tasks page. A run is, in this order:
every task one schedule created for one day (a schedule with a time per machine creates
one batch per agent); else every task one pre-execution notice announced for one test;
else a batch. `limit`, `offset`
and `total` count runs. A group is listed whole when any of its tasks matches the filters.

Each group carries:

| Field | Notes |
|-------|-------|
| `run_id` | `s:…` for a scheduled run, `n:…` for an announced run, `b:<batch id>` for a batch. Treat it as an opaque id |
| `batch_id` | The run's batch; for a run of several batches, the newest one |
| `batch_ids` | Every batch with a task in the run, newest first |
| `created_at` | The batch's time; for a run of several batches, its newest task's (with a filter, its newest matching task's) |
| `agent_count`, `status_counts` | Describe the whole run, also under a `breakdown` filter |
| `tasks[].schedule_run` | `<schedule id>:<date>` when a schedule created the task (the date is the local day of its slot), else `null` |

`run_id` and `batch_ids` are not sent by the Vercel backend, which has no notices: there a
run is always a batch.

Besides the usual status, type, search and paging filters it accepts:

| Query | Notes |
|-------|-------|
| `from`, `to` | Only tasks created in that stretch of time: ISO instants, both included (a day of the [activity strip](#task-activity)). Either alone is allowed. A run whose tasks fall outside it lists only the tasks inside; `agent_count` and `status_counts` still describe the whole run, and the type counts count only tasks inside. An unreadable value, a value given twice, or an end before its start returns `400 — Invalid date range` |
| `breakdown` | Only tasks whose finished outcome matches one key of the 7-day breakdown. Implies `execute_test` tasks and the last 7 days. An unknown shape returns `400 — Invalid breakdown` |
| `detail` | `full` (the default, also when the value is empty) returns whole tasks. `summary` returns light tasks, below. Any other value, or the parameter given more than once, returns `400 — Invalid detail` |

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

#### Light tasks (`detail=summary`)

A page of whole tasks can run to megabytes: every task carries its stdout, its test
metadata and, for a cyber-hygiene bundle, the full detail of 50 to 150 controls. A list
draws none of that. With `detail=summary` each task keeps every field except these two,
which are cut down to what a list draws:

| Field | Kept |
|-------|------|
| `payload` | `test_uuid`, `test_name`, `binary_name`, `execution_timeout`, and `command` for a command task |
| `result` | `summary: true`, `exit_code`, `execution_duration_ms`, and when present `error`, `edr_terminated`, `compacted_at`, `bundle_results` |
| `result.bundle_results`, any category but `cyber-hygiene` | `bundle_category` and `controls`: each stage's `control_id`, `exit_code` and `skipped`, in order. An entry without a text `control_id` and a numeric `exit_code` is left out |
| `result.bundle_results`, category `cyber-hygiene` | `bundle_category` and `control_counts`: `evaluated` (controls not skipped) and `compliant` (by the control's own `compliant` flag, or by exit code 105, 126 or 127 when it has none). Entries without a text `control_id` and a numeric `exit_code` are not counted. Neither `controls` nor `control_counts` is sent for a bundle with no controls |

`result` stays `null` for a task without one. Group-level fields are the same in both forms.
`summary: true` tells a light result from one whose output is empty or was removed by
retention (`compacted_at`).

Get the whole task, with its output and every control, from
[`GET /api/agent/admin/tasks/:id`](#other-task-routes). The Tasks page asks for light tasks and
fetches the task whose detail is open.

A light task is made of allowlists: a field is added to it only when a list starts to draw it.
Read whole tasks (the default) if you need anything else. The Vercel backend ignores `detail`
and always returns whole tasks.

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

### Schedules

| Method | Path | Permission | Notes |
|--------|------|------------|-------|
| `GET` | `/schedules` | `endpoints:schedules:read` | Optional `status` filter |
| `GET` | `/schedules/:id` | `endpoints:schedules:read` | One schedule |
| `POST` | `/schedules` | `endpoints:schedules:create` | See below |
| `PATCH` | `/schedules/:id` | `endpoints:schedules:write` | Any of `name`, `agent_ids`, `schedule_config`, `timezone`, `status` (`active` or `paused`), `priority`, `execution_timeout` |
| `DELETE` | `/schedules/:id` | `endpoints:schedules:delete` | Deletes the schedule |

### Agent Versions

| Method | Path | Permission | Notes |
|--------|------|------------|-------|
| `GET` | `/versions` | `endpoints:versions:read` | Registered agent versions. A signed version carries `signer_subject` and, for Windows, `signer_fingerprint` (SHA-256 of the signing certificate, 64 hex characters) when the server could read it |
| `GET` | `/versions/readiness` | `endpoints:versions:read` | Whether an install command's download would work now. Returns `any_ready` and five `platforms` (`os`, `arch`, `ready`, `version`, `reason`: `no version` or `file missing`, `null` when ready). Not on `backend-serverless` |
| `POST` | `/versions` | `endpoints:versions:create` | Registers a binary already on the server. Body: `version`, `os`, `arch`, `binary_path`, optional `release_notes`, `mandatory` |
| `POST` | `/versions/upload` | `endpoints:versions:create` | Multipart upload: file field `binary`, plus `version`, `os`, `arch`, optional `release_notes`, `mandatory`, `cert_id`, `allow_unsigned` |
| `POST` | `/versions/build` | `endpoints:versions:create` | Builds from source. Body: `version`, `os`, `arch`. `501` when the agent source is not available |
| `DELETE` | `/versions/:version/:os/:arch` | `endpoints:versions:delete` | Removes a version |

`release_notes` on both routes is free text, with one reserved form: notes that start with `Built from source` are a `400`. The server writes that line for versions it builds, and the console shows it as the version's source commit.

The four write routes are install-wide (see [Organization scope](#organization-scope)).
Registering or uploading returns `422` when the version does not equal the version built into the binary,
or when signing fails.

### Create Schedule

```
POST /api/agent/admin/schedules
```

**Body** (a one-off run on 2026-10-29, each machine at its own random time):
```json
{
  "agent_ids": ["agent-uuid"],
  "org_id": "default",
  "test_uuid": "7659eeba-f315-440e-9882-4aa015d68b27",
  "test_name": "Test name",
  "binary_name": "7659eeba-f315-440e-9882-4aa015d68b27.exe",
  "metadata": {
    "category": "", "subcategory": "", "techniques": [], "tactics": [],
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

`target_index`, `name`, `priority` and `execution_timeout` are optional, with the same rules as [Create Task](#create-task). Leave the `metadata` fields empty to take them from the test library. `randomize_mode` on `once` is not supported by the Vercel (serverless) backend.
