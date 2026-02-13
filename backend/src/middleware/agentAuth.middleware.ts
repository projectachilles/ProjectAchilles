import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { getDatabase } from '../services/agent/database.js';
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

  // Look up agent in database
  const db = getDatabase();
  const row = db.prepare(
    'SELECT id, org_id, hostname, os, arch, status, api_key_hash FROM agents WHERE id = ?'
  ).get(agentId) as AgentRow | undefined;

  // M2: Always run bcrypt.compare to prevent timing oracle — use dummy hash if agent not found
  const hashToCompare = row?.api_key_hash ?? DUMMY_HASH;

  bcrypt.compare(token, hashToCompare)
    .then((match) => {
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
          res.status(401).json({ success: false, error: 'Invalid agent credentials' });
          return;
        }
        const skew = Math.abs(Date.now() - requestTime) / 1000;
        if (skew > MAX_TIMESTAMP_SKEW_SECONDS) {
          res.status(401).json({ success: false, error: 'Invalid agent credentials' });
          return;
        }
      } else {
        // Backwards compatibility: missing header → warn but allow
        console.warn(`[agentAuth] Agent ${row.id} sent request without X-Request-Timestamp header`);
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
    })
    .catch(() => {
      res.status(401).json({ success: false, error: 'Invalid agent credentials' });
    });
}
