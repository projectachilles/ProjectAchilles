// What a finished security-test task means, from its exit code(s). The
// frontend twin is frontend/src/utils/testOutcome.ts (task labels); both are
// pinned by the same golden table, so the Tasks page tiles always agree with
// the task rows. Change BOTH together.
//
// Same rules as the campaign verdict (verdict.ts) without EDR documents: a
// bundle is Protected when any stage was blocked, else Unprotected when one ran;
// a watchdog-failed run that the EDR reconciliation pass proved was killed by
// the EDR (result.edr_terminated) is Protected.

import type { TaskResult, TaskStatus, TaskType } from '../../types/agent.js';

export type TaskOutcomeKind = 'protected' | 'unprotected' | 'not-run' | 'run-failed' | 'test-error' | 'inconclusive';

const PROTECTED_CODES = new Set([105, 126, 127]);

function exitKind(code: number): TaskOutcomeKind {
  if (PROTECTED_CODES.has(code)) return 'protected';
  if (code === 101) return 'unprotected';
  if (code === 260) return 'not-run';
  if (code === -1) return 'run-failed';
  if (code === 999 || code === 1) return 'test-error';
  return 'inconclusive';
}

/** The outcome of a finished execute_test task; null for other task types and unfinished runs. */
export function classifyTaskOutcome(task: { type: TaskType; status: TaskStatus; result: TaskResult | null }): TaskOutcomeKind | null {
  if (task.type !== 'execute_test') return null;
  if (task.status === 'failed') return task.result?.edr_terminated ? 'protected' : 'run-failed';
  if (task.status !== 'completed' || !task.result) return null;

  const code = task.result.exit_code;
  const bundle = task.result.bundle_results;
  const controls = Array.isArray(bundle?.controls)
    ? bundle.controls.filter((c) => typeof c?.control_id === 'string' && typeof c?.exit_code === 'number')
    : [];
  if (controls.length > 0 && bundle?.bundle_category !== 'cyber-hygiene') {
    if (controls.some((c) => !c.skipped && PROTECTED_CODES.has(c.exit_code))) return 'protected';
    if (controls.some((c) => !c.skipped && c.exit_code === 101)) return 'unprotected';
  }
  return exitKind(code);
}
