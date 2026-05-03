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
 * Cron endpoint for ES ingestion retry. Drains tasks where the synchronous
 * ingestion attempt in POST /tasks/:id/result failed. Capped at
 * MAX_INGEST_ATTEMPTS=10 retries per task to avoid burning ES capacity on
 * permanent failures (mapping conflicts, etc.).
 *
 * Called by Vercel Cron every 5 minutes.
 */
router.get('/retry-ingestion', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!verifyCronSecret(authHeader)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  try {
    const { retryPendingIngestions } = await import('../services/agent/ingestionWorker.service.js');
    const report = await retryPendingIngestions();
    if (report.attempted > 0 || report.permanentlyFailed > 0) {
      console.log(
        '[Ingestion-Retry] attempted=%d succeeded=%d failed=%d permanent=%d',
        report.attempted,
        report.succeeded,
        report.failed,
        report.permanentlyFailed,
      );
    }
    res.json({ success: true, data: report });
  } catch (error) {
    console.error('[cron/retry-ingestion] Error:', error);
    res.status(500).json({ success: false, error: 'Ingestion retry failed' });
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
