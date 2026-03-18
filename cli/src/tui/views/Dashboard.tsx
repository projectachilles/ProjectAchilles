/**
 * Main dashboard — fleet summary, recent tasks, defense score.
 */

import { useKeyboard } from '@opentui/react';
import { Spinner } from '../components/Spinner.js';
import { ScoreBadge } from '../components/ScoreBadge.js';
import { usePolling } from '../hooks/usePolling.js';
import * as agentsApi from '../../api/agents.js';
import * as analyticsApi from '../../api/analytics.js';
import * as tasksApi from '../../api/tasks.js';

interface DashboardProps {
  height: number;
}

export function Dashboard({ height }: DashboardProps) {
  const metrics = usePolling(() => agentsApi.getMetrics(), 15000);
  const score = usePolling(() => analyticsApi.getDefenseScore(), 30000);
  const recentTasks = usePolling(() => tasksApi.listTasks({ limit: 8 }), 10000);

  useKeyboard((event) => {
    if (event.name === 'r') {
      metrics.refresh();
      score.refresh();
      recentTasks.refresh();
    }
  });

  return (
    <box flexDirection="column" height={height} padding={1}>
      {/* Fleet Overview + Score */}
      <box flexDirection="row" height={5} gap={2}>
        {/* Fleet card */}
        <box flexDirection="column" border={true} borderStyle="single" borderColor="#16213e" padding={1} width="50%">
          <text fg="#e94560">Fleet Overview</text>
          {metrics.loading && !metrics.data ? (
            <Spinner message="Loading fleet..." />
          ) : metrics.error ? (
            <text fg="#e94560">Error: {metrics.error}</text>
          ) : metrics.data ? (
            <box flexDirection="column">
              <text fg="#16c79a">● {metrics.data.online} online  </text>
              <text fg="#e94560">● {metrics.data.offline} offline  </text>
              <text fg="#6c6c8a">{metrics.data.total} total agents</text>
            </box>
          ) : null}
        </box>

        {/* Score card */}
        <box flexDirection="column" border={true} borderStyle="single" borderColor="#16213e" padding={1} width="50%">
          {score.loading && !score.data ? (
            <Spinner message="Loading score..." />
          ) : score.error ? (
            <text fg="#6c6c8a">Analytics not configured</text>
          ) : score.data ? (
            <box flexDirection="column">
              <ScoreBadge score={score.data.score} />
              <text fg="#6c6c8a">
                {score.data.protectedCount} protected / {score.data.unprotectedCount} unprotected
              </text>
            </box>
          ) : null}
        </box>
      </box>

      {/* Recent Tasks */}
      <box flexDirection="column" border={true} borderStyle="single" borderColor="#16213e" padding={1} flexGrow={1} marginTop={1}>
        <text fg="#e94560">Recent Tasks</text>
        {recentTasks.loading && !recentTasks.data ? (
          <Spinner message="Loading tasks..." />
        ) : recentTasks.error ? (
          <text fg="#e94560">Error: {recentTasks.error}</text>
        ) : recentTasks.data?.tasks && recentTasks.data.tasks.length > 0 ? (
          <box flexDirection="column" marginTop={1}>
            {recentTasks.data.tasks.map((task) => {
              const statusIcon = task.status === 'completed' ? '✓'
                : task.status === 'failed' ? '✗'
                : task.status === 'executing' ? '⏳'
                : '◷';
              const statusColor = task.status === 'completed' ? '#16c79a'
                : task.status === 'failed' ? '#e94560'
                : task.status === 'executing' ? '#f5c518'
                : '#6c6c8a';
              const testName = task.payload?.test_name || task.payload?.command || '—';
              const host = task.agent_hostname || '—';
              const ago = getTimeAgo(task.created_at);

              return (
                <box key={task.id} flexDirection="row" height={1}>
                  <text fg={statusColor}>{statusIcon} </text>
                  <text fg="#a0a0b8">{testName.padEnd(25).slice(0, 25)} </text>
                  <text fg="#6c6c8a">{host.padEnd(16).slice(0, 16)} </text>
                  <text fg="#6c6c8a">{ago}</text>
                </box>
              );
            })}
          </box>
        ) : (
          <text fg="#6c6c8a">No recent tasks</text>
        )}
      </box>
    </box>
  );
}

function getTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
