/**
 * Sensors API Routes
 */

import { Router } from 'express';
import { z } from 'zod';
import { sensorsService } from '../../services/endpoints/sensors.service.js';
import { requireAuth, getCredentials } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { ListSensorsRequest, Platform } from '../../types/endpoints.js';

const router = Router();

// Apply auth middleware to all routes
router.use(requireAuth);

// Validation schemas
const listSensorsSchema = z.object({
  limit: z.number().int().positive().optional(),
  offset: z.number().int().min(0).optional(),
  withTags: z.boolean().optional(),
  withIp: z.string().optional(),
  withHostnamePrefix: z.string().optional(),
  onlyOnline: z.boolean().optional(),
  filterTag: z.string().optional(),
  filterHostname: z.string().optional(),
  filterPlatform: z
    .enum([Platform.WINDOWS, Platform.MACOS, Platform.LINUX, Platform.LC_SECOPS])
    .optional(),
});

const tagSensorSchema = z.object({
  tag: z.string().min(1, 'Tag is required'),
  ttl: z.number().int().positive().optional(),
});

const untagSensorSchema = z.object({
  tag: z.string().min(1, 'Tag is required'),
});

const bulkTagSchema = z.object({
  sensorIds: z.array(z.string()).min(1, 'At least one sensor ID is required'),
  tag: z.string().min(1, 'Tag is required'),
  ttl: z.number().int().positive().optional(),
});

/**
 * GET /api/endpoints/sensors
 * List sensors with optional filtering
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Parse query parameters
    const query: Partial<ListSensorsRequest> = {
      limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      withTags: req.query.withTags === 'true',
      withIp: req.query.withIp as string,
      withHostnamePrefix: req.query.withHostnamePrefix as string,
      onlyOnline: req.query.onlyOnline === 'true',
      filterTag: req.query.filterTag as string,
      filterHostname: req.query.filterHostname as string,
      filterPlatform: req.query.filterPlatform as any,
    };

    const validatedQuery = listSensorsSchema.parse(query);
    const result = await sensorsService.listSensors(credentials, validatedQuery);

    res.json({
      success: true,
      data: {
        sensors: result.sensors,
        total: result.total,
        count: result.sensors.length,
      },
    });
  })
);

/**
 * GET /api/endpoints/sensors/:sensorId
 * Get specific sensor by ID
 */
router.get(
  '/:sensorId',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const sensor = await sensorsService.getSensor(credentials, req.params.sensorId);

    if (!sensor) {
      return res.status(404).json({
        success: false,
        error: 'Sensor not found',
        message: `Sensor ${req.params.sensorId} not found`,
      });
    }

    res.json({
      success: true,
      data: sensor,
    });
  })
);

/**
 * POST /api/endpoints/sensors/online-status
 * Get online status for multiple sensors
 * Note: Batched API call - send all sensor IDs in a single request
 * Maximum recommended batch size: 1000 sensors
 */
router.post(
  '/online-status',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const MAX_BATCH_SIZE = 1000;
    const { sensorIds } = z
      .object({
        sensorIds: z.array(z.string())
          .min(1, 'At least one sensor ID is required')
          .max(MAX_BATCH_SIZE, `Maximum ${MAX_BATCH_SIZE} sensors per request`),
      })
      .parse(req.body);

    const statusResponse = await sensorsService.getOnlineStatus(
      credentials,
      sensorIds
    );

    res.json({
      success: true,
      data: statusResponse,
    });
  })
);

/**
 * POST /api/endpoints/sensors/:sensorId/tag
 * Add tag to sensor
 */
router.post(
  '/:sensorId/tag',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { tag, ttl } = tagSensorSchema.parse(req.body);

    await sensorsService.tagSensor(credentials, req.params.sensorId, tag, ttl);

    res.json({
      success: true,
      message: `Tag '${tag}' added to sensor ${req.params.sensorId}`,
    });
  })
);

/**
 * DELETE /api/endpoints/sensors/:sensorId/tag
 * Remove tag from sensor
 */
router.delete(
  '/:sensorId/tag',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { tag } = untagSensorSchema.parse(req.body);

    await sensorsService.untagSensor(credentials, req.params.sensorId, tag);

    res.json({
      success: true,
      message: `Tag '${tag}' removed from sensor ${req.params.sensorId}`,
    });
  })
);

/**
 * POST /api/endpoints/sensors/bulk/tag
 * Add tag to multiple sensors
 */
router.post(
  '/bulk/tag',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { sensorIds, tag, ttl } = bulkTagSchema.parse(req.body);

    const results: Array<{ sensorId: string; success: boolean; error?: string }> =
      [];

    for (const sensorId of sensorIds) {
      try {
        await sensorsService.tagSensor(credentials, sensorId, tag, ttl);
        results.push({ sensorId, success: true });
      } catch (error) {
        results.push({
          sensorId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    res.json({
      success: true,
      data: {
        results,
        summary: {
          total: sensorIds.length,
          successful: successCount,
          failed: sensorIds.length - successCount,
        },
      },
    });
  })
);

/**
 * POST /api/endpoints/sensors/bulk/untag
 * Remove tag from multiple sensors
 */
router.post(
  '/bulk/untag',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { sensorIds, tag } = z
      .object({
        sensorIds: z.array(z.string()).min(1),
        tag: z.string().min(1),
      })
      .parse(req.body);

    const results: Array<{ sensorId: string; success: boolean; error?: string }> =
      [];

    for (const sensorId of sensorIds) {
      try {
        await sensorsService.untagSensor(credentials, sensorId, tag);
        results.push({ sensorId, success: true });
      } catch (error) {
        results.push({
          sensorId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    res.json({
      success: true,
      data: {
        results,
        summary: {
          total: sensorIds.length,
          successful: successCount,
          failed: sensorIds.length - successCount,
        },
      },
    });
  })
);

/**
 * POST /api/endpoints/sensors/:sensorId/isolate
 * Isolate sensor from network
 */
router.post(
  '/:sensorId/isolate',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    await sensorsService.isolateSensor(credentials, req.params.sensorId);

    res.json({
      success: true,
      message: `Sensor ${req.params.sensorId} isolated from network`,
    });
  })
);

/**
 * POST /api/endpoints/sensors/:sensorId/rejoin
 * Remove network isolation from sensor
 */
router.post(
  '/:sensorId/rejoin',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    await sensorsService.rejoinSensor(credentials, req.params.sensorId);

    res.json({
      success: true,
      message: `Sensor ${req.params.sensorId} rejoined network`,
    });
  })
);

export default router;
