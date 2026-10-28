import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;
vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});
const resolveUserLabel = vi.hoisted(() => vi.fn());
vi.mock('../../notices/userLabel.js', () => ({ resolveUserLabel }));

const { resolveRequesterLabel, resolveRequesterLabels } = await import('../requesterLabel.js');

describe('resolveRequesterLabel', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    resolveUserLabel.mockReset().mockImplementation(async (id: string) => (id === 'user_jane' ? 'Jane Doe (jane@example.com)' : id));
  });

  it('names a Clerk user', async () => {
    expect(await resolveRequesterLabel('user_jane')).toBe('Jane Doe (jane@example.com)');
  });

  it('names an API key by its key name, not its id', async () => {
    testDb.prepare(
      `INSERT INTO api_keys (id, name, token_hash, key_prefix, scope, created_by) VALUES ('k1', 'CI pipeline', 'h', 'ak_', 'read-write', 'user_jane')`,
    ).run();
    expect(await resolveRequesterLabel('apikey:k1')).toBe('API key · CI pipeline');
    expect(await resolveRequesterLabel('apikey:gone')).toBe('API key (deleted)');
    expect(resolveUserLabel).not.toHaveBeenCalled();
  });

  it('is null when there is no creator', async () => {
    expect(await resolveRequesterLabel(null)).toBeNull();
    expect(await resolveRequesterLabel('')).toBeNull();
  });

  it('looks each distinct creator up once', async () => {
    const map = await resolveRequesterLabels(['user_jane', 'user_jane', null, 'user_bob']);
    expect(resolveUserLabel).toHaveBeenCalledTimes(2);
    expect(map.get('user_jane')).toBe('Jane Doe (jane@example.com)');
    expect(map.get('user_bob')).toBe('user_bob');
  });
});
