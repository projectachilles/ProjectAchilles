import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Task } from '../../../types/agent.js';
import type { EdrTermination } from '../../edr/agent-kill-evidence.js';

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
const mockPutMapping = vi.fn();
vi.mock('../../analytics/client.js', () => ({
  createEsClient: vi.fn(() => ({ index: mockEsIndex, bulk: mockEsBulk, indices: { putMapping: mockPutMapping } })),
}));

const mockCreateResultsIndex = vi.fn();
vi.mock('../../analytics/index-management.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics/index-management.service.js')>()),
  createResultsIndex: (...args: unknown[]) => mockCreateResultsIndex(...args),
}));

const { ingestEdrTerminatedResult, resetClient } = await import('../results.service.js');

const t: EdrTermination = {
  vendors: ['sentinelone'], alert_ids: ['a1', 'a2'],
  killed_at: '2026-10-20T10:05:00.000Z', reconciled_at: '2026-10-20T10:40:00.000Z',
};

function makeTask(): Task {
  return {
    id: 'task-9', agent_id: 'agent-001', org_id: 'org-001', type: 'execute_test', status: 'failed',
    payload: {
      test_uuid: 'uuid-9', test_name: 'LockBit', binary_name: 'b.exe', binary_sha256: 'x', binary_size: 1,
      execution_timeout: 300, arguments: [],
      metadata: { category: 'intel-driven', subcategory: 'ransomware', severity: 'critical', techniques: ['T1486'], tactics: ['impact'], threat_actor: 'LockBit', target: ['windows'], complexity: 'high', tags: ['x'], score: 9 },
    },
    target_index: null,
  } as unknown as Task;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetClient();
  mockPutMapping.mockResolvedValue({});
  mockIsConfigured.mockReturnValue(true);
  mockGetSettings.mockReturnValue({ writeIndexPrefix: 'achilles-results-', writeIndexRollover: 'daily' });
});

describe('ingestEdrTerminatedResult', () => {
  it('writes a whole-test protected doc', async () => {
    await ingestEdrTerminatedResult(makeTask(), 'LT4862', t, null);
    expect(mockCreateResultsIndex).toHaveBeenCalledWith('achilles-results-2026.10.20');
    const call = mockEsIndex.mock.calls[0][0];
    expect(call.id).toBe('task-9');
    expect(call.index).toBe('achilles-results-2026.10.20');
    const d = call.document;
    expect(d.event.ERROR).toBe(126);
    expect(d.routing).toEqual({ event_time: t.killed_at, oid: 'org-001', hostname: 'LT4862' });
    expect(d.f0rtika.is_protected).toBe(true);
    expect(d.f0rtika.edr_terminated).toBe(true);
    expect(d.f0rtika.stages_unknown).toBe(true);
    expect(d.f0rtika.edr_terminated_vendors).toEqual(['sentinelone']);
    expect(d.f0rtika.edr_terminated_alert_ids).toEqual(['a1', 'a2']);
    expect(d.f0rtika.test_uuid).toBe('uuid-9');
    expect(d.f0rtika.threat_actor).toBe('LockBit');
    expect('is_bundle_control' in d.f0rtika).toBe(false);
    expect('bundle_id' in d.f0rtika).toBe(false);
    expect(Object.keys(d.f0rtika).filter((k) => /_(detected|stage_detected|prevented)$/.test(k))).toEqual([]);
  });

  it('sets bundle_id and bundle_name for a multi-stage test', async () => {
    await ingestEdrTerminatedResult(makeTask(), 'LT4862', t, { bundleName: 'LockBit Chain' });
    const d = mockEsIndex.mock.calls[0][0].document;
    expect(d.f0rtika.bundle_id).toBe('uuid-9');
    expect(d.f0rtika.bundle_name).toBe('LockBit Chain');
  });

  it('refuses a wildcard write index', async () => {
    mockGetSettings.mockReturnValue({ writeIndexPrefix: 'achilles-*', writeIndexRollover: 'none' });
    await expect(ingestEdrTerminatedResult(makeTask(), 'h', t, null)).rejects.toThrow(/wildcard/);
  });

  it('puts the edr_terminated mapping on an existing write index once', async () => {
    await ingestEdrTerminatedResult(makeTask(), 'LT4862', t, null);
    await ingestEdrTerminatedResult(makeTask(), 'LT4862', t, null);
    expect(mockPutMapping).toHaveBeenCalledTimes(1);
    expect(mockPutMapping).toHaveBeenCalledWith({
      index: 'achilles-results-2026.10.20',
      properties: { f0rtika: { properties: {
        edr_terminated: { type: 'boolean' },
        edr_terminated_vendors: { type: 'keyword' },
        edr_terminated_alert_ids: { type: 'keyword' },
        stages_unknown: { type: 'boolean' },
      } } },
    });
    expect(mockPutMapping.mock.invocationCallOrder[0]).toBeLessThan(mockEsIndex.mock.invocationCallOrder[0]);
  });

  it('still writes the doc when putMapping fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockPutMapping.mockRejectedValue(new Error('boom'));
    await ingestEdrTerminatedResult(makeTask(), 'LT4862', t, null);
    expect(mockEsIndex).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
