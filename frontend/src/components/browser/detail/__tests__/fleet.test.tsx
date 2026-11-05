import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TestDetails } from '@/types/test';
import type { BuildInfoState } from '../useBuildInfo';
import type { TestFleetResponse, TestFleetStage } from '@/services/api/analytics';

const caps = { loaded: true, testFleet: true };
const getTestFleet = vi.fn();
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => caps }));
vi.mock('@/services/api/analytics', () => ({ analyticsApi: { getTestFleet: (...a: unknown[]) => getTestFleet(...a) } }));
vi.mock('../overview/DeployPanel', () => ({ default: () => <div>deploy-panel</div> }));

const { mapFleetToPills } = await import('../overview/fleetPills');
const { default: OverviewTab } = await import('../overview/OverviewTab');

const fs = (over: Partial<TestFleetStage>): TestFleetStage => ({
  controlId: 'T1059', blocked: 9, detected: 2, through: 1, hosts: 12, lastRunAt: '2026-11-01T00:00:00Z', ...over,
});
const resp = (over: Partial<TestFleetResponse> = {}, stages: TestFleetStage[] = [fs({})]): TestFleetResponse => ({
  headline: { hostCount: 12, pairCount: 12, stoppedCount: 10, lastRunAt: '2026-11-01T00:00:00Z' },
  stages, stoppedBeforeStage: 0, ...over,
});

const stage = (id: number, technique: string) => ({ stageId: id, technique, name: `Stage ${id}`, fileName: `s${id}.go` });

function make(over: Partial<TestDetails> = {}): TestDetails {
  return {
    uuid: 'u-1', name: 'My Test', category: 'intel-driven', techniques: ['T1059'], isMultiStage: true,
    stages: [stage(1, 'T1059'), stage(2, 'T1486')], files: [], overview: {}, ...over,
  } as unknown as TestDetails;
}
const renderTab = (t: TestDetails) =>
  render(<MemoryRouter><OverviewTab test={t} canBuild={false} build={{} as BuildInfoState} onOpenFile={vi.fn()} /></MemoryRouter>);

beforeEach(() => { getTestFleet.mockReset(); caps.loaded = true; caps.testFleet = true; });

describe('mapFleetToPills', () => {
  it('shares one technique between two stages', () => {
    const { pills, earlier } = mapFleetToPills([stage(1, 'T1562.001'), stage(2, 'T1562.001'), stage(3, 'T1486')], [fs({ controlId: 'T1562.001' })]);
    expect(pills[1]).toEqual({ blocked: 9, detected: 2, through: 1, sharedWith: [2] });
    expect(pills[2]).toEqual({ blocked: 9, detected: 2, through: 1, sharedWith: [1] });
    expect(pills[3]).toBeUndefined();
    expect(earlier).toEqual([]);
  });
  it('puts unmatched rows in earlier', () => {
    const old = fs({ controlId: 'T9999' });
    const { pills, earlier } = mapFleetToPills([stage(1, 'T1059')], [fs({}), old]);
    expect(pills[1]).toEqual({ blocked: 9, detected: 2, through: 1 });
    expect(earlier).toEqual([old]);
  });
});

describe('Overview fleet', () => {
  it('renders pill text and headline', async () => {
    getTestFleet.mockResolvedValue(resp());
    renderTab(make());
    expect(await screen.findByText('9 blocked · 2 detected · 1 through')).toBeInTheDocument();
    expect(screen.getByText('chain stopped on 10 of 12 hosts')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Analytics/ })).toHaveAttribute('href', '/analytics?tests=My%20Test');
    expect(screen.queryByText(/stopped before any stage ran/)).toBeNull();
  });
  it('shows the stopped-before-stage line only when > 0, multi-stage only', async () => {
    getTestFleet.mockResolvedValue(resp({ stoppedBeforeStage: 2 }));
    renderTab(make());
    expect(await screen.findByText('2 hosts stopped before any stage ran (EDR killed / blocked at launch)')).toBeInTheDocument();
  });
  it('not shown for standalone tests', async () => {
    getTestFleet.mockResolvedValue(resp({ stoppedBeforeStage: 2 }));
    renderTab(make({ isMultiStage: false, stages: [] }));
    await screen.findByText('chain stopped on 10 of 12 hosts');
    expect(screen.queryByText(/stopped before any stage ran/)).toBeNull();
  });
  it('lists earlier stages', async () => {
    getTestFleet.mockResolvedValue(resp({}, [fs({}), fs({ controlId: 'T9999', blocked: 1, detected: 0, through: 0 })]));
    renderTab(make());
    expect(await screen.findByText('T9999')).toBeInTheDocument();
    expect(screen.getByText('Earlier stages')).toBeInTheDocument();
  });
  it('hides FleetPanel when pairCount is 0', async () => {
    getTestFleet.mockResolvedValue(resp({ headline: { hostCount: 0, pairCount: 0, stoppedCount: 0, lastRunAt: null } }, []));
    renderTab(make());
    await waitFor(() => expect(getTestFleet).toHaveBeenCalled());
    expect(screen.queryByText(/chain stopped/)).toBeNull();
  });
  it('cyber-hygiene copy and control rows grouped by validator', async () => {
    getTestFleet.mockResolvedValue(resp({}, [
      fs({ controlId: 'CH-DEF-001', validator: 'Defender', description: 'RTP on', blocked: 5, detected: 3, through: 4, hosts: 12 }),
    ]));
    renderTab(make({
      category: 'cyber-hygiene', isMultiStage: false, stages: [],
      validatorDescriptions: { Defender: 'Defender checks', Firewall: 'FW checks' },
    } as Partial<TestDetails>));
    expect(await screen.findByText('10 of 12 control checks passing on 12 hosts')).toBeInTheDocument();
    expect(screen.getByText('Firewall')).toBeInTheDocument();
    expect(screen.getByText('CH-DEF-001')).toBeInTheDocument();
    expect(screen.getByText('8 / 12 hosts')).toBeInTheDocument();
    expect(screen.getByText('RTP on')).toBeInTheDocument();
  });
  it('capability false: no request, no panel', async () => {
    caps.testFleet = false;
    renderTab(make());
    await new Promise((r) => setTimeout(r, 20));
    expect(getTestFleet).not.toHaveBeenCalled();
    expect(screen.queryByText(/chain stopped/)).toBeNull();
  });
  it('fetch rejects: renders without fleet, no error text', async () => {
    getTestFleet.mockRejectedValue(new Error('boom'));
    renderTab(make());
    await waitFor(() => expect(getTestFleet).toHaveBeenCalled());
    expect(screen.getByText('Stage 1')).toBeInTheDocument();
    expect(screen.queryByText(/boom|error|failed/i)).toBeNull();
    expect(screen.queryByText(/chain stopped/)).toBeNull();
  });
});
