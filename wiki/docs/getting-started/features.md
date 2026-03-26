---
sidebar_position: 2
title: Features Overview
description: A comprehensive overview of all ProjectAchilles features — AI-powered test development, test browser, execution framework, analytics & measurement, build system, scheduling, and integrations.
---

# Features Overview

ProjectAchilles is built around three pillars — **develop tests**, **execute them**, and **measure the results** — each accessible from a unified web interface with Clerk authentication.

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
- **MITRE ATT&CK coverage matrix** with visual technique heatmap
- **Execution drawer** — assign and run tests directly from the browse page
- **Favorite tests**, track recent views, view version history and Git modification dates

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
| **Defender Integration** | Sync Secure Score, alerts, and control profiles with cross-correlation analytics |
| **Risk Acceptance** | Accept risk on individual controls with audit tracking |
| **Trend Alerting** | Threshold-based Slack and email notifications with in-app notification bell |
| **Archive Executions** | Archive old execution results to declutter active views |

## Execution Framework

Deploy a lightweight Go agent to endpoints for remote test execution with full lifecycle management.

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

Sync Secure Score, alerts, and control profiles from Microsoft 365 Defender. Cross-correlate MITRE techniques between your test results and real Defender alerts.

### Alerting

Threshold-based alerting when defense scores drop below configured levels:
- **Slack** — Block Kit formatted messages via webhook
- **Email** — Nodemailer with SMTP configuration
- **In-App** — Notification bell with recent alert history

## Visual Themes

Three selectable themes to match your team's preference:

| Theme | Description |
|-------|-------------|
| **Default** | Clean light/dark mode with purple accent |
| **Neobrutalism** | Hot pink accent, bold borders, high contrast |
| **Hacker Terminal** | Phosphor green/amber with scanline effects |

## Security Hardening

| Protection | Description |
|------------|-------------|
| TLS Enforcement | `skip_tls_verify` blocked for non-localhost; explicit `--allow-insecure` required |
| API Key Rotation | Zero-downtime dual-key rotation with heartbeat delivery |
| Replay Protection | Timestamp validation (5-min window) on all agent requests |
| Binary Verification | SHA256 checksum + Ed25519 signature verification |
| Encrypted Credentials | AES-256-GCM for agent config (machine-bound) |
| Rate Limiting | Per-endpoint budgets (enrollment, device, download, rotation) |
| Semgrep SAST | 11 community rulesets + 5 custom rules in CI |
