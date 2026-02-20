import { Router } from 'express';
import { processSchedules } from '../services/agent/schedules.service.js';
import { processAutoRotation } from '../services/agent/autoRotation.service.js';

const router = Router();

/**
 * Cron endpoint for schedule processing.
 * Called by Vercel Crons every minute.
 * Protected by CRON_SECRET (auto-injected by Vercel).
 */
router.get('/schedules', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  try {
    await processSchedules();
    res.json({ success: true, message: 'Schedules processed' });
  } catch (error) {
    console.error('[cron/schedules] Error:', error);
    res.status(500).json({ success: false, error: 'Schedule processing failed' });
  }
});

/**
 * Cron endpoint for auto key rotation.
 * Called by Vercel Crons every minute.
 */
router.get('/auto-rotation', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  try {
    await processAutoRotation();
    res.json({ success: true, message: 'Auto-rotation processed' });
  } catch (error) {
    console.error('[cron/auto-rotation] Error:', error);
    res.status(500).json({ success: false, error: 'Auto-rotation processing failed' });
  }
});

export default router;
