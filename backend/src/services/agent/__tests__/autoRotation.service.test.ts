import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

// Record which agents the sweep tried to rotate, without doing bcrypt work.
const rotated: string[] = [];
vi.mock('../enrollment.service.js', () => ({
  rotateAgentKey: async (agentId: string) => {
    rotated.push(agentId);
    testDb.prepare(
      `UPDATE agents SET pending_api_key_hash = 'pending', key_rotation_initiated_at = ? WHERE id = ?`
    ).run(new Date().toISOString(), agentId);
    return { agent_key: 'ak_new', agent_id: agentId, rotated_at: new Date().toISOString() };
  },
}));

let settings = { enabled: true, intervalDays: 90 };

// Serve the settings file from memory. The service does `import fs from 'fs'`,
// so the patched functions must be on the DEFAULT export too — returning
// `default: actual` would silently hand back the real fs and every test would
// read whatever is (or isn't) on the developer's disk.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const isSettings = (p: unknown) => String(p).endsWith('agent-settings.json');
  const patched = {
    ...actual,
    existsSync: (p: string) => (isSettings(p) ? true : actual.existsSync(p)),
    readFileSync: (p: string, enc?: unknown) =>
      isSettings(p)
        ? JSON.stringify({ autoRotation: settings })
        : (actual.readFileSync as (a: string, b?: unknown) => string)(p, enc),
  };
  return { ...patched, default: patched };
});

const { processAutoRotation } = await import('../autoRotation.service.js');

/** Age an agent's key past the rotation interval so only liveness decides. */
function withOldKey(id: string, lastHeartbeat: string | null): void {
  const longAgo = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
  testDb.prepare(
    `UPDATE agents SET created_at = ?, api_key_rotated_at = NULL, last_heartbeat = ? WHERE id = ?`
  ).run(longAgo, lastHeartbeat, id);
}

describe('autoRotation.processAutoRotation', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    rotated.length = 0;
    settings = { enabled: true, intervalDays: 90 };
  });

  afterEach(() => testDb.close());

  it('rotates an agent that is currently online', async () => {
    insertTestAgent(testDb, { id: 'online-1' });
    withOldKey('online-1', new Date(Date.now() - 30 * 1000).toISOString());

    await processAutoRotation();

    expect(rotated).toEqual(['online-1']);
  });

  it('does nothing when auto-rotation is disabled', async () => {
    settings = { enabled: false, intervalDays: 90 };
    insertTestAgent(testDb, { id: 'online-1' });
    withOldKey('online-1', new Date().toISOString());

    await processAutoRotation();

    expect(rotated).toEqual([]);
  });

  // The reason this gate exists: the new key is delivered by heartbeat, so
  // arming a rotation on an agent that will not heartbeat inside the grace
  // period produces a pending key nobody can collect.
  it('skips an agent that has been offline for days', async () => {
    insertTestAgent(testDb, { id: 'sleeping-laptop' });
    withOldKey('sleeping-laptop', new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString());

    await processAutoRotation();

    expect(rotated).toEqual([]);
    const row = testDb
      .prepare('SELECT key_rotation_initiated_at FROM agents WHERE id = ?')
      .get('sleeping-laptop') as { key_rotation_initiated_at: string | null };
    expect(row.key_rotation_initiated_at).toBeNull();
  });

  it('skips an agent that has never sent a heartbeat', async () => {
    insertTestAgent(testDb, { id: 'never-seen' });
    withOldKey('never-seen', null);

    await processAutoRotation();

    expect(rotated).toEqual([]);
  });

  // Regression: last_heartbeat is written as an ISO string
  // ('2026-09-01T00:05:00.000Z') while SQLite's datetime('now', …) yields
  // '2026-09-01 12:37:45'. Comparing the two lexically hits 'T' (0x54) vs
  // ' ' (0x20) at index 10, so EVERY heartbeat from the same UTC day sorts as
  // newer than the cutoff. A gate written that way silently admits an agent
  // that has been asleep since midnight — the exact case it must exclude.
  it('skips an agent last seen hours ago on the same UTC day', async () => {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 5, 0, 0);

    // Only meaningful if "now" is well past 00:05 UTC; otherwise the timestamp
    // is not actually stale and the case cannot be constructed.
    if (Date.now() - startOfToday.getTime() < 2 * 3600 * 1000) {
      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
      startOfToday.setTime(twoHoursAgo.getTime());
    }

    insertTestAgent(testDb, { id: 'stale-today' });
    withOldKey('stale-today', startOfToday.toISOString());

    await processAutoRotation();

    expect(rotated).toEqual([]);
  });

  it('rotates only the online agents in a mixed fleet', async () => {
    insertTestAgent(testDb, { id: 'online-1' });
    insertTestAgent(testDb, { id: 'offline-1', hostname: 'other-host' });
    withOldKey('online-1', new Date(Date.now() - 10 * 1000).toISOString());
    withOldKey('offline-1', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());

    await processAutoRotation();

    expect(rotated).toEqual(['online-1']);
  });

  it('skips an agent that already has a rotation in flight', async () => {
    insertTestAgent(testDb, { id: 'mid-rotation' });
    withOldKey('mid-rotation', new Date().toISOString());
    testDb
      .prepare(`UPDATE agents SET key_rotation_initiated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), 'mid-rotation');

    await processAutoRotation();

    expect(rotated).toEqual([]);
  });

  it('skips an agent whose key is younger than the interval', async () => {
    insertTestAgent(testDb, { id: 'fresh-key' });
    testDb
      .prepare(`UPDATE agents SET api_key_rotated_at = ?, last_heartbeat = ? WHERE id = ?`)
      .run(new Date().toISOString(), new Date().toISOString(), 'fresh-key');

    await processAutoRotation();

    expect(rotated).toEqual([]);
  });
});
