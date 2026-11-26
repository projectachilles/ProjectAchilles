import type { MovementListKey, ScoreMovementResponse } from '@/services/api/analytics';

/**
 * Wording of the "What moved the score" card. Pure: the card renders what
 * this returns and adds no copy of its own.
 */

export type SegmentTone = 'accent' | 'danger' | 'warning' | 'faint';

export interface MovementSegment {
  list: MovementListKey;
  label: string;
  hint?: string;
  count: number;
  tone: SegmentTone;
}

export interface MovementPanel {
  /** Replaces the panel body when there is nothing to show. */
  empty: string | null;
  headline: string;
  rate: string | null;
  segments: MovementSegment[];
  note: string | null;
}

export interface ScoreMovementView {
  title: string;
  description: string;
  pill: string | null;
  failures: MovementPanel;
  newTests: MovementPanel;
  footer: string[];
}

/**
 * A day as the card writes it: "Oct 27", with the year ("Oct 27, 2025") when
 * it is not the current year. Used by the card's notes and its list dialog.
 */
export function formatMovementDay(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(
    'en-US',
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
  );
}

/** A count as the card writes it, with the thousands separator of the Defense Score tile ("1,289"). */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

function percent(rate: number | null): string | null {
  return rate === null ? null : `${Math.round(rate)}%`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function failuresNote(data: ScoreMovementResponse): string | null {
  const { total, origins } = data.failures;
  if (total === 0) return null;
  const terms: string[] = [];
  const term = (n: number, one: string, many: string) => `${formatCount(n)} ${plural(n, one, many)}`;
  if (origins.openAtStart > 0) {
    terms.push(`${formatCount(origins.openAtStart)} open on ${formatMovementDay(data.window.from)}`);
  }
  if (origins.olderRetested > 0) terms.push(`${term(origins.olderRetested, 'older failure', 'older failures')} re-tested`);
  if (origins.newTest > 0) terms.push(`${term(origins.newTest, 'new test', 'new tests')} that got through`);
  if (origins.regression > 0) terms.push(term(origins.regression, 'regression', 'regressions'));
  if (origins.firstOnEndpoint > 0) terms.push(`${formatCount(origins.firstOnEndpoint)} first time on an endpoint`);
  return `${formatCount(total)} ${plural(total, 'failure', 'failures')} = ${terms.join(' + ')}`;
}

function newTestsNote(data: ScoreMovementResponse): string | null {
  const { tests, pairs, gotThrough, gotThroughFixed, gotThroughOpen } = data.newTests;
  if (pairs === 0) return null;
  const base =
    `${formatCount(tests)} ${plural(tests, 'test', 'tests')} run for the first time in this organization, ` +
    `across ${formatCount(pairs)} test × endpoint ${plural(pairs, 'pair', 'pairs')}.`;
  if (gotThrough === 0) return base;
  return (
    `${base} Of the ${formatCount(gotThrough)} that got through: ` +
    `${formatCount(gotThroughFixed)} fixed since, ${formatCount(gotThroughOpen)} still open.`
  );
}

function footerLines(data: ScoreMovementResponse): string[] {
  const lines: string[] = [];
  const { regressed, firstOnEndpoint, riskAccepted, scoreDifference } = data;
  if (regressed.total > 0) {
    lines.push(
      `Regressed: ${formatCount(regressed.total)} ${plural(regressed.total, 'pair was', 'pairs were')} ` +
        'protected and got through, ' +
        `${formatCount(regressed.fixed)} fixed since`,
    );
  }
  if (firstOnEndpoint.pairs > 0) {
    lines.push(
      `First time on an endpoint: ${formatCount(firstOnEndpoint.pairs)} ${plural(firstOnEndpoint.pairs, 'pair', 'pairs')}, ` +
        `${formatCount(firstOnEndpoint.stopped)} stopped on the first run. Counted apart from new tests`,
    );
  }
  if (riskAccepted !== null && riskAccepted > 0) {
    lines.push(
      `${formatCount(riskAccepted)} failing ${plural(riskAccepted, 'pair is', 'pairs are')} risk-accepted and not counted`,
    );
  }
  if (scoreDifference.fixedButCounted > 0) {
    const n = scoreDifference.fixedButCounted;
    lines.push(
      `${formatCount(n)} ${plural(n, 'failure the score still counts was', 'failures the score still counts were')} ` +
        'fixed by blocking the test before it started',
    );
  }
  if (scoreDifference.countedTwice > 0) {
    const n = scoreDifference.countedTwice;
    lines.push(`${formatCount(n)} open ${plural(n, 'failure is', 'failures are')} counted twice by the score`);
  }
  return lines;
}

export function buildScoreMovementView(data: ScoreMovementResponse, rangeLabel: string): ScoreMovementView {
  const f = data.failures;
  const n = data.newTests;
  const notTested = f.notRetested + f.leftUntested;

  return {
    title: `What moved the score · ${rangeLabel}`,
    description:
      `${formatCount(data.pairs.start)} → ${formatCount(data.pairs.end)} pairs in the score · ` +
      `${formatCount(data.failing.start)} → ${formatCount(data.failing.end)} failing`,
    pill: notTested > 0 ? `${formatCount(notTested)} ${plural(notTested, 'failure', 'failures')} not re-tested` : null,
    failures: {
      empty: f.total === 0 ? 'No failures in this period' : null,
      headline: `${formatCount(f.fixed)} of ${formatCount(f.total)} fixed`,
      rate: f.total === 0 ? null : percent(f.fixRate),
      segments: [
        { list: 'fixed', label: 'Fixed', hint: 're-tested, now protected', count: f.fixed, tone: 'accent' },
        { list: 'stillFailing', label: 'Still failing', hint: 're-tested, still gets through', count: f.stillFailing, tone: 'danger' },
        { list: 'notRetested', label: 'Not re-tested', hint: 'no run since it failed', count: f.notRetested, tone: 'warning' },
        {
          list: 'leftUntested',
          label: 'Left the score untested',
          hint: 'older than the range, never re-run',
          count: f.leftUntested,
          tone: 'faint',
        },
      ],
      note: failuresNote(data),
    },
    newTests: {
      empty: n.pairs === 0 ? 'No new tests in this period' : null,
      headline: `${formatCount(n.stopped)} of ${formatCount(n.pairs)} stopped`,
      rate: n.pairs === 0 ? null : percent(n.rate),
      segments: [
        { list: 'newStopped', label: 'Stopped on the first run', count: n.stopped, tone: 'accent' },
        { list: 'newGotThrough', label: 'Got through on the first run', count: n.gotThrough, tone: 'danger' },
      ],
      note: newTestsNote(data),
    },
    footer: footerLines(data),
  };
}
