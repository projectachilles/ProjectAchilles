// CrowdStrike Falcon data sync service — fetches from the Falcon API and indexes to ES.
// Supports manual and automatic (interval-based) sync.

import { FalconClient, FalconApiError } from './falcon-client.js';
import { ensureCrowdStrikeIndex, ensureCrowdStrikeIndexMappings, CROWDSTRIKE_INDEX } from './index-management.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';
import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import { CrowdStrikeEnrichmentService } from './enrichment.service.js';
import { CrowdStrikeAutoResolveService } from './auto-resolve.service.js';
import { runAgentKillReconciliation, failedAgentKillPass } from '../edr/agent-kill-reconcile.service.js';
import { runLaunchBlockReconciliation, failedLaunchBlockPass } from '../edr/launch-block-reconcile.service.js';
import type { Client } from '@elastic/elasticsearch';
import type {
  FalconAlert,
  FalconZtaAssessment,
  CrowdStrikeZtaScoreDoc,
  CrowdStrikeAlertDoc,
  SyncResult,
  CrowdStrikeSyncResult,
  CrowdStrikeSyncStatus,
  CrowdStrikeSyncError,
  EnrichmentPassResult,
  AutoResolvePassResult,
} from '../../types/crowdstrike.js';

/** Days of alert history to fetch on first sync (no persisted lastAlertSync). */
const INITIAL_ALERT_LOOKBACK_DAYS = 90;

/**
 * Bump this when the alert schema changes (e.g. new extracted fields) to
 * force a full re-sync on all deployments. The persisted sync_version is
 * compared against this; a mismatch clears lastAlertSync.
 */
const CROWDSTRIKE_ALERT_SYNC_VERSION = 2; // v2: + prevention_action / pattern_disposition* / portal_url

/** Max alerts per /alerts/combined/alerts/v1 page (API ceiling is 1000). */
const ALERT_PAGE_LIMIT = 1000;
/** Max device AIDs per ZTA query page (getAssessmentsByScoreV1 caps limit at 1000). */
const ZTA_DEVICE_PAGE_LIMIT = 1000;

/**
 * Never record an empty error message. Elasticsearch `ResponseError`s from
 * HEAD requests (e.g. `indices.exists` inside `ensureCrowdStrikeIndex`) have
 * no response body by definition, so `.message` is '' — which surfaced in
 * the UI as a bare "alerts:" banner and in logs as a blank line. A 403 on
 * that HEAD request almost always means the ES API key lacks privileges on
 * the achilles-crowdstrike index (Defender works because its index was
 * already covered).
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message) return err.message;
    const statusCode = (err as { statusCode?: number }).statusCode;
    const path = (err as { meta?: { meta?: { request?: { params?: { path?: string } } } } })
      .meta?.meta?.request?.params?.path;
    const where = path ? ` on ${path}` : '';
    const hint = statusCode === 403
      ? ' — check that the Elasticsearch API key has read/write/create_index on the achilles-crowdstrike index'
      : ' (empty response body)';
    return `${err.name}${statusCode ? ` HTTP ${statusCode}` : ''}${where}${hint}`;
  }
  return String(err);
}

export class CrowdStrikeSyncService {
  private falconClient: FalconClient | null = null;
  private syncStatus: CrowdStrikeSyncStatus = {
    lastAlertSync: null,
    lastZtaSync: null,
    ztaStatus: null,
    lastSyncResult: null,
    lastAttemptAt: null,
    lastError: null,
  };
  private syncStatusLoaded = false;

  // ---------------------------------------------------------------------------
  // Client initialization
  // ---------------------------------------------------------------------------

  private ensureFalconClient(): FalconClient {
    // Always recreate from current credentials so UI changes take effect
    const integrationsService = new IntegrationsSettingsService();
    const creds = integrationsService.getCrowdStrikeCredentials();

    if (!creds) {
      throw new Error('CrowdStrike integration is not configured');
    }

    this.falconClient = new FalconClient(creds);
    return this.falconClient;
  }

  private getEsClient(): Client {
    const settingsService = new SettingsService();
    const settings = settingsService.getSettings();
    if (!settings.configured) {
      throw new Error('Elasticsearch is not configured');
    }
    return createEsClient(settings);
  }

  /** Load persisted sync timestamps from integrations settings on first use. */
  private loadPersistedSyncStatus(): void {
    if (this.syncStatusLoaded) return;
    this.syncStatusLoaded = true;

    try {
      const integrationsService = new IntegrationsSettingsService();
      const timestamps = integrationsService.getCrowdStrikeSyncTimestamps();
      console.log(`[CrowdStrike] Loaded sync timestamps: version=${timestamps.sync_version ?? 'none'}, lastAlert=${timestamps.last_alert_sync ?? 'none'}`);

      // If sync version changed (schema upgrade), force a full re-sync
      if (timestamps.sync_version !== CROWDSTRIKE_ALERT_SYNC_VERSION) {
        if (timestamps.sync_version !== undefined) {
          console.log(`[CrowdStrike] Sync version mismatch (${timestamps.sync_version} → ${CROWDSTRIKE_ALERT_SYNC_VERSION}) — forcing full re-sync`);
        }
        return; // Leave lastAlertSync as null to trigger 90-day lookback
      }

      if (timestamps.last_alert_sync) {
        this.syncStatus.lastAlertSync = timestamps.last_alert_sync;
      }
      if (timestamps.last_zta_sync) {
        this.syncStatus.lastZtaSync = timestamps.last_zta_sync;
      }
      if (timestamps.zta_status) {
        this.syncStatus.ztaStatus = timestamps.zta_status;
      }
    } catch {
      // Settings not available yet — will do full initial sync
    }
  }

  /** Persist sync timestamps without touching credentials. */
  private persistSyncTimestamps(): void {
    try {
      const integrationsService = new IntegrationsSettingsService();
      integrationsService.saveCrowdStrikeSyncTimestamps({
        last_alert_sync: this.syncStatus.lastAlertSync ?? undefined,
        last_zta_sync: this.syncStatus.lastZtaSync ?? undefined,
        zta_status: this.syncStatus.ztaStatus ?? undefined,
        sync_version: CROWDSTRIKE_ALERT_SYNC_VERSION,
      });
    } catch (err) {
      console.warn('[CrowdStrike] Failed to persist sync timestamps:', err instanceof Error ? err.message : String(err));
    }
  }

  // ---------------------------------------------------------------------------
  // Transform helpers
  // ---------------------------------------------------------------------------

  private transformAlert(alert: FalconAlert, cid: string): CrowdStrikeAlertDoc {
    // Extract hostname, filename, and filepath from the alert resource for
    // precise correlation. CrowdStrike's combined alert resource carries the
    // device hostname and the triggering file name/path at the root level
    // (no nested evidence array like Graph's). Filepath capture recovers
    // AV-only alerts whose evidence is only a dropped-file path under a
    // bundle-named sandbox dir — without it they are uncorrelatable via
    // filename matching alone.
    const hostnames = new Set<string>();
    const filenames = new Set<string>();
    const filepaths = new Set<string>();

    if (alert.device?.hostname) {
      hostnames.add(alert.device.hostname.toUpperCase());
    }
    if (alert.filename) {
      filenames.add(alert.filename.toLowerCase());
    }
    if (alert.filepath) {
      filepaths.add(alert.filepath.toLowerCase());
    }

    // MITRE techniques: the alert's own technique_id plus every
    // mitre_attack[] entry, deduped.
    const techniques = new Set<string>();
    if (alert.technique_id) techniques.add(alert.technique_id);
    for (const m of alert.mitre_attack ?? []) {
      if (m.technique_id) techniques.add(m.technique_id);
    }

    // Derive the prevention action from pattern_disposition_details.
    // Precedence per docs/edr-prevention-action-detection.md: a failed kill
    // is surfaced first (the EDR TRIED to prevent and failed — operationally
    // distinct from "no prevention"), then quarantine, then process kills,
    // then generic blocks. Absent details → detection-only (undefined).
    let preventionAction: string | undefined;
    const d = alert.pattern_disposition_details;
    if (d) {
      if (d.kill_action_failed) preventionAction = 'kill_failed';
      else if (d.quarantine_file) preventionAction = 'quarantined';
      else if (d.kill_process || d.kill_parent || d.kill_subprocess) preventionAction = 'process_killed';
      else if (d.process_blocked || d.operation_blocked || d.fs_operation_blocked) preventionAction = 'blocked';
    }

    return {
      doc_type: 'alert',
      timestamp: alert.updated_timestamp || alert.created_timestamp || '',
      cid,
      alert_id: alert.composite_id,
      alert_title: alert.display_name || alert.name || '',
      description: alert.description ?? '',
      severity: (alert.severity_name ?? 'unknown').toLowerCase(),
      status: alert.status ?? '',
      category: alert.scenario || alert.product || '',
      service_source: 'CrowdStrike Falcon',
      mitre_techniques: Array.from(techniques),
      created_at: alert.created_timestamp ?? '',
      updated_at: alert.updated_timestamp ?? '',
      resolved_at: alert.status === 'closed' ? (alert.updated_timestamp ?? null) : null,
      recommended_actions: '',
      evidence_hostnames: Array.from(hostnames),
      evidence_filenames: Array.from(filenames),
      evidence_filepaths: Array.from(filepaths),
      ...(preventionAction ? { prevention_action: preventionAction } : {}),
      ...(alert.pattern_disposition !== undefined ? { pattern_disposition: alert.pattern_disposition } : {}),
      ...(alert.pattern_disposition_description ? { pattern_disposition_description: alert.pattern_disposition_description } : {}),
      ...(alert.falcon_host_link ? { portal_url: alert.falcon_host_link } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Sync methods
  // ---------------------------------------------------------------------------

  /** Sync Alerts (incremental — only new since last sync). */
  async syncAlerts(): Promise<SyncResult> {
    this.loadPersistedSyncStatus();

    const errors: string[] = [];
    let synced = 0;

    try {
      // Setup lives inside the try so a missing credential or an ES
      // privilege error is reported as a result error, not thrown past
      // callers that swallow rejections (the background timers).
      const client = this.ensureFalconClient();
      const es = this.getEsClient();
      await ensureCrowdStrikeIndex();

      // Build FQL filter: incremental if we have a checkpoint, otherwise 90-day lookback
      let filter: string;
      if (this.syncStatus.lastAlertSync) {
        filter = `created_timestamp:>='${this.syncStatus.lastAlertSync}'`;
      } else {
        const lookback = new Date(Date.now() - INITIAL_ALERT_LOOKBACK_DAYS * 86400_000);
        filter = `created_timestamp:>='${lookback.toISOString()}'`;
        console.log(`[CrowdStrike] Initial alert sync — fetching last ${INITIAL_ALERT_LOOKBACK_DAYS} days`);
      }

      // Page through /alerts/combined/alerts/v1 via the after token.
      const alerts: FalconAlert[] = [];
      let after: string | undefined;
      do {
        const page = await client.getAlertsCombined({
          filter,
          sort: 'created_timestamp|asc',
          limit: ALERT_PAGE_LIMIT,
          after,
        });
        alerts.push(...page.resources);
        after = page.after;
        // Defensive: stop when a page comes back empty even if an after
        // token was echoed — avoids spinning on a degenerate cursor.
        if (page.resources.length === 0) break;
      } while (after);

      console.log(`[CrowdStrike] Alert sync: fetched ${alerts.length} alert(s) from Falcon API`);

      if (alerts.length > 0) {
        // Use `update` with `doc_as_upsert:true` so f0rtika.* fields written by
        // the enrichment pass (achilles_correlated, achilles_test_uuid,
        // achilles_matched_at) and the auto-resolve pass (auto_resolved,
        // auto_resolve_mode, auto_resolved_at) survive subsequent syncs.
        // A plain `index` op replaces the whole doc and would wipe them whenever
        // Falcon re-emits the alert (which it does whenever updated_timestamp
        // ticks — common for "new"/"in_progress" alerts as evidence evolves).
        const operations = alerts.flatMap((alert) => {
          const doc = this.transformAlert(alert, alert.cid ?? '');
          return [
            { update: { _index: CROWDSTRIKE_INDEX, _id: `alert-${alert.composite_id}`, retry_on_conflict: 3 } },
            { doc, doc_as_upsert: true },
          ];
        });

        const result = await es.bulk({ operations, refresh: 'wait_for' });

        if (result.errors) {
          for (const item of result.items) {
            const op = item.update;
            if (op?.error) {
              errors.push(`Alert ${op._id}: ${op.error.reason}`);
            }
          }
        }

        synced = alerts.length - errors.length;
      }

      // Only update checkpoint on successful fetch (not on error)
      this.syncStatus.lastAlertSync = new Date().toISOString();
      this.persistSyncTimestamps();
    } catch (err) {
      errors.push(describeError(err));
    }

    if (synced > 0 || errors.length > 0) {
      console.log(`[CrowdStrike] Alert sync result: ${synced} synced, ${errors.length} error(s)${errors.length > 0 ? ' — ' + errors[0] : ''}`);
    }

    this.recordOutcome('alerts', errors);
    return { synced, errors };
  }

  /**
   * Sync Zero Trust Assessment scores (daily org snapshot, doc id
   * `score-<YYYY-MM-DD>`). CrowdStrike's Secure-Score equivalent.
   *
   * ZTA requires Falcon Insight licensing — a 403 from the ZTA API means
   * "not licensed", not a broken credential. That path is NON-FATAL:
   * zta_status is recorded as 'not_licensed' in the sync timestamps (the
   * UI renders an empty state) and the rest of the integration is
   * unaffected.
   */
  async syncZtaScores(): Promise<SyncResult> {
    this.loadPersistedSyncStatus();

    const errors: string[] = [];
    let synced = 0;

    try {
      const client = this.ensureFalconClient();
      const es = this.getEsClient();
      await ensureCrowdStrikeIndex();

      // Enumerate device AIDs (paginated), then batch-fetch assessments.
      const aids: string[] = [];
      let after: string | undefined;
      do {
        const page = await client.getZtaDeviceIds({ limit: ZTA_DEVICE_PAGE_LIMIT, after });
        aids.push(...page.resources);
        after = page.after;
        if (page.resources.length === 0) break;
      } while (after);

      if (aids.length > 0) {
        const assessments = await client.getZtaAssessments(aids);
        const doc = this.buildZtaSnapshot(assessments);
        if (doc) {
          const dateStr = doc.timestamp.split('T')[0]; // YYYY-MM-DD
          const result = await es.bulk({
            operations: [
              { index: { _index: CROWDSTRIKE_INDEX, _id: `score-${dateStr}` } },
              doc,
            ],
            refresh: 'wait_for',
          });

          if (result.errors) {
            for (const item of result.items) {
              const op = item.index;
              if (op?.error) {
                errors.push(`ZTA score ${op._id}: ${op.error.reason}`);
              }
            }
          }

          synced = errors.length === 0 ? 1 : 0;
        }
      }

      this.syncStatus.lastZtaSync = new Date().toISOString();
      this.syncStatus.ztaStatus = 'ok';
      this.persistSyncTimestamps();
    } catch (err) {
      // Not licensed — non-fatal by design. CrowdStrike returns 403 when the
      // API client lacks the ZTA scope or the CID has no Falcon Insight.
      // A 404 is NOT mapped here: the gateway's generic "Not Found ...
      // trace-id" is what an unknown route returns, and treating it as
      // not_licensed once hid a wrong endpoint path. It surfaces as an error.
      if (err instanceof FalconApiError && err.statusCode === 403) {
        console.log(`[CrowdStrike] ZTA not licensed (HTTP 403) — skipping score sync. Body: ${err.bodySnippet}`);
        this.syncStatus.ztaStatus = 'not_licensed';
        this.persistSyncTimestamps();
        this.recordOutcome('zta', []);
        return { synced, errors };
      }
      errors.push(describeError(err));
    }

    this.recordOutcome('zta', errors);
    return { synced, errors };
  }

  /**
   * Aggregate per-device assessments into the daily org snapshot.
   * Returns null when no usable assessments came back (nothing to index).
   */
  private buildZtaSnapshot(assessments: FalconZtaAssessment[]): CrowdStrikeZtaScoreDoc | null {
    const scored = assessments.filter((a) => typeof a.assessment?.overall === 'number');
    if (scored.length === 0) return null;

    const avg = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
    const overalls = scored.map((a) => a.assessment!.overall!);
    const osScores = scored.map((a) => a.assessment!.os ?? 0);
    const sensorScores = scored.map((a) => a.assessment!.sensor_config ?? 0);

    return {
      doc_type: 'zta_score',
      timestamp: new Date().toISOString(),
      cid: scored[0].cid ?? '',
      overall_score: avg(overalls),
      os_score: avg(osScores),
      sensor_config_score: avg(sensorScores),
      device_count: scored.length,
      min_score: Math.min(...overalls),
      max_score: Math.max(...overalls),
    };
  }

  /**
   * Run the CrowdStrike evidence enrichment pass. Non-blocking: any failure
   * is captured and returned without throwing, so the sync loop stays
   * healthy and the pass will self-heal on the next cycle. Early-returns
   * as a no-op when CrowdStrike integration is not configured.
   *
   * Public so the 5-min alert interval in server.ts can call it alongside
   * syncAlerts(). Without this cadence, enrichment would only run on boot
   * (via syncAll), leaving freshly-ingested alerts uncorrelated for up to
   * the container's full uptime.
   */
  async runEnrichmentPass(): Promise<EnrichmentPassResult> {
    try {
      const integrationsService = new IntegrationsSettingsService();
      if (!integrationsService.isCrowdStrikeConfigured()) {
        return { scanned: 0, detected: 0, stageDetected: 0, skipped: 0, batches: 0, alertsMarkedCorrelated: 0, errors: [], durationMs: 0 };
      }
      const es = this.getEsClient();
      const settingsService = new SettingsService();
      const settings = settingsService.getSettings();
      const service = new CrowdStrikeEnrichmentService(es, settings.indexPattern);
      const result = await service.runEnrichmentPass({ lookbackDays: 90 });
      console.log(
        `[CrowdStrike-Enrichment] scanned=${result.scanned} detected=${result.detected} ` +
        `stageDetected=${result.stageDetected} skipped=${result.skipped} ` +
        `batches=${result.batches} durationMs=${result.durationMs} errors=${result.errors.length}`,
      );
      for (const e of result.errors) {
        console.warn(`[CrowdStrike-Enrichment-ERROR] ${e}`);
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CrowdStrike-Enrichment] pass threw: ${msg}`);
      return { scanned: 0, detected: 0, stageDetected: 0, skipped: 0, batches: 0, alertsMarkedCorrelated: 0, errors: [msg], durationMs: 0 };
    }
  }

  /**
   * Run the CrowdStrike auto-resolve pass. Customer opt-in — no-op when
   * integration settings have auto_resolve_mode='disabled' (the default).
   * Non-blocking: any error is captured in the result's errors[] rather
   * than thrown, so the sync loop stays healthy.
   *
   * Public so both syncAll() (boot) and the 5-min alert interval in
   * server.ts can invoke it after the enrichment pass that produces
   * its input (alerts tagged with f0rtika.achilles_correlated=true).
   */
  async runAutoResolvePass(): Promise<AutoResolvePassResult> {
    const zero: AutoResolvePassResult = {
      mode: 'disabled',
      candidates: 0,
      patched: 0,
      wouldPatch: 0,
      skipped: 0,
      errors: [],
      durationMs: 0,
    };
    try {
      const integrationsService = new IntegrationsSettingsService();
      if (!integrationsService.isCrowdStrikeConfigured()) return zero;

      const mode = integrationsService.getCrowdStrikeAutoResolveMode();
      if (mode === 'disabled') return { ...zero, mode: 'disabled' };

      const es = this.getEsClient();
      const falcon = this.ensureFalconClient();
      const service = new CrowdStrikeAutoResolveService(es, falcon, mode);
      const result = await service.runAutoResolvePass();

      console.log(
        `[CrowdStrike-AutoResolve] mode=${result.mode} candidates=${result.candidates} ` +
        `patched=${result.patched} wouldPatch=${result.wouldPatch} skipped=${result.skipped} ` +
        `errors=${result.errors.length} durationMs=${result.durationMs}`,
      );
      for (const e of result.errors) {
        console.warn(`[CrowdStrike-AutoResolve-ERROR] ${e}`);
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CrowdStrike-AutoResolve] pass threw: ${msg}`);
      return { ...zero, errors: [msg] };
    }
  }

  /** Run both syncs plus the enrichment and auto-resolve passes. */
  async syncAll(): Promise<CrowdStrikeSyncResult> {
    // Propagate any additive mapping changes to pre-existing indexes.
    // Idempotent and non-fatal — a failure here does not block the sync.
    await ensureCrowdStrikeIndexMappings();

    const [alerts, zta] = await Promise.all([
      this.syncAlerts(),
      this.syncZtaScores(),
    ]);

    // Run enrichment AFTER alerts are synced so fresh alerts are
    // in the index when we evaluate test docs.
    const enrichment = await this.runEnrichmentPass();

    // EDR-killed agent runs: watchdog-failed tasks with kill evidence in any
    // vendor's alert index become Protected results. Never throws.
    const agentKill = await runAgentKillReconciliation().catch(failedAgentKillPass);

    // Exit-260 runs an EDR's prevention alert proves it blocked at launch
    // become Protected. Before auto-resolve: it links the proving alerts.
    const launchBlock = await runLaunchBlockReconciliation().catch(failedLaunchBlockPass);

    // Auto-resolve pass runs AFTER enrichment because its candidates are
    // exactly the alerts the enrichment pass just tagged. Customer opt-in;
    // no-op when auto_resolve_mode='disabled' (the default).
    const autoResolve = await this.runAutoResolvePass();

    const result: CrowdStrikeSyncResult = {
      alerts,
      zta,
      enrichment,
      agentKill,
      launchBlock,
      autoResolve,
      timestamp: new Date().toISOString(),
    };

    this.syncStatus.lastSyncResult = result;
    return result;
  }

  /**
   * Stamp the attempt and keep lastError current: set it when a stage fails,
   * clear it when the stage that last failed succeeds. Logged here so failures
   * are visible even when the caller discards the result.
   */
  private recordOutcome(stage: CrowdStrikeSyncError['stage'], errors: string[]): void {
    const now = new Date().toISOString();
    this.syncStatus.lastAttemptAt = now;
    if (errors.length > 0) {
      this.syncStatus.lastError = { stage, message: errors[0], at: now };
      console.error(`[CrowdStrike] ${stage} sync failed: ${errors[0]}`);
    } else if (this.syncStatus.lastError?.stage === stage) {
      this.syncStatus.lastError = null;
    }
  }

  /** Get the current sync status for the UI. */
  getSyncStatus(): CrowdStrikeSyncStatus {
    return { ...this.syncStatus };
  }
}
