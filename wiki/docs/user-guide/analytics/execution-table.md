---
sidebar_position: 3
title: "Execution Table"
description: "Browse and filter test execution results in the paginated Execution Table."
---

# Execution Table

The Execution Table provides a paginated, filterable view of all test execution results stored in Elasticsearch.

## Features

- **Pagination** — Navigate through results with configurable page size
- **Sorting** — Sort by timestamp, test name, hostname, exit code, or severity
- **Advanced filtering** — Filter by technique, hostname, threat actor, tags, error codes, and date range

## Shared FilterBar

The Execution Table shares its filter bar with other Analytics dashboard tabs, providing a unified filtering experience.

![Executions — master-detail view with grouped bundle runs on the left and the selected run's attack chain and per-stage results on the right](/img/screenshots/executions-table.png)

## Bundle Results

Tests that produce per-control results (cyber-hygiene bundles, multi-stage tests) are grouped under collapsible parent rows:

- **Parent row** shows the bundle name, a "X/Y Protected" summary badge, and an item count badge
- **Expanding** reveals individual sub-rows with per-control results
- **Skipped stages** (non-cyber-hygiene with exit code 0) show a "Skipped" label
- **Standalone tests** render as flat rows

### Multi-stage run detail

Selecting a multi-stage run (any non-cyber-hygiene bundle, such as an intel-driven attack chain) opens a run detail built around the chain:

- **Run header** — Test UUID, score, target, complexity and tags appear once, with a results line such as "1 protected · 1 detected · 2 unprotected · 1 inconclusive" (zero counts are omitted).
- **Attack chain strip** — one node per stage, coloured by outcome. Click a node to open that stage.
- **Stage rows** — numbered in stage order, showing technique ID · ATT&CK technique name · tactic. An **MDE** or **CS** chip appears when a Defender or CrowdStrike alert names that stage's binary.
- **Stage detail** — a plain-language verdict, the result code, a link to the ATT&CK technique, **What this stage does** (when available), **EDR evidence for this stage**, **View test details** and **Accept risk**.

Stage verdicts:

| Outcome | Verdict |
|---------|---------|
| Protected | Stopped by endpoint protection: blocked or quarantined before the stage could finish. |
| Prevented | The EDR (Defender, CrowdStrike or both) reports a quarantine, process kill or block after the stage ran. |
| Detected | Ran to completion; an EDR alerted but did not stop it. |
| Unprotected | Ran to completion with no block and no alert. |
| Stage not run (exit 260) | A control, usually an ASR prevalence rule, blocked the test binary before it ran. The technique was not tested and is not scored as protected. |
| Inconclusive | The stage ended with an error and counts as neither protected nor unprotected. If the stage's EDR reports a prevention action, that vendor and action are named as the likely cause; scoring is unchanged. |
| Did not run | The chain stopped at the nearest earlier stage that ran, and the verdict says why: a control blocked it, a control blocked its test binary before it ran, or it ended with an error. If that stage ran to completion (detected or unprotected), the verdict just says the chain stopped before this stage. |

The verdicts are explanatory only; they do not change scoring. The exact rules and wording live in `frontend/src/pages/analytics/components/executions/stageVerdict.ts`.

**"What this stage does"** needs three things: the test library change that writes a `description` per stage must be merged and the tests rebuilt, endpoints must run an agent release that includes it (the release after 0.6.7), and the run must be new. Older runs simply show no description.

Cyber-hygiene bundles keep the per-control ratio bar and rows described above.

## Archiving

Use the **Archive** button to move old execution results out of active views. Archived results are still queryable but hidden from the default view.
