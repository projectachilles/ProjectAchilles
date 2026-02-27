import { Router } from 'express';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { IntegrationsSettingsService } from '../services/integrations/settings.js';

const router = Router();

// All integration routes require Clerk auth
router.use(requireClerkAuth());

const settingsService = new IntegrationsSettingsService();

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

export default router;
