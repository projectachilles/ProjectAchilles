/**
 * Alert sources that are a person responding, not the EDR itself. Mirrors the
 * backend's ANALYST_INITIATED_THREAT_SOURCES (sentinelone/normalize.ts), where
 * these never count as prevention. Keyed by the alert's `initiated_by`, so a
 * future vendor that reports one gets the same label.
 */
const ANALYST_RESPONSES: Record<string, { label: string; detail: string }> = {
  dv_command: {
    label: 'Analyst response (Deep Visibility)',
    detail:
      'An analyst mitigated this process from a SentinelOne Deep Visibility hunt. It is a person responding, so it is not counted as SentinelOne prevention.',
  },
};

/** The label and tooltip for an analyst-raised alert; null for anything the EDR raised itself. */
export function analystResponse(initiatedBy: string | null | undefined): { label: string; detail: string } | null {
  return initiatedBy ? ANALYST_RESPONSES[initiatedBy] ?? null : null;
}
