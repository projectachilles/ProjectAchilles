import type { AgentTask } from '@/types/agent';

// What a security-test run means, from its exit code(s). Mirrors the backend's
// ERROR_CODE_MAP (services/analytics/elasticsearch.ts) and the campaign verdict
// rule (services/outcomes/verdict.ts): a bundle is Protected when any stage was
// blocked, Unprotected when none was but one ran. Only Unprotected is red: a
// run that never happened says nothing about the endpoint.

export type TestOutcomeKind = 'protected' | 'unprotected' | 'not-run' | 'run-failed' | 'test-error' | 'inconclusive';
export type TestOutcomeTone = 'accent' | 'danger' | 'warning' | 'muted';

export interface TestOutcome {
  kind: TestOutcomeKind;
  label: string;
  tone: TestOutcomeTone;
  /** One-line explanation: tooltip and detail text. */
  title: string;
}

const PROTECTED_CODES = new Set([105, 126, 127]);

/** Short meaning of an exit code, shown next to it. */
export const EXIT_MEANING: Record<number, string> = {
  [-1]: 'run did not finish',
  0: 'exited without a result',
  1: 'test error',
  101: 'attack ran unblocked',
  105: 'quarantined on extraction',
  126: 'execution prevented',
  127: 'quarantined on execution',
  200: 'no output',
  259: 'timed out',
  260: 'blocked before launch',
  999: 'test error, prerequisites not met',
};

const KIND: Record<TestOutcomeKind, { label: string; tone: TestOutcomeTone }> = {
  protected: { label: 'Protected', tone: 'accent' },
  unprotected: { label: 'Unprotected', tone: 'danger' },
  'not-run': { label: 'Not run', tone: 'warning' },
  'run-failed': { label: 'Run failed', tone: 'warning' },
  'test-error': { label: 'Test error', tone: 'warning' },
  inconclusive: { label: 'Inconclusive', tone: 'muted' },
};

function exitKind(code: number): TestOutcomeKind {
  if (PROTECTED_CODES.has(code)) return 'protected';
  if (code === 101) return 'unprotected';
  if (code === 260) return 'not-run';
  if (code === -1) return 'run-failed';
  if (code === 999 || code === 1) return 'test-error';
  return 'inconclusive';
}

interface StageResult {
  control_id: string;
  exit_code: number;
  skipped?: boolean;
  compliant?: boolean;
}

function stagesOf(result: AgentTask['result']): { category: string | null; controls: StageResult[] } | null {
  const controls = result?.bundle_results?.controls;
  if (!Array.isArray(controls) || controls.length === 0) return null;
  return {
    category: result?.bundle_results?.bundle_category ?? null,
    controls: controls.filter((c) => typeof c?.control_id === 'string' && typeof c?.exit_code === 'number'),
  };
}

const describeExit = (code: number) => `Exit ${code}: ${EXIT_MEANING[code] ?? 'unrecognised exit code'}.`;

function outcome(kind: TestOutcomeKind, title: string): TestOutcome {
  return { kind, ...KIND[kind], title };
}

/** The outcome of an execute_test task, or null for other task types and runs still in progress. */
export function testOutcome(task: Pick<AgentTask, 'type' | 'status' | 'result'>): TestOutcome | null {
  if (task.type !== 'execute_test') return null;
  // The watchdog fails a run whose agent went offline or overran (exit -1).
  if (task.status === 'failed') {
    return outcome('run-failed', task.result?.error ?? 'The run did not finish, so there is no result.');
  }
  if (task.status !== 'completed' || !task.result) return null;

  const code = task.result.exit_code;
  const bundle = stagesOf(task.result);
  if (bundle && bundle.category === 'cyber-hygiene') {
    const evaluated = bundle.controls.filter((c) => !c.skipped);
    const ok = evaluated.filter((c) => c.compliant ?? PROTECTED_CODES.has(c.exit_code)).length;
    return outcome(exitKind(code), `${ok} of ${evaluated.length} controls compliant. ${describeExit(code)}`);
  }
  if (bundle) {
    const blocked = bundle.controls.findIndex((c) => !c.skipped && PROTECTED_CODES.has(c.exit_code));
    if (blocked >= 0) {
      const c = bundle.controls[blocked];
      return outcome('protected', `Blocked at stage ${blocked + 1} (${c.control_id}), exit ${c.exit_code}.`);
    }
    const ran = bundle.controls.filter((c) => !c.skipped && c.exit_code === 101).length;
    if (ran > 0) {
      const total = bundle.controls.filter((c) => !c.skipped).length;
      return outcome('unprotected', `${ran} of ${total} stage${total === 1 ? '' : 's'} ran without being blocked.`);
    }
  }
  return outcome(exitKind(code), describeExit(code));
}

export const TONE_TEXT: Record<TestOutcomeTone, string> = {
  accent: 'text-accent',
  danger: 'text-danger',
  warning: 'text-warning',
  muted: 'text-muted',
};

export const TONE_DOT: Record<TestOutcomeTone, string> = {
  accent: 'bg-accent',
  danger: 'bg-danger',
  warning: 'bg-warning',
  muted: 'bg-faint',
};
