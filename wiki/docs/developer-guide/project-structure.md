---
sidebar_position: 2
title: "Project Structure"
description: "Understand the ProjectAchilles monorepo structure — frontend, backend, agent, and supporting services."
---

# Project Structure

## Monorepo Layout

```
ProjectAchilles/
├── frontend/              # React 19 + TypeScript + Vite
├── backend/               # Express + TypeScript (ES modules)
├── backend-serverless/    # Vercel serverless fork (Turso + Vercel Blob)
├── agent/                 # Go agent source (cross-platform)
├── scripts/               # Shell scripts (start.sh, setup.sh, etc.)
├── docs/                  # Documentation source files
├── wiki/                  # Documentation site (Docusaurus)
└── docker-compose.yml     # Multi-service deployment
```

## Frontend (`frontend/src/`)

| Directory | Purpose |
|-----------|---------|
| `components/shared/ui/` | Base UI primitives (Button, Card, Input, Badge, etc.) |
| `pages/` | Module pages: browser/, analytics/, endpoints/, auth/, settings/ |
| `services/api/` | API client modules |
| `hooks/` | Custom hooks (`useAuthenticatedApi`, `useAnalyticsFilters`, etc.) |
| `store/` | Redux slices |
| `types/` | TypeScript type definitions |

## Backend (`backend/src/`)

| Directory | Purpose |
|-----------|---------|
| `api/` | Route handlers (`*.routes.ts`) |
| `services/agent/` | Enrollment, heartbeat, tasks, schedules, database |
| `services/analytics/` | Elasticsearch queries, client factory, encrypted settings |
| `services/browser/` | Git sync, test indexing, metadata extraction |
| `services/tests/` | Go cross-compilation, multi-cert management |
| `services/defender/` | Microsoft Graph API client |
| `services/alerting/` | Slack + email dispatch |
| `middleware/` | Auth, error handling, rate limiting |
| `types/` | TypeScript type definitions |

## Agent (`agent/`)

| Directory | Purpose |
|-----------|---------|
| `main.go` | CLI entry point (`--enroll`, `--run`, `--install`, `--status`) |
| `internal/config/` | Configuration management |
| `internal/enrollment/` | Token-based registration |
| `internal/executor/` | Test binary execution |
| `internal/httpclient/` | HTTP client with auth headers |
| `internal/poller/` | Task polling loop |
| `internal/reporter/` | Result reporting |
| `internal/service/` | OS service management (systemd/SCM/launchd) |
| `internal/store/` | Encrypted credential storage |
| `internal/sysinfo/` | Platform-specific system info |
| `internal/updater/` | Self-update mechanism |
