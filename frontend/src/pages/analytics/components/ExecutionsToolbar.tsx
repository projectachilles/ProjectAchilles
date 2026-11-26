import { useId, useState, type ReactNode } from 'react';
import { Calendar, ChevronDown, Download, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ExecutionsExport } from './executions/useExecutionsExport';

interface ExecutionsToolbarProps {
  exportState: ExecutionsExport;
  /** Link to the print-ready execution report for the current filters. */
  reportHref?: string;
  /** SB-format compliance report export (server-generated for the current window). */
  onExportSbReport?: () => Promise<void>;
  sbReportExporting?: boolean;
  onArchiveByDate?: (before: string) => Promise<void>;
  archiving?: boolean;
  /** Controls of the view itself, shown before the shared ones (the list's sorting). */
  children?: ReactNode;
}

/**
 * Export and "Archive by date" for All Executions. Both act on the filters,
 * not on a view, so the list and the matrix show the same controls.
 */
export function ExecutionsToolbar({ exportState, reportHref, onExportSbReport, sbReportExporting, onArchiveByDate, archiving, children }: ExecutionsToolbarProps) {
  const [showDatePurge, setShowDatePurge] = useState(false);
  const [purgeDate, setPurgeDate] = useState('');
  const dateInputId = useId();

  const handleDatePurgeConfirm = async () => {
    if (!purgeDate || !onArchiveByDate) return;
    await onArchiveByDate(purgeDate);
    setShowDatePurge(false);
    setPurgeDate('');
  };

  return (
    <>
      {exportState.note && <span className="text-[12px] text-warning" role="status">{exportState.note}</span>}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}
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
              onClick={() => { void exportState.exportCsv(); }}
              disabled={exportState.exporting}
              className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-raised hover:text-accent disabled:opacity-50"
            >
              {exportState.exporting ? 'Exporting…' : 'Export CSV'}
            </button>
            <button
              onClick={() => { void exportState.exportJson(); }}
              disabled={exportState.exporting}
              className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-raised hover:text-accent disabled:opacity-50"
            >
              {exportState.exporting ? 'Exporting…' : 'Export JSON'}
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
              <label htmlFor={dateInputId} className="mb-2 block text-[11px] uppercase tracking-wider text-faint">
                Archive all executions before:
              </label>
              <input
                id={dateInputId}
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
    </>
  );
}
