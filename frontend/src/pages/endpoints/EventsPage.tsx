/**
 * Events Page - Query and view LimaCharlie events using LCQL
 * ACHILLES - Endpoint Management
 * Split Panel Layout: Compact table + Detail panel with Pagination
 */

import { useState } from 'react';
import { Search, Activity, X, FileText, Terminal, Code, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Info, Tag, ChevronDown, ChevronUp, Edit3 } from 'lucide-react';
import { api } from '../../services/api/endpoints';
import type { Event } from '../../types/endpoints';
import SharedLayout from '../../components/shared/Layout';
import { PageContainer, PageHeader } from '../../components/endpoints/Layout';
import { Button } from '../../components/shared/ui/Button';
import { Input } from '../../components/shared/ui/Input';
import { Alert } from '../../components/shared/ui/Alert';
import { Spinner } from '../../components/shared/ui/Spinner';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/shared/ui/Table';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export default function EventsPage() {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(100);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, any> | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<'info' | 'stdout' | 'stderr' | 'json'>('info');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Query builder collapse state
  const [queryCollapsed, setQueryCollapsed] = useState(false);

  // Quick query templates
  const queryTemplates = [
    { label: 'General Query', query: "-24h | plat == windows | * | event/* contains 'psexec'" },
    { label: 'Unsigned Binaries', query: "-24h | plat == windows | CODE_IDENTITY | event/SIGNATURE/FILE_IS_SIGNED != 1 | event/FILE_PATH as Path event/HASH as Hash event/ORIGINAL_FILE_NAME as OriginalFileName COUNT_UNIQUE(Hash) as Count GROUP BY(Path Hash OriginalFileName)" },
    { label: 'Process Arguments', query: '-1h | plat == windows | NEW_PROCESS EXISTING_PROCESS | event/COMMAND_LINE contains "psexec" | event/FILE_PATH as path event/COMMAND_LINE as cli routing/hostname as host' },
    { label: 'Security Test Events', query: "2025-11-24 23:48:20 to 2025-12-08 23:48:20 | * | RECEIPT | routing/investigation_id contains 'e55f'" },
    { label: 'Specific Logon Type', query: '-24h | plat == windows | WEL | event/EVENT/System/EventID == "4624" AND event/EVENT/EventData/LogonType == "10"' },
  ];

  // Pagination calculations
  const totalPages = Math.ceil(events.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedEvents = events.slice(startIndex, endIndex);

  const handleQuery = async () => {
    if (!query.trim()) {
      setError('Please enter a query');
      return;
    }

    setLoading(true);
    setError(null);
    setSelectedIndex(null);
    setCurrentPage(1); // Reset to first page on new query

    try {
      const response = await api.queryEvents(query, limit);
      if (response.success && response.data) {
        setEvents(response.data.results);
        setStats(response.data.stats || null);
        // Auto-collapse query builder after successful query with results
        if (response.data.results.length > 0) {
          setQueryCollapsed(true);
        }
      } else {
        setError(response.error || 'Failed to query events');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to query events');
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setSelectedIndex(null); // Clear selection when changing pages
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1); // Reset to first page when changing page size
    setSelectedIndex(null);
  };

  const formatTimestamp = (event: Event): string => {
    const ts = event.routing?.event_time || event.event_time || event.ts;
    if (!ts) return 'N/A';
    try {
      const timestamp = parseInt(ts.toString());
      return new Date(timestamp).toLocaleString();
    } catch {
      return ts.toString();
    }
  };

  const getHostname = (event: Event): string => {
    return event.routing?.hostname ||
           event.routing?.event?.HOSTNAME ||
           event.event?.HOSTNAME ||
           event.hostname ||
           'N/A';
  };

  const getEventError = (event: Event): string => {
    return event.event?.ERROR?.toString() || '';
  };

  const getFilePath = (event: Event): string => {
    return event.event?.FILE_PATH || '';
  };

  const getStdErr = (event: Event): string => {
    return event.event?.STDERR || '';
  };

  const getStdOut = (event: Event): string => {
    return event.event?.STDOUT || '';
  };

  const getCommandLine = (event: Event): string => {
    return event.event?.COMMAND_LINE || '';
  };

  const getTags = (event: Event): string[] => {
    return event.routing?.tags || [];
  };

  // Get the actual index in the full events array
  const getActualIndex = (pageIndex: number) => startIndex + pageIndex;

  const selectedEvent = selectedIndex !== null ? events[selectedIndex] : null;

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisiblePages = 5;

    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(1);
        pages.push('...');
        pages.push(currentPage - 1);
        pages.push(currentPage);
        pages.push(currentPage + 1);
        pages.push('...');
        pages.push(totalPages);
      }
    }

    return pages;
  };

  return (
    <SharedLayout>
      <PageContainer>
        <PageHeader
          title="Event Query"
          description="Query LimaCharlie events using LCQL (LimaCharlie Query Language)"
        />

        {/* Query Builder - Collapsible */}
        <div className="border border-border rounded-lg bg-card mb-6 overflow-hidden">
          {/* Header - Always visible */}
          <div
            className="flex items-center justify-between px-4 py-3 bg-muted/30 cursor-pointer hover:bg-muted/40 transition-colors"
            onClick={() => setQueryCollapsed(!queryCollapsed)}
          >
            <div className="flex items-center gap-3">
              <Search className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">LCQL Query</span>
              {queryCollapsed && query && (
                <span className="text-xs text-muted-foreground font-mono truncate max-w-md">
                  {query.length > 60 ? query.substring(0, 60) + '...' : query}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {queryCollapsed && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    setQueryCollapsed(false);
                  }}
                >
                  <Edit3 className="w-3 h-3 mr-1" />
                  Edit
                </Button>
              )}
              {queryCollapsed ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Expandable Content */}
          {!queryCollapsed && (
            <div className="p-6 border-t border-border">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                <div className="md:col-span-8">
                  <label className="block text-sm font-medium mb-1.5">Query</label>
                  <textarea
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-24 font-mono text-sm"
                    placeholder="-3h | * | RECEIPT | routing/investigation_id contains 'e55f'"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div className="md:col-span-2">
                  <Input
                    label="Limit"
                    type="number"
                    value={limit.toString()}
                    onChange={(e) => setLimit(parseInt(e.target.value) || 100)}
                    disabled={loading}
                  />
                </div>
                <div className="md:col-span-2">
                  <Button
                    className="w-full h-11"
                    onClick={handleQuery}
                    disabled={loading || !query.trim()}
                  >
                    {loading ? (
                      <>
                        <Spinner size="sm" className="mr-2" />
                        Querying...
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4 mr-2" />
                        Query
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Quick Query Templates */}
              <div className="mt-4">
                <p className="text-xs text-muted-foreground mb-2">Quick Templates:</p>
                <div className="flex flex-wrap gap-2">
                  {queryTemplates.map((template) => (
                    <button
                      key={template.label}
                      onClick={() => setQuery(template.query)}
                      className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      {template.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Stats */}
        {stats && (
          <div className="border border-border rounded-lg bg-card p-3 mb-4">
            <p className="text-sm text-muted-foreground">
              Found {events.length} events
              {stats.execution_time_ms && ` in ${stats.execution_time_ms}ms`}
            </p>
          </div>
        )}

        {/* Split Panel Layout */}
        {events.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left Panel: Compact Events Table */}
            <div className="border border-border rounded-lg overflow-hidden bg-card flex flex-col">
              <div className="bg-muted/30 px-4 py-2 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-medium">Events List</h3>
                <span className="text-xs text-muted-foreground">
                  Showing {startIndex + 1}-{Math.min(endIndex, events.length)} of {events.length}
                </span>
              </div>
              <div className="overflow-auto flex-1" style={{ maxHeight: '400px' }}>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="sticky top-0 bg-card z-10">Timestamp</TableHead>
                      <TableHead className="sticky top-0 bg-card z-10">Hostname</TableHead>
                      <TableHead className="sticky top-0 bg-card z-10">File Path</TableHead>
                      <TableHead className="sticky top-0 bg-card z-10 w-16">Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedEvents.map((event, pageIndex) => {
                      const actualIndex = getActualIndex(pageIndex);
                      return (
                        <TableRow
                          key={actualIndex}
                          className={`cursor-pointer transition-colors ${
                            selectedIndex === actualIndex
                              ? 'bg-primary/30 hover:bg-primary/35 border-l-2 border-l-primary'
                              : pageIndex % 2 === 0
                                ? 'bg-transparent hover:bg-muted/40'
                                : 'bg-white/[0.03] dark:bg-white/[0.06] hover:bg-muted/40'
                          }`}
                          onClick={() => setSelectedIndex(actualIndex)}
                        >
                          <TableCell className="py-2">
                            <span className="font-mono text-xs whitespace-nowrap">
                              {formatTimestamp(event)}
                            </span>
                          </TableCell>
                          <TableCell className="py-2">
                            <span className="font-mono text-xs text-muted-foreground">
                              {getHostname(event)}
                            </span>
                          </TableCell>
                          <TableCell className="py-2">
                            <span
                              className="font-mono text-xs text-muted-foreground truncate block max-w-[200px]"
                              title={getFilePath(event)}
                            >
                              {getFilePath(event) || '-'}
                            </span>
                          </TableCell>
                          <TableCell className="py-2">
                            <span className={`font-mono text-xs font-medium ${
                              getEventError(event) && getEventError(event) !== '0'
                                ? 'text-destructive'
                                : 'text-muted-foreground'
                            }`}>
                              {getEventError(event) || '-'}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls */}
              <div className="border-t border-border px-4 py-3 bg-muted/20">
                <div className="flex items-center justify-between gap-4">
                  {/* Page Size Selector */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Per page:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                      className="h-8 px-2 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Page Navigation */}
                  <div className="flex items-center gap-1">
                    {/* First Page */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handlePageChange(1)}
                      disabled={currentPage === 1}
                    >
                      <ChevronsLeft className="w-4 h-4" />
                    </Button>

                    {/* Previous Page */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>

                    {/* Page Numbers */}
                    <div className="flex items-center gap-1">
                      {getPageNumbers().map((page, idx) => (
                        typeof page === 'number' ? (
                          <Button
                            key={idx}
                            variant={currentPage === page ? 'primary' : 'ghost'}
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => handlePageChange(page)}
                          >
                            {page}
                          </Button>
                        ) : (
                          <span key={idx} className="px-1 text-muted-foreground">
                            {page}
                          </span>
                        )
                      ))}
                    </div>

                    {/* Next Page */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>

                    {/* Last Page */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handlePageChange(totalPages)}
                      disabled={currentPage === totalPages}
                    >
                      <ChevronsRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Panel: Event Details */}
            <div className="border border-border rounded-lg overflow-hidden bg-card">
              <div className="bg-muted/30 px-4 py-2 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-medium">Event Details</h3>
                {selectedEvent && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setSelectedIndex(null)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>

              {selectedEvent ? (
                <div className="flex flex-col h-[460px]">
                  {/* Tab Navigation */}
                  <div className="flex border-b border-border">
                    <button
                      onClick={() => setDetailTab('info')}
                      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                        detailTab === 'info'
                          ? 'border-b-2 border-primary text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Info className="w-4 h-4" />
                      Info
                    </button>
                    <button
                      onClick={() => setDetailTab('stdout')}
                      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                        detailTab === 'stdout'
                          ? 'border-b-2 border-primary text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Terminal className="w-4 h-4" />
                      Stdout
                    </button>
                    <button
                      onClick={() => setDetailTab('stderr')}
                      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                        detailTab === 'stderr'
                          ? 'border-b-2 border-primary text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <FileText className="w-4 h-4" />
                      Stderr
                    </button>
                    <button
                      onClick={() => setDetailTab('json')}
                      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                        detailTab === 'json'
                          ? 'border-b-2 border-primary text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Code className="w-4 h-4" />
                      Raw JSON
                    </button>
                  </div>

                  {/* Tab Content */}
                  <div className="flex-1 overflow-auto p-4">
                    {detailTab === 'info' && (
                      <div className="space-y-4">
                        {/* Command Line */}
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                            <Terminal className="w-3 h-3" />
                            Command Line
                          </h4>
                          {getCommandLine(selectedEvent) ? (
                            <pre className="text-xs font-mono text-foreground bg-muted/30 p-3 rounded-md whitespace-pre-wrap break-words">
                              {getCommandLine(selectedEvent)}
                            </pre>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">No command line</p>
                          )}
                        </div>

                        {/* File Path */}
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                            <FileText className="w-3 h-3" />
                            File Path
                          </h4>
                          {getFilePath(selectedEvent) ? (
                            <pre className="text-xs font-mono text-foreground bg-muted/30 p-3 rounded-md whitespace-pre-wrap break-words">
                              {getFilePath(selectedEvent)}
                            </pre>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">No file path</p>
                          )}
                        </div>

                        {/* Tags */}
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                            <Tag className="w-3 h-3" />
                            Tags
                          </h4>
                          {getTags(selectedEvent).length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {getTags(selectedEvent).map((tag, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-1 text-xs font-mono bg-primary/10 text-primary border border-primary/20 rounded-md"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">No tags</p>
                          )}
                        </div>

                        {/* Error Code */}
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            Error Code
                          </h4>
                          <span className={`text-sm font-mono ${
                            getEventError(selectedEvent) && getEventError(selectedEvent) !== '0'
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                          }`}>
                            {getEventError(selectedEvent) || '-'}
                          </span>
                        </div>
                      </div>
                    )}
                    {detailTab === 'stdout' && (
                      <div className="h-full">
                        {getStdOut(selectedEvent) ? (
                          <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words">
                            {getStdOut(selectedEvent)}
                          </pre>
                        ) : (
                          <p className="text-muted-foreground text-sm">No stdout output</p>
                        )}
                      </div>
                    )}
                    {detailTab === 'stderr' && (
                      <div className="h-full">
                        {getStdErr(selectedEvent) ? (
                          <pre className="text-xs font-mono text-destructive whitespace-pre-wrap break-words">
                            {getStdErr(selectedEvent)}
                          </pre>
                        ) : (
                          <p className="text-muted-foreground text-sm">No stderr output</p>
                        )}
                      </div>
                    )}
                    {detailTab === 'json' && (
                      <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-words">
                        {JSON.stringify(selectedEvent, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-[460px] text-muted-foreground">
                  <Activity className="w-12 h-12 mb-3 opacity-50" />
                  <p className="text-sm">Select an event to view details</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty States */}
        {!loading && events.length === 0 && query && (
          <div className="border border-border rounded-lg bg-card p-12 text-center">
            <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No events found for this query.</p>
          </div>
        )}

        {!loading && !query && (
          <div className="border border-border rounded-lg bg-card p-12 text-center">
            <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              Enter an LCQL query above and click Query to view events.
            </p>
          </div>
        )}
      </PageContainer>
    </SharedLayout>
  );
}
