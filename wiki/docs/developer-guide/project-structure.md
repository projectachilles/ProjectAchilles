---
sidebar_position: 2
title: "Project Structure"
description: "Understand the ProjectAchilles monorepo structure — frontend, backend, agent, and supporting services."
---

# Project Structure

## Monorepo Layout

```
ProjectAchilles/
├── frontend/              # React 19 + TypeScript + Vite console
├── backend/               # Express + TypeScript (ES modules)
├── backend-serverless/    # Vercel serverless fork (Turso + Vercel Blob)
├── agent/                 # Go agent source (cross-platform)
├── installer/             # achilles-installer: Go TUI wizard for server installs
├── appliance/             # Windows Hyper-V appliance image build and tests
├── cli/                   # achilles command-line client (Bun + TypeScript)
├── scripts/               # start.sh, deploy-server.sh, install-onprem.sh, generators
├── deploy/                # Caddy config, ES seed data, lab endpoint, offline kit
├── lab-assets/            # Static files some tests fetch over the network
├── docs/                  # Changelog, deployment guides, design notes
├── wiki/                  # Documentation site (Docusaurus)
├── blog/                  # Blog (Next.js + MDX)
├── docker-compose.yml         # Local / simple deployment
├── docker-compose.server.yml  # Single-server install behind Caddy
└── docker-compose.lab.yml     # Lab endpoint
```

`backend/` and `backend-serverless/` are independent codebases. A change in one does not reach the other. See [Backend Serverless](./backend-serverless).

## Frontend (`frontend/src/`)

| Directory | Purpose |
|-----------|---------|
| `components/shared/ui/` | Base UI primitives (Button, Card, Input, Badge, Dialog, Table, Tabs, etc.) |
| `components/layout/` | App shell, page header, global search, notification bell, console identity |
| `pages/` | Pages by area: `dashboard/`, `tests/`, `browser/` (test detail), `analytics/`, `endpoints/` (agents and tasks), `campaigns/`, `settings/`, `auth/`, `landing/` |
| `routes/` | `AppRouter.tsx`: all routes |
| `services/api/` | API client modules |
| `hooks/` | Custom hooks (`useAuthenticatedApi`, `useAnalyticsFilters`, `useCapabilities`, etc.) |
| `store/` | Redux store and slices |
| `lib/` | Shared pure helpers (ATT&CK data, EDR vendor registry, time ranges) |
| `styles/` | `index.css`: theme tokens (single dark theme) |
| `types/` | TypeScript type definitions |

## Backend (`backend/src/`)

| Directory | Purpose |
|-----------|---------|
| `api/` | Route handlers (`*.routes.ts`, agent routes under `api/agent/`) |
| `services/agent/` | Enrollment, heartbeat, tasks, schedules, results ingestion, updates, database |
| `services/analytics/` | Elasticsearch queries, client factory, encrypted settings, posture and stage coverage rules |
| `services/browser/` | Git sync, test indexing, metadata extraction |
| `services/tests/` | Go cross-compilation, build jobs, build environment allowlist, multi-cert management |
| `services/campaigns/` | Saved test campaigns, runs, evidence matrix |
| `services/notices/` | Pre-execution notices and the advance digest |
| `services/outcomes/` | Verdict rules and the EDR vendor registry |
| `services/reports/` | Execution report and JSON export payloads |
| `services/edr/` | Vendor-neutral EDR code: alert enrichment and analytics, agent-kill and launch-block passes, Elasticsearch readiness |
| `services/defender/`, `crowdstrike/`, `sentinelone/`, `sophos/` | One directory per EDR integration: API client, sync, analytics, auto-resolve |
| `services/alerts/` | Threshold alerting, Slack + email dispatch |
| `services/integrations/` | Encrypted integration settings (`integrations.json`) |
| `services/apiKeys/`, `cliSessions.ts` | API keys and CLI sign-in sessions |
| `services/consoleIdentity/` | Console identity (code, name, colour) |
| `services/risk-acceptance/` | Risk acceptances |
| `services/shared/` | Encryption and other shared helpers |
| `middleware/` | Auth (Clerk, API key, CLI token, agent key), org scoping, error handling, rate limiting, validation |
| `data/` | Generated ATT&CK technique and tactic data |
| `schemas/` | Request validation schemas |
| `types/` | TypeScript type definitions |

## Agent (`agent/`)

| Directory | Purpose |
|-----------|---------|
| `main.go` | CLI entry point (`--enroll`, `--install`, `--run`, `--status`, `--reload`, `--uninstall`, `--version`) |
| `Makefile` | Cross-compilation, signing and checksum targets |
| `internal/config/` | Configuration management |
| `internal/enrollment/` | Token-based registration |
| `internal/executor/` | Test binary execution, bundle results, test-leftover cleanup |
| `internal/httpclient/` | HTTP client with auth headers |
| `internal/poller/` | Task polling loop |
| `internal/queue/` | On-disk queue for results that could not be sent |
| `internal/reporter/` | Result reporting |
| `internal/service/` | OS service management (systemd/SCM/launchd) |
| `internal/status/` | `--status` output |
| `internal/store/` | Encrypted credential storage |
| `internal/sysinfo/` | Platform-specific system info |
| `internal/uninstaller/` | Uninstall and per-platform cleanup |
| `internal/updater/` | Self-update mechanism and post-install check |
| `internal/winacl/` | Windows folder permissions for the install folder |
