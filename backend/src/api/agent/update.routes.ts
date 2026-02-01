import { Router } from 'express';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import {
  getLatestVersion,
  streamUpdate,
  registerVersion,
  listVersions,
} from '../../services/agent/update.service.js';
import type { AgentOS, AgentArch } from '../../types/agent.js';

const VALID_OS: AgentOS[] = ['windows', 'linux'];
const VALID_ARCH: AgentArch[] = ['amd64', 'arm64'];

// ============================================================================
// Agent-facing routes (requireAgentAuth applied at mount time)
// ============================================================================

export const agentUpdateRouter = Router();

/**
 * GET /version
 * Check if a newer agent version is available.
 * Returns version info or 204 if the agent is already up to date.
 */
agentUpdateRouter.get(
  '/version',
  asyncHandler(async (req, res) => {
    const agent = req.agent;
    if (!agent) {
      throw new AppError('Agent authentication required', 401);
    }

    const latest = getLatestVersion(agent.os, agent.arch);
    if (!latest) {
      res.status(204).send();
      return;
    }

    const currentVersion = req.headers['x-agent-version'] as string | undefined;
    if (currentVersion === latest.version) {
      res.status(204).send();
      return;
    }

    res.json({ success: true, data: latest });
  })
);

/**
 * GET /update?os=<os>&arch=<arch>
 * Download the latest agent binary for the given platform.
 */
agentUpdateRouter.get(
  '/update',
  asyncHandler(async (req, res) => {
    const os = (req.query.os || req.agent?.os) as AgentOS | undefined;
    const arch = (req.query.arch || req.agent?.arch) as AgentArch | undefined;

    if (!os || !arch) {
      throw new AppError('Missing required query parameters: os, arch', 400);
    }

    if (!VALID_OS.includes(os)) {
      throw new AppError('Invalid os parameter', 400);
    }

    if (!VALID_ARCH.includes(arch)) {
      throw new AppError('Invalid arch parameter', 400);
    }

    streamUpdate(os, arch, res);
  })
);

// ============================================================================
// Admin routes (Clerk auth required)
// ============================================================================

export const adminUpdateRouter = Router();

// Clerk auth is applied at mount time in the parent router.

/**
 * POST /admin/versions
 * Register a new agent version.
 * Body: { version, os, arch, binary_path, release_notes?, mandatory? }
 */
adminUpdateRouter.post(
  '/versions',
  asyncHandler(async (req, res) => {
    const { version, os, arch, binary_path, release_notes, mandatory } = req.body as {
      version: string;
      os: AgentOS;
      arch: AgentArch;
      binary_path: string;
      release_notes?: string;
      mandatory?: boolean;
    };

    if (!version || !os || !arch || !binary_path) {
      throw new AppError('Missing required fields: version, os, arch, binary_path', 400);
    }

    const result = registerVersion(
      version,
      os,
      arch,
      binary_path,
      release_notes ?? '',
      mandatory ?? false
    );

    res.status(201).json({ success: true, data: result });
  })
);

/**
 * GET /admin/versions
 * List all registered agent versions.
 */
adminUpdateRouter.get(
  '/versions',
  asyncHandler(async (_req, res) => {
    const versions = listVersions();
    res.json({ success: true, data: versions });
  })
);
