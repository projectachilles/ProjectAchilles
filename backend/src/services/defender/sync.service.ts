// Defender data sync service — fetches from Microsoft Graph and indexes to ES.
// Supports manual and automatic (interval-based) sync.

import { MicrosoftGraphClient } from './graph-client.js';
import { ensureDefenderIndex, DEFENDER_INDEX } from './index-management.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';
import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
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
} from '../../types/defender.js';

/** Days of alert history to fetch on first sync (no persisted lastAlertSync). */
const INITIAL_ALERT_LOOKBACK_DAYS = 90;

/**
 * Bump this when the alert schema changes (e.g. new extracted fields) to
 * force a full re-sync on all deployments. The persisted sync_version is
 * compared against this; a mismatch clears lastAlertSync.
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

  private ensureGraphClient(): MicrosoftGraphClient {
    // Always recreate from current credentials so UI changes take effect
    const integrationsService = new IntegrationsSettingsService();
    const creds = integrationsService.getDefenderCredentials();

    if (!creds) {
      throw new Error('Defender integration is not configured');
    }

    this.graphClient = new MicrosoftGraphClient(creds.tenant_id, creds.client_id, creds.client_secret);
    return this.graphClient;
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

      // Self-healing: remove bogus file-based defender entry with empty credentials.
      // A prior code version accidentally wrote configured:true with empty creds
      // when persisting sync timestamps, shadowing env-var-based credentials.
      this.cleanupBogusDefenderEntry(integrationsService);

      const timestamps = integrationsService.getDefenderSyncTimestamps();

      // If sync version changed (schema upgrade), force a full re-sync
      if (timestamps.sync_version !== ALERT_SYNC_VERSION) {
        console.log(`[Defender] Sync version mismatch (${timestamps.sync_version ?? 'none'} → ${ALERT_SYNC_VERSION}) — forcing full re-sync`);
        return; // Leave lastAlertSync as null to trigger 90-day lookback
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

  /** Remove a file-based defender entry that has configured:true but empty credentials. */
  private cleanupBogusDefenderEntry(integrationsService: IntegrationsSettingsService): void {
    try {
      // Only relevant when credentials come from env vars
      if (!integrationsService.isEnvDefenderConfigured()) return;

      const settings = integrationsService.getDefenderSettings();
      if (!settings) return;

      // If file-based entry exists with empty credentials, it's the bogus one
      const creds = integrationsService.getDefenderCredentials();
      if (creds) return; // Credentials resolve fine — nothing to fix

      // getDefenderSettings returned non-null (file entry exists with configured:true)
      // but getDefenderCredentials returned null (empty creds) → bogus entry
      console.warn('[Defender] Cleaning up bogus file-based defender entry with empty credentials');
      integrationsService.deleteDefenderSettings();
    } catch {
      // Non-fatal
    }
  }

  /** Persist sync timestamps without touching credentials. */
  private persistSyncTimestamps(): void {
    try {
      const integrationsService = new IntegrationsSettingsService();
      integrationsService.saveDefenderSyncTimestamps({
        last_alert_sync: this.syncStatus.lastAlertSync ?? undefined,
        last_score_sync: this.syncStatus.lastScoreSync ?? undefined,
        sync_version: ALERT_SYNC_VERSION,
      });
    } catch {
      // Non-fatal — sync continues, timestamps just won't survive next restart
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
    // Extract hostnames and filenames from evidence for precise correlation
    const hostnames = new Set<string>();
    const filenames = new Set<string>();

    for (const ev of alert.evidence ?? []) {
      // Device evidence → hostname
      if (ev.deviceDnsName) {
        hostnames.add(ev.deviceDnsName.toUpperCase());
      }
      // Process evidence → binary filename
      if (ev.imageFile?.fileName) {
        filenames.add(ev.imageFile.fileName.toLowerCase());
      }
      if (ev.parentProcess?.imageFile?.fileName) {
        filenames.add(ev.parentProcess.imageFile.fileName.toLowerCase());
      }
      // File evidence → filename
      if (ev.fileDetails?.fileName) {
        filenames.add(ev.fileDetails.fileName.toLowerCase());
      }
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
    this.loadPersistedSyncStatus();

    const client = this.ensureGraphClient();
    const es = this.getEsClient();
    await ensureDefenderIndex();

    const errors: string[] = [];
    let synced = 0;

    try {
      const scores = await client.getSecureScores(90);

      if (scores.length > 0) {
        const operations = scores.flatMap((score) => {
          const doc = this.transformScore(score);
          const dateStr = score.createdDateTime.split('T')[0]; // YYYY-MM-DD
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
      this.persistSyncTimestamps();
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    return { synced, errors };
  }

  /** Sync Control Profiles (full replace). */
  async syncControlProfiles(): Promise<SyncResult> {
    const client = this.ensureGraphClient();
    const es = this.getEsClient();
    await ensureDefenderIndex();

    const errors: string[] = [];
    let synced = 0;

    try {
      const profiles = await client.getControlProfiles();

      // Get tenant_id from credentials
      const integrationsService = new IntegrationsSettingsService();
      const creds = integrationsService.getDefenderCredentials()!;

      // Delete existing control profiles
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
    this.loadPersistedSyncStatus();

    const client = this.ensureGraphClient();
    const es = this.getEsClient();
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

      // Get tenant_id from credentials
      const integrationsService = new IntegrationsSettingsService();
      const creds = integrationsService.getDefenderCredentials()!;

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

      // Only update checkpoint on successful fetch (not on error)
      this.syncStatus.lastAlertSync = new Date().toISOString();
      this.persistSyncTimestamps();
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    return { synced, errors };
  }

  /** Run all three syncs. */
  async syncAll(): Promise<DefenderSyncResult> {
    const [scores, controls, alerts] = await Promise.all([
      this.syncSecureScores(),
      this.syncControlProfiles(),
      this.syncAlerts(),
    ]);

    const result: DefenderSyncResult = {
      scores,
      controls,
      alerts,
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
