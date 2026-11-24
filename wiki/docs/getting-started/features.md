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

![Security Dashboard — attention chips, KPI strip, trend overview, testing cadence, threat actor readiness and ATT&CK outcome matrix](/img/screenshots/security-dashboard.png)

- **Attention chips** — derived, not stored: quiet count chips for offline
  agents, stale agents, failed tasks, outdated agents, and a failed library
  sync, each linking to the page that resolves it
- **KPI strip** — Defense Score, Secure Score, total tests, average score,
  and agents online
- **Trend overview**, **testing cadence** (14-day activity, last run, next
  scheduled run), **threat actor readiness**, **ATT&CK outcome matrix**,
  **fleet health**, and **recent executions**
- **24h / 7d / 30d / 90d / All** range selector, defaulting to 30 days and
  shared with Analytics
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
| Documentation | Markdown (README + info card) | MITRE mapping, threat actor context |
| Kill chain diagram | Interactive HTML | Visualizes multi-stage attack flow |

![Test page, Kill chain tab — the test header and tab row above the kill chain diagram: technique cards and the stage progression](/img/screenshots/test-detail-killchain.png)

**Test categories:**

| Category | Description | Example |
|----------|-------------|---------|
| **Intel-Driven** | Real-world attack techniques from APT reports and ransomware analysis | Lazarus group TTPs, Emotet delivery chains |
| **MITRE Top 10** | Most common ransomware techniques from MITRE ATT&CK | Process injection, defense evasion, lateral movement |
| **Cyber-Hygiene** | Configuration validation for endpoint, identity, and cloud security | Defender settings, ASR rules, LSASS protection, MFA |

:::info[Companion Repository]
The test development pipeline lives in a companion repository. Tests are synced to ProjectAchilles via Git for browsing, building, and execution.
:::

## Test Browser

Browse the full test library with rich metadata and execute tests directly from the UI.

- **Filter and search** by MITRE ATT&CK technique, platform, category, and threat actor
- **Fleet result per test** — each row shows how the test last went across your endpoints
- **Sync** the library from the Tests page header
- **Tabbed test pages** — an Overview written from the test's own documentation, per-stage results across the fleet, plus source code, detection rules, hardening scripts, and attack flow diagrams
- **Build, sign, and download** test binaries directly from test detail pages
- **MITRE ATT&CK coverage chart** with per-tactic bar visualization
- **Execution drawer** — assign and run tests directly from the browse page
- **Favorite tests**, track recent views, view version history and Git modification dates

![Tests — the test library list with category, platform and threat-actor filters, and each test's fleet result](/img/screenshots/tests.png)

:::tip[Hybrid Test Library]
Tests can come from an upstream Git repository (auto-synced) or from custom local directories. Both sources are indexed with collision-free UUIDs. See [Custom Tests](../user-guide/test-browser/custom-tests) for details.
:::

## Analytics & Measurement

Quantify your security posture with 30+ query endpoints powered by Elasticsearch.

| Feature | Description |
|---------|-------------|
| **Defense Score** | Current posture: the share of test × endpoint pairs whose most recent result in the selected window was blocked or detected. Breakdowns cover category, hostname, ATT&CK technique and test coverage. |
| **Outcome Breakdown** | Splits the latest results into Protected, Prevented, Detected only and Silent, using the EDR alerts matched to each run (not on Vercel) |
| **Stage Coverage** | For multi-stage attack chains: how many stages were blocked, detected or got through, and which chains were stopped at a single stage (not on Vercel) |
| **Chain Depth** | How far each attack chain got on its latest run per host |
| **Trend Analysis** | The same score as of each day, ending at today's value, plus the error-rate trend. Gaps mark periods with no results in the window. |
| **ATT&CK Coverage Matrix** | One cell per technique, coloured by the share of its test x endpoint results that were stopped |
| **Coverage by Test and Host** | Test Coverage, Defense Score by Host and Test Breadth by Host cards |
| **Execution Table** | Paginated results with advanced filtering (technique, hostname, threat actor, tags) and CSV/JSON export of every matching result |
| **Execution Report** | Print-ready report (PDF through the browser) of the selected window |
| **Multi-Index** | Switch between Elasticsearch indices, create new ones, view index metadata |
| **EDR Tabs** | One tab per configured EDR (Microsoft Defender, CrowdStrike, SentinelOne, Sophos) — evidence-based detection rate, posture score, alert correlation, MITRE technique overlap, and opt-in alert auto-resolution |
| **Risk Acceptance** | Accept risk on individual controls with audit tracking |
| **Trend Alerting** | Threshold-based Slack and email notifications with in-app notification bell |
| **Archive Executions** | Archive old execution results to declutter active views |

## Execution Framework

Deploy a lightweight Go agent to endpoints for remote test execution with full lifecycle management.

![Agents — fleet pulse rail with online/offline ring, version rollout, groups, key rotation and binaries beside the grouped agent table](/img/screenshots/agents.png)

- **Enrollment** — Token-based registration with configurable TTL and max uses
- **Heartbeat Monitoring** — Real-time online/offline status with CPU, memory, disk, and uptime metrics
- **Task Execution** — Download, verify (SHA256 and size), execute, and report results with stdout/stderr capture
- **Self-Updating** — Agents poll for new versions and auto-apply cryptographically signed updates
- **Zero-Downtime Key Rotation** — Rotated API keys delivered automatically via heartbeat with 5-minute dual-key grace period
- **Encrypted Config** — Agent credentials encrypted at rest with AES-256-GCM using machine-bound keys
- **Tagging** — Organize agents with custom tags for filtering and bulk operations
- **Locked Install Folder** — The agent installs into `C:\F0` (Windows) or `/opt/f0` (Linux, macOS) and restricts the folder to SYSTEM and Administrators (root)
- **Test Leftover Cleanup** — Before and after every run the agent empties the test-artifact folder and the decoy folder, keeping its own files and undo files, and at startup it sweeps stale task folders
- **Cross-Platform** — Windows, Linux, and macOS support (amd64 + arm64)
- **Bundle Results** — Reads per-control results from cyber-hygiene bundles for granular compliance tracking
- **Remote Uninstall** — Two-phase agent removal (stop service + cleanup) initiated from admin UI
- **Agent Diagnostics** — Enhanced `--status` flag showing service state, connection health, and config validation
- **Stale Task Detection** — Tasks auto-fail when agent goes offline during execution
- **EDR-Aware Results** — When a connected EDR killed the agent mid-test or blocked the test before it started, and its alert proves it, the run counts as Protected instead of an error (not on Vercel)
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
| macOS | amd64, arm64 | launchd (plist) | Ad-hoc (rcodesign or codesign) | sysctl, vm_stat |

## Build System

Compile and sign test binaries on demand with Go cross-compilation.

- **Cross-Compilation** — Build for Linux/Windows/macOS x amd64/arm64 from any host OS
- **Code Signing** — Windows Authenticode signing via osslsigncode, macOS ad-hoc signing via rcodesign
- **Multi-Certificate Management** — Upload PFX/P12 or generate self-signed certs (up to 5)
- **Embed Dependencies** — Detects `//go:embed` directives and allows uploading required files
- **Build Caching** — Previously built binaries cached for instant download
- **Isolated Build Environment** — Build scripts get an allowlisted environment, so test-library code cannot read the backend's secrets from it

Builds need a Go toolchain and are not available on Vercel; upload a prebuilt binary there.

## Tasks, Schedules, and Campaigns

The Tasks page has three views: **Runs**, **Schedules** and **Campaigns**.

- **Schedule Types** — Once, daily, weekly (specific days), monthly (specific day)
- **Randomized Timing** — Optional randomization within office hours for realistic simulation, also for one-off (Once) schedules
- **Campaigns** — Save a plan of tests × agents, run it with one click, and get an evidence matrix per run that you can export as CSV or print. See [Campaigns](../user-guide/agent-management/campaigns) (not on Vercel)
- **Pre-execution Notices** — Email the security engineers before every test run and hold the tests until the mail server has accepted the notice, with an optional day-before digest. See [Pre-execution Notices](../user-guide/integrations/pre-execution-notices) (not on Vercel)
- **Deleted Tasks Are Archived** — Deleting a finished task keeps an archived copy on the server
- **Per-Task ES Index** — Target specific Elasticsearch indices per task for result isolation
- **Task Notes** — Editable, version-tracked notes on each task
- **Priority Queue** — Higher-priority tasks assigned first

## Integrations

### Microsoft Defender

Sync Secure Score, alerts, and control profiles from Microsoft 365 Defender. A
dedicated **Defender tab** reports the **evidence-based detection rate** — what
share of your attack simulations Defender actually caught (from per-run enrichment flags) — alongside alert
drill-downs, control ↔ alert linking, and MITRE technique overlap. The opt-in
**[auto-resolve](../user-guide/integrations/defender-auto-resolve)** pillar can
programmatically resolve Achilles-correlated alerts in Defender so
continuous-validation activity doesn't flood the SOC queue.

### CrowdStrike Falcon

Syncs alerts and Zero Trust Assessment scores, correlates alerts with the tests that caused them, and can auto-resolve test alerts. See [CrowdStrike](../user-guide/integrations/crowdstrike).

### SentinelOne

Syncs threats and detection alerts from the SentinelOne Management API, plus a posture pass (policies, agent health, exclusion gaps) and an Endpoint Protection score computed by Achilles. Auto-resolve and automatic mitigation of test threats are opt-in. Not available on Vercel. See [SentinelOne](../user-guide/integrations/sentinelone).

### Sophos Central

Syncs alerts, SIEM events and XDR detections from one Sophos Central tenant, plus Account Health Check posture. Auto-resolve of test alerts is opt-in. Not available on Vercel. See [Sophos](../user-guide/integrations/sophos).

EDR integration settings apply to the whole deployment, not to one organization.

### Alerting

Threshold-based alerting when defense scores drop below configured levels:
- **Slack** — Block Kit formatted messages via webhook
- **Email** — Nodemailer with SMTP configuration
- **In-App** — Notification bell with recent alert history

Alerting is not available on Vercel.

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
| **Analytics** | Defense Score, executions, risk acceptances, and one tab per configured EDR |
| **Agents** | Fleet table plus the fleet-pulse utility rail |
| **Tasks** | Runs, schedules, and campaigns |
| **Settings** | General (console identity), integrations, tests, agent binaries, users, API keys |

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
| Binary Verification | SHA256 check of test binaries; SHA256 + Ed25519 signature for agent updates, plus a launch check after the update |
| Encrypted Credentials | AES-256-GCM for agent config (machine-bound) |
| Rate Limiting | Per-endpoint budgets (enrollment, device, download, rotation) |
| Semgrep SAST | 11 community rulesets + 11 custom rules in CI |
| CodeQL | Code scanning for Go, JavaScript/TypeScript, Python and GitHub Actions on every PR |
| Session-Only Administration | User management, API keys and CLI sign-in approval need a browser session; a leaked API key or CLI token cannot create more credentials |
| Organization Scoping | Agents, tasks, schedules and analytics results are limited to the caller's organization |
