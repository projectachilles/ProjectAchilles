# Spec: prevention-action detection (CrowdStrike) + host-scoped alerts-for-test fallback

**Status:** approved · **Applies to:** CrowdStrike integration (prevention) + both EDR integrations (fallback fix)
**Related:** `docs/edr-killed-stage-detection.md`, PR #485
**Canonical reference:** `wiki/docs/user-guide/analytics/exit-codes-and-outcomes.md`

## Part 1 — Host-scope the technique-only fallback in `alerts-for-test`

### Problem (observed in production, 2026-10-12, customer tenant)

`getAlertsForTest()` in both vendors' analytics services uses a three-tier fallback:
evidence (hostname + binary + window) → technique + hostname → **technique-only with no
hostname constraint** (`analytics.service.ts` — "Fallback 2"). During a fleet-wide
simultaneous bundle run, hosts where the EDR did *not* alert inherited sibling hosts'
alerts: WS11284's T1486 stage displayed three `ProcRansomware` alerts belonging to
LT8801 / WS11199 / WS11328 (same technique, same ±30-min window).

Impact is **display-only**: enrichment flags (which drive Defense Score and Detected
badges) are hostname+evidence-constrained and were not affected.

### Change

When the caller provides `hostname`, the technique-only fallback keeps the hostname
filter (same dual-field `evidence_hostnames` / `.keyword` wildcard used by the other
tiers). When `hostname` is absent (e.g. unknown host), behavior is unchanged —
technique-only remains the last resort.

Rationale: for both vendors, synced alert docs carry `evidence_hostnames` whenever the
vendor reports a device; a technique-only cross-host association is a false positive
waiting for any simultaneous multi-host run. A missed association for a genuinely
host-less alert is the acceptable trade-off.

Files: `backend/src/services/{defender,crowdstrike}/analytics.service.ts` and the
`backend-serverless` twins, plus their test suites.

## Part 2 — Treat vendor-confirmed prevention as *prevented*, not just detected

### Problem

Falcon's console shows "Actions taken: **Process killed**" for killed stages, but the
platform showed the stage as inconclusive/detected-at-best. Verified against the live
Alerts API: every alert resource carries a structured disposition:

```
pattern_disposition: 16  →  pattern_disposition_description: "Prevention, process killed."
pattern_disposition_details: { kill_process: true, kill_action_failed: false,
                               quarantine_file, process_blocked, operation_blocked,
                               fs_operation_blocked, kill_parent, kill_subprocess, ... }
falcon_host_link: "https://falcon.us-2.crowdstrike.com/activity-v2/detections/<composite_id>?_cid=..."
```

This is deterministic vendor evidence of *prevention* — no inference needed.

### Change (CrowdStrike; Defender analog deferred)

1. **Sync (`transformAlert`)** — extract onto the alert doc:
   - `prevention_action` (keyword): derived enum —
     `kill_action_failed` → `'kill_failed'`;
     else `quarantine_file` → `'quarantined'`;
     else `kill_process`/`kill_parent`/`kill_subprocess` → `'process_killed'`;
     else `process_blocked`/`operation_blocked`/`fs_operation_blocked` → `'blocked'`;
     else absent (detection-only).
   - `pattern_disposition` (integer) + `pattern_disposition_description` (keyword) — raw, for display/audit.
   - `portal_url` (keyword) ← `falcon_host_link` — exact per-alert console deep link.
   - Index mappings updated additively (both backends + `scripts/upload_to_elasticsearch.py`).
   - `CROWDSTRIKE_ALERT_SYNC_VERSION` bumped 1 → 2 to force a one-time full re-sync so
     existing alert docs gain the new fields.

2. **Enrichment** — the alert-side msearch sub-queries currently discard `_source`;
   include `_source: ['prevention_action']`. Prevention-flag qualification rule
   (tightened after production data showed bundle-level overclaiming):
   - **Stage matches always qualify** — the alert names this stage's own binary.
   - **Wide/bundle matches qualify only when the stage did NOT reach a conclusive
     outcome** (`event.ERROR` ∉ {101, 105, 126, 127}). A sibling stage that already
     exited 101 (executed unprotected) was not prevented by the alert that killed a
     later stage — observed in prod when Falcon killed T1486 while stages 1–4 had
     completed.
   Qualifying matches set on the test doc, alongside the existing detected flags:
   - `f0rtika.crowdstrike_prevented: true`
   - `f0rtika.crowdstrike_prevention_action: '<action>'`
   Results-index mapping gains the two additive fields (both backends + python script).

3. **Scoring** — `crowdstrike_prevented` ⊆ `crowdstrike_detected`, and Defense Score
   already counts detected as protected, so no score-formula change. The SB compliance
   report gains the distinction: prevented stages report outcome PREVENTED with
   `preventedBy: ['CrowdStrike Falcon']` (it already has the `preventedBy` list shape).
   The report applies the same guard as enrichment: a conclusive-executed stage
   (exit 101) is never upgraded to PREVENTED, while error/inconclusive exits
   (999/259/0) with a vendor-confirmed kill are — killed stages never reach
   conclusive codes.

4. **Frontend** —
   - `RunDetailPanel` / executions `shared.tsx`: a `crowdstrike_prevented` stage renders
     a distinct **Prevented** label (stronger than Detected), showing the action
     (`process killed`, `quarantined`, …) where space allows.
   - `CrowdStrikeAlertDetailsDrawer` + related-alerts rows: use `portal_url` for a true
     per-alert Falcon console link, falling back to the region-base `/alerts` link when
     absent; show `prevention_action` as a badge on alert rows.
   - API types extended (`prevention_action`, `pattern_disposition_description`,
     `portal_url` on alert items; `crowdstrike_prevented` on execution docs).

## Rollout

Additive mappings only; sync-version bump re-fetches 90 days of alerts with the new
fields; next enrichment pass backfills prevented flags on eligible docs (including the
killed-stage population unlocked by PR #485). No migration, no agent change, no
Defender behavior change beyond Part 1's display fix.

## Tests

- transformAlert: disposition → `prevention_action` derivation (kill, quarantine,
  blocked, kill-failed precedence, detection-only absence); `portal_url` captured.
- Enrichment: matched alert with `prevention_action: 'process_killed'` → test doc gets
  `crowdstrike_prevented` + action; detection-only alert → detected flags only.
- alerts-for-test (both vendors): tier-3 with hostname includes the hostname filter;
  without hostname stays technique-only.
- SB report: prevented stage → PREVENTED + `preventedBy` entry.
- Sync: version bump forces full re-sync (existing pattern test).
