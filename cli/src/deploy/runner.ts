/**
 * Plan runner shared by the Ink wizard and the headless CI path. Walks a
 * provider's steps in order: automated steps stream their `execute()` output via
 * `onLog`; manual steps print their instructions, then pause for `confirmManual`
 * (auto-confirmed in headless mode). Returns a structured result per step.
 */

import { CommandError } from './run.js';
import type { DeployProvider, ExecContext, LogLine, Step } from './types.js';

export interface StepResult {
  id: string;
  title: string;
  kind: Step['kind'];
  status: 'ok' | 'failed' | 'skipped';
  error?: string;
}

export interface RunnerCallbacks {
  onLog: (line: LogLine) => void;
  onStepStart?: (step: Step, index: number, total: number) => void;
  onStepDone?: (result: StepResult, index: number) => void;
  /** Resolve `true` to continue past a manual step, `false` to abort. */
  confirmManual?: (step: Step) => Promise<boolean>;
}

export interface RunPlanResult {
  ok: boolean;
  results: StepResult[];
}

export async function runPlan(
  provider: DeployProvider,
  inputs: Record<string, unknown>,
  repoRoot: string,
  headless: boolean,
  cb: RunnerCallbacks,
): Promise<RunPlanResult> {
  const steps = provider.plan(inputs);
  const ctx: ExecContext = { inputs, repoRoot, headless };
  const results: StepResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    cb.onStepStart?.(step, i, steps.length);

    let result: StepResult = { id: step.id, title: step.title, kind: step.kind, status: 'ok' };

    try {
      for await (const line of provider.execute(step, ctx)) {
        cb.onLog(line);
      }
    } catch (err) {
      const message =
        err instanceof CommandError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      result = { ...result, status: 'failed', error: message };
      cb.onLog({ stream: 'err', text: message });
      cb.onStepDone?.(result, i);
      results.push(result);
      return { ok: false, results };
    }

    // Manual steps pause for confirmation (headless auto-confirms).
    if (step.kind === 'manual' && !headless && cb.confirmManual) {
      const proceed = await cb.confirmManual(step);
      if (!proceed) {
        result = { ...result, status: 'skipped' };
        cb.onStepDone?.(result, i);
        results.push(result);
        return { ok: false, results };
      }
    }

    cb.onStepDone?.(result, i);
    results.push(result);
  }

  return { ok: true, results };
}
