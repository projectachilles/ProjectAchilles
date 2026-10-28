import type { EnrichedTestExecution } from '@/services/api/analytics';
import { classifyExecution, type ExecutionOutcome } from './shared';
import { EDR_VENDOR_KEYS, PREVENTION_ACTION_PRECEDENCE, edrVendor, edrVendorName, type EdrVendorKey } from '@/lib/edrVendors';

export type StageKind = ExecutionOutcome | 'not-run';

export interface StageVerdict {
  kind: StageKind;
  title: string;
  body: string;
}

/** A stage's outcome: classifyExecution's, except exit 260 (blocked before it ran) is 'not-run'. */
export function stageKind(exec: EnrichedTestExecution): StageKind {
  return exec.error_code === 260 ? 'not-run' : classifyExecution(exec);
}

const ACTION_COPY: Record<string, string> = {
  quarantined: 'quarantined the file',
  process_killed: 'killed the process',
  blocked: 'blocked it',
};

/** Vendor ids joined as display names ("A and B"), in the order given; "An EDR" when there are none. */
export function killVendorLabel(vendors: string[] | undefined): string {
  return joinNames((vendors ?? []).map(edrVendorName)) ?? 'An EDR';
}

/**
 * Set when the EDR killed the agent during this run (stages unknown); null otherwise.
 * `vendor` is the vendor names joined with " and ", in the order the backend sent them.
 */
export function agentKill(exec: EnrichedTestExecution): { vendor: string; alertIds: string[] } | null {
  if (!exec.edr_terminated) return null;
  return { vendor: killVendorLabel(exec.edr_terminated_vendors), alertIds: exec.edr_terminated_alert_ids ?? [] };
}

/** Run-list sub-label under "Protected" for an EDR-killed run. */
export function agentKillSubLabel(kill: { vendor: string }): string {
  return `Stopped by ${kill.vendor} \u2014 agent terminated`;
}

/** Detail-panel note for an EDR-killed run. */
export function agentKillNote(kill: { vendor: string }): string {
  return `${kill.vendor} terminated the Achilles agent while this test was running, so the test could not report which stages ran. The run counts as protected for the test as a whole; stages are unknown.`;
}

/** Vendors whose per-stage flag is set (falling back to the bundle-level flag for older documents), in registry order. */
function stageEdr(exec: EnrichedTestExecution): EdrVendorKey[] {
  return EDR_VENDOR_KEYS.filter((k) => Boolean(exec[`${k}_stage_detected`] ?? exec[`${k}_detected`]));
}

/** "A", "A and B", "A, B and C". */
function joinNames(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function vendorLabel(vendors: readonly EdrVendorKey[]): string | null {
  return joinNames(vendors.map((k) => edrVendor(k).name));
}

/** Vendor(s) that reported on this stage; null when none did. */
export function stageVendors(exec: EnrichedTestExecution): { label: string; short: string } | null {
  const vendors = stageEdr(exec);
  const label = vendorLabel(vendors);
  if (!label) return null;
  return { label, short: vendors.map((k) => edrVendor(k).abbrev).join(' + ') };
}

/** "<vendor> reports it <action>." naming only the vendor whose action is used (PREVENTION_ACTION_PRECEDENCE). */
function preventionSentence(exec: EnrichedTestExecution): string | null {
  const reported = new Set(stageEdr(exec));
  for (const k of PREVENTION_ACTION_PRECEDENCE) {
    const action = reported.has(k) ? ACTION_COPY[exec[`${k}_prevention_action`] ?? ''] : undefined;
    if (action) return `${edrVendor(k).name} reports it ${action}.`;
  }
  return null;
}

/** Boolean-only fallback: name the vendor(s) whose *_prevented flag is set. */
function preventedFallback(exec: EnrichedTestExecution): string {
  const names = vendorLabel(EDR_VENDOR_KEYS.filter((k) => Boolean(exec[`${k}_prevented`])));
  if (!names) return 'An EDR reports it stopped it.';
  return `${names} ${names.includes(' and ') ? 'report' : 'reports'} it stopped it.`;
}

/**
 * Why a skipped stage did not run. "Stop" orchestrators end the chain at the first block or the
 * first error, so the cause is the nearest earlier stage that was not itself skipped.
 */
function skippedBody(exec: EnrichedTestExecution, siblings: EnrichedTestExecution[]): string {
  const generic = 'The chain stopped before this stage.';
  const idx = siblings.indexOf(exec);
  for (let i = idx - 1; i >= 0; i--) {
    const prev = siblings[i];
    const kind = stageKind(prev);
    if (kind === 'skipped') continue;
    const m = /^Stage (\d+)$/.exec(prev.control_validator ?? '');
    if (!m) return generic;
    const n = m[1];
    if (kind === 'protected' || kind === 'prevented') return `The chain stopped at stage ${n}, where a control blocked it.`;
    if (kind === 'not-run') return `The chain stopped at stage ${n}, where a control blocked the test binary before it ran.`;
    if (kind === 'inconclusive') return `The chain stopped at stage ${n}, which ended with an error.`;
    return generic;
  }
  return generic;
}

export function stageVerdict(exec: EnrichedTestExecution, siblings: EnrichedTestExecution[]): StageVerdict {
  if (exec.error_code === 260) {
    return {
      kind: 'not-run',
      title: 'Stage not run: a control blocked the test binary before it ran.',
      body: "Usually an ASR prevalence rule. The technique itself was not tested, so it isn't scored as protected.",
    };
  }
  const kind = classifyExecution(exec);
  switch (kind) {
    case 'protected':
      return {
        kind,
        title: 'Stopped by endpoint protection.',
        body: 'The stage was blocked or quarantined before it could finish.',
      };
    case 'prevented': {
      return {
        kind,
        title: 'Ran, then an EDR stopped it.',
        body: preventionSentence(exec) ?? preventedFallback(exec),
      };
    }
    case 'detected': {
      return {
        kind,
        title: 'Ran to completion. An EDR alerted but did not stop it.',
        body: `${vendorLabel(stageEdr(exec)) ?? 'An EDR'} raised an alert naming this stage's binary; nothing was blocked.`,
      };
    }
    case 'unprotected':
      return {
        kind,
        title: 'Ran to completion with no block and no alert.',
        body: 'Nothing on the endpoint reacted to this stage.',
      };
    case 'skipped':
      return { kind, title: 'Did not run.', body: skippedBody(exec, siblings) };
    default: {
      const evidence = preventionSentence(exec);
      return {
        kind: 'inconclusive',
        title: 'Not scored: the stage ended with an error.',
        body:
          `${exec.error_name ?? 'Error'} (${exec.error_code ?? 'unknown'}) counts as neither protected nor unprotected.` +
          (evidence ? ` ${evidence.slice(0, -1)}, which is the likely cause.` : ''),
      };
    }
  }
}

const COUNT_ORDER: Array<[StageKind, string]> = [
  ['protected', 'protected'],
  ['prevented', 'prevented'],
  ['detected', 'detected'],
  ['unprotected', 'unprotected'],
  ['not-run', 'not run'],
  ['inconclusive', 'inconclusive'],
];

/** Header results line for a run: non-zero outcome counts joined with " · ". */
export function stageOutcomeCounts(members: EnrichedTestExecution[]): string {
  const counts = new Map<string, number>();
  for (const m of members) {
    const kind = stageKind(m);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return COUNT_ORDER.filter(([k]) => (counts.get(k) ?? 0) > 0)
    .map(([k, word]) => `${counts.get(k)} ${word}`)
    .join(' · ');
}
