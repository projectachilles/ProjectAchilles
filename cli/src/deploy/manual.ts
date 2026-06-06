/**
 * Shared helper for guided providers: render a `manual` step's instructions and
 * copy-paste command blocks into the log pane as `LogLine`s.
 */

import type { LogLine, Step } from './types.js';

export async function* emitManual(step: Step): AsyncIterable<LogLine> {
  if (step.instructions) {
    for (const line of step.instructions.split('\n')) {
      yield { stream: 'info', text: line };
    }
  }
  if (step.commands?.length) {
    yield { stream: 'info', text: '' };
    for (const line of step.commands) {
      yield { stream: 'out', text: line };
    }
  }
}
