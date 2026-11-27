import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';

// The run start a result records (boundedRunStart), at ingestion and in the
// start-up backfill (lookupStartedAt): the same bound in both.

let testDb: Database.Database;
vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

const { boundedRunStart, RUN_START_GRACE_MS, DEFAULT_EXECUTION_TIMEOUT_S } = await import('../runStart.js');
const { lookupStartedAt } = await import('../runStartBackfill.js');

const END = '2026-11-27T12:00:00Z';
const before = (ms: number) => new Date(Date.parse(END) - ms).toISOString();

describe('boundedRunStart', () => {
  it('keeps a start within execution_timeout + grace of the end, in UTC ISO form', () => {
    expect(boundedRunStart('2026-11-27T13:55:00+02:00', END, 600)).toBe('2026-11-27T11:55:00.000Z');
    expect(boundedRunStart(before(600_000 + RUN_START_GRACE_MS), END, 600)).toBe(before(600_000 + RUN_START_GRACE_MS));
    expect(boundedRunStart(END, END, 600)).toBe('2026-11-27T12:00:00.000Z');
  });

  it('drops a start further back than that, however far', () => {
    expect(boundedRunStart(before(600_000 + RUN_START_GRACE_MS + 1), END, 600)).toBeUndefined();
    expect(boundedRunStart('2020-01-01T00:00:00Z', END, 600)).toBeUndefined();
    expect(boundedRunStart('0001-01-01T00:00:00Z', END, 600)).toBeUndefined();
  });

  it('uses the default timeout when the payload has none or a bad one', () => {
    const limit = DEFAULT_EXECUTION_TIMEOUT_S * 1000 + RUN_START_GRACE_MS;
    for (const timeout of [undefined, null, 0, -5, '600', Number.NaN]) {
      expect(boundedRunStart(before(limit), END, timeout)).toBe(before(limit));
      expect(boundedRunStart(before(limit + 1), END, timeout)).toBeUndefined();
    }
  });

  it('records nothing without two dates in order', () => {
    expect(boundedRunStart('2026-11-27T12:00:01Z', END, 600)).toBeUndefined();
    for (const bad of [undefined, null, '', 'garbage', 42]) {
      expect(boundedRunStart(bad, END, 600)).toBeUndefined();
      expect(boundedRunStart(before(1000), bad, 600)).toBeUndefined();
    }
  });
});

describe('lookupStartedAt (the backfill\'s task lookup)', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'a1', hostname: 'H', org_id: 'default' });
  });

  function task(id: string, result: unknown, timeout?: number) {
    insertTestTask(testDb, {
      id, agent_id: 'a1', org_id: 'default', type: 'execute_test', status: 'completed', batch_id: `b-${id}`,
      payload: JSON.stringify({ test_uuid: 't', ...(timeout !== undefined ? { execution_timeout: timeout } : {}) }),
    });
    testDb.prepare('UPDATE tasks SET result = ? WHERE id = ?').run(typeof result === 'string' ? result : JSON.stringify(result), id);
  }

  it('gives a start only where ingestion would record one', () => {
    task('ok', { started_at: before(60_000), completed_at: END }, 600);
    task('long', { started_at: before(3_600_000), completed_at: END }, 600);
    task('long-timeout', { started_at: before(3_600_000), completed_at: END }, 7200);
    task('no-end', { started_at: before(60_000) }, 600);
    task('default', { started_at: before(DEFAULT_EXECUTION_TIMEOUT_S * 1000 + RUN_START_GRACE_MS + 1), completed_at: END });
    task('broken', '{not json');

    const starts = lookupStartedAt(['ok', 'long', 'long-timeout', 'no-end', 'default', 'broken', 'missing']);

    expect(Object.fromEntries(starts)).toEqual({ ok: before(60_000), 'long-timeout': before(3_600_000) });
  });
});
