import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

beforeEach(() => {
  testDb = createTestDatabase();
});

describe('api_keys admin scope migration', () => {
  it('accepts an admin-scope row after migration', () => {
    expect(() =>
      testDb
        .prepare(
          `INSERT INTO api_keys (id, name, token_hash, key_prefix, scope, created_by)
           VALUES ('k1', 'n', 'h1', 'pa_abcdefgh', 'admin', 'u')`,
        )
        .run(),
    ).not.toThrow();

    const row = testDb.prepare('SELECT scope FROM api_keys WHERE id = ?').get('k1') as {
      scope: string;
    };
    expect(row.scope).toBe('admin');
  });

  it('still accepts read and read-write, and still rejects an unknown scope', () => {
    testDb
      .prepare(
        `INSERT INTO api_keys (id, name, token_hash, key_prefix, scope, created_by)
         VALUES ('k2', 'n', 'h2', 'pa_abcdefgh', 'read', 'u')`,
      )
      .run();
    testDb
      .prepare(
        `INSERT INTO api_keys (id, name, token_hash, key_prefix, scope, created_by)
         VALUES ('k3', 'n', 'h3', 'pa_abcdefgh', 'read-write', 'u')`,
      )
      .run();
    expect(() =>
      testDb
        .prepare(
          `INSERT INTO api_keys (id, name, token_hash, key_prefix, scope, created_by)
           VALUES ('k4', 'n', 'h4', 'pa_abcdefgh', 'superuser', 'u')`,
        )
        .run(),
    ).toThrow();
  });

  it('migrates an existing legacy table, preserving rows', async () => {
    const legacy = new Database(':memory:');
    legacy.exec(`
      CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'read' CHECK(scope IN ('read','read-write')),
        created_by TEXT NOT NULL,
        org_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT,
        last_used_at TEXT,
        revoked_at TEXT
      );
      INSERT INTO api_keys (id, name, token_hash, key_prefix, scope, created_by, org_id)
        VALUES ('old1', 'legacy', 'hash_old', 'pa_11112222', 'read-write', 'u1', 'org_a');
    `);

    const { migrateAdminApiKeyScope } = await import('../database.js');
    migrateAdminApiKeyScope(legacy);

    const row = legacy.prepare('SELECT * FROM api_keys WHERE id = ?').get('old1') as {
      scope: string;
      org_id: string;
      key_prefix: string;
    };
    expect(row.scope).toBe('read-write');
    expect(row.org_id).toBe('org_a');
    expect(row.key_prefix).toBe('pa_11112222');

    expect(() =>
      legacy
        .prepare(
          `INSERT INTO api_keys (id, name, token_hash, key_prefix, scope, created_by)
           VALUES ('new1', 'n', 'hash_new', 'pa_33334444', 'admin', 'u')`,
        )
        .run(),
    ).not.toThrow();

    // Idempotent: a second run is a no-op and does not lose data.
    migrateAdminApiKeyScope(legacy);
    expect(legacy.prepare('SELECT COUNT(*) c FROM api_keys').get()).toEqual({ c: 2 });
    legacy.close();
  });
});
