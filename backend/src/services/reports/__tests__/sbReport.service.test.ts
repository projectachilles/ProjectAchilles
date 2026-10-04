import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnalyticsSettings } from '../../../types/analytics.js';

// ─── Mock setup ───────────────────────────────────────────────────
const mockSearch = vi.fn();

vi.mock('@elastic/elasticsearch', () => ({
  Client: vi.fn().mockImplementation(function (this: any) {
    this.search = mockSearch;
  }),
}));

const { SbReportService, parseSbReportWindow, SB_BUNDLE_ID, SB_BUNDLE_NAME, SB_STAGE_LABELS } =
  await import('../sbReport.service.js');

// ─── Helpers ──────────────────────────────────────────────────────
const SB_ORG_UUID = '09b59276-9efb-4d3d-bbdd-4b4663ef0c42';
const BUNDLE_UUID = '298cc137-ea39-4cf0-9b2d-b1c59a3cbacb';
const TASK_ID = '4c28f408-1676-40ff-a2e6-60ea5bdd6076';
const EVENT_TIME = '2026-10-02T02:35:33.000Z';

function makeSettings(overrides?: Partial<AnalyticsSettings>): AnalyticsSettings {
  return {
    connectionType: 'direct',
    node: 'http://localhost:9200',
    apiKey: 'test-key',
    indexPattern: 'achilles-results-*',
    configured: true,
    ...overrides,
  };
}

interface FixtureControl {
  control_id: string;
  validator?: string;
  exit_code: number;
  techniques: string[];
  tactics: string[];
  defender_stage_detected?: boolean;
  defender_detected?: boolean;
  hostname?: string;
  event_time?: string;
  bundle_id?: string;
}

/** Build an ES hit shaped like a real ingested bundle-control doc. */
function makeBundleHit(control: FixtureControl) {
  const hostname = control.hostname ?? 'WIN-LAB-01';
  const source: Record<string, unknown> = {
    'routing.event_time': control.event_time ?? EVENT_TIME,
    'routing.oid': SB_ORG_UUID,
    'routing.hostname': hostname,
    'event.ERROR': control.exit_code,
    'f0rtika.test_uuid': `${control.bundle_id ?? BUNDLE_UUID}::${control.control_id}`,
    'f0rtika.test_name': `LockBit 3.0 Stage — ${control.control_id}`,
    'f0rtika.is_protected': control.exit_code !== 101,
    'f0rtika.category': 'intel-driven',
    'f0rtika.subcategory': 'ransomware',
    'f0rtika.severity': 'critical',
    'f0rtika.techniques': control.techniques,
    'f0rtika.tactics': control.tactics,
    'f0rtika.threat_actor': 'LockBit 3.0',
    'f0rtika.bundle_id': control.bundle_id ?? BUNDLE_UUID,
    'f0rtika.bundle_name': 'LockBit 3.0 Double Extortion Kill Chain (SB-PC-2026-001)',
    'f0rtika.control_id': control.control_id,
    'f0rtika.is_bundle_control': true,
  };
  if (control.validator !== undefined) {
    source['f0rtika.control_validator'] = control.validator;
  }
  if (control.defender_stage_detected !== undefined) {
    source['f0rtika.defender_stage_detected'] = control.defender_stage_detected;
  }
  if (control.defender_detected !== undefined) {
    source['f0rtika.defender_detected'] = control.defender_detected;
  }
  return { _id: `${TASK_ID}::${control.control_id}`, _source: source };
}

/** The real lab fixture: staging/298cc137…/bundle_results.json (5 stages,
 * exits 101/126/101/101/101, no defender detections). */
function makeLabFixtureHits() {
  return [
    makeBundleHit({ control_id: 'T1059.001', validator: 'Stage 1', exit_code: 101, techniques: ['T1059.001'], tactics: ['execution', 'defense-evasion'] }),
    makeBundleHit({ control_id: 'T1003.001', validator: 'Stage 2', exit_code: 126, techniques: ['T1003.001'], tactics: ['credential-access'] }),
    makeBundleHit({ control_id: 'T1021.002', validator: 'Stage 3', exit_code: 101, techniques: ['T1021.002'], tactics: ['lateral-movement'] }),
    makeBundleHit({ control_id: 'T1567.002', validator: 'Stage 4', exit_code: 101, techniques: ['T1567.002'], tactics: ['exfiltration'] }),
    makeBundleHit({ control_id: 'T1486', validator: 'Stage 5', exit_code: 101, techniques: ['T1486'], tactics: ['impact'] }),
  ];
}

function esSearchResponse(hits: unknown[]) {
  return {
    hits: {
      total: { value: hits.length, relation: 'eq' },
      hits,
    },
  };
}

const WINDOW = { from: '2026-10-01T00:00:00Z', to: '2026-10-03T00:00:00Z' };

function createService() {
  return new SbReportService(makeSettings());
}

// ─── Tests ────────────────────────────────────────────────────────
describe('sbReport.service.ts', () => {
  beforeEach(() => {
    mockSearch.mockReset();
  });

  describe('parseSbReportWindow', () => {
    it('accepts a valid ISO window', () => {
      expect(parseSbReportWindow(WINDOW.from, WINDOW.to)).toEqual(WINDOW);
    });

    it('accepts date-only bounds', () => {
      expect(parseSbReportWindow('2026-10-01', '2026-10-02')).toEqual({ from: '2026-10-01', to: '2026-10-02' });
    });

    it('rejects missing bounds with a 400 AppError', () => {
      expect(() => parseSbReportWindow(undefined, WINDOW.to)).toThrowError(/required/);
      expect(() => parseSbReportWindow(WINDOW.from, '')).toThrowError(/required/);
      try {
        parseSbReportWindow(undefined, undefined);
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('rejects unparseable dates', () => {
      expect(() => parseSbReportWindow('not-a-date', WINDOW.to)).toThrowError(/valid ISO dates/);
    });

    it('rejects from >= to', () => {
      expect(() => parseSbReportWindow(WINDOW.to, WINDOW.from)).toThrowError(/from must be before to/);
      expect(() => parseSbReportWindow(WINDOW.from, WINDOW.from)).toThrowError(/from must be before to/);
    });
  });

  describe('generateSbReport', () => {
    it('maps the real lab fixture to MISSED/PREVENTED/MISSED/EXPOSED/EXPOSED', async () => {
      mockSearch.mockResolvedValue(esSearchResponse(makeLabFixtureHits()));

      const report = await createService().generateSbReport({ ...WINDOW, org: SB_ORG_UUID });

      expect(report.executions).toHaveLength(5);
      const byStage = new Map(report.executions.map((r) => [r.stage, r]));
      expect(byStage.get(1)?.outcome).toBe('MISSED');
      expect(byStage.get(2)?.outcome).toBe('PREVENTED');
      expect(byStage.get(3)?.outcome).toBe('MISSED');
      expect(byStage.get(4)?.outcome).toBe('EXPOSED');
      expect(byStage.get(5)?.outcome).toBe('EXPOSED');

      // isProtected iff PREVENTED or DETECTED
      expect(byStage.get(1)?.isProtected).toBe(false);
      expect(byStage.get(2)?.isProtected).toBe(true);

      // Envelope constants and per-row contract fields
      for (const row of report.executions) {
        expect(row.bundleId).toBe(SB_BUNDLE_ID);
        expect(row.bundleName).toBe(SB_BUNDLE_NAME);
        expect(row.hostname).toBe('WIN-LAB-01');
        expect(row.timestamp).toBe(EVENT_TIME);
        expect(row.sourceEventId).toMatch(/^4c28f408-1676-40ff-a2e6-60ea5bdd6076::/);
        expect(row.stageLabel).toBe(SB_STAGE_LABELS[row.stage]);
        expect(row.techniques.length).toBeGreaterThan(0);
        expect(row.evidenceRef).toContain(row.sourceEventId);
      }

      // Tactics converted to TA codes
      expect(byStage.get(1)?.tactics).toEqual(['TA0002', 'TA0005']);
      expect(byStage.get(2)?.tactics).toEqual(['TA0006']);
      expect(byStage.get(4)?.tactics).toEqual(['TA0010']);
      expect(byStage.get(5)?.tactics).toEqual(['TA0040']);

      // No defender detection data -> no preventedBy/detectedBy attribution
      expect(byStage.get(2)?.preventedBy).toEqual([]);
      expect(byStage.get(2)?.detectedBy).toEqual([]);
    });

    it('builds meta with org short name from ORG_NAMES, default vendor, and generatedAt', async () => {
      mockSearch.mockResolvedValue(esSearchResponse(makeLabFixtureHits()));

      const report = await createService().generateSbReport({ ...WINDOW, org: SB_ORG_UUID });

      expect(report.meta.organization).toBe('SB');
      expect(report.meta.vendor).toBe('ProjectAchilles');
      expect(report.meta.window).toEqual(WINDOW);
      expect(new Date(report.meta.generatedAt).toString()).not.toBe('Invalid Date');
    });

    it('honors org_code and vendor overrides', async () => {
      mockSearch.mockResolvedValue(esSearchResponse(makeLabFixtureHits()));

      const report = await createService().generateSbReport({
        ...WINDOW, org: SB_ORG_UUID, orgCode: 'ENT-001', vendor: 'F0RT1KA / ProjectAchilles',
      });

      expect(report.meta.organization).toBe('ENT-001');
      expect(report.meta.vendor).toBe('F0RT1KA / ProjectAchilles');
    });

    it('maps exit 101 with defender_stage_detected to DETECTED with detectedBy', async () => {
      const hits = [
        makeBundleHit({ control_id: 'T1003.001', validator: 'Stage 2', exit_code: 101, techniques: ['T1003.001'], tactics: ['credential-access'], defender_stage_detected: true }),
      ];
      mockSearch.mockResolvedValue(esSearchResponse(hits));

      const report = await createService().generateSbReport({ ...WINDOW, org: SB_ORG_UUID });

      expect(report.executions[0].outcome).toBe('DETECTED');
      expect(report.executions[0].isProtected).toBe(true);
      expect(report.executions[0].detectedBy).toEqual(['Microsoft Defender for Endpoint']);
    });

    it('maps exit 101 with only bundle-level defender_detected to DETECTED', async () => {
      const hits = [
        makeBundleHit({ control_id: 'T1059.001', validator: 'Stage 1', exit_code: 101, techniques: ['T1059.001'], tactics: ['execution'], defender_detected: true }),
      ];
      mockSearch.mockResolvedValue(esSearchResponse(hits));

      const report = await createService().generateSbReport({ ...WINDOW, org: SB_ORG_UUID });

      expect(report.executions[0].outcome).toBe('DETECTED');
    });

    it('attributes preventedBy when a PREVENTED row also carries defender detection', async () => {
      const hits = [
        makeBundleHit({ control_id: 'T1003.001', validator: 'Stage 2', exit_code: 126, techniques: ['T1003.001'], tactics: ['credential-access'], defender_detected: true }),
      ];
      mockSearch.mockResolvedValue(esSearchResponse(hits));

      const report = await createService().generateSbReport({ ...WINDOW, org: SB_ORG_UUID });

      expect(report.executions[0].outcome).toBe('PREVENTED');
      expect(report.executions[0].preventedBy).toEqual(['Microsoft Defender for Endpoint']);
    });

    it('maps inconclusive exits (200/259/260) to ERROR with an inconclusive note in evidenceRef', async () => {
      const hits = [
        makeBundleHit({ control_id: 'T1059.001', validator: 'Stage 1', exit_code: 259, techniques: ['T1059.001'], tactics: ['execution'] }),
      ];
      mockSearch.mockResolvedValue(esSearchResponse(hits));

      const report = await createService().generateSbReport({ ...WINDOW, org: SB_ORG_UUID });

      expect(report.executions[0].outcome).toBe('ERROR');
      expect(report.executions[0].isProtected).toBe(false);
      expect(report.executions[0].evidenceRef).toContain('inconclusive: StillActive');
    });

    it('maps 999 and unknown exits to ERROR', async () => {
      const hits = [
        makeBundleHit({ control_id: 'T1059.001', validator: 'Stage 1', exit_code: 999, techniques: ['T1059.001'], tactics: ['execution'] }),
        makeBundleHit({ control_id: 'T1003.001', validator: 'Stage 2', exit_code: 42, techniques: ['T1003.001'], tactics: ['credential-access'] }),
      ];
      mockSearch.mockResolvedValue(esSearchResponse(hits));

      const report = await createService().generateSbReport({ ...WINDOW, org: SB_ORG_UUID });

      expect(report.executions.map((r) => r.outcome)).toEqual(['ERROR', 'ERROR']);
      expect(report.executions[0].evidenceRef).toContain('UnexpectedTestError');
    });

    it('emits one row per stage per endpoint for multi-host runs', async () => {
      const stageControls = [
        { control_id: 'T1059.001', validator: 'Stage 1', exit_code: 101, techniques: ['T1059.001'], tactics: ['execution', 'defense-evasion'] },
        { control_id: 'T1486', validator: 'Stage 5', exit_code: 101, techniques: ['T1486'], tactics: ['impact'] },
      ];
      const hits = [
        ...stageControls.map((c) => makeBundleHit({ ...c, hostname: 'HOST-A' })),
        ...stageControls.map((c) => makeBundleHit({ ...c, hostname: 'HOST-B' })),
      ];
      mockSearch.mockResolvedValue(esSearchResponse(hits));

      const report = await createService().generateSbReport({ ...WINDOW, org: SB_ORG_UUID });

      expect(report.executions).toHaveLength(4);
      expect(report.executions.filter((r) => r.hostname === 'HOST-A')).toHaveLength(2);
      expect(report.executions.filter((r) => r.hostname === 'HOST-B')).toHaveLength(2);
      // Sorted by hostname then stage
      expect(report.executions.map((r) => `${r.hostname}:${r.stage}`)).toEqual([
        'HOST-A:1', 'HOST-A:5', 'HOST-B:1', 'HOST-B:5',
      ]);
    });

    it('parses the stage number from control_validator ("Stage N: …" format)', async () => {
      const hits = [
        makeBundleHit({ control_id: 'T1486', validator: 'Stage 5: Impact: Encryption & Recovery Inhibition', exit_code: 101, techniques: ['T1486'], tactics: ['impact'] }),
      ];
      mockSearch.mockResolvedValue(esSearchResponse(hits));

      const report = await createService().generateSbReport({ ...WINDOW, org: SB_ORG_UUID });

      expect(report.executions[0].stage).toBe(5);
      expect(report.executions[0].stageLabel).toBe(SB_STAGE_LABELS[5]);
    });

    it('falls back to control_id ordering when control_validator is missing', async () => {
      // Deliberately scrambled input order; fallback numbering comes from
      // control_id sort order within the execution group.
      const hits = [
        makeBundleHit({ control_id: 'T1486', validator: undefined, exit_code: 101, techniques: ['T1486'], tactics: ['impact'] }),
        makeBundleHit({ control_id: 'T1003.001', validator: undefined, exit_code: 126, techniques: ['T1003.001'], tactics: ['credential-access'] }),
        makeBundleHit({ control_id: 'T1059.001', validator: undefined, exit_code: 101, techniques: ['T1059.001'], tactics: ['execution'] }),
      ];
      mockSearch.mockResolvedValue(esSearchResponse(hits));

      const report = await createService().generateSbReport({ ...WINDOW, org: SB_ORG_UUID });
      const byTechnique = new Map(report.executions.map((r) => [r.techniques[0], r]));

      expect(byTechnique.get('T1003.001')?.stage).toBe(1);
      expect(byTechnique.get('T1059.001')?.stage).toBe(2);
      expect(byTechnique.get('T1486')?.stage).toBe(3);
    });

    it('returns an empty executions array for an empty window', async () => {
      mockSearch.mockResolvedValue(esSearchResponse([]));

      const report = await createService().generateSbReport({ ...WINDOW, org: SB_ORG_UUID });

      expect(report.executions).toEqual([]);
      expect(report.meta.organization).toBe('SB');
    });

    it('scopes the ES query to bundle controls, the window, org, and bundle_uuid', async () => {
      mockSearch.mockResolvedValue(esSearchResponse([]));

      await createService().generateSbReport({
        ...WINDOW, org: SB_ORG_UUID, bundleUuid: BUNDLE_UUID,
      });

      expect(mockSearch).toHaveBeenCalledTimes(1);
      const searchArgs = mockSearch.mock.calls[0][0];
      expect(searchArgs.index).toBe('achilles-results-*');
      const filters = searchArgs.query.bool.filter;
      expect(filters).toContainEqual({ term: { 'f0rtika.is_bundle_control': true } });
      expect(filters).toContainEqual({ range: { 'routing.event_time': { gte: WINDOW.from, lte: WINDOW.to } } });
      expect(filters).toContainEqual({ term: { 'routing.oid': SB_ORG_UUID } });
      expect(filters).toContainEqual({ term: { 'f0rtika.bundle_id': BUNDLE_UUID } });
    });

    it('omits org and bundle filters when not provided', async () => {
      mockSearch.mockResolvedValue(esSearchResponse([]));

      const report = await createService().generateSbReport({ ...WINDOW });

      const searchArgs = mockSearch.mock.calls[0][0];
      // Base filters only: is_bundle_control, test-data parity, event_time range
      expect(searchArgs.query.bool.filter).toHaveLength(3);
      expect(report.meta.organization).toBe('unknown');
    });

    it('applies the analytics test-data parity filter (exists test_uuid + test_name)', async () => {
      mockSearch.mockResolvedValue(esSearchResponse([]));

      await createService().generateSbReport({ ...WINDOW });

      const filters = mockSearch.mock.calls[0][0].query.bool.filter;
      expect(filters).toContainEqual({
        bool: {
          must: [
            { exists: { field: 'f0rtika.test_uuid' } },
            { exists: { field: 'f0rtika.test_name' } },
          ],
        },
      });
    });

    it('sorts by routing.event_time desc so truncation keeps the newest runs', async () => {
      mockSearch.mockResolvedValue(esSearchResponse([]));

      await createService().generateSbReport({ ...WINDOW });

      expect(mockSearch.mock.calls[0][0].sort).toEqual([{ 'routing.event_time': 'desc' }]);
    });

    it('maps scope filters to the same ES fields and semantics as the analytics filter bar', async () => {
      mockSearch.mockResolvedValue(esSearchResponse([]));

      await createService().generateSbReport({
        ...WINDOW,
        tags: 'sb-bulletin',
        hostnames: 'HOST-A',
        tests: 'LockBit Stage 1',
        bundleNames: 'LockBit 3.0 Double Extortion Kill Chain (SB-PC-2026-001)',
      });

      const filters = mockSearch.mock.calls[0][0].query.bool.filter;
      // Single values collapse to plain term clauses
      expect(filters).toContainEqual({ term: { 'f0rtika.tags': 'sb-bulletin' } });
      expect(filters).toContainEqual({ term: { 'routing.hostname': 'HOST-A' } });
      expect(filters).toContainEqual({ term: { 'f0rtika.test_name': 'LockBit Stage 1' } });
      expect(filters).toContainEqual({ term: { 'f0rtika.bundle_name': 'LockBit 3.0 Double Extortion Kill Chain (SB-PC-2026-001)' } });
    });

    it('uses bool should + minimum_should_match for multi-value scope filters', async () => {
      mockSearch.mockResolvedValue(esSearchResponse([]));

      await createService().generateSbReport({
        ...WINDOW,
        tags: 'sb-bulletin, quarterly',
        hostnames: 'HOST-A, HOST-B ,,',
      });

      const filters = mockSearch.mock.calls[0][0].query.bool.filter;
      expect(filters).toContainEqual({
        bool: {
          should: [
            { term: { 'f0rtika.tags': 'sb-bulletin' } },
            { term: { 'f0rtika.tags': 'quarterly' } },
          ],
          minimum_should_match: 1,
        },
      });
      expect(filters).toContainEqual({
        bool: {
          should: [
            { term: { 'routing.hostname': 'HOST-A' } },
            { term: { 'routing.hostname': 'HOST-B' } },
          ],
          minimum_should_match: 1,
        },
      });
    });

    it('ignores empty scope filter values', async () => {
      mockSearch.mockResolvedValue(esSearchResponse([]));

      await createService().generateSbReport({ ...WINDOW, tags: ' , ', hostnames: '' });

      // No extra filters beyond the base three
      expect(mockSearch.mock.calls[0][0].query.bool.filter).toHaveLength(3);
    });

    it('warns loudly when the export mixes more than one bundle', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const hits = [
        makeBundleHit({ control_id: 'T1059.001', validator: 'Stage 1', exit_code: 101, techniques: ['T1059.001'], tactics: ['execution'] }),
        makeBundleHit({ control_id: 'T1083', validator: 'Stage 1', exit_code: 101, techniques: ['T1083'], tactics: ['discovery'], bundle_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
      ];
      mockSearch.mockResolvedValue(esSearchResponse(hits));

      try {
        await createService().generateSbReport({ ...WINDOW });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('mixes 2 distinct bundles'));
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('does not warn when the export covers a single bundle', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockSearch.mockResolvedValue(esSearchResponse(makeLabFixtureHits()));

      try {
        await createService().generateSbReport({ ...WINDOW });
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
