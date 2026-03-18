---
sidebar_position: 1
title: "Defense Score & Trends"
description: "Understand the ProjectAchilles Defense Score — aggregate scoring, breakdowns, and trend analysis."
---

# Defense Score & Trends

The Defense Score is the primary metric for measuring your security posture.

## What Is the Defense Score?

The Defense Score is an aggregate percentage representing how many of your executed security tests were detected (or blocked) by your defenses. A score of 85% means 85% of test executions resulted in a "Protected" outcome.

## Score Calculation

```
Defense Score = (Protected Executions / Total Executions) × 100
```

Each test execution is classified by its exit code:
- **Exit code 1** → "Protected" (defense detected/blocked the test)
- **Exit code 0** → "Unprotected" (test completed without detection)
- **Other exit codes** → "Error" (test failed to execute properly)

## Breakdowns

The Defense Score can be broken down by:
- **Test** — Score per individual test
- **Technique** — Score per MITRE ATT&CK technique
- **Category** — Score per test category
- **Hostname** — Score per endpoint
- **Severity** — Score per severity level

## Trend Analysis

The trend chart shows the Defense Score over time with a configurable rolling window:
- **7 days** — Short-term operational view
- **30 days** — Monthly trend
- **90 days** — Quarterly trend

A downward trend indicates deteriorating security posture and may trigger [threshold alerts](../integrations/alerting).

## Dual Defense Score

The dashboard overlays the real-time score with a trend line, making it easy to see both the current state and the trajectory.
