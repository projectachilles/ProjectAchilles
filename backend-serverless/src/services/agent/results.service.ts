// Result ingestion service — transforms agent task results into the existing
// Elasticsearch document schema so the Analytics module works unchanged.

import type { Client } from '@elastic/elasticsearch';
import type { Task, TaskResult } from '../../types/agent.js';
import { ERROR_CODE_MAP } from '../analytics/elasticsearch.js';
import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';

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

  if (!await settingsService.isConfigured()) {
    throw new Error('Elasticsearch is not configured — cannot ingest results');
  }

  const settings = await settingsService.getSettings();
  esClient = createEsClient(settings);
  indexPattern = settings.indexPattern ?? 'achilles-results-*';

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

  // Bundle results: fan out to one ES document per control
  if (result.bundle_results?.controls?.length) {
    await ingestBundleControls(client, index, task, result);
    return;
  }

  // Standard single-document path (unchanged)
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

  await client.index({ index, id: task.id, document: doc });
}

/**
 * Fan out bundle controls into individual ES documents via the bulk API.
 * Each control becomes an independent document so existing dashboards and
 * Defense Score formulas count them as separate test results.
 *
 * `_id = <task_id>::<control_id>` — keyed on task_id (unique per dispatch
 * per agent), NOT bundle_id (constant across every run of the same test).
 * This preserves data across distinct runs (different agents, repeated
 * schedules) while keeping retries idempotent: the reporter reuses the
 * same task_id when retrying after a lost response, so a retry overwrites
 * its own prior doc instead of creating a duplicate. The earlier
 * `bundle_id::control_id` key silently overwrote one run's results with
 * the next, destroying the very data the system exists to capture.
 *
 * Throws if ES bulk reports per-item errors (errors:true). The HTTP layer
 * returns 200 even when individual ops fail, so swallowing the response
 * loses data silently; surface it so the caller can mark the task for
 * retry by the durable retry worker.
 */
async function ingestBundleControls(
  client: Client,
  index: string,
  task: Task,
  result: TaskResult,
): Promise<void> {
  const bundle = result.bundle_results!;

  // Resolve tenant label for Azure integration bundles
  let tenantLabel: string | undefined;
  const needsAzureLabel = task.payload.metadata?.integrations?.includes('azure')
    || bundle.bundle_subcategory === 'identity-tenant'
    || task.payload.metadata?.subcategory === 'identity-tenant';
  if (needsAzureLabel) {
    const intService = new IntegrationsSettingsService();
    const azureSettings = await intService.getAzureSettings();
    tenantLabel = azureSettings?.label || 'Azure Tenant';
  }

  const operations = bundle.controls.flatMap((control) => [
    { index: { _index: index, _id: `${task.id}::${control.control_id}` } },
    {
      routing: {
        event_time: result.completed_at,
        oid: task.org_id,
        hostname: result.hostname,
      },
      event: {
        ERROR: control.exit_code,
      },
      f0rtika: {
        test_uuid: `${bundle.bundle_id}::${control.control_id}`,
        test_name: control.control_name,
        is_protected: isProtectedCode(control.exit_code),
        error_name: getErrorName(control.exit_code),
        category: control.category,
        subcategory: control.subcategory,
        severity: control.severity,
        techniques: control.techniques,
        tactics: control.tactics,
        threat_actor: task.payload.metadata?.threat_actor,
        target: task.payload.metadata?.target,
        complexity: task.payload.metadata?.complexity,
        tags: task.payload.metadata?.tags,
        score: task.payload.metadata?.score,
        bundle_id: bundle.bundle_id,
        bundle_name: bundle.bundle_name,
        control_id: control.control_id,
        control_validator: control.validator,
        is_bundle_control: true,
        ...(tenantLabel ? { tenant_label: tenantLabel } : {}),
      },
    },
  ]);

  const response = await client.bulk({ operations });
  if (response?.errors) {
    const failures: string[] = [];
    for (let i = 0; i < (response.items ?? []).length; i++) {
      const item = response.items[i] as Record<string, { _id?: string; error?: { type?: string; reason?: string } } | undefined>;
      const op = item.index ?? item.create ?? item.update ?? item.delete;
      if (op?.error) {
        failures.push(`op[${i}] _id=${op._id ?? '?'}: ${op.error.type ?? 'error'}: ${op.error.reason ?? 'no reason'}`);
      }
    }
    throw new Error(
      `ES bulk ingestion had ${failures.length}/${bundle.controls.length} per-item errors for task ${task.id}: ${failures.join('; ')}`,
    );
  }
}

/**
 * Reset the cached ES client (useful for testing or after settings change).
 */
export function resetClient(): void {
  esClient = null;
  indexPattern = null;
}
