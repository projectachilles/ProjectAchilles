import { getDatabase } from './database.js';
import { decryptPendingKey, promotePendingKey, ROTATION_GRACE_PERIOD_SECONDS } from './enrollment.service.js';
import { recordEvent } from './events.service.js';
import type {
  HeartbeatPayload,
  AgentSummary,
  Agent,
  AgentRuntimeStatus,
  AgentStatus,
  AgentOS,
  AgentArch,
  ListAgentsRequest,
  HeartbeatHistoryPoint,
  FleetHealthMetrics,
} from '../../types/agent.js';

const HEARTBEAT_TIMEOUT_SECONDS = 180; // 3x the 60s heartbeat interval

// ============================================================================
// HEARTBEAT PROCESSING
// ============================================================================

export function processHeartbeat(agentId: string, payload: HeartbeatPayload): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  // Read current state before updating to detect transitions
  const current = db.prepare(
    'SELECT agent_version, last_heartbeat FROM agents WHERE id = ?'
  ).get(agentId) as { agent_version: string; last_heartbeat: string | null } | undefined;

  const stmt = db.prepare(`
    UPDATE agents
    SET last_heartbeat = ?,
        last_heartbeat_data = ?,
        agent_version = ?,
        updated_at = ?
    WHERE id = ?
  `);

  stmt.run(now, JSON.stringify(payload), payload.agent_version, now, agentId);

  // Detect came_online: agent was offline (gap > 180s or no previous heartbeat)
  if (current) {
    if (!current.last_heartbeat || !isAgentOnline(current.last_heartbeat)) {
      recordEvent(agentId, 'came_online');
    }

    // Detect version change
    if (current.agent_version !== payload.agent_version) {
      recordEvent(agentId, 'version_updated', {
        from: current.agent_version,
        to: payload.agent_version,
      });
    }
  }

  // Record heartbeat history
  recordHeartbeatHistory(agentId, payload);
}

// ============================================================================
// KEY ROTATION — HEARTBEAT DELIVERY
// ============================================================================

/**
 * Check if the agent has a pending rotation key that should be delivered via heartbeat.
 * Returns the plaintext key if within grace period, or null.
 * If the grace period has expired, promotes the pending key and returns null.
 */
export function getPendingRotationKey(agentId: string): string | null {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT pending_api_key_encrypted, key_rotation_initiated_at FROM agents WHERE id = ?'
  ).get(agentId) as { pending_api_key_encrypted: string | null; key_rotation_initiated_at: string | null } | undefined;

  if (!row?.pending_api_key_encrypted || !row.key_rotation_initiated_at) {
    return null;
  }

  // Check if grace period has expired
  const initiatedAt = new Date(row.key_rotation_initiated_at + 'Z').getTime();
  const elapsed = (Date.now() - initiatedAt) / 1000;
  if (elapsed > ROTATION_GRACE_PERIOD_SECONDS) {
    promotePendingKey(agentId);
    return null;
  }

  try {
    return decryptPendingKey(row.pending_api_key_encrypted);
  } catch {
    return null;
  }
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
  task_activity_24h: {
    completed: number;
    failed: number;
    total: number;
    success_rate: number;
    in_progress: number;
  };
  by_version: Record<string, number>;
}

export function getAgentMetrics(orgId?: string): AgentMetrics {
  const db = getDatabase();

  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_SECONDS * 1000).toISOString();

  // Base condition
  const orgCondition = orgId ? ' AND org_id = ?' : '';
  const orgParams = orgId ? [orgId] : [];

  // Total agents (excluding decommissioned)
  const totalRow = db.prepare(
    `SELECT COUNT(*) as count FROM agents WHERE status NOT IN ('decommissioned', 'uninstalled')${orgCondition}`
  ).get(...orgParams) as { count: number };

  // Online agents
  const onlineRow = db.prepare(
    `SELECT COUNT(*) as count FROM agents WHERE status = 'active' AND last_heartbeat > ?${orgCondition}`
  ).get(cutoff, ...orgParams) as { count: number };

  // By OS
  const osRows = db.prepare(
    `SELECT os, COUNT(*) as count FROM agents WHERE status NOT IN ('decommissioned', 'uninstalled')${orgCondition} GROUP BY os`
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

  // Task activity — last 24 hours
  const taskOrgCondition = orgCondition.replace('org_id', 'tasks.org_id');

  const completedRow = db.prepare(
    `SELECT COUNT(*) as count FROM tasks WHERE status = 'completed' AND completed_at > datetime('now', '-24 hours')${taskOrgCondition}`
  ).get(...orgParams) as { count: number };

  const failedRow = db.prepare(
    `SELECT COUNT(*) as count FROM tasks WHERE status = 'failed' AND completed_at > datetime('now', '-24 hours')${taskOrgCondition}`
  ).get(...orgParams) as { count: number };

  const inProgressRow = db.prepare(
    `SELECT COUNT(*) as count FROM tasks WHERE status IN ('assigned', 'downloading', 'executing')${taskOrgCondition}`
  ).get(...orgParams) as { count: number };

  const finished24h = completedRow.count + failedRow.count;
  const successRate = finished24h > 0 ? Math.round((completedRow.count / finished24h) * 100) : 0;

  // Agent version distribution (non-decommissioned)
  const versionRows = db.prepare(
    `SELECT agent_version, COUNT(*) as count FROM agents WHERE status NOT IN ('decommissioned', 'uninstalled')${orgCondition} GROUP BY agent_version`
  ).all(...orgParams) as { agent_version: string; count: number }[];

  const by_version: Record<string, number> = {};
  for (const row of versionRows) {
    by_version[row.agent_version] = row.count;
  }

  return {
    total: totalRow.count,
    online: onlineRow.count,
    offline: totalRow.count - onlineRow.count,
    by_os,
    by_status,
    pending_tasks: pendingRow.count,
    task_activity_24h: {
      completed: completedRow.count,
      failed: failedRow.count,
      total: finished24h,
      success_rate: successRate,
      in_progress: inProgressRow.count,
    },
    by_version,
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
  } else {
    // By default, exclude decommissioned/uninstalled agents (matches getAgentMetrics behavior)
    conditions.push("status NOT IN ('decommissioned', 'uninstalled')");
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

  if (filters.stale_only) {
    conditions.push(`status = 'active' AND last_heartbeat IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM tasks t WHERE t.agent_id = agents.id AND t.status = 'completed' AND t.completed_at > datetime('now', '-7 days')
    )`);
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
    `SELECT id, hostname, os, arch, agent_version, status, last_heartbeat, last_heartbeat_data, tags, key_rotation_initiated_at
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
    key_rotation_initiated_at: string | null;
  }[];

  // Compute stale set for enrichment
  const staleIds = getStaleAgentIds(filters.org_id);

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
    is_stale: staleIds.has(row.id),
    rotation_pending: row.key_rotation_initiated_at != null,
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
    rotation_pending: (row.key_rotation_initiated_at as string | null) != null,
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

  // Read current status for change detection
  let previousStatus: string | undefined;
  if (updates.status !== undefined) {
    const current = db.prepare('SELECT status FROM agents WHERE id = ?').get(agentId) as { status: string } | undefined;
    previousStatus = current?.status;
  }

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

  // Record status change event
  if (updates.status !== undefined && previousStatus !== undefined && updates.status !== previousStatus) {
    recordEvent(agentId, 'status_changed', { from: previousStatus, to: updates.status });
  }
}

export function deleteAgent(agentId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE agents SET status = 'decommissioned', updated_at = ? WHERE id = ?`
  ).run(now, agentId);

  recordEvent(agentId, 'decommissioned');
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

// ============================================================================
// HEARTBEAT HISTORY
// ============================================================================

/**
 * Record a heartbeat data point in the append-only history table.
 */
export function recordHeartbeatHistory(agentId: string, payload: HeartbeatPayload): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO heartbeat_history (agent_id, cpu_percent, memory_mb, disk_free_mb, uptime_seconds)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    agentId,
    payload.system.cpu_percent ?? null,
    payload.system.memory_mb ?? null,
    payload.system.disk_free_mb ?? null,
    payload.system.uptime_seconds ?? null
  );
}

/**
 * Get heartbeat history for an agent over N days.
 */
export function getHeartbeatHistory(agentId: string, days: number = 7): HeartbeatHistoryPoint[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT timestamp, cpu_percent, memory_mb, disk_free_mb, uptime_seconds
    FROM heartbeat_history
    WHERE agent_id = ? AND timestamp > datetime('now', ?)
    ORDER BY timestamp ASC
  `).all(agentId, `-${days} days`) as HeartbeatHistoryPoint[];

  return rows;
}

/**
 * Delete heartbeat history rows older than 30 days.
 * Designed to run hourly as a background job.
 */
export function pruneHeartbeatHistory(): number {
  const db = getDatabase();
  const result = db.prepare(`
    DELETE FROM heartbeat_history WHERE timestamp < datetime('now', '-30 days')
  `).run();
  if (result.changes > 0) {
    console.log(`[heartbeat] Pruned ${result.changes} heartbeat history row(s) older than 30 days`);
  }
  return result.changes;
}

/**
 * Detect agents that have gone offline (last heartbeat > 180s ago)
 * and record went_offline events if not already recorded recently.
 * Designed to run every 60s as a background job.
 */
export function detectOfflineAgents(): number {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_SECONDS * 1000).toISOString();

  // Find agents that are active, were online (have a heartbeat), but now exceed timeout.
  // Use datetime() to normalize timestamp formats (ISO 8601 T-separator vs SQLite space-separator).
  const offlineAgents = db.prepare(`
    SELECT a.id FROM agents a
    WHERE a.status = 'active'
      AND a.last_heartbeat IS NOT NULL
      AND datetime(a.last_heartbeat) < datetime(?)
      AND NOT EXISTS (
        SELECT 1 FROM agent_events e
        WHERE e.agent_id = a.id
          AND e.event_type = 'went_offline'
          AND datetime(e.created_at) > datetime(a.last_heartbeat)
      )
  `).all(cutoff) as { id: string }[];

  for (const agent of offlineAgents) {
    recordEvent(agent.id, 'went_offline');
  }

  return offlineAgents.length;
}

// ============================================================================
// FLEET HEALTH METRICS
// ============================================================================

/**
 * Compute fleet-wide health metrics from heartbeat history and task data.
 */
export function getFleetHealthMetrics(orgId?: string): FleetHealthMetrics {
  const db = getDatabase();
  const orgCondition = orgId ? " AND a.org_id = ?" : '';
  const orgParams = orgId ? [orgId] : [];

  // Active agent count
  const agentCountRow = db.prepare(
    `SELECT COUNT(*) as count FROM agents a WHERE a.status = 'active'${orgCondition}`
  ).get(...orgParams) as { count: number };
  const agentCount = agentCountRow.count;

  // Fleet uptime % (30d): ratio of actual heartbeats to expected heartbeats.
  // Each heartbeat is ~60s apart, so expected = agent_count * 30 * 24 * 60.
  let fleetUptime = 0;
  if (agentCount > 0) {
    const hbCountRow = db.prepare(`
      SELECT COUNT(*) as count FROM heartbeat_history h
      INNER JOIN agents a ON h.agent_id = a.id
      WHERE h.timestamp > datetime('now', '-30 days') AND a.status = 'active'${orgCondition.replace('a.org_id', 'a.org_id')}
    `).get(...orgParams) as { count: number };

    const expectedHeartbeats = agentCount * 30 * 24 * 60; // one per minute over 30 days
    fleetUptime = Math.min(100, (hbCountRow.count / expectedHeartbeats) * 100);
  }

  // Task success rate (7d)
  const taskOrgCondition = orgId ? " AND t.org_id = ?" : '';
  const completedRow = db.prepare(
    `SELECT COUNT(*) as count FROM tasks t WHERE t.status = 'completed' AND t.completed_at > datetime('now', '-7 days')${taskOrgCondition}`
  ).get(...orgParams) as { count: number };

  const failedRow = db.prepare(
    `SELECT COUNT(*) as count FROM tasks t WHERE t.status = 'failed' AND t.completed_at > datetime('now', '-7 days')${taskOrgCondition}`
  ).get(...orgParams) as { count: number };

  const finished7d = completedRow.count + failedRow.count;
  const taskSuccessRate = finished7d > 0 ? Math.round((completedRow.count / finished7d) * 100 * 10) / 10 : 100;

  // MTBF: mean time between task failures
  const failureTimestamps = db.prepare(`
    SELECT created_at FROM agent_events
    WHERE event_type = 'task_failed'
      AND created_at > datetime('now', '-30 days')
    ORDER BY created_at ASC
  `).all() as { created_at: string }[];

  let mtbfHours: number | null = null;
  if (failureTimestamps.length >= 2) {
    let totalGapMs = 0;
    for (let i = 1; i < failureTimestamps.length; i++) {
      const prev = new Date(failureTimestamps[i - 1].created_at + 'Z').getTime();
      const curr = new Date(failureTimestamps[i].created_at + 'Z').getTime();
      totalGapMs += curr - prev;
    }
    mtbfHours = Math.round((totalGapMs / (failureTimestamps.length - 1) / (1000 * 60 * 60)) * 10) / 10;
  }

  // Stale agents: active, online-capable, but 0 completed tasks in 7d
  const staleRows = db.prepare(`
    SELECT a.id FROM agents a
    WHERE a.status = 'active'
      AND a.last_heartbeat IS NOT NULL${orgCondition}
      AND NOT EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.agent_id = a.id
          AND t.status = 'completed'
          AND t.completed_at > datetime('now', '-7 days')
      )
  `).all(...orgParams) as { id: string }[];

  return {
    fleet_uptime_percent_30d: Math.round(fleetUptime * 10) / 10,
    task_success_rate_7d: taskSuccessRate,
    mtbf_hours: mtbfHours,
    stale_agent_count: staleRows.length,
    stale_agent_ids: staleRows.map(r => r.id),
  };
}

// ============================================================================
// STALE AGENT DETECTION (for list enrichment)
// ============================================================================

/**
 * Get the set of agent IDs considered "stale" (active but no completed tasks in 7d).
 */
export function getStaleAgentIds(orgId?: string): Set<string> {
  const db = getDatabase();
  const orgCondition = orgId ? " AND a.org_id = ?" : '';
  const orgParams = orgId ? [orgId] : [];

  const rows = db.prepare(`
    SELECT a.id FROM agents a
    WHERE a.status = 'active'
      AND a.last_heartbeat IS NOT NULL${orgCondition}
      AND NOT EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.agent_id = a.id
          AND t.status = 'completed'
          AND t.completed_at > datetime('now', '-7 days')
      )
  `).all(...orgParams) as { id: string }[];

  return new Set(rows.map(r => r.id));
}
