---
sidebar_position: 2
title: "Heatmaps & Treemaps"
description: "Visualize security coverage with host-test heatmaps and category treemaps in the Analytics dashboard."
---

# Heatmaps & Treemaps

## Host-Test Heatmap

The heatmap displays a matrix of hosts (rows) vs. tests (columns), with each cell color-coded:

| Color | Meaning |
|-------|---------|
| **Green** | Protected — defense detected the test |
| **Red** | Unprotected — test bypassed defenses |
| **Gray** | Not executed on this host |

### Interpreting the Heatmap

- **Red columns** indicate a test that bypasses defenses on all hosts — prioritize this gap
- **Red rows** indicate a host with weak defenses — investigate its configuration
- **Hover** over a cell for execution details (timestamp, exit code, hostname)

## Category Treemap

The treemap provides a hierarchical view of test coverage by category and subcategory.

- **Rectangle size** represents the number of tests in that category
- **Color intensity** represents the protection rate
- **Click** to drill down into subcategories
- **Hover** for detailed statistics

The treemap helps identify which broad areas of your security posture have the most coverage and where gaps exist.
