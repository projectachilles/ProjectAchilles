---
sidebar_position: 4
title: "Defender Auto-Resolve"
description: "Programmatically resolve Achilles-correlated alerts in Microsoft Defender so continuous-validation activity doesn't flood the SOC queue."
---

# Defender Auto-Resolve

Auto-resolve is the **third pillar** of the [Microsoft Defender
integration](./microsoft-defender). It reads Achilles-correlated alerts from
Elasticsearch and PATCHes them in Microsoft Defender to `status=resolved` with
a `securityTesting` determination — so continuous-validation activity doesn't
flood your SOC queue with alerts that are expected and authorized.

| Pillar | Direction | Graph permission | Default |
|--------|-----------|------------------|---------|
| 1. Analytics ingest | Graph → ES | `SecurityAlert.Read.All` | On once credentials are set |
| 2. Evidence correlation | ES ↔ ES | None extra | Automatic |
| 3. **Auto-resolve** | ES → Graph | `SecurityAlert.ReadWrite.All` | **Opt-in, disabled by default** |

Pillars 1 and 2 are read-only. Auto-resolve is the first **write** pillar —
enabling it requires a separate permission grant, so you can run the read-only
integration indefinitely without ever granting write access.

## Operational Modes

Auto-resolve has three modes, selected from the UI or API:

| Mode | Effect |
|------|--------|
| `disabled` (default) | No ES queries, no Graph calls. The feature is dormant. |
| `dry_run` | Computes candidates, logs `[Defender-AutoResolve-DryRun]`, and writes a receipt with `mode=dry_run`. **Does not call Microsoft Graph.** Run this for 7+ days to audit correlation quality before going live. |
| `enabled` | PATCHes the correlated alert in Defender to `status=resolved`, `classification=informationalExpectedActivity`, `determination=securityTesting`, with an audit-trail comment naming the Achilles test UUID. |

Receipts are written in both `dry_run` and `enabled` modes so the same
candidate isn't reprocessed on every sync cycle.

## Which Alerts Are Eligible

An alert is a candidate only when **all** of these hold:

| Condition | Why |
|-----------|-----|
| `f0rtika.achilles_correlated == true` | The enrichment pass tied the alert to an Achilles test execution. |
| `status == "new"` | Defender hasn't acted on the alert, and no human has acknowledged it. |
| `f0rtika.auto_resolved != true` | The alert hasn't already been processed by a previous pass (idempotency). |

:::info Fail-closed by design
The candidate query is a **whitelist** on `status: "new"`, not a denylist on
`status: "resolved"`. Alerts that are `inProgress` (a SOC analyst is actively
triaging) or `resolved` (already closed) are left untouched, and any *future*
status value Defender introduces is automatically excluded until the policy is
updated. Turning auto-resolve on never disrupts in-flight SOC work, and
historical alerts your team already triaged stay exactly as they were left.
:::

## Setup Walkthrough

### 1. Grant the write scope in Azure AD

Auto-resolve needs `SecurityAlert.ReadWrite.All` in addition to the read-only
scope you granted for pillar 1.

1. Open [Azure portal → App registrations](https://portal.azure.com) and select
   the app you use for Achilles → Defender.
2. **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Application permissions** → search for `SecurityAlert.ReadWrite.All`.
3. Click **Grant admin consent** for your tenant.
4. Confirm the permission shows **Granted** (green check).

No restart or redeploy is needed — the existing OAuth2 client picks up the new
scope the next time it refreshes its token (within ~5 minutes).

### 2. Enable dry-run mode

1. Open **Settings → Integrations → Microsoft Defender**.
2. Expand **Alert auto-resolution**.
3. Select **Dry-run**.

Within one sync cycle (~5 minutes) you should see `[Defender-AutoResolve-DryRun]`
entries in the backend logs and rows in the **Recent receipts** table marked
`mode=dry_run`. Each receipt names the alert and the Achilles test UUID that
triggered it.

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
PATCHing correlated alerts. In the Defender portal, resolved alerts appear
with:

- **Classification**: Informational — expected activity
- **Determination**: Security testing
- **Resolution comment**: naming the Achilles bundle UUID

## Verifying It Works

**In the Defender portal** — filter alerts by classification
`Informational - expected activity`; each should carry the security-testing
determination and a comment naming a bundle UUID.

**From the API:**

```bash
# Status + recent counts
curl -H "Authorization: Bearer $CLERK_JWT" \
  https://<backend>/api/integrations/defender/auto-resolve/status

# Recent receipts
curl -H "Authorization: Bearer $CLERK_JWT" \
  "https://<backend>/api/integrations/defender/auto-resolve/receipts?limit=20"
```

## Cadence & Safety Limits

- Auto-resolve runs after every Defender enrichment pass — every 5 minutes on
  Docker / Render / Fly.io, and on each Vercel Cron tick on Vercel.
- Each pass is capped at **30 PATCHes** to protect the tenant from Graph API
  rate-limiting.
- A `403` halts the pass cleanly (no error spam); a `404` writes a
  skip-forever receipt; transient errors skip the receipt so the next pass
  retries.

:::warning Defense Score invariant
**Auto-resolve never changes the [Defense Score](../analytics/defense-score).**
It operates only on alert documents in the `achilles-defender` index. Test
documents in `achilles-results-*` (which feed the Defense Score) are untouched
— they stay byte-identical whether auto-resolve is disabled or enabled. If you
enable auto-resolve and observe the Defense Score change, that is a bug worth
reporting.
:::

## Troubleshooting

### 403 on the first PATCH

**Symptom:** logs show `[Defender-AutoResolve-ERROR] 403: ... SecurityAlert.ReadWrite.All`.

**Cause:** the Azure AD app has read-only scopes but not the write scope.

**Fix:** follow [Setup step 1](#1-grant-the-write-scope-in-azure-ad) — grant
`SecurityAlert.ReadWrite.All` and admin consent. The pass halts cleanly after
the first 403 rather than spamming errors, so a short interruption is the worst
case.

### 404 on a specific alert

**Symptom:** a receipt shows `auto_resolve_error: not_found`.

**Cause:** the alert was deleted in Defender between correlation and
auto-resolve (rare).

**Fix:** none needed — the receipt prevents Achilles from retrying that alert.

### Dry-run mode but no receipts appear

1. Check `[Defender-Enrichment] alertsMarkedCorrelated=N` in the logs — is N > 0
   on recent cycles? If 0, correlation isn't tagging alerts; verify tests are
   running and their bundle UUIDs appear in Defender alert `evidence_filenames`.
2. If correlation *is* tagging alerts but no auto-resolve receipts appear, open
   an issue — something is off between the correlation pass and the candidate
   query.

### Mode appears reset after a restart

The mode is persisted in the encrypted integrations settings
(`~/.projectachilles/integrations.json` on Docker/Render/Fly; Vercel Blob on
Vercel) and survives restarts and redeploys. If it appears reset, the likely
cause is settings-file corruption or an env-var override — check that
`DEFENDER_TENANT_ID` hasn't unset the file-based entry.

## Non-Goals (v1)

- **No retroactive cleanup** — open alerts from before you enabled auto-resolve
  are ignored. Only alerts correlated going forward are resolved.
- **No incident-level PATCHes** — Defender auto-cascades incident status when
  all child alerts resolve, so v1 only touches individual alerts.
- **No per-customer correlation tuning** — a single correlation policy
  (bundle-UUID prefix + hostname + time window) applies uniformly.

## API Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/integrations/defender/auto-resolve/status` | Current mode + recent receipt counts |
| `PUT` | `/api/integrations/defender/auto-resolve/mode` | Set mode (`disabled` / `dry_run` / `enabled`) |
| `GET` | `/api/integrations/defender/auto-resolve/receipts?limit=&offset=` | Paginated receipt history |

See [Defender API endpoints](../../api-reference/defender) for the full surface.
