# Achilles Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace LimaCharlie with a custom Go agent and new backend/frontend Endpoints module.

**Architecture:** Three parallel workstreams — (1) Go agent binary, (2) Express backend agent module with SQLite, (3) React frontend agent management UI. The agent communicates with the backend via HTTPS polling; the backend writes results to Elasticsearch using the existing schema.

**Tech Stack:** Go 1.22+, Express/TypeScript, React 19/TypeScript, SQLite (better-sqlite3), Tailwind CSS v4, Redux Toolkit

---

## Dependency Graph and Parallel Execution Map

```
PHASE 1 — Foundation (all parallel)
├── Task 1:  [BACKEND]  Agent types                    ──┐
├── Task 2:  [BACKEND]  SQLite database layer          ──┤
├── Task 3:  [AGENT]    Go project scaffold + config   ──┤
├── Task 4:  [FRONTEND] Agent types + API client       ──┘
│
PHASE 2 — Core Services (all parallel, depends on Phase 1)
├── Task 5:  [BACKEND]  Agent auth middleware           ─── depends on: 1, 2
├── Task 6:  [BACKEND]  Enrollment service + routes     ─── depends on: 1, 2
├── Task 7:  [BACKEND]  Heartbeat service + routes      ─── depends on: 1, 2
├── Task 8:  [BACKEND]  Task queue service + routes     ─── depends on: 1, 2
├── Task 9:  [BACKEND]  Binary serving service + routes ─── depends on: 1, 2
├── Task 10: [BACKEND]  Result ingestion service        ─── depends on: 1, 2
├── Task 11: [AGENT]    Enrollment module               ─── depends on: 3
├── Task 12: [AGENT]    Poller + heartbeat module       ─── depends on: 3
├── Task 13: [AGENT]    Executor module                 ─── depends on: 3
├── Task 14: [AGENT]    Reporter module                 ─── depends on: 3
│
PHASE 3 — Integration (parallel within groups, depends on Phase 2)
├── Task 15: [BACKEND]  Mount agent routes in server.ts ─── depends on: 5-10
├── Task 16: [AGENT]    Service wrappers (Win + Linux)  ─── depends on: 11-14
├── Task 17: [AGENT]    Self-update module              ─── depends on: 12
├── Task 18: [BACKEND]  Agent update service + routes   ─── depends on: 1, 2
│
PHASE 4 — Frontend (all parallel, depends on Task 4)
├── Task 19: [FRONTEND] Redux agent slice               ─── depends on: 4
├── Task 20: [FRONTEND] AgentDashboardPage              ─── depends on: 4, 19
├── Task 21: [FRONTEND] AgentsPage (list + manage)      ─── depends on: 4, 19
├── Task 22: [FRONTEND] TasksPage (create + monitor)    ─── depends on: 4, 19
├── Task 23: [FRONTEND] EnrollmentTokenGenerator        ─── depends on: 4, 19
├── Task 24: [FRONTEND] Replace routes + cleanup        ─── depends on: 19-23
│
PHASE 5 — Build and Ship
├── Task 25: [AGENT]    Cross-compile + sign pipeline   ─── depends on: 16, 17
├── Task 26: [ALL]      Integration testing             ─── depends on: 15, 24, 25
```

**Maximum parallelism per phase:**
- Phase 1: **4 agents** simultaneously
- Phase 2: **10 agents** simultaneously
- Phase 3: **4 agents** simultaneously
- Phase 4: **6 agents** simultaneously
- Phase 5: **2 agents** simultaneously

---

## Codebase Conventions Reference

Before implementing ANY task, follow these rules:

**Backend (Express + TypeScript):**
- ES modules with `.js` extensions in all imports: `import { foo } from './bar.js';`
- Wrap async route handlers: `router.get('/path', asyncHandler(async (req, res) => { ... }));`
- Throw `AppError` for HTTP errors: `throw new AppError('Not found', 404);`
- Response format: `res.json({ success: true, data: { ... } });`
- Import error utilities: `import { asyncHandler, AppError } from '../middleware/error.middleware.js';`
- Strict mode, no `any`, use `import type` for type-only imports

**Frontend (React + TypeScript):**
- Use `@/` alias for all imports from `src/`
- API clients as plain objects: `export const agentApi = { async listAgents() { ... } };`
- Use `apiClient` from `@/hooks/useAuthenticatedApi` (auto-injects Clerk JWT)
- Redux slices with `createAsyncThunk` for async operations
- Tailwind CSS v4 for styling (no CSS modules)

**Go Agent:**
- Go modules, standard project layout
- `gopkg.in/yaml.v3` for config parsing
- `crypto/sha256` for binary verification
- `golang.org/x/sys/windows/svc` for Windows service (build-tagged)

---

## PHASE 1 — Foundation

---

### Task 1: Backend Agent Types

**Files:**
- Create: `backend/src/types/agent.ts`

**Context:** This file defines ALL shared types for the agent management system. Every backend service and route in the agent module imports from here. Must be completed before any Phase 2 backend task can start.

**Step 1: Create the types file**

```typescript
// backend/src/types/agent.ts

// --- Agent Entity ---

export type AgentStatus = 'active' | 'disabled' | 'decommissioned';
export type AgentOS = 'windows' | 'linux';
export type AgentArch = 'amd64' | 'arm64';
export type AgentRuntimeStatus = 'idle' | 'executing' | 'updating' | 'error' | 'offline';

export interface Agent {
  id: string;
  org_id: string;
  hostname: string;
  os: AgentOS;
  arch: AgentArch;
  agent_version: string;
  status: AgentStatus;
  last_heartbeat: string | null;
  last_heartbeat_data: HeartbeatPayload | null;
  enrolled_at: string;
  enrolled_by: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface AgentSummary {
  id: string;
  hostname: string;
  os: AgentOS;
  arch: AgentArch;
  agent_version: string;
  status: AgentStatus;
  runtime_status: AgentRuntimeStatus;
  last_heartbeat: string | null;
  tags: string[];
  is_online: boolean;
}

// --- Enrollment ---

export interface EnrollmentToken {
  id: string;
  token_hash: string;
  org_id: string;
  created_by: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface EnrollmentRequest {
  token: string;
  hostname: string;
  os: AgentOS;
  arch: AgentArch;
  agent_version: string;
}

export interface EnrollmentResponse {
  agent_id: string;
  agent_key: string;
  org_id: string;
  server_url: string;
  poll_interval: number;
}

export interface CreateTokenRequest {
  org_id: string;
  ttl_hours?: number;
  max_uses?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateTokenResponse {
  token: string;
  id: string;
  expires_at: string;
  max_uses: number;
}

// --- Heartbeat ---

export interface HeartbeatPayload {
  timestamp: string;
  status: AgentRuntimeStatus;
  current_task: string | null;
  system: {
    hostname: string;
    os: string;
    arch: string;
    uptime_seconds: number;
    cpu_percent: number;
    memory_mb: number;
    disk_free_mb: number;
  };
  agent_version: string;
  last_task_completed: string | null;
}

// --- Tasks ---

export type TaskType = 'execute_test' | 'update_agent' | 'uninstall';
export type TaskStatus = 'pending' | 'assigned' | 'downloading' | 'executing' | 'completed' | 'failed' | 'expired';

export interface TaskPayload {
  test_uuid: string;
  test_name: string;
  binary_name: string;
  binary_sha256: string;
  binary_size: number;
  execution_timeout: number;
  arguments: string[];
  metadata: TaskTestMetadata;
}

export interface TaskTestMetadata {
  category: string;
  severity: string;
  techniques: string[];
  tactics: string[];
  threat_actor: string;
  target: string;
  complexity: string;
  tags: string[];
}

export interface Task {
  id: string;
  agent_id: string;
  org_id: string;
  type: TaskType;
  priority: number;
  status: TaskStatus;
  payload: TaskPayload;
  result: TaskResult | null;
  created_at: string;
  assigned_at: string | null;
  completed_at: string | null;
  ttl: number;
  created_by: string | null;
}

export interface TaskResult {
  task_id: string;
  test_uuid: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  started_at: string;
  completed_at: string;
  execution_duration_ms: number;
  binary_sha256: string;
  hostname: string;
  os: string;
  arch: string;
}

export interface CreateTaskRequest {
  agent_ids: string[];
  test_uuid: string;
  test_name: string;
  binary_name: string;
  execution_timeout?: number;
  arguments?: string[];
  priority?: number;
  metadata: TaskTestMetadata;
}

// --- Agent Version / Updates ---

export interface AgentVersion {
  version: string;
  os: AgentOS;
  arch: AgentArch;
  binary_path: string;
  binary_sha256: string;
  binary_size: number;
  release_notes: string | null;
  mandatory: boolean;
  created_at: string;
}

export interface VersionCheckResponse {
  version: string;
  sha256: string;
  size: number;
  mandatory: boolean;
}

// --- List / Filter Requests ---

export interface ListAgentsRequest {
  org_id?: string;
  status?: AgentStatus;
  os?: AgentOS;
  hostname?: string;
  tag?: string;
  online_only?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListTasksRequest {
  agent_id?: string;
  org_id?: string;
  status?: TaskStatus;
  type?: TaskType;
  limit?: number;
  offset?: number;
}

// --- Express Request Augmentation ---

export interface AuthenticatedAgent {
  id: string;
  org_id: string;
  hostname: string;
  os: AgentOS;
  arch: AgentArch;
  status: AgentStatus;
}

declare global {
  namespace Express {
    interface Request {
      agent?: AuthenticatedAgent;
    }
  }
}
```

**Step 2: Validate TypeScript compiles**

Run: `cd /home/jimx/F0RT1KA/ProjectAchilles/backend && npx tsc --noEmit src/types/agent.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/types/agent.ts
git commit -m "feat(agent): add agent management type definitions"
```

---

### Task 2: SQLite Database Layer

**Files:**
- Create: `backend/src/services/agent/database.ts`
- Modify: `backend/package.json` (add `better-sqlite3` + `@types/better-sqlite3`)

**Context:** This is the persistence layer for all agent data. It initializes the SQLite database, creates tables, and exposes typed query helpers. Every Phase 2 backend service depends on this.

**Step 1: Install dependency**

Run: `cd /home/jimx/F0RT1KA/ProjectAchilles/backend && npm install better-sqlite3 && npm install -D @types/better-sqlite3`

**Step 2: Create the database service**

```typescript
// backend/src/services/agent/database.ts
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DATA_DIR = path.join(os.homedir(), '.projectachilles');
const DB_PATH = path.join(DATA_DIR, 'agents.db');

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initializeTables(db);
  return db;
}

function initializeTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      hostname TEXT NOT NULL,
      os TEXT NOT NULL CHECK(os IN ('windows', 'linux')),
      arch TEXT NOT NULL CHECK(arch IN ('amd64', 'arm64')),
      agent_version TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'disabled', 'decommissioned')),
      last_heartbeat TEXT,
      last_heartbeat_data TEXT,
      enrolled_at TEXT NOT NULL,
      enrolled_by TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS enrollment_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      org_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 1,
      use_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('execute_test', 'update_agent', 'uninstall')),
      priority INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','assigned','downloading','executing',
                         'completed','failed','expired')),
      payload TEXT NOT NULL,
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      assigned_at TEXT,
      completed_at TEXT,
      ttl INTEGER NOT NULL DEFAULT 604800,
      created_by TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS agent_versions (
      version TEXT NOT NULL,
      os TEXT NOT NULL CHECK(os IN ('windows', 'linux')),
      arch TEXT NOT NULL CHECK(arch IN ('amd64', 'arm64')),
      binary_path TEXT NOT NULL,
      binary_sha256 TEXT NOT NULL,
      binary_size INTEGER NOT NULL,
      release_notes TEXT,
      mandatory INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (version, os, arch)
    );

    CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(org_id);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks(org_id);
    CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_org
      ON enrollment_tokens(org_id);
  `);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

**Step 3: Validate TypeScript compiles**

Run: `cd /home/jimx/F0RT1KA/ProjectAchilles/backend && npx tsc --noEmit src/services/agent/database.ts`
Expected: No errors

**Step 4: Commit**

```bash
git add backend/src/services/agent/database.ts backend/package.json backend/package-lock.json
git commit -m "feat(agent): add SQLite database layer for agent management"
```

---

### Task 3: Go Agent Project Scaffold + Config

**Files:**
- Create: `agent/go.mod`
- Create: `agent/main.go`
- Create: `agent/internal/config/config.go`
- Create: `agent/internal/store/store.go`

**Context:** Sets up the Go module, CLI flag parsing, YAML config loading, and local state persistence. All other agent modules import from config and store.

**Step 1: Initialize Go module**

Run: `mkdir -p /home/jimx/F0RT1KA/ProjectAchilles/agent && cd /home/jimx/F0RT1KA/ProjectAchilles/agent && go mod init github.com/f0rt1ka/achilles-agent`

**Step 2: Install dependencies**

Run: `cd /home/jimx/F0RT1KA/ProjectAchilles/agent && go get gopkg.in/yaml.v3`

**Step 3: Create config package**

```go
// agent/internal/config/config.go
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	ServerURL         string        `yaml:"server_url"`
	PollInterval      time.Duration `yaml:"poll_interval"`
	HeartbeatInterval time.Duration `yaml:"heartbeat_interval"`
	AgentID           string        `yaml:"agent_id"`
	AgentKey          string        `yaml:"agent_key"`
	OrgID             string        `yaml:"org_id"`
	WorkDir           string        `yaml:"work_dir"`
	LogFile           string        `yaml:"log_file"`
	MaxExecutionTime  time.Duration `yaml:"max_execution_time"`
	MaxBinarySize     int64         `yaml:"max_binary_size"`
	CACert            string        `yaml:"ca_cert"`
	SkipTLSVerify     bool          `yaml:"skip_tls_verify"`
}

func DefaultConfig() *Config {
	workDir := "/opt/f0/tasks"
	logFile := "/opt/f0/achilles-agent.log"
	if runtime.GOOS == "windows" {
		workDir = `C:\F0\tasks`
		logFile = `C:\F0\achilles-agent.log`
	}
	return &Config{
		PollInterval:      30 * time.Second,
		HeartbeatInterval: 60 * time.Second,
		WorkDir:           workDir,
		LogFile:           logFile,
		MaxExecutionTime:  5 * time.Minute,
		MaxBinarySize:     100 * 1024 * 1024,
	}
}

func DefaultConfigPath() string {
	if runtime.GOOS == "windows" {
		return `C:\F0\achilles-agent.yaml`
	}
	return "/opt/f0/achilles-agent.yaml"
}

func Load(path string) (*Config, error) {
	cfg := DefaultConfig()
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config: %w", err)
	}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}
	return cfg, nil
}

func (c *Config) Save(path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("creating config directory: %w", err)
	}
	data, err := yaml.Marshal(c)
	if err != nil {
		return fmt.Errorf("marshaling config: %w", err)
	}
	return os.WriteFile(path, data, 0600)
}

func (c *Config) Validate() error {
	if c.ServerURL == "" {
		return fmt.Errorf("server_url is required")
	}
	if c.AgentID == "" {
		return fmt.Errorf("agent_id is required (run --enroll first)")
	}
	if c.AgentKey == "" {
		return fmt.Errorf("agent_key is required (run --enroll first)")
	}
	return nil
}
```

**Step 4: Create local state store**

```go
// agent/internal/store/store.go
package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type State struct {
	AgentID       string `json:"agent_id"`
	LastTaskID    string `json:"last_task_id,omitempty"`
	LastHeartbeat string `json:"last_heartbeat,omitempty"`
	Version       string `json:"version"`
}

type Store struct {
	path  string
	mu    sync.RWMutex
	state State
}

func New(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("creating store directory: %w", err)
	}
	s := &Store{path: filepath.Join(dir, "state.json")}
	data, err := os.ReadFile(s.path)
	if err == nil {
		if jsonErr := json.Unmarshal(data, &s.state); jsonErr != nil {
			return nil, fmt.Errorf("parsing state file: %w", jsonErr)
		}
	}
	return s, nil
}

func (s *Store) Get() State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state
}

func (s *Store) Update(fn func(*State)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(&s.state)
	data, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling state: %w", err)
	}
	return os.WriteFile(s.path, data, 0600)
}
```

**Step 5: Create main.go with CLI parsing**

```go
// agent/main.go
package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/f0rt1ka/achilles-agent/internal/config"
)

var version = "0.1.0"

func main() {
	enrollToken := flag.String("enroll", "", "Enrollment token")
	serverURL := flag.String("server", "", "Backend URL (required for enrollment)")
	install := flag.Bool("install", false, "Install as system service")
	uninstall := flag.Bool("uninstall", false, "Uninstall system service")
	showStatus := flag.Bool("status", false, "Show agent status")
	showVersion := flag.Bool("version", false, "Show agent version")
	configPath := flag.String("config", config.DefaultConfigPath(), "Config file path")
	runForeground := flag.Bool("run", false, "Run in foreground")

	flag.Parse()

	if *showVersion {
		fmt.Printf("achilles-agent v%s\n", version)
		os.Exit(0)
	}

	if *enrollToken != "" {
		if *serverURL == "" {
			log.Fatal("--server is required for enrollment")
		}
		fmt.Printf("Enrolling with server %s ...\n", *serverURL)
		// enrollment.Enroll() — implemented in Task 11
		_ = configPath
		if *install {
			fmt.Println("Installing as system service...")
			// service.Install() — implemented in Task 16
		}
		os.Exit(0)
	}

	if *uninstall {
		fmt.Println("Uninstalling...")
		os.Exit(0)
	}

	if *showStatus {
		fmt.Println("Agent status: not yet implemented")
		os.Exit(0)
	}

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	if err := cfg.Validate(); err != nil {
		log.Fatalf("Invalid config: %v", err)
	}

	if *runForeground {
		fmt.Printf("Running achilles-agent v%s in foreground\n", version)
		// poller.Run(cfg) — implemented in Task 12
		return
	}

	fmt.Println("Use --run for foreground mode, or --install to set up as a service")
}
```

**Step 6: Verify Go builds**

Run: `cd /home/jimx/F0RT1KA/ProjectAchilles/agent && go build -o /dev/null .`
Expected: Builds without errors

**Step 7: Commit**

```bash
git add agent/
git commit -m "feat(agent): scaffold Go agent with config, store, and CLI"
```

---

### Task 4: Frontend Agent Types + API Client

**Files:**
- Create: `frontend/src/types/agent.ts`
- Create: `frontend/src/services/api/agent.ts`

**Context:** Defines frontend-side agent types (mirroring backend types) and the API client for the admin management endpoints. These are Clerk-authenticated calls (admin managing agents via UI), not agent-to-backend calls.

**Step 1: Create frontend types**

```typescript
// frontend/src/types/agent.ts

export type AgentStatus = 'active' | 'disabled' | 'decommissioned';
export type AgentOS = 'windows' | 'linux';
export type AgentArch = 'amd64' | 'arm64';
export type AgentRuntimeStatus = 'idle' | 'executing' | 'updating' | 'error' | 'offline';
export type TaskStatus = 'pending' | 'assigned' | 'downloading' | 'executing'
  | 'completed' | 'failed' | 'expired';
export type TaskType = 'execute_test' | 'update_agent' | 'uninstall';

export interface AgentSummary {
  id: string;
  hostname: string;
  os: AgentOS;
  arch: AgentArch;
  agent_version: string;
  status: AgentStatus;
  runtime_status: AgentRuntimeStatus;
  last_heartbeat: string | null;
  tags: string[];
  is_online: boolean;
}

export interface Agent {
  id: string;
  org_id: string;
  hostname: string;
  os: AgentOS;
  arch: AgentArch;
  agent_version: string;
  status: AgentStatus;
  last_heartbeat: string | null;
  last_heartbeat_data: HeartbeatData | null;
  enrolled_at: string;
  enrolled_by: string | null;
  tags: string[];
}

export interface HeartbeatData {
  timestamp: string;
  status: AgentRuntimeStatus;
  current_task: string | null;
  system: {
    hostname: string;
    os: string;
    arch: string;
    uptime_seconds: number;
    cpu_percent: number;
    memory_mb: number;
    disk_free_mb: number;
  };
  agent_version: string;
  last_task_completed: string | null;
}

export interface TaskTestMetadata {
  category: string;
  severity: string;
  techniques: string[];
  tactics: string[];
  threat_actor: string;
  target: string;
  complexity: string;
  tags: string[];
}

export interface AgentTask {
  id: string;
  agent_id: string;
  type: TaskType;
  priority: number;
  status: TaskStatus;
  payload: {
    test_uuid: string;
    test_name: string;
    binary_name: string;
    execution_timeout: number;
  };
  result: TaskResult | null;
  created_at: string;
  assigned_at: string | null;
  completed_at: string | null;
}

export interface TaskResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  started_at: string;
  completed_at: string;
  execution_duration_ms: number;
  hostname: string;
}

export interface EnrollmentToken {
  id: string;
  token?: string;
  org_id: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
  created_at: string;
}

export interface CreateTokenRequest {
  org_id: string;
  ttl_hours?: number;
  max_uses?: number;
}

export interface CreateTasksRequest {
  agent_ids: string[];
  test_uuid: string;
  test_name: string;
  binary_name: string;
  execution_timeout?: number;
  arguments?: string[];
  priority?: number;
  metadata: TaskTestMetadata;
}

export interface ListAgentsRequest {
  status?: AgentStatus;
  os?: AgentOS;
  hostname?: string;
  tag?: string;
  online_only?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListTasksRequest {
  agent_id?: string;
  status?: TaskStatus;
  type?: TaskType;
  limit?: number;
  offset?: number;
}

export interface AgentMetrics {
  total: number;
  online: number;
  offline: number;
  by_os: Record<string, number>;
  by_status: Record<string, number>;
  pending_tasks: number;
}
```

**Step 2: Create the API client**

```typescript
// frontend/src/services/api/agent.ts
import { apiClient } from '@/hooks/useAuthenticatedApi';
import type {
  AgentSummary,
  Agent,
  AgentTask,
  EnrollmentToken,
  CreateTokenRequest,
  CreateTasksRequest,
  ListAgentsRequest,
  ListTasksRequest,
  AgentMetrics,
} from '@/types/agent';

export const agentApi = {
  // --- Agents ---

  async listAgents(
    params?: ListAgentsRequest
  ): Promise<{ agents: AgentSummary[]; total: number }> {
    const response = await apiClient.get('/agent/admin/agents', { params });
    return response.data.data;
  },

  async getAgent(agentId: string): Promise<Agent> {
    const response = await apiClient.get(`/agent/admin/agents/${agentId}`);
    return response.data.data;
  },

  async updateAgent(
    agentId: string,
    updates: { status?: string; tags?: string[] }
  ): Promise<void> {
    await apiClient.patch(`/agent/admin/agents/${agentId}`, updates);
  },

  async deleteAgent(agentId: string): Promise<void> {
    await apiClient.delete(`/agent/admin/agents/${agentId}`);
  },

  async tagAgent(agentId: string, tag: string): Promise<void> {
    await apiClient.post(`/agent/admin/agents/${agentId}/tag`, { tag });
  },

  async untagAgent(agentId: string, tag: string): Promise<void> {
    await apiClient.delete(`/agent/admin/agents/${agentId}/tag`, {
      data: { tag },
    });
  },

  async getMetrics(): Promise<AgentMetrics> {
    const response = await apiClient.get('/agent/admin/metrics');
    return response.data.data;
  },

  // --- Enrollment Tokens ---

  async createToken(data: CreateTokenRequest): Promise<EnrollmentToken> {
    const response = await apiClient.post('/agent/admin/tokens', data);
    return response.data.data;
  },

  async listTokens(): Promise<EnrollmentToken[]> {
    const response = await apiClient.get('/agent/admin/tokens');
    return response.data.data;
  },

  async revokeToken(tokenId: string): Promise<void> {
    await apiClient.delete(`/agent/admin/tokens/${tokenId}`);
  },

  // --- Tasks ---

  async createTasks(
    data: CreateTasksRequest
  ): Promise<{
    task_ids: string[];
    summary: { total: number; created: number };
  }> {
    const response = await apiClient.post('/agent/admin/tasks', data);
    return response.data.data;
  },

  async listTasks(
    params?: ListTasksRequest
  ): Promise<{ tasks: AgentTask[]; total: number }> {
    const response = await apiClient.get('/agent/admin/tasks', { params });
    return response.data.data;
  },

  async getTask(taskId: string): Promise<AgentTask> {
    const response = await apiClient.get(`/agent/admin/tasks/${taskId}`);
    return response.data.data;
  },

  async cancelTask(taskId: string): Promise<void> {
    await apiClient.patch(`/agent/admin/tasks/${taskId}`, {
      status: 'expired',
    });
  },
};
```

**Step 3: Validate TypeScript compiles**

Run: `cd /home/jimx/F0RT1KA/ProjectAchilles/frontend && npx tsc --noEmit src/types/agent.ts src/services/api/agent.ts`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/types/agent.ts frontend/src/services/api/agent.ts
git commit -m "feat(agent): add frontend agent types and API client"
```

---

## PHASE 2 — Core Services

---

### Task 5: Agent Authentication Middleware

**Files:**
- Create: `backend/src/middleware/agentAuth.middleware.ts`
- Modify: `backend/package.json` (add `bcryptjs` + `@types/bcryptjs`)

**Context:** Authenticates agent-to-backend API calls using the `Authorization: Bearer ak_*` header and `X-Agent-ID` header. Does NOT use Clerk; agents have their own auth.

**Step 1: Install bcryptjs**

Run: `cd /home/jimx/F0RT1KA/ProjectAchilles/backend && npm install bcryptjs && npm install -D @types/bcryptjs`

**Step 2: Implement middleware**

Key logic:
- Extract Bearer token from Authorization header (must start with `ak_`)
- Extract agent_id from `X-Agent-ID` header
- Look up agent by id in SQLite via `getDatabase()`
- Verify `agent.status === 'active'` (return 403 if disabled/decommissioned)
- Compare token against `agent.api_key_hash` using `bcryptjs.compare()`
- Attach agent info to `req.agent` as `AuthenticatedAgent`
- Return 401 on missing/invalid credentials, 403 on disabled agent

**Exports:** `requireAgentAuth` (Express middleware function)

**Response format on failure:**
```typescript
res.status(401).json({ success: false, error: 'Invalid agent credentials' });
res.status(403).json({ success: false, error: 'Agent is disabled' });
```

**Step 3: Commit**

```bash
git add backend/src/middleware/agentAuth.middleware.ts backend/package.json backend/package-lock.json
git commit -m "feat(agent): add agent API key authentication middleware"
```

---

### Task 6: Enrollment Service + Routes

**Files:**
- Create: `backend/src/services/agent/enrollment.service.ts`
- Create: `backend/src/api/agent/enrollment.routes.ts`

**Context:** Two sets of endpoints: (1) Admin endpoints (Clerk-protected) for generating enrollment tokens, (2) Public endpoint for agents to enroll using a token.

**Service methods:**
- `createToken(orgId, createdBy, ttlHours, maxUses)` — generates random token (`acht_` + 32 hex chars via `crypto.randomBytes(16).toString('hex')`), stores bcrypt hash, returns plaintext once
- `enrollAgent(request: EnrollmentRequest)` — validates token hash via bcrypt (iterate all non-expired, non-fully-used tokens for the matching org), creates agent record with UUID, generates API key (`ak_` + 64 hex chars via `crypto.randomBytes(32).toString('hex')`), stores bcrypt hash, increments token use_count, returns `EnrollmentResponse`
- `listTokens(orgId)` — returns active (non-expired, use_count < max_uses) tokens
- `revokeToken(tokenId)` — deletes token record

**Routes:**
```
POST /api/agent/enroll                  — Agent enrollment (NO auth required)
POST /api/agent/admin/tokens            — Create token (Clerk auth)
GET  /api/agent/admin/tokens            — List tokens (Clerk auth)
DELETE /api/agent/admin/tokens/:id      — Revoke token (Clerk auth)
```

**Step N: Commit**

```bash
git add backend/src/services/agent/enrollment.service.ts backend/src/api/agent/enrollment.routes.ts
git commit -m "feat(agent): add enrollment service with token generation and agent registration"
```

---

### Task 7: Heartbeat Service + Routes

**Files:**
- Create: `backend/src/services/agent/heartbeat.service.ts`
- Create: `backend/src/api/agent/heartbeat.routes.ts`

**Context:** Agents POST heartbeats every 60s. The service stores heartbeat data and determines online/offline status. Online threshold: last heartbeat within 180 seconds (3x heartbeat interval).

**Service methods:**
- `processHeartbeat(agentId, payload: HeartbeatPayload)` — update agent's `last_heartbeat` timestamp and `last_heartbeat_data` JSON in SQLite, also update `agent_version` if changed
- `isAgentOnline(lastHeartbeat: string | null)` — returns true if `last_heartbeat` is within 180 seconds of now
- `getAgentMetrics(orgId?)` — aggregate counts from agents table: total, online (heartbeat < 180s), offline, group by os, group by status; count pending tasks from tasks table

**Routes:**
```
POST /api/agent/heartbeat               — Process heartbeat (agent auth via requireAgentAuth)
GET  /api/agent/admin/metrics           — Get agent metrics (Clerk auth via requireClerkAuth)
GET  /api/agent/admin/agents            — List agents with online status (Clerk auth)
GET  /api/agent/admin/agents/:id        — Get single agent detail (Clerk auth)
PATCH /api/agent/admin/agents/:id       — Update agent status/tags (Clerk auth)
DELETE /api/agent/admin/agents/:id      — Decommission agent (Clerk auth)
POST /api/agent/admin/agents/:id/tag    — Add tag (Clerk auth)
DELETE /api/agent/admin/agents/:id/tag  — Remove tag (Clerk auth)
```

**Step N: Commit**

```bash
git add backend/src/services/agent/heartbeat.service.ts backend/src/api/agent/heartbeat.routes.ts
git commit -m "feat(agent): add heartbeat processing service and agent management endpoints"
```

---

### Task 8: Task Queue Service + Routes

**Files:**
- Create: `backend/src/services/agent/tasks.service.ts`
- Create: `backend/src/api/agent/tasks.routes.ts`

**Context:** Manages the task lifecycle. Admins create tasks (Clerk auth), agents fetch and update tasks (agent auth).

**Service methods:**
- `createTasks(request: CreateTaskRequest, createdBy)` — for each agent_id, create a task record with UUID; compute `binary_sha256` and `binary_size` from the build file at `~/.projectachilles/builds/{test_uuid}/` by reading `build-meta.json` and computing SHA256 of the binary
- `getNextTask(agentId)` — find oldest pending task for this agent (`ORDER BY priority DESC, created_at ASC`), atomically mark as `assigned` and set `assigned_at`, return task or null
- `updateTaskStatus(taskId, agentId, newStatus)` — validate agent owns the task; validate state transition (pending->assigned->downloading->executing->completed|failed); update status and timestamps
- `submitResult(taskId, agentId, result: TaskResult)` — store result JSON, mark task completed, call results ingestion service (Task 10)
- `listTasks(filters: ListTasksRequest)` — paginated task list with optional filters
- `expireOldTasks()` — mark tasks where `created_at + ttl < now()` as `expired`; called on every `getNextTask()`

**Routes (Agent auth):**
```
GET   /api/agent/tasks                    — Fetch next task (returns 204 if none)
PATCH /api/agent/tasks/:id/status         — Update task status
POST  /api/agent/tasks/:id/result         — Submit result
```

**Routes (Admin/Clerk auth):**
```
POST  /api/agent/admin/tasks              — Create tasks for agents
GET   /api/agent/admin/tasks              — List tasks with filters
GET   /api/agent/admin/tasks/:id          — Get task detail
PATCH /api/agent/admin/tasks/:id          — Cancel/update task
```

**Step N: Commit**

```bash
git add backend/src/services/agent/tasks.service.ts backend/src/api/agent/tasks.routes.ts
git commit -m "feat(agent): add task queue service with create, fetch, and result submission"
```

---

### Task 9: Binary Serving Service + Routes

**Files:**
- Create: `backend/src/services/agent/binary.service.ts`
- Create: `backend/src/api/agent/binary.routes.ts`

**Context:** Agents download test binaries from the backend. Reads from `~/.projectachilles/builds/{test_uuid}/` — the same location the existing BuildService writes to.

**Service methods:**
- `getBinaryInfo(binaryName)` — extract UUID from filename (strip `.exe` extension), read `~/.projectachilles/builds/{uuid}/build-meta.json` for size/filename, compute SHA256 of the actual binary file
- `streamBinary(binaryName, res)` — resolve path, set `Content-Type: application/octet-stream`, `Content-Length`, `Content-Disposition`, and pipe the file to the Express response

**Routes (Agent auth):**
```
GET /api/agent/binary/:name              — Download test binary (agent auth)
```

**Step N: Commit**

```bash
git add backend/src/services/agent/binary.service.ts backend/src/api/agent/binary.routes.ts
git commit -m "feat(agent): add binary serving endpoint for test binary downloads"
```

---

### Task 10: Result Ingestion Service

**Files:**
- Create: `backend/src/services/agent/results.service.ts`

**Context:** Transforms agent task results into the existing Elasticsearch document schema so the Analytics module works unchanged. This is the critical compatibility layer.

**Service method:**
- `ingestResult(task: Task, result: TaskResult)` — builds ES document and indexes it

**Error code mapping (must match `backend/src/services/analytics/elasticsearch.ts`):**
```
0   -> NormalExit          (protected: false)
1   -> BinaryNotRecognized (protected: false)
101 -> Unprotected         (protected: false)
105 -> FileQuarantinedOnExtraction (protected: true)
126 -> ExecutionPrevented  (protected: true)
127 -> QuarantinedOnExecution (protected: true)
200 -> NoOutput            (protected: false)
259 -> StillActive         (protected: false)
999 -> UnexpectedTestError (protected: false)
```

**ES document format (must match existing schema exactly):**
```typescript
{
  routing: {
    event_time: result.completed_at,          // ISO timestamp
    oid: task.org_id,                          // org UUID
    hostname: result.hostname,                 // endpoint hostname
  },
  event: {
    ERROR: result.exit_code,                   // numeric code
  },
  f0rtika: {
    test_uuid: task.payload.test_uuid,
    test_name: task.payload.test_name,
    is_protected: errorMap[result.exit_code]?.protected ?? false,
    error_name: errorMap[result.exit_code]?.name ?? `Unknown (${result.exit_code})`,
    category: task.payload.metadata.category,
    severity: task.payload.metadata.severity,
    techniques: task.payload.metadata.techniques,
    tactics: task.payload.metadata.tactics,
    threat_actor: task.payload.metadata.threat_actor,
    target: task.payload.metadata.target,
    complexity: task.payload.metadata.complexity,
    tags: task.payload.metadata.tags,
  },
}
```

**ES client:** Import `SettingsService` from `../analytics/settings.js` and create `ElasticsearchService` from `../analytics/elasticsearch.js` using the lazy initialization pattern (same as `analytics.routes.ts`). Call `esClient.index({ index: indexPattern, document: doc })`.

**Step N: Commit**

```bash
git add backend/src/services/agent/results.service.ts
git commit -m "feat(agent): add result ingestion service mapping agent results to ES schema"
```

---

### Task 11: Go Agent — Enrollment Module

**Files:**
- Create: `agent/internal/enrollment/enrollment.go`

**Context:** Handles the one-time enrollment handshake. Called when the agent runs with `--enroll <token> --server <url>`.

**Function signature:**
```go
func Enroll(serverURL, token, configPath string) error
```

**Logic:**
1. Gather system info: `os.Hostname()`, `runtime.GOOS`, `runtime.GOARCH`
2. Build `EnrollmentRequest` JSON: `{ token, hostname, os, arch, agent_version }`
3. POST to `serverURL + "/api/agent/enroll"`
4. Parse response: `{ agent_id, agent_key, org_id, server_url, poll_interval }`
5. Create Config struct, populate all fields
6. Save config to `configPath` via `config.Save()`
7. Print success: `"Enrolled successfully. Agent ID: {agent_id}"`

**Error handling:** Print clear error messages for HTTP 401 (invalid token), 410 (token expired/used), network errors.

**Step N: Commit**

```bash
git add agent/internal/enrollment/
git commit -m "feat(agent): add enrollment module for one-time agent registration"
```

---

### Task 12: Go Agent — Poller + Heartbeat Module

**Files:**
- Create: `agent/internal/httpclient/client.go`
- Create: `agent/internal/poller/poller.go`

**Context:** The main run loop. Shared HTTP client with auth headers; two tickers for heartbeat and task polling.

**httpclient package:**
- `type Client struct` with `*http.Client`, config reference, version string
- `NewClient(cfg *config.Config) *Client` — configures TLS (custom CA, skip verify), sets timeouts
- `Do(ctx context.Context, method, path string, body interface{}) (*http.Response, error)` — adds headers: `Authorization: Bearer {agent_key}`, `X-Agent-ID: {agent_id}`, `X-Agent-Version: {version}`, `Content-Type: application/json`
- Exponential backoff on 429/5xx (1s, 2s, 4s, max 3 retries)

**poller package:**
- `func Run(ctx context.Context, cfg *config.Config, store *store.Store) error` — blocking
- Two tickers: heartbeat (cfg.HeartbeatInterval) and poll (cfg.PollInterval) with `math/rand` jitter of +/-5s
- Heartbeat: POST `/api/agent/heartbeat` with system stats from `runtime.MemStats`, `os.Hostname`, CPU via `/proc/stat` (Linux) or WMI (Windows, or skip for simplicity)
- Task poll: GET `/api/agent/tasks`; if 200 with body, decode Task, call executor.Execute(); if 204, continue
- Graceful shutdown: `context.WithCancel`, listen for `os.Signal(SIGINT, SIGTERM)`

**Step N: Commit**

```bash
git add agent/internal/httpclient/ agent/internal/poller/
git commit -m "feat(agent): add HTTP client, poller loop, and heartbeat module"
```

---

### Task 13: Go Agent — Executor Module

**Files:**
- Create: `agent/internal/executor/executor.go`
- Create: `agent/internal/executor/types.go`

**Context:** Downloads test binary, verifies integrity, executes it, captures result.

**types.go:**
```go
type Task struct {
    TaskID  string      `json:"task_id"`
    Type    string      `json:"type"`
    Payload TaskPayload `json:"payload"`
}

type TaskPayload struct {
    TestUUID         string   `json:"test_uuid"`
    TestName         string   `json:"test_name"`
    BinaryName       string   `json:"binary_name"`
    BinarySHA256     string   `json:"binary_sha256"`
    BinarySize       int64    `json:"binary_size"`
    ExecutionTimeout int      `json:"execution_timeout"`
    Arguments        []string `json:"arguments"`
}

type Result struct {
    TaskID            string `json:"task_id"`
    TestUUID          string `json:"test_uuid"`
    ExitCode          int    `json:"exit_code"`
    Stdout            string `json:"stdout"`
    Stderr            string `json:"stderr"`
    StartedAt         string `json:"started_at"`
    CompletedAt       string `json:"completed_at"`
    ExecutionDurationMs int64 `json:"execution_duration_ms"`
    BinarySHA256      string `json:"binary_sha256"`
    Hostname          string `json:"hostname"`
    OS                string `json:"os"`
    Arch              string `json:"arch"`
}
```

**executor.go — `func Execute(ctx context.Context, client *httpclient.Client, task Task, cfg *config.Config) (*Result, error)`:**

1. PATCH `/api/agent/tasks/{id}/status` with `{ "status": "downloading" }`
2. GET `/api/agent/binary/{binary_name}` — save to temp dir under `cfg.WorkDir`
3. Verify SHA256: `crypto/sha256` over downloaded file, compare to `task.Payload.BinarySHA256`
4. Verify file size matches `task.Payload.BinarySize`
5. On Linux: `os.Chmod(path, 0755)`
6. PATCH status to `"executing"`
7. Create `exec.CommandContext` with timeout `time.Duration(task.Payload.ExecutionTimeout) * time.Second`
   - Set `cmd.Dir` to isolated temp dir
   - Capture stdout/stderr via `bytes.Buffer` with `io.LimitReader` (1MB)
   - NO shell wrapper (direct binary execution)
8. Run, capture exit code (handle `*exec.ExitError` for non-zero exits)
   - If context deadline exceeded: exit_code = 259 (StillActive)
9. Build Result struct with timing, hostname, OS, arch
10. Cleanup: `os.RemoveAll(tempDir)`
11. Return Result

**Step N: Commit**

```bash
git add agent/internal/executor/
git commit -m "feat(agent): add test binary executor with SHA256 verification and timeout"
```

---

### Task 14: Go Agent — Reporter Module

**Files:**
- Create: `agent/internal/reporter/reporter.go`

**Context:** Sends execution results to backend and updates task status.

**Function:** `func Report(ctx context.Context, client *httpclient.Client, taskID string, result *executor.Result) error`

1. POST `/api/agent/tasks/{taskID}/result` with Result JSON body
2. If success: PATCH `/api/agent/tasks/{taskID}/status` with `{ "status": "completed" }`
3. If execution had error (non-zero exit): still POST result, still mark completed (the exit code IS the result)
4. If POST fails (network/5xx): retry up to 3 times with 2s/4s/8s backoff
5. If all retries fail: PATCH status to `"failed"`, return error

**Step N: Commit**

```bash
git add agent/internal/reporter/
git commit -m "feat(agent): add result reporter with retry logic"
```

---

## PHASE 3 — Integration

---

### Task 15: Mount Agent Routes in server.ts

**Files:**
- Create: `backend/src/api/agent/index.ts`
- Modify: `backend/src/server.ts`

**Context:** Create a combined agent router and mount it in the Express app.

**`backend/src/api/agent/index.ts`:**
- Import all route files from this directory
- Create two sub-routers:
  - Agent-facing routes (authenticated via `requireAgentAuth`):
    `POST /enroll` (NO auth), `POST /heartbeat`, `GET /tasks`, `PATCH /tasks/:id/status`, `POST /tasks/:id/result`, `GET /binary/:name`, `GET /version`, `GET /update`
  - Admin routes (authenticated via `requireClerkAuth`):
    `POST /admin/tokens`, `GET /admin/tokens`, `DELETE /admin/tokens/:id`, `GET /admin/agents`, `GET /admin/agents/:id`, `PATCH /admin/agents/:id`, `DELETE /admin/agents/:id`, `POST /admin/agents/:id/tag`, `DELETE /admin/agents/:id/tag`, `GET /admin/metrics`, `POST /admin/tasks`, `GET /admin/tasks`, `GET /admin/tasks/:id`, `PATCH /admin/tasks/:id`, `POST /admin/versions`, `GET /admin/versions`
- Export: `createAgentRouter()` function returning the combined Router

**Modify `backend/src/server.ts`:**
- Add import: `import { createAgentRouter } from './api/agent/index.js';`
- Mount before error handlers: `app.use('/api/agent', createAgentRouter());`
- Keep existing LimaCharlie routes for now (parallel operation per migration strategy)

**Step N: Commit**

```bash
git add backend/src/api/agent/index.ts backend/src/server.ts
git commit -m "feat(agent): mount agent API routes in Express server"
```

---

### Task 16: Go Agent — Service Wrappers (Windows + Linux)

**Files:**
- Create: `agent/internal/service/service_windows.go` (build tag: `//go:build windows`)
- Create: `agent/internal/service/service_linux.go` (build tag: `//go:build linux`)
- Create: `agent/internal/service/install.go`

**Windows (`service_windows.go`):**
- Install dep: `go get golang.org/x/sys`
- Implement `golang.org/x/sys/windows/svc.Handler` interface
- Service name: `AchillesAgent`, display name: `Achilles Agent`
- Handle `svc.AcceptStop | svc.AcceptShutdown`
- `Execute()` method: create context, run `poller.Run(ctx, cfg, store)`, cancel on stop signal

**Linux (`service_linux.go`):**
- `Install(configPath string)` — write systemd unit file to `/etc/systemd/system/achilles-agent.service`:
  ```
  [Unit]
  Description=Achilles Agent
  After=network-online.target
  Wants=network-online.target

  [Service]
  Type=simple
  ExecStart=/opt/f0/achilles-agent --run
  Restart=always
  RestartSec=10
  WorkingDirectory=/opt/f0

  [Install]
  WantedBy=multi-user.target
  ```
- Run `systemctl daemon-reload && systemctl enable achilles-agent && systemctl start achilles-agent`
- `Uninstall()` — stop, disable, remove unit file, daemon-reload
- `Run(cfg, store)` — just calls `poller.Run()` directly (systemd manages lifecycle)

**install.go (shared):**
- `func Install(configPath string) error` — dispatches to platform-specific install
- `func Uninstall() error` — dispatches to platform-specific uninstall

**Step N: Commit**

```bash
git add agent/internal/service/
git commit -m "feat(agent): add Windows Service and Linux systemd service wrappers"
```

---

### Task 17: Go Agent — Self-Update Module

**Files:**
- Create: `agent/internal/updater/updater.go`

**Context:** Checks for new versions during heartbeat. Downloads, verifies, replaces agent binary.

**Function:** `func CheckAndUpdate(ctx context.Context, client *httpclient.Client, currentVersion string, cfg *config.Config) (bool, error)`

1. GET `/api/agent/version` — parse `{ version, sha256, size, mandatory }`
2. Compare version strings (simple string comparison or semver if importing a lib)
3. If no update: return `(false, nil)`
4. GET `/api/agent/update?os={GOOS}&arch={GOARCH}` — stream to temp file
5. Verify SHA256 of downloaded file
6. Platform-specific replacement:
   - **Windows:** Rename current binary to `.old`, rename new to current path, return `(true, nil)` — service controller restarts
   - **Linux:** Replace binary in-place (Linux allows this for running binaries), then `syscall.Exec` to re-exec self with same args

**Step N: Commit**

```bash
git add agent/internal/updater/
git commit -m "feat(agent): add self-update module with SHA256 verification"
```

---

### Task 18: Backend — Agent Update Service + Routes

**Files:**
- Create: `backend/src/services/agent/update.service.ts`
- Create: `backend/src/api/agent/update.routes.ts`

**Context:** Manages agent binary versions for the self-update mechanism.

**Service methods:**
- `registerVersion(version, os, arch, binaryPath, releaseNotes, mandatory)` — compute SHA256 and size from file, insert into `agent_versions` table
- `getLatestVersion(os, arch)` — query latest version for platform, return `VersionCheckResponse`
- `streamUpdate(os, arch, res)` — resolve binary_path from latest version record, stream file to Express response

**Routes (Agent auth):**
```
GET /api/agent/version                   — Check for updates (returns version info or 204)
GET /api/agent/update                    — Download agent binary (query: os, arch)
```

**Routes (Admin/Clerk auth):**
```
POST /api/agent/admin/versions           — Upload new agent version (multipart form)
GET  /api/agent/admin/versions           — List all versions
```

**Step N: Commit**

```bash
git add backend/src/services/agent/update.service.ts backend/src/api/agent/update.routes.ts
git commit -m "feat(agent): add agent update management service and endpoints"
```

---

## PHASE 4 — Frontend

---

### Task 19: Redux Agent Slice

**Files:**
- Create: `frontend/src/store/agentSlice.ts`
- Modify: `frontend/src/store/index.ts` (add agent reducer)

**Context:** Manages agent list state. Follows the existing `sensorsSlice.ts` pattern exactly.

**State shape:**
```typescript
{
  agents: AgentSummary[];
  selectedAgent: Agent | null;
  tasks: AgentTask[];
  metrics: AgentMetrics | null;
  loading: boolean;
  error: string | null;
  filters: ListAgentsRequest;
  pagination: { page: number; pageSize: number; total: number };
}
```

**Async thunks:**
- `fetchAgents(filters)` — calls `agentApi.listAgents()`
- `fetchAgent(id)` — calls `agentApi.getAgent()`
- `fetchMetrics()` — calls `agentApi.getMetrics()`
- `fetchTasks(filters)` — calls `agentApi.listTasks()`
- `createTasks(data)` — calls `agentApi.createTasks()`
- `updateAgentStatus(id, status)` — calls `agentApi.updateAgent()`
- `tagAgent(id, tag)` — calls `agentApi.tagAgent()`
- `untagAgent(id, tag)` — calls `agentApi.untagAgent()`

**Modify `store/index.ts`:** Add `agent: agentReducer` to `configureStore({ reducer: { ... } })`.

**Step N: Commit**

```bash
git add frontend/src/store/agentSlice.ts frontend/src/store/index.ts
git commit -m "feat(agent): add Redux agent slice with async thunks"
```

---

### Task 20: AgentDashboardPage

**Files:**
- Create: `frontend/src/pages/endpoints/AgentDashboardPage.tsx`

**Context:** Replaces `EndpointDashboardPage.tsx`. Shows agent fleet overview metrics.

**Layout (mirror existing dashboard pattern):**
- Top row: 4 metric cards (Total Agents, Online, Offline, Pending Tasks)
- Middle row: OS distribution card (Windows vs Linux, donut chart using Recharts) + Agent version distribution
- Bottom row: Quick action cards linking to /endpoints/agents, /endpoints/tasks, and enrollment section
- Recent task completions list (last 5 tasks)

**Data fetching:** Call `agentApi.getMetrics()` and `agentApi.listTasks({ limit: 5 })` on mount.

**Step N: Commit**

```bash
git add frontend/src/pages/endpoints/AgentDashboardPage.tsx
git commit -m "feat(agent): add agent dashboard page with fleet metrics"
```

---

### Task 21: AgentsPage (List + Manage)

**Files:**
- Create: `frontend/src/pages/endpoints/AgentsPage.tsx`
- Create: `frontend/src/components/endpoints/agents/AgentList.tsx`
- Create: `frontend/src/components/endpoints/agents/AgentFilters.tsx`
- Create: `frontend/src/components/endpoints/agents/AgentDetailPanel.tsx`

**Context:** Replaces `SensorsPage.tsx`. Follow the exact SensorsPage layout pattern.

**AgentFilters props:** `{ filters, onFilterChange, onRefresh }`
- Hostname search input
- OS dropdown (all/windows/linux)
- Status dropdown (all/active/disabled/decommissioned)
- Online-only toggle switch

**AgentList props:** `{ agents, selectedAgents, onToggleSelect, onToggleSelectAll }`
- Table columns: Checkbox, Status dot (green=online/gray=offline), Hostname, OS (with icon), Arch, Version, Last Seen (relative time), Tags (badges), Actions dropdown (disable/enable, decommission, delete)
- Follow `SensorList.tsx` patterns for selection, pagination, bulk actions

**AgentDetailPanel props:** `{ agent: Agent | null, onClose }`
- Slide-out panel (or expandable section)
- Sections: Agent Info (id, enrolled date, enrolled by), System Info (from last heartbeat data), Recent Tasks list, Tags management

**AgentsPage:** Compose AgentFilters + AgentList + AgentDetailPanel + TagManager + pagination. Use Redux `agentSlice` for state.

**Step N: Commit**

```bash
git add frontend/src/pages/endpoints/AgentsPage.tsx frontend/src/components/endpoints/agents/
git commit -m "feat(agent): add agents list page with filtering, tagging, and detail panel"
```

---

### Task 22: TasksPage (Create + Monitor)

**Files:**
- Create: `frontend/src/pages/endpoints/TasksPage.tsx`
- Create: `frontend/src/components/endpoints/tasks/TaskCreatorDialog.tsx`
- Create: `frontend/src/components/endpoints/tasks/TaskList.tsx`

**Context:** Replaces `PayloadsPage.tsx` and parts of `EventsPage.tsx`.

**TaskCreatorDialog props:** `{ open, onClose, selectedAgents?: string[] }`
- Step 1: Select test (fetch from `browserApi.getAllTests()`, searchable dropdown)
- Step 2: Select target agents (multi-select from agent list, or pre-filled if opened from AgentsPage)
- Step 3: Set execution timeout (default 300s), priority (1/2/3)
- Step 4: Confirm and create (calls `agentApi.createTasks()`)
- Show result summary: N tasks created for M agents

**TaskList props:** `{ tasks, loading }`
- Table columns: Status badge, Test Name, Agent Hostname, Created, Started, Completed, Duration, Exit Code, Actions (view detail, cancel if pending)
- Status badge colors: pending=gray, assigned=blue, downloading=blue, executing=amber, completed=green, failed=red, expired=gray
- Expandable rows showing stdout/stderr/result detail
- Filter bar: status dropdown, agent dropdown, test dropdown

**TasksPage:** TaskList with filter bar + "Create Task" button opening TaskCreatorDialog. Use Redux `agentSlice.tasks` for state.

**Step N: Commit**

```bash
git add frontend/src/pages/endpoints/TasksPage.tsx frontend/src/components/endpoints/tasks/TaskCreatorDialog.tsx frontend/src/components/endpoints/tasks/TaskList.tsx
git commit -m "feat(agent): add task creation and monitoring page"
```

---

### Task 23: EnrollmentTokenGenerator

**Files:**
- Create: `frontend/src/components/endpoints/enrollment/EnrollmentSection.tsx`

**Context:** Section for generating enrollment tokens. Can be placed on the dashboard or agents page.

**Features:**
- "Generate Token" button with optional settings (TTL hours, max uses)
- On generation: show token in a highlighted code block with clipboard copy button
- Show installation command templates:
  - Windows PowerShell snippet
  - Linux bash snippet
- Token list table: ID (truncated), Created, Expires, Uses (N/M), Status, Revoke button
- Refresh button to re-fetch token list

**Data:** `agentApi.createToken()`, `agentApi.listTokens()`, `agentApi.revokeToken()`

**Step N: Commit**

```bash
git add frontend/src/components/endpoints/enrollment/
git commit -m "feat(agent): add enrollment token generator with install command snippets"
```

---

### Task 24: Replace Routes + Cleanup LimaCharlie Code

**Files:**
- Modify: `frontend/src/routes/AppRouter.tsx` — update endpoint routes
- Modify: `frontend/src/components/layout/AppSidebar.tsx` — update navigation
- Modify: `frontend/src/store/index.ts` — remove old slices if still referenced
- Modify: `backend/src/server.ts` — comment out LimaCharlie route mounting

**Route changes in AppRouter.tsx:**
```
/endpoints            → AgentDashboardPage (was EndpointDashboardPage)
/endpoints/agents     → AgentsPage (was SensorsPage at /endpoints/sensors)
/endpoints/tasks      → TasksPage (was PayloadsPage at /endpoints/payloads)
```
Remove: `/endpoints/events` route (events now visible via task results)

**Sidebar navigation update in AppSidebar.tsx:**
- Endpoints section links:
  - Dashboard -> /endpoints
  - Agents -> /endpoints/agents
  - Tasks -> /endpoints/tasks
- Remove: Sensors, Payloads, Events links

**Backend server.ts:**
- Comment out: `app.use('/api/endpoints', endpointsRoutes);`
- Comment out: `app.use('/api/auth', authLimiter, endpointAuthRoutes);`
- Remove associated imports (or comment them out)
- Keep: Clerk middleware, analytics routes, browser routes, tests routes, agent routes

**Do NOT delete old files yet** — keep them for reference during parallel operation phase. Just disconnect them from the router.

**Step N: Commit**

```bash
git add frontend/src/routes/AppRouter.tsx frontend/src/components/layout/AppSidebar.tsx frontend/src/store/index.ts backend/src/server.ts
git commit -m "feat(agent): replace LimaCharlie routes with Achilles Agent pages"
```

---

## PHASE 5 — Build and Ship

---

### Task 25: Cross-Compile + Sign Pipeline

**Files:**
- Create: `agent/Makefile`

**Context:** Build the Go agent for both platforms, sign the Windows binary.

**Makefile:**
```makefile
VERSION := 0.1.0
LDFLAGS := -s -w -X main.version=$(VERSION)
DIST := dist

.PHONY: build-all build-windows build-linux sign-windows clean

build-all: build-windows build-linux

build-windows:
	mkdir -p $(DIST)
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
	  go build -ldflags "$(LDFLAGS)" -o $(DIST)/achilles-agent-windows-amd64.exe .

build-linux:
	mkdir -p $(DIST)
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
	  go build -ldflags "$(LDFLAGS)" -o $(DIST)/achilles-agent-linux-amd64 .

sign-windows: build-windows
	@if [ -f "$$HOME/.projectachilles/certs/cert.pfx" ]; then \
	  echo "Signing Windows binary..."; \
	  osslsigncode sign \
	    -pkcs12 "$$HOME/.projectachilles/certs/cert.pfx" \
	    -pass "$$(cat $$HOME/.projectachilles/certs/cert-pass.txt 2>/dev/null)" \
	    -in $(DIST)/achilles-agent-windows-amd64.exe \
	    -out $(DIST)/achilles-agent-windows-amd64-signed.exe && \
	  mv $(DIST)/achilles-agent-windows-amd64-signed.exe \
	     $(DIST)/achilles-agent-windows-amd64.exe; \
	else \
	  echo "No certificate found, skipping signing"; \
	fi

clean:
	rm -rf $(DIST)
```

**Step N: Commit**

```bash
git add agent/Makefile
git commit -m "feat(agent): add cross-compilation Makefile and signing pipeline"
```

---

### Task 26: Integration Testing

**Files:**
- Create: `agent/internal/executor/executor_test.go`
- Create test scenarios as documented below

**Test scenarios:**

1. **Config load/save round-trip** — write config, read back, verify fields
2. **Store persistence** — create store, update state, create new store from same dir, verify state
3. **Executor SHA256 verification** — create temp binary, compute SHA256, verify executor accepts correct hash and rejects wrong hash
4. **Executor timeout** — create a binary that sleeps forever, verify executor kills it and returns exit code 259
5. **Executor stdout/stderr capture** — create binary that writes to both, verify capture

**Backend test scenarios** (manual or scripted):
1. Generate enrollment token via admin API
2. Enroll agent using the token
3. Verify agent appears in agent list
4. Create task for the enrolled agent
5. Simulate agent fetching the task
6. Submit a result
7. Verify ES document was written with correct schema

**Step N: Commit**

```bash
git add agent/internal/executor/executor_test.go
git commit -m "test(agent): add integration tests for executor, config, and store"
```

---

## Summary: Maximum Parallelism Execution Guide

When running this plan with Claude Code subagents:

**Batch 1 (4 parallel agents):**
- Agent A: Task 1 (Backend types)
- Agent B: Task 2 (SQLite database)
- Agent C: Task 3 (Go scaffold)
- Agent D: Task 4 (Frontend types + API)

**Batch 2 (10 parallel agents):**
- Agent A: Task 5 (Agent auth middleware)
- Agent B: Task 6 (Enrollment service)
- Agent C: Task 7 (Heartbeat service)
- Agent D: Task 8 (Task queue service)
- Agent E: Task 9 (Binary serving)
- Agent F: Task 10 (Result ingestion)
- Agent G: Task 11 (Go enrollment)
- Agent H: Task 12 (Go poller)
- Agent I: Task 13 (Go executor)
- Agent J: Task 14 (Go reporter)

**Batch 3 (4 parallel agents):**
- Agent A: Task 15 (Mount routes)
- Agent B: Task 16 (Service wrappers)
- Agent C: Task 17 (Self-update)
- Agent D: Task 18 (Update service)

**Batch 4 (6 parallel agents):**
- Agent A: Task 19 (Redux slice) — must complete before B-E start
- Agent B: Task 20 (Dashboard page) — after 19
- Agent C: Task 21 (Agents page) — after 19
- Agent D: Task 22 (Tasks page) — after 19
- Agent E: Task 23 (Enrollment UI) — after 19
- Agent F: Task 24 (Route cleanup) — after 19-23

**Batch 5 (2 parallel agents):**
- Agent A: Task 25 (Build pipeline)
- Agent B: Task 26 (Integration tests)
