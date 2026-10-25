// Achilles "Endpoint Protection" score for SentinelOne.
//
// SentinelOne has no posture score like Defender's Secure Score or Falcon's
// ZTA, so this one is ours: the share of agents that pass every check below,
// computed by the posture pass from the agent inventory and the policies it
// already fetches. It is labelled as an Achilles score, never as SentinelOne's.
//
// A check is evaluated for an agent only when the agent (or its effective
// policy) reports the field. An unreported field is skipped, not failed, so a
// field another console version names differently can't sink the score.
//
// networkStatus is deliberately not a check: "disconnected" means SentinelOne
// network-isolated the endpoint (contained), not that it is unprotected.
// Reporting is `isActive`.

export type ProtectionCheckId =
  | 'reporting'
  | 'protect_mode'
  | 'up_to_date'
  | 'no_active_threat'
  | 'anti_tamper'
  | 'firewall_control'
  | 'disk_encrypted';

export interface ProtectionCheckResult {
  id: ProtectionCheckId;
  label: string;
  /** Agents the check could be evaluated for. */
  evaluated: number;
  passed: number;
}

export interface SentinelOneProtectionScore {
  /** 0-100, one decimal; null when no agent could be scored. */
  score: number | null;
  /** Agents passing every check evaluated for them. */
  protected: number;
  /** Agents with at least one evaluated check (the score's denominator). */
  scored: number;
  /** Agents in the inventory. */
  total: number;
  checks: ProtectionCheckResult[];
}

type Raw = Record<string, unknown>;

/** The policy-doc fields the score reads (posture.service policy docs). */
export interface ProtectionPolicyDoc {
  level?: unknown;
  scope_id?: unknown;
  inherits?: unknown;
  anti_tampering_on?: unknown;
  /** Present when the policy was fetched; absent for inherited / unread scopes. */
  raw?: unknown;
}

const CHECKS: Array<{ id: ProtectionCheckId; label: string }> = [
  { id: 'reporting', label: 'Reporting' },
  { id: 'protect_mode', label: 'Protect mode' },
  { id: 'up_to_date', label: 'Agent up to date' },
  { id: 'no_active_threat', label: 'No active threat' },
  { id: 'anti_tamper', label: 'Anti-tamper on' },
  { id: 'firewall_control', label: 'Firewall control on' },
  { id: 'disk_encrypted', label: 'Disk encrypted' },
];

const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const id = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined);

/**
 * Anti-tamper from the policy that applies to the agent: its group's own
 * policy, else (the group inherits) its site's, else its account's. Undefined
 * when that policy wasn't read (403, over the group cap): unknown, not off.
 */
function effectiveAntiTamper(
  agent: Raw,
  policies: { group: Map<string, ProtectionPolicyDoc>; site: Map<string, ProtectionPolicyDoc>; account: Map<string, ProtectionPolicyDoc> },
): boolean | undefined {
  const fromDoc = (doc: ProtectionPolicyDoc | undefined): boolean | undefined | 'missing' =>
    !doc ? 'missing' : doc.raw ? bool(doc.anti_tampering_on) : undefined;

  const groupId = id(agent.groupId);
  const group = groupId ? policies.group.get(groupId) : undefined;
  if (group && group.inherits !== true) {
    const v = fromDoc(group);
    return v === 'missing' ? undefined : v;
  }
  const siteId = id(agent.siteId);
  const site = fromDoc(siteId ? policies.site.get(siteId) : undefined);
  if (site !== 'missing') {
    if (site !== undefined) return site;
    // The site policy wasn't read: don't guess from the account's.
    return undefined;
  }
  const accountId = id(agent.accountId);
  const account = fromDoc(accountId ? policies.account.get(accountId) : undefined);
  return account === 'missing' ? undefined : account;
}

/** Each check's verdict for one agent: true pass, false fail, undefined not evaluated. */
function agentChecks(agent: Raw, antiTamper: boolean | undefined): Record<ProtectionCheckId, boolean | undefined> {
  const mode = typeof agent.mitigationMode === 'string' && agent.mitigationMode ? agent.mitigationMode : undefined;
  const infected = bool(agent.infected);
  return {
    reporting: bool(agent.isActive),
    protect_mode: mode === undefined ? undefined : mode === 'protect',
    up_to_date: bool(agent.isUpToDate),
    no_active_threat: infected === undefined ? undefined : !infected,
    anti_tamper: antiTamper,
    firewall_control: bool(agent.firewallEnabled),
    disk_encrypted: bool(agent.encryptedApplications),
  };
}

export function computeProtectionScore(agents: Raw[], policyDocs: ProtectionPolicyDoc[]): SentinelOneProtectionScore {
  const policies = { group: new Map<string, ProtectionPolicyDoc>(), site: new Map<string, ProtectionPolicyDoc>(), account: new Map<string, ProtectionPolicyDoc>() };
  for (const doc of policyDocs) {
    const scopeId = id(doc.scope_id);
    if (!scopeId) continue;
    if (doc.level === 'group') policies.group.set(scopeId, doc);
    else if (doc.level === 'site') policies.site.set(scopeId, doc);
    else if (doc.level === 'account') policies.account.set(scopeId, doc);
  }

  const tally = new Map(CHECKS.map((c) => [c.id, { evaluated: 0, passed: 0 }]));
  let protectedCount = 0;
  let scored = 0;
  for (const agent of agents) {
    const verdicts = agentChecks(agent, effectiveAntiTamper(agent, policies));
    let evaluated = 0;
    let allPass = true;
    for (const c of CHECKS) {
      const v = verdicts[c.id];
      if (v === undefined) continue;
      evaluated++;
      const t = tally.get(c.id)!;
      t.evaluated++;
      if (v) t.passed++;
      else allPass = false;
    }
    if (evaluated === 0) continue;
    scored++;
    if (allPass) protectedCount++;
  }

  return {
    score: scored > 0 ? Math.round((protectedCount / scored) * 1000) / 10 : null,
    protected: protectedCount,
    scored,
    total: agents.length,
    checks: CHECKS.map((c) => ({ id: c.id, label: c.label, ...tally.get(c.id)! })),
  };
}
