// Who asked for a task, for the task views ("Requested by"). tasks.created_by
// is a Clerk user id (Run now, retry, or the creator of the schedule that ran
// it) or `apikey:<id>` for API-key callers; show a name, never the raw id.

import { getDatabase } from './database.js';
import { resolveUserLabel } from '../notices/userLabel.js';

/** "Name (email)", "API key · <name>", or the id itself when nothing better is known. */
export async function resolveRequesterLabel(createdBy: string | null | undefined): Promise<string | null> {
  if (!createdBy) return null;
  if (createdBy.startsWith('apikey:')) {
    const id = createdBy.slice('apikey:'.length);
    const row = getDatabase().prepare('SELECT name FROM api_keys WHERE id = ?').get(id) as { name: string } | undefined;
    return row ? `API key · ${row.name}` : 'API key (deleted)';
  }
  // Clerk lookups are cached for an hour and never throw (falls back to the id).
  return resolveUserLabel(createdBy);
}

/** Labels for every distinct creator, looked up once each. */
export async function resolveRequesterLabels(ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((id): id is string => !!id))];
  const labels = await Promise.all(unique.map((id) => resolveRequesterLabel(id)));
  return new Map(unique.map((id, i) => [id, labels[i] ?? id]));
}
