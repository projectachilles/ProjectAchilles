# Spec: EDR-killed test stages should count as detected/protected

**Status:** proposed · **Applies to:** Defender + CrowdStrike integrations, Defense Score, Analytics UI
**Related:** `docs/defender-asr-exclusion-rationale.md`, `docs/defender-detection-rate.md`, `docs/crowdstrike-detection-rate.md`, PR #484 (exit-code overflow fix)
**Canonical reference:** `wiki/docs/user-guide/analytics/exit-codes-and-outcomes.md`

> **Related case: the EDR kills the agent itself.** This spec covers a killed *stage* whose result still reaches Elasticsearch. When the EDR kills the agent process, no result is reported at all; that case is reconciled from EDR alerts after the fact and scored Protected with stages unknown. See `wiki/docs/user-guide/analytics/exit-codes-and-outcomes.md` ("Agent terminated by the EDR").

## Problem

When an EDR kills a test stage **at launch or mid-run**, the resulting test document lands in an
error/inconclusive category (`event.ERROR` 999 after the #484 coercion, 260 for pre-execution policy
blocks, 259 for timeouts) instead of a conclusive one. Those docs are then excluded from the EDR
enrichment scan, because both enrichment services restrict eligibility to the conclusive codes:

```ts
// backend/src/services/{defender,crowdstrike}/enrichment.service.ts
const CONCLUSIVE_ERROR_CODES = [101, 105, 126, 127];
```

Consequence: the **strongest possible protection outcome** — the EDR killed the attack stage before
it could do anything — renders in Analytics as an "error" stage with no detection credit, while a
stage that merely *ran and was alerted on* does get credit. The scoring model punishes prevention.

### Production evidence (2026-10-12, customer tenant)

Three hosts (WS11199, WS11328, LT8801) ran the LockBit kill-chain bundle. CrowdStrike Falcon killed
`298cc137-…-t1486.exe` at launch (exit `0xE0000027`) and raised a `ProcRansomware` alert ~60s later
carrying the exact stage binary in its evidence. The stage docs were error-category; enrichment never
scanned them; the runs showed 4/5 stages with no CrowdStrike detection badge on the killed stage.

## Design principle

**Evidence, not exit codes.** The backend cannot reliably infer *why* a process died — 999 also covers
genuine environment failures ("prerequisites not met"), and 259 is a timeout. What distinguishes
"EDR killed it" from "test broke" is the presence of a matching EDR alert. The correlation engine
already evaluates exactly that evidence (hostname + bundle-UUID/stage-binary filename + ±5/+30-minute
window). So: widen what enrichment may *scan*, and let evidence decide what gets *flagged*.

## Proposal

### 1. Enrichment eligibility (both vendors, both backends)

Extend the eligibility code list in all four enrichment services
(`backend` + `backend-serverless`, `defender` + `crowdstrike`) from
`[101, 105, 126, 127]` to `[0, 1, 101, 105, 126, 127, 259, 999]` — i.e. conclusive codes **plus**
error/inconclusive codes. Rename the constant to `ENRICHMENT_ELIGIBLE_ERROR_CODES`.

- Flagged docs then carry `f0rtika.defender_detected` / `crowdstrike_detected` (and the stage-level
  variants) exactly as today.
- Unmatched error docs (genuine environment failures with no corroborating alert) remain
  untouched — no flag, no scoring change.

**Deliberately excluded:** `260` (BlockedPreExecution) stays ineligible. That code is produced by
ASR/app-control policy blocks, including the ASR rule the platform itself excludes by design
(`docs/defender-asr-exclusion-rationale.md`); counting it as detection would conflate our own
exclusion with EDR efficacy. Revisited (Oct 2026): a separate pass,
`services/edr/launch-block-reconcile.service.ts`, turns a whole-test 260 into a Protected 126
when a CrowdStrike/SentinelOne/Sophos prevention alert names the run's task folder or
orchestrator binary (never a Defender alert). The enrichment pass still never scans 260.

**False-positive analysis:** the stage query requires the exact stage binary
(`<bundle-uuid>-<control_id>[-variant].exe`) in alert evidence on the same hostname within the time
window; the wide query requires the bundle UUID in filename/filepath evidence. An unrelated alert
matching all of that on an erroring test is vanishingly unlikely. Worst case is a *bundle-level*
(`*_detected`, not `*_stage_detected`) flag when the EDR killed one stage and a sibling stage errored
for unrelated reasons inside the same window — acceptable, and visible in the UI via the alert link.

**Load:** the scan set grows by error-category docs inside the 90-day lookback. Pass caps (200
docs/pass, 60s) are unchanged; the pass is self-healing across cycles.

### 2. Scoring — verdict display fixed here; Defense-Score widen deferred

**Correction (Oct 27 2026):** the earlier claim that flagging alone makes a killed stage count was
wrong for per-stage verdicts. The stage verdict functions returned `inconclusive` as soon as the
exit code was not 101, *before* consulting the EDR flags, so a 999/`0xE0000027` stage carrying its
own `*_stage_detected` + a confirmed prevention action still read as "Not scored: error". This is
now fixed in `reports/stageOutcome.ts` (`classifyStage` + `OUTCOME_FILTERS`) and its
backend-serverless twin: an error-coded stage upgrades to Prevented/Detected on **stage-level
evidence only** (`*_stage_detected` + a confirmed `*_prevention_action`; never the bundle-level
`*_prevented`/`*_detected` flags, which a sibling stage can set).

The **Defense Score** still filters to conclusive codes `[101,105,126,127]`
(`analytics/elasticsearch.ts` `buildConclusiveResultsFilter`, `posture.ts` `CONCLUSIVE_CODES`)
*before* the detection-OR applies, so an error-coded killed stage shows the right verdict but does
not yet count toward the score. Widening that gate is a separate, larger change (strict-vs-combined,
risk-acceptance, trend) — tracked, not done here. `is_protected` semantics (codes 105/126/127) are
untouched.

### 3. UI — verdict upgraded here (was NOT automatic)

**Correction:** `classifyExecution` (`executions/shared.tsx`) early-returned `inconclusive` for any
non-101 code, so the `*_stage_detected ?? *_detected` fallback below it never ran for a killed
stage — the row showed "Not scored", not Detected. The console now upgrades an error-coded stage
with stage-level evidence to Prevented/Detected (`stageVerdict.ts` renders "Ran, then an EDR
stopped it." / the Detected label). The stage detail still shows the related alert via
`alerts-for-test`, and the raw kill code remains visible as `Unknown (3758096423)` /
`event.ERROR_raw` for transparency.

### 4. Agent — no change

The agent reports the raw OS exit code (correct). Attribution of *why* a process died is a
backend/evidence concern, not an agent-side guess.

## Rollout

- Additive only: flag fields and mappings already exist; no index migration.
- First enrichment pass after deploy backfills automatically: killed-stage docs have neither flag
  set, so they re-enter eligibility (within the 90-day lookback) and get evaluated.
- Expect a one-time **increase in Detection Rate and Defense Score** on tenants with EDR-killed
  stages — this is the intended correction, worth a changelog/wiki note.

## Tests

- Enrichment (both vendors, both backends): a 999-coded doc + matching stage-evidence alert →
  `*_stage_detected: true`; a 999 doc with no matching alert → untouched; 260 docs never scanned.
- Defense Score: flagged error-category doc counts as detected/protected in `combined`, not in
  `strict`.
- Regression: existing conclusive-code behavior unchanged.
