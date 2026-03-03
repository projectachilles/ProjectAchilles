import { getDatabase } from './database.js';
import type { AgentEvent, AgentEventType } from '../../types/agent.js';

interface EventRow {
  id: number;
  agent_id: string;
  event_type: string;
  details: string;
  created_at: string;
}

function parseEventRow(row: EventRow): AgentEvent {
  return {
    id: row.id,
    agent_id: row.agent_id,
    event_type: row.event_type as AgentEventType,
    details: JSON.parse(row.details) as Record<string, unknown>,
    created_at: row.created_at,
  };
}

/**
 * Record a lifecycle event for an agent.
 */
export function recordEvent(
  agentId: string,
  eventType: AgentEventType,
  details: Record<string, unknown> = {}
): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO agent_events (agent_id, event_type, details)
    VALUES (?, ?, ?)
  `).run(agentId, eventType, JSON.stringify(details));
}

/**
 * List events for an agent with pagination and optional type filter.
 * Returns newest-first.
 */
export function listAgentEvents(
  agentId: string,
  options: { limit?: number; offset?: number; event_type?: AgentEventType } = {}
): { events: AgentEvent[]; total: number } {
  const db = getDatabase();
  const { limit = 50, offset = 0, event_type } = options;

  const conditions = ['agent_id = ?'];
  const params: (string | number)[] = [agentId];

  if (event_type) {
    conditions.push('event_type = ?');
    params.push(event_type);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const countRow = db.prepare(
    `SELECT COUNT(*) as total FROM agent_events ${whereClause}`
  ).get(...params) as { total: number };

  const rows = db.prepare(
    `SELECT * FROM agent_events ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as EventRow[];

  return {
    events: rows.map(parseEventRow),
    total: countRow.total,
  };
}
