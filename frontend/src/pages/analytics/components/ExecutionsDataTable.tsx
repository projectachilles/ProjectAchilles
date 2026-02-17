import { useState, useMemo, Fragment } from 'react';
import {
  Loader2,
  ShieldCheck,
  ShieldX,
  ShieldQuestion,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Columns,
  Check,
  Filter,
  Package,
} from 'lucide-react';
import { formatDistanceToNow, isValid, format } from 'date-fns';
import type { EnrichedTestExecution, PaginatedResponse, SeverityLevel, CategoryType } from '@/services/api/analytics';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// Parse timestamp - handles both epoch ms strings and ISO strings
function parseTimestamp(timestamp: string): Date {
  if (/^\d+$/.test(timestamp)) {
    return new Date(parseInt(timestamp, 10));
  }
  return new Date(timestamp);
}

// Safe date formatting
function formatTimestamp(timestamp: string, relative = true): string {
  if (!timestamp) return 'Unknown';
  try {
    const date = parseTimestamp(timestamp);
    if (!isValid(date)) return 'Unknown';
    if (relative) {
      return formatDistanceToNow(date, { addSuffix: true });
    }
    return format(date, 'yyyy-MM-dd HH:mm:ss');
  } catch {
    return 'Unknown';
  }
}

// Severity badge variants
const SEVERITY_VARIANTS: Record<SeverityLevel, string> = {
  critical: 'bg-red-500/10 text-red-500 border-red-500/30',
  high: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
  low: 'bg-green-500/10 text-green-500 border-green-500/30',
  info: 'bg-gray-500/10 text-gray-500 border-gray-500/30',
};

// Error code → category mapping (mirrors backend ERROR_CODE_MAP)
const ERROR_CODE_CATEGORIES: Record<number, string> = {
  0:   'inconclusive',
  1:   'contextual',
  101: 'failed',
  105: 'protected',
  126: 'protected',
  127: 'protected',
  200: 'inconclusive',
  259: 'inconclusive',
  999: 'error',
};

const ERROR_CATEGORY_COLORS: Record<string, string> = {
  protected:    'text-green-600 dark:text-green-400',
  failed:       'text-red-600 dark:text-red-400',
  inconclusive: 'text-yellow-600 dark:text-yellow-400',
  contextual:   'text-yellow-600 dark:text-yellow-400',
  error:        'text-orange-600 dark:text-orange-400',
};

// Derive result from error code (three-state: protected/unprotected/inconclusive)
const PROTECTED_CODES = new Set([105, 126, 127]);
const UNPROTECTED_CODES = new Set([101]);

function getResultFromErrorCode(errorCode: number | undefined): 'protected' | 'unprotected' | 'inconclusive' {
  if (errorCode === undefined || errorCode === null) return 'inconclusive';
  if (UNPROTECTED_CODES.has(errorCode)) return 'unprotected';
  if (PROTECTED_CODES.has(errorCode)) return 'protected';
  return 'inconclusive';
}

// ── Bundle grouping types ─────────────────────────────────────────

interface BundleGroup {
  type: 'bundle';
  key: string;
  bundle_id: string;
  bundle_name: string;
  hostname: string;
  timestamp: string;
  controls: EnrichedTestExecution[];
  protectedCount: number;
  unprotectedCount: number;
  totalCount: number;
  category?: CategoryType;
}

interface StandaloneRow {
  type: 'standalone';
  key: string;
  execution: EnrichedTestExecution;
}

type DisplayRow = BundleGroup | StandaloneRow;

/** Group consecutive bundle controls by bundle_id + hostname. */
function groupExecutions(executions: EnrichedTestExecution[]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  const bundleMap = new Map<string, BundleGroup>();
  // Track insertion order so bundles appear at the position of their first control
  const insertionOrder: string[] = [];

  for (let i = 0; i < executions.length; i++) {
    const exec = executions[i];

    if (exec.is_bundle_control && exec.bundle_id) {
      const groupKey = `${exec.bundle_id}::${exec.hostname}`;

      if (!bundleMap.has(groupKey)) {
        const group: BundleGroup = {
          type: 'bundle',
          key: groupKey,
          bundle_id: exec.bundle_id,
          bundle_name: exec.bundle_name || 'Bundle',
          hostname: exec.hostname,
          timestamp: exec.timestamp,
          controls: [],
          protectedCount: 0,
          unprotectedCount: 0,
          totalCount: 0,
          category: exec.category,
        };
        bundleMap.set(groupKey, group);
        insertionOrder.push(groupKey);
        // Insert a placeholder — we'll fill it in the final pass
        rows.push(group);
      }

      const group = bundleMap.get(groupKey)!;
      group.controls.push(exec);
      group.totalCount++;
      const result = getResultFromErrorCode(exec.error_code);
      if (result === 'protected') group.protectedCount++;
      if (result === 'unprotected') group.unprotectedCount++;
    } else {
      rows.push({
        type: 'standalone',
        key: `standalone-${exec.test_uuid}-${exec.timestamp}-${i}`,
        execution: exec,
      });
    }
  }

  return rows;
}

// Column definitions
interface ColumnDef {
  key: string;
  label: string;
  sortable?: boolean;
  defaultVisible?: boolean;
  sortField?: string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'test_name', label: 'Test Name', sortable: true, defaultVisible: true, sortField: 'f0rtika.test_name' },
  { key: 'hostname', label: 'Hostname', sortable: true, defaultVisible: true, sortField: 'routing.hostname' },
  { key: 'result', label: 'Result', sortable: true, defaultVisible: true, sortField: 'f0rtika.is_protected' },
  { key: 'severity', label: 'Severity', sortable: true, defaultVisible: false, sortField: 'f0rtika.severity' },
  { key: 'category', label: 'Category', sortable: true, defaultVisible: true, sortField: 'f0rtika.category' },
  { key: 'subcategory', label: 'Subcategory', sortable: false, defaultVisible: false },
  { key: 'threat_actor', label: 'Threat Actor', sortable: true, defaultVisible: false, sortField: 'f0rtika.threat_actor' },
  { key: 'techniques', label: 'Techniques', sortable: false, defaultVisible: true },
  { key: 'tactics', label: 'Tactics', sortable: false, defaultVisible: false },
  { key: 'tags', label: 'Tags', sortable: false, defaultVisible: false },
  { key: 'complexity', label: 'Complexity', sortable: true, defaultVisible: false, sortField: 'f0rtika.complexity' },
  { key: 'target', label: 'Target', sortable: false, defaultVisible: false },
  { key: 'score', label: 'Score', sortable: true, defaultVisible: false, sortField: 'f0rtika.score' },
  { key: 'error', label: 'Result Code', sortable: false, defaultVisible: true },
  { key: 'org', label: 'Organization', sortable: false, defaultVisible: false },
  { key: 'timestamp', label: 'Time', sortable: true, defaultVisible: true, sortField: 'routing.event_time' },
];

interface ExecutionsDataTableProps {
  data: PaginatedResponse<EnrichedTestExecution> | null;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSort: (field: string, order: 'asc' | 'desc') => void;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  filtersExpanded?: boolean;
  onToggleFilters?: () => void;
  activeFilterCount?: number;
}

export default function ExecutionsDataTable({
  data,
  loading,
  onPageChange,
  onPageSizeChange,
  onSort,
  sortField,
  sortOrder = 'desc',
  filtersExpanded = false,
  onToggleFilters,
  activeFilterCount = 0,
}: ExecutionsDataTableProps) {
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key))
  );
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(new Set());
  const [expandedDetail, setExpandedDetail] = useState<string | null>(null);
  const [showColumnMenu, setShowColumnMenu] = useState(false);

  const executions = data?.data || [];
  const pagination = data?.pagination;

  // Group executions into bundle groups and standalone rows
  const displayRows = useMemo(() => groupExecutions(executions), [executions]);

  // Toggle column visibility
  const toggleColumn = (key: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Reset to default columns
  const resetColumns = () => {
    setVisibleColumns(new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key)));
  };

  // Handle sort click
  const handleSort = (column: ColumnDef) => {
    if (!column.sortable || !column.sortField) return;
    const newOrder = sortField === column.sortField && sortOrder === 'desc' ? 'asc' : 'desc';
    onSort(column.sortField, newOrder);
  };

  // Export to CSV
  const exportToCsv = () => {
    if (!executions.length) return;
    const visibleColumnsList = COLUMNS.filter(c => visibleColumns.has(c.key));
    const headers = visibleColumnsList.map(c => c.label);
    const rows = executions.map(exec => {
      return visibleColumnsList.map(col => {
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

  // Export to JSON
  const exportToJson = () => {
    if (!executions.length) return;
    const json = JSON.stringify(executions, null, 2);
    downloadFile(json, 'executions.json', 'application/json');
  };

  // Download file helper
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

  // Get cell value for a column
  const getCellValue = (exec: EnrichedTestExecution, key: string): string | number | undefined => {
    switch (key) {
      case 'test_name': return exec.test_name;
      case 'hostname': return exec.hostname;
      case 'result': {
        const r = getResultFromErrorCode(exec.error_code);
        return r === 'protected' ? 'Protected' : r === 'unprotected' ? 'Unprotected' : 'Inconclusive';
      }
      case 'severity': return exec.severity;
      case 'category': return exec.category;
      case 'subcategory': return exec.subcategory;
      case 'threat_actor': return exec.threat_actor;
      case 'techniques': return exec.tactics?.join(', ');
      case 'tactics': return exec.tactics?.join(', ');
      case 'tags': return exec.tags?.join(', ');
      case 'complexity': return exec.complexity;
      case 'target': return exec.target;
      case 'score': return exec.score;
      case 'error': {
        if (!exec.error_name && !exec.error_code) return '';
        if (exec.error_name && exec.error_code) return `${exec.error_name} (${exec.error_code})`;
        return exec.error_name || String(exec.error_code ?? '');
      }
      case 'org': return exec.org;
      case 'timestamp': return formatTimestamp(exec.timestamp);
      default: return '';
    }
  };

  // Render cell content
  const renderCell = (exec: EnrichedTestExecution, key: string, indent = false) => {
    switch (key) {
      case 'test_name':
        return (
          <span className={`font-medium text-foreground ${indent ? 'pl-6' : ''}`}>
            {indent && <span className="text-muted-foreground mr-1.5">&#x2514;</span>}
            {exec.test_name}
          </span>
        );

      case 'hostname':
        return (
          <span
            className="text-muted-foreground font-mono text-sm block max-w-[220px] truncate"
            title={exec.hostname}
          >
            {exec.hostname}
          </span>
        );

      case 'result': {
        const result = getResultFromErrorCode(exec.error_code);
        if (result === 'protected') {
          return (
            <span className="inline-flex items-center gap-1.5 text-green-600 dark:text-green-400">
              <ShieldCheck className="w-4 h-4" />
              <span className="text-sm font-medium">Protected</span>
            </span>
          );
        }
        if (result === 'unprotected') {
          return (
            <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
              <ShieldX className="w-4 h-4" />
              <span className="text-sm font-medium">Unprotected</span>
            </span>
          );
        }
        return (
          <span className="inline-flex items-center gap-1.5 text-yellow-600 dark:text-yellow-400">
            <ShieldQuestion className="w-4 h-4" />
            <span className="text-sm font-medium">Inconclusive</span>
          </span>
        );
      }

      case 'severity':
        if (!exec.severity) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge variant="outline" className={`uppercase text-xs ${SEVERITY_VARIANTS[exec.severity]}`}>
            {exec.severity}
          </Badge>
        );

      case 'category':
        if (!exec.category) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500 border-blue-500/30">
            {exec.category}
          </Badge>
        );

      case 'threat_actor':
        if (!exec.threat_actor) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-500 border-purple-500/30">
            {exec.threat_actor}
          </Badge>
        );

      case 'tags':
        if (!exec.tags?.length) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {exec.tags.slice(0, 3).map(tag => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {exec.tags.length > 3 && (
              <span className="text-xs text-muted-foreground">+{exec.tags.length - 3}</span>
            )}
          </div>
        );

      case 'complexity':
        if (!exec.complexity) return <span className="text-muted-foreground">—</span>;
        {
          const complexityColors: Record<string, string> = {
            low: 'text-green-500',
            medium: 'text-yellow-500',
            high: 'text-red-500',
          };
          return (
            <span className={`text-sm capitalize ${complexityColors[exec.complexity] || 'text-foreground'}`}>
              {exec.complexity}
            </span>
          );
        }

      case 'score':
        if (exec.score === undefined || exec.score === null) return <span className="text-muted-foreground">—</span>;
        return <span className="text-sm font-medium text-foreground">{exec.score.toFixed(1)}</span>;

      case 'org':
        return (
          <Badge variant="outline" className="text-xs bg-primary/10 text-primary">
            {exec.org}
          </Badge>
        );

      case 'error': {
        if (!exec.error_name && !exec.error_code) return <span className="text-muted-foreground">—</span>;
        const errorText = exec.error_name && exec.error_code
          ? `${exec.error_name} (${exec.error_code})`
          : exec.error_name || String(exec.error_code ?? '');
        const errorCategory = exec.error_code != null
          ? ERROR_CODE_CATEGORIES[exec.error_code]
          : undefined;
        const errorColor = errorCategory
          ? ERROR_CATEGORY_COLORS[errorCategory]
          : 'text-muted-foreground';
        return (
          <span className={`text-sm font-mono ${errorColor}`}>
            {errorText}
          </span>
        );
      }

      case 'timestamp':
        return <span className="text-sm text-muted-foreground">{formatTimestamp(exec.timestamp)}</span>;

      default: {
        const value = getCellValue(exec, key);
        return <span className="text-sm text-foreground">{value || '—'}</span>;
      }
    }
  };

  // Render a bundle parent row cell
  const renderBundleCell = (group: BundleGroup, key: string, isExpanded: boolean) => {
    switch (key) {
      case 'test_name':
        return (
          <span className="inline-flex items-center gap-2 font-medium text-foreground">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <Package className="w-4 h-4 text-blue-500 shrink-0" />
            <span>{group.bundle_name}</span>
            <Badge variant="secondary" className="text-xs ml-1">
              {group.totalCount} controls
            </Badge>
          </span>
        );

      case 'hostname':
        return (
          <span
            className="text-muted-foreground font-mono text-sm block max-w-[220px] truncate"
            title={group.hostname}
          >
            {group.hostname}
          </span>
        );

      case 'result': {
        const ratio = group.totalCount > 0 ? group.protectedCount / group.totalCount : 0;
        const color = ratio >= 0.8 ? 'text-green-600 dark:text-green-400'
          : ratio >= 0.5 ? 'text-yellow-600 dark:text-yellow-400'
          : 'text-red-600 dark:text-red-400';
        return (
          <span className={`inline-flex items-center gap-1.5 ${color}`}>
            <ShieldCheck className="w-4 h-4" />
            <span className="text-sm font-medium">
              {group.protectedCount}/{group.totalCount} Protected
            </span>
          </span>
        );
      }

      case 'category':
        if (!group.category) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500 border-blue-500/30">
            {group.category}
          </Badge>
        );

      case 'techniques': {
        // Collect unique techniques from all controls
        const allTechniques = new Set<string>();
        for (const ctrl of group.controls) {
          if (ctrl.tactics) ctrl.tactics.forEach(t => allTechniques.add(t));
        }
        if (allTechniques.size === 0) return <span className="text-muted-foreground">—</span>;
        const techniqueArr = [...allTechniques];
        return (
          <div className="flex flex-wrap gap-1">
            {techniqueArr.slice(0, 2).map(t => (
              <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
            ))}
            {techniqueArr.length > 2 && (
              <span className="text-xs text-muted-foreground">+{techniqueArr.length - 2}</span>
            )}
          </div>
        );
      }

      case 'error':
        return (
          <span className="text-sm text-muted-foreground font-mono">
            {group.protectedCount}P / {group.unprotectedCount}F
          </span>
        );

      case 'timestamp':
        return <span className="text-sm text-muted-foreground">{formatTimestamp(group.timestamp)}</span>;

      default:
        return <span className="text-muted-foreground">—</span>;
    }
  };

  // Render the detail panel for a single execution
  const renderDetailPanel = (exec: EnrichedTestExecution) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
      <div>
        <span className="text-muted-foreground">Test UUID:</span>
        <p className="font-mono text-xs mt-1 text-foreground">{exec.test_uuid}</p>
      </div>
      {exec.is_bundle_control && exec.bundle_name && (
        <div>
          <span className="text-muted-foreground">Bundle:</span>
          <p className="mt-1 text-foreground">{exec.bundle_name}</p>
        </div>
      )}
      {exec.is_bundle_control && exec.control_validator && (
        <div>
          <span className="text-muted-foreground">Validator:</span>
          <p className="mt-1 text-foreground">{exec.control_validator}</p>
        </div>
      )}
      {exec.tactics?.length ? (
        <div>
          <span className="text-muted-foreground">Tactics:</span>
          <p className="mt-1 text-foreground">{exec.tactics.join(', ')}</p>
        </div>
      ) : null}
      {exec.target && (
        <div>
          <span className="text-muted-foreground">Target:</span>
          <p className="mt-1 text-foreground">{exec.target}</p>
        </div>
      )}
      {exec.complexity && (
        <div>
          <span className="text-muted-foreground">Complexity:</span>
          <p className="mt-1 capitalize text-foreground">{exec.complexity}</p>
        </div>
      )}
      {exec.tags?.length ? (
        <div className="col-span-2">
          <span className="text-muted-foreground">Tags:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {exec.tags.map(tag => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
      {exec.score !== undefined && (
        <div>
          <span className="text-muted-foreground">Score:</span>
          <p className="mt-1 text-foreground">{exec.score}/10</p>
        </div>
      )}
      <div>
        <span className="text-muted-foreground">Full Timestamp:</span>
        <p className="mt-1 text-foreground">{formatTimestamp(exec.timestamp, false)}</p>
      </div>
    </div>
  );

  // Visible columns for rendering
  const visibleColumnsList = useMemo(
    () => COLUMNS.filter(c => visibleColumns.has(c.key)),
    [visibleColumns]
  );

  // Toggle bundle expand/collapse
  const toggleBundle = (key: string) => {
    setExpandedBundles(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        // Also close any detail panel for controls in this bundle
        setExpandedDetail(current => {
          if (current?.startsWith(key)) return null;
          return current;
        });
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Toggle detail panel for a specific row
  const toggleDetail = (key: string) => {
    setExpandedDetail(prev => prev === key ? null : key);
  };

  if (loading && !data) {
    return (
      <Card className="min-h-[400px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      {/* Table Header */}
      <CardHeader className="flex flex-row items-center justify-between py-3 border-b">
        <div className="text-sm text-muted-foreground">
          {pagination ? (
            <>
              Showing {((pagination.page - 1) * pagination.pageSize) + 1}–
              {Math.min(pagination.page * pagination.pageSize, pagination.totalItems)} of{' '}
              {pagination.totalItems.toLocaleString()} results
            </>
          ) : (
            'Loading...'
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Filters Toggle */}
          {onToggleFilters && (
            <button
              onClick={onToggleFilters}
              className={`
                flex items-center gap-1.5 px-3 py-1.5
                border rounded-lg text-sm transition-colors
                ${filtersExpanded || activeFilterCount > 0
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-secondary border-border text-foreground hover:bg-accent'
                }
              `}
            >
              <Filter className="w-4 h-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="px-1.5 py-0.5 bg-primary text-primary-foreground text-xs rounded-full">
                  {activeFilterCount}
                </span>
              )}
              {filtersExpanded ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          )}

          {/* Column Visibility Toggle */}
          <div className="relative">
            <button
              onClick={() => setShowColumnMenu(!showColumnMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-foreground border border-border rounded-lg text-sm hover:bg-accent transition-colors"
            >
              <Columns className="w-4 h-4" />
              Columns
            </button>

            {showColumnMenu && (
              <div className="absolute right-0 z-50 mt-1 w-56 bg-card text-card-foreground border border-border rounded-lg shadow-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-border flex justify-between items-center">
                  <span className="text-sm font-medium">Columns</span>
                  <button
                    onClick={resetColumns}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Reset
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto py-1">
                  {COLUMNS.map(col => (
                    <button
                      key={col.key}
                      onClick={() => toggleColumn(col.key)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
                    >
                      <div className={`
                        w-4 h-4 rounded border flex items-center justify-center
                        ${visibleColumns.has(col.key) ? 'bg-primary border-primary' : 'border-border'}
                      `}>
                        {visibleColumns.has(col.key) && <Check className="w-3 h-3 text-primary-foreground" />}
                      </div>
                      <span className="text-foreground">{col.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Export Dropdown */}
          <div className="relative group">
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-foreground border border-border rounded-lg text-sm hover:bg-accent transition-colors">
              <Download className="w-4 h-4" />
              Export
              <ChevronDown className="w-3 h-3" />
            </button>
            <div className="absolute right-0 z-50 mt-1 w-32 bg-card text-card-foreground border border-border rounded-lg shadow-lg overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
              <button
                onClick={exportToCsv}
                className="w-full px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
              >
                Export CSV
              </button>
              <button
                onClick={exportToJson}
                className="w-full px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
              >
                Export JSON
              </button>
            </div>
          </div>
        </div>
      </CardHeader>

      {/* Table */}
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {visibleColumnsList.map(col => (
                <TableHead
                  key={col.key}
                  className={col.sortable ? 'cursor-pointer hover:text-foreground select-none' : ''}
                  onClick={() => col.sortable && handleSort(col)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && col.sortField && (
                      <span className="text-xs">
                        {sortField === col.sortField ? (
                          sortOrder === 'desc' ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4 opacity-30" />
                        )}
                      </span>
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && executions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnsList.length} className="py-12 text-center">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
                </TableCell>
              </TableRow>
            ) : executions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnsList.length} className="py-12 text-center text-muted-foreground">
                  No executions found
                </TableCell>
              </TableRow>
            ) : (
              displayRows.map((row) => {
                if (row.type === 'standalone') {
                  const exec = row.execution;
                  const detailKey = row.key;
                  return (
                    <Fragment key={detailKey}>
                      <TableRow
                        className={`cursor-pointer ${expandedDetail === detailKey ? 'bg-accent/30' : ''}`}
                        onClick={() => toggleDetail(detailKey)}
                      >
                        {visibleColumnsList.map(col => (
                          <TableCell key={col.key}>
                            {renderCell(exec, col.key)}
                          </TableCell>
                        ))}
                      </TableRow>

                      {expandedDetail === detailKey && (
                        <TableRow className="bg-accent/20">
                          <TableCell colSpan={visibleColumnsList.length} className="py-4 px-6">
                            {renderDetailPanel(exec)}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                }

                // Bundle group
                const group = row;
                const isExpanded = expandedBundles.has(group.key);

                return (
                  <Fragment key={group.key}>
                    {/* Bundle parent row */}
                    <TableRow
                      className={`cursor-pointer bg-muted/30 hover:bg-muted/50 ${isExpanded ? 'border-b-0' : ''}`}
                      onClick={() => toggleBundle(group.key)}
                    >
                      {visibleColumnsList.map(col => (
                        <TableCell key={col.key}>
                          {renderBundleCell(group, col.key, isExpanded)}
                        </TableCell>
                      ))}
                    </TableRow>

                    {/* Expanded control sub-rows */}
                    {isExpanded && group.controls.map((ctrl, ctrlIdx) => {
                      const ctrlDetailKey = `${group.key}::ctrl-${ctrlIdx}`;
                      return (
                        <Fragment key={ctrlDetailKey}>
                          <TableRow
                            className={`cursor-pointer bg-card/50 border-l-2 border-l-blue-500/30 ${expandedDetail === ctrlDetailKey ? 'bg-accent/30' : 'hover:bg-accent/10'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleDetail(ctrlDetailKey);
                            }}
                          >
                            {visibleColumnsList.map(col => (
                              <TableCell key={col.key}>
                                {renderCell(ctrl, col.key, col.key === 'test_name')}
                              </TableCell>
                            ))}
                          </TableRow>

                          {expandedDetail === ctrlDetailKey && (
                            <TableRow className="bg-accent/20 border-l-2 border-l-blue-500/30">
                              <TableCell colSpan={visibleColumnsList.length} className="py-4 px-6">
                                {renderDetailPanel(ctrl)}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>

      {/* Pagination */}
      {pagination && pagination.totalPages > 0 && (
        <CardFooter className="flex items-center justify-between py-3 border-t">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows per page:</span>
            <select
              value={pagination.pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="px-2 py-1 bg-secondary text-foreground border border-border rounded text-sm"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(1)}
              disabled={!pagination.hasPrevious}
              className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed text-foreground"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={!pagination.hasPrevious}
              className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed text-foreground"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span className="px-3 text-sm text-foreground">
              Page {pagination.page} of {pagination.totalPages}
            </span>

            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={!pagination.hasNext}
              className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed text-foreground"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onPageChange(pagination.totalPages)}
              disabled={!pagination.hasNext}
              className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed text-foreground"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
