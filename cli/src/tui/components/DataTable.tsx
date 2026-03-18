/**
 * Reusable sortable/scrollable data table for TUI views.
 */

import { useState } from 'react';
import { useKeyboard } from '@opentui/react';

export interface Column {
  key: string;
  label: string;
  width?: number;
  transform?: (value: unknown, row: Record<string, unknown>) => string;
}

interface DataTableProps {
  data: Record<string, unknown>[];
  columns: Column[];
  height: number;
  focused?: boolean;
  onSelect?: (row: Record<string, unknown>) => void;
}

export function DataTable({ data, columns, height, focused = true, onSelect }: DataTableProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const visibleRows = Math.max(1, height - 2); // header + border

  useKeyboard((event) => {
    if (!focused) return;

    if (event.name === 'arrowDown' || event.name === 'j') {
      setSelectedIdx(prev => {
        const next = Math.min(prev + 1, data.length - 1);
        if (next >= scrollOffset + visibleRows) setScrollOffset(next - visibleRows + 1);
        return next;
      });
    }
    if (event.name === 'arrowUp' || event.name === 'k') {
      setSelectedIdx(prev => {
        const next = Math.max(prev - 1, 0);
        if (next < scrollOffset) setScrollOffset(next);
        return next;
      });
    }
    if (event.name === 'enter' && onSelect && data[selectedIdx]) {
      onSelect(data[selectedIdx]);
    }
  });

  const visibleData = data.slice(scrollOffset, scrollOffset + visibleRows);

  // Calculate column widths
  const totalAvail = columns.reduce((acc, col) => acc + (col.width ?? 12), 0);

  return (
    <box flexDirection="column" height={height}>
      {/* Header */}
      <box flexDirection="row" height={1} backgroundColor="#16213e">
        {columns.map(col => (
          <box key={col.key} width={col.width ?? 12}>
            <text fg="#e94560">{(col.label ?? col.key).padEnd(col.width ?? 12).slice(0, col.width ?? 12)}</text>
          </box>
        ))}
      </box>

      {/* Rows */}
      {visibleData.length === 0 ? (
        <box height={1} paddingLeft={2}>
          <text fg="#6c6c8a">No data</text>
        </box>
      ) : (
        visibleData.map((row, i) => {
          const actualIdx = scrollOffset + i;
          const isSelected = actualIdx === selectedIdx && focused;
          return (
            <box
              key={String(row.id ?? actualIdx)}
              flexDirection="row"
              height={1}
              backgroundColor={isSelected ? '#1a1a2e' : undefined}
            >
              {columns.map(col => {
                const raw = row[col.key];
                const val = col.transform ? col.transform(raw, row) : String(raw ?? '—');
                const display = val.padEnd(col.width ?? 12).slice(0, col.width ?? 12);
                return (
                  <box key={col.key} width={col.width ?? 12}>
                    <text fg={isSelected ? '#ffffff' : '#a0a0b8'}>
                      {isSelected ? '▸ ' : '  '}{display}
                    </text>
                  </box>
                );
              })}
            </box>
          );
        })
      )}

      {/* Scroll indicator */}
      {data.length > visibleRows && (
        <box height={1}>
          <text fg="#6c6c8a">
            {'  '}Showing {scrollOffset + 1}-{Math.min(scrollOffset + visibleRows, data.length)} of {data.length}
          </text>
        </box>
      )}
    </box>
  );
}
