// Sophos Central sync: every poll discovers the tenant (whoami), pulls Common
// Alerts, SIEM events and XDR detections, normalizes them and writes ONE row
// per Sophos detection into achilles-sophos (merge.ts decides the merges),
// then runs enrichment -> agent-kill reconciliation -> auto-resolve, and the
// posture pass every 6 h.
//
// Checkpoint rules (SentinelOne's):
//  - A source's checkpoint advances only after a clean run (to the run's start).
//  - 429 / 5xx / network / GraphQL errors pin it; a permanent per-doc 4xx
//    (mapping, parse) is reported but doesn't (it would fail the same way forever).
//  - sync_version: when the stored version differs, every checkpoint is
//    cleared ONCE and the new version saved before fetching; from then on each
//    source's checkpoint stands on its own (a failing source re-backfills alone).
//  - Only checkpoints that advanced are written.
//  - A credential / tenant change discards the run's checkpoints.
//
// SIEM events: Sophos keeps 24 h. When the last clean SIEM poll is more than
// 23 h old, the cursor is dropped, the feed restarts at now - 23 h and the
// window [last_siem_sync, restart] is recorded as `sync_gap` (status + settings).
// The gap stays visible until the checkpoints are reset or until a fully
// clean poll at least 24 h after the gap was detected clears it.

import type { Client } from '@elastic/elasticsearch';
import { SophosClient } from './sophos-client.js';
import { classifyUnavailable } from './capability.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';
import {
  SOPHOS_ALERT_BACKFILL_DAYS,
  SOPHOS_DEFAULT_DETECTION_BACKFILL_DAYS,
  SOPHOS_DEFAULT_POLL_INTERVAL_MINUTES,
  SOPHOS_MAX_DETECTION_BACKFILL_DAYS,
} from './defaults.js';
import { ensureSophosIndex, SOPHOS_INDEX } from './index-management.js';
import {
  parseLegacyCleanup,
  transformAlert,
  transformGraphqlDetection,
  transformSiemEvent,
  transformV1Detection,
  type SophosAlertDoc,
  type SophosLegacyCleanup,
} from './normalize.js';
import {
  addPollDocs,
  alertLookupWindows,
  findCandidates,
  planAlertWrites,
  planSiemWrites,
  planXdrWrites,
  siemLookupWindows,
  sophosDocId,
  xdrLookupWindows,
  type MergePlan,
  type SophosDocMap,
  type SophosReceiptMap,
} from './merge.js';
import {
  SOPHOS_DETECTION_POLL_QUERY,
  SOPHOS_DETECTION_SEARCH_QUERY,
  detectionCql,
  detectionPollVariables,
  detectionSearchVariables,
} from './detection-query.js';
import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import { SophosEnrichmentService } from './enrichment.service.js';
import { SophosAutoResolveService } from './auto-resolve.service.js';
import { SophosPostureService, POSTURE_INTERVAL_MS, type SophosPosturePassResult } from './posture.service.js';
import { runAgentKillReconciliation, failedAgentKillPass } from '../edr/agent-kill-reconcile.service.js';
import { runLaunchBlockReconciliation, failedLaunchBlockPass } from '../edr/launch-block-reconcile.service.js';
import type { AgentKillPassResult } from '../../types/agent-kill.js';
import type { LaunchBlockPassResult } from '../../types/launch-block.js';
import type { AutoResolvePassResult, EnrichmentPassResult } from '../../types/edr.js';
import type { SophosCapabilities, SophosCapabilityState, SophosIntegrationSettings } from '../../types/sophos.js';
import { describeError } from '../shared/networkError.js';

/** Bump when the doc schema changes to force a full re-backfill. */
// v2: XDR detections carry their File source_entities (the test's stage binary) in evidence.
export const SOPHOS_SYNC_VERSION = 2;
/** A SIEM checkpoint older than this can no longer be trusted (Sophos keeps 24 h). */
export const SOPHOS_SIEM_GAP_MS = 23 * 60 * 60 * 1000;
/** Re-read this much before a checkpoint to absorb clock skew / late writes. */
const CHECKPOINT_OVERLAP_MS = 2 * 60 * 1000;
/**
 * XDR detections are re-read for 30 min: Sophos adds entities (the process that
 * wrote a blocked file, i.e. the test stage) minutes after creating one, so a
 * copy stored between the two would otherwise never match its stage. Re-reads
 * are upserts, so correlation and auto-resolve receipts survive.
 */
const XDR_REFRESH_OVERLAP_MS = 30 * 60 * 1000;
/** A recorded gap stays visible at least this long after it was detected. */
const SYNC_GAP_VISIBLE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
/** Alerts are kept 90 days; stay an hour inside that so Sophos can't reject `from` as out of range. */
const ALERT_WINDOW_MS = SOPHOS_ALERT_BACKFILL_DAYS * DAY_MS - 60 * 60 * 1000;
const SIEM_MAX_PAGES = 1_000;
const DETECTION_PAGE_SIZE = 500;
/** GraphQL offset paging covers this many; beyond it, `detectionPoll(search_id)` returns further parts. */
const DETECTION_OFFSET_CAP = 10_000;
const DETECTION_MAX_POLLS = 100;
const V1_WRITE_CHUNK = 500;

export interface SophosSourceSyncResult { fetched: number; synced: number; merged: number; errors: string[] }

export interface SophosSyncResult {
  scopeChanged?: boolean;
  alerts?: SophosSourceSyncResult;
  siem_events?: SophosSourceSyncResult;
  xdr_detections?: SophosSourceSyncResult;
  enrichment?: EnrichmentPassResult;
  agentKill?: AgentKillPassResult;
  launchBlock?: LaunchBlockPassResult;
  autoResolve?: AutoResolvePassResult;
  posture?: SophosPosturePassResult;
  timestamp: string;
}

export interface SophosSyncStatus {
  lastSiemSync: string | null;
  lastAlertSync: string | null;
  lastDetectionSync: string | null;
  syncGap: { from: string; to: string } | null;
  lastSyncResult: SophosSyncResult | null;
  lastAttemptAt: string | null;
  lastError: { stage: string; message: string; at: string } | null;
  inProgress: boolean;
}

export { SOPHOS_DETECTION_SEARCH_QUERY, SOPHOS_DETECTION_POLL_QUERY };

interface DetectionsResponse {
  status?: string | null;
  reason?: string | null;
  search_id?: string | null;
  alerts?: { total_results?: number | null; total_parts?: number | null; part?: number | null; list?: unknown[] | null } | null;
}

type Outcome = 'clean' | 'pinned' | 'unavailable';

/** What one poll shares between its stages. */
interface PollContext {
  es: Client;
  client: SophosClient;
  /** Docs this poll wrote, so later stages merge into the freshest copy. */
  pollDocs: SophosDocMap;
  capabilities: SophosCapabilities;
}

const DEFAULT_CAPABILITIES: SophosCapabilities = { siem: 'unknown', alerts: 'unknown', xdr_graphql: 'unknown', xdr_rest: 'unknown', health_check: 'unknown' };

/** `api-eu01.central.sophos.com` -> `eu01`. */
function regionOf(host: string | null): string | undefined {
  return host ? /^api-([a-z]{2}\d{2})\./.exec(host)?.[1] : undefined;
}

function emptySource(): SophosSourceSyncResult {
  return { fetched: 0, synced: 0, merged: 0, errors: [] };
}

/** `checkpoint - 2 min`, never older than `maxMs`; `firstRunMs` back on the first run. */
function clampSince(checkpoint: string | null | undefined, maxMs: number, firstRunMs: number, now: number, overlapMs = CHECKPOINT_OVERLAP_MS): string {
  const floor = now - maxMs;
  const cp = checkpoint ? Date.parse(checkpoint) : NaN;
  const since = Number.isNaN(cp) ? now - Math.min(firstRunMs, maxMs) : Math.max(cp - overlapMs, floor);
  return new Date(since).toISOString();
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SophosSyncService {
  private status: SophosSyncStatus = {
    lastSiemSync: null,
    lastAlertSync: null,
    lastDetectionSync: null,
    syncGap: null,
    lastSyncResult: null,
    lastAttemptAt: null,
    lastError: null,
    inProgress: false,
  };
  /** SIEM cursor after the last cleanly written page of this poll. */
  private siemCursor: string | null = null;

  private settingsService(): IntegrationsSettingsService {
    return new IntegrationsSettingsService();
  }

  private getEsClient(): Client {
    const settings = new SettingsService().getSettings();
    if (!settings.configured) throw new Error('Elasticsearch is not configured');
    return createEsClient(settings);
  }

  /** True when the configured polling interval has elapsed since the last attempt. */
  isDue(now = Date.now()): boolean {
    if (this.status.inProgress) return false;
    const settings = this.settingsService().getSophosSettings();
    if (!settings?.configured) return false;
    const intervalMs = Math.max(1, settings.poll_interval_minutes ?? SOPHOS_DEFAULT_POLL_INTERVAL_MINUTES) * 60_000;
    if (!this.status.lastAttemptAt) return true;
    return now - Date.parse(this.status.lastAttemptAt) >= intervalMs;
  }

  /** Poll every source. Concurrent calls are coalesced (no overlap): a call during a run returns at once. */
  async syncAll(): Promise<SophosSyncResult> {
    const timestamp = new Date().toISOString();
    if (this.status.inProgress) return { timestamp };
    this.status.inProgress = true;
    this.status.lastAttemptAt = timestamp;
    // A failure from an earlier poll; cleared below if this poll gets through
    // without replacing it (only source errors clear themselves in reportSource).
    const errorBefore = this.status.lastError;
    let stage = 'setup';
    try {
      const svc = this.settingsService();
      const settings = svc.getSophosSettings();
      const creds = svc.getSophosCredentials();
      if (!settings || !creds) throw new Error('Sophos integration is not configured');

      const client = new SophosClient(creds);
      const es = this.getEsClient();

      stage = 'whoami';
      const who = await client.whoami();
      const tenantChanged = !!settings.tenant_id && settings.tenant_id !== who.id;
      if (tenantChanged) {
        // Checkpoints, cursor and gap belong to the previous tenant. Cleared
        // before the new tenant is recorded, so a crash in between can't leave
        // the old tenant's checkpoints under the new tenant id.
        console.log('[Sophos] tenant changed since the last sync: checkpoints discarded, backfilling');
        svc.resetSophosSyncTimestamps();
      }
      svc.saveSophosDiscovery({
        tenant_id: who.id,
        ...(who.dataRegionHost ? { api_host: who.dataRegionHost, data_region: regionOf(who.dataRegionHost) } : {}),
        last_auth_ok_at: new Date().toISOString(),
      });

      stage = 'index';
      await ensureSophosIndex();

      stage = 'checkpoints';
      let cp = tenantChanged ? {} : svc.getSophosSyncTimestamps();
      if (tenantChanged || cp.sync_version !== SOPHOS_SYNC_VERSION) {
        // New doc schema (or new tenant): clear every checkpoint once, then trust
        // each source's own checkpoint from here on.
        if (!tenantChanged) {
          console.log(`[Sophos] sync version ${String(cp.sync_version ?? 'none')} -> ${SOPHOS_SYNC_VERSION}: checkpoints cleared, backfilling`);
          svc.resetSophosSyncTimestamps();
        }
        svc.saveSophosSyncTimestamps({ sync_version: SOPHOS_SYNC_VERSION });
        cp = {};
      }
      this.status.lastAlertSync = cp.last_alert_sync ?? null;
      this.status.lastSiemSync = cp.last_siem_sync ?? null;
      this.status.lastDetectionSync = cp.last_detection_sync ?? null;
      this.siemCursor = cp.siem_cursor ?? null;
      this.status.syncGap = cp.sync_gap ?? null;
      const start = { alert: this.status.lastAlertSync, siem: this.status.lastSiemSync, detection: this.status.lastDetectionSync, cursor: this.siemCursor };

      const ctx: PollContext = { es, client, pollDocs: new Map(), capabilities: { ...DEFAULT_CAPABILITIES, ...settings.capabilities } };
      const result: SophosSyncResult = { timestamp };

      stage = 'alerts';
      const alerts = await this.syncAlerts(ctx);
      result.alerts = alerts.result;
      stage = 'siem_events';
      const siem = await this.syncSiemEvents(ctx);
      result.siem_events = siem.result;
      stage = 'xdr_detections';
      const detections = await this.syncDetections(ctx, settings);
      result.xdr_detections = detections.result;

      // The credential (and so the tenant) was changed while this sync ran: the
      // save already cleared the checkpoints, and writing this run's back would
      // skip the new tenant's backfill. Drop them and run again soon.
      const latest = svc.getSophosSettings();
      if (!latest || latest.client_id !== settings.client_id || (!!latest.tenant_id && latest.tenant_id !== who.id)) {
        console.log('[Sophos] credential or tenant changed during the sync: checkpoints discarded, re-syncing');
        this.status.lastAlertSync = null;
        this.status.lastSiemSync = null;
        this.status.lastDetectionSync = null;
        this.status.syncGap = null;
        this.siemCursor = null;
        this.status.lastAttemptAt = null; // isDue() -> true on the next tick
        result.scopeChanged = true;
        this.status.lastSyncResult = result;
        return result;
      }

      stage = 'checkpoints';
      svc.saveSophosDiscovery({ capabilities: ctx.capabilities });
      const allClean = [alerts.outcome, siem.outcome, detections.outcome].every((o) => o !== 'pinned');
      // Only what advanced is written; a pinned source keeps its stored checkpoint.
      const changed = <T,>(now: T, before: T): T | undefined => (now !== before ? now : undefined);
      svc.saveSophosSyncTimestamps({
        last_alert_sync: changed(this.status.lastAlertSync, start.alert) ?? undefined,
        last_siem_sync: changed(this.status.lastSiemSync, start.siem) ?? undefined,
        last_detection_sync: changed(this.status.lastDetectionSync, start.detection) ?? undefined,
        siem_cursor: changed(this.siemCursor, start.cursor),
        ...this.gapUpdate(siem.newGap, allClean),
      });

      // Correlate AFTER the poll so freshly-synced alerts are visible.
      result.enrichment = await this.runEnrichmentPass(es);
      // EDR-killed agent runs (any vendor's evidence). Never throws.
      result.agentKill = await runAgentKillReconciliation().catch(failedAgentKillPass);
      // Exit-260 runs an EDR's prevention alert proves it blocked at launch
      // become Protected (any capable vendor's evidence). Never throws.
      result.launchBlock = await runLaunchBlockReconciliation().catch(failedLaunchBlockPass);
      result.autoResolve = await this.runAutoResolvePass(es, client);
      const lastPosture = svc.getSophosSyncTimestamps().last_posture_sync;
      if (!lastPosture || Date.now() - Date.parse(lastPosture) >= POSTURE_INTERVAL_MS) {
        result.posture = await this.runPosturePass(es, client);
        // Only a pass that couldn't start (index unavailable / pass threw) retries next sync.
        if (!result.posture.errors.some((e) => e.startsWith('index:') || e.startsWith('pass:'))) {
          svc.saveSophosSyncTimestamps({ last_posture_sync: new Date().toISOString() });
        }
        const health = this.healthCapability(result.posture);
        if (health && health !== ctx.capabilities.health_check) {
          svc.saveSophosDiscovery({ capabilities: { ...ctx.capabilities, health_check: health } });
        }
      }

      if (this.status.lastError === errorBefore) this.status.lastError = null;
      this.status.lastSyncResult = result;
      return result;
    } catch (err) {
      const message = describeError(err);
      this.status.lastError = { stage, message, at: new Date().toISOString() };
      console.error(`[Sophos] sync failed (${stage}): ${message}`);
      const result: SophosSyncResult = { timestamp, alerts: { ...emptySource(), errors: [message] } };
      this.status.lastSyncResult = result;
      return result;
    } finally {
      this.status.inProgress = false;
    }
  }

  /**
   * sync_gap to persist: a gap found this poll is recorded; an older one is
   * cleared by a fully clean poll at least 24 h after it was detected (the
   * feed restarted at detection - 23 h, so detection = gap.to + 23 h).
   */
  private gapUpdate(newGap: { from: string; to: string } | null, allClean: boolean): { sync_gap?: { from: string; to: string } | null } {
    if (newGap) return { sync_gap: newGap };
    const gap = this.status.syncGap;
    if (!gap || !allClean) return {};
    const detectedAt = Date.parse(gap.to) + SOPHOS_SIEM_GAP_MS;
    if (Number.isNaN(detectedAt) || Date.now() - detectedAt < SYNC_GAP_VISIBLE_MS) return {};
    this.status.syncGap = null;
    return { sync_gap: null };
  }

  private healthCapability(r: SophosPosturePassResult): SophosCapabilityState | null {
    if (r.healthCheck) return 'available';
    const e = r.errors.find((x) => x.startsWith('health_check:'));
    if (e && /HTTP 403/.test(e)) return 'forbidden';
    return null;
  }

  // -------------------------------------------------------------------------
  // Sources
  // -------------------------------------------------------------------------

  private async syncAlerts(ctx: PollContext): Promise<{ result: SophosSourceSyncResult; outcome: Outcome }> {
    const startedAt = new Date().toISOString();
    const out = emptySource();
    const from = clampSince(this.status.lastAlertSync, ALERT_WINDOW_MS, ALERT_WINDOW_MS, Date.now());
    if (!this.status.lastAlertSync) console.log(`[Sophos] Initial alerts backfill — last ${SOPHOS_ALERT_BACKFILL_DAYS} day(s)`);
    let outcome: Outcome = 'clean';
    try {
      const pages = ctx.client.paginateKey((key) => ctx.client.listAlerts({ from, pageFromKey: key }));
      for await (const page of pages) {
        out.fetched += page.length;
        const docs = page.map(transformAlert).filter((d) => d.alert_id);
        if (docs.length === 0) continue;
        const ids = docs.map(sophosDocId);
        const windows = alertLookupWindows(docs);
        const receipts: SophosReceiptMap = new Map();
        const found = await findCandidates(ctx.es, { ids, windows, sourceTypes: ['siem_event'], receipts });
        addPollDocs(found, ctx.pollDocs, ids, windows);
        const plan = planAlertWrites(docs, found, receipts);
        if (await this.writePlan(ctx, plan, out)) outcome = 'pinned';
      }
      ctx.capabilities.alerts = 'available';
    } catch (err) {
      outcome = this.sourceFailed(ctx, 'alerts', err, out);
    }
    if (outcome === 'clean') this.status.lastAlertSync = startedAt;
    this.reportSource('alerts', out);
    return { result: out, outcome };
  }

  private async syncSiemEvents(ctx: PollContext): Promise<{ result: SophosSourceSyncResult; outcome: Outcome; newGap: { from: string; to: string } | null }> {
    const startedAt = new Date().toISOString();
    const now = Date.now();
    const out = emptySource();
    let newGap: { from: string; to: string } | null = null;

    const last = this.status.lastSiemSync;
    const lastMs = last ? Date.parse(last) : NaN;
    const restartAt = Math.floor((now - SOPHOS_SIEM_GAP_MS) / 1000);
    let fromDate: number | undefined;
    if (!Number.isNaN(lastMs) && now - lastMs > SOPHOS_SIEM_GAP_MS) {
      // Sophos keeps 24 h and silently restarts an expired cursor there: say so.
      fromDate = restartAt;
      newGap = { from: last!, to: new Date(restartAt * 1000).toISOString() };
      this.siemCursor = null;
      this.status.syncGap = newGap;
      console.warn(`[Sophos] SIEM events between ${newGap.from} and ${newGap.to} were not collected (Sophos keeps 24 h)`);
    } else if (!this.siemCursor) {
      fromDate = Number.isNaN(lastMs) ? restartAt : Math.max(restartAt, Math.floor((lastMs - CHECKPOINT_OVERLAP_MS) / 1000));
    }

    let outcome: Outcome = 'clean';
    try {
      let cursor = this.siemCursor;
      const seen = new Set<string>();
      for (let page = 0; page < SIEM_MAX_PAGES; page++) {
        const res = await ctx.client.siemEvents(cursor ? { cursor } : { fromDate });
        out.fetched += res.items.length;
        const events: SophosAlertDoc[] = [];
        const cleanups: SophosLegacyCleanup[] = [];
        for (const item of res.items) {
          const doc = transformSiemEvent(item);
          if (doc?.alert_id) { events.push(doc); continue; }
          const cleanup = parseLegacyCleanup(item);
          if (cleanup?.id) cleanups.push(cleanup);
        }
        if (events.length > 0 || cleanups.length > 0) {
          const windows = siemLookupWindows(events, cleanups);
          const receipts: SophosReceiptMap = new Map();
          const found = await findCandidates(ctx.es, { windows, sourceTypes: ['alert', 'siem_event', 'xdr_detection'], receipts });
          addPollDocs(found, ctx.pollDocs, events.map(sophosDocId), windows);
          const plan = planSiemWrites(events, cleanups, found, receipts);
          // A retryable write failure: don't move the cursor past this page.
          if (await this.writePlan(ctx, plan, out)) { outcome = 'pinned'; break; }
        }
        if (res.next_cursor) this.siemCursor = res.next_cursor;
        if (!res.has_more || !res.next_cursor || seen.has(res.next_cursor)) break;
        seen.add(res.next_cursor);
        cursor = res.next_cursor;
      }
      ctx.capabilities.siem = 'available';
    } catch (err) {
      outcome = this.sourceFailed(ctx, 'siem', err, out);
    }
    if (outcome === 'clean') this.status.lastSiemSync = startedAt;
    this.reportSource('siem_events', out);
    return { result: out, outcome, newGap };
  }

  /** GraphQL detectionSearch first; REST v1 only when GraphQL is not available to this credential. */
  private async syncDetections(ctx: PollContext, settings: SophosIntegrationSettings): Promise<{ result: SophosSourceSyncResult; outcome: Outcome }> {
    const startedAt = new Date().toISOString();
    const now = Date.now();
    const out = emptySource();
    const backfillDays = Math.min(Math.max(settings.detection_backfill_days ?? SOPHOS_DEFAULT_DETECTION_BACKFILL_DAYS, 1), SOPHOS_MAX_DETECTION_BACKFILL_DAYS);
    const since = clampSince(this.status.lastDetectionSync, SOPHOS_MAX_DETECTION_BACKFILL_DAYS * DAY_MS, backfillDays * DAY_MS, now, XDR_REFRESH_OVERLAP_MS);
    if (!this.status.lastDetectionSync) console.log(`[Sophos] Initial XDR detections backfill — last ${backfillDays} day(s)`);

    let outcome: Outcome = 'clean';
    try {
      outcome = await this.syncGraphqlDetections(ctx, since, now, out);
      ctx.capabilities.xdr_graphql = 'available';
    } catch (err) {
      const state = out.fetched === 0 ? classifyUnavailable(err) : null;
      if (!state) {
        outcome = this.sourceFailed(ctx, 'xdr_detections', err, out);
      } else {
        ctx.capabilities.xdr_graphql = state;
        // A plain 404 may be a wrong route, not a missing licence: keep the evidence visible.
        if (state === 'unknown') out.errors.push(describeError(err));
        console.warn(`[Sophos] XDR GraphQL ${state}; falling back to REST v1 detections`);
        try {
          const items = await ctx.client.detectionsV1({ from: since, to: new Date(now).toISOString() });
          out.fetched += items.length;
          const docs = items.map(transformV1Detection).filter((d) => d.alert_id);
          for (let i = 0; i < docs.length; i += V1_WRITE_CHUNK) {
            if (await this.writeDetections(ctx, docs.slice(i, i + V1_WRITE_CHUNK), out)) outcome = 'pinned';
          }
          ctx.capabilities.xdr_rest = 'available';
        } catch (restErr) {
          outcome = this.sourceFailed(ctx, 'xdr_rest', restErr, out);
        }
      }
    }
    if (outcome === 'clean') this.status.lastDetectionSync = startedAt;
    this.reportSource('xdr_detections', out);
    return { result: out, outcome };
  }

  private async syncGraphqlDetections(ctx: PollContext, since: string, now: number, out: SophosSourceSyncResult): Promise<Outcome> {
    // Relative window (shared with the capture kit); minutes since the overlapped checkpoint.
    const cql = detectionCql((now - Date.parse(since)) / 60_000);
    let outcome: Outcome = 'clean';
    const writePage = async (list: unknown[]) => {
      out.fetched += list.length;
      const docs = list.map(transformGraphqlDetection).filter((d) => d.alert_id);
      if (docs.length > 0 && await this.writeDetections(ctx, docs, out)) outcome = 'pinned';
    };

    // With a known total_results, stopping short of it is never clean (the
    // detections in between would be skipped by the advanced checkpoint). The
    // short-page rule only ends the search when no total is reported.
    let fetched = 0;
    let total: number | null = null;
    const incomplete = (op: string) =>
      new Error(`Sophos ${op} returned ${fetched} of ${total} detections; the detection checkpoint was not advanced`);

    let searchId: string | null = null;
    for (;;) {
      const data = await ctx.client.graphql<{ detectionSearch?: DetectionsResponse | null }>(SOPHOS_DETECTION_SEARCH_QUERY,
        detectionSearchVariables(cql, fetched, DETECTION_PAGE_SIZE));
      const res = checkedResponse(data?.detectionSearch, 'detectionSearch');
      const list = res.alerts?.list ?? [];
      await writePage(list);
      fetched += list.length;
      total = typeof res.alerts?.total_results === 'number' ? res.alerts.total_results : total;
      searchId = res.search_id || searchId;
      if (total !== null) {
        if (fetched >= total) return outcome;
        if (list.length === 0) throw incomplete('detectionSearch');
      } else if (list.length < DETECTION_PAGE_SIZE) {
        return outcome;
      }
      if (fetched >= DETECTION_OFFSET_CAP) break;
    }

    // More than 10k detections in the window: the rest comes as parts of the search.
    if (!searchId) throw new Error('Sophos detectionSearch returned more than 10000 detections and no search_id to continue');
    for (let i = 0; i < DETECTION_MAX_POLLS; i++) {
      const data = await ctx.client.graphql<{ detectionPoll?: DetectionsResponse | null }>(SOPHOS_DETECTION_POLL_QUERY, detectionPollVariables(searchId));
      const res = checkedResponse(data?.detectionPoll, 'detectionPoll');
      const list = res.alerts?.list ?? [];
      await writePage(list);
      fetched += list.length;
      total = typeof res.alerts?.total_results === 'number' ? res.alerts.total_results : total;
      if (total !== null && fetched >= total) return outcome;
      const part = res.alerts?.part ?? 0;
      const parts = res.alerts?.total_parts ?? 0;
      if (list.length === 0 || part >= parts) {
        if (total !== null) throw incomplete('detectionPoll');
        return outcome;
      }
    }
    throw new Error(`Sophos detectionPoll did not finish within ${DETECTION_MAX_POLLS} parts`);
  }

  /**
   * One page of XDR detections (GraphQL or REST v1): each absorbs the stored
   * siem_event rows describing the same block (merge.ts (d)); a row a Common
   * Alert matches is left to the alert. Returns writePlan's retry flag.
   */
  private async writeDetections(ctx: PollContext, docs: SophosAlertDoc[], out: SophosSourceSyncResult): Promise<boolean> {
    if (docs.length === 0) return false;
    const ids = docs.map(sophosDocId);
    const windows = xdrLookupWindows(docs);
    const receipts: SophosReceiptMap = new Map();
    const found = await findCandidates(ctx.es, { ids, windows, sourceTypes: ['siem_event', 'alert'], receipts });
    addPollDocs(found, ctx.pollDocs, ids, windows);
    return this.writePlan(ctx, planXdrWrites(docs, found, receipts), out);
  }

  /**
   * Classify a source failure. A surface this credential/tenant can't use
   * (403/404) is recorded as a capability and doesn't hold sync_version back;
   * anything else pins the source's checkpoint. Alerts / SIEM unavailability
   * is still reported as an error (it is a role problem the admin must fix);
   * a tenant without XDR is not an error.
   */
  private sourceFailed(ctx: PollContext, source: 'alerts' | 'siem' | 'xdr_detections' | 'xdr_rest', err: unknown, out: SophosSourceSyncResult): Outcome {
    // A GraphQL failure that is not "unavailable" never reaches here as unavailable (no fallback ran).
    const state = source === 'xdr_detections' ? null : classifyUnavailable(err);
    if (state && source === 'xdr_rest') {
      ctx.capabilities.xdr_rest = state;
      console.warn(`[Sophos] XDR REST detections ${state}: this credential/tenant has no XDR detections`);
      if (state === 'unknown') out.errors.push(describeError(err));
      return 'unavailable';
    }
    if (state && (source === 'alerts' || source === 'siem')) ctx.capabilities[source] = state;
    out.errors.push(describeError(err));
    return state ? 'unavailable' : 'pinned';
  }

  private reportSource(source: string, out: SophosSourceSyncResult): void {
    if (out.errors.length > 0) {
      this.status.lastError = { stage: source, message: out.errors[0], at: new Date().toISOString() };
      console.error(`[Sophos] ${source} sync: ${out.errors.length} error(s) — ${out.errors[0]}`);
    } else if (this.status.lastError?.stage === source) {
      this.status.lastError = null;
    }
    console.log(`[Sophos] ${source} sync: fetched=${out.fetched} synced=${out.synced} merged=${out.merged} errors=${out.errors.length}`);
  }

  /**
   * Write a plan: upserts first (update + doc_as_upsert keeps f0rtika.*
   * receipts), then deletes of absorbed siem_event rows whose absorbing doc
   * was written. Returns true when something retryable failed (429 / 5xx /
   * status 0), which pins the source's checkpoint.
   */
  private async writePlan(ctx: PollContext, plan: MergePlan, out: SophosSourceSyncResult): Promise<boolean> {
    let retryNeeded = false;
    const failed = new Set<string>();
    const collect = (items: Array<Record<string, { _id?: string | null; status?: number; error?: { reason?: string | null } } | undefined>>, kind: 'update' | 'delete') => {
      for (const item of items) {
        const op = item[kind];
        if (!op?.error) continue;
        if (op._id) failed.add(op._id);
        const status = op.status ?? 0;
        if (status === 429 || status >= 500 || status === 0) retryNeeded = true;
        if (out.errors.length < 20) out.errors.push(`${op._id}: ${op.error.reason}`);
      }
    };

    if (plan.upserts.size > 0) {
      const operations = [...plan.upserts].flatMap(([id, doc]) => [
        { update: { _index: SOPHOS_INDEX, _id: id, retry_on_conflict: 3 } },
        { doc, doc_as_upsert: true },
      ]);
      const res = await ctx.es.bulk({ operations, refresh: 'wait_for' });
      if (res.errors) collect(res.items as never, 'update');
      out.synced += plan.upserts.size - failed.size;
    }
    out.merged += plan.merged;

    for (const [id, doc] of plan.upserts) {
      if (failed.has(id)) continue;
      // A carried receipt is in ES now; later pages read it back via findCandidates, never re-write it.
      const { f0rtika: _carried, ...stripped } = doc;
      ctx.pollDocs.set(id, stripped);
    }
    // Deleting an id that was never stored is a no-op ('not_found', not an error).
    const deletes = [...plan.deletes].filter(([, target]) => !failed.has(target)).map(([id]) => id);
    if (deletes.length > 0) {
      const res = await ctx.es.bulk({ operations: deletes.map((id) => ({ delete: { _index: SOPHOS_INDEX, _id: id } })), refresh: 'wait_for' });
      if (res.errors) collect(res.items as never, 'delete');
      for (const id of deletes) ctx.pollDocs.delete(id);
    }
    return retryNeeded;
  }

  // -------------------------------------------------------------------------
  // Post-poll passes (never throw)
  // -------------------------------------------------------------------------

  /** Correlate Sophos alerts with Achilles test results (f0rtika.sophos_* flags). Never throws. */
  async runEnrichmentPass(es?: Client): Promise<EnrichmentPassResult> {
    const empty = (errors: string[] = []): EnrichmentPassResult => ({
      scanned: 0, detected: 0, stageDetected: 0, skipped: 0, batches: 0, alertsMarkedCorrelated: 0, errors, durationMs: 0,
    });
    try {
      if (!this.settingsService().getSophosSettings()?.configured) return empty();
      const client = es ?? this.getEsClient();
      const indexPattern = new SettingsService().getSettings().indexPattern;
      const result = await new SophosEnrichmentService(client, indexPattern).runEnrichmentPass({ lookbackDays: 90 });
      console.log(
        `[Sophos-Enrichment] scanned=${result.scanned} detected=${result.detected} ` +
        `stageDetected=${result.stageDetected} alertsCorrelated=${result.alertsMarkedCorrelated} ` +
        `durationMs=${result.durationMs} errors=${result.errors.length}`,
      );
      for (const e of result.errors.slice(0, 5)) console.warn(`[Sophos-Enrichment-ERROR] ${e}`);
      return result;
    } catch (err) {
      const msg = describeError(err);
      console.error(`[Sophos-Enrichment] pass threw: ${msg}`);
      return empty([msg]);
    }
  }

  /** Auto-resolve of test-matched alerts / detections (default disabled). Never throws. */
  private async runAutoResolvePass(es: Client, client: SophosClient): Promise<AutoResolvePassResult> {
    let mode: AutoResolvePassResult['mode'] = 'disabled';
    try {
      mode = this.settingsService().getSophosAutoResolveMode();
      const r = await new SophosAutoResolveService(es, client, mode).runAutoResolvePass();
      if (r.mode !== 'disabled') {
        console.log(`[Sophos-AutoResolve] mode=${r.mode} candidates=${r.candidates} resolved=${r.patched} wouldResolve=${r.wouldPatch} errors=${r.errors.length}`);
      }
      return r;
    } catch (err) {
      return { mode, candidates: 0, patched: 0, wouldPatch: 0, skipped: 0, errors: [describeError(err)], durationMs: 0 };
    }
  }

  /** Read-only posture pass (Health Check, endpoints, policies, exclusions). Never throws. */
  private async runPosturePass(es: Client, client: SophosClient): Promise<SophosPosturePassResult> {
    try {
      const r = await new SophosPostureService(es, client).runPosturePass();
      console.log(
        `[Sophos-Posture] healthCheck=${r.healthCheck} history=${r.historyImported} endpoints=${r.endpoints} ` +
        `policies=${r.policies} exclusions=${r.exclusions} allowedItems=${r.allowedItems} errors=${r.errors.length}`,
      );
      for (const e of r.errors.slice(0, 5)) console.warn(`[Sophos-Posture-ERROR] ${e}`);
      return r;
    } catch (err) {
      return { healthCheck: false, historyImported: 0, endpoints: 0, policies: 0, exclusions: 0, allowedItems: 0, errors: [`pass: ${describeError(err)}`] };
    }
  }

  /** Force the next run to redo the initial backfill (also clears a recorded sync gap). */
  resetCheckpoints(): void {
    this.settingsService().resetSophosSyncTimestamps();
    this.status.lastAlertSync = null;
    this.status.lastSiemSync = null;
    this.status.lastDetectionSync = null;
    this.status.syncGap = null;
    this.siemCursor = null;
  }

  getSyncStatus(): SophosSyncStatus {
    return { ...this.status };
  }
}

function checkedResponse(res: DetectionsResponse | null | undefined, op: string): DetectionsResponse {
  if (!res) throw new Error(`Sophos ${op} returned no data`);
  if (res.status && res.status !== 'OK') {
    throw new Error(`Sophos ${op} failed: ${String(res.status).slice(0, 40)}${res.reason ? ` (${String(res.reason).slice(0, 200)})` : ''}`);
  }
  return res;
}
