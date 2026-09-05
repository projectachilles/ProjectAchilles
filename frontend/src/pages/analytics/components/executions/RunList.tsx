import { useEffect, useRef } from 'react';
import { Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { BundleResultLabel, ExecResultLabel, formatTimestamp, type DisplayRow } from './shared';

interface RunListProps {
  rows: DisplayRow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Bulk-selection state; pass null to hide checkboxes. */
  checkedKeys: Set<string> | null;
  onToggleChecked: (key: string) => void;
}

export function RunList({ rows, selectedKey, onSelect, checkedKeys, onToggleChecked }: RunListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the selected row visible when selection moves via keyboard
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]');
    if (el instanceof HTMLElement && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedKey]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const index = rows.findIndex((r) => r.key === selectedKey);
    const nextIndex =
      e.key === 'ArrowDown' ? Math.min(index + 1, rows.length - 1) : Math.max(index - 1, 0);
    if (rows[nextIndex]) onSelect(rows[nextIndex].key);
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Execution runs"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="max-h-[70vh] overflow-y-auto outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rounded-lg"
    >
      {rows.map((row) => {
        const selected = row.key === selectedKey;
        const name = row.type === 'bundle' ? row.bundle_name : row.execution.test_name;
        const hostname = row.type === 'bundle' ? row.hostname : row.execution.hostname;
        const timestamp = row.type === 'bundle' ? row.timestamp : row.execution.timestamp;

        return (
          <div
            key={row.key}
            role="option"
            aria-selected={selected}
            data-selected={selected || undefined}
            onClick={() => onSelect(row.key)}
            className={cn(
              'cursor-pointer border-b border-border px-3 py-2.5 transition-colors last:border-b-0',
              selected ? 'border-l-2 border-l-accent bg-raised' : 'border-l-2 border-l-transparent hover:bg-raised/60',
            )}
          >
            <div className="flex items-center gap-2">
              {checkedKeys && (
                <Checkbox
                  checked={checkedKeys.has(row.key)}
                  onCheckedChange={() => onToggleChecked(row.key)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${name}`}
                />
              )}
              {row.type === 'bundle' && <Package className="h-3.5 w-3.5 shrink-0 text-info" />}
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{name}</span>
              {row.type === 'bundle' && (
                <Badge variant="default" className="hidden shrink-0 md:inline-flex">
                  {row.totalCount} {row.category === 'cyber-hygiene' ? 'controls' : 'stages'}
                </Badge>
              )}
              <span className="shrink-0 whitespace-nowrap text-[11px] text-faint">
                {formatTimestamp(timestamp)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 pl-0">
              <span className="flex min-w-0 items-center gap-2">
                {row.type === 'bundle' ? (
                  <BundleResultLabel group={row} compact />
                ) : (
                  <ExecResultLabel exec={row.execution} compact />
                )}
                {row.type === 'bundle' && (
                  <Badge variant="default" className="shrink-0 md:hidden">
                    {row.totalCount} {row.category === 'cyber-hygiene' ? 'controls' : 'stages'}
                  </Badge>
                )}
              </span>
              <span className="truncate font-mono text-[11px] text-faint" title={hostname}>
                {hostname}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
