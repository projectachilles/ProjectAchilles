import { Router } from 'express';
import type { Request } from 'express';
import { requireClerkAuth, requirePermission, getUserOrgId } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { validateUrlForSSRF, validateHostForSSRF } from '../middleware/urlValidation.js';
import { IntegrationsSettingsService } from '../services/integrations/settings.js';
import { DefenderSyncService } from '../services/defender/sync.service.js';
import { AlertsService } from '../services/alerts/alerts.service.js';
import { testSlackWebhook } from '../services/alerts/slack.service.js';
import { testEmailConnection } from '../services/alerts/email.service.js';
import { validate } from '../middleware/validation.js';
import {
  AzureCredentialsSchema,
  AzureTestSchema,
  DefenderCredentialsSchema,
  DefenderTestSchema,
  DefenderAutoResolveModeSchema,
  AlertSettingsSchema,
  AlertTestSchema,
} from '../schemas/integrations.schemas.js';
import { DEFENDER_INDEX } from '../services/defender/index-management.js';
import { buildClientAssertionForTest } from '../services/defender/graph-client.js';
import { parsePfx } from '../services/defender/pfx-parser.js';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });
import { SettingsService as AnalyticsSettingsService } from '../services/analytics/settings.js';
import { createEsClient } from '../services/analytics/client.js';

const router = Router();

// All integration routes require Clerk auth
router.use(requireClerkAuth());

/** Create org-scoped settings service from the request's Clerk JWT (PA-018). */
function getSettingsService(req: Request): IntegrationsSettingsService {
  const orgId = getUserOrgId((req as any).auth);
  return new IntegrationsSettingsService(orgId);
}

// Legacy singleton for backward-compatible call sites (alertsService, sync)
const settingsService = new IntegrationsSettingsService();
const alertsService = new AlertsService();

// Make alertsService accessible for the result ingestion hook
export { alertsService };

// ---------------------------------------------------------------------------
// Azure / Entra ID
// ---------------------------------------------------------------------------

/** GET /api/integrations/azure — Returns masked settings */
router.get('/azure', requirePermission('integrations:read'), (req, res) => {
  const settings = getSettingsService(req).getAzureSettings();

  if (!settings?.configured) {
    res.json({ configured: false });
    return;
  }

  const mask = (val: string) =>
    val.length > 4 ? '****' + val.slice(-4) : '****';

  const authMethod = settings.auth_method ?? 'client_secret';
  res.json({
    configured: true,
    tenant_id: mask(settings.tenant_id),
    client_id: mask(settings.client_id),
    auth_method: authMethod,
    client_secret_set: authMethod === 'client_secret' && !!settings.client_secret,
    cert_thumbprint_set: authMethod === 'certificate' && !!settings.cert_thumbprint,
    label: settings.label ?? '',
    env_configured: settingsService.isEnvConfigured(),
  });
});

/** POST /api/integrations/azure — Save credentials (partial update supported) */
router.post('/azure', requirePermission('integrations:write'), validate(AzureCredentialsSchema), asyncHandler(async (req, res) => {
  const svc = getSettingsService(req);
  const { tenant_id, client_id, client_secret, label, auth_method, cert_thumbprint, private_key_pem } = req.body;

  const isEdit = svc.isAzureConfigured();
  const effectiveAuthMethod = auth_method ?? 'client_secret';

  if (!isEdit) {
    if (!tenant_id || !client_id) {
      throw new AppError('tenant_id and client_id are required for initial setup', 400);
    }
    if (effectiveAuthMethod === 'certificate') {
      if (!cert_thumbprint || !private_key_pem) {
        throw new AppError('cert_thumbprint and private_key_pem are required for certificate auth setup', 400);
      }
    } else if (!client_secret) {
      throw new AppError('client_secret is required for client secret auth setup', 400);
    }
  }

  svc.saveAzureSettings({ tenant_id, client_id, client_secret, label, auth_method, cert_thumbprint, private_key_pem });

  res.json({ success: true });
}));

/** DELETE /api/integrations/azure — Remove Azure credentials */
router.delete('/azure', requirePermission('integrations:write'), asyncHandler(async (req, res) => {
  if (settingsService.isEnvConfigured()) {
    throw new AppError(
      'Cannot disconnect: Azure credentials are set via environment variables (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET). Remove these env vars to disconnect.',
      400
    );
  }
  getSettingsService(req).deleteAzureSettings();
  res.json({ success: true });
}));

/** POST /api/integrations/azure/test — Validate credentials (format check for secret; live token test for cert) */
router.post('/azure/test', requirePermission('integrations:write'), validate(AzureTestSchema), asyncHandler(async (req, res) => {
  const { tenant_id, client_id, client_secret, auth_method, cert_thumbprint, private_key_pem } = req.body;

  const stored = getSettingsService(req).getAzureCredentials();
  const effectiveTenantId = tenant_id || stored?.tenant_id;
  const effectiveClientId = client_id || stored?.client_id;

  if (!effectiveTenantId || !effectiveClientId) {
    res.json({ success: false, error: 'Missing credentials: tenant_id and client_id are required' });
    return;
  }

  const uuidPattern = /^[0-9a-f-]{36}$/i;
  if (!uuidPattern.test(effectiveTenantId)) {
    res.json({ success: false, error: 'tenant_id does not look like a valid UUID (expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)' });
    return;
  }
  if (!uuidPattern.test(effectiveClientId)) {
    res.json({ success: false, error: 'client_id does not look like a valid UUID (expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)' });
    return;
  }

  const effectiveAuthMethod = auth_method ?? stored?.authMethod ?? 'client_secret';

  if (effectiveAuthMethod === 'certificate') {
    const effectiveThumbprint = cert_thumbprint || (stored?.authMethod === 'certificate' ? stored.cert_thumbprint : undefined);
    const effectiveKey = private_key_pem || (stored?.authMethod === 'certificate' ? stored.private_key_pem : undefined);
    if (!effectiveThumbprint || !effectiveKey) {
      res.json({ success: false, error: 'Missing certificate credentials: cert_thumbprint and private_key_pem are required' });
      return;
    }
    try {
      const assertion = buildClientAssertionForTest(effectiveTenantId, effectiveClientId, effectiveThumbprint, effectiveKey);
      const tokenUrl = `https://login.microsoftonline.com/${effectiveTenantId}/oauth2/v2.0/token`;
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: effectiveClientId,
          client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: assertion,
          scope: 'https://graph.microsoft.com/.default',
        }).toString(),
      });
      if (!tokenRes.ok) {
        const errBody = await tokenRes.json().catch(() => ({}));
        const errorDesc = (errBody as Record<string, string>).error_description || `HTTP ${tokenRes.status}`;
        res.json({ success: false, error: `Authentication failed: ${errorDesc}` });
        return;
      }
      res.json({ success: true, message: 'Successfully acquired token from Microsoft Entra ID — certificate credentials are valid' });
    } catch (err) {
      res.json({ success: false, error: `Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
    }
    return;
  }

  // Client secret path: format validation only (backward compat)
  const effectiveClientSecret = client_secret || (stored?.authMethod === 'client_secret' ? stored.client_secret : undefined);
  if (!effectiveClientSecret) {
    res.json({ success: false, error: 'Missing credentials: client_secret is required' });
    return;
  }
  res.json({ success: true, message: 'Credentials look valid' });
}));

/** POST /api/integrations/azure/parse-pfx — Extract thumbprint + private key from a PFX/P12 file */
router.post('/azure/parse-pfx', requirePermission('integrations:write'), upload.single('pfx'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No PFX file uploaded', 400);
  }
  const passphrase = (req.body as Record<string, string>).passphrase ?? '';
  try {
    const result = parsePfx(req.file.buffer, passphrase);
    res.json({
      thumbprint: result.thumbprint,
      private_key_pem: result.privateKeyPem,
      subject_cn: result.subjectCn,
      not_after: result.notAfter,
    });
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : 'Failed to parse PFX', 400);
  }
}));

// ---------------------------------------------------------------------------
// Microsoft Defender (Graph Security API)
// ---------------------------------------------------------------------------

/** GET /api/integrations/defender — Returns masked settings */
router.get('/defender', requirePermission('integrations:read'), (req, res) => {
  const settings = getSettingsService(req).getDefenderSettings();

  if (!settings?.configured) {
    res.json({ configured: false });
    return;
  }

  const mask = (val: string) =>
    val.length > 4 ? '****' + val.slice(-4) : '****';

  const authMethod = settings.auth_method ?? 'client_secret';
  res.json({
    configured: true,
    tenant_id: mask(settings.tenant_id),
    client_id: mask(settings.client_id),
    auth_method: authMethod,
    client_secret_set: authMethod === 'client_secret' && !!settings.client_secret,
    cert_thumbprint_set: authMethod === 'certificate' && !!settings.cert_thumbprint,
    label: settings.label ?? '',
    env_configured: settingsService.isEnvDefenderConfigured(),
  });
});

/** POST /api/integrations/defender — Save credentials (partial update supported) */
router.post('/defender', requirePermission('integrations:write'), validate(DefenderCredentialsSchema), asyncHandler(async (req, res) => {
  const svc = getSettingsService(req);
  const { tenant_id, client_id, client_secret, label, auth_method, cert_thumbprint, private_key_pem } = req.body;

  const isEdit = svc.isDefenderConfigured();
  const effectiveAuthMethod = auth_method ?? 'client_secret';

  if (!isEdit) {
    if (!tenant_id || !client_id) {
      throw new AppError('tenant_id and client_id are required for initial setup', 400);
    }
    if (effectiveAuthMethod === 'certificate') {
      if (!cert_thumbprint || !private_key_pem) {
        throw new AppError('cert_thumbprint and private_key_pem are required for certificate auth', 400);
      }
    } else {
      if (!client_secret) {
        throw new AppError('client_secret is required for initial setup with client secret auth', 400);
      }
    }
  }

  svc.saveDefenderSettings({ tenant_id, client_id, client_secret, label, auth_method, cert_thumbprint, private_key_pem });

  res.json({ success: true });
}));

/**
 * POST /api/integrations/defender/parse-pfx — Parse a PFX file and return thumbprint + private key PEM.
 * Accepts multipart/form-data with fields: pfx (file), passphrase (string).
 * The caller can then POST these to /defender/test and /defender to validate and save.
 */
router.post('/defender/parse-pfx', requirePermission('integrations:write'), upload.single('pfx'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('pfx file is required', 400);
  }
  const passphrase = (req.body.passphrase as string) ?? '';
  const result = parsePfx(req.file.buffer, passphrase);
  res.json({
    success: true,
    data: {
      thumbprint: result.thumbprint,
      private_key_pem: result.privateKeyPem,
      subject_cn: result.subjectCn,
      not_after: result.notAfter,
    },
  });
}));

/** DELETE /api/integrations/defender — Remove Defender credentials */
router.delete('/defender', requirePermission('integrations:write'), asyncHandler(async (req, res) => {
  if (settingsService.isEnvDefenderConfigured()) {
    throw new AppError(
      'Cannot disconnect: Defender credentials are set via environment variables (DEFENDER_TENANT_ID, DEFENDER_CLIENT_ID, DEFENDER_CLIENT_SECRET). Remove these env vars to disconnect.',
      400
    );
  }
  getSettingsService(req).deleteDefenderSettings();
  res.json({ success: true });
}));

/** POST /api/integrations/defender/test — Real OAuth2 token acquisition against Microsoft */
router.post('/defender/test', requirePermission('integrations:write'), validate(DefenderTestSchema), asyncHandler(async (req, res) => {
  const { tenant_id, client_id, client_secret, auth_method, cert_thumbprint, private_key_pem } = req.body;

  // Resolve: use provided values or fall back to stored
  const stored = getSettingsService(req).getDefenderCredentials();
  const effectiveTenantId = tenant_id || stored?.tenant_id;
  const effectiveClientId = client_id || stored?.client_id;

  if (!effectiveTenantId || !effectiveClientId) {
    res.json({ success: false, error: 'Missing credentials: tenant_id and client_id are required' });
    return;
  }

  const uuidPattern = /^[0-9a-f-]{36}$/i;
  if (!uuidPattern.test(effectiveTenantId)) {
    res.json({ success: false, error: 'tenant_id does not look like a valid UUID (expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)' });
    return;
  }
  if (!uuidPattern.test(effectiveClientId)) {
    res.json({ success: false, error: 'client_id does not look like a valid UUID (expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)' });
    return;
  }

  // Resolve effective auth method and credentials
  const effectiveAuthMethod = auth_method ?? stored?.authMethod ?? 'client_secret';
  let tokenBody: URLSearchParams;

  if (effectiveAuthMethod === 'certificate') {
    const effectiveThumbprint = cert_thumbprint || (stored?.authMethod === 'certificate' ? stored.cert_thumbprint : undefined);
    const effectiveKey = private_key_pem || (stored?.authMethod === 'certificate' ? stored.private_key_pem : undefined);
    if (!effectiveThumbprint || !effectiveKey) {
      res.json({ success: false, error: 'Missing certificate credentials: cert_thumbprint and private_key_pem are required' });
      return;
    }
    try {
      const assertion = buildClientAssertionForTest(effectiveTenantId, effectiveClientId, effectiveThumbprint, effectiveKey);
      tokenBody = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: effectiveClientId,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
        scope: 'https://graph.microsoft.com/.default',
      });
    } catch (err) {
      res.json({ success: false, error: `Failed to build certificate assertion: ${err instanceof Error ? err.message : 'Unknown error'}` });
      return;
    }
  } else {
    const effectiveClientSecret = client_secret || (stored?.authMethod === 'client_secret' ? stored.client_secret : undefined);
    if (!effectiveClientSecret) {
      res.json({ success: false, error: 'Missing credentials: client_secret is required for client secret auth' });
      return;
    }
    tokenBody = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: effectiveClientId,
      client_secret: effectiveClientSecret,
      scope: 'https://graph.microsoft.com/.default',
    });
  }

  try {
    const tokenUrl = `https://login.microsoftonline.com/${effectiveTenantId}/oauth2/v2.0/token`;
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.json().catch(() => ({}));
      const errorDesc = (errBody as Record<string, string>).error_description || `HTTP ${tokenRes.status}`;
      res.json({ success: false, error: `Authentication failed: ${errorDesc}` });
      return;
    }

    res.json({ success: true, message: 'Successfully acquired token from Microsoft Graph — credentials are valid' });
  } catch (err) {
    res.json({ success: false, error: `Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
  }
}));

// ---------------------------------------------------------------------------
// Defender Sync
// ---------------------------------------------------------------------------

const defenderSyncService = new DefenderSyncService();

/** POST /api/integrations/defender/sync — Manual full sync trigger */
router.post('/defender/sync', requirePermission('integrations:write'), asyncHandler(async (_req, res) => {
  if (!settingsService.isDefenderConfigured()) {
    throw new AppError('Defender integration is not configured', 400);
  }

  const result = await defenderSyncService.syncAll();
  res.json({ success: true, data: result });
}));

/** GET /api/integrations/defender/sync/status — Last sync times + counts */
router.get('/defender/sync/status', requirePermission('integrations:read'), (_req, res) => {
  res.json(defenderSyncService.getSyncStatus());
});

// ---------------------------------------------------------------------------
// Defender Auto-Resolve (Wave 6 — customer-facing controls)
// ---------------------------------------------------------------------------

/**
 * Build an ES client from the request's analytics settings. The auto-resolve
 * status + receipts endpoints query the achilles-defender index directly
 * (not via DefenderSyncService) because those reads don't need Graph access.
 */
function getEsClientForRequest(): ReturnType<typeof createEsClient> | null {
  const settings = new AnalyticsSettingsService().getSettings();
  if (!settings.configured) return null;
  return createEsClient(settings);
}

/**
 * GET /api/integrations/defender/auto-resolve/status
 *
 * Returns the current mode plus receipt counts over 24h / 7d / 30d windows.
 * Safe to call even when Defender isn't configured — returns mode='disabled'
 * and zeroed counts.
 */
router.get('/defender/auto-resolve/status', requirePermission('integrations:read'), asyncHandler(async (req, res) => {
  const mode = getSettingsService(req).getAutoResolveMode();
  const lastAutoResolve = defenderSyncService.getSyncStatus().lastSyncResult?.autoResolve ?? null;

  const es = getEsClientForRequest();
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
        // Non-fatal — UI will show 0 on a missing index or transient failure.
      }
    }
  }

  res.json({ success: true, data: { mode, counts, lastAutoResolve } });
}));

/**
 * PUT /api/integrations/defender/auto-resolve/mode
 *
 * Body: { mode: 'disabled' | 'dry_run' | 'enabled' }
 *
 * Fails with 400 when Defender is not yet configured (the setter throws —
 * we surface that clearly rather than silently writing a shadow entry).
 */
router.put('/defender/auto-resolve/mode', requirePermission('integrations:write'), validate(DefenderAutoResolveModeSchema), asyncHandler(async (req, res) => {
  const { mode } = req.body as { mode: 'disabled' | 'dry_run' | 'enabled' };
  try {
    getSettingsService(req).setAutoResolveMode(mode);
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : String(err), 400);
  }
  res.json({ success: true, data: { mode } });
}));

/**
 * GET /api/integrations/defender/auto-resolve/receipts?limit=20&offset=0
 *
 * Paginated list of alert docs that carry an auto-resolve receipt,
 * ordered by auto_resolved_at desc. Each item is the bare minimum the
 * UI needs to render a row; full alert details stay in Defender's portal.
 */
router.get('/defender/auto-resolve/receipts', requirePermission('integrations:read'), asyncHandler(async (_req, res) => {
  const limit = Math.min(Math.max(parseInt(String(_req.query.limit ?? '20'), 10) || 20, 1), 100);
  const offset = Math.max(parseInt(String(_req.query.offset ?? '0'), 10) || 0, 0);

  const es = getEsClientForRequest();
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
    // Missing index or transient ES failure — surface empty list rather than 500
    // so the UI can still render the page.
    console.warn('[auto-resolve receipts] query failed:', err instanceof Error ? err.message : String(err));
    res.json({ success: true, data: { items: [], total: 0, limit, offset } });
  }
}));

/** Expose the singleton for background sync from server.ts */
export { defenderSyncService };

// ---------------------------------------------------------------------------
// Trend Alerting
// ---------------------------------------------------------------------------

/** GET /api/integrations/alerts — Returns masked alert settings */
router.get('/alerts', requirePermission('integrations:read'), (req, res) => {
  const settings = getSettingsService(req).getAlertSettings();

  if (!settings) {
    res.json({ configured: false });
    return;
  }

  const mask = (val: string) =>
    val.length > 4 ? '****' + val.slice(-4) : '****';

  res.json({
    configured: getSettingsService(req).isAlertingConfigured(),
    thresholds: settings.thresholds,
    cooldown_minutes: settings.cooldown_minutes,
    last_alert_at: settings.last_alert_at,
    slack: settings.slack ? {
      configured: settings.slack.configured,
      enabled: settings.slack.enabled,
      webhook_url_set: !!settings.slack.webhook_url,
    } : undefined,
    email: settings.email ? {
      configured: settings.email.configured,
      enabled: settings.email.enabled,
      smtp_host: settings.email.smtp_host,
      smtp_port: settings.email.smtp_port,
      smtp_secure: settings.email.smtp_secure,
      smtp_user: settings.email.smtp_user ? mask(settings.email.smtp_user) : undefined,
      from_address: settings.email.from_address,
      recipients: settings.email.recipients,
    } : undefined,
    agent_alerts: settings.agent_alerts ? {
      enabled: settings.agent_alerts.enabled,
      offline_hours_threshold: settings.agent_alerts.offline_hours_threshold,
      flapping_threshold: settings.agent_alerts.flapping_threshold,
      fleet_online_percent_min: settings.agent_alerts.fleet_online_percent_min,
      cooldown_minutes: settings.agent_alerts.cooldown_minutes,
    } : undefined,
  });
});

/** POST /api/integrations/alerts — Save alert settings (partial update) */
router.post('/alerts', requirePermission('integrations:write'), validate(AlertSettingsSchema),
  asyncHandler(async (req, res) => {
    getSettingsService(req).saveAlertSettings(req.body);
    res.json({ success: true });
  })
);

/** POST /api/integrations/alerts/test — Send test notification */
router.post('/alerts/test', requirePermission('integrations:write'), validate(AlertTestSchema),
  asyncHandler(async (req, res) => {
    const settings = getSettingsService(req).getAlertSettings();
    const results: { slack?: { success: boolean; message: string }; email?: { success: boolean; message: string } } = {};

    // Test Slack — use webhook from request body or existing settings
    const slackUrl = req.body.slack_webhook_url || settings?.slack?.webhook_url;
    if (slackUrl) {
      const SLACK_URL_PATTERN = /^https:\/\/hooks\.slack\.com\/(services|workflows)\//;
      try {
        await validateUrlForSSRF(slackUrl, [SLACK_URL_PATTERN]);
      } catch {
        results.slack = { success: false, message: 'Invalid Slack webhook URL. Must be https://hooks.slack.com/services/... or https://hooks.slack.com/workflows/...' };
      }
      if (!results.slack) {
        results.slack = await testSlackWebhook(slackUrl);
      }
    }

    // Test Email — use settings from request body or existing settings
    const emailSettings = req.body.email || settings?.email;
    if (emailSettings?.smtp_host) {
      try {
        await validateHostForSSRF(emailSettings.smtp_host);
      } catch {
        results.email = { success: false, message: 'SMTP host targets a private or reserved IP address' };
      }
      if (!results.email) {
        results.email = await testEmailConnection(emailSettings);
      }
    }

    res.json({ success: true, data: results });
  })
);

/** GET /api/integrations/alerts/history — Recent alert events */
router.get('/alerts/history', requirePermission('integrations:read'), (_req, res) => {
  res.json({ success: true, data: alertsService.getAlertHistory() });
});

export default router;
