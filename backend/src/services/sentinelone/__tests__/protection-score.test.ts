import { describe, it, expect } from 'vitest';
import { computeProtectionScore, REPORTING_WINDOW_DAYS, type ProtectionPolicyDoc } from '../protection-score.js';

const NOW = Date.parse('2026-10-26T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

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

  describe('reporting: checked in within the window, not online right now', () => {
    const offline = (over: Record<string, unknown>) => computeProtectionScore([agent({ isActive: false, ...over })], [sitePolicy(true)], NOW);

    it('passes an offline agent that checked in within the window', () => {
      expect(offline({ lastActiveDate: daysAgo(2.5) }).score).toBe(100);
      expect(offline({ lastActiveDate: daysAgo(REPORTING_WINDOW_DAYS) }).score).toBe(100);
    });

    it('fails an agent that has not checked in for longer than the window', () => {
      const r = offline({ lastActiveDate: daysAgo(REPORTING_WINDOW_DAYS + 0.01) });
      expect(r.score).toBe(0);
      expect(check(r, 'reporting')).toMatchObject({ evaluated: 1, passed: 0 });
    });

    it('passes an active agent whatever its last-active date says', () => {
      expect(computeProtectionScore([agent({ lastActiveDate: daysAgo(30) })], [sitePolicy(true)], NOW).score).toBe(100);
    });

    it('falls back to isActive without a last-active date, and fails an unparseable one', () => {
      expect(offline({}).score).toBe(0);
      expect(offline({ lastActiveDate: 'not a date' }).score).toBe(0);
    });

    it('skips the check when the agent reports neither field', () => {
      const r = computeProtectionScore([agent({ isActive: undefined })], [sitePolicy(true)], NOW);
      expect(check(r, 'reporting').evaluated).toBe(0);
    });

    it('names the window in the label', () => {
      expect(check(offline({}), 'reporting').label).toBe(`Checked in (${REPORTING_WINDOW_DAYS} days)`);
    });
  });

  describe('firewall control', () => {
    it('is skipped, as not deployed, when no agent has it on', () => {
      const r = computeProtectionScore([agent({ firewallEnabled: false }), agent({ id: '2', firewallEnabled: false })], [sitePolicy(true)]);
      expect(r.score).toBe(100);
      expect(check(r, 'firewall_control')).toEqual({ id: 'firewall_control', label: 'Firewall control on', evaluated: 0, passed: 0, notDeployed: true });
    });

    it('counts for every agent once one agent has it on', () => {
      const r = computeProtectionScore([agent(), agent({ id: '2', firewallEnabled: false })], [sitePolicy(true)]);
      expect(r.score).toBe(50);
      expect(check(r, 'firewall_control')).toEqual({ id: 'firewall_control', label: 'Firewall control on', evaluated: 2, passed: 1 });
    });

    it('is not flagged as not deployed when no agent reports the field', () => {
      const r = computeProtectionScore([agent({ firewallEnabled: undefined })], [sitePolicy(true)]);
      expect(check(r, 'firewall_control').notDeployed).toBeUndefined();
    });
  });

  it('scores a laptop fleet that is offline overnight and has no Firewall Control (sb.gob.do, Oct 26 2026)', () => {
    const fleet = [2.6, 2.5, 2.5, 2.5, 2.4].map((d, i) =>
      agent({ id: String(i), isActive: false, lastActiveDate: daysAgo(d), firewallEnabled: false, networkStatus: 'connected' }));
    expect(computeProtectionScore(fleet, [sitePolicy(true), inheritingGroup], NOW)).toMatchObject({ score: 100, protected: 5, scored: 5, total: 5 });
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
