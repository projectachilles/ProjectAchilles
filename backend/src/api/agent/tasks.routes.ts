import { Router } from 'express';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import { getUserId } from '../../middleware/clerk.middleware.js';
import {
  createTasks,
  createCommandTasks,
  getNextTask,
  updateTaskStatus,
  submitResult,
  listTasks,
  getTask,
  cancelTask,
  updateTaskNotes,
} from '../../services/agent/tasks.service.js';
import { ingestResult } from '../../services/agent/results.service.js';
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

    const task = getNextTask(agent.id);

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
  asyncHandler(async (req, res) => {
    const agent = req.agent;
    if (!agent) {
      throw new AppError('Agent authentication required', 401);
    }

    const { status } = req.body as { status: TaskStatus };
    if (!status) {
      throw new AppError('Missing required field: status', 400);
    }

    const task = updateTaskStatus(req.params.id, agent.id, status);

    res.json({ success: true, data: task });
  })
);

/**
 * POST /tasks/:id/result
 * Submit execution result for a task owned by the authenticated agent.
 * Body: TaskResult
 */
agentTasksRouter.post(
  '/tasks/:id/result',
  asyncHandler(async (req, res) => {
    const agent = req.agent;
    if (!agent) {
      throw new AppError('Agent authentication required', 401);
    }

    const result = req.body as TaskResult;
    if (!result || result.exit_code === undefined) {
      throw new AppError('Invalid result payload', 400);
    }

    const task = submitResult(req.params.id, agent.id, result);

    // Only ingest security test results into ES (not command results)
    if (task.type === 'execute_test') {
      ingestResult(task, result).catch((err) => {
        console.error('[ES Ingestion] Failed for task %s:', task.id,
          err instanceof Error ? err.message : err);
      });
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
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) {
      throw new AppError('Unable to determine user identity', 401);
    }

    const { org_id, ...taskRequest } = req.body as CreateTaskRequest & { org_id: string };

    if (!org_id) {
      throw new AppError('Missing required field: org_id', 400);
    }

    if (!taskRequest.agent_ids || taskRequest.agent_ids.length === 0) {
      throw new AppError('Missing required field: agent_ids', 400);
    }

    const taskIds = createTasks(taskRequest, org_id, userId);

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
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) {
      throw new AppError('Unable to determine user identity', 401);
    }

    const { org_id, ...cmdRequest } = req.body as CreateCommandTaskRequest & { org_id: string };

    if (!org_id) {
      throw new AppError('Missing required field: org_id', 400);
    }

    if (!cmdRequest.agent_ids || cmdRequest.agent_ids.length === 0) {
      throw new AppError('Missing required field: agent_ids', 400);
    }

    if (!cmdRequest.command) {
      throw new AppError('Missing required field: command', 400);
    }

    const taskIds = createCommandTasks(cmdRequest, org_id, userId);

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
  asyncHandler(async (req, res) => {
    const filters: ListTasksRequest = {
      agent_id: req.query.agent_id as string | undefined,
      org_id: req.query.org_id as string | undefined,
      status: req.query.status as TaskStatus | undefined,
      type: req.query.type as TaskType | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };

    const result = listTasks(filters);

    res.json({ success: true, data: result });
  })
);

/**
 * GET /admin/tasks/:id
 * Get a single task by ID.
 */
adminTasksRouter.get(
  '/tasks/:id',
  asyncHandler(async (req, res) => {
    const task = getTask(req.params.id);

    res.json({ success: true, data: task });
  })
);

/**
 * POST /tasks/:id/cancel
 * Cancel a task (set status to expired).
 */
adminTasksRouter.post(
  '/tasks/:id/cancel',
  asyncHandler(async (req, res) => {
    const task = cancelTask(req.params.id);

    res.json({ success: true, data: task });
  })
);

/**
 * PATCH /tasks/:id/notes
 * Update the notes for a task.
 * Body: { content: string }
 */
adminTasksRouter.patch(
  '/tasks/:id/notes',
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) {
      throw new AppError('Unable to determine user identity', 401);
    }

    const { content } = req.body as { content: string };
    if (typeof content !== 'string') {
      throw new AppError('Missing required field: content', 400);
    }

    const task = updateTaskNotes(req.params.id, content, userId);

    res.json({ success: true, data: task });
  })
);
