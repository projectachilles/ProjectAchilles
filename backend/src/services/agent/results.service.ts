// Result ingestion service — transforms agent task results into the existing
// Elasticsearch document schema so the Analytics module works unchanged.

import type { Client } from '@elastic/elasticsearch';
import type { Task, TaskResult } from '../../types/agent.js';
import { ERROR_CODE_MAP } from '../analytics/elasticsearch.js';
import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';

// Protected exit codes: file quarantined, execution prevented, quarantined on execution
const PROTECTED_CODES = new Set([105, 126, 127]);

/** Returns true if the exit code indicates the endpoint was protected. */
function isProtectedCode(exitCode: number): boolean {
  return PROTECTED_CODES.has(exitCode);
}

/** Maps a numeric exit code to its canonical error name. */
function getErrorName(exitCode: number): string {
  const entry = ERROR_CODE_MAP[exitCode];
  return entry ? entry.name : `Unknown (${exitCode})`;
}

// Lazy-initialised ES client and index pattern
let esClient: Client | null = null;
let indexPattern: string | null = null;

/** Initialise (or re-use) the ES client from the current analytics settings. */
async function getClient(): Promise<{ client: Client; index: string }> {
  if (esClient && indexPattern) {
    return { client: esClient, index: indexPattern };
  }

  const settingsService = new SettingsService();

  if (!settingsService.isConfigured()) {
    throw new Error('Elasticsearch is not configured — cannot ingest results');
  }

  const settings = settingsService.getSettings();
  esClient = createEsClient(settings);
  indexPattern = settings.indexPattern;

  return { client: esClient, index: indexPattern };
}

/**
 * Ingest a completed task result into Elasticsearch.
 *
 * Builds a document that matches the existing ES schema used by the Analytics
 * module so dashboards, filters, and aggregations work without changes.
 */
export async function ingestResult(task: Task, result: TaskResult): Promise<void> {
  const { client, index: defaultIndex } = await getClient();
  const index = task.target_index ?? defaultIndex;

  const doc = {
    routing: {
      event_time: result.completed_at,
      oid: task.org_id,
      hostname: result.hostname,
    },
    event: {
      ERROR: result.exit_code,
    },
    f0rtika: {
      test_uuid: task.payload.test_uuid,
      test_name: task.payload.test_name,
      is_protected: isProtectedCode(result.exit_code),
      error_name: getErrorName(result.exit_code),
      category: task.payload.metadata?.category,
      subcategory: task.payload.metadata?.subcategory,
      severity: task.payload.metadata?.severity,
      techniques: task.payload.metadata?.techniques,
      tactics: task.payload.metadata?.tactics,
      threat_actor: task.payload.metadata?.threat_actor,
      target: task.payload.metadata?.target,
      complexity: task.payload.metadata?.complexity,
      tags: task.payload.metadata?.tags,
      score: task.payload.metadata?.score,
    },
  };

  await client.index({ index, document: doc });
}

/**
 * Reset the cached ES client (useful for testing or after settings change).
 */
export function resetClient(): void {
  esClient = null;
  indexPattern = null;
}
