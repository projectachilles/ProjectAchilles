/**
 * MITRE ATT&CK enterprise tactics in kill-chain order.
 * `slug` matches test metadata (`tactics` field, kebab-case);
 * `code` is the two-letter bar/deep-link label used across the console.
 */
export interface EnterpriseTactic {
  slug: string;
  code: string;
  name: string;
  /** Whether the dashboard coverage bars display this tactic (IA→IM). */
  shown: boolean;
}

export const ENTERPRISE_TACTICS: readonly EnterpriseTactic[] = [
  { slug: 'reconnaissance', code: 'RE', name: 'Reconnaissance', shown: false },
  { slug: 'resource-development', code: 'RD', name: 'Resource Development', shown: false },
  { slug: 'initial-access', code: 'IA', name: 'Initial Access', shown: true },
  { slug: 'execution', code: 'EX', name: 'Execution', shown: true },
  { slug: 'persistence', code: 'PE', name: 'Persistence', shown: true },
  { slug: 'privilege-escalation', code: 'PR', name: 'Privilege Escalation', shown: true },
  { slug: 'defense-evasion', code: 'DE', name: 'Defense Evasion', shown: true },
  { slug: 'credential-access', code: 'CA', name: 'Credential Access', shown: true },
  { slug: 'discovery', code: 'DI', name: 'Discovery', shown: true },
  { slug: 'lateral-movement', code: 'LM', name: 'Lateral Movement', shown: true },
  { slug: 'collection', code: 'CO', name: 'Collection', shown: true },
  { slug: 'command-and-control', code: 'C2', name: 'Command and Control', shown: true },
  { slug: 'exfiltration', code: 'EF', name: 'Exfiltration', shown: true },
  { slug: 'impact', code: 'IM', name: 'Impact', shown: true },
] as const;

/** Resolve a deep-link tactic value (code like "DE" or slug) to its slug. */
export function tacticToSlug(value: string): string | null {
  const needle = value.trim();
  const byCode = ENTERPRISE_TACTICS.find((t) => t.code.toLowerCase() === needle.toLowerCase());
  if (byCode) return byCode.slug;
  const bySlug = ENTERPRISE_TACTICS.find((t) => t.slug === needle.toLowerCase());
  return bySlug ? bySlug.slug : null;
}

export function tacticLabel(slug: string): string {
  return ENTERPRISE_TACTICS.find((t) => t.slug === slug)?.name ?? slug;
}
