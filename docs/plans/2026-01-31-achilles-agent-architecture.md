# Achilles Agent — Architecture Document

**Date:** 2026-01-31
**Status:** Draft — Pending Review
**Scope:** Replace LimaCharlie agents with a custom lightweight agent for security test execution

---

## 1. Executive Summary

Achilles Agent is a lightweight, cross-platform agent written in Go that replaces LimaCharlie as the execution framework for ProjectAchilles security tests. It runs as a system service on Windows and Linux endpoints, polls the ProjectAchilles backend for tasks, downloads and executes test binaries, and reports results back through the backend to Elasticsearch.

**Key design principles:**
- **Minimal footprint:** Single static binary, <15MB, low CPU/RAM usage
- **Backend-mediated:** Agent only communicates with the ProjectAchilles backend (never directly to Elasticsearch or external services)
- **Firewall-friendly:** Outbound HTTPS polling only — no inbound ports required
- **Sequential execution:** One test at a time for predictable behavior and clean result attribution
- **Self-updating:** Backend-pushed updates with signature verification

---

## 2. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    ProjectAchilles Backend                       │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │  Agent API    │  │  Enrollment  │  │  Result Ingestion  │    │
│  │  (new module) │  │  Service     │  │  Service           │    │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────┘    │
│         │                  │                    │                │
│         │                  │                    ▼                │
│         │                  │           ┌───────────────┐        │
│         │                  │           │ Elasticsearch  │        │
│         │                  │           │ (f0rtika-*)    │        │
│         │                  │           └───────────────┘        │
│  ┌──────┴──────────────────┴────────────────────┐               │
│  │         Agent Management Service              │               │
│  │  (enrollment, tasks, updates, heartbeats)     │               │
│  └──────────────────┬───────────────────────────┘               │
│                     │                                            │
│  ┌──────────────────┴───────────────────────────┐               │
│  │         Agent Data Store (SQLite/JSON)         │               │
│  │  (agent registry, task queue, enrollment keys) │               │
│  └───────────────────────────────────────────────┘               │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ HTTPS (outbound from agent)
                    ┌─────────────┼─────────────┐
                    │             │             │
              ┌─────▼─────┐ ┌────▼──────┐ ┌───▼───────┐
              │  Agent 1   │ │  Agent 2   │ │  Agent N   │
              │  (Win)     │ │  (Linux)   │ │  (Win)     │
              │  Service   │ │  systemd   │ │  Service   │
              └───────────┘ └───────────┘ └───────────┘
```

---

## 3. Agent Binary Architecture

### 3.1 Component Layout

```
achilles-agent (single Go binary)
├── main.go                    # Entry point, CLI flags, service wrapper
├── config/
│   └── config.go              # Configuration loading (file + flags + env)
├── enrollment/
│   └── enrollment.go          # One-time enrollment handshake
├── poller/
│   └── poller.go              # Main polling loop (heartbeat + task fetch)
├── executor/
│   └── executor.go            # Test binary download, execution, result capture
├── reporter/
│   └── reporter.go            # Result packaging and upload to backend
├── updater/
│   └── updater.go             # Self-update with signature verification
├── service/
│   ├── windows.go             # Windows Service integration (golang.org/x/sys/windows/svc)
│   └── linux.go               # Systemd notify integration
└── store/
    └── store.go               # Local state persistence (agent ID, queue, results)
```

### 3.2 Agent Lifecycle

```
           ┌──────────┐
           │  Install  │  (run with --install flag)
           └────┬─────┘
                │
                ▼
           ┌──────────┐
           │  Enroll   │  (one-time, using enrollment token)
           └────┬─────┘
                │
                ▼
     ┌──────────────────────┐
     │    Main Poll Loop     │◄──────────────────┐
     │  (every 30s default)  │                    │
     └────┬────────────┬─────┘                    │
          │            │                          │
          ▼            ▼                          │
   ┌──────────┐  ┌───────────┐                   │
   │ Heartbeat│  │ Fetch Task│                   │
   │ (POST)   │  │ (GET)     │                   │
   └──────────┘  └─────┬─────┘                   │
                        │ task found?             │
                        ▼                         │
                  ┌───────────┐                   │
                  │ Download  │                   │
                  │ Binary    │                   │
                  └─────┬─────┘                   │
                        ▼                         │
                  ┌───────────┐                   │
                  │ Execute   │                   │
                  │ Test      │                   │
                  └─────┬─────┘                   │
                        ▼                         │
                  ┌───────────┐                   │
                  │ Report    │                   │
                  │ Result    │───────────────────┘
                  └───────────┘
```

### 3.3 Configuration

Agent configuration lives in a YAML file alongside the binary:

**Windows:** `C:\F0\achilles-agent.yaml`
**Linux:** `/opt/f0/achilles-agent.yaml`

```yaml
# Server connection
server_url: "https://projectachilles.example.com"
poll_interval: 30s          # How often to check for tasks
heartbeat_interval: 60s     # How often to send heartbeat

# Agent identity (populated after enrollment)
agent_id: ""                # UUID assigned by backend
agent_key: ""               # Pre-shared key (encrypted at rest)

# Local paths
work_dir: "C:\\F0\\tasks"   # Test binary download/execution directory
log_file: "C:\\F0\\achilles-agent.log"

# Resource limits
max_execution_time: 300s    # Per-test timeout (5 minutes default)
max_binary_size: 100MB      # Reject binaries larger than this

# TLS
ca_cert: ""                 # Optional custom CA certificate path
skip_tls_verify: false      # Never true in production
```

---

## 4. Enrollment Flow

```
Admin (UI)                    Backend                         Agent
   │                            │                               │
   │  Generate enrollment token │                               │
   │  (scoped to org, TTL)      │                               │
   │ ──────────────────────────►│                               │
   │                            │  Store token (hashed)         │
   │◄─────────────────────────  │                               │
   │  Token: "acht_xxxxxx"     │                               │
   │                            │                               │
   │  (admin runs agent with    │                               │
   │   --enroll acht_xxxxxx)    │                               │
   │                            │                               │
   │                            │◄──────────────────────────────│
   │                            │  POST /api/agent/enroll       │
   │                            │  {                            │
   │                            │    token: "acht_xxxxxx",      │
   │                            │    hostname: "WORKSTATION-1", │
   │                            │    os: "windows",             │
   │                            │    arch: "amd64",             │
   │                            │    agent_version: "1.0.0"     │
   │                            │  }                            │
   │                            │                               │
   │                            │  Validate token               │
   │                            │  Create agent record          │
   │                            │  Generate agent_id + api_key  │
   │                            │  Invalidate token (one-time)  │
   │                            │                               │
   │                            │──────────────────────────────►│
   │                            │  {                            │
   │                            │    agent_id: "uuid",          │
   │                            │    agent_key: "ak_xxxxxxx",   │
   │                            │    org_id: "uuid",            │
   │                            │    server_url: "https://...", │
   │                            │    poll_interval: 30           │
   │                            │  }                            │
   │                            │                               │
   │                            │  Agent saves config, starts   │
   │                            │  polling loop                 │
```

**Enrollment token format:** `acht_<32-char-random>` (prefix for easy identification)
**Agent key format:** `ak_<64-char-random>` (long-lived, revocable)

**Token properties:**
- One-time use (consumed on successful enrollment)
- Time-limited (configurable TTL, default 24 hours)
- Scoped to an organization
- Optional: max-use count (for batch enrollment)

---

## 5. Communication Protocol

### 5.1 Agent → Backend API

All requests include:
```
Authorization: Bearer ak_<agent_key>
X-Agent-ID: <agent_uuid>
X-Agent-Version: <semver>
Content-Type: application/json
```

| Endpoint | Method | Purpose | Frequency |
|----------|--------|---------|-----------|
| `/api/agent/heartbeat` | POST | Report alive status + system info | Every 60s |
| `/api/agent/tasks` | GET | Fetch next pending task | Every 30s |
| `/api/agent/tasks/:id/status` | PATCH | Update task status (running/completed/failed) | Per task |
| `/api/agent/tasks/:id/result` | POST | Upload test result data | Per task |
| `/api/agent/binary/:name` | GET | Download test binary | Per task |
| `/api/agent/version` | GET | Check for agent updates | Every heartbeat |
| `/api/agent/update` | GET | Download new agent binary | On update |

### 5.2 Heartbeat Payload

```json
{
  "timestamp": "2026-01-31T10:30:00Z",
  "status": "idle",              // idle | executing | updating | error
  "current_task": null,          // task UUID if executing
  "system": {
    "hostname": "WORKSTATION-1",
    "os": "windows",
    "arch": "amd64",
    "uptime_seconds": 86400,
    "cpu_percent": 5.2,
    "memory_mb": 45,
    "disk_free_mb": 50000
  },
  "agent_version": "1.0.0",
  "last_task_completed": "2026-01-31T10:25:00Z"
}
```

### 5.3 Task Object

```json
{
  "task_id": "uuid",
  "type": "execute_test",        // execute_test | update_agent | uninstall
  "priority": 1,                 // 1 (normal), 2 (high), 3 (critical)
  "payload": {
    "test_uuid": "test-uuid",
    "test_name": "Test Name",
    "binary_name": "test-uuid.exe",
    "binary_sha256": "abc123...",
    "binary_size": 2048576,
    "execution_timeout": 300,
    "arguments": [],             // CLI args for the test binary
    "metadata": {
      "category": "cyber-hygiene",
      "severity": "high",
      "techniques": ["T1234"],
      "tactics": ["execution"],
      "threat_actor": "APT28",
      "target": "windows-endpoint",
      "complexity": "medium",
      "tags": ["tag1"]
    }
  },
  "created_at": "2026-01-31T10:00:00Z",
  "ttl": 604800                  // 7 days
}
```

### 5.4 Result Payload

```json
{
  "task_id": "uuid",
  "test_uuid": "test-uuid",
  "exit_code": 126,
  "stdout": "",
  "stderr": "",
  "started_at": "2026-01-31T10:30:05Z",
  "completed_at": "2026-01-31T10:30:08Z",
  "execution_duration_ms": 3000,
  "binary_sha256": "abc123...",
  "hostname": "WORKSTATION-1",
  "os": "windows",
  "arch": "amd64"
}
```

The backend transforms this into the Elasticsearch document format (`f0rtika-results-*`), mapping exit codes to the existing canonical error code system (101=Unprotected, 126=ExecutionPrevented, etc.).

---

## 6. Test Execution Flow

```
Agent                              Backend                    Elasticsearch
  │                                  │                            │
  │  GET /api/agent/tasks            │                            │
  │ ────────────────────────────────►│                            │
  │                                  │  Find pending task for     │
  │◄────────────────────────────────│  this agent                │
  │  Task: execute_test              │                            │
  │                                  │                            │
  │  PATCH /tasks/:id/status         │                            │
  │  { status: "downloading" }       │                            │
  │ ────────────────────────────────►│                            │
  │                                  │                            │
  │  GET /api/agent/binary/:name     │                            │
  │ ────────────────────────────────►│                            │
  │◄────────────────────────────────│  Stream binary              │
  │  (verify SHA256)                 │                            │
  │                                  │                            │
  │  PATCH /tasks/:id/status         │                            │
  │  { status: "executing" }         │                            │
  │ ────────────────────────────────►│                            │
  │                                  │                            │
  │  Execute binary locally          │                            │
  │  (capture exit code, stdout,     │                            │
  │   stderr, timing)                │                            │
  │                                  │                            │
  │  POST /tasks/:id/result          │                            │
  │  { exit_code: 126, ... }         │                            │
  │ ────────────────────────────────►│                            │
  │                                  │  Map exit code to result   │
  │                                  │  Build ES document         │
  │                                  │ ──────────────────────────►│
  │                                  │  Index to f0rtika-results  │
  │                                  │                            │
  │  PATCH /tasks/:id/status         │                            │
  │  { status: "completed" }         │                            │
  │ ────────────────────────────────►│                            │
```

### 6.1 Binary Verification

Before executing any downloaded binary, the agent:
1. Verifies SHA256 hash matches the task's `binary_sha256` field
2. Verifies file size matches `binary_size`
3. (Future) Verifies code signature if signing cert thumbprint is configured

### 6.2 Execution Sandbox

The agent executes test binaries with:
- **Timeout enforcement:** Kill process after `execution_timeout` seconds (exit code 259 = StillActive)
- **Working directory:** Isolated temp dir under `work_dir`, cleaned after execution
- **No shell:** Direct process execution (no `cmd.exe` or `/bin/sh` wrapper) to prevent injection
- **Stdout/stderr capture:** Buffered, with size limits (1MB each)

### 6.3 Cleanup

After each test execution:
1. Kill any orphaned child processes
2. Delete the downloaded binary
3. Remove the temporary working directory
4. Report result to backend

---

## 7. Self-Update Mechanism

```
Agent                              Backend
  │                                  │
  │  (during heartbeat)              │
  │  GET /api/agent/version          │
  │ ────────────────────────────────►│
  │◄────────────────────────────────│
  │  { version: "1.1.0",            │
  │    sha256: "def456...",          │
  │    mandatory: true }             │
  │                                  │
  │  (current is 1.0.0, update!)     │
  │                                  │
  │  PATCH heartbeat                 │
  │  { status: "updating" }          │
  │ ────────────────────────────────►│
  │                                  │
  │  GET /api/agent/update?os=win&arch=amd64
  │ ────────────────────────────────►│
  │◄────────────────────────────────│  Stream new binary
  │                                  │
  │  Verify SHA256                   │
  │  Write to temp location          │
  │  Replace current binary          │
  │  Restart service                 │
```

**Platform-specific restart:**
- **Windows:** The service controller restarts the process after it exits
- **Linux:** `systemd` restarts the process (configured with `Restart=always`)

The agent writes the new binary to a temp path, then:
- **Windows:** Renames current → `.old`, new → current, exits (service restarts)
- **Linux:** Replaces binary in-place (possible because Linux doesn't lock running binaries), then `syscall.Exec` to re-exec

---

## 8. Backend Changes (New Endpoints Module)

### 8.1 New Backend Services

```
backend/src/
├── services/
│   └── agent/                         # NEW
│       ├── agentRegistry.service.ts   # Agent CRUD, enrollment tokens
│       ├── agentTasks.service.ts      # Task queue management
│       ├── agentHeartbeat.service.ts  # Heartbeat processing, online status
│       ├── agentBinary.service.ts     # Binary serving for download
│       ├── agentUpdate.service.ts     # Agent version management
│       └── agentResults.service.ts    # Result ingestion → Elasticsearch
├── api/
│   └── agent/                         # NEW
│       ├── enrollment.routes.ts       # Token generation, agent enrollment
│       ├── heartbeat.routes.ts        # Heartbeat endpoint
│       ├── tasks.routes.ts            # Task fetch, status updates, results
│       ├── binary.routes.ts           # Binary download
│       └── update.routes.ts           # Version check, update download
├── middleware/
│   └── agentAuth.middleware.ts        # NEW: Agent API key validation
└── types/
    └── agent.ts                       # NEW: Agent types
```

### 8.2 Data Store

For the initial version, the backend uses a **SQLite database** (via `better-sqlite3`) for agent data. This avoids introducing a new infrastructure dependency while supporting the query patterns needed.

**Tables:**

```sql
-- Agent registry
CREATE TABLE agents (
  id TEXT PRIMARY KEY,              -- UUID
  org_id TEXT NOT NULL,             -- Organization (maps to Clerk org)
  hostname TEXT NOT NULL,
  os TEXT NOT NULL,                 -- windows | linux
  arch TEXT NOT NULL,               -- amd64 | arm64
  agent_version TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,       -- bcrypt hash of agent key
  status TEXT DEFAULT 'active',     -- active | disabled | decommissioned
  last_heartbeat TEXT,
  last_heartbeat_data JSON,
  enrolled_at TEXT NOT NULL,
  enrolled_by TEXT,                 -- Clerk user ID who generated token
  tags JSON DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Enrollment tokens
CREATE TABLE enrollment_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,         -- bcrypt hash
  org_id TEXT NOT NULL,
  created_by TEXT NOT NULL,         -- Clerk user ID
  expires_at TEXT NOT NULL,
  max_uses INTEGER DEFAULT 1,
  use_count INTEGER DEFAULT 0,
  metadata JSON DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Task queue
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,              -- UUID
  agent_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  type TEXT NOT NULL,               -- execute_test | update_agent | uninstall
  priority INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',    -- pending | assigned | downloading | executing | completed | failed | expired
  payload JSON NOT NULL,
  result JSON,
  created_at TEXT DEFAULT (datetime('now')),
  assigned_at TEXT,
  completed_at TEXT,
  ttl INTEGER DEFAULT 604800,
  created_by TEXT,                  -- Clerk user ID
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Agent update binaries
CREATE TABLE agent_versions (
  version TEXT PRIMARY KEY,         -- semver
  os TEXT NOT NULL,
  arch TEXT NOT NULL,
  binary_path TEXT NOT NULL,
  binary_sha256 TEXT NOT NULL,
  binary_size INTEGER NOT NULL,
  release_notes TEXT,
  mandatory BOOLEAN DEFAULT false,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(version, os, arch)
);
```

### 8.3 Agent Authentication Middleware

The agent API uses a separate auth middleware (not Clerk):

```typescript
// agentAuth.middleware.ts
// Validates: Authorization: Bearer ak_<key>
// Extracts: agent_id from X-Agent-ID header
// Verifies: API key hash matches agent record
// Attaches: agent object to req.agent
```

### 8.4 Frontend Changes (New Endpoints Module)

The existing Endpoints module pages are replaced:

| Current (LimaCharlie) | New (Achilles Agent) |
|------------------------|----------------------|
| LimaCharlie login | Removed (agents auth with API keys, not user credentials) |
| SensorsPage | **AgentsPage** (list enrolled agents, status, tags) |
| PayloadsPage | **TasksPage** (create tasks, deploy tests to agents) |
| EventsPage | **ResultsPage** (view task results, execution logs) |
| EndpointDashboardPage | **AgentDashboardPage** (agent metrics, online status) |

**New UI components:**
- **EnrollmentTokenGenerator** — Generate tokens with TTL and org scope
- **AgentList** — Table with hostname, OS, status, last seen, version, tags
- **TaskCreator** — Select tests + target agents → create tasks
- **TaskQueue** — View pending/running/completed tasks per agent
- **AgentDetail** — Single agent view with history, config, actions
- **BulkActions** — Tag, deploy tests, update agents in bulk

---

## 9. Security Model

### 9.1 Authentication Layers

| Actor | Authenticates With | Scope |
|-------|-------------------|-------|
| Admin (UI) | Clerk JWT | Full CRUD on agents, tasks, tokens |
| Agent binary | Pre-shared API key (`ak_*`) | Own heartbeat, tasks, results only |
| Enrollment | One-time token (`acht_*`) | Enroll one agent |

### 9.2 Agent API Key Security

- Keys generated server-side using cryptographically secure random bytes (64 chars)
- Only the bcrypt hash stored in the database
- Key shown to admin once at enrollment time (in agent config output)
- Stored on the endpoint encrypted at rest (OS-native: DPAPI on Windows, file permissions on Linux)
- Revocable per-agent (set status to `disabled`)

### 9.3 Binary Integrity

- Test binaries verified by SHA256 before execution
- Agent update binaries verified by SHA256
- Code signing with existing ProjectAchilles certificate infrastructure
- Agent rejects binaries that fail hash verification

### 9.4 Transport Security

- All agent ↔ backend communication over TLS (HTTPS)
- Optional custom CA certificate for enterprise environments
- No inbound ports on the endpoint required

### 9.5 Execution Safety

- Direct process execution (no shell) prevents command injection
- Per-test timeout prevents hung processes
- Working directory isolated and cleaned after each test
- stdout/stderr size-limited to prevent memory exhaustion

---

## 10. Scalability Considerations

### 10.1 Polling Load

With 30-second poll interval:
- 100 agents = ~3.3 requests/second (trivial)
- 1,000 agents = ~33 requests/second (easily handled by Express)
- 10,000 agents = ~333 requests/second (may need load balancing)

Heartbeats at 60-second interval are half the above.

### 10.2 Mitigation Strategies

- **Jitter:** Agents add random ±5s jitter to poll interval to avoid thundering herd
- **Conditional responses:** If no task available, backend returns `204 No Content` (minimal payload)
- **Backoff:** If backend returns 429 or 5xx, agent backs off exponentially
- **Batched heartbeats:** Heartbeat and task-check are combined in a single request when possible

### 10.3 Database Scaling Path

SQLite works for up to ~1,000 agents. Beyond that:
- Migrate to PostgreSQL (schema is already compatible)
- Add connection pooling
- Task queue could move to Redis for higher throughput

---

## 11. Agent Binary Size & Resource Budget

| Metric | Target | Notes |
|--------|--------|-------|
| Binary size | <15 MB | Go static binary, stripped symbols |
| Idle RAM | <20 MB | Polling loop only |
| Active RAM | <50 MB | During test execution |
| Idle CPU | <1% | Sleep between polls |
| Disk usage | <50 MB | Binary + config + working dir |
| Network (idle) | <1 KB/min | Heartbeat + empty task check |

---

## 12. Installation & Management

### 12.1 Installation Commands

**Windows (PowerShell as Admin):**
```powershell
# Download agent
Invoke-WebRequest -Uri "https://server/api/agent/update?os=windows&arch=amd64" -OutFile "C:\F0\achilles-agent.exe"

# Enroll and install as service
C:\F0\achilles-agent.exe --enroll acht_xxxxx --server https://server --install
```

**Linux (root):**
```bash
# Download agent
curl -o /opt/f0/achilles-agent "https://server/api/agent/update?os=linux&arch=amd64"
chmod +x /opt/f0/achilles-agent

# Enroll and install as systemd service
/opt/f0/achilles-agent --enroll acht_xxxxx --server https://server --install
```

### 12.2 Agent CLI Flags

```
achilles-agent [flags]

Flags:
  --enroll <token>     Enroll with backend using enrollment token
  --server <url>       Backend URL (required for enrollment)
  --install            Install as system service after enrollment
  --uninstall          Remove system service and clean up
  --status             Show agent status and config
  --version            Show agent version
  --config <path>      Path to config file (default: auto-detect)
  --run                Run in foreground (for debugging)
```

### 12.3 Uninstallation

The agent supports clean uninstall:
1. Stop service
2. Deregister from backend (marks as decommissioned)
3. Remove service registration
4. Delete working directory
5. Optionally delete agent binary and config

---

## 13. Compatibility with Existing Analytics

The result ingestion service on the backend maps agent results to the existing Elasticsearch document schema:

```
Agent result                     →  Elasticsearch document
─────────────────────────────────────────────────────────
exit_code: 126                   →  event.ERROR: 126
hostname: "WS-1"                 →  f0rtika.hostname: "WS-1"
test_uuid                        →  f0rtika.test_uuid
task metadata (from task payload)→  f0rtika.test_name, test_category,
                                    test_severity, test_techniques, etc.
exit_code mapping                →  f0rtika.is_protected: true/false
                                    f0rtika.error_name: "ExecutionPrevented"
timestamp                        →  routing.event_time
org_id                           →  routing.oid
```

This means the Analytics module (defense score, coverage charts, host matrix, etc.) works without any changes. The data looks identical whether it came from LimaCharlie or the Achilles Agent.

---

## 14. Migration Strategy

### Phase 1: Build & Test
- Build the Achilles Agent Go binary
- Build the backend Agent Management module
- Build the new Endpoints UI
- Test with a few endpoints in a lab environment

### Phase 2: Parallel Operation
- Run Achilles Agent alongside LimaCharlie on test endpoints
- Verify results match between both systems
- Validate analytics compatibility

### Phase 3: Cutover
- Enroll production endpoints with Achilles Agent
- Remove LimaCharlie agent from endpoints
- Remove LimaCharlie backend code and dependencies
- Update documentation

---

## 15. Out of Scope (Initial Version)

- **macOS support** — Designed for but not implemented in v1
- **Network isolation** — Not needed per requirements
- **Interactive shell** — No remote shell capability (security decision)
- **File retrieval** — Agent doesn't upload arbitrary files from endpoint
- **Process monitoring** — Agent doesn't monitor endpoint processes
- **Multi-tenant agent** — One agent = one organization
- **Agent-to-agent communication** — No lateral communication

---

## 16. Technology Stack Summary

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Agent binary | Go 1.22+ | Cross-compile, static binary, low footprint |
| Agent service (Win) | `golang.org/x/sys/windows/svc` | Native Windows Service API |
| Agent service (Linux) | systemd unit + sd_notify | Standard Linux service management |
| Agent config | YAML | Human-readable, familiar |
| Agent local store | JSON file | Minimal dependency, simple state |
| Backend data store | SQLite (better-sqlite3) | Zero infrastructure, sufficient for 1K agents |
| Backend API | Express + TypeScript | Consistent with existing backend |
| Frontend | React + TypeScript | Consistent with existing frontend |
| Transport | HTTPS (TLS 1.2+) | Standard, firewall-friendly |
| Binary verification | SHA-256 | Fast, collision-resistant |
| Key storage (Win) | DPAPI | OS-native encryption |
| Key storage (Linux) | File permissions (0600) | Standard Unix security model |
| Code signing | osslsigncode + existing PFX | Reuse existing infrastructure |
