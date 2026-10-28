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

const { resolveRequesterLabel, resolveRequesterLabels, withoutEmail } = await import('../requesterLabel.js');

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

describe('API key names stay in their org', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    testDb.prepare(
      `INSERT INTO api_keys (id, name, token_hash, key_prefix, scope, created_by, org_id) VALUES ('k2', 'Org B key', 'h2', 'ak_', 'read', 'u', 'org-b')`,
    ).run();
  });

  it('does not name another org\'s key', async () => {
    expect(await resolveRequesterLabel('apikey:k2', 'org-a')).toBe('API key');
    expect(await resolveRequesterLabel('apikey:k2', 'org-b')).toBe('API key · Org B key');
  });
});

describe('withoutEmail', () => {
  it('keeps the name and drops the email', () => {
    expect(withoutEmail('Jane Doe (jane@example.com)')).toBe('Jane Doe');
  });
  it('masks a label that is only an email', () => {
    expect(withoutEmail('jane@example.com')).toBe('j…@example.com');
  });
  it('leaves other labels alone', () => {
    expect(withoutEmail('API key · CI pipeline')).toBe('API key · CI pipeline');
    expect(withoutEmail('user_123')).toBe('user_123');
  });
});

