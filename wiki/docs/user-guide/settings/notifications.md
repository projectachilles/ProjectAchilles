---
sidebar_position: 3
title: "Notifications"
description: "The notification bell: recent threshold alerts and agent build notices in the console."
---

# Notifications

## Notification Bell

The bell in the top bar shows recent threshold alerts. A red dot on the bell means there is an alert you have not opened yet.

Click the bell to see the **five most recent alerts**. Each one shows:

- The metric that crossed its threshold, with the current value and the threshold
- Whether the alert was delivered to Slack and to email (✓ or ✗ per channel)
- How long ago it fired

**View all alerts →** opens Settings. The same alerts are listed under **Recent Alerts** in **Settings → Integrations → Alerts & Notifications**.

The bell needs the `integrations:read` permission to load alerts. Which alerts you have seen is remembered per browser.

### Other states

| The dropdown shows | Meaning |
|--------------------|---------|
| `Alerts not configured` | No alert channel is set up yet. **Open Settings** takes you there |
| `No recent alerts — all clear` | Alerting is configured and nothing has fired |
| `Threshold alerts aren't available on this deployment` | The deployment has no alerting (Vercel) |

### Agent build notices

When you build or upload an agent binary in **Settings → Agent**, the bell also shows a short notice, for example `Agent v0.7.4 built for windows/amd64`. These notices are kept in your browser for 24 hours and are not shared with other users. Up to three are shown, above the alerts.

## Notification History

The backend keeps the last 50 alerts in memory, so the list starts empty again after the backend restarts. The bell and the Settings card show the five most recent. The Slack channel or mailbox that receives the alerts is the lasting record.

## Configuring Notifications

See [Alerting (Slack & Email)](../integrations/alerting) for thresholds and the Slack and email channels.
