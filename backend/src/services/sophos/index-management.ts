// Elasticsearch index management for Sophos Central data.
// Single index "achilles-sophos" with a doc_type discriminator:
//   - 'alert'           normalized Common API alerts, SIEM events and XDR detections
//   - 'health_check'    account Health Check scores (posture)
//   - 'endpoint_health' per-endpoint health snapshots (posture)
//   - 'policy'          policy inventory (posture)
//   - 'exclusion'       exclusions (posture)
//   - 'allowed_item'    allowed items (posture)
// Alert fields mirror achilles-crowdstrike / achilles-sentinelone so analytics,
// correlation and reporting code can treat it the same way. Posture docs carry
// their varying fields as dynamic objects under health / endpoint / policy /
// exclusion, so they never collide with the alert vocabulary.

import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';

export const SOPHOS_INDEX = 'achilles-sophos';

const keywordText = (ignoreAbove: number) => ({
  type: 'text' as const,
  fields: { keyword: { type: 'keyword' as const, ignore_above: ignoreAbove } },
});

const dynamicObject = { type: 'object' as const, dynamic: true };

export const SOPHOS_INDEX_MAPPING = {
  mappings: {
    properties: {
      doc_type: { type: 'keyword' as const },
      source_type: { type: 'keyword' as const },
      timestamp: { type: 'date' as const },

      // --- Alert fields (shared vocabulary with the other EDR indexes) ---
      alert_id: { type: 'keyword' as const },
      alert_title: { type: 'text' as const, fields: { keyword: { type: 'keyword' as const } } },
      description: { type: 'text' as const },
      severity: { type: 'keyword' as const },
      severity_raw: { type: 'keyword' as const },
      status: { type: 'keyword' as const },
      category: { type: 'keyword' as const },
      service_source: { type: 'keyword' as const },
      mitre_techniques: { type: 'keyword' as const },
      created_at: { type: 'date' as const },
      updated_at: { type: 'date' as const },
      resolved_at: { type: 'date' as const },
      recommended_actions: { type: 'text' as const },
      prevention_action: { type: 'keyword' as const },
      portal_url: { type: 'keyword' as const },
      evidence_hostnames: keywordText(256),
      evidence_filenames: keywordText(256),
      evidence_filepaths: keywordText(1024),

      // --- Sophos-specific ---
      sophos_type: { type: 'keyword' as const },
      origin: { type: 'keyword' as const },
      sha256: { type: 'keyword' as const },
      endpoint_id: { type: 'keyword' as const },
      event_ids: { type: 'keyword' as const },
      allowed_actions: { type: 'keyword' as const },
      merged_siem_event_ids: { type: 'keyword' as const },
      threat_id: { type: 'keyword' as const },

      // --- Posture docs (health_check, endpoint_health, policy, exclusion, allowed_item) ---
      // snapshot_id + source are keyword so the per-snapshot replace (term / must_not) is exact.
      snapshot_id: { type: 'keyword' as const },
      source: { type: 'keyword' as const },
      health: { type: 'object' as const, dynamic: true, properties: { headline: { type: 'float' as const } } },
      endpoint: dynamicObject,
      policy: dynamicObject,
      exclusion: dynamicObject,
      allowed_item: dynamicObject,

      // Achilles correlation fields (same object as the other EDR indexes).
      f0rtika: {
        properties: {
          achilles_correlated: { type: 'boolean' as const },
          achilles_test_uuid: { type: 'keyword' as const },
          achilles_matched_at: { type: 'date' as const },
          // EDR-killed agent runs (edr/agent-kill-reconcile.service.ts). A
          // separate link, never achilles_correlated, so auto-resolve skips them.
          achilles_agent_kill_task_id: { type: 'keyword' as const },
          achilles_agent_kill_matched_at: { type: 'date' as const },
          // Auto-resolve receipts (alert acknowledged / detection resolved).
          auto_resolved: { type: 'boolean' as const },
          auto_resolved_at: { type: 'date' as const },
          auto_resolve_mode: { type: 'keyword' as const },
          auto_resolve_error: { type: 'keyword' as const },
          auto_resolve_dry_run_at: { type: 'date' as const },
        },
      },
    },
  },
};

/**
 * Ensure the Sophos index exists. Existence is checked first so an ES API key
 * without `create_index` (least privilege) still works once the index has
 * been created by an admin.
 */
export async function ensureSophosIndex(): Promise<void> {
  const settings = new SettingsService().getSettings();
  if (!settings.configured) throw new Error('Elasticsearch is not configured');
  const client = createEsClient(settings);
  const exists = await client.indices.exists({ index: SOPHOS_INDEX });
  if (exists) {
    // Propagate additive mapping changes; non-fatal.
    await client.indices.putMapping({ index: SOPHOS_INDEX, properties: SOPHOS_INDEX_MAPPING.mappings.properties })
      .catch((err: unknown) => console.warn(`[Sophos] putMapping failed: ${err instanceof Error ? err.message : String(err)}`));
    return;
  }
  try {
    await client.indices.create({ index: SOPHOS_INDEX, ...SOPHOS_INDEX_MAPPING });
  } catch (err: unknown) {
    // 400 resource_already_exists (race with another sync) is fine.
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 400) return;
    throw err;
  }
}
