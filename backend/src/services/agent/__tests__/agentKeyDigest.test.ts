import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

// Import AFTER mock setup
const {
  digestAgentKey,
  recordAgentKeyDigest,
  agentKeyDigestMatches,
  _clearAgentKeyDigestMemory,
} = await import('../agentKeyDigest.js');

const AGENT = 'agent-digest-001';
const H = '$2a$12$currentkeyhashcurrentkeyhashcurrentkeyhashcurren';
const H2 = '$2a$12$replacedkeyhashreplacedkeyhashreplacedkeyhashrepl';
const TOK_A = 'ak_' + 'a'.repeat(64);
const TOK_B = 'ak_' + 'b'.repeat(64);

describe('agentKeyDigest', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    _clearAgentKeyDigestMemory();
  });

  it('digestAgentKey is a deterministic hex SHA-256 of the full token', () => {
    const d = digestAgentKey(TOK_A);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(digestAgentKey(TOK_A)).toBe(d);
    expect(digestAgentKey(TOK_B)).not.toBe(d);
  });

  it('matches only the token it was recorded for', () => {
    recordAgentKeyDigest(AGENT, H, TOK_A);
    expect(agentKeyDigestMatches(AGENT, H, TOK_A)).toBe(true);
    expect(agentKeyDigestMatches(AGENT, H, TOK_B)).toBe(false);
  });

  it('is void once api_key_hash changes', () => {
    recordAgentKeyDigest(AGENT, H, TOK_A);
    expect(agentKeyDigestMatches(AGENT, H2, TOK_A)).toBe(false);
  });

  it('survives a restart', () => {
    recordAgentKeyDigest(AGENT, H, TOK_A);
    _clearAgentKeyDigestMemory();
    expect(agentKeyDigestMatches(AGENT, H, TOK_A)).toBe(true);
    expect(agentKeyDigestMatches(AGENT, H, TOK_B)).toBe(false);
  });

  it('never stores the plaintext token', () => {
    recordAgentKeyDigest(AGENT, H, TOK_A);
    const row = testDb
      .prepare('SELECT * FROM agent_key_digests WHERE agent_id = ?')
      .get(AGENT) as Record<string, string>;
    expect(row.api_key_hash).toBe(H);
    expect(row.key_digest).toBe(digestAgentKey(TOK_A));
    expect(JSON.stringify(row)).not.toContain(TOK_A);
  });

  it('a newer record replaces the older one for the same agent', () => {
    recordAgentKeyDigest(AGENT, H, TOK_A);
    recordAgentKeyDigest(AGENT, H2, TOK_B);
    _clearAgentKeyDigestMemory();
    expect(agentKeyDigestMatches(AGENT, H, TOK_A)).toBe(false);
    expect(agentKeyDigestMatches(AGENT, H2, TOK_B)).toBe(true);
    const count = testDb.prepare('SELECT COUNT(*) AS n FROM agent_key_digests').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('returns false for an agent with no recorded digest', () => {
    expect(agentKeyDigestMatches('unknown-agent', H, TOK_A)).toBe(false);
  });
});
