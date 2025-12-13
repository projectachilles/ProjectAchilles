// API routes for security tests

import { Router, Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireClerkAuth } from '../middleware/clerk.middleware.js';
import { asyncHandler } from '../middleware/error.middleware.js';
import { TestIndexer } from '../services/browser/testIndexer.js';
import { FileService } from '../services/browser/fileService.js';

const router = Router();

// Protect all browser routes with Clerk authentication
router.use(requireClerkAuth());

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get tests source path from environment with relative path fallback
// Default: ProjectAchilles/tests_source (from backend/src/api/)
const testsSourcePath = process.env.TESTS_SOURCE_PATH || path.resolve(__dirname, '../../../tests_source');

const testIndexer = new TestIndexer(testsSourcePath);

// Initial scan on startup
console.log(`Scanning tests from: ${testsSourcePath}`);
testIndexer.scanAllTests();

/**
 * GET /api/browser/tests
 * Get all tests with optional filtering
 */
router.get('/tests', asyncHandler(async (req: Request, res: Response) => {
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
  const testList = tests.map(test => ({
    uuid: test.uuid,
    name: test.name,
    category: test.category,
    severity: test.severity,
    techniques: test.techniques,
    tactics: test.tactics,
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
  }));

  res.json({
    success: true,
    count: testList.length,
    tests: testList,
  });
}));

/**
 * GET /api/browser/tests/:uuid
 * Get detailed information about a specific test
 */
router.get('/tests/:uuid', asyncHandler(async (req: Request, res: Response) => {
  const { uuid } = req.params;

  // Validate UUID format to prevent path traversal
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uuid)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid UUID format',
    });
  }

  const test = testIndexer.getTest(uuid);

  if (!test) {
    return res.status(404).json({
      success: false,
      error: 'Test not found',
    });
  }

  res.json({
    success: true,
    test,
  });
}));

/**
 * GET /api/browser/tests/:uuid/files
 * Get list of files in a test directory
 */
router.get('/tests/:uuid/files', asyncHandler(async (req: Request, res: Response) => {
  const { uuid } = req.params;

  // Validate UUID format to prevent path traversal
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uuid)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid UUID format',
    });
  }

  const test = testIndexer.getTest(uuid);

  if (!test) {
    return res.status(404).json({
      success: false,
      error: 'Test not found',
    });
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
  const { uuid, filename } = req.params;

  // Validate UUID format to prevent path traversal
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uuid)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid UUID format',
    });
  }

  const decodedFilename = decodeURIComponent(filename);

  // Prevent path traversal - filename must not contain path separators or parent directory references
  if (decodedFilename.includes('/') || decodedFilename.includes('\\') || decodedFilename.includes('..')) {
    return res.status(400).json({
      success: false,
      error: 'Invalid filename',
    });
  }

  const test = testIndexer.getTest(uuid);

  if (!test) {
    return res.status(404).json({
      success: false,
      error: 'Test not found',
    });
  }

  // Find the file in the test's file list
  const file = test.files.find(f => f.name === decodedFilename);

  if (!file) {
    return res.status(404).json({
      success: false,
      error: 'File not found',
    });
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
  const { uuid } = req.params;

  // Validate UUID format to prevent path traversal
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uuid)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid UUID format',
    });
  }

  const test = testIndexer.getTest(uuid);

  if (!test) {
    return res.status(404).json({
      success: false,
      error: 'Test not found',
    });
  }

  if (!test.hasAttackFlow || !test.attackFlowPath) {
    return res.status(404).json({
      success: false,
      error: 'Attack flow diagram not available for this test',
    });
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
router.post('/tests/refresh', asyncHandler(async (_req: Request, res: Response) => {
  console.log('Refreshing test index...');
  const tests = testIndexer.refresh();

  res.json({
    success: true,
    message: 'Test index refreshed successfully',
    count: tests.length,
  });
}));

export default router;
