---
sidebar_position: 8
title: "Alerting Endpoints"
description: "REST API endpoints for configuring alert thresholds and notification channels."
---

# Alerting Endpoints

## Endpoints

### Get Alert Configuration

```
GET /api/integrations/alerts
```

Returns current alert thresholds and notification channel configuration. Secrets are never returned: the Slack webhook is reported as `webhook_url_set`, the SMTP password is omitted, and `smtp_user` is masked as `****` plus its last four characters.

### Save Alert Configuration

```
POST /api/integrations/alerts
```

A partial update. Any field you leave out, or send blank, keeps its saved value. A masked `smtp_user` (starting with `****`) is treated as blank, so echoing back what `GET` returned never overwrites the real username.

**Body:**
```json
{
  "thresholds": { "enabled": true, "defense_score_min": 70, "error_rate_max": 20 },
  "cooldown_minutes": 30,
  "slack": { "enabled": true, "webhook_url": "https://hooks.slack.com/services/..." },
  "email": {
    "enabled": true,
    "smtp_host": "smtp.example.com",
    "smtp_port": 465,
    "smtp_secure": true,
    "smtp_user": "alerts@example.com",
    "smtp_pass": "<smtp-password>",
    "from_address": "alerts@example.com",
    "recipients": ["team@example.com"]
  },
  "agent_alerts": { "enabled": true, "offline_hours_threshold": 4 }
}
```

Credentials are encrypted at rest with AES-256-GCM.

### Test Channels

```
POST /api/integrations/alerts/test
```

Takes the same `slack_webhook_url` and `email` fields as the form, and checks the channels without saving anything. Email fields are merged over the saved settings field by field. A blank password or a blank or masked username reuses the saved one, **but only when `smtp_host` matches the saved host**. That way a test can't send the stored password to a different server. Changing the host therefore means typing the credentials again.

**Response:** `{ "success": true, "data": { "email": { "success": false, "message": "SMTP connection failed: Connection timeout" } } }`. A connection timeout usually means an outbound firewall is dropping traffic to the SMTP host.

## Pre-execution notices

Settings and status for [pre-execution notices](../user-guide/integrations/pre-execution-notices). All routes need Clerk authentication. Settings and the notice log are per organization: the caller's Clerk organization is used, and an organization without its own settings falls back to the deployment-wide (legacy) settings. A notice belongs to the organization of the tasks it gates. `GET /api/notices`, `GET /api/notices/status` and `POST /api/notices/:id/release` only see the caller's organization's notices; another organization's notice id returns `404 Notice not found`. A caller without an organization (single-organization deployments) sees every notice, unless `REQUIRE_ORG_ISOLATION=true`, which returns `403` from every notice route, including the settings routes. These routes are not available on the Vercel (serverless) backend.

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| `GET` | `/api/notices/settings` | `integrations:read` | Current settings, plus `smtp_configured` |
| `PUT` | `/api/notices/settings` | `integrations:write` | Update settings. Returns 400 if you enable without SMTP configured or without a recipient |
| `POST` | `/api/notices/settings/test` | `integrations:write` | Send a sample notice to the recipients |
| `GET` | `/api/notices/status` | `endpoints:tasks:read` | Banner data: overdue pending notices, not-delivered count (7 days), last SMTP check |
| `GET` | `/api/notices?state=&limit=&offset=` | `endpoints:tasks:read` | List notices, newest first (`limit` 1 to 100, default 25; `offset` 0 or more, default 0). Optional `state` (`pending`, `sent`, `not_delivered`, `overridden`, `skipped`; anything else is 400). Each item adds `run_tag` and `held_tasks` (its pending tasks) |
| `POST` | `/api/notices/:id/release` | `endpoints:tasks:create` | Release a pending notice without delivery. Body: `{ "reason": "..." }` (required). Returns 400 if the notice is no longer pending |

**Settings body (`PUT /api/notices/settings`):** all fields are optional.

```json
{
  "enabled": true,
  "recipients": ["secops@example.com"],
  "lead_minutes": 5,
  "max_wait_minutes": 60,
  "pickup_window_minutes": 120,
  "send_finished": true,
  "advance_digest_enabled": true,
  "digest_timezone": "America/Santo_Domingo"
}
```

`lead_minutes` is clamped to 0 to 5, `max_wait_minutes` to 15 to 1440, and `pickup_window_minutes` to 30 to 1440. Recipients must be bare email addresses. `advance_digest_enabled` (default `false`) turns on the daily [advance digest](../user-guide/integrations/pre-execution-notices#advance-digest), sent at 09:00 in `digest_timezone` (an IANA name, default `UTC`).

**Test notice response (`POST /api/notices/settings/test`):**

```json
{
  "success": true,
  "data": {
    "accepted": ["secops@example.com"],
    "rejected": [],
    "fully_accepted": true
  }
}
```

The grouped task list response (`GET /api/agent/admin/tasks/grouped`) adds a `notices` map (notice id to `run_tag`, `state`, `last_error`, `release_at`, `pickup_deadline`) on each batch group whose tasks are linked to notices. For a caller in an organization, the map only lists that organization's notices.

`GET /api/notices/status` returns `smtpCheck` as `{ "ok": null, "at": null, "message": null }` while notices are disabled. `pendingOverdue` and `notDeliveredLast7d` are always counted.

**Delivery details need `integrations:read`.** `GET /api/notices/status`, `GET /api/notices` and the grouped task list's `notices` map (`GET /api/agent/admin/tasks/grouped`) are readable with `endpoints:tasks:read`. Recipient addresses and mail-server text are only returned to callers who also have `integrations:read`. Everyone else gets the same response with those details removed:
- the list items have no `recipients` field;
- `last_error` (in the list and in the grouped task list's `notices` map) and `digests[].lastError` become a count such as `2 recipients rejected` or `1 recipient not accepted`, or `delivery failed`;
- `smtpCheck.message` is `SMTP check failed` when the check failed, otherwise `null`.

Counts and states are unchanged.

The response also has a `digests` array, always present: the latest advance digest per organization in scope from the last 7 days.

```json
{
  "digests": [
    {
      "orgId": "org_123",
      "digestDate": "2026-10-27",
      "runDate": "2026-10-28",
      "state": "sent",
      "occurrenceCount": 3,
      "hostCount": 12,
      "recipientCount": 2,
      "sentAt": "2026-10-27T13:00:04.000Z",
      "lastError": null
    }
  ]
}
```

`digestDate` is the day the digest was sent and `runDate` the day it covers, both in the digest timezone. `state` is `sending`, `sent`, `empty` (nothing scheduled) or `failed`; `lastError` is set when a send failed or some recipients were rejected.

### Several tests under one notice

```
POST /api/agent/admin/tasks/batch
```

Creates the tasks for several tests as one run, under **one** pre-execution notice (one email), instead of one notice per test. The test browser uses it when you run more than one test at once. Requires `endpoints:tasks:create`.

```json
{
  "org_id": "default",
  "requests": [
    { "agent_ids": ["agent-uuid-1"], "test_uuid": "test-uuid-a", "test_name": "Test A", "binary_name": "a.exe" },
    { "agent_ids": ["agent-uuid-1", "agent-uuid-2"], "test_uuid": "test-uuid-b", "test_name": "Test B", "binary_name": "b.exe" }
  ]
}
```

Each entry in `requests` takes the same fields as `POST /api/agent/admin/tasks`, without `org_id`. Send 1 to 50 requests. The batch is all-or-nothing: if any request fails (for example, a test has no build for an agent's OS), nothing is created and no notice is sent. The response is `201` with the task ids of each request, in request order:

```json
{ "success": true, "data": { "task_ids": [["task-1"], ["task-2", "task-3"]] } }
```

This route works whether or not notices are enabled.
