import { Router } from 'express';
import type { Request } from 'express';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import { getUserId, hasRequestPermission, requirePermission, validateRequestOrgId } from '../../middleware/clerk.middleware.js';
import { assertAgentsInOrg, assertRowInOrg, callerOrg, listOrgScope } from '../../middleware/orgScope.js';
import {
  createTasks,
  createTasksBatch,
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
  retryTask,
  deleteTask,
  updateTaskNotes,
  sanitizeTaskForAdmin,
  markTaskIngested,
  markIngestionFailed,
  TerminalStateRejection,
} from '../../services/agent/tasks.service.js';
import { runWithNotice } from '../../services/notices/notices.service.js';
import { redactNoticeSummaries } from '../../services/notices/redact.js';
import { ingestResult } from '../../services/agent/results.service.js';
import { retryPendingIngestions } from '../../services/agent/ingestionWorker.service.js';
import { alertsService } from '../integrations.routes.js';
import { validate } from '../../middleware/validation.js';
import { UpdateTaskStatusSchema, TaskResultSchema } from '../../schemas/agent.schemas.js';
import { resolveRequesterLabels, withoutEmail } from '../../services/agent/requesterLabel.js';
import { getAgentRunRecency, getTestRunRecency, MAX_RECENCY_TESTS } from '../../services/agent/testRunHistory.js';
import { TASK_BREAKDOWN_KEY_RE } from '../../services/outcomes/taskOutcome.js';
import {
  CreateTaskSchema,
  CreateTaskBatchSchema,
  CreateCommandTaskSchema,
  CreateUpdateTaskSchema,
  CreateUninstallTaskSchema,
  UpdateTaskNotesSchema,
} from '../../schemas/admin.schemas.js';
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
agentTasksRouter.get( // nosemgrep: semgrep.rules.projectachilles-clerk-auth-missing -- agent device route: mounted behind requireAgentAuth in api/agent/index.ts
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
  validate(UpdateTaskStatusSchema),
  asyncHandler(async (req, res) => {
    const agent = req.agent;
    if (!agent) {
      throw new AppError('Agent authentication required', 401);
    }

    const { status, error: errorMsg } = req.body as { status: TaskStatus; error?: string };

    try {
      const task = updateTaskStatus(req.params.id, agent.id, status, errorMsg);
      res.json({ success: true, data: task });
    } catch (err) {
      if (err instanceof TerminalStateRejection) {
        // Idempotent: server already has final outcome. 2xx so the agent's
        // reporter doesn't loop trying to PATCH a terminal task.
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
      task = submitResult(req.params.id, agent.id, result);
    } catch (err) {
      if (err instanceof TerminalStateRejection) {
        // Idempotent: server already has a final outcome. Skip ES ingestion
        // and alerts (those ran at the original completion). Returning 2xx
        // signals success so the agent's queue.Drain deletes its file and
        // stops the resubmission storm.
        res.setHeader('F0-Task-State', 'terminal-idempotent');
        res.json({ success: true, data: err.task, idempotent: true });
        return;
      }
      throw err;
    }

    // Result is now durably stored in SQLite (tasks.result column). ES
    // ingestion is best-effort on the fast path: try synchronously, and
    // on failure leave es_ingested=0 for the background retry worker
    // (services/agent/ingestionWorker.service.ts) to drain later. We
    // ALWAYS return 200 to the agent because:
    //   1. The data is durable. No retry from the agent is necessary.
    //   2. Re-submission of terminal tasks is handled idempotently above
    //      (TerminalStateRejection -> 200) so agents won't deadlock.
    if (task.type === 'execute_test') {
      try {
        await ingestResult(task, result);
        markTaskIngested(task.id);
      } catch (err) {
        markIngestionFailed(task.id);
        console.error(
          '[ES Ingestion] task %s queued for retry (sync attempt failed): %s',
          task.id,
          err instanceof Error ? err.message : err,
        );
      }

      // Alert evaluation is non-critical for ack — let it run async and
      // log on failure. Even if ingestion failed, alerts still evaluate
      // against whatever data IS in ES.
      alertsService.evaluateAndNotify(
        task.payload.test_name,
        result.hostname ?? 'unknown',
      ).catch((err) => {
        console.error('[Alerts] Evaluation failed for task %s:', task.id,
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
  requirePermission('endpoints:tasks:create'),
  validate(CreateTaskSchema),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) {
      throw new AppError('Unable to determine user identity', 401);
    }

    const { org_id, ...taskRequest } = req.body as CreateTaskRequest & { org_id: string };
    validateRequestOrgId(org_id, req.auth);
    assertAgentsInOrg(taskRequest.agent_ids, callerOrg(req));

    // The notice belongs to the tasks' (validated) org.
    const taskIds = runWithNotice(
      { type: 'run_now', createdBy: userId, orgId: org_id },
      (noticeId) => createTasks(taskRequest, org_id, userId, { noticeId }),
    );

    res.status(201).json({ success: true, data: { task_ids: taskIds } });
  })
);

/**
 * POST /admin/tasks/batch
 * Run several tests at once: every request's tasks are created under ONE
 * pre-execution notice (one email), all-or-nothing like a single Run Now.
 * Body: { org_id, requests: CreateTaskRequest[] } (1..50 requests)
 * Returns: { task_ids: string[][] } in request order.
 */
adminTasksRouter.post(
  '/tasks/batch',
  requirePermission('endpoints:tasks:create'),
  validate(CreateTaskBatchSchema),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) {
      throw new AppError('Unable to determine user identity', 401);
    }

    const { org_id, requests } = req.body as { org_id: string; requests: CreateTaskRequest[] };
    validateRequestOrgId(org_id, req.auth);
    assertAgentsInOrg(requests.flatMap((r) => r.agent_ids), callerOrg(req));

    const taskIds = runWithNotice(
      { type: 'run_now', createdBy: userId, orgId: org_id },
      (noticeId) => createTasksBatch(requests, org_id, userId, { noticeId }),
    );

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
    assertAgentsInOrg(cmdRequest.agent_ids, callerOrg(req));

    const taskIds = createCommandTasks(cmdRequest, org_id, userId);

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
    validateRequestOrgId(org_id, req.auth);
    assertAgentsInOrg(agent_ids, callerOrg(req));

    const taskIds = createUpdateTasks(agent_ids, org_id, userId);

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
    validateRequestOrgId(org_id, req.auth);
    assertAgentsInOrg(agent_ids, callerOrg(req));

    const taskIds = createUninstallTasks(agent_ids, org_id, userId, cleanup ?? false);

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
      org_id: listOrgScope(req),
      status: req.query.status as TaskStatus | undefined,
      type: req.query.type as TaskType | undefined,
      search: req.query.search as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };

    const result = listTasks(filters);

    // Strip env_vars from admin responses
    result.tasks = result.tasks.map(sanitizeTaskForAdmin);

    res.json({ success: true, data: result });
  })
);

/**
 * 404 "Task not found" unless the task exists and, for a caller with an
 * organization, belongs to it.
 */
function requireTaskInScope(req: Request): void {
  const org = callerOrg(req);
  const task = getTask(req.params.id);
  assertRowInOrg(task.org_id, org, 'Task');
}

const TEST_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /admin/tasks/test-recency[?test_uuids=<uuid>[,<uuid>...]]
 * For the host picker's "not run recently" filter: `agents` is when each agent
 * last ran ANY test, `runs` when it last ran each given test (empty without
 * test_uuids). Both say whether a run is queued. Org-scoped like the task lists.
 */
adminTasksRouter.get(
  '/tasks/test-recency',
  requirePermission('endpoints:tasks:read'),
  asyncHandler(async (req, res) => {
    const raw = typeof req.query.test_uuids === 'string' ? req.query.test_uuids : '';
    const testUuids = [...new Set(raw.split(',').map((u) => u.trim()).filter(Boolean))];
    if (testUuids.length > MAX_RECENCY_TESTS) throw new AppError(`At most ${MAX_RECENCY_TESTS} test_uuids`, 400);
    if (testUuids.some((u) => !TEST_UUID_RE.test(u))) throw new AppError('Invalid test_uuids', 400);

    const org = listOrgScope(req);
    res.json({
      success: true,
      data: { runs: getTestRunRecency(testUuids, org), agents: getAgentRunRecency(org) },
    });
  })
);

const GROUPED_TASK_TYPES: ReadonlySet<string> = new Set<TaskType>(['execute_test', 'execute_command', 'update_agent', 'uninstall']);

/**
 * GET /admin/tasks/grouped
 * List tasks grouped by batch_id with server-side pagination.
 */
adminTasksRouter.get(
  '/tasks/grouped',
  requirePermission('endpoints:tasks:read'),
  asyncHandler(async (req, res) => {
    // `type` may list several types ("update_agent,uninstall"); each must be known.
    const types = typeof req.query.type === 'string' && req.query.type
      ? req.query.type.split(',').map((t) => t.trim()).filter(Boolean)
      : [];
    if (types.some((t) => !GROUPED_TASK_TYPES.has(t))) throw new AppError('Invalid task type', 400);

    const breakdown = typeof req.query.breakdown === 'string' && req.query.breakdown ? req.query.breakdown : undefined;
    if (breakdown !== undefined && !TASK_BREAKDOWN_KEY_RE.test(breakdown)) throw new AppError('Invalid breakdown', 400);

    const filters: ListTasksRequest = {
      agent_id: req.query.agent_id as string | undefined,
      org_id: listOrgScope(req),
      status: req.query.status as TaskStatus | undefined,
      types: types as TaskType[],
      breakdown,
      search: req.query.search as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };

    // An org caller sees only its own org's tasks (filters.org_id) and, per
    // ruling R21, only its own org's notices.
    const org = callerOrg(req);
    const result = listTasksGrouped(filters, org ? { kind: 'org', orgId: org } : { kind: 'all' });

    // Notice errors can name recipients (`not accepted: a@…`); only callers
    // who can read the notice settings see them as-is.
    const fullNoticeErrors = hasRequestPermission(req, 'integrations:read');

    // Who asked for each task, resolved once per distinct creator (Clerk lookups
    // are cached). It is personal data: the rows are already limited to the
    // caller's org, and emails go only to user admins.
    const showEmails = hasRequestPermission(req, 'settings:users:manage');
    const labels = await resolveRequesterLabels(
      result.groups.flatMap((g) => g.tasks.map((t) => t.created_by)),
      org,
    );
    const requesterLabel = (t: { created_by: string }) => {
      const label = labels.get(t.created_by);
      if (!label) return null;
      return showEmails ? label : withoutEmail(label);
    };

    // Strip env_vars from admin responses
    for (const group of result.groups) {
      group.tasks = group.tasks.map((t) => ({ ...sanitizeTaskForAdmin(t), created_by_label: requesterLabel(t) }));
      group.payload = { ...group.payload, env_vars: undefined };
      if (group.notices && !fullNoticeErrors) group.notices = redactNoticeSummaries(group.notices);
    }

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
    requireTaskInScope(req);
    const task = sanitizeTaskForAdmin(getTask(req.params.id));

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
    requireTaskInScope(req);
    const task = cancelTask(req.params.id);

    res.json({ success: true, data: task });
  })
);

/**
 * POST /tasks/:id/retry
 * Re-dispatch a terminal execute_test task as a new pending task.
 * Requires the task-creation permission (it creates a task); command tasks
 * are rejected by the service so this route can't sidestep the stricter
 * endpoints:tasks:command permission.
 */
adminTasksRouter.post(
  '/tasks/:id/retry',
  requirePermission('endpoints:tasks:create'),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) {
      throw new AppError('Unable to determine user identity', 401);
    }

    // The clone keeps the original task's org, so the notice belongs to it.
    // getTask throws 404 for an unknown or other-org id before any notice is created.
    requireTaskInScope(req);
    const original = getTask(req.params.id);
    // The clone runs on the original task's agent: it must be in the caller's
    // org too, whatever org the old task row was recorded under.
    assertAgentsInOrg([original.agent_id], callerOrg(req));
    const orgId = original.org_id;
    const task = runWithNotice(
      { type: 'manual_retry', createdBy: userId, orgId },
      (noticeId) => retryTask(req.params.id, userId, noticeId),
    );

    res.status(201).json({ success: true, data: sanitizeTaskForAdmin(task) });
  })
);

/**
 * DELETE /tasks/:id
 * Delete a terminal task (completed/failed/expired); 409 for an active one.
 * The row is archived in deleted_tasks with who deleted it, not discarded.
 */
adminTasksRouter.delete(
  '/tasks/:id',
  requirePermission('endpoints:tasks:delete'),
  asyncHandler(async (req, res) => {
    requireTaskInScope(req);
    deleteTask(req.params.id, getUserId(req.auth) ?? null);
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
    requireTaskInScope(req);

    const task = updateTaskNotes(req.params.id, content, userId);

    res.json({ success: true, data: task });
  })
);

/**
 * POST /admin/ingestion/retry
 * Manually drain the ES ingestion backlog. Mirrors the Vercel cron
 * endpoint /api/cron/retry-ingestion in serverless deployments — gives
 * Docker / Render / Fly.io / Railway operators a uniform "force-drain
 * now" surface alongside the automatic 5-minute setInterval worker.
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
