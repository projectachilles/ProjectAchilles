---
sidebar_position: 4
title: "Multi-Index Management"
description: "Manage multiple Elasticsearch indices for isolated test result sets in ProjectAchilles."
---

# Multi-Index Management

## Overview

ProjectAchilles writes test results into **dated write indices** and reads them back through a wildcard pattern (`achilles-results-*` by default). Indices are created automatically — there is no manual index creation step.

## Write-Index Rollover

Ingestion routes through a write index resolved from a configurable prefix and rollover mode (**Write Index Prefix** and **Write index rollover** in Analytics → Settings):

| Rollover mode | Write index |
|---------------|-------------|
| **Daily** | `achilles-results-YYYY.MM.DD` |
| **Monthly** | `achilles-results-YYYY.MM` |
| **Static** (none) | The prefix as-is |

New dated indices are created automatically on first ingest with the correct field mappings. Because the read pattern (`achilles-results-*`) spans all dated indices, analytics always see the full result history — rollover only affects where new documents land.

Rollover keeps individual indices small, which makes retention simple: old dated indices can be snapshotted and deleted without touching the current write index.

Environment variable equivalents: `ELASTICSEARCH_WRITE_INDEX_PREFIX` and `ELASTICSEARCH_WRITE_INDEX_ROLLOVER` (`none` / `daily` / `monthly`).

## Viewing Indices

The read-only index list in Analytics settings shows all indices matching the configured pattern, with document count, size, and creation date.

## Per-Task Index Targeting

When creating a task or schedule, you can specify a target Elasticsearch index under **Advanced** (the default is the global write index). Results from that task are ingested into the specified index instead.

This is useful for:
- **Engagement isolation** — Keep results from different engagements separate
- **Environment separation** — Separate production vs. staging test results
- **Team separation** — Different teams work with their own result sets
