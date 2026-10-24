---
sidebar_position: 6
title: "Microsoft Defender"
description: "Read the Microsoft Defender tab in the ProjectAchilles Analytics dashboard — detection rate, Secure Score, alert correlation, and auto-resolve."
---

# Microsoft Defender

When the Microsoft Defender integration is configured, a dedicated **Defender**
tab appears in the Analytics dashboard. It answers one operational question:

> Of the attack simulations we launched, what share did Microsoft Defender catch?

If the integration is not configured the tab is hidden entirely — the
`useDefenderConfig()` hook gates the whole tab so unconfigured users never see
empty panels. To set the integration up, see
[Integrations → Microsoft Defender](../integrations/microsoft-defender).

![Defender tab — Secure Score, Defender Alerts, Detected / Prevented and Auto-Resolve cards above the test execution vs alert volume chart](/img/screenshots/analytics-defender.png)

## Tab Header

The header shows when Defender data was last synced and provides a **Sync Now**
button to trigger an immediate pull from Microsoft Graph instead of waiting for
the next scheduled interval.

## Hero Row

Four tiles summarize posture at a glance:

| Tile | What it shows |
|------|---------------|
| **Secure Score** | Current Microsoft Secure Score as a percentage, raw `current / max` points, the change versus the trend window, and a sparkline. |
| **Defender Alerts** | Total alert count in the window, how many are high-severity, and the change versus the previous 7 days. Click the tile to open the alert drawer for all alerts. |
| **Detected / Prevented** | The headline metric — the share of attack simulations in the selected window that Defender detected (the [Detection Rate](#detection-rate), evidence-based), the share it prevented, how many executions raised an alert and how many were stopped, plus one pip per technique showing whether it drew an alert. |
| **Auto-Resolve** | Current auto-resolve mode (`disabled` / `dry-run` / `enabled`) and recent receipt counts. See [Auto-Resolve](../integrations/defender-auto-resolve). |

:::info Detection Rate is evidence-based
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

The **Test Execution vs Defender Alert Volume** card plots test executions against
alerts on a shared time axis, bucketed by day for windows up to 90 days and by
week beyond that. Alert bars are split into **linked** alerts (the enrichment
pass matched them to an Achilles test) and **organic** alerts (everything else,
including alerts raised by genuine activity). A burst of testing should show up
as a burst of linked alerts; organic alerts are background noise you did not
cause.

## Alert Feed

A full-width feed lists every alert in the window with severity, status,
techniques and the auto-resolve receipt when present. Filter it by **source**
(All / Test / Organic) and by **severity** (the default is "High & medium"; the CrowdStrike tab defaults to "All severities"); the counts on each segment stay
stable as you filter, and the "All" count equals the Alerts tile total. The
summary strip above the feed follows the source you pick but not the severity;
severity only narrows the rows and the page count. A linked alert's **Linked
test** opens the Executions view filtered to that test, or to the bundle when
the alert was matched to a bundle. Click a row to open the alert drawer.

## Technique Coverage

Per-technique table for the window, split into **prevented**, **detected only**
and **missed** executions, with an **Alerts (in window)** column: the number of
distinct Defender alerts in the window tagged with that technique or one of its
sub-techniques, so it matches the drawer the row opens. Detected techniques are listed first. The header total equals the
Detected / Prevented tile's denominator, because both come from the same response.

## Top Remediation Controls

The Defender security controls most relevant to your current gaps. Clicking a
control opens the alert drawer scoped to the techniques that control covers.

## Alert Drill-Down Drawer

Clicking the Defender Alerts tile, a control, or a technique opens the **Alert
Details drawer**. It lists the matching alerts with severity, status, MITRE
techniques, evidence, and — when present — the auto-resolve receipt showing
whether and how the alert was resolved.

## Detection Rate

The Detection Rate is **evidence-based and per-execution**:

```
detectionRate = (prevented + detectedOnly) / executions × 100
```

- **executions** — conclusive attack-simulation executions in the selected
  window. Each execution is counted once, even if it exercises several
  techniques.
- **detected** — the execution's own enrichment flag says Defender caught it. A
  bundle stage counts only by its own per-stage flag, so it is never credited
  because a sibling stage was detected; a standalone test counts by its own
  detection flag. A prevention Defender confirmed always counts as detected.
- **prevented** — Defender confirmed it blocked the execution. **Detected only** is
  detected but not blocked; the rest are **missed**.

:::note Numbers can differ from before
Earlier versions matched alerts to executions by MITRE technique within a
±60-minute window. The tab now reads the per-run flags instead, so rates can
change after this update. The legacy
heuristic is still available from the API for the CLI; see the
[API reference](../../api-reference/defender#technique-coverage).
:::

### Exclusions

Two kinds of document are excluded from the test-execution count because
neither launched an attack Defender could detect:

- **Cyber-hygiene controls** — configuration checks, not attack simulations.
- **Skipped bundle stages** — stages the orchestrator chose not to run (a bundle
  control with exit code `0`), which the Executions table also renders as
  "Skipped".

Every Defender-tab metric that counts executions applies the same exclusions
(`attackSimulationExclusions()`), so "test execution" means the same thing
across the whole tab. The Dashboard tab's [Defense Score](./defense-score)
deliberately does **not** apply them — a passing hardening check legitimately
counts toward that score.

## Conditional Display

Every element of the Defender tab is gated by `useDefenderConfig()`, which
returns `{ configured, loading }`. When `configured` is `false` the tab is not
rendered at all, so users who have not set up the integration see only
Achilles-native analytics.

## See Also

- [Integrations → Microsoft Defender](../integrations/microsoft-defender) — setup and architecture
- [Auto-Resolve](../integrations/defender-auto-resolve) — programmatically resolving correlated alerts
- [Defender API endpoints](../../api-reference/defender)
