import type { Task, TaskPayload, TaskResult } from '../../types/agent.js';

/**
 * The light form of a task, for lists of many tasks: of its payload and its
 * result, what a list draws (plus the payload's short identity fields, which
 * the frontend's task type requires). Every other field of the task is kept.
 *
 * A page of the grouped task list was up to 12.8 MB. Most of it was per-control
 * detail of cyber-hygiene bundles (name, expected, actual, tactics; 50 to 150
 * controls a bundle), then the test metadata in every payload, then stdout.
 * No list draws any of it: a task's detail fetches the task by id.
 *
 * These are allowlists. A field a list starts to draw has to be added here
 * (and to the frontend's TaskResult); a field nobody lists is not sent.
 */

/** One stage of a multi-stage test: what decides its verdict. */
export interface StageSummary {
  control_id: string;
  exit_code: number;
  skipped?: boolean;
}

export interface TaskResultSummary {
  /** Says this is the light form: "no stdout" also means "printed nothing" and "removed by retention". */
  summary: true;
  exit_code: number;
  execution_duration_ms?: number;
  error?: string;
  edr_terminated?: TaskResult['edr_terminated'];
  compacted_at?: string;
  bundle_results?: {
    bundle_category?: string;
    /** The stages of a multi-stage test, in order. Not sent for a cyber-hygiene bundle. */
    controls?: StageSummary[];
    /** A cyber-hygiene bundle's controls, counted: a list shows "N of M controls compliant". */
    control_counts?: { evaluated: number; compliant: number };
  };
}

export type TaskPayloadSummary = Pick<TaskPayload, 'test_uuid' | 'test_name' | 'binary_name' | 'execution_timeout' | 'command'>;

const PROTECTED_CODES = new Set([105, 126, 127]);

const RESULT_FIELDS = ['exit_code', 'execution_duration_ms', 'error', 'edr_terminated', 'compacted_at'] as const;
const PAYLOAD_FIELDS = ['test_uuid', 'test_name', 'binary_name', 'execution_timeout', 'command'] as const;

function pick<T extends object>(source: T, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = (source as Record<string, unknown>)[field];
    if (value !== undefined) out[field] = value;
  }
  return out;
}

interface ControlLike {
  control_id: string;
  exit_code: number;
  skipped?: unknown;
  compliant?: unknown;
}

/** The entries a verdict is computed from; the frontend ignores the same ones (testOutcome.ts, stagesOf). */
function usableControls(controls: unknown): ControlLike[] {
  if (!Array.isArray(controls)) return [];
  return controls.filter(
    (c): c is ControlLike =>
      Boolean(c) && typeof c === 'object' && typeof (c as ControlLike).control_id === 'string' && typeof (c as ControlLike).exit_code === 'number',
  );
}

/**
 * A stored result is whatever an agent sent, so nothing here trusts its shape.
 * Stages keep their order: a multi-stage verdict depends on it.
 */
export function summarizeTaskResult(result: TaskResult | null): TaskResultSummary | null {
  if (!result) return null;
  const summary = { summary: true, ...pick(result, RESULT_FIELDS) } as unknown as TaskResultSummary;

  const bundle: unknown = result.bundle_results;
  if (bundle && typeof bundle === 'object') {
    const { bundle_category: category, controls } = bundle as { bundle_category?: unknown; controls?: unknown };
    const out: NonNullable<TaskResultSummary['bundle_results']> = {};
    if (typeof category === 'string') out.bundle_category = category;
    if (Array.isArray(controls) && controls.length > 0) {
      const usable = usableControls(controls);
      if (category === 'cyber-hygiene') {
        // The Tasks page's rule for a compliance bundle (frontend testOutcome.ts):
        // a control counts unless it was skipped, and is compliant by its own
        // flag, or by a protected exit code when it has none.
        const evaluated = usable.filter((c) => !c.skipped);
        out.control_counts = {
          evaluated: evaluated.length,
          compliant: evaluated.filter((c) => c.compliant ?? PROTECTED_CODES.has(c.exit_code)).length,
        };
      } else {
        out.controls = usable.map((c) => pick(c, ['control_id', 'exit_code', 'skipped']) as unknown as StageSummary);
      }
    }
    summary.bundle_results = out;
  }
  return summary;
}

export function summarizeTaskPayload(payload: TaskPayload): TaskPayloadSummary {
  return pick(payload ?? {}, PAYLOAD_FIELDS) as unknown as TaskPayloadSummary;
}

export type TaskSummary<T extends Task = Task> = Omit<T, 'payload' | 'result'> & {
  payload: TaskPayloadSummary;
  result: TaskResultSummary | null;
};

/** A task as a list needs it. */
export function summarizeTask<T extends Task>(task: T): TaskSummary<T> {
  return {
    ...task,
    payload: summarizeTaskPayload(task.payload),
    result: summarizeTaskResult(task.result),
  };
}
