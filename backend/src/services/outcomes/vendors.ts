/**
 * EDR integrations whose enrichment writes `f0rtika.<key>_*` flags on result
 * docs. The fields edr.ts fetches and the vendors verdict.ts names both come
 * from this list, and it must match the vendors in reports/stageOutcome.ts
 * `classifyStage` (Analytics' label rule).
 */
export const EDR_VENDORS = [
  { key: 'defender', name: 'Defender' },
  { key: 'crowdstrike', name: 'CrowdStrike' },
  { key: 'sentinelone', name: 'SentinelOne' },
] as const;
