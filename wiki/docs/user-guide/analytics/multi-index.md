---
sidebar_position: 4
title: "Multi-Index Management"
description: "Manage multiple Elasticsearch indices for isolated test result sets in ProjectAchilles."
---

# Multi-Index Management

## Overview

ProjectAchilles supports multiple Elasticsearch indices, allowing you to isolate test results by engagement, environment, or team.

## Managing Indices

### Viewing Indices

The index selector dropdown shows all available indices matching the configured pattern (`achilles-results-*` by default). Each index displays:
- Document count
- Index size
- Creation date

### Creating Indices

Click **Create Index** to create a new Elasticsearch index with the correct field mappings. The index name must follow the pattern `achilles-results-<name>`.

### Switching Indices

Select a different index from the dropdown to switch the entire Analytics dashboard to that index. All queries, scores, and visualizations update to reflect the selected index.

## Per-Task Index Targeting

When creating a task or schedule, you can specify a target Elasticsearch index. Results from that task are ingested into the specified index instead of the default.

This is useful for:
- **Engagement isolation** — Keep results from different engagements separate
- **Environment separation** — Separate production vs. staging test results
- **Team separation** — Different teams work with their own result sets
