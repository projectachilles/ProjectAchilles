import { Router } from 'express';
import path from 'path';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import { agentHasActiveTaskForTest } from '../../services/agent/tasks.service.js';
import { getBinaryInfo, redirectToBinary } from '../../services/agent/binary.service.js';

// ============================================================================
// Agent-facing binary download router
// Agent auth (requireAgentAuth) is applied at mount time by the parent router.
// ============================================================================

const router = Router();

/**
 * GET /binary/:name?test_uuid=xxx
 * Download a test binary. The agent provides the binary name (from the task
 * payload) and the test_uuid as a query parameter, and must hold an active
 * task for that test.
 */
router.get( // nosemgrep: semgrep.rules.projectachilles-clerk-auth-missing -- agent device route: mounted behind requireAgentAuth in api/agent/index.ts
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

    // An agent may fetch only the tests it was asked to run. Without a task
    // for this test the answer is the same 404 as for a build that does not
    // exist, so the route can't be used to probe which tests are built.
    if (!req.agent || !(await agentHasActiveTaskForTest(req.agent.id, testUuid))) {
      throw new AppError(`Binary not found: ${path.basename(binaryName)}`, 404);
    }

    const info = await getBinaryInfo(testUuid, binaryName);

    redirectToBinary(info.url, info.name, res);
  })
);

export default router;
