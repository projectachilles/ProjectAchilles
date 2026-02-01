// Result ingestion service — transforms agent task results into the existing
// Elasticsearch document schema so the Analytics module works unchanged.

import { Client } from '@elastic/elasticsearch';
import type { Task, TaskResult } from '../../types/agent.js';
import type { AnalyticsSettings } from '../../types/analytics.js';
import { ERROR_CODE_MAP } from '../analytics/elasticsearch.js';
import { SettingsService } from '../analytics/settings.js';

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

/** Create an ES Client from analytics settings (same pattern as ElasticsearchService). */
function createClient(settings: AnalyticsSettings): Client {
  if (settings.connectionType === 'cloud' && settings.cloudId) {
    return new Client({
      cloud: { id: settings.cloudId },
      auth: { apiKey: settings.apiKey || '' },
    });
  }

  if (settings.node) {
    const auth = settings.apiKey
      ? { apiKey: settings.apiKey }
      : { username: settings.username || '', password: settings.password || '' };

    return new Client({
      node: settings.node,
      auth,
    });
  }

  throw new Error('Invalid Elasticsearch configuration');
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
  esClient = createClient(settings);
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
  const { client, index } = await getClient();

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
      severity: task.payload.metadata?.severity,
      techniques: task.payload.metadata?.techniques,
      tactics: task.payload.metadata?.tactics,
      threat_actor: task.payload.metadata?.threat_actor,
      target: task.payload.metadata?.target,
      complexity: task.payload.metadata?.complexity,
      tags: task.payload.metadata?.tags,
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
