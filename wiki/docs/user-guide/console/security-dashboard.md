---
sidebar_position: 2
title: "Security Dashboard"
description: "The unified ProjectAchilles dashboard — attention banner, KPI strip, trend overview, testing cadence, threat actor readiness, ATT&CK outcome matrix, fleet health, and the shared time range selector."
---

# Security Dashboard

`/dashboard` is the console's landing page and the single place posture is
summarised across all three data sources — the test library, the endpoint
fleet, and Elasticsearch analytics. It replaced the three separate module
dashboards in 2.1.

![Security Dashboard — attention banner, KPI strip, trend overview, testing cadence, threat actor readiness and ATT&CK outcome matrix](/img/screenshots/security-dashboard.png)

## Time range

The header carries a **24h / 7d / 30d / 90d / All** selector plus a git sync
chip and a manual refresh. The range drives the Defense Score and the trend
overview, and defaults to **30d**. It is shared with the Analytics section:
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

## Attention banner

When something needs a human, a warning strip appears above the KPI row with
one link per issue. It is derived, not stored — each item links to the page
that resolves it:

| Item | Trigger | Links to |
|------|---------|----------|
| Agents offline | One or more enrolled agents missed their heartbeat window | `/agents` |
| Stale agents | Agents with no task in 7 days | `/agents` |
| Failed tasks | Task failures in the last 24 hours | `/tasks` |
| Outdated agents | Agents running an older binary than the newest registered version | `/agents` |
| Sync failures | The test library git sync last failed | `/tests` |

No banner means nothing crossed a threshold.

## KPI strip

Up to six cards, each reading from a different source so a single outage
degrades one card rather than the page:

| KPI | Meaning |
|-----|---------|
| **Defense Score** | Share of test × endpoint pairs whose most recent result in the range was blocked or detected. Renders in danger colour below 60%. The caption reads `<n> pairs · ±d.d pts over <range>`. With fewer than 10 pairs, the score is muted and the caption reads `n=<n> · not enough data`. |
| **Secure Score** | Microsoft Defender Secure Score, when the integration is configured |
| **ZTA Score** | CrowdStrike Zero Trust Assessment score, when the integration is configured and licensed |
| **Total tests** | Tests in the library, with an intel-driven count (`<n> intel-driven`) |
| **Avg score** | Mean test score across scored tests |
| **Agents online** | Online / enrolled, with an offline count |

## Cards

**Trend overview** — Defense Score, Secure Score, and error rate on one
30-day-rolling axis over the selected window.

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
- Tasks in the last 24 hours: done, failed, and running
- The next scheduled run. It is hidden for roles that cannot read schedules,
  and schedules whose next run time has already passed are ignored

**Threat actor readiness** — follows the shared range. For each adversary it
shows the share of protected test × endpoint pairs (latest result, any-stage,
like the Defense Score). The worst actors come first, up to seven. An actor
below 80% is marked **exposed**. "Not tested in `<range>`" ("Never tested" when
the range is All) lists intel-driven library actors with no results (the first
six, then "+N more").

**ATT&CK outcome matrix** — twelve tactic columns, Initial Access to Impact.
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

**Fleet health** and **recent executions** round out the page; a recent
execution links straight to `/analytics?expanded=<id>`, opening that run in the
executions master-detail view.

## Degradation, not redirects

Every card fetches independently. If Elasticsearch is unconfigured, the
analytics KPIs read "not configured", and the testing cadence, threat actor and
ATT&CK cards show "Connect Elasticsearch" with a "Set up analytics →" link to
Settings, while the library and fleet cards keep working. The dashboard never redirects you away — that was the
main complaint about the old per-module dashboards.

## Related

- **[Console & Navigation](./navigation)** — the shell, shortcuts, and theme
- **[Defense Score](../analytics/defense-score)** — how the score is computed
- **[Task Execution](../agent-management/task-execution)** — the task stream behind the failed-task banner
