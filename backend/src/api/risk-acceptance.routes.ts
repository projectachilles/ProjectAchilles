import { Router } from 'express';
import { clerkClient } from '@clerk/express';
import { requireClerkAuth, requirePermission, getUserId, getUserOrgId } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { SettingsService } from '../services/analytics/settings.js';
import { createEsClient } from '../services/analytics/client.js';
import { RiskAcceptanceService } from '../services/risk-acceptance/risk-acceptance.service.js';
import { validate } from '../middleware/validation.js';
import { AcceptRiskSchema, RevokeRiskSchema, LookupRiskSchema } from '../schemas/risk.schemas.js';

const router = Router();

// All risk acceptance routes require Clerk authentication
router.use(requireClerkAuth());

// Lazy-initialized service (needs ES settings)
const settingsService = new SettingsService();
let riskService: RiskAcceptanceService | null = null;

function getRiskService(): RiskAcceptanceService {
  if (!riskService) {
    const settings = settingsService.getSettings();
    if (!settings.configured) {
      throw new AppError('Elasticsearch not configured', 400);
    }
    const client = createEsClient(settings);
    riskService = new RiskAcceptanceService(client);
  }
  return riskService;
}

// Exported so analytics routes can wire up cache invalidation
export function getRiskAcceptanceService(): RiskAcceptanceService | null {
  return riskService;
}

// POST /api/risk-acceptances — Accept risk for a control
router.post('/', requirePermission('analytics:risk:write'), validate(AcceptRiskSchema), asyncHandler(async (req, res) => {
  const { test_name, control_id, hostname, scope, justification } = req.body;

  const userId = getUserId(req.auth);
  if (!userId) throw new AppError('Authentication required', 401);

  // Resolve display name from Clerk user profile
  const user = await clerkClient.users.getUser(userId);
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ')
    || user.emailAddresses[0]?.emailAddress
    || userId;

  const orgId = getUserOrgId(req.auth);

  // Normalize hostname/scope so they can never disagree downstream.
  // Resolution mirrors the consumer (buildExclusionFilter): explicit `scope` wins,
  // legacy clients (no scope) fall back to "hostname presence implies host scope".
  const resolvedScope: 'host' | 'global' = scope ?? (hostname ? 'host' : 'global');
  const resolvedHostname = resolvedScope === 'host' ? (hostname || undefined) : undefined;

  const svc = getRiskService();
  const acceptance = await svc.acceptRisk({
    org_id: orgId,
    test_name,
    control_id: control_id || undefined,
    hostname: resolvedHostname,
    scope: resolvedScope,
    justification: justification.trim(),
    accepted_by: userId,
    accepted_by_name: displayName,
  });

  res.status(201).json({ success: true, data: acceptance });
}));

// POST /api/risk-acceptances/:id/revoke — Revoke a risk acceptance
router.post('/:id/revoke', requirePermission('analytics:risk:write'), validate(RevokeRiskSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const userId = getUserId(req.auth);
  if (!userId) throw new AppError('Authentication required', 401);

  // Resolve display name from Clerk user profile
  const user = await clerkClient.users.getUser(userId);
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ')
    || user.emailAddresses[0]?.emailAddress
    || userId;

  const orgId = getUserOrgId(req.auth);

  const svc = getRiskService();
  const acceptance = await svc.revokeRisk(id, {
    revoked_by: userId,
    revoked_by_name: displayName,
    revocation_reason: reason.trim(),
  }, orgId);

  res.json({ success: true, data: acceptance });
}));

// GET /api/risk-acceptances — List acceptances (org-scoped)
router.get('/', requirePermission('analytics:risk:read'), asyncHandler(async (req, res) => {
  const { status, test_name, page, pageSize } = req.query;
  const orgId = getUserOrgId(req.auth);

  const svc = getRiskService();
  const result = await svc.listAcceptances({
    org_id: orgId,
    status: status as 'active' | 'revoked' | undefined,
    test_name: test_name as string | undefined,
    page: page ? parseInt(page as string, 10) : 1,
    pageSize: pageSize ? parseInt(pageSize as string, 10) : 50,
  });

  res.json({ success: true, data: result.data, total: result.total });
}));

// GET /api/risk-acceptances/:id — Get single acceptance (org-scoped)
router.get('/:id', requirePermission('analytics:risk:read'), asyncHandler(async (req, res) => {
  const orgId = getUserOrgId(req.auth);

  const svc = getRiskService();
  const acceptance = await svc.getAcceptanceById(req.params.id, orgId);

  if (!acceptance) {
    throw new AppError('Risk acceptance not found', 404);
  }

  res.json({ success: true, data: acceptance });
}));

// POST /api/risk-acceptances/lookup — Batch lookup for UI badges (org-scoped)
router.post('/lookup', requirePermission('analytics:risk:read'), validate(LookupRiskSchema), asyncHandler(async (req, res) => {
  const { test_names } = req.body;
  const orgId = getUserOrgId(req.auth);

  const svc = getRiskService();
  const result = await svc.getAcceptancesForControls(test_names, orgId);

  res.json({ success: true, data: result });
}));

export default router;
