import { Router } from 'express';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { validate } from '../middleware/validation.js';
import { IntegrationsSettingsService } from '../services/integrations/settings.js';
import { DefenderSyncService } from '../services/defender/sync.service.js';
import { AzureCredentialsSchema, AzureTestSchema, DefenderCredentialsSchema, DefenderTestSchema, DefenderAutoResolveModeSchema } from '../schemas/integrations.schemas.js';
import { DEFENDER_INDEX } from '../services/defender/index-management.js';
import { SettingsService as AnalyticsSettingsService } from '../services/analytics/settings.js';
import { createEsClient } from '../services/analytics/client.js';

const router = Router();

router.use(requireClerkAuth());

const settingsService = new IntegrationsSettingsService();

router.get('/azure', requirePermission('integrations:read'), asyncHandler(async (_req, res) => {
  const settings = await settingsService.getAzureSettings();

  if (!settings?.configured) {
    res.json({ configured: false });
    return;
  }

  const mask = (val: string) =>
    val.length > 4 ? '****' + val.slice(-4) : '****';

  res.json({
    configured: true,
    tenant_id: mask(settings.tenant_id),
    client_id: mask(settings.client_id),
    client_secret_set: !!settings.client_secret,
    label: settings.label ?? '',
    env_configured: settingsService.isEnvConfigured(),
  });
}));

router.post('/azure', requirePermission('integrations:write'), validate(AzureCredentialsSchema), asyncHandler(async (req, res) => {
  const { tenant_id, client_id, client_secret, label } = req.body;

  const isEdit = await settingsService.isAzureConfigured();

  if (!isEdit) {
    if (!tenant_id || !client_id || !client_secret) {
      throw new AppError('tenant_id, client_id, and client_secret are required for initial setup', 400);
    }
  }

  await settingsService.saveAzureSettings({ tenant_id, client_id, client_secret, label });

  res.json({ success: true });
}));

router.delete('/azure', requirePermission('integrations:write'), asyncHandler(async (_req, res) => {
  if (settingsService.isEnvConfigured()) {
    throw new AppError(
      'Cannot disconnect: Azure credentials are set via environment variables (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET). Remove these env vars to disconnect.',
      400
    );
  }
  await settingsService.deleteAzureSettings();
  res.json({ success: true });
}));

router.post('/azure/test', requirePermission('integrations:write'), validate(AzureTestSchema), asyncHandler(async (req, res) => {
  const { tenant_id, client_id, client_secret } = req.body;

  const stored = await settingsService.getAzureCredentials();
  const effectiveTenantId = tenant_id || stored?.tenant_id;
  const effectiveClientId = client_id || stored?.client_id;
  const effectiveClientSecret = client_secret || stored?.client_secret;

  if (!effectiveTenantId || !effectiveClientId || !effectiveClientSecret) {
    res.json({
      success: false,
      error: 'Missing credentials: tenant_id, client_id, and client_secret are all required',
    });
    return;
  }

  const uuidPattern = /^[0-9a-f-]{36}$/i;
  if (!uuidPattern.test(effectiveTenantId)) {
    res.json({
      success: false,
      error: 'tenant_id does not look like a valid UUID (expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)',
    });
    return;
  }

  if (!uuidPattern.test(effectiveClientId)) {
    res.json({
      success: false,
      error: 'client_id does not look like a valid UUID (expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)',
    });
    return;
  }

  res.json({ success: true, message: 'Credentials look valid' });
}));

// ---------------------------------------------------------------------------
// Microsoft Defender (Graph Security API)
// ---------------------------------------------------------------------------

router.get('/defender', requirePermission('integrations:read'), asyncHandler(async (_req, res) => {
  const settings = await settingsService.getDefenderSettings();

  if (!settings?.configured) {
    res.json({ configured: false });
    return;
  }

  const mask = (val: string) =>
    val.length > 4 ? '****' + val.slice(-4) : '****';

  res.json({
    configured: true,
    tenant_id: mask(settings.tenant_id),
    client_id: mask(settings.client_id),
    client_secret_set: !!settings.client_secret,
    label: settings.label ?? '',
    env_configured: settingsService.isEnvDefenderConfigured(),
  });
}));

router.post('/defender', requirePermission('integrations:write'), validate(DefenderCredentialsSchema), asyncHandler(async (req, res) => {
  const { tenant_id, client_id, client_secret, label } = req.body;

  const isEdit = await settingsService.isDefenderConfigured();

  if (!isEdit) {
    if (!tenant_id || !client_id || !client_secret) {
      throw new AppError('tenant_id, client_id, and client_secret are required for initial setup', 400);
    }
  }

  await settingsService.saveDefenderSettings({ tenant_id, client_id, client_secret, label });

  res.json({ success: true });
}));

router.delete('/defender', requirePermission('integrations:write'), asyncHandler(async (_req, res) => {
  if (settingsService.isEnvDefenderConfigured()) {
    throw new AppError(
      'Cannot disconnect: Defender credentials are set via environment variables (DEFENDER_TENANT_ID, DEFENDER_CLIENT_ID, DEFENDER_CLIENT_SECRET). Remove these env vars to disconnect.',
      400
    );
  }
  await settingsService.deleteDefenderSettings();
  res.json({ success: true });
}));

router.post('/defender/test', requirePermission('integrations:write'), validate(DefenderTestSchema), asyncHandler(async (req, res) => {
  const { tenant_id, client_id, client_secret } = req.body;

  const stored = await settingsService.getDefenderCredentials();
  const effectiveTenantId = tenant_id || stored?.tenant_id;
  const effectiveClientId = client_id || stored?.client_id;
  const effectiveClientSecret = client_secret || stored?.client_secret;

  if (!effectiveTenantId || !effectiveClientId || !effectiveClientSecret) {
    res.json({
      success: false,
      error: 'Missing credentials: tenant_id, client_id, and client_secret are all required',
    });
    return;
  }

  const uuidPattern = /^[0-9a-f-]{36}$/i;
  if (!uuidPattern.test(effectiveTenantId)) {
    res.json({
      success: false,
      error: 'tenant_id does not look like a valid UUID (expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)',
    });
    return;
  }

  // Real OAuth2 token acquisition test
  try {
    const tokenUrl = `https://login.microsoftonline.com/${effectiveTenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: effectiveClientId,
      client_secret: effectiveClientSecret,
      scope: 'https://graph.microsoft.com/.default',
    });

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.json().catch(() => ({})) as Record<string, string>;
      res.json({
        success: false,
        error: errBody.error_description || `Token endpoint returned HTTP ${tokenRes.status}`,
      });
      return;
    }

    res.json({ success: true, message: 'Successfully authenticated with Microsoft Graph' });
  } catch (err) {
    res.json({
      success: false,
      error: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}));

// Defender sync routes
const defenderSyncService = new DefenderSyncService();

router.post('/defender/sync', requirePermission('integrations:write'), asyncHandler(async (_req, res) => {
  const isConfigured = await settingsService.isDefenderConfigured();
  if (!isConfigured) {
    throw new AppError('Defender integration is not configured', 400);
  }
  const result = await defenderSyncService.syncAll();
  res.json({ success: true, data: result });
}));

router.get('/defender/sync/status', requirePermission('integrations:read'), asyncHandler(async (_req, res) => {
  res.json(defenderSyncService.getSyncStatus());
}));

// ──────────────────────────────────────────────────────────────────
// Defender Auto-Resolve (Wave 6 — customer-facing controls)
// ──────────────────────────────────────────────────────────────────

async function getEsClientForRequest() {
  const settings = await new AnalyticsSettingsService().getSettings();
  if (!settings.configured) return null;
  return createEsClient(settings);
}

router.get('/defender/auto-resolve/status', requirePermission('integrations:read'), asyncHandler(async (_req, res) => {
  const mode = await settingsService.getAutoResolveMode();
  const lastAutoResolve = defenderSyncService.getSyncStatus().lastSyncResult?.autoResolve ?? null;

  const es = await getEsClientForRequest();
  const counts = { last24h: 0, last7d: 0, last30d: 0 };

  if (es) {
    const windows: Array<[keyof typeof counts, string]> = [
      ['last24h', 'now-24h'],
      ['last7d', 'now-7d'],
      ['last30d', 'now-30d'],
    ];
    for (const [key, gte] of windows) {
      try {
        const resp = await es.count({
          index: DEFENDER_INDEX,
          query: {
            bool: {
              filter: [
                { term: { doc_type: 'alert' } },
                { term: { 'f0rtika.auto_resolved': true } },
                { range: { 'f0rtika.auto_resolved_at': { gte } } },
              ],
            },
          },
        });
        counts[key] = typeof resp.count === 'number' ? resp.count : 0;
      } catch {
        // Non-fatal.
      }
    }
  }

  res.json({ success: true, data: { mode, counts, lastAutoResolve } });
}));

router.put('/defender/auto-resolve/mode', requirePermission('integrations:write'), validate(DefenderAutoResolveModeSchema), asyncHandler(async (req, res) => {
  const { mode } = req.body as { mode: 'disabled' | 'dry_run' | 'enabled' };
  try {
    await settingsService.setAutoResolveMode(mode);
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : String(err), 400);
  }
  res.json({ success: true, data: { mode } });
}));

router.get('/defender/auto-resolve/receipts', requirePermission('integrations:read'), asyncHandler(async (_req, res) => {
  const limit = Math.min(Math.max(parseInt(String(_req.query.limit ?? '20'), 10) || 20, 1), 100);
  const offset = Math.max(parseInt(String(_req.query.offset ?? '0'), 10) || 0, 0);

  const es = await getEsClientForRequest();
  if (!es) {
    res.json({ success: true, data: { items: [], total: 0, limit, offset } });
    return;
  }

  try {
    const resp = await es.search({
      index: DEFENDER_INDEX,
      size: limit,
      from: offset,
      query: {
        bool: {
          filter: [
            { term: { doc_type: 'alert' } },
            { term: { 'f0rtika.auto_resolved': true } },
          ],
        },
      },
      sort: [{ 'f0rtika.auto_resolved_at': 'desc' }],
      _source: [
        'alert_id', 'alert_title', 'severity',
        'f0rtika.auto_resolved_at', 'f0rtika.auto_resolve_mode',
        'f0rtika.auto_resolve_error', 'f0rtika.achilles_test_uuid',
      ],
    } as any);

    const hits = ((resp as any).hits?.hits ?? []) as any[];
    const totalRaw = (resp as any).hits?.total;
    const total = typeof totalRaw === 'number' ? totalRaw : totalRaw?.value ?? hits.length;

    const items = hits.map((h) => {
      const src = h._source ?? {};
      const f0rtika = src.f0rtika ?? {};
      return {
        alert_id: src.alert_id ?? '',
        alert_title: src.alert_title ?? '',
        severity: src.severity ?? '',
        auto_resolved_at: f0rtika.auto_resolved_at ?? null,
        auto_resolve_mode: f0rtika.auto_resolve_mode ?? null,
        auto_resolve_error: f0rtika.auto_resolve_error ?? null,
        achilles_test_uuid: f0rtika.achilles_test_uuid ?? null,
      };
    });

    res.json({ success: true, data: { items, total, limit, offset } });
  } catch (err) {
    console.warn('[auto-resolve receipts] query failed:', err instanceof Error ? err.message : String(err));
    res.json({ success: true, data: { items: [], total: 0, limit, offset } });
  }
}));

export { defenderSyncService };
export default router;
