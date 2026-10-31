# CrowdStrike Auto-Resolve

Third pillar of the CrowdStrike Falcon integration. Reads Achilles-correlated alerts from Elasticsearch and PATCHes them in CrowdStrike Falcon to `update_status='closed'` with an appended audit-trail comment naming the Achilles test UUID, so continuous-validation activity doesn't flood your SOC queue with alerts that are expected and authorized.

## The three-pillar mental model

| Pillar | Direction | Falcon API scope | Default |
|---|---|---|---|
| 1. Analytics ingest — ZTA posture score, alerts | Falcon API → ES | `Alerts: read`, `Zero Trust Assessment: read` (optional) | On once credentials are set |
| 2. Evidence correlation — test ↔ alert matching | ES ↔ ES | None extra | Automatic |
| 3. **Auto-resolve** — alert → closed in Falcon | ES → Falcon API | `Alerts: write` | **Opt-in, disabled by default** |

Pillars 1 and 2 are read-only. Pillar 3 is the first write pillar. Enabling it requires a separate scope grant from pillar 1, so customers can run the read-only integration indefinitely without ever granting write access.

## Required API scopes

| Scope | Needed for | Falcon API surface |
|---|---|---|
| `Alerts: read` | Alert sync | `POST /alerts/combined/alerts/v1` (FQL filter, `created_timestamp` sort, after-token pagination) |
| `Alerts: write` | Auto-resolve | `PATCH /alerts/entities/alerts/v3` (`update_status='closed'`, `append_comment`) |
| `Zero Trust Assessment: read` | ZTA posture score (requires **Falcon Insight** licensing) | `GET /zero-trust-assessment/queries/assessments/v1?filter=score:>=0` + `GET /zero-trust-assessment/entities/assessments/v1` |

Scopes are granted on the API client in the Falcon console → **Support** → **API Clients and Keys**. The legacy `/detects/*` endpoints were decommissioned on 2025-09-30 and are not used.

## Operational modes

The auto-resolve pillar has three modes, chosen from the UI or API:

| Mode | Effect |
|---|---|
| `disabled` (default) | No ES queries, no Falcon API calls. Feature is dormant. |
| `dry_run` | Compute candidates, log `[CrowdStrike-AutoResolve-DryRun]`, write a receipt with `mode='dry_run'`. **Does not call the Falcon API.** Use this for 7+ days to audit correlation quality before flipping live. |
| `enabled` | PATCH the correlated alert in Falcon to `update_status='closed'` with an appended comment naming the Achilles test UUID. |

Receipts are written in both `dry_run` and `enabled` modes so the same candidate isn't reprocessed on every 5-minute cycle.

## Which alerts are eligible

An alert is a candidate for auto-resolve only when **all** of these hold:

| Condition | Why |
|---|---|
| `f0rtika.achilles_correlated == true` | The enrichment pass tied the alert to an Achilles test execution (bundle-UUID match in evidence within the time window). |
| `status == "new"` | Falcon hasn't acted on the alert yet, and no human has acknowledged it. |
| `f0rtika.auto_resolved != true` | The alert hasn't already been processed by a previous pass (idempotency). |

Specifically **excluded** from auto-resolve:

- **`status == "closed"`** — already closed by a human or by Falcon workflow. Auto-resolve never reaches into closed alerts, even if it would have classified them differently. The original disposition stands.
- **`status == "in_progress"` or `"reopened"`** — a SOC analyst has acknowledged the alert and is actively triaging it. Auto-resolve respects that acknowledgment and leaves the alert alone.
- **Any future status value CrowdStrike introduces** — fail-closed by default. The candidate query is a *whitelist* on `status: 'new'`, not a denylist on `status: 'closed'`, so any new status is automatically excluded until the policy is updated.

What this means in practice: turning auto-resolve on never disrupts in-flight SOC work, and historical alerts your team has already triaged stay exactly as they were left. The only alerts that get PATCHed are the ones nobody has touched yet — which is precisely the intended target of the feature.

## The write call

Each candidate is closed with a single call — status change and comment in one request:

```
PATCH /alerts/entities/alerts/v3
{
  "composite_ids": ["<alert-composite-id>"],
  "action_parameters": [
    { "name": "update_status", "value": "closed" },
    { "name": "append_comment", "value": "Achilles test <uuid> — authorized continuous validation. Closed automatically by Project Achilles." }
  ]
}
```

**200-with-errors envelope:** the Falcon API returns HTTP 200 with a per-item `errors[]` array and `meta.writes.resources_affected`. Auto-resolve inspects the envelope, not just the HTTP status — a candidate whose ID appears in `errors[]` gets an error receipt, not a success receipt.

## Setup walkthrough

### 1. Grant the write scope in the Falcon console

The auto-resolve pillar needs `Alerts: write` in addition to the `Alerts: read` scope already granted for pillar 1.

1. Open the Falcon console → **Support** → **API Clients and Keys**.
2. Find the API client used for Achilles → CrowdStrike and click **Edit**.
3. Under **API Scopes**, enable **Alerts: write** and save.

No restart or redeploy is needed on the Achilles side — the existing OAuth2 client picks up the new scope the next time it refreshes its token (within ~30 minutes; sooner on the next 401-driven re-authentication).

### 2. Enable dry-run mode

1. Open **Settings → Integrations → CrowdStrike Falcon**.
2. Expand **Alert auto-resolution**.
3. Select **Dry-run**.

Within one sync cycle (~5 minutes), you should see `[CrowdStrike-AutoResolve-DryRun]` entries in backend logs and rows appearing in the **Recent receipts** table marked `mode=dry_run`. Each receipt names the alert and the Achilles test UUID that triggered it.

### 3. Audit for 7 days

During the dry-run window:

- **Look for false positives** in the receipts table. A false positive here means an alert was marked `achilles_correlated` by the enrichment pass that you consider a real (non-Achilles) detection. If any appear, open an issue with the alert ID and matching test UUID so the correlation logic can be tightened.
- **Check counts** in the 24h / 7d / 30d stats strip for sanity — if your test volume is N bundles/day and you're seeing auto-resolve candidates at 10×N, correlation may be too loose; if you're seeing 0 receipts despite a full day of tests, correlation may be missing matches.

### 4. Flip to enabled

Once dry-run looks clean, select **Enabled**. The next sync cycle will start PATCHing correlated alerts in Falcon to `status=closed`.

In the Falcon console, auto-resolved alerts appear with:
- **Status**: Closed
- **Comment**: "Achilles test `<bundle-uuid>` — authorized continuous validation. Closed automatically by Project Achilles."

## How to spot-check it's working

### In the Falcon console

Filter alerts by status `Closed`. Each auto-resolved alert should carry the appended comment naming a bundle UUID.

### From the API

```bash
# Status + recent counts
curl -H "Authorization: Bearer $CLERK_JWT" \
  https://<backend>/api/integrations/crowdstrike/auto-resolve/status

# Recent receipts
curl -H "Authorization: Bearer $CLERK_JWT" \
  "https://<backend>/api/integrations/crowdstrike/auto-resolve/receipts?limit=20"
```

### From Elasticsearch directly

```bash
# Count alerts that carry an auto-resolve receipt in the last 7 days
curl -H "Authorization: ApiKey $ES_API_KEY" \
  "$ES/achilles-crowdstrike/_count" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "bool": {
        "filter": [
          { "term": { "doc_type": "alert" } },
          { "term": { "f0rtika.auto_resolved": true } },
          { "range": { "f0rtika.auto_resolved_at": { "gte": "now-7d" } } }
        ]
      }
    }
  }'
```

## Defense Score invariant

**Auto-resolve never changes the Defense Score.** It operates only on alert documents in the `achilles-crowdstrike` index. Test documents in `achilles-results-*` (which feed the Defense Score) are untouched.

If you enable auto-resolve and observe the Defense Score change, that is a bug worth reporting — it should stay byte-identical before and after.

## Troubleshooting

### 403 on the first PATCH

Symptom: backend logs show `[CrowdStrike-AutoResolve-ERROR] 403: ...`.

Cause: the Falcon API client has `Alerts: read` but not `Alerts: write`.

Fix: follow Setup step 1 (add `Alerts: write` to the API client). The pass halts cleanly after the first 403 rather than spamming errors, so a short interruption is the worst case.

### 404 on a specific alert

Symptom: receipt shows `auto_resolve_error: not_found`.

Cause: the alert was deleted in Falcon between correlation and auto-resolve (vanishingly rare but possible with aggressive cleanup policies).

Fix: none needed. The receipt prevents Achilles from retrying the same alert. The affected alert has no impact on any other auto-resolve work.

### Mode is dry-run but no receipts appear

Check upstream:

1. `[CrowdStrike-Enrichment] alertsMarkedCorrelated=N` — is N > 0 on recent cycles? If 0, correlation isn't tagging alerts; check that tests are running and that their bundle UUIDs appear in the CrowdStrike alert `evidence_filenames`.
2. If correlation IS tagging alerts but no auto-resolve receipts appear, open an issue — something's off between the correlation pass and the auto-resolve candidate query.

### Mode stuck after a restart

The mode is persisted in the encrypted integrations settings (`~/.projectachilles/integrations.json` on Docker/Render/Fly; Vercel Blob on Vercel). It survives restarts and redeploys. If it appears reset, the most likely cause is a settings-file corruption or an env-var override — check `CROWDSTRIKE_CLIENT_ID` hasn't unset the file-based entry.

## Non-goals (v1)

- **No retroactive cleanup**. When you enable auto-resolve, existing open alerts from before the switch are ignored. Only alerts correlated going forward will be auto-resolved.
- **No tag or assignment updates.** Auto-resolve writes status + comment only; Falcon's detection tagging and assignments are untouched.
- **No per-customer correlation tuning.** Single correlation policy (bundle-UUID prefix + hostname + time window) applies uniformly.

## Architecture reference

For implementation details, see the module files in `backend/src/services/crowdstrike/`:

- `auto-resolve.service.ts` — the resolver itself (scans ES, PATCHes via Falcon, writes receipts)
- `falcon-client.ts` — `updateAlerts()` method + envelope inspection (`errors[]`, `meta.writes.resources_affected`)
- `sync.service.ts` — the wrapper that wires the resolver into the 5-minute sync loop
- `enrichment.service.ts` — writes the alert-side `f0rtika.achilles_correlated` field that the resolver reads

`backend-serverless/` holds the parallel implementation for Vercel deployments.
