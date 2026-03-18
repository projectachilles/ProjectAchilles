/**
 * Agent list view with filters and detail expansion.
 */

import { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { DataTable, type Column } from '../components/DataTable.js';
import { Spinner } from '../components/Spinner.js';
import { usePolling } from '../hooks/usePolling.js';
import * as agentsApi from '../../api/agents.js';

interface AgentListProps {
  height: number;
}

const COLUMNS: Column[] = [
  { key: 'hostname', label: 'Hostname', width: 18 },
  { key: 'os', label: 'OS', width: 8 },
  { key: 'arch', label: 'Arch', width: 6 },
  { key: 'agent_version', label: 'Ver', width: 8 },
  {
    key: 'is_online', label: 'Status', width: 10,
    transform: (v) => v ? '● online' : '● offline',
  },
  { key: 'tags', label: 'Tags', width: 20, transform: (v) => Array.isArray(v) ? v.join(', ') : '—' },
];

export function AgentList({ height }: AgentListProps) {
  const [selectedAgent, setSelectedAgent] = useState<Record<string, unknown> | null>(null);
  const agents = usePolling(() => agentsApi.listAgents({ limit: 100 }), 15000);

  useKeyboard((event) => {
    if (event.name === 'r') agents.refresh();
    if (event.name === 'escape') setSelectedAgent(null);
  });

  if (agents.loading && !agents.data) {
    return <Spinner message="Loading agents..." />;
  }

  if (agents.error) {
    return <text fg="#e94560">{`Error: ${agents.error}`}</text>;
  }

  const data = (agents.data?.agents ?? []) as unknown as Record<string, unknown>[];

  if (selectedAgent) {
    return (
      <box flexDirection="column" padding={1} height={height}>
        <text fg="#e94560">Agent Detail (ESC to go back)</text>
        <box flexDirection="column" marginTop={1}>
          {Object.entries(selectedAgent).map(([key, val]) => (
            <box key={key} flexDirection="row" height={1}>
              <text fg="#6c6c8a">{key.padEnd(20)}</text>
              <text fg="#a0a0b8">{typeof val === 'object' ? JSON.stringify(val) : String(val ?? '—')}</text>
            </box>
          ))}
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" padding={1} height={height}>
      <box flexDirection="row" height={1}>
        <text fg="#e94560">{`Agents `}</text>
        <text fg="#6c6c8a">{`(${String(data.length)} total) — Enter: detail, r: refresh`}</text>
      </box>
      <DataTable
        data={data}
        columns={COLUMNS}
        height={height - 2}
        onSelect={setSelectedAgent}
      />
    </box>
  );
}
