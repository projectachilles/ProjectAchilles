---
sidebar_position: 2
title: "Coverage Views"
description: "Where to see coverage by ATT&CK technique, by test and by host: the ATT&CK coverage matrix, the technique distribution, the coverage bar lists and Test Breadth by Host."
---

# Coverage Views

Coverage is shown in five places. None of them changes the Defense Score; they
show where it comes from.

:::note[The host-test heatmap and the category treemap]
Earlier releases had a host × test heatmap and a category treemap. The console
no longer has either. Coverage by technique is now the ATT&CK coverage matrix,
and coverage by host is the Test Breadth by Host card. For a host × test grid
of one planned run, use a [campaign's evidence matrix](../agent-management/campaigns).
:::

## MITRE ATT&CK coverage (Dashboard)

The **MITRE ATT&CK coverage** card on the [Security Dashboard](../console/security-dashboard)
has twelve tactic columns, Initial Access to Impact. Each cell is one
technique, coloured by the share of its test × endpoint results that were
stopped (blocked or detected):

| Colour | Stopped share |
|--------|---------------|
| Stopped | 95% or more |
| Partial | 80% to 94% |
| Got through | Below 80% |
| In library, not run | No results in the range |

- Each technique is scored **per stage**, on the latest result of each test ×
  endpoint pair. A technique whose stage got through shows as such even when a
  sibling stage of the same test was blocked.
- **Hover** a cell for its counts, for example "T1486 · 7 blocked · 2 detected
  only · 4 got through of 13 test × endpoint results".
- **Click** a cell to open Analytics filtered to that technique.
- The header of each column shows stopped / tested techniques, and the footer
  names the tactic with the most techniques that got through.

## ATT&CK technique distribution (Analytics)

On **Analytics → Dashboard**, the **ATT&CK technique distribution** card lists
the ten techniques with the most results in the selected window. Each row has a
stacked protected / unprotected bar and the protected percentage, and the rows
run from the best protected to the worst.

- Scoring is per stage and latest-result, like the matrix above.
- A chip in the header counts the listed techniques that also appear on alerts
  of a connected EDR, for example "3 with Defender alerts".
- **Click** a row to open **All Executions** filtered to that technique.

## Test Coverage and Defense Score by Host

Two bar lists on **Analytics → Dashboard**, both on the
[latest-result](./defense-score#latest-result-score) basis:

- **Test Coverage** has one row per test (the ten with the most results) and
  shows how many hosts are protected and unprotected for that test. Hover a row
  for the counts.
- **Defense Score by Host** has one row per endpoint with its score. Hover a
  row for the protected, unprotected and total pair counts.

A mostly unprotected row in Test Coverage points at a test that gets through
on most hosts. A low row in Defense Score by Host points at one endpoint to
investigate.

## Test Breadth by Host

The **Test Breadth by Host** card shows one tile of equal size per tested
host: how many of the tests in use that host has run. It is about how much was
tested, not how well the host defended, so it uses a blue ramp and never green
or red. Hosts with no result are listed below the tiles, and clicking a host
shows one tile per test.

The rules (test set, shades, the "Not tested" group, the tooltip) are in
[Defense Score & Trends](./defense-score#test-breadth-by-host).

## Host × test grids

- A **campaign run** has an evidence matrix: one cell per test and host, with
  the same verdicts as Analytics. See [Campaigns](../agent-management/campaigns).
  Campaigns are not available on Vercel.
- The CLI prints the host × test execution counts with
  [`achilles analytics heatmap`](../cli/analytics-commands#analytics-heatmap).
