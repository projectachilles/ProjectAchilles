import { Router } from 'express';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { requirePermission } from '../../middleware/clerk.middleware.js';
import { initCatalog, getCatalogSize } from '../../services/agent/test-catalog.service.js';
import type { TestSource } from '../../types/test.js';

export function createAdminCatalogRouter(testSources: TestSource[] | string): Router {
  const router = Router();

  /**
   * POST /api/agent/admin/catalog/reload
   * Re-scan the test library and rebuild the in-memory catalog.
   */
  router.post(
    '/catalog/reload',
    requirePermission('tests:sync:execute'),
    asyncHandler(async (_req, res) => {
      initCatalog(testSources);
      res.json({ success: true, catalogSize: getCatalogSize() });
    }),
  );

  return router;
}
