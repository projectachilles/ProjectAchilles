import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

let signedIn = true;

vi.mock('../../middleware/clerk.middleware.js', async (orig) => {
  const actual = await orig<typeof import('../../middleware/clerk.middleware.js')>();
  return {
    ...actual,
    requireClerkAuth: () => (req: any, res: any, next: any) => {
      if (!signedIn) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      req.auth = { userId: 'user_1' };
      next();
    },
  };
});

const about = { platform: { version: '2.11.0' }, agent: { official: null }, latest: { enabled: false } };
const mockGetAbout = vi.fn(() => about);
vi.mock('../../services/about/about.service.js', () => ({ getAbout: mockGetAbout }));

const { default: aboutRoutes } = await import('../about.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');

const app = express();
app.use('/api/about', aboutRoutes);
app.use(errorHandler);

describe('GET /api/about', () => {
  beforeEach(() => {
    signedIn = true;
    mockGetAbout.mockClear();
  });

  it('needs a signed-in caller', async () => {
    signedIn = false;
    const res = await request(app).get('/api/about');
    expect(res.status).toBe(401);
    expect(mockGetAbout).not.toHaveBeenCalled();
  });

  it('returns what the install is running to any signed-in caller', async () => {
    const res = await request(app).get('/api/about');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: about });
  });
});
