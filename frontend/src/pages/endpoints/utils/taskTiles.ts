import type { AgentMetrics, TaskBreakdownRow, TaskOutcomes7d } from '@/types/agent';

export interface TaskTile {
  id: 'protected' | 'unprotected' | 'no-verdict' | 'in-progress' | 'completed' | 'failed' | 'success-rate';
  label: string;
  value: string;
  /** Tailwind text colour for the value. */
  cls: string;
  sub?: string;
}

export interface TaskTiles {
  /** What the tiles cover, for the page subtitle. */
  window: 'last 7 days' | 'last 24 hours';
  tiles: TaskTile[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Tasks page KPI tiles. With task_outcomes_7d they count test runs by outcome,
 * the same rules as the task rows (only Unprotected is red, "—" when nothing
 * ran). Without it (serverless, older backend) they fall back to the 24h
 * lifecycle counts.
 */
export function taskTiles(metrics: AgentMetrics): TaskTiles {
  const inProgress = metrics.task_activity_24h.in_progress;
  const o = metrics.task_outcomes_7d;
  if (!o) {
    const a = metrics.task_activity_24h;
    return {
      window: 'last 24 hours',
      tiles: [
        { id: 'completed', label: 'Completed', value: String(a.completed), cls: 'text-accent' },
        { id: 'failed', label: 'Failed', value: String(a.failed), cls: a.failed > 0 ? 'text-danger' : '' },
        { id: 'in-progress', label: 'In progress', value: String(inProgress), cls: '' },
        { id: 'success-rate', label: 'Success rate', value: a.total > 0 ? `${Math.round(a.success_rate)}%` : '—', cls: a.total > 0 ? '' : 'text-muted' },
      ],
    };
  }

  const t = o.tests;
  const noVerdict = t.not_run + t.run_failed + t.test_error + t.inconclusive;
  const ran = t.protected + t.unprotected + noVerdict > 0;
  const count = (n: number, cls: string) => (ran ? { value: String(n), cls: n > 0 ? cls : '' } : { value: '—', cls: 'text-muted' });
  const breakdown = [
    t.not_run && `${t.not_run} not run`,
    t.run_failed && `${t.run_failed} run failed`,
    t.test_error && `${t.test_error} test error`,
    t.inconclusive && `${t.inconclusive} inconclusive`,
  ].filter(Boolean).join(' · ');

  return {
    window: 'last 7 days',
    tiles: [
      {
        id: 'protected',
        label: 'Protected',
        ...count(t.protected, 'text-accent'),
        sub: !ran ? 'no test runs in 7 days' : t.edr_stopped > 0 ? `incl. ${t.edr_stopped} stopped by EDR` : undefined,
      },
      { id: 'unprotected', label: 'Unprotected', ...count(t.unprotected, 'text-danger'), sub: ran && t.unprotected > 0 ? 'ran without being blocked' : undefined },
      { id: 'no-verdict', label: 'No verdict', ...count(noVerdict, 'text-warning'), sub: breakdown || undefined },
      {
        id: 'in-progress',
        label: 'In progress',
        value: String(inProgress),
        cls: '',
        sub: o.other.total > 0
          ? `+ ${plural(o.other.total, 'other task')}${o.other.failed > 0 ? ` · ${o.other.failed} failed` : ''}`
          : undefined,
      },
    ],
  };
}

export interface BreakdownGroup { title: string | null; total: number; rows: TaskBreakdownRow[] }

const NO_VERDICT_GROUPS: Array<[string, TaskBreakdownRow['outcome']]> = [
  ['Not run', 'not-run'],
  ['Run failed', 'run-failed'],
  ['Test error', 'test-error'],
  ['Inconclusive', 'inconclusive'],
];

/** The 7-day counts that open an exit-code menu and filter the task list. */
export type BreakdownTile = 'protected' | 'unprotected' | 'no-verdict';

export const BREAKDOWN_TILE_LABEL: Record<BreakdownTile, string> = {
  protected: 'Protected',
  unprotected: 'Unprotected',
  'no-verdict': 'No verdict',
};

/** Exit codes / reasons behind a tile; null when the backend sent no breakdown. */
export function breakdownGroups(o: TaskOutcomes7d, tile: BreakdownTile): BreakdownGroup[] | null {
  if (!o.breakdown) return null;
  const group = (title: string | null, outcome: TaskBreakdownRow['outcome']): BreakdownGroup => {
    const rows = o.breakdown!.filter((r) => r.outcome === outcome);
    return { title, total: rows.reduce((n, r) => n + r.count, 0), rows };
  };
  // Protected and Unprotected are one untitled list each (Unprotected is always
  // exit 101: a single-binary run, or a multi-stage run where a stage ran).
  if (tile !== 'no-verdict') return [group(null, tile)];
  return NO_VERDICT_GROUPS.map(([title, outcome]) => group(title, outcome)).filter((g) => g.rows.length > 0);
}
