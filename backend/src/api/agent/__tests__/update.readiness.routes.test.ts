import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { InstallReadiness } from '../../../types/agent.js';

// The shared clerk mock lets every permission through, so this file has its
// own: requirePermission answers 403 unless the test granted that permission.
let granted: string[] = [];
vi.mock('../../../middleware/clerk.middleware.js', () => ({
  requirePermission: (permission: string) => (_req: unknown, res: express.Response, next: express.NextFunction) => {
    if (granted.includes(permission)) return next();
    res.status(403).json({ success: false, error: 'Forbidden' });
  },
}));

const readiness: InstallReadiness = {
  any_ready: true,
  platforms: [
    { os: 'windows', arch: 'amd64', ready: true, version: '0.7.4', reason: null },
    { os: 'linux', arch: 'amd64', ready: false, version: '0.7.4', reason: 'file missing' },
    { os: 'linux', arch: 'arm64', ready: false, version: null, reason: 'no version' },
    { os: 'darwin', arch: 'arm64', ready: false, version: null, reason: 'no version' },
    { os: 'darwin', arch: 'amd64', ready: false, version: null, reason: 'no version' },
  ],
};

vi.mock('../../../services/agent/update.service.js', () => ({
  getInstallReadiness: () => readiness,
  deleteVersion: vi.fn(),
  getLatestVersion: vi.fn(),
  listVersions: vi.fn(() => []),
  registerVersion: vi.fn(),
  registerVersionFromUpload: vi.fn(),
  streamUpdate: vi.fn(),
  BinaryPathError: class extends Error {},
}));

const { createAdminUpdateRouter } = await import('../update.routes.js');
const { errorHandler } = await import('../../../middleware/error.middleware.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', createAdminUpdateRouter(null));
  app.use(errorHandler);
  return app;
}

describe('GET /admin/versions/readiness', () => {
  beforeEach(() => {
    granted = [];
  });

  it('returns the install readiness under data', async () => {
    granted = ['endpoints:versions:read'];

    const res = await request(createApp()).get('/admin/versions/readiness');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: readiness });
  });

  it('is 403 without endpoints:versions:read', async () => {
    granted = ['endpoints:versions:create', 'endpoints:versions:delete', 'endpoints:tokens:create'];

    const res = await request(createApp()).get('/admin/versions/readiness');

    expect(res.status).toBe(403);
  });
});
