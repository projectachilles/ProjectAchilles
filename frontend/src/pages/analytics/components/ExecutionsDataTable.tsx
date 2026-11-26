import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Archive,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  ShieldOff,
} from 'lucide-react';
import type {
  EnrichedTestExecution,
  GroupedPaginatedResponse,
  RiskAcceptance,
} from '@/services/api/analytics';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCapabilities } from '@/hooks/useCapabilities';
import {
  SORT_FIELDS,
  mapGroupsToDisplayRows,
} from './executions/shared';
import { RunList } from './executions/RunList';
import { RunDetailPanel, type AcceptRiskItem } from './executions/RunDetailPanel';
import { useRunDetail } from './executions/useRunDetail';
import { useExecutionsExport } from './executions/useExecutionsExport';
import { ExecutionsToolbar } from './ExecutionsToolbar';
import { useRunDetailDialogs } from './executions/RunDetailDialogs';

export interface ExecutionsDataTableProps {
  data: GroupedPaginatedResponse | null;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSort: (field: string, order: 'asc' | 'desc') => void;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  /** Resolves to `false` when the archive did not go through. */
  onArchive?: (groupKeys: string[]) => Promise<boolean | void>;
  /** Resolves to `false` when the archive did not go through. */
  onArchiveByDate?: (before: string) => Promise<boolean | void>;
  archiving?: boolean;
  onAcceptRisk?: (items: AcceptRiskItem[], justification: string) => Promise<void>;
  onRevokeRisk?: (acceptanceId: string, reason: string) => Promise<void>;
  riskAcceptances?: Map<string, RiskAcceptance[]>;
  acceptingRisk?: boolean;
  /** Master-detail selection, controllable for ?expanded= deep links. */
  selectedKey?: string | null;
  onSelectedKeyChange?: (key: string | null) => void;
  /** SB-format compliance report export (server-generated for the current window). */
  onExportSbReport?: () => Promise<void>;
  sbReportExporting?: boolean;
  /** Link to the print-ready execution report for the current filters. */
  reportHref?: string;
  /**
   * Every result matching the current filters, for CSV/JSON export (capped by
   * the caller). Without it, the export holds the current page only.
   */
  onFetchAllExecutions?: () => Promise<{ executions: EnrichedTestExecution[]; total: number }>;
}

export default function ExecutionsDataTable({
  data,
  loading,
  onPageChange,
  onPageSizeChange,
  onSort,
  sortField,
  sortOrder = 'desc',
  onArchive,
  onArchiveByDate,
  archiving,
  onAcceptRisk,
  onRevokeRisk,
  riskAcceptances,
  acceptingRisk,
  selectedKey: selectedKeyProp,
  onSelectedKeyChange,
  onExportSbReport,
  sbReportExporting,
  reportHref,
  onFetchAllExecutions,
}: ExecutionsDataTableProps) {
  const { testVersions: showVersions } = useCapabilities();

  // Master-detail selection (controlled when the parent passes props)
  const [internalSelectedKey, setInternalSelectedKey] = useState<string | null>(null);
  const selectedKey = selectedKeyProp !== undefined ? selectedKeyProp : internalSelectedKey;
  const setSelectedKey = useCallback(
    (key: string | null) => {
      setInternalSelectedKey(key);
      onSelectedKeyChange?.(key);
    },
    [onSelectedKeyChange],
  );

  // Bulk selection state
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // What the detail panel shows beyond the row, and the dialogs it opens:
  // shared with the coverage matrix's drawer.
  const detail = useRunDetail();
  const { prime, collapseControls } = detail;
  const dialogs = useRunDetailDialogs({
    riskAcceptances,
    onAcceptRisk,
    onRevokeRisk,
    onArchive,
    acceptingRisk,
    archiving,
    onArchived: () => setSelectedKeys(new Set()),
  });


  const groups = data?.groups || [];
  const pagination = data?.pagination;

  // Clear bulk selection when data changes (page, sort, filter)
  useEffect(() => {
    setSelectedKeys(new Set());
  }, [data]);

  // Flatten all group members for export
  const allExecutions = useMemo(() => groups.flatMap(g => g.members), [groups]);

  // Map server-provided groups to DisplayRows for rendering
  const displayRows = useMemo(() => mapGroupsToDisplayRows(groups), [groups]);
  const allGroupKeys = useMemo(() => displayRows.map(r => r.key), [displayRows]);

  const selectedRow = useMemo(
    () => displayRows.find((r) => r.key === selectedKey) ?? null,
    [displayRows, selectedKey],
  );

  // Trigger fetches for a row's detail data
  const primeRow = useCallback(
    (key: string) => {
      const row = displayRows.find((r) => r.key === key);
      if (row) prime(row);
    },
    [displayRows, prime],
  );

  const handleSelect = useCallback(
    (key: string) => {
      setSelectedKey(key);
      collapseControls();
      primeRow(key);
    },
    [setSelectedKey, collapseControls, primeRow],
  );

  // Auto-select: honor a deep-linked key when it exists on this page,
  // otherwise fall back to the first row so the panel is never empty.
  useEffect(() => {
    if (displayRows.length === 0) return;
    if (selectedKey && displayRows.some((r) => r.key === selectedKey)) {
      primeRow(selectedKey);
      return;
    }
    setInternalSelectedKey(displayRows[0].key);
    onSelectedKeyChange?.(displayRows[0].key);
    primeRow(displayRows[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayRows]);


  // Bulk selection helpers
  const toggleSelect = (key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedKeys.size === allGroupKeys.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(allGroupKeys));
    }
  };

  const isAllSelected = allGroupKeys.length > 0 && selectedKeys.size === allGroupKeys.length;

  const archiveEnabled = !!onArchive;



  const riskEnabled = !!onAcceptRisk;

  // Bulk risk accept: collect items from checked groups
  const handleBulkAcceptRisk = () => {
    const items: AcceptRiskItem[] = [];
    for (const key of selectedKeys) {
      const row = displayRows.find(r => r.key === key);
      if (!row) continue;
      if (row.type === 'standalone') {
        items.push({ test_name: row.execution.test_name, hostname: row.execution.hostname });
      } else {
        for (const ctrl of row.controls) {
          items.push({ test_name: ctrl.test_name, control_id: ctrl.control_id, hostname: ctrl.hostname });
        }
      }
    }
    if (items.length > 0) dialogs.requestAcceptRisk(items);
  };

  // Export and "Archive by date" are the toolbar's (shared with the matrix view).
  const exportState = useExecutionsExport({ pageExecutions: allExecutions, onFetchAllExecutions, showVersions });


  if (loading && !data) {
    return (
      <Card className="min-h-[400px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted" />
      </Card>
    );
  }

  const actionsEnabled = archiveEnabled || riskEnabled;

  return (
    <div>
      {/* Section header + toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          {actionsEnabled && (
            <Checkbox
              checked={isAllSelected}
              onCheckedChange={toggleSelectAll}
              aria-label="Select all on this page"
            />
          )}
          <span className="text-[13px] text-muted">
            {pagination ? (
              <>
                Showing {((pagination.page - 1) * pagination.pageSize) + 1}–
                {Math.min(pagination.page * pagination.pageSize, pagination.totalGroups)} of{' '}
                {pagination.totalGroups.toLocaleString()} groups
                {' '}({pagination.totalDocuments.toLocaleString()} documents)
              </>
            ) : (
              'Loading…'
            )}
          </span>
        </div>

        <ExecutionsToolbar
          exportState={exportState}
          reportHref={reportHref}
          onExportSbReport={onExportSbReport}
          sbReportExporting={sbReportExporting}
          onArchiveByDate={onArchiveByDate}
          archiving={archiving}
        >
        <Select
          value={sortField ?? 'routing.event_time'}
          onValueChange={(field) => onSort(field, sortOrder)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_FIELDS.map((f) => (
              <SelectItem key={f.field} value={f.field}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onSort(sortField ?? 'routing.event_time', sortOrder === 'desc' ? 'asc' : 'desc')}
          title={sortOrder === 'desc' ? 'Descending' : 'Ascending'}
        >
          {sortOrder === 'desc' ? <ArrowDownNarrowWide /> : <ArrowUpNarrowWide />}
        </Button>
        </ExecutionsToolbar>
      </div>

      {/* Bulk actions bar */}
      {actionsEnabled && selectedKeys.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-md border border-accent/25 bg-accent-dim px-3 py-2">
          <span className="text-sm font-medium text-accent">{selectedKeys.size} selected</span>
          {riskEnabled && (
            <Button
              variant="outline"
              size="sm"
              disabled={acceptingRisk}
              onClick={handleBulkAcceptRisk}
              className="border-warning/40 text-warning hover:bg-warning-dim"
            >
              {acceptingRisk ? <Loader2 className="animate-spin" /> : <ShieldOff />}
              Accept risk
            </Button>
          )}
          {archiveEnabled && (
            <Button
              variant="outline"
              size="sm"
              disabled={archiving}
              onClick={() => dialogs.requestArchive([...selectedKeys])}
              className="border-danger/40 text-danger hover:bg-danger-dim"
            >
              {archiving ? <Loader2 className="animate-spin" /> : <Archive />}
              Archive selected
            </Button>
          )}
        </div>
      )}

      {/* Master-detail */}
      {groups.length === 0 ? (
        <Card className="flex h-40 items-center justify-center text-sm text-faint">
          No executions found
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:min-h-[30rem] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-stretch">
          {/* minmax(0,1fr) below lg: the lone implicit `auto` column would otherwise
              grow to the detail panel's min-content (the attack-chain strip's full
              width) and push the page wider than the screen.
              From lg up the detail sets the row height (it shows every stage) and the
              list matches it: the run list is absolutely positioned inside its card, so
              it never adds to the row height, and scrolls within whatever height it gets. */}
          <Card className="relative overflow-hidden">
            <RunList
              rows={displayRows}
              selectedKey={selectedKey}
              onSelect={handleSelect}
              checkedKeys={actionsEnabled ? selectedKeys : null}
              onToggleChecked={toggleSelect}
              showVersions={showVersions}
            />
          </Card>
          <RunDetailPanel row={selectedRow} {...detail.panelProps} {...dialogs.panelProps} />
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 0 && (
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Rows per page:</span>
            <Select
              value={String(pagination.pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => onPageChange(1)} disabled={!pagination.hasPrevious}>
              <ChevronsLeft />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => onPageChange(pagination.page - 1)} disabled={!pagination.hasPrevious}>
              <ChevronLeft />
            </Button>
            <span className="px-3 text-sm">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <Button variant="ghost" size="icon-sm" onClick={() => onPageChange(pagination.page + 1)} disabled={!pagination.hasNext}>
              <ChevronRight />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => onPageChange(pagination.totalPages)} disabled={!pagination.hasNext}>
              <ChevronsRight />
            </Button>
          </div>
        </div>
      )}




      {dialogs.dialogs}
    </div>
  );
}
