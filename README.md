# ProjectAchilles

<div align="center">

![ProjectAchilles](https://img.shields.io/badge/ProjectAchilles-Purple%20Team%20Platform-7C3AED?style=for-the-badge)

[![CI](https://github.com/projectachilles/ProjectAchilles/actions/workflows/ci.yml/badge.svg)](https://github.com/projectachilles/ProjectAchilles/actions/workflows/ci.yml)
[![Security Review](https://github.com/projectachilles/ProjectAchilles/actions/workflows/security-review.yml/badge.svg?event=pull_request)](https://github.com/projectachilles/ProjectAchilles/actions/workflows/security-review.yml)
[![Semgrep](https://img.shields.io/badge/semgrep-SAST-orange?logo=semgrep)](https://github.com/projectachilles/ProjectAchilles/actions/workflows/security-review.yml)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Go](https://img.shields.io/badge/Go-1.24-00ADD8?logo=go&logoColor=white)](https://go.dev/)

**The Open-Source Purple Team Platform for Continuous Security Validation**

Execute security tests on endpoints, measure detection coverage, and close defensive gaps — all from one unified interface.

[Quick Start](#quick-start) · [Features](#features) · [Architecture](#architecture) · [Documentation](#documentation) · [Roadmap](docs/ROADMAP.md) · [Contributing](#contributing)

</div>

---

## Overview

ProjectAchilles is a purple team platform that bridges the gap between offensive testing and defensive measurement. Red teams deploy a lightweight Go agent to endpoints and execute security tests on demand or on schedule. Blue teams track detection coverage through an analytics dashboard backed by Elasticsearch, identifying which techniques are detected, which are missed, and where to focus hardening efforts.

The platform replaces the need for commercial endpoint management tools with a purpose-built, open-source agent system — complete with cross-compilation, code signing, task scheduling, and result ingestion.

## Key Highlights

- **Custom Go Agent** — Lightweight agent with enrollment, heartbeat monitoring, task execution, and self-updating
- **Build From Source** — Cross-compile test binaries for Windows/Linux (amd64/arm64) directly from the UI
- **Code Signing** — Sign Windows binaries with Authenticode via multi-certificate management (up to 5 certs)
- **30+ Analytics Endpoints** — Defense scores, heatmaps, treemaps, error rate trends, and coverage breakdowns
- **MITRE ATT&CK Mapping** — Filter tests and results by technique, tactic, and threat actor
- **Task Scheduling** — Recurring execution (daily/weekly/monthly) with randomized timing
- **Docker Compose Deployment** — One-command deployment with optional local Elasticsearch
- **Git-Synced Test Library** — Tests pulled from a Git repository with automatic sync
- **Multi-Index Management** — Per-task Elasticsearch index targeting for isolated result sets
- **Microsoft Defender Integration** — Sync Secure Score, alerts, and control profiles from Microsoft 365 Defender with MITRE cross-correlation
- **Trend Alerting** — Threshold-based Slack and email notifications with in-app notification bell
- **MITRE ATT&CK Coverage Matrix** — Visual technique coverage heatmap on the browse page
- **3 Visual Themes** — Default, Neobrutalism, and Hacker Terminal (with green/amber phosphor variants)
- **5 Deployment Targets** — Docker Compose, Railway, Render, Fly.io, and Vercel (serverless)
- **Remote Agent Uninstall** — Two-phase uninstall with service removal and cleanup verification
- **Risk Acceptance** — Accept risk for individual security controls with tracking
- **macOS Agent Support** — Native launchd service with ad-hoc code signing via rcodesign

## Quick Start

### Path A — Local Development

```bash
# Clone the repository
git clone https://github.com/projectachilles/ProjectAchilles.git
cd ProjectAchilles

# Start the full stack (installs deps, finds available ports)
./scripts/start.sh -k --daemon
```

Configure Clerk authentication (see [Configuration](#configuration)), then open http://localhost:5173.

### Path B — Docker Compose

```bash
# Clone and run the setup wizard
git clone https://github.com/projectachilles/ProjectAchilles.git
cd ProjectAchilles
./scripts/setup.sh

# Start services
docker compose up -d

# Optional: include local Elasticsearch with synthetic data
docker compose --profile elasticsearch up -d
```

### Path C — Windows (PowerShell)

```powershell
git clone https://github.com/your-org/ProjectAchilles.git
cd ProjectAchilles
.\scripts\Install-ProjectAchilles.ps1
```

The PowerShell script checks prerequisites, fixes line endings, configures `backend/.env` interactively, builds Docker images, and opens the dashboard. See [Windows Docker Installation](docs/deployment/WINDOWS_DOCKER_INSTALL.md) for the full manual guide.

### Deployment Targets

| Target | Backend | Database | Agent Builds | Guide |
|--------|---------|----------|-------------|-------|
| **Docker Compose** | `backend/` | SQLite (volume) | Yes | [docker-compose.yml](docker-compose.yml) |
| **Railway** | `backend/` | SQLite (volume) | Partial | [Railway Guide](docs/deployment/RAILWAY.md) |
| **Render** | `backend/` | SQLite (persistent disk) | Partial | [Render Guide](docs/deployment/RENDER.md) |
| **Fly.io** | `backend/` | SQLite (volume) | Yes | [Fly.io Guide](docs/deployment/FLY.md) |
| **Vercel** | `backend-serverless/` | Turso (libSQL) | No | [Vercel Guide](docs/deployment/VERCEL.md) |

## Features

### Test Browser

Browse a git-synced library of security tests with rich metadata. Each test includes source code, documentation, detection rules (KQL/YARA), and attack flow diagrams.

- Filter by MITRE ATT&CK technique, platform, category, and severity
- Favorite tests and track recent views
- View version history, author info, and Git modification dates
- Copy-to-clipboard for detection rules and test artifacts
- Build, sign, and download test binaries directly from test detail pages
- MITRE ATT&CK coverage matrix with visual technique heatmap
- Overview dashboard with 3-tab layout (overview, matrix, list) and category legend
- Execution drawer — run tests directly from the browse page

### Analytics Dashboard

Measure your defensive posture with 30+ query endpoints powered by Elasticsearch.

- **Defense Score** — Aggregate score with breakdowns by test, technique, category, hostname, and severity
- **Trend Analysis** — Rolling-window defense score and error rate trends over time
- **Heatmaps** — Host-test matrix showing protection status across your fleet
- **Treemaps** — Hierarchical category/subcategory coverage visualization
- **Execution Table** — Paginated results with advanced filtering (technique, hostname, threat actor, tags, error codes)
- **Multi-Index Management** — Switch between Elasticsearch indices, create new ones, view index metadata
- **Microsoft Defender Integration** — Sync Secure Score, alerts, and control profiles with cross-correlation analytics
- **Dual Defense Score** — Real score and trend line overlay for tracking trajectory
- **Risk Acceptance** — Accept risk on individual controls with audit tracking
- **Trend Alerting** — Threshold-based Slack (Block Kit) and email (Nodemailer) notifications
- **Notification Bell** — In-app alert dropdown showing recent threshold breaches
- **Archive Executions** — Archive old execution results to declutter active views
- **Shared FilterBar** — Unified filter bar across Analytics dashboard tabs

### Agent System

Deploy a custom Go agent to endpoints for remote test execution with full lifecycle management.

- **Enrollment** — Token-based registration with configurable TTL and max uses
- **Heartbeat Monitoring** — Real-time online/offline status with CPU, memory, disk, and uptime metrics
- **Task Execution** — Download, verify (SHA256 + Ed25519 signature), execute, and report results with stdout/stderr capture
- **Self-Updating** — Agents poll for new versions and auto-apply cryptographically signed updates
- **Zero-Downtime Key Rotation** — Rotated API keys delivered automatically via heartbeat with 5-minute dual-key grace period
- **Encrypted Config** — Agent credentials encrypted at rest with AES-256-GCM using machine-bound keys
- **Tagging** — Organize agents with custom tags for filtering and bulk operations
- **Cross-Platform** — Windows, Linux, and macOS support (amd64 + arm64)
- **Bundle Results** — Reads per-control results from cyber-hygiene bundles and fans out to individual ES documents for granular compliance tracking
- **Remote Uninstall** — Two-phase agent removal (stop service + cleanup) initiated from admin UI
- **Agent Diagnostics** — Enhanced `--status` flag showing service state, connection health, and config validation
- **macOS Support** — Native launchd plist at `/Library/LaunchDaemons/`, sysinfo via sysctl/vm_stat, ad-hoc code signing via rcodesign
- **Stale Task Detection** — Tasks auto-fail when agent goes offline during execution
- **Windows Job Objects** — Orphan process cleanup for async task execution

### Build System

Compile and sign test binaries on demand with Go cross-compilation.

- **Cross-Compilation** — Build for Linux/Windows × amd64/arm64 from any host OS
- **Code Signing** — Windows Authenticode signing via osslsigncode
- **Multi-Certificate Management** — Upload PFX/P12 or generate self-signed certs (up to 5)
- **Embed Dependencies** — Detects `//go:embed` directives and allows uploading required files
- **Build Caching** — Previously built binaries cached for instant download

### Task Scheduling

Automate test execution across agent pools with flexible scheduling.

- **Schedule Types** — Once, daily, weekly (specific days), monthly (specific day)
- **Randomized Timing** — Optional randomization within office hours for realistic simulation
- **Per-Task ES Index** — Target specific Elasticsearch indices per task for result isolation
- **Task Notes** — Editable, version-tracked notes on each task
- **Priority Queue** — Higher-priority tasks assigned first

### Agent Communication Security

The agent-server communication channel has been hardened through an internal security audit covering 9 findings. All HIGH and MEDIUM findings are resolved. See [Agent Security Findings](docs/agent-security-findings.md) for full details.

| Protection | Description |
|------------|-------------|
| **TLS Enforcement** | `skip_tls_verify` blocked for non-localhost servers; explicit `--allow-insecure` override required |
| **API Key Rotation** | Zero-downtime rotation via heartbeat delivery with 5-minute dual-key grace period |
| **Replay Protection** | `X-Request-Timestamp` header with 5-minute skew window; payload-level timestamp validation |
| **Timing Oracle Prevention** | Constant-time bcrypt comparison on enrollment and auth (dummy hash on miss) |
| **Update Signatures** | Ed25519 detached signatures on agent binaries; verified before applying updates |
| **Rate Limiting** | Per-endpoint budgets: enrollment (5/15min), device (100/15min), download (10/15min), rotation (3/15min) |
| **Encrypted Credentials** | Agent API key encrypted at rest with AES-256-GCM; key derived from machine ID (non-portable) |
| **Least-Privilege Permissions** | Binary `0700` / Windows SYSTEM+Admins ACL; config `0600`; work dirs `0700` |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (React SPA)                        │
│   Browser  │  Analytics  │  Agents  │  Settings  │  Scheduling     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ REST API
┌──────────────────────────────┴──────────────────────────────────────┐
│                      Backend (Express + TS)                        │
│                                                                    │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Browser  │  │ Analytics │  │  Agent   │  │     Build        │  │
│  │ Service  │  │  Service  │  │ Service  │  │    Service       │  │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘  └───────┬──────────┘  │
│       │              │             │                │              │
│  ┌────┴─────┐  ┌─────┴─────┐  ┌───┴──────┐  ┌──────┴──────────┐  │
│  │ Git Repo │  │Elastic-   │  │ SQLite   │  │ Go Toolchain    │  │
│  │ (Tests)  │  │search     │  │ (Agents, │  │ + osslsigncode  │  │
│  └──────────┘  └───────────┘  │  Tasks)  │  └─────────────────┘  │
│                               └──────────┘                        │
│  ┌────────────────────────┐  ┌───────────────────────────────┐    │
│  │ Alerting Service       │  │ Defender Service              │    │
│  │ (Slack + Email)        │  │ (Graph API client)            │    │
│  └────────────────────────┘  └──────────┬────────────────────┘    │
└──────────────────────────────────────────┼────────────────────────┘
                               │           │
                    ┌──────────┴──────┐  ┌─┴──────────────────┐
                    │  Achilles Agent │  │ Microsoft Graph API │
                    │  (Go binary)   │  │ (Secure Score,      │
                    │  ┌───────────┐ │  │  Alerts, Controls)  │
                    │  │ Heartbeat │ │  └─────────────────────┘
                    │  │ Executor  │ │
                    │  │ Updater   │ │
                    │  └───────────┘ │
                    └────────────────┘
                         Endpoints
```

### Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Frontend | React | 19.2 |
| Build Tool | Vite | 7.2 |
| Styling | Tailwind CSS | 4.1 |
| State Management | Redux Toolkit | 2.10 |
| Routing | React Router | 7.13 |
| Authentication | Clerk | 5.x |
| Backend | Express | 4.18 |
| Language | TypeScript | 5.9 |
| Agent | Go | 1.24 |
| Analytics Store | Elasticsearch | 8.17 |
| Agent Database | SQLite | 3.x |
| Code Signing | osslsigncode | — |
| Containerization | Docker Compose | — |

### Project Structure

```
ProjectAchilles/
├── frontend/                  # React 19 + TypeScript + Vite
│   └── src/
│       ├── components/        # Shared UI primitives
│       ├── pages/             # Module pages (browser, analytics, agents, settings)
│       ├── services/api/      # API client modules
│       ├── hooks/             # Custom hooks (useAuthenticatedApi, etc.)
│       └── store/             # Redux slices
├── backend/                   # Express + TypeScript (ES modules)
│   └── src/
│       ├── api/               # Route handlers (*.routes.ts)
│       ├── services/          # Business logic by module
│       ├── middleware/         # Auth, error handling, rate limiting
│       └── types/             # TypeScript definitions
├── agent/                     # Go agent source
│   ├── main.go                # CLI entry point (--enroll, --run, --install)
│   └── internal/              # Agent modules (poller, executor, updater, sysinfo)
├── scripts/                   # Shell scripts and PowerShell bootstrap
│   ├── start.sh               # Development startup script
│   ├── setup.sh               # Interactive setup wizard (Linux/macOS)
│   └── Install-ProjectAchilles.ps1 # Bootstrap script (Windows)
├── docs/                      # Documentation
│   ├── deployment/            # Deployment guides (Fly, Railway, Render, Vercel)
│   └── security/              # Security audit and remediation docs
├── docker-compose.yml         # Multi-service deployment
└── CLAUDE.md                  # AI assistant development guidance
```

## Configuration

### Authentication (Required)

All modules require [Clerk](https://clerk.com) authentication. Create a Clerk application and configure your keys:

```bash
# frontend/.env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# backend/.env
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

### Environment Variables

#### Frontend

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key | — (required) |
| `VITE_BACKEND_PORT` | Backend port for Vite proxy | `3000` |
| `VITE_API_URL` | Full backend URL (production) | — |

#### Backend

| Variable | Description | Default |
|----------|-------------|---------|
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key | — (required) |
| `CLERK_SECRET_KEY` | Clerk secret key | — (required) |
| `PORT` | Server port | `3000` |
| `SESSION_SECRET` | Session signing key | — (required in prod) |
| `CORS_ORIGIN` | Allowed CORS origin | `http://localhost:5173` |
| `TESTS_REPO_URL` | Git URL for test library | — |
| `GITHUB_TOKEN` | PAT for private repos | — |
| `TESTS_SOURCE_PATH` | Local fallback path for tests | `./tests_source` |
| `AGENT_SERVER_URL` | External URL for agent communication | — |
| `ENCRYPTION_SECRET` | Encryption key for settings at rest | Machine-derived |

#### Elasticsearch (optional)

| Variable | Description |
|----------|-------------|
| `ELASTICSEARCH_CLOUD_ID` | Elastic Cloud deployment ID |
| `ELASTICSEARCH_API_KEY` | API key for authentication |
| `ELASTICSEARCH_NODE` | Direct node URL (e.g., `http://localhost:9200`) |
| `ELASTICSEARCH_INDEX_PATTERN` | Index pattern (default: `achilles-results-*`) |

#### Docker

| Variable | Description |
|----------|-------------|
| `NGROK_FRONTEND_DOMAIN` | ngrok domain for frontend tunnel |
| `NGROK_BACKEND_DOMAIN` | ngrok domain for backend/agent tunnel |

## API Reference

> All endpoints require Clerk JWT authentication unless noted. Include `Authorization: Bearer <token>` header.

### Browser

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/browser/tests` | List all security tests |
| `GET` | `/api/browser/tests/:uuid` | Get test details with metadata |
| `GET` | `/api/browser/tests/:uuid/files` | List test files |
| `GET` | `/api/browser/tests/:uuid/files/:filename` | Get file contents |

### Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/analytics/defense-score` | Aggregate defense score |
| `GET` | `/api/analytics/defense-score/trend` | Score trend over time |
| `GET` | `/api/analytics/host-test-matrix` | Host × test heatmap data |
| `GET` | `/api/analytics/technique-distribution` | Technique coverage breakdown |
| `GET` | `/api/analytics/executions/paginated` | Paginated results with filters |
| `POST` | `/api/analytics/settings` | Configure Elasticsearch connection |

### Agent (Admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/agent/admin/agents` | List agents with filters |
| `POST` | `/api/agent/admin/tokens` | Create enrollment token |
| `POST` | `/api/agent/admin/tasks` | Create task for agent(s) |
| `GET` | `/api/agent/admin/schedules` | List schedules |
| `POST` | `/api/agent/admin/schedules` | Create recurring schedule |

### Agent (Device)

| Method | Endpoint | Auth |
|--------|----------|------|
| `POST` | `/api/agent/enroll` | Enrollment token |
| `POST` | `/api/agent/heartbeat` | Agent key |
| `GET` | `/api/agent/tasks` | Agent key |
| `POST` | `/api/agent/tasks/:id/result` | Agent key |
| `GET` | `/api/agent/update` | Agent key |

> `POST /api/agent/tasks/:id/result` accepts an optional `bundle_results` field. When present, each control is indexed as an independent ES document for per-control analytics.

### Build & Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tests/builds/:uuid` | Trigger cross-compilation |
| `GET` | `/api/tests/builds/:uuid/download` | Download built binary |
| `GET` | `/api/tests/certificates` | List certificates |
| `POST` | `/api/tests/certificates/upload` | Upload PFX/P12 certificate |
| `POST` | `/api/tests/certificates/generate` | Generate self-signed certificate |

### Defender Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/analytics/defender/secure-score` | Current Secure Score with category breakdown |
| `GET` | `/api/analytics/defender/secure-score/trend` | Secure Score trend over time |
| `GET` | `/api/analytics/defender/alerts` | Defender alerts with filtering |
| `GET` | `/api/analytics/defender/controls` | Control profiles with compliance status |
| `GET` | `/api/analytics/defender/cross-correlation` | Defense Score vs Secure Score correlation |
| `GET` | `/api/integrations/defender/config` | Defender configuration status |
| `POST` | `/api/integrations/defender/config` | Save Defender credentials |
| `POST` | `/api/integrations/defender/sync` | Trigger manual data sync |

### Alerting

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/integrations/alerts/config` | Get alert threshold configuration |
| `POST` | `/api/integrations/alerts/config` | Save alert thresholds and notification channels |

## Documentation

### Getting Started
- [Quick Start Deployment](docs/deployment/QUICK_START_DEPLOYMENT.md) — 50-minute production deployment
- [Windows Docker Installation](docs/deployment/WINDOWS_DOCKER_INSTALL.md) — Complete guide for Windows with Docker Desktop
- [Docker Compose guide](docker-compose.yml) — Local deployment with optional Elasticsearch

### Deployment
- [Docker Compose guide](docker-compose.yml) — Local deployment with optional Elasticsearch
- [Quick Start Deployment](docs/deployment/QUICK_START_DEPLOYMENT.md) — 50-minute production deployment
- [Railway Deployment](docs/deployment/RAILWAY.md) — Railway with private networking
- [Render Deployment](docs/deployment/RENDER.md) — Render with persistent disk and Blueprint
- [Fly.io Deployment](docs/deployment/FLY.md) — Fly.io with custom domains and volumes
- [Vercel Deployment](docs/deployment/VERCEL.md) — Serverless with Turso and Vercel Blob
- [Windows Docker Installation](docs/deployment/WINDOWS_DOCKER_INSTALL.md) — Complete guide for Windows with Docker Desktop
- [Production Deployment Guide](docs/deployment/PRODUCTION_DEPLOYMENT.md) — Comprehensive Railway deployment
- [Deployment Checklist](docs/deployment/DEPLOYMENT_CHECKLIST.md) — Interactive pre-flight checklist

### Development
- [CLAUDE.md](CLAUDE.md) — AI-assisted development guidance
- [Contributing Guide](CONTRIBUTING.md) — Contribution guidelines and code standards
- [Changelog](CHANGELOG.md) — Version history

### Security & Community
- [Security Policy](SECURITY.md) — Vulnerability reporting and security model
- [Agent Security Findings](docs/agent-security-findings.md) — Internal audit: 9 findings, 8 fixed
- [Code of Conduct](CODE_OF_CONDUCT.md) — Community guidelines
- [Roadmap](docs/ROADMAP.md) — Planned features and direction

## Contributing

We welcome contributions across all modules — frontend, backend, agent (Go), and documentation. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on setup, coding standards, and the PR process.

## Security

For security vulnerabilities, please report via [GitHub Security Advisories](https://github.com/projectachilles/ProjectAchilles/security/advisories) or review our [Security Policy](SECURITY.md).

## License

This project is licensed under the Apache License 2.0 — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built for purple teams**

</div>
