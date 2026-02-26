// API routes for security tests

import { Router, Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { TestIndexer } from '../services/browser/testIndexer.js';
import { FileService } from '../services/browser/fileService.js';
import { GitSyncService, SyncStatus } from '../services/browser/gitSyncService.js';
import { GitHubMetadataService } from '../services/browser/githubMetadataService.js';
import { initCatalog } from '../services/agent/test-catalog.service.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Module-level state (initialized by createBrowserRouter)
let testIndexer: TestIndexer | null = null;
let gitSyncService: GitSyncService | null = null;
let githubMetadataService: GitHubMetadataService | null = null;

/**
 * Create and configure the browser router
 * @param options - Configuration options
 * @returns Configured Express router
 */
export function createBrowserRouter(options: {
  testsSourcePath: string;
  gitSync?: GitSyncService;
  githubMetadata?: GitHubMetadataService;
}): Router {
  const router = Router();

  // Protect all browser routes with Clerk authentication + library read permission
  router.use(requireClerkAuth());
  router.use(requirePermission('tests:library:read'));

  // Initialize the test indexer
  testIndexer = new TestIndexer(options.testsSourcePath);
  gitSyncService = options.gitSync || null;
  githubMetadataService = options.githubMetadata || null;

  // Initial scan on startup (if tests directory exists)
  console.log(`Scanning tests from: ${options.testsSourcePath}`);
  try {
    testIndexer.scanAllTests();
    console.log('✓ Tests scanned successfully');

    // Trigger background GitHub metadata fetch
    if (githubMetadataService) {
      const allTests = testIndexer.getAllTests();
      githubMetadataService.fetchAllModificationDates(allTests).catch(err => {
        console.warn('⚠ Background GitHub metadata fetch failed:', err instanceof Error ? err.message : err);
      });
    }
  } catch (error) {
    console.warn('⚠ Tests directory not found - browser module will have no tests available');
    console.warn('  Tests will be available after sync completes');
  }

  // ============ SYNC ENDPOINTS ============

  /**
   * POST /api/browser/tests/sync
   * Trigger a sync from the GitHub repository
   */
  router.post('/tests/sync', requirePermission('tests:sync:execute'), asyncHandler(async (_req: Request, res: Response) => {
    if (!gitSyncService) {
      throw new AppError('Git sync is not configured', 503);
    }

    if (gitSyncService.isSyncing()) {
      throw new AppError('Sync already in progress', 409);
    }

    console.log('Manual sync triggered...');

    try {
      // Pull latest changes
      await gitSyncService.sync();

      // Re-scan tests after sync
      const tests = testIndexer?.refresh() || [];

      // Reload agent test catalog so new tests are available for enrichment
      initCatalog(options.testsSourcePath);

      // Re-fetch GitHub metadata in background
      if (githubMetadataService && tests.length > 0) {
        githubMetadataService.clearCache();
        githubMetadataService.fetchAllModificationDates(tests).catch(err => {
          console.warn('⚠ Post-sync GitHub metadata fetch failed:', err instanceof Error ? err.message : err);
        });
      }

      const status = gitSyncService.getStatus();
      res.json({
        success: true,
        message: 'Sync completed successfully',
        syncStatus: status,
        testCount: tests.length,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown sync error';
      console.error('Sync failed:', errorMessage);
      throw new AppError(`Sync failed: ${errorMessage}`, 500);
    }
  }));

  /**
   * GET /api/browser/tests/sync/status
   * Get current sync status
   */
  router.get('/tests/sync/status', asyncHandler(async (_req: Request, res: Response) => {
    const status: SyncStatus = gitSyncService?.getStatus() || {
      lastSyncTime: null,
      commitHash: null,
      branch: 'main',
      status: 'never_synced',
      error: 'Git sync not configured',
    };

    // Add test count from indexer
    status.testCount = testIndexer?.getAllTests().length || 0;

    res.json({
      success: true,
      syncStatus: status,
    });
  }));

  // ============ TEST ENDPOINTS ============

  /**
   * GET /api/browser/tests
   * Get all tests with optional filtering
   */
  router.get('/tests', asyncHandler(async (req: Request, res: Response) => {
    if (!testIndexer) {
      throw new AppError('Test indexer not initialized', 503);
    }

    const { search, technique, category, severity } = req.query;

    let tests = testIndexer.getAllTests();

    // Apply filters
    if (search && typeof search === 'string') {
      tests = testIndexer.searchTests(search);
    } else if (technique && typeof technique === 'string') {
      tests = testIndexer.filterByTechnique(technique);
    } else if (category && typeof category === 'string') {
      tests = testIndexer.filterByCategory(category);
    } else if (severity && typeof severity === 'string') {
      tests = testIndexer.filterBySeverity(severity);
    }

    // Return simplified test list (without full file details)
    const testList = tests.map(test => {
      const gitInfo = githubMetadataService?.getCommitInfo(test.uuid);
      return {
        uuid: test.uuid,
        name: test.name,
        category: test.category,
        subcategory: test.subcategory,
        severity: test.severity,
        techniques: test.techniques,
        tactics: test.tactics,
        target: test.target,
        complexity: test.complexity,
        threatActor: test.threatActor,
        author: test.author,
        version: test.version,
        tags: test.tags,
        createdDate: test.createdDate,
        score: test.score,
        isMultiStage: test.isMultiStage,
        stageCount: test.stages.length,
        description: test.description,
        hasAttackFlow: test.hasAttackFlow,
        hasReadme: test.hasReadme,
        hasInfoCard: test.hasInfoCard,
        hasSafetyDoc: test.hasSafetyDoc,
        hasDetectionFiles: test.hasDetectionFiles,
        hasDefenseGuidance: test.hasDefenseGuidance,
        lastModifiedDate: gitInfo?.lastModifiedDate,
        lastCommitMessage: gitInfo?.lastCommitMessage,
      };
    });

    res.json({
      success: true,
      count: testList.length,
      tests: testList,
    });
  }));

  /**
   * GET /api/browser/tests/categories
   * Get all unique categories
   */
  router.get('/tests/categories', asyncHandler(async (_req: Request, res: Response) => {
    if (!testIndexer) {
      throw new AppError('Test indexer not initialized', 503);
    }

    const categories = testIndexer.getCategories();

    res.json({
      success: true,
      categories,
    });
  }));

  /**
   * GET /api/browser/tests/:uuid
   * Get detailed information about a specific test
   */
  router.get('/tests/:uuid', asyncHandler(async (req: Request, res: Response) => {
    if (!testIndexer) {
      throw new AppError('Test indexer not initialized', 503);
    }

    const { uuid } = req.params;

    // Validate UUID format to prevent path traversal
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uuid)) {
      throw new AppError('Invalid UUID format', 400);
    }

    const test = testIndexer.getTest(uuid);

    if (!test) {
      throw new AppError('Test not found', 404);
    }

    // Merge GitHub metadata if available
    const gitInfo = githubMetadataService?.getCommitInfo(uuid);
    const enrichedTest = gitInfo
      ? { ...test, lastModifiedDate: gitInfo.lastModifiedDate, lastCommitMessage: gitInfo.lastCommitMessage }
      : test;

    res.json({
      success: true,
      test: enrichedTest,
    });
  }));

  /**
   * GET /api/browser/tests/:uuid/description
   * Get test description (standalone) or validator description (bundle control).
   * Query param ?validator=<name> for bundle control lookups.
   */
  router.get('/tests/:uuid/description', asyncHandler(async (req: Request, res: Response) => {
    if (!testIndexer) {
      throw new AppError('Test indexer not initialized', 503);
    }

    const { uuid } = req.params;
    const validator = req.query.validator as string | undefined;

    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uuid)) {
      throw new AppError('Invalid UUID format', 400);
    }

    const test = testIndexer.getTest(uuid);
    if (!test) {
      res.json({ success: true, data: { description: null } });
      return;
    }

    let description: string | null = null;
    if (validator) {
      description = test.validatorDescriptions?.[validator] ?? null;
    } else {
      description = test.description ?? null;
    }

    res.json({ success: true, data: { description } });
  }));

  /**
   * GET /api/browser/tests/:uuid/files
   * Get list of files in a test directory
   */
  router.get('/tests/:uuid/files', asyncHandler(async (req: Request, res: Response) => {
    if (!testIndexer) {
      throw new AppError('Test indexer not initialized', 503);
    }

    const { uuid } = req.params;

    // Validate UUID format to prevent path traversal
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uuid)) {
      throw new AppError('Invalid UUID format', 400);
    }

    const test = testIndexer.getTest(uuid);

    if (!test) {
      throw new AppError('Test not found', 404);
    }

    res.json({
      success: true,
      files: test.files,
    });
  }));

  /**
   * GET /api/browser/tests/:uuid/file/:filename
   * Get content of a specific file
   */
  router.get('/tests/:uuid/file/:filename', asyncHandler(async (req: Request, res: Response) => {
    if (!testIndexer) {
      throw new AppError('Test indexer not initialized', 503);
    }

    const { uuid, filename } = req.params;

    // Validate UUID format to prevent path traversal
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uuid)) {
      throw new AppError('Invalid UUID format', 400);
    }

    const decodedFilename = decodeURIComponent(filename);

    // Prevent path traversal - filename must not contain path separators or parent directory references
    if (decodedFilename.includes('/') || decodedFilename.includes('\\') || decodedFilename.includes('..')) {
      throw new AppError('Invalid filename', 400);
    }

    const test = testIndexer.getTest(uuid);

    if (!test) {
      throw new AppError('Test not found', 404);
    }

    // Find the file in the test's file list
    const file = test.files.find(f => f.name === decodedFilename);

    if (!file) {
      throw new AppError('File not found', 404);
    }

    // Read file content
    const fileContent = FileService.readFileContent(file.path);

    res.json({
      success: true,
      file: {
        name: file.name,
        type: fileContent.type,
        content: fileContent.content,
        size: file.size,
      },
    });
  }));

  /**
   * GET /api/browser/tests/:uuid/attack-flow
   * Get attack flow diagram HTML
   */
  router.get('/tests/:uuid/attack-flow', asyncHandler(async (req: Request, res: Response) => {
    if (!testIndexer) {
      throw new AppError('Test indexer not initialized', 503);
    }

    const { uuid } = req.params;

    // Validate UUID format to prevent path traversal
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uuid)) {
      throw new AppError('Invalid UUID format', 400);
    }

    const test = testIndexer.getTest(uuid);

    if (!test) {
      throw new AppError('Test not found', 404);
    }

    if (!test.hasAttackFlow || !test.attackFlowPath) {
      throw new AppError('Attack flow diagram not available for this test', 404);
    }

    // Read HTML file
    const fileContent = FileService.readFileContent(test.attackFlowPath);

    res.json({
      success: true,
      html: fileContent.content,
    });
  }));

  /**
   * POST /api/browser/tests/refresh
   * Refresh test index (rescan tests_source directory)
   */
  router.post('/tests/refresh', requirePermission('tests:sync:execute'), asyncHandler(async (_req: Request, res: Response) => {
    if (!testIndexer) {
      throw new AppError('Test indexer not initialized', 503);
    }

    console.log('Refreshing test index...');
    const tests = testIndexer.refresh();

    res.json({
      success: true,
      message: 'Test index refreshed successfully',
      count: tests.length,
    });
  }));

  return router;
}

// Default export for backwards compatibility (creates router with env-based config)
const defaultTestsSourcePath = process.env.TESTS_SOURCE_PATH || path.resolve(__dirname, '../../../tests_source');
const defaultRouter = createBrowserRouter({ testsSourcePath: defaultTestsSourcePath });

export default defaultRouter;
