import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

const { recordEvent, listAgentEvents } = await import('../events.service.js');

describe('events.service', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'agent-001' });
    insertTestAgent(testDb, { id: 'agent-002', hostname: 'host-2' });
  });

  describe('recordEvent', () => {
    it('inserts an event with default details', () => {
      recordEvent('agent-001', 'enrolled');

      const row = testDb.prepare('SELECT * FROM agent_events WHERE agent_id = ?').get('agent-001') as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.event_type).toBe('enrolled');
      expect(row.details).toBe('{}');
      expect(row.created_at).toBeDefined();
    });

    it('inserts an event with custom details', () => {
      recordEvent('agent-001', 'version_updated', { from: '1.0.0', to: '1.1.0' });

      const row = testDb.prepare('SELECT * FROM agent_events WHERE agent_id = ?').get('agent-001') as Record<string, unknown>;
      expect(JSON.parse(row.details as string)).toEqual({ from: '1.0.0', to: '1.1.0' });
    });

    it('records multiple events for the same agent', () => {
      recordEvent('agent-001', 'enrolled');
      recordEvent('agent-001', 'came_online');
      recordEvent('agent-001', 'task_completed', { task_id: 'task-1' });

      const count = testDb.prepare('SELECT COUNT(*) as c FROM agent_events WHERE agent_id = ?').get('agent-001') as { c: number };
      expect(count.c).toBe(3);
    });

    it('records events for different agents independently', () => {
      recordEvent('agent-001', 'enrolled');
      recordEvent('agent-002', 'enrolled');

      const count1 = testDb.prepare('SELECT COUNT(*) as c FROM agent_events WHERE agent_id = ?').get('agent-001') as { c: number };
      const count2 = testDb.prepare('SELECT COUNT(*) as c FROM agent_events WHERE agent_id = ?').get('agent-002') as { c: number };
      expect(count1.c).toBe(1);
      expect(count2.c).toBe(1);
    });
  });

  describe('listAgentEvents', () => {
    it('returns events newest-first', () => {
      // Insert with explicit timestamps to ensure ordering
      testDb.prepare(`
        INSERT INTO agent_events (agent_id, event_type, details, created_at)
        VALUES (?, ?, '{}', ?)
      `).run('agent-001', 'enrolled', '2024-01-01 00:00:00');
      testDb.prepare(`
        INSERT INTO agent_events (agent_id, event_type, details, created_at)
        VALUES (?, ?, '{}', ?)
      `).run('agent-001', 'came_online', '2024-01-02 00:00:00');
      testDb.prepare(`
        INSERT INTO agent_events (agent_id, event_type, details, created_at)
        VALUES (?, ?, '{}', ?)
      `).run('agent-001', 'task_completed', '2024-01-03 00:00:00');

      const result = listAgentEvents('agent-001');
      expect(result.events).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.events[0].event_type).toBe('task_completed');
      expect(result.events[2].event_type).toBe('enrolled');
    });

    it('paginates results', () => {
      for (let i = 0; i < 5; i++) {
        testDb.prepare(`
          INSERT INTO agent_events (agent_id, event_type, details, created_at)
          VALUES (?, ?, '{}', ?)
        `).run('agent-001', 'task_completed', `2024-01-0${i + 1} 00:00:00`);
      }

      const page1 = listAgentEvents('agent-001', { limit: 2, offset: 0 });
      expect(page1.events).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page2 = listAgentEvents('agent-001', { limit: 2, offset: 2 });
      expect(page2.events).toHaveLength(2);
    });

    it('filters by event_type', () => {
      recordEvent('agent-001', 'enrolled');
      recordEvent('agent-001', 'came_online');
      recordEvent('agent-001', 'task_completed', { task_id: 'task-1' });
      recordEvent('agent-001', 'task_completed', { task_id: 'task-2' });

      const result = listAgentEvents('agent-001', { event_type: 'task_completed' });
      expect(result.events).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.events.every(e => e.event_type === 'task_completed')).toBe(true);
    });

    it('returns empty result for agent with no events', () => {
      const result = listAgentEvents('agent-002');
      expect(result.events).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('parses details JSON correctly', () => {
      recordEvent('agent-001', 'version_updated', { from: '1.0.0', to: '2.0.0' });

      const result = listAgentEvents('agent-001');
      expect(result.events[0].details).toEqual({ from: '1.0.0', to: '2.0.0' });
    });

    it('only returns events for the specified agent', () => {
      recordEvent('agent-001', 'enrolled');
      recordEvent('agent-002', 'enrolled');

      const result = listAgentEvents('agent-001');
      expect(result.events).toHaveLength(1);
      expect(result.events[0].agent_id).toBe('agent-001');
    });
  });
});
