import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDatabase } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../../agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

const repo = await import('../digest.repo.js');

const T0 = '2026-10-27T09:00:00.000Z';
const T1 = '2026-10-27T09:10:00.000Z';

function claim(id: string, orgId: string, digestDate: string, nowIso = T0): boolean {
  return repo.insertClaim({ id, orgId, digestDate, runDate: '2026-10-28', timezone: 'UTC', nowIso });
}

describe('digest.repo', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
  });
  afterEach(() => {
    testDb.close();
  });

  it('insertClaim is exclusive per (org, date)', () => {
    expect(claim('d1', 'a', '2026-10-27')).toBe(true);
    expect(claim('d2', 'a', '2026-10-27')).toBe(false);
    expect(claim('d3', 'b', '2026-10-27')).toBe(true);
    expect(repo.getDigest('a', '2026-10-27')).toMatchObject({ id: 'd1', state: 'sending', claim_at: T0 });
  });

  it('reclaim only applies against the current claim_at', () => {
    claim('d1', 'a', '2026-10-27');
    expect(repo.reclaim('d1', { state: 'sending', claimAt: 'stale' }, T1)).toBe(false);
    expect(repo.reclaim('d1', { state: 'sending', claimAt: T0 }, T1)).toBe(true);
    expect(repo.getDigest('a', '2026-10-27')?.claim_at).toBe(T1);
    // the previous owner no longer matches
    expect(repo.reclaim('d1', { state: 'sending', claimAt: T0 }, T1)).toBe(false);
  });

  it('markFailed increments attempts and records the error; failed rows can be reclaimed', () => {
    claim('d1', 'a', '2026-10-27');
    expect(repo.markFailed('d1', T0, 'smtp down', T1)).toBe(true);
    expect(repo.getDigest('a', '2026-10-27')).toMatchObject({
      state: 'failed', attempts: 1, last_error: 'smtp down', last_attempt_at: T1,
    });
    expect(repo.reclaim('d1', { state: 'failed', claimAt: T0 }, T1)).toBe(true);
    expect(repo.markFailed('d1', T1, 'again', T1)).toBe(true);
    expect(repo.getDigest('a', '2026-10-27')?.attempts).toBe(2);
  });

  it('markSent with a wrong claimAt is refused and leaves the row sending', () => {
    claim('d1', 'a', '2026-10-27');
    const d = { sentAt: T1, recipients: ['x@y.com'], occurrenceCount: 3, hostCount: 2, note: null };
    expect(repo.markSent('d1', 'stale', d)).toBe(false);
    expect(repo.getDigest('a', '2026-10-27')?.state).toBe('sending');
    expect(repo.markSent('d1', T0, { ...d, note: 'Rejected: z@y.com' })).toBe(true);
    const row = repo.getDigest('a', '2026-10-27');
    expect(row).toMatchObject({ state: 'sent', sent_at: T1, occurrence_count: 3, host_count: 2, last_error: 'Rejected: z@y.com' });
    expect(JSON.parse(row?.recipients ?? 'null')).toEqual(['x@y.com']);
  });

  it('markEmpty is guarded by claim_at', () => {
    claim('d1', 'a', '2026-10-27');
    expect(repo.markEmpty('d1', 'stale')).toBe(false);
    expect(repo.markEmpty('d1', T0)).toBe(true);
    expect(repo.getDigest('a', '2026-10-27')?.state).toBe('empty');
  });

  it('latestDigests returns the newest row per org within scope', () => {
    claim('a1', 'a', '2026-10-25');
    claim('a2', 'a', '2026-10-27');
    claim('b1', 'b', '2026-10-26');
    claim('b0', 'b', '2026-10-01');
    expect(repo.latestDigests({ kind: 'org', orgId: 'a' }, '2026-10-20').map(r => r.id)).toEqual(['a2']);
    expect(repo.latestDigests({ kind: 'all' }, '2026-10-20').map(r => r.id)).toEqual(['a2', 'b1']);
    expect(repo.latestDigests({ kind: 'all' }, '2026-10-28')).toEqual([]);
  });
});
