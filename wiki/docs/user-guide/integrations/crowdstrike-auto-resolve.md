---
sidebar_position: 6
title: "CrowdStrike Auto-Resolve"
description: "Programmatically close Achilles-correlated alerts in CrowdStrike Falcon so continuous-validation activity doesn't flood the SOC queue."
---

# CrowdStrike Auto-Resolve

Auto-resolve is the **third pillar** of the [CrowdStrike Falcon
integration](./crowdstrike). It reads Achilles-correlated alerts from
Elasticsearch and PATCHes them in CrowdStrike Falcon to `status=closed` with
an appended audit-trail comment naming the Achilles test UUID — so
continuous-validation activity doesn't flood your SOC queue with alerts that
are expected and authorized.

| Pillar | Direction | Falcon API scope | Default |
|--------|-----------|------------------|---------|
| 1. Analytics ingest | Falcon API → ES | `Alerts: read` | On once credentials are set |
| 2. Evidence correlation | ES ↔ ES | None extra | Automatic |
| 3. **Auto-resolve** | ES → Falcon API | `Alerts: write` | **Opt-in, disabled by default** |

Pillars 1 and 2 are read-only. Auto-resolve is the first **write** pillar —
enabling it requires a separate scope grant, so you can run the read-only
integration indefinitely without ever granting write access.

## Operational Modes

Auto-resolve has three modes, selected from the UI or API:

| Mode | Effect |
|------|--------|
| `disabled` (default) | No ES queries, no Falcon API calls. The feature is dormant. |
| `dry_run` | Computes candidates, logs `[CrowdStrike-AutoResolve-DryRun]`, and writes a receipt with `mode=dry_run`. **Does not call the Falcon API.** Run this for 7+ days to audit correlation quality before going live. |
| `enabled` | PATCHes the correlated alert in Falcon to `update_status='closed'` with an appended comment naming the Achilles test UUID. |

Receipts are written in both `dry_run` and `enabled` modes so the same
candidate isn't reprocessed on every sync cycle.


Alerts matched to an EDR-killed agent run (see [Exit Codes & Outcomes](../analytics/exit-codes-and-outcomes#agent-terminated-by-the-edr)) are never auto-resolved.

## Which Alerts Are Eligible

An alert is a candidate only when **all** of these hold:

| Condition | Why |
|-----------|-----|
| `f0rtika.achilles_correlated == true` | The enrichment pass tied the alert to an Achilles test execution. |
| `status == "new"` | Falcon hasn't acted on the alert, and no human has acknowledged it. |
| `f0rtika.auto_resolved != true` | The alert hasn't already been processed by a previous pass (idempotency). |

:::info[Fail-closed by design]
The candidate query is a **whitelist** on `status: "new"`, not a denylist on
`status: "closed"`. Alerts that are `in_progress` or `reopened` (a SOC analyst
is actively triaging) or `closed` (already handled) are left untouched, and
any *future* status value CrowdStrike introduces is automatically excluded
until the policy is updated. Turning auto-resolve on never disrupts in-flight
SOC work, and historical alerts your team already triaged stay exactly as they
were left.
:::

## Setup Walkthrough

### 1. Grant the write scope in the Falcon console

Auto-resolve needs `Alerts: write` in addition to the `Alerts: read` scope you
granted for pillar 1.

1. Open the Falcon console → **Support** → **API Clients and Keys**.
2. Find the API client used for Achilles → CrowdStrike and click **Edit**.
3. Under **API Scopes**, enable **Alerts: write** and save.

No restart or redeploy is needed — the existing OAuth2 client picks up the new
scope the next time it refreshes its token (within ~30 minutes; sooner on the
next 401-driven re-authentication).

### 2. Enable dry-run mode

1. Open **Settings → Integrations → CrowdStrike Falcon**.
2. Expand **Alert auto-resolution**.
3. Select **Dry-run**.

Within one sync cycle (~5 minutes) you should see
`[CrowdStrike-AutoResolve-DryRun]` entries in the backend logs and rows in the
**Recent receipts** table marked `mode=dry_run`. Each receipt names the alert
and the Achilles test UUID that triggered it.

### 3. Audit for 7 days

During the dry-run window:

- **Look for false positives** in the receipts table — an alert marked
  `achilles_correlated` that you consider a real (non-Achilles) detection. If
  any appear, open an issue with the alert ID and matching test UUID so the
  correlation logic can be tightened.
- **Sanity-check counts** in the 24h / 7d / 30d stats strip. If your test
  volume is N bundles/day and you see candidates at 10×N, correlation may be
  too loose; if you see 0 receipts despite a full day of tests, it may be
  missing matches.

### 4. Flip to enabled

Once dry-run looks clean, select **Enabled**. The next sync cycle starts
PATCHing correlated alerts. In the Falcon console, resolved alerts appear
with:

- **Status**: Closed
- **Comment**: "Achilles test `<bundle-uuid>` — authorized continuous
  validation. Closed automatically by Project Achilles."

## How Auto-Resolve Writes to Falcon

Each candidate is closed with a single call:

```
PATCH /alerts/entities/alerts/v3
{
  "composite_ids": ["<alert-composite-id>"],
  "update_status": "closed",
  "append_comment": "Achilles test <uuid> — authorized continuous validation…"
}
```

Two CrowdStrike-specific behaviors are worth knowing:

- **Status + comment only.** Auto-resolve sets `update_status='closed'` and
  appends a comment referencing the Achilles test UUID. It does **not** modify
  tags, assignments, or any other alert field.
- **200-with-errors envelope.** The Falcon API returns HTTP 200 with a
  per-item `errors[]` array and `meta.writes.resources_affected`. Auto-resolve
  inspects the envelope, not just the HTTP status — a candidate whose ID
  appears in `errors[]` gets an error receipt, not a success receipt.

## Verifying It Works

**In the Falcon console** — filter alerts by status `Closed`; auto-resolved
alerts carry the appended comment naming an Achilles bundle UUID.

**From the API:**

```bash
# Status + recent counts
curl -H "Authorization: Bearer $CLERK_JWT" \
  https://<backend>/api/integrations/crowdstrike/auto-resolve/status

# Recent receipts
curl -H "Authorization: Bearer $CLERK_JWT" \
  "https://<backend>/api/integrations/crowdstrike/auto-resolve/receipts?limit=20"
```

## Cadence & Safety Limits

- Auto-resolve runs after every CrowdStrike enrichment pass — every 5 minutes
  on Docker / Render / Fly.io, and on each Vercel Cron tick on Vercel.
- Each pass is capped at **30 PATCHes** to protect the tenant from Falcon API
  rate-limiting.
- A `403` halts the pass cleanly (no error spam); a `404` writes a
  skip-forever receipt; transient errors skip the receipt so the next pass
  retries.

:::warning[Defense Score invariant]
**Auto-resolve never changes the [Defense Score](../analytics/defense-score).**
It operates only on alert documents in the `achilles-crowdstrike` index. Test
documents in `achilles-results-*` (which feed the Defense Score) are untouched
— they stay byte-identical whether auto-resolve is disabled or enabled. If you
enable auto-resolve and observe the Defense Score change, that is a bug worth
reporting.
:::

## Troubleshooting

### 403 on the first PATCH

**Symptom:** logs show `[CrowdStrike-AutoResolve-ERROR] 403: ...`.

**Cause:** the Falcon API client has `Alerts: read` but not `Alerts: write`.

**Fix:** follow [Setup step 1](#1-grant-the-write-scope-in-the-falcon-console)
— add `Alerts: write` to the API client. The pass halts cleanly after the
first 403 rather than spamming errors, so a short interruption is the worst
case.

### 404 on a specific alert

**Symptom:** a receipt shows `auto_resolve_error: not_found`.

**Cause:** the alert was deleted in Falcon between correlation and
auto-resolve (rare).

**Fix:** none needed — the receipt prevents Achilles from retrying that alert.

### Dry-run mode but no receipts appear

1. Check `[CrowdStrike-Enrichment] alertsMarkedCorrelated=N` in the logs — is
   N > 0 on recent cycles? If 0, correlation isn't tagging alerts; verify
   tests are running and their bundle UUIDs appear in CrowdStrike alert
   `evidence_filenames`.
2. If correlation *is* tagging alerts but no auto-resolve receipts appear,
   open an issue — something is off between the correlation pass and the
   candidate query.

### Mode appears reset after a restart

The mode is persisted in the encrypted integrations settings
(`~/.projectachilles/integrations.json` on Docker/Render/Fly; Vercel Blob on
Vercel) and survives restarts and redeploys. If it appears reset, the likely
cause is settings-file corruption or an env-var override — check that
`CROWDSTRIKE_CLIENT_ID` hasn't unset the file-based entry.

## Non-Goals (v1)

- **No retroactive cleanup** — open alerts from before you enabled
  auto-resolve are ignored. Only alerts correlated going forward are resolved.
- **No tag or assignment updates** — auto-resolve writes status + comment
  only; Falcon's detection tagging is untouched.
- **No per-customer correlation tuning** — a single correlation policy
  (bundle-UUID prefix + hostname + time window) applies uniformly.

## API Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/integrations/crowdstrike/auto-resolve/status` | Current mode + recent receipt counts |
| `PUT` | `/api/integrations/crowdstrike/auto-resolve/mode` | Set mode (`disabled` / `dry_run` / `enabled`) |
| `GET` | `/api/integrations/crowdstrike/auto-resolve/receipts?limit=&offset=` | Paginated receipt history |

See [CrowdStrike API endpoints](../../api-reference/crowdstrike) for the full
surface.
