/**
 * TypeScript type definitions for the custom agent management system.
 * Replaces LimaCharlie with a self-hosted agent infrastructure.
 */

// ============================================================================
// AGENT ENTITY
// ============================================================================

export type AgentStatus = 'active' | 'disabled' | 'decommissioned' | 'uninstalled';

export type AgentOS = 'windows' | 'linux' | 'darwin';

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
  rotation_pending?: boolean;
  health_score?: number;
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
  rotation_pending?: boolean;
  health_score?: number;
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
  update_public_key: string;
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

export type ReconnectReason = 'service_restart' | 'network_recovery' | 'machine_reboot' | 'update_restart' | 'unknown';

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
    process_cpu_percent?: number;
    process_memory_mb?: number;
  };
  agent_version: string;
  last_task_completed: string | null;
  reconnect_reason?: ReconnectReason;
  process_start_time?: string;
}

// ============================================================================
// TASKS
// ============================================================================

export type TaskType = 'execute_test' | 'update_agent' | 'uninstall' | 'execute_command';

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
  command?: string;
  env_vars?: Record<string, string>;
}

export interface TaskTestMetadata {
  category: string;
  subcategory: string;
  severity: string;
  techniques: string[];
  tactics: string[];
  threat_actor: string;
  target: string[];
  complexity: string;
  tags: string[];
  score: number | null;
  integrations: string[];
}

export interface TaskNoteEntry {
  content: string;
  editedBy: string;
  editedAt: string;
}

export interface Task {
  id: string;
  agent_id: string;
  agent_hostname: string | null;
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
  target_index: string | null;
  batch_id: string;
  retry_count: number;
  max_retries: number;
  original_task_id: string | null;
}

export interface TaskGroup {
  batch_id: string;
  type: TaskType;
  payload: TaskPayload;
  created_at: string;
  created_by: string | null;
  agent_count: number;
  status_counts: Partial<Record<TaskStatus, number>>;
  tasks: Task[];
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
  bundle_results?: BundleResults;
}

export interface BundleControlResult {
  control_id: string;
  control_name: string;
  validator: string;
  exit_code: number;
  compliant: boolean;
  severity: string;
  category: string;
  subcategory: string;
  techniques: string[];
  tactics: string[];
  expected: string;
  actual: string;
  details: string;
  skipped: boolean;
  error_message: string;
}

export interface BundleResults {
  schema_version: string;
  bundle_id: string;
  bundle_name: string;
  bundle_category: string;
  bundle_subcategory: string;
  execution_id: string;
  started_at: string;
  completed_at: string;
  overall_exit_code: number;
  total_controls: number;
  passed_controls: number;
  failed_controls: number;
  controls: BundleControlResult[];
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
  target_index?: string;
  max_retries?: number;
}

export interface CreateCommandTaskRequest {
  agent_ids: string[];
  command: string;
  execution_timeout?: number;
  priority?: number;
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
  signed: boolean;
  binary_signature: string | null;
  created_at: string;
}

export interface VersionCheckResponse {
  version: string;
  sha256: string;
  size: number;
  mandatory: boolean;
  signature?: string;
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
  search?: string;
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
  target_index: string | null;
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
  target_index?: string;
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
// AGENT EVENTS & HEARTBEAT HISTORY
// ============================================================================

export type AgentEventType =
  | 'enrolled'
  | 'went_offline'
  | 'came_online'
  | 'task_failed'
  | 'task_completed'
  | 'version_updated'
  | 'key_rotated'
  | 'status_changed'
  | 'decommissioned';

export interface AgentEvent {
  id: number;
  agent_id: string;
  event_type: AgentEventType;
  details: Record<string, unknown>;
  created_at: string;
}

export interface HeartbeatHistoryPoint {
  timestamp: string;
  cpu_percent: number | null;
  memory_mb: number | null;
  disk_free_mb: number | null;
  uptime_seconds: number | null;
  process_cpu_percent: number | null;
  process_memory_mb: number | null;
}

export interface FleetHealthMetrics {
  fleet_uptime_percent_30d: number;
  task_success_rate_7d: number;
  mtbf_hours: number | null;
  stale_agent_count: number;
  stale_agent_ids: string[];
  avg_health_score: number;
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
