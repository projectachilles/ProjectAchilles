import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecResultLabel } from '../shared';
import type { EnrichedTestExecution } from '@/services/api/analytics';

// Pins what the executions panel prints for each outcome of classifyExecution (whose rule
// classifyExecution.test.ts pins): the label text and its color class. The execution report
// uses the same vocabulary, so a change here is a change to both.

function makeExec(over: Partial<EnrichedTestExecution>): EnrichedTestExecution {
  return {
    test_uuid: 'u', test_name: 'n', hostname: 'h', is_protected: false, org: 'o', timestamp: '2026-10-12T12:47:49Z',
    error_code: 101, is_bundle_control: false,
    defender_detected: false, defender_stage_detected: false, defender_prevented: false,
    crowdstrike_detected: false, crowdstrike_stage_detected: false, crowdstrike_prevented: false,
    ...over,
  };
}

interface LabelCase {
  name: string;
  exec: EnrichedTestExecution;
  compact: boolean;
  label: string;
  color: string;
}

const CASES: LabelCase[] = [
  {
    name: 'skipped bundle stage', compact: false, label: 'Skipped', color: 'text-faint',
    exec: makeExec({ is_bundle_control: true, error_code: 0, category: 'intel-driven' }),
  },
  {
    name: 'not assessed cyber-hygiene control', compact: false, label: 'Not assessed', color: 'text-faint',
    exec: makeExec({ is_bundle_control: true, error_code: 0, category: 'cyber-hygiene', skipped: true }),
  },
  { name: 'protected', compact: false, label: 'Protected', color: 'text-accent', exec: makeExec({ error_code: 126 }) },
  {
    name: 'prevented, compact, drops the action', compact: true, label: 'Prevented', color: 'text-accent',
    exec: makeExec({ error_code: 999, crowdstrike_stage_detected: true, crowdstrike_prevention_action: 'quarantined' }),
  },
  {
    name: 'prevented names the Falcon action', compact: false, label: 'Prevented (quarantined)', color: 'text-accent',
    exec: makeExec({ error_code: 999, crowdstrike_stage_detected: true, crowdstrike_prevention_action: 'quarantined' }),
  },
  {
    name: 'prevented names the Defender action', compact: false, label: 'Prevented (process killed)', color: 'text-accent',
    exec: makeExec({ error_code: 999, defender_stage_detected: true, defender_prevention_action: 'process_killed' }),
  },
  {
    name: 'prevented by flag, with no action to name', compact: false, label: 'Prevented', color: 'text-accent',
    exec: makeExec({ error_code: 999, defender_stage_detected: true, defender_stage_prevented: true }),
  },
  {
    name: 'exit 101 with a block action is Detected, never Prevented', compact: false, label: 'Detected', color: 'text-warning',
    exec: makeExec({ defender_stage_detected: true, defender_stage_prevented: true, defender_prevention_action: 'process_killed' }),
  },
  { name: 'detected', compact: false, label: 'Detected', color: 'text-warning', exec: makeExec({ defender_stage_detected: true }) },
  {
    name: 'detected despite a failed kill', compact: false, label: 'Detected', color: 'text-warning',
    exec: makeExec({ crowdstrike_stage_detected: true, crowdstrike_prevention_action: 'kill_failed' }),
  },
  { name: 'unprotected', compact: false, label: 'Unprotected', color: 'text-danger', exec: makeExec({}) },
  { name: 'inconclusive (exit 999)', compact: false, label: 'Inconclusive', color: 'text-warning', exec: makeExec({ error_code: 999 }) },
  { name: 'inconclusive (standalone exit 0)', compact: true, label: 'Inconclusive', color: 'text-warning', exec: makeExec({ error_code: 0 }) },
];

describe('ExecResultLabel', () => {
  it.each(CASES)('$name', ({ exec: e, compact, label, color }) => {
    const { container } = render(<ExecResultLabel exec={e} compact={compact} />);
    const text = screen.getByText(label);
    expect(container.textContent).toBe(label);
    expect(text).toHaveClass(compact ? 'text-xs' : 'text-sm');
    // The color sits on the wrapper, so the icon takes it too.
    expect(text.parentElement).toHaveClass(color);
    expect(text.parentElement?.querySelector('svg')).not.toBeNull();
  });
});
