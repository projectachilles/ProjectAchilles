/**
 * Events API Routes
 * Handles event querying using LCQL
 */

import { Router } from 'express';
import { z } from 'zod';
import { eventsService } from '../../services/endpoints/events.service.js';
import { requireAuth, getCredentials } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';

const router = Router();

// Apply auth middleware to all routes
router.use(requireAuth);

/**
 * POST /api/endpoints/events/query
 * Query events using LCQL
 */
router.post(
  '/query',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { query, limit, timeout } = z
      .object({
        query: z.string().min(1, 'Query is required'),
        limit: z.number().int().positive().optional().default(100),
        timeout: z.number().int().positive().optional().default(300),
      })
      .parse(req.body);

    const results = await eventsService.queryEvents(
      credentials,
      query,
      limit,
      timeout
    );

    res.json({
      success: true,
      data: results,
    });
  })
);

/**
 * POST /api/endpoints/events/by-investigation
 * Query events by investigation ID
 */
router.post(
  '/by-investigation',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { investigationId, startTime, endTime, limit } = z
      .object({
        investigationId: z.string().min(1, 'Investigation ID is required'),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        limit: z.number().int().positive().optional().default(100),
      })
      .parse(req.body);

    const results = await eventsService.queryEventsByInvestigation(
      credentials,
      investigationId,
      startTime ? new Date(startTime) : undefined,
      endTime ? new Date(endTime) : undefined,
      limit
    );

    res.json({
      success: true,
      data: results,
    });
  })
);

/**
 * POST /api/endpoints/events/by-sensor
 * Query events by sensor ID
 */
router.post(
  '/by-sensor',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { sensorId, eventType, startTime, endTime, limit } = z
      .object({
        sensorId: z.string().min(1, 'Sensor ID is required'),
        eventType: z.string().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        limit: z.number().int().positive().optional().default(100),
      })
      .parse(req.body);

    const results = await eventsService.queryEventsBySensor(
      credentials,
      sensorId,
      eventType,
      startTime ? new Date(startTime) : undefined,
      endTime ? new Date(endTime) : undefined,
      limit
    );

    res.json({
      success: true,
      data: results,
    });
  })
);

export default router;
