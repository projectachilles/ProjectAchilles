import { describe, it, expect } from 'vitest';
import { classifyExecution, type ExecutionOutcome } from '../shared';
import type { EnrichedTestExecution } from '@/services/api/analytics';

// ── Golden table ─────────────────────────────────────────────────
// Twin of backend/src/services/reports/__tests__/stageOutcome.test.ts.
// Same rows, same expectations. Change BOTH tables together.
interface GoldenCase {
  name: string;
  exit?: number;
  bundle?: boolean;
  category?: string;
  flags?: Partial<Record<
    | 'defender_detected' | 'defender_stage_detected' | 'defender_prevented'
    | 'crowdstrike_detected' | 'crowdstrike_stage_detected' | 'crowdstrike_prevented',
    boolean
  >>;
  actions?: Partial<Record<'defender_prevention_action' | 'crowdstrike_prevention_action', string>>;
  expected: ExecutionOutcome;
}

const GOLDEN: GoldenCase[] = [
  { name: 'exit 105 → protected', exit: 105, expected: 'protected' },
  { name: 'exit 126 → protected', exit: 126, expected: 'protected' },
  { name: 'exit 127 → protected', exit: 127, expected: 'protected' },
  { name: 'exit 126 + stage alert stays protected', exit: 126, flags: { defender_stage_detected: true }, expected: 'protected' },
  { name: 'exit 101, nothing → unprotected', exit: 101, expected: 'unprotected' },
  { name: 'exit 101 + Defender stage alert → detected', exit: 101, flags: { defender_stage_detected: true }, expected: 'detected' },
  { name: 'exit 101 + Falcon stage alert → detected', exit: 101, flags: { crowdstrike_stage_detected: true }, expected: 'detected' },
  { name: 'exit 101 + bundle-level Defender flag only → unprotected', exit: 101, flags: { defender_detected: true }, expected: 'unprotected' },
  { name: 'exit 101 + Falcon prevented → prevented', exit: 101, flags: { crowdstrike_prevented: true }, expected: 'prevented' },
  { name: 'exit 101 + Defender prevented → prevented', exit: 101, flags: { defender_prevented: true }, expected: 'prevented' },
  {
    name: 'exit 101 + Falcon stage alert + quarantined → prevented', exit: 101,
    flags: { crowdstrike_stage_detected: true }, actions: { crowdstrike_prevention_action: 'quarantined' }, expected: 'prevented',
  },
  {
    name: 'exit 101 + Defender stage alert + kill_failed → detected', exit: 101,
    flags: { defender_stage_detected: true }, actions: { defender_prevention_action: 'kill_failed' }, expected: 'detected',
  },
  {
    name: 'exit 101 + Defender stage alert + quarantined → prevented', exit: 101,
    flags: { defender_stage_detected: true }, actions: { defender_prevention_action: 'quarantined' }, expected: 'prevented',
  },
  {
    name: 'exit 101 + Defender stage alert + process_killed → prevented', exit: 101,
    flags: { defender_stage_detected: true }, actions: { defender_prevention_action: 'process_killed' }, expected: 'prevented',
  },
  {
    name: 'exit 101 + Falcon stage alert + blocked → prevented', exit: 101,
    flags: { crowdstrike_stage_detected: true }, actions: { crowdstrike_prevention_action: 'blocked' }, expected: 'prevented',
  },
  {
    name: 'exit 101 + Falcon stage alert + kill_failed → detected', exit: 101,
    flags: { crowdstrike_stage_detected: true }, actions: { crowdstrike_prevention_action: 'kill_failed' }, expected: 'detected',
  },
  {
    name: 'exit 101 + bundle-level flag + blocked action → unprotected', exit: 101,
    flags: { defender_detected: true }, actions: { defender_prevention_action: 'blocked' }, expected: 'unprotected',
  },
  { name: 'bundle stage exit 0 (intel-driven) → skipped', exit: 0, bundle: true, category: 'intel-driven', expected: 'skipped' },
  { name: 'bundle control exit 0 (cyber-hygiene) → inconclusive', exit: 0, bundle: true, category: 'cyber-hygiene', expected: 'inconclusive' },
  { name: 'standalone exit 0 → inconclusive', exit: 0, expected: 'inconclusive' },
  { name: 'exit 1 → inconclusive', exit: 1, expected: 'inconclusive' },
  { name: 'exit 200 → inconclusive', exit: 200, expected: 'inconclusive' },
  { name: 'exit 259 → inconclusive', exit: 259, expected: 'inconclusive' },
  { name: 'exit 260 → inconclusive', exit: 260, expected: 'inconclusive' },
  { name: 'exit 999 → inconclusive', exit: 999, expected: 'inconclusive' },
  { name: 'exit 999 + Defender prevented → inconclusive (unlike SB Export)', exit: 999, flags: { defender_prevented: true }, expected: 'inconclusive' },
  // Error-coded stage the EDR blocked: upgrade on this stage's own flag + confirmed action.
  {
    name: 'exit 999 + Falcon stage alert + process_killed → prevented (EDR killed the stage)', exit: 999,
    flags: { crowdstrike_stage_detected: true }, actions: { crowdstrike_prevention_action: 'process_killed' }, expected: 'prevented',
  },
  {
    name: 'exit 999 + Defender stage alert + quarantined → prevented', exit: 999,
    flags: { defender_stage_detected: true }, actions: { defender_prevention_action: 'quarantined' }, expected: 'prevented',
  },
  { name: 'exit 999 + Defender stage alert, no action → detected', exit: 999, flags: { defender_stage_detected: true }, expected: 'detected' },
  {
    name: 'exit 999 + Falcon stage alert + kill_failed → detected (kill_failed is not prevention)', exit: 999,
    flags: { crowdstrike_stage_detected: true }, actions: { crowdstrike_prevention_action: 'kill_failed' }, expected: 'detected',
  },
  { name: 'exit 999 + bundle-level Defender flag only → inconclusive (sibling-stage risk)', exit: 999, flags: { defender_detected: true }, expected: 'inconclusive' },
  {
    name: 'Falcon kill code 0xE0000027 + stage alert + process_killed → prevented', exit: 3758096423,
    flags: { crowdstrike_stage_detected: true }, actions: { crowdstrike_prevention_action: 'process_killed' }, expected: 'prevented',
  },
  { name: 'exit 0 + Defender stage alert → inconclusive (exit 0 ran, never an EDR block)', exit: 0, flags: { defender_stage_detected: true }, expected: 'inconclusive' },
  { name: 'missing exit code + Defender stage alert → inconclusive (no code, no upgrade)', flags: { defender_stage_detected: true }, expected: 'inconclusive' },
  { name: 'missing exit code → inconclusive', expected: 'inconclusive' },
];

// The API's mapHitToExecution defaults every enrichment flag to false, so the
// console's `stage ?? bundle` fallback never fires on real data. The
// converter mirrors that, which is why the bundle-level-only rows stay
// unprotected here, exactly as on the backend.
function toExec(c: GoldenCase): EnrichedTestExecution {
  return {
    test_uuid: 'u', test_name: 'n', hostname: 'h', is_protected: false, org: 'o', timestamp: '2026-10-12T12:47:49Z',
    error_code: c.exit,
    is_bundle_control: c.bundle ?? false,
    category: c.category as EnrichedTestExecution['category'],
    defender_detected: c.flags?.defender_detected ?? false,
    defender_stage_detected: c.flags?.defender_stage_detected ?? false,
    defender_prevented: c.flags?.defender_prevented ?? false,
    crowdstrike_detected: c.flags?.crowdstrike_detected ?? false,
    crowdstrike_stage_detected: c.flags?.crowdstrike_stage_detected ?? false,
    crowdstrike_prevented: c.flags?.crowdstrike_prevented ?? false,
    defender_prevention_action: c.actions?.defender_prevention_action,
    crowdstrike_prevention_action: c.actions?.crowdstrike_prevention_action,
  };
}

describe('classifyExecution — golden table (twin of the backend)', () => {
  it.each(GOLDEN)('$name', (c) => {
    expect(classifyExecution(toExec(c))).toBe(c.expected);
  });
});
