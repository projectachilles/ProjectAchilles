import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'crypto';
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

  it('digestAgentKey is a deterministic hex HMAC-SHA256 of the token keyed by the bcrypt hash', () => {
    const d = digestAgentKey(TOK_A, H);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(d).toBe(createHmac('sha256', H).update(TOK_A).digest('hex'));
    expect(digestAgentKey(TOK_A, H)).toBe(d);
    expect(digestAgentKey(TOK_B, H)).not.toBe(d);
  });

  it('a digest recorded under one hash never matches under another, even with the same token', () => {
    recordAgentKeyDigest(AGENT, H, TOK_A);
    const underH = (testDb.prepare('SELECT key_digest FROM agent_key_digests WHERE agent_id = ?').get(AGENT) as {
      key_digest: string;
    }).key_digest;
    recordAgentKeyDigest(AGENT, H2, TOK_A);
    const underH2 = (testDb.prepare('SELECT key_digest FROM agent_key_digests WHERE agent_id = ?').get(AGENT) as {
      key_digest: string;
    }).key_digest;

    // Cryptographic binding: the same token yields a different digest per hash.
    expect(underH).not.toBe(underH2);
    _clearAgentKeyDigestMemory();
    expect(agentKeyDigestMatches(AGENT, H, TOK_A)).toBe(false);
    expect(agentKeyDigestMatches(AGENT, H2, TOK_A)).toBe(true);
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
    expect(row.key_digest).toBe(digestAgentKey(TOK_A, H));
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
