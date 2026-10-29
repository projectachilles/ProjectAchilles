---
sidebar_position: 9
title: "Sophos"
description: "Read the Sophos tab in the ProjectAchilles Analytics dashboard: detection coverage, alert correlation, Health Check posture, endpoint health, policies and allow-list gaps."
---

# Sophos

When the Sophos integration is configured, a dedicated **Sophos** tab appears
in the Analytics dashboard (`?tab=sophos`). Like the
[SentinelOne tab](./sentinelone), it answers one operational question:

> Of the attack simulations we launched, what share did Sophos catch?

It also shows the Sophos posture that explains the answer: the Health Check
score, endpoint health, threat-protection policy deviations, and the exclusion
and allow-list entries that would exempt Achilles tests.

If the integration is not configured the tab is hidden entirely
(`useSophosConfig()` gates it). The integration exists only on Docker-style
backends; on Vercel the tab never appears. To set it up, see
[Integrations → Sophos](../integrations/sophos).

## Tab header

The header shows the tenant's data region, the licensed features Sophos
reported (SIEM events, Alerts, XDR detections, Health Check), when Sophos data
was last synced and a **Sync Now** button. The sync runs in the background; the
button stays busy while the tab polls the sync status. When the last sync
failed, the header shows the failing stage and error.

Two messages can appear under the header:

- **ATT&CK techniques come from Sophos XDR detections.** Shown when the
  tenant has no XDR detection access. Alerts, SIEM prevention evidence and
  posture still work; Sophos rows simply carry no techniques, and Achilles never
  infers one from the detection type.
- **Sophos sync gap.** Sophos keeps SIEM events for 24 hours only. If Achilles
  couldn't collect for longer, the warning names the exact missing period. See
  [the 24-hour SIEM window](../integrations/sophos#the-24-hour-siem-window-and-the-sync-gap-warning).

## Date range

The tab follows the **Analytics date picker**. Changing it reloads the tiles,
timeline, alert feed, technique coverage and the exclusion check. The Health
Check details, endpoint health and policy cards show the latest posture
snapshot and don't depend on the range (the Health Check tile trend uses the
last 30 days).

## Hero row

| Tile | What it shows |
|------|---------------|
| **Sophos Health Check** | The [Health Check headline](#health-check), the four category bars, a sparkline and the change over the last 30 days. |
| **Sophos Alerts** | Rows in the window (alerts, XDR detections and SIEM events, one row per Sophos detection), how many are linked to Achilles tests versus organic, a severity bar and the change versus the previous 7 days. |
| **Detected / Prevented** | The share of attack simulations in the window that Sophos detected, and the share it prevented (see [Detection rate](#detection-rate)). |
| **Sophos response** | How many rows Sophos **prevented** (quarantined, killed or blocked), how many were **detected only**, and how many had a failed **cleanup**. |
| **Auto-Resolve** | The auto-resolve mode and the receipts of the last 30 days and 24 hours, with real resolutions and dry-run receipts counted separately. See [Sophos Auto-Resolve](../integrations/sophos-auto-resolve#receipts). |

## Health Check

Sophos has no single posture score. Its Account Health Check returns four
checks (**protection**, **policy**, **exclusions**, **tamper protection**), each
scored 0-100 and split between computers and servers (exclusions are global).

The tile headline is the **Achilles average of Sophos Health Check scores**: the
mean of the four categories, each being the mean of its computer / server (or
global) scores. A category Sophos doesn't return is skipped, not counted as
zero. The label says it is ours, because Sophos publishes no overall number.

- Sophos keeps 30 days of history. Achilles imports those 30 days on the first
  sync, then stores a snapshot every 6 hours, so the trend and the "Defense
  Score vs posture" chart have data from day one.
- The **Health Check details** band shows each category's score, its
  computer / server breakdown and what Sophos flagged. The Health Check API
  returns **counts, not device names** (for example "2 of 5 servers not fully
  protected"); to find the devices, use the Sophos Central console or the
  endpoint inventory.

## Endpoint health

Counts from the latest endpoint inventory (the Endpoint API): **Endpoints**,
**Not seen in 7 days**, **Out of date**, **Tamper off**, **Isolated**,
**Health bad**, **Health suspicious**, and how many endpoints have the XDR
sensor. Tamper state comes from the endpoint list; Achilles never reads the
per-endpoint tamper-protection password. The inventory is capped at 50,000
endpoints.

## Correlation timeline

Plots test executions against Sophos rows on a shared time axis, bucketed by day
for windows up to 90 days and by week beyond that. Rows are split into
**linked** (matched to an Achilles test) and **organic**.

## Alert feed

A paged feed lists every row in the window with severity, title, host,
**Sophos response** (Prevented action, "Detected only" or "Cleanup failed"),
first technique, linked test, status and age. Rows open in Sophos Central where
a link exists. Filters:

- **Source**: All / Test / Organic.
- **Severity**: All severities or High & critical.
- **Type**: All types, **Alerts** (Common Alerts), **XDR detections**, or
  **SIEM events**. Unlike source and severity, type also narrows the segment
  counts and the summary strip.

A **SIEM event** row is one with no matching Common Alert; when an alert exists
the SIEM evidence is merged into it. **XDR detections** are always
detected-only: Sophos documents them as activity that was not blocked
([Sophos: Detections](https://docs.sophos.com/central/customer/help/en-us/ManageYourProducts/ThreatAnalysisCenter/Detections/)).

## Technique coverage

Per-technique table for the window, split into **prevented**, **detected only**
and **missed** executions, with an **Alerts (in window)** column. Techniques
come only from XDR detections. Without XDR the card shows the XDR notice and
the technique columns have nothing to match; prevented / detected still count at
the test level. Click a technique to open the alert drawer for it.

## Exclusion and allow-list gaps

Two kinds of finding:

**Critical** (red boxes) entries that would exempt every Achilles test:

| Kind | Meaning |
|------|---------|
| **Certificate allowed** | An allowed-items `certificateSigner` entry matches the active Achilles signing certificate (common name or SHA-256). The agent and all tests share that certificate, so every test is trusted. |
| **Folder exclusion** | An exclusion covers `C:\F0` or `/opt/f0`. |
| **Agent process exclusion** | A process exclusion of the agent, which covers every file it writes or opens, so every test. |

**Missed tests under an exclusion:** unprotected runs (exit code `101`, no Sophos
detection) on Sophos-managed hosts whose binary path is covered by a scanning
exclusion or an allowed `path` item: host, path, last run and the exclusion.
Hash and certificate entries other than the critical check can't be matched,
because test results carry no file hash or signer.

Remove critical entries; see
[Endpoint Prerequisites](../../deployment/endpoint-prerequisites#sophos-intercept-x)
for what to allow instead.

## Threat-protection policies

A table of the Sophos threat-protection and server-threat-protection policies
and the protection-relevant settings that **differ from Sophos' recommended
value** (for example Deep Learning, on-access scanning, live protection,
behavioural, AMSI, HIPS, CryptoGuard, exploit mitigation, credential theft, IPS,
adaptive attack protection). Each policy shows what it applies to. Nothing here
is scored, and Achilles doesn't resolve which policy applies to which endpoint.
A weaker setting is a common reason tests are detected but not prevented.

## Detection rate

The Detected / Prevented tile and Technique Coverage use the same
evidence-based, per-execution definition as the CrowdStrike tab, with the Sophos
flags (`f0rtika.sophos_detected`, `sophos_stage_detected`, `sophos_prevented`):

```
detectionRate = (prevented + detectedOnly) / executions × 100
```

See [CrowdStrike → Detection Rate](./crowdstrike#detection-rate) for the full
definition. **Prevented** only counts Sophos' own automatic response; see
[How Sophos evidence becomes a verdict](../integrations/sophos#how-sophos-evidence-becomes-a-verdict).

## See also

- [Integrations → Sophos](../integrations/sophos): setup, sync and permission modes
- [Sophos Auto-Resolve](../integrations/sophos-auto-resolve)
- [Sophos API endpoints](../../api-reference/sophos)
- [Exit Codes & Outcomes](./exit-codes-and-outcomes)
