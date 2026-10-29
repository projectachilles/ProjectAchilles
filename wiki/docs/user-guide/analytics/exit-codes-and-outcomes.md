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
| `260` | BlockedPreExecution | Blocked before launch by an ASR/app-control **policy** — technique never evaluated | inconclusive |
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
- `260` — a policy block before execution, including the ASR rule the platform
  excludes by design (see
  [Defender ASR exclusion](../../deployment/endpoint-prerequisites#3-defender-asr-per-rule-exclusion-for-cf0)); counting it
  would conflate our own configuration with detection

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
| **Detected** | `*_stage_detected` or `*_detected` | The EDR saw it and alerted, but didn't stop it |
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
- `200` and `260` are excluded from both.

### SB compliance report

Outcomes: `PREVENTED / DETECTED / MISSED / EXPOSED / NOT_RUN / ERROR`.

| Exit | EDR flags | Outcome | Attribution |
|---|---|---|---|
| 105 / 126 / 127 | any | **PREVENTED** | `preventedBy`: vendor(s) |
| 999 / 259 / 0 / none | `crowdstrike_prevented` or `defender_prevented` | **PREVENTED** | `preventedBy`: the preventing vendor(s), both when both flagged |
| 101 / 0 | detected flag(s) | **DETECTED** | `detectedBy`: vendor(s), both when both flagged |
| 101 / 0 | none, tactic ∈ `{exfiltration, impact}` | **EXPOSED** | — |
| 101 / 0 | none, other tactics | **MISSED** | — |
| 200 / 259 / 260 | any | **ERROR** (with "inconclusive" note) | — |
| — (no document) | — | **NOT_RUN** | — |

## 5. Worked examples

| Scenario | Exit | Evidence | Label / SB outcome |
|---|---|---|---|
| Falcon kills the ransomware stage at launch | `0xE0000027` → 999 | Stage-binary alert match, `process_killed` disposition | **Prevented (process killed)** / PREVENTED |
| Defender blocks a stage binary mid-execution | 999 | Stage-binary alert match, `remediationStatus: blocked` | **Prevented (process killed)** / PREVENTED |
| Sibling stage already ran to completion before the kill | 101 | Bundle-wide alert match only | **Detected** / DETECTED — a succeeded stage is never upgraded to Prevented |
| Stage runs, nothing reacts | 101, no alert | none | **Unprotected** / MISSED (or EXPOSED for exfiltration/impact tactics) |
| Stage dies, no alert anywhere | 999, no alert | none | **Inconclusive** / ERROR — a kill is never assumed |
| Defender ASR policy blocks launch | 260 | policy, not detection | **Inconclusive** / ERROR — never counted |
| Defender quarantines at extraction | 105 | — | **Protected** / PREVENTED |
| EDR kills the agent mid-test | `-1` (watchdog) | Same-host alert in the run window, EDR-killed, techniques overlap | **Protected**, stages unknown, not in the SB export (see [section 6](#6-agent-terminated-by-the-edr)). Without an alert there is no Elasticsearch document, so the run is absent from Analytics. The task shows **failed** on the Tasks page, campaigns show **Error** and the Finished email shows **Not run** |

## 6. Agent terminated by the EDR

An EDR can kill the agent process itself in the middle of a test. The agent then never reports a result, and the server's watchdog fails the task as `Agent went offline during execution` or `Task exceeded execution timeout` (exit `-1`, no Elasticsearch document). When an EDR alert proves the kill, ProjectAchilles turns that failure into a **Protected** result. It does this after every Microsoft Defender, CrowdStrike, SentinelOne and Sophos poll, and only against EDRs that are configured.

A watchdog failure becomes a result only when **all** of these hold:

- The alert is on the same host (exact short hostname).
- It was created between the moment the agent picked up the task and the moment the watchdog failed it. If the agent came back (service recovery, a quick reboot) and picked up its next test first, the window ends at that pickup plus 60 seconds, so the next test's alerts never count for the dead one.
- If the alert is already linked to a test (`f0rtika.achilles_test_uuid`), it is this test.
- The EDR itself killed, quarantined or blocked something. Achilles' own SentinelOne automatic mitigation does not count.
- (Sophos) A Sophos alert without ATT&CK techniques can't satisfy the technique-overlap check below. Sophos only supplies techniques through XDR detections, so on a tenant without XDR such a kill stays a failed task instead of becoming Protected.
- The alert's ATT&CK techniques overlap the test's techniques (compared at parent level, so `T1486` matches `T1486.001`).

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

## Related

- [Defense Score](./defense-score) — how the score is computed
- [Microsoft Defender integration](../integrations/microsoft-defender) — Defender correlation and auto-resolve
- [CrowdStrike Falcon integration](../integrations/crowdstrike) — prevention dispositions, Falcon console deep links
- [Sophos integration](../integrations/sophos#how-sophos-evidence-becomes-a-verdict) — what counts as Sophos prevention versus detection
