// SentinelOne threat mitigation executor (Response permission mode only) + audit trail.
//
// Its only caller is the opt-in automatic-mitigation pass; there are no
// manual response-action routes. Every attempt — accepted, rejected by the
// permission boundary, or failed at the API — is written as a
// `doc_type: 'response_action'` document to the achilles-sentinelone index
// (best-effort) and logged.

import { SentinelOneClient, SentinelOnePermissionError, SentinelOneApiError } from './s1-client.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';
import { ensureSentinelOneIndex, SENTINELONE_INDEX } from './index-management.js';
import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import type { SentinelOneResponseAction, SentinelOneResponseAuditDoc } from '../../types/sentinelone.js';

const MAX_TARGETS_PER_ACTION = 100;
const HISTORY_RING_SIZE = 200;

export interface ResponseActionOutcome {
  success: boolean;
  statusCode: number;
  affected?: number;
  error?: string;
  audit: SentinelOneResponseAuditDoc;
}

export class SentinelOneResponseService {
  /** In-memory fallback history (used when ES is not configured). */
  private history: SentinelOneResponseAuditDoc[] = [];

  async execute(
    action: SentinelOneResponseAction,
    actor: { userId: string; orgId?: string },
  ): Promise<ResponseActionOutcome> {
    const creds = new IntegrationsSettingsService(actor.orgId).getSentinelOneCredentials();
    const targetIds = action.threatIds;

    const audit: SentinelOneResponseAuditDoc = {
      doc_type: 'response_action',
      timestamp: new Date().toISOString(),
      action_kind: action.kind,
      action: action.action,
      target_ids: targetIds,
      requested_by: actor.userId,
      ...(actor.orgId ? { org_id: actor.orgId } : {}),
      permission_mode: creds?.permission_mode ?? 'read_only',
      outcome: 'failed',
    };

    let outcome: ResponseActionOutcome;
    try {
      if (!creds) {
        outcome = { success: false, statusCode: 400, error: 'SentinelOne integration is not configured', audit };
      } else if (targetIds.length === 0 || targetIds.length > MAX_TARGETS_PER_ACTION) {
        outcome = { success: false, statusCode: 400, error: `Between 1 and ${MAX_TARGETS_PER_ACTION} target ids are required`, audit };
      } else {
        // The client itself refuses writes in read_only mode (defence in depth —
        // the route checks the mode too).
        const client = new SentinelOneClient(creds);
        const res = await client.mitigateThreats(action.action, action.threatIds);
        audit.outcome = 'success';
        audit.affected = res.affected;
        outcome = { success: true, statusCode: 200, affected: res.affected, audit };
      }
    } catch (err) {
      if (err instanceof SentinelOnePermissionError) {
        audit.outcome = 'rejected';
        outcome = { success: false, statusCode: 403, error: err.message, audit };
      } else {
        const statusCode = err instanceof SentinelOneApiError ? (err.statusCode >= 500 ? 502 : err.statusCode) : 502;
        outcome = { success: false, statusCode, error: err instanceof Error ? err.message : String(err), audit };
      }
    }
    if (!outcome.success) audit.error = outcome.error;

    await this.recordAudit(audit);
    return outcome;
  }

  private async recordAudit(audit: SentinelOneResponseAuditDoc): Promise<void> {
    console.log(
      `[SentinelOne-Response] ${audit.outcome.toUpperCase()} ${audit.action_kind}/${audit.action} ` +
      `targets=${audit.target_ids.length} by=${audit.requested_by} mode=${audit.permission_mode}` +
      (audit.error ? ` error=${audit.error.slice(0, 200)}` : ''),
    );
    this.history.unshift(audit);
    if (this.history.length > HISTORY_RING_SIZE) this.history.length = HISTORY_RING_SIZE;

    try {
      const settings = new SettingsService().getSettings();
      if (!settings.configured) return;
      await ensureSentinelOneIndex();
      await createEsClient(settings).index({ index: SENTINELONE_INDEX, document: audit, refresh: 'wait_for' });
    } catch (err) {
      console.warn(`[SentinelOne-Response] audit write to ES failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Recent audit records — ES when available, else the in-memory ring. */
  async getHistory(limit = 50): Promise<SentinelOneResponseAuditDoc[]> {
    try {
      const settings = new SettingsService().getSettings();
      if (settings.configured) {
        const res = await createEsClient(settings).search<SentinelOneResponseAuditDoc>({
          index: SENTINELONE_INDEX,
          size: limit,
          query: { term: { doc_type: 'response_action' } },
          sort: [{ timestamp: 'desc' }],
        });
        return res.hits.hits.map((h) => h._source as SentinelOneResponseAuditDoc).filter(Boolean);
      }
    } catch {
      // Missing index / transient ES error — fall back to memory.
    }
    return this.history.slice(0, limit);
  }
}
