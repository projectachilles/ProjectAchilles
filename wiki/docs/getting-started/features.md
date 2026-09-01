---
sidebar_position: 2
title: Features Overview
description: A comprehensive overview of all ProjectAchilles features — AI-powered test development, test browser, execution framework, analytics & measurement, build system, scheduling, and integrations.
---

# Features Overview

ProjectAchilles is built around three pillars — **develop tests**, **execute them**, and **measure the results** — each accessible from a unified web interface with Clerk authentication.

## Unified Security Dashboard

`/dashboard` is the console's landing page — one view of posture across the
test library, the endpoint fleet, and Elasticsearch analytics. It replaced the
three separate module dashboards in 2.1.

![Security Dashboard — attention banner, KPI strip, trend overview, severity mix, ATT&CK coverage and category breakdown](/img/screenshots/security-dashboard.png)

- **Attention banner** — derived, not stored: offline agents, stale agents,
  failed tasks in the last 24 h, outdated binaries, and git sync failures, each
  linking to the page that resolves it
- **KPI strip** — Defense Score, Secure Score, total tests, average score,
  agents online, and executions in the window
- **Trend overview**, **severity mix**, **ATT&CK coverage**, **category
  breakdown**, **fleet health**, and **recent executions**
- **7d / 30d / 90d** range selector, defaulting to 90 days
- **Per-card degradation** — an unconfigured integration greys out its own card
  and offers a "Configure →" link; the dashboard never redirects you away

See **[Security Dashboard](../user-guide/console/security-dashboard)**.

## AI-Powered Test Development

Security tests are built by a multi-agent AI pipeline that converts threat intelligence into complete test packages. Each test includes ~19 artifacts generated autonomously.

**Pipeline overview:**

```
Threat Intelligence Article
    ↓ Phase 1: Analysis & Implementation
    Extracts TTPs → generates Go source → compiles & signs binary
    ↓ Phase 2: Parallel Artifact Generation
    Detection Rules (5 formats) │ Defense Guidance │ Documentation │ Kill Chain Diagrams
    ↓ Phase 3: Validation & Deployment
    Verifies all artifacts → syncs catalog → deploys to endpoints
```

**What each test package contains:**

| Artifact | Formats | Purpose |
|----------|---------|---------|
| Test binary | Go (Windows, Linux, macOS) | Executes the simulated technique on the endpoint |
| Detection rules | KQL, YARA, Sigma, Elastic EQL, LimaCharlie | Import directly into your SIEM/EDR |
| Hardening scripts | PowerShell, Bash (Linux + macOS) | Remediate gaps found by the test |
| Documentation | Markdown (README + info card) | MITRE mapping, severity, threat actor context |
| Kill chain diagram | Interactive HTML | Visualizes multi-stage attack flow |

![Test detail view — multi-stage kill chain diagram with stage progression, source files, and build artifacts](/img/screenshots/test-detail-killchain.png)

**Test categories:**

| Category | Description | Example |
|----------|-------------|---------|
| **Intel-Driven** | Real-world attack techniques from APT reports and ransomware analysis | Lazarus group TTPs, Emotet delivery chains |
| **MITRE Top 10** | Most common ransomware techniques from MITRE ATT&CK | Process injection, defense evasion, lateral movement |
| **Cyber-Hygiene** | Configuration validation for endpoint, identity, and cloud security | Defender settings, ASR rules, LSASS protection, MFA |

:::info Companion Repository
The test development pipeline lives in a companion repository. Tests are synced to ProjectAchilles via Git for browsing, building, and execution.
:::

## Test Browser

Browse the full test library with rich metadata and execute tests directly from the UI.

- **Filter and search** by MITRE ATT&CK technique, platform, category, and severity
- **View details** including source code, detection rules, hardening scripts, and attack flow diagrams
- **Build, sign, and download** test binaries directly from test detail pages
- **MITRE ATT&CK coverage chart** with per-tactic bar visualization
- **Execution drawer** — assign and run tests directly from the browse page
- **Favorite tests**, track recent views, view version history and Git modification dates

![Tests — facet rail with category, severity, platform and threat-actor filters beside grouped test cards showing severity badges and test scores](/img/screenshots/tests.png)

:::tip Hybrid Test Library
Tests can come from an upstream Git repository (auto-synced) or from custom local directories. Both sources are indexed with collision-free UUIDs. See [Custom Tests](../user-guide/test-browser/custom-tests) for details.
:::

## Analytics & Measurement

Quantify your security posture with 30+ query endpoints powered by Elasticsearch.

| Feature | Description |
|---------|-------------|
| **Defense Score** | Aggregate score with breakdowns by test, technique, category, hostname, and severity |
| **Trend Analysis** | Rolling-window defense score and error rate trends over time |
| **MITRE ATT&CK Heatmaps** | Host-test matrix showing protection status across your fleet |
| **Coverage Treemaps** | Hierarchical category/subcategory coverage visualization |
| **Execution Table** | Paginated results with advanced filtering (technique, hostname, threat actor, tags) |
| **Multi-Index** | Switch between Elasticsearch indices, create new ones, view index metadata |
| **Defender Integration** | Dedicated Defender tab — per-execution detection rate, Secure Score, alert correlation, MITRE technique overlap, and opt-in alert auto-resolution |
| **Risk Acceptance** | Accept risk on individual controls with audit tracking |
| **Trend Alerting** | Threshold-based Slack and email notifications with in-app notification bell |
| **Archive Executions** | Archive old execution results to declutter active views |

## Execution Framework

Deploy a lightweight Go agent to endpoints for remote test execution with full lifecycle management.

![Agents — fleet pulse rail with online/offline ring, version rollout, groups, key rotation and binaries beside the grouped agent table](/img/screenshots/agents.png)

- **Enrollment** — Token-based registration with configurable TTL and max uses
- **Heartbeat Monitoring** — Real-time online/offline status with CPU, memory, disk, and uptime metrics
- **Task Execution** — Download, verify (SHA256 + Ed25519 signature), execute, and report results with stdout/stderr capture
- **Self-Updating** — Agents poll for new versions and auto-apply cryptographically signed updates
- **Zero-Downtime Key Rotation** — Rotated API keys delivered automatically via heartbeat with 5-minute dual-key grace period
- **Encrypted Config** — Agent credentials encrypted at rest with AES-256-GCM using machine-bound keys
- **Tagging** — Organize agents with custom tags for filtering and bulk operations
- **Cross-Platform** — Windows, Linux, and macOS support (amd64 + arm64)
- **Bundle Results** — Reads per-control results from cyber-hygiene bundles for granular compliance tracking
- **Remote Uninstall** — Two-phase agent removal (stop service + cleanup) initiated from admin UI
- **Agent Diagnostics** — Enhanced `--status` flag showing service state, connection health, and config validation
- **Stale Task Detection** — Tasks auto-fail when agent goes offline during execution
- **Disconnect Reason Reporting** — Agents report why they went offline (service restart, machine reboot, network recovery, update restart) on reconnection
- **Automatic Task Retry** — Tasks that fail due to agent offline are automatically retried (up to 2x) when the agent reconnects
- **Agent Health Score** — Per-agent reliability score (0–100) based on heartbeat consistency, task success rate, and connection stability
- **Offline Alerting** — Configurable alerts for agent offline duration, connection flapping, and fleet online percentage via Slack/email
- **Local Result Queue** — Test results are persisted locally and delivered later if the server is unreachable during reporting
- **Adaptive Heartbeat Backoff** — Heartbeat frequency automatically reduces during extended outages and snaps back on recovery

### Platform Support

| Platform | Architecture | Service Manager | Code Signing | System Info |
|----------|-------------|-----------------|--------------|-------------|
| Windows | amd64 | SCM (`sc.exe`) | Authenticode (osslsigncode) | WMI/native |
| Linux | amd64 | systemd | None | `/proc`, `/etc` |
| macOS | amd64, arm64 | launchd (plist) | Ad-hoc (rcodesign) | sysctl, vm_stat |

## Build System

Compile and sign test binaries on demand with Go cross-compilation.

- **Cross-Compilation** — Build for Linux/Windows/macOS x amd64/arm64 from any host OS
- **Code Signing** — Windows Authenticode signing via osslsigncode, macOS ad-hoc signing via rcodesign
- **Multi-Certificate Management** — Upload PFX/P12 or generate self-signed certs (up to 5)
- **Embed Dependencies** — Detects `//go:embed` directives and allows uploading required files
- **Build Caching** — Previously built binaries cached for instant download

## Task Scheduling

Automate test execution across agent pools with flexible scheduling.

- **Schedule Types** — Once, daily, weekly (specific days), monthly (specific day)
- **Randomized Timing** — Optional randomization within office hours for realistic simulation
- **Per-Task ES Index** — Target specific Elasticsearch indices per task for result isolation
- **Task Notes** — Editable, version-tracked notes on each task
- **Priority Queue** — Higher-priority tasks assigned first

## Integrations

### Microsoft Defender

Sync Secure Score, alerts, and control profiles from Microsoft 365 Defender. A
dedicated **Defender tab** reports the **per-execution detection rate** — what
share of your attack simulations Defender actually caught — alongside alert
drill-downs, control ↔ alert linking, and MITRE technique overlap. The opt-in
**[auto-resolve](../user-guide/integrations/defender-auto-resolve)** pillar can
programmatically resolve Achilles-correlated alerts in Defender so
continuous-validation activity doesn't flood the SOC queue.

### Alerting

Threshold-based alerting when defense scores drop below configured levels:
- **Slack** — Block Kit formatted messages via webhook
- **Email** — Nodemailer with SMTP configuration
- **In-App** — Notification bell with recent alert history

## Console & Navigation

A single dark **f0 design language** across every screen — terminal-green
accent on near-black surfaces, Inter for prose and JetBrains Mono for anything
machine-shaped (hostnames, versions, exit codes, IDs).

Navigation is flat: six destinations in a fixed sidebar, with global search and
notifications docked under the wordmark.

| Destination | What lives there |
|-------------|------------------|
| **Dashboard** | Unified posture across tests, endpoints, and analytics |
| **Tests** | The test library with a faceted browse rail |
| **Analytics** | Defense Score, executions, risk acceptances, Defender |
| **Agents** | Fleet table plus the fleet-pulse utility rail |
| **Tasks** | Live task stream, scheduled tasks, and task detail |
| **Settings** | Integrations, tests, agent binaries, users, API keys |

Keyboard shortcuts: `1`–`6` jump between destinations, `/` focuses the page
search, `⌘K` / `Ctrl+K` opens global search, and `?` lists every shortcut.

See **[Console & Navigation](../user-guide/console/navigation)** for the full
tour.

## Security Hardening

| Protection | Description |
|------------|-------------|
| TLS Enforcement | `skip_tls_verify` blocked for non-localhost; explicit `--allow-insecure` required |
| API Key Rotation | Zero-downtime dual-key rotation with heartbeat delivery |
| Replay Protection | Timestamp validation (5-min window) on all agent requests |
| Binary Verification | SHA256 checksum + Ed25519 signature verification |
| Encrypted Credentials | AES-256-GCM for agent config (machine-bound) |
| Rate Limiting | Per-endpoint budgets (enrollment, device, download, rotation) |
| Semgrep SAST | 11 community rulesets + 11 custom rules in CI |
