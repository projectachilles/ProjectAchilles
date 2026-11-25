import { describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { EnrichedTestExecution } from '@/services/api/analytics';
import type { DefenderAlertItem } from '@/services/api/defender';
import { DefenderAlertRow, emptyEndpointAlerts, stageAlertState, stageAlertsKey } from '../detailParts';

function stage(control: string, over: Partial<EnrichedTestExecution> = {}): EnrichedTestExecution {
  return {
    test_uuid: `u1::${control}`,
    control_id: control,
    techniques: [control],
    timestamp: '2026-10-12T12:47:49Z',
    hostname: 'win-host-01',
    is_bundle_control: true,
    bundle_id: 'u1',
    error_code: 126,
    ...over,
  } as unknown as EnrichedTestExecution;
}

function alert(over: Partial<DefenderAlertItem> = {}): DefenderAlertItem {
  return {
    alert_id: 'a1',
    alert_title: 'Bad thing',
    severity: 'high',
    status: 'new',
    attribution: 'stage',
    attributed_control_id: 't1518.001',
    prevention_action: 'quarantined',
    ...over,
  } as unknown as DefenderAlertItem;
}

function alertsFor(exec: EnrichedTestExecution, alerts: DefenderAlertItem[]) {
  const alertsMap = new Map([['k', { alerts }]]) as never;
  return stageAlertState(exec, { alertsMap, alertsLoading: new Set(), endpointAlerts: emptyEndpointAlerts(), stageAlertsCacheKey: () => 'k' }).defender.alerts;
}

describe('stageAlertsKey', () => {
  it('differs for two runs of one test on one host with different timestamps', () => {
    const a = stageAlertsKey(stage('T1047', { timestamp: '2026-10-12T12:00:00Z' }));
    const b = stageAlertsKey(stage('T1047', { timestamp: '2026-10-13T12:00:00Z' }));
    expect(a).not.toBe(b);
  });
});

describe('an alert with evidence for several stages', () => {
  const multi = alert({
    attributed_control_ids: ['t1518.001', 't1136.001'],
    stage_actions: { 't1518.001': 'process_killed' },
    prevention_action: 'quarantined',
  });

  it('is listed under each of its stages and not under another', () => {
    expect(alertsFor(stage('T1518.001'), [multi])).toHaveLength(1);
    expect(alertsFor(stage('T1136.001'), [multi])).toHaveLength(1);
    expect(alertsFor(stage('T1047'), [multi])).toHaveLength(0);
  });

  it("shows the stage's own action, and none under a stage without an entry", () => {
    const first = alertsFor(stage('T1518.001'), [multi])[0];
    render(<DefenderAlertRow alert={first} runTimestamp="2026-10-12T12:47:49Z" />);
    expect(screen.getByText('process killed')).toBeInTheDocument();

    const fifth = alertsFor(stage('T1136.001'), [multi])[0];
    expect(fifth.prevention_action).toBeUndefined();
    cleanup();
    render(<DefenderAlertRow alert={fifth} runTimestamp="2026-10-12T12:47:49Z" />);
    expect(screen.getByText('Bad thing')).toBeInTheDocument();
    expect(screen.queryByText(/quarantined|process killed|blocked/)).toBeNull();
  });

  it('matches a variant token in stage_actions to its stage', () => {
    const v = alert({
      attributed_control_id: 't1562.001-svcnotify',
      attributed_control_ids: ['t1562.001-svcnotify'],
      stage_actions: { 't1562.001-svcnotify': 'blocked' },
      prevention_action: undefined,
    });
    const [got] = alertsFor(stage('T1562.001'), [v]);
    expect(got.prevention_action).toBe('blocked');
  });
});

describe('an alert without attributed_control_ids or stage_actions', () => {
  it('is listed by attributed_control_id and keeps its prevention_action', () => {
    const [got] = alertsFor(stage('T1518.001'), [alert()]);
    expect(got.prevention_action).toBe('quarantined');
    expect(alertsFor(stage('T1047'), [alert()])).toHaveLength(0);
  });

  it('matches a variant control to its stage', () => {
    const [got] = alertsFor(stage('T1562.001'), [alert({ attributed_control_id: 't1562.001-svcnotify' })]);
    expect(got.prevention_action).toBe('quarantined');
  });
});
