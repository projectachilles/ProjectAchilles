---
sidebar_position: 2
title: Features Overview
description: A comprehensive overview of all ProjectAchilles features — test browser, analytics dashboard, agent system, build system, scheduling, and integrations.
---

# Features Overview

ProjectAchilles consists of five core modules, each accessible from a unified web interface with Clerk authentication.

## Test Browser

Browse a git-synced library of security tests with rich metadata. Each test includes source code, documentation, detection rules (KQL/YARA), and attack flow diagrams.

- **Filter and search** by MITRE ATT&CK technique, platform, category, and severity
- **Favorite tests** and track recent views
- **View details** including version history, author info, and Git modification dates
- **Copy-to-clipboard** for detection rules and test artifacts
- **Build, sign, and download** test binaries directly from test detail pages
- **MITRE ATT&CK coverage matrix** with visual technique heatmap
- **Overview dashboard** with 3-tab layout (overview, matrix, list) and category legend
- **Execution drawer** — run tests directly from the browse page

:::tip Hybrid Test Library
Tests can come from an upstream Git repository (auto-synced) or from custom local directories. Both sources are indexed with collision-free UUIDs. See [Custom Tests](../user-guide/test-browser/custom-tests) for details.
:::

## Analytics Dashboard

Measure your defensive posture with 30+ query endpoints powered by Elasticsearch.

| Feature | Description |
|---------|-------------|
| **Defense Score** | Aggregate score with breakdowns by test, technique, category, hostname, and severity |
| **Trend Analysis** | Rolling-window defense score and error rate trends over time |
| **Heatmaps** | Host-test matrix showing protection status across your fleet |
| **Treemaps** | Hierarchical category/subcategory coverage visualization |
| **Execution Table** | Paginated results with advanced filtering (technique, hostname, threat actor, tags, error codes) |
| **Multi-Index** | Switch between Elasticsearch indices, create new ones, view index metadata |
| **Defender Integration** | Sync Secure Score, alerts, and control profiles with cross-correlation analytics |
| **Dual Defense Score** | Real score and trend line overlay for tracking trajectory |
| **Risk Acceptance** | Accept risk on individual controls with audit tracking |
| **Trend Alerting** | Threshold-based Slack (Block Kit) and email (Nodemailer) notifications |
| **Notification Bell** | In-app alert dropdown showing recent threshold breaches |
| **Archive Executions** | Archive old execution results to declutter active views |

## Agent System

Deploy a custom Go agent to endpoints for remote test execution with full lifecycle management.

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
