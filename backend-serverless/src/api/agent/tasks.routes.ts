import { Router } from 'express';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import { validate } from '../../middleware/validation.js';
import { getUserId, requirePermission, validateRequestOrgId } from '../../middleware/clerk.middleware.js';
import {
  createTasks,
  createCommandTasks,
  createUpdateTasks,
  createUninstallTasks,
  getNextTask,
  updateTaskStatus,
  submitResult,
  listTasks,
  listTasksGrouped,
  getTask,
  cancelTask,
  deleteTask,
  updateTaskNotes,
  markTaskIngested,
  markIngestionFailed,
  TerminalStateRejection,
} from '../../services/agent/tasks.service.js';
import { ingestResult } from '../../services/agent/results.service.js';
import { retryPendingIngestions } from '../../services/agent/ingestionWorker.service.js';
import { UpdateTaskStatusSchema, TaskResultSchema } from '../../schemas/agent.schemas.js';
import { CreateTaskSchema, CreateCommandTaskSchema, CreateUpdateTaskSchema, CreateUninstallTaskSchema, UpdateTaskNotesSchema } from '../../schemas/admin.schemas.js';
import type {
  CreateTaskRequest,
  CreateCommandTaskRequest,
  TaskStatus,
  TaskResult,
  ListTasksRequest,
  TaskType,
} from '../../types/agent.js';

// ============================================================================
// Agent-facing router (requireAgentAuth applied at mount time)
// ============================================================================

export const agentTasksRouter = Router();

/**
 * GET /tasks
 * Fetch the next pending task for the authenticated agent.
 * Returns 204 if no tasks are available.
 */
agentTasksRouter.get(
  '/tasks',
  asyncHandler(async (req, res) => {
    const agent = req.agent;
    if (!agent) {
      throw new AppError('Agent authentication required', 401);
    }

    const task = await getNextTask(agent.id);

    if (!task) {
      res.status(204).send();
      return;
    }

    res.json({ success: true, data: task });
  })
);

/**
 * PATCH /tasks/:id/status
 * Update the status of a task owned by the authenticated agent.
 * Body: { status: TaskStatus }
 */
agentTasksRouter.patch(
  '/tasks/:id/status',
  validate(UpdateTaskStatusSchema),
  asyncHandler(async (req, res) => {
    const agent = req.agent;
    if (!agent) {
      throw new AppError('Agent authentication required', 401);
    }

    const { status } = req.body as { status: TaskStatus };

    try {
      const task = await updateTaskStatus(req.params.id, agent.id, status);
      res.json({ success: true, data: task });
    } catch (err) {
      if (err instanceof TerminalStateRejection) {
        res.setHeader('F0-Task-State', 'terminal-idempotent');
        res.json({ success: true, data: err.task, idempotent: true });
        return;
      }
      throw err;
    }
  })
);

/**
 * POST /tasks/:id/result
 * Submit execution result for a task owned by the authenticated agent.
 * Body: TaskResult
 */
agentTasksRouter.post(
  '/tasks/:id/result',
  validate(TaskResultSchema),
  asyncHandler(async (req, res) => {
    const agent = req.agent;
    if (!agent) {
      throw new AppError('Agent authentication required', 401);
    }

    const result = req.body as TaskResult;

    let task;
    try {
      task = await submitResult(req.params.id, agent.id, result);
    } catch (err) {
      if (err instanceof TerminalStateRejection) {
        // Idempotent: server already has a final outcome. Skip ingestion.
        res.setHeader('F0-Task-State', 'terminal-idempotent');
        res.json({ success: true, data: err.task, idempotent: true });
        return;
      }
      throw err;
    }

    // Result is now durably stored in Turso (tasks.result column). ES
    // ingestion is best-effort on the fast path: try synchronously, and
    // on failure leave es_ingested=0 for the /api/cron/retry-ingestion
    // Vercel Cron to drain later. Re-submission of terminal tasks is
    // handled idempotently above (TerminalStateRejection -> 200).
    if (task.type === 'execute_test') {
      try {
        await ingestResult(task, result);
        await markTaskIngested(task.id);
      } catch (err) {
        await markIngestionFailed(task.id);
        console.error(
          '[ES Ingestion] task %s queued for retry (sync attempt failed): %s',
          task.id,
          err instanceof Error ? err.message : err,
        );
      }
    }

    res.json({ success: true, data: task });
  })
);

// ============================================================================
// Admin router (Clerk auth required)
// ============================================================================

export const adminTasksRouter = Router();

// Clerk auth is applied at mount time in the parent router.

/**
 * POST /admin/tasks
 * Create tasks for one or more agents.
 * Body: CreateTaskRequest + org_id
 */
adminTasksRouter.post(
  '/tasks',
  requirePermission('endpoints:tasks:create'),
  validate(CreateTaskSchema),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) {
      throw new AppError('Unable to determine user identity', 401);
    }

    const { org_id, ...taskRequest } = req.body as CreateTaskRequest & { org_id: string };

    validateRequestOrgId(org_id, req.auth);

    const taskIds = await createTasks(taskRequest, org_id, userId);

    res.status(201).json({ success: true, data: { task_ids: taskIds } });
  })
);

/**
 * POST /admin/tasks/command
 * Create command execution tasks for one or more agents.
 * Body: CreateCommandTaskRequest + org_id
 */
adminTasksRouter.post(
  '/tasks/command',
  requirePermission('endpoints:tasks:command'),
  validate(CreateCommandTaskSchema),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) {
      throw new AppError('Unable to determine user identity', 401);
    }

    const { org_id, ...cmdRequest } = req.body as CreateCommandTaskRequest & { org_id: string };

    validateRequestOrgId(org_id, req.auth);

    const taskIds = await createCommandTasks(cmdRequest, org_id, userId);

    res.status(201).json({ success: true, data: { task_ids: taskIds } });
  })
);

/**
 * POST /admin/tasks/update
 * Create update_agent tasks for one or more agents.
 * Body: { org_id: string, agent_ids: string[] }
 */
adminTasksRouter.post(
  '/tasks/update',
  requirePermission('endpoints:tasks:create'),
  validate(CreateUpdateTaskSchema),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) {
      throw new AppError('Unable to determine user identity', 401);
    }

    const { org_id, agent_ids } = req.body as { org_id: string; agent_ids: string[] };

    const taskIds = await createUpdateTasks(agent_ids, org_id, userId);

    res.status(201).json({ success: true, data: { task_ids: taskIds } });
  })
);

/**
 * POST /admin/tasks/uninstall
 * Create uninstall tasks for one or more agents.
 * Body: { org_id: string, agent_ids: string[], cleanup?: boolean }
 */
adminTasksRouter.post(
  '/tasks/uninstall',
  requirePermission('endpoints:agents:delete'),
  validate(CreateUninstallTaskSchema),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) {
      throw new AppError('Unable to determine user identity', 401);
    }

    const { org_id, agent_ids, cleanup } = req.body as { org_id: string; agent_ids: string[]; cleanup?: boolean };

    const taskIds = await createUninstallTasks(agent_ids, org_id, userId, cleanup ?? false);

    res.status(201).json({ success: true, data: { task_ids: taskIds } });
  })
);

/**
 * GET /admin/tasks
 * List tasks with optional filters.
 * Query params: agent_id, org_id, status, type, limit, offset
 */
adminTasksRouter.get(
  '/tasks',
  requirePermission('endpoints:tasks:read'),
  asyncHandler(async (req, res) => {
    const filters: ListTasksRequest = {
      agent_id: req.query.agent_id as string | undefined,
      org_id: req.query.org_id as string | undefined,
      status: req.query.status as TaskStatus | undefined,
      type: req.query.type as TaskType | undefined,
      search: req.query.search as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };

    const result = await listTasks(filters);

    res.json({ success: true, data: result });
  })
);

/**
 * GET /admin/tasks/grouped
 * List tasks grouped by batch_id with server-side pagination.
 */
adminTasksRouter.get(
  '/tasks/grouped',
  requirePermission('endpoints:tasks:read'),
  asyncHandler(async (req, res) => {
    const filters: ListTasksRequest = {
      agent_id: req.query.agent_id as string | undefined,
      org_id: req.query.org_id as string | undefined,
      status: req.query.status as TaskStatus | undefined,
      type: req.query.type as TaskType | undefined,
      search: req.query.search as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };

    const result = await listTasksGrouped(filters);
    res.json({ success: true, data: result });
  })
);

/**
 * GET /admin/tasks/:id
 * Get a single task by ID.
 */
adminTasksRouter.get(
  '/tasks/:id',
  requirePermission('endpoints:tasks:read'),
  asyncHandler(async (req, res) => {
    const task = await getTask(req.params.id);

    res.json({ success: true, data: task });
  })
);

/**
 * POST /tasks/:id/cancel
 * Cancel a task (set status to expired).
 */
adminTasksRouter.post(
  '/tasks/:id/cancel',
  requirePermission('endpoints:tasks:cancel'),
  asyncHandler(async (req, res) => {
    const task = await cancelTask(req.params.id);

    res.json({ success: true, data: task });
  })
);

/**
 * DELETE /tasks/:id
 * Delete a terminal task (completed/failed/expired).
 */
adminTasksRouter.delete(
  '/tasks/:id',
  requirePermission('endpoints:tasks:delete'),
  asyncHandler(async (req, res) => {
    await deleteTask(req.params.id);
    res.json({ success: true, data: null });
  })
);

/**
 * PATCH /tasks/:id/notes
 * Update the notes for a task.
 * Body: { content: string }
 */
adminTasksRouter.patch(
  '/tasks/:id/notes',
  requirePermission('endpoints:tasks:notes'),
  validate(UpdateTaskNotesSchema),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) {
      throw new AppError('Unable to determine user identity', 401);
    }

    const { content } = req.body as { content: string };

    const task = await updateTaskNotes(req.params.id, content, userId);

    res.json({ success: true, data: task });
  })
);

/**
 * POST /admin/ingestion/retry
 * Manually drain the ES ingestion backlog. Companion to the Vercel cron
 * endpoint /api/cron/retry-ingestion (every 5 min) — gives operators a
 * Clerk-auth'd "force-drain now" surface uniform with the Docker /
 * Render / Fly.io / Railway deployments.
 *
 * Returns a RetryReport: { attempted, succeeded, failed, permanentlyFailed }.
 * Bounded by MAX_INGEST_ATTEMPTS (10) per task — tasks at the cap are
 * counted in `permanentlyFailed` but not retried until their attempt
 * counter is manually reset.
 */
adminTasksRouter.post(
  '/ingestion/retry',
  requirePermission('endpoints:tasks:create'),
  asyncHandler(async (_req, res) => {
    const report = await retryPendingIngestions();
    res.json({ success: true, data: report });
  })
);
