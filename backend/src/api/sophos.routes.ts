// Sophos Central integration routes — mounted at /api/integrations/sophos.
//
// Permission model (mirrors SentinelOne):
//   - integrations:read   → view settings (masked), sync status, auto-resolve status/receipts
//   - integrations:write  → save/test/delete credentials, manual sync, auto-resolve mode
// Ingested alerts are read through /api/analytics/sophos. There are no manual
// response-action routes: console writes happen only in the opt-in auto-resolve
// pass, which requires permission_mode === 'response'; the Sophos client
// independently refuses every write in read_only mode.

import { Router } from 'express';
import type { Request } from 'express';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { requireDeploymentScopeForEdrWrite } from '../middleware/edrScope.middleware.js';
import { validate } from '../middleware/validation.js';
import {
  SophosSettingsSchema,
  SophosTestSchema,
  SophosSyncSchema,
  SophosAutoResolveModeSchema,
} from '../schemas/sophos.schemas.js';
import { IntegrationsSettingsService } from '../services/integrations/settings.js';
import { SophosClient } from '../services/sophos/sophos-client.js';
import { classifyUnavailable } from '../services/sophos/capability.js';
import { SophosSyncService, SOPHOS_DETECTION_SEARCH_QUERY } from '../services/sophos/sync.service.js';
import type { SophosSyncStatus } from '../services/sophos/sync.service.js';
import { detectionCql, detectionSearchVariables } from '../services/sophos/detection-query.js';
import { SOPHOS_INDEX } from '../services/sophos/index-management.js';
import { SettingsService as AnalyticsSettingsService } from '../services/analytics/settings.js';
import { createEsClient } from '../services/analytics/client.js';
import type { SophosCapabilities, SophosCapabilityState } from '../types/sophos.js';

const router = Router();
router.use(requireClerkAuth());

export const sophosSyncService = new SophosSyncService();

/** Deployment-wide, like the other EDRs: the background sync reads only these settings. */
function getSettingsService(_req: Request): IntegrationsSettingsService {
  return new IntegrationsSettingsService();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** GET /api/integrations/sophos — masked settings (secret never returned). */
router.get('/', requirePermission('integrations:read'), (req, res) => {
  res.json(getSettingsService(req).getSophosSettingsMasked());
});

/** POST /api/integrations/sophos — save settings (partial update). */
router.post('/', requirePermission('integrations:write'), requireDeploymentScopeForEdrWrite, validate(SophosSettingsSchema), asyncHandler(async (req, res) => {
  const svc = getSettingsService(req);
  // A saved file section outranks the env credentials, so it would silently
  // shadow them (and desync the sync checkpoints, which live under sophos_sync).
  if (svc.isEnvSophosConfigured()) {
    throw new AppError('Sophos credentials are set via environment variables (SOPHOS_CLIENT_ID, SOPHOS_CLIENT_SECRET) and cannot be changed here. Remove these env vars to configure Sophos from the UI.', 400);
  }
  const body = req.body as Record<string, any>;
  const storedId = svc.getSophosCredentials()?.client_id;
  if (body.client_id && storedId && body.client_id !== storedId && !body.client_secret) {
    throw new AppError('Enter the client secret for the new client ID (the saved secret is only used with the saved client ID)', 400);
  }
  if (!svc.isSophosConfigured() && (!body.client_id || !body.client_secret)) {
    throw new AppError('client_id and client_secret are required for initial setup', 400);
  }

  try {
    svc.saveSophosSettings(body);
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : String(err), 400);
  }

  // Start pulling right away instead of waiting for the next poll tick.
  sophosSyncService.syncAll().catch((err) => {
    console.warn('⚠ Sophos sync after settings save failed:', err instanceof Error ? err.message : err);
  });

  res.json({ success: true });
}));

/** DELETE /api/integrations/sophos — remove stored settings. */
router.delete('/', requirePermission('integrations:write'), requireDeploymentScopeForEdrWrite, asyncHandler(async (req, res) => {
  try {
    getSettingsService(req).deleteSophosSettings();
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : String(err), 400);
  }
  res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// Test connection + capability probe
// ---------------------------------------------------------------------------

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function probe(fn: () => Promise<unknown>): Promise<SophosCapabilityState> {
  try {
    await fn();
    return 'available';
  } catch (err) {
    return classifyUnavailable(err) ?? 'unknown';
  }
}

/** One cheap read per capability (read-only client). */
async function probeCapabilities(client: SophosClient, previous?: SophosCapabilities): Promise<SophosCapabilities> {
  const [alerts, siem, health] = await Promise.all([
    probe(() => client.listAlerts({ pageSize: 1 })),
    probe(() => client.siemEvents({ limit: 200 })),
    probe(() => client.healthCheck()),
  ]);
  const xdr_graphql = await probe(() =>
    client.graphql(SOPHOS_DETECTION_SEARCH_QUERY, detectionSearchVariables(detectionCql(5), 0, 1)));
  // The REST v1 query is a run + poll: only worth it when GraphQL is not usable.
  let xdr_rest: SophosCapabilityState = previous?.xdr_rest ?? 'unknown';
  if (xdr_graphql !== 'available') {
    const now = new Date();
    xdr_rest = await probe(() => client.detectionsV1({ from: new Date(now.getTime() - 5 * 60_000).toISOString(), to: now.toISOString() }));
  }
  return { alerts, siem, health_check: health, xdr_graphql, xdr_rest };
}

/** POST /api/integrations/sophos/test — authenticate, identify the tenant, probe each API surface. */
router.post('/test', requirePermission('integrations:write'), requireDeploymentScopeForEdrWrite, validate(SophosTestSchema), asyncHandler(async (req, res) => {
  const { client_id, client_secret } = req.body as { client_id?: string; client_secret?: string };
  const stored = getSettingsService(req).getSophosCredentials();
  const effectiveId = client_id || stored?.client_id;
  if (!effectiveId) {
    res.json({ success: false, error: 'Missing credentials: client ID and client secret are required' });
    return;
  }
  // The stored secret is only ever sent with the stored client id: testing a
  // different client needs its own secret.
  const usingStored = !client_secret && !!stored && effectiveId === stored.client_id;
  const effectiveSecret = client_secret || (usingStored ? stored!.client_secret : undefined);
  if (!effectiveSecret) {
    res.json({ success: false, error: stored ? 'Enter the client secret for this client ID (the saved secret is only used with the saved client ID)' : 'Missing credentials: client ID and client secret are required' });
    return;
  }

  const client = new SophosClient({ client_id: effectiveId, client_secret: effectiveSecret, permission_mode: 'read_only' });
  let who;
  try {
    who = await client.whoami();
  } catch (err) {
    // Redaction of the secret happens in the client's error path.
    res.json({ success: false, error: describeError(err) });
    return;
  }
  const region = who.dataRegionHost ? /^api-([a-z]{2}\d{2})\./.exec(who.dataRegionHost)?.[1] : undefined;
  const previous = new IntegrationsSettingsService().getSophosSettings()?.capabilities;
  const capabilities = await probeCapabilities(client, usingStored ? previous : undefined);

  if (usingStored) {
    try {
      getSettingsService(req).saveSophosDiscovery({ tenant_id: who.id, capabilities, ...(who.dataRegionHost ? { api_host: who.dataRegionHost, ...(region ? { data_region: region } : {}) } : {}), last_auth_ok_at: new Date().toISOString() });
    } catch (err) {
      console.warn('[Sophos] could not persist the test result:', describeError(err));
    }
  }
  res.json({ success: true, region, tenantId: who.id, capabilities });
}));

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * POST /api/integrations/sophos/sync — start a manual sync ({ reset: true }
 * re-runs the backfill). Returns 202 at once; poll /sync/status. A request
 * while a sync runs starts nothing and does not reset: `started: false`.
 */
router.post('/sync', requirePermission('integrations:write'), requireDeploymentScopeForEdrWrite, validate(SophosSyncSchema), asyncHandler(async (req, res) => {
  if (!new IntegrationsSettingsService().isSophosConfigured()) {
    throw new AppError('Sophos integration is not configured', 400);
  }
  if (sophosSyncService.getSyncStatus().inProgress) {
    res.status(202).json({ success: true, data: { started: false, inProgress: true } });
    return;
  }
  if (req.body?.reset && process.env.REQUIRE_ORG_ISOLATION === 'true') {
    throw new AppError('A Sophos re-backfill affects every organization; it is not available when REQUIRE_ORG_ISOLATION=true.', 403);
  }
  if (req.body?.reset) sophosSyncService.resetCheckpoints();
  sophosSyncService.syncAll().catch((err) => {
    console.warn('⚠ Sophos manual sync failed:', err instanceof Error ? err.message : err);
  });
  res.status(202).json({ success: true, data: { started: true, inProgress: true } });
}));

/**
 * GET /api/integrations/sophos/sync/status. The in-memory status is empty
 * after a restart, so the persisted checkpoints and gap fill the blanks.
 */
router.get('/sync/status', requirePermission('integrations:read'), (req, res) => {
  const status: SophosSyncStatus = sophosSyncService.getSyncStatus();
  const persisted = getSettingsService(req).getSophosSyncTimestamps();
  res.json({
    ...status,
    lastSiemSync: status.lastSiemSync ?? persisted.last_siem_sync ?? null,
    lastAlertSync: status.lastAlertSync ?? persisted.last_alert_sync ?? null,
    lastDetectionSync: status.lastDetectionSync ?? persisted.last_detection_sync ?? null,
    syncGap: status.syncGap ?? persisted.sync_gap ?? null,
  });
});

// ---------------------------------------------------------------------------
// Auto-resolve (default disabled)
// ---------------------------------------------------------------------------

function esClientOrNull() {
  const settings = new AnalyticsSettingsService().getSettings();
  return settings.configured ? createEsClient(settings) : null;
}

const WINDOWS = [['last24h', 'now-24h'], ['last7d', 'now-7d'], ['last30d', 'now-30d']] as const;

/**
 * Receipt counts over 24h / 7d / 30d. `counts` are real resolutions only
 * (f0rtika.auto_resolved); dry-run "would resolve" receipts, which never set
 * auto_resolved, are counted separately under `dry_run`.
 */
async function receiptCounts() {
  const counts = { last24h: 0, last7d: 0, last30d: 0 };
  const dryRun = { last24h: 0, last7d: 0, last30d: 0 };
  const es = esClientOrNull();
  if (!es) return { counts, dryRun };
  for (const [key, gte] of WINDOWS) {
    const count = async (filter: object[]): Promise<number> => {
      try {
        const resp = await es.count({ index: SOPHOS_INDEX, query: { bool: { filter: [{ term: { doc_type: 'alert' } }, ...filter] } } });
        return typeof resp.count === 'number' ? resp.count : 0;
      } catch {
        return 0; // Missing index / transient.
      }
    };
    counts[key] = await count([
      { term: { 'f0rtika.auto_resolved': true } },
      { range: { 'f0rtika.auto_resolved_at': { gte } } },
    ]);
    // A doc a later enabled pass really resolved keeps its old dry_run_at: it counts once, as resolved.
    dryRun[key] = await count([
      { range: { 'f0rtika.auto_resolve_dry_run_at': { gte } } },
      { bool: { must_not: [{ term: { 'f0rtika.auto_resolved': true } }] } },
    ]);
  }
  return { counts, dryRun };
}

/** Painless: the receipt's own time (resolved_at, else dry_run_at) as epoch millis; guarded for fields an older index never mapped. */
export const RECEIPT_TIME_SORT = {
  _script: {
    type: 'number',
    order: 'desc',
    script: {
      lang: 'painless',
      source: "def r = 'f0rtika.auto_resolved_at'; def d = 'f0rtika.auto_resolve_dry_run_at'; if (doc.containsKey(r) && doc[r].size() > 0) { return doc[r].value.toInstant().toEpochMilli(); } if (doc.containsKey(d) && doc[d].size() > 0) { return doc[d].value.toInstant().toEpochMilli(); } return 0L;",
    },
  },
};

async function receiptList(req: Request) {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
  const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
  const fields = ['auto_resolved_at', 'auto_resolve_dry_run_at', 'auto_resolve_mode', 'auto_resolve_error'];
  const es = esClientOrNull();
  if (!es) return { items: [], total: 0, limit, offset };
  try {
    const resp = await es.search({
      index: SOPHOS_INDEX,
      size: limit,
      from: offset,
      // Real resolutions and dry-run "would resolve" receipts (dry run never sets auto_resolved).
      query: { bool: {
        filter: [{ term: { doc_type: 'alert' } }],
        should: [{ term: { 'f0rtika.auto_resolved': true } }, { exists: { field: 'f0rtika.auto_resolve_dry_run_at' } }],
        minimum_should_match: 1,
      } },
      // A receipt has one of the two times; sort newest first by whichever it has
      // (two plain sort keys would put every dry run after every real resolution).
      sort: [RECEIPT_TIME_SORT],
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
    const e = err as { statusCode?: number; meta?: { statusCode?: number }; message?: string };
    const status = e?.statusCode ?? e?.meta?.statusCode;
    // No index yet is a legitimately empty list; anything else must not look like "no receipts".
    if (status === 404 || /index_not_found/.test(String(e?.message))) return { items: [], total: 0, limit, offset };
    console.warn('[sophos receipts] query failed:', e?.message ?? String(err));
    throw new AppError(`Could not load auto-resolve receipts: ${e?.message ?? 'Elasticsearch query failed'}`, 502);
  }
}

/** GET /api/integrations/sophos/auto-resolve/status */
router.get('/auto-resolve/status', requirePermission('integrations:read'), asyncHandler(async (req, res) => {
  const svc = getSettingsService(req);
  const { counts, dryRun } = await receiptCounts();
  res.json({
    success: true,
    data: {
      mode: svc.getSophosAutoResolveMode(),
      permission_mode: svc.getSophosPermissionMode(),
      counts,
      dry_run_counts: dryRun,
      lastAutoResolve: sophosSyncService.getSyncStatus().lastSyncResult?.autoResolve ?? null,
    },
  });
}));

/** PUT /api/integrations/sophos/auto-resolve/mode — { mode }; 'enabled' requires Response mode */
router.put('/auto-resolve/mode', requirePermission('integrations:write'), requireDeploymentScopeForEdrWrite, validate(SophosAutoResolveModeSchema), asyncHandler(async (req, res) => {
  const { mode } = req.body as { mode: 'disabled' | 'dry_run' | 'enabled' };
  try {
    getSettingsService(req).setSophosAutoResolveMode(mode);
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : String(err), 400);
  }
  res.json({ success: true, data: { mode } });
}));

/** GET /api/integrations/sophos/auto-resolve/receipts?limit&offset */
router.get('/auto-resolve/receipts', requirePermission('integrations:read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await receiptList(req) });
}));

export default router;
