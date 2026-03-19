---
sidebar_position: 5
title: "Analytics Commands"
description: "Querying defense scores, trends, coverage, and technique analysis."
---

# Analytics Commands

The `analytics` command (alias: `an`) queries security metrics from Elasticsearch. These commands give you visibility into your defense posture, test coverage, and execution history.

```bash
achilles analytics <subcommand> [flags]
```

:::info
Analytics commands require a configured Elasticsearch connection on the backend. If ES is not set up, these commands will return errors.
:::

## Shared Filter Flags

Most analytics subcommands accept these common filters:

| Flag | Type | Description |
|------|------|-------------|
| `--org` | string | Filter by organization |
| `--from` | string | Start date (ISO 8601 format, e.g., `2026-03-01`) |
| `--to` | string | End date (ISO 8601 format) |

## Subcommands

| Subcommand | Description |
|------------|-------------|
| `score` | Current defense score |
| `trend` | Defense score over time |
| `by-test` | Score breakdown by individual test |
| `by-technique` | Score breakdown by MITRE technique |
| `by-hostname` | Score breakdown by hostname |
| `by-org` | Score breakdown by organization |
| `executions` | Recent test executions |
| `coverage` | Test coverage matrix |
| `heatmap` | Host x test execution matrix |
| `techniques` | MITRE technique distribution |
| `errors` | Error rate breakdown |
| `hostnames` | Count of unique hostnames |
| `tests` | Count of unique tests executed |

## analytics score

Get the current defense score -- the primary security metric.

```bash
achilles analytics score [flags]
```

The defense score is a percentage (0-100%) representing how well your defenses blocked simulated attacks. Higher is better.

**Example:**

```bash
achilles analytics score
```

```
  Defense Score: 73.2% ████████████████████░░░░░░░░

  protected:        42
  unprotected:      16
  total_executions: 58
```

```bash
# Score for a specific date range
achilles analytics score --from 2026-03-01 --to 2026-03-15

# JSON output
achilles analytics score --json
```

## analytics trend

View how the defense score changes over time.

```bash
achilles analytics trend [flags]
```

**Additional flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--interval` | string | `1d` | Time bucket interval (`1h`, `1d`, `1w`) |
| `--days` | number | 30 | Window in days |

**Example:**

```bash
# Daily trend for the last 30 days (default)
achilles analytics trend

# Hourly trend for the last 7 days
achilles analytics trend --interval 1h --days 7

# Weekly trend for the last 90 days
achilles analytics trend --interval 1w --days 90
```

**Example output:**

```
  Date          Score     Protected    Total
  ────────────  ────────  ──────────   ────────
  3/19/2026     73.2%           42         58
  3/18/2026     71.8%           38         53
  3/17/2026     68.4%           26         38
  3/16/2026     75.0%           30         40
```

## analytics by-test

Get the defense score broken down by individual test.

```bash
achilles analytics by-test [flags]
```

**Additional flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--limit` | number | 20 | Max results |

**Example:**

```bash
achilles analytics by-test --limit 10
```

```
  Test                            Score     Protected    Total
  ──────────────────────────────  ────────  ──────────   ────────
  T1059.001-PowerShell-Exec       100.0%          12         12
  T1486-Data-Encrypted            83.3%           10         12
  T1547-Boot-Logon-Autostart      66.7%            8         12
  T1003-Credential-Dumping        50.0%            6         12
```

## analytics by-technique

Get defense scores grouped by MITRE ATT&CK technique ID.

```bash
achilles analytics by-technique [flags]
```

**Example:**

```bash
achilles analytics by-technique
```

```
  Technique       Score     Protected    Total
  ──────────────  ────────  ──────────   ────────
  T1059           92.0%           23         25
  T1486           78.6%           11         14
  T1547           66.7%            8         12
  T1003           41.7%            5         12
```

## analytics by-hostname

Get defense scores broken down by endpoint hostname.

```bash
achilles analytics by-hostname [flags]
```

**Additional flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--limit` | number | 20 | Max results |

**Example:**

```bash
achilles analytics by-hostname
```

```
  Hostname              Score     Protected    Unprotected    Total
  ────────────────────  ────────  ──────────   ────────────   ────────
  prod-web-01           85.7%            6              1          7
  prod-web-02           71.4%            5              2          7
  dev-db-03             57.1%            4              3          7
```

## analytics by-org

Get defense scores broken down by organization.

```bash
achilles analytics by-org [flags]
```

Only accepts `--from` and `--to` filters (not `--org`, since the breakdown is across orgs).

## analytics executions

View recent test executions with protection outcomes.

```bash
achilles analytics executions [flags]
```

**Additional flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--page` | number | 1 | Page number |
| `--size` | number | 20 | Page size |
| `--grouped` | boolean | false | Group results by batch |

**Flat mode example:**

```bash
achilles analytics executions
```

```
  Time                  Test                        Host              Outcome
  ────────────────────  ────────────────────────    ────────────────  ──────────────
  2026-03-19 14:00:00   T1059-PowerShell-Exec       prod-web-01       PROTECTED
  2026-03-19 13:55:00   T1486-Data-Encrypted        prod-web-01       UNPROTECTED
  2026-03-19 13:50:00   T1547-Boot-Logon-Auto       dev-db-03         PROTECTED
```

**Grouped mode example:**

```bash
achilles analytics executions --grouped
```

```
  Test                        Host              Protected    Unprotected    Total    Last Run
  ────────────────────────    ────────────────  ──────────   ────────────   ────────  ──────────
  CyberHygiene-Bundle         prod-web-01             8              2         10    2026-03-19
  T1059-PowerShell-Exec       prod-web-01             3              0          3    2026-03-19
```

## analytics coverage

View the test coverage matrix -- which tests have been executed and their protection outcomes.

```bash
achilles analytics coverage [flags]
```

```
  Test                            Protected    Unprotected
  ──────────────────────────────  ──────────   ────────────
  T1059.001-PowerShell-Exec             12              0
  T1486-Data-Encrypted                  10              2
  T1547-Boot-Logon-Autostart             8              4
```

## analytics heatmap

View the host-by-test execution matrix.

```bash
achilles analytics heatmap [flags]
```

```
  Host                  Test                        Count
  ────────────────────  ────────────────────────    ────────
  prod-web-01           T1059-PowerShell-Exec            5
  prod-web-01           T1486-Data-Encrypted             3
  dev-db-03             T1059-PowerShell-Exec            4
```

## analytics techniques

View MITRE ATT&CK technique distribution across all executions.

```bash
achilles analytics techniques [flags]
```

```
  Technique       Protected    Unprotected
  ──────────────  ──────────   ────────────
  T1059                 23              2
  T1486                 11              3
  T1547                  8              4
```

## analytics errors

Get the test error rate breakdown.

```bash
achilles analytics errors [flags]
```

Returns a summary of execution errors, helping identify flaky tests or infrastructure issues.

## analytics hostnames

Get a count of unique hostnames that have reported test results.

```bash
achilles analytics hostnames [--org <org>]
```

## analytics tests

Get a count of unique tests that have been executed.

```bash
achilles analytics tests [--org <org>]
```
