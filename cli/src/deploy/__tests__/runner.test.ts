/**
 * Plan runner tests using a fake provider — verifies ordered execution, log
 * streaming, failure short-circuiting, headless manual auto-confirm, and
 * interactive manual abort.
 */

import { describe, it, expect, vi } from 'vitest';
import { runPlan } from '../runner.js';
import { CommandError } from '../run.js';
import type { DeployProvider, LogLine, Step } from '../types.js';
import { z } from 'zod';

function fakeProvider(
  steps: Step[],
  exec: (step: Step) => AsyncIterable<LogLine>,
): DeployProvider {
  return {
    id: 'docker',
    label: 'Fake',
    summary: 'fake',
    modes: ['self-host'],
    automation: 'automated',
    checkPrereqs: async () => [],
    inputSchema: () => z.object({}),
    plan: () => steps,
    execute: (step) => exec(step),
  };
}

async function* yieldLines(...lines: LogLine[]): AsyncIterable<LogLine> {
  for (const l of lines) yield l;
}

describe('runPlan', () => {
  it('runs steps in order and collects ok results', async () => {
    const steps: Step[] = [
      { id: 'a', title: 'A', kind: 'automated' },
      { id: 'b', title: 'B', kind: 'automated' },
    ];
    const seen: string[] = [];
    const provider = fakeProvider(steps, (step) => {
      seen.push(step.id);
      return yieldLines({ stream: 'out', text: `ran ${step.id}` });
    });

    const logs: LogLine[] = [];
    const res = await runPlan(provider, {}, '/repo', true, {
      onLog: (l) => logs.push(l),
    });

    expect(res.ok).toBe(true);
    expect(seen).toEqual(['a', 'b']);
    expect(res.results.map((r) => r.status)).toEqual(['ok', 'ok']);
    expect(logs.map((l) => l.text)).toEqual(['ran a', 'ran b']);
  });

  it('short-circuits on a failing step', async () => {
    const steps: Step[] = [
      { id: 'a', title: 'A', kind: 'automated' },
      { id: 'b', title: 'B', kind: 'automated' },
    ];
    const provider = fakeProvider(steps, (step) => {
      if (step.id === 'b') {
        return (async function* () {
          throw new CommandError('boom', 1);
        })();
      }
      return yieldLines({ stream: 'out', text: 'ok' });
    });

    const res = await runPlan(provider, {}, '/repo', true, { onLog: () => {} });
    expect(res.ok).toBe(false);
    expect(res.results.at(-1)).toMatchObject({ id: 'b', status: 'failed', error: 'boom' });
  });

  it('auto-confirms manual steps in headless mode', async () => {
    const steps: Step[] = [{ id: 'm', title: 'Manual', kind: 'manual', instructions: 'do it' }];
    const provider = fakeProvider(steps, () => yieldLines({ stream: 'info', text: 'do it' }));
    const confirm = vi.fn();

    const res = await runPlan(provider, {}, '/repo', true, {
      onLog: () => {},
      confirmManual: confirm,
    });

    expect(res.ok).toBe(true);
    expect(confirm).not.toHaveBeenCalled(); // headless never prompts
  });

  it('aborts when an interactive manual step is declined', async () => {
    const steps: Step[] = [{ id: 'm', title: 'Manual', kind: 'manual' }];
    const provider = fakeProvider(steps, () => yieldLines());

    const res = await runPlan(provider, {}, '/repo', false, {
      onLog: () => {},
      confirmManual: async () => false,
    });

    expect(res.ok).toBe(false);
    expect(res.results.at(-1)).toMatchObject({ status: 'skipped' });
  });
});
