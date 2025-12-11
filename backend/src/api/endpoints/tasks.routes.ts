/**
 * Tasks API Routes
 */

import { Router } from 'express';
import { z } from 'zod';
import { tasksService } from '../../services/endpoints/tasks.service.js';
import { requireAuth, getCredentials } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { Platform } from '../../types/endpoints.js';

const router = Router();

// Apply auth middleware to all routes
router.use(requireAuth);

// Validation schemas
const putPayloadSchema = z.object({
  payloadName: z.string().min(1, 'Payload name is required'),
  payloadPath: z.string().min(1, 'Payload path is required'),
  filterHostname: z.string().optional(),
  filterTag: z.string().optional(),
  filterPlatform: z.enum([Platform.WINDOWS, Platform.MACOS, Platform.LINUX]).optional(),
  investigationId: z.string().optional(),
  context: z.string().optional(),
  ttl: z.number().int().positive().optional(),
  onlineOnly: z.boolean().optional().default(true),
});

const runCommandSchema = z.object({
  command: z.string().optional(),
  payloadName: z.string().optional(),
  payloadBasePath: z.string().optional(),
  filterHostname: z.string().optional(),
  filterTag: z.string().optional(),
  filterPlatform: z.enum([Platform.WINDOWS, Platform.MACOS, Platform.LINUX]).optional(),
  investigationId: z.string().optional(),
  context: z.string().optional(),
  ttl: z.number().int().positive().optional(),
  onlineOnly: z.boolean().optional().default(true),
});

const taskSensorSchema = z.object({
  tasks: z.array(z.string()).min(1, 'At least one task is required'),
  investigationId: z.string().optional(),
});

/**
 * POST /api/endpoints/tasks/put
 * Upload file to sensors
 */
router.post(
  '/put',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const request = putPayloadSchema.parse(req.body);
    const results = await tasksService.putPayload(credentials, request);

    // Convert Map to object for JSON response
    const resultsObj: Record<string, any> = {};
    results.forEach((value, key) => {
      resultsObj[key] = value;
    });

    const successCount = Array.from(results.values()).filter((r) => !r.error).length;

    res.json({
      success: true,
      data: {
        results: resultsObj,
        summary: {
          total: results.size,
          successful: successCount,
          failed: results.size - successCount,
        },
      },
    });
  })
);

/**
 * POST /api/endpoints/tasks/run
 * Execute command on sensors
 */
router.post(
  '/run',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const request = runCommandSchema.parse(req.body);

    // Validate that either command or payloadName is provided
    if (!request.command && !request.payloadName) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        message: 'Either command or payloadName must be specified',
      });
    }

    const results = await tasksService.runCommand(credentials, request);

    // Convert Map to object for JSON response
    const resultsObj: Record<string, any> = {};
    results.forEach((value, key) => {
      resultsObj[key] = value;
    });

    const successCount = Array.from(results.values()).filter((r) => !r.error).length;

    res.json({
      success: true,
      data: {
        results: resultsObj,
        summary: {
          total: results.size,
          successful: successCount,
          failed: results.size - successCount,
        },
      },
    });
  })
);

/**
 * POST /api/endpoints/tasks/sensor/:sensorId
 * Send task to specific sensor
 */
router.post(
  '/sensor/:sensorId',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { tasks, investigationId } = taskSensorSchema.parse(req.body);

    const result = await tasksService.taskSensor(
      credentials,
      req.params.sensorId,
      tasks,
      investigationId
    );

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * POST /api/endpoints/tasks/sensor/:sensorId/put
 * Upload file to specific sensor
 */
router.post(
  '/sensor/:sensorId/put',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { sourcePath, destPath, investigationId } = z
      .object({
        sourcePath: z.string().min(1, 'Source path is required'),
        destPath: z.string().min(1, 'Destination path is required'),
        investigationId: z.string().optional(),
      })
      .parse(req.body);

    const result = await tasksService.putFileWithInvestigation(
      credentials,
      req.params.sensorId,
      sourcePath,
      destPath,
      investigationId || `put_${Date.now()}`
    );

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * POST /api/endpoints/tasks/sensor/:sensorId/run
 * Execute command on specific sensor
 */
router.post(
  '/sensor/:sensorId/run',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { command, investigationId } = z
      .object({
        command: z.string().min(1, 'Command is required'),
        investigationId: z.string().optional(),
      })
      .parse(req.body);

    const result = await tasksService.runCommandWithInvestigation(
      credentials,
      req.params.sensorId,
      command,
      investigationId || `run_${Date.now()}`
    );

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;
