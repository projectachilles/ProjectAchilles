import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupedPaginatedResponse, EnrichedTestExecution } from '@/services/api/analytics';
import type { DefenderAlertItem, RelatedAlertsResponse } from '@/services/api/defender';

// Hoisted spy so the vi.mock factory (which is itself hoisted above all
// top-level declarations) can reference it without hitting a TDZ.
const { getAlertsForTestMock } = vi.hoisted(() => ({
  getAlertsForTestMock: vi.fn(),
}));

vi.mock('@/hooks/useDefenderConfig', () => ({
  useDefenderConfig: () => ({ configured: true, loading: false }),
}));

vi.mock('@/services/api/defender', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/defender')>(
    '@/services/api/defender',
  );
  return {
    ...actual,
    defenderApi: { getAlertsForTest: getAlertsForTestMock },
  };
});

vi.mock('@/services/api/browser', () => ({
  browserApi: { getTestDescription: vi.fn().mockResolvedValue(null) },
}));

import ExecutionsDataTable from '../ExecutionsDataTable';

// Bundle UUID for the test fixture. Frontend strips the `::T...` suffix
// when deriving binaryName, so any value works as long as it's stable
// across the two stages we construct.
const BUNDLE_UUID = '6a2351ac-654a-4112-b378-e6919beef70d';

function makeStage(overrides: Partial<EnrichedTestExecution>): EnrichedTestExecution {
  return {
    test_uuid: `${BUNDLE_UUID}::T1083`,
    test_name: 'Defender Update-Path Discovery',
    hostname: 'LAP-PF1A47F0',
    is_protected: false,
    org: 'achilles',
    timestamp: '2026-05-12T12:00:00.000Z',
    error_code: 101,
    error_name: 'Unprotected',
    category: 'intel-driven',
    techniques: ['T1083'],
    bundle_id: BUNDLE_UUID,
    bundle_name: 'UnDefend - Defender Signature/Engine Update DoS via File-Lock Race',
    control_id: 'T1083',
    is_bundle_control: true,
    defender_detected: false,
    ...overrides,
  };
}

function makeAlert(overrides: Partial<DefenderAlertItem> = {}): DefenderAlertItem {
  return {
    alert_id: 'alert-001',
    alert_title: 'Suspicious file lock race detected',
    description: '',
    severity: 'medium',
    status: 'new',
    category: 'DefenseEvasion',
    service_source: 'microsoftDefenderForEndpoint',
    mitre_techniques: ['T1083'],
    created_at: '2026-05-12T12:05:00.000Z',
    updated_at: '2026-05-12T12:05:00.000Z',
    resolved_at: null,
    recommended_actions: '',
    attribution: 'bundle',
    ...overrides,
  };
}

function makeData(controls: EnrichedTestExecution[], opts: { defenderDetected: boolean }): GroupedPaginatedResponse {
  const protectedCount = controls.filter((c) => c.error_code !== 101).length;
  const unprotectedCount = controls.length - protectedCount;
  return {
    groups: [
      {
        groupKey: `bundle::${BUNDLE_UUID}::LAP-PF1A47F0`,
        type: 'bundle',
        representative: controls[0],
        members: controls,
        protectedCount,
        unprotectedCount,
        totalCount: controls.length,
        defenderDetected: opts.defenderDetected,
      },
    ],
    pagination: {
      page: 1,
      pageSize: 25,
      totalGroups: 1,
      totalDocuments: controls.length,
      totalPages: 1,
      hasNext: false,
      hasPrevious: false,
    },
  };
}

function renderTable(data: GroupedPaginatedResponse) {
  return render(
    <ExecutionsDataTable
      data={data}
      loading={false}
      onPageChange={vi.fn()}
      onPageSizeChange={vi.fn()}
      onSort={vi.fn()}
      sortField="routing.event_time"
      sortOrder="desc"
      scoringMode="all-stages"
    />,
  );
}

beforeEach(() => {
  getAlertsForTestMock.mockReset();
});

describe('ExecutionsDataTable — per-stage Defender detection', () => {
  // Stage sub-rows only render when the bundle row is expanded — the parent
  // alone shows the rollup badge. These tests assert behavior at the
  // sub-row level, so they expand first.
  it('renders "Detected" instead of "Unprotected" when a stage has defender_detected:true and error_code:101', async () => {
    // Reproduces the UnDefend bundle: stage 2 is unprotected by EDR
    // (error 101) AND was correlated to a Defender alert by the enrichment
    // pass. Before the fix this stage rendered as red "Unprotected" because
    // the Result cell only consulted error_code. After the fix the cell
    // prefers the amber "Detected" badge so the per-stage signal agrees
    // with the parent bundle's "Detected" rollup.
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });

    const detectedStage = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1562.001`,
      test_name: 'WinDefend Service-Stop Notification Subscription',
      control_id: 'T1562.001',
      techniques: ['T1562.001'],
      defender_detected: true,
    });
    const plainStage = makeStage({ defender_detected: false });

    renderTable(makeData([plainStage, detectedStage], { defenderDetected: true }));

    await userEvent.click(screen.getByText(plainStage.bundle_name!));

    // Both stages are unprotected by EDR. Only one was Defender-detected.
    await waitFor(() => {
      expect(screen.getByText('Detected')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Unprotected')).toHaveLength(1);
  });

  it('keeps "Unprotected" wording when no Defender correlation exists on the stage', async () => {
    // Defensive: a stage with defender_detected:false MUST still render as
    // "Unprotected" — the new branch is gated on the boolean flag, not on
    // the parent's rollup.
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({ defender_detected: false });
    renderTable(makeData([stage], { defenderDetected: false }));

    await userEvent.click(screen.getByText(stage.bundle_name!));

    await waitFor(() => {
      expect(screen.getByText('Unprotected')).toBeInTheDocument();
    });
    expect(screen.queryByText('Detected')).toBeNull();
  });
});

describe('ExecutionsDataTable — bundle-level alert callout dedupe', () => {
  it('aggregates bundle-attribution alerts across per-stage caches and dedupes by alert_id', async () => {
    // Both stages' independent queries return the SAME bundle-attribution
    // alert (this happens whenever stage windows overlap the alert's
    // timestamp — common for fast-execution sandboxed bundles like
    // BlueHammer). The callout must render the alert once, not twice.
    const sharedAlert = makeAlert({
      alert_id: 'eicar-001',
      alert_title: "'EICAR_Test_File' malware was prevented",
      attribution: 'bundle',
    });
    const response: RelatedAlertsResponse = {
      alerts: [sharedAlert],
      matchedTechniques: ['T1083'],
      total: 1,
    };
    getAlertsForTestMock.mockResolvedValue(response);

    const stage1 = makeStage({ test_uuid: `${BUNDLE_UUID}::T1083`, control_id: 'T1083', techniques: ['T1083'] });
    const stage2 = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1562.001`,
      control_id: 'T1562.001',
      techniques: ['T1562.001'],
      test_name: 'WinDefend Service-Stop Notification Subscription',
    });
    renderTable(makeData([stage1, stage2], { defenderDetected: true }));

    // Expand the bundle to trigger per-stage prefetches.
    const expandRow = screen.getByText(stage1.bundle_name!);
    await userEvent.click(expandRow);

    // Wait for both stages' fetches to resolve and the callout to render.
    await waitFor(() => {
      expect(screen.getByText(/EICAR_Test_File/)).toBeInTheDocument();
    });

    // Each stage fired one request. Dedupe happens at render time, not
    // in the cache.
    expect(getAlertsForTestMock).toHaveBeenCalledTimes(2);
    // Alert title appears exactly once in the callout despite being
    // returned by both stage queries.
    expect(screen.getAllByText(/EICAR_Test_File/)).toHaveLength(1);
  });

  it('renders nothing in the callout when no stage returned a bundle-attribution alert', async () => {
    // Only stage-attribution alerts in the response — callout should NOT
    // render (this preserves the original behavior of hiding the amber
    // strip when there's nothing to put in it).
    const stageOnlyAlert = makeAlert({
      attribution: 'stage',
      attributed_control_id: 't1083',
    });
    getAlertsForTestMock.mockResolvedValue({
      alerts: [stageOnlyAlert],
      matchedTechniques: ['T1083'],
      total: 1,
    });

    const stage1 = makeStage({ test_uuid: `${BUNDLE_UUID}::T1083`, control_id: 'T1083', techniques: ['T1083'] });
    const stage2 = makeStage({ test_uuid: `${BUNDLE_UUID}::T1562.001`, control_id: 'T1562.001', techniques: ['T1562.001'] });
    renderTable(makeData([stage1, stage2], { defenderDetected: true }));

    await userEvent.click(screen.getByText(stage1.bundle_name!));

    await waitFor(() => {
      expect(getAlertsForTestMock).toHaveBeenCalledTimes(2);
    });

    expect(screen.queryByText(/Bundle-level Defender alerts/i)).toBeNull();
  });
});
