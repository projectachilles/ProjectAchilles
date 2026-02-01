import { getDatabase } from './database.js';
import type {
  HeartbeatPayload,
  AgentSummary,
  Agent,
  AgentRuntimeStatus,
  AgentStatus,
  AgentOS,
  AgentArch,
  ListAgentsRequest,
} from '../../types/agent.js';

const HEARTBEAT_TIMEOUT_SECONDS = 180; // 3x the 60s heartbeat interval

// ============================================================================
// HEARTBEAT PROCESSING
// ============================================================================

export function processHeartbeat(agentId: string, payload: HeartbeatPayload): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE agents
    SET last_heartbeat = ?,
        last_heartbeat_data = ?,
        agent_version = ?,
        updated_at = ?
    WHERE id = ?
  `);

  stmt.run(now, JSON.stringify(payload), payload.agent_version, now, agentId);
}

// ============================================================================
// ONLINE STATUS
// ============================================================================

export function isAgentOnline(lastHeartbeat: string | null): boolean {
  if (!lastHeartbeat) return false;

  const lastTime = new Date(lastHeartbeat).getTime();
  const now = Date.now();
  const diffSeconds = (now - lastTime) / 1000;

  return diffSeconds < HEARTBEAT_TIMEOUT_SECONDS;
}

function computeRuntimeStatus(
  lastHeartbeat: string | null,
  lastHeartbeatData: string | null,
  status: AgentStatus
): AgentRuntimeStatus {
  if (status !== 'active') return 'offline';
  if (!isAgentOnline(lastHeartbeat)) return 'offline';

  if (lastHeartbeatData) {
    try {
      const data = JSON.parse(lastHeartbeatData) as HeartbeatPayload;
      return data.status;
    } catch {
      return 'idle';
    }
  }

  return 'idle';
}

// ============================================================================
// METRICS
// ============================================================================

interface AgentMetrics {
  total: number;
  online: number;
  offline: number;
  by_os: Record<string, number>;
  by_status: Record<string, number>;
  pending_tasks: number;
}

export function getAgentMetrics(orgId?: string): AgentMetrics {
  const db = getDatabase();

  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_SECONDS * 1000).toISOString();

  // Base condition
  const orgCondition = orgId ? ' AND org_id = ?' : '';
  const orgParams = orgId ? [orgId] : [];

  // Total agents (excluding decommissioned)
  const totalRow = db.prepare(
    `SELECT COUNT(*) as count FROM agents WHERE status != 'decommissioned'${orgCondition}`
  ).get(...orgParams) as { count: number };

  // Online agents
  const onlineRow = db.prepare(
    `SELECT COUNT(*) as count FROM agents WHERE status = 'active' AND last_heartbeat > ?${orgCondition}`
  ).get(cutoff, ...orgParams) as { count: number };

  // By OS
  const osRows = db.prepare(
    `SELECT os, COUNT(*) as count FROM agents WHERE status != 'decommissioned'${orgCondition} GROUP BY os`
  ).all(...orgParams) as { os: string; count: number }[];

  const by_os: Record<string, number> = {};
  for (const row of osRows) {
    by_os[row.os] = row.count;
  }

  // By status
  const statusRows = db.prepare(
    `SELECT status, COUNT(*) as count FROM agents${orgCondition ? ' WHERE 1=1' + orgCondition : ''} GROUP BY status`
  ).all(...orgParams) as { status: string; count: number }[];

  const by_status: Record<string, number> = {};
  for (const row of statusRows) {
    by_status[row.status] = row.count;
  }

  // Pending tasks
  const pendingRow = db.prepare(
    `SELECT COUNT(*) as count FROM tasks WHERE status = 'pending'${orgCondition.replace('org_id', 'tasks.org_id')}`
  ).get(...orgParams) as { count: number };

  return {
    total: totalRow.count,
    online: onlineRow.count,
    offline: totalRow.count - onlineRow.count,
    by_os,
    by_status,
    pending_tasks: pendingRow.count,
  };
}

// ============================================================================
// AGENT LISTING
// ============================================================================

interface ListAgentsResult {
  agents: AgentSummary[];
  total: number;
}

export function listAgents(filters: ListAgentsRequest): ListAgentsResult {
  const db = getDatabase();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.org_id) {
    conditions.push('org_id = ?');
    params.push(filters.org_id);
  }

  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }

  if (filters.os) {
    conditions.push('os = ?');
    params.push(filters.os);
  }

  if (filters.hostname) {
    conditions.push('hostname LIKE ?');
    params.push(`%${filters.hostname}%`);
  }

  if (filters.tag) {
    conditions.push("tags LIKE ?");
    params.push(`%${JSON.stringify(filters.tag).slice(0, -1)}%`);
  }

  if (filters.online_only) {
    const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_SECONDS * 1000).toISOString();
    conditions.push("status = 'active' AND last_heartbeat > ?");
    params.push(cutoff);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  // Get total count
  const countRow = db.prepare(
    `SELECT COUNT(*) as count FROM agents ${whereClause}`
  ).get(...params) as { count: number };

  // Get agents
  const rows = db.prepare(
    `SELECT id, hostname, os, arch, agent_version, status, last_heartbeat, last_heartbeat_data, tags
     FROM agents ${whereClause}
     ORDER BY last_heartbeat DESC NULLS LAST
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as {
    id: string;
    hostname: string;
    os: AgentOS;
    arch: AgentArch;
    agent_version: string;
    status: AgentStatus;
    last_heartbeat: string | null;
    last_heartbeat_data: string | null;
    tags: string;
  }[];

  const agents: AgentSummary[] = rows.map((row) => ({
    id: row.id,
    hostname: row.hostname,
    os: row.os,
    arch: row.arch,
    agent_version: row.agent_version,
    status: row.status,
    runtime_status: computeRuntimeStatus(row.last_heartbeat, row.last_heartbeat_data, row.status),
    last_heartbeat: row.last_heartbeat ?? '',
    tags: parseTags(row.tags),
    is_online: isAgentOnline(row.last_heartbeat),
  }));

  return { agents, total: countRow.count };
}

// ============================================================================
// SINGLE AGENT
// ============================================================================

export function getAgent(agentId: string): Agent | null {
  const db = getDatabase();

  const row = db.prepare(
    `SELECT * FROM agents WHERE id = ?`
  ).get(agentId) as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    id: row.id as string,
    org_id: row.org_id as string,
    hostname: row.hostname as string,
    os: row.os as AgentOS,
    arch: row.arch as AgentArch,
    agent_version: row.agent_version as string,
    status: row.status as AgentStatus,
    last_heartbeat: (row.last_heartbeat as string) ?? '',
    last_heartbeat_data: row.last_heartbeat_data
      ? (JSON.parse(row.last_heartbeat_data as string) as HeartbeatPayload)
      : null,
    enrolled_at: row.enrolled_at as string,
    enrolled_by: row.enrolled_by as string,
    tags: parseTags(row.tags as string),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// ============================================================================
// UPDATE / DELETE
// ============================================================================

export function updateAgent(
  agentId: string,
  updates: { status?: AgentStatus; tags?: string[] }
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const fields: string[] = ['updated_at = ?'];
  const params: (string)[] = [now];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    params.push(updates.status);
  }

  if (updates.tags !== undefined) {
    fields.push('tags = ?');
    params.push(JSON.stringify(updates.tags));
  }

  params.push(agentId);

  db.prepare(
    `UPDATE agents SET ${fields.join(', ')} WHERE id = ?`
  ).run(...params);
}

export function deleteAgent(agentId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE agents SET status = 'decommissioned', updated_at = ? WHERE id = ?`
  ).run(now, agentId);
}

// ============================================================================
// TAGS
// ============================================================================

export function addTag(agentId: string, tag: string): string[] {
  const db = getDatabase();
  const now = new Date().toISOString();

  const row = db.prepare(`SELECT tags FROM agents WHERE id = ?`).get(agentId) as
    | { tags: string }
    | undefined;

  if (!row) throw new Error(`Agent ${agentId} not found`);

  const tags = parseTags(row.tags);
  if (!tags.includes(tag)) {
    tags.push(tag);
  }

  db.prepare(`UPDATE agents SET tags = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(tags),
    now,
    agentId
  );

  return tags;
}

export function removeTag(agentId: string, tag: string): string[] {
  const db = getDatabase();
  const now = new Date().toISOString();

  const row = db.prepare(`SELECT tags FROM agents WHERE id = ?`).get(agentId) as
    | { tags: string }
    | undefined;

  if (!row) throw new Error(`Agent ${agentId} not found`);

  const tags = parseTags(row.tags).filter((t) => t !== tag);

  db.prepare(`UPDATE agents SET tags = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(tags),
    now,
    agentId
  );

  return tags;
}

// ============================================================================
// HELPERS
// ============================================================================

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
