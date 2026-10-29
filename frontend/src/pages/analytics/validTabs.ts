export type IntegrationTabId = 'defender' | 'crowdstrike' | 'sentinelone' | 'sophos';

/** Analytics tabs available for the configured integrations; an unconfigured integration has no tab. */
export function buildValidTabs(configured: Record<IntegrationTabId, boolean>) {
  return [
    'dashboard' as const,
    'executions' as const,
    'risk-acceptances' as const,
    ...(configured.defender ? ['defender' as const] : []),
    ...(configured.crowdstrike ? ['crowdstrike' as const] : []),
    ...(configured.sentinelone ? ['sentinelone' as const] : []),
    ...(configured.sophos ? ['sophos' as const] : []),
  ];
}
