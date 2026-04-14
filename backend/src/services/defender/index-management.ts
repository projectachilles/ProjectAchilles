// Elasticsearch index management for Defender data.
// Single index "achilles-defender" with a doc_type discriminator.

import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import type { IndexInfo } from '../analytics/index-management.service.js';

export const DEFENDER_INDEX = 'achilles-defender';

export const DEFENDER_INDEX_MAPPING = {
  mappings: {
    properties: {
      doc_type: { type: 'keyword' as const },
      timestamp: { type: 'date' as const },
      tenant_id: { type: 'keyword' as const },

      // --- Secure Score fields ---
      current_score: { type: 'float' as const },
      max_score: { type: 'float' as const },
      score_percentage: { type: 'float' as const },
      control_scores: {
        type: 'nested' as const,
        properties: {
          name: { type: 'keyword' as const },
          category: { type: 'keyword' as const },
          score: { type: 'float' as const },
        },
      },
      average_comparative_score: { type: 'float' as const },

      // --- Control Profile fields ---
      control_name: { type: 'keyword' as const },
      control_category: { type: 'keyword' as const },
      title: { type: 'text' as const, fields: { keyword: { type: 'keyword' as const } } },
      implementation_cost: { type: 'keyword' as const },
      user_impact: { type: 'keyword' as const },
      rank: { type: 'integer' as const },
      threats: { type: 'keyword' as const },
      deprecated: { type: 'boolean' as const },
      remediation_summary: { type: 'text' as const },
      action_url: { type: 'keyword' as const },
      tier: { type: 'keyword' as const },

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
      // text + .keyword multi-field: matches the dynamic mapping that ES
      // produced for the original index. Queries must target the .keyword
      // subfield for exact / wildcard matches on hyphenated UUIDs, since
      // the parent text field tokenizes on '-' and '.'.
      evidence_hostnames: {
        type: 'text' as const,
        fields: { keyword: { type: 'keyword' as const, ignore_above: 256 } },
      },
      evidence_filenames: {
        type: 'text' as const,
        fields: { keyword: { type: 'keyword' as const, ignore_above: 256 } },
      },

      // Achilles correlation + auto-resolve fields.
      // Populated on ALERT docs by:
      //   - enrichment.service.ts  (achilles_correlated, achilles_test_uuid, achilles_matched_at)
      //   - auto-resolve.service.ts (auto_resolved, auto_resolved_at, auto_resolve_mode, auto_resolve_error)
      // Object mapping (not nested) — single sub-object per alert doc; dotted-path queries work directly.
      f0rtika: {
        properties: {
          achilles_correlated: { type: 'boolean' as const },
          achilles_test_uuid:  { type: 'keyword' as const },
          achilles_matched_at: { type: 'date' as const },
          auto_resolved:       { type: 'boolean' as const },
          auto_resolved_at:    { type: 'date' as const },
          auto_resolve_mode:   { type: 'keyword' as const },
          auto_resolve_error:  { type: 'keyword' as const },
        },
      },
    },
  },
};

/** Create the Defender index if it doesn't exist. */
export async function createDefenderIndex(): Promise<{ created: boolean; message: string }> {
  const settingsService = new SettingsService();
  const settings = settingsService.getSettings();

  if (!settings.configured) {
    throw new Error('Elasticsearch is not configured');
  }

  const client = createEsClient(settings);

  try {
    await client.indices.create({
      index: DEFENDER_INDEX,
      ...DEFENDER_INDEX_MAPPING,
    });
    return { created: true, message: `Index "${DEFENDER_INDEX}" created successfully` };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 400) {
      return { created: false, message: `Index "${DEFENDER_INDEX}" already exists` };
    }
    throw err;
  }
}

/** Ensure the Defender index exists (create if missing, no-op if exists). */
export async function ensureDefenderIndex(): Promise<void> {
  await createDefenderIndex();
}

/**
 * Idempotently apply the Defender index mapping to an existing index.
 * Used to propagate additive mapping changes (e.g., new f0rtika.* fields)
 * to indexes created before those fields were declared. Safe to call on
 * every sync cycle — Elasticsearch ignores no-op mapping updates.
 *
 * Does nothing if Elasticsearch is not configured or the index doesn't
 * exist yet; the next ensureDefenderIndex() call will create it with the
 * full mapping.
 */
export async function ensureDefenderIndexMappings(): Promise<void> {
  const settingsService = new SettingsService();
  const settings = settingsService.getSettings();
  if (!settings.configured) return;

  const client = createEsClient(settings);

  try {
    const exists = await client.indices.exists({ index: DEFENDER_INDEX });
    if (!exists) return;

    await client.indices.putMapping({
      index: DEFENDER_INDEX,
      properties: DEFENDER_INDEX_MAPPING.mappings.properties,
    });
  } catch (err) {
    // Non-fatal — index may not exist yet, or cluster may be transiently unavailable.
    // Propagating the error would block the sync cycle; the next cycle will retry.
    console.warn(`[Defender] ensureDefenderIndexMappings failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** List the Defender index info. */
export async function listDefenderIndices(): Promise<IndexInfo[]> {
  const settingsService = new SettingsService();
  const settings = settingsService.getSettings();

  if (!settings.configured) {
    throw new Error('Elasticsearch is not configured');
  }

  const client = createEsClient(settings);

  try {
    const response = await client.cat.indices({ index: DEFENDER_INDEX, format: 'json', bytes: 'b' });
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
