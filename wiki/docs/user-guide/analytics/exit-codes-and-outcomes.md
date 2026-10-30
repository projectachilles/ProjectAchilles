---
title: "Exit Codes & Outcomes"
description: "Canonical reference for test exit codes, correlation flags, stage labels, and final Defense Score / SB report outcomes."
---

# Exit Codes & Outcomes

The single source of truth for how a test execution's raw exit code, EDR
correlation flags, stage labels in the UI, and final outcomes in the Defense
Score and SB compliance report relate to each other.

## 1. Exit codes — what the agent reports

| Code | Name | Meaning | Category |
|---|---|---|---|
| `0` | NormalExit | Ran, exited normally — outcome varies by context | inconclusive |
| `1` | BinaryNotRecognized | Binary not recognized / permission denied | contextual |
| `101` | Unprotected | **Attack succeeded** — endpoint did nothing | failed |
| `105` | FileQuarantinedOnExtraction | AV quarantined the file during extraction | protected |
| `126` | ExecutionPrevented | Execution blocked/prevented by AV/EDR policy | protected |
| `127` | QuarantinedOnExecution | Quarantined at execution attempt | protected |
| `200` | NoOutput | Upload confirmation — **not a test outcome** | excluded from everything |
| `259` | StillActive | Process timeout (Windows STILL_ACTIVE) | inconclusive |
| `260` | BlockedPreExecution | Blocked before launch (access denied): by an EDR/AV, or by an app-control **policy** such as Defender ASR — technique never evaluated | inconclusive, or **Protected** once an EDR's own alert confirms the block ([section 7](#7-test-blocked-at-launch-by-the-edr)) |
| `999` | UnexpectedTestError | Process died unexpectedly — crash, missing prereqs, **or EDR kill** | error |
| `> 2³¹−1` (e.g. `0xE0000027`) | *(unsigned NTSTATUS-style)* | EDR kill codes and similar — **coerced to `999` at ingestion**, original preserved in `event.ERROR_raw` | error |

:::info[Exit codes never prove prevention]
`999` is ambiguous by itself — it means "something killed the process or it
broke." Attribution only ever comes from EDR alert evidence (§2), never from
the exit code. This is the "evidence, not exit codes" principle.
:::

## 2. Correlation flags — written by the enrichment pass

The enrichment pass (every 5 minutes) scans recent test docs and correlates
them against synced EDR alerts:

| Flag | Set when | Qualification |
|---|---|---|
| `defender_detected` / `crowdstrike_detected` / `sentinelone_detected` / `sophos_detected` | Alert evidence matches hostname + bundle UUID in filename/path, within −5/+30 min of the test | — |
| `*_stage_detected` | Alert evidence names the **stage's own binary** (`<bundle-uuid>-<control>.exe`) | — |
| `crowdstrike_prevented` / `defender_prevented` / `sentinelone_prevented` / `sophos_prevented` (+ `*_prevention_action`) | Matched alert carries a vendor-confirmed prevention disposition | **Stage-binary matches always qualify. Bundle-wide matches only if the stage never reached a conclusive outcome** (exit ∉ `{101, 105, 126, 127}`). A failed kill (CS `kill_action_failed`) never qualifies |

**Vendor prevention dispositions**, normalized to a shared vocabulary
(`process_killed` / `quarantined` / `blocked`):

| Normalized action | CrowdStrike (`pattern_disposition_details`) | Defender (`evidence[].remediationStatus`) |
|---|---|---|
| `process_killed` | `kill_process` ("Prevention, process killed.") | `blocked` (blocked while executing) |
| `blocked` | `process_blocked` / `*_blocked` | `prevented` (never ran) |
| `quarantined` | `quarantine_file` | `remediated` (completed) |
| *(absent — detection only)* | no disposition / `kill_action_failed` | `active`, `none`, `pendingApproval`, … |

Alert docs also carry `portal_url` — the exact per-alert console deep link
(Falcon's `falcon_host_link`, Defender's `alertWebUrl`) — used by the alert
drawers and execution detail panels.

**Which documents are scanned:** exit codes `[0, 1, 101, 105, 126, 127, 259, 999]`
— so EDR-killed stages (999) are eligible. Deliberately **not scanned**:

- `200` — upload confirmation, not a test outcome
- `260` — a block before execution. It may be the ASR rule the platform
  excludes by design (see
  [Defender ASR exclusion](../../deployment/endpoint-prerequisites#3-defender-asr-per-rule-exclusion-for-cf0)), and counting that
  would conflate our own configuration with detection. When an EDR's own
  prevention alert proves the EDR blocked the launch, a separate pass turns
  the result into a Protected `126` ([section 7](#7-test-blocked-at-launch-by-the-edr)); the enrichment pass never touches it

**Time-window semantics:** an alert correlates with a test when its
`created_at` falls in the −5/+30-minute window, or when its last-update time
does **and the alert is still active** (`new`/`in_progress`/`reopened`).
Terminal alerts (`resolved`/`closed`) re-enter a window via updates **only
when the update happened more than 60 s after the alert's resolution time** —
a post-resolution bump is a genuine re-fire of an aggregated alert (Defender
reuses one alert for repeat detections of the same binary on a host, bumping
its last-update time without reopening it), while the resolution itself —
including our own auto-resolve — never qualifies. In the execution detail
panels such alerts are annotated from the re-fire time, e.g.
"re-fired 3m after · first seen Oct 10", rather than by their original
creation time. (Defender only — see `docs/edr-alert-refire-watermark.md`; no
alert aggregation has been observed for CrowdStrike.)

## 3. Stage labels in the UI

Each stage row in the executions view resolves to exactly one label, by
precedence (top wins):

| Label | Condition | Meaning |
|---|---|---|
| **Protected** | exit ∈ `{105, 126, 127}` | Endpoint blocked/quarantined at the OS level |
| **Prevented** | `crowdstrike_prevented`, `defender_prevented`, `sentinelone_prevented` or `sophos_prevented` (or detected flags + confirmed prevention action) | Vendor-confirmed kill/quarantine/block — shows the action, e.g. "Prevented (process killed)" |
| **Detected** | `*_stage_detected` | The EDR saw this stage and alerted, but didn't stop it. The run-wide `*_detected` flag, which every stage of a run carries once any alert names the run, doesn't count here |
| **Unprotected** | exit 101 | Attack ran to completion, nothing reacted |
| **Inconclusive** | everything else (0, 1, 259, 260, 999, missing) | Can't judge — error, timeout, policy block, or unconfirmed kill |

Bundle rows roll up with the same precedence:
Protected > Prevented > Detected > Unprotected.

## 4. Final outcomes

### Defense Score (Analytics dashboards)

- **Strict score**: `protected (105/126/127) / conclusive (101 + 105 + 126 + 127)`
- **Combined score** ("detected counts as protected"): adds
  `defender_detected OR crowdstrike_detected` to the protected side.
  `*_prevented` ⊆ `*_detected` for both vendors, so prevented stages are
  covered automatically.
- Error codes (`0`, `1`, `259`, `999`) feed the **Error Rate**, not the score.
- `200` and `260` are excluded from both. A `260` that an EDR's own alert
  proves was the EDR blocking the launch is rewritten to `126` and counts as
  protected ([section 7](#7-test-blocked-at-launch-by-the-edr)).

### SB compliance report

Outcomes: `PREVENTED / DETECTED / MISSED / EXPOSED / NOT_RUN / ERROR`.

| Exit | EDR flags | Outcome | Attribution |
|---|---|---|---|
| 105 / 126 / 127 | any | **PREVENTED** | `preventedBy`: vendor(s) |
| 999 / 259 / 0 / none | any vendor's `*_prevented` | **PREVENTED** | `preventedBy`: the preventing vendor(s), all when several flagged |
| 101 / 0 | `*_stage_detected` | **DETECTED** | `detectedBy`: vendor(s), all when several flagged |
| 101 / 0 | none, tactic ∈ `{exfiltration, impact}` | **EXPOSED** | — |
| 101 / 0 | none, other tactics | **MISSED** | — |
| 200 / 259 / 260 | any | **ERROR** (with "inconclusive" note) | — |
| — (no document) | — | **NOT_RUN** | — |

Techniques on each row:

- **`techniques`**: what the stage executed, as the bulletin defines the field.
  It holds the result's own technique, plus every technique the test library
  declares for that stage in the info card heading
  (`### Stage 1 — Execution & Defense Degradation (T1059.001, T1562.001, T1112)`),
  e.g. `["T1059.001", "T1562.001", "T1112"]`. A test without that heading keeps
  its single technique. The list comes from the library at export time, so
  older runs get it too.
- **`detectedTechniques`**: an additional field (the bulletin accepts extra
  fields and doesn't evaluate them). It lists the ATT&CK techniques on the
  alerts that named this stage's own binary, for each vendor whose
  `*_stage_detected` flag is set, sorted. It's empty when no vendor detected
  the stage. If the alert search fails, the export still completes, with this
  field empty and a warning in the backend log.

The outcome applies to every technique in `techniques`: results are measured
per stage, not per technique.

## 5. Worked examples

| Scenario | Exit | Evidence | Label / SB outcome |
|---|---|---|---|
| Falcon kills the ransomware stage at launch | `0xE0000027` → 999 | Stage-binary alert match, `process_killed` disposition | **Prevented (process killed)** / PREVENTED |
| Defender blocks a stage binary mid-execution | 999 | Stage-binary alert match, `remediationStatus: blocked` | **Prevented (process killed)** / PREVENTED |
| Sibling stage already ran to completion before the kill | 101 | Bundle-wide alert match only | **Unprotected** / MISSED (EXPOSED for exfiltration/impact): the alert names another stage, and a succeeded stage is never upgraded to Prevented |
| Stage runs, nothing reacts | 101, no alert | none | **Unprotected** / MISSED (or EXPOSED for exfiltration/impact tactics) |
| Stage dies, no alert anywhere | 999, no alert | none | **Inconclusive** / ERROR — a kill is never assumed |
| Defender ASR policy blocks launch | 260 | policy, not detection | **Inconclusive** / ERROR — never counted |
| EDR (e.g. Falcon ML) blocks the test at launch | 260 → `126` | Same-host prevention alert naming the run's task folder or the test's `<uuid>.exe` | **Protected**, credited to the EDR, no technique scored (see [section 7](#7-test-blocked-at-launch-by-the-edr)). The task still shows **Not run** on the Tasks page |
| Defender quarantines at extraction | 105 | — | **Protected** / PREVENTED |
| EDR kills the agent mid-test | `-1` (watchdog) | Same-host alert in the run window, EDR-killed, techniques overlap | **Protected**, stages unknown, not in the SB export (see [section 6](#6-agent-terminated-by-the-edr)). Without an alert there is no Elasticsearch document, so the run is absent from Analytics. The task shows **failed** on the Tasks page, campaigns show **Error** and the Finished email shows **Not run** |

## 6. Agent terminated by the EDR

An EDR can kill the agent process itself in the middle of a test. The agent then never reports a result, and the server's watchdog fails the task as `Agent went offline during execution` or `Task exceeded execution timeout` (exit `-1`, no Elasticsearch document). When an EDR alert proves the kill, ProjectAchilles turns that failure into a **Protected** result. It does this after every Microsoft Defender, CrowdStrike, SentinelOne and Sophos poll, and only against EDRs that are configured.

A watchdog failure becomes a result only when **all** of these hold:

- The alert is on the same host (exact short hostname).
- It was created between the moment the agent picked up the task and the moment the watchdog failed it. If the agent came back (service recovery, a quick reboot) and picked up its next test first, the window ends at that pickup plus 60 seconds, so the next test's alerts never count for the dead one.
- If the alert is already linked to a test (`f0rtika.achilles_test_uuid`), it is this test.
- The EDR itself killed, quarantined or blocked something. Achilles' own SentinelOne automatic mitigation does not count.
- The alert's ATT&CK techniques overlap the test's techniques (compared at parent level, so `T1486` matches `T1486.001`). Sophos currently provides no such alert on any tenant: its alerts and SIEM events carry the prevention but no techniques, and its XDR detections carry techniques but never a prevention action, so a Sophos kill stays a failed task instead of becoming Protected.

The name of the flagged file does not matter. For example, an alert whose process tree is rooted at the agent's own binary or at a remote-management agent such as `rphcp.exe` still matches, because the technique and time window tie it to the run. The first check after the server starts covers watchdog failures from the last 30 days; later checks cover the last 2 days, since vendor alerts sync within minutes. Each failure's alerts are searched only within that run's own window.

Not every `-1` qualifies:

- A watchdog failure with no matching alert stays an **error** and stays out of Elasticsearch.
- Cyber-hygiene tests are never converted. They are scored per control, and a whole-test result cannot represent them.

### How it scores

- It is one whole-test result with outcome **Protected** and the stages **unknown**: the agent died before saying which stage was running.
- It counts in the Defense Score. For a multi-stage test in **any-stage** mode it joins that test's latest-basis pair on the host, and the newest run wins whether it is a kill or a real run. In **all-stages** mode pairs are per stage, so a multi-stage kill run adds no pair; a single-stage test's kill run is its own pair.
- It is excluded from every technique view: technique coverage, the ATT&CK matrix, the execution report's technique and tactic counts, and the vendors' detection-rate and technique-overlap numbers. Stages are unknown, so no technique can be credited.
- The chain-depth card shows these runs as **Stopped by EDR, stage unknown: N**, instead of placing them in a stage bucket.
- Campaign evidence and the pre-execution Finished email show **Protected**. See [Pre-execution notices](../integrations/pre-execution-notices).
- The SB-PC-2026-001 export stays per-control, so these runs are not in it.

:::note[Alerts stay open]
Alerts matched this way are linked to the run but never auto-resolved, and they never receive the `achilles_correlated` flag, so SentinelOne automatic mitigation never touches them (and Sophos auto-resolve never acknowledges them). Your SOC still sees and triages them.
:::

## 7. Test blocked at launch by the EDR

When an EDR's static or machine-learning prevention blocks the test binary as
it starts, Windows refuses to create the process. The agent reports exit `260`
(`BlockedPreExecution`): it cannot tell that apart from Defender ASR rule
`01443614`, which refuses fresh, low-prevalence binaries and which the platform
deliberately does not count as protection. The EDR's own alert can tell them
apart. After every Microsoft Defender, CrowdStrike, SentinelOne and Sophos poll,
ProjectAchilles looks for that alert and, when it proves the block, rewrites the
`260` result in place as a **Protected** result credited to that EDR.

A `260` result becomes Protected only when **all** of these hold:

- It is a whole-test result, not a stage of a multi-stage run (those stay
  inconclusive), and not a cyber-hygiene test.
- The alert comes from **CrowdStrike, SentinelOne or Sophos**. Microsoft
  Defender alerts never count here: `260` was built for Defender's ASR
  prevalence rule, and an ASR block can't yet be told apart from an antivirus
  block on a Defender alert.
- The EDR itself prevented something: `quarantined`, `process_killed` or
  `blocked`. A failed kill or a detection-only alert does not count, and
  neither does Achilles' own SentinelOne automatic mitigation.
- The alert is on the same host (exact short hostname). If the alert is already
  linked to a test, it is this test.
- The alert names **this run**: a file inside the run's own task folder
  (`C:\F0\tasks\task-<task id>-<n>\`, the exact run, within a day of the
  result), or, when it names no task folder, the test's own binary
  `<test uuid>.exe` created between 5 minutes before and 30 minutes after the
  result. A stage binary such as `<test uuid>-T1105.exe` does not count: the
  test never started, so no stage binary existed.
- The alert has not proved another run. An alert proves at most one run, ever:
  it gets a receipt (`f0rtika.achilles_launch_block_doc_id`) naming that run,
  and an alert that names one run's folder never counts for another run.
- For an alert that only names the binary: it counts for the nearest `260` run
  on that host, and for none when another run of the same test on that host
  (one that ran, or was already resolved) is at least as near to it. Then the
  alert belongs to that run. The same holds when the enrichment pass already
  linked the alert to a run.

The first check after the server starts covers `260` results from the last 90
days, so runs from before an upgrade are reconciled automatically; later checks
cover the last 2 days.

### What changes on the result

- `event.ERROR` becomes `126` (`ExecutionPrevented`) and the result is
  protected. The agent's original code stays on the document in
  `f0rtika.launch_block.original_exit_code` (`260`), next to the vendors, the
  proving alert ids, which evidence matched (`task_path` or `orchestrator`) and
  when it was reconciled. `f0rtika.edr_launch_blocked` is `true`.
- The vendor's flags are set (`<vendor>_detected`, `<vendor>_prevented`,
  `<vendor>_prevention_action`), so the result is attributed to that EDR.
- The proving alerts are linked to the test (`achilles_correlated`), the same
  way the enrichment pass links an alert that names the test's binary. If you
  turned on auto-resolve for that vendor, it resolves them like any other
  correlated alert.

### How it scores

- It counts in the Defense Score as Protected. For a multi-stage test in
  **any-stage** mode it joins that test's latest-basis pair on the host, and
  the newest run wins. In **all-stages** mode pairs are per stage, so a
  multi-stage test's launch block adds no pair; a single-stage test's launch
  block is its own pair.
- It is excluded from every technique view, like an EDR-killed run: technique
  coverage, the ATT&CK matrix, the execution report's technique and tactic
  counts, and the vendors' detection-rate and technique-overlap numbers. No
  stage ran, so no technique can be credited.
- The chain-depth card counts a multi-stage test's launch block as blocked at
  stage 1.
- Executions shows **Protected** with "Blocked before it ran by
  CrowdStrike Falcon" (or the matching product), and the run's detail lists the
  proving alerts.
- Campaign evidence shows **Protected**, naming the EDR, once the result has
  been reconciled.
- The SB-PC-2026-001 export reads only per-control stage documents, so these
  whole-test results are not in it (like EDR-killed runs).

:::caution[Where the run still shows the agent's 260]
The task database keeps the agent's raw result, so these places still show the
run as **Not run** (exit 260) after Analytics shows Protected:

- the Tasks page, its task rows and its 7-day outcome tiles;
- the pre-execution **Finished** email, when it is sent before the next EDR
  poll reconciles the run. Unlike an EDR-killed run, nothing holds the email
  back for a `260`.
:::

:::note[The techniques stay unmeasured]
A launch block proves the EDR stops the test binary before it runs, not how it
handles the techniques the test exercises. That is why the run counts for the
test but never for a technique: the technique views keep showing those
techniques as untested on that host until a run gets past launch.
:::

## Related

- [Defense Score](./defense-score) — how the score is computed
- [Microsoft Defender integration](../integrations/microsoft-defender) — Defender correlation and auto-resolve
- [CrowdStrike Falcon integration](../integrations/crowdstrike) — prevention dispositions, Falcon console deep links
- [Sophos integration](../integrations/sophos#how-sophos-evidence-becomes-a-verdict) — what counts as Sophos prevention versus detection
