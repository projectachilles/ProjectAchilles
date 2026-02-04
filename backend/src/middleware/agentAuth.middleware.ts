import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { getDatabase } from '../services/agent/database.js';
import type { AuthenticatedAgent, AgentStatus, AgentOS, AgentArch } from '../types/agent.js';

interface AgentRow {
  id: string;
  org_id: string;
  hostname: string;
  os: AgentOS;
  arch: AgentArch;
  status: AgentStatus;
  api_key_hash: string;
}

/**
 * Express middleware that authenticates agent API calls.
 *
 * Expects:
 *   - Authorization: Bearer ak_<token>
 *   - X-Agent-ID: <agent_id>
 *
 * On success, attaches `req.agent` as AuthenticatedAgent.
 * On failure, returns 401 (invalid/missing credentials) or 403 (disabled agent).
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

  if (!row) {
    res.status(401).json({ success: false, error: 'Invalid agent credentials' });
    return;
  }

  // Check agent status before expensive bcrypt comparison
  if (row.status !== 'active') {
    res.status(403).json({ success: false, error: 'Agent is disabled' });
    return;
  }

  // Verify API key (async bcrypt compare)
  bcrypt.compare(token, row.api_key_hash)
    .then((match) => {
      if (!match) {
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
    })
    .catch(() => {
      res.status(401).json({ success: false, error: 'Invalid agent credentials' });
    });
}
