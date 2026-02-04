/**
 * TypeScript type definitions for the custom agent management system.
 * Replaces LimaCharlie with a self-hosted agent infrastructure.
 */

// ============================================================================
// AGENT ENTITY
// ============================================================================

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
  last_heartbeat: string;
  last_heartbeat_data: HeartbeatPayload | null;
  enrolled_at: string;
  enrolled_by: string;
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
  last_heartbeat: string;
  tags: string[];
  is_online: boolean;
}

// ============================================================================
// ENROLLMENT
// ============================================================================

export interface EnrollmentToken {
  id: string;
  org_id: string;
  token: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
  metadata: Record<string, string>;
  created_at: string;
  created_by: string;
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
  metadata?: Record<string, string>;
}

export interface CreateTokenResponse {
  token: string;
  id: string;
  expires_at: string;
  max_uses: number;
}

// ============================================================================
// HEARTBEAT
// ============================================================================

export interface HeartbeatPayload {
  timestamp: string;
  status: AgentRuntimeStatus;
  current_task: string | null;
  system: {
    hostname: string;
    os: AgentOS;
    arch: AgentArch;
    uptime_seconds: number;
    cpu_percent: number;
    memory_mb: number;
    disk_free_mb: number;
  };
  agent_version: string;
  last_task_completed: string | null;
}

// ============================================================================
// TASKS
// ============================================================================

export type TaskType = 'execute_test' | 'update_agent' | 'uninstall';

export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'downloading'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'expired';

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
  subcategory: string;
  severity: string;
  techniques: string[];
  tactics: string[];
  threat_actor: string;
  target: string;
  complexity: string;
  tags: string[];
  score: number | null;
}

export interface TaskNoteEntry {
  content: string;
  editedBy: string;
  editedAt: string;
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
  notes: string | null;
  notes_history: TaskNoteEntry[];
  created_at: string;
  assigned_at: string | null;
  completed_at: string | null;
  ttl: number;
  created_by: string;
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
  os: AgentOS;
  arch: AgentArch;
}

export interface CreateTaskRequest {
  agent_ids: string[];
  test_uuid: string;
  test_name: string;
  binary_name: string;
  execution_timeout?: number;
  arguments?: string[];
  priority?: number;
  metadata?: TaskTestMetadata;
}

// ============================================================================
// AGENT UPDATES
// ============================================================================

export interface AgentVersion {
  version: string;
  os: AgentOS;
  arch: AgentArch;
  binary_path: string;
  binary_sha256: string;
  binary_size: number;
  release_notes: string;
  mandatory: boolean;
  created_at: string;
}

export interface VersionCheckResponse {
  version: string;
  sha256: string;
  size: number;
  mandatory: boolean;
}

// ============================================================================
// LIST / FILTER
// ============================================================================

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

// ============================================================================
// SCHEDULES
// ============================================================================

export type ScheduleType = 'once' | 'daily' | 'weekly' | 'monthly';
export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'deleted';

export interface ScheduleConfigOnce { date: string; time: string; }
export interface ScheduleConfigDaily { time: string; randomize_time?: boolean; }
export interface ScheduleConfigWeekly { days: number[]; time: string; randomize_time?: boolean; }   // 0=Sun..6=Sat
export interface ScheduleConfigMonthly { dayOfMonth: number; time: string; randomize_time?: boolean; }
export type ScheduleConfig =
  | ScheduleConfigOnce
  | ScheduleConfigDaily
  | ScheduleConfigWeekly
  | ScheduleConfigMonthly;

export interface Schedule {
  id: string;
  name: string | null;
  agent_ids: string[];
  org_id: string;
  test_uuid: string;
  test_name: string;
  binary_name: string;
  execution_timeout: number;
  priority: number;
  metadata: TaskTestMetadata;
  schedule_type: ScheduleType;
  schedule_config: ScheduleConfig;
  timezone: string;
  next_run_at: string | null;
  last_run_at: string | null;
  status: ScheduleStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateScheduleRequest {
  name?: string;
  agent_ids: string[];
  org_id: string;
  test_uuid: string;
  test_name: string;
  binary_name: string;
  execution_timeout?: number;
  priority?: number;
  metadata?: TaskTestMetadata;
  schedule_type: ScheduleType;
  schedule_config: ScheduleConfig;
  timezone?: string;
}

export interface UpdateScheduleRequest {
  name?: string;
  agent_ids?: string[];
  schedule_config?: ScheduleConfig;
  timezone?: string;
  status?: 'active' | 'paused';
  priority?: number;
  execution_timeout?: number;
}

// ============================================================================
// EXPRESS AUGMENTATION
// ============================================================================

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
