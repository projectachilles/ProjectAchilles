// Agent Health Score — computes a 0-100 reliability score per agent based on
// heartbeat consistency (40%), task success rate (30%), and stability (30%).
// Computed on-demand from indexed SQLite tables (cheap, no caching needed).

import { getDatabase } from './database.js';

/**
 * Compute health score for a single agent.
 * Score range: 0–100 (higher = healthier).
 *
 * Components:
 *  - Heartbeat consistency (40%): received / expected heartbeats in 7d
 *  - Task success rate (30%): completed / (completed + failed) in 7d
 *  - Stability (30%): 1 - min(went_offline_count_7d / 10, 1)
 */
export function computeAgentHealthScore(agentId: string): number {
  const db = getDatabase();

  // Heartbeat consistency: heartbeat_history samples every 5th heartbeat.
  // Expected = 7 days × 24h × 60min ÷ 5 = 2016 records.
  const hbRow = db.prepare(`
    SELECT COUNT(*) as count FROM heartbeat_history
    WHERE agent_id = ? AND timestamp > datetime('now', '-7 days')
  `).get(agentId) as { count: number };
  const expectedHb = 7 * 24 * 60 / 5;
  const hbScore = Math.min(1, hbRow.count / expectedHb);

  // Task success rate
  const taskRow = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM tasks
    WHERE agent_id = ? AND completed_at > datetime('now', '-7 days')
  `).get(agentId) as { completed: number | null; failed: number | null };
  const completed = taskRow.completed ?? 0;
  const failed = taskRow.failed ?? 0;
  const totalTasks = completed + failed;
  const taskScore = totalTasks > 0 ? completed / totalTasks : 1;

  // Stability: fewer disconnects = higher score. 10+ disconnects = 0 stability.
  const disconnectRow = db.prepare(`
    SELECT COUNT(*) as count FROM agent_events
    WHERE agent_id = ? AND event_type = 'went_offline'
      AND created_at > datetime('now', '-7 days')
  `).get(agentId) as { count: number };
  const stabilityScore = 1 - Math.min(disconnectRow.count / 10, 1);

  return Math.round(hbScore * 40 + taskScore * 30 + stabilityScore * 30);
}

/**
 * Batch-compute health scores for multiple agents (avoids N+1 queries).
 * Uses 3 bulk SQL queries grouped by agent_id.
 */
export function computeAgentHealthScores(agentIds: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  if (agentIds.length === 0) return scores;

  const db = getDatabase();
  const placeholders = agentIds.map(() => '?').join(',');

  // 1. Heartbeat counts per agent
  const hbRows = db.prepare(`
    SELECT agent_id, COUNT(*) as count FROM heartbeat_history
    WHERE agent_id IN (${placeholders}) AND timestamp > datetime('now', '-7 days')
    GROUP BY agent_id
  `).all(...agentIds) as { agent_id: string; count: number }[];
  const hbMap = new Map(hbRows.map(r => [r.agent_id, r.count]));

  // 2. Task stats per agent
  const taskRows = db.prepare(`
    SELECT agent_id,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM tasks
    WHERE agent_id IN (${placeholders}) AND completed_at > datetime('now', '-7 days')
    GROUP BY agent_id
  `).all(...agentIds) as { agent_id: string; completed: number | null; failed: number | null }[];
  const taskMap = new Map(taskRows.map(r => [r.agent_id, {
    completed: r.completed ?? 0,
    failed: r.failed ?? 0,
  }]));

  // 3. Disconnect counts per agent
  const disconnectRows = db.prepare(`
    SELECT agent_id, COUNT(*) as count FROM agent_events
    WHERE agent_id IN (${placeholders}) AND event_type = 'went_offline'
      AND created_at > datetime('now', '-7 days')
    GROUP BY agent_id
  `).all(...agentIds) as { agent_id: string; count: number }[];
  const disconnectMap = new Map(disconnectRows.map(r => [r.agent_id, r.count]));

  const expectedHb = 7 * 24 * 60 / 5;

  for (const id of agentIds) {
    const hbCount = hbMap.get(id) ?? 0;
    const hbScore = Math.min(1, hbCount / expectedHb);

    const tasks = taskMap.get(id) ?? { completed: 0, failed: 0 };
    const totalTasks = tasks.completed + tasks.failed;
    const taskScore = totalTasks > 0 ? tasks.completed / totalTasks : 1;

    const disconnects = disconnectMap.get(id) ?? 0;
    const stabilityScore = 1 - Math.min(disconnects / 10, 1);

    scores.set(id, Math.round(hbScore * 40 + taskScore * 30 + stabilityScore * 30));
  }

  return scores;
}
