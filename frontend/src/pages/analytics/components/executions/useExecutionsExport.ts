import { useState } from 'react';
import type { EnrichedTestExecution } from '@/services/api/analytics';
import { exportColumns, getCellValue } from './shared';

interface ExecutionsExportOptions {
  /** What is exported when the page cannot fetch every match: the results on screen. */
  pageExecutions: EnrichedTestExecution[];
  /** Every result matching the current filters (capped by the caller). */
  onFetchAllExecutions?: () => Promise<{ executions: EnrichedTestExecution[]; total: number }>;
  /** Add the test version columns (capability `testVersions`). */
  showVersions: boolean;
}

export interface ExecutionsExport {
  exporting: boolean;
  /** What to tell the user after an export: a partial export, or a failure. */
  note: string | null;
  exportCsv: () => Promise<void>;
  exportJson: () => Promise<void>;
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** CSV and JSON export of the executions matching the page's filters; the list and the matrix view share it. */
export function useExecutionsExport({ pageExecutions, onFetchAllExecutions, showVersions }: ExecutionsExportOptions): ExecutionsExport {
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /** The rows to export: every match when the page can fetch them, else this page. */
  const rowsForExport = async (): Promise<EnrichedTestExecution[] | null> => {
    if (!onFetchAllExecutions) return pageExecutions;
    setExporting(true);
    setNote(null);
    try {
      const { executions, total } = await onFetchAllExecutions();
      if (executions.length < total) {
        setNote(`Exported the newest ${executions.length.toLocaleString()} of ${total.toLocaleString()} results.`);
      }
      return executions;
    } catch (err) {
      console.error('Failed to fetch executions for export:', err);
      setNote('Export failed: could not load the results.');
      return null;
    } finally {
      setExporting(false);
    }
  };

  const exportCsv = async () => {
    const executions = await rowsForExport();
    if (!executions?.length) return;
    const columns = exportColumns(showVersions);
    const headers = columns.map((c) => c.label);
    const rows = executions.map((exec) =>
      columns.map((col) => {
        const value = getCellValue(exec, col.key);
        const strValue = String(value ?? '');
        if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
          return `"${strValue.replace(/"/g, '""')}"`;
        }
        return strValue;
      }),
    );
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadFile(csv, 'executions.csv', 'text/csv');
  };

  const exportJson = async () => {
    const executions = await rowsForExport();
    if (!executions?.length) return;
    downloadFile(JSON.stringify(executions, null, 2), 'executions.json', 'application/json');
  };

  return { exporting, note, exportCsv, exportJson };
}
