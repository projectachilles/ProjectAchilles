// SentinelOne alert sync — polls the Management API on a configurable interval,
// normalizes threats + cloud-detection alerts and upserts them into ES.
//
//  - Initial run: backfill `backfill_days` (≤ 365 — the console retention).
//  - Afterwards: incremental from the persisted checkpoint (with a small
//    overlap window); docs are keyed by S1 id so re-fetches dedupe.
//  - Pages are streamed through cursor pagination and bulk-indexed page by
//    page, so a 1-year backfill never holds the whole result set in memory.

import type { Client } from '@elastic/elasticsearch';
import { SentinelOneClient } from './s1-client.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';
import { S1_DEFAULT_BACKFILL_DAYS, S1_DEFAULT_POLL_INTERVAL_MINUTES, S1_DEFAULT_SOURCES, S1_MAX_BACKFILL_DAYS } from './defaults.js';
import { ensureSentinelOneIndex, SENTINELONE_INDEX } from './index-management.js';
import { normalizeToken, threatPreventionAction } from './normalize.js';
import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import { CrowdStrikeEnrichmentService } from '../crowdstrike/enrichment.service.js';
import { SentinelOneAutoResolveService } from './auto-resolve.service.js';
import { SentinelOneAutoMitigationService } from './auto-mitigation.service.js';
import { SentinelOneResponseService } from './response.service.js';
import { SentinelOnePostureService, POSTURE_INTERVAL_MS } from './posture.service.js';
import type { AutoResolvePassResult, EnrichmentPassResult } from '../../types/defender.js';
import type {
  S1Threat,
  S1CloudDetectionAlert,
  SentinelOneAlertDoc,
  SentinelOneIntegrationSettings,
  SentinelOneSeverity,
  SentinelOneSource,
  SentinelOneSourceSyncResult,
  SentinelOneSyncResult,
  SentinelOneSyncStatus,
  AutoMitigationPassResult,
  SentinelOnePosturePassResult,
} from '../../types/sentinelone.js';

/** Bump when the doc schema changes to force a full re-backfill. */
// v2: lowercase incident status / analyst verdict, resolved_at for detection
//     alerts, evidence_filenames derived from file paths and process names.
export const SENTINELONE_SYNC_VERSION = 2;
/** Re-read this much before the checkpoint to absorb clock skew / late writes. */
const CHECKPOINT_OVERLAP_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// Normalization (pure — exported for tests)
// ---------------------------------------------------------------------------

const TECHNIQUE_RE = /T\d{4}(?:[./]\d{3})?/g;

function extractTechniques(values: Array<string | undefined>): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    for (const m of v.match(TECHNIQUE_RE) ?? []) out.add(m.replace('/', '.'));
  }
  return Array.from(out);
}

export { normalizeToken, threatPreventionAction };

/** File name of a Windows (`\device\...`, `C:\...`) or POSIX path. */
function basename(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const name = path.split(/[\\/]/).pop();
  return name ? name : undefined;
}

/** Looks like a file name (has an extension), e.g. `mimikatz.exe`. */
function isFileName(v: string | undefined): v is string {
  return !!v && /^[^\\/]+\.[A-Za-z0-9]{1,8}$/.test(v.trim());
}

/** Lowercased, de-duplicated, non-empty values. */
function uniqueLower(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v && !!v.trim()).map((v) => v.trim().toLowerCase())));
}

export function normalizeSeverity(raw: string | undefined): SentinelOneSeverity {
  switch ((raw ?? '').toLowerCase()) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'medium': return 'medium';
    case 'low': return 'low';
    case 'info':
    case 'informational': return 'informational';
    default: return 'unknown';
  }
}

/** Threats carry a confidence level rather than a severity. */
function threatSeverity(t: S1Threat): SentinelOneSeverity {
  const explicit = normalizeSeverity((t.threatInfo as Record<string, string> | undefined)?.severity);
  if (explicit !== 'unknown') return explicit;
  switch ((t.threatInfo?.confidenceLevel ?? '').toLowerCase()) {
    case 'malicious': return 'high';
    case 'suspicious': return 'medium';
    case 'n/a': return 'low';
    default: return 'unknown';
  }
}

export function transformThreat(t: S1Threat, baseUrl: string): SentinelOneAlertDoc {
  const ti = t.threatInfo ?? {};
  const host = t.agentRealtimeInfo?.agentComputerName;
  const techniques = extractTechniques(
    (t.indicators ?? []).flatMap((i) => (i.tactics ?? []).flatMap((tac) => (tac.techniques ?? []).flatMap((te) => [te.name, te.link]))),
  );
  const status = normalizeToken(ti.incidentStatus);
  const prevention = threatPreventionAction(t);
  // Evidence binaries: the detected file, plus the originator process (the
  // binary that spawned it — for an Achilles stage, the stage binary itself).
  const filenames = uniqueLower([
    ti.fileDisplayName,
    basename(ti.filePath),
    isFileName(ti.threatName) ? ti.threatName : undefined,
    isFileName(ti.originatorProcess) ? ti.originatorProcess : undefined,
  ]);
  return {
    doc_type: 'alert',
    source_type: 'threats',
    timestamp: ti.updatedAt || ti.createdAt || null,
    alert_id: t.id,
    alert_title: ti.threatName || ti.fileDisplayName || 'SentinelOne threat',
    description: [ti.classification, ti.mitigationStatusDescription, ti.originatorProcess ? `Originator: ${ti.originatorProcess}` : undefined]
      .filter(Boolean).join(' — '),
    severity: threatSeverity(t),
    status,
    category: ti.classification || ti.detectionType || '',
    service_source: 'SentinelOne',
    mitre_techniques: techniques,
    created_at: ti.createdAt || null,
    updated_at: ti.updatedAt || null,
    resolved_at: status === 'resolved' ? (ti.updatedAt || null) : null,
    recommended_actions: '',
    evidence_hostnames: host ? [host.toUpperCase()] : [],
    evidence_filenames: filenames,
    evidence_filepaths: uniqueLower([ti.filePath]),
    account_id: t.agentDetectionInfo?.accountId ?? t.agentRealtimeInfo?.accountId,
    site_id: t.agentDetectionInfo?.siteId ?? t.agentRealtimeInfo?.siteId,
    group_id: t.agentDetectionInfo?.groupId ?? t.agentRealtimeInfo?.groupId,
    agent_id: t.agentRealtimeInfo?.agentId,
    storyline_id: ti.storyline,
    threat_id: t.id,
    confidence_level: ti.confidenceLevel,
    classification: ti.classification,
    analyst_verdict: normalizeToken(ti.analystVerdict) || undefined,
    mitigation_status: ti.mitigationStatus,
    ...(prevention ? { prevention_action: prevention } : {}),
    sha1: ti.sha1,
    sha256: ti.sha256,
    portal_url: `${baseUrl}/incidents/threats/${encodeURIComponent(t.id)}/overview`,
  };
}

export function transformCloudAlert(a: S1CloudDetectionAlert): SentinelOneAlertDoc | null {
  const ai = a.alertInfo ?? {};
  if (!ai.alertId) return null;
  const ri = a.ruleInfo ?? {};
  const src = a.sourceProcessInfo ?? {};
  const tgt = a.targetProcessInfo ?? {};
  const status = normalizeToken(ai.incidentStatus);
  const filenames = uniqueLower([
    src.name,
    basename(src.filePath),
    tgt.tgtProcName,
    basename(tgt.tgtFilePath),
    basename(tgt.tgtProcImagePath),
  ]);
  const filepaths = uniqueLower([src.filePath, tgt.tgtFilePath, tgt.tgtProcImagePath]);
  return {
    doc_type: 'alert',
    source_type: 'cloud_detection_alerts',
    timestamp: ai.updatedAt || ai.createdAt || ai.reportedAt || null,
    alert_id: ai.alertId,
    alert_title: ri.name || 'SentinelOne detection alert',
    description: ri.description ?? '',
    severity: normalizeSeverity(ri.severity),
    status,
    category: ai.eventType || ai.source || '',
    service_source: 'SentinelOne',
    mitre_techniques: extractTechniques([ri.name, ri.description]),
    created_at: ai.createdAt || null,
    updated_at: ai.updatedAt || ai.createdAt || null,
    resolved_at: status === 'resolved' ? (ai.updatedAt || null) : null,
    recommended_actions: '',
    evidence_hostnames: a.agentDetectionInfo?.name ? [a.agentDetectionInfo.name.toUpperCase()] : [],
    evidence_filenames: filenames,
    evidence_filepaths: filepaths,
    account_id: a.agentDetectionInfo?.accountId,
    site_id: a.agentDetectionInfo?.siteId,
    // Without group_id, a scope with group_ids would never match a detection
    // alert (scope-filter.ts), so auto-resolve could never act on one.
    group_id: a.agentDetectionInfo?.groupId,
    agent_id: a.agentRealtimeInfo?.id,
    storyline_id: src.storyline,
    analyst_verdict: normalizeToken(ai.analystVerdict) || undefined,
    sha1: src.fileHashSha1,
    sha256: src.fileHashSha256,
  };
}

/** Apply user-configured segmentation that the API can't express server-side. */
export function passesFilters(doc: SentinelOneAlertDoc, settings: Pick<SentinelOneIntegrationSettings, 'filters'>): boolean {
  const sev = settings.filters?.severities;
  if (sev && sev.length > 0 && !sev.includes(doc.severity)) return false;
  const st = settings.filters?.incident_statuses;
  if (st && st.length > 0 && !st.map(normalizeToken).includes(doc.status)) return false;
  return true;
}

/** Console + scope a sync ran against: checkpoints are only valid for the same pair. */
function scopeFingerprint(s: Pick<SentinelOneIntegrationSettings, 'base_url' | 'scope'> | null | undefined): string {
  return JSON.stringify({ base_url: s?.base_url ?? null, scope: s?.scope ?? {} });
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || `${err.name}${(err as { statusCode?: number }).statusCode ? ` HTTP ${(err as { statusCode?: number }).statusCode}` : ''}`;
  return String(err);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SentinelOneSyncService {
  private status: SentinelOneSyncStatus = {
    lastThreatSync: null,
    lastAlertSync: null,
    lastSyncResult: null,
    lastAttemptAt: null,
    lastError: null,
    inProgress: false,
  };

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
    const settings = this.settingsService().getSentinelOneSettings();
    if (!settings?.configured) return false;
    const intervalMs = Math.max(1, settings.poll_interval_minutes ?? S1_DEFAULT_POLL_INTERVAL_MINUTES) * 60_000;
    if (!this.status.lastAttemptAt) return true;
    return now - Date.parse(this.status.lastAttemptAt) >= intervalMs;
  }

  /** Run every enabled source. Concurrent calls are coalesced (no overlap). */
  async syncAll(): Promise<SentinelOneSyncResult> {
    const timestamp = new Date().toISOString();
    if (this.status.inProgress) {
      return { timestamp };
    }
    this.status.inProgress = true;
    this.status.lastAttemptAt = timestamp;
    try {
      const svc = this.settingsService();
      const settings = svc.getSentinelOneSettings();
      const creds = svc.getSentinelOneCredentials();
      if (!settings || !creds) throw new Error('SentinelOne integration is not configured');

      const client = new SentinelOneClient(creds);
      const es = this.getEsClient();
      await ensureSentinelOneIndex();

      const checkpoints = svc.getSentinelOneSyncTimestamps();
      const versionOk = checkpoints.sync_version === SENTINELONE_SYNC_VERSION;
      this.status.lastThreatSync = versionOk ? checkpoints.last_threat_sync ?? null : null;
      this.status.lastAlertSync = versionOk ? checkpoints.last_alert_sync ?? null : null;

      const sources = settings.sources?.length ? settings.sources : S1_DEFAULT_SOURCES;
      const result: SentinelOneSyncResult = { timestamp };

      if (sources.includes('threats')) {
        result.threats = await this.syncSource('threats', client, es, settings, this.status.lastThreatSync);
      }
      if (sources.includes('cloud_detection_alerts')) {
        result.cloud_detection_alerts = await this.syncSource('cloud_detection_alerts', client, es, settings, this.status.lastAlertSync);
      }

      // The console or scope was changed while this sync ran: the save already
      // cleared the checkpoints, and writing this run's (old-scope) ones back
      // would skip the new scope's backfill. Drop them and run again soon.
      if (scopeFingerprint(svc.getSentinelOneSettings()) !== scopeFingerprint(settings)) {
        console.log('[SentinelOne] console or scope changed during the sync: checkpoints discarded, re-syncing');
        this.status.lastThreatSync = null;
        this.status.lastAlertSync = null;
        this.status.lastAttemptAt = null; // isDue() → true on the next tick
        result.scopeChanged = true;
        this.status.lastSyncResult = result;
        return result;
      }

      // Record the doc-schema version only once every enabled source has a
      // checkpoint from a clean run under it. Otherwise a failed re-backfill
      // after a version bump would be marked done and never retried.
      const allCaughtUp = (!sources.includes('threats') || this.status.lastThreatSync !== null)
        && (!sources.includes('cloud_detection_alerts') || this.status.lastAlertSync !== null);
      svc.saveSentinelOneSyncTimestamps({
        last_threat_sync: this.status.lastThreatSync ?? undefined,
        last_alert_sync: this.status.lastAlertSync ?? undefined,
        ...(allCaughtUp ? { sync_version: SENTINELONE_SYNC_VERSION } : {}),
      });

      // Correlate AFTER the poll so freshly-synced alerts are visible.
      result.enrichment = await this.runEnrichmentPass(es);
      // Then the opt-in write passes (both no-ops by default): mitigation
      // first (it only acts on unresolved threats), then auto-resolve.
      result.autoMitigation = await this.runAutoMitigationPass(es, client, settings);
      result.autoResolve = await this.runAutoResolvePass(es, client, settings);
      // Posture (exclusions, policies, agents) on its own, slower cadence.
      const lastPosture = svc.getSentinelOneSyncTimestamps().last_posture_sync;
      if (!lastPosture || Date.now() - Date.parse(lastPosture) >= POSTURE_INTERVAL_MS) {
        result.posture = await this.runPosturePass(es, client, settings);
        // Permission errors (403 on a scope) don't heal within minutes, so only a
        // pass that couldn't start (index unavailable / pass threw) retries next sync.
        if (!result.posture.errors.some((e) => e.startsWith('index:') || e.startsWith('pass:'))) {
          svc.saveSentinelOneSyncTimestamps({ last_posture_sync: new Date().toISOString() });
        }
      }

      this.status.lastSyncResult = result;
      return result;
    } catch (err) {
      const message = describeError(err);
      this.status.lastError = { stage: 'threats', message, at: new Date().toISOString() };
      console.error(`[SentinelOne] sync failed: ${message}`);
      const result: SentinelOneSyncResult = { timestamp, threats: { fetched: 0, synced: 0, filtered: 0, errors: [message] } };
      this.status.lastSyncResult = result;
      return result;
    } finally {
      this.status.inProgress = false;
    }
  }

  private buildParams(source: SentinelOneSource, settings: SentinelOneIntegrationSettings, checkpoint: string | null): Record<string, string | string[] | number | undefined> {
    const scope = settings.scope ?? {};
    const params: Record<string, string | string[] | number | undefined> = {
      accountIds: scope.account_ids,
      siteIds: scope.site_ids,
      groupIds: scope.group_ids,
      skipCount: 'true',
    };
    // /cloud-detection/alerts rejects sortBy=createdAt (HTTP 400); only threats sort explicitly.
    if (source === 'threats') {
      params.sortBy = 'createdAt';
      params.sortOrder = 'asc';
    }
    if (checkpoint) {
      const since = new Date(Date.parse(checkpoint) - CHECKPOINT_OVERLAP_MS).toISOString();
      // Threats: updatedAt so status/mitigation changes re-sync too.
      if (source === 'threats') params.updatedAt__gte = since;
      else params.createdAt__gte = since;
    } else {
      const days = Math.min(Math.max(settings.backfill_days ?? S1_DEFAULT_BACKFILL_DAYS, 1), S1_MAX_BACKFILL_DAYS);
      params.createdAt__gte = new Date(Date.now() - days * 86_400_000).toISOString();
      console.log(`[SentinelOne] Initial ${source} backfill — last ${days} day(s)`);
    }
    return params;
  }

  private async syncSource(
    source: SentinelOneSource,
    client: SentinelOneClient,
    es: Client,
    settings: SentinelOneIntegrationSettings,
    checkpoint: string | null,
  ): Promise<SentinelOneSourceSyncResult> {
    const startedAt = new Date().toISOString();
    const out: SentinelOneSourceSyncResult = { fetched: 0, synced: 0, filtered: 0, errors: [] };
    const params = this.buildParams(source, settings, checkpoint);
    let retryNeeded = false;

    try {
      const pages = source === 'threats'
        ? client.paginate((p) => client.listThreats(p), params)
        : client.paginate((p) => client.listCloudDetectionAlerts(p), params);

      for await (const page of pages) {
        out.fetched += page.length;
        const docs: Array<{ id: string; doc: SentinelOneAlertDoc }> = [];
        const dropped: string[] = [];
        for (const item of page) {
          const doc = source === 'threats'
            ? transformThreat(item as S1Threat, client.baseUrl)
            : transformCloudAlert(item as S1CloudDetectionAlert);
          if (!doc) continue;
          const id = `${source === 'threats' ? 'threat' : 'alert'}-${doc.alert_id}`;
          // An item that no longer passes the filters (e.g. it was resolved and
          // only unresolved ones are kept) is removed, so the index never
          // keeps a stale copy from when it did pass.
          if (!passesFilters(doc, settings)) { out.filtered++; dropped.push(id); continue; }
          docs.push({ id, doc });
        }
        if (docs.length === 0 && dropped.length === 0) continue;

        // update + doc_as_upsert keeps f0rtika.* enrichment fields across re-syncs.
        // Deleting an id that was never stored is a no-op ('not_found', not an error).
        const operations = [
          ...docs.flatMap(({ id, doc }) => [
            { update: { _index: SENTINELONE_INDEX, _id: id, retry_on_conflict: 3 } },
            { doc, doc_as_upsert: true },
          ]),
          ...dropped.map((id) => ({ delete: { _index: SENTINELONE_INDEX, _id: id } })),
        ];
        const res = await es.bulk({ operations, refresh: 'wait_for' });
        let pageErrors = 0;
        if (res.errors) {
          for (const item of res.items) {
            const op = item.update ?? item.delete;
            if (op?.error) {
              if (item.update) pageErrors++;
              // A 4xx other than 429 (mapping / parsing) fails the same way on
              // every retry: report it, but don't let one bad doc hold the
              // checkpoint back forever. Throttling and 5xx are retried.
              const status = op.status ?? 0;
              if (status === 429 || status >= 500 || status === 0) retryNeeded = true;
              if (out.errors.length < 20) out.errors.push(`${op._id}: ${op.error.reason}`);
            }
          }
        }
        out.synced += docs.length - pageErrors;
      }

      // Advance the checkpoint to the start of this run unless something
      // retryable failed, so a partial failure is retried (dedup makes
      // re-fetches harmless).
      if (!retryNeeded) {
        if (source === 'threats') this.status.lastThreatSync = startedAt;
        else this.status.lastAlertSync = startedAt;
      }
    } catch (err) {
      out.errors.push(describeError(err));
    }

    if (out.errors.length > 0) {
      this.status.lastError = { stage: source, message: out.errors[0], at: new Date().toISOString() };
      console.error(`[SentinelOne] ${source} sync: ${out.errors.length} error(s) — ${out.errors[0]}`);
    } else if (this.status.lastError?.stage === source) {
      this.status.lastError = null;
    }
    console.log(`[SentinelOne] ${source} sync: fetched=${out.fetched} synced=${out.synced} filtered=${out.filtered} errors=${out.errors.length}`);
    return out;
  }

  /**
   * Correlate SentinelOne alerts with Achilles test results — the same pass
   * CrowdStrike runs (bundle UUID + hostname + time window), writing
   * f0rtika.sentinelone_detected / _stage_detected / _prevented /
   * _prevention_action on result docs and f0rtika.achilles_correlated on the
   * matched alerts. Never throws: failures are returned and self-heal on the
   * next poll.
   */
  async runEnrichmentPass(es?: Client): Promise<EnrichmentPassResult> {
    const empty = (errors: string[] = []): EnrichmentPassResult => ({
      scanned: 0, detected: 0, stageDetected: 0, skipped: 0, batches: 0, alertsMarkedCorrelated: 0, errors, durationMs: 0,
    });
    try {
      if (!this.settingsService().getSentinelOneSettings()?.configured) return empty();
      const client = es ?? this.getEsClient();
      const indexPattern = new SettingsService().getSettings().indexPattern;
      const service = new CrowdStrikeEnrichmentService(client, indexPattern, {
        alertIndex: SENTINELONE_INDEX,
        flagPrefix: 'sentinelone',
        ignoreAchillesMitigated: true,
      });
      const result = await service.runEnrichmentPass({ lookbackDays: 90 });
      console.log(
        `[SentinelOne-Enrichment] scanned=${result.scanned} detected=${result.detected} ` +
        `stageDetected=${result.stageDetected} alertsCorrelated=${result.alertsMarkedCorrelated} ` +
        `durationMs=${result.durationMs} errors=${result.errors.length}`,
      );
      for (const e of result.errors.slice(0, 5)) console.warn(`[SentinelOne-Enrichment-ERROR] ${e}`);
      return result;
    } catch (err) {
      const msg = describeError(err);
      console.error(`[SentinelOne-Enrichment] pass threw: ${msg}`);
      return empty([msg]);
    }
  }

  /** Opt-in automatic mitigation (Response mode only — see auto-mitigation.service.ts). Never throws. */
  async runAutoMitigationPass(es: Client, client: SentinelOneClient, settings: SentinelOneIntegrationSettings): Promise<AutoMitigationPassResult> {
    let cfg: { mode: AutoMitigationPassResult['mode']; action: AutoMitigationPassResult['action'] } = { mode: 'disabled', action: 'kill' };
    try {
      cfg = this.settingsService().getSentinelOneAutoMitigation();
      const service = new SentinelOneAutoMitigationService(es, new SentinelOneResponseService(), {
        mode: cfg.mode,
        action: cfg.action,
        permissionMode: settings.permission_mode === 'response' ? 'response' : 'read_only',
        scope: settings.scope,
      }, client);
      const r = await service.runAutoMitigationPass();
      if (r.mode !== 'disabled') {
        console.log(`[SentinelOne-AutoMitigation] mode=${r.mode} action=${r.action} candidates=${r.candidates} mitigated=${r.mitigated} wouldMitigate=${r.wouldMitigate} errors=${r.errors.length}`);
      }
      return r;
    } catch (err) {
      return { mode: cfg.mode, action: cfg.action, candidates: 0, mitigated: 0, wouldMitigate: 0, skipped: 0, errors: [describeError(err)], durationMs: 0 };
    }
  }

  /** Auto-resolve of test-matched alerts (default disabled). Never throws. */
  async runAutoResolvePass(es: Client, client: SentinelOneClient, settings: SentinelOneIntegrationSettings): Promise<AutoResolvePassResult> {
    let mode: AutoResolvePassResult['mode'] = 'disabled';
    try {
      mode = this.settingsService().getSentinelOneAutoResolveMode();
      const r = await new SentinelOneAutoResolveService(es, client, mode, settings.scope).runAutoResolvePass();
      if (r.mode !== 'disabled') {
        console.log(`[SentinelOne-AutoResolve] mode=${r.mode} candidates=${r.candidates} resolved=${r.patched} wouldResolve=${r.wouldPatch} errors=${r.errors.length}`);
      }
      return r;
    } catch (err) {
      return { mode, candidates: 0, patched: 0, wouldPatch: 0, skipped: 0, errors: [describeError(err)], durationMs: 0 };
    }
  }

  /** Read-only posture pass. Never throws. */
  async runPosturePass(es: Client, client: SentinelOneClient, settings: SentinelOneIntegrationSettings): Promise<SentinelOnePosturePassResult> {
    try {
      const r = await new SentinelOnePostureService(es, client).runPosturePass(settings);
      console.log(
        `[SentinelOne-Posture] exclusions=${r.exclusions} policies=${r.policies} agents=${r.agents} ` +
        `health=${r.agentHealth ? JSON.stringify(r.agentHealth) : 'n/a'} errors=${r.errors.length}`,
      );
      for (const e of r.errors.slice(0, 5)) console.warn(`[SentinelOne-Posture-ERROR] ${e}`);
      return r;
    } catch (err) {
      return { exclusions: 0, policies: 0, agents: 0, agentHealth: null, errors: [`pass: ${describeError(err)}`], durationMs: 0 };
    }
  }

  /** Force the next run to redo the initial backfill. */
  resetCheckpoints(): void {
    this.settingsService().resetSentinelOneSyncTimestamps();
    this.status.lastThreatSync = null;
    this.status.lastAlertSync = null;
  }

  getSyncStatus(): SentinelOneSyncStatus {
    return { ...this.status };
  }
}
