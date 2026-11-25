# Spec: Defender prevention-action detection (vendor-confirmed prevented)

**Status:** approved · **Applies to:** Microsoft Defender integration (both backends + frontend)
**Related:** `docs/edr-prevention-action-detection.md` (CrowdStrike original), `docs/edr-killed-stage-detection.md`
**Canonical reference:** `wiki/docs/user-guide/analytics/exit-codes-and-outcomes.md`

## Problem

CrowdStrike stages killed by Falcon are already reclassified as **Prevented** using the alert's
`pattern_disposition`. Defender has a direct equivalent we don't use: every item in a Graph
`alerts_v2` alert's `evidence[]` carries `remediationStatus`
(`microsoft.graph.security.evidenceRemediationStatus`):

| Defender value | Microsoft's definition | Normalized `prevention_action` |
|---|---|---|
| `blocked` | "The threat was blocked **while executing**" | `process_killed` |
| `prevented` | "The threat was **prevented from executing**" | `blocked` |
| `remediated` | "Remediation action has **completed** successfully" | `quarantined` |
| `active` / `running` / `pendingApproval` / `none` / `notFound` / `unremediated` / `declined` / `partiallyRemediated` | no completed prevention | *(absent)* |

Without it, a stage Defender killed mid-flight lands as exit 999 and gets at most **Detected**,
when the vendor deterministically reported prevention. (Defender already gets prevention credit
for 105/126/127 exit codes; this fills the mid-flight-kill gap — exactly the gap closed for
CrowdStrike in PR #486/#487.)

## Change (Defender only; mirrors the CrowdStrike design)

1. **Sync (`transformAlert`, both backends)** — derive alert-level prevention from
   `evidence[].remediationStatus`:
   - Consider only evidence items that carry a filename/path (process/file evidence — the ones
     `transformAlert` already extracts into `evidence_filenames`/`evidence_filepaths`); if none
     have a status, fall back to any evidence item with a prevention-ish status.
   - Alert-level value = strongest completed action, precedence `remediated` > `blocked` >
     `prevented`; normalize per the table above into `prevention_action`, and keep the raw
     Defender value in `remediation_status` (keyword) for audit/display.
   - Also capture `portal_url` ← the alert's `alertWebUrl` (Graph provides a per-alert deep link —
     upgrades the Defender drawer from the generic portal base, same as `falcon_host_link` did).
   - `remediationStatus` evolves over time (`active` → `remediated`), and alert re-syncs via
     `updatedDateTime` upserts naturally refine it; still bump `ALERT_SYNC_VERSION` 3 → 4 to
     backfill existing alert docs immediately.
   - Index mappings updated additively (both backends + `scripts/upload_to_elasticsearch.py`).

2. **Enrichment (both Defender enrichment services)** — identical rule to CrowdStrike:
   stage-binary matches always qualify; bundle-wide matches qualify only when the stage never
   reached a conclusive outcome (`event.ERROR` ∉ {101, 105, 126, 127}). A stage that exited 101
   never qualifies, even on a stage-binary match: Defender can mark a process as blocked after it
   has exited, so such a stage is Detected, with no prevention flag written. Qualifying matches set
   `f0rtika.defender_prevented: true` + `f0rtika.defender_prevention_action: '<action>'`.
   `msearch` sub-queries include `_source: ['prevention_action']`.
   Results-index mapping gains the two additive fields (both backends + python script).

3. **Types / roll-up (both backends)** — `types/analytics.ts`:
   `defender_prevented?` / `defender_prevention_action?` on the execution type,
   `defenderPrevented?` on the group badge; carried through `elasticsearch.ts` roll-up and
   `mapHitToExecution` exactly like the CrowdStrike fields.

4. **Scoring** — no formula change (prevented ⊆ detected; the combined Defense Score already
   counts detected as protected). SB report: `mapOutcome` treats `defender_prevented` like
   `crowdstrike_prevented` (PREVENTED except conclusive-executed 101), and `preventedBy` lists
   the preventing vendor(s) — both when both apply.

5. **Frontend** —
   - `ExecResultLabel` / `BundleResultLabel`: **Prevented** when either vendor's prevented flag
     is set (or detected + confirmed prevention action); the action label mapping is already
     normalized and shared (`crowdstrikePrevention.ts` — rename/generalize to a vendor-neutral
     prevention util).
   - Defender `AlertDetailsDrawer` + Defender sections in `RunDetailPanel`: prevention badge
     (same component as CrowdStrike) and per-alert `portal_url` deep links with the existing
     `security.microsoft.com/alerts` fallback.

## Rollout

Additive mappings only. `ALERT_SYNC_VERSION` bump re-fetches 90 days of alerts with remediation
status; the next enrichment pass backfills `defender_prevented` on eligible docs (docs with both
detected flags set are not re-scanned — same one-time `update_by_query` pattern used for the
CrowdStrike backfill may be applied operationally where needed).

## Per-run evidence (sync v9)

A Defender alert stays open for days and collects evidence from later runs, so
matching a stage by file name alone can credit a run with another run's
evidence. `ALERT_SYNC_VERSION = 9` adds `evidence_items` to each alert doc (un-indexed):
one entry per file-naming evidence item with `file`, `path`, `parent`,
`parent_path`, `kind`, `verdict`, `action`, `started_at` and `added_at`. It is
`null` when an alert has more than 1,000 such items or an item has no time
Defender added it (`createdDateTime` missing or not a date). `started_at` is
`null` for a file item, and for a process item whose `processCreationDateTime`
is empty, not a date, or earlier than `2000-01-01T00:00:00Z` (Defender sends
`0001-01-01T00:00:00Z` as a placeholder). The forced full re-sync selects by
`lastUpdateDateTime` over the 90-day look-back, so a Defender alert last
updated before the look-back is not re-read, has no `evidence_items` and keeps
the older rule. `evidence_items_version` records that a full look-back finished
without a write error; per-run crediting stays off until it does. A full
look-back that ends with write errors is repeated on the next cycle, at most 3
times in a row. After the third, the sync goes on incrementally, logs one
warning, and per-run crediting stays off until the backend restarts. Until
then the enrichment pass sets stage flags by the older rule while the console's
alert list and the execution report are already run-scoped (they do not wait
for the re-sync), so the two can disagree.

Each result stores `routing.run_started_at` in UTC ISO form (from the agent
task's `started_at`; filled on stored results at start-up by
`runStartBackfill.ts`). `edr/runEvidence.ts`
turns it into a run window, `[run_started_at - 60 s, event_time + 60 s]`. A
process item is in the run when it started inside the window; a file item (or a
process item without a start time) when Defender added it from the window start
up to 30 minutes after `event_time`. With a run view, the prevention action of
a stage, and of a single-test alert at test level, comes from the in-run items
only, not from the alert-wide `prevention_action`.

At test level the run rule counts an in-run name only when it is a test
binary (`<uuid>.exe`, `<uuid>-<control>.exe`), or, by path, a path naming the
test (the uuid, or the bundle-name token the wide query matches on). An in-run
file such as `<uuid>_output.txt` alone gives no test-level credit, although the
wide query's `<uuid>*` filename clause matched it. The alert lookup and the
execution report use the same path rule (`defenderPathNamesTest`) when they
leave out an alert that names the test only in an earlier run.

A result without `routing.run_started_at`, and an alert without
`evidence_items`, keep the rules above. Stored results are re-checked once;
`f0rtika.defender_run_rule: 'run_activity'` marks the ones that were (the previous release used
`run_evidence`; those results are checked once more). A pass
without a run view that sets a detection or prevention flag on a marked result
clears the marker (`null`), so the result is re-checked once the run rule is
back.

## Finding a run's alerts: alert time or activity span

A flag is removed only when the run's own alert lookup finds at least one alert
for it and none of the alerts found counts for the run. The re-check, the
console's alert list and the execution report find a run's alerts in two ways
(`buildDefenderEvidenceQuery`, `buildStageDefenderEvidenceQuery`; two named
query clauses, so Elasticsearch reports which one matched in `matched_queries`):

- `alert_time`: the alert was created, or last updated, between 5 minutes
  before and 30 minutes after the result's `event_time`
  (`buildAlertTimeWindowQuery`, unchanged).
- `activity_span`: `first_activity_at <= event_time + 30 min` and
  `last_activity_at >= run start - 5 min`. This reaches an alert Defender raised
  long after the activity, and every run of a long-open alert, because the
  alert's recorded activity covers all of them.

The span clause needs a usable `routing.run_started_at` (a date not after
`event_time`); without it the query is the older one exactly. In the enrichment
pass it is used only with per-run crediting on (`runScopedEvidence`, the alert
re-sync finished). A hit found only by the span (`foundBySpanOnly`) counts, and
is listed, only through in-run evidence items; an alert without `evidence_items`
found only that way is treated as not returned (`spanHitUnusable`). The
enrichment pass marks an alert found only by the span as an Achilles alert
(`f0rtika.achilles_correlated`), so that auto-resolve can close it, only when
it counts for the run; an alert found by alert time is marked as before,
whether it counts or not. In the
console list and the report only the first tier (the one that names the test)
uses the span; the technique-only tier stays on alert time. Credit for a late
alert needs no one-time pass: the enrichment pass revisits every result of the
last 90 days that has no detection flag on each cycle.

Measured on production data: 284 process start times of test binaries in 217
Defender alerts all lay inside the alert's first-to-last activity, or at most 2
minutes before the first activity. That is why the margins are 5 minutes before
the run's start and 30 minutes after its end.

Known limits:

- A later run that Defender re-detects without adding a new evidence item gets
  no credit for that run. A flag already stored on such a result is kept when
  the stage did not run to completion (see the next section).
- An alert raised late whose only evidence is a file is still not credited (a
  file item counts by when Defender added it).
- Activity recorded more than 30 minutes after the run's end, or a process
  starting more than 5 minutes after the alert's last activity, is not found.
- Past the first 100 alerts of one query, only alerts found by alert time count
  the older way; alerts found only by span beyond the 100 read are ignored.
  When alerts found only by span were left unread, nobody judged them, so no
  stored flag is removed for that result on that query's alerts: not the stage
  flags (stage query), not `defender_detected` (test-level query), and not a
  prevention flag read from that query. The result is still marked as checked.
- The technique-only tier of the alert list and the report, and CrowdStrike,
  SentinelOne and Sophos, are unchanged.
- A result older than 90 days is not revisited.

### A stage that did not run to completion keeps its flags

Defender can stop a file it already knows and update the open alert without
adding an evidence item, so a run it really stopped can look like a run with no
evidence. In the re-check, for each of a result's two alert queries (the
stage's own binary; the whole test) the pass notes whether it has nothing of the
run: at least one usable alert, none left unread, and every usable alert holds
nothing of the run (`holdsNothingOfRun`, `runEvidence.ts`: the alert has an item
list, the run has a window, and no item of any file is inside it). When the
result did not run to completion (`ranToCompletion` false: any exit code other
than 101, or none):

- the stage query has nothing of the run: no stored flag of the result is
  removed (stage detection, `defender_detected`, prevention flags, the stored
  action, and the "stage not prevented" settling). The pass uses the same
  unjudged gates as for unread alerts (`stageUnjudged`, `wideUnjudged`; the
  flag is `stageNoRunItems` / `wideNoRunItems`);
- only the test-level query has nothing of the run: only what that query
  decides is held back.

Still removed as before: the flags of a stage that ran to completion (exit 101)
with no evidence of its run, and the stage flag of a stage whose alert holds
items of the run but none for that stage. No flag is ever created by this rule.

On a fresh result in that situation the pass also stores a note, once, to learn
what Defender writes on the alert: `f0rtika.defender_no_run_evidence =
{ seen_at, kind: 'stage' | 'wide', alerts }`, with at most 5 alerts, each
`{ id, found_by, updated_at, first_activity_at, last_activity_at, items }`
(`id` is the alert document id, `found_by` the query clauses that matched it,
`updated_at` its last update, `items` the number of evidence items the run rule
reads). It is written only when the result has a run window, did not run to
completion, ended within the last 72 hours (`recheckHours`) and has no note yet;
`kind` is `stage` when the stage query has nothing of the run, else `wide`. It is
mapped with `enabled: false` (not indexed) and no API returns it. The pass
result lists the ids in `noRunEvidenceDocs` (at most 20) and the Defender sync
logs `[Defender] Stage stopped with no evidence of its run, note stored on: <id>, <id>`.

Limits of this rule:

- A kept flag can show an alert chip beside an empty alert list: the list and
  the execution report still require evidence of the run.
- A stage that failed for a reason unrelated to the EDR (for example an error
  exit from a broken test) inside the span of an open alert about its binary
  also keeps a stale flag; the rule cannot tell the two apart.
- A silent block on a new run is still not credited; only a stored flag is kept.
- A system whose re-check already ran (the previous release) does not get
  removed flags back.

## Tests

- transformAlert: normalization table (each status → action), precedence across multiple evidence
  items, filename-evidence preference, absent when detection-only, `portal_url` capture, version
  bump forces full re-sync.
- Enrichment (both backends): stage match + `blocked` → `defender_prevented`; wide match on a
  101-coded doc → no prevented flag; wide match on 999 doc → qualifies.
- SB report: 999 + `defender_prevented` → PREVENTED with `preventedBy: ['Microsoft Defender for
  Endpoint']`; both vendors prevented → both listed; 101 + flag → DETECTED (guard).
- Frontend: Prevented label for either vendor; drawer `portal_url` preferred, fallback preserved.
