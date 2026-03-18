---
sidebar_position: 4
title: "Task Execution"
description: "Create and monitor security test execution tasks across your agent fleet."
---

# Task Execution

## Creating a Task

1. Navigate to **Agents** → select an agent
2. Click **Create Task**
3. Select the **test** to execute
4. Choose the **platform** and **architecture** for the binary
5. Optionally specify a target **Elasticsearch index**
6. Click **Submit**

The task enters the pending queue and is picked up by the agent on its next poll.

## Task Lifecycle

```
pending → assigned → downloading → executing → reporting → completed/failed
```

1. **Pending** — Task created, waiting for agent to poll
2. **Assigned** — Agent picked up the task
3. **Downloading** — Agent downloading the test binary
4. **Executing** — Binary running on the endpoint
5. **Reporting** — Agent sending results back
6. **Completed/Failed** — Final state with exit code and output

## Task Results

Results include:
- **Exit code** — 0 (unprotected), 1 (protected), other (error)
- **Stdout/Stderr** — Captured output from the test binary
- **Execution duration**
- **Timestamp**

Results are ingested into Elasticsearch for analytics.

## Binary Verification

Before execution, the agent verifies:
1. **SHA256 checksum** — Matches the expected hash
2. **Ed25519 signature** — Cryptographically signed by the server's private key

If either check fails, the task is rejected.
