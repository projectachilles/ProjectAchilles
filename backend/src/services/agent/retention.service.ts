/**
 * SQLite retention for the agent tables.
 *
 * `tasks.result` holds the full agent output (mostly stdout) and `agent_events`
 * grows ~10 rows per agent per day; neither was ever pruned. Elasticsearch holds
 * the canonical results, so after the retention window SQLite keeps only what the
 * verdict readers use (exit code, error, edr_terminated, the last 400 chars of
 * stderr, bundle control results) and drops the bulky output.
 *
 * The SQLite file does not shrink (no VACUUM): freed pages are reused, so growth stops.
 */
import type { TaskResult } from '../../types/agent.js';
import { getDatabase } from './database.js';

const DEFAULT_DAYS = 90;
const STDERR_TAIL_CHARS = 400;

export interface RetentionSettings {
  taskOutputDays: number;
  agentEventDays: number;
}

function parseDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_DAYS;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_DAYS;
  return Number(trimmed);
}

/** Retention windows in days; 0 disables a job. Non-integer or negative values fall back to 90. */
export function getRetentionSettings(): RetentionSettings {
  return {
    taskOutputDays: parseDays(process.env.TASK_OUTPUT_RETENTION_DAYS),
    agentEventDays: parseDays(process.env.AGENT_EVENT_RETENTION_DAYS),
  };
}

/** SQLite `datetime('now')` format, so comparisons against the stored columns stay sargable. */
function sqliteCutoff(now: Date, days: number): string {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 19).replace('T', ' ');
}

/** Pure: drops stdout, keeps the stderr tail and every control field except `details`. */
export function compactResult(result: TaskResult, compactedAtIso: string): TaskResult {
  const compacted: TaskResult & { compacted_at: string } = {
    ...result,
    stdout: '',
    stderr: typeof result.stderr === 'string' ? result.stderr.slice(-STDERR_TAIL_CHARS) : result.stderr,
    compacted_at: compactedAtIso,
  };
  if (result.bundle_results && Array.isArray(result.bundle_results.controls)) {
    compacted.bundle_results = {
      ...result.bundle_results,
      controls: result.bundle_results.controls.map((c) => ({ ...c, details: '' })),
    };
  }
  return compacted;
}

/**
 * Candidate query. The unary plus on `status` stops SQLite choosing
 * idx_tasks_es_ingested (every terminal row) over the partial
 * idx_tasks_compactable (only uncompacted rows by completed_at).
 */
export const COMPACTABLE_SELECT_SQL = `SELECT id, result FROM tasks
     WHERE result_compacted_at IS NULL
       AND completed_at < ?
       AND +status IN ('completed','failed')
       AND result IS NOT NULL
       AND (type != 'execute_test' OR es_ingested = 1)
     LIMIT ?`;

export interface CompactOptions {
  olderThanDays?: number;
  batchSize?: number;
  maxRows?: number;
  now?: Date;
}

/** Compact the output of finished, ES-ingested tasks older than the window. Returns rows compacted. */
export function compactTaskResults(opts: CompactOptions = {}): number {
  const db = getDatabase();
  const now = opts.now ?? new Date();
  const days = opts.olderThanDays ?? getRetentionSettings().taskOutputDays;
  const batchSize = opts.batchSize ?? 500;
  const maxRows = opts.maxRows ?? 5000;
  const cutoff = sqliteCutoff(now, days);
  const compactedAtIso = now.toISOString();

  const select = db.prepare(COMPACTABLE_SELECT_SQL);
  const update = db.prepare('UPDATE tasks SET result = ?, result_compacted_at = ? WHERE id = ?');

  let total = 0;
  while (total < maxRows) {
    const limit = Math.min(batchSize, maxRows - total);
    const rows = select.all(cutoff, limit) as { id: string; result: string }[];
    if (rows.length === 0) break;

    db.transaction(() => {
      for (const row of rows) {
        let next: string | null = null;
        try {
          next = JSON.stringify(compactResult(JSON.parse(row.result) as TaskResult, compactedAtIso));
        } catch {
          // Unparseable result: keep it as is, just mark it so it is not picked again.
          next = row.result;
        }
        update.run(next, compactedAtIso, row.id);
      }
    })();
    total += rows.length;
    if (rows.length < limit) break;
  }

  if (total > 0) {
    console.log(`[retention] Compacted output of ${total} task result(s) older than ${days} days`);
  }
  return total;
}

/** Delete agent events older than the window, in batches of 1000. Returns rows deleted. */
export function pruneAgentEvents(opts: { olderThanDays?: number; now?: Date } = {}): number {
  const db = getDatabase();
  const days = opts.olderThanDays ?? getRetentionSettings().agentEventDays;
  const cutoff = sqliteCutoff(opts.now ?? new Date(), days);
  const BATCH_SIZE = 1000;
  const stmt = db.prepare(
    'DELETE FROM agent_events WHERE id IN (SELECT id FROM agent_events WHERE created_at < ? LIMIT ?)',
  );
  let total = 0;
  while (true) {
    const { changes } = stmt.run(cutoff, BATCH_SIZE);
    total += changes;
    if (changes < BATCH_SIZE) break;
  }
  if (total > 0) {
    console.log(`[retention] Pruned ${total} agent event(s) older than ${days} days`);
  }
  return total;
}

/** Hourly job: runs each retention job unless its window is 0 (disabled). */
export function runRetentionTick(): { compacted: number; pruned: number } {
  const { taskOutputDays, agentEventDays } = getRetentionSettings();
  const compacted = taskOutputDays > 0 ? compactTaskResults({ olderThanDays: taskOutputDays }) : 0;
  const pruned = agentEventDays > 0 ? pruneAgentEvents({ olderThanDays: agentEventDays }) : 0;
  return { compacted, pruned };
}
