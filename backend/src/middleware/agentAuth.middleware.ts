import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { getDatabase } from '../services/agent/database.js';
import { cancelPendingKey, promotePendingKey, ROTATION_GRACE_PERIOD_SECONDS } from '../services/agent/enrollment.service.js';
import {
  getCachedAgent,
  setCachedAgent,
  invalidateAgentCache,
  isTokenVerifiedRecently,
  setVerifiedToken,
  hashTokenForCache,
} from '../services/agent/agentAuthCache.js';
import type { CachedAgentRow } from '../services/agent/agentAuthCache.js';
import type { AuthenticatedAgent } from '../types/agent.js';

const MAX_TIMESTAMP_SKEW_SECONDS = 300; // 5 minutes

type AgentRow = CachedAgentRow;

// M2: Pre-computed dummy hash so bcrypt.compare always runs, eliminating timing oracle
const DUMMY_HASH = bcrypt.hashSync('dummy-value-for-timing', 12);

/**
 * Express middleware that authenticates agent API calls.
 *
 * Expects:
 *   - Authorization: Bearer ak_<token>
 *   - X-Agent-ID: <agent_id>
 *
 * Supports dual-key authentication during rotations. A rotation is resolved by
 * which key the agent presents, never by elapsed time — both keys stay
 * acceptable until the agent proves which one it holds:
 *   1. Try the current api_key_hash
 *   2. If it matches and a pending key exists whose grace period has already
 *      expired, the agent never picked the new key up — cancel the rotation and
 *      keep the current key. Within the grace period the pending key is left
 *      alone: the agent is *expected* to still be on the old key, because the
 *      heartbeat response is what delivers the new one
 *   3. If it does not match and a pending key exists, try the pending hash
 *   4. If the pending hash matches, promote it — the agent has proven it holds
 *      the new key, which is the only safe moment to make it primary
 *
 * The grace period governs *delivery* (how long a heartbeat will hand out the
 * pending key), not acceptance. Resolving on a timer instead would lock out
 * whichever agent guessed wrong: promoting strands one that was offline through
 * the window, cancelling strands one that adopted the key and then slept.
 *
 * On success, attaches `req.agent` as AuthenticatedAgent.
 * On failure, returns 401 with uniform error message for all failure modes.
 */
export function requireAgentAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const agentId = req.headers['x-agent-id'];

  // Validate presence of required headers
  if (!authHeader || typeof agentId !== 'string' || !agentId) {
    res.status(401).json({ success: false, error: 'Invalid agent credentials' });
    return;
  }

  // Extract bearer token and verify ak_ prefix
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1].startsWith('ak_')) {
    res.status(401).json({ success: false, error: 'Invalid agent credentials' });
    return;
  }

  const token = parts[1];
  const tokenHash = hashTokenForCache(token);

  // Try in-memory cache first, fall back to DB on miss
  let row: AgentRow | undefined = getCachedAgent(agentId) ?? undefined;
  if (!row) {
    const db = getDatabase();
    row = db.prepare(
      'SELECT id, org_id, hostname, os, arch, status, api_key_hash, pending_api_key_hash, key_rotation_initiated_at FROM agents WHERE id = ?'
    ).get(agentId) as AgentRow | undefined;
    if (row) setCachedAgent(agentId, row);
  }

  // NOTE: the rotation is deliberately NOT resolved here based on elapsed time.
  // At expiry the server cannot know which key the agent actually holds, and
  // guessing bricks an agent either way — see the comment on the bcrypt branches
  // below. Both keys stay acceptable until the agent proves which one it has.

  // Verdict-cache fast path: if this exact tokenHash recently passed bcrypt
  // for this agent, skip the cost-12 bcrypt.compare entirely. The verdict
  // cache is auto-cleared on rotation (setCachedAgent replaces the entry)
  // and bounded by CACHE_TTL_MS, so a deactivated agent or rotated key
  // re-runs bcrypt within a single TTL window.
  if (row && isTokenVerifiedRecently(agentId, tokenHash)) {
    finalizeAgentAuth(req, res, next, row);
    return;
  }

  // M2: Always run bcrypt.compare to prevent timing oracle — use dummy hash if agent not found
  const hashToCompare = row?.api_key_hash ?? DUMMY_HASH;

  bcrypt.compare(token, hashToCompare)
    .then(async (match) => {
      // A rotation is resolved by which key the agent presents, never by a
      // clock. Both keys stay acceptable until then, because at grace expiry
      // the server genuinely cannot tell the two cases apart, and either guess
      // permanently locks out one of them:
      //
      //   - promote  → an agent that was offline through the whole window
      //                never received the new key; its old key stops working
      //   - cancel   → an agent that DID receive the new key and then went
      //                offline comes back holding a key the server discarded
      //
      // Both were real: promote-on-expiry is the bug this replaces, and
      // cancel-on-expiry is the mirror image it would have introduced.
      if (match && row?.pending_api_key_hash && row.key_rotation_initiated_at) {
        // Old key still in use. Only abandon the rotation once the DELIVERY
        // window has closed — within the grace period the agent is expected to
        // still be on the old key, because the heartbeat *response* to this
        // very request is what hands the new key over. Cancelling here
        // unconditionally would kill every rotation at the first heartbeat.
        const initiatedAt = new Date(row.key_rotation_initiated_at + 'Z').getTime();
        if ((Date.now() - initiatedAt) / 1000 > ROTATION_GRACE_PERIOD_SECONDS) {
          cancelPendingKey(row.id);
          invalidateAgentCache(row.id);
        }
      } else if (!match && row?.pending_api_key_hash) {
        const pendingMatch = await bcrypt.compare(token, row.pending_api_key_hash);
        if (pendingMatch) {
          // Agent has proven it holds the new key — the only safe moment to
          // make it primary. No grace-period check: an agent that adopted the
          // key and then slept for a week is still the agent we want to keep.
          promotePendingKey(row.id);
          invalidateAgentCache(row.id);
          match = true;
        }
      }

      // Uniform rejection: agent not found, wrong key, or inactive — same 401 message
      if (!row || !match) {
        if (!row) {
          console.warn(`[agentAuth] REJECTED agent_id=${agentId} reason=not_found`);
        } else {
          console.warn(`[agentAuth] REJECTED agent_id=${row.id} hostname=${row.hostname} reason=key_mismatch`);
        }
        res.status(401).json({ success: false, error: 'Invalid agent credentials' });
        return;
      }

      // Record verdict so the next request from this agent with the same
      // token can take the fast path. Done before finalize so even rejected
      // status/timestamp checks below don't suppress the bcrypt-pass record.
      setVerifiedToken(row.id, tokenHash);

      finalizeAgentAuth(req, res, next, row);
    })
    .catch((err) => {
      console.warn(`[agentAuth] REJECTED agent_id=${agentId} reason=internal_error error=${err instanceof Error ? err.message : String(err)}`);
      res.status(401).json({ success: false, error: 'Invalid agent credentials' });
    });
}

/**
 * Post-bcrypt (or post-verdict-cache-hit) checks: agent status + replay-protection
 * timestamp. On success, attaches `req.agent` and calls `next()`. On any failure,
 * responds 401 with the uniform message. Same semantics whether reached via the
 * slow bcrypt path or the verdict fast path — the only thing the fast path skips
 * is the bcrypt compare itself.
 */
function finalizeAgentAuth(
  req: Request,
  res: Response,
  next: NextFunction,
  row: AgentRow,
): void {
  if (row.status !== 'active') {
    console.warn(`[agentAuth] REJECTED agent_id=${row.id} hostname=${row.hostname} reason=inactive status=${row.status}`);
    res.status(401).json({ success: false, error: 'Invalid agent credentials' });
    return;
  }

  const requestTimestamp = req.headers['x-request-timestamp'];
  if (typeof requestTimestamp === 'string') {
    const requestTime = new Date(requestTimestamp).getTime();
    if (isNaN(requestTime)) {
      console.warn(`[agentAuth] Agent ${row.id} (${row.hostname}) sent unparseable X-Request-Timestamp: ${requestTimestamp}`);
      res.status(401).json({ success: false, error: 'Invalid agent credentials' });
      return;
    }
    const now = Date.now();
    const skew = Math.abs(now - requestTime) / 1000;
    if (skew > MAX_TIMESTAMP_SKEW_SECONDS) {
      const direction = requestTime > now ? 'ahead' : 'behind';
      console.warn(`[agentAuth] Agent ${row.id} (${row.hostname}) rejected: clock skew ${skew.toFixed(0)}s ${direction} (max ${MAX_TIMESTAMP_SKEW_SECONDS}s). agent=${requestTimestamp} server=${new Date(now).toISOString()}`);
      res.status(401).json({ success: false, error: 'Invalid agent credentials' });
      return;
    }
  } else {
    console.warn(`[agentAuth] Agent ${row.id} (${row.hostname}) rejected: missing X-Request-Timestamp header`);
    res.status(401).json({ success: false, error: 'Invalid agent credentials' });
    return;
  }

  const agent: AuthenticatedAgent = {
    id: row.id,
    org_id: row.org_id,
    hostname: row.hostname,
    os: row.os,
    arch: row.arch,
    status: row.status,
  };

  req.agent = agent;
  next();
}
