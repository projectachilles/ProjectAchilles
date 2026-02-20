import { getDb } from './database.js';
import { decryptPendingKey, promotePendingKey, ROTATION_GRACE_PERIOD_SECONDS } from './enrollment.service.js';
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

export async function processHeartbeat(agentId: string, payload: HeartbeatPayload): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();

  await db.run(
    `UPDATE agents
     SET last_heartbeat = ?,
         last_heartbeat_data = ?,
         agent_version = ?,
         updated_at = ?
     WHERE id = ?`,
    [now, JSON.stringify(payload), payload.agent_version, now, agentId]
  );
}

// ============================================================================
// KEY ROTATION — HEARTBEAT DELIVERY
// ============================================================================

/**
 * Check if the agent has a pending rotation key that should be delivered via heartbeat.
 * Returns the plaintext key if within grace period, or null.
 * If the grace period has expired, promotes the pending key and returns null.
 */
export async function getPendingRotationKey(agentId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.get(
    'SELECT pending_api_key_encrypted, key_rotation_initiated_at FROM agents WHERE id = ?',
    [agentId]
  ) as unknown as { pending_api_key_encrypted: string | null; key_rotation_initiated_at: string | null } | undefined;

  if (!row?.pending_api_key_encrypted || !row.key_rotation_initiated_at) {
    return null;
  }

  // Check if grace period has expired
  const initiatedAt = new Date(row.key_rotation_initiated_at + 'Z').getTime();
  const elapsed = (Date.now() - initiatedAt) / 1000;
  if (elapsed > ROTATION_GRACE_PERIOD_SECONDS) {
    await promotePendingKey(agentId);
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

export async function getAgentMetrics(orgId?: string): Promise<AgentMetrics> {
  const db = await getDb();

  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_SECONDS * 1000).toISOString();

  // Base condition
  const orgCondition = orgId ? ' AND org_id = ?' : '';
  const orgParams = orgId ? [orgId] : [];

  // Total agents (excluding decommissioned)
  const totalRow = await db.get(
    `SELECT COUNT(*) as count FROM agents WHERE status != 'decommissioned'${orgCondition}`,
    [...orgParams]
  ) as unknown as { count: number };

  // Online agents
  const onlineRow = await db.get(
    `SELECT COUNT(*) as count FROM agents WHERE status = 'active' AND last_heartbeat > ?${orgCondition}`,
    [cutoff, ...orgParams]
  ) as unknown as { count: number };

  // By OS
  const osRows = await db.all(
    `SELECT os, COUNT(*) as count FROM agents WHERE status != 'decommissioned'${orgCondition} GROUP BY os`,
    [...orgParams]
  ) as unknown as { os: string; count: number }[];

  const by_os: Record<string, number> = {};
  for (const row of osRows) {
    by_os[row.os] = row.count;
  }

  // By status
  const statusRows = await db.all(
    `SELECT status, COUNT(*) as count FROM agents${orgCondition ? ' WHERE 1=1' + orgCondition : ''} GROUP BY status`,
    [...orgParams]
  ) as unknown as { status: string; count: number }[];

  const by_status: Record<string, number> = {};
  for (const row of statusRows) {
    by_status[row.status] = row.count;
  }

  // Pending tasks
  const pendingRow = await db.get(
    `SELECT COUNT(*) as count FROM tasks WHERE status = 'pending'${orgCondition.replace('org_id', 'tasks.org_id')}`,
    [...orgParams]
  ) as unknown as { count: number };

  // Task activity — last 24 hours
  const taskOrgCondition = orgCondition.replace('org_id', 'tasks.org_id');

  const completedRow = await db.get(
    `SELECT COUNT(*) as count FROM tasks WHERE status = 'completed' AND completed_at > datetime('now', '-24 hours')${taskOrgCondition}`,
    [...orgParams]
  ) as unknown as { count: number };

  const failedRow = await db.get(
    `SELECT COUNT(*) as count FROM tasks WHERE status = 'failed' AND completed_at > datetime('now', '-24 hours')${taskOrgCondition}`,
    [...orgParams]
  ) as unknown as { count: number };

  const inProgressRow = await db.get(
    `SELECT COUNT(*) as count FROM tasks WHERE status IN ('assigned', 'downloading', 'executing')${taskOrgCondition}`,
    [...orgParams]
  ) as unknown as { count: number };

  const finished24h = completedRow.count + failedRow.count;
  const successRate = finished24h > 0 ? Math.round((completedRow.count / finished24h) * 100) : 0;

  // Agent version distribution (non-decommissioned)
  const versionRows = await db.all(
    `SELECT agent_version, COUNT(*) as count FROM agents WHERE status != 'decommissioned'${orgCondition} GROUP BY agent_version`,
    [...orgParams]
  ) as unknown as { agent_version: string; count: number }[];

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

export async function listAgents(filters: ListAgentsRequest): Promise<ListAgentsResult> {
  const db = await getDb();

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
    // By default, exclude decommissioned agents (matches getAgentMetrics behavior)
    conditions.push("status != 'decommissioned'");
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
  const countRow = await db.get(
    `SELECT COUNT(*) as count FROM agents ${whereClause}`,
    [...params]
  ) as unknown as { count: number };

  // Get agents
  const rows = await db.all(
    `SELECT id, hostname, os, arch, agent_version, status, last_heartbeat, last_heartbeat_data, tags, key_rotation_initiated_at
     FROM agents ${whereClause}
     ORDER BY last_heartbeat DESC NULLS LAST
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as unknown as {
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
    rotation_pending: row.key_rotation_initiated_at != null,
  }));

  return { agents, total: countRow.count };
}

// ============================================================================
// SINGLE AGENT
// ============================================================================

export async function getAgent(agentId: string): Promise<Agent | null> {
  const db = await getDb();

  const row = await db.get(
    `SELECT * FROM agents WHERE id = ?`,
    [agentId]
  ) as unknown as Record<string, unknown> | undefined;

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

export async function updateAgent(
  agentId: string,
  updates: { status?: AgentStatus; tags?: string[] }
): Promise<void> {
  const db = await getDb();
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

  await db.run(
    `UPDATE agents SET ${fields.join(', ')} WHERE id = ?`,
    [...params]
  );
}

export async function deleteAgent(agentId: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();

  await db.run(
    `UPDATE agents SET status = 'decommissioned', updated_at = ? WHERE id = ?`,
    [now, agentId]
  );
}

// ============================================================================
// TAGS
// ============================================================================

export async function addTag(agentId: string, tag: string): Promise<string[]> {
  const db = await getDb();
  const now = new Date().toISOString();

  const row = await db.get(
    `SELECT tags FROM agents WHERE id = ?`,
    [agentId]
  ) as unknown as { tags: string } | undefined;

  if (!row) throw new Error(`Agent ${agentId} not found`);

  const tags = parseTags(row.tags);
  if (!tags.includes(tag)) {
    tags.push(tag);
  }

  await db.run(
    `UPDATE agents SET tags = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(tags), now, agentId]
  );

  return tags;
}

export async function removeTag(agentId: string, tag: string): Promise<string[]> {
  const db = await getDb();
  const now = new Date().toISOString();

  const row = await db.get(
    `SELECT tags FROM agents WHERE id = ?`,
    [agentId]
  ) as unknown as { tags: string } | undefined;

  if (!row) throw new Error(`Agent ${agentId} not found`);

  const tags = parseTags(row.tags).filter((t) => t !== tag);

  await db.run(
    `UPDATE agents SET tags = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(tags), now, agentId]
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
