---
sidebar_position: 10
title: "Sophos Auto-Resolve"
description: "Acknowledge Achilles-matched Sophos alerts and resolve matched XDR detections automatically, so continuous-validation activity doesn't fill your SOC queue."
---

# Sophos Auto-Resolve

The [Sophos integration](./sophos) has one opt-in pass that writes to Sophos
Central. It is off by default and needs the integration in **Response**
permission mode (dry run works in read-only mode).

**Auto-resolve** closes the Sophos alerts and XDR detections that Achilles
matched to one of its own tests, so continuous-validation activity doesn't fill
your SOC queue:

| Record | What Achilles sends |
|--------|---------------------|
| Common Alert | `POST /common/v1/alerts/{id}/actions` with `action: acknowledge` |
| XDR detection | GraphQL mutation `detectionUpdateResolutionInfo` with `resolution_status: TRUE_POSITIVE_BENIGN` |

Both carry the reason `ProjectAchilles security test <bundle-uuid> on <host>
(auto-resolve)`.

| Pass | Direction | Permission mode | Default |
|------|-----------|-----------------|---------|
| Ingest | Sophos API to Elasticsearch | Read-only or Response | On once credentials are set |
| Evidence correlation | Elasticsearch only | None | Automatic |
| **Auto-resolve** | Elasticsearch to Sophos API | Response (for `enabled`) | **Opt-in, disabled** |

Ingest and correlation are read-only. You can run the integration read-only
forever and never give Achilles write access.

:::danger[What it never does]
Auto-resolve never sends `authPua` (it would allow-list a PUA on every
computer), never cleans or quarantines anything (`cleanVirus`, `cleanPua`,
`clearThreat`, `clearHmpa`), never isolates, scans or sends a message to an
endpoint, and never touches tamper protection. The client refuses those
requests locally: in Response mode it will send only the two writes above.
:::

## Required Sophos role

| Mode | Role for the API credential |
|------|-----------------------------|
| Read-only | **Service Principal Read-Only** |
| Response | **Service Principal Management** (or **Super Admin**): a role that may acknowledge alerts and resolve detections |

A `403` halts the pass and names the role needed. The permission mode is set in
**Settings → Integrations → Sophos**, or with `SOPHOS_PERMISSION_MODE=response`
when the credentials come from environment variables.

:::note[Pending validation]
Exactly which Sophos roles may acknowledge alerts and resolve XDR detections is
still being confirmed on a proof-of-concept tenant (Service Principal
Management (or Super Admin) is the expectation). Treat the table as the safe
choice, and use the `403` message as the final word.
:::

## When the pass runs

Every Sophos sync runs, in order: poll the sources, correlate with test
results (marking matched alerts `f0rtika.achilles_correlated: true` and
`f0rtika.achilles_test_uuid`), check for an EDR-killed agent, then
auto-resolve. Syncs start every polling interval (default 5 minutes) and on
**Sync now**.

## Modes

| Mode | Effect |
|------|--------|
| `disabled` (default) | No queries, no Sophos calls. |
| `dry_run` | Finds candidates, re-reads their live state from Sophos (read-only), logs `[Sophos-AutoResolve-DryRun] would_resolve ...` and records a **Would resolve** receipt. Changes nothing in Sophos. Allowed in read-only mode. |
| `enabled` | Acknowledges or resolves each candidate and records a receipt. Requires Response mode: saving the integration in read-only mode turns `enabled` into `disabled` (a dry run is kept), and the API refuses `enabled` in read-only mode with `400`. |

A dry-run receipt **never blocks a later real resolve**: dry runs are recorded
separately and never mark the alert as resolved, so switching from `dry_run` to
`enabled` processes the same alerts. The status counts show real resolutions
and dry-run receipts separately.

## Which alerts are eligible

An alert or detection is a candidate only when **all** of these hold:

| Condition | Why |
|-----------|-----|
| It is a Common Alert or an XDR detection, and `f0rtika.achilles_correlated` is true with an Achilles test UUID | The correlation pass tied it to a test. |
| It is still open locally | Not acknowledged or resolved already. |
| It isn't an EDR-killed-agent alert | Those stay open for your SOC. |
| No receipt for the current mode | It hasn't been handled already. |

SIEM-only rows are never candidates (there is no Sophos object to resolve) and
detections that came from the REST v1 fallback aren't auto-resolved either.
Candidates are taken oldest match first.

:::info[Live status check (fails closed)]
The local copy can be stale. Before acting, every pass re-reads each candidate
from Sophos: a Common Alert is acted on only if it still exists and its
`allowedActions` still include `acknowledge`; an XDR detection only if its
status is still `OPEN`.

- Anything else is skipped, and a local status is mirrored when Sophos says
  the detection is no longer open.
- If Sophos no longer returns the item, it gets a `not_found` receipt so it
  stops taking a slot in the queue.
- If the lookup itself fails, nothing is concluded; the candidate is retried on
  the next pass.

Turning auto-resolve on never touches an alert an analyst already picked up.
:::

## Limits and errors

- At most **30 candidates** per pass, and no new write starts after 30 seconds.
- A `401` or `403` halts the pass; nothing more is attempted until the next
  sync. The error names the role needed.
- A `404` writes a `not_found` receipt, so the item isn't retried.
- A stored id that isn't a valid Sophos id is skipped with an `invalid_id`
  receipt; nothing is sent for it.
- Any other error (timeouts, `5xx` after the client's retries) writes no
  receipt, so the item is retried next pass.
- Achilles stays within its 50 requests per minute share of the tenant's API
  budget.

## Receipts

Each processed alert document in `achilles-sophos` gets:

| Field | Description |
|-------|-------------|
| `f0rtika.auto_resolved` | `true` on a real pass (including skip receipts such as `not_found`). Never set by a dry run. |
| `f0rtika.auto_resolved_at` | When the pass processed it |
| `f0rtika.auto_resolve_dry_run_at` | Dry-run receipt time |
| `f0rtika.auto_resolve_mode` | `dry_run` or `enabled` |
| `f0rtika.auto_resolve_error` | `not_found`, `not_actionable` (Sophos no longer offers the action) or `invalid_id` |

A successful real resolve also sets the document's `status` (`acknowledged` for
alerts, `resolved` for detections). Receipts live on the alert document only:
**test documents and the Defense Score are never touched**, whether auto-resolve
is disabled or enabled.

:::note[Acknowledged alerts leave Sophos' list]
Once an alert is acknowledged it disappears from Sophos' alert list. Achilles
keeps its own copy, so it stays in the Sophos tab and in your history.
:::

## Setup walkthrough

1. **Give the credential a Response role.** In Sophos Central give the API
   credential Service Principal Management (or Super Admin) rights. Read-Only is enough until you
   enable a write.
2. **Switch the integration to Response mode.** **Settings → Integrations →
   Sophos**, set **Permission mode** to **Response** and click **Update Settings**. Auto-resolve stays
   off.
3. **Turn on dry run.** Expand **Alert auto-resolution** and choose **Dry run**
   (this also works in read-only mode). Within one sync you should see
   `[Sophos-AutoResolve-DryRun]` lines in the backend log and **Would resolve**
   rows in the receipts table.
4. **Audit for a few days.** Look for a receipt on an alert you consider a
   real, non-Achilles detection and report it with the alert id and test UUID.
   Compare the counts with your test volume; zero receipts after a day of tests
   usually means correlation found no matches.
5. **Enable.** Choose **Enabled**. The next sync acknowledges the matched, open
   alerts.

## Verifying it works

In Sophos Central, an acknowledged alert is gone from the alert list. The
reason text names the Achilles test.

```bash
# Mode, permission mode, receipt counts and the last pass result
curl -H "Authorization: Bearer $CLERK_JWT" \
  https://<backend>/api/integrations/sophos/auto-resolve/status

# Recent receipts (real and dry run)
curl -H "Authorization: Bearer $CLERK_JWT" \
  "https://<backend>/api/integrations/sophos/auto-resolve/receipts?limit=20"
```

The last pass result (`lastAutoResolve`) is held in memory and is `null` after
a backend restart until the next sync.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| "Enabled" is refused or greyed out | The integration isn't saved in Response mode. Switch the permission mode and save first. |
| Pass stops with `403 ... Management role` | The credential's role can't acknowledge or resolve. Give it Service Principal Management or Super Admin in Sophos Central. |
| `auto-resolve is enabled but the integration is read-only` | Credentials come from env vars and `SOPHOS_PERMISSION_MODE` isn't `response`. Set it, or use `dry_run`. |
| Receipts show `not_found` | The item no longer exists in Sophos (purged or already handled). No action needed. |
| Receipts show `not_actionable` | Sophos no longer offers the acknowledge action for it. No action needed. |
| Dry run but no receipts | Check `[Sophos-Enrichment] ... alertsCorrelated=N` in the backend log. If it stays 0 the correlation isn't matching alerts to tests: check the tests run on Sophos-managed hosts. |
| Save and **Sync now** return 403 | `REQUIRE_ORG_ISOLATION=true`: the shared Sophos configuration is read-only from the UI. Use the `SOPHOS_*` env vars. |

## API reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/integrations/sophos/auto-resolve/status` | Mode, permission mode, receipt counts (real and dry run), last pass |
| `PUT` | `/api/integrations/sophos/auto-resolve/mode` | Set mode (`disabled` / `dry_run` / `enabled`) |
| `GET` | `/api/integrations/sophos/auto-resolve/receipts?limit=&offset=` | Paginated receipts |

See [Sophos API endpoints](../../api-reference/sophos) for the full surface.
