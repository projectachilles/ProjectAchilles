import { describe, it, expect } from 'vitest';
import { computeProtectionScore, type ProtectionPolicyDoc } from '../protection-score.js';

/** An agent that passes every check, overridable per test. */
function agent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '1', siteId: 'S1', groupId: 'G1', accountId: 'A1',
    isActive: true, mitigationMode: 'protect', isUpToDate: true, infected: false,
    firewallEnabled: true, encryptedApplications: true,
    ...over,
  };
}

const sitePolicy = (antiTamper: boolean, extra: Partial<ProtectionPolicyDoc> = {}): ProtectionPolicyDoc =>
  ({ level: 'site', scope_id: 'S1', anti_tampering_on: antiTamper, raw: {}, ...extra });
const inheritingGroup: ProtectionPolicyDoc = { level: 'group', scope_id: 'G1', inherits: true };

const check = (r: ReturnType<typeof computeProtectionScore>, id: string) => r.checks.find((c) => c.id === id)!;

describe('computeProtectionScore', () => {
  it('scores the share of agents that pass every check', () => {
    const r = computeProtectionScore(
      [agent(), agent({ id: '2' }), agent({ id: '3', mitigationMode: 'detect' }), agent({ id: '4', infected: true })],
      [sitePolicy(true), inheritingGroup],
    );
    expect(r).toMatchObject({ score: 50, protected: 2, scored: 4, total: 4 });
    expect(check(r, 'protect_mode')).toMatchObject({ evaluated: 4, passed: 3 });
    expect(check(r, 'no_active_threat')).toMatchObject({ evaluated: 4, passed: 3 });
    expect(check(r, 'anti_tamper')).toMatchObject({ evaluated: 4, passed: 4 });
  });

  it('rounds to one decimal', () => {
    const agents = [agent(), agent({ id: '2' }), agent({ id: '3', isUpToDate: false })];
    expect(computeProtectionScore(agents, [sitePolicy(true)]).score).toBe(66.7);
  });

  it('skips a field the agent does not report instead of failing it', () => {
    const r = computeProtectionScore([agent({ firewallEnabled: undefined, encryptedApplications: 'yes' })], [sitePolicy(true)]);
    expect(r.score).toBe(100);
    expect(check(r, 'firewall_control')).toMatchObject({ evaluated: 0, passed: 0 });
    expect(check(r, 'disk_encrypted')).toMatchObject({ evaluated: 0, passed: 0 });
  });

  it('does not count a network-isolated agent as unprotected', () => {
    expect(computeProtectionScore([agent({ networkStatus: 'disconnected' })], [sitePolicy(true)]).score).toBe(100);
  });

  it('fails an agent that stopped reporting', () => {
    expect(computeProtectionScore([agent({ isActive: false })], [sitePolicy(true)]).score).toBe(0);
  });

  describe('anti-tamper comes from the policy that applies to the agent', () => {
    it("uses the group's own policy when the group does not inherit", () => {
      const r = computeProtectionScore([agent()], [
        sitePolicy(true),
        { level: 'group', scope_id: 'G1', inherits: false, anti_tampering_on: false, raw: {} },
      ]);
      expect(r.score).toBe(0);
      expect(check(r, 'anti_tamper')).toMatchObject({ evaluated: 1, passed: 0 });
    });

    it("uses the site's policy when the group inherits", () => {
      expect(computeProtectionScore([agent()], [sitePolicy(false), inheritingGroup]).score).toBe(0);
      expect(computeProtectionScore([agent()], [sitePolicy(true), inheritingGroup]).score).toBe(100);
    });

    it("treats a group policy that wasn't read (403, over the cap) as unknown, not off", () => {
      const r = computeProtectionScore([agent()], [
        sitePolicy(false),
        { level: 'group', scope_id: 'G1', inherits: false, policy_error: 'HTTP 403' } as ProtectionPolicyDoc,
      ]);
      expect(check(r, 'anti_tamper').evaluated).toBe(0);
      expect(r.score).toBe(100);
    });

    it("treats an unread site policy as unknown instead of using the account's", () => {
      const r = computeProtectionScore([agent()], [
        { level: 'site', scope_id: 'S1', anti_tampering_on: undefined },
        { level: 'account', scope_id: 'A1', anti_tampering_on: false, raw: {} },
      ]);
      expect(check(r, 'anti_tamper').evaluated).toBe(0);
    });

    it('falls back to the account policy when the site has no policy doc', () => {
      const r = computeProtectionScore([agent({ siteId: 'S9' })], [{ level: 'account', scope_id: 'A1', anti_tampering_on: false, raw: {} }]);
      expect(check(r, 'anti_tamper')).toMatchObject({ evaluated: 1, passed: 0 });
    });

    it('skips anti-tamper when no policies were read at all', () => {
      const r = computeProtectionScore([agent()], []);
      expect(check(r, 'anti_tamper').evaluated).toBe(0);
      expect(r.score).toBe(100);
    });
  });

  it('is null with no agents, and leaves agents with nothing to evaluate out of the denominator', () => {
    expect(computeProtectionScore([], [])).toMatchObject({ score: null, protected: 0, scored: 0, total: 0 });
    const r = computeProtectionScore([agent(), { id: '9' }], [sitePolicy(true)]);
    expect(r).toMatchObject({ score: 100, scored: 1, total: 2 });
  });
});
