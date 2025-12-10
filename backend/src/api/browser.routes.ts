import { Router } from 'express';
import { asyncHandler } from '../middleware/error.middleware.js';
import { TestIndexer } from '../services/browser/testIndexer.js';
import { FileService } from '../services/browser/fileService.js';

const router = Router();

// Initialize services
const testIndexer = new TestIndexer();
const fileService = new FileService();

// Initialize test index on startup
testIndexer.initialize().catch(err => {
  console.error('Failed to initialize test indexer:', err);
});

// GET /api/browser/tests - List all tests
router.get('/tests', asyncHandler(async (req, res) => {
  const { search, technique, category, severity } = req.query;

  let tests = testIndexer.getAllTests();

  // Apply filters
  if (search && typeof search === 'string') {
    const query = search.toLowerCase();
    tests = tests.filter(t =>
      t.name.toLowerCase().includes(query) ||
      t.uuid.toLowerCase().includes(query) ||
      t.techniques.some(tech => tech.toLowerCase().includes(query)) ||
      t.description?.toLowerCase().includes(query)
    );
  }

  if (technique && typeof technique === 'string') {
    tests = tests.filter(t => t.techniques.includes(technique));
  }

  if (category && typeof category === 'string') {
    tests = tests.filter(t => t.category === category);
  }

  if (severity && typeof severity === 'string') {
    tests = tests.filter(t => t.severity === severity);
  }

  res.json(tests);
}));

// GET /api/browser/tests/:uuid - Get test details
router.get('/tests/:uuid', asyncHandler(async (req, res) => {
  const { uuid } = req.params;
  const test = testIndexer.getTest(uuid);

  if (!test) {
    return res.status(404).json({ error: 'Test not found' });
  }

  res.json(test);
}));

// GET /api/browser/tests/:uuid/files - Get test files list
router.get('/tests/:uuid/files', asyncHandler(async (req, res) => {
  const { uuid } = req.params;
  const test = testIndexer.getTest(uuid);

  if (!test) {
    return res.status(404).json({ error: 'Test not found' });
  }

  res.json(test.files);
}));

// GET /api/browser/tests/:uuid/file/:filename - Get file content
router.get('/tests/:uuid/file/:filename', asyncHandler(async (req, res) => {
  const { uuid, filename } = req.params;
  const test = testIndexer.getTest(uuid);

  if (!test) {
    return res.status(404).json({ error: 'Test not found' });
  }

  const file = test.files.find(f => f.name === filename);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  const content = await fileService.readFile(file.path);
  res.type('text/plain').send(content);
}));

// GET /api/browser/tests/:uuid/attack-flow - Get attack flow HTML
router.get('/tests/:uuid/attack-flow', asyncHandler(async (req, res) => {
  const { uuid } = req.params;
  const test = testIndexer.getTest(uuid);

  if (!test) {
    return res.status(404).json({ error: 'Test not found' });
  }

  if (!test.hasAttackFlow || !test.attackFlowPath) {
    return res.status(404).json({ error: 'Attack flow not found' });
  }

  const content = await fileService.readFile(test.attackFlowPath);
  res.type('text/html').send(content);
}));

// POST /api/browser/tests/refresh - Refresh test index
router.post('/tests/refresh', asyncHandler(async (_req, res) => {
  await testIndexer.refresh();
  const tests = testIndexer.getAllTests();
  res.json({ message: 'Test index refreshed', count: tests.length });
}));

export default router;
