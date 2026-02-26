import { Router } from 'express';
import multer from 'multer';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import { requirePermission } from '../../middleware/clerk.middleware.js';
import {
  getLatestVersion,
  streamUpdate,
  registerVersion,
  listVersions,
  registerVersionFromUpload,
  deleteVersion,
} from '../../services/agent/update.service.js';
import type { AgentBuildService } from '../../services/agent/agentBuild.service.js';
import type { AgentOS, AgentArch } from '../../types/agent.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

const VALID_OS: AgentOS[] = ['windows', 'linux', 'darwin'];
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

    console.warn(`[update] Serving version ${latest.version} to agent ${agent.id} (${agent.hostname}, ${agent.os}/${agent.arch}), current=${currentVersion ?? 'unknown'}`);
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

    console.warn(`[update] Streaming binary to agent ${req.agent?.id ?? 'unknown'} (${os}/${arch})`);
    streamUpdate(os, arch, res);
  })
);

// ============================================================================
// Admin routes (Clerk auth required)
// ============================================================================

// Clerk auth is applied at mount time in the parent router.

export function createAdminUpdateRouter(buildService: AgentBuildService | null): Router {
  const router = Router();

  /**
   * POST /admin/versions
   * Register a new agent version.
   * Body: { version, os, arch, binary_path, release_notes?, mandatory? }
   */
  router.post(
    '/versions',
    requirePermission('endpoints:versions:create'),
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
  router.get(
    '/versions',
    requirePermission('endpoints:versions:read'),
    asyncHandler(async (_req, res) => {
      const versions = listVersions();
      res.json({ success: true, data: versions });
    })
  );

  /**
   * POST /admin/versions/upload
   * Upload and register a new agent binary version (multipart).
   * Fields: version, os, arch, release_notes?, mandatory?, binary (file)
   */
  router.post(
    '/versions/upload',
    requirePermission('endpoints:versions:create'),
    upload.single('binary'),
    asyncHandler(async (req, res) => {
      const { version, os, arch, release_notes, mandatory } = req.body as {
        version: string;
        os: string;
        arch: string;
        release_notes?: string;
        mandatory?: string;
      };

      if (!version || !os || !arch) {
        throw new AppError('Missing required fields: version, os, arch', 400);
      }

      if (!VALID_OS.includes(os as AgentOS)) {
        throw new AppError('Invalid os parameter', 400);
      }

      if (!VALID_ARCH.includes(arch as AgentArch)) {
        throw new AppError('Invalid arch parameter', 400);
      }

      if (!req.file) {
        throw new AppError('Missing binary file', 400);
      }

      const result = registerVersionFromUpload(
        version,
        os as AgentOS,
        arch as AgentArch,
        req.file.buffer,
        release_notes ?? '',
        mandatory === 'true'
      );

      res.status(201).json({ success: true, data: result });
    })
  );

  /**
   * POST /admin/versions/build
   * Build agent binary from source for a given platform.
   * Body: { version, os, arch }
   */
  router.post(
    '/versions/build',
    requirePermission('endpoints:versions:create'),
    asyncHandler(async (req, res) => {
      if (!buildService) {
        throw new AppError('Agent build from source is not available — agent source path not configured', 501);
      }

      const { version, os, arch } = req.body as {
        version: string;
        os: string;
        arch: string;
      };

      if (!version || !os || !arch) {
        throw new AppError('Missing required fields: version, os, arch', 400);
      }

      if (!VALID_OS.includes(os as AgentOS)) {
        throw new AppError('Invalid os parameter', 400);
      }

      if (!VALID_ARCH.includes(arch as AgentArch)) {
        throw new AppError('Invalid arch parameter', 400);
      }

      const result = await buildService.buildAndSign(version, os as AgentOS, arch as AgentArch);
      res.status(201).json({ success: true, data: result });
    })
  );

  /**
   * DELETE /admin/versions/:version/:os/:arch
   * Delete a registered agent version and its binary.
   */
  router.delete(
    '/versions/:version/:os/:arch',
    requirePermission('endpoints:versions:delete'),
    asyncHandler(async (req, res) => {
      const { version, os, arch } = req.params;

      if (!VALID_OS.includes(os as AgentOS)) {
        throw new AppError('Invalid os parameter', 400);
      }

      if (!VALID_ARCH.includes(arch as AgentArch)) {
        throw new AppError('Invalid arch parameter', 400);
      }

      const deleted = deleteVersion(version, os as AgentOS, arch as AgentArch);
      if (!deleted) {
        throw new AppError('Version not found', 404);
      }

      res.json({ success: true });
    })
  );

  return router;
}
