/**
 * Schedule management view.
 */

import { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { DataTable, type Column } from '../components/DataTable.js';
import { Spinner } from '../components/Spinner.js';
import { useApi } from '../hooks/useApi.js';
import * as schedulesApi from '../../api/schedules.js';

interface ScheduleListProps {
  height: number;
}

const COLUMNS: Column[] = [
  { key: 'id', label: 'ID', width: 10, transform: (v) => String(v).slice(0, 8) + '…' },
  { key: 'name', label: 'Name', width: 16, transform: (v) => v ? String(v) : '—' },
  { key: 'test_name', label: 'Test', width: 22 },
  { key: 'schedule_type', label: 'Type', width: 8 },
  {
    key: 'status', label: 'Status', width: 10,
    transform: (v) => {
      const s = String(v);
      if (s === 'active') return '▶ active';
      if (s === 'paused') return '⏸ paused';
      return s;
    },
  },
  { key: 'next_run_at', label: 'Next Run', width: 14, transform: (v) => v ? String(v).slice(0, 16) : '—' },
];

export function ScheduleList({ height }: ScheduleListProps) {
  const [selectedSchedule, setSelectedSchedule] = useState<Record<string, unknown> | null>(null);
  const schedules = useApi(() => schedulesApi.listSchedules());

  useKeyboard((event) => {
    if (event.name === 'r') schedules.refresh();
    if (event.name === 'escape') setSelectedSchedule(null);
  });

  if (schedules.loading && !schedules.data) {
    return <Spinner message="Loading schedules..." />;
  }

  if (schedules.error) {
    return <text fg="#e94560">Error: {schedules.error}</text>;
  }

  const data = (schedules.data ?? []) as unknown as Record<string, unknown>[];

  if (selectedSchedule) {
    return (
      <box flexDirection="column" padding={1} height={height}>
        <text fg="#e94560">Schedule Detail (ESC to go back)</text>
        <box flexDirection="column" marginTop={1}>
          {['id', 'name', 'test_name', 'schedule_type', 'schedule_config', 'timezone', 'status', 'next_run_at', 'last_run_at', 'agent_ids', 'created_by'].map(key => (
            <box key={key} flexDirection="row" height={1}>
              <text fg="#6c6c8a">{key.padEnd(18)}</text>
              <text fg="#a0a0b8">
                {(() => {
                  const val = (selectedSchedule as Record<string, unknown>)[key];
                  if (typeof val === 'object') return JSON.stringify(val);
                  return String(val ?? '—');
                })()}
              </text>
            </box>
          ))}
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" padding={1} height={height}>
      <box flexDirection="row" height={1}>
        <text fg="#e94560">Schedules </text>
        <text fg="#6c6c8a">({data.length} total) — Enter: detail, r: refresh</text>
      </box>
      <DataTable
        data={data}
        columns={COLUMNS}
        height={height - 2}
        onSelect={setSelectedSchedule}
      />
    </box>
  );
}
