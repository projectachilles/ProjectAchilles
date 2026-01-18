import { useState, useMemo } from 'react';
import {
  Loader2,
  ShieldCheck,
  ShieldX,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Columns,
  Check,
} from 'lucide-react';
import { formatDistanceToNow, isValid, format } from 'date-fns';
import type { EnrichedTestExecution, PaginatedResponse, SeverityLevel } from '@/services/api/analytics';

// Parse timestamp - handles both epoch ms strings and ISO strings
function parseTimestamp(timestamp: string): Date {
  // Check if it's a numeric string (epoch milliseconds)
  if (/^\d+$/.test(timestamp)) {
    return new Date(parseInt(timestamp, 10));
  }
  // Otherwise parse as Date string
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

// Severity colors
const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  critical: 'bg-red-500/10 text-red-500 border-red-500/30',
  high: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
  low: 'bg-green-500/10 text-green-500 border-green-500/30',
  info: 'bg-gray-500/10 text-gray-500 border-gray-500/30',
};

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
  { key: 'severity', label: 'Severity', sortable: true, defaultVisible: true, sortField: 'f0rtika.severity' },
  { key: 'category', label: 'Category', sortable: true, defaultVisible: true, sortField: 'f0rtika.category' },
  { key: 'subcategory', label: 'Subcategory', sortable: false, defaultVisible: false },
  { key: 'threat_actor', label: 'Threat Actor', sortable: true, defaultVisible: true, sortField: 'f0rtika.threat_actor' },
  { key: 'techniques', label: 'Techniques', sortable: false, defaultVisible: false },
  { key: 'tactics', label: 'Tactics', sortable: false, defaultVisible: false },
  { key: 'tags', label: 'Tags', sortable: false, defaultVisible: false },
  { key: 'complexity', label: 'Complexity', sortable: true, defaultVisible: false, sortField: 'f0rtika.complexity' },
  { key: 'target', label: 'Target', sortable: false, defaultVisible: false },
  { key: 'score', label: 'Score', sortable: true, defaultVisible: false, sortField: 'f0rtika.score' },
  { key: 'org', label: 'Organization', sortable: false, defaultVisible: true },
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
}

export default function ExecutionsDataTable({
  data,
  loading,
  onPageChange,
  onPageSizeChange,
  onSort,
  sortField,
  sortOrder = 'desc',
}: ExecutionsDataTableProps) {
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key))
  );
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [showColumnMenu, setShowColumnMenu] = useState(false);

  const executions = data?.data || [];
  const pagination = data?.pagination;

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
        // Escape quotes and wrap in quotes if contains comma
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
  const getCellValue = (exec: EnrichedTestExecution, key: string): any => {
    switch (key) {
      case 'test_name':
        return exec.test_name;
      case 'hostname':
        return exec.hostname;
      case 'result':
        return exec.is_protected ? 'Blocked' : 'Bypassed';
      case 'severity':
        return exec.severity;
      case 'category':
        return exec.category;
      case 'subcategory':
        return exec.subcategory;
      case 'threat_actor':
        return exec.threat_actor;
      case 'techniques':
        return exec.tactics?.join(', ');
      case 'tactics':
        return exec.tactics?.join(', ');
      case 'tags':
        return exec.tags?.join(', ');
      case 'complexity':
        return exec.complexity;
      case 'target':
        return exec.target;
      case 'score':
        return exec.score;
      case 'org':
        return exec.org;
      case 'timestamp':
        return formatTimestamp(exec.timestamp);
      default:
        return '';
    }
  };

  // Render cell content
  const renderCell = (exec: EnrichedTestExecution, key: string) => {
    switch (key) {
      case 'test_name':
        return <span className="font-medium">{exec.test_name}</span>;

      case 'hostname':
        return <span className="text-muted-foreground font-mono text-sm">{exec.hostname}</span>;

      case 'result':
        return exec.is_protected ? (
          <span className="inline-flex items-center gap-1.5 text-green-600 dark:text-green-400">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-sm font-medium">Blocked</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
            <ShieldX className="w-4 h-4" />
            <span className="text-sm font-medium">Bypassed</span>
          </span>
        );

      case 'severity':
        if (!exec.severity) return <span className="text-muted-foreground">—</span>;
        return (
          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border uppercase ${SEVERITY_COLORS[exec.severity]}`}>
            {exec.severity}
          </span>
        );

      case 'category':
        if (!exec.category) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-500 border border-blue-500/30">
            {exec.category}
          </span>
        );

      case 'threat_actor':
        if (!exec.threat_actor) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-purple-500/10 text-purple-500 border border-purple-500/30">
            {exec.threat_actor}
          </span>
        );

      case 'tags':
        if (!exec.tags?.length) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {exec.tags.slice(0, 3).map(tag => (
              <span key={tag} className="inline-flex px-1.5 py-0.5 rounded text-xs bg-secondary text-muted-foreground">
                {tag}
              </span>
            ))}
            {exec.tags.length > 3 && (
              <span className="text-xs text-muted-foreground">+{exec.tags.length - 3}</span>
            )}
          </div>
        );

      case 'complexity':
        if (!exec.complexity) return <span className="text-muted-foreground">—</span>;
        const complexityColors: Record<string, string> = {
          low: 'text-green-500',
          medium: 'text-yellow-500',
          high: 'text-red-500',
        };
        return (
          <span className={`text-sm capitalize ${complexityColors[exec.complexity] || ''}`}>
            {exec.complexity}
          </span>
        );

      case 'score':
        if (exec.score === undefined || exec.score === null) return <span className="text-muted-foreground">—</span>;
        return <span className="text-sm font-medium">{exec.score.toFixed(1)}</span>;

      case 'org':
        return (
          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
            {exec.org}
          </span>
        );

      case 'timestamp':
        return <span className="text-sm text-muted-foreground">{formatTimestamp(exec.timestamp)}</span>;

      default:
        const value = getCellValue(exec, key);
        return <span className="text-sm">{value || '—'}</span>;
    }
  };

  // Visible columns for rendering
  const visibleColumnsList = useMemo(
    () => COLUMNS.filter(c => visibleColumns.has(c.key)),
    [visibleColumns]
  );

  if (loading && !data) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 min-h-[400px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Table Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
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
          {/* Column Visibility Toggle */}
          <div className="relative">
            <button
              onClick={() => setShowColumnMenu(!showColumnMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary border border-border rounded-lg text-sm hover:bg-accent transition-colors"
            >
              <Columns className="w-4 h-4" />
              Columns
            </button>

            {showColumnMenu && (
              <div className="absolute right-0 z-50 mt-1 w-56 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
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
                      <span>{col.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Export Dropdown */}
          <div className="relative group">
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary border border-border rounded-lg text-sm hover:bg-accent transition-colors">
              <Download className="w-4 h-4" />
              Export
              <ChevronDown className="w-3 h-3" />
            </button>
            <div className="absolute right-0 z-50 mt-1 w-32 bg-background border border-border rounded-lg shadow-lg overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
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
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              {visibleColumnsList.map(col => (
                <th
                  key={col.key}
                  className={`text-left py-3 px-4 text-sm font-medium text-muted-foreground ${col.sortable ? 'cursor-pointer hover:text-foreground select-none' : ''}`}
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
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && executions.length === 0 ? (
              <tr>
                <td colSpan={visibleColumnsList.length} className="py-12 text-center">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
                </td>
              </tr>
            ) : executions.length === 0 ? (
              <tr>
                <td colSpan={visibleColumnsList.length} className="py-12 text-center text-muted-foreground">
                  No executions found
                </td>
              </tr>
            ) : (
              executions.map((exec, index) => (
                <>
                  <tr
                    key={`${exec.test_uuid}-${exec.timestamp}-${index}`}
                    className={`border-b border-border/50 hover:bg-accent/50 transition-colors cursor-pointer ${expandedRow === index ? 'bg-accent/30' : ''}`}
                    onClick={() => setExpandedRow(expandedRow === index ? null : index)}
                  >
                    {visibleColumnsList.map(col => (
                      <td key={col.key} className="py-3 px-4">
                        {renderCell(exec, col.key)}
                      </td>
                    ))}
                  </tr>

                  {/* Expanded Row Details */}
                  {expandedRow === index && (
                    <tr className="bg-accent/20">
                      <td colSpan={visibleColumnsList.length} className="py-4 px-6">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Test UUID:</span>
                            <p className="font-mono text-xs mt-1">{exec.test_uuid}</p>
                          </div>
                          {exec.tactics?.length && (
                            <div>
                              <span className="text-muted-foreground">Tactics:</span>
                              <p className="mt-1">{exec.tactics.join(', ')}</p>
                            </div>
                          )}
                          {exec.target && (
                            <div>
                              <span className="text-muted-foreground">Target:</span>
                              <p className="mt-1">{exec.target}</p>
                            </div>
                          )}
                          {exec.complexity && (
                            <div>
                              <span className="text-muted-foreground">Complexity:</span>
                              <p className="mt-1 capitalize">{exec.complexity}</p>
                            </div>
                          )}
                          {exec.tags?.length && (
                            <div className="col-span-2">
                              <span className="text-muted-foreground">Tags:</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {exec.tags.map(tag => (
                                  <span key={tag} className="px-2 py-0.5 bg-secondary rounded text-xs">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {exec.score !== undefined && (
                            <div>
                              <span className="text-muted-foreground">Score:</span>
                              <p className="mt-1">{exec.score}/10</p>
                            </div>
                          )}
                          <div>
                            <span className="text-muted-foreground">Full Timestamp:</span>
                            <p className="mt-1">{formatTimestamp(exec.timestamp, false)}</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 0 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows per page:</span>
            <select
              value={pagination.pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="px-2 py-1 bg-secondary border border-border rounded text-sm"
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
              className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={!pagination.hasPrevious}
              className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span className="px-3 text-sm">
              Page {pagination.page} of {pagination.totalPages}
            </span>

            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={!pagination.hasNext}
              className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onPageChange(pagination.totalPages)}
              disabled={!pagination.hasNext}
              className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
