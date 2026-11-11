import type { ExecutionReport } from '@/services/api/reports';
import { ALL_TIME_FROM } from '@/hooks/useAnalyticsFilters';
import { fmtDate, fmtDateTime, plural, tzName } from '../lib/format';
import { FILTER_LABELS } from '../lib/verdict';
import { splitFilterList } from '@/lib/filterList';

const NAMES_SHOWN = 5;

/**
 * The tests behind `keys`, for "tested by" and "Emulated by": each name once, at most five, then
 * "+N more". A key the report cannot name is counted as "1 other test" rather than printed as an id.
 */
export function testNamesText(report: ExecutionReport, keys: string[]): string {
  const known = new Map([...report.tests, ...report.otherTests].map((t) => [t.testKey, t.name]));
  const names = new Set<string>();
  let unnamed = 0;
  for (const key of new Set(keys)) {
    const name = known.get(key);
    if (name) names.add(name);
    else unnamed += 1;
  }
  const shown = [...names].slice(0, NAMES_SHOWN);
  const more = names.size - shown.length;
  return [
    shown.join(', ') + (more > 0 ? ` +${more} more` : ''),
    unnamed > 0 ? plural(unnamed, 'other test') : '',
  ].filter(Boolean).join(', ');
}

/** The window to print: an All-time window starts at the first execution, not the year 2000. */
export function windowRange(report: ExecutionReport): { from: string; to: string } {
  const w = report.meta.window;
  const from = w.effectiveFrom === ALL_TIME_FROM && w.firstExecution ? w.firstExecution : w.effectiveFrom;
  return { from, to: w.effectiveTo };
}

export function windowText(report: ExecutionReport): string {
  const { from, to } = windowRange(report);
  return `${fmtDate(from, report.meta.tz)} – ${fmtDate(to, report.meta.tz)}`;
}

export function orgLabel(report: ExecutionReport): string {
  return report.meta.org.name ?? report.meta.org.id ?? 'All organizations';
}

/**
 * The Defense Score as the dashboard prints it (one decimal, like the verdict sentence).
 * A failed lookup reads "unavailable"; "—" means the lookup succeeded but nothing was scored.
 */
export function defenseScoreText(report: ExecutionReport): string {
  if (report.meta.unavailable.includes('defenseScore')) return 'unavailable';
  const score = report.defenseScore?.score;
  return score == null ? '—' : `${score.toFixed(1)}%`;
}

/** Shown on the cover and the summary when part of the data in scope could not be read. */
export function PartialBanner({ report }: { report: ExecutionReport }) {
  const partial = report.meta.partial;
  if (!partial) return null;
  return (
    <div className="rp-banner" role="note">
      {`Some data in scope could not be read (${partial.failedShards} of ${partial.totalShards} shards); totals may be incomplete.`}
    </div>
  );
}

/** One line under any alert content when the EDR lookup was incomplete. Nothing on a tenant without EDR. */
export function AlertsIncompleteNote({ report }: { report: ExecutionReport }) {
  const { edrVendors, unavailable } = report.meta;
  if (edrVendors.length === 0 || !unavailable.includes('alerts')) return null;
  return <p className="rp-caption">EDR alert correlation was incomplete — see the notice on the summary page.</p>;
}

export function ScopeList({ report }: { report: ExecutionReport }) {
  const { meta } = report;
  const tz = meta.tz;
  const { from, to } = windowRange(report);
  const filters = Object.entries(meta.filters).filter(([k]) => k !== 'org');
  return (
    <dl className="rp-kv">
      <dt>Organization</dt>
      <dd>{orgLabel(report)}</dd>
      <dt>Window</dt>
      <dd>{meta.window.label}: {fmtDateTime(from, tz)} – {fmtDateTime(to, tz)} {tzName(to, tz)}</dd>
      <dt>Executions</dt>
      <dd>
        {meta.window.firstExecution && meta.window.lastExecution
          ? `${fmtDateTime(meta.window.firstExecution, tz)} – ${fmtDateTime(meta.window.lastExecution, tz)}`
          : 'None in this window'}
      </dd>
      <dt>Filters</dt>
      <dd>{filters.length ? filters.map(([k, v]) => `${FILTER_LABELS[k] ?? k}: ${splitFilterList(v).join(', ')}`).join(' · ') : 'None'}</dd>
      <dt>Excluded</dt>
      <dd>Archived executions</dd>
    </dl>
  );
}
