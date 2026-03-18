---
sidebar_position: 3
title: "MITRE ATT&CK Matrix"
description: "Understand the MITRE ATT&CK coverage matrix heatmap in the ProjectAchilles test browser."
---

# MITRE ATT&CK Matrix

The MITRE ATT&CK Matrix tab provides a visual heatmap of your test coverage mapped to the ATT&CK framework.

## Coverage Heatmap

The matrix displays MITRE ATT&CK techniques organized by tactic (columns) and technique (rows). Each cell is color-coded based on the number of tests covering that technique:

| Color | Meaning |
|-------|---------|
| **Dark purple** | High coverage (3+ tests) |
| **Medium purple** | Moderate coverage (2 tests) |
| **Light purple** | Minimal coverage (1 test) |
| **Gray** | No coverage |

## Interpreting the Matrix

- **Full columns** indicate strong coverage for that tactic
- **Empty columns** reveal gaps in your testing capability
- **Hover** over any cell to see the specific tests covering that technique
- **Click** a cell to filter the test list to that technique

## Using the Matrix

### Identifying Gaps
Look for gray cells in critical tactics (Initial Access, Privilege Escalation, Defense Evasion) to prioritize test development.

### Tracking Progress
As you add tests, the matrix fills in. Compare snapshots over time to measure your test library's growth.

### Reporting
The matrix provides a visual summary of your testing capability for stakeholders.
