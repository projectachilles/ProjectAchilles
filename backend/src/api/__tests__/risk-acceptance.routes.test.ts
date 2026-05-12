import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mock Clerk middleware ─────────────────────────────────────────
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  requireAuth: () => (_req: any, _res: any, next: any) => next(),
  clerkClient: {
    users: {
      getUser: vi.fn().mockResolvedValue({
        firstName: 'Test',
        lastName: 'User',
        emailAddresses: [{ emailAddress: 'test@example.com' }],
      }),
    },
  },
}));

vi.mock('../../middleware/clerk.middleware.js', () => ({
  clerkAuth: (_req: any, _res: any, next: any) => next(),
  requireClerkAuth: () => (req: any, _res: any, next: any) => {
    req.auth = {
      userId: 'test-user-001',
      sessionClaims: { name: 'Test User', email: 'test@example.com' },
    };
    next();
  },
  getUserId: (auth: any) => auth?.userId || 'test-user-001',
  getUserOrgId: (auth: any) => auth?.orgId || auth?.sessionClaims?.org_id || 'org-001',
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

// ── Mock the settings service (needed by getRiskService) ──────────
vi.mock('../../services/analytics/settings.js', () => ({
  SettingsService: class MockSettingsService {
    getSettings = vi.fn().mockReturnValue({
      configured: true,
      connectionType: 'direct',
      node: 'http://localhost:9200',
      indexPattern: 'f0rtika-*',
    });
  },
}));

// ── Mock the ES client factory ────────────────────────────────────
vi.mock('../../services/analytics/client.js', () => ({
  createEsClient: vi.fn().mockReturnValue({}),
}));

// ── Mock the RiskAcceptanceService ────────────────────────────────
const mockAcceptRisk = vi.fn();
const mockRevokeRisk = vi.fn();
const mockGetAcceptanceById = vi.fn();
const mockListAcceptances = vi.fn();
const mockGetAcceptancesForControls = vi.fn();

vi.mock('../../services/risk-acceptance/risk-acceptance.service.js', () => ({
  RiskAcceptanceService: vi.fn().mockImplementation(function (this: any) {
    this.acceptRisk = mockAcceptRisk;
    this.revokeRisk = mockRevokeRisk;
    this.getAcceptanceById = mockGetAcceptanceById;
    this.listAcceptances = mockListAcceptances;
    this.getAcceptancesForControls = mockGetAcceptancesForControls;
    this.buildExclusionFilter = vi.fn().mockResolvedValue(null);
    this.invalidateCache = vi.fn();
  }),
}));

// ── Mock index-management ─────────────────────────────────────────
vi.mock('../../services/risk-acceptance/index-management.js', () => ({
  RISK_ACCEPTANCE_INDEX: 'achilles-risk-acceptances',
  ensureRiskAcceptanceIndex: vi.fn().mockResolvedValue(undefined),
}));

const { default: riskRoutes } = await import('../risk-acceptance.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');

// ── Helper ────────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/risk-acceptances', riskRoutes);
  app.use(errorHandler);
  return app;
}

function makeAcceptanceDoc(overrides?: Record<string, unknown>) {
  return {
    acceptance_id: 'acc-001',
    test_name: 'T1059-powershell',
    justification: 'Compensating control is deployed and verified.',
    accepted_by: 'test-user-001',
    accepted_by_name: 'Test User',
    accepted_at: '2026-02-15T10:00:00.000Z',
    status: 'active',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('risk-acceptance routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── POST /api/risk-acceptances ──────────────────────────────────

  describe('POST /api/risk-acceptances', () => {
    it('creates acceptance and returns 201', async () => {
      const doc = makeAcceptanceDoc();
      mockAcceptRisk.mockResolvedValue(doc);

      const app = createApp();
      const res = await request(app)
        .post('/api/risk-acceptances')
        .send({
          test_name: 'T1059-powershell',
          justification: 'Compensating control is deployed and verified.',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.acceptance_id).toBe('acc-001');
      expect(mockAcceptRisk).toHaveBeenCalledWith(
        expect.objectContaining({
          test_name: 'T1059-powershell',
          justification: 'Compensating control is deployed and verified.',
          accepted_by: 'test-user-001',
          accepted_by_name: 'Test User',
        }),
      );
    });

    it('passes optional control_id and hostname', async () => {
      mockAcceptRisk.mockResolvedValue(makeAcceptanceDoc({ control_id: 'CH-DEF-001', hostname: 'srv-01' }));

      const app = createApp();
      const res = await request(app)
        .post('/api/risk-acceptances')
        .send({
          test_name: 'cyber-hygiene-baseline',
          control_id: 'CH-DEF-001',
          hostname: 'srv-01',
          justification: 'Accepted for specific host — compensating control.',
        });

      expect(res.status).toBe(201);
      expect(mockAcceptRisk).toHaveBeenCalledWith(
        expect.objectContaining({
          control_id: 'CH-DEF-001',
          hostname: 'srv-01',
        }),
      );
    });

    it('returns 400 when test_name is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/risk-acceptances')
        .send({ justification: 'This has no test name but enough characters.' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('test_name');
    });

    it('returns 400 when justification is too short', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/risk-acceptances')
        .send({ test_name: 'T1059-powershell', justification: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('justification');
      expect(res.body.error).toContain('10 characters');
    });

    it('returns 400 when justification is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/risk-acceptances')
        .send({ test_name: 'T1059-powershell' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('justification');
    });
  });

  // ── POST /api/risk-acceptances/:id/revoke ───────────────────────

  describe('POST /api/risk-acceptances/:id/revoke', () => {
    it('revokes an acceptance and returns 200', async () => {
      const revokedDoc = makeAcceptanceDoc({
        status: 'revoked',
        revoked_by: 'test-user-001',
        revoked_by_name: 'Test User',
        revocation_reason: 'Compensating control removed from environment.',
        revoked_at: '2026-02-20T14:00:00.000Z',
      });
      mockRevokeRisk.mockResolvedValue(revokedDoc);

      const app = createApp();
      const res = await request(app)
        .post('/api/risk-acceptances/acc-001/revoke')
        .send({ reason: 'Compensating control removed from environment.' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('revoked');
      expect(mockRevokeRisk).toHaveBeenCalledWith('acc-001', expect.objectContaining({
        revoked_by: 'test-user-001',
        revoked_by_name: 'Test User',
        revocation_reason: 'Compensating control removed from environment.',
      }), 'org-001');
    });

    it('returns 400 when reason is too short', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/risk-acceptances/acc-001/revoke')
        .send({ reason: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('reason');
      expect(res.body.error).toContain('10 characters');
    });

    it('returns 400 when reason is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/risk-acceptances/acc-001/revoke')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('reason');
    });

    it('returns 500 when service throws (e.g., not found)', async () => {
      mockRevokeRisk.mockRejectedValue(new Error('Risk acceptance not found: acc-999'));

      const app = createApp();
      const res = await request(app)
        .post('/api/risk-acceptances/acc-999/revoke')
        .send({ reason: 'This acceptance does not exist in the system.' });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('not found');
    });
  });

  // ── GET /api/risk-acceptances ───────────────────────────────────

  describe('GET /api/risk-acceptances', () => {
    it('lists acceptances with defaults', async () => {
      const docs = [makeAcceptanceDoc(), makeAcceptanceDoc({ acceptance_id: 'acc-002' })];
      mockListAcceptances.mockResolvedValue({ data: docs, total: 2 });

      const app = createApp();
      const res = await request(app).get('/api/risk-acceptances');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(mockListAcceptances).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, pageSize: 50 }),
      );
    });

    it('passes status filter', async () => {
      mockListAcceptances.mockResolvedValue({ data: [], total: 0 });

      const app = createApp();
      const res = await request(app).get('/api/risk-acceptances?status=active');

      expect(res.status).toBe(200);
      expect(mockListAcceptances).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active' }),
      );
    });

    it('passes test_name filter', async () => {
      mockListAcceptances.mockResolvedValue({ data: [], total: 0 });

      const app = createApp();
      const res = await request(app).get('/api/risk-acceptances?test_name=T1059-powershell');

      expect(res.status).toBe(200);
      expect(mockListAcceptances).toHaveBeenCalledWith(
        expect.objectContaining({ test_name: 'T1059-powershell' }),
      );
    });

    it('passes pagination parameters', async () => {
      mockListAcceptances.mockResolvedValue({ data: [], total: 0 });

      const app = createApp();
      const res = await request(app).get('/api/risk-acceptances?page=3&pageSize=10');

      expect(res.status).toBe(200);
      expect(mockListAcceptances).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3, pageSize: 10 }),
      );
    });
  });

  // ── GET /api/risk-acceptances/:id ───────────────────────────────

  describe('GET /api/risk-acceptances/:id', () => {
    it('returns single acceptance', async () => {
      const doc = makeAcceptanceDoc();
      mockGetAcceptanceById.mockResolvedValue(doc);

      const app = createApp();
      const res = await request(app).get('/api/risk-acceptances/acc-001');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.acceptance_id).toBe('acc-001');
    });

    it('returns 404 when not found', async () => {
      mockGetAcceptanceById.mockResolvedValue(null);

      const app = createApp();
      const res = await request(app).get('/api/risk-acceptances/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  // ── POST /api/risk-acceptances/lookup ───────────────────────────

  describe('POST /api/risk-acceptances/lookup', () => {
    it('returns grouped results for valid test_names', async () => {
      const grouped = {
        'T1059-powershell': [makeAcceptanceDoc()],
        'T1486-ransomware': [makeAcceptanceDoc({ acceptance_id: 'acc-002', test_name: 'T1486-ransomware' })],
      };
      mockGetAcceptancesForControls.mockResolvedValue(grouped);

      const app = createApp();
      const res = await request(app)
        .post('/api/risk-acceptances/lookup')
        .send({ test_names: ['T1059-powershell', 'T1486-ransomware'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data['T1059-powershell']).toHaveLength(1);
      expect(res.body.data['T1486-ransomware']).toHaveLength(1);
    });

    it('returns 400 when test_names is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/risk-acceptances/lookup')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
    });

    it('returns 400 when test_names is empty array', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/risk-acceptances/lookup')
        .send({ test_names: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
    });

    it('returns 400 when test_names is not an array', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/risk-acceptances/lookup')
        .send({ test_names: 'not-an-array' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
    });

    it('returns 400 when test_names exceeds 500', async () => {
      const app = createApp();
      const longArray = Array.from({ length: 501 }, (_, i) => `test-${i}`);
      const res = await request(app)
        .post('/api/risk-acceptances/lookup')
        .send({ test_names: longArray });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('500');
    });
  });
});
