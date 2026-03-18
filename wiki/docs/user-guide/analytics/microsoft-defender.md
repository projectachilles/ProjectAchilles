---
sidebar_position: 6
title: "Microsoft Defender"
description: "View Microsoft 365 Defender Secure Score, alerts, and control profiles in the ProjectAchilles Analytics dashboard."
---

# Microsoft Defender

## Overview

When configured, the Analytics dashboard displays Microsoft Defender data alongside your test results for cross-correlation analysis.

## Dashboard Elements

### Secure Score
The current Microsoft Secure Score with category breakdown (Identity, Data, Device, Apps, Infrastructure).

### Secure Score Trend
Score history over time, overlaid with your Defense Score trend for correlation.

### Alerts
Recent Defender alerts with severity classification and MITRE ATT&CK technique mapping.

### Control Profiles
Defender security control profiles with compliance status.

### Cross-Correlation
- **Defense Score vs Secure Score** — How your internal test results correlate with Microsoft's security assessment
- **MITRE Technique Overlap** — Techniques appearing in both your test results and Defender alerts

## Conditional Display

All Defender dashboard elements are hidden when not configured. The `useDefenderConfig` hook returns `{ configured, loading }` to control visibility.

## Setup

See [Integrations → Microsoft Defender](../integrations/microsoft-defender) for configuration steps.
