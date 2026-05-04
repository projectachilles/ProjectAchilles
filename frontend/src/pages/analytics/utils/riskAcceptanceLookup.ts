import type { EnrichedTestExecution, RiskAcceptance, RiskScope } from '@/services/api/analytics';

// Mirrors backend buildExclusionFilter logic:
// explicit `scope` wins; legacy records (no scope) infer from hostname presence.
export function effectiveScope(acc: RiskAcceptance): RiskScope {
  return acc.scope ?? (acc.hostname ? 'host' : 'global');
}

export function lookupKey(testName: string, controlId?: string): string {
  return controlId ? `${testName}::${controlId}` : testName;
}

export function findAcceptanceForExec(
  exec: Pick<EnrichedTestExecution, 'test_name' | 'control_id' | 'hostname'>,
  riskAcceptances: Map<string, RiskAcceptance[]> | null,
): RiskAcceptance | undefined {
  if (!riskAcceptances) return undefined;
  const matches = riskAcceptances.get(lookupKey(exec.test_name, exec.control_id));
  if (!matches || matches.length === 0) return undefined;

  const hostMatch = matches.find(
    a => effectiveScope(a) === 'host' && a.hostname === exec.hostname,
  );
  if (hostMatch) return hostMatch;

  return matches.find(a => effectiveScope(a) === 'global');
}
