// The verdict of one completed test run on one host (a campaign cell, or one
// line of a notice's Finished email), its
// human-readable reason, and an EDR summary. Matches Analytics' group label:
// Protected (a stage was blocked) > Prevented (an EDR confirmed prevention) >
// Detected (an EDR alert matched) > Unprotected (a stage ran unblocked) >
// Error. Per-stage outcomes use the report's classifyStage, which is pinned to
// the console's rule by a shared golden table.

import { CONFIRMED_PREVENTION_ACTIONS, classifyStage, getSourceField } from '../reports/stageOutcome.js';
import { classifyOutcome } from '../notices/render.js';
import type { StageOutcome } from '../../types/reports.js';
import type { TaskResult } from '../../types/agent.js';
import type { EdrDocs } from './edr.js';
import { EDR_VENDORS } from './vendors.js';

export type VerdictState = 'protected' | 'prevented' | 'detected' | 'unprotected' | 'error';

export interface StageInput {
  control_id: string;
  exit_code: number;
  skipped?: boolean;
  compliant?: boolean;
}

export interface VerdictInput {
  taskId: string;
  exitCode: number | null;
  /** result.error reported by the agent */
  error: string | null;
  /** Last few hundred characters of result.stderr */
  stderrTail: string | null;
  /** payload.metadata.category */
  category: string | null;
  /** result.bundle_results.controls, or null for a single-binary test */
  controls: StageInput[] | null;
  edr: EdrDocs;
}

export interface StageView {
  label: string;
  exit_code: number | null;
  outcome: StageOutcome;
}

export interface Verdict {
  state: VerdictState;
  reason: string;
  /** "Defender: prevented (process killed)", "Defender: alert raised", "unavailable", or null. */
  edr: string | null;
  stages: StageView[];
  /** Compact stage list for the CSV: "1:101 2:999 3:skip" or "47 of 52 controls compliant". */
  stagesText: string;
}

const PROTECTED_CODES = [105, 126, 127];

/** result.bundle_results.controls → stage inputs, or null for a single-binary result. */
export function controlsOf(value: unknown): StageInput[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = value
    .filter((c) => c && typeof c.control_id === 'string' && typeof c.exit_code === 'number')
    .map((c) => ({ control_id: c.control_id, exit_code: c.exit_code, skipped: c.skipped === true, compliant: typeof c.compliant === 'boolean' ? c.compliant : undefined }));
  return out.length > 0 ? out : null;
}

/**
 * Elasticsearch ids of a completed result: `<task_id>`, or `<task_id>::<control_id>`
 * per stage. Cyber-hygiene bundles keep their own verdict, so none are needed.
 */
export function resultDocIds(taskId: string, category: string | null, controls: StageInput[] | null): string[] {
  if (category === 'cyber-hygiene') return [];
  return controls ? controls.map((c) => `${taskId}::${c.control_id}`) : [taskId];
}

const EXIT_MEANING: Record<number, string> = {
  0: 'exited without a result',
  1: 'test error',
  200: 'no output',
  259: 'timed out',
  260: 'blocked before execution by app control, technique not evaluated',
  999: 'test error, prerequisites not met',
};

const ACTION_TEXT: Record<string, string> = { process_killed: 'process killed', quarantined: 'quarantined', blocked: 'blocked' };

const flag = (src: Record<string, unknown>, field: string) => getSourceField(src, `f0rtika.${field}`) === true;

function fallbackOutcome(exit: number | null, skipped: boolean, isBundle: boolean): StageOutcome {
  if (skipped || (isBundle && exit === 0)) return 'skipped';
  if (exit !== null && PROTECTED_CODES.includes(exit)) return 'protected';
  return exit === 101 ? 'unprotected' : 'inconclusive';
}

interface Signal { vendor: string; action: string | null; stage: number | null }

/** EDR signals across the cell's docs, in stage order, one per vendor. */
function edrSignals(docs: Array<Record<string, unknown> | undefined>, isBundle: boolean) {
  const prevented: Signal[] = [];
  const detected: Signal[] = [];
  for (const v of EDR_VENDORS) {
    docs.forEach((src, i) => {
      if (!src) return;
      const action = String(getSourceField(src, `f0rtika.${v.key}_prevention_action`) ?? '') || null;
      const alerted = flag(src, `${v.key}_detected`) || flag(src, `${v.key}_stage_detected`);
      const prev = flag(src, `${v.key}_prevented`) || (alerted && !!action && CONFIRMED_PREVENTION_ACTIONS.includes(action));
      const stage = isBundle ? i + 1 : null;
      if (prev && !prevented.some((s) => s.vendor === v.name)) prevented.push({ vendor: v.name, action, stage });
      if (alerted && !detected.some((s) => s.vendor === v.name)) detected.push({ vendor: v.name, action: null, stage });
    });
  }
  return { prevented, detected };
}

const joinNames = (names: string[]) => names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
const actionText = (a: string | null) => (a && ACTION_TEXT[a]) || null;
const exitMeaning = (code: number) => EXIT_MEANING[code] ?? 'test error';
const lastLine = (s: string | null) => (s ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? '';

export function cellVerdict(input: VerdictInput): Verdict {
  const { taskId, exitCode, controls, edr } = input;

  if (input.category === 'cyber-hygiene') {
    const evaluated = (controls ?? []).filter((c) => !c.skipped);
    const ok = evaluated.filter((c) => c.compliant ?? PROTECTED_CODES.includes(c.exit_code)).length;
    const o = classifyOutcome({ status: 'completed', result: exitCode === null ? null : ({ exit_code: exitCode } as TaskResult) });
    const state: VerdictState = o === 'protected' ? 'protected' : o === 'unprotected' ? 'unprotected' : 'error';
    const counted = evaluated.length > 0;
    const reason = counted
      ? `${ok} of ${evaluated.length} controls compliant${ok < evaluated.length ? `; ${evaluated.length - ok} not` : ''}.`
      : exitCode === null ? 'No result.' : `Exit ${exitCode}: ${exitMeaning(exitCode)}.`;
    return { state, reason, edr: null, stages: [], stagesText: counted ? `${ok} of ${evaluated.length} controls compliant` : '' };
  }

  const isBundle = !!controls && controls.length > 0;
  const list = isBundle ? controls! : [{ control_id: '', exit_code: exitCode ?? -1, skipped: false }];
  const docs = list.map((c) => edr.docs.get(isBundle ? `${taskId}::${c.control_id}` : taskId));
  const stages: StageView[] = list.map((c, i) => ({
    label: isBundle ? `Stage ${i + 1} (${c.control_id})` : '',
    exit_code: isBundle ? c.exit_code : exitCode,
    outcome: docs[i] ? classifyStage(docs[i]!) : fallbackOutcome(isBundle ? c.exit_code : exitCode, !!c.skipped, isBundle),
  }));
  const { prevented, detected } = edrSignals(docs, isBundle);

  // Sentences about stages that did not reach a verdict.
  const tail = isBundle
    ? stages.flatMap((s) =>
        s.outcome === 'skipped' ? [`${s.label} skipped.`]
          : s.outcome === 'inconclusive' && s.exit_code !== null ? [`${s.label} reported a test error (${s.exit_code}, ${exitMeaning(s.exit_code).replace(/^test error, /, '')}).`]
            : [])
    : [];
  const join = (...parts: string[]) => parts.filter(Boolean).join(' ');
  const edrNote = edr.status === 'ok' ? 'No EDR alert matched.' : edr.status === 'unavailable' ? 'EDR results unavailable.' : '';

  let state: VerdictState;
  let lead: string;
  const blocked = stages.findIndex((s) => s.outcome === 'protected');
  if (blocked >= 0) {
    state = 'protected';
    const code = stages[blocked].exit_code;
    lead = isBundle ? `Blocked at stage ${blocked + 1} (${list[blocked].control_id}), exit ${code}.` : `Blocked, exit ${code}.`;
  } else if (prevented.length > 0) {
    state = 'prevented';
    const act = actionText(prevented.find((p) => actionText(p.action))?.action ?? null);
    const at = prevented[0].stage !== null ? ` during stage ${prevented[0].stage} (${list[prevented[0].stage - 1].control_id})` : '';
    lead = `${joinNames(prevented.map((p) => p.vendor))} prevented it${act ? ` (${act})` : ''}${at}.`;
  } else if (detected.length > 0) {
    state = 'detected';
    lead = `${joinNames(detected.map((d) => d.vendor))} raised an alert; nothing was blocked.`;
  } else if (stages.some((s) => s.outcome === 'unprotected')) {
    state = 'unprotected';
    if (isBundle) {
      const ran = stages.filter((s) => s.outcome === 'unprotected').length;
      const total = stages.filter((s) => s.outcome !== 'skipped').length;
      lead = `${ran} of ${total} stage${total === 1 ? '' : 's'} ran without being blocked.`;
    } else {
      lead = `Ran without being blocked (exit ${exitCode}).`;
    }
    return finish(state, join(lead, ...tail, edrNote));
  } else {
    state = 'error';
    lead = isBundle || exitCode === null ? '' : join(`Exit ${exitCode}: ${exitMeaning(exitCode)}.`, input.error ?? lastLine(input.stderrTail));
  }
  return finish(state, join(lead, ...tail));

  function finish(s: VerdictState, reason: string): Verdict {
    const edrText = edr.status === 'unavailable'
      ? 'unavailable'
      : [
          ...prevented.map((p) => `${p.vendor}: prevented${actionText(p.action) ? ` (${actionText(p.action)})` : ''}`),
          ...detected.filter((d) => !prevented.some((p) => p.vendor === d.vendor)).map((d) => `${d.vendor}: alert raised`),
        ].join('; ') || null;
    return {
      state: s,
      reason: reason || (exitCode === null ? 'No result.' : `Exit ${exitCode}.`),
      edr: edrText,
      stages: isBundle ? stages : [],
      stagesText: isBundle ? stages.map((st, i) => `${i + 1}:${st.outcome === 'skipped' ? 'skip' : st.exit_code}`).join(' ') : '',
    };
  }
}
