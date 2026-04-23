import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Task, TaskResult, BundleResults } from '../../../types/agent.js';

// ── Mock setup ──────────────────────────────────────────────────────

const mockGetSettings = vi.fn();
const mockIsConfigured = vi.fn();

vi.mock('../../analytics/settings.js', () => ({
  SettingsService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.getSettings = mockGetSettings;
    this.isConfigured = mockIsConfigured;
  }),
}));

const mockEsIndex = vi.fn();
const mockEsBulk = vi.fn();

vi.mock('../../analytics/client.js', () => ({
  createEsClient: vi.fn(() => ({
    index: mockEsIndex,
    bulk: mockEsBulk,
  })),
}));

// Import ERROR_CODE_MAP from the real module — it's a static map we don't mock
const { ERROR_CODE_MAP } = await import('../../analytics/elasticsearch.js');

const { ingestResult, resetClient } = await import('../results.service.js');

// ── Helpers ──────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-001',
    agent_id: 'agent-001',
    org_id: 'org-001',
    type: 'execute_test',
    priority: 1,
    status: 'completed',
    payload: {
      test_uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      test_name: 'Credential Dumping',
      binary_name: 'test.exe',
      binary_sha256: 'abc123',
      binary_size: 2048,
      execution_timeout: 60,
      arguments: [],
      metadata: {
        category: 'cyber-hygiene',
        subcategory: 'credentials',
        severity: 'high',
        techniques: ['T1003'],
        tactics: ['TA0006'],
        threat_actor: 'APT29',
        target: ['windows-endpoint'],
        complexity: 'medium',
        tags: ['lsass'],
        score: 8.5,
      },
    },
    result: null,
    notes: null,
    notes_history: [],
    created_at: '2026-01-01T00:00:00Z',
    assigned_at: null,
    completed_at: null,
    ttl: 3600,
    created_by: 'admin',
    target_index: null,
    ...overrides,
  } as Task;
}

function makeResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    task_id: 'task-001',
    test_uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    exit_code: 101,
    stdout: 'test output',
    stderr: '',
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:01:00Z',
    execution_duration_ms: 60000,
    binary_sha256: 'abc123',
    hostname: 'workstation-01',
    os: 'windows',
    arch: 'amd64',
    ...overrides,
  };
}

function makeBundle(overrides: Partial<BundleResults> = {}): BundleResults {
  return {
    schema_version: '1.0',
    bundle_id: 'a3c923ae-1a46-4b1f-b696-be6c2731a628',
    bundle_name: 'Cyber-Hygiene Bundle',
    bundle_category: 'cyber-hygiene',
    bundle_subcategory: 'baseline',
    execution_id: 'exec-001',
    started_at: '2026-02-16T14:30:00Z',
    completed_at: '2026-02-16T14:31:45Z',
    overall_exit_code: 101,
    total_controls: 2,
    passed_controls: 1,
    failed_controls: 1,
    controls: [
      {
        control_id: 'CH-DEF-001', control_name: 'Real-time Protection',
        validator: 'Microsoft Defender', exit_code: 126, compliant: true,
        severity: 'critical', category: 'cyber-hygiene', subcategory: 'baseline',
        techniques: ['T1562.001'], tactics: ['defense-evasion'],
        expected: 'Enabled', actual: 'Enabled', details: 'Enabled',
        skipped: false, error_message: '',
      },
      {
        control_id: 'CH-DEF-002', control_name: 'Behavior Monitoring',
        validator: 'Microsoft Defender', exit_code: 101, compliant: false,
        severity: 'high', category: 'cyber-hygiene', subcategory: 'baseline',
        techniques: ['T1562.001'], tactics: ['defense-evasion'],
        expected: 'Enabled', actual: 'Disabled', details: 'Disabled',
        skipped: false, error_message: '',
      },
    ],
    ...overrides,
  };
}

function configuredSettings() {
  return {
    connectionType: 'direct' as const,
    node: 'http://localhost:9200',
    apiKey: 'test-key',
    indexPattern: 'f0rtika-results',
    configured: true,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('results.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClient();
    mockIsConfigured.mockReturnValue(true);
    mockGetSettings.mockReturnValue(configuredSettings());
    mockEsIndex.mockResolvedValue({});
    mockEsBulk.mockResolvedValue({});
  });

  // ── Group 1: Client Initialization ─────────────────────────

  describe('client initialization', () => {
    it('throws when Elasticsearch is not configured', async () => {
      mockIsConfigured.mockReturnValue(false);

      await expect(ingestResult(makeTask(), makeResult()))
        .rejects.toThrow('Elasticsearch is not configured');
    });

    it('lazily initializes ES client on first call', async () => {
      await ingestResult(makeTask(), makeResult());

      expect(mockEsIndex).toHaveBeenCalledTimes(1);
    });

    it('reuses cached client on subsequent calls', async () => {
      await ingestResult(makeTask(), makeResult());
      await ingestResult(makeTask(), makeResult());

      // isConfigured should only be called once (lazy init on first call)
      expect(mockIsConfigured).toHaveBeenCalledTimes(1);
    });

    it('resetClient forces re-initialization', async () => {
      await ingestResult(makeTask(), makeResult());
      resetClient();
      await ingestResult(makeTask(), makeResult());

      // isConfigured called twice — once per init
      expect(mockIsConfigured).toHaveBeenCalledTimes(2);
    });
  });

  // ── Group 2: Document Building ─────────────────────────────

  describe('document building', () => {
    it('builds correct routing fields from result', async () => {
      const result = makeResult({ completed_at: '2026-02-01T12:00:00Z', hostname: 'host-42' });
      const task = makeTask({ org_id: 'org-99' });

      await ingestResult(task, result);

      const indexedDoc = mockEsIndex.mock.calls[0][0].document;
      expect(indexedDoc.routing).toEqual({
        event_time: '2026-02-01T12:00:00Z',
        oid: 'org-99',
        hostname: 'host-42',
      });
    });

    it('builds correct event fields with exit code', async () => {
      const result = makeResult({ exit_code: 101 });

      await ingestResult(makeTask(), result);

      const indexedDoc = mockEsIndex.mock.calls[0][0].document;
      expect(indexedDoc.event.ERROR).toBe(101);
    });

    it('maps all metadata fields into f0rtika namespace', async () => {
      await ingestResult(makeTask(), makeResult());

      const f0rtika = mockEsIndex.mock.calls[0][0].document.f0rtika;
      expect(f0rtika.test_uuid).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(f0rtika.test_name).toBe('Credential Dumping');
      expect(f0rtika.category).toBe('cyber-hygiene');
      expect(f0rtika.severity).toBe('high');
      expect(f0rtika.techniques).toEqual(['T1003']);
      expect(f0rtika.tactics).toEqual(['TA0006']);
      expect(f0rtika.threat_actor).toBe('APT29');
      expect(f0rtika.score).toBe(8.5);
    });
  });

  // ── Group 3: isProtectedCode ───────────────────────────────

  describe('isProtectedCode mapping', () => {
    it('marks exit code 105 as protected (quarantined)', async () => {
      await ingestResult(makeTask(), makeResult({ exit_code: 105 }));
      expect(mockEsIndex.mock.calls[0][0].document.f0rtika.is_protected).toBe(true);
    });

    it('marks exit code 126 as protected (execution prevented)', async () => {
      await ingestResult(makeTask(), makeResult({ exit_code: 126 }));
      expect(mockEsIndex.mock.calls[0][0].document.f0rtika.is_protected).toBe(true);
    });

    it('marks exit code 127 as protected (quarantined on execution)', async () => {
      await ingestResult(makeTask(), makeResult({ exit_code: 127 }));
      expect(mockEsIndex.mock.calls[0][0].document.f0rtika.is_protected).toBe(true);
    });

    it('marks exit code 101 as not protected (unprotected)', async () => {
      await ingestResult(makeTask(), makeResult({ exit_code: 101 }));
      expect(mockEsIndex.mock.calls[0][0].document.f0rtika.is_protected).toBe(false);
    });

    it('marks exit code 0 as not protected', async () => {
      await ingestResult(makeTask(), makeResult({ exit_code: 0 }));
      expect(mockEsIndex.mock.calls[0][0].document.f0rtika.is_protected).toBe(false);
    });
  });

  // ── Group 4: getErrorName ──────────────────────────────────

  describe('error name resolution', () => {
    it('resolves known exit code to canonical name', async () => {
      await ingestResult(makeTask(), makeResult({ exit_code: 101 }));
      const errorName = mockEsIndex.mock.calls[0][0].document.f0rtika.error_name;
      expect(errorName).toBe(ERROR_CODE_MAP[101].name);
    });

    it('resolves unknown exit code to "Unknown (code)" format', async () => {
      await ingestResult(makeTask(), makeResult({ exit_code: 42 }));
      const errorName = mockEsIndex.mock.calls[0][0].document.f0rtika.error_name;
      expect(errorName).toBe('Unknown (42)');
    });
  });

  // ── Group 5: Index Targeting ───────────────────────────────

  describe('index targeting', () => {
    it('uses default index pattern from settings', async () => {
      await ingestResult(makeTask(), makeResult());

      expect(mockEsIndex).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'f0rtika-results' }),
      );
    });

    it('uses task.target_index when specified', async () => {
      const task = makeTask({ target_index: 'custom-results-2026' });

      await ingestResult(task, makeResult());

      expect(mockEsIndex).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'custom-results-2026' }),
      );
    });
  });

  // ── Group 6: Bundle Results Ingestion ─────────────────────

  describe('bundle results ingestion', () => {
    it('fans out bundle controls to bulk API (one doc per control)', async () => {
      const result = makeResult({ bundle_results: makeBundle() });
      await ingestResult(makeTask(), result);

      expect(mockEsBulk).toHaveBeenCalledTimes(1);
      expect(mockEsIndex).not.toHaveBeenCalled();
      const ops = mockEsBulk.mock.calls[0][0].operations;
      // 2 controls × 2 (action + doc) = 4 operations
      expect(ops).toHaveLength(4);
    });

    it('sets per-control f0rtika fields correctly', async () => {
      const result = makeResult({ bundle_results: makeBundle() });
      await ingestResult(makeTask(), result);

      const ops = mockEsBulk.mock.calls[0][0].operations;
      const doc1 = ops[1]; // first control document
      expect(doc1.f0rtika.test_uuid).toBe('a3c923ae-1a46-4b1f-b696-be6c2731a628::CH-DEF-001');
      expect(doc1.f0rtika.test_name).toBe('Real-time Protection');
      expect(doc1.f0rtika.is_protected).toBe(true);
      expect(doc1.f0rtika.bundle_id).toBe('a3c923ae-1a46-4b1f-b696-be6c2731a628');
      expect(doc1.f0rtika.is_bundle_control).toBe(true);
      expect(doc1.f0rtika.control_id).toBe('CH-DEF-001');
      expect(doc1.f0rtika.control_validator).toBe('Microsoft Defender');
    });

    it('maps control exit codes to is_protected correctly', async () => {
      const result = makeResult({ bundle_results: makeBundle() });
      await ingestResult(makeTask(), result);

      const ops = mockEsBulk.mock.calls[0][0].operations;
      expect(ops[1].f0rtika.is_protected).toBe(true);   // 126 = protected
      expect(ops[3].f0rtika.is_protected).toBe(false);   // 101 = unprotected
    });

    it('inherits task-level metadata for bundle controls', async () => {
      const result = makeResult({ bundle_results: makeBundle() });
      await ingestResult(makeTask(), result);

      const ops = mockEsBulk.mock.calls[0][0].operations;
      const doc1 = ops[1];
      expect(doc1.f0rtika.threat_actor).toBe('APT29');
      expect(doc1.f0rtika.target).toEqual(['windows-endpoint']);
      expect(doc1.f0rtika.complexity).toBe('medium');
      expect(doc1.f0rtika.score).toBe(8.5);
    });

    it('uses per-control severity, techniques, and tactics', async () => {
      const result = makeResult({ bundle_results: makeBundle() });
      await ingestResult(makeTask(), result);

      const ops = mockEsBulk.mock.calls[0][0].operations;
      const doc1 = ops[1];
      expect(doc1.f0rtika.severity).toBe('critical');
      expect(doc1.f0rtika.techniques).toEqual(['T1562.001']);
      expect(doc1.f0rtika.tactics).toEqual(['defense-evasion']);

      const doc2 = ops[3];
      expect(doc2.f0rtika.severity).toBe('high');
    });

    it('falls through to standard ingestion when no bundle_results', async () => {
      await ingestResult(makeTask(), makeResult());
      expect(mockEsIndex).toHaveBeenCalledTimes(1);
      expect(mockEsBulk).not.toHaveBeenCalled();
    });

    it('uses task.target_index for bundle controls', async () => {
      const task = makeTask({ target_index: 'custom-index' });
      const result = makeResult({ bundle_results: makeBundle() });
      await ingestResult(task, result);

      const ops = mockEsBulk.mock.calls[0][0].operations;
      expect(ops[0]).toEqual({
        index: { _index: 'custom-index', _id: 'a3c923ae-1a46-4b1f-b696-be6c2731a628::CH-DEF-001' },
      });
    });
  });

  // ── Group 7: Ingestion Idempotency ─────────────────────────

  describe('ingestion idempotency', () => {
    it('sets a deterministic _id on single-document ingestion', async () => {
      const task = makeTask({ id: 'fixed-task-uuid-42' });
      await ingestResult(task, makeResult());

      expect(mockEsIndex).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'fixed-task-uuid-42' }),
      );
    });

    it('re-ingesting the same single result produces the same _id (overwrite, not duplicate)', async () => {
      const task = makeTask();
      await ingestResult(task, makeResult());
      await ingestResult(task, makeResult());

      const firstId = mockEsIndex.mock.calls[0][0].id;
      const secondId = mockEsIndex.mock.calls[1][0].id;
      expect(firstId).toBe(secondId);
      expect(firstId).toBeDefined();
    });

    it('sets a deterministic composite _id on each bundle control action line', async () => {
      const result = makeResult({ bundle_results: makeBundle() });
      await ingestResult(makeTask(), result);

      const ops = mockEsBulk.mock.calls[0][0].operations;
      expect(ops[0].index._id).toBe('a3c923ae-1a46-4b1f-b696-be6c2731a628::CH-DEF-001');
      expect(ops[2].index._id).toBe('a3c923ae-1a46-4b1f-b696-be6c2731a628::CH-DEF-002');
    });

    it('re-ingesting the same bundle produces the same per-control _ids', async () => {
      const result = makeResult({ bundle_results: makeBundle() });
      await ingestResult(makeTask(), result);
      await ingestResult(makeTask(), result);

      const firstOps = mockEsBulk.mock.calls[0][0].operations;
      const secondOps = mockEsBulk.mock.calls[1][0].operations;
      expect(firstOps[0].index._id).toBe(secondOps[0].index._id);
      expect(firstOps[2].index._id).toBe(secondOps[2].index._id);
    });
  });
});
