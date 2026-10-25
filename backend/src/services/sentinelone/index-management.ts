// Elasticsearch index management for SentinelOne data.
// Single index "achilles-sentinelone" with a doc_type discriminator:
//   - 'alert'            normalized threats + cloud-detection alerts
//   - 'response_action'  audit trail of response actions taken from Achilles
// Alert fields mirror achilles-crowdstrike / achilles-defender so analytics,
// correlation and reporting code can treat it the same way.

import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';

export const SENTINELONE_INDEX = 'achilles-sentinelone';

const keywordText = (ignoreAbove: number) => ({
  type: 'text' as const,
  fields: { keyword: { type: 'keyword' as const, ignore_above: ignoreAbove } },
});

export const SENTINELONE_INDEX_MAPPING = {
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

      // --- SentinelOne-specific ---
      account_id: { type: 'keyword' as const },
      site_id: { type: 'keyword' as const },
      group_id: { type: 'keyword' as const },
      agent_id: { type: 'keyword' as const },
      storyline_id: { type: 'keyword' as const },
      threat_id: { type: 'keyword' as const },
      confidence_level: { type: 'keyword' as const },
      classification: { type: 'keyword' as const },
      analyst_verdict: { type: 'keyword' as const },
      mitigation_status: { type: 'keyword' as const },
      sha1: { type: 'keyword' as const },
      sha256: { type: 'keyword' as const },

      // --- Response action audit ---
      action_kind: { type: 'keyword' as const },
      action: { type: 'keyword' as const },
      target_ids: { type: 'keyword' as const },
      requested_by: { type: 'keyword' as const },
      org_id: { type: 'keyword' as const },
      permission_mode: { type: 'keyword' as const },
      outcome: { type: 'keyword' as const },
      affected: { type: 'integer' as const },
      error: { type: 'text' as const },

      // Achilles correlation fields (same object as the other EDR indexes).
      f0rtika: {
        properties: {
          achilles_correlated: { type: 'boolean' as const },
          achilles_test_uuid: { type: 'keyword' as const },
          achilles_matched_at: { type: 'date' as const },
          // Auto-resolve receipts (incident status → resolved + note).
          auto_resolved: { type: 'boolean' as const },
          auto_resolved_at: { type: 'date' as const },
          auto_resolve_mode: { type: 'keyword' as const },
          auto_resolve_error: { type: 'keyword' as const },
          // Automatic-mitigation receipts (opt-in, Response mode only).
          auto_mitigated: { type: 'boolean' as const },
          auto_mitigated_at: { type: 'date' as const },
          auto_mitigation_mode: { type: 'keyword' as const },
          auto_mitigation_action: { type: 'keyword' as const },
          auto_mitigation_error: { type: 'keyword' as const },
        },
      },
    },
  },
};

/**
 * Ensure the SentinelOne index exists. Existence is checked first so an ES
 * API key without `create_index` (least privilege) still works once the
 * index has been created by an admin.
 */
export async function ensureSentinelOneIndex(): Promise<void> {
  const settings = new SettingsService().getSettings();
  if (!settings.configured) throw new Error('Elasticsearch is not configured');
  const client = createEsClient(settings);
  const exists = await client.indices.exists({ index: SENTINELONE_INDEX });
  if (exists) {
    // Propagate additive mapping changes; non-fatal.
    await client.indices.putMapping({ index: SENTINELONE_INDEX, properties: SENTINELONE_INDEX_MAPPING.mappings.properties })
      .catch((err: unknown) => console.warn(`[SentinelOne] putMapping failed: ${err instanceof Error ? err.message : String(err)}`));
    return;
  }
  try {
    await client.indices.create({ index: SENTINELONE_INDEX, ...SENTINELONE_INDEX_MAPPING });
  } catch (err: unknown) {
    // 400 resource_already_exists (race with another sync) is fine.
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 400) return;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Posture index: exclusions, protection policies, agent inventory and agent
// health snapshots. Kept apart from the alert index so its field names
// (type, value, mode, name ...) never collide with the alert mapping.
//   doc_type 'exclusion'     one per exclusion  (_id exclusion-<id>)
//   doc_type 'policy'        one per scope      (_id policy-<level>-<id>)
//   doc_type 'agent'         one per agent      (_id agent-<id>)
//   doc_type 'agent_health'  time series of /agents/count snapshots
// Docs from the previous pass are removed by `snapshot_id`.
// ---------------------------------------------------------------------------

export const SENTINELONE_POSTURE_INDEX = 'achilles-sentinelone-posture';

const kw = { type: 'keyword' as const };
const bool = { type: 'boolean' as const };

export const SENTINELONE_POSTURE_MAPPING = {
  mappings: {
    properties: {
      doc_type: kw,
      snapshot_id: kw,
      timestamp: { type: 'date' as const },
      // scope
      level: kw,
      scope_id: kw,
      scope_name: kw,
      account_id: kw,
      site_id: kw,
      group_id: kw,
      site_name: kw,
      // exclusion
      exclusion_id: kw,
      exclusion_type: kw,
      value: { type: 'text' as const, fields: { keyword: { type: 'keyword' as const, ignore_above: 2048 } } },
      os_type: kw,
      path_exclusion_type: kw,
      exclusion_mode: kw,
      description: { type: 'text' as const },
      source: kw,
      created_at: { type: 'date' as const },
      // policy
      inherits: bool,
      mitigation_mode: kw,
      mitigation_mode_suspicious: kw,
      auto_mitigation_action: kw,
      anti_tampering_on: bool,
      snapshots_on: bool,
      agent_ui_on: bool,
      engines_on: kw,
      engines_off: kw,
      policy_error: kw,
      counts_error: kw,
      // agent
      agent_id: kw,
      computer_name: kw,
      agent_version: kw,
      is_active: bool,
      infected: bool,
      is_up_to_date: bool,
      network_status: kw,
      // agent health counts
      counts: {
        properties: {
          total: { type: 'integer' as const },
          active: { type: 'integer' as const },
          infected: { type: 'integer' as const },
          outdated: { type: 'integer' as const },
          detect_only: { type: 'integer' as const },
          disconnected: { type: 'integer' as const },
        },
      },
      // Unparsed API object for audit / display of fields we don't map.
      raw: { type: 'object' as const, enabled: false },
    },
  },
};

export async function ensureSentinelOnePostureIndex(): Promise<void> {
  const settings = new SettingsService().getSettings();
  if (!settings.configured) throw new Error('Elasticsearch is not configured');
  const client = createEsClient(settings);
  const exists = await client.indices.exists({ index: SENTINELONE_POSTURE_INDEX });
  if (exists) {
    await client.indices.putMapping({ index: SENTINELONE_POSTURE_INDEX, properties: SENTINELONE_POSTURE_MAPPING.mappings.properties })
      .catch((err: unknown) => console.warn(`[SentinelOne-Posture] putMapping failed: ${err instanceof Error ? err.message : String(err)}`));
    return;
  }
  try {
    await client.indices.create({ index: SENTINELONE_POSTURE_INDEX, ...SENTINELONE_POSTURE_MAPPING });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 400) return;
    throw err;
  }
}
