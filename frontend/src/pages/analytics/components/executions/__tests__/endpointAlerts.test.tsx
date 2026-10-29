import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EnrichedTestExecution } from '@/services/api/analytics';
import type { RelatedCrowdStrikeAlertsResponse, CrowdStrikeAlertItem } from '@/services/api/crowdstrike';
import {
  EndpointAlertRow,
  emptyEndpointAlerts,
  stageAlertState,
  type RunDetailPanelProps,
} from '../detailParts';
import { StageList } from '../StageList';
import type { BundleGroup } from '../shared';

const exec = {
  test_uuid: 'u1::T1059',
  control_id: 'T1059',
  techniques: ['T1059'],
  timestamp: '2026-10-12T12:47:49Z',
  hostname: 'LT1',
  is_bundle_control: true,
  bundle_id: 'u1',
  bundle_name: 'Chain',
  error_code: 126,
  category: 'intel-driven',
  control_validator: 'Stage 1',
} as unknown as EnrichedTestExecution;

function alertItem(over: Partial<CrowdStrikeAlertItem> = {}): CrowdStrikeAlertItem {
  return {
    alert_id: 'a1',
    alert_title: 'Bad thing',
    severity: 'high',
    status: 'new',
    portal_url: 'https://central.sophos.com/a1',
    attribution: 'stage',
    attributed_control_id: 'T1059',
    ...over,
  } as unknown as CrowdStrikeAlertItem;
}

const response = (alerts: CrowdStrikeAlertItem[]) => ({ alerts }) as unknown as RelatedCrowdStrikeAlertsResponse;

describe('stageAlertState', () => {
  it('returns a key per endpoint vendor including sophos', () => {
    const endpointAlerts = emptyEndpointAlerts();
    endpointAlerts.sophos.map.set('k', response([alertItem(), alertItem({ alert_id: 'b', attribution: 'bundle' })]));
    endpointAlerts.sophos.loading.add('k');
    const state = stageAlertState(exec, {
      alertsMap: new Map(),
      alertsLoading: new Set(),
      endpointAlerts,
      stageAlertsCacheKey: () => 'k',
    });
    expect(Object.keys(state.endpoint).sort()).toEqual(['crowdstrike', 'sentinelone', 'sophos']);
    expect(state.endpoint.sophos.loading).toBe(true);
    expect(state.endpoint.sophos.alerts).toHaveLength(1);
    expect(state.endpoint.sophos.hasBundleAlerts).toBe(true);
    expect(state.endpoint.crowdstrike.alerts).toEqual([]);
  });
});

describe('EndpointAlertRow', () => {
  it('links Sophos alerts with the Sophos Central label', () => {
    render(<EndpointAlertRow alert={alertItem()} runTimestamp={exec.timestamp} vendor="sophos" />);
    expect(screen.getByLabelText('Open in Sophos Central')).toHaveAttribute('href', 'https://central.sophos.com/a1');
  });
});

describe('StageList vendor copy', () => {
  it('names all four vendors when all are configured', () => {
    const endpointAlerts = emptyEndpointAlerts();
    for (const v of ['crowdstrike', 'sentinelone', 'sophos'] as const) endpointAlerts[v].configured = true;
    const group = {
      type: 'bundle', key: 'g', bundle_id: 'u1', bundle_name: 'Chain', hostname: 'LT1',
      timestamp: exec.timestamp, controls: [exec], protectedCount: 1, unprotectedCount: 0,
      totalCount: 1, category: 'intel-driven',
    } as unknown as BundleGroup;
    const props = {
      defenderConfigured: true,
      endpointAlerts,
      descriptionMap: new Map(),
      descriptionLoadingKey: null,
      alertsMap: new Map(),
      alertsLoading: new Set(),
      stageAlertsCacheKey: () => 'k',
      getAcceptanceForExec: () => undefined,
      riskEnabled: false,
      onRequestAcceptRisk: vi.fn(),
      onRequestRevoke: vi.fn(),
      onOpenInfo: vi.fn(),
      expandedControlIndex: 0,
      onToggleControl: vi.fn(),
    } as unknown as RunDetailPanelProps;
    render(<StageList {...props} group={group} />);
    expect(
      screen.getByText("No Defender, CrowdStrike, SentinelOne and Sophos alert names this stage's binary.")
    ).toBeInTheDocument();
  });
});
