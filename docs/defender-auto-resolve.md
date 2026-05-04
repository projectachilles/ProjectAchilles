# Microsoft Defender Auto-Resolve

Third pillar of the Microsoft Defender integration. Reads Achilles-correlated alerts from Elasticsearch and PATCHes them in Microsoft Defender to `status=resolved` with a `securityTesting` determination, so continuous-validation activity doesn't flood your SOC queue with alerts that are expected and authorized.

## The three-pillar mental model

| Pillar | Direction | Graph permission | Default |
|---|---|---|---|
| 1. Analytics ingest — Secure Score, alerts, control profiles | Graph → ES | `SecurityAlert.Read.All` | On once credentials are set |
| 2. Evidence correlation — test ↔ alert matching | ES ↔ ES | None extra | Automatic |
| 3. **Auto-resolve** — alert → resolved in Defender | ES → Graph | `SecurityAlert.ReadWrite.All` | **Opt-in, disabled by default** |

Pillars 1 and 2 are read-only. Pillar 3 is the first write pillar. Enabling it requires a separate permission grant from pillar 1, so customers can run the read-only integration indefinitely without ever granting write access.

## Operational modes

The auto-resolve pillar has three modes, chosen from the UI or API:

| Mode | Effect |
|---|---|
| `disabled` (default) | No ES queries, no Graph calls. Feature is dormant. |
| `dry_run` | Compute candidates, log `[Defender-AutoResolve-DryRun]`, write a receipt with `mode='dry_run'`. **Does not call Microsoft Graph.** Use this for 7+ days to audit correlation quality before flipping live. |
| `enabled` | PATCH the correlated alert in Defender to `status=resolved`, `classification=informationalExpectedActivity`, `determination=securityTesting`, with an audit-trail comment naming the Achilles test UUID. |

Receipts are written in both `dry_run` and `enabled` modes so the same candidate isn't reprocessed on every 5-minute cycle.

## Which alerts are eligible

An alert is a candidate for auto-resolve only when **all** of these hold:

| Condition | Why |
|---|---|
| `f0rtika.achilles_correlated == true` | The enrichment pass tied the alert to an Achilles test execution (bundle-UUID match in evidence within the time window). |
| `status == "new"` | Defender hasn't acted on the alert yet, and no human has acknowledged it. |
| `f0rtika.auto_resolved != true` | The alert hasn't already been processed by a previous pass (idempotency). |

Specifically **excluded** from auto-resolve:

- **`status == "resolved"`** — already closed by a human or by Defender's auto-investigation. Auto-resolve never reaches into closed alerts, even if it would have classified them differently. The original disposition stands.
- **`status == "inProgress"`** — a SOC analyst has acknowledged the alert and is actively triaging it. Auto-resolve respects that acknowledgment and leaves the alert alone. The analyst can finish their workflow without finding the alert flipped to `resolved` underneath them.
- **`status == "unknown"` or any future status value Defender introduces** — fail-closed by default. The candidate query is a *whitelist* on `status: 'new'`, not a denylist on `status: 'resolved'`, so any new status Defender adds is automatically excluded until the policy is updated.

What this means in practice: turning auto-resolve on never disrupts in-flight SOC work, and historical alerts your team has already triaged stay exactly as they were left. The only alerts that get PATCHed are the ones nobody has touched yet — which is precisely the intended target of the feature.

## Setup walkthrough

### 1. Grant the extra scope in Azure AD

The auto-resolve pillar needs `SecurityAlert.ReadWrite.All` in addition to the read-only scopes you already granted for pillar 1.

1. Open [Azure portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps) and select the app you use for Achilles → Defender.
2. **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions** → search for `SecurityAlert.ReadWrite.All`.
3. Click **Grant admin consent** for your tenant.
4. Confirm the permission shows **Granted** (green check) in the permissions list.

No restart or redeploy is needed on the Achilles side — the existing OAuth2 client picks up the new scope the next time it refreshes its token (within ~5 minutes).

### 2. Enable dry-run mode

1. Open **Settings → Integrations → Microsoft Defender**.
2. Expand **Alert auto-resolution**.
3. Select **Dry-run**.

Within one sync cycle (~5 minutes), you should see `[Defender-AutoResolve-DryRun]` entries in backend logs and rows appearing in the **Recent receipts** table marked `mode=dry_run`. Each receipt names the alert and the Achilles test UUID that triggered it.

### 3. Audit for 7 days

During the dry-run window:

- **Look for false positives** in the receipts table. A false positive here means an alert was marked `achilles_correlated` by the enrichment pass that you consider a real (non-Achilles) detection. If any appear, open an issue with the alert ID and matching test UUID so the correlation logic can be tightened.
- **Check counts** in the 24h / 7d / 30d stats strip for sanity — if your test volume is N bundles/day and you're seeing auto-resolve candidates at 10×N, correlation may be too loose; if you're seeing 0 receipts despite a full day of tests, correlation may be missing matches.

### 4. Flip to enabled

Once dry-run looks clean, select **Enabled**. The next sync cycle will start PATCHing correlated alerts in Defender to `status=resolved`.

In the Defender portal, resolved alerts appear with:
- **Classification**: Informational — expected activity
- **Determination**: Security testing
- **Resolution comment**: "Achilles test `<bundle-uuid>` — authorized continuous validation. Resolved automatically by Project Achilles."

## How to spot-check it's working

### In the Defender portal

Filter alerts by classification `Informational - expected activity`. Each auto-resolved alert should carry the security-testing determination and the comment naming a bundle UUID.

### From the API

```bash
# Status + recent counts
curl -H "Authorization: Bearer $CLERK_JWT" \
  https://<backend>/api/integrations/defender/auto-resolve/status

# Recent receipts
curl -H "Authorization: Bearer $CLERK_JWT" \
  "https://<backend>/api/integrations/defender/auto-resolve/receipts?limit=20"
```

### From Elasticsearch directly

```bash
# Count alerts that carry an auto-resolve receipt in the last 7 days
curl -H "Authorization: ApiKey $ES_API_KEY" \
  "$ES/achilles-defender/_count" \
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

**Auto-resolve never changes the Defense Score.** It operates only on alert documents in the `achilles-defender` index. Test documents in `achilles-results-*` (which feed the Defense Score) are untouched.

If you enable auto-resolve and observe the Defense Score change, that is a bug worth reporting — it should stay byte-identical before and after.

## Troubleshooting

### 403 on the first PATCH

Symptom: backend logs show `[Defender-AutoResolve-ERROR] 403: ... SecurityAlert.ReadWrite.All`.

Cause: the Azure AD app has read-only scopes but not the write scope.

Fix: follow Setup step 1 (grant `SecurityAlert.ReadWrite.All` + admin consent). The pass halts cleanly after the first 403 rather than spamming errors, so a short interruption is the worst case.

### 404 on a specific alert

Symptom: receipt shows `auto_resolve_error: not_found`.

Cause: the alert was deleted in Defender between correlation and auto-resolve (vanishingly rare but possible with aggressive cleanup policies).

Fix: none needed. The receipt prevents Achilles from retrying the same alert. The affected alert has no impact on any other auto-resolve work.

### Mode is dry-run but no receipts appear

Check upstream:

1. `[Defender-Enrichment] alertsMarkedCorrelated=N` — is N > 0 on recent cycles? If 0, correlation isn't tagging alerts; check that tests are running and that their bundle UUIDs appear in the Defender alert `evidence_filenames`.
2. If correlation IS tagging alerts but no auto-resolve receipts appear, open an issue — something's off between the correlation pass and the auto-resolve candidate query.

### Mode stuck after a restart

The mode is persisted in the encrypted integrations settings (`~/.projectachilles/integrations.json` on Docker/Render/Fly; Vercel Blob on Vercel). It survives restarts and redeploys. If it appears reset, the most likely cause is a settings-file corruption or an env-var override — check `DEFENDER_TENANT_ID` hasn't unset the file-based entry.

## Non-goals (v1)

- **No retroactive cleanup**. When you enable auto-resolve, existing open alerts from before the switch are ignored. Only alerts correlated going forward will be auto-resolved.
- **No incident-level PATCHes.** Defender auto-cascades incident status when all child alerts resolve, so this v1 only touches individual alerts.
- **No bulk Graph `$batch` calls.** Individual PATCHes per alert; adequate for the ~30 candidates per pass cap.
- **No per-customer correlation tuning.** Single correlation policy (bundle-UUID prefix + hostname + time window) applies uniformly.

## Architecture reference

For implementation details, see the module files in `backend/src/services/defender/`:

- `auto-resolve.service.ts` — the resolver itself (scans ES, PATCHes via Graph, writes receipts)
- `graph-client.ts` — `updateAlert()` method + `GraphPatchError` class
- `sync.service.ts` — the wrapper that wires the resolver into the 5-minute sync loop
- `enrichment.service.ts` — writes the alert-side `f0rtika.achilles_correlated` field that the resolver reads

`backend-serverless/` holds the parallel implementation for Vercel deployments.
