# Spec: Re-fired aggregated EDR alerts — resolution watermark for the correlation window

**Status:** proposed · **Applies to:** Microsoft Defender integration (both backends + frontend); CrowdStrike assessed and intentionally unchanged
**Related:** PR #490 (window echo fix), `docs/defender-auto-resolve.md`, `docs/edr-killed-stage-detection.md`, `docs/defender-prevention-action-detection.md`

## Problem

Defender **aggregates**: repeated detections of the same binary on the same host update one
existing alert instead of creating a new one. When that alert is already resolved, a re-fire
bumps `lastUpdateDateTime` but leaves `status: resolved` untouched — no new alert, no reopen.

Observed in prod (WS11284, LockBit bundle, Oct 10/12 2026):

- Alert `da91cdf52c` ("Attempt to turn off Microsoft Defender Antivirus protection",
  T1562.001/.006) was created Oct 10 against the stage-1 binary
  `298cc137-…-t1059.001.exe` and was **born resolved** (AV remediation completes at creation:
  `resolved_at == created_at`).
- Oct 12 run: the same stage-1 binary fired again; Defender bumped the alert's
  `lastUpdateDateTime` to 16:50:59Z (3 min into the run). Status stayed `resolved`.
- Under PR #490's window rule (terminal alerts match via `created_at` only), this genuine
  re-fire is invisible: the new run's stage gets no badge, no panel entry, no detection credit.
  (The Oct 12 stage-1 doc still shows "Detected" only because it was ingested pre-#490, when
  the old rule matched on `timestamp` regardless of status — badge and panel disagree on that
  doc permanently, since flags are write-once.)

PR #490 excluded the `timestamp` path for terminal alerts to kill lifecycle echo (our
auto-resolve PATCH bumps `lastUpdateDateTime`, re-floating old alerts into later run windows).
But the echo and the genuine re-fire share that one field. This spec distinguishes them with a
watermark: **an update that happens after the alert's resolution time is not the resolution.**

## Data shape verification (prod, `achilles-defender`, 2026-10-13)

- 2,012 resolved/closed alerts; 2,011 carry `resolved_at` (Graph `resolvedDateTime` — reliable).
- 316 **born-resolved** (`resolved_at` ≈ `created_at`): AV auto-remediation. Status never
  transitions, so no lifecycle bump is possible — any post-creation update is vendor evidence
  activity. (Our auto-resolve whitelists `status='new'` and never touches these.)
- 1,695 resolved after creation: sampled docs show `timestamp` ≈ `resolved_at` (sub-second
  skew) — resolution is the last update until something else happens.
- 567 alerts have `timestamp > resolved_at + 60s` — post-resolution updates (re-fires / added
  evidence), all currently invisible to run windows. A further ~100 alerts show updates 1–60s
  after resolution (resolution-adjacent bumps, e.g. comment POSTs) — absorbed by the epsilon.
- Painless date access: `doc['f'].value.toInstant().toEpochMilli()` works (`toMillis()` does
  not exist on `ZonedDateTime`). `created_at`/`timestamp`/`resolved_at` are all mapped `date`.
- CrowdStrike (`achilles-crowdstrike`): zero closed alerts; Falcon console shows one detection
  per fire (no aggregation observed). See "CrowdStrike parity" below.

## Change (Defender, both backends)

1. **Window helper** — `buildAlertTimeWindowQuery` in `defender/evidence-correlation.ts`
   (backend + backend-serverless) gains a third disjunct re-admitting terminal alerts that
   were updated *after* their resolution:

   ```
   should:
     a. range created_at ∈ window                                   (unchanged — fired in window)
     b. range timestamp  ∈ window AND status ∉ {resolved, closed}   (unchanged — active update)
     c. range timestamp  ∈ window AND status ∈ {resolved, closed}
        AND script: timestamp > resolved_at + 60s                   (NEW — post-resolution re-fire)
   ```

   - Branch (c) script, with missing-field guards:
     `doc['resolved_at'].size() > 0 && doc['timestamp'].size() > 0 && doc['timestamp'].value.toInstant().toEpochMilli() > doc['resolved_at'].value.toInstant().toEpochMilli() + 60000`
   - **Why 60s:** resolution-adjacent vendor updates (our auto-resolve comment POST bumps
     `lastUpdateDateTime` seconds after the status PATCH; prod shows ~100 alerts updated 1–60s
     post-resolution). Genuine re-fires arrive minutes-to-days later, so 60s costs nothing.
   - **Echo stays closed:** our auto-resolve PATCH sets `resolvedDateTime` and
     `lastUpdateDateTime` to the same instant → `timestamp ≤ resolved_at + ε` → branch (c)
     false. Only a *later, independent* vendor update re-admits the alert.
   - **Born-resolved alerts** take branch (c) on any post-creation update (their `resolved_at`
     is `created_at`) — correct: they have no lifecycle path, every update is evidence activity.

2. **Callers — no signature change.** The helper is the single source of truth for the
   enrichment wide + stage queries, `getAlertsForTest` (primary + fallback queries), and the
   detection-rate analytics. Badge, panel, and analytics adopt the rule simultaneously and
   stay consistent by construction.

3. **Effect on the WS11284 class of cases:** the two "49h before" T1486 alerts on the Oct 12
   run (bumps at 16:51:11Z / 16:59:03Z, inside the stage-5 execution window — strongly
   suggesting genuine re-fires misclassified as echo) would match again under branch (c), as
   would the stage-1 tamper alert. They reappear carrying their real semantics: *old alert,
   re-fired during this run* — which is why item 4 matters.

4. **Frontend annotation** (`RunDetailPanel`, both vendor sections): an alert matched via
   branch (c) rendered as "resolved · 49h before" is exactly the UX that motivated #490. When
   an alert is terminal **and** `updated_at > resolved_at + 60s`, annotate with the re-fire
   time relative to the run instead: **"re-fired 3m after · first seen Oct 10"**
   (`updated_at` for the relative annotation, `created_at` for first-seen). The
   `getAlertsForTest` response already carries `created_at`, `updated_at`, and `resolved_at` —
   no API change, frontend-only.

5. **No backfill, no sync-version bump.** `resolved_at` is already synced; the change is
   query-side only. Going forward, re-fires set enrichment flags on newly ingested runs.
   Historical result docs are untouched (flags are write-once; e.g. WS11284's Oct 12 stage-1
   doc keeps its pre-#490 "Detected" badge, which matches its actual history).

## CrowdStrike parity decision

**No window change for CrowdStrike.** No aggregation has been observed: Falcon creates one
detection per fire (console confirms per-run detections), so `created_at` already credits each
run. Additionally, the CS mapper sets `resolved_at = updated_timestamp` while
`status == 'closed'` — it tracks the *latest* update, not the close time, so it cannot serve
as a watermark.

If CS aggregation is ever observed, the path is: stamp `f0rtika.achilles_auto_resolved_at`
from the vendor's `updated_timestamp` at auto-resolve time (and/or fix the CS mapper to set
`resolved_at` once at first close and preserve it across syncs), then apply branch (c) keyed
on that field. Out of scope here; recorded as the known extension.

## Accepted limitations

- A human metadata edit (comment, assignment, classification change) on a resolved alert that
  lands inside a run window will surface that alert via branch (c). Rare, and arguably
  desirable: SOC activity on a test-correlated alert during a run is detection-relevant.
- A genuine re-fire within 60s of resolution is absorbed by the epsilon. Re-fires come from
  later runs (minutes-to-days later), so this is effectively free.
- Graph `resolvedDateTime` is relied upon as the watermark; prod data shows it populated on
  2,011/2,012 terminal alerts. Alerts missing `resolved_at` are conservatively excluded from
  branch (c).

## Tests

- Window helper: terminal alert with `timestamp` in window and `> resolved_at + 60s` →
  matches; `≤ resolved_at + 60s` (resolution/comment bump) → excluded; missing `resolved_at`
  → excluded; active-alert branch (b) and `created_at` branch (a) unchanged; missing-field
  guards never throw.
- Enrichment (both backends): born-resolved aggregated alert whose `timestamp` re-fired during
  a run sets `defender_stage_detected` on the *new* run's doc; the same alert without the
  re-fire bump does not.
- `getAlertsForTest`: re-fire-matched alert is returned with `resolved_at` populated.
- Frontend: branch-(c) alert renders "re-fired Xm after · first seen …"; other terminal alerts
  keep the existing created-relative annotation.
- backend-serverless: mirror all of the above.
