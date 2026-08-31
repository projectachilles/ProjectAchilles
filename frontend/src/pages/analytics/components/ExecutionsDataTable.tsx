import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
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
  ShieldAlert,
} from 'lucide-react';
import type {
  EnrichedTestExecution,
  GroupedPaginatedResponse,
  RiskAcceptance,
} from '@/services/api/analytics';
import { findAcceptanceForExec } from '../utils/riskAcceptanceLookup';
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
import { browserApi } from '@/services/api/browser';
import { defenderApi, type RelatedAlertsResponse } from '@/services/api/defender';
import { useDefenderConfig } from '@/hooks/useDefenderConfig';
import TestInfoModal from './TestInfoModal';
import {
  EXPORT_COLUMNS,
  SORT_FIELDS,
  getCellValue,
  mapGroupsToDisplayRows,
} from './executions/shared';
import { RunList } from './executions/RunList';
import {
  RunDetailPanel,
  type AcceptRiskItem,
  type InfoModalRequest,
} from './executions/RunDetailPanel';

interface ExecutionsDataTableProps {
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
}: ExecutionsDataTableProps) {
  const { configured: defenderConfigured } = useDefenderConfig();

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
  const [expandedControlIndex, setExpandedControlIndex] = useState<number | null>(null);

  // Bulk selection state
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Dialog state
  const [confirmArchiveKeys, setConfirmArchiveKeys] = useState<string[] | null>(null);
  const [showDatePurge, setShowDatePurge] = useState(false);
  const [purgeDate, setPurgeDate] = useState('');

  // Description cache: cacheKey → { description, hasInfoCard, hasReadme }
  interface DescriptionData { description: string | null; hasInfoCard: boolean; hasReadme: boolean }
  const descriptionCache = useRef<Map<string, DescriptionData | null>>(new Map());
  const [descriptionLoading, setDescriptionLoading] = useState<string | null>(null);
  const [descriptionMap, setDescriptionMap] = useState<Map<string, DescriptionData | null>>(new Map());

  // Info modal state
  const [infoModal, setInfoModal] = useState<(InfoModalRequest & { open: boolean }) | null>(null);

  const fetchDescription = useCallback(async (exec: EnrichedTestExecution) => {
    const isBundleCtrl = exec.is_bundle_control && exec.bundle_id;
    const cacheKey = isBundleCtrl
      ? `${exec.bundle_id}::${exec.control_validator ?? ''}`
      : exec.test_uuid;

    if (descriptionCache.current.has(cacheKey)) {
      return;
    }

    setDescriptionLoading(cacheKey);
    try {
      const uuid = isBundleCtrl ? exec.bundle_id! : exec.test_uuid;
      const validator = isBundleCtrl ? exec.control_validator : undefined;
      const result = await browserApi.getTestDescription(uuid, validator);
      descriptionCache.current.set(cacheKey, result);
      setDescriptionMap(prev => new Map(prev).set(cacheKey, result));
    } catch {
      descriptionCache.current.set(cacheKey, null);
      setDescriptionMap(prev => new Map(prev).set(cacheKey, null));
    } finally {
      setDescriptionLoading(null);
    }
  }, []);

  // Related Defender alerts cache (mirrors descriptionCache pattern).
  // Keyed PER STAGE so each stage queries with its own timestamp + techniques.
  // alertsLoading is a Set to track concurrent in-flight fetches across stages.
  const alertsCache = useRef<Map<string, RelatedAlertsResponse | null>>(new Map());
  const [alertsLoading, setAlertsLoading] = useState<Set<string>>(new Set());
  const [alertsMap, setAlertsMap] = useState<Map<string, RelatedAlertsResponse | null>>(new Map());

  // Per-stage cache key. Each stage queries with its own routing.event_time +
  // techniques; the bundle-level callout aggregates `attribution === 'bundle'`
  // alerts across every stage cache and dedupes by alert_id.
  const stageAlertsCacheKey = useCallback(
    (exec: EnrichedTestExecution) => `${exec.test_uuid}::${exec.hostname}::stage-alerts`,
    [],
  );

  const fetchRelatedAlerts = useCallback(async (exec: EnrichedTestExecution) => {
    if (!defenderConfigured) return;
    const techniques = exec.techniques;
    if (!techniques || techniques.length === 0) return;

    const cacheKey = stageAlertsCacheKey(exec);
    if (alertsCache.current.has(cacheKey)) return;

    // Derive binary name: for bundle controls use the base UUID (before ::),
    // for standalone tests use the test_uuid directly. Binary is <uuid>.exe.
    const baseUuid = exec.test_uuid.includes('::')
      ? exec.test_uuid.split('::')[0]
      : exec.test_uuid;
    const binaryName = `${baseUuid}.exe`;

    setAlertsLoading(prev => {
      const next = new Set(prev);
      next.add(cacheKey);
      return next;
    });
    try {
      const result = await defenderApi.getAlertsForTest(
        techniques, exec.timestamp, 30, exec.hostname, binaryName, exec.bundle_name,
      );
      alertsCache.current.set(cacheKey, result);
      setAlertsMap(prev => new Map(prev).set(cacheKey, result));
    } catch {
      alertsCache.current.set(cacheKey, null);
      setAlertsMap(prev => new Map(prev).set(cacheKey, null));
    } finally {
      setAlertsLoading(prev => {
        const next = new Set(prev);
        next.delete(cacheKey);
        return next;
      });
    }
  }, [defenderConfigured, stageAlertsCacheKey]);

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
      if (!row) return;
      if (row.type === 'standalone') {
        void fetchDescription(row.execution);
        void fetchRelatedAlerts(row.execution);
      } else {
        for (const ctrl of row.controls) void fetchRelatedAlerts(ctrl);
      }
    },
    [displayRows, fetchDescription, fetchRelatedAlerts],
  );

  const handleSelect = useCallback(
    (key: string) => {
      setSelectedKey(key);
      setExpandedControlIndex(null);
      primeRow(key);
    },
    [setSelectedKey, primeRow],
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

  const handleToggleControl = useCallback(
    (index: number, ctrl: EnrichedTestExecution) => {
      setExpandedControlIndex((prev) => {
        if (prev === index) return null;
        void fetchDescription(ctrl);
        void fetchRelatedAlerts(ctrl);
        return index;
      });
    },
    [fetchDescription, fetchRelatedAlerts],
  );

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

  const handleArchiveConfirm = async () => {
    if (!confirmArchiveKeys || !onArchive) return;
    await onArchive(confirmArchiveKeys);
    setConfirmArchiveKeys(null);
    setSelectedKeys(new Set());
  };

  const handleDatePurgeConfirm = async () => {
    if (!purgeDate || !onArchiveByDate) return;
    await onArchiveByDate(purgeDate);
    setShowDatePurge(false);
    setPurgeDate('');
  };

  // ── Risk Acceptance state ────────────────────────────────────────
  const [riskAcceptItems, setRiskAcceptItems] = useState<AcceptRiskItem[] | null>(null);
  const [riskJustification, setRiskJustification] = useState('');
  const [riskScope, setRiskScope] = useState<'host' | 'global'>('global');
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; testName: string } | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const riskEnabled = !!onAcceptRisk;

  /** Look up active risk acceptance for a given execution. */
  const getAcceptanceForExec = useCallback(
    (exec: EnrichedTestExecution): RiskAcceptance | undefined =>
      findAcceptanceForExec(exec, riskAcceptances ?? null),
    [riskAcceptances],
  );

  const handleAcceptRiskConfirm = async () => {
    if (!riskAcceptItems || !onAcceptRisk || riskJustification.trim().length < 10) return;
    // When scope is 'global', drop hostname so the persisted record is unambiguously
    // org-wide. Storing both fields confused readers that didn't honor `scope`.
    const itemsWithScope = riskAcceptItems.map(item => ({
      ...item,
      scope: riskScope,
      hostname: riskScope === 'host' ? item.hostname : undefined,
    }));
    await onAcceptRisk(itemsWithScope, riskJustification.trim());
    setRiskAcceptItems(null);
    setRiskJustification('');
    setRiskScope('global');
  };

  const handleRevokeConfirm = async () => {
    if (!revokeTarget || !onRevokeRisk || revokeReason.trim().length < 10) return;
    await onRevokeRisk(revokeTarget.id, revokeReason.trim());
    setRevokeTarget(null);
    setRevokeReason('');
  };

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
    if (items.length > 0) setRiskAcceptItems(items);
  };

  // ── Export ───────────────────────────────────────────────────────
  const exportToCsv = () => {
    if (!allExecutions.length) return;
    const headers = EXPORT_COLUMNS.map(c => c.label);
    const rows = allExecutions.map(exec => {
      return EXPORT_COLUMNS.map(col => {
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

  const exportToJson = () => {
    if (!allExecutions.length) return;
    const json = JSON.stringify(allExecutions, null, 2);
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
            <div className="invisible absolute right-0 z-50 mt-1 w-32 overflow-hidden rounded-md border border-border bg-overlay opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100">
              <button
                onClick={exportToCsv}
                className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-raised hover:text-accent"
              >
                Export CSV
              </button>
              <button
                onClick={exportToJson}
                className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-raised hover:text-accent"
              >
                Export JSON
              </button>
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
              onClick={() => setConfirmArchiveKeys([...selectedKeys])}
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
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Card className="overflow-hidden">
            <RunList
              rows={displayRows}
              selectedKey={selectedKey}
              onSelect={handleSelect}
              checkedKeys={actionsEnabled ? selectedKeys : null}
              onToggleChecked={toggleSelect}
            />
          </Card>
          <RunDetailPanel
            row={selectedRow}
            defenderConfigured={defenderConfigured}
            descriptionMap={descriptionMap}
            descriptionLoadingKey={descriptionLoading}
            alertsMap={alertsMap}
            alertsLoading={alertsLoading}
            stageAlertsCacheKey={stageAlertsCacheKey}
            getAcceptanceForExec={getAcceptanceForExec}
            riskEnabled={riskEnabled}
            archiveEnabled={archiveEnabled}
            onRequestAcceptRisk={setRiskAcceptItems}
            onRequestRevoke={setRevokeTarget}
            onRequestArchive={setConfirmArchiveKeys}
            onOpenInfo={(request) => setInfoModal({ ...request, open: true })}
            expandedControlIndex={expandedControlIndex}
            onToggleControl={handleToggleControl}
          />
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

      {/* Confirmation Dialog (individual + bulk archive) */}
      {confirmArchiveKeys && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70" onClick={() => !archiving && setConfirmArchiveKeys(null)}>
          <div className="mx-4 w-full max-w-md rounded-[10px] border border-border-strong bg-surface p-6 shadow-[0_24px_60px_rgba(0,0,0,0.55)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold tracking-tight">Archive Executions</h3>
              <button onClick={() => !archiving && setConfirmArchiveKeys(null)} className="text-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-6 text-sm text-muted">
              This will move <span className="font-medium text-foreground">{confirmArchiveKeys.length}</span> execution group{confirmArchiveKeys.length !== 1 ? 's' : ''} to the archive. This is reversible.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setConfirmArchiveKeys(null)} disabled={archiving}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleArchiveConfirm} disabled={archiving}>
                {archiving && <Loader2 className="animate-spin" />}
                Archive
              </Button>
            </div>
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

      {/* Risk Acceptance Dialog */}
      {riskAcceptItems && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70" onClick={() => !acceptingRisk && setRiskAcceptItems(null)}>
          <div className="mx-4 w-full max-w-md rounded-[10px] border border-border-strong bg-surface p-6 shadow-[0_24px_60px_rgba(0,0,0,0.55)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                <ShieldOff className="h-5 w-5 text-warning" />
                Accept Risk
              </h3>
              <button onClick={() => !acceptingRisk && setRiskAcceptItems(null)} className="text-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 text-sm text-muted">
              Accepting risk for <span className="font-medium text-foreground">{riskAcceptItems.length}</span> control{riskAcceptItems.length !== 1 ? 's' : ''}.
              Accepted controls will be excluded from the Defense Score.
            </p>
            <div className="mb-4 max-h-32 overflow-y-auto rounded-md border border-border bg-raised p-2 font-mono text-xs">
              {riskAcceptItems.slice(0, 10).map((item, i) => (
                <div key={i} className="truncate text-muted">
                  {item.test_name}{item.control_id ? `::${item.control_id}` : ''}
                </div>
              ))}
              {riskAcceptItems.length > 10 && (
                <div className="text-muted">...and {riskAcceptItems.length - 10} more</div>
              )}
            </div>
            <div className="mb-4">
              <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-faint">Scope</label>
              <div className="flex overflow-hidden rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => setRiskScope('global')}
                  className={`flex-1 px-3 py-1.5 text-sm transition-colors ${riskScope === 'global' ? 'bg-warning-dim text-warning' : 'bg-transparent text-muted hover:bg-raised'}`}
                >
                  All Hosts
                </button>
                <button
                  type="button"
                  onClick={() => setRiskScope('host')}
                  className={`flex-1 border-l border-border px-3 py-1.5 text-sm transition-colors ${riskScope === 'host' ? 'bg-warning-dim text-warning' : 'bg-transparent text-muted hover:bg-raised'}`}
                >
                  This Host Only
                </button>
              </div>
              <p className="mt-1 text-xs text-faint">
                {riskScope === 'global'
                  ? 'Excluded from Defense Score across all hosts in the organization.'
                  : 'Excluded from Defense Score only for the specific host(s) where it was observed.'}
              </p>
            </div>
            <div className="mb-4">
              <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-faint">
                Justification <span className="text-danger">*</span>
              </label>
              <textarea
                value={riskJustification}
                onChange={(e) => setRiskJustification(e.target.value)}
                placeholder="Describe why this risk is being accepted (min 10 characters)..."
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-raised px-3 py-2 text-sm placeholder:text-faint outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              />
              {riskJustification.length > 0 && riskJustification.trim().length < 10 && (
                <p className="mt-1 text-xs text-danger">Minimum 10 characters required</p>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => { setRiskAcceptItems(null); setRiskJustification(''); }} disabled={acceptingRisk}>
                Cancel
              </Button>
              <Button
                variant="outline"
                className="border-warning/40 text-warning hover:bg-warning-dim"
                onClick={handleAcceptRiskConfirm}
                disabled={acceptingRisk || riskJustification.trim().length < 10}
              >
                {acceptingRisk && <Loader2 className="animate-spin" />}
                Accept Risk
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Risk Acceptance Dialog */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70" onClick={() => !acceptingRisk && setRevokeTarget(null)}>
          <div className="mx-4 w-full max-w-md rounded-[10px] border border-border-strong bg-surface p-6 shadow-[0_24px_60px_rgba(0,0,0,0.55)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                <ShieldAlert className="h-5 w-5 text-warning" />
                Revoke Risk Acceptance
              </h3>
              <button onClick={() => !acceptingRisk && setRevokeTarget(null)} className="text-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 text-sm text-muted">
              Revoking acceptance for <span className="font-medium text-foreground">{revokeTarget.testName}</span>.
              This control will be included in the Defense Score again.
            </p>
            <div className="mb-4">
              <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-faint">
                Reason <span className="text-danger">*</span>
              </label>
              <textarea
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Describe why this acceptance is being revoked (min 10 characters)..."
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-raised px-3 py-2 text-sm placeholder:text-faint outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              />
              {revokeReason.length > 0 && revokeReason.trim().length < 10 && (
                <p className="mt-1 text-xs text-danger">Minimum 10 characters required</p>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => { setRevokeTarget(null); setRevokeReason(''); }} disabled={acceptingRisk}>
                Cancel
              </Button>
              <Button
                variant="outline"
                className="border-warning/40 text-warning hover:bg-warning-dim"
                onClick={handleRevokeConfirm}
                disabled={acceptingRisk || revokeReason.trim().length < 10}
              >
                {acceptingRisk && <Loader2 className="animate-spin" />}
                Revoke Acceptance
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Test Info Modal */}
      {infoModal && (
        <TestInfoModal
          open={infoModal.open}
          onClose={() => setInfoModal(null)}
          testUuid={infoModal.testUuid}
          testName={infoModal.testName}
          hasInfoCard={infoModal.hasInfoCard}
          hasReadme={infoModal.hasReadme}
          scrollToValidator={infoModal.scrollToValidator}
        />
      )}
    </div>
  );
}
