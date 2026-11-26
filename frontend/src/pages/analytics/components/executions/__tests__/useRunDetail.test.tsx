import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { EnrichedTestExecution } from '@/services/api/analytics';
import type { DisplayRow } from '../shared';

// What a run's detail needs beyond the row itself: the test's description and
// the related alerts. The executions list and the matrix drawer both load it
// through this hook; the list's own tests (ExecutionsDataTable.test.tsx) cover
// what the panel then shows.

const { getTestDescription, defenderBatch, csBatch } = vi.hoisted(() => ({
  getTestDescription: vi.fn(),
  defenderBatch: vi.fn(),
  csBatch: vi.fn(),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ testVersions: true, loaded: true }) }));
vi.mock('@/hooks/useDefenderConfig', () => ({ useDefenderConfig: () => ({ configured: true, loading: false }) }));
vi.mock('@/hooks/useCrowdStrikeConfig', () => ({ useCrowdStrikeConfig: () => ({ configured: true, loading: false }) }));
vi.mock('@/hooks/useSentinelOneConfig', () => ({ useSentinelOneConfig: () => ({ configured: false, loading: false }) }));
vi.mock('@/hooks/useSophosConfig', () => ({ useSophosConfig: () => ({ configured: false, loading: false }) }));
vi.mock('@/services/api/browser', () => ({ browserApi: { getTestDescription } }));
vi.mock('@/services/api/defender', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/defender')>('@/services/api/defender');
  return { ...actual, defenderApi: { getAlertsForTests: defenderBatch } };
});
vi.mock('@/services/api/crowdstrike', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/crowdstrike')>('@/services/api/crowdstrike');
  return { ...actual, crowdstrikeApi: { ...actual.crowdstrikeApi, getAlertsForTest: vi.fn(), getAlertsForTests: csBatch } };
});

const { useRunDetail } = await import('../useRunDetail');
const { stageAlertsKey } = await import('../detailParts');

const exec = (over: Partial<EnrichedTestExecution>): EnrichedTestExecution =>
  ({
    test_uuid: 'a0000000-1234-4abc-8def-000000000001',
    test_name: 'Solo test',
    hostname: 'HOST-01',
    timestamp: '2026-01-10T09:00:00.000Z',
    techniques: ['T1059'],
    ...over,
  }) as EnrichedTestExecution;

const SOLO: DisplayRow = { type: 'standalone', key: 'solo', execution: exec({}) };
const BUNDLE = 'c0ffee00-1234-4abc-8def-000000000001';
const stage = (n: number) =>
  exec({ test_uuid: `${BUNDLE}::T${n}`, bundle_id: BUNDLE, bundle_name: 'Chain A', is_bundle_control: true, control_id: `T${n}`, control_validator: `Stage ${n}`, techniques: [`T100${n}`] });
const CHAIN = { type: 'bundle', key: 'chain', bundle_id: BUNDLE, bundle_name: 'Chain A', hostname: 'HOST-01', timestamp: '2026-01-10T09:00:00.000Z', controls: [stage(1), stage(2)] } as unknown as DisplayRow;

beforeEach(() => {
  vi.clearAllMocks();
  getTestDescription.mockResolvedValue({ description: 'What it does', hasInfoCard: true, hasReadme: false });
  defenderBatch.mockImplementation((items: unknown[]) => Promise.resolve(items.map(() => ({ alerts: [], total: 0 }))));
  csBatch.mockImplementation((items: unknown[]) => Promise.resolve(items.map(() => ({ alerts: [], total: 0 }))));
});

describe('useRunDetail', () => {
  it('loads a standalone run\'s description and alerts once', async () => {
    const { result } = renderHook(() => useRunDetail());

    act(() => result.current.prime(SOLO));
    await waitFor(() => expect(result.current.panelProps.descriptionMap.get(SOLO.execution.test_uuid)).toMatchObject({ description: 'What it does' }));
    await waitFor(() => expect(result.current.panelProps.alertsMap.has(stageAlertsKey(SOLO.execution))).toBe(true));
    act(() => result.current.prime(SOLO));

    expect(getTestDescription).toHaveBeenCalledTimes(1);
    expect(getTestDescription).toHaveBeenCalledWith(SOLO.execution.test_uuid, undefined);
    expect(defenderBatch).toHaveBeenCalledTimes(1);
    expect(csBatch).toHaveBeenCalledTimes(1);
  });

  it('asks for every stage of a chain in one request per vendor, and no description yet', async () => {
    const { result } = renderHook(() => useRunDetail());

    act(() => result.current.prime(CHAIN));
    await waitFor(() => expect(result.current.panelProps.alertsMap.size).toBe(2));

    expect(defenderBatch).toHaveBeenCalledTimes(1);
    expect(defenderBatch.mock.calls[0][0]).toHaveLength(2);
    expect(csBatch).toHaveBeenCalledTimes(1);
    expect(result.current.panelProps.endpointAlerts.crowdstrike.map.size).toBe(2);
    expect(result.current.panelProps.endpointAlerts.sentinelone).toMatchObject({ configured: false });
    expect(getTestDescription).not.toHaveBeenCalled();
  });

  it('opens one stage at a time and loads its description by validator', async () => {
    const { result } = renderHook(() => useRunDetail());
    const [first, second] = (CHAIN as Extract<DisplayRow, { type: 'bundle' }>).controls;

    act(() => result.current.panelProps.onToggleControl(0, first));
    expect(result.current.panelProps.expandedControlIndex).toBe(0);
    await waitFor(() => expect(getTestDescription).toHaveBeenCalledWith(BUNDLE, 'Stage 1'));

    act(() => result.current.panelProps.onToggleControl(1, second));
    expect(result.current.panelProps.expandedControlIndex).toBe(1);
    act(() => result.current.panelProps.onToggleControl(1, second));
    expect(result.current.panelProps.expandedControlIndex).toBeNull();
  });

  it('closes the open stage on request (a new run is selected)', () => {
    const { result } = renderHook(() => useRunDetail());
    act(() => result.current.panelProps.onToggleControl(0, stage(1)));

    act(() => result.current.collapseControls());

    expect(result.current.panelProps.expandedControlIndex).toBeNull();
  });

  it('reports a failed alert lookup as null and asks again next time', async () => {
    defenderBatch.mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => useRunDetail());

    act(() => result.current.prime(SOLO));
    await waitFor(() => expect(result.current.panelProps.alertsMap.get(stageAlertsKey(SOLO.execution))).toBeNull());
    act(() => result.current.prime(SOLO));

    await waitFor(() => expect(defenderBatch).toHaveBeenCalledTimes(2));
  });

  it('says whether versions and Defender are available', () => {
    const { result } = renderHook(() => useRunDetail());

    expect(result.current.panelProps).toMatchObject({ showVersions: true, defenderConfigured: true, descriptionLoadingKey: null });
  });
});
