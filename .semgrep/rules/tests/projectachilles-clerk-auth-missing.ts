import { Router } from 'express';
import { requireClerkAuth } from '../middleware/clerk.middleware.js';
import { asyncHandler } from '../middleware/error.middleware.js';

// --- Protected routes (should NOT trigger) ---

const protectedRouter = Router();
protectedRouter.use(requireClerkAuth());

// ok: projectachilles-clerk-auth-missing
protectedRouter.get('/items', asyncHandler(async (req, res) => {
  res.json({ items: [] });
}));

// ok: projectachilles-clerk-auth-missing
protectedRouter.post('/items', asyncHandler(async (req, res) => {
  res.json({ created: true });
}));

// --- Unprotected routes (should trigger) ---

const unprotectedRouter = Router();

// ruleid: projectachilles-clerk-auth-missing
unprotectedRouter.get('/secret', asyncHandler(async (req, res) => {
  res.json({ data: 'sensitive' });
}));

// ruleid: projectachilles-clerk-auth-missing
unprotectedRouter.post('/admin/action', asyncHandler(async (req, res) => {
  res.json({ done: true });
}));

// --- Per-route auth (should NOT trigger) ---

const mixedRouter = Router();

// ok: projectachilles-clerk-auth-missing
mixedRouter.get('/protected', requireClerkAuth(), asyncHandler(async (req, res) => {
  res.json({ ok: true });
}));
