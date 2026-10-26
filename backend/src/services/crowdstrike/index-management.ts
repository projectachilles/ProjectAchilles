// Elasticsearch index management for CrowdStrike Falcon data.
// Single index "achilles-crowdstrike" with a doc_type discriminator.

import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import type { IndexInfo } from '../analytics/index-management.service.js';

export const CROWDSTRIKE_INDEX = 'achilles-crowdstrike';

export const CROWDSTRIKE_INDEX_MAPPING = {
  mappings: {
    properties: {
      doc_type: { type: 'keyword' as const },
      timestamp: { type: 'date' as const },
      cid: { type: 'keyword' as const },

      // --- ZTA score fields (daily org snapshot) ---
      overall_score: { type: 'float' as const },
      os_score: { type: 'float' as const },
      sensor_config_score: { type: 'float' as const },
      device_count: { type: 'integer' as const },
      min_score: { type: 'float' as const },
      max_score: { type: 'float' as const },

      // --- Alert fields ---
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
      // Prevention disposition (CrowdStrike-only; additive). prevention_action
      // is the derived enum (kill_failed/quarantined/process_killed/blocked);
      // the pattern_disposition* pair keeps the raw values for display/audit.
      prevention_action: { type: 'keyword' as const },
      pattern_disposition: { type: 'integer' as const },
      pattern_disposition_description: { type: 'keyword' as const },
      portal_url: { type: 'keyword' as const },
      // text + .keyword multi-field: matches the dynamic mapping that ES
      // produced for the original index on Render. Queries target both the
      // bare field and the .keyword subfield in a should[] disjunction —
      // some legacy clusters (commit 63236dd era) declared bare keyword
      // and ES rejects keyword→text type changes, so the mapping is
      // permanent on a given cluster. Tolerating either shape via the
      // query is safer than chasing the mapping. See evidence-correlation.ts.
      evidence_hostnames: {
        type: 'text' as const,
        fields: { keyword: { type: 'keyword' as const, ignore_above: 256 } },
      },
      evidence_filenames: {
        type: 'text' as const,
        fields: { keyword: { type: 'keyword' as const, ignore_above: 256 } },
      },
      // Filepaths for substring matching (Issue #2 / Option B). ignore_above
      // is larger than for filenames because Windows paths can be long.
      evidence_filepaths: {
        type: 'text' as const,
        fields: { keyword: { type: 'keyword' as const, ignore_above: 1024 } },
      },

      // Achilles correlation + auto-resolve fields.
      // Populated on ALERT docs by:
      //   - enrichment.service.ts  (achilles_correlated, achilles_test_uuid, achilles_matched_at)
      //   - edr/agent-kill-reconcile.service.ts (achilles_agent_kill_task_id, achilles_agent_kill_matched_at)
      //   - auto-resolve.service.ts (auto_resolved, auto_resolved_at, auto_resolve_mode, auto_resolve_error)
      // Object mapping (not nested) — single sub-object per alert doc; dotted-path queries work directly.
      f0rtika: {
        properties: {
          achilles_correlated: { type: 'boolean' as const },
          achilles_test_uuid:  { type: 'keyword' as const },
          achilles_matched_at: { type: 'date' as const },
          // EDR-killed agent runs (edr/agent-kill-reconcile.service.ts). A
          // separate link, never achilles_correlated, so auto-resolve skips them.
          achilles_agent_kill_task_id:    { type: 'keyword' as const },
          achilles_agent_kill_matched_at: { type: 'date' as const },
          auto_resolved:       { type: 'boolean' as const },
          auto_resolved_at:    { type: 'date' as const },
          auto_resolve_mode:   { type: 'keyword' as const },
          auto_resolve_error:  { type: 'keyword' as const },
        },
      },
    },
  },
};

/** Create the CrowdStrike index if it doesn't exist. */
export async function createCrowdStrikeIndex(): Promise<{ created: boolean; message: string }> {
  const settingsService = new SettingsService();
  const settings = settingsService.getSettings();

  if (!settings.configured) {
    throw new Error('Elasticsearch is not configured');
  }

  const client = createEsClient(settings);

  try {
    await client.indices.create({
      index: CROWDSTRIKE_INDEX,
      ...CROWDSTRIKE_INDEX_MAPPING,
    });
    return { created: true, message: `Index "${CROWDSTRIKE_INDEX}" created successfully` };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 400) {
      return { created: false, message: `Index "${CROWDSTRIKE_INDEX}" already exists` };
    }
    throw err;
  }
}

/**
 * Ensure the CrowdStrike index exists (create if missing, no-op if exists).
 *
 * Checks existence first: ES evaluates privileges before existence, so an
 * API key with read/write but no `create_index` on achilles-crowdstrike gets a
 * 403 (not the tolerated 400) from an unconditional indices.create — which
 * used to abort every sync on least-privilege keys.
 */
export async function ensureCrowdStrikeIndex(): Promise<void> {
  const settings = new SettingsService().getSettings();
  if (!settings.configured) {
    throw new Error('Elasticsearch is not configured');
  }
  const exists = await createEsClient(settings).indices.exists({ index: CROWDSTRIKE_INDEX });
  if (exists) return;
  await createCrowdStrikeIndex();
}

/**
 * Idempotently apply the CrowdStrike index mapping to an existing index.
 * Used to propagate additive mapping changes (e.g., new f0rtika.* fields)
 * to indexes created before those fields were declared. Safe to call on
 * every sync cycle — Elasticsearch ignores no-op mapping updates.
 *
 * Does nothing if Elasticsearch is not configured or the index doesn't
 * exist yet; the next ensureCrowdStrikeIndex() call will create it with the
 * full mapping.
 */
export async function ensureCrowdStrikeIndexMappings(): Promise<void> {
  const settingsService = new SettingsService();
  const settings = settingsService.getSettings();
  if (!settings.configured) return;

  const client = createEsClient(settings);

  try {
    const exists = await client.indices.exists({ index: CROWDSTRIKE_INDEX });
    if (!exists) return;

    await client.indices.putMapping({
      index: CROWDSTRIKE_INDEX,
      properties: CROWDSTRIKE_INDEX_MAPPING.mappings.properties,
    });
  } catch (err) {
    // Non-fatal — index may not exist yet, or cluster may be transiently unavailable.
    // Propagating the error would block the sync cycle; the next cycle will retry.
    console.warn(`[CrowdStrike] ensureCrowdStrikeIndexMappings failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** List the CrowdStrike index info. */
export async function listCrowdStrikeIndices(): Promise<IndexInfo[]> {
  const settingsService = new SettingsService();
  const settings = settingsService.getSettings();

  if (!settings.configured) {
    throw new Error('Elasticsearch is not configured');
  }

  const client = createEsClient(settings);

  try {
    const response = await client.cat.indices({ index: CROWDSTRIKE_INDEX, format: 'json', bytes: 'b' });
    const indices = Array.isArray(response) ? response : [];

    return indices.map((idx) => {
      const record = idx as Record<string, unknown>;
      const storeSize = parseInt(String(idx['store.size'] ?? '0'), 10);
      const datasetSize = parseInt(String(record['dataset.size'] ?? '0'), 10);

      return {
        name: String(idx.index ?? ''),
        docsCount: parseInt(String(idx['docs.count'] ?? '0'), 10),
        storeSize: storeSize || datasetSize,
        status: String(idx.health ?? 'unknown'),
      };
    });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404) {
      return [];
    }
    throw err;
  }
}
