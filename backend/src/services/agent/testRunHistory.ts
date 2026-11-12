/**
 * Per-agent run history of a test, for the "not tested recently" filter of the
 * host picker. Reads the tasks table only: tasks are keyed by agent id and are
 * never pruned (retention compacts their output, not the rows).
 */
import { getDatabase } from './database.js';

export interface TestRunRecency {
  agent_id: string;
  test_uuid: string;
  /** ISO time of the most recent run that produced a result; null when there is none. */
  last_run_at: string | null;
  /** A run of this test is waiting for, or running on, this agent. */
  queued: boolean;
}

/** Most tests one request may ask about (a campaign's limit). */
export const MAX_RECENCY_TESTS = 100;

interface RecencyRow {
  agent_id: string;
  test_uuid: string;
  last_run_at: string | null;
  queued: number;
}

/** SQLite `datetime('now')` text ("YYYY-MM-DD HH:MM:SS", UTC) as an ISO string. */
function toIso(sqliteTime: string): string {
  return sqliteTime.includes('T') ? sqliteTime : `${sqliteTime.replace(' ', 'T')}Z`;
}

/**
 * The latest run of each given test on each agent, one row per agent x test
 * that has at least one task. Agents with no task for a test have no row.
 *
 * A run counts when the agent delivered a result (`completed`), or when the
 * watchdog failed it and the EDR-kill pass later proved the EDR stopped it
 * (`failed` + `es_ingested`), which Analytics shows as Protected. A run that
 * was cut off with no such evidence, expired or was cancelled does not count.
 */
export function getTestRunRecency(testUuids: readonly string[], orgId?: string): TestRunRecency[] {
  if (testUuids.length === 0) return [];
  const db = getDatabase();
  const placeholders = testUuids.map(() => '?').join(', ');
  const params: string[] = [...testUuids];
  let orgClause = '';
  if (orgId) {
    orgClause = ' AND org_id = ?';
    params.push(orgId);
  }

  const rows = db.prepare(`
    SELECT agent_id,
           json_extract(payload, '$.test_uuid') AS test_uuid,
           MAX(CASE WHEN status = 'completed' OR (status = 'failed' AND es_ingested = 1)
                    THEN completed_at END) AS last_run_at,
           MAX(CASE WHEN status IN ('pending', 'assigned', 'downloading', 'executing')
                    THEN 1 ELSE 0 END) AS queued
    FROM tasks
    WHERE type = 'execute_test'
      AND json_valid(payload)
      AND json_extract(payload, '$.test_uuid') IN (${placeholders})${orgClause}
    GROUP BY agent_id, json_extract(payload, '$.test_uuid')
  `).all(...params) as RecencyRow[];

  return rows.map((r) => ({
    agent_id: r.agent_id,
    test_uuid: r.test_uuid,
    last_run_at: r.last_run_at ? toIso(r.last_run_at) : null,
    queued: r.queued === 1,
  }));
}
