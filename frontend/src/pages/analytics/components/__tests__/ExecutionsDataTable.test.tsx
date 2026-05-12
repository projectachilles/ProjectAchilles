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
    // After PR-B parent badge agrees with stage badges (same "Detected"
    // wording), so 2 "Detected" labels appear: parent + the one stage.
    // Use getAllByText to disambiguate.
    await waitFor(() => {
      expect(screen.getAllByText('Detected').length).toBeGreaterThanOrEqual(2);
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

    // 2 "Unprotected" rows: parent rollup + the one stage. No "Detected"
    // anywhere because group.defenderDetected is false.
    await waitFor(() => {
      expect(screen.getAllByText('Unprotected').length).toBeGreaterThanOrEqual(2);
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

describe('ExecutionsDataTable — variant-suffix attribution matching', () => {
  // The backend classifier extracts the full token between the bundle UUID
  // and `.exe` from the evidence binary name. For binaries with a variant
  // suffix (e.g. `<uuid>-t1562.001-svcnotify.exe`), this is
  // `t1562.001-svcnotify` — strictly *not equal* to the test doc's
  // `control_id` of `T1562.001`. Strict-equality matching dropped these
  // alerts entirely (the original symptom reported on Fly.io: both stages
  // badged Detected but every detail panel said "No related Defender
  // alerts"). The filter must accept `<control_id>-<variant>` as a match.
  it('surfaces alerts whose attributed_control_id has a -<variant> suffix beyond the stage control_id', async () => {
    const variantAlert = makeAlert({
      alert_id: 'wacatac-001',
      alert_title: "An active 'Wacatac' malware was blocked",
      attribution: 'stage',
      attributed_control_id: 't1562.001-svcnotify',
    });
    getAlertsForTestMock.mockResolvedValue({
      alerts: [variantAlert],
      matchedTechniques: [],
      total: 1,
    });

    const stage1 = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1083`,
      control_id: 'T1083',
      techniques: ['T1083'],
    });
    const stage2 = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1562.001`,
      control_id: 'T1562.001',
      techniques: ['T1562.001'],
      test_name: 'WinDefend Service-Stop Notification Subscription',
      defender_detected: true,
    });
    renderTable(makeData([stage1, stage2], { defenderDetected: true }));

    await userEvent.click(screen.getByText(stage1.bundle_name!));
    await waitFor(() => {
      expect(getAlertsForTestMock).toHaveBeenCalledTimes(2);
    });

    // Open stage 2's detail panel — its control_id is T1562.001 and the
    // alert's attributed_control_id is "t1562.001-svcnotify".
    await userEvent.click(screen.getByText(stage2.test_name));
    await waitFor(() => {
      expect(screen.getByText(/Wacatac/)).toBeInTheDocument();
    });
  });

  it('rejects attributed_control_id that shares only a prefix without the dash boundary', async () => {
    // Defensive: `t10831` must NOT match a stage with control_id `t1083`.
    // The boundary check (`startsWith(`${stageControlId}-`)`) is the
    // safeguard against false positives across adjacent technique IDs.
    const lookalikeAlert = makeAlert({
      attribution: 'stage',
      attributed_control_id: 't10831',
    });
    getAlertsForTestMock.mockResolvedValue({
      alerts: [lookalikeAlert],
      matchedTechniques: [],
      total: 1,
    });

    const stage = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1083`,
      control_id: 'T1083',
      techniques: ['T1083'],
      defender_detected: true,
    });
    renderTable(makeData([stage], { defenderDetected: true }));

    await userEvent.click(screen.getByText(stage.bundle_name!));
    await userEvent.click(screen.getByText(stage.test_name));

    await waitFor(() => {
      expect(getAlertsForTestMock).toHaveBeenCalled();
    });

    // The lookalike alert title should NOT appear; the panel falls through
    // to the "no related alerts" copy.
    expect(screen.queryByText(/Wacatac/)).toBeNull();
    expect(screen.getByText(/No related Defender alerts/i)).toBeInTheDocument();
  });
});

describe('ExecutionsDataTable — stage-flag preference (per-stage truth)', () => {
  // After PR-A's stage-specific enrichment lands, the per-stage Result cell
  // should prefer defender_stage_detected (set ONLY when the alert evidence
  // contains THIS stage's binary). The bundle-level defender_detected flag
  // is reserved for the parent badge rollup.
  it('uses defender_stage_detected when present, ignoring the bundle flag', async () => {
    // Stage 1 has the bundle flag but NOT the stage flag — alert was for
    // another stage of the same bundle. The parent rolls up to Detected
    // (group.defenderDetected:true), but the single stage sub-row must NOT
    // show Detected because its own stage flag is false. Expect exactly 1
    // "Detected" (the parent) and 1 "Unprotected" (the stage).
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({
      defender_detected: true,
      defender_stage_detected: false,
    });
    renderTable(makeData([stage], { defenderDetected: true }));

    await userEvent.click(screen.getByText(stage.bundle_name!));
    await waitFor(() => {
      expect(screen.getAllByText('Unprotected').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText('Detected')).toHaveLength(1); // parent only
  });

  it('renders Detected when defender_stage_detected is true', async () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({
      defender_detected: true,
      defender_stage_detected: true,
    });
    renderTable(makeData([stage], { defenderDetected: true }));

    await userEvent.click(screen.getByText(stage.bundle_name!));
    // Parent rolls up Detected AND stage row shows Detected (per-stage flag).
    await waitFor(() => {
      expect(screen.getAllByText('Detected').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('falls back to defender_detected for legacy docs missing the stage flag', async () => {
    // Pre-PR-A docs only carry defender_detected. Until the next enrichment
    // passes backfill defender_stage_detected, the UI must still show
    // Detected — the fallback prevents a visible regression during deploy.
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({
      defender_detected: true,
      defender_stage_detected: undefined,
    });
    renderTable(makeData([stage], { defenderDetected: true }));

    await userEvent.click(screen.getByText(stage.bundle_name!));
    await waitFor(() => {
      expect(screen.getAllByText('Detected').length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('ExecutionsDataTable — toggle removal + parent rollup', () => {
  it('does not render the All Stages / Any Stage toggle in the header', () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({});
    renderTable(makeData([stage], { defenderDetected: false }));

    expect(screen.queryByText('All Stages')).toBeNull();
    expect(screen.queryByText('Any Stage')).toBeNull();
  });

  it('parent bundle badge: any-stage Protected wins over any-stage Detected', () => {
    // Three stages: one Protected (error_code 105), one Detected
    // (defender_detected: true, error_code 101), one plain Unprotected
    // (error_code 101, no detection). Parent must badge Protected — the
    // strongest signal (EDR prevention) wins.
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const protectedStage = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1083`,
      control_id: 'T1083',
      error_code: 105,
    });
    const detectedStage = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1562.001`,
      control_id: 'T1562.001',
      error_code: 101,
      defender_detected: true,
      defender_stage_detected: true,
    });
    const unprotectedStage = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1078`,
      control_id: 'T1078',
      error_code: 101,
    });
    renderTable(
      makeData([protectedStage, detectedStage, unprotectedStage], { defenderDetected: true }),
    );

    // Parent row badge is the FIRST 'Protected' in the DOM (the table
    // renders parent before stage sub-rows). Without expanding, only the
    // parent is visible — so any Protected text we find is the parent.
    expect(screen.getByText('Protected')).toBeInTheDocument();
    // Parent should NOT badge Detected when there's a Protected stage
    expect(screen.queryByText('Detected')).toBeNull();
  });

  it('parent bundle badge: Detected when no stage is Protected but one is Detected', () => {
    // Bundle has no EDR-prevented stages but does have Defender correlation
    // → parent badges Detected (not Unprotected). Same priority as PR #225.
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const detectedStage = makeStage({ defender_detected: true });
    const unprotectedStage = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1078`,
      control_id: 'T1078',
      error_code: 101,
    });
    renderTable(
      makeData([detectedStage, unprotectedStage], { defenderDetected: true }),
    );

    expect(screen.getByText('Detected')).toBeInTheDocument();
  });

  it('cyber-hygiene bundles keep their per-control ratio badge', () => {
    // The any-stage rollup is intentionally NOT applied to cyber-hygiene
    // bundles — each control is independently scored, so collapsing to a
    // single verdict would erase per-control gap analysis.
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const chStage1 = makeStage({
      category: 'cyber-hygiene',
      test_uuid: `${BUNDLE_UUID}::CH-001`,
      control_id: 'CH-001',
      error_code: 105,
    });
    const chStage2 = makeStage({
      category: 'cyber-hygiene',
      test_uuid: `${BUNDLE_UUID}::CH-002`,
      control_id: 'CH-002',
      error_code: 101,
    });
    renderTable(makeData([chStage1, chStage2], { defenderDetected: false }));

    // Ratio badge format: "1/2 Protected"
    expect(screen.getByText('1/2 Protected')).toBeInTheDocument();
  });
});
