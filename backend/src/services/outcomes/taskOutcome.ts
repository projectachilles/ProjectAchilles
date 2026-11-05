// What a finished security-test task means, from its exit code(s). The
// frontend twin is frontend/src/utils/testOutcome.ts (task labels); both are
// pinned by the same golden table, so the Tasks page tiles always agree with
// the task rows. Change BOTH together.
//
// Same rules as the campaign verdict (verdict.ts) without EDR documents: a
// bundle is Protected when any stage was blocked, else Unprotected when one ran;
// a watchdog-failed run that the EDR reconciliation pass proved was killed by
// the EDR (result.edr_terminated) is Protected.

import { resolveErrorName } from './exitCodes.js';
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

export const OFFLINE_ERROR = 'Agent went offline during execution';
export const TIMEOUT_ERROR = 'Task exceeded execution timeout';

export type TaskBreakdownKey = string;
export const TASK_BREAKDOWN_KEY_RE = /^(exit:-?\d{1,10}|stage:-?\d{1,10}|edr-stopped|failed:(offline|timeout|other))$/;

/** SQL for "finished in the last 7 days"; pass a table alias when joining tables that also have `status`. */
export function outcomeWindowSql(alias?: string): string {
  const p = alias ? `${alias}.` : '';
  return `${p}status IN ('completed', 'failed') AND ${p}completed_at > datetime('now', '-7 days')`;
}

/** The exit code / failure reason behind a finished task's outcome; null when it has none. */
export function taskBreakdown(task: { type: TaskType; status: TaskStatus; result: TaskResult | null }): { key: TaskBreakdownKey; outcome: TaskOutcomeKind } | null {
  const outcome = classifyTaskOutcome(task);
  if (outcome === null) return null;
  const result = task.result;
  if (task.status === 'failed') {
    if (result?.edr_terminated) return { key: 'edr-stopped', outcome };
    const err = (result as { error?: unknown } | null)?.error;
    if (err === OFFLINE_ERROR) return { key: 'failed:offline', outcome };
    if (err === TIMEOUT_ERROR) return { key: 'failed:timeout', outcome };
    return { key: 'failed:other', outcome };
  }
  if (!result) return null;

  const bundle = result.bundle_results;
  const controls = Array.isArray(bundle?.controls)
    ? bundle.controls.filter((c) => typeof c?.control_id === 'string' && typeof c?.exit_code === 'number')
    : [];
  if (controls.length > 0 && bundle?.bundle_category !== 'cyber-hygiene') {
    const live = controls.filter((c) => !c.skipped);
    if (outcome === 'protected') {
      const hit = live.find((c) => PROTECTED_CODES.has(c.exit_code));
      if (hit) return { key: `stage:${hit.exit_code}`, outcome };
    } else if (outcome === 'unprotected' && live.some((c) => c.exit_code === 101)) {
      return { key: 'stage:101', outcome };
    }
  }
  return { key: `exit:${result.exit_code}`, outcome };
}

export function breakdownLabel(key: TaskBreakdownKey): { code: number | null; name: string } {
  switch (key) {
    case 'edr-stopped': return { code: null, name: 'EDR stopped the agent' };
    case 'failed:offline': return { code: null, name: 'Agent offline' };
    case 'failed:timeout': return { code: null, name: 'Timeout' };
    case 'failed:other': return { code: null, name: 'Other failure' };
  }
  const m = /^(exit|stage):(-?\d+)$/.exec(key);
  if (!m) return { code: null, name: key };
  const code = Number(m[2]);
  let name = resolveErrorName(code);
  if (m[1] === 'stage') name += code === 101 ? ' · stage ran' : ' · stage blocked';
  return { code, name };
}
