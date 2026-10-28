import type {
  ExecutionActivityDay,
  ExecutionActivityResponse,
  TechniqueOutcomeItem,
  ThreatActorCoverageItem,
} from '@/services/api/analytics';
import type { AgentMetrics, Schedule } from '@/types/agent';
import type { TestMetadata } from '@/types/test';
import { tacticsForTechnique } from '@/lib/attack';
import { ENTERPRISE_TACTICS } from '@/lib/mitreTactics';

/* ------------------------------------------------------------------ */
/* Testing cadence                                                     */
/* ------------------------------------------------------------------ */

export interface CadenceView {
  /** One bar per UTC day, oldest first. */
  bars: ExecutionActivityDay[];
  /** Whole days since the last result; null when there has never been one. */
  lastRunDaysAgo: number | null;
  /** ISO time of the last result (all-time); null = never. */
  lastRunAt: string | null;
  executions7d: number;
  /** null = no conclusive results in the last 7 days. */
  protectedPct7d: number | null;
  endpointsTested7d: number;
  /** Enrolled agents. */
  agentsTotal: number;
  /**
   * Run activity: 7-day test outcomes ("Runs · 7d"), or the 24h lifecycle
   * counts when the backend has no outcome metrics; null when metrics are unavailable.
   */
  taskActivity: { label: string; parts: Array<{ text: string; tone: 'accent' | 'danger' | 'warning' | 'info' | 'muted' }> } | null;
  /** Earliest upcoming schedule (next run in the future); null when none or schedules unavailable. */
  nextScheduled: { when: string; label: string; endpoints: number } | null;
  /** False when schedules could not be read (no permission): hide the row rather than say "Nothing scheduled". */
  schedulesAvailable: boolean;
}

const MS_PER_DAY = 86_400_000;

export function buildCadence(
  activity: ExecutionActivityResponse,
  metrics: AgentMetrics | null,
  /** null = schedules unavailable (e.g. 403 for this role). */
  schedules: Schedule[] | null,
  agentsTotal: number,
  now: number = Date.now(),
): CadenceView {
  const bars = activity.days ?? [];

  let lastRunDaysAgo: number | null = null;
  if (activity.lastExecutionAt) {
    const t = new Date(activity.lastExecutionAt).getTime();
    if (!Number.isNaN(t)) lastRunDaysAgo = Math.max(0, Math.floor((now - t) / MS_PER_DAY));
  }

  const act = metrics?.task_activity_24h;
  const outcomes = metrics?.task_outcomes_7d;
  let taskActivity: CadenceView['taskActivity'] = null;
  if (outcomes) {
    const t = outcomes.tests;
    taskActivity = {
      label: 'Runs · 7d',
      parts: [
        { text: `${t.protected + t.unprotected} with a verdict`, tone: 'accent' },
        { text: `${t.not_run + t.run_failed + t.test_error + t.inconclusive} no verdict`, tone: 'warning' },
        { text: `${act?.in_progress ?? 0} running`, tone: 'info' },
      ],
    };
  } else if (act) {
    taskActivity = {
      label: 'Tasks · 24h',
      parts: [
        { text: `${act.completed ?? 0} done`, tone: 'accent' },
        { text: `${act.failed ?? 0} failed`, tone: 'danger' },
        { text: `${act.in_progress ?? 0} running`, tone: 'warning' },
      ],
    };
  }

  let nextScheduled: CadenceView['nextScheduled'] = null;
  for (const s of schedules ?? []) {
    if (!s.next_run_at) continue;
    const t = new Date(s.next_run_at).getTime();
    // A past next_run_at is overdue or stale, not the next run.
    if (Number.isNaN(t) || t < now) continue;
    if (!nextScheduled || t < new Date(nextScheduled.when).getTime()) {
      nextScheduled = {
        when: s.next_run_at,
        label: s.name ?? s.test_name,
        endpoints: s.agent_ids?.length ?? 0,
      };
    }
  }

  return {
    bars,
    lastRunDaysAgo,
    lastRunAt: lastRunDaysAgo == null ? null : activity.lastExecutionAt,
    executions7d: activity.executions7d ?? 0,
    protectedPct7d:
      activity.protectedPct7d != null && Number.isFinite(activity.protectedPct7d)
        ? activity.protectedPct7d
        : null,
    endpointsTested7d: activity.endpointsTested7d ?? 0,
    agentsTotal,
    taskActivity,
    nextScheduled,
    schedulesAvailable: schedules != null,
  };
}

/* ------------------------------------------------------------------ */
/* Threat actor readiness                                              */
/* ------------------------------------------------------------------ */

export const ACTOR_EXPOSED_BELOW = 80;
export const ACTOR_STALE_DAYS = 14;

export interface ActorRow {
  threatActor: string;
  /** Combined score 0-100. */
  score: number;
  pairCount: number;
  testCount: number;
  /** score < ACTOR_EXPOSED_BELOW */
  exposed: boolean;
  lastTestedAt: string | null;
  /** Whole days since lastTestedAt; null when never. */
  daysAgo: number | null;
  /** Last tested more than ACTOR_STALE_DAYS ago. */
  stale: boolean;
}

export interface ActorReadinessView {
  /** Weakest first (score asc, pairs desc); the card shows as many as fit. */
  rows: ActorRow[];
  /** Actors with coverage data (before the row limit). */
  totalActors: number;
  /** Actors scoring below ACTOR_EXPOSED_BELOW (before the row limit). */
  exposedCount: number;
  /** Intel-driven library actors with no coverage in the range, sorted. */
  untestedActors: string[];
  /** Human range label, e.g. "30 days"; used for "not tested in <range>". */
  rangeLabel: string;
  /** Nothing to show: no coverage rows and no untested library actors. */
  empty: boolean;
}

export function buildActorReadiness(
  coverage: ThreatActorCoverageItem[],
  tests: TestMetadata[],
  rangeLabel = 'this range',
  now: number = Date.now(),
): ActorReadinessView {
  const pairs = (c: ThreatActorCoverageItem) => c.pairCount ?? c.totalExecutions ?? 0;
  const sorted = [...coverage].sort(
    (a, b) => a.coverage - b.coverage || pairs(b) - pairs(a) || a.threatActor.localeCompare(b.threatActor),
  );
  const rows: ActorRow[] = sorted.map((c) => {
    const t = c.lastTestedAt ? new Date(c.lastTestedAt).getTime() : NaN;
    const daysAgo = Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / MS_PER_DAY));
    return {
      threatActor: c.threatActor,
      score: c.coverage,
      pairCount: pairs(c),
      testCount: c.testCount,
      exposed: c.coverage < ACTOR_EXPOSED_BELOW,
      lastTestedAt: c.lastTestedAt ?? null,
      daysAgo,
      stale: daysAgo != null && daysAgo > ACTOR_STALE_DAYS,
    };
  });

  const tested = new Set(coverage.map((c) => c.threatActor));
  const libraryActors = new Set<string>();
  for (const t of tests) {
    if (t.category === 'intel-driven' && t.threatActor) libraryActors.add(t.threatActor);
  }
  const untestedActors = [...libraryActors].filter((a) => !tested.has(a)).sort((a, b) => a.localeCompare(b));

  return {
    rows,
    totalActors: coverage.length,
    exposedCount: coverage.filter((c) => c.coverage < ACTOR_EXPOSED_BELOW).length,
    untestedActors,
    rangeLabel,
    empty: coverage.length === 0 && untestedActors.length === 0,
  };
}

/* ------------------------------------------------------------------ */
/* ATT&CK outcome matrix                                               */
/* ------------------------------------------------------------------ */

export type CellState = 'stopped' | 'partial' | 'through' | 'notRun';

/** Share of test × endpoint results (protected + detected) at or above which a technique is 'stopped'. */
export const STOPPED_SHARE = 0.95;
/** Share at or above which a technique is 'partial'; below it is 'through'. */
export const PARTIAL_SHARE = 0.8;

export interface MatrixCell {
  /** Technique ID, trimmed and upper-cased (sub-techniques are their own cells). */
  technique: string;
  state: CellState;
  protected: number;
  detected: number;
  unprotected: number;
  /** Tooltip / aria text, e.g. "T1486 · 7 blocked · 2 detected only · 4 got through of 13 test × endpoint results". */
  label: string;
}

export interface MatrixColumn {
  slug: string;
  code: string;
  name: string;
  cells: MatrixCell[];
  /** Cells in the 'through' state. */
  throughCount: number;
  /** Cells in the 'stopped' state. */
  stoppedCount: number;
  /** Cells that have results (not 'notRun'). */
  testedCount: number;
}

export interface AttackMatrixView {
  /** One column per shown tactic (IA to IM), in kill-chain order. */
  columns: MatrixColumn[];
  /** Distinct techniques per state, each counted once (incl. unplaced ones). */
  totals: Record<CellState, number> & { techniques: number };
  /** Shown tactic with the most 'through' cells; null when none. */
  weakestTactic: { slug: string; code: string; name: string; throughCount: number } | null;
  /** No techniques in the outcomes or the library. */
  empty: boolean;
}

const STATE_ORDER: Record<CellState, number> = { through: 0, partial: 1, stopped: 2, notRun: 3 };

function stateOf(share: number): CellState {
  if (share >= STOPPED_SHARE) return 'stopped';
  if (share >= PARTIAL_SHARE) return 'partial';
  return 'through';
}

interface Counts { protected: number; detected: number; unprotected: number }

function makeCell(technique: string, c: Counts | undefined): MatrixCell {
  const n = c ? c.protected + c.detected + c.unprotected : 0;
  if (!c || n === 0) {
    return {
      technique, state: 'notRun', protected: 0, detected: 0, unprotected: 0,
      label: `${technique} · in library, not run in this range`,
    };
  }
  const parts: string[] = [];
  if (c.protected) parts.push(`${c.protected} blocked`);
  if (c.detected) parts.push(`${c.detected} detected only`);
  if (c.unprotected) parts.push(`${c.unprotected} got through`);
  return {
    technique,
    state: stateOf((c.protected + c.detected) / n),
    protected: c.protected,
    detected: c.detected,
    unprotected: c.unprotected,
    label: `${technique} · ${parts.join(' · ')} of ${n} test × endpoint results`,
  };
}

/** "t1059.001 " and "T1059.001" are the same technique. */
function normaliseTechniqueId(id: string | null | undefined): string {
  return (id ?? '').trim().toUpperCase();
}

export function buildAttackMatrix(
  outcomes: TechniqueOutcomeItem[],
  tests: TestMetadata[],
): AttackMatrixView {
  const counts = new Map<string, Counts>();
  for (const o of outcomes) {
    const id = normaliseTechniqueId(o.technique);
    if (!id) continue;
    const prev = counts.get(id) ?? { protected: 0, detected: 0, unprotected: 0 };
    counts.set(id, {
      protected: prev.protected + o.protected,
      detected: prev.detected + o.detected,
      unprotected: prev.unprotected + o.unprotected,
    });
  }
  const ids = new Set<string>(counts.keys());
  for (const t of tests) {
    for (const raw of [...(t.techniques ?? []), ...(t.stages ?? []).map((s) => s.technique)]) {
      const id = normaliseTechniqueId(raw);
      if (id) ids.add(id);
    }
  }
  const cellsById = new Map<string, MatrixCell>();
  for (const id of ids) cellsById.set(id, makeCell(id, counts.get(id)));

  const shown = ENTERPRISE_TACTICS.filter((t) => t.shown);
  const shownSlugs = new Set(shown.map((t) => t.slug));
  const byTactic = new Map<string, MatrixCell[]>(shown.map((t) => [t.slug, []]));
  const totals = { stopped: 0, partial: 0, through: 0, notRun: 0, techniques: 0 };

  for (const [technique, cell] of cellsById) {
    totals[cell.state] += 1;
    totals.techniques += 1;
    for (const slug of tacticsForTechnique(technique)) {
      if (shownSlugs.has(slug)) byTactic.get(slug)!.push(cell);
    }
  }

  const columns: MatrixColumn[] = shown.map((t) => {
    const cells = byTactic.get(t.slug)!.sort(
      (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.technique.localeCompare(b.technique),
    );
    return {
      slug: t.slug,
      code: t.code,
      name: t.name,
      cells,
      throughCount: cells.filter((c) => c.state === 'through').length,
      stoppedCount: cells.filter((c) => c.state === 'stopped').length,
      testedCount: cells.filter((c) => c.state !== 'notRun').length,
    };
  });

  let weakest: MatrixColumn | null = null;
  for (const c of columns) {
    if (c.throughCount > 0 && (!weakest || c.throughCount > weakest.throughCount)) weakest = c;
  }

  return {
    columns,
    totals,
    weakestTactic: weakest
      ? { slug: weakest.slug, code: weakest.code, name: weakest.name, throughCount: weakest.throughCount }
      : null,
    empty: cellsById.size === 0,
  };
}
