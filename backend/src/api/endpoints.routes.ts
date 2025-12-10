import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { SensorsService } from '../services/endpoints/sensors.service.js';

const router = Router();

// Auth middleware for endpoints routes
function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.credentials) {
    throw new AppError('Authentication required', 401);
  }
  next();
}

// Apply auth middleware to all routes
router.use(requireAuth);

// Helper to get credentials from session
function getCredentials(req: Request) {
  const creds = req.session.credentials;
  if (!creds) {
    throw new AppError('Not authenticated', 401);
  }
  return creds;
}

// ============ SENSORS ============

// GET /api/endpoints/sensors - List sensors
router.get('/sensors', asyncHandler(async (req: Request, res: Response) => {
  const { oid, apiKey } = getCredentials(req);
  const { platform, hostname, tag, isOnline } = req.query;

  const sensorsService = new SensorsService(oid, apiKey);
  const sensors = await sensorsService.listSensors({
    platform: platform as string,
    hostname: hostname as string,
    tag: tag as string,
    isOnline: isOnline === 'true' ? true : isOnline === 'false' ? false : undefined,
  });

  res.json(sensors);
}));

// GET /api/endpoints/sensors/:sid - Get sensor details
router.get('/sensors/:sid', asyncHandler(async (req: Request, res: Response) => {
  const { oid, apiKey } = getCredentials(req);
  const { sid } = req.params;

  const sensorsService = new SensorsService(oid, apiKey);
  const sensor = await sensorsService.getSensor(sid);

  if (!sensor) {
    throw new AppError('Sensor not found', 404);
  }

  res.json(sensor);
}));

// POST /api/endpoints/sensors/:sid/tag - Add tag to sensor
router.post('/sensors/:sid/tag', asyncHandler(async (req: Request, res: Response) => {
  const { oid, apiKey } = getCredentials(req);
  const { sid } = req.params;
  const { tag } = req.body;

  if (!tag) {
    throw new AppError('Tag is required', 400);
  }

  const sensorsService = new SensorsService(oid, apiKey);
  await sensorsService.addTag(sid, tag);

  res.json({ success: true });
}));

// DELETE /api/endpoints/sensors/:sid/tag - Remove tag from sensor
router.delete('/sensors/:sid/tag', asyncHandler(async (req: Request, res: Response) => {
  const { oid, apiKey } = getCredentials(req);
  const { sid } = req.params;
  const { tag } = req.body;

  if (!tag) {
    throw new AppError('Tag is required', 400);
  }

  const sensorsService = new SensorsService(oid, apiKey);
  await sensorsService.removeTag(sid, tag);

  res.json({ success: true });
}));

// POST /api/endpoints/sensors/:sid/isolate - Isolate sensor
router.post('/sensors/:sid/isolate', asyncHandler(async (req: Request, res: Response) => {
  const { oid, apiKey } = getCredentials(req);
  const { sid } = req.params;

  const sensorsService = new SensorsService(oid, apiKey);
  await sensorsService.isolateSensor(sid);

  res.json({ success: true });
}));

// POST /api/endpoints/sensors/:sid/rejoin - Rejoin sensor
router.post('/sensors/:sid/rejoin', asyncHandler(async (req: Request, res: Response) => {
  const { oid, apiKey } = getCredentials(req);
  const { sid } = req.params;

  const sensorsService = new SensorsService(oid, apiKey);
  await sensorsService.rejoinSensor(sid);

  res.json({ success: true });
}));

// ============ TASKS ============

// POST /api/endpoints/tasks/run - Run command on sensors
router.post('/tasks/run', asyncHandler(async (req: Request, res: Response) => {
  const { oid, apiKey } = getCredentials(req);
  const { sensorIds, command, investigationId } = req.body;

  if (!sensorIds || !Array.isArray(sensorIds) || sensorIds.length === 0) {
    throw new AppError('Sensor IDs are required', 400);
  }

  if (!command) {
    throw new AppError('Command is required', 400);
  }

  const sensorsService = new SensorsService(oid, apiKey);
  const results = await sensorsService.runCommand(sensorIds, command, investigationId);

  res.json({ success: true, results });
}));

// POST /api/endpoints/tasks/put - Deploy payload to sensors
router.post('/tasks/put', asyncHandler(async (req: Request, res: Response) => {
  const { oid, apiKey } = getCredentials(req);
  const { sensorIds, payloadName, destinationPath } = req.body;

  if (!sensorIds || !Array.isArray(sensorIds) || sensorIds.length === 0) {
    throw new AppError('Sensor IDs are required', 400);
  }

  if (!payloadName || !destinationPath) {
    throw new AppError('Payload name and destination path are required', 400);
  }

  const sensorsService = new SensorsService(oid, apiKey);
  const results = await sensorsService.deployPayload(sensorIds, payloadName, destinationPath);

  res.json({ success: true, results });
}));

// ============ PAYLOADS ============

// GET /api/endpoints/payloads - List payloads
router.get('/payloads', asyncHandler(async (req: Request, res: Response) => {
  const { oid, apiKey } = getCredentials(req);

  const sensorsService = new SensorsService(oid, apiKey);
  const payloads = await sensorsService.listPayloads();

  res.json(payloads);
}));

// DELETE /api/endpoints/payloads/:name - Delete payload
router.delete('/payloads/:name', asyncHandler(async (req: Request, res: Response) => {
  const { oid, apiKey } = getCredentials(req);
  const { name } = req.params;

  const sensorsService = new SensorsService(oid, apiKey);
  await sensorsService.deletePayload(name);

  res.json({ success: true });
}));

// ============ EVENTS ============

// POST /api/endpoints/events/query - Query events
router.post('/events/query', asyncHandler(async (req: Request, res: Response) => {
  const { oid, apiKey } = getCredentials(req);
  const { query, sensorId, investigationId, limit } = req.body;

  const sensorsService = new SensorsService(oid, apiKey);
  const events = await sensorsService.queryEvents({
    query,
    sensorId,
    investigationId,
    limit: limit || 100,
  });

  res.json(events);
}));

export default router;
