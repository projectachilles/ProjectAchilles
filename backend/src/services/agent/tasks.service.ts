import crypto from 'crypto';
import { getDatabase } from './database.js';
import { AppError } from '../../middleware/error.middleware.js';
import type {
  Task,
  TaskGroup,
  TaskPayload,
  TaskResult,
  TaskStatus,
  TaskType,
  TaskTestMetadata,
  TaskNoteEntry,
  CreateTaskRequest,
  CreateTaskOptions,
  CreateCommandTaskRequest,
  ListTasksRequest,
} from '../../types/agent.js';
import { withCatalogMetadata } from './testMetadata.js';
import { readBuildMeta, resolveTestArtifact } from './testArtifacts.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';
import { recordEvent } from './events.service.js';
import { getNoticeSummaries } from '../notices/notices.repo.js';
import type { NoticeScope } from '../notices/types.js';
import { AGENT_KILL_WATCHDOG_ERRORS, parseSqliteUtc } from '../edr/agent-kill-evidence.js';
import type { EdrTermination } from '../edr/agent-kill-evidence.js';

// ============================================================================
// HELPERS
// ============================================================================

interface TaskRow {
  id: string;
  agent_id: string;
  agent_hostname?: string | null;
  org_id: string;
  type: string;
  priority: number;
  status: string;
  payload: string;
  result: string | null;
  notes: string | null;
  notes_history: string;
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
  es_ingested: number;
  ingest_attempts: number;
  last_ingest_attempt_at: string | null;
  notice_id?: string | null;
  campaign_run_id?: string | null;
}

function parseTaskRow(row: TaskRow): Task {
  return {
    ...row,
    agent_hostname: row.agent_hostname ?? null,
    payload: JSON.parse(row.payload) as TaskPayload,
    result: row.result ? (JSON.parse(row.result) as TaskResult) : null,
    notes_history: row.notes_history ? (JSON.parse(row.notes_history) as TaskNoteEntry[]) : [],
  } as Task;
}

/**
 * Valid state transitions for task status.
 * Each key maps to the set of statuses it can transition to.
 */
const VALID_TRANSITIONS: Record<string, TaskStatus[]> = {
  pending: ['assigned', 'expired'],
  assigned: ['downloading', 'executing', 'failed', 'expired'],
  downloading: ['executing', 'failed', 'expired'],
  executing: ['completed', 'failed'],
};

/**
 * Signals an idempotent rejection: the task is already in a terminal state
 * (completed/failed/expired) when the agent submitted a result or status
 * update. The server's outcome is authoritative; the agent's request is
 * stale and should be acknowledged with a 2xx response so the agent's
 * local result queue stops retrying.
 *
 * Routes catch this and return 200 with header `F0-Task-State: terminal-idempotent`.
 * Distinct from AppError so the global error middleware doesn't log it as 4xx noise.
 */
export class TerminalStateRejection extends Error {
  constructor(public readonly task: Task) {
    super(`Task ${task.id} is already in terminal state: ${task.status}`);
    this.name = 'TerminalStateRejection';
  }
}

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['completed', 'failed', 'expired']);

/**
 * Resolve integration environment variables for cloud-targeted tests.
 * Currently supports Azure/Entra ID via the identity-tenant subcategory.
 */
function resolveIntegrationEnvVars(metadata: TaskTestMetadata): Record<string, string> | undefined {
  const needsAzure = metadata.integrations?.includes('azure')
    || metadata.subcategory === 'identity-tenant';  // backward compat

  if (needsAzure) {
    const service = new IntegrationsSettingsService();
    const creds = service.getAzureCredentials();
    if (!creds) return undefined;
    if (creds.authMethod === 'certificate') {
      return {
        AZURE_TENANT_ID: creds.tenant_id,
        AZURE_CLIENT_ID: creds.client_id,
        AZURE_CERT_THUMBPRINT: creds.cert_thumbprint,
        AZURE_PRIVATE_KEY_PEM: creds.private_key_pem,
      };
    }
    return {
      AZURE_TENANT_ID: creds.tenant_id,
      AZURE_CLIENT_ID: creds.client_id,
      AZURE_CLIENT_SECRET: creds.client_secret,
    };
  }
  return undefined;
}

/**
 * Strip env_vars from a parsed task before returning to admin endpoints.
 * Prevents credential leakage through the admin API even if strip-after-dispatch
 * hasn't run yet (e.g. the agent hasn't fetched the task).
 */
export function sanitizeTaskForAdmin(task: Task): Task {
  if (task.payload.env_vars) {
    return {
      ...task,
      payload: { ...task.payload, env_vars: undefined },
    };
  }
  return task;
}

// ============================================================================
// EXPIRE THROTTLE
// ============================================================================

let lastExpireRun = 0;
const EXPIRE_THROTTLE_MS = 60_000;

/** Reset the expire throttle (for tests). */
export function resetExpireThrottle(): void {
  lastExpireRun = 0;
}

// ============================================================================
// SERVICE METHODS
// ============================================================================

/**
 * Create tasks for one or more agents. Looks up binary info from the build
 * directory and inserts a task row per agent.
 */
export function createTasks(
  request: CreateTaskRequest,
  orgId: string,
  createdBy: string,
  options: CreateTaskOptions = {},
): string[] {
  const db = getDatabase();
  const noticeId = options.noticeId ?? null;
  const campaignRunId = options.campaignRunId ?? null;

  const {
    agent_ids,
    test_uuid,
    test_name,
    binary_name,
    execution_timeout = 300,
    arguments: args = [],
    priority = 1,
    metadata,
    target_index,
    max_retries = 2,
  } = request;

  if (!agent_ids || agent_ids.length === 0) {
    throw new AppError('At least one agent_id is required', 400);
  }

  if (!test_uuid || !test_name || !binary_name) {
    throw new AppError('test_uuid, test_name, and binary_name are required', 400);
  }

  // Build metadata must exist (404 otherwise); per-OS artifact resolution is
  // shared with campaign preflight in testArtifacts.ts.
  const buildMeta = readBuildMeta(test_uuid);

  if (!buildMeta) {
    throw new AppError(`Build metadata not found for test ${test_uuid}`, 404);
  }

  // Resolve the test binary PER AGENT OS (see resolveTestArtifact). Shipping one
  // binary to every agent regardless of OS caused Windows agents to receive the
  // Linux orchestrator. Results are memoized per OS so each file is read once.
  const artifactCache = new Map<string, { name: string; sha256: string; size: number }>();

  function resolveArtifactForOs(agentOs: string): { name: string; sha256: string; size: number } {
    const cached = artifactCache.get(agentOs);
    if (cached) return cached;
    const res = resolveTestArtifact(test_uuid, agentOs, { fallbackFilename: binary_name, meta: buildMeta });
    if (!res.ok) {
      if (res.reason === 'binary missing on server') {
        throw new AppError(`Binary file not found: ${res.filename}`, 404);
      }
      const built = res.built && res.built.length > 0 ? res.built.join(', ') : 'none';
      throw new AppError(
        `No binary was built for OS '${agentOs}' (test ${test_uuid}; built for: ${built})`,
        422,
      );
    }
    const artifact = { name: res.binaryName, sha256: res.sha256, size: res.size };
    artifactCache.set(agentOs, artifact);
    return artifact;
  }

  // Look up each targeted agent's OS up front (single query).
  const osPlaceholders = agent_ids.map(() => '?').join(', ');
  const agentOsRows = db
    .prepare(`SELECT id, os FROM agents WHERE id IN (${osPlaceholders})`)
    .all(...agent_ids) as Array<{ id: string; os: string }>;
  const osByAgentId = new Map(agentOsRows.map((r) => [r.id, r.os]));
  // Fallback OS for an agent not found in the table (e.g. FK will reject the
  // insert anyway): prefer the build's primary platform, else legacy behavior.
  const fallbackOs: string = buildMeta.platform?.os ?? 'linux';

  // Build payload with metadata enrichment from test catalog
  const enrichedMetadata = withCatalogMetadata(test_uuid, metadata);

  // Integration credentials (env_vars) are per-test, not per-agent — compute once.
  const envVars = resolveIntegrationEnvVars(enrichedMetadata);

  // Build each agent's payload with the artifact for that agent's OS. Resolution
  // happens eagerly (before the transaction) so an unbuilt OS fails the whole
  // batch cleanly instead of leaving a partial dispatch.
  const payloadByAgentId = new Map<string, string>();
  for (const agentId of agent_ids) {
    const agentOs = osByAgentId.get(agentId) ?? fallbackOs;
    const artifact = resolveArtifactForOs(agentOs);
    const payload: TaskPayload = {
      test_uuid,
      test_name,
      binary_name: artifact.name,
      binary_sha256: artifact.sha256,
      binary_size: artifact.size,
      execution_timeout,
      arguments: args,
      metadata: enrichedMetadata,
    };
    if (envVars) {
      payload.env_vars = envVars;
    }
    payloadByAgentId.set(agentId, JSON.stringify(payload));
  }

  // Insert tasks inside a transaction
  const batchId = crypto.randomUUID();
  const insertStmt = db.prepare(`
    INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_at, ttl, created_by, target_index, batch_id, max_retries, notice_id, campaign_run_id)
    VALUES (?, ?, ?, 'execute_test', ?, 'pending', ?, datetime('now'), 604800, ?, ?, ?, ?, ?, ?)
  `);

  const taskIds: string[] = [];

  const insertAll = db.transaction(() => {
    for (const agentId of agent_ids) {
      const taskId = crypto.randomUUID();
      insertStmt.run(taskId, agentId, orgId, priority, payloadByAgentId.get(agentId)!, createdBy, target_index ?? null, batchId, max_retries, noticeId, campaignRunId);
      taskIds.push(taskId);
    }
  });

  insertAll();

  return taskIds;
}

/**
 * Create the tasks for several test requests as one unit (one "Run" of
 * several tests). All-or-nothing: if any request throws, nothing is written.
 * Returns each request's task ids, in request order.
 */
export function createTasksBatch(
  requests: CreateTaskRequest[],
  orgId: string,
  createdBy: string,
  options: CreateTaskOptions = {},
): string[][] {
  const db = getDatabase();
  return db.transaction(() => requests.map((r) => createTasks(r, orgId, createdBy, options)))();
}

/**
 * Create command tasks for one or more agents. Unlike createTasks, this
 * does not look up a binary — it stores a shell command in the payload.
 */
export function createCommandTasks(
  request: CreateCommandTaskRequest,
  orgId: string,
  createdBy: string
): string[] {
  const db = getDatabase();

  const {
    agent_ids,
    command,
    execution_timeout = 300,
    priority = 1,
  } = request;

  if (!agent_ids || agent_ids.length === 0) {
    throw new AppError('At least one agent_id is required', 400);
  }

  if (!command || typeof command !== 'string' || command.trim().length === 0) {
    throw new AppError('command is required and must be a non-empty string', 400);
  }

  if (command.length > 10240) {
    throw new AppError('command exceeds maximum length (10 KB)', 400);
  }

  const payload: TaskPayload = {
    test_uuid: '',
    test_name: '',
    binary_name: '',
    binary_sha256: '',
    binary_size: 0,
    execution_timeout,
    arguments: [],
    metadata: {
      category: '',
      subcategory: '',
      severity: '',
      techniques: [],
      tactics: [],
      threat_actor: '',
      target: [],
      complexity: '',
      tags: [],
      score: null,
      integrations: [],
    },
    command,
  };

  const payloadJson = JSON.stringify(payload);

  const batchId = crypto.randomUUID();
  const insertStmt = db.prepare(`
    INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_at, ttl, created_by, batch_id)
    VALUES (?, ?, ?, 'execute_command', ?, 'pending', ?, datetime('now'), 604800, ?, ?)
  `);

  const taskIds: string[] = [];

  const insertAll = db.transaction(() => {
    for (const agentId of agent_ids) {
      const taskId = crypto.randomUUID();
      insertStmt.run(taskId, agentId, orgId, priority, payloadJson, createdBy, batchId);
      taskIds.push(taskId);
    }
  });

  insertAll();

  return taskIds;
}

/**
 * Create update_agent tasks for one or more agents. Unlike createTasks, this
 * does not look up a binary — it signals the agent to check for updates.
 */
export function createUpdateTasks(
  agentIds: string[],
  orgId: string,
  createdBy: string
): string[] {
  const db = getDatabase();

  if (!agentIds || agentIds.length === 0) {
    throw new AppError('At least one agent_id is required', 400);
  }

  const payload: TaskPayload = {
    test_uuid: '',
    test_name: '',
    binary_name: '',
    binary_sha256: '',
    binary_size: 0,
    execution_timeout: 600,
    arguments: [],
    metadata: {
      category: '',
      subcategory: '',
      severity: '',
      techniques: [],
      tactics: [],
      threat_actor: '',
      target: [],
      complexity: '',
      tags: [],
      score: null,
      integrations: [],
    },
  };

  const payloadJson = JSON.stringify(payload);
  const batchId = crypto.randomUUID();

  const insertStmt = db.prepare(`
    INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_at, ttl, created_by, batch_id)
    VALUES (?, ?, ?, 'update_agent', 10, 'pending', ?, datetime('now'), 604800, ?, ?)
  `);

  // An agent runs one task at a time, and an update task only asks it to check
  // for the latest version, so a second open one can never do anything the
  // first won't. Reuse it: repeated "Update All" clicks otherwise pile up
  // tasks that sit in the queue for the full 7-day TTL.
  const openUpdateStmt = db.prepare(`
    SELECT id FROM tasks
    WHERE agent_id = ? AND type = 'update_agent'
      AND status IN ('pending', 'assigned', 'downloading', 'executing')
    ORDER BY created_at ASC
    LIMIT 1
  `);

  const taskIds: string[] = [];

  const insertAll = db.transaction(() => {
    for (const agentId of agentIds) {
      const open = openUpdateStmt.get(agentId) as { id: string } | undefined;
      if (open) {
        taskIds.push(open.id);
        continue;
      }
      const taskId = crypto.randomUUID();
      insertStmt.run(taskId, agentId, orgId, payloadJson, createdBy, batchId);
      taskIds.push(taskId);
    }
  });

  insertAll();

  return taskIds;
}

/**
 * Create uninstall tasks for one or more agents. Validates that each agent
 * is eligible (not already uninstalled/decommissioned). The cleanup flag
 * controls whether the agent deletes its files after stopping the service.
 */
export function createUninstallTasks(
  agentIds: string[],
  orgId: string,
  createdBy: string,
  cleanup = false
): string[] {
  const db = getDatabase();

  if (!agentIds || agentIds.length === 0) {
    throw new AppError('At least one agent_id is required', 400);
  }

  // Pre-validate: reject agents that are already uninstalled or decommissioned
  const placeholders = agentIds.map(() => '?').join(', ');
  const ineligible = db.prepare(
    `SELECT id, status FROM agents WHERE id IN (${placeholders}) AND status IN ('uninstalled', 'decommissioned')`
  ).all(...agentIds) as { id: string; status: string }[];

  if (ineligible.length > 0) {
    const ids = ineligible.map((a) => `${a.id} (${a.status})`).join(', ');
    throw new AppError(`Agents not eligible for uninstall: ${ids}`, 400);
  }

  const payload: TaskPayload = {
    test_uuid: '',
    test_name: '',
    binary_name: '',
    binary_sha256: '',
    binary_size: 0,
    execution_timeout: 300,
    arguments: [],
    metadata: {
      category: '',
      subcategory: '',
      severity: '',
      techniques: [],
      tactics: [],
      threat_actor: '',
      target: [],
      complexity: '',
      tags: [],
      score: null,
      integrations: [],
    },
    command: cleanup ? 'cleanup' : '',
  };

  const payloadJson = JSON.stringify(payload);
  const batchId = crypto.randomUUID();

  const insertStmt = db.prepare(`
    INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_at, ttl, created_by, batch_id)
    VALUES (?, ?, ?, 'uninstall', 10, 'pending', ?, datetime('now'), 86400, ?, ?)
  `);

  const taskIds: string[] = [];

  const insertAll = db.transaction(() => {
    for (const agentId of agentIds) {
      const taskId = crypto.randomUUID();
      insertStmt.run(taskId, agentId, orgId, payloadJson, createdBy, batchId);
      taskIds.push(taskId);
    }
  });

  insertAll();

  return taskIds;
}

/**
 * Fetch the next pending task for a given agent. Expires old tasks first,
 * then atomically assigns the highest-priority oldest pending task.
 */
export function getNextTask(agentId: string, now: Date = new Date()): Task | null {
  const db = getDatabase();

  // Throttle expire checks to once per 60s — TTL has 7-day granularity,
  // so a 60s delay is invisible. Eliminates ~80 write UPDATEs/minute.
  const nowMs = Date.now();
  if (nowMs - lastExpireRun > EXPIRE_THROTTLE_MS) {
    expireOldTasks();
    expireStaleTasks();
    expireOverdueTasks();
    lastExpireRun = nowMs;
  }

  // Notice hold: ISO strings compared to JS-computed ISO params (never datetime('now')).
  const nowIso = now.toISOString();

  // Find and assign the next task atomically via transaction
  const result = db.transaction(() => {
    const row = db.prepare(`
      SELECT * FROM tasks
      WHERE agent_id = ? AND status = 'pending'
        AND (notice_id IS NULL OR EXISTS (
          SELECT 1 FROM run_notices n WHERE n.id = tasks.notice_id
            AND n.state IN ('sent','overridden')
            AND n.release_at <= ? AND n.pickup_deadline > ?))
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get(agentId, nowIso, nowIso) as TaskRow | undefined;

    if (!row) return null;

    db.prepare(`
      UPDATE tasks SET status = 'assigned', assigned_at = datetime('now')
      WHERE id = ?
    `).run(row.id);

    return { ...row, status: 'assigned', assigned_at: new Date().toISOString() } as TaskRow;
  })();

  if (!result) return null;

  const task = parseTaskRow(result);

  // Strip env_vars from stored payload after dispatching to agent.
  // The agent receives the full payload (with credentials) from the row
  // we just read; after this point, credentials are no longer in the DB.
  if (task.payload.env_vars) {
    const storedPayload = JSON.parse(result.payload) as TaskPayload;
    delete storedPayload.env_vars;
    db.prepare('UPDATE tasks SET payload = ? WHERE id = ?')
      .run(JSON.stringify(storedPayload), result.id);
  }

  return task;
}

/**
 * Update the status of a task. Validates that the agent owns the task and
 * that the state transition is valid.
 */
export function updateTaskStatus(
  taskId: string,
  agentId: string,
  newStatus: TaskStatus,
  errorMsg?: string
): Task {
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;

  if (!row) {
    throw new AppError('Task not found', 404);
  }

  if (row.agent_id !== agentId) {
    throw new AppError('Agent does not own this task', 403);
  }

  // Idempotent path for terminal source states. The agent's reporter PATCHes
  // status='failed' as a final give-up after exhausting result-POST retries;
  // if the server already failed/expired/completed the task, this PATCH is
  // moot. Throwing TerminalStateRejection lets the route return 2xx so the
  // agent stops looping.
  if (TERMINAL_STATUSES.has(row.status as TaskStatus)) {
    throw new TerminalStateRejection(parseTaskRow(row));
  }

  const allowed = VALID_TRANSITIONS[row.status];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new AppError(
      `Invalid state transition: ${row.status} -> ${newStatus}`,
      400
    );
  }

  const updates: string[] = [`status = '${newStatus}'`];

  if (newStatus === 'assigned') {
    updates.push(`assigned_at = datetime('now')`);
  }
  if (newStatus === 'completed' || newStatus === 'failed') {
    updates.push(`completed_at = datetime('now')`);
  }

  if (newStatus === 'failed') {
    console.warn(`[tasks] Task ${taskId} (type=${row.type}) marked failed by agent ${agentId} (was ${row.status})`);
  }

  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(taskId);

  // Store structured error result so the frontend can display the failure reason
  if (newStatus === 'failed' && errorMsg && !row.result) {
    db.prepare('UPDATE tasks SET result = ? WHERE id = ?').run(
      JSON.stringify({
        error: errorMsg,
        exit_code: -1,
        stdout: '',
        stderr: errorMsg,
        execution_duration_ms: 0,
      }),
      taskId
    );
  }

  // Record lifecycle events
  if (newStatus === 'failed') {
    recordEvent(agentId, 'task_failed', { task_id: taskId, task_type: row.type });
  }

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow;
  return parseTaskRow(updated);
}

/**
 * Submit a result for a task, marking it as completed.
 */
export function submitResult(
  taskId: string,
  agentId: string,
  result: TaskResult
): Task {
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;

  if (!row) {
    throw new AppError('Task not found', 404);
  }

  if (row.agent_id !== agentId) {
    throw new AppError('Agent does not own this task', 403);
  }

  // Idempotent path for terminal source states. The server already has a
  // final outcome for this task (e.g. expireStaleTasks marked it failed
  // while the agent's result POST was in flight). Don't overwrite — let
  // the route signal success so the agent's queue.Drain deletes its copy.
  if (TERMINAL_STATUSES.has(row.status as TaskStatus)) {
    throw new TerminalStateRejection(parseTaskRow(row));
  }

  if (row.status !== 'executing' && row.status !== 'downloading') {
    throw new AppError(
      `Cannot submit result for task in status: ${row.status}`,
      400
    );
  }

  db.prepare(`
    UPDATE tasks
    SET result = ?, status = 'completed', completed_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(result), taskId);

  recordEvent(agentId, 'task_completed', { task_id: taskId, task_type: row.type });

  // Post-completion hook: mark agent as uninstalled when an uninstall task completes
  if (row.type === 'uninstall') {
    db.prepare(`UPDATE agents SET status = 'uninstalled', updated_at = datetime('now') WHERE id = ?`).run(row.agent_id);
    console.log(`[tasks] Agent ${row.agent_id} marked as uninstalled (task ${taskId})`);
  }

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow;
  return parseTaskRow(updated);
}

// ────────────────────────────────────────────────────────────────────────
// ES INGESTION TRACKING
// ────────────────────────────────────────────────────────────────────────
//
// Result ingestion is async-with-retry: the route stores the result via
// submitResult() (durable in SQLite), then attempts ES bulk ingestion. On
// failure the task is left at es_ingested=0 and a background worker retries.
//
// This decouples agent task acknowledgment from ES availability — agents
// always see a 200 once their result is durably stored, even if ES is
// briefly unreachable. Eventual consistency is restored by the worker.

/** Cap on retry attempts before a task is left for manual investigation. */
export const MAX_INGEST_ATTEMPTS = 10;

/** Mark a task as successfully ingested into ES. */
export function markTaskIngested(taskId: string): void {
  getDatabase().prepare(`
    UPDATE tasks
    SET es_ingested = 1,
        ingest_attempts = ingest_attempts + 1,
        last_ingest_attempt_at = datetime('now')
    WHERE id = ?
  `).run(taskId);
}

export interface AgentKillCandidateRow {
  task: Task;
  hostname: string | null;
  /** Parsed `result.edr_terminated`; null until the task has been reconciled. */
  termination: EdrTermination | null;
  /**
   * `assigned_at` of the same agent's next task, or null. A restarted agent
   * picks up its next test while the dead one is still `executing`, so that
   * test's alerts can fall inside the dead task's window.
   */
  nextAssignedAt: string | null;
}

/**
 * Watchdog-failed `execute_test` tasks (agent vanished mid-run) completed
 * since `sinceIso`, with the agent hostname. Includes already-reconciled rows.
 * Cyber-hygiene tests are excluded: they score per control, so a whole-test
 * document can't represent them.
 */
export function listAgentKillCandidates(sinceIso: string): AgentKillCandidateRow[] {
  const marks = AGENT_KILL_WATCHDOG_ERRORS.map(() => '?').join(', ');
  // completed_at is stored as SQLite `YYYY-MM-DD HH:MM:SS`; compare in that format.
  const since = new Date(parseSqliteUtc(sinceIso)).toISOString().slice(0, 19).replace('T', ' ');
  const rows = getDatabase().prepare(`
    SELECT t.*, a.hostname AS agent_hostname,
      (SELECT MIN(t2.assigned_at) FROM tasks t2
        WHERE t2.agent_id = t.agent_id AND t2.assigned_at > t.assigned_at) AS next_assigned_at
    FROM tasks t
    LEFT JOIN agents a ON a.id = t.agent_id
    WHERE t.type = 'execute_test'
      AND t.status = 'failed'
      AND json_extract(t.result, '$.error') IN (${marks})
      AND t.completed_at >= ?
      AND t.assigned_at IS NOT NULL
      AND COALESCE(json_extract(t.payload, '$.metadata.category'), '') != 'cyber-hygiene'
  `).all(...AGENT_KILL_WATCHDOG_ERRORS, since) as Array<TaskRow & { next_assigned_at: string | null }>;
  return rows.map((row) => {
    const task = parseTaskRow(row);
    const termination = task.result?.edr_terminated ?? null;
    return { task, hostname: row.agent_hostname ?? null, termination, nextAssignedAt: row.next_assigned_at ?? null };
  });
}

/**
 * Stamp a watchdog-failed task as reconciled: adds `result.edr_terminated` and
 * sets es_ingested = 1. `status` and `exit_code` stay as the watchdog left them.
 */
export function recordEdrTermination(taskId: string, t: EdrTermination): void {
  getDatabase().prepare(`
    UPDATE tasks
    SET result = json_set(COALESCE(result, '{}'), '$.edr_terminated', json(?)),
        es_ingested = 1
    WHERE id = ?
  `).run(JSON.stringify(t), taskId);
}

/**
 * Record a failed ingestion attempt without flipping es_ingested.
 * The task remains a candidate for retry until ingest_attempts hits the cap.
 */
export function markIngestionFailed(taskId: string): void {
  getDatabase().prepare(`
    UPDATE tasks
    SET ingest_attempts = ingest_attempts + 1,
        last_ingest_attempt_at = datetime('now')
    WHERE id = ?
  `).run(taskId);
}

/**
 * Fetch tasks that the retry worker should attempt next:
 *   completed execute_test tasks whose ES ingestion has not yet succeeded
 *   AND whose attempt count is below the permanent-failure cap.
 *
 * Ordered oldest-first so a backlog drains FIFO instead of starving older work.
 */
export function getPendingIngestionTasks(limit = 50): Task[] {
  const rows = getDatabase().prepare(`
    SELECT * FROM tasks
    WHERE status = 'completed'
      AND type = 'execute_test'
      AND es_ingested = 0
      AND ingest_attempts < ?
      AND result IS NOT NULL
    ORDER BY completed_at ASC
    LIMIT ?
  `).all(MAX_INGEST_ATTEMPTS, limit) as TaskRow[];
  return rows.map(parseTaskRow);
}

/** Count tasks that have permanently failed ingestion (ingest_attempts >= cap). */
export function countPermanentlyFailedIngestions(): number {
  const row = getDatabase().prepare(`
    SELECT COUNT(*) as cnt FROM tasks
    WHERE status = 'completed'
      AND type = 'execute_test'
      AND es_ingested = 0
      AND ingest_attempts >= ?
  `).get(MAX_INGEST_ATTEMPTS) as { cnt: number };
  return row.cnt;
}

/**
 * List tasks with optional filters and pagination.
 */
export function listTasks(
  filters: ListTasksRequest
): { tasks: Task[]; total: number } {
  const db = getDatabase();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.agent_id) {
    conditions.push('t.agent_id = ?');
    params.push(filters.agent_id);
  }
  if (filters.org_id) {
    conditions.push('t.org_id = ?');
    params.push(filters.org_id);
  }
  if (filters.status) {
    conditions.push('t.status = ?');
    params.push(filters.status);
  }
  if (filters.type) {
    conditions.push('t.type = ?');
    params.push(filters.type);
  }
  if (filters.search) {
    const searchPattern = `%${filters.search}%`;
    conditions.push(`(
      json_extract(t.payload, '$.test_name') LIKE ?
      OR json_extract(t.payload, '$.command') LIKE ?
      OR a.hostname LIKE ?
    )`);
    params.push(searchPattern, searchPattern, searchPattern);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const countRow = db.prepare(
    `SELECT COUNT(*) as total FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id ${whereClause}`
  ).get(...params) as { total: number };

  const rows = db.prepare(
    `SELECT t.*, a.hostname AS agent_hostname FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id ${whereClause} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as TaskRow[];

  return {
    tasks: rows.map(parseTaskRow),
    total: countRow.total,
  };
}

/**
 * List tasks grouped by batch_id with server-side pagination.
 * A group is included if ANY task within it matches the filter conditions.
 * `noticeScope` limits each group's `notices` map (Ruling R21); it does not
 * filter the task rows.
 */
export function listTasksGrouped(
  filters: ListTasksRequest,
  noticeScope: NoticeScope,
): { groups: TaskGroup[]; total: number; type_counts: Partial<Record<TaskType, number>> } {
  const db = getDatabase();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.agent_id) {
    conditions.push('t.agent_id = ?');
    params.push(filters.agent_id);
  }
  if (filters.org_id) {
    conditions.push('t.org_id = ?');
    params.push(filters.org_id);
  }
  if (filters.status) {
    conditions.push('t.status = ?');
    params.push(filters.status);
  }
  if (filters.search) {
    const searchPattern = `%${filters.search}%`;
    conditions.push(`(
      json_extract(t.payload, '$.test_name') LIKE ?
      OR json_extract(t.payload, '$.command') LIKE ?
      OR a.hostname LIKE ?
    )`);
    params.push(searchPattern, searchPattern, searchPattern);
  }

  // Task counts per type use every filter except the type, so each type pill
  // shows how many tasks it would list.
  const baseWhere = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const baseParams = [...params];
  const countRows = db.prepare(`
    SELECT t.type, COUNT(*) as count FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id
    ${baseWhere}
    GROUP BY t.type
  `).all(...baseParams) as { type: TaskType; count: number }[];
  const type_counts: Partial<Record<TaskType, number>> = {};
  for (const row of countRows) type_counts[row.type] = row.count;

  const types = filters.types?.length ? filters.types : filters.type ? [filters.type] : [];
  if (types.length > 0) {
    conditions.push(`t.type IN (${types.map(() => '?').join(', ')})`);
    params.push(...types);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  // 1. Get paginated batch_ids
  const batchRows = db.prepare(`
    SELECT t.batch_id, MAX(t.created_at) as latest_created
    FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id
    ${whereClause}
    GROUP BY t.batch_id
    ORDER BY latest_created DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as { batch_id: string; latest_created: string }[];

  // 2. Get total group count
  const countRow = db.prepare(`
    SELECT COUNT(*) as total FROM (
      SELECT DISTINCT t.batch_id FROM tasks t
      LEFT JOIN agents a ON t.agent_id = a.id
      ${whereClause}
    )
  `).get(...params) as { total: number };

  if (batchRows.length === 0) {
    return { groups: [], total: countRow.total, type_counts };
  }

  // 3. Fetch full task details for matched batches
  const placeholders = batchRows.map(() => '?').join(', ');
  const batchIds = batchRows.map((r) => r.batch_id);

  const taskRows = db.prepare(`
    SELECT t.*, a.hostname AS agent_hostname
    FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id
    WHERE t.batch_id IN (${placeholders})
    ORDER BY t.batch_id, a.hostname
  `).all(...batchIds) as TaskRow[];

  // Group tasks by batch_id
  const tasksByBatch = new Map<string, Task[]>();
  for (const row of taskRows) {
    const task = parseTaskRow(row);
    const existing = tasksByBatch.get(row.batch_id);
    if (existing) {
      existing.push(task);
    } else {
      tasksByBatch.set(row.batch_id, [task]);
    }
  }

  // Build TaskGroup objects in the order returned by the batch query
  const groups: TaskGroup[] = batchRows.map((batchRow) => {
    const tasks = tasksByBatch.get(batchRow.batch_id) ?? [];
    const first = tasks[0];

    const statusCounts: Partial<Record<TaskStatus, number>> = {};
    for (const t of tasks) {
      statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
    }

    const noticeIds = [...new Set(tasks.map((t) => t.notice_id).filter((id): id is string => !!id))];
    const group: TaskGroup = {
      batch_id: batchRow.batch_id,
      type: first?.type ?? 'execute_test',
      payload: first?.payload ?? ({} as TaskPayload),
      created_at: first?.created_at ?? batchRow.latest_created,
      created_by: first?.created_by ?? null,
      agent_count: tasks.length,
      status_counts: statusCounts,
      tasks,
    };
    if (noticeIds.length > 0) {
      const notices = getNoticeSummaries(noticeIds, noticeScope);
      if (Object.keys(notices).length > 0) group.notices = notices;
    }
    return group;
  });

  return { groups, total: countRow.total, type_counts };
}

/**
 * Get a single task by ID.
 */
export function getTask(taskId: string): Task {
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;

  if (!row) {
    throw new AppError('Task not found', 404);
  }

  return parseTaskRow(row);
}

/**
 * Cancel a task by setting its status to 'expired'.
 */
export function cancelTask(taskId: string): Task {
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;

  if (!row) {
    throw new AppError('Task not found', 404);
  }

  if (row.status === 'completed' || row.status === 'failed' || row.status === 'expired') {
    throw new AppError(`Cannot cancel task in status: ${row.status}`, 400);
  }

  db.prepare(`UPDATE tasks SET status = 'expired' WHERE id = ?`).run(taskId);

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow;
  return parseTaskRow(updated);
}

/**
 * Manually retry a terminal task by cloning it as a new pending task —
 * same shape the automatic retries in expireStaleTasks/expireOverdueTasks
 * create: same agent/payload/batch, retry_count+1, original_task_id chain.
 *
 * Restricted to execute_test: re-dispatching an execute_command task must
 * stay behind the stricter endpoints:tasks:command permission, and
 * update/uninstall tasks have their own creation endpoints. Unlike the
 * automatic retries, a manual retry is NOT gated on max_retries — a human
 * clicking Retry overrides the automatic budget (and since retry_count
 * then exceeds max_retries, the clone won't auto-retry further).
 */
export function retryTask(taskId: string, retriedBy: string, noticeId: string | null = null): Task {
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;

  if (!row) {
    throw new AppError('Task not found', 404);
  }

  if (row.type !== 'execute_test') {
    throw new AppError('Only test execution tasks can be retried', 400);
  }

  if (row.status !== 'completed' && row.status !== 'failed' && row.status !== 'expired') {
    throw new AppError(`Cannot retry task in status: ${row.status}`, 400);
  }

  const retryId = crypto.randomUUID();
  const originalId = row.original_task_id || row.id;

  db.prepare(`
    INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload,
      created_at, ttl, created_by, target_index, batch_id,
      retry_count, max_retries, original_task_id, notes, notes_history, notice_id, campaign_run_id)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, datetime('now'), ?, ?, ?, ?,
      ?, ?, ?, NULL, '[]', ?, ?)
  `).run(
    retryId, row.agent_id, row.org_id, row.type,
    row.priority, row.payload, row.ttl, retriedBy,
    row.target_index, row.batch_id,
    (row.retry_count ?? 0) + 1, row.max_retries ?? 2, originalId, noticeId, row.campaign_run_id ?? null,
  );

  console.log(`[tasks] Manual retry of task ${taskId} by ${retriedBy} → ${retryId}`);

  const inserted = db.prepare('SELECT * FROM tasks WHERE id = ?').get(retryId) as TaskRow;
  return parseTaskRow(inserted);
}

/**
 * Delete a task in any status. Admin-only action behind Clerk auth.
 */
export function deleteTask(taskId: string): void {
  const db = getDatabase();

  const row = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as { status: string } | undefined;

  if (!row) {
    throw new AppError('Task not found', 404);
  }

  db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
}

/**
 * Expire tasks that have exceeded their TTL.
 */
export function expireOldTasks(): number {
  const db = getDatabase();

  const result = db.prepare(`
    UPDATE tasks
    SET status = 'expired'
    WHERE status IN ('pending', 'assigned')
      AND julianday('now') - julianday(created_at) > ttl / 86400.0
  `).run();

  return result.changes;
}

/**
 * Fail tasks stuck in 'executing' or 'downloading' whose owning agent has
 * been offline for longer than STALE_TASK_THRESHOLD_SECONDS. This prevents
 * tasks from being orphaned forever when an agent crashes or loses network.
 *
 * Retry creation is gated on the agent's CURRENT heartbeat: a retry is
 * created only when the agent has come back online (last_heartbeat fresh
 * within STALE_TASK_THRESHOLD_SECONDS). For an agent that's still offline
 * — e.g. powered off overnight — we skip the retry. Otherwise we'd pile
 * 2× retries onto every silent agent and produce all-failed retry chains
 * that flood the Tasks UI without any chance of succeeding.
 */
const STALE_TASK_THRESHOLD_SECONDS = 360; // 2× heartbeat timeout (180s)

export function expireStaleTasks(): number {
  const db = getDatabase();

  // Select stale tasks (need individual rows for retry logic)
  const staleTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE status IN ('executing', 'downloading')
      AND agent_id IN (
        SELECT id FROM agents
        WHERE last_heartbeat IS NULL
           OR (julianday('now') - julianday(last_heartbeat)) * 86400.0 > ?
      )
  `).all(STALE_TASK_THRESHOLD_SECONDS) as TaskRow[];

  if (staleTasks.length === 0) return 0;

  const failStmt = db.prepare(`
    UPDATE tasks
    SET status = 'failed',
        completed_at = datetime('now'),
        result = json('{"error":"Agent went offline during execution","exit_code":-1,"stdout":"","stderr":"Agent went offline during execution","execution_duration_ms":0}')
    WHERE id = ?
  `);

  const insertRetry = db.prepare(`
    INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload,
      created_at, ttl, created_by, target_index, batch_id,
      retry_count, max_retries, original_task_id, notes, notes_history, notice_id, campaign_run_id)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, datetime('now'), ?, ?, ?, ?,
      ?, ?, ?, NULL, '[]', ?, ?)
  `);

  // Re-fetch the agent's current heartbeat per task to decide whether to
  // create a retry. The staleTasks SELECT already established the agent
  // was offline at that moment; this query asks "has it come back since?"
  const agentHbStmt = db.prepare(`
    SELECT last_heartbeat,
           CASE
             WHEN last_heartbeat IS NULL THEN 0
             WHEN (julianday('now') - julianday(last_heartbeat)) * 86400.0 > ? THEN 0
             ELSE 1
           END AS is_back_online
    FROM agents WHERE id = ?
  `);

  let skipped_offline_retries = 0;

  db.transaction(() => {
    for (const task of staleTasks) {
      failStmt.run(task.id);

      const retryCount = task.retry_count ?? 0;
      const maxRetries = task.max_retries ?? 2;
      const canRetry = retryCount < maxRetries && task.type === 'execute_test';

      const agentHb = agentHbStmt.get(STALE_TASK_THRESHOLD_SECONDS, task.agent_id) as
        { last_heartbeat: string | null; is_back_online: number } | undefined;
      const isAgentBackOnline = !!agentHb && agentHb.is_back_online === 1;

      const willRetry = canRetry && isAgentBackOnline;

      // Record task_failed event with retry context
      recordEvent(task.agent_id, 'task_failed', {
        task_id: task.id,
        task_type: task.type,
        reason: 'agent_offline',
        retry_created: willRetry,
        retry_count: retryCount,
        agent_back_online: isAgentBackOnline,
      });

      if (willRetry) {
        const retryId = crypto.randomUUID();
        const originalId = task.original_task_id || task.id;
        insertRetry.run(
          retryId, task.agent_id, task.org_id, task.type,
          task.priority, task.payload, task.ttl, task.created_by,
          task.target_index, task.batch_id,
          retryCount + 1, maxRetries, originalId, task.notice_id ?? null, task.campaign_run_id ?? null,
        );
        console.log(`[tasks] Created retry ${retryCount + 1}/${maxRetries} for task ${task.id} → ${retryId}`);
      } else if (canRetry) {
        skipped_offline_retries++;
        console.log(`[tasks] Skipping retry for task ${task.id} — agent ${task.agent_id} still offline (last_hb ${agentHb?.last_heartbeat ?? 'never'})`);
      }
    }
  })();

  const skippedNote = skipped_offline_retries > 0
    ? `; ${skipped_offline_retries} retry/retries skipped (agent still offline)`
    : '';
  console.warn(`[tasks] Expired ${staleTasks.length} stale task(s) (agent offline >${STALE_TASK_THRESHOLD_SECONDS}s while executing)${skippedNote}`);
  return staleTasks.length;
}

/**
 * Buffer added to execution_timeout before declaring a task overdue.
 * Accounts for binary download time and result-reporting latency.
 */
const OVERDUE_BUFFER_SECONDS = 120;

/**
 * Fail tasks stuck in 'executing' or 'downloading' longer than their
 * execution_timeout + buffer, even when the agent is still online.
 *
 * This catches the case where the agent-side context.WithTimeout killed the
 * main process but cmd.Wait() hangs because a child process escaped the
 * Windows Job Object. The heartbeat goroutine keeps running, so
 * expireStaleTasks (which checks agent heartbeat) never fires.
 *
 * Uses json_extract to read execution_timeout from the task payload.
 * Falls back to 300s if the field is absent (e.g. update_agent tasks).
 */
export function expireOverdueTasks(): number {
  const db = getDatabase();

  // 'assigned' is included so a task that was handed to an agent but
  // never PATCHed to 'downloading' (e.g. agent crashed between poll and
  // download, or the PATCH failed mid-flight) gets cleaned up. Without
  // this branch the task zombies until TTL (default 7 days). Verified
  // a real zombie of this shape on tpsgl: task df09471f sat 'assigned'
  // for 4+ days while its agent was heartbeating fresh.
  const overdueTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE status IN ('executing', 'downloading', 'assigned')
      AND assigned_at IS NOT NULL
      AND (julianday('now') - julianday(assigned_at)) * 86400.0 >
          COALESCE(json_extract(payload, '$.execution_timeout'), 300) + ?
  `).all(OVERDUE_BUFFER_SECONDS) as TaskRow[];

  if (overdueTasks.length === 0) return 0;

  const failStmt = db.prepare(`
    UPDATE tasks
    SET status = 'failed',
        completed_at = datetime('now'),
        result = json('{"error":"Task exceeded execution timeout","exit_code":-1,"stdout":"","stderr":"Task exceeded maximum allowed execution time. The agent may have a stuck process.","execution_duration_ms":0}')
    WHERE id = ?
  `);

  const insertRetry = db.prepare(`
    INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload,
      created_at, ttl, created_by, target_index, batch_id,
      retry_count, max_retries, original_task_id, notes, notes_history, notice_id, campaign_run_id)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, datetime('now'), ?, ?, ?, ?,
      ?, ?, ?, NULL, '[]', ?, ?)
  `);

  db.transaction(() => {
    for (const task of overdueTasks) {
      failStmt.run(task.id);

      const retryCount = task.retry_count ?? 0;
      const maxRetries = task.max_retries ?? 2;
      const canRetry = retryCount < maxRetries && task.type === 'execute_test';

      recordEvent(task.agent_id, 'task_failed', {
        task_id: task.id,
        task_type: task.type,
        reason: 'execution_timeout_exceeded',
        retry_created: canRetry,
        retry_count: retryCount,
      });

      if (canRetry) {
        const retryId = crypto.randomUUID();
        const originalId = task.original_task_id || task.id;
        insertRetry.run(
          retryId, task.agent_id, task.org_id, task.type,
          task.priority, task.payload, task.ttl, task.created_by,
          task.target_index, task.batch_id,
          retryCount + 1, maxRetries, originalId, task.notice_id ?? null, task.campaign_run_id ?? null,
        );
        console.log(`[tasks] Created retry ${retryCount + 1}/${maxRetries} for overdue task ${task.id} → ${retryId}`);
      }
    }
  })();

  console.warn(`[tasks] Expired ${overdueTasks.length} overdue task(s) (exceeded execution_timeout + ${OVERDUE_BUFFER_SECONDS}s buffer)`);
  return overdueTasks.length;
}

/**
 * Update the notes for a task. Appends a versioned entry to `notes_history`.
 */
export function updateTaskNotes(
  taskId: string,
  content: string,
  editedBy: string
): Task {
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;

  if (!row) {
    throw new AppError('Task not found', 404);
  }

  const history: TaskNoteEntry[] = row.notes_history
    ? (JSON.parse(row.notes_history) as TaskNoteEntry[])
    : [];

  history.push({ content, editedBy, editedAt: new Date().toISOString() });

  db.prepare(`UPDATE tasks SET notes = ?, notes_history = ? WHERE id = ?`).run(
    content,
    JSON.stringify(history),
    taskId
  );

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow;
  return parseTaskRow(updated);
}
