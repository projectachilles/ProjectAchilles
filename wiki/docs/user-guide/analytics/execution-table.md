---
sidebar_position: 3
title: "Execution Table"
description: "Browse and filter test execution results in the paginated Execution Table."
---

# Execution Table

The Execution Table is the **All Executions** tab of Analytics. It has two views, chosen with the **View** switch above it:

- **Matrix** — the latest result of every test on every host, one row per test. It answers "where am I exposed now".
- **List** — every run, newest first, with sorting, bulk actions and export. It is the page as it was before the matrix, and the only view on a server that does not provide the matrix (`backend-serverless`).

The matrix is the default, and your last choice is remembered in your browser. A link to one run (`?expanded=<id>`) and a click on the dashboard's Outcome breakdown card open the List, because both select or filter runs, not pairs. Clicking **Matrix** from there drops that selection or filter.

## Activity strip

Above both views, a short row of bars shows **when the runs happened**: one bar per stretch of time, as tall as its runs are many, coloured by outcome. Red is unprotected (at the bottom), grey is no verdict, green is protected. A run is one test on one host; a multi-stage test counts once, with the verdict of its whole chain.

- **Buckets follow the date range:** hours for 48 hours or less, days up to 62 days, weeks (from Monday) beyond. They are cut in your browser's time zone. A range longer than a year shows its last 365 days.
- **Click a bar to narrow the page to it.** The matrix, the list and the export then read only that hour, day or week. The strip keeps showing the whole range with the bar marked, so the next day is one click away. Click the bar again, or the chip beside the strip, to clear it.
- **The bars are whole hours, days or weeks.** With "Last 30 days" the first bar is the full first day, so it can include runs from a few hours before the range starts.
- **Keyboard:** the strip is one stop for Tab; the left and right arrows move between the bars, Enter selects. The line under the strip writes out the bar under the focus or the pointer ("Nov 18: 42 runs, 10 unprotected, 2 no verdict, 30 protected").
- **A quiet range has no bars.** With fewer than three hours, days or weeks holding runs, the strip is one line that names them ("Runs on 2 days in this window: Nov 16 · 12 runs, Nov 23 · 4 runs"), each a button that narrows the page the same way. With no run at all there is no strip.
- **What the strip follows:** the date range and every filter of the filter bar except the outcome filters (result, error name, error code, the Outcome chip). It shows the split by outcome itself, so with an outcome filter set a bar can count more runs than the list shows; the list says so.
- The selected bar is in the address (`bucketFrom`, `bucketTo`), so a link narrows the same way. It is dropped when you change the date range or leave the tab. **Archive by date ignores it**, as it ignores every filter.

The counts are the same runs, by the same rules, as the Dashboard's test cadence card. The strip is not shown on a server that does not provide it (`backend-serverless`).

## Matrix view

Each row is one test, with its name written once and one mark per host. Hosts keep the same order in every row, most exposed first, so a weak host is a column and a hard test is a row.

| Mark | State | Meaning |
|------|-------|---------|
| ✓ green | Protected | The latest conclusive result was blocked, or the EDR prevented it. |
| ▲ amber | Detected | The test ran and an EDR alert named it; nothing stopped it. |
| ✕ red | Unprotected | The test ran and nothing alerted. |
| ? grey | No verdict | The test ran on this host in the window, with no conclusive result. |
| ⊘ blue | Risk accepted | A risk acceptance covers every result of this test on this host. |
| dashed, empty | Never run | The host has results in the window, none for this test. |

The states are the Defense Score's: the same latest result per test and host, counted the same way. A test whose newest run has no verdict keeps showing its older conclusive result. A multi-stage attack is one mark per host. Under each name, "caught on x of y hosts" counts protected and detected among the hosts with a verdict.

**Cyber-hygiene bundles** are one row each. A bundle has no single state per host, so its mark is a gauge filled to the share of compliant controls, with the numbers on wide marks ("31/48"). No threshold turns a gauge green or red: the fill is the share.

**How much a mark shows depends on the room each host gets.** A few hosts get tiles with the result's age and a dot for each earlier result (up to six, one per day, newest first), under their hostnames. More hosts get smaller tiles with the glyph only, then small squares; the mark under the pointer or the keyboard focus is written out in a line above the matrix (test, host, state and age). When the hosts no longer fit, or the fleet is above 150 hosts, each test becomes one bar with the number of hosts per state and "n never run". Click a count on a bar to list the hosts in that state. A bundle's bar counts controls, not hosts, so its counts are not clickable; **Show hosts** under it lists the bundle's hosts with their compliant and evaluated controls.

**Opening a result.** Click a mark to list that test's runs on that host under the row, newest first, with each chain run's stages as squares. The run the mark shows opens in a panel on the right with the full run detail described below (attack chain, stages, EDR evidence, test version, **Accept risk**, **Archive**). That is the latest run with a verdict; a newer run that only failed is listed above it. `↑` / `↓` or the panel's arrows move between the runs of that pair and `Esc` closes the panel; the ✕ on the list of runs closes the pair. The open pair and run are kept in the address, so a link reopens them in the matrix (a run beyond the pair's newest 25 opens the pair without the panel).

**Keyboard.** The matrix is one stop for the `Tab` key. Inside it, `←` / `→` move along a test's hosts and `↑` / `↓` to the same host in the test above or below; `Enter` opens the mark.

**Filters.** The filter bar's scope applies (organization, date range, tests, hosts, techniques, categories, tags, threat actors, bundles). Outcome filters (result, error name, error code, the Outcome chip, the Version filter) narrow the List only; the matrix says so when a result or error filter is set. A machine with no result in the window is not a column.

**Rows of hosts.** The **Rows** switch turns the matrix: one row per host, most exposed first, with one mark per test under the tests' names, and "caught on x of y tests" under each hostname. It answers "what is this host exposed to", and it is the way to read marks on a fleet too large for rows of tests, which become bars. Hosts are listed 25 at a time, with **Show more**. Where a host's tests do not fit as squares, the rows scroll sideways inside the card and the hostnames stay in view. A click on a mark opens the same runs and panel; a link to a pair whose host is further down the list shows its runs above the rows. Turning the matrix closes the open pair. The choice is kept in the address and remembered in your browser.

**Export and Archive by date** are above both views. Export follows the filter bar: every matching result, newest first, including the outcome filters the matrix itself ignores. **Archive by date does not follow the filters:** it archives every execution before the date you pick, and its dialog says so. After it the matrix is read again. **Sorting and bulk accept-risk and archive** are in the List view.

:::note
The screenshot below shows the List view. A screenshot of the Matrix view will be added.
:::

## List view features

- **Master-detail layout** — runs on the left, the selected run's detail on the right. `↑` / `↓` move the selection, and the selected run is kept in the URL (`?expanded=<id>`), so a link opens straight to it
- **Pagination** — 10, 25, 50 or 100 runs per page. The toolbar shows the number of runs (groups) and of results (documents)
- **Sorting** — Sort by time, test name, hostname, result, category or score, ascending or descending
- **Advanced filtering** — Filter by result, hostname, category, threat actor, tags, error name, error code, bundle, test, technique and date range
- **Outcome chip** — Opening the table from the dashboard's Outcome breakdown card filters it to that outcome (Protected, Prevented, Detected only or Silent). An "Outcome: …" chip above the table removes the filter
- **Test version** — each run shows the short commit of the test it ran and its state, compared with the test as it is synced now: **current**, **older**, **version unknown** or **not recorded**. The run's detail has a **Test version** block, the **Version** filter narrows the list to one state, and the CSV ends with the columns `version` and `version_state`. See [Test Versions](../test-browser/test-versions#versions-on-results)
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
