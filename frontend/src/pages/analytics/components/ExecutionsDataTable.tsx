import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Loader2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Archive,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  Calendar,
  X,
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
  exportColumns,
  SORT_FIELDS,
  getCellValue,
  mapGroupsToDisplayRows,
} from './executions/shared';
import { RunList } from './executions/RunList';
import { RunDetailPanel, type AcceptRiskItem } from './executions/RunDetailPanel';
import { useRunDetail } from './executions/useRunDetail';
import { useRunDetailDialogs } from './executions/RunDetailDialogs';

export interface ExecutionsDataTableProps {
  data: GroupedPaginatedResponse | null;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSort: (field: string, order: 'asc' | 'desc') => void;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  onArchive?: (groupKeys: string[]) => Promise<void>;
  onArchiveByDate?: (before: string) => Promise<void>;
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

  // Dialog state
  const [showDatePurge, setShowDatePurge] = useState(false);
  const [purgeDate, setPurgeDate] = useState('');

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


  const handleDatePurgeConfirm = async () => {
    if (!purgeDate || !onArchiveByDate) return;
    await onArchiveByDate(purgeDate);
    setShowDatePurge(false);
    setPurgeDate('');
  };

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

  // ── Export ───────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  /** The rows to export: every match when the page can fetch them, else this page. */
  const rowsForExport = async (): Promise<EnrichedTestExecution[] | null> => {
    if (!onFetchAllExecutions) return allExecutions;
    setExporting(true);
    setExportNote(null);
    try {
      const { executions, total } = await onFetchAllExecutions();
      if (executions.length < total) {
        setExportNote(`Exported the newest ${executions.length.toLocaleString()} of ${total.toLocaleString()} results.`);
      }
      return executions;
    } catch (err) {
      console.error('Failed to fetch executions for export:', err);
      setExportNote('Export failed: could not load the results.');
      return null;
    } finally {
      setExporting(false);
    }
  };

  const exportToCsv = async () => {
    const executions = await rowsForExport();
    if (!executions?.length) return;
    const columns = exportColumns(showVersions);
    const headers = columns.map(c => c.label);
    const rows = executions.map(exec => {
      return columns.map(col => {
        const value = getCellValue(exec, col.key);
        const strValue = String(value ?? '');
        if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
          return `"${strValue.replace(/"/g, '""')}"`;
        }
        return strValue;
      });
    });
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadFile(csv, 'executions.csv', 'text/csv');
  };

  const exportToJson = async () => {
    const executions = await rowsForExport();
    if (!executions?.length) return;
    const json = JSON.stringify(executions, null, 2);
    downloadFile(json, 'executions.json', 'application/json');
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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
          {exportNote && <span className="text-[12px] text-warning" role="status">{exportNote}</span>}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
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
          {onArchiveByDate && (
            <Button variant="secondary" size="sm" onClick={() => setShowDatePurge(true)}>
              <Calendar />
              Archive by date
            </Button>
          )}
          <div className="relative group">
            <Button variant="secondary" size="sm">
              <Download />
              Export
              <ChevronDown className="!size-3" />
            </Button>
            <div className="invisible absolute right-0 z-50 mt-1 w-32 overflow-hidden rounded-md border border-border bg-overlay opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
              <button
                onClick={() => { void exportToCsv(); }}
                disabled={exporting}
                className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-raised hover:text-accent disabled:opacity-50"
              >
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
              <button
                onClick={() => { void exportToJson(); }}
                disabled={exporting}
                className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-raised hover:text-accent disabled:opacity-50"
              >
                {exporting ? 'Exporting…' : 'Export JSON'}
              </button>
              {reportHref && (
                <a
                  href={reportHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-raised hover:text-accent"
                >
                  Report (PDF)
                </a>
              )}
              {onExportSbReport && (
                <button
                  onClick={() => { void onExportSbReport(); }}
                  disabled={sbReportExporting}
                  className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-raised hover:text-accent disabled:opacity-50"
                >
                  {sbReportExporting ? 'Exporting SB Export…' : 'SB Export'}
                </button>
              )}
            </div>
          </div>
        </div>
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


      {/* Date Purge Dialog */}
      {showDatePurge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70" onClick={() => !archiving && setShowDatePurge(false)}>
          <div className="mx-4 w-full max-w-md rounded-[10px] border border-border-strong bg-surface p-6 shadow-[0_24px_60px_rgba(0,0,0,0.55)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold tracking-tight">Archive by Date</h3>
              <button onClick={() => !archiving && setShowDatePurge(false)} className="text-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-6">
              <label className="mb-2 block text-[11px] uppercase tracking-wider text-faint">
                Archive all executions before:
              </label>
              <input
                type="date"
                value={purgeDate}
                onChange={(e) => setPurgeDate(e.target.value)}
                className="w-full rounded-md border border-border bg-raised px-3 py-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => { setShowDatePurge(false); setPurgeDate(''); }} disabled={archiving}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDatePurgeConfirm} disabled={!purgeDate || archiving}>
                {archiving && <Loader2 className="animate-spin" />}
                Archive
              </Button>
            </div>
          </div>
        </div>
      )}


      {dialogs.dialogs}
    </div>
  );
}
