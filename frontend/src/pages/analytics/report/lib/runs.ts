// Helpers over the report's runs, shared by the test pages, the execution log
// and the run-strip appendix.
import type { OutcomeCounts, ReportAlert, ReportRun, ReportRunStage, ReportStage, ReportTest } from '@/services/api/reports';
import { timeOf, truncate } from './format';
import { emptyCounts } from './outcomes';

/** Longest stage name printed beside a stage label in an alert row. */
const STAGE_NAME_MAX = 34;

export function countStages(stages: ReportRunStage[]): OutcomeCounts {
  const c = emptyCounts();
  for (const s of stages) c[s.outcome] += 1;
  return c;
}

/** The run's earliest alert. An alert whose time does not parse is never first. */
export function firstAlert(run: ReportRun): ReportAlert | null {
  let first: { a: ReportAlert; t: number } | null = null;
  for (const a of run.alerts) {
    const t = timeOf(a.createdAt);
    if (t !== null && (first === null || t < first.t)) first = { a, t };
  }
  return first?.a ?? null;
}

export function vendorName(vendor: ReportAlert['vendor']): string {
  return vendor === 'defender' ? 'Defender' : vendor === 'sentinelone' ? 'SentinelOne' : 'Falcon';
}

/** What labelling an alert's stage needs: a run stage, or the test's stage when the run did not fetch it. */
export type AlertStage = Pick<ReportRunStage, 'controlId' | 'order' | 'name' | 'techniques' | 'tactics'>;

/**
 * The stage that an alert's evidence names, or null for a bundle-level alert. The token is the
 * backend's lowercased control id, optionally with a variant suffix (`t1211-cfapi`), so it is
 * compared case-insensitively against the stage's controlId; a bare prefix is not a match.
 * A run carries at most 60 stages, so a token none of them matches is looked up in `testStages`
 * (the run's test's stages from report.tests) before the alert counts as bundle-level.
 */
export function stageForAlert(run: ReportRun, token: string | null, testStages: ReportStage[] = []): AlertStage | null {
  if (!token) return null;
  const wanted = token.toLowerCase();
  const isNamed = (s: AlertStage) => {
    const id = s.controlId?.toLowerCase();
    return !!id && (wanted === id || wanted.startsWith(`${id}-`));
  };
  return run.stages.find(isNamed) ?? testStages.find(isNamed) ?? null;
}

/** The report's test for a run, when the report carries one. */
export function testOf(tests: ReportTest[], run: ReportRun): ReportTest | undefined {
  return tests.find((t) => t.testKey === run.testKey);
}

export interface ResolvedRunStage {
  name: string;
  techniques: string[];
  tactics: string[];
}

/**
 * A run stage's name, techniques and tactics. Reports with more than 25 runs omit them from the
 * run stages, so a missing value is read from the same stage (testKey + controlId) of `tests`.
 * The name falls back to the controlId, then to "Stage N", so something is always printable.
 */
export function resolveRunStage(tests: ReportTest[], run: ReportRun, stage: AlertStage): ResolvedRunStage {
  const known = testOf(tests, run)?.stages.find((s) => s.controlId === stage.controlId);
  return {
    name: stage.name ?? known?.name ?? stage.controlId ?? `Stage ${stage.order}`,
    techniques: stage.techniques ?? known?.techniques ?? [],
    tactics: stage.tactics ?? known?.tactics ?? [],
  };
}

/**
 * "S2 Privileged credential access" for the stage an alert names, or "bundle" when it names none.
 * A standalone test has no stages to name, so its alerts get '' (callers drop empty parts).
 */
export function alertStageText(tests: ReportTest[], run: ReportRun, token: string | null): string {
  const test = testOf(tests, run);
  if (test && !test.isBundle) return '';
  const stage = stageForAlert(run, token, test?.stages);
  return stage ? `S${stage.order} ${truncate(resolveRunStage(tests, run, stage).name, STAGE_NAME_MAX)}` : 'bundle';
}
