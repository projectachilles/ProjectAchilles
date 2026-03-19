---
sidebar_position: 3
title: "Agent Commands"
description: "Managing agents via CLI — list, show, update, delete, rotate-key, metrics."
---

# Agent Commands

The `agents` command (alias: `a`) manages enrolled security agents across your fleet. Agents are the endpoint software that executes security tests and reports results.

```bash
achilles agents <subcommand> [flags]
```

## Subcommands

| Subcommand | Description |
|------------|-------------|
| `list` | List agents with optional filters |
| `show` | Show detailed info for a specific agent |
| `update` | Update agent status |
| `delete` | Decommission an agent |
| `rotate-key` | Rotate an agent's API key |
| `heartbeats` | Show heartbeat history |
| `events` | Show agent event log |
| `metrics` | Fleet metrics and health summary |

## agents list

List enrolled agents with filtering and pagination.

```bash
achilles agents list [flags]
```

**Flags:**

| Flag | Type | Choices | Description |
|------|------|---------|-------------|
| `--status` | string | `active`, `disabled`, `decommissioned`, `online`, `offline`, `stale` | Filter by status |
| `--os` | string | `windows`, `linux`, `darwin` | Filter by operating system |
| `--tag` | string | | Filter by tag |
| `--hostname` | string | | Filter by hostname |
| `--online-only` | boolean | | Show only online agents |
| `--stale-only` | boolean | | Show only stale agents |
| `--limit` | number | | Max results (default: 50) |
| `--offset` | number | | Offset for pagination (default: 0) |

**Examples:**

```bash
# List all agents
achilles agents list

# Show only Windows agents that are online
achilles agents list --os windows --online-only

# Find stale agents (missed heartbeats)
achilles agents list --stale-only

# Filter by tag
achilles agents list --tag production

# Paginate through results
achilles agents list --limit 10 --offset 20

# JSON output for scripting
achilles agents list --json
```

**Example output:**

```
  ID          Hostname              OS        Arch    Version   Status        Last Seen     Tags
  ─────────   ────────────────────  ────────  ──────  ────────  ────────────  ────────────  ──────────
  a1b2c3d4…   prod-web-01           windows   amd64   1.4.2     ● active      2m ago        production
  e5f6g7h8…   dev-db-03             linux     amd64   1.4.1     ● active      4h ago        dev, staging
  i9j0k1l2…   staging-api-02        darwin    arm64   1.4.2     ○ disabled    6h ago        staging

  Showing 3 of 3 agents
```

## agents show

Display detailed information about a specific agent.

```bash
achilles agents show <id>
```

**Example:**

```bash
achilles agents show a1b2c3d4-5678-9abc-def0-123456789abc
```

**Output includes:** ID, hostname, OS, architecture, agent version, status, last heartbeat, enrollment date, enrolled by, tags, key rotation status, and timestamps.

## agents update

Update an agent's administrative status.

```bash
achilles agents update <id> --status <active|disabled>
```

**Flags:**

| Flag | Type | Choices | Description |
|------|------|---------|-------------|
| `--status` | string | `active`, `disabled` | New status |

**Example:**

```bash
# Disable an agent (stops task assignment)
achilles agents update a1b2c3d4 --status disabled

# Re-enable an agent
achilles agents update a1b2c3d4 --status active
```

## agents delete

Decommission an agent. This is a soft-delete -- the agent record is preserved but marked as decommissioned.

```bash
achilles agents delete <id>
```

:::warning
Decommissioning is irreversible from the CLI. The agent will stop receiving tasks and its status changes to `decommissioned`.
:::

**Example:**

```bash
achilles agents delete a1b2c3d4-5678-9abc-def0-123456789abc
```

## agents rotate-key

Rotate the API authentication key for an agent. The agent picks up the new key on its next heartbeat.

```bash
achilles agents rotate-key <id>
```

**Example:**

```bash
achilles agents rotate-key a1b2c3d4
```

```
  ✓ Key rotated for agent a1b2c3d4
  ⚠ The agent will pick up the new key on next heartbeat
```

## agents heartbeats

View heartbeat telemetry history for an agent, including CPU usage, memory, and disk metrics.

```bash
achilles agents heartbeats <id> [flags]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--days` | number | 7 | Number of days of history (1-30) |

**Example:**

```bash
# Last 7 days (default)
achilles agents heartbeats a1b2c3d4

# Last 30 days
achilles agents heartbeats a1b2c3d4 --days 30
```

**Example output:**

```
  Time                  CPU %    Mem MB    Disk MB
  ────────────────────  ───────  ────────  ────────
  2026-03-19 14:00:00     12.3      4096     51200
  2026-03-19 13:00:00     15.1      4120     51180
  2026-03-19 12:00:00      8.7      3980     51200
```

## agents events

View the event log for an agent (enrollment, status changes, task completions, etc.).

```bash
achilles agents events <id> [flags]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--type` | string | | Filter by event type |
| `--limit` | number | 20 | Max results |

**Example:**

```bash
# All recent events
achilles agents events a1b2c3d4

# Filter by event type
achilles agents events a1b2c3d4 --type task_completed
```

## agents metrics

Display fleet-wide metrics and health KPIs.

```bash
achilles agents metrics
```

This combines two API calls to show:

- **Fleet metrics**: Total agents, online/offline counts, breakdown by OS
- **Health KPIs**: Fleet uptime (30-day), task success rate (7-day), MTBF (mean time between failures), stale agent count

**Example output:**

```
  total:                    24
  online:                   21
  offline:                  3
  by_os:                    {"windows": 18, "linux": 4, "darwin": 2}
  fleet_uptime_30d:         98.7%
  task_success_rate_7d:     94.2%
  mtbf_hours:               168
  stale_agents:             1
```
