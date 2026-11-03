import type { Client } from '@elastic/elasticsearch';
import type { BundleControlResult, BundleResults, TaskResult } from '../../types/agent.js';

type Raw = Record<string, unknown>;
type Vendor = 'sophos' | 'sentinelone';
type Status = NonNullable<BundleControlResult['status']>;

export interface CentralPostureEvidence {
  vendor: Vendor;
  endpoint?: Raw;
  policies?: Raw[];
  error?: string;
  maxLastSeenHours?: number;
}

const obj = (value: unknown): Raw => value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {};
const str = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const bool = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

function setResult(control: BundleControlResult, status: Status, actual: string, details: string, source: string, observedAt?: string, evidence?: Raw): void {
  control.status = status;
  control.compliant = status === 'PASS';
  control.skipped = false;
  control.exit_code = status === 'PASS' ? 126 : status === 'FAIL' ? 101 : status === 'ERROR' ? 999 : 0;
  control.actual = actual;
  control.details = details;
  control.evidence_source = source;
  control.error_message = '';
  if (observedAt) control.observed_at = observedAt;
  if (evidence) control.evidence = { ...(control.evidence ?? {}), ...evidence };
}

function recentResult(control: BundleControlResult, lastSeen: string | undefined, networkStatus: string | undefined, maxHours: number, source: string): void {
  if (!lastSeen || !Number.isFinite(Date.parse(lastSeen))) {
    setResult(control, 'UNKNOWN', 'Central last-active time was not reported', 'Cannot assess check-in freshness without a timestamp', source);
    return;
  }
  const normalizedNetwork = networkStatus?.toLowerCase();
  if (normalizedNetwork !== undefined && normalizedNetwork !== 'connected' && normalizedNetwork !== 'disconnected') {
    setResult(control, 'UNKNOWN', `last_active=${lastSeen}, network_status=${networkStatus}`, 'Central network state was not reported unambiguously', source, lastSeen);
    return;
  }
  const ageHours = (Date.now() - Date.parse(lastSeen)) / 3_600_000;
  const recent = ageHours >= 0 && ageHours <= maxHours;
  const connected = normalizedNetwork === undefined || normalizedNetwork === 'connected';
  const pass = recent && connected;
  setResult(control, pass ? 'PASS' : 'FAIL',
    `last_active=${lastSeen}, age_hours=${ageHours.toFixed(1)}${networkStatus ? `, network_status=${networkStatus}` : ''}`,
    pass ? `Recent central check-in within ${maxHours} hours` : `Check-in is stale or the endpoint is disconnected; threshold ${maxHours} hours`,
    source, lastSeen, { last_active: lastSeen, age_hours: Number(ageHours.toFixed(1)), network_status: networkStatus, threshold_hours: maxHours });
}

export function effectiveSentinelOnePolicy(agent: Raw, policies: Raw[]): Raw | undefined {
  const byScope = (level: string, id: string | undefined) => id && policies.find((p) => p.level === level && p.scope_id === id);
  const group = byScope('group', str(agent.group_id));
  if (group && group.inherits !== true && (group.anti_tampering_on !== undefined || group.engines_on !== undefined || group.engines_off !== undefined)) return group;
  const site = byScope('site', str(agent.site_id));
  if (site) return site;
  return byScope('account', str(agent.account_id)) || undefined;
}

function applySophos(control: BundleControlResult, endpoint: Raw, maxHours: number): boolean {
  const source = 'sophos_central_endpoint_api';
  switch (control.control_id) {
    case 'CH-SOP-004': {
      const policy = obj(endpoint.effective_prevention_policy);
      const deviations = Array.isArray(policy.deviations) ? policy.deviations : undefined;
      if (!str(policy.policy_id) || deviations === undefined) {
        setResult(control, 'UNKNOWN', 'No endpoint-specific effective prevention policy in the posture snapshot',
          'Tenant-wide policies are not proof of this endpoint’s effective policy', source);
      } else {
        const pass = policy.enabled !== false && deviations.length === 0;
        setResult(control, pass ? 'PASS' : 'FAIL', `policy_id=${policy.policy_id}, enabled=${policy.enabled !== false}, deviations=${deviations.length}`,
          pass ? 'Effective prevention policy is enabled with no tracked deviations' : 'Effective policy is disabled or has protection deviations', source, undefined,
          { policy_id: policy.policy_id, enabled: policy.enabled !== false, deviations });
      }
      return true;
    }
    case 'CH-SOP-005':
      recentResult(control, str(endpoint.last_seen_at), undefined, maxHours, source);
      return true;
    case 'CH-SOP-006': {
      const supported = bool(endpoint.tamper_protection_supported);
      const enabled = bool(endpoint.tamper_protection_enabled);
      if (supported === false) {
        setResult(control, 'NOT_APPLICABLE', 'Tamper protection is not supported on this endpoint', 'Sophos reports tamper protection as unsupported', source, undefined, { supported, enabled });
      } else if (enabled === undefined) {
        setResult(control, 'UNKNOWN', 'Tamper state was not reported', 'No authoritative endpoint tamper state is available', source);
      } else {
        setResult(control, enabled ? 'PASS' : 'FAIL', `tamperProtectionEnabled=${enabled}`,
          enabled ? 'Tamper protection is enabled centrally' : 'Tamper protection is disabled centrally', source, undefined, { supported, enabled });
      }
      return true;
    }
    default:
      return false;
  }
}

function applySentinelOne(control: BundleControlResult, agent: Raw, policies: Raw[], maxHours: number): boolean {
  const source = 'sentinelone_central_api';
  switch (control.control_id) {
    case 'CH-S1-003': {
      const active = bool(agent.is_active);
      const mode = str(agent.mitigation_mode)?.toLowerCase();
      if (active === false || mode === 'detect') {
        setResult(control, 'FAIL', `is_active=${active}, mitigation_mode=${mode ?? 'unknown'}`, 'Agent is inactive or in detect-only mode', source, undefined, { is_active: active, mitigation_mode: mode });
      } else if (active === true && mode === 'protect') {
        setResult(control, 'PASS', 'is_active=true, mitigation_mode=protect', 'Agent is active in protect mode', source, undefined, { is_active: active, mitigation_mode: mode });
      } else {
        setResult(control, 'UNKNOWN', `is_active=${active ?? 'unknown'}, mitigation_mode=${mode ?? 'unknown'}`, 'Agent prevention state was not reported unambiguously', source);
      }
      return true;
    }
    case 'CH-S1-004':
      recentResult(control, str(agent.last_active_date), str(agent.network_status), maxHours, source);
      return true;
    case 'CH-S1-005': {
      const policy = effectiveSentinelOnePolicy(agent, policies);
      const enabled = bool(policy?.anti_tampering_on);
      if (!policy || enabled === undefined) {
        setResult(control, 'UNKNOWN', 'No effective anti-tampering policy value', 'The agent scope did not resolve to a policy with antiTamperingOn', source);
      } else {
        setResult(control, enabled ? 'PASS' : 'FAIL', `antiTamperingOn=${enabled}, policy=${policy.scope_id ?? policy.level ?? 'effective'}`,
          enabled ? 'Anti-tampering is enabled in the effective policy' : 'Anti-tampering is disabled in the effective policy', source, undefined,
          { anti_tampering_on: enabled, policy_level: policy.level, policy_scope_id: policy.scope_id });
      }
      return true;
    }
    case 'CH-S1-006': {
      const policy = effectiveSentinelOnePolicy(agent, policies);
      const on = Array.isArray(policy?.engines_on) ? policy.engines_on : [];
      const off = Array.isArray(policy?.engines_off) ? policy.engines_off : [];
      if (!policy || (on.length === 0 && off.length === 0)) {
        setResult(control, 'UNKNOWN', 'No effective engine state was reported', 'The effective policy has no engine evidence', source);
      } else {
        const pass = off.length === 0 && on.length > 0;
        setResult(control, pass ? 'PASS' : 'FAIL', `engines_on=${on.length}, engines_off=${off.length}`,
          pass ? 'All engines reported by the effective policy are enabled' : `Disabled engines: ${off.join(', ')}`, source, undefined,
          { engines_on: on, engines_off: off, policy_level: policy.level, policy_scope_id: policy.scope_id });
      }
      return true;
    }
    default:
      return false;
  }
}

export function applyCentralPosture(bundle: BundleResults, evidence: CentralPostureEvidence): boolean {
  if (!evidence.endpoint) return false;
  let applied = false;
  const maxHours = evidence.maxLastSeenHours ?? 24;
  for (const control of bundle.controls) {
    const changed = evidence.vendor === 'sophos'
      ? applySophos(control, evidence.endpoint, maxHours)
      : applySentinelOne(control, evidence.endpoint, evidence.policies ?? [], maxHours);
    applied = applied || changed;
  }
  if (applied) recalculateBundle(bundle);
  return applied;
}

export function recalculateBundle(bundle: BundleResults): void {
  const counts = { PASS: 0, FAIL: 0, SKIPPED: 0, UNKNOWN: 0, ERROR: 0, NOT_APPLICABLE: 0, NOT_EVALUATED: 0 } as Record<Status, number>;
  for (const control of bundle.controls) {
    const status = control.status ?? (control.skipped ? 'SKIPPED' : control.compliant ? 'PASS' : 'FAIL');
    counts[status]++;
  }
  bundle.passed_controls = counts.PASS;
  bundle.failed_controls = counts.FAIL;
  bundle.skipped_controls = counts.SKIPPED;
  bundle.unknown_controls = counts.UNKNOWN;
  bundle.error_controls = counts.ERROR;
  bundle.not_applicable_controls = counts.NOT_APPLICABLE;
  bundle.not_evaluated_controls = counts.NOT_EVALUATED;
  bundle.total_controls = bundle.controls.length;
  const evaluated = counts.PASS + counts.FAIL;
  const incomplete = counts.SKIPPED + counts.UNKNOWN + counts.ERROR + counts.NOT_EVALUATED > 0 || !!bundle.context_error;
  bundle.assessment_complete = !incomplete && evaluated > 0;
  if (evaluated === 0) {
    bundle.execution_status = 'error';
    bundle.compliance_status = 'not_assessed';
    bundle.overall_exit_code = 999;
  } else if (counts.FAIL > 0) {
    bundle.execution_status = incomplete ? 'partial' : 'completed';
    bundle.compliance_status = 'non_compliant';
    bundle.overall_exit_code = 101;
  } else if (incomplete) {
    bundle.execution_status = 'partial';
    bundle.compliance_status = 'incomplete';
    bundle.overall_exit_code = 999;
  } else {
    bundle.execution_status = 'completed';
    bundle.compliance_status = 'compliant';
    bundle.overall_exit_code = 126;
  }
}

function vendorOf(bundle: BundleResults): Vendor | undefined {
  for (const control of bundle.controls) {
    if (control.evidence_source === 'central_sophos_api_required') return 'sophos';
    if (control.evidence_source === 'central_sentinelone_api_required') return 'sentinelone';
  }
  return undefined;
}

function hostnames(hostname: string): string[] {
  return Array.from(new Set([hostname, hostname.toUpperCase(), hostname.toLowerCase()]));
}

async function search(client: Client, index: string, query: Raw, size = 1): Promise<Raw[]> {
  const response = await client.search({ index, size, query } as never);
  return ((response.hits?.hits ?? []) as Array<{ _source?: Raw }>).flatMap((hit) => hit._source ? [hit._source] : []);
}

async function loadEvidence(client: Client, vendor: Vendor, hostname: string): Promise<CentralPostureEvidence> {
  const evidence: CentralPostureEvidence = { vendor, maxLastSeenHours: configuredLastSeenHours() };
  try {
    if (vendor === 'sophos') {
      const hits = await search(client, 'achilles-sophos', {
        bool: { filter: [{ term: { doc_type: 'endpoint_health' } }, { terms: { 'endpoint.hostname': hostnames(hostname) } }] },
      });
      evidence.endpoint = hits.length ? obj(hits[0].endpoint) : undefined;
      return evidence;
    }
    const agents = await search(client, 'achilles-sentinelone-posture', {
      bool: { filter: [{ term: { doc_type: 'agent' } }, { terms: { computer_name: hostnames(hostname) } }] },
    });
    evidence.endpoint = agents[0];
    if (evidence.endpoint) {
      evidence.policies = await search(client, 'achilles-sentinelone-posture', { term: { doc_type: 'policy' } }, 1000);
    }
    return evidence;
  } catch (err) {
    evidence.error = errorText(err);
    return evidence;
  }
}

function configuredLastSeenHours(): number {
  const parsed = Number(process.env.F0_EDR_LAST_SEEN_HOURS ?? 24);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 720 ? Math.floor(parsed) : 24;
}

export async function enrichBundleWithCentralPosture(client: Client, result: TaskResult): Promise<boolean> {
  const bundle = result.bundle_results;
  if (!bundle) return false;
  const vendor = vendorOf(bundle);
  if (!vendor) return false;
  const evidence = await loadEvidence(client, vendor, result.hostname);
  const applied = applyCentralPosture(bundle, evidence);
  if (applied) result.exit_code = bundle.overall_exit_code;
  return applied;
}
