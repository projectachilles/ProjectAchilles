import crypto from 'crypto';
import { getDb } from './database.js';
import { AppError } from '../../middleware/error.middleware.js';
import { blobRead, blobReadText } from '../storage.js';
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

// ============================================================================
// SERVICE METHODS
// ============================================================================

/**
 * Create tasks for one or more agents. Looks up binary info from the build
 * directory and inserts a task row per agent.
 */
export async function createTasks(
  request: CreateTaskRequest,
  orgId: string,
  createdBy: string
): Promise<string[]> {
  const db = await getDb();

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

  // Resolve build metadata and binary from Blob storage
  const metaJson = await blobReadText(`builds/${test_uuid}/build-meta.json`);
  if (!metaJson) {
    throw new AppError(`Build metadata not found for test ${test_uuid}`, 404);
  }

  const buildMeta = JSON.parse(metaJson);
  const binaryFilename: string = buildMeta.binary_name ?? buildMeta.filename ?? binary_name;

  const binaryBuffer = await blobRead(`builds/${test_uuid}/${binaryFilename}`);
  if (!binaryBuffer) {
    throw new AppError(`Binary file not found: ${binaryFilename}`, 404);
  }

  // Compute SHA256 and file size from buffer
  const binarySha256 = crypto.createHash('sha256').update(binaryBuffer).digest('hex');
  const binarySize = binaryBuffer.length;

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

  const payloadJson = JSON.stringify(payload);

  // Insert tasks inside a transaction
  const batchId = crypto.randomUUID();
  const taskIds: string[] = [];

  await db.transaction(async (tx) => {
    for (const agentId of agent_ids) {
      const taskId = crypto.randomUUID();
      await tx.execute({
        sql: `INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_at, ttl, created_by, target_index, batch_id)
              VALUES (?, ?, ?, 'execute_test', ?, 'pending', ?, datetime('now'), 604800, ?, ?, ?)`,
        args: [taskId, agentId, orgId, priority, payloadJson, createdBy, target_index ?? null, batchId],
      });
      taskIds.push(taskId);
    }
  });

  return taskIds;
}

/**
 * Create command tasks for one or more agents. Unlike createTasks, this
 * does not look up a binary — it stores a shell command in the payload.
 */
export async function createCommandTasks(
  request: CreateCommandTaskRequest,
  orgId: string,
  createdBy: string
): Promise<string[]> {
  const db = await getDb();

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
  const taskIds: string[] = [];

  await db.transaction(async (tx) => {
    for (const agentId of agent_ids) {
      const taskId = crypto.randomUUID();
      await tx.execute({
        sql: `INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_at, ttl, created_by, batch_id)
              VALUES (?, ?, ?, 'execute_command', ?, 'pending', ?, datetime('now'), 604800, ?, ?)`,
        args: [taskId, agentId, orgId, priority, payloadJson, createdBy, batchId],
      });
      taskIds.push(taskId);
    }
  });

  return taskIds;
}

/**
 * Create update_agent tasks for one or more agents. Unlike createTasks, this
 * does not look up a binary — it signals the agent to check for updates.
 */
export async function createUpdateTasks(
  agentIds: string[],
  orgId: string,
  createdBy: string
): Promise<string[]> {
  const db = await getDb();

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
  const taskIds: string[] = [];

  await db.transaction(async (tx) => {
    for (const agentId of agentIds) {
      const taskId = crypto.randomUUID();
      await tx.execute({
        sql: `INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_at, ttl, created_by, batch_id)
              VALUES (?, ?, ?, 'update_agent', 10, 'pending', ?, datetime('now'), 604800, ?, ?)`,
        args: [taskId, agentId, orgId, payloadJson, createdBy, batchId],
      });
      taskIds.push(taskId);
    }
  });

  return taskIds;
}

/**
 * Create uninstall tasks for one or more agents. Validates that each agent
 * is eligible (not already uninstalled/decommissioned). The cleanup flag
 * controls whether the agent deletes its files after stopping the service.
 */
export async function createUninstallTasks(
  agentIds: string[],
  orgId: string,
  createdBy: string,
  cleanup = false
): Promise<string[]> {
  const db = await getDb();

  if (!agentIds || agentIds.length === 0) {
    throw new AppError('At least one agent_id is required', 400);
  }

  // Pre-validate: reject agents that are already uninstalled or decommissioned
  const placeholders = agentIds.map(() => '?').join(', ');
  const ineligible = await db.all(
    `SELECT id, status FROM agents WHERE id IN (${placeholders}) AND status IN ('uninstalled', 'decommissioned')`,
    [...agentIds]
  ) as unknown as { id: string; status: string }[];

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
  const taskIds: string[] = [];

  await db.transaction(async (tx) => {
    for (const agentId of agentIds) {
      const taskId = crypto.randomUUID();
      await tx.execute({
        sql: `INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_at, ttl, created_by, batch_id)
              VALUES (?, ?, ?, 'uninstall', 10, 'pending', ?, datetime('now'), 86400, ?, ?)`,
        args: [taskId, agentId, orgId, payloadJson, createdBy, batchId],
      });
      taskIds.push(taskId);
    }
  });

  return taskIds;
}

/**
 * Fetch the next pending task for a given agent. Expires old tasks first,
 * then atomically assigns the highest-priority oldest pending task.
 */
export async function getNextTask(agentId: string): Promise<Task | null> {
  const db = await getDb();

  // Expire old tasks and fail stale executing tasks first
  await expireOldTasks();
  await expireStaleTasks();

  // Find and assign the next task atomically via transaction
  const result = await db.transaction(async (tx) => {
    const rs = await tx.execute({
      sql: `SELECT * FROM tasks
            WHERE agent_id = ? AND status = 'pending'
            ORDER BY priority DESC, created_at ASC
            LIMIT 1`,
      args: [agentId],
    });
    const row = rs.rows[0] as unknown as TaskRow | undefined;

    if (!row) return null;

    await tx.execute({
      sql: `UPDATE tasks SET status = 'assigned', assigned_at = datetime('now')
            WHERE id = ?`,
      args: [row.id],
    });

    return { ...row, status: 'assigned', assigned_at: new Date().toISOString() } as unknown as TaskRow;
  });

  if (!result) return null;

  return parseTaskRow(result);
}

/**
 * Update the status of a task. Validates that the agent owns the task and
 * that the state transition is valid.
 */
export async function updateTaskStatus(
  taskId: string,
  agentId: string,
  newStatus: TaskStatus
): Promise<Task> {
  const db = await getDb();

  const row = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]) as unknown as TaskRow | undefined;

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

  await db.run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, [taskId]);

  const updated = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]) as unknown as TaskRow;
  return parseTaskRow(updated);
}

/**
 * Submit a result for a task, marking it as completed.
 */
export async function submitResult(
  taskId: string,
  agentId: string,
  result: TaskResult
): Promise<Task> {
  const db = await getDb();

  const row = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]) as unknown as TaskRow | undefined;

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

  await db.run(
    `UPDATE tasks
     SET result = ?, status = 'completed', completed_at = datetime('now')
     WHERE id = ?`,
    [JSON.stringify(result), taskId]
  );

  // Post-completion hook: mark agent as uninstalled when an uninstall task completes
  if (row.type === 'uninstall') {
    await db.run(`UPDATE agents SET status = 'uninstalled', updated_at = datetime('now') WHERE id = ?`, [row.agent_id]);
    console.log(`[tasks] Agent ${row.agent_id} marked as uninstalled (task ${taskId})`);
  }

  const updated = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]) as unknown as TaskRow;
  return parseTaskRow(updated);
}

/**
 * List tasks with optional filters and pagination.
 */
export async function listTasks(
  filters: ListTasksRequest
): Promise<{ tasks: Task[]; total: number }> {
  const db = await getDb();

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

  const countRow = await db.get(
    `SELECT COUNT(*) as total FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id ${whereClause}`,
    [...params]
  ) as unknown as { total: number };

  const rows = await db.all(
    `SELECT t.*, a.hostname AS agent_hostname FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id ${whereClause} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as unknown as TaskRow[];

  return {
    tasks: rows.map(parseTaskRow),
    total: countRow.total,
  };
}

/**
 * List tasks grouped by batch_id with server-side pagination.
 * A group is included if ANY task within it matches the filter conditions.
 */
export async function listTasksGrouped(
  filters: ListTasksRequest
): Promise<{ groups: TaskGroup[]; total: number }> {
  const db = await getDb();

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
  const batchRows = await db.all(
    `SELECT t.batch_id, MAX(t.created_at) as latest_created
     FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id
     ${whereClause}
     GROUP BY t.batch_id
     ORDER BY latest_created DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as unknown as { batch_id: string; latest_created: string }[];

  // 2. Get total group count
  const countRow = await db.get(
    `SELECT COUNT(*) as total FROM (
       SELECT DISTINCT t.batch_id FROM tasks t
       LEFT JOIN agents a ON t.agent_id = a.id
       ${whereClause}
     )`,
    [...params]
  ) as unknown as { total: number };

  if (batchRows.length === 0) {
    return { groups: [], total: countRow.total };
  }

  // 3. Fetch full task details for matched batches
  const placeholders = batchRows.map(() => '?').join(', ');
  const batchIds = batchRows.map((r) => r.batch_id);

  const taskRows = await db.all(
    `SELECT t.*, a.hostname AS agent_hostname
     FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id
     WHERE t.batch_id IN (${placeholders})
     ORDER BY t.batch_id, a.hostname`,
    [...batchIds]
  ) as unknown as TaskRow[];

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
export async function getTask(taskId: string): Promise<Task> {
  const db = await getDb();

  const row = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]) as unknown as TaskRow | undefined;

  if (!row) {
    throw new AppError('Task not found', 404);
  }

  return parseTaskRow(row);
}

/**
 * Cancel a task by setting its status to 'expired'.
 */
export async function cancelTask(taskId: string): Promise<Task> {
  const db = await getDb();

  const row = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]) as unknown as TaskRow | undefined;

  if (!row) {
    throw new AppError('Task not found', 404);
  }

  if (row.status === 'completed' || row.status === 'failed' || row.status === 'expired') {
    throw new AppError(`Cannot cancel task in status: ${row.status}`, 400);
  }

  await db.run(`UPDATE tasks SET status = 'expired' WHERE id = ?`, [taskId]);

  const updated = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]) as unknown as TaskRow;
  return parseTaskRow(updated);
}

/**
 * Delete a task in any status. Admin-only action behind Clerk auth.
 */
export async function deleteTask(taskId: string): Promise<void> {
  const db = await getDb();

  const row = await db.get('SELECT status FROM tasks WHERE id = ?', [taskId]) as unknown as { status: string } | undefined;

  if (!row) {
    throw new AppError('Task not found', 404);
  }

  await db.run('DELETE FROM tasks WHERE id = ?', [taskId]);
}

/**
 * Expire tasks that have exceeded their TTL.
 */
export async function expireOldTasks(): Promise<number> {
  const db = await getDb();

  const result = await db.run(
    `UPDATE tasks
     SET status = 'expired'
     WHERE status IN ('pending', 'assigned')
       AND julianday('now') - julianday(created_at) > ttl / 86400.0`
  );

  return result.changes;
}

/**
 * Fail tasks stuck in 'executing' or 'downloading' whose owning agent has
 * been offline for longer than STALE_TASK_THRESHOLD_SECONDS. This prevents
 * tasks from being orphaned forever when an agent crashes or loses network.
 */
const STALE_TASK_THRESHOLD_SECONDS = 360; // 2× heartbeat timeout (180s)

export async function expireStaleTasks(): Promise<number> {
  const db = await getDb();

  const result = await db.run(
    `UPDATE tasks
     SET status = 'failed',
         completed_at = datetime('now'),
         result = json('{"error":"Agent went offline during execution"}')
     WHERE status IN ('executing', 'downloading')
       AND agent_id IN (
         SELECT id FROM agents
         WHERE last_heartbeat IS NULL
            OR (julianday('now') - julianday(last_heartbeat)) * 86400.0 > ?
       )`,
    [STALE_TASK_THRESHOLD_SECONDS]
  );

  return result.changes;
}

/**
 * Update the notes for a task. Appends a versioned entry to `notes_history`.
 */
export async function updateTaskNotes(
  taskId: string,
  content: string,
  editedBy: string
): Promise<Task> {
  const db = await getDb();

  const row = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]) as unknown as TaskRow | undefined;

  if (!row) {
    throw new AppError('Task not found', 404);
  }

  const history: TaskNoteEntry[] = row.notes_history
    ? (JSON.parse(row.notes_history) as TaskNoteEntry[])
    : [];

  history.push({ content, editedBy, editedAt: new Date().toISOString() });

  await db.run(
    `UPDATE tasks SET notes = ?, notes_history = ? WHERE id = ?`,
    [content, JSON.stringify(history), taskId]
  );

  const updated = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]) as unknown as TaskRow;
  return parseTaskRow(updated);
}
