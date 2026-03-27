/**
 * Zod schemas for agent-facing endpoints (enrollment, heartbeat, tasks, updates).
 * These validate request bodies from the Go agent binary.
 */

import { z } from 'zod';

// ── Shared enums ─────────────────────────────────────────────────────────────

export const AgentOSSchema = z.enum(['windows', 'linux', 'darwin']);
export const AgentArchSchema = z.enum(['amd64', 'arm64']);
export const TaskStatusSchema = z.enum(['pending', 'assigned', 'downloading', 'executing', 'completed', 'failed', 'expired']);

const ReconnectReasonSchema = z.enum([
  'service_restart', 'network_recovery', 'machine_reboot', 'update_restart',
  'network_adapter_disabled', 'dns_failure', 'server_unreachable', 'network_unreachable',
  'connection_timeout', 'connection_reset', 'tls_error',
  'disk_pressure_crash', 'memory_pressure_crash', 'unknown',
]);

// ── Enrollment ───────────────────────────────────────────────────────────────

export const EnrollRequestSchema = z.object({
  token: z.string().min(1, 'token is required'),
  hostname: z.string().min(1, 'hostname is required'),
  os: AgentOSSchema,
  arch: AgentArchSchema,
  agent_version: z.string().min(1, 'agent_version is required'),
});

export const CreateTokenSchema = z.object({
  org_id: z.string().min(1, 'org_id is required'),
  ttl_hours: z.number().int().min(1).max(720).optional(),
  max_uses: z.number().int().min(1).max(1000).optional(),
  metadata: z.record(z.string()).optional(),
});

// ── Heartbeat ────────────────────────────────────────────────────────────────

const ReconnectContextSchema = z.object({
  reason: ReconnectReasonSchema,
  detail: z.string().optional(),
  first_failure_at: z.string().optional(),
  offline_duration_seconds: z.number(),
  failure_count: z.number().int(),
  network_state: z.string().optional(),
  system_at_failure: z.object({
    disk_free_mb: z.number(),
    memory_mb: z.number(),
    total_memory_mb: z.number(),
    cpu_percent: z.number(),
  }).optional(),
  process_start_time: z.string().optional(),
}).strict();

export const HeartbeatSchema = z.object({
  timestamp: z.string().min(1, 'timestamp is required'),
  status: z.enum(['idle', 'executing', 'updating', 'error', 'offline']),
  current_task: z.string().nullable(),
  system: z.object({
    hostname: z.string(),
    os: AgentOSSchema,
    arch: AgentArchSchema,
    uptime_seconds: z.number(),
    cpu_percent: z.number(),
    memory_mb: z.number(),
    disk_free_mb: z.number(),
    total_memory_mb: z.number().optional(),
    process_cpu_percent: z.number().optional(),
    process_memory_mb: z.number().optional(),
  }),
  agent_version: z.string(),
  last_task_completed: z.string().nullable(),
  reconnect_reason: ReconnectReasonSchema.optional(),
  process_start_time: z.string().optional(),
  reconnect_context: ReconnectContextSchema.optional(),
});

// ── Task status update (agent → backend) ─────────────────────────────────────

export const UpdateTaskStatusSchema = z.object({
  status: TaskStatusSchema,
  error: z.string().optional(),
});

// ── Task result submission (agent → backend) ─────────────────────────────────

const BundleControlResultSchema = z.object({
  control_id: z.string(),
  control_name: z.string(),
  validator: z.string(),
  exit_code: z.number().int(),
  compliant: z.boolean(),
  severity: z.string(),
  category: z.string(),
  subcategory: z.string(),
  techniques: z.array(z.string()),
  tactics: z.array(z.string()),
  expected: z.string(),
  actual: z.string(),
  details: z.string(),
  skipped: z.boolean(),
  error_message: z.string(),
});

const BundleResultsSchema = z.object({
  schema_version: z.string(),
  bundle_id: z.string(),
  bundle_name: z.string(),
  bundle_category: z.string(),
  bundle_subcategory: z.string(),
  execution_id: z.string(),
  started_at: z.string(),
  completed_at: z.string(),
  overall_exit_code: z.number().int(),
  total_controls: z.number().int(),
  passed_controls: z.number().int(),
  failed_controls: z.number().int(),
  controls: z.array(BundleControlResultSchema),
});

export const TaskResultSchema = z.object({
  task_id: z.string(),
  test_uuid: z.string(),
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  started_at: z.string(),
  completed_at: z.string(),
  execution_duration_ms: z.number(),
  binary_sha256: z.string(),
  hostname: z.string(),
  os: AgentOSSchema,
  arch: AgentArchSchema,
  error: z.string().optional(),
  bundle_results: BundleResultsSchema.optional(),
});
