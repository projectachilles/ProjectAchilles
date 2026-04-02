---
sidebar_position: 3
title: Architecture
description: System architecture, tech stack, data flow diagrams, and project structure of ProjectAchilles.
---

# Architecture

ProjectAchilles follows a three-tier architecture: a React SPA frontend, an Express API backend, and Go agents deployed to target endpoints. Elasticsearch stores test results for analytics, while SQLite manages agent state.

## System Overview

```mermaid
graph TB
    subgraph Clients
        FE["Frontend<br/>React 19 · Vite · Tailwind CSS<br/><i>Browser · Analytics · Agents · Settings</i>"]
        CLI["CLI<br/>Bun · Ink · AI SDK v6<br/><i>Commands · AI Chat Agent</i>"]
    end

    FE -->|Clerk JWT| BE
    CLI -->|Clerk JWT| BE

    subgraph BE ["Backend — Express + TypeScript"]
        BRS[Browser Service]
        ANS[Analytics Service]
        AGS[Agent Service]
        BDS[Build Service]
        DFS[Defender Service]
        ALS[Alerting Service]
    end

    BRS --> GIT[(Git Repo)]
    ANS --> ES[(Elasticsearch)]
    AGS --> DB[(SQLite)]
    BDS --> GO[Go Toolchain + Code Signing]
    DFS --> GRAPH[Microsoft Graph API]
    ALS --> NOTIFY[Slack · Email]

    AGS <-->|Agent API Key| AGENT

    subgraph EP ["Endpoints — Windows · Linux · macOS"]
        AGENT["Achilles Agent — Go<br/>Heartbeat · Executor · Updater"]
    end
```

## Data Flow

### Test Execution Flow

```mermaid
sequenceDiagram
    participant Admin as Admin UI
    participant Backend as Backend API
    participant DB as SQLite
    participant Agent as Go Agent
    participant ES as Elasticsearch

    Admin->>Backend: Create task (test UUID, agent IDs)
    Backend->>DB: Store task (status: pending)
    Agent->>Backend: Poll for tasks (heartbeat)
    Backend->>Agent: Return pending task
    Agent->>Backend: Download test binary
    Agent->>Agent: Verify SHA256 + Ed25519 signature
    Agent->>Agent: Execute test binary
    Agent->>Backend: Report result (exit code, stdout, stderr)
    Backend->>DB: Update task (status: completed)
    Backend->>ES: Ingest result document
    Backend->>Backend: Check alert thresholds
```

### Agent Enrollment Flow

```mermaid
sequenceDiagram
    participant Admin as Admin UI
    participant Backend as Backend API
    participant DB as SQLite
    participant Agent as Go Agent

    Admin->>Backend: Create enrollment token
    Backend->>DB: Store token (TTL, max uses)
    Agent->>Backend: POST /api/agent/enroll (token + system info)
    Backend->>DB: Validate token, create agent record
    Backend->>Agent: Return API key + server public key
    Agent->>Agent: Encrypt API key with machine-bound key
    Agent->>Backend: Start heartbeat polling
```

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| **Frontend** | React | 19.2 | UI framework |
| | Vite | 7.2 | Build tool and dev server |
| | Tailwind CSS | 4.1 | Utility-first styling |
| | Redux Toolkit | 2.10 | State management |
| | React Router | 7.13 | Client-side routing |
| | Clerk | 5.x | Authentication |
| **Backend** | Express | 4.18 | HTTP framework |
| | TypeScript | 5.9 | Type-safe development |
| | better-sqlite3 | — | Agent database |
| | @elastic/elasticsearch | 8.x | Analytics queries |
| **Agent** | Go | 1.24 | Cross-platform binary |
| **Analytics** | Elasticsearch | 8.17 | Result storage and aggregation |
| **Signing** | osslsigncode | — | Windows Authenticode |
| | rcodesign | — | macOS ad-hoc signing |
| **CI** | GitHub Actions | — | Test + security review |

## Project Structure

```
ProjectAchilles/
├── frontend/                  # React 19 + TypeScript + Vite
│   └── src/
│       ├── components/        # Shared UI primitives (Button, Card, etc.)
│       ├── pages/             # Module pages (browser, analytics, agents, settings)
│       ├── services/api/      # API client modules
│       ├── hooks/             # Custom hooks (useAuthenticatedApi, etc.)
│       └── store/             # Redux slices
├── backend/                   # Express + TypeScript (ES modules)
│   └── src/
│       ├── api/               # Route handlers (*.routes.ts)
│       ├── services/          # Business logic by module
│       │   ├── agent/         # Enrollment, heartbeat, tasks, schedules
│       │   ├── analytics/     # Elasticsearch queries, client factory
│       │   ├── browser/       # Git sync, test indexing
│       │   ├── tests/         # Go cross-compilation, cert management
│       │   ├── defender/      # Microsoft Graph API client
│       │   └── alerting/      # Slack + email dispatch
│       ├── middleware/        # Auth, error handling, rate limiting
│       └── types/             # TypeScript definitions
├── backend-serverless/        # Vercel serverless fork (Turso + Blob)
├── agent/                     # Go agent source
│   ├── main.go                # CLI entry point (--enroll, --run, --install)
│   └── internal/              # Agent modules
│       ├── config/            # Configuration management
│       ├── enrollment/        # Token-based registration
│       ├── executor/          # Test binary execution
│       ├── httpclient/        # HTTP client with auth
│       ├── poller/            # Task polling loop
│       ├── reporter/          # Result reporting
│       ├── service/           # OS service management
│       ├── store/             # Encrypted credential storage
│       ├── sysinfo/           # Platform-specific system info
│       └── updater/           # Self-update mechanism
├── scripts/                   # Shell scripts and PowerShell bootstrap
├── docs/                      # Documentation source files
├── wiki/                      # This documentation site (Docusaurus)
└── docker-compose.yml         # Multi-service deployment
```

## Deployment Architecture

ProjectAchilles supports five deployment targets, each with different trade-offs:

| Target | Backend | Database | File Storage | Agent Builds | Cost |
|--------|---------|----------|-------------|-------------|------|
| **Docker Compose** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | Free |
| **Railway** | `backend/` | SQLite (volume) | Filesystem (volume) | Partial | ~$10-13/mo |
| **Render** | `backend/` | SQLite (persistent disk) | Filesystem (disk) | Partial | ~$14/mo |
| **Fly.io** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | ~$8/mo |
| **Vercel** | `backend-serverless/` | Turso (libSQL) | Vercel Blob | No | ~$20/mo |

The Vercel target uses a purpose-built serverless fork (`backend-serverless/`) that replaces SQLite with Turso, filesystem with Vercel Blob, and process-based scheduling with Vercel Cron jobs. See [Deployment Overview](../deployment/overview) for detailed comparisons.

## End-to-End Data Flow

The following diagram shows the complete journey of data through the platform — from test discovery to defense metrics:

```mermaid
graph LR
    subgraph "1. Test Discovery"
        GIT[(Git Repo<br/>f0_library)] -->|Sync| BROWSER[Browser Service]
        BROWSER -->|Index| CATALOG[Test Catalog]
    end

    subgraph "2. Build & Sign"
        CATALOG -->|Select test| BUILD[Build Service]
        BUILD -->|Go compile| BIN[Signed Binary]
        CERT[(Certificate Store)] -->|Active cert| BUILD
    end

    subgraph "3. Task Distribution"
        BIN -->|Create task| TASKS[(SQLite<br/>tasks table)]
        TASKS -->|Agent polls| AGENT[Go Agent]
    end

    subgraph "4. Execution"
        AGENT -->|Download binary| BIN
        AGENT -->|Verify signature| AGENT
        AGENT -->|Execute| RESULT[Exit Code + Output]
    end

    subgraph "5. Ingestion"
        RESULT -->|POST /result| INGEST[Result Service]
        INGEST -->|Index document| ES[(Elasticsearch)]
        INGEST -->|Check thresholds| ALERT[Alerting Service]
    end

    subgraph "6. Analytics"
        ES -->|Aggregate| DEFENSE[Defense Score]
        ES -->|Aggregate| HEATMAP[MITRE Heatmap]
        ES -->|Aggregate| TRENDS[Trend Charts]
        ES -->|Correlate| DEFENDER[Defender Cross-Correlation]
    end
```

### Detailed Execution Sequence

```mermaid
sequenceDiagram
    participant User as Admin UI
    participant API as Backend API
    participant DB as SQLite
    participant Agent as Go Agent
    participant ES as Elasticsearch
    participant Alert as Alerting Service
    participant Slack as Slack/Email

    User->>API: Create task (test UUID, target agents)
    API->>DB: INSERT task (status: pending)

    loop Heartbeat polling (default: 30s)
        Agent->>API: POST /heartbeat (system info)
        API->>DB: Update agent last_seen
        API-->>Agent: Pending task list
    end

    Agent->>API: GET /download?task_id=...
    API-->>Agent: Signed binary (SHA256 + Ed25519)
    Agent->>Agent: Verify SHA256 hash
    Agent->>Agent: Verify Ed25519 signature
    Agent->>Agent: Execute binary (30s timeout)
    Agent->>API: POST /result (exit_code, stdout, stderr, bundle_results)

    API->>DB: UPDATE task status → completed
    API->>ES: Index result document(s)

    Note over API,ES: Bundle tests fan out to multiple ES documents

    API->>Alert: evaluateAndNotify(testName, agentId)
    Alert->>ES: Query current Defense Score
    alt Threshold breached
        Alert->>Slack: Dispatch notification
    end

    User->>API: GET /api/analytics/defense-score
    API->>ES: Aggregate results
    API-->>User: Defense Score + breakdown
```

### Integration Data Flows

Beyond the core test execution pipeline, several integration-specific flows run in parallel:

**Microsoft Defender Sync** (background, every 5 min / 6 hours):
```
Microsoft Graph API → Graph Client → Sync Service → achilles-defender index
```

**Alert Evaluation** (triggered per result ingestion):
```
Result Ingestion → Defense Score Query → Threshold Check → Slack/Email Dispatch
```

**Risk Acceptance** (user-initiated):
```
Accept Risk → achilles-risk-acceptances index → Exclusion Filter Cache → Defense Score recalculation
```
