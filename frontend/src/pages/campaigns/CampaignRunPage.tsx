import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, Printer } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/endpoints/Layout';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import { campaignsApi, type CellState, type RunMatrix, type RunNotice } from '@/services/api/campaigns';

const POLL_MS = 15_000;
/** Printed columns per block: more than this and the matrix prints in blocks, one per page. */
const PRINT_COLS = 12;

const STATE_ORDER: CellState[] = [
  'protected', 'prevented', 'detected', 'unprotected', 'error', 'running', 'waiting_for_notice', 'not_run', 'na',
];

/** Same labels and order as Analytics. */
const STATE_LABEL: Record<CellState, string> = {
  waiting_for_notice: 'Waiting for notice',
  running: 'Running',
  protected: 'Protected',
  prevented: 'Prevented',
  detected: 'Detected',
  unprotected: 'Unprotected',
  error: 'Error',
  not_run: 'Not run',
  na: 'N/A',
};

/** Theme tokens only. Error is blue (info) so it never reads as Detected (amber). */
const STATE_CLASS: Record<CellState, string> = {
  waiting_for_notice: 'bg-raised text-muted',
  running: 'bg-raised text-foreground',
  protected: 'bg-success/15 text-success',
  prevented: 'bg-success/15 text-success',
  detected: 'bg-warning-dim text-warning',
  unprotected: 'bg-danger-dim text-danger',
  error: 'bg-info-dim text-info',
  not_run: 'bg-raised text-muted',
  na: 'bg-raised text-faint',
};

const TERMINAL: CellState[] = ['protected', 'prevented', 'detected', 'unprotected', 'error', 'not_run'];
/** Counted as protected, like the Defense Score. */
const COVERED: CellState[] = ['protected', 'prevented', 'detected'];

type Cell = RunMatrix['cells'][string][string];
interface Axis { key: string; label: string; sub?: string }

/** "covered/conclusive" for a row or column of cells, or "—" when nothing is conclusive. */
function coverage(cells: (Cell | undefined)[]): string {
  const covered = cells.filter((c) => c && COVERED.includes(c.state)).length;
  const conclusive = covered + cells.filter((c) => c?.state === 'unprotected').length;
  return conclusive === 0 ? '—' : `${covered}/${conclusive}`;
}

/** Hover text: outcome, reason, and the stage-by-stage result. */
function cellTitle(c: Cell): string | undefined {
  const lines = [c.reason ?? '', ...c.stages.map((s) => `${s.label}: ${s.outcome === 'skipped' ? 'skipped' : s.exit_code ?? '—'}`)];
  const text = lines.filter(Boolean).join('\n');
  return text || undefined;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out.length > 0 ? out : [[]];
}

/** Landscape while the run page is mounted, like the Analytics report: a named @page would add a blank page. */
function useLandscapePrint() {
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-campaign-print', '');
    style.textContent = '@page { size: landscape; margin: 10mm; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
}

function isUnsettled(m: RunMatrix): boolean {
  return m.totals.waiting_for_notice > 0 || m.totals.running > 0;
}

function progressPercent(m: RunMatrix): number {
  const t = m.totals;
  const applicable = STATE_ORDER.filter((s) => s !== 'na').reduce((n, s) => n + t[s], 0);
  if (applicable === 0) return 100;
  const done = TERMINAL.reduce((n, s) => n + t[s], 0);
  return Math.round((done / applicable) * 100);
}

const NOTICE_STATE_LABEL: Record<string, string> = {
  pending: 'pending',
  sent: 'sent',
  not_delivered: 'not delivered',
  overridden: 'overridden',
  skipped: 'skipped',
};

/** The notice record as one sentence: sent, released without notice, or none. */
function noticeRecordText(notice: RunNotice | null): string {
  if (!notice) return 'No pre-execution notice (notices off)';
  const tag = `Notice ${notice.run_tag}`;
  if (notice.state === 'sent') {
    const when = notice.sent_at ? ` ${new Date(notice.sent_at).toLocaleString()}` : '';
    const to = notice.recipients.length > 0 ? ` to ${notice.recipients.join(', ')}` : '';
    return `${tag} sent${when}${to}`;
  }
  if (notice.state === 'overridden') {
    const by = notice.override_by ? ` by ${notice.override_by}` : '';
    const at = notice.override_at ? ` at ${new Date(notice.override_at).toLocaleString()}` : '';
    const why = notice.override_reason ? `: ${notice.override_reason}` : '';
    return `${tag} released without notice${by}${at}${why}`;
  }
  return `${tag} · ${NOTICE_STATE_LABEL[notice.state] ?? notice.state}`;
}

export default function CampaignRunPage() {
  const { runId } = useParams<{ runId: string }>();
  useLandscapePrint();
  const [matrix, setMatrix] = useState<RunMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!runId) return;
    try {
      setMatrix(await campaignsApi.getRun(runId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run');
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const unsettled = matrix !== null && isUnsettled(matrix);
  useEffect(() => {
    if (!unsettled) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [unsettled, load]);

  async function downloadCsv() {
    if (!runId || exporting) return;
    setExporting(true);
    try {
      const { blob, filename } = await campaignsApi.exportRunCsv(runId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename ?? `campaign-run-${runId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export CSV');
    } finally {
      setExporting(false);
    }
  }

  if (!matrix) {
    return (
      <PageContainer>
        {error ? <Alert variant="destructive">{error}</Alert> : <div className="flex justify-center py-12"><Spinner /></div>}
      </PageContainer>
    );
  }

  const { run, tests, agents, cells, totals } = matrix;
  const percent = progressPercent(matrix);
  const notice = run.notice;

  // The longer list goes down the side, so the matrix grows downward, not sideways.
  const hostsAsRows = agents.length > tests.length;
  const testAxis: Axis[] = tests.map((t) => ({ key: t.uuid, label: t.name }));
  const hostAxis: Axis[] = agents.map((a) => ({ key: a.id, label: a.hostname, sub: a.os }));
  const rows = hostsAsRows ? hostAxis : testAxis;
  const cols = hostsAsRows ? testAxis : hostAxis;
  const cellAt = (r: string, c: string): Cell | undefined =>
    hostsAsRows ? cells[c]?.[r] : cells[r]?.[c];
  const blocks = chunk(cols, PRINT_COLS);
  const edrLine = matrix.edr.status === 'unavailable'
    ? 'EDR results unavailable: outcomes use test exit codes only'
    : matrix.edr.sources.length > 0 ? `EDR results from ${matrix.edr.sources.join(' and ')}` : null;

  const table = (blockCols: Axis[], screen: boolean) => (
    <table className="w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr>
          <th className={`border-b border-border bg-surface px-3 py-2 text-left font-medium ${screen ? 'sticky left-0 top-0 z-30 print:static' : ''}`}>
            {hostsAsRows ? 'Host' : 'Test'}
          </th>
          {blockCols.map((c) => (
            <th
              key={c.key}
              title={c.label}
              className={`min-w-[7rem] max-w-[14rem] border-b border-border bg-surface px-3 py-2 text-left align-bottom font-medium ${screen ? 'sticky top-0 z-20 print:static' : ''}`}
            >
              <span className="line-clamp-3 whitespace-normal">{c.label}</span>
              {c.sub && <span className="block text-xs font-normal text-muted">{c.sub}</span>}
            </th>
          ))}
          <th className={`border-b border-l border-border bg-surface px-3 py-2 text-right font-medium ${screen ? 'sticky top-0 z-20 print:static' : ''}`}>
            Protected
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const rowCells = cols.map((c) => cellAt(r.key, c.key));
          return (
            <tr key={r.key}>
              <th
                scope="row"
                className={`border-b border-r border-border bg-background px-3 py-2 text-left font-normal ${screen ? 'sticky left-0 z-10 print:static' : ''}`}
              >
                {r.label}
                {r.sub && <span className="ml-2 text-xs text-muted">{r.sub}</span>}
              </th>
              {blockCols.map((c) => {
                const cell = cellAt(r.key, c.key);
                if (!cell) return <td key={c.key} className="border-b border-border px-3 py-2" />;
                return (
                  <td
                    key={c.key}
                    data-state={cell.state}
                    title={cellTitle(cell)}
                    className={`whitespace-nowrap border-b border-border px-3 py-2 ${STATE_CLASS[cell.state]}`}
                  >
                    {STATE_LABEL[cell.state]}
                  </td>
                );
              })}
              <td className="border-b border-l border-border px-3 py-2 text-right tabular-nums text-muted">
                {coverage(rowCells)}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" className={`border-t border-border bg-surface px-3 py-2 text-left font-medium ${screen ? 'sticky bottom-0 left-0 z-30 print:static' : ''}`}>
            Protected
          </th>
          {blockCols.map((c) => (
            <td key={c.key} className={`border-t border-border bg-surface px-3 py-2 tabular-nums text-muted ${screen ? 'sticky bottom-0 z-20 print:static' : ''}`}>
              {coverage(rows.map((r) => cellAt(r.key, c.key)))}
            </td>
          ))}
          <td className={`border-l border-t border-border bg-surface px-3 py-2 text-right font-medium tabular-nums ${screen ? 'sticky bottom-0 z-20 print:static' : ''}`}>
            {totals.percent_protected === null ? '—' : `${totals.percent_protected}%`}
          </td>
        </tr>
      </tfoot>
    </table>
  );

  return (
    <PageContainer>
      <div className="campaign-run-print">
        <PageHeader
          title={run.campaign_name}
          description={run.framework_label ?? undefined}
          actions={(
            <div className="flex items-center gap-2 print:hidden">
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="w-4 h-4 mr-2" />Print
              </Button>
              <Button variant="outline" onClick={() => void downloadCsv()} disabled={exporting}>
                <Download className="w-4 h-4 mr-2" />Download CSV
              </Button>
            </div>
          )}
        />

        {error && <Alert variant="destructive" className="mb-4">{error}</Alert>}

        <dl className="mb-4 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline text-muted">Started by </dt><dd className="inline">{run.started_by_name || run.started_by}</dd></div>
          <div><dt className="inline text-muted">Started </dt><dd className="inline">{new Date(run.started_at).toLocaleString()}</dd></div>
          <div className="sm:col-span-2">
            <dt className="sr-only">Pre-execution notice</dt>
            <dd data-testid="notice-record">{noticeRecordText(notice)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dd className="inline font-medium">{`As of ${new Date(matrix.as_of).toLocaleString()}`}</dd>
            {edrLine && (
              <dd data-testid="edr-line" className={`inline ${matrix.edr.status === 'unavailable' ? 'text-warning' : 'text-muted'}`}>
                {` · ${edrLine}`}
              </dd>
            )}
          </div>
        </dl>

        <div className="mb-4">
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-muted">Progress</span>
            <span>{`${percent}%`}</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 overflow-hidden rounded bg-raised"
          >
            <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-muted">Protected </span>
            <span data-testid="percent-protected" className="text-lg font-semibold">
              {totals.percent_protected === null ? '—' : `${totals.percent_protected}%`}
            </span>
          </div>
          {STATE_ORDER.map((s) => (
            <span key={s} className="text-muted">
              {`${STATE_LABEL[s]}: `}<span className="text-foreground">{totals[s]}</span>
            </span>
          ))}
          <span className="basis-full text-xs text-faint">
            Prevented and Detected count as protected, as in the Defense Score. Hover a cell for the reason and each stage&apos;s result.
          </span>
        </div>

        <div className={`campaign-matrix-scroll max-h-[70vh] overflow-auto rounded-[10px] border border-border ${blocks.length > 1 ? 'print:hidden' : ''}`}>
          {table(cols, true)}
        </div>
        {blocks.length > 1 && (
          <div className="hidden print:block" data-testid="print-blocks">
            {blocks.map((b, i) => (
              <div key={i} className={i > 0 ? 'break-before-page' : ''}>
                {table(b, false)}
              </div>
            ))}
          </div>
        )}

        <p className="mt-4 text-sm print:hidden">
          <Link to="/tasks/campaigns" className="text-accent hover:underline">Back to campaigns</Link>
        </p>
      </div>
    </PageContainer>
  );
}
