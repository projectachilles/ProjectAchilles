/**
 * State for the advance-notice digest: one row per (org, digest_date).
 *
 * Claim-then-send: a caller inserts/reclaims the row as 'sending' (recording
 * claim_at) before mailing, and every later write is guarded by that claim_at so
 * a stale owner cannot overwrite a newer claim. Timestamps are JS-computed ISO
 * strings; never `datetime('now')`.
 *
 * Must not import notices.service.ts (it imports this module).
 */
import { getDatabase } from '../agent/database.js';
import type { NoticeScope } from './types.js';

export type DigestState = 'sending' | 'sent' | 'failed' | 'empty';

export interface DigestRow {
  id: string;
  org_id: string;
  digest_date: string;
  run_date: string;
  timezone: string;
  state: DigestState;
  attempts: number;
  last_error: string | null;
  occurrence_count: number;
  host_count: number;
  recipients: string | null;
  created_at: string;
  sent_at: string | null;
  claim_at: string | null;
  last_attempt_at: string | null;
}

export function getDigest(orgId: string, digestDate: string): DigestRow | null {
  const row = getDatabase()
    .prepare('SELECT * FROM notice_digests WHERE org_id = ? AND digest_date = ?')
    .get(orgId, digestDate) as DigestRow | undefined;
  return row ?? null;
}

/** INSERT ... ON CONFLICT DO NOTHING as 'sending'; true when this caller inserted it. */
export function insertClaim(r: {
  id: string;
  orgId: string;
  digestDate: string;
  runDate: string;
  timezone: string;
  nowIso: string;
}): boolean {
  const res = getDatabase()
    .prepare(`
      INSERT INTO notice_digests (id, org_id, digest_date, run_date, timezone, state, created_at, claim_at)
      VALUES (?, ?, ?, ?, ?, 'sending', ?, ?)
      ON CONFLICT(org_id, digest_date) DO NOTHING
    `)
    .run(r.id, r.orgId, r.digestDate, r.runDate, r.timezone, r.nowIso, r.nowIso);
  return res.changes > 0;
}

/** Take over a failed or stale 'sending' row; true when this caller won the race. */
export function reclaim(
  id: string,
  prev: { state: 'failed' | 'sending'; claimAt: string | null },
  nowIso: string,
): boolean {
  const res = getDatabase()
    .prepare(`
      UPDATE notice_digests SET state = 'sending', claim_at = ?
      WHERE id = ? AND state = ? AND claim_at IS ?
    `)
    .run(nowIso, id, prev.state, prev.claimAt);
  return res.changes > 0;
}

export function markSent(
  id: string,
  claimAt: string,
  d: { sentAt: string; recipients: string[]; occurrenceCount: number; hostCount: number; note: string | null },
): boolean {
  const res = getDatabase()
    .prepare(`
      UPDATE notice_digests
      SET state = 'sent', sent_at = ?, recipients = ?, occurrence_count = ?, host_count = ?, last_error = ?
      WHERE id = ? AND state = 'sending' AND claim_at = ?
    `)
    .run(d.sentAt, JSON.stringify(d.recipients), d.occurrenceCount, d.hostCount, d.note, id, claimAt);
  return res.changes > 0;
}

export function markEmpty(id: string, claimAt: string): boolean {
  const res = getDatabase()
    .prepare(`UPDATE notice_digests SET state = 'empty' WHERE id = ? AND state = 'sending' AND claim_at = ?`)
    .run(id, claimAt);
  return res.changes > 0;
}

export function markFailed(id: string, claimAt: string, error: string, nowIso: string): boolean {
  const res = getDatabase()
    .prepare(`
      UPDATE notice_digests
      SET state = 'failed', attempts = attempts + 1, last_error = ?, last_attempt_at = ?
      WHERE id = ? AND state = 'sending' AND claim_at = ?
    `)
    .run(error, nowIso, id, claimAt);
  return res.changes > 0;
}

/** Latest row per org within the scope, digest_date >= sinceDate. */
export function latestDigests(scope: NoticeScope, sinceDate: string): DigestRow[] {
  const orgSql = scope.kind === 'org' ? ' AND org_id = ?' : '';
  const params = scope.kind === 'org' ? [sinceDate, scope.orgId] : [sinceDate];
  return getDatabase()
    .prepare(`
      SELECT d.* FROM notice_digests d
      WHERE d.digest_date >= ?${orgSql.replace('org_id', 'd.org_id')}
        AND d.digest_date = (SELECT MAX(digest_date) FROM notice_digests m WHERE m.org_id = d.org_id AND m.digest_date >= ?)
      ORDER BY d.org_id
    `)
    .all(...params, sinceDate) as DigestRow[];
}
