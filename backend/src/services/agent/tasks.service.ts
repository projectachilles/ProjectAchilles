import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDatabase } from './database.js';
import { AppError } from '../../middleware/error.middleware.js';
import type {
  Task,
  TaskGroup,
  TaskPayload,
  TaskResult,
  TaskStatus,
  TaskTestMetadata,
  TaskNoteEntry,
  CreateTaskRequest,
  CreateCommandTaskRequest,
  ListTasksRequest,
} from '../../types/agent.js';
import { getTestMetadata } from './test-catalog.service.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';

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
 * Resolve integration environment variables for cloud-targeted tests.
 * Currently supports Azure/Entra ID via the identity-tenant subcategory.
 */
function resolveIntegrationEnvVars(metadata: TaskTestMetadata): Record<string, string> | undefined {
  if (metadata.subcategory === 'identity-tenant') {
    const service = new IntegrationsSettingsService();
    const creds = service.getAzureCredentials();
    if (!creds) return undefined;
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
// SERVICE METHODS
// ============================================================================

/**
 * Create tasks for one or more agents. Looks up binary info from the build
 * directory and inserts a task row per agent.
 */
export function createTasks(
  request: CreateTaskRequest,
  orgId: string,
  createdBy: string
): string[] {
  const db = getDatabase();

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
  } = request;

  if (!agent_ids || agent_ids.length === 0) {
    throw new AppError('At least one agent_id is required', 400);
  }

  if (!test_uuid || !test_name || !binary_name) {
    throw new AppError('test_uuid, test_name, and binary_name are required', 400);
  }

  // Resolve build directory and read build-meta.json
  const buildDir = path.join(os.homedir(), '.projectachilles', 'builds', test_uuid);
  const metaPath = path.join(buildDir, 'build-meta.json');

  if (!fs.existsSync(metaPath)) {
    throw new AppError(`Build metadata not found for test ${test_uuid}`, 404);
  }

  const buildMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const binaryFilename: string = buildMeta.binary_name ?? buildMeta.filename ?? binary_name;
  const binaryPath = path.join(buildDir, binaryFilename);

  if (!fs.existsSync(binaryPath)) {
    throw new AppError(`Binary file not found: ${binaryFilename}`, 404);
  }

  // Compute SHA256 and file size
  const binaryBuffer = fs.readFileSync(binaryPath);
  const binarySha256 = crypto.createHash('sha256').update(binaryBuffer).digest('hex');
  const binarySize = fs.statSync(binaryPath).size;

  // Build payload with metadata enrichment from test catalog
  let enrichedMetadata: TaskTestMetadata = metadata ?? {
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
  };

  // If metadata is empty (no category, no techniques), enrich from the test catalog
  if (!enrichedMetadata.category && enrichedMetadata.techniques.length === 0) {
    const entry = getTestMetadata(test_uuid);
    if (entry) {
      enrichedMetadata = {
        category: entry.category ?? '',
        subcategory: entry.subcategory ?? '',
        severity: entry.severity ?? '',
        techniques: entry.techniques ?? [],
        tactics: entry.tactics ?? [],
        threat_actor: entry.threatActor ?? '',
        target: entry.target ?? [],
        complexity: entry.complexity ?? '',
        tags: entry.tags ?? [],
        score: entry.score ?? null,
      };
    }
  }

  const payload: TaskPayload = {
    test_uuid,
    test_name,
    binary_name: binaryFilename,
    binary_sha256: binarySha256,
    binary_size: binarySize,
    execution_timeout,
    arguments: args,
    metadata: enrichedMetadata,
  };

  // Inject integration credentials as env_vars for cloud-targeted tests
  const envVars = resolveIntegrationEnvVars(enrichedMetadata);
  if (envVars) {
    payload.env_vars = envVars;
  }

  const payloadJson = JSON.stringify(payload);

  // Insert tasks inside a transaction
  const batchId = crypto.randomUUID();
  const insertStmt = db.prepare(`
    INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_at, ttl, created_by, target_index, batch_id)
    VALUES (?, ?, ?, 'execute_test', ?, 'pending', ?, datetime('now'), 604800, ?, ?, ?)
  `);

  const taskIds: string[] = [];

  const insertAll = db.transaction(() => {
    for (const agentId of agent_ids) {
      const taskId = crypto.randomUUID();
      insertStmt.run(taskId, agentId, orgId, priority, payloadJson, createdBy, target_index ?? null, batchId);
      taskIds.push(taskId);
    }
  });

  insertAll();

  return taskIds;
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
    },
  };

  const payloadJson = JSON.stringify(payload);
  const batchId = crypto.randomUUID();

  const insertStmt = db.prepare(`
    INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_at, ttl, created_by, batch_id)
    VALUES (?, ?, ?, 'update_agent', 10, 'pending', ?, datetime('now'), 604800, ?, ?)
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
export function getNextTask(agentId: string): Task | null {
  const db = getDatabase();

  // Expire old tasks and fail stale executing tasks first
  expireOldTasks();
  expireStaleTasks();

  // Find and assign the next task atomically via transaction
  const result = db.transaction(() => {
    const row = db.prepare(`
      SELECT * FROM tasks
      WHERE agent_id = ? AND status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get(agentId) as TaskRow | undefined;

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
  newStatus: TaskStatus
): Task {
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;

  if (!row) {
    throw new AppError('Task not found', 404);
  }

  if (row.agent_id !== agentId) {
    throw new AppError('Agent does not own this task', 403);
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

  // Post-completion hook: mark agent as uninstalled when an uninstall task completes
  if (row.type === 'uninstall') {
    db.prepare(`UPDATE agents SET status = 'uninstalled', updated_at = datetime('now') WHERE id = ?`).run(row.agent_id);
    console.log(`[tasks] Agent ${row.agent_id} marked as uninstalled (task ${taskId})`);
  }

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow;
  return parseTaskRow(updated);
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
 */
export function listTasksGrouped(
  filters: ListTasksRequest
): { groups: TaskGroup[]; total: number } {
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
    return { groups: [], total: countRow.total };
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

    return {
      batch_id: batchRow.batch_id,
      type: first?.type ?? 'execute_test',
      payload: first?.payload ?? ({} as TaskPayload),
      created_at: first?.created_at ?? batchRow.latest_created,
      created_by: first?.created_by ?? null,
      agent_count: tasks.length,
      status_counts: statusCounts,
      tasks,
    };
  });

  return { groups, total: countRow.total };
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
 */
const STALE_TASK_THRESHOLD_SECONDS = 360; // 2× heartbeat timeout (180s)

export function expireStaleTasks(): number {
  const db = getDatabase();

  const result = db.prepare(`
    UPDATE tasks
    SET status = 'failed',
        completed_at = datetime('now'),
        result = json('{"error":"Agent went offline during execution"}')
    WHERE status IN ('executing', 'downloading')
      AND agent_id IN (
        SELECT id FROM agents
        WHERE last_heartbeat IS NULL
           OR (julianday('now') - julianday(last_heartbeat)) * 86400.0 > ?
      )
  `).run(STALE_TASK_THRESHOLD_SECONDS);

  if (result.changes > 0) {
    console.warn(`[tasks] Expired ${result.changes} stale task(s) (agent offline >${STALE_TASK_THRESHOLD_SECONDS}s while executing)`);
  }

  return result.changes;
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
