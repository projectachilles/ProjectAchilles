// Who asked for a task, for the task views ("Requested by"). tasks.created_by
// is a Clerk user id (Run now, retry, or the creator of the schedule that ran
// it) or `apikey:<id>` for API-key callers; show a name, never the raw id.
//
// Callers decide who may see emails (see withoutEmail) and must only resolve
// tasks of the caller's own org: the label is personal data.

import { getDatabase } from './database.js';
import { resolveUserLabel } from '../notices/userLabel.js';

/**
 * "Name (email)", "API key · <name>", or the id itself when nothing better is
 * known. With an orgId, an API key outside that org is shown as "API key".
 */
export async function resolveRequesterLabel(createdBy: string | null | undefined, orgId?: string): Promise<string | null> {
  if (!createdBy) return null;
  if (createdBy.startsWith('apikey:')) {
    const id = createdBy.slice('apikey:'.length);
    const row = getDatabase().prepare('SELECT name, org_id FROM api_keys WHERE id = ?').get(id) as
      | { name: string; org_id: string | null }
      | undefined;
    if (!row) return 'API key (deleted)';
    if (orgId && row.org_id && row.org_id !== orgId) return 'API key';
    return `API key · ${row.name}`;
  }
  // Clerk lookups are cached for an hour and never throw (falls back to the id).
  return resolveUserLabel(createdBy);
}

/** Labels for every distinct creator, looked up once each. */
export async function resolveRequesterLabels(ids: Iterable<string | null | undefined>, orgId?: string): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((id): id is string => !!id))];
  const labels = await Promise.all(unique.map((id) => resolveRequesterLabel(id, orgId)));
  return new Map(unique.map((id, i) => [id, labels[i] ?? id]));
}

/** The label without its email, for callers who can't manage users: "Jane Doe", or "j…@example.com". */
export function withoutEmail(label: string): string {
  const named = /^(.+) \([^()\s]+@[^()\s]+\)$/.exec(label);
  if (named) return named[1];
  const email = /^([^@\s])[^@\s]*@([^@\s]+)$/.exec(label);
  if (email) return `${email[1]}…@${email[2]}`;
  return label;
}
