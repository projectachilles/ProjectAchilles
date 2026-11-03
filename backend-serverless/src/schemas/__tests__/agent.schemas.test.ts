import { describe, it, expect } from 'vitest';
import { BundleControlResultSchema } from '../agent.schemas.js';

const base = {
  control_id: 'T1059.001', control_name: 'PowerShell', validator: 'Stage 1',
  exit_code: 101, compliant: false, severity: 'high', category: 'intel-driven',
  subcategory: '', techniques: ['T1059.001'], tactics: ['execution'],
  expected: '', actual: '', details: '', skipped: false, error_message: '',
};

describe('BundleControlResultSchema description', () => {
  it('keeps a stage description', () => {
    const parsed = BundleControlResultSchema.parse({ ...base, description: 'PowerShell recon' });
    expect(parsed.description).toBe('PowerShell recon');
  });

  it('still parses a control without a description (old agents)', () => {
    const parsed = BundleControlResultSchema.parse(base);
    expect(parsed.description).toBeUndefined();
  });

  it('keeps compliance status, benchmark, applicability, and evidence', () => {
    const parsed = BundleControlResultSchema.parse({
      ...base,
      status: 'UNKNOWN',
      applicability: 'requires an active Defender service',
      benchmark: { framework: 'cis_benchmark', product: 'Windows 11', version: '5.1.1', profile: 'Level 1', recommendation_id: '18.10.1.1' },
      evidence_source: 'local_registry',
      observed_at: '2026-11-03T12:00:00Z',
      remediation: 'Enable the policy',
      evidence: { configured: false },
    });
    expect(parsed.status).toBe('UNKNOWN');
    expect(parsed.benchmark?.recommendation_id).toBe('18.10.1.1');
    expect(parsed.evidence).toEqual({ configured: false });
  });
});
