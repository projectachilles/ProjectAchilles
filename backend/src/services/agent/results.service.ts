// Result ingestion service — transforms agent task results into the existing
// Elasticsearch document schema so the Analytics module works unchanged.

import type { Client } from '@elastic/elasticsearch';
import type { Task, TaskResult } from '../../types/agent.js';
import type { AnalyticsSettings } from '../../types/analytics.js';
import { ERROR_CODE_MAP } from '../analytics/elasticsearch.js';
import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import { createResultsIndex, RESULTS_INDEX_MAPPING } from '../analytics/index-management.service.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';
import type { EdrTermination } from '../edr/agent-kill-evidence.js';

function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

/** UTC index-date suffix: 'YYYY.MM.DD' (daily) or 'YYYY.MM' (monthly). */
function formatIndexDate(d: Date, mode: 'daily' | 'monthly'): string {
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  return mode === 'monthly' ? `${y}.${m}` : `${y}.${m}.${pad2(d.getUTCDate())}`;
}

/**
 * Resolve the destination index for a result write.
 * - explicit `task.target_index` wins (verbatim, no date suffix)
 * - otherwise `<writeIndexPrefix><date?>` per rollover mode
 * The date derives from `completedAt` (immutable in the result payload) so a
 * retry lands in the same dated index as the original — preserving _id overwrite
 * idempotency across a midnight boundary. Falls back to ingest-time on bad input.
 */
export function resolveWriteIndex(
  settings: Pick<AnalyticsSettings, 'writeIndexPrefix' | 'writeIndexRollover'>,
  task: { target_index?: string },
  completedAt: string | undefined,
): string {
  if (task.target_index) return task.target_index;
  const base = settings.writeIndexPrefix || 'achilles-results-';
  const mode = settings.writeIndexRollover || 'none';
  if (mode === 'none') return base;
  const parsed = completedAt ? new Date(completedAt) : new Date();
  const d = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return `${base}${formatIndexDate(d, mode)}`;
}

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

/**
 * Windows exit codes are unsigned 32-bit — NTSTATUS/HRESULT-style codes from
 * an EDR kill (e.g. 0xE0000027 = 3758096423) exceed int32, and indices
 * created before event.ERROR moved to `long` reject them with
 * document_parsing_exception, which silently dropped the stage doc after
 * MAX_INGEST_ATTEMPTS. Coerce out-of-range codes to the unexpected-error
 * sentinel and keep the original value in ERROR_raw.
 */
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const EXIT_CODE_UNEXPECTED = 999;

function sanitizeExitCode(exitCode: number): { code: number; raw?: string } {
  if (Number.isInteger(exitCode) && exitCode >= INT32_MIN && exitCode <= INT32_MAX) {
    return { code: exitCode };
  }
  return { code: EXIT_CODE_UNEXPECTED, raw: String(exitCode) };
}

// Lazy-initialised ES client and per-index ensure cache
let esClient: Client | null = null;
const ensuredIndices = new Set<string>();
const edrMappedIndices = new Set<string>();

/** Initialise (or re-use) the ES client from the current analytics settings. */
async function getClient(): Promise<{ client: Client }> {
  if (esClient) {
    return { client: esClient };
  }

  const settingsService = new SettingsService();

  if (!settingsService.isConfigured()) {
    throw new Error('Elasticsearch is not configured — cannot ingest results');
  }

  esClient = createEsClient(settingsService.getSettings());

  return { client: esClient };
}

/**
 * Ensure the write index exists with the canonical mapping.
 * Idempotent: calls createResultsIndex (which is a no-op on already-exists)
 * only once per process lifetime per index name.
 *
 * With `tolerateDenied`, a 403 (a key that may write but not create indices)
 * is logged and the write goes ahead: the index is then expected to exist.
 */
async function ensureResultsIndex(name: string, tolerateDenied = false): Promise<void> {
  if (ensuredIndices.has(name)) return;
  try {
    await createResultsIndex(name);
  } catch (err) {
    const status = (err as { statusCode?: number } | null)?.statusCode;
    if (!tolerateDenied || status !== 403) throw err;
    console.warn(
      `[results] Not allowed to create index "${name}" (403); writing to it as is. ` +
        'If it does not exist yet, create it from Analytics settings so it gets the results mapping.',
    );
  }
  ensuredIndices.add(name);
}

/** Client + concrete write index for a result doc (wildcard guard, dated-index ensure). */
async function prepareWrite(task: Task, timestamp: string | undefined): Promise<{ client: Client; index: string }> {
  const { client } = await getClient();
  const settings = new SettingsService().getSettings();
  const index = resolveWriteIndex(settings, { target_index: task.target_index ?? undefined }, timestamp);
  if (index.includes('*')) {
    throw new Error(
      `Resolved write index contains a wildcard: "${index}" — configure a concrete writeIndexPrefix/indexPattern for writes`,
    );
  }
  // Create a generated write index with the canonical mapping before its first
  // write, or ES guesses the mapping and Analytics aggregations fail. An explicit
  // target_index is the caller's own index whose lifecycle they own, so we don't
  // create it for them. Without rollover the index usually exists already, maybe
  // behind a key that may not create indices: that must not block the write.
  if (!task.target_index) {
    await ensureResultsIndex(index, (settings.writeIndexRollover ?? 'none') === 'none');
  }
  return { client, index };
}

/** Standard whole-test document; shared by `ingestResult` and `ingestEdrTerminatedResult`. */
function buildStandardDoc(task: Task, eventTime: string | undefined, hostname: string | undefined, rawExitCode: number) {
  const exitCode = sanitizeExitCode(rawExitCode);
  return {
    routing: {
      event_time: eventTime,
      oid: task.org_id,
      hostname,
    },
    event: {
      ERROR: exitCode.code,
      ...(exitCode.raw !== undefined ? { ERROR_raw: exitCode.raw } : {}),
    },
    f0rtika: {
      test_uuid: task.payload.test_uuid,
      test_name: task.payload.test_name,
      is_protected: isProtectedCode(rawExitCode),
      error_name: getErrorName(rawExitCode),
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
}

/**
 * Ingest a completed task result into Elasticsearch.
 *
 * Builds a document that matches the existing ES schema used by the Analytics
 * module so dashboards, filters, and aggregations work without changes.
 */
export async function ingestResult(task: Task, result: TaskResult): Promise<void> {
  const { client, index } = await prepareWrite(task, result.completed_at);

  // Bundle results: fan out to one ES document per control
  if (result.bundle_results?.controls?.length) {
    await ingestBundleControls(client, index, task, result);
    return;
  }

  // Standard single-document path (unchanged)
  const doc = buildStandardDoc(task, result.completed_at, result.hostname, result.exit_code);

  await client.index({ index, id: task.id, document: doc });
}

const EDR_TERMINATED_FIELDS = [
  'edr_terminated',
  'edr_terminated_vendors',
  'edr_terminated_alert_ids',
  'stages_unknown',
] as const;

/**
 * Indices created before these fields existed would dynamically map the
 * vendor/alert-id arrays as text. Add the canonical definitions once per
 * process per index; additive and idempotent, so failure is non-fatal.
 */
async function ensureEdrTerminatedMapping(client: Client, index: string): Promise<void> {
  if (edrMappedIndices.has(index)) return;
  const all = RESULTS_INDEX_MAPPING.mappings.properties.f0rtika.properties;
  const properties = Object.fromEntries(EDR_TERMINATED_FIELDS.map((k) => [k, all[k]]));
  try {
    await client.indices.putMapping({ index, properties: { f0rtika: { properties } } });
    edrMappedIndices.add(index);
  } catch (err) {
    console.warn(`[Results] putMapping failed for ${index}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Write the whole-test result for a run whose agent was killed by an EDR: the
 * watchdog failed the task and no result ever arrived, so this is the only ES
 * document the run gets. Always Protected (exit 126); stage outcomes are
 * unknown. `_id = task.id`, so a retry overwrites itself. Never dispatches
 * threshold alerts, and carries no `is_bundle_control` or vendor
 * `*_detected`/`*_prevented` flags.
 */
export async function ingestEdrTerminatedResult(
  task: Task,
  hostname: string,
  t: EdrTermination,
  bundle: { bundleName: string } | null,
): Promise<void> {
  const { client, index } = await prepareWrite(task, t.killed_at);
  const doc = buildStandardDoc(task, t.killed_at, hostname, 126);
  const f0rtika = {
    ...doc.f0rtika,
    ...(bundle ? { bundle_id: task.payload.test_uuid, bundle_name: bundle.bundleName } : {}),
    edr_terminated: true,
    edr_terminated_vendors: t.vendors,
    edr_terminated_alert_ids: t.alert_ids,
    stages_unknown: true,
  };
  await ensureEdrTerminatedMapping(client, index);
  await client.index({ index, id: task.id, document: { ...doc, f0rtika } });
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
 * loses data silently; surface it so the route returns 5xx and the agent
 * retries.
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
    const azureSettings = intService.getAzureSettings();
    tenantLabel = azureSettings?.label || 'Azure Tenant';
  }

  const operations = bundle.controls.flatMap((control) => {
    const controlExitCode = sanitizeExitCode(control.exit_code);
    return [
      { index: { _index: index, _id: `${task.id}::${control.control_id}` } },
      {
        routing: {
          event_time: result.completed_at,
          oid: task.org_id,
          hostname: result.hostname,
        },
        event: {
          ERROR: controlExitCode.code,
          ...(controlExitCode.raw !== undefined ? { ERROR_raw: controlExitCode.raw } : {}),
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
          ...(control.description ? { control_description: control.description } : {}),
          is_bundle_control: true,
          ...(tenantLabel ? { tenant_label: tenantLabel } : {}),
        },
      },
    ];
  });

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
 * Reset the cached ES client and index-ensure set (useful for testing or after settings change).
 */
export function resetClient(): void {
  esClient = null;
  ensuredIndices.clear();
  edrMappedIndices.clear();
}
