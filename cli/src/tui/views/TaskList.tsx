/**
 * Task list view with status filters.
 */

import { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { DataTable, type Column } from '../components/DataTable.js';
import { Spinner } from '../components/Spinner.js';
import { usePolling } from '../hooks/usePolling.js';
import * as tasksApi from '../../api/tasks.js';

interface TaskListProps {
  height: number;
}

const COLUMNS: Column[] = [
  { key: 'id', label: 'ID', width: 10, transform: (v) => String(v).slice(0, 8) + '…' },
  { key: 'type', label: 'Type', width: 14 },
  { key: 'agent_hostname', label: 'Host', width: 16, transform: (v) => v ? String(v) : '—' },
  {
    key: 'status', label: 'Status', width: 12,
    transform: (v) => {
      const s = String(v);
      if (s === 'completed') return '✓ completed';
      if (s === 'failed') return '✗ failed';
      if (s === 'executing') return '⏳ executing';
      if (s === 'expired') return '✗ expired';
      return `◷ ${s}`;
    },
  },
  {
    key: 'payload', label: 'Test/Cmd', width: 22,
    transform: (v) => {
      if (!v || typeof v !== 'object') return '—';
      const p = v as Record<string, unknown>;
      return String(p.test_name ?? p.command ?? '—').slice(0, 20);
    },
  },
];

export function TaskList({ height }: TaskListProps) {
  const [selectedTask, setSelectedTask] = useState<Record<string, unknown> | null>(null);
  const tasks = usePolling(() => tasksApi.listTasks({ limit: 100 }), 10000);

  useKeyboard((event) => {
    if (event.name === 'r') tasks.refresh();
    if (event.name === 'escape') setSelectedTask(null);
  });

  if (tasks.loading && !tasks.data) {
    return <Spinner message="Loading tasks..." />;
  }

  if (tasks.error) {
    return <text fg="#e94560">{`Error: ${tasks.error}`}</text>;
  }

  const data = (tasks.data?.tasks ?? []) as unknown as Record<string, unknown>[];

  if (selectedTask) {
    return (
      <box flexDirection="column" padding={1} height={height}>
        <text fg="#e94560">Task Detail (ESC to go back)</text>
        <box flexDirection="column" marginTop={1}>
          {['id', 'type', 'status', 'agent_hostname', 'priority', 'created_at', 'completed_at', 'batch_id', 'notes'].map(key => (
            <box key={key} flexDirection="row" height={1}>
              <text fg="#6c6c8a">{key.padEnd(20)}</text>
              <text fg="#a0a0b8">{String((selectedTask as Record<string, unknown>)[key] ?? '—')}</text>
            </box>
          ))}
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" padding={1} height={height}>
      <box flexDirection="row" height={1}>
        <text fg="#e94560">{`Tasks `}</text>
        <text fg="#6c6c8a">{`(${String(data.length)} total) — Enter: detail, r: refresh`}</text>
      </box>
      <DataTable
        data={data}
        columns={COLUMNS}
        height={height - 2}
        onSelect={setSelectedTask}
      />
    </box>
  );
}
