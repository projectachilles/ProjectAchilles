import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../services/agent/database.js';
import { cancelPendingKey, promotePendingKey, ROTATION_GRACE_PERIOD_SECONDS } from '../services/agent/enrollment.service.js';
import type { AuthenticatedAgent, AgentStatus, AgentOS, AgentArch } from '../types/agent.js';

const MAX_TIMESTAMP_SKEW_SECONDS = 300; // 5 minutes

interface AgentRow {
  id: string;
  org_id: string;
  hostname: string;
  os: AgentOS;
  arch: AgentArch;
  status: AgentStatus;
  api_key_hash: string;
  pending_api_key_hash: string | null;
  key_rotation_initiated_at: string | null;
}

// M2: Pre-computed dummy hash so bcrypt.compare always runs, eliminating timing oracle
const DUMMY_HASH = bcrypt.hashSync('dummy-value-for-timing', 12);

/**
 * Express middleware that authenticates agent API calls.
 *
 * Expects:
 *   - Authorization: Bearer ak_<token>
 *   - X-Agent-ID: <agent_id>
 *
 * Supports dual-key authentication during rotation grace periods:
 *   1. If a pending key exists and the grace period has expired, promote it first
 *   2. Try the current api_key_hash
 *   3. If no match and a pending key exists (within grace), try the pending hash
 *   4. If the pending hash matches, promote it (agent has adopted the new key)
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

  // Async DB lookup
  (async () => {
    const db = await getDb();
    let row = await db.get(
      'SELECT id, org_id, hostname, os, arch, status, api_key_hash, pending_api_key_hash, key_rotation_initiated_at FROM agents WHERE id = ?',
      [agentId]
    ) as unknown as AgentRow | undefined;

    // NOTE: the rotation is deliberately NOT resolved here based on elapsed
    // time. At expiry the server cannot know which key the agent actually
    // holds, and guessing bricks an agent either way — see the branches below.

    // M2: Always run bcrypt.compare to prevent timing oracle — use dummy hash if agent not found
    const hashToCompare = row?.api_key_hash ?? DUMMY_HASH;

    let match = await bcrypt.compare(token, hashToCompare);

    // A rotation is resolved by which key the agent presents, never by a clock.
    // Both keys stay acceptable until then, because at grace expiry the server
    // genuinely cannot tell the two cases apart, and either guess permanently
    // locks out one of them:
    //
    //   - promote  → an agent offline through the whole window never received
    //                the new key; its old key stops working
    //   - cancel   → an agent that DID receive the new key and then went
    //                offline comes back holding a key the server discarded
    if (match && row?.pending_api_key_hash && row.key_rotation_initiated_at) {
      // Old key still in use. Only abandon the rotation once the DELIVERY
      // window has closed — within the grace period the agent is expected to
      // still be on the old key, because the heartbeat *response* to this very
      // request is what hands the new key over. Cancelling here
      // unconditionally would kill every rotation at the first heartbeat.
      const initiatedAt = new Date(row.key_rotation_initiated_at + 'Z').getTime();
      if ((Date.now() - initiatedAt) / 1000 > ROTATION_GRACE_PERIOD_SECONDS) {
        await cancelPendingKey(row.id);
      }
    } else if (!match && row?.pending_api_key_hash) {
      const pendingMatch = await bcrypt.compare(token, row.pending_api_key_hash);
      if (pendingMatch) {
        // Agent has proven it holds the new key — the only safe moment to make
        // it primary. No grace-period check: an agent that adopted the key and
        // then slept for a week is still the agent we want to keep.
        await promotePendingKey(row.id);
        match = true;
      }
    }

    // Uniform rejection: agent not found, wrong key, or inactive — same 401 message
    if (!row || !match) {
      res.status(401).json({ success: false, error: 'Invalid agent credentials' });
      return;
    }

    if (row.status !== 'active') {
      res.status(401).json({ success: false, error: 'Invalid agent credentials' });
      return;
    }

    // Replay protection: validate X-Request-Timestamp header
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
      // Reject requests without timestamp header to prevent replay attacks
      console.warn(`[agentAuth] Agent ${row.id} rejected: missing X-Request-Timestamp header`);
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
  })().catch(() => {
    res.status(401).json({ success: false, error: 'Invalid agent credentials' });
  });
}
