---
sidebar_position: 3
title: "Execution Table"
description: "Browse and filter test execution results in the paginated Execution Table."
---

# Execution Table

The Execution Table is the **All Executions** tab of Analytics: a paginated, filterable view of all test execution results stored in Elasticsearch.

## Features

- **Master-detail layout** — runs on the left, the selected run's detail on the right. `↑` / `↓` move the selection, and the selected run is kept in the URL (`?expanded=<id>`), so a link opens straight to it
- **Pagination** — 10, 25, 50 or 100 runs per page. The toolbar shows the number of runs (groups) and of results (documents)
- **Sorting** — Sort by time, test name, hostname, result, category or score, ascending or descending
- **Advanced filtering** — Filter by result, hostname, category, threat actor, tags, error name, error code, bundle, test, technique and date range
- **Outcome chip** — Opening the table from the dashboard's Outcome breakdown card filters it to that outcome (Protected, Prevented, Detected only or Silent). An "Outcome: …" chip above the table removes the filter
- **Export** — CSV, JSON, the [PDF report](./execution-report) and the SB Export. CSV and JSON hold every matching result, not only the current page, up to 10,000. See [Data Export](./defense-score#data-export)
- **Bulk actions** — Tick runs to accept risk or archive them together

## Shared FilterBar

The Execution Table shares its filter bar and date range with the Analytics **Dashboard** tab. Open it with the **Filters** button in the page header. See [Filtering](./defense-score#filtering).

![Executions — master-detail view with grouped bundle runs on the left and the selected run's attack chain and per-stage results on the right](/img/screenshots/executions-table.png)

## Bundle Results

Tests that produce per-control results (cyber-hygiene bundles, multi-stage tests) are grouped under collapsible parent rows:

- **Parent row** shows the bundle name, a "X/Y Protected" summary badge, and an item count badge. For cyber-hygiene runs, Y is the number of assessed controls; not-assessed controls are excluded and counted separately below the summary
- **Cyber-hygiene summary colors** are green when all assessed controls are protected, amber when detection or an inconclusive result leaves the assessment incomplete without confirmed exposure, and red when any control is exposed. Runs with no assessed controls use a neutral "Not assessed" label
- **Expanding** reveals individual sub-rows with per-control results
- **Not assessed controls** (`skipped: true` with exit code 0) show "Not assessed" for cyber-hygiene and "Skipped" for other categories; legacy non-cyber-hygiene exit-0 stages also show "Skipped"
- **Unmarked cyber-hygiene exit-0 controls** remain inconclusive rather than being treated as not assessed
- **Standalone tests** render as flat rows

### Multi-stage run detail

Selecting a multi-stage run (any non-cyber-hygiene bundle, such as an intel-driven attack chain) opens a run detail built around the chain:

- **Run header** — Test UUID, score, target, complexity and tags appear once, with a results line such as "1 protected · 1 detected · 2 unprotected · 1 inconclusive" (zero counts are omitted).
- **Attack chain strip** — one node per stage, coloured by outcome. Click a node to open that stage.
- **Stage rows** — numbered in stage order, showing technique ID · ATT&CK technique name · tactic. An EDR chip (for example **CS alert** or **SX alert**) appears when a Defender, CrowdStrike, SentinelOne or Sophos alert names that stage's binary. The binary counts when it is the process the alert fired on or the one that started it: most alerts fire on a Windows program the stage ran (`cmd.exe`, `powershell.exe`, `rundll32.exe`).
- **Stage detail** — a plain-language verdict, the result code, a link to the ATT&CK technique, **What this stage does** (when available), **EDR evidence for this stage**, **View test details** and **Accept risk**.

Stage verdicts:

| Outcome | Verdict |
|---------|---------|
| Protected | Stopped by endpoint protection: blocked or quarantined before the stage could finish. |
| Prevented | An EDR (Defender, CrowdStrike, SentinelOne or Sophos) reports a quarantine, process kill or block after the stage ran. |
| Detected | Ran to completion; an EDR alerted but did not stop it. |
| Unprotected | Ran to completion with no block and no alert. |
| Stage not run (exit 260) | Something refused to start the stage's binary: an EDR/AV, or an application-control rule such as an ASR prevalence rule. The technique was not tested and is not scored as protected. (When a whole test is blocked at launch and the EDR's own alert confirms it, the run shows **Protected**, "Blocked before it ran by &lt;EDR&gt;"; see [Exit Codes & Outcomes](./exit-codes-and-outcomes#7-test-blocked-at-launch-by-the-edr).) |
| Inconclusive | The stage ended with an error and counts as neither protected nor unprotected. If the stage's EDR reports a prevention action, that vendor and action are named as the likely cause; scoring is unchanged. |
| Did not run | The chain stopped at the nearest earlier stage that ran, and the verdict says why: a control blocked it, a control blocked its test binary before it ran, or it ended with an error. If that stage ran to completion (detected or unprotected), the verdict just says the chain stopped before this stage. |

The verdicts are explanatory only; they do not change scoring. The exact rules and wording live in `frontend/src/pages/analytics/components/executions/stageVerdict.ts`.

**"What this stage does"** needs three things: the test library change that writes a `description` per stage must be merged and the tests rebuilt, endpoints must run an agent release that includes it (the release after 0.6.7), and the run must be new. Older runs simply show no description.

Cyber-hygiene bundles keep the per-control ratio bar and rows described above.

### Related EDR alerts

- **Multi-stage runs**: a stage's **EDR evidence for this stage** lists only the
  alerts that name that stage's binary. Alerts that name the test but no
  particular stage are listed once, at run level.
- **Standalone tests** have no stages, so their run detail lists every
  correlated Defender, CrowdStrike, SentinelOne and Sophos alert.
- **No related … alerts within the time window** means the lookup ran and
  matched nothing. **Couldn't load … alerts. Select the run again to retry.**
  means the lookup itself failed (for example an HTTP error); selecting the
  run or stage again asks again.

### Runs terminated by the EDR

When an EDR kills the agent mid-test and an alert proves it, the run appears as one row with outcome **Protected** and the stages marked **unknown**; there is no per-stage detail because the agent never reported any. See [Exit Codes & Outcomes](./exit-codes-and-outcomes#6-agent-terminated-by-the-edr) for the evidence rule.

## Archiving

Archiving moves execution results out of the results indices into a separate Elasticsearch index, named `archived-` plus the index pattern's prefix (`archived-achilles-results` by default). Three ways:

- **Archive** in a run's detail panel
- **Archive selected** after ticking several runs
- **Archive by date**, which archives every execution before the date you pick

Archived results no longer appear in the table, the dashboard, the scores or the [execution report](./execution-report). The documents stay in the archive index, where you can query them in Elasticsearch; the console has no view or restore for them. Archiving needs the `analytics:executions:archive` permission, and the Elasticsearch API key must be allowed to create and write the archive index.
