// Deterministic narrative for the executive summary (spec §5.4). Each
// sentence appears only when its condition holds; no LLM involved.
import type { ExecutionReport, ReportTechnique } from '@/services/api/reports';
import { conclusive, defended, protectionRate } from './outcomes';
import { fmtCount, fmtPct, plural } from './format';
import { halvesTrend } from './timeline';

const STRENGTH_MIN_RESULTS = 5;
const STRENGTH_RATE = 0.9;
const GAP_RATE = 0.4;

export const FILTER_LABELS: Record<string, string> = {
  org: 'Organization',
  result: 'Result',
  hostnames: 'Endpoints',
  tests: 'Tests',
  techniques: 'Techniques',
  categories: 'Categories',
  threatActors: 'Threat actors',
  tags: 'Tags',
  errorNames: 'Error names',
  errorCodes: 'Exit codes',
  bundleNames: 'Bundles',
};

/** "Result is unprotected and Exit codes is 101", or null when no outcome filter is on. */
export function describeOutcomeFilters(report: ExecutionReport): string | null {
  const keys = report.meta.outcomeFiltered.map((f) => f.split('=')[0]);
  if (keys.length === 0) return null;
  return keys.map((k) => `${FILTER_LABELS[k] ?? k} is ${report.meta.filters[k] ?? ''}`).join(' and ');
}

const label = (t: ReportTechnique) => (t.name ? `${t.name} (${t.id})` : t.id);

/**
 * The Defense Score sentence. A failed enrichment says so rather than going silent. Scores print
 * to one decimal, as on the dashboard; they are not truncated to whole percents like rates (fmtPct).
 */
function defenseScoreSentence(report: ExecutionReport): string | null {
  if (report.meta.unavailable.includes('defenseScore')) return 'The Defense Score is unavailable for this report.';
  const ds = report.defenseScore;
  if (!ds || ds.score === null) return null;
  const raw = ds.rawScore !== null && ds.riskAcceptedCount > 0
    ? `, or ${ds.rawScore.toFixed(1)}% before excluding ${plural(ds.riskAcceptedCount, 'risk-accepted execution')}`
    : '';
  return `The Defense Score for these filters is ${ds.score.toFixed(1)}%${raw}.`;
}

export function buildVerdict(report: ExecutionReport): string[] {
  const sentences: string[] = [];
  const outcomeFilter = describeOutcomeFilters(report);
  if (outcomeFilter) {
    sentences.push(`This report includes only executions where ${outcomeFilter}. Its rates describe that subset, not overall defensive posture.`);
  }
  const score = defenseScoreSentence(report);

  const totals = report.totals.outcomes;
  const n = conclusive(totals);
  if (n === 0) {
    sentences.push('No stage result reached a verdict in this period.');
    if (score) sentences.push(score);
    return sentences;
  }
  const runs = report.totals.runs;
  const runsText = `${fmtCount(runs, report.totals.runsApproximate)} ${runs === 1 ? 'run' : 'runs'}`;
  sentences.push(
    `Across ${runsText} on ${plural(report.totals.endpoints, 'endpoint')}, ${defended(totals)} of ${n} conclusive stage results were protected, prevented or detected (${fmtPct(protectionRate(totals))}).`,
  );

  const rated = report.techniques
    .map((t) => ({ t, n: conclusive(t.outcomes), rate: protectionRate(t.outcomes) }))
    .filter((x) => x.n >= STRENGTH_MIN_RESULTS && x.rate !== null);

  const strength = rated
    .filter((x) => (x.rate ?? 0) >= STRENGTH_RATE)
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || b.n - a.n)[0];
  if (strength) {
    sentences.push(`${label(strength.t)} was stopped or detected in ${defended(strength.t.outcomes)} of ${strength.n} attempts.`);
  }

  for (const gap of rated.filter((x) => (x.rate ?? 1) < GAP_RATE).sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0) || b.n - a.n).slice(0, 2)) {
    sentences.push(`${label(gap.t)} got through in ${gap.t.outcomes.unprotected} of ${gap.n} attempts without being stopped or detected.`);
  }

  const hi = report.totals.highImpactUnprotected;
  if (hi > 0) {
    sentences.push(`${plural(hi, 'exfiltration or impact stage result')} ran without being stopped or detected.`);
  }

  const halves = halvesTrend(report.timeline.buckets, report.meta.window.axisFrom, report.meta.window.axisTo);
  if (halves) {
    const [a, b] = [fmtPct(halves.first), fmtPct(halves.second)];
    sentences.push(a === b
      ? `The stage protection rate held steady at ${a} across the period.`
      : `The stage protection rate moved from ${a} in the first half of the period to ${b} in the second.`);
  }

  if (score) sentences.push(score);
  return sentences;
}
