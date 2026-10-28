import { Router } from 'express';
import type { Request } from 'express';
import { requireClerkAuth, requirePermission, hasRequestPermission, getUserId, getUserOrgId } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { validate } from '../middleware/validation.js';
import { IntegrationsSettingsService } from '../services/integrations/settings.js';
import { sendMail } from '../services/alerts/email.service.js';
import { buildNoticeEmail } from '../services/notices/render.js';
import { isFullyAccepted } from '../services/notices/acceptance.js';
import { isSmtpUsable } from '../services/notices/channels.js';
import {
  getNoticeStatus,
  listNotices,
  releaseWithoutNotice,
  tasksUiUrl,
} from '../services/notices/notices.service.js';
import type { NoticeScope } from '../services/notices/notices.service.js';
import { redactNoticeListItem, redactNoticeStatus } from '../services/notices/redact.js';
import type { NoticeState } from '../services/notices/types.js';

const NOTICE_STATES: NoticeState[] = ['pending', 'sent', 'not_delivered', 'overridden', 'skipped'];
import { UpdateNoticeSettingsSchema, ReleaseNoticeSchema } from '../schemas/notices.schemas.js';

const router = Router();

router.use(requireClerkAuth());

/*
 * Ruling R20: notices are per org, like alerts. Settings live under
 * `orgs[callerOrg]` with the legacy top level as the fallback, and a caller
 * sees and acts on only the notices of its own org (a notice's org is the
 * org_id of the tasks it gates).
 */


/**
 * Which notices the caller may see or act on. A caller with a Clerk org sees
 * only that org's notices. A caller without one is in legacy single-org mode
 * and sees all notices (the same as task listing without an org_id filter),
 * unless REQUIRE_ORG_ISOLATION=true, which rejects org-less callers.
 */
function noticeScope(req: Request): NoticeScope {
  const orgId = getUserOrgId(req.auth);
  if (orgId) return { kind: 'org', orgId };
  if (process.env.REQUIRE_ORG_ISOLATION === 'true') {
    throw new AppError('Organization isolation required. Configure Clerk Organizations.', 403);
  }
  return { kind: 'all' };
}

/**
 * The caller's org settings (the `getSettingsService(req)` pattern of
 * integrations.routes). Same isolation rule as noticeScope (Ruling R22): a
 * no-org caller under REQUIRE_ORG_ISOLATION=true gets 403; otherwise it edits
 * the legacy top level.
 */
const settingsService = (req: Request): IntegrationsSettingsService => {
  const scope = noticeScope(req);
  return new IntegrationsSettingsService(scope.kind === 'org' ? scope.orgId : undefined);
};

// Usable SMTP (host + from address), not the alerts `configured` flag: the
// Alerts UI never sends that flag, so it stays false after a UI save.
const smtpConfigured = (svc: IntegrationsSettingsService): boolean =>
  isSmtpUsable(svc.getAlertSettings()?.email);

// Status and list are readable with endpoints:tasks:read; recipient
// addresses and raw SMTP text are only for callers who can read the settings.
const canSeeDeliveryDetail = (req: Request): boolean => hasRequestPermission(req, 'integrations:read');

router.get('/settings', requirePermission('integrations:read'), asyncHandler(async (req, res) => {
  const svc = settingsService(req);
  res.json({
    success: true,
    data: { ...svc.getPreExecutionNoticeSettings(), smtp_configured: smtpConfigured(svc) },
  });
}));

router.put(
  '/settings',
  requirePermission('integrations:write'),
  validate(UpdateNoticeSettingsSchema),
  asyncHandler(async (req, res) => {
    const svc = settingsService(req);
    const current = svc.getPreExecutionNoticeSettings();
    const enabled = req.body.enabled ?? current.enabled;
    const recipients: string[] = req.body.recipients ?? current.recipients;

    if (enabled) {
      if (!smtpConfigured(svc)) {
        throw new AppError('SMTP email must be configured in Alerts before enabling notices', 400);
      }
      if (recipients.length === 0) {
        throw new AppError('At least one recipient is required', 400);
      }
    }

    const saved = svc.savePreExecutionNoticeSettings(req.body);
    res.json({ success: true, data: { ...saved, smtp_configured: smtpConfigured(svc) } });
  }),
);

router.post('/settings/test', requirePermission('integrations:write'), asyncHandler(async (req, res) => {
  const svc = settingsService(req);
  const email = svc.getAlertSettings()?.email;
  if (!email || !isSmtpUsable(email)) {
    throw new AppError('SMTP email must be configured in Alerts before sending a test notice', 400);
  }
  const recipients = svc.getPreExecutionNoticeSettings().recipients;
  if (recipients.length === 0) {
    throw new AppError('At least one recipient is required', 400);
  }

  const now = new Date();
  const built = buildNoticeEmail({
    kind: 'run',
    runTag: 'PA-RUN-TEST00',
    timezone: 'UTC',
    trigger: 'Test notice (no tests will run)',
    startNotBefore: now,
    pickupDeadline: new Date(now.getTime() + 2 * 3_600_000),
    windowEnd: new Date(now.getTime() + 3 * 3_600_000),
    tests: [{ name: 'Sample test', uuid: '00000000-0000-0000-0000-000000000000', stages: '1', techniques: ['T0000'], tactics: [] }],
    hosts: [{ hostname: 'sample-host', os: 'windows', online: true }],
    edr: [],
    uiUrl: tasksUiUrl(),
  });

  const result = await sendMail(email, { to: recipients, subject: `[TEST] ${built.subject}`, html: built.html });
  res.json({
    success: true,
    data: {
      accepted: result.accepted,
      rejected: result.rejected,
      fully_accepted: isFullyAccepted(recipients, result),
    },
  });
}));

router.get('/status', requirePermission('endpoints:tasks:read'), asyncHandler(async (req, res) => {
  const status = getNoticeStatus(noticeScope(req));
  res.json({ success: true, data: canSeeDeliveryDetail(req) ? status : redactNoticeStatus(status) });
}));

router.get('/', requirePermission('endpoints:tasks:read'), asyncHandler(async (req, res) => {
  const scope = noticeScope(req);
  const rawLimit = parseInt(String(req.query.limit ?? ''), 10);
  const rawOffset = parseInt(String(req.query.offset ?? ''), 10);
  // SQLite treats a negative LIMIT as unlimited, so clamp explicitly.
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 25;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;
  const state = req.query.state as string | undefined;
  if (state !== undefined && !NOTICE_STATES.includes(state as NoticeState)) {
    throw new AppError(`state must be one of ${NOTICE_STATES.join(', ')}`, 400);
  }
  const rows = listNotices(limit, offset, scope, state as NoticeState | undefined);
  res.json({ success: true, data: canSeeDeliveryDetail(req) ? rows : rows.map(redactNoticeListItem) });
}));

router.post(
  '/:id/release',
  requirePermission('endpoints:tasks:create'),
  validate(ReleaseNoticeSchema),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) throw new AppError('Unable to determine user identity', 401);
    // A notice of another org is "not found" (existence not revealed).
    const notice = releaseWithoutNotice(req.params.id, userId, req.body.reason, noticeScope(req));
    res.json({ success: true, data: notice });
  }),
);

export default router;
