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

The write index is created automatically on first ingest with the correct field mappings, in every mode (an index you named yourself as a task's target is left to you). With **Static**, an existing index is used as it is, and a key that may write but not create indices still writes; a missing index then has to be created from Analytics → Settings first, or Elasticsearch guesses its field types. Because the read pattern (`achilles-results-*`) spans all dated indices, analytics always see the full result history — rollover only affects where new documents land.

Rollover keeps individual indices small, which makes retention simple: old dated indices can be snapshotted and deleted without touching the current write index.

Environment variable equivalents: `ELASTICSEARCH_WRITE_INDEX_PREFIX` and `ELASTICSEARCH_WRITE_INDEX_ROLLOVER` (`none` / `daily` / `monthly`).

## Viewing Indices

The read-only **Index Management** list in the Elasticsearch settings (**Settings → Integrations**) shows every results index (`achilles-results-*`) with its document count, size and health. Select a row to use that index as the index pattern.

## Per-Task Index Targeting

When creating a task or schedule, you can pick a **Target Index** under **Advanced** (the default is the global write index). Results from that task are ingested into that index instead.

The list offers the existing results indices. Through the API, `target_index` must name an Achilles results index (`achilles-results-…`, lower case); any other name is rejected with a 400, because results are written with the backend's own Elasticsearch credentials.

This is useful for:
- **Engagement isolation** — Keep results from different engagements separate
- **Environment separation** — Separate production vs. staging test results
- **Team separation** — Different teams work with their own result sets
