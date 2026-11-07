// ATT&CK technique ids across renumbering. MITRE revokes techniques and
// reissues them under new ids (T1562.001 "Disable or Modify Tools" became
// T1685), and EDRs adopt the new ids before test libraries do. Everything that
// matches an alert's techniques against a test's goes through here, so the
// two ids count as one technique. The pairs come from MITRE's revoked-by
// relationships (ATTACK_TECHNIQUE_REVOKED_BY, generated). Kept byte-identical
// in backend/ and backend-serverless/.

import { ATTACK_TECHNIQUE_REVOKED_BY } from './attackTechniques.js';

/** New id -> the revoked ids it replaced. */
const REPLACED: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [from, to] of Object.entries(ATTACK_TECHNIQUE_REVOKED_BY)) {
    const list = m.get(to);
    if (list) list.push(from);
    else m.set(to, [from]);
  }
  for (const list of m.values()) list.sort();
  return m;
})();

const TECHNIQUE_ID = /^\s*(T\d{4}(?:\.\d{3})?)\b/i;

/** "T1068 (Exploitation for Privilege Escalation)" / " t1068 " -> "T1068"; null when there is no id. */
export function normalizeTechniqueId(raw: string): string | null {
  const m = TECHNIQUE_ID.exec(raw);
  return m ? m[1].toUpperCase() : null;
}

/**
 * The ids that mean the same technique as `raw`: itself first, then the id
 * that replaced it, then the ids it replaced. Two old ids that MITRE merged
 * into one new technique are not aliases of each other (only of the new id).
 * Empty when `raw` holds no technique id.
 */
export function techniqueAliases(raw: string): string[] {
  const id = normalizeTechniqueId(raw);
  if (!id) return [];
  const out = [id];
  const replacement = ATTACK_TECHNIQUE_REVOKED_BY[id];
  if (replacement) out.push(replacement);
  for (const old of REPLACED.get(id) ?? []) if (!out.includes(old)) out.push(old);
  return out;
}

/** Every alias of every id, deduped, in first-seen order. */
export function expandTechniqueAliases(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of ids) for (const a of techniqueAliases(raw)) if (!out.includes(a)) out.push(a);
  return out;
}

export type TechniqueMatchClause = { term: Record<string, string> } | { prefix: Record<string, string> };

/**
 * ES clauses for `field`: each requested id and its sub-techniques (the
 * trailing dot in the prefix is load-bearing: no T1059 -> T10590), plus each
 * of its aliases EXACTLY. An alias's sub-techniques are other techniques
 * (T1685.005 was T1070.001, log clearing), so they never ride along.
 * Put the clauses in a bool `should` with minimum_should_match 1.
 */
export function techniqueMatchClauses(field: string, ids: readonly string[]): TechniqueMatchClause[] {
  const requested = new Set(ids.map(normalizeTechniqueId).filter((t): t is string => t !== null));
  const out: TechniqueMatchClause[] = [];
  for (const t of requested) out.push({ term: { [field]: t } }, { prefix: { [field]: `${t}.` } });
  for (const t of expandTechniqueAliases(ids)) if (!requested.has(t)) out.push({ term: { [field]: t } });
  return out;
}
