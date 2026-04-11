/**
 * Authentication provider routes.
 *
 * Settings CRUD:
 *   GET    /api/auth/providers             — list configured providers
 *   GET    /api/auth/providers/:provider   — get masked settings
 *   POST   /api/auth/providers/:provider   — save credentials
 *   POST   /api/auth/providers/:provider/test — test credentials
 *   DELETE /api/auth/providers/:provider   — remove credentials
 *
 * OAuth flow (public — no auth required):
 *   GET /api/auth/:provider/authorize      — redirect to provider
 *   GET /api/auth/:provider/callback       — handle callback, issue JWT
 */

import { Router } from 'express';
import type { Request } from 'express';
import crypto from 'node:crypto';
import { getUserOrgId } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { IntegrationsSettingsService } from '../services/integrations/settings.js';
import jwt from 'jsonwebtoken';

const router = Router();

const VALID_PROVIDERS = ['azuread', 'google', 'clerk'] as const;
type Provider = typeof VALID_PROVIDERS[number];

function isValidProvider(p: string): p is Provider {
  return VALID_PROVIDERS.includes(p as Provider);
}

function getSettings(req: Request): IntegrationsSettingsService {
  const orgId = getUserOrgId((req as any).auth);
  return new IntegrationsSettingsService(orgId);
}

function getSecret(): string {
  return process.env.SESSION_SECRET || 'achilles-dev-secret';
}

function issueJwt(user: { id: string; name: string; email?: string; role: string; method: string }): string {
  return jwt.sign(
    { sub: user.id, name: user.name, email: user.email, role: user.role, type: user.method },
    getSecret(),
    { algorithm: 'HS256', issuer: 'projectachilles', expiresIn: '24h' },
  );
}

// Mask a string to show only last 4 chars
const mask = (val: string) => val.length > 4 ? '****' + val.slice(-4) : '****';

// ============================================================================
// Public: List configured providers (no auth — login page needs this)
// ============================================================================

router.get('/providers', (_req, res) => {
  const svc = new IntegrationsSettingsService();
  const providers = svc.getConfiguredAuthProviders();
  // Always include 'basic' since it's always available
  res.json({ providers: ['basic', ...providers] });
});

// ============================================================================
// Settings CRUD (requires auth)
// ============================================================================

/** GET /api/auth/providers/:provider — masked settings */
router.get('/providers/:provider', asyncHandler(async (req, res) => {
  const { provider } = req.params;
  if (!isValidProvider(provider)) throw new AppError('Invalid provider', 400);

  const svc = getSettings(req);
  const settings = svc.getAuthProvider(provider);

  if (!settings?.configured) {
    res.json({ configured: false });
    return;
  }

  // Mask all string values
  const masked: Record<string, unknown> = { configured: true };
  for (const [key, value] of Object.entries(settings)) {
    if (key === 'configured') continue;
    masked[key] = typeof value === 'string' ? mask(value) : value;
  }
  res.json(masked);
}));

/** POST /api/auth/providers/:provider — save credentials */
router.post('/providers/:provider', asyncHandler(async (req, res) => {
  const { provider } = req.params;
  if (!isValidProvider(provider)) throw new AppError('Invalid provider', 400);

  const body = req.body;

  // Validate required fields per provider
  if (provider === 'azuread') {
    if (!body.tenant_id || !body.client_id || !body.client_secret) {
      throw new AppError('tenant_id, client_id, and client_secret are required', 400);
    }
  } else if (provider === 'google') {
    if (!body.client_id || !body.client_secret) {
      throw new AppError('client_id and client_secret are required', 400);
    }
  } else if (provider === 'clerk') {
    if (!body.publishable_key || !body.secret_key) {
      throw new AppError('publishable_key and secret_key are required', 400);
    }
  }

  const svc = getSettings(req);
  svc.saveAuthProvider(provider, body);
  res.json({ success: true });
}));

/** POST /api/auth/providers/:provider/test — test credentials */
router.post('/providers/:provider/test', asyncHandler(async (req, res) => {
  const { provider } = req.params;
  if (!isValidProvider(provider)) throw new AppError('Invalid provider', 400);

  const body = req.body;

  if (provider === 'azuread') {
    const { tenant_id, client_id, client_secret } = body;
    if (!tenant_id || !client_id || !client_secret) {
      throw new AppError('tenant_id, client_id, and client_secret are required', 400);
    }
    // Test by fetching an OAuth2 token with client_credentials
    const tokenUrl = `https://login.microsoftonline.com/${tenant_id}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      client_id,
      client_secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const resp = await fetch(tokenUrl, { method: 'POST', body: params });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new AppError(`Azure AD validation failed: ${(err as any).error_description || resp.statusText}`, 400);
    }
    res.json({ success: true, message: 'Azure AD credentials are valid' });

  } else if (provider === 'google') {
    const { client_id, client_secret } = body;
    if (!client_id || !client_secret) {
      throw new AppError('client_id and client_secret are required', 400);
    }
    // Validate by checking the OAuth2 client info endpoint
    const resp = await fetch(`https://oauth2.googleapis.com/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id,
        client_secret,
        grant_type: 'authorization_code',
        code: 'test-validation-only',
        redirect_uri: 'http://localhost',
      }),
    });
    const data = await resp.json() as any;
    // We expect "invalid_grant" (the code is fake) — but NOT "invalid_client"
    if (data.error === 'invalid_client') {
      throw new AppError('Google credentials are invalid: client_id or client_secret is wrong', 400);
    }
    res.json({ success: true, message: 'Google credentials are valid' });

  } else if (provider === 'clerk') {
    const { publishable_key, secret_key } = body;
    if (!publishable_key || !secret_key) {
      throw new AppError('publishable_key and secret_key are required', 400);
    }
    // Validate by calling Clerk API
    const resp = await fetch('https://api.clerk.com/v1/instance', {
      headers: { Authorization: `Bearer ${secret_key}` },
    });
    if (!resp.ok) {
      throw new AppError('Clerk credentials are invalid', 400);
    }
    res.json({ success: true, message: 'Clerk credentials are valid' });
  }
}));

/** DELETE /api/auth/providers/:provider — remove credentials */
router.delete('/providers/:provider', asyncHandler(async (req, res) => {
  const { provider } = req.params;
  if (!isValidProvider(provider)) throw new AppError('Invalid provider', 400);

  const svc = getSettings(req);
  svc.deleteAuthProvider(provider);
  res.json({ success: true });
}));

// ============================================================================
// OAuth Flow (public — no auth required)
// ============================================================================

// In-memory state store for CSRF protection (short-lived)
const pendingStates = new Map<string, { provider: Provider; createdAt: number }>();

// Cleanup old states every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of pendingStates) {
    if (val.createdAt < cutoff) pendingStates.delete(key);
  }
}, 5 * 60 * 1000);

function getCallbackUrl(req: Request, provider: string): string {
  const origin = process.env.CORS_ORIGIN || `${req.protocol}://${req.get('host')}`;
  return `${origin.replace(/\/$/, '')}/api/auth/${provider}/callback`;
}

function getFrontendUrl(): string {
  return process.env.CORS_ORIGIN || 'http://localhost:8080';
}

/** GET /api/auth/azuread/authorize */
router.get('/azuread/authorize', (req, res) => {
  const svc = new IntegrationsSettingsService();
  const config = svc.getAuthProvider('azuread');
  if (!config?.configured) { res.status(400).json({ error: 'Azure AD not configured' }); return; }

  const state = crypto.randomBytes(32).toString('hex');
  pendingStates.set(state, { provider: 'azuread', createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: config.client_id as string,
    response_type: 'code',
    redirect_uri: getCallbackUrl(req, 'azuread'),
    response_mode: 'query',
    scope: 'openid profile email',
    state,
  });

  res.redirect(`https://login.microsoftonline.com/${config.tenant_id}/oauth2/v2.0/authorize?${params}`);
});

/** GET /api/auth/azuread/callback */
router.get('/azuread/callback', asyncHandler(async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) throw new AppError('Missing code or state', 400);

  const pending = pendingStates.get(state as string);
  if (!pending || pending.provider !== 'azuread') throw new AppError('Invalid state', 400);
  pendingStates.delete(state as string);

  const svc = new IntegrationsSettingsService();
  const config = svc.getAuthProvider('azuread');
  if (!config) throw new AppError('Azure AD not configured', 500);

  // Exchange code for tokens
  const tokenResp = await fetch(`https://login.microsoftonline.com/${config.tenant_id}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.client_id as string,
      client_secret: config.client_secret as string,
      code: code as string,
      redirect_uri: getCallbackUrl(req, 'azuread'),
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResp.ok) {
    const err = await tokenResp.json().catch(() => ({}));
    throw new AppError(`Token exchange failed: ${(err as any).error_description || tokenResp.statusText}`, 400);
  }

  const tokens = await tokenResp.json() as any;

  // Get user info from Graph API
  const userResp = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = await userResp.json() as any;

  const token = issueJwt({
    id: `azuread-${userInfo.id}`,
    name: userInfo.displayName || userInfo.userPrincipalName || 'Azure User',
    email: userInfo.mail || userInfo.userPrincipalName,
    role: 'admin',
    method: 'azuread',
  });

  // Redirect to frontend with token
  res.redirect(`${getFrontendUrl()}/login?token=${encodeURIComponent(token)}&user=${encodeURIComponent(JSON.stringify({ id: `azuread-${userInfo.id}`, name: userInfo.displayName || 'Azure User', role: 'admin' }))}`);
}));

/** GET /api/auth/google/authorize */
router.get('/google/authorize', (req, res) => {
  const svc = new IntegrationsSettingsService();
  const config = svc.getAuthProvider('google');
  if (!config?.configured) { res.status(400).json({ error: 'Google not configured' }); return; }

  const state = crypto.randomBytes(32).toString('hex');
  pendingStates.set(state, { provider: 'google', createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: config.client_id as string,
    response_type: 'code',
    redirect_uri: getCallbackUrl(req, 'google'),
    scope: 'openid profile email',
    state,
    access_type: 'offline',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

/** GET /api/auth/google/callback */
router.get('/google/callback', asyncHandler(async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) throw new AppError('Missing code or state', 400);

  const pending = pendingStates.get(state as string);
  if (!pending || pending.provider !== 'google') throw new AppError('Invalid state', 400);
  pendingStates.delete(state as string);

  const svc = new IntegrationsSettingsService();
  const config = svc.getAuthProvider('google');
  if (!config) throw new AppError('Google not configured', 500);

  // Exchange code for tokens
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.client_id as string,
      client_secret: config.client_secret as string,
      code: code as string,
      redirect_uri: getCallbackUrl(req, 'google'),
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResp.ok) {
    const err = await tokenResp.json().catch(() => ({}));
    throw new AppError(`Token exchange failed: ${(err as any).error_description || tokenResp.statusText}`, 400);
  }

  const tokens = await tokenResp.json() as any;

  // Get user info
  const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = await userResp.json() as any;

  const token = issueJwt({
    id: `google-${userInfo.id}`,
    name: userInfo.name || userInfo.email || 'Google User',
    email: userInfo.email,
    role: 'admin',
    method: 'google',
  });

  res.redirect(`${getFrontendUrl()}/login?token=${encodeURIComponent(token)}&user=${encodeURIComponent(JSON.stringify({ id: `google-${userInfo.id}`, name: userInfo.name || 'Google User', role: 'admin' }))}`);
}));

export default router;
