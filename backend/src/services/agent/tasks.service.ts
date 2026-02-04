import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDatabase } from './database.js';
import { AppError } from '../../middleware/error.middleware.js';
import type {
  Task,
  TaskPayload,
  TaskResult,
  TaskStatus,
  TaskTestMetadata,
  TaskNoteEntry,
  CreateTaskRequest,
  ListTasksRequest,
} from '../../types/agent.js';
import { getTestMetadata } from './test-catalog.service.js';

// ============================================================================
// HELPERS
// ============================================================================

interface TaskRow {
  id: string;
  agent_id: string;
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
}

function parseTaskRow(row: TaskRow): Task {
  return {
    ...row,
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
  assigned: ['downloading', 'failed', 'expired'],
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
    target: '',
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
        target: entry.target ?? '',
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
  const insertStmt = db.prepare(`
    INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_at, ttl, created_by)
    VALUES (?, ?, ?, 'execute_test', ?, 'pending', ?, datetime('now'), 604800, ?)
  `);

  const taskIds: string[] = [];

  const insertAll = db.transaction(() => {
    for (const agentId of agent_ids) {
      const taskId = crypto.randomUUID();
      insertStmt.run(taskId, agentId, orgId, priority, payloadJson, createdBy);
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

  // Expire old tasks first
  expireOldTasks();

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

  return parseTaskRow(result);
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
    conditions.push('agent_id = ?');
    params.push(filters.agent_id);
  }
  if (filters.org_id) {
    conditions.push('org_id = ?');
    params.push(filters.org_id);
  }
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.type) {
    conditions.push('type = ?');
    params.push(filters.type);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const countRow = db.prepare(
    `SELECT COUNT(*) as total FROM tasks ${whereClause}`
  ).get(...params) as { total: number };

  const rows = db.prepare(
    `SELECT * FROM tasks ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as TaskRow[];

  return {
    tasks: rows.map(parseTaskRow),
    total: countRow.total,
  };
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
