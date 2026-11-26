---
sidebar_position: 2
title: "Security Dashboard"
description: "The unified ProjectAchilles dashboard — attention chips, KPI strip, trend overview, testing cadence, threat actor readiness, ATT&CK coverage matrix, fleet health, and the shared time range selector."
---

# Security Dashboard

`/dashboard` is the console's landing page and the single place posture is
summarised across all three data sources — the test library, the endpoint
fleet, and Elasticsearch analytics. It replaced the three separate module
dashboards in 2.1.

![Security Dashboard — attention chips, KPI strip, trend overview, testing cadence, threat actor readiness and ATT&CK coverage matrix](/img/screenshots/security-dashboard.png)

## Time range

The header carries a **24h / 7d / 30d / 90d / All** selector. The range drives
the Defense Score, the trend overview, threat actor readiness and the ATT&CK
matrix, and defaults to **30d**. The test library's sync chip and **Sync**
button are on the **Tests** page header, not here. It is shared with the Analytics section:
changing it on one page changes it on the other, and the choice is remembered
for the browser tab. A custom range picked in Analytics shows here as a
**Custom** chip. For the
Defense Score the range is a **freshness window**: a test × endpoint pair counts
only if its most recent result falls inside it. The trend line shows the same
calculation as of each UTC day and always ends at the tile's value. See
[Defense Score](../analytics/defense-score.md#latest-result-score).

:::tip
Match the range to your schedule. A 7-day window on a monthly schedule shows an
empty chart even though the programme is healthy; pick 90d for monthly bundles.
:::

## Attention chips \{#attention-banner}

Under the header, an **attention** row shows one small chip per issue: a
coloured dot, a count and a short label. Hover a chip for the full sentence;
click it to open the page that resolves it. The row is derived, not stored:

| Chip | Trigger | Links to |
|------|---------|----------|
| `<n> offline` | One or more enrolled agents missed their heartbeat window | `/agents` |
| `<n> stale · 7d` | Agents with no completed task in 7 days | `/agents?stale=true` (the stale filter) |
| `<n> tasks failed · 7d` | Test runs that did not finish, plus failed commands and agent updates, in the last 7 days. A run an EDR stopped is not counted | `/tasks` |
| `<n> outdated` | Agents running an older binary than the newest registered version | `/agents` |
| `library sync failed` | The test library git sync last failed | `/tests` |

Chips are amber, except the sync failure, which is red. When nothing needs
attention the row reads **all clear**.

## KPI strip

Up to seven cards, each reading from a different source so a single outage
degrades one card rather than the page. Each card links to the page behind it:

| KPI | Meaning |
|-----|---------|
| **Defense score (`<range>`)** | Share of test × endpoint pairs whose most recent result in the range was blocked or detected. Renders in danger colour below 60%. The caption reads `<n> pairs · ±d.d pts over <range>`. With fewer than 10 pairs, the score is muted and the caption reads `n=<n> · not enough data`. |
| **Secure score** | Microsoft Defender Secure Score. Reads "not configured" without the integration |
| **ZTA score** | CrowdStrike Zero Trust Assessment score, with the device count. The card appears only when CrowdStrike is configured, and shows a dash when ZTA is not licensed |
| **Sophos Health Check** | The Achilles average of the Sophos Account Health Check scores. The card appears only when Sophos is configured (not on Vercel) |
| **Total tests** | Tests in the library, with an intel-driven count (`<n> intel-driven`) |
| **Avg score** | Mean test score across scored tests |
| **Agents online** | Online / enrolled, with an offline count. Renders in danger colour when any agent is offline |

## Cards

**Trend overview** — Defense Score and error rate, one point per UTC day over
the selected window, on one axis. Secure Score, ZTA score and Sophos Health
Check join as extra lines when their integration is configured. The line under
the title gives the current value of each series.

**Testing cadence** — how recently and how often you are testing. It uses a
fixed recent window and ignores the range selector.

- 14 daily bars (UTC days) of test runs: protected, got through, and
  inconclusive. A multi-stage test's run counts once, protected when any stage
  was blocked or detected, the same rule as the Tasks page; a cyber-hygiene run
  is protected only when every control passed. Upload confirmations are not
  counted
- A "last run Nd ago" chip, in UTC calendar days and measured over all time. It turns warning at 2 to 7
  days and danger above 7 days
- Endpoints tested in the last 7 days, out of enrolled agents
- **Runs · 7d**: test runs with a verdict (protected or unprotected), runs
  with no verdict (not run, failed, test error or inconclusive), and tasks
  running now
- The next scheduled run. It is hidden for roles that cannot read schedules,
  and schedules whose next run time has already passed are ignored

**What moved the score**: follows the shared range and shows which part of a
change in the Defense Score is real. Every failure in the range is sorted into
fixed, still failing, not re-tested and left the score untested, and the first
run of every new attack test into stopped or got through. Each count that is
not zero opens the list of tests and endpoints behind it. Not available on the
serverless (Vercel) deployment. See
[What moved the score](../analytics/defense-score#what-moved-the-score).

**Threat actor readiness** — follows the shared range. For each adversary it
shows the share of protected test × endpoint pairs (latest result, any-stage,
like the Defense Score). The worst actors come first, as many as fit the card
(three to ten), each with its test count and the days since it was last
tested. An actor below 80% is marked **exposed**. "Not tested in `<range>`" ("Never tested" when
the range is All) lists intel-driven library actors with no results (the first
six, then "+N more").

**MITRE ATT&CK coverage** — twelve tactic columns, Initial Access to Impact.
Each technique is a cell under its real ATT&CK tactic (or tactics). Colour is
the share of that technique's test × endpoint results that were stopped
(blocked or detected):

| Colour | Stopped share |
|--------|---------------|
| Stopped | 95% or more |
| Partial | 80% to 94% |
| Got through | Below 80% |
| In library, not run | No results |

Scoring is per stage, so a technique whose stage got through shows as such even
if a sibling stage was blocked. Click a cell to open Analytics filtered to that
technique. The footer names the weakest tactic.

**Top remediation controls** — the Microsoft Defender Secure Score controls
with the highest score impact, each linking to its action in Defender. Reads
"Defender is not configured." without the integration.

**Fleet health** — agents online, 7-day task success rate and mean time
between failures, the fleet split by operating system and agent version, and
counts of stale and outdated agents.

**Recent executions** — the latest finished tasks (completed or failed). A row
opens the Tasks page searched for that test.

## Degradation, not redirects

Every card fetches independently. If Elasticsearch is unconfigured, the
analytics KPIs read "not configured", and the testing cadence, threat actor and
ATT&CK cards show "Connect Elasticsearch" with a "Set up analytics →" link to
Settings, while the library and fleet cards keep working. The dashboard never redirects you away — that was the
main complaint about the old per-module dashboards.

## Related

- **[Console & Navigation](./navigation)** — the shell, shortcuts, and theme
- **[Defense Score](../analytics/defense-score)** — how the score is computed
- **[Task Execution](../agent-management/task-execution)** — the task stream behind the failed-task chip
