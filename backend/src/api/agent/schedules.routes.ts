import { Router } from 'express';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import { getUserId, requirePermission } from '../../middleware/clerk.middleware.js';
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
  ScheduleStatus,
  CreateScheduleRequest,
  UpdateScheduleRequest,
} from '../../types/agent.js';

export const adminSchedulesRouter = Router();

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
      org_id: req.query.org_id as string | undefined,
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
    deleteSchedule(req.params.id);
    res.json({ success: true, data: null });
  })
);
