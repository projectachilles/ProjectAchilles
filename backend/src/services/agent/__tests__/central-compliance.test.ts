import { describe, expect, it } from 'vitest';
import type { BundleControlResult, BundleResults } from '../../../types/agent.js';
import { applyCentralPosture, effectiveSentinelOnePolicy } from '../central-compliance.js';

function control(control_id: string): BundleControlResult {
  return {
    control_id, control_name: control_id, validator: 'vendor', exit_code: 0, compliant: false,
    status: 'UNKNOWN', severity: 'high', category: 'cyber-hygiene', subcategory: 'baseline',
    techniques: ['T1562.001'], tactics: ['defense-evasion'], expected: 'central evidence', actual: 'unknown',
    details: '', skipped: false, error_message: '',
  };
}

function bundle(controls: BundleControlResult[]): BundleResults {
  return {
    schema_version: '1.1', bundle_id: 'bundle', bundle_name: 'Bundle', bundle_category: 'cyber-hygiene',
    bundle_subcategory: 'baseline', execution_id: 'exec', started_at: '2026-11-03T00:00:00Z',
    completed_at: '2026-11-03T00:01:00Z', overall_exit_code: 999, total_controls: controls.length,
    passed_controls: 0, failed_controls: 0, controls,
  };
}

describe('Sophos central compliance', () => {
  it('uses authoritative endpoint tamper state and supports not-applicable', () => {
    const enabled = bundle([control('CH-SOP-006')]);
    expect(applyCentralPosture(enabled, {
      vendor: 'sophos', endpoint: { tamper_protection_supported: true, tamper_protection_enabled: true },
    })).toBe(true);
    expect(enabled.controls[0].status).toBe('PASS');

    const disabled = bundle([control('CH-SOP-006')]);
    applyCentralPosture(disabled, { vendor: 'sophos', endpoint: { tamper_protection_supported: true, tamper_protection_enabled: false } });
    expect(disabled.controls[0].status).toBe('FAIL');

    const unsupported = bundle([control('CH-SOP-006')]);
    applyCentralPosture(unsupported, { vendor: 'sophos', endpoint: { tamper_protection_supported: false } });
    expect(unsupported.controls[0].status).toBe('NOT_APPLICABLE');
  });

  it('evaluates check-in freshness and rejects stale endpoints', () => {
    const recent = bundle([control('CH-SOP-005')]);
    applyCentralPosture(recent, { vendor: 'sophos', endpoint: { last_seen_at: new Date().toISOString() } });
    expect(recent.controls[0].status).toBe('PASS');

    const stale = bundle([control('CH-SOP-005')]);
    applyCentralPosture(stale, { vendor: 'sophos', endpoint: { last_seen_at: new Date(Date.now() - 72 * 3_600_000).toISOString() } });
    expect(stale.controls[0].status).toBe('FAIL');
    expect(stale.controls[0].evidence?.threshold_hours).toBe(24);
  });

  it('does not infer effective prevention policy from tenant-wide policies', () => {
    const result = bundle([control('CH-SOP-004')]);
    applyCentralPosture(result, { vendor: 'sophos', endpoint: { health: 'good' } });
    expect(result.controls[0].status).toBe('UNKNOWN');
    expect(result.controls[0].details).toContain('not proof');
  });
});

describe('SentinelOne central compliance', () => {
  it('uses agent protect/detect state', () => {
    const protect = bundle([control('CH-S1-003')]);
    applyCentralPosture(protect, { vendor: 'sentinelone', endpoint: { is_active: true, mitigation_mode: 'protect' } });
    expect(protect.controls[0].status).toBe('PASS');

    const detect = bundle([control('CH-S1-003')]);
    applyCentralPosture(detect, { vendor: 'sentinelone', endpoint: { is_active: true, mitigation_mode: 'detect' } });
    expect(detect.controls[0].status).toBe('FAIL');
  });

  it('resolves non-inherited group policy before site and account', () => {
    const agent = { group_id: '1', site_id: '2', account_id: '3' };
    const policies = [
      { level: 'group', scope_id: '1', anti_tampering_on: false },
      { level: 'site', scope_id: '2', anti_tampering_on: true },
      { level: 'account', scope_id: '3', anti_tampering_on: true },
    ];
    expect(effectiveSentinelOnePolicy(agent, policies)?.scope_id).toBe('1');
    expect(effectiveSentinelOnePolicy({ ...agent, group_id: undefined }, policies)?.scope_id).toBe('2');
  });

  it('does not treat an unrecognized network state as disconnected', () => {
    const result = bundle([control('CH-S1-004')]);
    applyCentralPosture(result, {
      vendor: 'sentinelone', endpoint: { last_active_date: new Date().toISOString(), network_status: 'unknown' },
    });
    expect(result.controls[0].status).toBe('UNKNOWN');
  });

  it('fails on effective anti-tampering or disabled engines', () => {
    const result = bundle([control('CH-S1-005'), control('CH-S1-006')]);
    applyCentralPosture(result, {
      vendor: 'sentinelone',
      endpoint: { group_id: '1' },
      policies: [{ level: 'group', scope_id: '1', anti_tampering_on: false, engines_on: ['static'], engines_off: ['behavioral'] }],
    });
    expect(result.controls.map((c) => c.status)).toEqual(['FAIL', 'FAIL']);
    expect(result.compliance_status).toBe('non_compliant');
    expect(result.overall_exit_code).toBe(101);
  });

  it('reaches compliant only when every control has conclusive passing evidence', () => {
    const local = control('CH-S1-001');
    local.status = 'PASS';
    local.compliant = true;
    local.exit_code = 126;
    const result = bundle([local, control('CH-S1-003'), control('CH-S1-005')]);
    applyCentralPosture(result, {
      vendor: 'sentinelone',
      endpoint: { is_active: true, mitigation_mode: 'protect', group_id: '1' },
      policies: [{ level: 'group', scope_id: '1', anti_tampering_on: true }],
    });
    expect(result.assessment_complete).toBe(true);
    expect(result.compliance_status).toBe('compliant');
    expect(result.overall_exit_code).toBe(126);
  });
});

describe('central evidence absence', () => {
  it('leaves local results unchanged without a central endpoint', () => {
    const result = bundle([control('CH-S1-003')]);
    expect(applyCentralPosture(result, { vendor: 'sentinelone' })).toBe(false);
    expect(result.overall_exit_code).toBe(999);
  });
});
