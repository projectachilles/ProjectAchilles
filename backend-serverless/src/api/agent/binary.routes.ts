import { Router } from 'express';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import { getBinaryInfo, redirectToBinary } from '../../services/agent/binary.service.js';

// ============================================================================
// Agent-facing binary download router
// Agent auth (requireAgentAuth) is applied at mount time by the parent router.
// ============================================================================

const router = Router();

/**
 * GET /binary/:name?test_uuid=xxx
 * Download a test binary. The agent provides the binary name (from the task
 * payload) and the test_uuid as a query parameter.
 */
router.get(
  '/binary/:name',
  asyncHandler(async (req, res) => {
    const binaryName = req.params.name;
    const testUuid = req.query.test_uuid as string | undefined;

    if (!binaryName) {
      throw new AppError('Missing required parameter: name', 400);
    }

    if (!testUuid) {
      throw new AppError('Missing required query parameter: test_uuid', 400);
    }

    const info = await getBinaryInfo(testUuid, binaryName);

    redirectToBinary(info.url, info.name, res);
  })
);

export default router;
