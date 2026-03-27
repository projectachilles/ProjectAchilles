import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { processSchedules } from '../services/agent/schedules.service.js';
import { processAutoRotation } from '../services/agent/autoRotation.service.js';

const router = Router();

/** Timing-safe comparison to prevent secret leakage via response timing. */
function verifyCronSecret(authHeader: string | undefined): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !authHeader) return false;
  const actual = authHeader.replace('Bearer ', '');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

/**
 * Cron endpoint for schedule processing.
 * Called by Vercel Crons every minute.
 * Protected by CRON_SECRET (auto-injected by Vercel).
 */
router.get('/schedules', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!verifyCronSecret(authHeader)) {
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
  if (!verifyCronSecret(authHeader)) {
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

/**
 * Cron endpoint for Defender data sync.
 * Called by Vercel Crons every 5 minutes for alerts, every 6 hours for scores/controls.
 * A single endpoint runs syncAll() — Vercel Cron triggers at the desired interval.
 */
router.get('/defender-sync', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!verifyCronSecret(authHeader)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  try {
    const { defenderSyncService } = await import('./integrations.routes.js');
    const result = await defenderSyncService.syncAll();
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[cron/defender-sync] Error:', error);
    res.status(500).json({ success: false, error: 'Defender sync failed' });
  }
});

export default router;
