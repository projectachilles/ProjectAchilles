import { Router } from 'express';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { IntegrationsSettingsService } from '../services/integrations/settings.js';
import { DefenderSyncService } from '../services/defender/sync.service.js';
import { AlertsService } from '../services/alerts/alerts.service.js';
import { testSlackWebhook } from '../services/alerts/slack.service.js';
import { testEmailConnection } from '../services/alerts/email.service.js';

const router = Router();

// All integration routes require Clerk auth
router.use(requireClerkAuth());

const settingsService = new IntegrationsSettingsService();
const alertsService = new AlertsService();

// Make alertsService accessible for the result ingestion hook
export { alertsService };

// ---------------------------------------------------------------------------
// Azure / Entra ID
// ---------------------------------------------------------------------------

/** GET /api/integrations/azure — Returns masked settings */
router.get('/azure', requirePermission('integrations:read'), (_req, res) => {
  const settings = settingsService.getAzureSettings();

  if (!settings?.configured) {
    res.json({ configured: false });
    return;
  }

  // Mask sensitive fields — expose only last 4 chars
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
});

/** POST /api/integrations/azure — Save credentials (partial update supported) */
router.post('/azure', requirePermission('integrations:write'), asyncHandler(async (req, res) => {
  const { tenant_id, client_id, client_secret, label } = req.body;

  // On initial setup all three are required; on edit they are optional
  const isEdit = settingsService.isAzureConfigured();

  if (!isEdit) {
    if (!tenant_id || !client_id || !client_secret) {
      throw new AppError('tenant_id, client_id, and client_secret are required for initial setup', 400);
    }
  }

  settingsService.saveAzureSettings({ tenant_id, client_id, client_secret, label });

  res.json({ success: true });
}));

/** POST /api/integrations/azure/test — Validate that the credentials are non-empty */
router.post('/azure/test', requirePermission('integrations:write'), asyncHandler(async (req, res) => {
  const { tenant_id, client_id, client_secret } = req.body;

  // Resolve: use provided values or fall back to stored
  const stored = settingsService.getAzureCredentials();
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

  // Basic format validation
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

/** GET /api/integrations/defender — Returns masked settings */
router.get('/defender', requirePermission('integrations:read'), (_req, res) => {
  const settings = settingsService.getDefenderSettings();

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
});

/** POST /api/integrations/defender — Save credentials (partial update supported) */
router.post('/defender', requirePermission('integrations:write'), asyncHandler(async (req, res) => {
  const { tenant_id, client_id, client_secret, label } = req.body;

  const isEdit = settingsService.isDefenderConfigured();

  if (!isEdit) {
    if (!tenant_id || !client_id || !client_secret) {
      throw new AppError('tenant_id, client_id, and client_secret are required for initial setup', 400);
    }
  }

  settingsService.saveDefenderSettings({ tenant_id, client_id, client_secret, label });

  res.json({ success: true });
}));

/** POST /api/integrations/defender/test — Real OAuth2 token acquisition against Microsoft */
router.post('/defender/test', requirePermission('integrations:write'), asyncHandler(async (req, res) => {
  const { tenant_id, client_id, client_secret } = req.body;

  // Resolve: use provided values or fall back to stored
  const stored = settingsService.getDefenderCredentials();
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

  // Format validation
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

  // Real OAuth2 client_credentials token acquisition
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
      const errBody = await tokenRes.json().catch(() => ({}));
      const errorDesc = (errBody as Record<string, string>).error_description || `HTTP ${tokenRes.status}`;
      res.json({
        success: false,
        error: `Authentication failed: ${errorDesc}`,
      });
      return;
    }

    res.json({
      success: true,
      message: 'Successfully acquired token from Microsoft Graph — credentials are valid',
    });
  } catch (err) {
    res.json({
      success: false,
      error: `Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    });
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

/** Expose the singleton for background sync from server.ts */
export { defenderSyncService };

// ---------------------------------------------------------------------------
// Trend Alerting
// ---------------------------------------------------------------------------

/** GET /api/integrations/alerts — Returns masked alert settings */
router.get('/alerts', requirePermission('integrations:read'), (_req, res) => {
  const settings = settingsService.getAlertSettings();

  if (!settings) {
    res.json({ configured: false });
    return;
  }

  const mask = (val: string) =>
    val.length > 4 ? '****' + val.slice(-4) : '****';

  res.json({
    configured: settingsService.isAlertingConfigured(),
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
  });
});

/** POST /api/integrations/alerts — Save alert settings (partial update) */
router.post('/alerts', requirePermission('integrations:write'),
  asyncHandler(async (req, res) => {
    settingsService.saveAlertSettings(req.body);
    res.json({ success: true });
  })
);

/** POST /api/integrations/alerts/test — Send test notification */
router.post('/alerts/test', requirePermission('integrations:write'),
  asyncHandler(async (req, res) => {
    const settings = settingsService.getAlertSettings();
    const results: { slack?: { success: boolean; message: string }; email?: { success: boolean; message: string } } = {};

    // Test Slack — use webhook from request body or existing settings
    const slackUrl = req.body.slack_webhook_url || settings?.slack?.webhook_url;
    if (slackUrl) {
      results.slack = await testSlackWebhook(slackUrl);
    }

    // Test Email — use settings from request body or existing settings
    const emailSettings = req.body.email || settings?.email;
    if (emailSettings?.smtp_host) {
      results.email = await testEmailConnection(emailSettings);
    }

    res.json({ success: true, data: results });
  })
);

/** GET /api/integrations/alerts/history — Recent alert events */
router.get('/alerts/history', requirePermission('integrations:read'), (_req, res) => {
  res.json({ success: true, data: alertsService.getAlertHistory() });
});

export default router;
