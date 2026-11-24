// Helpers over the report's runs, shared by the test pages, the execution log
// and the run-strip appendix.
import type { OutcomeCounts, ReportAlert, ReportRun, ReportRunStage, ReportStage, ReportTest } from '@/services/api/reports';
import { agentKillNote, killVendorLabel } from '../../components/executions/stageVerdict';
import { timeOf, truncate } from './format';
import { emptyCounts } from './outcomes';
import { findEdrVendor } from '@/lib/edrVendors';
import { VERSION_STATE_LABEL } from '../../components/executions/versionLabels';
import { isConfirmedPrevention } from '../../utils/prevention';

/** Longest stage name printed beside a stage label in an alert row. */
const STAGE_NAME_MAX = 34;

export function countStages(stages: ReportRunStage[]): OutcomeCounts {
  const c = emptyCounts();
  for (const s of stages) c[s.outcome] += 1;
  return c;
}

/** Which version sentence the Method page prints (see runVersionsBasis). */
export type RunVersionsBasis = 'compared' | 'not_compared' | 'not_recorded';

/**
 * Which version sentence the Method page prints, from what the runs carry:
 * - 'compared': a run has a state other than not recorded (the library was read);
 * - 'not_compared': otherwise, a run has a commit, or neither a commit nor a state (it prints
 *   "version unknown"): the library could not be read when the report was generated;
 * - 'not_recorded': otherwise, every run with a version is not recorded;
 * - null: no run carries a version (a server without test versions sends none).
 */
export function runVersionsBasis(runs: ReportRun[]): RunVersionsBasis | null {
  const versions = runs.flatMap((r) => (r.version ? [r.version] : []));
  if (versions.some((v) => v.state !== undefined && v.state !== 'not_recorded')) return 'compared';
  if (versions.some((v) => v.commit || v.state === undefined)) return 'not_compared';
  return versions.length > 0 ? 'not_recorded' : null;
}

/**
 * The run's version line in the Execution log: the 7-character commit, then its state's label for
 * every state; the commit alone when it could not be compared (no state); with no commit, the
 * state's label, or "version unknown" with no state either. null when the run carries no version.
 */
export function runVersionLine(run: ReportRun): { commit: string | null; word: string | null } | null {
  const v = run.version;
  if (!v) return null;
  const commit = v.commit?.slice(0, 7) || null;
  const word = v.state ? VERSION_STATE_LABEL[v.state] : (commit ? null : VERSION_STATE_LABEL.unknown);
  return { commit, word };
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
  return findEdrVendor(vendor)?.reportName ?? vendor;
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

/**
 * The alert's action as the report prints it, or null: "<action>", or
 * "<action>, stage still completed" when the action is a confirmed one
 * (quarantined, process killed, blocked) and the stage it is attributed to
 * exited 101 (it ran to completion, so the action did not stop it and the
 * stage reads Detected; same rule as the verdict and the console badge). A
 * standalone test uses its one result. A failed kill is never qualified: it
 * prints as "kill failed" whatever the exit code.
 */
export function alertActionText(tests: ReportTest[], run: ReportRun, alert: ReportAlert): string | null {
  if (!alert.preventionAction) return null;
  const action = alert.preventionAction.replace(/_/g, ' ');
  if (!isConfirmedPrevention(alert.preventionAction)) return action;
  const test = testOf(tests, run);
  const named = stageForAlert(run, alert.stageControlId);
  const stage = test && !test.isBundle ? run.stages[0] : run.stages.find((s) => s === named);
  return stage?.exitCode === 101 ? `${action}, stage still completed` : action;
}

/** The note for a run the EDR killed the agent in (same copy as the console's run detail); null otherwise. */
export function agentKillText(run: ReportRun): string | null {
  return run.agentTerminated ? agentKillNote({ vendor: killVendorLabel(run.agentTerminated.vendors) }) : null;
}
