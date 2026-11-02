import { Router } from 'express';
import type { Request } from 'express';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import { getUserId, requirePermission, validateRequestOrgId } from '../../middleware/clerk.middleware.js';
import { assertAgentsInOrg, assertRowInOrg, callerOrg, listOrgScope } from '../../middleware/orgScope.js';
import {
  createSchedule,
  listSchedules,
  getSchedule,
  updateSchedule,
  deleteSchedule,
} from '../../services/agent/schedules.service.js';
import { validate } from '../../middleware/validation.js';
import { CreateScheduleSchema, UpdateScheduleSchema } from '../../schemas/admin.schemas.js';
import type {
  Schedule,
  ScheduleStatus,
  CreateScheduleRequest,
  UpdateScheduleRequest,
} from '../../types/agent.js';

export const adminSchedulesRouter = Router();

/**
 * The schedule, or 404 "Schedule not found" unless it exists and, for a
 * caller with an organization, belongs to it.
 */
function requireScheduleInScope(req: Request): Schedule {
  const org = callerOrg(req);
  const schedule = getSchedule(req.params.id);
  assertRowInOrg(schedule.org_id, org, 'Schedule');
  return schedule;
}

/**
 * POST /admin/schedules
 * Create a new schedule.
 */
adminSchedulesRouter.post(
  '/schedules',
  requirePermission('endpoints:schedules:create'),
  validate(CreateScheduleSchema),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) {
      throw new AppError('Unable to determine user identity', 401);
    }

    const body = req.body as CreateScheduleRequest;
    validateRequestOrgId(body.org_id, req.auth);
    assertAgentsInOrg(body.agent_ids, callerOrg(req));
    const schedule = createSchedule(body, userId);

    res.status(201).json({ success: true, data: schedule });
  })
);

/**
 * GET /admin/schedules
 * List schedules with optional filters.
 */
adminSchedulesRouter.get(
  '/schedules',
  requirePermission('endpoints:schedules:read'),
  asyncHandler(async (req, res) => {
    const filters: { org_id?: string; status?: ScheduleStatus } = {
      org_id: listOrgScope(req),
      status: req.query.status as ScheduleStatus | undefined,
    };

    const schedules = listSchedules(filters);

    res.json({ success: true, data: schedules });
  })
);

/**
 * GET /admin/schedules/:id
 * Get a single schedule.
 */
adminSchedulesRouter.get(
  '/schedules/:id',
  requirePermission('endpoints:schedules:read'),
  asyncHandler(async (req, res) => {
    requireScheduleInScope(req);
    const schedule = getSchedule(req.params.id);
    res.json({ success: true, data: schedule });
  })
);

/**
 * PATCH /admin/schedules/:id
 * Update / pause / resume a schedule.
 */
adminSchedulesRouter.patch(
  '/schedules/:id',
  requirePermission('endpoints:schedules:write'),
  validate(UpdateScheduleSchema),
  asyncHandler(async (req, res) => {
    const updates = req.body as UpdateScheduleRequest;
    const existing = requireScheduleInScope(req);
    // The agents the schedule will fire at after this change, new or kept,
    // must all be in the caller's org (a pause/resume can't re-arm a
    // schedule that targets another org's agent).
    assertAgentsInOrg(updates.agent_ids ?? existing.agent_ids, callerOrg(req));
    const schedule = updateSchedule(req.params.id, updates);
    res.json({ success: true, data: schedule });
  })
);

/**
 * DELETE /admin/schedules/:id
 * Soft-delete a schedule.
 */
adminSchedulesRouter.delete(
  '/schedules/:id',
  requirePermission('endpoints:schedules:delete'),
  asyncHandler(async (req, res) => {
    requireScheduleInScope(req);
    deleteSchedule(req.params.id);
    res.json({ success: true, data: null });
  })
);
