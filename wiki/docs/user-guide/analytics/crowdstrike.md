---
sidebar_position: 7
title: "CrowdStrike Falcon"
description: "Read the CrowdStrike Falcon tab in the ProjectAchilles Analytics dashboard — detection rate, ZTA posture score, alert correlation, and auto-resolve."
---

# CrowdStrike Falcon

When the CrowdStrike Falcon integration is configured, a dedicated
**CrowdStrike** tab appears in the Analytics dashboard (`?tab=crowdstrike`).
It answers one operational question:

> Of the attack simulations we launched, what share did CrowdStrike Falcon catch?

If the integration is not configured the tab is hidden entirely — the
`useCrowdStrikeConfig()` hook gates the whole tab so unconfigured users never
see empty panels. To set the integration up, see
[Integrations → CrowdStrike Falcon](../integrations/crowdstrike).

## Tab Header

The header shows when CrowdStrike data was last synced and provides a
**Sync Now** button to trigger an immediate pull from the Falcon API instead
of waiting for the next scheduled interval. When Zero Trust Assessment is not
licensed (Falcon Insight required), the header shows a non-blocking notice and
the ZTA tile renders an empty state — the rest of the tab works normally.

## Hero Row

Four tiles summarize posture at a glance:

| Tile | What it shows |
|------|---------------|
| **ZTA Score** | Current Zero Trust Assessment posture score (0–100 average across devices), the change versus the trend window, and a sparkline. Shows a not-licensed empty state when Falcon Insight is unavailable. |
| **CrowdStrike Alerts** | Total alert count in the window, how many are high/critical-severity, and the change versus the previous 7 days. Click the tile to open the alert drawer for all alerts. |
| **Detection Rate** | The headline metric — the share of attack simulations in the selected window that CrowdStrike detected (evidence-based, see [Detection Rate](#detection-rate)), with prevented, detected-only and missed counts. |
| **Auto-Resolve** | Current auto-resolve mode (`disabled` / `dry-run` / `enabled`) and recent receipt counts. See [Auto-Resolve](../integrations/crowdstrike-auto-resolve). |

:::info[Detection Rate is evidence-based]
The Detection Rate comes from the per-run detection flags the enrichment pass
writes onto each test result, not from a technique plus time-window match
against alerts. It is an **organisation-specific operational KPI** — track it
over time for your own tenant, but do not use the absolute number to compare
organisations. The full definition is in [Detection Rate](#detection-rate)
below.
:::

## Date range

The whole tab follows the **Analytics date picker** in the page header. Changing
the range reloads every card (tiles, timeline, alert feed and Technique
Coverage) for the same window, and **Sync Now** refreshes the feed and timeline
as well. The tiles are labelled with the window they cover.

## Correlation Timeline

The **Test Execution vs CrowdStrike Alert Volume** card plots test executions against
alerts on a shared time axis, bucketed by day for windows up to 90 days and by
week beyond that. Alert bars are split into **linked** alerts (the enrichment
pass matched them to an Achilles test) and **organic** alerts (everything else,
including alerts raised by genuine activity). A burst of testing should show up
as a burst of linked alerts; organic alerts are background noise you did not
cause.

## Alert Feed

A full-width feed lists every alert in the window with severity, status,
techniques and the auto-resolve receipt when present. Filter it by **source**
(All / Test / Organic) and by **severity**; the counts on each segment stay
stable as you filter, and the "All" count equals the Alerts tile total. The
summary strip above the feed follows the source you pick but not the severity;
severity only narrows the rows and the page count. A linked alert's **Linked
test** opens the Executions view filtered to that test, or to the bundle when
the alert was matched to a bundle. Click a row to open the alert drawer.

## Technique Coverage

Per-technique table for the window, split into **prevented**, **detected only**
and **missed** executions, with an **Alerts (in window)** column: the number of
distinct CrowdStrike alerts in the window tagged with that technique or one of its
sub-techniques, so it matches the drawer the row opens. Detected techniques are listed first. The header total equals the
Detection Rate tile's denominator, because both come from the same response.

## Alert Drill-Down Drawer

Clicking the CrowdStrike Alerts tile or a technique opens the **Alert Details
drawer**. It lists the matching alerts with severity, status, MITRE
techniques, evidence, deep links into the **Falcon console**
(`falcon.<region>.crowdstrike.com`) for each alert, and — when present — the
auto-resolve receipt showing whether and how the alert was closed.

## Detection Rate

The Detection Rate is **evidence-based and per-execution**:

```
detectionRate = (prevented + detectedOnly) / executions × 100
```

- **executions** — conclusive attack-simulation executions in the selected
  window. Each execution is counted once, even if it exercises several
  techniques.
- **detected** — the execution's own enrichment flag says CrowdStrike caught it. A
  bundle stage counts only by its own per-stage flag, so it is never credited
  because a sibling stage was detected; a standalone test counts by its own
  detection flag. A prevention CrowdStrike confirmed always counts as detected.
- **prevented** — CrowdStrike confirmed it blocked the execution. **Detected only** is
  detected but not blocked; the rest are **missed**.

:::note[Numbers can differ from before]
Earlier versions matched alerts to executions by MITRE technique within a
±60-minute window. The tab now reads the per-run flags instead, so rates can
change after this update. The legacy
heuristic is still available from the API for the CLI; see the
[API reference](../../api-reference/crowdstrike#technique-coverage).
:::

### Exclusions

Two kinds of document are excluded from the test-execution count because
neither launched an attack CrowdStrike could detect:

- **Cyber-hygiene controls** — configuration checks, not attack simulations.
- **Skipped bundle stages** — stages the orchestrator chose not to run (a
  bundle control with exit code `0`), which the Executions table also renders
  as "Skipped".

Every CrowdStrike-tab metric that counts executions applies the same
exclusions (`attackSimulationExclusions()`), so "test execution" means the
same thing across the whole tab — identical semantics to the
[Microsoft Defender](./microsoft-defender) tab. The Dashboard tab's
[Defense Score](./defense-score) deliberately does **not** apply them — a
passing hardening check legitimately counts toward that score.

## Conditional Display

Every element of the CrowdStrike tab is gated by `useCrowdStrikeConfig()`,
which returns `{ configured, loading }`. When `configured` is `false` the tab
is not rendered at all, so users who have not set up the integration see only
Achilles-native analytics.

## See Also

- [Integrations → CrowdStrike Falcon](../integrations/crowdstrike) — setup and architecture
- [Auto-Resolve](../integrations/crowdstrike-auto-resolve) — programmatically closing correlated alerts
- [CrowdStrike API endpoints](../../api-reference/crowdstrike)
