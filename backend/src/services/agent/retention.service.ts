/**
 * SQLite retention for the agent tables.
 *
 * `tasks.result` holds the full agent output (mostly stdout) and `agent_events`
 * grows ~10 rows per agent per day; neither was ever pruned. After the retention
 * window SQLite keeps only what the verdict readers use (exit code, error,
 * edr_terminated, the last 400 chars of stderr, bundle control results) and drops
 * the bulky output:
 *   - `execute_test`: only once the result is in Elasticsearch (`es_ingested = 1`),
 *     which holds the canonical copy.
 *   - `update_agent` / `uninstall`: never sent to Elasticsearch; their output is
 *     dropped after the window anyway (it is only install/uninstall chatter).
 *   - `execute_command`: never compacted. Admin shell-command output is
 *     audit-relevant and those rows are rare.
 *
 * Event pruning keeps each agent's newest `went_offline` event whatever its age:
 * `detectOfflineAgents` records a new one whenever none exists after the agent's
 * last heartbeat, so deleting it would make every long-offline agent "go offline"
 * again once per retention window.
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
       AND type NOT IN ('execute_command')
       AND (type != 'execute_test' OR es_ingested = 1)
     LIMIT ?`;

export interface CompactOptions {
  olderThanDays?: number;
  batchSize?: number;
  maxRows?: number;
  now?: Date;
}

/**
 * Compact the output of finished tasks older than the window (test results only
 * once ingested; execute_command never). A window of 0 or less does nothing.
 * Returns rows compacted.
 */
export function compactTaskResults(opts: CompactOptions = {}): number {
  const days = opts.olderThanDays ?? getRetentionSettings().taskOutputDays;
  if (!(days > 0)) return 0;
  const db = getDatabase();
  const now = opts.now ?? new Date();
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

/**
 * Pruning candidates: events older than the cutoff, except each agent's newest
 * `went_offline` (see the header). The correlated subquery only runs for
 * `went_offline` rows and walks idx_agent_events_agent_ts.
 */
export const PRUNABLE_EVENTS_DELETE_SQL = `DELETE FROM agent_events WHERE id IN (
       SELECT e.id FROM agent_events e
        WHERE e.created_at < ?
          AND NOT (e.event_type = 'went_offline' AND e.id = (
            SELECT w.id FROM agent_events w
             WHERE w.agent_id = e.agent_id AND w.event_type = 'went_offline'
             ORDER BY w.created_at DESC, w.id DESC
             LIMIT 1))
        LIMIT ?)`;

/**
 * Delete agent events older than the window, in batches of 1000, keeping each
 * agent's newest `went_offline`. A window of 0 or less does nothing. Returns rows deleted.
 */
export function pruneAgentEvents(opts: { olderThanDays?: number; now?: Date } = {}): number {
  const days = opts.olderThanDays ?? getRetentionSettings().agentEventDays;
  if (!(days > 0)) return 0;
  const db = getDatabase();
  const cutoff = sqliteCutoff(opts.now ?? new Date(), days);
  const BATCH_SIZE = 1000;
  const stmt = db.prepare(PRUNABLE_EVENTS_DELETE_SQL);
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

/**
 * Hourly job: runs each retention job unless its window is 0 (disabled). Each
 * job is isolated, so a failure in one never skips the other; a failed job
 * counts 0 and is retried on the next tick.
 */
export function runRetentionTick(): { compacted: number; pruned: number } {
  const { taskOutputDays, agentEventDays } = getRetentionSettings();
  let compacted = 0;
  let pruned = 0;
  try {
    compacted = compactTaskResults({ olderThanDays: taskOutputDays });
  } catch (err) {
    console.error('[retention] Task output compaction failed:', err);
  }
  try {
    pruned = pruneAgentEvents({ olderThanDays: agentEventDays });
  } catch (err) {
    console.error('[retention] Agent event pruning failed:', err);
  }
  return { compacted, pruned };
}
