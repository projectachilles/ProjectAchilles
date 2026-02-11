// Agent module types

export type AgentStatus = 'active' | 'disabled' | 'decommissioned';
export type AgentOS = 'windows' | 'linux';
export type AgentArch = 'amd64' | 'arm64';
export type AgentRuntimeStatus = 'idle' | 'executing' | 'updating' | 'error' | 'offline';
export type TaskStatus = 'pending' | 'assigned' | 'downloading' | 'executing' | 'completed' | 'failed' | 'expired';
export type TaskType = 'execute_test' | 'update_agent' | 'uninstall' | 'execute_command';

export interface HeartbeatData {
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

export interface AgentSummary {
  id: string;
  org_id: string;
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

export interface TaskResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  started_at: string;
  completed_at: string;
  execution_duration_ms: number;
  hostname: string;
}

export interface TaskNoteEntry {
  content: string;
  editedBy: string;
  editedAt: string;
}

export interface AgentTask {
  id: string;
  agent_id: string;
  agent_hostname: string | null;
  type: TaskType;
  priority: number;
  status: TaskStatus;
  payload: {
    test_uuid: string;
    test_name: string;
    binary_name: string;
    execution_timeout: number;
    command?: string;
  };
  result: TaskResult | null;
  notes: string | null;
  notes_history: TaskNoteEntry[];
  created_at: string;
  assigned_at: string | null;
  completed_at: string | null;
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

// Request types

export interface CreateTokenRequest {
  org_id: string;
  ttl_hours?: number;
  max_uses?: number;
}

export interface CreateTasksRequest {
  agent_ids: string[];
  org_id: string;
  test_uuid: string;
  test_name: string;
  binary_name: string;
  execution_timeout?: number;
  arguments?: string[];
  priority?: number;
  metadata: TaskTestMetadata;
  target_index?: string;
}

export interface CreateCommandTasksRequest {
  agent_ids: string[];
  org_id: string;
  command: string;
  execution_timeout?: number;
  priority?: number;
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

// Schedules

export type ScheduleType = 'once' | 'daily' | 'weekly' | 'monthly';
export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'deleted';

export interface ScheduleConfigOnce { date: string; time: string; }
export interface ScheduleConfigDaily { time: string; randomize_time?: boolean; }
export interface ScheduleConfigWeekly { days: number[]; time: string; randomize_time?: boolean; }
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
  target_index?: string | null;
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

export interface AgentVersion {
  version: string;
  os: AgentOS;
  arch: AgentArch;
  binary_sha256: string;
  binary_size: number;
  release_notes: string;
  mandatory: boolean;
  signed?: boolean;
  created_at: string;
}
