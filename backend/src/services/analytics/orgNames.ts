/**
 * Display names for organization UUIDs, set per deployment so customer names
 * never live in the code. ORG_NAMES is a JSON object keyed by org UUID:
 *
 *   ORG_NAMES='{"<org uuid>": "ACME"}'
 *   ORG_NAMES='{"<org uuid>": {"shortName": "ACME", "fullName": "Acme Corporation"}}'
 *
 * Orgs without a name show the first 8 characters of their UUID (callers'
 * fallback). Kept identical in backend/ and backend-serverless/.
 */

export interface OrgName {
  shortName: string;
  fullName: string;
}

export function parseOrgNames(raw: string | undefined): Record<string, OrgName> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[org-names] ORG_NAMES is not valid JSON; organizations show their UUID prefix');
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.warn('[org-names] ORG_NAMES must be a JSON object keyed by org UUID');
    return {};
  }
  const names: Record<string, OrgName> = {};
  for (const [uuid, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) {
      names[uuid] = { shortName: value.trim(), fullName: value.trim() };
    } else if (value && typeof value === 'object') {
      const { shortName, fullName } = value as { shortName?: unknown; fullName?: unknown };
      if (typeof shortName === 'string' && shortName.trim()) {
        const full = typeof fullName === 'string' && fullName.trim() ? fullName.trim() : shortName.trim();
        names[uuid] = { shortName: shortName.trim(), fullName: full };
      }
    }
  }
  return names;
}

// Re-parsed only when the variable changes (tests set it per case).
let cachedRaw: string | undefined;
let cached: Record<string, OrgName> = {};

export function orgNames(): Record<string, OrgName> {
  const raw = process.env.ORG_NAMES;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parseOrgNames(raw);
  }
  return cached;
}

export function orgName(uuid: string | null | undefined): OrgName | undefined {
  return uuid ? orgNames()[uuid] : undefined;
}

export function orgShortName(uuid: string | null | undefined): string | undefined {
  return orgName(uuid)?.shortName;
}
