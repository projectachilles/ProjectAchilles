import { describe, it, expect } from 'vitest';
import { effectiveScope, lookupKey, findAcceptanceForExec } from '../riskAcceptanceLookup';
import type { RiskAcceptance } from '@/services/api/analytics';

function acceptance(overrides: Partial<RiskAcceptance> & { test_name: string }): RiskAcceptance {
  return {
    acceptance_id: 'acc-1',
    justification: 'because',
    accepted_by: 'user-1',
    accepted_by_name: 'User One',
    accepted_at: '2026-05-01T00:00:00Z',
    status: 'active',
    ...overrides,
  };
}

describe('effectiveScope', () => {
  it('honors explicit global even when hostname is set', () => {
    // The "All Hosts (from LT-TPL-L50)" bug: persisted records had both fields.
    expect(effectiveScope(acceptance({
      test_name: 't', scope: 'global', hostname: 'LT-TPL-L50',
    }))).toBe('global');
  });

  it('honors explicit host', () => {
    expect(effectiveScope(acceptance({
      test_name: 't', scope: 'host', hostname: 'LT-TPL-L50',
    }))).toBe('host');
  });

  it('infers host from hostname presence on legacy records (no scope)', () => {
    expect(effectiveScope(acceptance({
      test_name: 't', hostname: 'LT-TPL-L50',
    }))).toBe('host');
  });

  it('infers global on legacy records with no hostname', () => {
    expect(effectiveScope(acceptance({ test_name: 't' }))).toBe('global');
  });
});

describe('lookupKey', () => {
  it('uses test_name only for non-bundle rows', () => {
    expect(lookupKey('Block X')).toBe('Block X');
  });

  it('joins test_name and control_id with :: for bundle controls', () => {
    expect(lookupKey('Block X', 'CH-ASR-007')).toBe('Block X::CH-ASR-007');
  });
});

describe('findAcceptanceForExec', () => {
  const exec50 = { test_name: 'Block X', control_id: 'CH-ASR-007', hostname: 'LT-TPL-L50' };
  const exec123 = { test_name: 'Block X', control_id: 'CH-ASR-007', hostname: 'LT-TPL-L123' };

  it('returns undefined when map is null', () => {
    expect(findAcceptanceForExec(exec50, null)).toBeUndefined();
  });

  it('returns undefined when no key match', () => {
    const map = new Map([['Other Test::CH-ASR-007', [acceptance({ test_name: 'Other Test' })]]]);
    expect(findAcceptanceForExec(exec50, map)).toBeUndefined();
  });

  it('REGRESSION: returns global acceptance for non-origin host even when stale hostname is set', () => {
    // The exact shape of the corrupt record on tpsgl: scope=global with hostname='LT-TPL-L50'.
    const acc = acceptance({
      test_name: 'Block X',
      control_id: 'CH-ASR-007',
      scope: 'global',
      hostname: 'LT-TPL-L50',
    });
    const map = new Map([['Block X::CH-ASR-007', [acc]]]);

    // Both hosts must resolve to the same global acceptance.
    expect(findAcceptanceForExec(exec50, map)).toBe(acc);
    expect(findAcceptanceForExec(exec123, map)).toBe(acc);
  });

  it('host-specific acceptance only matches its hostname', () => {
    const acc = acceptance({
      test_name: 'Block X',
      control_id: 'CH-ASR-007',
      scope: 'host',
      hostname: 'LT-TPL-L50',
    });
    const map = new Map([['Block X::CH-ASR-007', [acc]]]);

    expect(findAcceptanceForExec(exec50, map)).toBe(acc);
    expect(findAcceptanceForExec(exec123, map)).toBeUndefined();
  });

  it('host-specific takes precedence over a coexisting global', () => {
    const hostAcc = acceptance({
      acceptance_id: 'host-acc',
      test_name: 'Block X', control_id: 'CH-ASR-007',
      scope: 'host', hostname: 'LT-TPL-L50',
    });
    const globalAcc = acceptance({
      acceptance_id: 'global-acc',
      test_name: 'Block X', control_id: 'CH-ASR-007',
      scope: 'global',
    });
    const map = new Map([['Block X::CH-ASR-007', [hostAcc, globalAcc]]]);

    // L50 row gets host-specific match
    expect(findAcceptanceForExec(exec50, map)).toBe(hostAcc);
    // L123 row falls back to global
    expect(findAcceptanceForExec(exec123, map)).toBe(globalAcc);
  });

  it('legacy global record (no scope, no hostname) still matches all hosts', () => {
    const acc = acceptance({ test_name: 'Block X', control_id: 'CH-ASR-007' });
    const map = new Map([['Block X::CH-ASR-007', [acc]]]);
    expect(findAcceptanceForExec(exec50, map)).toBe(acc);
    expect(findAcceptanceForExec(exec123, map)).toBe(acc);
  });

  it('legacy host record (no scope, hostname set) only matches that host', () => {
    const acc = acceptance({
      test_name: 'Block X', control_id: 'CH-ASR-007', hostname: 'LT-TPL-L50',
    });
    const map = new Map([['Block X::CH-ASR-007', [acc]]]);
    expect(findAcceptanceForExec(exec50, map)).toBe(acc);
    expect(findAcceptanceForExec(exec123, map)).toBeUndefined();
  });

  it('non-bundle test rows match by test_name alone', () => {
    const acc = acceptance({ test_name: 'Standalone Test', scope: 'global' });
    const map = new Map([['Standalone Test', [acc]]]);
    expect(findAcceptanceForExec(
      { test_name: 'Standalone Test', hostname: 'LT-TPL-L123' },
      map,
    )).toBe(acc);
  });
});
