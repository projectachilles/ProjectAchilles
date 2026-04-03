---
sidebar_position: 4
title: "Changelog"
description: "Version history and release notes for ProjectAchilles."
---

# Changelog

All notable changes to ProjectAchilles are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

For the full, detailed changelog, see [CHANGELOG.md on GitHub](https://github.com/projectachilles/ProjectAchilles/blob/main/docs/CHANGELOG.md).

## [Unreleased]

### Major Additions

- **Agent System** — Custom Go agent with enrollment, heartbeat, task execution, self-updating, cross-platform support (Windows/Linux/macOS), remote uninstall, bundle results fan-out
- **Build System** — On-demand Go cross-compilation, Windows Authenticode + macOS ad-hoc signing, multi-certificate management (up to 5), embed dependency detection
- **Task Scheduling** — Recurring execution (once/daily/weekly/monthly), timezone-aware, randomized timing, per-task ES index targeting
- **Analytics** — 30+ query endpoints, Defense Score with breakdowns, heatmaps, treemaps, trend analysis, multi-index management, risk acceptance, archive executions
- **Alerting** — Threshold-based Slack (Block Kit) and email (Nodemailer) notifications, in-app notification bell
- **Microsoft Defender** — Secure Score, Alerts v2, Control Profiles via Graph API, cross-correlation analytics
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
- Semgrep SAST in CI (11 community + 5 custom rulesets)
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
