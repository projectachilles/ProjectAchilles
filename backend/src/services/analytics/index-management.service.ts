// Index management service — creates and lists ES indices with the canonical
// mapping used by the results ingestion pipeline.

import type { Client, estypes } from '@elastic/elasticsearch';
import { SettingsService } from './settings.js';
import { createEsClient } from './client.js';
import { EDR_VENDOR_KEYS } from '../outcomes/vendors.js';
import { createAchillesIndex } from '../shared/esIndexCreate.js';

export interface IndexInfo {
  name: string;
  docsCount: number;
  storeSize: number;
  status: string;
}

export const RESULTS_INDEX_MAPPING = {
  mappings: {
    properties: {
      routing: {
        properties: {
          event_time: { type: 'date' as const },
          oid: { type: 'keyword' as const },
          hostname: { type: 'keyword' as const },
        },
      },
      f0rtika: {
        properties: {
          test_uuid: { type: 'keyword' as const },
          test_name: { type: 'keyword' as const },
          is_protected: { type: 'boolean' as const },
          error_name: { type: 'keyword' as const },
          category: { type: 'keyword' as const },
          subcategory: { type: 'keyword' as const },
          severity: { type: 'keyword' as const },
          techniques: { type: 'keyword' as const },
          tactics: { type: 'keyword' as const },
          target: { type: 'keyword' as const },
          complexity: { type: 'keyword' as const },
          threat_actor: { type: 'keyword' as const },
          tags: { type: 'keyword' as const },
          score: { type: 'float' as const },
          bundle_id: { type: 'keyword' as const },
          bundle_name: { type: 'keyword' as const },
          control_id: { type: 'keyword' as const },
          control_validator: { type: 'keyword' as const },
          control_description: { type: 'text' as const, index: false },
          compliant: { type: 'boolean' as const },
          control_status: { type: 'keyword' as const },
          expected: { type: 'text' as const, index: false },
          actual: { type: 'text' as const, index: false },
          details: { type: 'text' as const, index: false },
          skipped: { type: 'boolean' as const },
          error_message: { type: 'text' as const, index: false },
          applicability: { type: 'keyword' as const },
          evidence_source: { type: 'keyword' as const },
          observed_at: { type: 'date' as const },
          remediation: { type: 'text' as const, index: false },
          evidence: { type: 'object' as const, enabled: false },
          bundle_schema_version: { type: 'keyword' as const },
          execution_status: { type: 'keyword' as const },
          compliance_status: { type: 'keyword' as const },
          assessment_complete: { type: 'boolean' as const },
          benchmark: {
            properties: {
              framework: { type: 'keyword' as const },
              product: { type: 'keyword' as const },
              version: { type: 'keyword' as const },
              profile: { type: 'keyword' as const },
              recommendation_id: { type: 'keyword' as const },
              source: { type: 'keyword' as const },
            },
          },
          endpoint_context: {
            properties: {
              hostname: { type: 'keyword' as const },
              os_family: { type: 'keyword' as const },
              os_product: { type: 'keyword' as const },
              os_version: { type: 'keyword' as const },
              os_build: { type: 'keyword' as const },
              architecture: { type: 'keyword' as const },
              os_role: { type: 'keyword' as const },
              role_source: { type: 'keyword' as const },
              domain_joined: { type: 'boolean' as const },
              entra_joined: { type: 'boolean' as const },
            },
          },
          is_bundle_control: { type: 'boolean' as const },
          // Whole-test result written when an EDR killed the agent mid-run
          // (no per-stage data exists, so stages_unknown is set).
          edr_terminated: { type: 'boolean' as const },
          edr_terminated_vendors: { type: 'keyword' as const },
          edr_terminated_alert_ids: { type: 'keyword' as const },
          stages_unknown: { type: 'boolean' as const },
          // A 260 (blocked before execution) result an EDR's own prevention
          // alert proved was the EDR blocking the test at launch: rewritten in
          // place to 126 by edr/launch-block-reconcile.service.ts, with the
          // audit trail in launch_block. Like edr_terminated, it counts for the
          // test but never for a technique (no stage ran).
          edr_launch_blocked: { type: 'boolean' as const },
          launch_block: {
            properties: {
              original_exit_code: { type: 'integer' as const },
              original_error_name: { type: 'keyword' as const },
              vendors: { type: 'keyword' as const },
              alert_ids: { type: 'keyword' as const },
              evidence: { type: 'keyword' as const },
              resolved_at: { type: 'date' as const },
            },
          },
          // Per EDR registry vendor (services/outcomes/vendors.ts), the flags its
          // enrichment pass writes: <key>_detected (bundle-scoped match),
          // <key>_stage_detected (alert names THIS stage's own binary;
          // drives the per-stage "Detected" badge), <key>_prevented
          // (vendor-confirmed prevention, subset of detected) and
          // <key>_prevention_action.
          ...edrFlagMappings(),
          tenant_label: { type: 'keyword' as const },
        },
      },
      event: {
        properties: {
          // long, not integer: Windows exit codes are unsigned 32-bit
          // (NTSTATUS/HRESULT-style codes from an EDR kill exceed int32).
          // Indices created before this change keep `integer` — the ingestion
          // path coerces out-of-range codes (see sanitizeExitCode).
          ERROR: { type: 'long' as const },
          ERROR_raw: { type: 'keyword' as const },
        },
      },
    },
  },
};

interface MappingNode {
  type?: string;
  properties?: MappingProps;
  [param: string]: unknown;
}
type MappingProps = Record<string, MappingNode>;

const nodeType = (node: MappingNode): string => node.type ?? (node.properties ? 'object' : 'unknown');

/**
 * The canonical fields a live mapping lacks, as a `properties` tree for putMapping.
 * A field the live mapping already has is never re-sent, whatever its type or
 * parameters: ES can't change an existing field's type, and one conflicting
 * field makes it reject the whole putMapping (illegal_argument_exception).
 * Type mismatches are returned in `conflicts` so the caller can report them.
 */
export function missingMappingProperties(
  live: MappingProps,
  canonical: MappingProps,
  prefix = '',
): { missing: MappingProps; conflicts: string[] } {
  const missing: MappingProps = {};
  const conflicts: string[] = [];
  for (const [name, want] of Object.entries(canonical)) {
    const path = prefix ? `${prefix}.${name}` : name;
    const have = live[name];
    if (!have) {
      missing[name] = want;
      continue;
    }
    const haveType = nodeType(have);
    const wantType = nodeType(want);
    if (haveType !== wantType) {
      conflicts.push(`${path}: ${haveType} (wanted ${wantType})`);
      continue;
    }
    if (want.properties) {
      const child = missingMappingProperties(have.properties ?? {}, want.properties, path);
      if (Object.keys(child.missing).length) missing[name] = { properties: child.missing };
      conflicts.push(...child.conflicts);
    }
  }
  return { missing, conflicts };
}

/** Union of the field trees of every index behind `indexName` (an alias can cover several). */
function mergeLiveProperties(response: Record<string, { mappings?: { properties?: MappingProps } }>): MappingProps {
  const merge = (into: MappingProps, from: MappingProps): MappingProps => {
    for (const [name, node] of Object.entries(from)) {
      const existing = into[name];
      if (!existing) into[name] = node;
      else if (existing.properties && node.properties) {
        into[name] = { ...existing, properties: merge({ ...existing.properties }, node.properties) };
      }
    }
    return into;
  };
  return Object.values(response).reduce<MappingProps>((acc, idx) => merge(acc, idx.mappings?.properties ?? {}), {});
}

/**
 * Bring an existing results index up to the canonical mapping, additively.
 * Best effort: a failure here is logged and never blocks writes. Without the
 * new fields ES still accepts documents (it maps unknown fields dynamically).
 */
async function addMissingResultsMappings(client: Client, indexName: string): Promise<string> {
  try {
    const live = mergeLiveProperties(
      await client.indices.getMapping({ index: indexName }) as Record<string, { mappings?: { properties?: MappingProps } }>,
    );
    const { missing, conflicts } = missingMappingProperties(
      live,
      RESULTS_INDEX_MAPPING.mappings.properties as unknown as MappingProps,
    );
    if (conflicts.length) {
      console.warn(
        `[IndexManagement] "${indexName}" has fields whose type differs from the canonical mapping; ` +
          `left as is (reindex to fix): ${conflicts.join(', ')}`,
      );
    }
    if (!Object.keys(missing).length) return 'mappings up to date';
    await client.indices.putMapping({
      index: indexName,
      properties: missing as unknown as Record<string, estypes.MappingProperty>,
    });
    return 'mappings updated';
  } catch (err) {
    const reason = (err as { meta?: { body?: { error?: { reason?: string } } } })?.meta?.body?.error?.reason
      ?? (err instanceof Error ? err.message : String(err));
    console.warn(`[IndexManagement] mapping update for "${indexName}" failed; writes continue: ${reason}`);
    return `mapping update failed (${reason})`;
  }
}

export async function createResultsIndex(
  indexName: string,
): Promise<{ created: boolean; message: string }> {
  const settingsService = new SettingsService();
  const settings = settingsService.getSettings();

  if (!settings.configured) {
    throw new Error('Elasticsearch is not configured. Configure it in Analytics Settings first.');
  }

  const client = createEsClient(settings);

  try {
    await createAchillesIndex(client, indexName, RESULTS_INDEX_MAPPING);
    return { created: true, message: `Index "${indexName}" created successfully` };
  } catch (err: unknown) {
    // ES returns 400 with resource_already_exists_exception when the index exists
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 400) {
      if (indexName.startsWith('achilles-results-')) {
        const outcome = await addMissingResultsMappings(client, indexName);
        return { created: false, message: `Index "${indexName}" already exists; ${outcome}` };
      }
      return { created: false, message: `Index "${indexName}" already exists` };
    }
    throw err;
  }
}

export async function listResultsIndices(pattern: string): Promise<IndexInfo[]> {
  const settingsService = new SettingsService();
  const settings = settingsService.getSettings();

  if (!settings.configured) {
    throw new Error('Elasticsearch is not configured. Configure it in Analytics Settings first.');
  }

  const client = createEsClient(settings);

  try {
    const response = await client.cat.indices({ index: pattern, format: 'json', bytes: 'b' });
    const indices = Array.isArray(response) ? response : [];

    return indices
      .map((idx) => {
        // Elastic Cloud Serverless returns store.size as "0" — use
        // dataset.size (serverless-only field) as a fallback.
        const record = idx as Record<string, unknown>;
        const storeSize = parseInt(String(idx['store.size'] ?? '0'), 10);
        const datasetSize = parseInt(String(record['dataset.size'] ?? '0'), 10);

        return {
          name: String(idx.index ?? ''),
          docsCount: parseInt(String(idx['docs.count'] ?? '0'), 10),
          storeSize: storeSize || datasetSize,
          status: String(idx.health ?? 'unknown'),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err: unknown) {
    // ES returns 404 when no indices match the pattern
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404) {
      return [];
    }
    throw err;
  }
}

function edrFlagMappings(): Record<string, { type: 'boolean' | 'keyword' }> {
  return Object.fromEntries(
    EDR_VENDOR_KEYS.flatMap((v) => [
      [`${v}_detected`, { type: 'boolean' as const }],
      [`${v}_stage_detected`, { type: 'boolean' as const }],
      [`${v}_prevented`, { type: 'boolean' as const }],
      [`${v}_prevention_action`, { type: 'keyword' as const }],
    ]),
  );
}
