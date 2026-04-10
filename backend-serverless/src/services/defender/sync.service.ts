// Defender data sync service — Vercel serverless version.
// Fetches from Microsoft Graph and indexes to ES.
// Triggered by Vercel Cron instead of setInterval.

import { MicrosoftGraphClient } from './graph-client.js';
import { ensureDefenderIndex, DEFENDER_INDEX } from './index-management.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';
import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import { DefenderEnrichmentService } from './enrichment.service.js';
import type { Client } from '@elastic/elasticsearch';
import type {
  GraphSecureScore,
  GraphControlProfile,
  GraphAlert,
  DefenderScoreDoc,
  DefenderControlDoc,
  DefenderAlertDoc,
  SyncResult,
  DefenderSyncResult,
  DefenderSyncStatus,
  EnrichmentPassResult,
} from '../../types/defender.js';

/** Days of alert history to fetch on first sync (no persisted lastAlertSync). */
const INITIAL_ALERT_LOOKBACK_DAYS = 90;

/**
 * Bump this when the alert schema changes (e.g. new extracted fields) to
 * force a full re-sync on all deployments.
 */
const ALERT_SYNC_VERSION = 2; // v2: evidence_hostnames + evidence_filenames

export class DefenderSyncService {
  private graphClient: MicrosoftGraphClient | null = null;
  private syncStatus: DefenderSyncStatus = {
    lastScoreSync: null,
    lastControlSync: null,
    lastAlertSync: null,
    lastSyncResult: null,
  };
  private syncStatusLoaded = false;

  // ---------------------------------------------------------------------------
  // Client initialization
  // ---------------------------------------------------------------------------

  private async ensureGraphClient(): Promise<MicrosoftGraphClient> {
    const integrationsService = new IntegrationsSettingsService();
    const creds = await integrationsService.getDefenderCredentials();

    if (!creds) {
      throw new Error('Defender integration is not configured');
    }

    this.graphClient = new MicrosoftGraphClient(creds.tenant_id, creds.client_id, creds.client_secret);
    return this.graphClient;
  }

  private async getEsClient(): Promise<Client> {
    const settingsService = new SettingsService();
    const settings = await settingsService.getSettings();
    if (!settings.configured) {
      throw new Error('Elasticsearch is not configured');
    }
    return createEsClient(settings);
  }

  /** Load persisted sync timestamps from integrations settings on first use. */
  private async loadPersistedSyncStatus(): Promise<void> {
    if (this.syncStatusLoaded) return;
    this.syncStatusLoaded = true;

    try {
      const integrationsService = new IntegrationsSettingsService();
      const timestamps = await integrationsService.getDefenderSyncTimestamps();

      // If sync version changed (schema upgrade), force a full re-sync
      if (timestamps.sync_version !== ALERT_SYNC_VERSION) {
        console.log(`[Defender] Sync version mismatch (${timestamps.sync_version ?? 'none'} → ${ALERT_SYNC_VERSION}) — forcing full re-sync`);
        return;
      }

      if (timestamps.last_alert_sync) {
        this.syncStatus.lastAlertSync = timestamps.last_alert_sync;
      }
      if (timestamps.last_score_sync) {
        this.syncStatus.lastScoreSync = timestamps.last_score_sync;
      }
    } catch {
      // Settings not available yet — will do full initial sync
    }
  }

  /** Persist sync timestamps without touching credentials (Vercel Blob). */
  private async persistSyncTimestamps(): Promise<void> {
    try {
      const integrationsService = new IntegrationsSettingsService();
      await integrationsService.saveDefenderSyncTimestamps({
        last_alert_sync: this.syncStatus.lastAlertSync ?? undefined,
        last_score_sync: this.syncStatus.lastScoreSync ?? undefined,
        sync_version: ALERT_SYNC_VERSION,
      });
    } catch {
      // Non-fatal — sync continues, timestamps just won't survive next invocation
    }
  }

  // ---------------------------------------------------------------------------
  // Transform helpers
  // ---------------------------------------------------------------------------

  private transformScore(score: GraphSecureScore): DefenderScoreDoc {
    const avgComparative = score.averageComparativeScores?.find(
      (s) => s.basis === 'TotalScore',
    );

    return {
      doc_type: 'secure_score',
      timestamp: score.createdDateTime,
      tenant_id: score.azureTenantId,
      current_score: score.currentScore,
      max_score: score.maxScore,
      score_percentage: score.maxScore > 0 ? (score.currentScore / score.maxScore) * 100 : 0,
      control_scores: (score.controlScores ?? []).map((cs) => ({
        name: cs.controlName,
        category: cs.controlCategory,
        score: cs.score ?? 0,
      })),
      average_comparative_score: avgComparative?.averageScore ?? null,
    };
  }

  private transformControl(profile: GraphControlProfile, tenantId: string): DefenderControlDoc {
    return {
      doc_type: 'control_profile',
      timestamp: new Date().toISOString(),
      tenant_id: tenantId,
      control_name: profile.id,
      control_category: profile.controlCategory,
      title: profile.title,
      implementation_cost: profile.implementationCost,
      user_impact: profile.userImpact,
      rank: profile.rank,
      threats: profile.threats ?? [],
      deprecated: profile.deprecated ?? false,
      remediation_summary: profile.remediation ?? '',
      action_url: profile.actionUrl ?? '',
      max_score: profile.maxScore ?? 0,
      tier: profile.tier ?? '',
    };
  }

  private transformAlert(alert: GraphAlert, tenantId: string): DefenderAlertDoc {
    const hostnames = new Set<string>();
    const filenames = new Set<string>();

    for (const ev of alert.evidence ?? []) {
      if (ev.deviceDnsName) hostnames.add(ev.deviceDnsName.toUpperCase());
      if (ev.imageFile?.fileName) filenames.add(ev.imageFile.fileName.toLowerCase());
      if (ev.parentProcess?.imageFile?.fileName) filenames.add(ev.parentProcess.imageFile.fileName.toLowerCase());
      if (ev.fileDetails?.fileName) filenames.add(ev.fileDetails.fileName.toLowerCase());
    }

    return {
      doc_type: 'alert',
      timestamp: alert.lastUpdateDateTime || alert.createdDateTime,
      tenant_id: tenantId,
      alert_id: alert.id,
      alert_title: alert.title,
      description: alert.description ?? '',
      severity: alert.severity,
      status: alert.status,
      category: alert.category ?? '',
      service_source: alert.serviceSource ?? '',
      mitre_techniques: alert.mitreTechniques ?? [],
      created_at: alert.createdDateTime,
      updated_at: alert.lastUpdateDateTime,
      resolved_at: alert.resolvedDateTime ?? null,
      recommended_actions: alert.recommendedActions ?? '',
      evidence_hostnames: Array.from(hostnames),
      evidence_filenames: Array.from(filenames),
    };
  }

  // ---------------------------------------------------------------------------
  // Sync methods
  // ---------------------------------------------------------------------------

  /** Sync Secure Scores (upsert by date). */
  async syncSecureScores(): Promise<SyncResult> {
    await this.loadPersistedSyncStatus();

    const client = await this.ensureGraphClient();
    const es = await this.getEsClient();
    await ensureDefenderIndex();

    const errors: string[] = [];
    let synced = 0;

    try {
      const scores = await client.getSecureScores(90);

      if (scores.length > 0) {
        const operations = scores.flatMap((score) => {
          const doc = this.transformScore(score);
          const dateStr = score.createdDateTime.split('T')[0];
          return [
            { index: { _index: DEFENDER_INDEX, _id: `score-${dateStr}` } },
            doc,
          ];
        });

        const result = await es.bulk({ operations, refresh: 'wait_for' });

        if (result.errors) {
          for (const item of result.items) {
            const op = item.index;
            if (op?.error) {
              errors.push(`Score ${op._id}: ${op.error.reason}`);
            }
          }
        }

        synced = scores.length - errors.length;
      }

      this.syncStatus.lastScoreSync = new Date().toISOString();
      await this.persistSyncTimestamps();
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    return { synced, errors };
  }

  /** Sync Control Profiles (full replace). */
  async syncControlProfiles(): Promise<SyncResult> {
    const client = await this.ensureGraphClient();
    const es = await this.getEsClient();
    await ensureDefenderIndex();

    const errors: string[] = [];
    let synced = 0;

    try {
      const profiles = await client.getControlProfiles();

      const integrationsService = new IntegrationsSettingsService();
      const creds = (await integrationsService.getDefenderCredentials())!;

      await es.deleteByQuery({
        index: DEFENDER_INDEX,
        query: { term: { doc_type: 'control_profile' } },
        refresh: true,
      }).catch(() => {
        // Index might not exist yet, ignore
      });

      if (profiles.length > 0) {
        const operations = profiles.flatMap((profile) => {
          const doc = this.transformControl(profile, creds.tenant_id);
          return [
            { index: { _index: DEFENDER_INDEX, _id: `control-${profile.id}` } },
            doc,
          ];
        });

        const result = await es.bulk({ operations, refresh: 'wait_for' });

        if (result.errors) {
          for (const item of result.items) {
            const op = item.index;
            if (op?.error) {
              errors.push(`Control ${op._id}: ${op.error.reason}`);
            }
          }
        }

        synced = profiles.length - errors.length;
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    this.syncStatus.lastControlSync = new Date().toISOString();
    return { synced, errors };
  }

  /** Sync Alerts (incremental — only new/updated since last sync). */
  async syncAlerts(): Promise<SyncResult> {
    await this.loadPersistedSyncStatus();

    const client = await this.ensureGraphClient();
    const es = await this.getEsClient();
    await ensureDefenderIndex();

    const errors: string[] = [];
    let synced = 0;

    try {
      // Build filter: incremental if we have a checkpoint, otherwise 90-day lookback
      let filter: string;
      if (this.syncStatus.lastAlertSync) {
        filter = `lastUpdateDateTime ge ${this.syncStatus.lastAlertSync}`;
      } else {
        const lookback = new Date(Date.now() - INITIAL_ALERT_LOOKBACK_DAYS * 86400_000);
        filter = `createdDateTime ge ${lookback.toISOString()}`;
        console.log(`[Defender] Initial alert sync — fetching last ${INITIAL_ALERT_LOOKBACK_DAYS} days`);
      }

      const alerts = await client.getAlerts(filter);

      const integrationsService = new IntegrationsSettingsService();
      const creds = (await integrationsService.getDefenderCredentials())!;

      if (alerts.length > 0) {
        const operations = alerts.flatMap((alert) => {
          const doc = this.transformAlert(alert, creds.tenant_id);
          return [
            { index: { _index: DEFENDER_INDEX, _id: `alert-${alert.id}` } },
            doc,
          ];
        });

        const result = await es.bulk({ operations, refresh: 'wait_for' });

        if (result.errors) {
          for (const item of result.items) {
            const op = item.index;
            if (op?.error) {
              errors.push(`Alert ${op._id}: ${op.error.reason}`);
            }
          }
        }

        synced = alerts.length - errors.length;
      }

      // Only update checkpoint on successful fetch
      this.syncStatus.lastAlertSync = new Date().toISOString();
      await this.persistSyncTimestamps();
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    return { synced, errors };
  }

  /**
   * Run the Defender evidence enrichment pass. Non-blocking: any failure
   * is captured and returned without throwing, so the sync loop stays
   * healthy and the pass will self-heal on the next cycle. Early-returns
   * as a no-op when Defender integration is not configured.
   */
  private async runEnrichmentPass(): Promise<EnrichmentPassResult> {
    try {
      const integrationsService = new IntegrationsSettingsService();
      if (!(await integrationsService.isDefenderConfigured())) {
        return { scanned: 0, detected: 0, skipped: 0, batches: 0, errors: [], durationMs: 0 };
      }
      const es = await this.getEsClient();
      const settingsService = new SettingsService();
      const settings = await settingsService.getSettings();
      const service = new DefenderEnrichmentService(es, settings.indexPattern);
      const result = await service.runEnrichmentPass({ lookbackDays: 90 });
      console.log(
        `[Defender-Enrichment] scanned=${result.scanned} detected=${result.detected} ` +
        `skipped=${result.skipped} batches=${result.batches} ` +
        `durationMs=${result.durationMs} errors=${result.errors.length}`,
      );
      for (const e of result.errors) {
        console.warn(`[Defender-Enrichment-ERROR] ${e}`);
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Defender-Enrichment] pass threw: ${msg}`);
      return { scanned: 0, detected: 0, skipped: 0, batches: 0, errors: [msg], durationMs: 0 };
    }
  }

  /** Run all three syncs. */
  async syncAll(): Promise<DefenderSyncResult> {
    const [scores, controls, alerts] = await Promise.all([
      this.syncSecureScores(),
      this.syncControlProfiles(),
      this.syncAlerts(),
    ]);

    // Run enrichment AFTER alerts are synced so fresh alerts are
    // in the index when we evaluate test docs.
    const enrichment = await this.runEnrichmentPass();

    const result: DefenderSyncResult = {
      scores,
      controls,
      alerts,
      enrichment,
      timestamp: new Date().toISOString(),
    };

    this.syncStatus.lastSyncResult = result;
    return result;
  }

  /** Get the current sync status for the UI. */
  getSyncStatus(): DefenderSyncStatus {
    return { ...this.syncStatus };
  }
}
