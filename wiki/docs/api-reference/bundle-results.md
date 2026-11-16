---
sidebar_position: 9
title: "Bundle Results Protocol"
description: "How bundle test results are ingested — per-control fan-out, composite UUIDs, and ES document structure."
---

# Bundle Results Protocol

## Overview

Bundle tests (cyber-hygiene bundles, multi-stage intel-driven tests) produce per-control/per-stage results that are fanned out into individual Elasticsearch documents.

## Data Flow

1. **Agent reads** `bundle_results.json` after test execution. It looks first in the task's own folder (the path it passes to the test as `F0_BUNDLE_DIR`), then in the shared folder (`C:\F0` on Windows, `/tmp/F0` on Linux and macOS)
2. **Agent validates** `bundle_id` matches the test UUID of the task
3. **Backend detects** `bundle_results.controls` in the result payload, and ignores them when `bundle_id` is not the test the task was dispatched for
4. **Backend fans out** each control as an independent ES document via `client.bulk()`

If the file can't be used, the run is reported as one ordinary result and the file is left in place.

### Trusted folder (agent 0.7.4)

The agent runs as root or SYSTEM, so it only reads a file it can trust:

- The shared folder must be a real directory (not a symlink or junction). On Linux and macOS it must also be owned by root or the agent's user and not writable by group or others, because `/tmp/F0` sits in world-writable `/tmp`.
- `bundle_results.json` must be a regular file (a symlink is refused) of at most 16 MiB.

## Composite test_uuid

Bundle control documents use `<bundle-uuid>::<control-id>` as the `test_uuid`:

```
7659eeba-f315-440e-9882-4aa015d68b27::CH-IEP-003
```

The `::` separator is unambiguous (UUIDs and control IDs contain only hyphens). Use `split('::')` to decompose.

## Document id

Each control document has the Elasticsearch `_id` `<task_id>::<control_id>`. The task id is unique per run, so two runs of the same bundle on the same host never overwrite each other, and a repeated ingestion of the same result replaces the same documents. A standalone test result uses `<task_id>`.

## Additional ES Fields

| Field | Type | Description |
|-------|------|-------------|
| `f0rtika.bundle_id` | keyword | Bundle test UUID |
| `f0rtika.bundle_name` | keyword | Bundle human-readable name |
| `f0rtika.control_id` | keyword | Individual control ID (e.g., `CH-DEF-001`) |
| `f0rtika.control_validator` | keyword | Parent validator name |
| `f0rtika.control_description` | text | Plain-language description of what the control or stage does, from the control's optional `description` in `bundle_results.json`. Omitted when empty. Returned by the API as `control_description` |
| `f0rtika.is_bundle_control` | boolean | `true` for fan-out documents |

## Frontend Display

The Execution Table groups bundle controls under collapsible parent rows:
- Parent shows bundle name + "X/Y Protected" badge
- Badge shows "X controls" for cyber-hygiene, "X stages" for other categories
- Explicitly skipped controls (`skipped: true`, exit code 0) show "Not assessed" for cyber-hygiene and "Skipped" otherwise
- Legacy non-cyber-hygiene stages with exit code 0 show "Skipped"; unmarked cyber-hygiene exit-0 controls remain inconclusive
