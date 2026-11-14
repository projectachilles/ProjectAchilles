/**
 * Ending a user's CLI sessions.
 *
 * A CLI session is a 1-hour access token (a JWT the backend signs, checked
 * without a database read) plus a refresh token stored in `cli_refresh_tokens`.
 * Neither is known to Clerk, so removing or demoting a user there does not
 * touch them. Revoking therefore does three things:
 *
 *   - deletes the user's refresh tokens, so the session can't be extended;
 *   - deletes the device codes the user approved, so a sign-in in progress
 *     can't complete;
 *   - records when it happened, so access tokens issued before that moment are
 *     refused for the rest of their hour (`isCliTokenRevoked`).
 */

import { getDatabase } from './agent/database.js';

/** End every CLI session of this user. Safe to call when they have none. */
export function revokeCliSessions(userId: string): void {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare('DELETE FROM cli_refresh_tokens WHERE user_id = ?').run(userId);
    // A device code the user approved but the CLI hasn't collected yet would
    // otherwise be exchanged for a token issued after the revocation.
    db.prepare('DELETE FROM cli_auth_codes WHERE user_id = ?').run(userId);
    db.prepare(`
      INSERT INTO cli_session_revocations (user_id, revoked_at) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET revoked_at = excluded.revoked_at
    `).run(userId, new Date().toISOString());
  })();
}

/**
 * True when a CLI access token with this `iat` (seconds) was issued at or
 * before the user's last revocation. `iat` has one-second resolution, so a
 * token issued in the same second as the revocation counts as revoked.
 */
export function isCliTokenRevoked(userId: string, issuedAtSeconds: number): boolean {
  const row = getDatabase()
    .prepare('SELECT revoked_at FROM cli_session_revocations WHERE user_id = ?')
    .get(userId) as { revoked_at: string } | undefined;
  if (!row) return false;
  const revokedAt = Date.parse(row.revoked_at);
  // An unreadable timestamp must not let the token through.
  if (Number.isNaN(revokedAt)) return true;
  return issuedAtSeconds * 1000 <= revokedAt;
}
