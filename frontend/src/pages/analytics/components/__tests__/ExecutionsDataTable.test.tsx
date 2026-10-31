import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupedPaginatedResponse, EnrichedTestExecution } from '@/services/api/analytics';
import type { DefenderAlertItem, RelatedAlertsResponse } from '@/services/api/defender';
import type { CrowdStrikeAlertItem, RelatedCrowdStrikeAlertsResponse } from '@/services/api/crowdstrike';

// Hoisted spy so the vi.mock factory (which is itself hoisted above all
// top-level declarations) can reference it without hitting a TDZ.
const {
  getAlertsForTestMock, csGetAlertsForTestMock, csConfigured,
  s1GetAlertsForTestMock, s1Configured, sophosGetAlertsForTestMock, sophosConfigured,
  defenderBatch, csBatch, s1Batch, sophosBatch,
} = vi.hoisted(() => {
  type Item = { techniques: string[]; timestamp: string; windowMinutes?: number; hostname?: string; binaryName?: string; bundleName?: string };
  // The batch call the table makes: each item answered by the vendor's
  // single-stage mock (so per-stage argument assertions keep working);
  // a rejected stage becomes null, as the backend reports it.
  const batchOf = (single: (...args: unknown[]) => unknown) =>
    vi.fn((items: Item[]) =>
      Promise.all(items.map((i) =>
        Promise.resolve()
          .then(() => single(i.techniques, i.timestamp, i.windowMinutes, i.hostname, i.binaryName, i.bundleName))
          .catch(() => null))));
  const getAlertsForTestMock = vi.fn();
  const csGetAlertsForTestMock = vi.fn();
  const s1GetAlertsForTestMock = vi.fn();
  const sophosGetAlertsForTestMock = vi.fn();
  return {
    getAlertsForTestMock,
    csGetAlertsForTestMock,
    csConfigured: { value: false },
    s1GetAlertsForTestMock,
    s1Configured: { value: false },
    sophosGetAlertsForTestMock,
    sophosConfigured: { value: false },
    batchOf,
    defenderBatch: batchOf(getAlertsForTestMock),
    csBatch: batchOf(csGetAlertsForTestMock),
    s1Batch: batchOf(s1GetAlertsForTestMock),
    sophosBatch: batchOf(sophosGetAlertsForTestMock),
  };
});

vi.mock('@/hooks/useSentinelOneConfig', () => ({
  useSentinelOneConfig: () => ({ configured: s1Configured.value, loading: false }),
}));

vi.mock('@/hooks/useSophosConfig', () => ({
  useSophosConfig: () => ({ configured: sophosConfigured.value, loading: false }),
}));

vi.mock('@/services/api/sentineloneAnalytics', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/sentineloneAnalytics')>(
    '@/services/api/sentineloneAnalytics',
  );
  return { ...actual, sentineloneAnalyticsApi: { ...actual.sentineloneAnalyticsApi, getAlertsForTest: s1GetAlertsForTestMock, getAlertsForTests: s1Batch } };
});

vi.mock('@/services/api/sophosAnalytics', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/sophosAnalytics')>(
    '@/services/api/sophosAnalytics',
  );
  return { ...actual, sophosAnalyticsApi: { ...actual.sophosAnalyticsApi, getAlertsForTest: sophosGetAlertsForTestMock, getAlertsForTests: sophosBatch } };
});

vi.mock('@/hooks/useDefenderConfig', () => ({
  useDefenderConfig: () => ({ configured: true, loading: false }),
}));

vi.mock('@/hooks/useCrowdStrikeConfig', () => ({
  useCrowdStrikeConfig: () => ({ configured: csConfigured.value, loading: false }),
}));

vi.mock('@/services/api/defender', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/defender')>(
    '@/services/api/defender',
  );
  return {
    ...actual,
    defenderApi: { getAlertsForTest: getAlertsForTestMock, getAlertsForTests: defenderBatch },
  };
});

vi.mock('@/services/api/crowdstrike', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/crowdstrike')>(
    '@/services/api/crowdstrike',
  );
  return {
    ...actual,
    crowdstrikeApi: { getAlertsForTest: csGetAlertsForTestMock, getAlertsForTests: csBatch },
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
    crowdstrike_detected: false,
    ...overrides,
  };
}

function makeAlert(overrides: Partial<DefenderAlertItem> = {}): DefenderAlertItem {
  return {
    alert_id: 'alert-001',
    hostname: null,
    achilles_correlated: false,
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

function makeData(controls: EnrichedTestExecution[], opts: { defenderDetected: boolean; defenderPrevented?: boolean; crowdstrikeDetected?: boolean; crowdstrikePrevented?: boolean }): GroupedPaginatedResponse {
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
        defenderPrevented: opts.defenderPrevented,
        crowdstrikeDetected: opts.crowdstrikeDetected,
        crowdstrikePrevented: opts.crowdstrikePrevented,
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

/**
 * Opens a stage's detail from its row in the stage list. Intel-driven bundles
 * also show the stage name on the attack-chain strip, so a bare getByText
 * would match twice.
 */
async function openStageRow(name: string) {
  const list = screen.getByRole('list', { name: 'Stages' });
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await userEvent.click(within(list).getByRole('button', { name: new RegExp(escaped), expanded: false }));
}

beforeEach(() => {
  getAlertsForTestMock.mockReset();
  for (const b of [defenderBatch, csBatch, s1Batch, sophosBatch]) b.mockClear();
  csGetAlertsForTestMock.mockReset();
  csGetAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
  csConfigured.value = false;
  s1Configured.value = false;
  sophosConfigured.value = false;
  const empty = { alerts: [], matchedTechniques: [], total: 0 };
  s1GetAlertsForTestMock.mockReset();
  s1GetAlertsForTestMock.mockResolvedValue(empty);
  sophosGetAlertsForTestMock.mockReset();
  sophosGetAlertsForTestMock.mockResolvedValue(empty);
});

describe('ExecutionsDataTable — SB report export', () => {
  it('offers the SB Export menu item when onExportSbReport is provided and invokes it on click', async () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const onExportSbReport = vi.fn().mockResolvedValue(undefined);
    const stage = makeStage({});
    render(
      <ExecutionsDataTable
        data={makeData([stage], { defenderDetected: false })}
        loading={false}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        onSort={vi.fn()}
        sortField="routing.event_time"
        sortOrder="desc"
        onExportSbReport={onExportSbReport}
        sbReportExporting={false}
      />,
    );

    await userEvent.click(screen.getByText('SB Export'));
    expect(onExportSbReport).toHaveBeenCalledTimes(1);
  });

  it('hides the SB Export menu item when no handler is provided', () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({});
    renderTable(makeData([stage], { defenderDetected: false }));

    expect(screen.queryByText('SB Export')).toBeNull();
    // The local CSV/JSON exports are always available
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
  });

  it('disables the SB Export item and shows progress wording while exporting', () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({});
    render(
      <ExecutionsDataTable
        data={makeData([stage], { defenderDetected: false })}
        loading={false}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        onSort={vi.fn()}
        sortField="routing.event_time"
        sortOrder="desc"
        onExportSbReport={vi.fn()}
        sbReportExporting={true}
      />,
    );

    expect(screen.getByText('Exporting SB Export…')).toBeDisabled();
  });
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

    await userEvent.click(screen.getAllByText(plainStage.bundle_name!)[0]);

    // Both stages are unprotected by EDR. Only one was Defender-detected.
    // After PR-B parent badge agrees with stage badges (same "Detected"
    // wording), so 2 "Detected" labels appear: parent + the one stage.
    // Use getAllByText to disambiguate.
    await waitFor(() => {
      expect(screen.getAllByText('Detected').length).toBeGreaterThanOrEqual(2);
    });
    // One stage is Unprotected: its attack-chain node and its stage row.
    expect(screen.getAllByText('Unprotected')).toHaveLength(2);
  });

  it('keeps "Unprotected" wording when no Defender correlation exists on the stage', async () => {
    // Defensive: a stage with defender_detected:false MUST still render as
    // "Unprotected" — the new branch is gated on the boolean flag, not on
    // the parent's rollup.
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({ defender_detected: false });
    renderTable(makeData([stage], { defenderDetected: false }));

    await userEvent.click(screen.getAllByText(stage.bundle_name!)[0]);

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
    await userEvent.click(screen.getAllByText(stage1.bundle_name!)[0]);

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

  it('asks each vendor once for all stages of the selected bundle', async () => {
    csConfigured.value = true;
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    csGetAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stages = ['T1083', 'T1562.001', 'T1486'].map((t) =>
      makeStage({ test_uuid: `${BUNDLE_UUID}::${t}`, control_id: t, techniques: [t] }));
    renderTable(makeData(stages, { defenderDetected: true }));

    await userEvent.click(screen.getAllByText(stages[0].bundle_name!)[0]);

    await waitFor(() => expect(defenderBatch).toHaveBeenCalled());
    await waitFor(() => expect(csBatch).toHaveBeenCalled());
    expect(defenderBatch).toHaveBeenCalledTimes(1);
    expect(csBatch).toHaveBeenCalledTimes(1);
    const items = defenderBatch.mock.calls[0][0] as Array<{ techniques: string[]; binaryName: string }>;
    expect(items.map((i) => i.techniques[0])).toEqual(['T1083', 'T1562.001', 'T1486']);
    expect(new Set(items.map((i) => i.binaryName))).toEqual(new Set([`${BUNDLE_UUID}.exe`]));
    csConfigured.value = false;
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

    await userEvent.click(screen.getAllByText(stage1.bundle_name!)[0]);

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

    await userEvent.click(screen.getAllByText(stage1.bundle_name!)[0]);
    await waitFor(() => {
      expect(getAlertsForTestMock).toHaveBeenCalledTimes(2);
    });

    // Open stage 2's detail panel — its control_id is T1562.001 and the
    // alert's attributed_control_id is "t1562.001-svcnotify".
    await openStageRow(stage2.test_name);
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

    await userEvent.click(screen.getAllByText(stage.bundle_name!)[0]);
    await openStageRow(stage.test_name);

    await waitFor(() => {
      expect(getAlertsForTestMock).toHaveBeenCalled();
    });

    // The lookalike alert title should NOT appear; the panel falls through
    // to the "no related alerts" copy.
    expect(screen.queryByText(/Wacatac/)).toBeNull();
    expect(screen.getByText("No Defender alert names this stage's binary.")).toBeInTheDocument();
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

    await userEvent.click(screen.getAllByText(stage.bundle_name!)[0]);
    await waitFor(() => {
      expect(screen.getAllByText('Unprotected').length).toBeGreaterThanOrEqual(1);
    });
    // Parent label renders twice in master-detail (run list + panel header);
    // the stage control row itself must NOT add a third.
    expect(screen.getAllByText('Detected')).toHaveLength(2);
  });

  it('renders Detected when defender_stage_detected is true', async () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({
      defender_detected: true,
      defender_stage_detected: true,
    });
    renderTable(makeData([stage], { defenderDetected: true }));

    await userEvent.click(screen.getAllByText(stage.bundle_name!)[0]);
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

    await userEvent.click(screen.getAllByText(stage.bundle_name!)[0]);
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

    // Master-detail: control rows are visible in the auto-selected panel,
    // so scope the parent-badge assertions to the run list.
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('Protected')).toBeInTheDocument();
    // Parent should NOT badge Detected when there's a Protected stage
    expect(within(list).queryByText('Detected')).toBeNull();
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

    expect(within(screen.getByRole('listbox')).getByText('Detected')).toBeInTheDocument();
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

    // Ratio badge format: "1/2 Protected" (run list + panel header)
    expect(screen.getAllByText('1/2 Protected').length).toBeGreaterThanOrEqual(1);
  });
});

function makeCsAlert(overrides: Partial<CrowdStrikeAlertItem> = {}): CrowdStrikeAlertItem {
  return {
    alert_id: 'cs-alert-001',
    achilles_correlated: false,
    alert_title: 'CrowdStrike: suspicious file lock race',
    description: '',
    severity: 'critical',
    status: 'new',
    technique: 'File and Directory Discovery',
    tactic: 'Discovery',
    product: 'epp',
    scenario: 'suspicious_activity',
    hostname: 'LAP-PF1A47F0',
    filename: '',
    filepath: '',
    mitre_techniques: ['T1083'],
    created_at: '2026-05-12T12:05:00.000Z',
    updated_at: '2026-05-12T12:05:00.000Z',
    resolved_at: null,
    attribution: 'bundle',
    ...overrides,
  };
}

describe('ExecutionsDataTable — CrowdStrike detection + related alerts', () => {
  it('renders "Detected" instead of "Unprotected" when a stage has crowdstrike_detected:true and error_code:101', async () => {
    // Mirror of the Defender per-stage badge test: the crowdstrike enrichment
    // flags (crowdstrike_stage_detected / crowdstrike_detected) drive the same
    // amber "Detected" wording — a CrowdStrike-only shop sees identical UX.
    csConfigured.value = true;
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });

    const detectedStage = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1562.001`,
      test_name: 'WinDefend Service-Stop Notification Subscription',
      control_id: 'T1562.001',
      techniques: ['T1562.001'],
      crowdstrike_detected: true,
      crowdstrike_stage_detected: true,
    });
    const plainStage = makeStage({});

    renderTable(makeData([plainStage, detectedStage], { defenderDetected: false, crowdstrikeDetected: true }));

    await userEvent.click(screen.getAllByText(plainStage.bundle_name!)[0]);

    // Parent rollup + the detected stage both show "Detected"; the plain
    // stage stays "Unprotected".
    await waitFor(() => {
      expect(screen.getAllByText('Detected').length).toBeGreaterThanOrEqual(2);
    });
    // One stage is Unprotected: its attack-chain node and its stage row.
    expect(screen.getAllByText('Unprotected')).toHaveLength(2);
  });

  it('does not fetch CrowdStrike alerts when the integration is not configured', async () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({});
    renderTable(makeData([stage], { defenderDetected: false }));

    await userEvent.click(screen.getAllByText(stage.bundle_name!)[0]);

    await waitFor(() => expect(getAlertsForTestMock).toHaveBeenCalled());
    expect(csGetAlertsForTestMock).not.toHaveBeenCalled();
  });

  it('renders the stage-attributed CrowdStrike alert under the matching stage detail', async () => {
    csConfigured.value = true;
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    csGetAlertsForTestMock.mockResolvedValue({
      alerts: [
        makeCsAlert({
          alert_id: 'cs-stage-1',
          alert_title: 'Falcon: Wacatac blocked',
          attribution: 'stage',
          attributed_control_id: 't1562.001',
        }),
      ],
      matchedTechniques: ['T1562.001'],
      total: 1,
    } satisfies RelatedCrowdStrikeAlertsResponse);

    const stage1 = makeStage({ test_uuid: `${BUNDLE_UUID}::T1083`, control_id: 'T1083', techniques: ['T1083'] });
    const stage2 = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1562.001`,
      control_id: 'T1562.001',
      techniques: ['T1562.001'],
      test_name: 'WinDefend Service-Stop Notification Subscription',
      crowdstrike_detected: true,
    });
    renderTable(makeData([stage1, stage2], { defenderDetected: false, crowdstrikeDetected: true }));

    await userEvent.click(screen.getAllByText(stage1.bundle_name!)[0]);
    await waitFor(() => expect(csGetAlertsForTestMock).toHaveBeenCalledTimes(2));

    // Open stage 2's detail panel — the stage-attributed CrowdStrike alert
    // should surface there (and the section header should exist).
    await openStageRow(stage2.test_name);
    await waitFor(() => {
      expect(screen.getByText(/Falcon: Wacatac blocked/)).toBeInTheDocument();
    });
    expect(screen.getByText('EDR evidence for this stage')).toBeInTheDocument();
  });

  it('aggregates bundle-attribution CrowdStrike alerts across per-stage caches and dedupes by alert_id', async () => {
    csConfigured.value = true;
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const sharedAlert = makeCsAlert({
      alert_id: 'cs-bundle-1',
      alert_title: "Falcon: 'EICAR_Test_File' malware was prevented",
      attribution: 'bundle',
    });
    csGetAlertsForTestMock.mockResolvedValue({
      alerts: [sharedAlert],
      matchedTechniques: ['T1083'],
      total: 1,
    });

    const stage1 = makeStage({ test_uuid: `${BUNDLE_UUID}::T1083`, control_id: 'T1083', techniques: ['T1083'] });
    const stage2 = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1562.001`,
      control_id: 'T1562.001',
      techniques: ['T1562.001'],
      test_name: 'WinDefend Service-Stop Notification Subscription',
    });
    renderTable(makeData([stage1, stage2], { defenderDetected: false, crowdstrikeDetected: true }));

    await userEvent.click(screen.getAllByText(stage1.bundle_name!)[0]);

    await waitFor(() => {
      expect(screen.getByText(/EICAR_Test_File/)).toBeInTheDocument();
    });

    expect(csGetAlertsForTestMock).toHaveBeenCalledTimes(2);
    // Bundle-level callout renders the alert once despite both stages
    // returning it.
    expect(screen.getAllByText(/EICAR_Test_File/)).toHaveLength(1);
    expect(screen.getByText(/Bundle-level CrowdStrike alerts/i)).toBeInTheDocument();
  });
});

describe('ExecutionsDataTable — CrowdStrike prevention (vendor-confirmed)', () => {
  it('renders "Prevented" (stronger than Detected) when crowdstrike_prevented is set on the stage', async () => {
    csConfigured.value = true;
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });

    const preventedStage = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1562.001`,
      test_name: 'WinDefend Service-Stop Notification Subscription',
      control_id: 'T1562.001',
      techniques: ['T1562.001'],
      crowdstrike_detected: true,
      crowdstrike_stage_detected: true,
      crowdstrike_prevented: true,
      crowdstrike_prevention_action: 'process_killed',
    });
    const plainStage = makeStage({});

    renderTable(
      makeData([plainStage, preventedStage], { defenderDetected: false, crowdstrikeDetected: true, crowdstrikePrevented: true }),
    );

    // Compact stage rows render bare "Prevented"; the non-compact panel
    // header includes the action — either way, no Detected/Unprotected for
    // the prevented stage.
    await waitFor(() => {
      expect(screen.getAllByText('Prevented').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.queryByText('Detected')).toBeNull();
    // One stage is Unprotected: its attack-chain node and its stage row.
    expect(screen.getAllByText('Unprotected')).toHaveLength(2);
  });

  it('still renders "Detected" (not Prevented) when detected flags are set but no prevention evidence exists', async () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({
      crowdstrike_detected: true,
      crowdstrike_stage_detected: true,
    });
    renderTable(makeData([stage], { defenderDetected: false, crowdstrikeDetected: true }));

    await waitFor(() => {
      expect(screen.getAllByText('Detected').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.queryByText(/Prevented/)).toBeNull();
  });

  it('treats kill_failed as Detected, never Prevented — the kill was attempted and failed', async () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({
      crowdstrike_detected: true,
      crowdstrike_stage_detected: true,
      crowdstrike_prevention_action: 'kill_failed',
    });
    renderTable(makeData([stage], { defenderDetected: false, crowdstrikeDetected: true }));

    await waitFor(() => {
      expect(screen.getAllByText('Detected').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.queryByText(/Prevented/)).toBeNull();
  });

  it('rolls the parent bundle badge up to Prevented when group.crowdstrikePrevented is set', () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({ crowdstrike_detected: true, crowdstrike_prevented: true });
    renderTable(
      makeData([stage], { defenderDetected: false, crowdstrikeDetected: true, crowdstrikePrevented: true }),
    );

    // Parent badge appears in both the run list and the panel header.
    expect(screen.getAllByText(/Prevented/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Detected')).toBeNull();
  });

  it('shows the prevention badge and portal_url deep link on stage-detail CrowdStrike alert rows', async () => {
    csConfigured.value = true;
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    csGetAlertsForTestMock.mockResolvedValue({
      alerts: [
        makeCsAlert({
          alert_id: 'cs-prev-1',
          alert_title: 'Falcon: ransomware process killed',
          attribution: 'stage',
          attributed_control_id: 't1486',
          prevention_action: 'process_killed',
          pattern_disposition_description: 'Prevention, process killed.',
          portal_url: 'https://falcon.us-2.crowdstrike.com/activity-v2/detections/xyz789?_cid=abc',
        }),
      ],
      matchedTechniques: ['T1486'],
      total: 1,
    } satisfies RelatedCrowdStrikeAlertsResponse);

    const stage = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1486`,
      control_id: 'T1486',
      techniques: ['T1486'],
      test_name: 'ProcRansomware Simulation',
      crowdstrike_detected: true,
      crowdstrike_prevented: true,
      crowdstrike_prevention_action: 'process_killed',
    });
    renderTable(
      makeData([stage], { defenderDetected: false, crowdstrikeDetected: true, crowdstrikePrevented: true }),
    );

    await userEvent.click(screen.getAllByText(stage.bundle_name!)[0]);
    await waitFor(() => expect(csGetAlertsForTestMock).toHaveBeenCalled());
    await openStageRow(stage.test_name);

    await waitFor(() => {
      expect(screen.getByText(/ransomware process killed/)).toBeInTheDocument();
    });
    // Prevention badge with the raw disposition as tooltip
    const badge = screen.getByText('process killed');
    expect(badge).toHaveAttribute('title', 'Prevention, process killed.');
    // Exact per-alert console link (portal_url), not the region-base fallback
    const link = screen.getByLabelText('Open in Falcon console');
    expect(link).toHaveAttribute(
      'href',
      'https://falcon.us-2.crowdstrike.com/activity-v2/detections/xyz789?_cid=abc',
    );
  });
});

describe('ExecutionsDataTable — Defender prevention (vendor-confirmed)', () => {
  it('renders "Prevented" when defender_prevented is set on the stage (no CrowdStrike involved)', async () => {
    csGetAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });

    const preventedStage = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1562.001`,
      test_name: 'WinDefend Service-Stop Notification Subscription',
      control_id: 'T1562.001',
      techniques: ['T1562.001'],
      defender_detected: true,
      defender_stage_detected: true,
      defender_prevented: true,
      defender_prevention_action: 'process_killed',
    });
    const plainStage = makeStage({});

    renderTable(
      makeData([plainStage, preventedStage], { defenderDetected: true, defenderPrevented: true }),
    );

    await waitFor(() => {
      expect(screen.getAllByText('Prevented').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.queryByText('Detected')).toBeNull();
    // One stage is Unprotected: its attack-chain node and its stage row.
    expect(screen.getAllByText('Unprotected')).toHaveLength(2);
  });

  it('renders a single Prevented label when BOTH vendors confirmed prevention', async () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({
      defender_detected: true,
      defender_prevented: true,
      defender_prevention_action: 'blocked',
      crowdstrike_detected: true,
      crowdstrike_prevented: true,
      crowdstrike_prevention_action: 'quarantined',
    });
    renderTable(
      makeData([stage], {
        defenderDetected: true,
        defenderPrevented: true,
        crowdstrikeDetected: true,
        crowdstrikePrevented: true,
      }),
    );

    // Exactly one Prevented verdict per badge slot — two vendors must not
    // produce stacked/duplicated labels.
    const prevented = screen.getAllByText(/^Prevented/);
    expect(prevented.length).toBeGreaterThanOrEqual(2);
    for (const el of prevented) {
      expect(el.textContent).toMatch(/^Prevented/);
    }
    expect(screen.queryByText('Detected')).toBeNull();
  });

  it('still renders "Detected" (not Prevented) for Defender-detected stages without prevention evidence', async () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    const stage = makeStage({
      defender_detected: true,
      defender_stage_detected: true,
    });
    renderTable(makeData([stage], { defenderDetected: true }));

    await waitFor(() => {
      expect(screen.getAllByText('Detected').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.queryByText(/Prevented/)).toBeNull();
  });

  it('shows the prevention badge and portal_url deep link on stage-detail Defender alert rows', async () => {
    getAlertsForTestMock.mockResolvedValue({
      alerts: [
        makeAlert({
          alert_id: 'da-prev-1',
          alert_title: 'Defender blocked the stage binary',
          attribution: 'stage',
          attributed_control_id: 't1083',
          prevention_action: 'process_killed',
          remediation_status: 'blocked',
          portal_url: 'https://security.microsoft.com/alerts/da-prev-1?tid=contoso',
        }),
      ],
      matchedTechniques: ['T1083'],
      total: 1,
    });

    const stage = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1083`,
      control_id: 'T1083',
      techniques: ['T1083'],
      defender_detected: true,
      defender_prevented: true,
      defender_prevention_action: 'process_killed',
    });
    renderTable(
      makeData([stage], { defenderDetected: true, defenderPrevented: true }),
    );

    await userEvent.click(screen.getAllByText(stage.bundle_name!)[0]);
    await waitFor(() => expect(getAlertsForTestMock).toHaveBeenCalled());
    await openStageRow(stage.test_name);

    await waitFor(() => {
      expect(screen.getByText(/Defender blocked the stage binary/)).toBeInTheDocument();
    });
    const badge = screen.getByText('process killed');
    expect(badge).toHaveAttribute('title', 'blocked');
    const link = screen.getByLabelText('Open in Microsoft Defender');
    expect(link).toHaveAttribute(
      'href',
      'https://security.microsoft.com/alerts/da-prev-1?tid=contoso',
    );
  });
});

describe('ExecutionsDataTable — re-fired alert annotation (resolution watermark)', () => {
  // Stage runs at 2026-05-12T12:00:00Z (makeStage fixture). An alert created
  // at 12:05 annotates "5m after" under the existing rule.
  const RUN_TIME = '2026-05-12T12:00:00.000Z';

  function renderStageWithAlert(alert: DefenderAlertItem) {
    getAlertsForTestMock.mockResolvedValue({
      alerts: [alert],
      matchedTechniques: ['T1083'],
      total: 1,
    });
    const stage = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1083`,
      control_id: 'T1083',
      techniques: ['T1083'],
      timestamp: RUN_TIME,
      defender_detected: true,
    });
    renderTable(makeData([stage], { defenderDetected: true }));
    return stage;
  }

  async function openStageDetail(stage: EnrichedTestExecution) {
    await userEvent.click(screen.getAllByText(stage.bundle_name!)[0]);
    await waitFor(() => expect(getAlertsForTestMock).toHaveBeenCalled());
    await openStageRow(stage.test_name);
    await waitFor(() => expect(screen.getByText(/suspicious/i)).toBeInTheDocument());
  }

  it('annotates a re-fired terminal alert from updated_at with the first-seen date', async () => {
    // Born-resolved aggregated alert (resolved_at == created_at on May 10)
    // re-fired 3 minutes into the May 12 run: Defender bumped
    // lastUpdateDateTime while status stayed resolved. Must NOT render the
    // misleading created-relative "49h before" annotation.
    const stage = renderStageWithAlert(
      makeAlert({
        alert_id: 'da-refire',
        alert_title: 'Suspicious tamper attempt (re-fired)',
        status: 'resolved',
        created_at: '2026-05-10T08:00:00.000Z',
        updated_at: '2026-05-12T12:03:00.000Z',
        resolved_at: '2026-05-10T08:00:00.000Z',
        attribution: 'stage',
        attributed_control_id: 't1083',
      }),
    );
    await openStageDetail(stage);

    expect(screen.getByText('re-fired 3m after · first seen May 10')).toBeInTheDocument();
    expect(screen.queryByText(/\d+h before/)).toBeNull();
  });

  it('keeps the created-relative annotation for a terminal alert with no post-resolution bump', async () => {
    // Resolved at creation, never updated afterwards → lifecycle bump only,
    // no re-fire: updated_at == resolved_at is NOT > resolved_at + 60s.
    const stage = renderStageWithAlert(
      makeAlert({
        alert_id: 'da-terminal',
        alert_title: 'Suspicious binary (resolved at creation)',
        status: 'resolved',
        created_at: '2026-05-12T12:05:00.000Z',
        updated_at: '2026-05-12T12:05:00.000Z',
        resolved_at: '2026-05-12T12:05:00.000Z',
        attribution: 'stage',
        attributed_control_id: 't1083',
      }),
    );
    await openStageDetail(stage);

    expect(screen.getByText('5m after')).toBeInTheDocument();
    expect(screen.queryByText(/re-fired/)).toBeNull();
  });

  it('keeps the created-relative annotation for active alerts regardless of updated_at', async () => {
    const stage = renderStageWithAlert(
      makeAlert({
        alert_id: 'da-active',
        alert_title: 'Suspicious binary (active)',
        status: 'inProgress',
        created_at: '2026-05-12T12:05:00.000Z',
        updated_at: '2026-05-13T09:00:00.000Z',
        resolved_at: null,
        attribution: 'stage',
        attributed_control_id: 't1083',
      }),
    );
    await openStageDetail(stage);

    expect(screen.getByText('5m after')).toBeInTheDocument();
    expect(screen.queryByText(/re-fired/)).toBeNull();
  });

  it('falls back to the created-relative annotation when resolved_at is missing', async () => {
    const stage = renderStageWithAlert(
      makeAlert({
        alert_id: 'da-noresolved',
        alert_title: 'Suspicious binary (no resolved_at)',
        status: 'resolved',
        created_at: '2026-05-12T12:05:00.000Z',
        updated_at: '2026-05-13T09:00:00.000Z',
        resolved_at: null,
        attribution: 'stage',
        attributed_control_id: 't1083',
      }),
    );
    await openStageDetail(stage);

    expect(screen.getByText('5m after')).toBeInTheDocument();
    expect(screen.queryByText(/re-fired/)).toBeNull();
  });

  it('applies the same re-fired annotation in the CrowdStrike alerts section', async () => {
    csConfigured.value = true;
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    csGetAlertsForTestMock.mockResolvedValue({
      alerts: [
        makeCsAlert({
          alert_id: 'cs-refire',
          alert_title: 'Falcon: suspicious activity (re-fired)',
          status: 'closed',
          created_at: '2026-05-10T08:00:00.000Z',
          updated_at: '2026-05-12T12:03:00.000Z',
          resolved_at: '2026-05-10T08:00:00.000Z',
          attribution: 'stage',
          attributed_control_id: 't1083',
        }),
      ],
      matchedTechniques: ['T1083'],
      total: 1,
    });
    const stage = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1083`,
      control_id: 'T1083',
      techniques: ['T1083'],
      timestamp: RUN_TIME,
      crowdstrike_detected: true,
    });
    renderTable(makeData([stage], { defenderDetected: false, crowdstrikeDetected: true }));

    await userEvent.click(screen.getAllByText(stage.bundle_name!)[0]);
    await waitFor(() => expect(csGetAlertsForTestMock).toHaveBeenCalled());
    await openStageRow(stage.test_name);

    await waitFor(() => {
      expect(screen.getByText('re-fired 3m after · first seen May 10')).toBeInTheDocument();
    });
  });
});

describe('ExecutionsDataTable — narrow-screen layout contract', () => {
  // jsdom cannot measure layout, so this pins the classes that keep the
  // attack-chain strip scrolling inside the panel below lg: a lone implicit
  // `auto` grid column grows to the strip's min-content width instead
  // (measured 562px vs 343px at 375px in headless Chromium).
  it('gives the master-detail grid a shrinkable column below lg and keeps the lg template', () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    renderTable(makeData([makeStage({}), makeStage({ control_id: 'T1562.001' })], { defenderDetected: false }));
    const grid = screen.getByRole('listbox').closest('.grid');
    expect(grid).toHaveClass('grid-cols-[minmax(0,1fr)]', 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]');
    const panel = screen.getByRole('region', { name: 'Run summary' }).parentElement;
    expect(panel).toHaveClass('min-w-0');
  });
});

describe('ExecutionsDataTable — execution report link', () => {
  it('opens the print report in a new tab when reportHref is provided', () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    render(
      <ExecutionsDataTable
        data={makeData([makeStage({})], { defenderDetected: false })}
        loading={false}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        onSort={vi.fn()}
        sortField="routing.event_time"
        sortOrder="desc"
        reportHref="/analytics/report?date=30d"
      />,
    );
    const link = screen.getByRole('link', { name: 'Report (PDF)' });
    expect(link).toHaveAttribute('href', '/analytics/report?date=30d');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('hides the link when no href is provided', () => {
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    renderTable(makeData([makeStage({})], { defenderDetected: false }));
    expect(screen.queryByRole('link', { name: 'Report (PDF)' })).toBeNull();
  });

  it('opens the Export menu on keyboard focus as well as on hover', () => {
    // jsdom cannot evaluate :focus-within visibility, so this pins the classes that provide it.
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    renderTable(makeData([makeStage({})], { defenderDetected: false }));
    const panel = screen.getByRole('button', { name: 'Export CSV' }).parentElement as HTMLElement;
    expect(panel).toHaveClass('invisible', 'opacity-0', 'group-hover:visible', 'group-hover:opacity-100');
    expect(panel).toHaveClass('group-focus-within:visible', 'group-focus-within:opacity-100');
  });
});

describe('ExecutionsDataTable — related alerts keyed by endpoint vendor', () => {
  const empty = { alerts: [], matchedTechniques: [], total: 0 };

  function standaloneData(exec: EnrichedTestExecution): GroupedPaginatedResponse {
    return {
      groups: [{
        groupKey: `standalone::${exec.test_uuid}`,
        type: 'standalone',
        representative: exec,
        members: [exec],
        protectedCount: 0,
        unprotectedCount: 1,
        totalCount: 1,
        defenderDetected: false,
      }],
      pagination: { page: 1, pageSize: 25, totalGroups: 1, totalDocuments: 1, totalPages: 1, hasNext: false, hasPrevious: false },
    } as GroupedPaginatedResponse;
  }

  const standalone = makeStage({
    test_uuid: 'aaaaaaaa-1111-2222-3333-444444444444',
    test_name: 'Standalone Probe',
    is_bundle_control: false,
    bundle_id: undefined,
    bundle_name: undefined,
    control_id: undefined,
    techniques: ['T1059.001'],
  });

  it('fetches Sophos related alerts for a selected standalone execution with the binary name and bundle args', async () => {
    sophosConfigured.value = true;
    getAlertsForTestMock.mockResolvedValue(empty);
    renderTable(standaloneData(standalone));

    await waitFor(() => expect(sophosGetAlertsForTestMock).toHaveBeenCalledTimes(1));
    expect(sophosGetAlertsForTestMock).toHaveBeenCalledWith(
      ['T1059.001'], standalone.timestamp, 30, standalone.hostname,
      'aaaaaaaa-1111-2222-3333-444444444444.exe', standalone.bundle_name,
    );
  });

  it('fetches each bundle control for Sophos under its own cache key', async () => {
    sophosConfigured.value = true;
    getAlertsForTestMock.mockResolvedValue(empty);
    const stage1 = makeStage({ test_uuid: `${BUNDLE_UUID}::T1083`, control_id: 'T1083', techniques: ['T1083'] });
    const stage2 = makeStage({
      test_uuid: `${BUNDLE_UUID}::T1562.001`, control_id: 'T1562.001', techniques: ['T1562.001'],
      test_name: 'WinDefend Service-Stop Notification Subscription',
    });
    renderTable(makeData([stage1, stage2], { defenderDetected: false }));
    await userEvent.click(screen.getAllByText(stage1.bundle_name!)[0]);

    await waitFor(() => expect(sophosGetAlertsForTestMock).toHaveBeenCalledTimes(2));
    const bin = `${BUNDLE_UUID}.exe`;
    expect(sophosGetAlertsForTestMock).toHaveBeenCalledWith(['T1083'], stage1.timestamp, 30, stage1.hostname, bin, stage1.bundle_name);
    expect(sophosGetAlertsForTestMock).toHaveBeenCalledWith(['T1562.001'], stage2.timestamp, 30, stage2.hostname, bin, stage2.bundle_name);

    // Expanding a control reuses its cached entry (no extra call).
    await openStageRow(stage2.test_name);
    expect(sophosGetAlertsForTestMock).toHaveBeenCalledTimes(2);
  });

  it('never calls Sophos when it is not configured, while CrowdStrike and SentinelOne still fetch with the same args', async () => {
    csConfigured.value = true;
    s1Configured.value = true;
    getAlertsForTestMock.mockResolvedValue(empty);
    renderTable(standaloneData(standalone));

    await waitFor(() => expect(csGetAlertsForTestMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(s1GetAlertsForTestMock).toHaveBeenCalledTimes(1));
    const args = [
      ['T1059.001'], standalone.timestamp, 30, standalone.hostname,
      'aaaaaaaa-1111-2222-3333-444444444444.exe', standalone.bundle_name,
    ];
    expect(csGetAlertsForTestMock).toHaveBeenCalledWith(...args);
    expect(s1GetAlertsForTestMock).toHaveBeenCalledWith(...args);
    expect(sophosGetAlertsForTestMock).not.toHaveBeenCalled();
  });

  it('serves a repeat selection of the same execution from the cache', async () => {
    sophosConfigured.value = true;
    getAlertsForTestMock.mockResolvedValue(empty);
    const stage1 = makeStage({ test_uuid: `${BUNDLE_UUID}::T1083`, control_id: 'T1083', techniques: ['T1083'] });
    renderTable(makeData([stage1], { defenderDetected: false }));
    await waitFor(() => expect(sophosGetAlertsForTestMock).toHaveBeenCalledTimes(1));

    // Re-select the already selected row.
    await userEvent.click(screen.getAllByText(stage1.bundle_name!)[0]);
    await userEvent.click(screen.getAllByText(stage1.bundle_name!)[0]);
    expect(sophosGetAlertsForTestMock).toHaveBeenCalledTimes(1);
  });
});

describe('ExecutionsDataTable — a failed related-alerts lookup is retried', () => {
  // A failed lookup (null) used to be cached for the life of the page, so the
  // run read "No related alerts" until a full reload. Only successful lookups
  // are cached now: opening the stage asks again.
  it('asks again when the stage is opened after a failed lookup', async () => {
    csConfigured.value = true;
    getAlertsForTestMock.mockResolvedValue({ alerts: [], matchedTechniques: [], total: 0 });
    csGetAlertsForTestMock.mockReset();
    csGetAlertsForTestMock
      .mockRejectedValueOnce(new Error('HTTP 400'))
      .mockResolvedValue({
        alerts: [{ alert_id: 'cs-1', alert_title: 'GenericSignedProxyExecution', severity: 'high', status: 'new',
          attribution: 'stage', attributed_control_id: 't1204.002', created_at: '2026-10-31T02:31:31Z' } as CrowdStrikeAlertItem],
        matchedTechniques: [], total: 1,
      } as RelatedCrowdStrikeAlertsResponse);
    const stage = makeStage({ test_uuid: `${BUNDLE_UUID}::T1204.002`, control_id: 'T1204.002', techniques: ['T1204.002'], test_name: 'Event-Invite LNK Execution' });
    renderTable(makeData([stage], { defenderDetected: false }));

    // The run is selected on mount; its CrowdStrike lookup fails.
    await waitFor(() => expect(csBatch).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('GenericSignedProxyExecution')).not.toBeInTheDocument();

    // Opening the stage asks again (the failure was not cached) and shows the alert.
    await openStageRow(stage.test_name);
    await waitFor(() => expect(csBatch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText('GenericSignedProxyExecution').length).toBeGreaterThan(0));
    csConfigured.value = false;
  });
});
