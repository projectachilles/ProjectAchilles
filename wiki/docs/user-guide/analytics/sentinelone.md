---
sidebar_position: 8
title: "SentinelOne"
description: "Read the SentinelOne tab in the ProjectAchilles Analytics dashboard — detection coverage, alert correlation, agent health, protection policy and exclusion gaps."
---

# SentinelOne

When the SentinelOne integration is configured, a dedicated **SentinelOne**
tab appears in the Analytics dashboard (`?tab=sentinelone`). Like the
[CrowdStrike tab](./crowdstrike), it answers one operational question:

> Of the attack simulations we launched, what share did SentinelOne catch?

It also shows the SentinelOne posture that explains the answer: agent health,
protection policy per scope, and missed tests that sit under an exclusion.

If the integration is not configured the tab is hidden entirely: the
`useSentinelOneConfig()` hook gates the tab, so unconfigured users never see
empty panels. The integration exists only on Docker-style backends; on Vercel
the tab never appears. To set it up, see
[Integrations → SentinelOne](../integrations/sentinelone).

## Tab Header

The header shows when SentinelOne data was last synced (the later of the
threat and detection-alert checkpoints) and a **Sync Now** button. The sync
runs in the background on the server; the button stays busy while the tab
polls the sync status, and the cards reload when the sync finishes. When the
last sync failed, the header shows the failing stage and error.

## Date range

The whole tab follows the **Analytics date picker** in the page header.
Changing the range reloads the tiles, timeline, alert feed, Technique Coverage
and the exclusion check for the same window. The agent health and protection
policy cards show the latest posture snapshot and don't depend on the range.

## Hero Row

| Tile | What it shows |
|------|---------------|
| **SentinelOne Alerts** | Alerts (threats and detection alerts) in the window, how many are linked to Achilles tests versus organic, a severity bar, and the change versus the previous 7 days. Click it to jump to the alert feed. |
| **Detected / Prevented** | The share of attack simulations in the window that SentinelOne detected, and the share it prevented, from the same response as the Technique Coverage card (see [Detection rate](#detection-rate)). |
| **Agent response** | How many alerts in the window SentinelOne **prevented** (killed, quarantined or otherwise mitigated), how many were **detected only**, and how many had a failed mitigation. Read from the prevention action recorded on each threat; detection alerts carry none, so they count as detected only. A threat that Achilles [automatic mitigation](../integrations/sentinelone-auto-resolve#automatic-mitigation) killed or quarantined also counts as detected only. |

SentinelOne has no Zero Trust Assessment equivalent, so unlike the CrowdStrike
tab there is no posture-score tile, and no score is invented.

## Agent Health

Six counts from the latest posture snapshot (`GET /agents/count` in the
configured scope): **Agents**, **Active**, **Infected**, **Detect-only**,
**Outdated** and **Disconnected (network)**. Infected, detect-only and outdated
are highlighted when above zero. The card shows the snapshot time.

The posture pass runs with the first sync and then every 6 hours. Until then
the card says there is no snapshot. If SentinelOne refused every agent read,
the card shows the HTTP status instead of the counts: the service user needs
permission to view endpoints in the scope.

You can be notified when these counts cross a limit: **Settings → Alerts →
SentinelOne agent health** has maximums for infected, detect-only and outdated
agents.

## Correlation Timeline

The **Test Execution vs SentinelOne Alerts Volume** card plots test executions
against alerts on a shared time axis, bucketed by day for windows up to 90
days and by week beyond that. Alert bars are split into **linked** alerts (the
enrichment pass matched them to an Achilles test) and **organic** alerts
(everything else).

## Alert Feed

A full-width, paged feed lists every alert in the window with its severity,
title, host, **SentinelOne response** (the recorded prevention action, or
"Detected only", which is also shown for threats Achilles mitigated), first technique, linked test, status and age. Threats have a
link that opens them in the SentinelOne console.

A summary strip above the rows shows the severity split, the
**Prevented / Detected only / Kill failed** counts and how many alerts
Achilles **auto-resolved**. The feed has the same filters as the CrowdStrike
feed, plus a record-type filter:

- **Source**: All / Test / Organic. The segment counts stay stable as you
  filter, and with **All types** the "All" count equals the Alerts tile total.
- **Severity**: All severities, or High & critical. Severity narrows only the
  rows and the page count.
- **Type**: All types, **Threats**, or **Detection alerts**. Unlike source and
  severity, the type filter also narrows the segment counts and the summary
  strip.

A linked alert's **Linked test** opens the Executions view filtered to that
test, or to the bundle when the alert was matched to a bundle.

## Technique Coverage

Per-technique table for the window, split into **prevented**, **detected only**
and **missed** executions, with an **Alerts (in window)** column: the number of
distinct SentinelOne alerts in the window tagged with that technique or one of
its sub-techniques. Detected techniques are listed first. Click a technique to
open the alert drawer for it.

## Missed Tests Covered by an Exclusion

This card lists tests SentinelOne **missed** (exit code `101` with no
SentinelOne detection) on SentinelOne-managed hosts, where a SentinelOne
**path exclusion** that applies to the host covers the folder the test ran
from. An exclusion like that explains the miss: SentinelOne was told to ignore
the file.

- The summary line shows the number of exclusions by type, the missed tests on
  SentinelOne hosts, and how many were flagged.
- Each flagged row shows the test (linked to the Executions view), the host and
  OS, the last run, and the exclusion's value, path type, mode and scope.
- Paths are matched against the Achilles agent work folders (`C:\F0\tasks\…`
  and `C:\F0\` on Windows, `/opt/f0/tasks/…` and `/opt/f0/` elsewhere).
- Hash and certificate exclusions can't be matched, because test results carry
  no file hash or signer. Their count is shown under the table.

Hosts are matched to SentinelOne agents by hostname.

## Protection Policy

A plain table of the protection policy per account, site and group in scope,
as configured in SentinelOne. Nothing here is scored.

| Column | Meaning |
|--------|---------|
| Scope | Account, site or group name (groups also show their site) |
| Threats / Suspicious | The policy's mitigation mode for threats and for suspicious detections: **Protect** or **Detect** |
| Anti-tamper / Snapshots | Whether the toggle is on |
| Engines off / Engines on | Detection engines turned off / on |

A group that inherits its site's policy shows "Inherits the site policy". A
scope whose policy the token can't read shows the HTTP status instead.

A policy in **Detect** mode is a common reason tests are detected but not
prevented.

## Alert Drill-Down Drawer

Clicking a technique opens the **Alert Details drawer**. It lists the matching
SentinelOne alerts in the window with severity, status, age, the prevention
badge, MITRE techniques and, when present, the auto-resolve receipt. Threats
have a link that opens them in the SentinelOne console; detection alerts have
no console link.

## Detection rate

The Detected / Prevented tile and the Technique Coverage card use the same
evidence-based, per-execution definition as the CrowdStrike tab, with
SentinelOne's flags (`f0rtika.sentinelone_detected`,
`f0rtika.sentinelone_stage_detected`, `f0rtika.sentinelone_prevented`):

```
detectionRate = (prevented + detectedOnly) / executions × 100
```

See [CrowdStrike → Detection Rate](./crowdstrike#detection-rate) for the full
definition, and [CrowdStrike → Exclusions](./crowdstrike#exclusions) for the
cyber-hygiene controls and skipped stages that are left out of the execution
count. Both apply unchanged. As there, it is an organisation-specific
operational KPI: track it over time for your own tenant rather than comparing
absolute numbers across organisations.

**Prevented** only counts what SentinelOne stopped itself. A kill or
quarantine done by Achilles automatic mitigation is never credited as a
SentinelOne prevention (the execution still counts as detected). See
[Defense Score and coverage](../integrations/sentinelone-auto-resolve#defense-score-and-coverage).

## See Also

- [Integrations → SentinelOne](../integrations/sentinelone) — setup, sync and permission modes
- [SentinelOne Auto-Resolve and Automatic Mitigation](../integrations/sentinelone-auto-resolve)
- [SentinelOne API endpoints](../../api-reference/sentinelone)
