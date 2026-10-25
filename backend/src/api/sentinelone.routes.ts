// SentinelOne integration routes — mounted at /api/integrations/sentinelone.
//
// Permission model:
//   - integrations:read   → view settings (masked), sync status, audit
// Ingested alerts are read through /api/analytics/sentinelone, like Defender
// and CrowdStrike.
//   - integrations:write  → save/test/delete credentials, manual sync,
//                           auto-resolve / automatic-mitigation settings
// There are no manual response-action routes. Console writes happen only in
// the opt-in auto-resolve / automatic-mitigation passes, which require
// permission_mode === 'response'; the S1 client independently refuses any
// non-GET request in read_only mode.

import { Router } from 'express';
import type { Request } from 'express';
import { requireClerkAuth, requirePermission, getUserOrgId, getUserId } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { validateUrlForSSRF } from '../middleware/urlValidation.js';
import { validate } from '../middleware/validation.js';
import {
  SentinelOneSettingsSchema,
  SentinelOneTestSchema,
  SentinelOneSyncSchema,
  SentinelOneAutoResolveModeSchema,
  SentinelOneAutoMitigationSchema,
} from '../schemas/sentinelone.schemas.js';
import { IntegrationsSettingsService } from '../services/integrations/settings.js';
import { SentinelOneClient, normalizeSentinelOneBaseUrl } from '../services/sentinelone/s1-client.js';
import { SentinelOneSyncService } from '../services/sentinelone/sync.service.js';
import { SentinelOneResponseService } from '../services/sentinelone/response.service.js';
import { SENTINELONE_INDEX } from '../services/sentinelone/index-management.js';
import { SettingsService as AnalyticsSettingsService } from '../services/analytics/settings.js';
import { createEsClient } from '../services/analytics/client.js';

const router = Router();
router.use(requireClerkAuth());

export const sentinelOneSyncService = new SentinelOneSyncService();
export const sentinelOneResponseService = new SentinelOneResponseService();

function getSettingsService(req: Request): IntegrationsSettingsService {
  return new IntegrationsSettingsService(getUserOrgId((req as any).auth));
}

function actorOf(req: Request): { userId: string; orgId?: string } {
  const auth = (req as any).auth;
  return { userId: getUserId(auth) ?? 'unknown', orgId: getUserOrgId(auth) };
}

/** Normalize + SSRF-check a user-supplied console URL. */
async function checkBaseUrl(raw: string): Promise<string> {
  let normalized: string;
  try {
    normalized = normalizeSentinelOneBaseUrl(raw);
    await validateUrlForSSRF(normalized);
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : 'Invalid SentinelOne console URL', 400);
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** GET /api/integrations/sentinelone — masked settings (token never returned). */
router.get('/', requirePermission('integrations:read'), (req, res) => {
  res.json(getSettingsService(req).getSentinelOneSettingsMasked());
});

/** POST /api/integrations/sentinelone — save settings (partial update). */
router.post('/', requirePermission('integrations:write'), validate(SentinelOneSettingsSchema), asyncHandler(async (req, res) => {
  const svc = getSettingsService(req);
  const body = req.body as Record<string, any>;
  const isEdit = svc.isSentinelOneConfigured();
  if (!isEdit && (!body.base_url || !body.api_token)) {
    throw new AppError('base_url and api_token are required for initial setup', 400);
  }
  if (body.base_url) body.base_url = await checkBaseUrl(body.base_url);

  try {
    svc.saveSentinelOneSettings(body);
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : String(err), 400);
  }

  // Start pulling right away instead of waiting for the next poll tick.
  sentinelOneSyncService.syncAll().catch((err) => {
    console.warn('⚠ SentinelOne sync after settings save failed:', err instanceof Error ? err.message : err);
  });

  res.json({ success: true });
}));

/** DELETE /api/integrations/sentinelone — remove stored settings. */
router.delete('/', requirePermission('integrations:write'), asyncHandler(async (req, res) => {
  try {
    getSettingsService(req).deleteSentinelOneSettings();
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : String(err), 400);
  }
  res.json({ success: true });
}));

/** POST /api/integrations/sentinelone/test — authenticated read against the console. */
router.post('/test', requirePermission('integrations:write'), validate(SentinelOneTestSchema), asyncHandler(async (req, res) => {
  const { base_url, api_token, scope } = req.body as { base_url?: string; api_token?: string; scope?: { account_ids?: string[]; site_ids?: string[] } };
  const stored = getSettingsService(req).getSentinelOneCredentials();
  const effectiveUrl = base_url || stored?.base_url;
  if (!effectiveUrl) {
    res.json({ success: false, error: 'Missing credentials: console URL and API token are required' });
    return;
  }
  let url: string;
  try {
    url = await checkBaseUrl(effectiveUrl);
  } catch (err) {
    res.json({ success: false, error: err instanceof Error ? err.message : 'Invalid console URL' });
    return;
  }
  // The stored token is only ever sent to the stored console: testing a
  // different console needs its own token.
  const effectiveToken = api_token || (stored && url === stored.base_url ? stored.api_token : undefined);
  if (!effectiveToken) {
    res.json({ success: false, error: stored ? 'Enter the API token for this console (the saved token is only used with the saved console URL)' : 'Missing credentials: console URL and API token are required' });
    return;
  }
  const client = new SentinelOneClient({ base_url: url, api_token: effectiveToken, permission_mode: 'read_only' });
  const result = await client.testConnection({ accountIds: scope?.account_ids, siteIds: scope?.site_ids });
  res.json(result.success ? { success: true, message: result.message } : { success: false, error: result.message });
}));

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * POST /api/integrations/sentinelone/sync — start a manual sync ({ reset: true }
 * re-runs the backfill). Returns 202 at once: a backfill can cover up to 365
 * days, far longer than a proxy keeps a request open. Poll /sync/status
 * (`inProgress`, `lastSyncResult`). A request while a sync runs starts
 * nothing (and does not reset): `started: false`.
 */
router.post('/sync', requirePermission('integrations:write'), validate(SentinelOneSyncSchema), asyncHandler(async (req, res) => {
  if (!new IntegrationsSettingsService().isSentinelOneConfigured()) {
    throw new AppError('SentinelOne integration is not configured', 400);
  }
  if (sentinelOneSyncService.getSyncStatus().inProgress) {
    res.status(202).json({ success: true, data: { started: false, inProgress: true } });
    return;
  }
  if (req.body?.reset) sentinelOneSyncService.resetCheckpoints();
  sentinelOneSyncService.syncAll().catch((err) => {
    console.warn('⚠ SentinelOne manual sync failed:', err instanceof Error ? err.message : err);
  });
  res.status(202).json({ success: true, data: { started: true, inProgress: true } });
}));

/** GET /api/integrations/sentinelone/sync/status */
router.get('/sync/status', requirePermission('integrations:read'), (_req, res) => {
  res.json(sentinelOneSyncService.getSyncStatus());
});

// ---------------------------------------------------------------------------
// Auto-resolve (default disabled) and automatic mitigation (default off)
// ---------------------------------------------------------------------------

function esClientOrNull() {
  const settings = new AnalyticsSettingsService().getSettings();
  return settings.configured ? createEsClient(settings) : null;
}

/** Receipt counts over 24h / 7d / 30d for a f0rtika.<flag> receipt. */
async function receiptCounts(flag: 'auto_resolved' | 'auto_mitigated', atField: string) {
  const counts = { last24h: 0, last7d: 0, last30d: 0 };
  const es = esClientOrNull();
  if (!es) return counts;
  for (const [key, gte] of [['last24h', 'now-24h'], ['last7d', 'now-7d'], ['last30d', 'now-30d']] as const) {
    try {
      const resp = await es.count({
        index: SENTINELONE_INDEX,
        query: { bool: { filter: [
          { term: { doc_type: 'alert' } },
          { term: { [`f0rtika.${flag}`]: true } },
          { range: { [`f0rtika.${atField}`]: { gte } } },
        ] } },
      });
      counts[key] = typeof resp.count === 'number' ? resp.count : 0;
    } catch {
      // Missing index / transient — 0.
    }
  }
  return counts;
}

async function receiptList(req: Request, flag: 'auto_resolved' | 'auto_mitigated', atField: string, fields: string[]) {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
  const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
  const es = esClientOrNull();
  if (!es) return { items: [], total: 0, limit, offset };
  try {
    const resp = await es.search({
      index: SENTINELONE_INDEX,
      size: limit,
      from: offset,
      query: { bool: { filter: [{ term: { doc_type: 'alert' } }, { term: { [`f0rtika.${flag}`]: true } }] } },
      sort: [{ [`f0rtika.${atField}`]: 'desc' }],
      _source: ['alert_id', 'alert_title', 'severity', 'source_type', 'f0rtika.achilles_test_uuid', ...fields.map((f) => `f0rtika.${f}`)],
    } as any);
    const hits = ((resp as any).hits?.hits ?? []) as any[];
    const totalRaw = (resp as any).hits?.total;
    const total = typeof totalRaw === 'number' ? totalRaw : totalRaw?.value ?? hits.length;
    const items = hits.map((h) => {
      const src = h._source ?? {};
      const f = src.f0rtika ?? {};
      const item: Record<string, unknown> = {
        alert_id: src.alert_id ?? '',
        alert_title: src.alert_title ?? '',
        severity: src.severity ?? '',
        source_type: src.source_type ?? null,
        achilles_test_uuid: f.achilles_test_uuid ?? null,
      };
      for (const field of fields) item[field] = f[field] ?? null;
      return item;
    });
    return { items, total, limit, offset };
  } catch (err) {
    console.warn('[sentinelone receipts] query failed:', err instanceof Error ? err.message : String(err));
    return { items: [], total: 0, limit, offset };
  }
}

/** GET /api/integrations/sentinelone/auto-resolve/status */
router.get('/auto-resolve/status', requirePermission('integrations:read'), asyncHandler(async (req, res) => {
  const svc = getSettingsService(req);
  res.json({
    success: true,
    data: {
      mode: svc.getSentinelOneAutoResolveMode(),
      permission_mode: svc.getSentinelOnePermissionMode(),
      counts: await receiptCounts('auto_resolved', 'auto_resolved_at'),
      lastAutoResolve: sentinelOneSyncService.getSyncStatus().lastSyncResult?.autoResolve ?? null,
    },
  });
}));

/** PUT /api/integrations/sentinelone/auto-resolve/mode — { mode }; 'enabled' requires Response mode */
router.put('/auto-resolve/mode', requirePermission('integrations:write'), validate(SentinelOneAutoResolveModeSchema), asyncHandler(async (req, res) => {
  const { mode } = req.body as { mode: 'disabled' | 'dry_run' | 'enabled' };
  try {
    getSettingsService(req).setSentinelOneAutoResolveMode(mode);
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : String(err), 400);
  }
  res.json({ success: true, data: { mode } });
}));

/** GET /api/integrations/sentinelone/auto-resolve/receipts?limit&offset */
router.get('/auto-resolve/receipts', requirePermission('integrations:read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await receiptList(req, 'auto_resolved', 'auto_resolved_at', ['auto_resolved_at', 'auto_resolve_mode', 'auto_resolve_error']) });
}));

/** GET /api/integrations/sentinelone/auto-mitigation/status */
router.get('/auto-mitigation/status', requirePermission('integrations:read'), asyncHandler(async (req, res) => {
  const svc = getSettingsService(req);
  res.json({
    success: true,
    data: {
      ...svc.getSentinelOneAutoMitigation(),
      permission_mode: svc.getSentinelOnePermissionMode(),
      counts: await receiptCounts('auto_mitigated', 'auto_mitigated_at'),
      lastAutoMitigation: sentinelOneSyncService.getSyncStatus().lastSyncResult?.autoMitigation ?? null,
    },
  });
}));

/**
 * PUT /api/integrations/sentinelone/auto-mitigation — { mode?, action? }.
 * Turning it on (dry_run or enabled) is refused unless the integration is in
 * Response mode; only kill / quarantine are accepted.
 */
router.put('/auto-mitigation', requirePermission('integrations:write'), validate(SentinelOneAutoMitigationSchema), asyncHandler(async (req, res) => {
  let data;
  try {
    data = getSettingsService(req).setSentinelOneAutoMitigation(req.body);
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : String(err), 400);
  }
  console.log(`[SentinelOne-AutoMitigation] settings changed by ${actorOf(req).userId}: mode=${data.mode} action=${data.action}`);
  res.json({ success: true, data });
}));

/** GET /api/integrations/sentinelone/auto-mitigation/receipts?limit&offset */
router.get('/auto-mitigation/receipts', requirePermission('integrations:read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await receiptList(req, 'auto_mitigated', 'auto_mitigated_at', ['auto_mitigated_at', 'auto_mitigation_mode', 'auto_mitigation_action', 'auto_mitigation_error']) });
}));

/** GET /api/integrations/sentinelone/actions/history — audit trail */
router.get('/actions/history', requirePermission('integrations:read'), asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
  res.json({ success: true, data: await sentinelOneResponseService.getHistory(limit) });
}));

export default router;
