import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Per-test auth shape attached by the mocked requireClerkAuth
let authShape: Record<string, unknown> | undefined;

vi.mock('../../middleware/clerk.middleware.js', () => ({
  clerkAuth: (_req: any, _res: any, next: any) => next(),
  requireClerkAuth: () => (req: any, _res: any, next: any) => {
    req.auth = authShape;
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

const identity = { code: 'ACME', name: 'Acme Financial Group', color: 'violet', source: 'saved' };
const mockGet = vi.fn();
const mockSave = vi.fn();
const mockReset = vi.fn();

vi.mock('../../services/consoleIdentity/consoleIdentity.service.js', async (orig) => {
  const actual = await orig<typeof import('../../services/consoleIdentity/consoleIdentity.service.js')>();
  return {
    ...actual,
    ConsoleIdentityService: class {
      get = mockGet;
      save = mockSave;
      reset = mockReset;
    },
  };
});

const { default: consoleIdentityRoutes } = await import('../consoleIdentity.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');

const app = express();
app.use(express.json());
app.use('/api/settings/identity', consoleIdentityRoutes);
app.use(errorHandler);

const SESSION = { tokenType: 'session_token', userId: 'user_1' };
const CLI = { userId: 'user_1' };
const API_KEY = { userId: 'apikey:k1', apiKeyPermissions: new Set<string>() };

beforeEach(() => {
  vi.clearAllMocks();
  authShape = SESSION;
  mockGet.mockReturnValue(identity);
  mockSave.mockReturnValue(identity);
  mockReset.mockReturnValue({ ...identity, source: 'env' });
});

describe('console identity routes', () => {
  it('GET returns the identity for any authenticated caller (even non-session)', async () => {
    authShape = API_KEY;
    const res = await request(app).get('/api/settings/identity');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: identity });
  });

  it('PUT normalizes and saves', async () => {
    const res = await request(app).put('/api/settings/identity').send({ code: ' acme ', name: '  ', color: 'violet' });
    expect(res.status).toBe(200);
    expect(mockSave).toHaveBeenCalledWith({ code: 'ACME', name: null, color: 'violet' });
    expect(res.body).toEqual({ success: true, data: identity });
  });

  it('PUT rejects a bad code with 400', async () => {
    const res = await request(app).put('/api/settings/identity').send({ code: 'a', name: null, color: 'violet' });
    expect(res.status).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('PUT rejects a non-preset colour with 400', async () => {
    const res = await request(app).put('/api/settings/identity').send({ code: 'ACME', name: null, color: 'green' });
    expect(res.status).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('PUT rejects a name over 80 chars with 400', async () => {
    const res = await request(app).put('/api/settings/identity').send({ code: 'ACME', name: 'x'.repeat(81), color: 'none' });
    expect(res.status).toBe(400);
  });

  it('surfaces a service error as 400', async () => {
    mockSave.mockImplementation(() => { throw new Error('Invalid code'); });
    const res = await request(app).put('/api/settings/identity').send({ code: 'ACME', name: null, color: 'none' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid code');
  });

  it('DELETE resets', async () => {
    const res = await request(app).delete('/api/settings/identity');
    expect(res.status).toBe(200);
    expect(mockReset).toHaveBeenCalledOnce();
    expect(res.body.data.source).toBe('env');
  });

  describe.each([['CLI', CLI], ['API-key', API_KEY]])('%s-shaped auth cannot write', (_n, shape) => {
    it('PUT is 403 and never saves', async () => {
      authShape = shape as Record<string, unknown>;
      const res = await request(app).put('/api/settings/identity').send({ code: 'ACME', name: null, color: 'violet' });
      expect(res.status).toBe(403);
      expect(mockSave).not.toHaveBeenCalled();
    });
    it('DELETE is 403 and never resets', async () => {
      authShape = shape as Record<string, unknown>;
      const res = await request(app).delete('/api/settings/identity');
      expect(res.status).toBe(403);
      expect(mockReset).not.toHaveBeenCalled();
    });
  });
});
