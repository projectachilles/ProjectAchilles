---
sidebar_position: 8
title: "SentinelOne Auto-Resolve"
description: "Resolve Achilles-matched SentinelOne threats and detection alerts automatically, and optionally kill or quarantine threats SentinelOne left unmitigated."
---

# SentinelOne Auto-Resolve and Automatic Mitigation

The [SentinelOne integration](./sentinelone) has two opt-in passes that write
to the SentinelOne console. Both are off by default and both need the
integration in **Response** permission mode.

- **Auto-resolve** sets the incident status of threats and detection alerts
  that Achilles matched to one of its own tests to `resolved`, so
  continuous-validation activity doesn't fill your SOC queue.
- **Automatic mitigation** kills or quarantines threats that SentinelOne
  detected but left unmitigated (for example because the policy is in detect
  mode), when they were matched to an Achilles test.

| Pass | Direction | Permission mode | Default |
|------|-----------|-----------------|---------|
| Alert ingest | SentinelOne API → ES | Read-only or Response | On once credentials are set |
| Evidence correlation | ES ↔ ES | None | Automatic |
| **Auto-resolve** | ES → SentinelOne API | Response (for `enabled`) | **Opt-in, disabled** |
| **Automatic mitigation** | ES → SentinelOne API | Response (for `dry_run` and `enabled`) | **Opt-in, disabled** |

Ingest and correlation are read-only. You can run the integration in read-only
mode indefinitely and never give Achilles write access.

## When the passes run

Every SentinelOne sync runs these steps in order:

1. Poll threats and detection alerts.
2. Enrichment: match alerts to Achilles test results and mark the matched
   alerts with `f0rtika.achilles_correlated: true` and
   `f0rtika.achilles_test_uuid`.
3. Automatic mitigation. It runs first because it only acts on unresolved
   threats.
4. Auto-resolve.

Syncs start every `poll_interval_minutes` (default 5) and on **Sync Now**.

## Required SentinelOne role

| Mode | Role for the API token's service user |
|------|---------------------------------------|
| Read-only | **Viewer** (or higher) in the configured scope |
| Response | A role that can change threat and alert incident status and mitigate threats, e.g. **IR Team** or **SOC** |

The permission mode is set in **Settings → Integrations → SentinelOne**
(`permission_mode`) or with `SENTINELONE_PERMISSION_MODE=response` when the
credentials come from environment variables. In read-only mode the API client
refuses every non-`GET` request before it is sent. In Response mode it sends
only the five write requests listed on this page.

## Auto-resolve

### Modes

| Mode | Effect |
|------|--------|
| `disabled` (default) | No queries, no SentinelOne calls. |
| `dry_run` | Finds candidates, checks their live status in SentinelOne (read-only `GET`), logs `[SentinelOne-AutoResolve-DryRun] would_resolve ...` and writes a receipt with `mode=dry_run`. Changes nothing in SentinelOne. Allowed in read-only mode. |
| `enabled` | Resolves each candidate in SentinelOne and writes a receipt with `mode=enabled`. Requires Response mode: the settings layer refuses `enabled` otherwise. |

A dry-run receipt doesn't block a later real run: switching from `dry_run` to
`enabled` processes the same alerts again.

### Which alerts are eligible

An alert is a candidate only when **all** of these hold:

| Condition | Why |
|-----------|-----|
| `f0rtika.achilles_correlated == true` and `f0rtika.achilles_test_uuid` is set | The enrichment pass tied the alert to an Achilles test. |
| Local `status == "unresolved"` | Nobody has started working on it. |
| Inside the configured account / site / group scope | Achilles never writes outside the scope you configured. An alert without the scoped id doesn't match. |
| No receipt from the current mode | It hasn't been handled already. |

Candidates are taken oldest match first. Alerts that were already correlated
and are still unresolved when you turn the pass on are processed too, a batch
at a time.

:::info Live status check (fails closed)
The local status can be stale: detection alerts are re-synced only by
creation time, so a status change in the console may not reach Elasticsearch.
Before acting, every pass re-reads each candidate's **current** incident status
from SentinelOne (one `GET /threats` and one `GET /cloud-detection/alerts`
call by id). A candidate is resolved only when the console still reports it as
`unresolved`.

- A candidate the console reports as `in_progress`, `resolved` or anything
  else is skipped, and its local status is updated so it stops being a
  candidate.
- If the console doesn't return the alert at all (purged, deleted, outside
  the token's scope), it gets a `not_found` receipt so it stops taking a slot
  in the oldest-first queue.
- If the lookup itself fails, nothing is concluded: the candidate is skipped
  and retried on the next pass.

Turning auto-resolve on never touches an alert an analyst has already picked
up.
:::

### What it writes

| Record type | Request | Body |
|-------------|---------|------|
| Threat | `POST /web/api/v2.1/threats/incident` | `incidentStatus: resolved` |
| Threat | `POST /web/api/v2.1/threats/notes` (best effort) | A note naming the test |
| Detection alert | `POST /web/api/v2.1/cloud-detection/alerts/incident` | `incidentStatus: resolved` |

The threat note reads:

> Achilles test `<test-uuid>` — authorized continuous validation. Incident
> resolved automatically by Project Achilles (no verdict or mitigation
> changed).

If the note fails, the threat is still resolved and the failure is only
logged. Detection alerts get no note.

Auto-resolve **never** sets an analyst verdict (Achilles tests run real
techniques; the verdict stays your analysts' call) and **never** kills,
quarantines, remediates or isolates anything.

### Receipts

Each processed alert document in `achilles-sentinelone` gets:

| Field | Description |
|-------|-------------|
| `f0rtika.auto_resolved` | `true` on every receipt, including dry-run and error receipts |
| `f0rtika.auto_resolved_at` | When the pass processed the alert |
| `f0rtika.auto_resolve_mode` | `dry_run` or `enabled` |
| `f0rtika.auto_resolve_error` | `not_found` (SentinelOne returned 404), `not_applied` (SentinelOne accepted the request but changed nothing) or `invalid_id` (the stored id is not a numeric SentinelOne id) |

A successful real resolve also sets the document's `status` to `resolved` and
its `resolved_at`. The alert feed's "auto-resolved" count includes only
`enabled` receipts without an error.

### Limits and errors

- At most **30 candidates** per pass, and the pass stops starting new writes
  after 30 seconds.
- `401` or `403` from SentinelOne halts the pass. Nothing more is attempted
  until the next sync.
- `404` writes a receipt with `auto_resolve_error: not_found`, so that alert is
  never retried in `enabled` mode.
- A `200` response that reports `affected: 0` (for example an id outside the
  token's scope) is not counted as resolved: it writes a receipt with
  `auto_resolve_error: not_applied`, adds no note and leaves the local status
  as it was. That alert is not retried in `enabled` mode.
- A stored id that is not a numeric SentinelOne id is skipped with an
  `invalid_id` receipt in the current mode, because it would fail the same way
  on every pass. Nothing is sent for it.
- Any other error (timeouts, `5xx` after the client's retries) writes no
  receipt, so the alert is retried on the next pass.
- If the mode is `enabled` but the integration is read-only, the pass writes
  nothing and reports `auto-resolve is enabled but the integration is
  read-only` (see [Troubleshooting](#auto-resolve-is-enabled-but-the-integration-is-read-only)).

## Automatic mitigation

:::danger This acts on real endpoints
When enabled, every sync kills or quarantines matching threats on the hosts
where they were found, without asking. A wrong match stops a real process. Run
it in dry-run first and check the receipts.
:::

### Modes and action

| Setting | Values |
|---------|--------|
| Mode | `disabled` (default), `dry_run` (run the live check below, log `[SentinelOne-AutoMitigation-DryRun] would_<action> ...` and write a receipt; nothing is written to SentinelOne), `enabled` |
| Action | `kill` (stop the process, default) or `quarantine` (stop and move the file) |

Remediate, rollback and network isolation are never automatic, and there are
no manual response-action routes.

Any mode other than `disabled` needs Response mode. The backend refuses to
turn it on otherwise, reads it as `disabled` whenever the integration is not in
Response mode, and switches it to `disabled` when you save the integration in
read-only mode. In the UI, choosing **Enabled** asks for an explicit
acknowledgement before it is saved.

### Which threats are eligible

A threat is a candidate only when **all** of these hold:

| Condition | Why |
|-----------|-----|
| It is a threat (`source_type: threats`) | Detection alerts have no mitigation endpoint and are never touched. |
| `f0rtika.achilles_correlated == true` and `f0rtika.achilles_test_uuid` is set | The enrichment pass matched it to an Achilles test, so the file is the Achilles test binary, not something found in the wild. |
| `mitigation_status == "not_mitigated"` and no `prevention_action` | SentinelOne itself did not stop it. |
| Incident status `unresolved` | Nobody is working on it. |
| Inside the configured account / site / group scope | Never outside your scope. |
| No receipt from the current mode | Not handled before. |

:::info Live check before acting (fails closed)
The local copy is only as fresh as the last poll, so before acting the pass
re-reads every candidate from the console (one `GET /threats?ids=...` call). A
threat is mitigated only when SentinelOne still reports it as `unresolved`,
`not_mitigated`, and with no mitigation recorded in its mitigation report
(no successful or failed kill, quarantine or remediate). Anything else, a
failed lookup (reported as `live status: ...`) is skipped and nothing is
mitigated for it; those are checked again on the next pass. A threat the
console no longer returns at all gets a `not_found` receipt, so it can't block
the oldest-first queue.
:::

### What it writes

```
POST /web/api/v2.1/threats/mitigate/kill         (or /quarantine)
{ "filter": { "ids": ["<threat-id>"] }, "data": {} }
```

One request per threat, at most **10 threats** per pass and 30 seconds of
work. The receipt (below) is written **before** the request, because it is
what keeps the kill from counting as SentinelOne prevention: if that write
fails, the threat is not mitigated. `401` / `403` halts the pass and clears
the receipt; `404` keeps a skip-forever receipt with
`auto_mitigation_error: not_found`; other errors clear the receipt, so the
threat is retried next pass.

### Receipts and audit

Each processed threat document gets `f0rtika.auto_mitigated: true`,
`f0rtika.auto_mitigated_at`, `f0rtika.auto_mitigation_mode`,
`f0rtika.auto_mitigation_action` and, on a 404, `f0rtika.auto_mitigation_error`.

Every real attempt (success, refused by the permission boundary, or failed at
the API) is also written as a `doc_type: response_action` document in
`achilles-sentinelone` with `requested_by: achilles-auto-mitigation`, and is
logged as `[SentinelOne-Response] ...`. The settings card lists it under
**Mitigation audit**, and the API serves it at
`GET /api/integrations/sentinelone/actions/history`.

## Defense Score and coverage

:::warning Defense Score invariant
**Neither pass changes the [Defense Score](../analytics/defense-score).** Both
write only to alert documents in `achilles-sentinelone` and to the console.
Test documents in `achilles-results-*` stay byte-identical whether the passes
are disabled or enabled. If enabling either one changes the Defense Score,
that is a bug worth reporting.
:::

Automatic mitigation is **never credited as a SentinelOne prevention.** After
Achilles kills or quarantines a threat, the next sync records that action on
the threat. The enrichment pass ignores the prevention action of any alert
with an `enabled`, error-free automatic-mitigation receipt, so
`f0rtika.sentinelone_prevented` and the Technique Coverage "prevented" count
only reflect what SentinelOne stopped itself. The threat still counts as
**detected**, because SentinelOne did raise it.

The Analytics tab applies the same rule: in the alert feed rows, the
Prevented / Detected only counts and the **Agent response** tile, a threat
Achilles mitigated counts as **detected only**, not prevented.

## Setup walkthrough

### 1. Give the service user a Response role

In the SentinelOne console, give the API token's service user a role that can
change incident status and mitigate threats (e.g. IR Team or SOC) in the scope
Achilles uses. Viewer is enough until you enable a write pass.

### 2. Switch the integration to Response mode

1. Open **Settings → Integrations → SentinelOne**.
2. Set **Permission mode** to **Response** and click **Update Settings**.

Both passes stay off after this step.

### 3. Turn on auto-resolve in dry-run

1. Expand **Alert auto-resolution**.
2. Select **Dry-run**.

Dry-run also works in read-only mode, so you can do this before step 2.
Within one sync you should see `[SentinelOne-AutoResolve-DryRun]` lines in the
backend log and rows in the **receipts** table marked `dry_run`. Each row names
the alert, its type (Threat / Detection alert) and the Achilles test.

### 4. Audit for a few days

- **Look for false matches**: a receipt for an alert you consider a real,
  non-Achilles detection. Report it with the alert id and test UUID so the
  correlation can be tightened.
- **Check the counts** in the 24h / 7d / 30d strip against your test volume.
  Zero receipts after a day of tests usually means correlation found no
  matches (see [Troubleshooting](#troubleshooting)).

### 5. Enable auto-resolve

Select **Enabled**. The next sync resolves matched, unresolved alerts in
SentinelOne. Threats resolved this way carry the Achilles note.

### 6. Optional: automatic mitigation

1. Expand **Automatic mitigation** and choose the **Action** (`kill` or
   `quarantine`).
2. Select **Dry-run** and check its receipts for a few days.
3. Select **Enabled**, tick the acknowledgement and click **Enable automatic
   mitigation**.

## Verifying it works

**In the SentinelOne console**: filter threats and alerts by incident status
`Resolved`. Auto-resolved threats carry the note naming the Achilles test.

**From the API:**

```bash
# Mode, permission mode, receipt counts and the last pass result
curl -H "Authorization: Bearer $CLERK_JWT" \
  https://<backend>/api/integrations/sentinelone/auto-resolve/status

# Recent receipts
curl -H "Authorization: Bearer $CLERK_JWT" \
  "https://<backend>/api/integrations/sentinelone/auto-resolve/receipts?limit=20"

# Automatic mitigation status and audit trail
curl -H "Authorization: Bearer $CLERK_JWT" \
  https://<backend>/api/integrations/sentinelone/auto-mitigation/status
curl -H "Authorization: Bearer $CLERK_JWT" \
  https://<backend>/api/integrations/sentinelone/actions/history
```

The last pass result (`lastAutoResolve` / `lastAutoMitigation`) is held in
memory and is `null` after a backend restart until the next sync.

## Troubleshooting

### "Enabled" is greyed out

Auto-resolve `enabled` and every automatic-mitigation mode need the
integration saved in Response mode. Switch the permission mode and save first.
The API returns `400` with the same reason.

### 401 or 403 on the first write

**Symptom:** the pass result lists `401: ...` or `403: ...` and stops.

**Cause:** the token is expired or revoked (401), or the service user's role
can't change incident status or mitigate threats in this scope (403).

**Fix:** renew the token or give the user a Response role (see
[step 1](#1-give-the-service-user-a-response-role)). The pass stops at the
first 401 / 403, so nothing else is attempted until the next sync.

### "auto-resolve is enabled but the integration is read-only"

Saving the integration in read-only mode turns auto-resolve `enabled` into
`disabled` (a `dry_run` mode is kept) and switches automatic mitigation off, so
this message doesn't follow a save in the UI.

It can still appear when the credentials come from environment variables: the
modes are then stored separately from the credentials, and changing
`SENTINELONE_PERMISSION_MODE` from `response` to `read_only` (or removing it)
involves no save, so a stored `enabled` mode stays. Automatic mitigation reads
as off in that case; auto-resolve writes nothing and reports this error on
every pass. Set `SENTINELONE_PERMISSION_MODE=response` again, or set
auto-resolve to `dry_run` or `disabled`.

### A receipt shows `not_found`

The alert or threat no longer exists in SentinelOne. No action needed: the
receipt stops Achilles from retrying it.

### A receipt shows `not_applied`

SentinelOne accepted the resolve request but reported that it changed nothing,
most often because the alert is outside what the token's scope can modify. The
alert was not resolved and is not retried in `enabled` mode. Check the service
user's scope and role, and resolve the alert by hand if needed.

### A receipt shows `invalid_id`

The stored alert has an id that isn't a numeric SentinelOne id, so Achilles
never sends it. The receipt keeps the pass from retrying it. Report it if you
see it, with the alert document.

### Matched alerts are skipped

The live status check skips any candidate the console no longer reports as
`unresolved`, and any candidate it couldn't look up. A lookup failure shows in
the pass errors as `live status (threats): ...` or `live status (alerts): ...`
and is retried on the next pass.

Automatic mitigation does the same check for threats: one that is no longer
unresolved and unmitigated in the console is skipped, and a failed lookup shows
as `live status: ...` and mitigates nothing in that pass.

### Dry-run but no receipts appear

1. Check `[SentinelOne-Enrichment] ... alertsCorrelated=N` in the backend log.
   If N stays 0, the enrichment pass isn't matching alerts to tests: check that
   tests are running on SentinelOne-managed hosts and that their binaries show
   up in the alerts' file names.
2. Check that the alerts are inside the configured scope and still
   `unresolved` locally.

## API reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/integrations/sentinelone/auto-resolve/status` | Mode, permission mode, receipt counts, last pass |
| `PUT` | `/api/integrations/sentinelone/auto-resolve/mode` | Set mode (`disabled` / `dry_run` / `enabled`) |
| `GET` | `/api/integrations/sentinelone/auto-resolve/receipts?limit=&offset=` | Paginated receipts |
| `GET` | `/api/integrations/sentinelone/auto-mitigation/status` | Mode, action, permission mode, receipt counts, last pass |
| `PUT` | `/api/integrations/sentinelone/auto-mitigation` | Set `mode` and/or `action` (`kill` / `quarantine`) |
| `GET` | `/api/integrations/sentinelone/auto-mitigation/receipts?limit=&offset=` | Paginated receipts |
| `GET` | `/api/integrations/sentinelone/actions/history?limit=` | Mitigation audit trail |

See [SentinelOne API endpoints](../../api-reference/sentinelone) for the full
surface.
