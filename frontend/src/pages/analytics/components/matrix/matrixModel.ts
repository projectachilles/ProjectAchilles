/**
 * Drawing rules of the coverage matrix. The server decides every state, count
 * and order (GET /analytics/coverage-matrix); this file only says which form
 * fits the width, what a state is called and how a mark reads aloud.
 */
import type { BarSegment } from '@/components/shared/marks/VerdictBar';
import type { MarkTone } from '@/components/shared/marks/markTone';
import type {
  ExtendedFilterParams,
  MatrixCell,
  MatrixHost,
  MatrixRatio,
  MatrixTest,
  MatrixVerdict,
} from '@/services/api/analytics';

/** Width a host needs for a tile with glyph, age and earlier-run dots. */
export const TILE_MIN_PX = 64;
/** Width a host needs for a small tile with a glyph. */
export const SMALL_MIN_PX = 26;
/** Width a host needs for a square. */
export const SQUARE_MIN_PX = 9;

export type MatrixForm = 'tile' | 'small' | 'squares' | 'bar';

/**
 * The form a row's marks take, from the width each host gets. `stripWidth` is
 * the width left for the marks, 0 until it has been measured.
 */
export function matrixForm(stripWidth: number, hostCount: number, cellsIncluded: boolean): MatrixForm {
  if (!cellsIncluded) return 'bar';
  if (hostCount === 0) return 'tile';
  if (stripWidth <= 0) return 'squares';
  const each = stripWidth / hostCount;
  if (each >= TILE_MIN_PX) return 'tile';
  if (each >= SMALL_MIN_PX) return 'small';
  return each >= SQUARE_MIN_PX ? 'squares' : 'bar';
}

/**
 * Word, colour and glyph of each state. The tones are the Tasks page's for
 * the same results; the glyph carries the state where colour cannot.
 */
export const VERDICT_META: Record<MatrixVerdict, { label: string; tone: MarkTone; glyph: string }> = {
  protected: { label: 'protected', tone: 'accent', glyph: '✓' },
  detected: { label: 'detected', tone: 'warning', glyph: '◐' },
  unprotected: { label: 'unprotected', tone: 'danger', glyph: '✕' },
  no_verdict: { label: 'no verdict', tone: 'muted', glyph: '?' },
  risk_accepted: { label: 'risk accepted', tone: 'info', glyph: '⊘' },
};

/** Worst first: what needs a decision, then what says nothing, then what is fine. */
export const VERDICT_ORDER: readonly MatrixVerdict[] = ['unprotected', 'no_verdict', 'risk_accepted', 'detected', 'protected'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** [amount, unit] of a time's age, null when it cannot be read; under a minute is [0, 'now']. */
function age(iso: string, now: number): [number, 'now' | 'minute' | 'hour' | 'day' | 'week'] | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const ms = now - at;
  if (ms < MINUTE) return [0, 'now'];
  if (ms < HOUR) return [Math.floor(ms / MINUTE), 'minute'];
  if (ms < DAY) return [Math.floor(ms / HOUR), 'hour'];
  if (ms < 14 * DAY) return [Math.floor(ms / DAY), 'day'];
  return [Math.floor(ms / (7 * DAY)), 'week'];
}

/** A result's age in a tile: "now", "12m", "5h", "3d", "6w". */
export function ageText(iso: string, now: number): string {
  const a = age(iso, now);
  if (!a) return '';
  return a[1] === 'now' ? 'now' : `${a[0]}${a[1][0]}`;
}

/** A result's age in words: "just now", "5 hours ago". */
export function agoText(iso: string, now: number): string {
  const a = age(iso, now);
  if (!a) return '';
  return a[1] === 'now' ? 'just now' : `${a[0]} ${a[1]}${a[0] === 1 ? '' : 's'} ago`;
}

function ratioText(r: MatrixRatio): string {
  const parts = [r.evaluated > 0 ? `${r.compliant} of ${r.evaluated} controls compliant` : 'no control assessed'];
  if (r.notAssessed > 0) parts.push(`${r.notAssessed} not assessed`);
  if (r.accepted > 0) parts.push(`${r.accepted} risk accepted`);
  return parts.join(', ');
}

/** The accessible name of one mark: host, what it shows, how old it is. */
export function cellLabel(host: Pick<MatrixHost, 'hostname'>, cell: MatrixCell | undefined, now: number): string {
  if (!cell) return `${host.hostname}: never run`;
  const what = cell.ratio ? ratioText(cell.ratio) : cell.verdict ? VERDICT_META[cell.verdict].label : 'no result';
  const when = agoText(cell.at, now);
  const earlier = cell.earlier?.length ? `; earlier: ${cell.earlier.map((v) => VERDICT_META[v].label).join(', ')}` : '';
  return `${host.hostname}: ${what}${when ? `, ${when}` : ''}${earlier}`;
}

const COUNT_OF: Record<MatrixVerdict, keyof MatrixTest['counts']> = {
  protected: 'protected',
  detected: 'detected',
  unprotected: 'unprotected',
  no_verdict: 'noVerdict',
  risk_accepted: 'riskAccepted',
};

/**
 * A row as one bar. An attack row counts hosts per state, worst first, then
 * the hosts that never ran it; the keys are the states (and 'never_run'). A
 * bundle row counts controls: a bundle has no state per host.
 */
export function rowSegments(test: MatrixTest): BarSegment[] {
  if (test.kind === 'controls' && test.ratio) {
    const r = test.ratio;
    return [
      { key: 'not_compliant', label: 'not compliant', tone: 'danger' as const, count: r.evaluated - r.compliant },
      { key: 'not_assessed', label: 'not assessed', tone: 'muted' as const, count: r.notAssessed },
      { key: 'accepted', label: 'risk accepted', tone: 'info' as const, count: r.accepted },
      { key: 'compliant', label: 'compliant', tone: 'accent' as const, count: r.compliant },
    ].filter((s) => s.count > 0);
  }
  const segments: BarSegment[] = VERDICT_ORDER.map((v) => ({
    key: v,
    label: VERDICT_META[v].label,
    tone: VERDICT_META[v].tone,
    count: test.counts[COUNT_OF[v]],
  }));
  segments.push({ key: 'never_run', label: 'never run', tone: 'hollow', count: test.counts.neverRun });
  return segments.filter((s) => s.count > 0);
}

/** The line under a row's name: how much of it was caught. */
export function caughtLine(test: MatrixTest): string {
  if (test.kind === 'controls') {
    const r = test.ratio;
    return r && r.evaluated > 0 ? `${r.compliant} of ${r.evaluated} controls compliant` : 'no control assessed';
  }
  const caught = test.counts.protected + test.counts.detected;
  const judged = caught + test.counts.unprotected;
  if (judged === 0) return 'no host with a verdict';
  return `caught on ${caught} of ${judged} host${judged === 1 ? '' : 's'}`;
}

/** How full a bundle's gauge is: the compliant share of its evaluated controls, null when none was. */
export function gaugePercent(ratio: MatrixRatio): number | null {
  return ratio.evaluated > 0 ? (ratio.compliant / ratio.evaluated) * 100 : null;
}

/**
 * The filters that decide what the matrix covers. The outcome filters and the
 * scoring mode only narrow the list: the server ignores them here, and
 * leaving them out keeps one request per scope.
 */
export function matrixScope(params: ExtendedFilterParams): ExtendedFilterParams {
  const { result: _result, errorNames: _errorNames, errorCodes: _errorCodes, scoringMode: _scoringMode, ...scope } = params;
  return scope;
}
