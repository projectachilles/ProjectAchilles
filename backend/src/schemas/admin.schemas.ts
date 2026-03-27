/**
 * Zod schemas for admin endpoints (tasks, schedules, versions, agents).
 * These validate request bodies from Clerk-authenticated frontend calls.
 */

import { z } from 'zod';
import { AgentOSSchema, AgentArchSchema } from './agent.schemas.js';

// ── Task metadata (shared) ───────────────────────────────────────────────────

const TaskTestMetadataSchema = z.object({
  category: z.string(),
  subcategory: z.string(),
  severity: z.string(),
  techniques: z.array(z.string()),
  tactics: z.array(z.string()),
  threat_actor: z.string(),
  target: z.array(z.string()),
  complexity: z.string(),
  tags: z.array(z.string()),
  score: z.number().nullable(),
  integrations: z.array(z.string()),
}).optional();

// ── Create tasks (execute_test) ──────────────────────────────────────────────

export const CreateTaskSchema = z.object({
  org_id: z.string().min(1, 'org_id is required'),
  agent_ids: z.array(z.string()).min(1, 'At least one agent_id is required'),
  test_uuid: z.string().min(1),
  test_name: z.string().min(1),
  binary_name: z.string().min(1),
  execution_timeout: z.number().int().positive().optional(),
  arguments: z.array(z.string()).optional(),
  priority: z.number().int().min(0).max(10).optional(),
  metadata: TaskTestMetadataSchema,
  target_index: z.string().optional(),
  max_retries: z.number().int().min(0).max(5).optional(),
});

// ── Create command tasks ─────────────────────────────────────────────────────

export const CreateCommandTaskSchema = z.object({
  org_id: z.string().min(1, 'org_id is required'),
  agent_ids: z.array(z.string()).min(1, 'At least one agent_id is required'),
  command: z.string().min(1, 'command is required'),
  execution_timeout: z.number().int().positive().optional(),
  priority: z.number().int().min(0).max(10).optional(),
});

// ── Create update tasks ──────────────────────────────────────────────────────

export const CreateUpdateTaskSchema = z.object({
  org_id: z.string().min(1, 'org_id is required'),
  agent_ids: z.array(z.string()).min(1, 'At least one agent_id is required'),
});

// ── Create uninstall tasks ───────────────────────────────────────────────────

export const CreateUninstallTaskSchema = z.object({
  org_id: z.string().min(1, 'org_id is required'),
  agent_ids: z.array(z.string()).min(1, 'At least one agent_id is required'),
  cleanup: z.boolean().optional(),
});

// ── Task notes ───────────────────────────────────────────────────────────────

export const UpdateTaskNotesSchema = z.object({
  content: z.string(),
});

// ── Agent update (admin PATCH) ───────────────────────────────────────────────

export const UpdateAgentSchema = z.object({
  status: z.enum(['active', 'disabled']).optional(),
  tags: z.array(z.string()).optional(),
});

// ── Agent tag ────────────────────────────────────────────────────────────────

export const AddTagSchema = z.object({
  tag: z.string().min(1, 'Tag is required'),
});

// ── Auto-rotation settings ───────────────────────────────────────────────────

export const AutoRotationSchema = z.object({
  enabled: z.boolean(),
  intervalDays: z.number().int().min(30).max(365),
});

// ── Schedule types ───────────────────────────────────────────────────────────

const ScheduleTypeSchema = z.enum(['once', 'daily', 'weekly', 'monthly']);

const ScheduleConfigSchema = z.union([
  z.object({ date: z.string(), time: z.string() }),
  z.object({ time: z.string(), randomize_time: z.boolean().optional() }),
  z.object({ days: z.array(z.number().int().min(0).max(6)), time: z.string(), randomize_time: z.boolean().optional() }),
  z.object({ dayOfMonth: z.number().int().min(1).max(31), time: z.string(), randomize_time: z.boolean().optional() }),
]);

export const CreateScheduleSchema = z.object({
  name: z.string().optional(),
  agent_ids: z.array(z.string()).min(1),
  org_id: z.string().min(1, 'org_id is required'),
  test_uuid: z.string().min(1),
  test_name: z.string().min(1),
  binary_name: z.string().min(1),
  execution_timeout: z.number().int().positive().optional(),
  priority: z.number().int().min(0).max(10).optional(),
  metadata: TaskTestMetadataSchema,
  schedule_type: ScheduleTypeSchema,
  schedule_config: ScheduleConfigSchema,
  timezone: z.string().optional(),
  target_index: z.string().optional(),
});

export const UpdateScheduleSchema = z.object({
  name: z.string().optional(),
  agent_ids: z.array(z.string()).optional(),
  schedule_config: ScheduleConfigSchema.optional(),
  timezone: z.string().optional(),
  status: z.enum(['active', 'paused']).optional(),
  priority: z.number().int().min(0).max(10).optional(),
  execution_timeout: z.number().int().positive().optional(),
});

// ── Agent versions ───────────────────────────────────────────────────────────

export const RegisterVersionSchema = z.object({
  version: z.string().min(1, 'version is required'),
  os: AgentOSSchema,
  arch: AgentArchSchema,
  binary_path: z.string().min(1, 'binary_path is required'),
  release_notes: z.string().optional(),
  mandatory: z.boolean().optional(),
});

export const BuildVersionSchema = z.object({
  version: z.string().min(1, 'version is required'),
  os: AgentOSSchema,
  arch: AgentArchSchema,
});
