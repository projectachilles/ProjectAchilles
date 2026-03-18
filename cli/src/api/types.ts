/**
 * API type definitions mirrored from backend/src/types/agent.ts and backend/src/types/roles.ts.
 * These are the wire types used by the CLI — kept in sync with the backend manually.
 */

// ─── Agent ──────────────────────────────────────────────────────────────────

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
  is_stale?: boolean;
  rotation_pending?: boolean;
}

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

export interface HeartbeatHistoryPoint {
  timestamp: string;
  cpu_percent: number | null;
  memory_mb: number | null;
  disk_free_mb: number | null;
  uptime_seconds: number | null;
}

export interface AgentEvent {
  id: number;
  agent_id: string;
  event_type: AgentEventType;
  details: Record<string, unknown>;
  created_at: string;
}

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

export interface FleetHealthMetrics {
  fleet_uptime_percent_30d: number;
  task_success_rate_7d: number;
  mtbf_hours: number | null;
  stale_agent_count: number;
  stale_agent_ids: string[];
}

// ─── Enrollment ─────────────────────────────────────────────────────────────

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

export interface CreateTokenRequest {
  org_id: string;
  ttl_hours?: number;
  max_uses?: number;
  metadata?: Record<string, string>;
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

export type TaskType = 'execute_test' | 'update_agent' | 'uninstall' | 'execute_command';
export type TaskStatus = 'pending' | 'assigned' | 'downloading' | 'executing' | 'completed' | 'failed' | 'expired';

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

// ─── Schedules ──────────────────────────────────────────────────────────────

export type ScheduleType = 'once' | 'daily' | 'weekly' | 'monthly';
export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'deleted';

export interface ScheduleConfigOnce { date: string; time: string; }
export interface ScheduleConfigDaily { time: string; randomize_time?: boolean; }
export interface ScheduleConfigWeekly { days: number[]; time: string; randomize_time?: boolean; }
export interface ScheduleConfigMonthly { dayOfMonth: number; time: string; randomize_time?: boolean; }
export type ScheduleConfig = ScheduleConfigOnce | ScheduleConfigDaily | ScheduleConfigWeekly | ScheduleConfigMonthly;

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

// ─── Agent Versions ─────────────────────────────────────────────────────────

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

// ─── Browser (Test Library) ─────────────────────────────────────────────────

export interface TestEntry {
  uuid: string;
  name: string;
  category: string;
  subcategory: string;
  severity: string;
  techniques: string[];
  tactics: string[];
  threat_actor: string;
  target: string[];
  complexity: string;
  tags: string[];
  binary_name: string;
  description: string;
  hasReferences: boolean;
  source: string;
}

export interface TestFile {
  name: string;
  type: string;
  size: number;
  category: string;
}

export interface TestDetails extends TestEntry {
  files: TestFile[];
}

export interface SyncStatus {
  status: 'idle' | 'syncing' | 'error';
  last_sync?: string;
  error?: string;
}

// ─── Analytics ──────────────────────────────────────────────────────────────

export interface DefenseScore {
  score: number;
  protectedCount: number;
  unprotectedCount: number;
  totalExecutions: number;
}

export interface ScoreTrendPoint {
  timestamp: string;
  score: number;
  total: number;
  protected: number;
}

export interface ScoreByTest {
  testUuid: string;
  testName: string;
  score: number;
  protectedCount: number;
  unprotectedCount: number;
}

export interface ScoreByTechnique {
  technique: string;
  score: number;
  protectedCount: number;
  unprotectedCount: number;
}

export interface ScoreByHostname {
  hostname: string;
  score: number;
  protected: number;
  unprotected: number;
  total: number;
}

export interface Execution {
  timestamp: string;
  testUuid: string;
  testName: string;
  hostname: string;
  outcome: 'protected' | 'unprotected' | 'error';
  error?: string;
}

export interface PaginatedExecutions {
  data: Execution[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ErrorRate {
  errorRate: number;
  errorCount: number;
  conclusiveCount: number;
  totalTestActivity: number;
}

export interface AnalyticsSettings {
  configured: boolean;
  connectionType?: string;
  indexPattern?: string;
  node?: string;
}

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

// ─── Defender ───────────────────────────────────────────────────────────────

export interface SecureScore {
  score: number;
  categories: Array<{ name: string; score: number; maxScore: number }>;
  lastUpdated: string;
}

export interface DefenderAlert {
  id: string;
  title: string;
  severity: string;
  status: string;
  category: string;
  createdDateTime: string;
  techniques: string[];
}

export interface DefenderControl {
  id: string;
  title: string;
  category: string;
  maxScore: number;
  currentScore: number;
  deprecated: boolean;
}

// ─── Builds ─────────────────────────────────────────────────────────────────

export interface BuildInfo {
  uuid: string;
  name: string;
  platform: string;
  signed: boolean;
  size: number;
  sha256: string;
  created_at: string;
}

export interface EmbedDependency {
  name: string;
  required: boolean;
  present: boolean;
  sourceBuilt: boolean;
  size?: number;
}

// ─── Certificates ───────────────────────────────────────────────────────────

export interface CertInfo {
  id: string;
  label: string;
  commonName: string;
  organization: string;
  country: string;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  created_at: string;
}

// ─── Integrations ───────────────────────────────────────────────────────────

export interface IntegrationConfig {
  configured: boolean;
  tenant_id?: string;
  client_id?: string;
  client_secret_set?: boolean;
  label?: string;
  env_configured?: boolean;
}

export interface AlertConfig {
  configured: boolean;
  thresholds?: {
    score_drop_percent?: number;
    score_floor?: number;
  };
  cooldown_minutes?: number;
  last_alert_at?: string;
  slack?: { webhook_url?: string; channel?: string };
  email?: { smtp_host?: string; from?: string; to?: string[] };
}

// ─── Risk Acceptance ────────────────────────────────────────────────────────

export interface RiskAcceptance {
  id: string;
  test_name: string;
  control_id?: string;
  hostname?: string;
  justification: string;
  status: 'active' | 'revoked';
  created_by: string;
  created_at: string;
  revoked_by?: string;
  revoked_at?: string;
  revoke_reason?: string;
}

// ─── Users ──────────────────────────────────────────────────────────────────

export type AppRole = 'admin' | 'operator' | 'analyst' | 'explorer';

export interface User {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  imageUrl: string;
  role: AppRole | null;
  lastActiveAt: string | null;
  createdAt: string;
}

export interface Invitation {
  id: string;
  emailAddress: string;
  role: AppRole;
  status: string;
  createdAt: string;
}

// ─── Generic API Response Envelopes ─────────────────────────────────────────

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
}

// ─── Status / Health ────────────────────────────────────────────────────────

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  version?: string;
  uptime?: number;
  capabilities?: Record<string, boolean>;
}

// ─── Agent Metrics ──────────────────────────────────────────────────────────

export interface AgentMetrics {
  total: number;
  online: number;
  offline: number;
  stale: number;
  disabled: number;
  decommissioned: number;
  by_os: Record<AgentOS, number>;
  by_version: Record<string, number>;
}
