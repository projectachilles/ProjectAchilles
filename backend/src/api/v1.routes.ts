/**
 * Public API v1 — external integration endpoints.
 *
 * Protected by X-API-Key (not user auth).
 * Read-only access to test library and MITRE coverage.
 *
 *   GET /api/v1/tests              — list all tests
 *   GET /api/v1/tests/:uuid        — get test details
 *   GET /api/v1/coverage/mitre     — MITRE ATT&CK coverage map
 */

import { Router } from 'express';
import { requireApiKey } from '../middleware/apikey.middleware.js';
import { getTestIndexer } from './browser.routes.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';

const router = Router();

// All v1 routes require a valid API key
router.use(requireApiKey());

/** GET /api/v1/tests — list all tests with metadata */
router.get('/tests', asyncHandler(async (req, res) => {
  const indexer = getTestIndexer();
  if (!indexer) throw new AppError('Test library not initialized', 503);

  const { search, technique, category, severity } = req.query;

  let tests = indexer.getAllTests();

  if (search && typeof search === 'string') {
    tests = indexer.searchTests(search);
  } else if (technique && typeof technique === 'string') {
    tests = indexer.filterByTechnique(technique);
  } else if (category && typeof category === 'string') {
    tests = indexer.filterByCategory(category);
  } else if (severity && typeof severity === 'string') {
    tests = indexer.filterBySeverity(severity);
  }

  const testList = tests.map(test => ({
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
    score: test.score,
    description: test.description,
    isMultiStage: test.isMultiStage,
    stageCount: test.stages.length,
    tags: test.tags,
    integrations: test.integrations,
    author: test.author,
    createdDate: test.createdDate,
  }));

  res.json({
    count: testList.length,
    tests: testList,
  });
}));

/** GET /api/v1/tests/:uuid — single test detail */
router.get('/tests/:uuid', asyncHandler(async (req, res) => {
  const indexer = getTestIndexer();
  if (!indexer) throw new AppError('Test library not initialized', 503);

  const test = indexer.getAllTests().find(t => t.uuid === req.params.uuid);
  if (!test) throw new AppError('Test not found', 404);

  res.json({
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
    score: test.score,
    scoreBreakdown: test.scoreBreakdown,
    description: test.description,
    isMultiStage: test.isMultiStage,
    stages: test.stages.map(s => ({
      stageId: s.stageId,
      technique: s.technique,
      name: s.name,
    })),
    tags: test.tags,
    integrations: test.integrations,
    author: test.author,
    unit: test.unit,
    createdDate: test.createdDate,
    hasAttackFlow: test.hasAttackFlow,
    hasKillChain: test.hasKillChain,
    hasDetectionFiles: test.hasDetectionFiles,
    hasDefenseGuidance: test.hasDefenseGuidance,
  });
}));

/** GET /api/v1/coverage/mitre — MITRE ATT&CK technique coverage */
router.get('/coverage/mitre', asyncHandler(async (_req, res) => {
  const indexer = getTestIndexer();
  if (!indexer) throw new AppError('Test library not initialized', 503);

  const tests = indexer.getAllTests();

  // Build technique → tests map
  const techniqueMap = new Map<string, { count: number; tests: string[]; severities: string[] }>();

  for (const test of tests) {
    for (const tech of test.techniques) {
      const existing = techniqueMap.get(tech) || { count: 0, tests: [], severities: [] };
      existing.count++;
      existing.tests.push(test.uuid);
      if (test.severity && !existing.severities.includes(test.severity)) {
        existing.severities.push(test.severity);
      }
      techniqueMap.set(tech, existing);
    }
  }

  // Build tactic → techniques map
  const tacticMap = new Map<string, Set<string>>();
  for (const test of tests) {
    for (const tactic of test.tactics || []) {
      const existing = tacticMap.get(tactic) || new Set<string>();
      for (const tech of test.techniques) {
        existing.add(tech);
      }
      tacticMap.set(tactic, existing);
    }
  }

  const techniques = Object.fromEntries(
    [...techniqueMap.entries()].map(([tech, data]) => [tech, data])
  );

  const tactics = Object.fromEntries(
    [...tacticMap.entries()].map(([tactic, techs]) => [
      tactic,
      { technique_count: techs.size, techniques: [...techs] },
    ])
  );

  res.json({
    total_tests: tests.length,
    total_techniques_covered: techniqueMap.size,
    total_tactics_covered: tacticMap.size,
    techniques,
    tactics,
  });
}));

export default router;
