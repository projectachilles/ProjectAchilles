/**
 * Endpoints API Routes Index
 * Combines all endpoint management routes
 */

import { Router } from 'express';
import sensorsRoutes from './sensors.routes.js';
import tasksRoutes from './tasks.routes.js';
import payloadsRoutes from './payloads.routes.js';
import eventsRoutes from './events.routes.js';

const router = Router();

// Mount route modules
router.use('/sensors', sensorsRoutes);
router.use('/tasks', tasksRoutes);
router.use('/payloads', payloadsRoutes);
router.use('/events', eventsRoutes);

export default router;
