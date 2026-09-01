---
sidebar_position: 4
title: "Changelog"
description: "Version history and release notes for ProjectAchilles."
---

# Changelog

All notable changes to ProjectAchilles are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

For the full, detailed changelog, see [CHANGELOG.md on GitHub](https://github.com/projectachilles/ProjectAchilles/blob/main/docs/CHANGELOG.md).

## [2.1.0] — 2026-09-01

Interface release. The console was rebuilt on the **f0 design language**, the
three module dashboards were replaced by one unified Security Dashboard, and
navigation flattened to six destinations.

### Added

- **Unified Security Dashboard** at `/dashboard` — attention banner, six-KPI
  strip, trend overview, severity mix, ATT&CK coverage, category breakdown,
  fleet health, and recent executions, with a 7d/30d/90d range selector and
  per-card degradation instead of redirects.
- **Console & Navigation** — flat six-item sidebar (Dashboard, Tests,
  Analytics, Agents, Tasks, Settings) with docked global search and
  notifications, and keyboard shortcuts (`1`–`6`, `/`, `⌘K`, `?`).
- **Tests** — faceted browse rail (category, severity, platform, threat actor,
  "not run yet") beside grouped test cards.
- **Executions master-detail** — grouped runs on the left, per-control results
  on the right, keyboard selection, and a deep-linkable `?expanded=<id>`.
- **Agents utility rail** — fleet-pulse ring, attention strip, version rollout,
  groups, key rotation, and per-platform binary downloads as native rail cards.
- **Task stream** — chronological stream with date markers, status glyphs,
  collapsible batch rows, and a detail panel; failed test tasks can be
  **retried** in place.
- **Expanded output view** — click `STDOUT` / `STDERR` to open the full output
  in a scrollable dialog.
- **`GET /api/agent/admin/agents/heartbeats`** — bulk hourly heartbeat buckets
  for the whole fleet in one request, replacing one request per agent behind
  the sparkline column.
- **`POST /api/agent/admin/tasks/:id/retry`** — re-dispatch a terminal
  `execute_test` task, linked to the original through `original_task_id`.

### Changed

- **Analytics defaults to a 90-day window** (was 30). Weekly and monthly bundle
  schedules produced empty 30-day charts on healthy programmes.
- **Analytics posture section** rebuilt in analyst columns — a Defense Score
  ledger (Actual / EDR-only / Risk-accepted / Inconclusive) and Secure Score on
  the left, trend overview on the right. Actual Score renders as a neutral
  dashed reference line so it no longer competes with the green series.
- **Coverage and by-host charts** flattened to bar lists; the Test Breadth by
  Host treemap renders at a fixed height again.
- **Scheduled Tasks** on the Tasks page is collapsed by default.
- **Routes flattened** to `/dashboard`, `/tests`, `/analytics`, `/agents`,
  `/tasks`, `/settings`. Every pre-2.1 path redirects, so existing bookmarks
  keep working.

### Removed

- **Theme selector and the Default / Neobrutalism / Hacker Terminal themes.**
  The console ships a single dark theme; stored theme preferences are ignored.
- The per-module Browser, Analytics, and Agent dashboards, superseded by the
  unified Security Dashboard.

## [Unreleased]

### Recent Changes (May–July 2026)

- **Blog** — new blog at [blog.projectachilles.io](https://blog.projectachilles.io)
  (Next.js + MDX) with a Spanish/English auto-translation workflow, RSS, and
  tag archives; linked from the landing page.
- **API keys v1** — `pa_` bearer tokens with scoped read/read-write
  permissions for programmatic access; managed in Settings → API Keys. See the
  [Programmatic Access guide](../api-reference/programmatic-access).
- **`achilles deploy`** — unified CLI deployment TUI (interactive or headless)
  for guided multi-target deploys.
- **Public + on-prem server targets** — single-server installs behind Caddy
  with four TLS modes (`acme-http`, `acme-dns`, `internal`, `byo`), bringing
  the deployment target count to seven.
- **Write-index rollover** — results now ingest into dated write indices
  (`achilles-results-YYYY.MM.DD` / `.YYYY.MM` / static) configured in Analytics
  settings; manual index creation removed.
- **Certificate auth for Defender / Azure** — JWT client assertion as an
  alternative to client secrets in both integrations.
- **Per-machine schedule randomization** — each agent gets an independent
  random execution time within office hours.
- **Rate limiter recalibration** — budgets re-keyed from IP to principal
  (agent ID / Clerk user) so fleets and analyst teams behind one NAT don't
  starve each other: agent device 30/min, enrollment/download 300/15min.
- **Honest task status** — completed tasks with non-zero exit codes display
  as Failed across all task tables.
- **Chart color governance** — semantic chart tokens with WCAG AA contrast
  enforcement and a drift-guard test.
- **SPA self-heal** — the frontend automatically recovers from stale
  code-split chunks after a deploy.

### Earlier Changes (April–May 2026)

- **Defender tab redesign** — rebuilt the Analytics Defender tab: hero row with
  Secure Score, alert volume, and detection-rate tiles; a test-vs-alert
  correlation timeline; an alert drill-down drawer; and control ↔ alert linking.
- **Per-execution detection rate** — the headline Defender metric is now
  `correlatedExecutions / totalExecutions`, an organisation-specific KPI, with
  MITRE parent/sub-technique roll-up and consistent attack-simulation
  exclusions (cyber-hygiene controls and skipped bundle stages).
- **Defender auto-resolve** — opt-in third pillar that programmatically
  resolves Achilles-correlated alerts in Microsoft Defender (`disabled` /
  `dry_run` / `enabled` modes). Never touches test documents or the Defense
  Score.
- **Browser "Has Binary" filter** — toggle to narrow the test list to tests
  that already have a compiled binary.
- **Build listing endpoint** — `GET /api/tests/builds` returns the UUIDs of all
  built tests.

### Major Additions

- **Agent System** — Custom Go agent with enrollment, heartbeat, task execution, self-updating, cross-platform support (Windows/Linux/macOS), remote uninstall, bundle results fan-out
- **Build System** — On-demand Go cross-compilation, Windows Authenticode + macOS ad-hoc signing, multi-certificate management (up to 5), embed dependency detection
- **Task Scheduling** — Recurring execution (once/daily/weekly/monthly), timezone-aware, randomized timing, per-task ES index targeting
- **Analytics** — 30+ query endpoints, Defense Score with breakdowns, heatmaps, treemaps, trend analysis, multi-index management, risk acceptance, archive executions
- **Alerting** — Threshold-based Slack (Block Kit) and email (Nodemailer) notifications, in-app notification bell
- **Microsoft Defender** — Secure Score, Alerts v2, Control Profiles via Graph API; dedicated Defender tab with per-execution detection rate, alert drill-down, control ↔ alert linking, and opt-in alert auto-resolution
- **Browser** — Git-synced test library, MITRE ATT&CK coverage matrix, execution drawer, 3-tab overview dashboard
- **Deployment** — Docker Compose, Railway, Render, Fly.io, Vercel (serverless) targets with comprehensive guides
- **Visual Themes** — Default, Neobrutalism, Hacker Terminal (green/amber phosphor variants)
- **Authentication** — Clerk with social login (Google, Microsoft, GitHub), email/password support

### Breaking Changes

- Removed LimaCharlie integration (replaced by custom agent system)
- All routes now require Clerk authentication
- Endpoints module replaced by Agents module

### Security

- React 19.2.3 (CVE patch)
- Authenticode code signing for binaries
- Semgrep SAST in CI (11 community + 11 custom rulesets)
- AES-256-GCM encryption for all stored credentials
- Resolved all Dependabot advisories

## [1.0.0] - 2024-12-10

### Added

- Core platform with unified startup script
- Browser module — test browsing, detail pages, file viewer, search
- Analytics module — Elasticsearch integration, defense score, trends
- Endpoints module — LimaCharlie integration (since replaced)
- Shared UI component library (Button, Card, Input, Tabs, Badge, etc.)
- TypeScript throughout, path aliases, hot reload
- Helmet.js, CORS, rate limiting, Zod validation

---

| Version | Date | Description |
|---------|------|-------------|
| Unreleased | — | Agent system, build system, scheduling, analytics, 5 deployment targets |
| 1.0.0 | 2024-12-10 | Initial release |
