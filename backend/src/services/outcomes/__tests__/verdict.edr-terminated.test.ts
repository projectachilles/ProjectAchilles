import { describe, it, expect } from 'vitest';
import { edrTerminatedVerdict } from '../verdict.js';
import type { EdrTermination } from '../../edr/agent-kill-evidence.js';

const termination = (vendors: EdrTermination['vendors']): EdrTermination => ({
  vendors,
  alert_ids: vendors.map((v) => `${v}-alert-1`),
  killed_at: '2026-10-26T16:06:32.000Z',
  reconciled_at: '2026-10-26T16:12:00.000Z',
});

describe('edrTerminatedVerdict', () => {
  it('edrTerminatedVerdict is protected with stages unknown', () => {
    const v = edrTerminatedVerdict(termination(['sentinelone']));
    expect(v).toEqual({
      state: 'protected',
      reason: 'Stopped by SentinelOne: the EDR terminated the agent and the test. Stages not reported.',
      edr: 'SentinelOne: prevented (agent terminated)',
      stages: [],
      stagesText: 'stages unknown',
    });
  });

  it('names every vendor, in the stored (earliest alert first) order', () => {
    const v = edrTerminatedVerdict(termination(['sentinelone', 'defender']));
    expect(v.state).toBe('protected');
    expect(v.reason).toBe('Stopped by SentinelOne and Defender: the EDR terminated the agent and the test. Stages not reported.');
    expect(v.edr).toBe('SentinelOne: prevented (agent terminated); Defender: prevented (agent terminated)');
  });
});
