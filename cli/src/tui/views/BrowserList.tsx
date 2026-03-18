/**
 * Test library browser view.
 */

import { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { DataTable, type Column } from '../components/DataTable.js';
import { Spinner } from '../components/Spinner.js';
import { useApi } from '../hooks/useApi.js';
import * as browserApi from '../../api/browser.js';

interface BrowserListProps {
  height: number;
}

const COLUMNS: Column[] = [
  { key: 'uuid', label: 'UUID', width: 10, transform: (v) => String(v).slice(0, 8) + '…' },
  { key: 'name', label: 'Name', width: 28 },
  { key: 'category', label: 'Category', width: 16 },
  { key: 'severity', label: 'Severity', width: 12 },
  { key: 'techniques', label: 'Techniques', width: 16, transform: (v) => Array.isArray(v) ? v.join(', ') : '—' },
];

export function BrowserList({ height }: BrowserListProps) {
  const [selectedTest, setSelectedTest] = useState<Record<string, unknown> | null>(null);
  const tests = useApi(() => browserApi.listTests());

  useKeyboard((event) => {
    if (event.name === 'r') tests.refresh();
    if (event.name === 'escape') setSelectedTest(null);
  });

  if (tests.loading && !tests.data) {
    return <Spinner message="Loading test library..." />;
  }

  if (tests.error) {
    return <text fg="#e94560">Error: {tests.error}</text>;
  }

  const data = (tests.data?.tests ?? []) as unknown as Record<string, unknown>[];

  if (selectedTest) {
    return (
      <box flexDirection="column" padding={1} height={height}>
        <text fg="#e94560">Test Detail (ESC to go back)</text>
        <box flexDirection="column" marginTop={1}>
          {['uuid', 'name', 'category', 'subcategory', 'severity', 'techniques', 'tactics', 'threat_actor', 'target', 'complexity', 'tags', 'binary_name', 'description'].map(key => (
            <box key={key} flexDirection="row" height={1}>
              <text fg="#6c6c8a">{key.padEnd(16)}</text>
              <text fg="#a0a0b8">
                {(() => {
                  const val = (selectedTest as Record<string, unknown>)[key];
                  if (Array.isArray(val)) return val.join(', ');
                  if (typeof val === 'string' && val.length > 60) return val.slice(0, 60) + '…';
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
        <text fg="#e94560">Test Library </text>
        <text fg="#6c6c8a">({data.length} tests) — Enter: detail, r: refresh</text>
      </box>
      <DataTable
        data={data}
        columns={COLUMNS}
        height={height - 2}
        onSelect={setSelectedTest}
      />
    </box>
  );
}
