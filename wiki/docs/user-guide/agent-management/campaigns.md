---
sidebar_position: 6
title: "Campaigns"
description: "Save a test plan of tests and agents, run it with one click, and export an evidence matrix."
---

# Campaigns

A **campaign** is a saved test plan: a set of tests crossed with a set of agents. You run it with one click, and ProjectAchilles produces an **evidence matrix** (one cell per test and host) that you can read on screen, export as CSV, or print.

![Campaigns: saved plans with their framework label, size, last result, and the expanded run history of one campaign](/img/screenshots/campaigns.png)

Use campaigns when you need repeatable, auditable proof of what was tested and what the controls did, for example for a compliance review or a quarterly validation. A campaign is also optionally labelled with a **framework label** (for example `ISO 27001 A.8`) that is carried onto the evidence page.

:::info[Availability]
Campaigns are available on self-hosted deployments (Docker, Render, Fly.io, Railway, public and on-prem servers). They are not available on Vercel; the **Campaigns** menu entry is hidden when the deployment does not support them.
:::

## Creating a Campaign

1. Open **Campaigns** in the navigation
2. Click **New campaign**
3. Fill in:
   - **Name** (required, 1-120 characters, unique within your organization)
   - **Description** (optional, up to 2000 characters)
   - **Framework label** (optional, up to 120 characters)
   - **Tests** to include (1 to 100)
   - **Hosts**: the agents to target (at least 1)
4. Save

![Edit campaign dialog: name, framework label, description, then searchable test and host pickers](/img/screenshots/campaign-editor.png)

Editing a campaign changes the plan for future runs only. Existing runs keep the plan they started with (see [Evidence snapshots](#evidence-snapshots)).

Every agent you pick must belong to your organization, and every test must exist in the test library.

## Running a Campaign

Click **Run** on a campaign. A dialog first checks the plan against the current state of the library and fleet and shows how many tasks will be created.

### Skipped pairs

Some test and host pairs cannot run. They are listed in the dialog with the reason:

| Reason | Meaning |
|--------|---------|
| `not built` | The test has never been built |
| `no <os> binary` | The test has no build for the host's operating system |
| `binary missing on server` | The build is recorded but the file is gone from the server |
| `agent <status>` | The agent is not `active` (for example `agent disabled` or `agent decommissioned`) |
| `removed from library` | The test is no longer in the test library |

:::warning[Deleted or moved agents block the run]
If an agent in the campaign was deleted, or now belongs to a different organization, the launch fails with `Agent <id> does not belong to your organization`. This is not a skip: **Run the rest** cannot run around it. The dry-run preview may list such an agent as `agent deleted` or `agent not in organization`, but you must edit the campaign and remove the agent before you can run it. (Without organizations, only a deleted agent blocks.)
:::

If anything else is skipped, the launch is refused the first time (the API answers `409`) and the dialog asks you to confirm. Choose **Run the rest** to dispatch only the pairs that can run, or cancel and fix the plan. Skipped pairs show as **N/A** in the matrix, with the reason on hover. If every pair is skipped, nothing runs.

### Pre-execution notices

When [pre-execution notices](../integrations/pre-execution-notices) are enabled, the dialog says so. A campaign sends **one** notice for the whole run (not one per test or host), and the tasks wait until the notice is released. The launch is a single all-or-nothing operation whether notices are on or off: either the run, its tasks, and its notice are all created, or none are.

### Limits

| Limit | Value |
|-------|-------|
| Tests per campaign | 100 |
| Agents per campaign | at least 1 |
| Tasks per run | 5,000 (a run that would exceed this is rejected) |
| Name | 120 characters |
| Description | 2000 characters |
| Framework label | 120 characters |

After you confirm, you are taken to the run's evidence page. Retries of a task (manual or automatic) stay attached to the run.

## Reading the Matrix

The evidence page shows one cell per test and host. **Whichever list is longer runs down the side**: with more hosts than tests (the usual case), hosts are rows and tests are columns; otherwise tests are rows. The first column and the header row stay in place while you scroll. The last column and the bottom row show how many results were protected per host and per test (for example `3/4`), and the bottom-right corner shows the run's % protected.

![Campaign run evidence page: who started it, the pre-execution notice, progress, outcome counts, and the test x host matrix with per-test and per-host totals](/img/screenshots/campaign-run.png)

The page refreshes every 15 seconds while anything is still in flight, and shows the **As of** time it was computed and which EDR integrations the outcomes reflect (for example `EDR results from Microsoft Defender`).

The header records who started the run (their name and email, looked up when the run starts; runs that stored only a user id show the name when displayed) and when, plus the pre-execution notice record:

| Notice record | Shown as |
|---------------|----------|
| Notice sent | `Notice PA-RUN-xxxxxx sent <local time> to a@example.com, b@example.com` |
| Released without notice | `Notice PA-RUN-xxxxxx released without notice by <user> at <time>: <reason>` |
| Notices were off at launch | `No pre-execution notice (notices off)` |

A notice that is still pending, not delivered, or skipped shows its run tag and state. The same header appears on the printed page.

Completed cells use **the same labels and order as Analytics → All Executions**:

| State | Meaning |
|-------|---------|
| **Protected** | A stage (or the test) was blocked: exit code 105, 126 or 127 |
| **Prevented** | Nothing reported a block, but Microsoft Defender or CrowdStrike Falcon reported that it prevented the activity (quarantined, process killed, or blocked) |
| **Detected** | Defender or CrowdStrike raised an alert for the test, but nothing was blocked or prevented |
| **Unprotected** | At least one stage ran without being blocked (exit code 101), and no EDR alert matched |
| **Error** | No stage reached a verdict and no EDR alert matched: for example exit code 999 (prerequisites not met), 1, 259 or 260, or the task failed. A 260 that an EDR's own alert proves was the EDR blocking the launch shows **Protected** instead ([Exit Codes & Outcomes](../analytics/exit-codes-and-outcomes#7-test-blocked-at-launch-by-the-edr)) |
| **Waiting for notice** | The task is queued and the pre-execution notice has not been released yet |
| **Running** | Queued (no notice), assigned, downloading, or executing |
| **Not run** | The task expired (the reason shows on hover), or there is no task for the pair |
| **N/A** | Skipped at launch |

**Hover a cell** for its reason and, for multi-stage tests, each stage's exit code, for example:

```
Defender prevented it (process killed) during stage 2 (T1572). Stage 2 (T1572) reported a test error (999, prerequisites not met). Stage 3 (T1005) skipped.
Stage 1 (T1105): 101
Stage 2 (T1572): 999
Stage 3 (T1005): skipped
```

Cyber-hygiene bundles are judged by their overall result, and the reason counts compliant controls (`47 of 52 controls compliant; 5 not.`).

EDR alerts reach ProjectAchilles a few minutes after a run (the Defender sync runs every 5 minutes), so a cell can move from **Unprotected** to **Detected** or **Prevented** shortly after the test finishes. If Elasticsearch cannot be reached, the page says `EDR results unavailable` and falls back to exit codes alone. See [Exit Codes and Outcomes](../analytics/exit-codes-and-outcomes) for the exit-code rules.

When a pair has more than one attempt in the run (a retry), the cell shows the **latest** attempt.

### % protected

```
% protected = (Protected + Prevented + Detected) / (Protected + Prevented + Detected + Unprotected)
```

rounded to a whole number. This is the same basis as the Defense Score, which counts an EDR-detected result as protected. Running, Error, Not run and N/A cells are **not** counted, so errors and skipped pairs never inflate or deflate the score. Until at least one cell has a verdict, the value is shown as a dash.

## Exporting Evidence

- **Download CSV** produces one row for **every** test and host pair, including skipped and not-run pairs, with the columns `test, techniques, host, os, outcome, exit_code, reason, completed_at, as_of, stages, edr`.
  - `outcome` is the cell state: `protected`, `prevented`, `detected`, `unprotected`, `error`, `not_run`, `running`, `waiting_for_notice`, or `na` for a pair skipped at launch.
  - `reason` explains every outcome, using the same text as the hover.
  - `stages` lists each stage's exit code, for example `1:101 2:999 3:skip`, or the compliant-control count for a cyber-hygiene bundle.
  - `edr` summarizes what the EDR reported, for example `Defender: prevented (process killed)` or `Defender: alert raised`, or `unavailable` when Elasticsearch could not be reached.
  - `exit_code` is empty for `na` and `not_run` pairs.
  - `stages` and `edr` were added at the end of each row, so files read by position before they existed still parse.
  - The file name includes the as-of time, for example `campaign-run-<run-id>-20261023T1405Z.csv`, so two exports of the same run are distinguishable.
- **Print** opens the browser print dialog with a landscape, light-theme layout, suitable for saving as PDF. The column header repeats on every page and rows never split across pages. When there are more than 12 columns, they print in blocks of 12, each block starting a new page and repeating the first column. Reasons are in the CSV, not on paper.

Every export carries the **as-of** time: the moment the evidence was read. A run that is still in progress will change on the next export.

## Run history

- **Per campaign**: click **Runs** on a campaign to list its runs, newest first, with the start time, who started it, the task count and % protected. Each run links to its evidence page.
- **All runs**: the **All runs** tab on the Campaigns page lists every run in your organization, newest first, including runs of campaigns that have since been deleted. Those carry a **deleted campaign** marker, and this tab is how you reach their evidence.

Both lists show 25 runs at a time; **Show more** loads the next page.

## Evidence snapshots

When a run starts, it stores a snapshot of the plan: the campaign name, framework label, the test and host lists, the skipped pairs, and the name of the user who started it. Editing or **deleting** the campaign afterwards never changes a past run. Runs of a deleted campaign remain readable from the **All runs** tab, where they carry a **deleted campaign** marker.

## Permissions and Organizations

Viewing campaigns and runs requires the endpoint task **read** permission. Creating, editing, deleting and running campaigns requires the task **create** permission, the same as dispatching tasks.

A campaign always belongs to a single organization, and runs, notices and tasks inherit it. A cross-organization campaign or run behaves as not found. When `REQUIRE_ORG_ISOLATION` is enabled, callers without an organization are rejected with `403` on every campaign route.

## What Campaigns Don't Do (v1)

- No recurring schedule (use [Task Scheduling](./task-scheduling) for that; a campaign is run on demand)
- No run comparison or trend across runs
- No cancelling a run once it has started
- No dynamic membership such as "all Windows hosts" (agents are picked explicitly)
- No PDF generation on the server (use the browser's print-to-PDF)
- Not available on Vercel deployments

For endpoint details see the [Campaigns API](../../api-reference/campaigns).
