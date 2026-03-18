---
sidebar_position: 9
title: "Bundle Results Protocol"
description: "How bundle test results are ingested — per-control fan-out, composite UUIDs, and ES document structure."
---

# Bundle Results Protocol

## Overview

Bundle tests (cyber-hygiene bundles, multi-stage intel-driven tests) produce per-control/per-stage results that are fanned out into individual Elasticsearch documents.

## Data Flow

1. **Agent reads** `c:\F0\bundle_results.json` after test execution
2. **Agent validates** `bundle_id` matches the task UUID
3. **Backend detects** `bundle_results.controls` in the result payload
4. **Backend fans out** each control as an independent ES document via `client.bulk()`

## Composite test_uuid

Bundle control documents use `<bundle-uuid>::<control-id>` as the `test_uuid`:

```
7659eeba-f315-440e-9882-4aa015d68b27::CH-IEP-003
```

The `::` separator is unambiguous (UUIDs and control IDs contain only hyphens). Use `split('::')` to decompose.

## Additional ES Fields

| Field | Type | Description |
|-------|------|-------------|
| `f0rtika.bundle_id` | keyword | Bundle test UUID |
| `f0rtika.bundle_name` | keyword | Bundle human-readable name |
| `f0rtika.control_id` | keyword | Individual control ID (e.g., `CH-DEF-001`) |
| `f0rtika.control_validator` | keyword | Parent validator name |
| `f0rtika.is_bundle_control` | boolean | `true` for fan-out documents |

## Frontend Display

The Execution Table groups bundle controls under collapsible parent rows:
- Parent shows bundle name + "X/Y Protected" badge
- Badge shows "X controls" for cyber-hygiene, "X stages" for other categories
- Skipped stages (non-cyber-hygiene, exit code 0) show "Skipped" label
