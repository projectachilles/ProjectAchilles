import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

/**
 * Request discipline of the Analytics dashboard tab: each endpoint once per
 * load. The vendor "configured" hooks start false and flip once their
 * /api/integrations/<vendor> call answers; that flip used to re-run all 13
 * core requests (seen in production logs as every endpoint called twice).
 */

// Every API method is a vi.fn returning an empty but well-formed payload.
// Built in vi.hoisted because some modules read API methods at import time;
// reset() swaps the payloads and clears the fns between tests.
const mocks = vi.hoisted(() => {
  function apiProxy() {
    const fns = new Map<string, ReturnType<typeof vi.fn>>();
    let overrides: Record<string, unknown> = {};
    const api = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
      get(_t, prop: string) {
        if (!fns.has(prop)) {
          fns.set(prop, vi.fn(async () => (prop in overrides ? overrides[prop] : [])));
        }
        return fns.get(prop);
      },
    });
    const reset = (next: Record<string, unknown>) => {
      overrides = next;
      for (const [name, fn] of fns) {
        fn.mockReset();
        fn.mockImplementation(async () => (name in overrides ? overrides[name] : []));
      }
    };
    return { api, reset };
  }
  return {
    analytics: apiProxy(),
    defender: apiProxy(),
    crowdstrike: apiProxy(),
    agent: apiProxy(),
    defenderFlipsTo: true,
    caps: { outcomeBreakdown: false, loaded: true } as { outcomeBreakdown: boolean; loaded: boolean; stageCoverage?: boolean; testVersions?: boolean },
  };
});

vi.mock('../../../services/api/analytics', () => ({ analyticsApi: mocks.analytics.api }));
vi.mock('../../../services/api/defender', () => ({ defenderApi: mocks.defender.api }));
vi.mock('../../../services/api/crowdstrike', () => ({ crowdstrikeApi: mocks.crowdstrike.api }));
vi.mock('../../../services/api/sentineloneAnalytics', () => ({ sentineloneAnalyticsApi: { getTechniqueOverlap: vi.fn(async () => []) } }));
vi.mock('../../../services/api/sophosAnalytics', () => ({ sophosAnalyticsApi: { getTechniqueOverlap: vi.fn(async () => []) } }));
vi.mock('../../../services/api/reports', () => ({ reportsApi: {} }));
vi.mock('../../../services/api/agent', () => ({ agentApi: mocks.agent.api }));

vi.mock('@/hooks/useAnalyticsAuth', () => ({
  useAnalyticsAuth: () => ({ configured: true, loading: false, settingsVersion: 0 }),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => mocks.caps }));
vi.mock('@/hooks/useScoringMode', () => ({ useScoringMode: () => ({ scoringMode: 'any-stage' }) }));

// Defender is configured, but (as in the browser) the hook only learns that
// after its own request resolves: false on the first render, then true.
vi.mock('@/hooks/useDefenderConfig', async () => {
  const React = await import('react');
  return {
    useDefenderConfig: () => {
      const [configured, setConfigured] = React.useState(false);
      React.useEffect(() => {
        const t = setTimeout(() => setConfigured(mocks.defenderFlipsTo), 20);
        return () => clearTimeout(t);
      }, []);
      return { configured, loading: false };
    },
  };
});
vi.mock('@/hooks/useCrowdStrikeConfig', () => ({ useCrowdStrikeConfig: () => ({ configured: false, loading: false }) }));
vi.mock('@/hooks/useSentinelOneConfig', () => ({ useSentinelOneConfig: () => ({ configured: false, loading: false }) }));
vi.mock('@/hooks/useSophosConfig', () => ({ useSophosConfig: () => ({ configured: false, loading: false }) }));

// recharts' ResponsiveContainer needs it once the card renders real charts
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const { default: AnalyticsDashboardPage } = await import('../AnalyticsDashboardPage');

const CORE_ENDPOINTS = [
  'getDefenseScore',
  'getUniqueHostnames',
  'getUniqueTests',
  'getDefenseScoreTrend',
  'getResultsByErrorType',
  'getTestCoverage',
  'getTechniqueDistribution',
  'getHostTestMatrix',
  'getChainDepth',
  'getDefenseScoreByHostname',
  'getErrorRateTrend',
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/analytics']}>
      <AnalyticsDashboardPage />
    </MemoryRouter>,
  );
}

// The fleet behind the Test Breadth by Host card: empty unless a test says otherwise.
beforeEach(() => {
  mocks.agent.reset({ listAgents: { agents: [], total: 0 } });
});

describe('AnalyticsDashboardPage request discipline', () => {
  beforeEach(() => {
    mocks.defenderFlipsTo = true;
    mocks.caps = { outcomeBreakdown: false, loaded: true };
    mocks.analytics.reset({
      getOutcomeBreakdown: { pairCount: 10, protected: 4, prevented: 2, detected: 1, silent: 3, noConclusive: 0, riskAccepted: 0, windowLabel: '30d' },
      getGroupedPaginatedExecutions: { groups: [], pagination: { page: 1, pageSize: 25, totalGroups: 0, totalDocuments: 0, totalPages: 0, hasNext: false, hasPrevious: false } },
      getDefenseScore: { score: 50, totalExecutions: 0, protectedCount: 0 },
      getUniqueHostnames: 0,
      getUniqueTests: 0,
      getChainDepth: null,
      getPaginatedExecutions: { data: [], pagination: { totalItems: 0 } },
      getErrorRate: { errorRate: 0 },
      getCanonicalTestCount: { count: 0 },
      listAcceptances: { total: 0 },
      getFilterOptions: {
        tests: [], techniques: [], hostnames: [], categories: [],
        threatActors: [], tags: [], errorNames: [], errorCodes: [], bundleNames: [],
      },
    });
    mocks.defender.reset({ getSecureScore: null });
    mocks.crowdstrike.reset({ getZtaScore: null });
  });

  it('calls each core endpoint once when a vendor turns out to be configured', async () => {
    renderPage();
    await waitFor(() => expect(mocks.defender.api.getSecureScore).toHaveBeenCalled());
    // Let any re-run the flip would trigger happen before counting.
    await new Promise((r) => setTimeout(r, 50));

    for (const name of CORE_ENDPOINTS) {
      expect(mocks.analytics.api[name], name).toHaveBeenCalledTimes(1);
    }
    // Test activity lists runs (grouped, like All Executions), not stage results.
    const activity = mocks.analytics.api.getGroupedPaginatedExecutions.mock.calls.filter(
      (call: unknown[]) => (call[0] as { pageSize?: number } | undefined)?.pageSize === 12,
    );
    expect(activity).toHaveLength(1);
    expect(mocks.analytics.api.getPaginatedExecutions).not.toHaveBeenCalled();
    // The panel's Inconclusive line comes from the score response, not /error-rate.
    expect(mocks.analytics.api.getErrorRate).not.toHaveBeenCalled();
    expect(mocks.analytics.api.getDefenseScore).toHaveBeenCalledWith(expect.objectContaining({ basis: 'latest', withNoConclusive: true }));
    expect(mocks.defender.api.getSecureScore).toHaveBeenCalledTimes(1);
    expect(mocks.defender.api.getSecureScoreTrend).toHaveBeenCalledTimes(1);
  });

  it('loads all filter dropdowns with one request', async () => {
    renderPage();
    await waitFor(() => expect(mocks.analytics.api.getFilterOptions).toHaveBeenCalledTimes(1));
    for (const name of [
      'getAvailableTests', 'getAvailableTechniques', 'getAvailableHostnames', 'getAvailableCategories',
      'getAvailableThreatActors', 'getAvailableTags', 'getAvailableErrorNames',
      'getAvailableErrorCodes', 'getAvailableBundleNames',
    ]) {
      expect(mocks.analytics.api[name], name).not.toHaveBeenCalled();
    }
  });

  it('does not hold the vendor cards until the core requests finish', async () => {
    // The core load never completes; Defender's summary must still be asked for.
    mocks.analytics.api.getDefenseScore.mockImplementation(() => new Promise(() => {}));
    renderPage();
    await waitFor(() => expect(mocks.defender.api.getSecureScore).toHaveBeenCalledTimes(1));
  });

  it('asks nothing of a vendor that is not configured', async () => {
    mocks.defenderFlipsTo = false;
    renderPage();
    await waitFor(() => expect(mocks.analytics.api.getErrorRateTrend).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.defender.api.getSecureScore).not.toHaveBeenCalled();
    expect(mocks.crowdstrike.api.getZtaScore).not.toHaveBeenCalled();
  });
});

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.search}</div>;
}

describe('Outcome breakdown card wiring', () => {
  beforeEach(() => {
    mocks.defenderFlipsTo = false;
    mocks.caps = { outcomeBreakdown: true, loaded: true };
    mocks.analytics.reset({
      getDefenseScore: { score: 50, totalExecutions: 0, protectedCount: 0 },
      getUniqueHostnames: 0,
      getUniqueTests: 0,
      getChainDepth: null,
      getPaginatedExecutions: { data: [], pagination: { totalItems: 0 } },
      getErrorRate: { errorRate: 0 },
      getCanonicalTestCount: { count: 0 },
      listAcceptances: { total: 0 },
      getOutcomeBreakdown: { pairCount: 10, protected: 4, prevented: 2, detected: 1, silent: 3, noConclusive: 0, riskAccepted: 0, windowLabel: '30d' },
      getGroupedPaginatedExecutions: { groups: [], pagination: { page: 1, pageSize: 25, totalGroups: 0, totalDocuments: 0, totalPages: 0, hasNext: false, hasPrevious: false } },
      getFilterOptions: {
        tests: [], techniques: [], hostnames: [], categories: [],
        threatActors: [], tags: [], errorNames: [], errorCodes: [], bundleNames: [],
      },
    });
    mocks.defender.reset({ getSecureScore: null });
    mocks.crowdstrike.reset({ getZtaScore: null });
  });

  it('shows the Outcome breakdown card and never asks for error types when supported', async () => {
    renderPage();
    expect(await screen.findByText('Outcome breakdown')).toBeTruthy();
    expect(mocks.analytics.api.getOutcomeBreakdown).toHaveBeenCalledTimes(1);
    expect(mocks.analytics.api.getOutcomeBreakdown.mock.calls[0][0]).toMatchObject({ basis: 'latest' });
    expect(mocks.analytics.api.getResultsByErrorType).not.toHaveBeenCalled();
  });

  it('keeps Results by error type when the backend does not support it', async () => {
    mocks.caps = { outcomeBreakdown: false, loaded: true };
    renderPage();
    await waitFor(() => expect(mocks.analytics.api.getResultsByErrorType).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Results by error type')).toBeTruthy();
    expect(mocks.analytics.api.getOutcomeBreakdown).not.toHaveBeenCalled();
  });

  it('calls neither until capabilities have loaded', async () => {
    mocks.caps = { outcomeBreakdown: false, loaded: false };
    renderPage();
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.analytics.api.getResultsByErrorType).not.toHaveBeenCalled();
    expect(mocks.analytics.api.getOutcomeBreakdown).not.toHaveBeenCalled();
    // ...but the rest of the dashboard does not wait for capabilities
    expect(mocks.analytics.api.getDefenseScore).toHaveBeenCalled();
  });

  async function clickSilent() {
    renderPage();
    const silent = await screen.findByText('Silent');
    fireEvent.click(silent.closest('button') ?? silent);
    await waitFor(() =>
      expect(mocks.analytics.api.getGroupedPaginatedExecutions).toHaveBeenCalledWith(
        expect.objectContaining({ verdict: 'silent' }),
      ),
    );
  }

  it('a legend click opens Executions filtered by verdict, and the chip clears it', async () => {
    await clickSilent();
    const chip = await screen.findByText(/Outcome: Silent/);
    mocks.analytics.api.getGroupedPaginatedExecutions.mockClear();
    fireEvent.click(chip);
    await waitFor(() => expect(mocks.analytics.api.getGroupedPaginatedExecutions).toHaveBeenCalled());
    const last = mocks.analytics.api.getGroupedPaginatedExecutions.mock.calls.at(-1)![0];
    expect(last).not.toHaveProperty('verdict');
    expect(screen.queryByText(/Outcome: Silent/)).toBeNull();
  });

  it('leaving Executions drops the verdict', async () => {
    await clickSilent();
    fireEvent.click(screen.getByRole('button', { name: /Dashboard/ }));
    await screen.findByText('Outcome breakdown');
    mocks.analytics.api.getGroupedPaginatedExecutions.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Executions/ }));
    await waitFor(() => expect(mocks.analytics.api.getGroupedPaginatedExecutions).toHaveBeenCalled());
    const last = mocks.analytics.api.getGroupedPaginatedExecutions.mock.calls.at(-1)![0];
    expect(last).not.toHaveProperty('verdict');
  });

  it('drops the verdict when the tab changes through the URL (back button)', async () => {
    let navigate!: ReturnType<typeof useNavigate>;
    function Nav() { navigate = useNavigate(); return null; }
    render(
      <MemoryRouter initialEntries={['/analytics']}>
        <AnalyticsDashboardPage />
        <Nav />
        <LocationProbe />
      </MemoryRouter>,
    );
    const silent = await screen.findByText('Silent');
    fireEvent.click(silent.closest('button') ?? silent);
    await screen.findByText(/Outcome: Silent/);
    act(() => navigate('/analytics'));
    await screen.findByText('Outcome breakdown');
    act(() => navigate('/analytics?tab=executions'));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('tab=executions'));
    await waitFor(() => {
      const last = mocks.analytics.api.getGroupedPaginatedExecutions.mock.calls.at(-1)![0];
      expect(last).not.toHaveProperty('verdict');
    });
    expect(screen.queryByText(/Outcome: Silent/)).toBeNull();
  });
});

describe('Stage coverage card wiring', () => {
  const group = { count: 0, bundleNames: [] as string[] };
  const coverage = {
    chains: 3, chainsProtected: 2, stagesRan: 9, blocked: 2, detected: 1, through: 6, coverage: 33.33,
    singleStage: { count: 1, bundleNames: ['Chain A, with a comma'] }, depthNotTested: group, layered: { count: 1, bundleNames: ['Chain B'] }, noneCaught: { count: 1, bundleNames: ['Chain C'] },
  };

  beforeEach(() => {
    mocks.defenderFlipsTo = false;
    mocks.caps = { outcomeBreakdown: false, loaded: true, stageCoverage: true };
    mocks.analytics.reset({
      getDefenseScore: { score: 50, totalExecutions: 0, protectedCount: 0 },
      getUniqueHostnames: 0,
      getUniqueTests: 0,
      getChainDepth: null,
      getStageCoverage: coverage,
      getPaginatedExecutions: { data: [], pagination: { totalItems: 0 } },
      getCanonicalTestCount: { count: 0 },
      listAcceptances: { total: 0 },
      getGroupedPaginatedExecutions: { groups: [], pagination: { page: 1, pageSize: 25, totalGroups: 0, totalDocuments: 0, totalPages: 0, hasNext: false, hasPrevious: false } },
      getFilterOptions: {
        tests: [], techniques: [], hostnames: [], categories: [],
        threatActors: [], tags: [], errorNames: [], errorCodes: [], bundleNames: [],
      },
    });
    mocks.defender.reset({});
    mocks.crowdstrike.reset({});
  });

  it('asks for stage coverage once and shows the card', async () => {
    renderPage();
    expect(await screen.findByText('Stage coverage')).toBeInTheDocument();
    expect(screen.getByText('3 of 9 stages caught')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.analytics.api.getStageCoverage).toHaveBeenCalledTimes(1);
  });

  it('Refresh reloads stage coverage with the rest of the dashboard', async () => {
    renderPage();
    await screen.findByText('Stage coverage');
    await waitFor(() => expect(mocks.analytics.api.getChainDepth).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(mocks.analytics.api.getChainDepth).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.analytics.api.getStageCoverage).toHaveBeenCalledTimes(2));
  });

  it('neither asks nor shows the card when the backend has no stage coverage', async () => {
    mocks.caps = { outcomeBreakdown: false, loaded: true, stageCoverage: false };
    renderPage();
    await waitFor(() => expect(mocks.analytics.api.getErrorRateTrend).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.analytics.api.getStageCoverage).not.toHaveBeenCalled();
    expect(screen.queryByText('Stage coverage')).not.toBeInTheDocument();
  });

  it('keeps the rest of the dashboard when the stage coverage request fails', async () => {
    mocks.analytics.api.getStageCoverage.mockRejectedValue(new Error('404'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage();
    expect(await screen.findByText("Couldn't load stage coverage")).toBeInTheDocument();
    expect(mocks.analytics.api.getDefenseScore).toHaveBeenCalledTimes(1);
  });

  it('a row click filters All Executions to those chains, commas intact', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Rest on a single stage/ }));
    await waitFor(() =>
      expect(mocks.analytics.api.getGroupedPaginatedExecutions).toHaveBeenCalledWith(
        expect.objectContaining({ bundleNames: expect.stringContaining('Chain A') }),
      ),
    );
    const call = mocks.analytics.api.getGroupedPaginatedExecutions.mock.calls
      .map((c: unknown[]) => (c[0] as { bundleNames?: string } | undefined)?.bundleNames)
      .find((b: string | undefined) => b?.includes('Chain A'));
    // One name, with its comma escaped so the backend doesn't split it in two.
    expect(call).toBe('Chain A\\, with a comma');
  });
});

describe('Test Breadth by Host wiring', () => {
  // As the server sends it: no organization id on an agent.
  const agent = (hostname: string) => ({ id: hostname, hostname, status: 'active' });

  function renderAt(url: string) {
    return render(
      <MemoryRouter initialEntries={[url]}>
        <AnalyticsDashboardPage />
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    mocks.defenderFlipsTo = false;
    mocks.caps = { outcomeBreakdown: false, loaded: true };
    mocks.analytics.reset({
      getDefenseScore: { score: 50, totalExecutions: 0, protectedCount: 0 },
      getUniqueHostnames: 0,
      getUniqueTests: 0,
      getChainDepth: null,
      getCanonicalTestCount: { count: 2, tests: ['T1', 'T2'], days: 90 },
      getHostTestMatrix: [{ hostname: 'LAP-A', testName: 'T1', count: 3 }],
      getGroupedPaginatedExecutions: { groups: [], pagination: { page: 1, pageSize: 25, totalGroups: 0, totalDocuments: 0, totalPages: 0, hasNext: false, hasPrevious: false } },
      getFilterOptions: {
        tests: [], techniques: [], hostnames: [], categories: [],
        threatActors: [], tags: [], errorNames: [], errorCodes: [], bundleNames: [],
      },
    });
    mocks.defender.reset({ getSecureScore: null });
    mocks.crowdstrike.reset({ getZtaScore: null });
  });

  it('shows an enrolled host with no result as not tested', async () => {
    mocks.agent.reset({ listAgents: { agents: [agent('lap-a'), agent('LAP-B')], total: 2 } });
    renderAt('/analytics');
    expect(await screen.findByText(/2 hosts · 1 tested · 1 not tested · 2 tests \(90d baseline\)/)).toBeTruthy();
    expect(mocks.agent.api.listAgents).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('pages the agent list until every active agent is read', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => agent(`h-${i}`));
    const page2 = Array.from({ length: 500 }, (_, i) => agent(`h-${1000 + i}`));
    mocks.agent.api.listAgents.mockImplementation(async (p: { offset?: number }) =>
      (p?.offset ?? 0) === 0 ? { agents: page1, total: 1500 } : { agents: page2, total: 1500 });
    renderAt('/analytics');
    expect(await screen.findByText(/1,501 hosts · 1 tested · 1,500 not tested/)).toBeTruthy();
    expect(mocks.agent.api.listAgents).toHaveBeenCalledTimes(2);
    expect(mocks.agent.api.listAgents).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1000 }));
  });

  it('keeps the dashboard and says so when the agent list cannot be read', async () => {
    mocks.agent.api.listAgents.mockRejectedValue(new Error('403'));
    renderAt('/analytics');
    expect(await screen.findByText(/1 host tested · enrolled hosts unavailable/)).toBeTruthy();
    expect(mocks.analytics.api.getDefenseScore).toHaveBeenCalledTimes(1);
  });

  it('asks the server for the selected organization: its baseline and its agents', async () => {
    mocks.agent.reset({ listAgents: { agents: [agent('LAP-B')], total: 1 } });
    renderAt('/analytics?org=o1');
    expect(await screen.findByText(/2 hosts · 1 tested · 1 not tested/)).toBeTruthy();
    expect(mocks.agent.api.listAgents).toHaveBeenCalledWith(expect.objectContaining({ status: 'active', org_id: 'o1' }));
    expect(mocks.analytics.api.getCanonicalTestCount).toHaveBeenCalledWith({ org: 'o1', days: 90 });
    expect(mocks.analytics.api.getCanonicalTestCount).toHaveBeenCalledWith({ org: 'o1', days: 30 });
  });

  it('a slow answer to an earlier request never replaces a later one', async () => {
    // The first load hangs (as when the organization is switched before it answers);
    // the next one answers at once.
    const slow: Array<(v: unknown) => void> = [];
    let hang = true;
    mocks.analytics.api.getCanonicalTestCount.mockImplementation((p: { days: number }) =>
      hang
        ? new Promise((resolve) => { slow.push(resolve); })
        : Promise.resolve({ count: 2, tests: ['T1', 'T2'], days: p.days }));
    mocks.agent.api.listAgents.mockImplementation(() =>
      hang
        ? new Promise((resolve) => { slow.push(resolve); })
        : Promise.resolve({ agents: [agent('LAP-B')], total: 1 }));

    renderAt('/analytics');
    await waitFor(() => expect(slow.length).toBe(3));
    hang = false;
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(await screen.findByText(/2 hosts · 1 tested · 1 not tested · 2 tests \(90d baseline\)/)).toBeTruthy();

    // The first load's answers arrive late: four tests and three other agents.
    await act(async () => {
      for (const resolve of slow) {
        resolve({ count: 4, tests: ['T1', 'T2', 'T3', 'T4'], days: 90, agents: [agent('X1'), agent('X2'), agent('X3')], total: 3 });
      }
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByText(/2 hosts · 1 tested · 1 not tested · 2 tests \(90d baseline\)/)).toBeTruthy();
  });

  it('a failed baseline falls back to the window, never to an older baseline', async () => {
    let fail = false;
    mocks.analytics.api.getCanonicalTestCount.mockImplementation(async (p: { days: number }) => {
      if (fail) throw new Error('boom');
      return { count: 2, tests: ['T1', 'T2'], days: p.days };
    });
    renderAt('/analytics');
    expect(await screen.findByText(/2 tests \(90d baseline\)/)).toBeTruthy();
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(await screen.findByText(/1 test \(current window\)/)).toBeTruthy();
  });

  it('narrows the fleet to the hostname filter', async () => {
    mocks.agent.reset({ listAgents: { agents: [agent('LAP-B'), agent('LAP-C')], total: 2 } });
    renderAt('/analytics?hostnames=LAP-A,LAP-B');
    expect(await screen.findByText(/2 hosts · 1 tested · 1 not tested/)).toBeTruthy();
  });

  it('reads no matching result when another filter is active', async () => {
    mocks.agent.reset({ listAgents: { agents: [agent('LAP-B')], total: 1 } });
    renderAt('/analytics?tests=T1');
    expect(await screen.findByText('No matching result (1)')).toBeTruthy();
  });
});

describe('Test version filter wiring', () => {
  const emptyPage = { groups: [], pagination: { page: 1, pageSize: 25, totalGroups: 0, totalDocuments: 0, totalPages: 0, hasNext: false, hasPrevious: false } };

  beforeEach(() => {
    mocks.defenderFlipsTo = false;
    mocks.caps = { outcomeBreakdown: false, loaded: true, testVersions: true };
    mocks.analytics.reset({
      getDefenseScore: { score: 50, totalExecutions: 0, protectedCount: 0 },
      getUniqueHostnames: 0,
      getUniqueTests: 0,
      getChainDepth: null,
      getPaginatedExecutions: { data: [], pagination: { totalItems: 0 } },
      getCanonicalTestCount: { count: 0 },
      listAcceptances: { total: 0 },
      getGroupedPaginatedExecutions: emptyPage,
      getFilterOptions: {
        tests: [], techniques: [], hostnames: [], categories: [],
        threatActors: [], tags: [], errorNames: [], errorCodes: [], bundleNames: [],
      },
    });
    mocks.defender.reset({});
    mocks.crowdstrike.reset({});
  });

  function renderExecutions(search: string) {
    return render(
      <MemoryRouter initialEntries={[`/analytics?tab=executions${search}`]}>
        <AnalyticsDashboardPage />
        <LocationProbe />
      </MemoryRouter>,
    );
  }
  const lastParams = () => mocks.analytics.api.getGroupedPaginatedExecutions.mock.calls.at(-1)![0];

  it('sends versionState from the URL, shows a chip, and the chip clears it', async () => {
    renderExecutions('&versionState=older');
    await waitFor(() => expect(lastParams()).toMatchObject({ versionState: 'older' }));
    // visible with the filter bar collapsed, and counted on the Filters button
    const chip = await screen.findByRole('button', { name: 'Remove version filter: Older version' });
    expect(chip).toHaveTextContent('Version: Older version');
    expect(screen.getByRole('button', { name: /Filters/ })).toHaveTextContent('1');
    mocks.analytics.api.getGroupedPaginatedExecutions.mockClear();
    fireEvent.click(chip);
    await waitFor(() => expect(mocks.analytics.api.getGroupedPaginatedExecutions).toHaveBeenCalled());
    expect(lastParams()).not.toHaveProperty('versionState');
    expect(screen.getByTestId('loc').textContent).not.toContain('versionState');
  });

  it('the Version control sets the filter and the URL', async () => {
    renderExecutions('');
    await waitFor(() => expect(mocks.analytics.api.getGroupedPaginatedExecutions).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    fireEvent.change(await screen.findByLabelText('Version'), { target: { value: 'not_recorded' } });
    await waitFor(() => expect(lastParams()).toMatchObject({ versionState: 'not_recorded' }));
    expect(screen.getByTestId('loc').textContent).toContain('versionState=not_recorded');
  });

  it('never sends versionState, and hides the control, without the capability', async () => {
    mocks.caps = { outcomeBreakdown: false, loaded: true, testVersions: false };
    renderExecutions('&versionState=older');
    await waitFor(() => expect(mocks.analytics.api.getGroupedPaginatedExecutions).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    await screen.findByText('All Results');
    expect(screen.queryByLabelText('Version')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove version filter/ })).toBeNull();
    // the URL param is ignored: no phantom count, nothing sent
    expect(screen.getByRole('button', { name: /Filters/ })).not.toHaveTextContent('1');
    for (const [args] of mocks.analytics.api.getGroupedPaginatedExecutions.mock.calls) {
      expect(args).not.toHaveProperty('versionState');
    }
  });

  it('another tab does not count a versionState left in the URL', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics?versionState=older']}>
        <AnalyticsDashboardPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mocks.analytics.api.getDefenseScore).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /Filters/ })).not.toHaveTextContent('1');
  });

  it('drops an invalid versionState: not sent, no count, no crash', async () => {
    renderExecutions('&versionState=bogus');
    await waitFor(() => expect(mocks.analytics.api.getGroupedPaginatedExecutions).toHaveBeenCalled());
    expect(lastParams()).not.toHaveProperty('versionState');
    expect(screen.getByRole('button', { name: /Filters/ })).not.toHaveTextContent('1');
    expect(screen.queryByRole('button', { name: /Remove version filter/ })).toBeNull();
  });

  it('says why the list is empty when versions are not available (503)', async () => {
    mocks.analytics.api.getGroupedPaginatedExecutions.mockRejectedValue(new Error('Test versions are not available'));
    renderExecutions('&versionState=current');
    expect(await screen.findByRole('alert')).toHaveTextContent('Test versions are not available');
    // nothing was reset behind the user's back
    expect(screen.getByTestId('loc').textContent).toContain('versionState=current');
  });
});

describe('Executions requests: only the latest applies', () => {
  const pagination = (page = 1, totalPages = 1) => ({
    page, pageSize: 25, totalGroups: 1, totalDocuments: 1, totalPages, hasNext: page < totalPages, hasPrevious: page > 1,
  });
  const listOf = (name: string, page = 1, totalPages = 1) => ({
    groups: [{
      groupKey: name, type: 'standalone',
      representative: { test_uuid: `u-${name}`, test_name: name, hostname: 'h1', is_protected: false, org: 'o', timestamp: '2026-10-12T12:47:49Z', error_code: 101 },
      members: [], protectedCount: 0, unprotectedCount: 1, totalCount: 1,
    }],
    pagination: pagination(page, totalPages),
  });
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }
  const api = () => mocks.analytics.api.getGroupedPaginatedExecutions;

  beforeEach(() => {
    mocks.defenderFlipsTo = false;
    mocks.caps = { outcomeBreakdown: false, loaded: true, testVersions: true };
    mocks.analytics.reset({
      getDefenseScore: { score: 50, totalExecutions: 0, protectedCount: 0 },
      getUniqueHostnames: 0,
      getUniqueTests: 0,
      getChainDepth: null,
      getPaginatedExecutions: { data: [], pagination: { totalItems: 0 } },
      getCanonicalTestCount: { count: 0 },
      listAcceptances: { total: 0 },
      getGroupedPaginatedExecutions: listOf('Initial'),
      getFilterOptions: {
        tests: [], techniques: [], hostnames: [], categories: [],
        threatActors: [], tags: [], errorNames: [], errorCodes: [], bundleNames: [],
      },
    });
    mocks.defender.reset({});
    mocks.crowdstrike.reset({});
  });

  function renderExecutions(search = '') {
    return render(
      <MemoryRouter initialEntries={[`/analytics?tab=executions${search}`]}>
        <AnalyticsDashboardPage />
        <LocationProbe />
      </MemoryRouter>,
    );
  }
  const pickVersion = async (value: string) => {
    if (!screen.queryByLabelText('Version')) fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    fireEvent.change(await screen.findByLabelText('Version'), { target: { value } });
  };

  it('a slow older request that fails after a newer one succeeded does not blank the list', async () => {
    const slow = deferred<unknown>();
    api().mockImplementationOnce(() => slow.promise);
    renderExecutions('&versionState=older');
    await waitFor(() => expect(api()).toHaveBeenCalledTimes(1));
    api().mockResolvedValue(listOf('Newer list'));
    await pickVersion('current');
    expect((await screen.findAllByText('Newer list')).length).toBeGreaterThan(0);
    await act(async () => { slow.reject(new Error('Test versions are not available')); await slow.promise.catch(() => {}); });
    expect(screen.getAllByText('Newer list').length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a slow older request that succeeds after a newer one does not overwrite it', async () => {
    const slow = deferred<unknown>();
    api().mockImplementationOnce(() => slow.promise);
    renderExecutions('&versionState=older');
    await waitFor(() => expect(api()).toHaveBeenCalledTimes(1));
    api().mockResolvedValue(listOf('Newer list'));
    await pickVersion('current');
    expect((await screen.findAllByText('Newer list')).length).toBeGreaterThan(0);
    await act(async () => { slow.resolve(listOf('Stale list')); await slow.promise; });
    expect(screen.queryByText('Stale list')).toBeNull();
    expect(screen.getAllByText('Newer list').length).toBeGreaterThan(0);
  });

  it('changing the version filter from page 3 issues one request, for page 1', async () => {
    api().mockImplementation(async (p: { page?: number }) => listOf('Row', p.page ?? 1, 5));
    renderExecutions();
    const next = async (n: number) => {
      const label = await screen.findByText(`Page ${n} of 5`);
      fireEvent.click(label.nextElementSibling as HTMLElement);
    };
    await next(1);
    await next(2);
    await screen.findByText('Page 3 of 5');
    await waitFor(() => expect(api().mock.calls.at(-1)![0]).toMatchObject({ page: 3 }));
    api().mockClear();
    await pickVersion('older');
    await screen.findByText('Page 1 of 5');
    await new Promise((r) => setTimeout(r, 50));
    expect(api()).toHaveBeenCalledTimes(1);
    expect(api().mock.calls[0][0]).toMatchObject({ page: 1, versionState: 'older' });
  });

  it('an unfiltered request failure shows no alert and keeps the list', async () => {
    api().mockResolvedValueOnce(listOf('Kept list'));
    renderExecutions();
    expect((await screen.findAllByText('Kept list')).length).toBeGreaterThan(0);
    api().mockRejectedValue(new Error('boom'));
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    // any refetch: change sort through the toolbar is brittle, so change page size via the filter bar result select
    fireEvent.change(await screen.findByDisplayValue('All Results'), { target: { value: 'protected' } });
    await waitFor(() => expect(api()).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByText('Kept list').length).toBeGreaterThan(0);
  });

  it('the export fetch carries versionState only when the filter is active', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    api().mockResolvedValue(listOf('Exportable'));
    renderExecutions('&versionState=older');
    await screen.findAllByText('Exportable');
    api().mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(api()).toHaveBeenCalled());
    expect(api().mock.calls[0][0]).toMatchObject({ versionState: 'older', pageSize: expect.any(Number) });
  });

  it('the export fetch has no versionState without the filter', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    api().mockResolvedValue(listOf('Exportable'));
    renderExecutions();
    await screen.findAllByText('Exportable');
    api().mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(api()).toHaveBeenCalled());
    expect(api().mock.calls[0][0]).not.toHaveProperty('versionState');
  });
});

describe('All Executions: matrix or list', () => {
  const emptyRuns = { groups: [], pagination: { page: 1, pageSize: 25, totalGroups: 0, totalDocuments: 0, totalPages: 0, hasNext: false, hasPrevious: false } };
  const emptyMatrix = { rows: 'tests', windowLabel: '30d', hosts: [], hostCount: 0, tests: [], testCount: 0, cellsIncluded: true, truncated: false };
  const matrix = () => mocks.analytics.api.getCoverageMatrix;
  const withMatrix = (on: boolean) => {
    mocks.caps = { outcomeBreakdown: true, loaded: true, ...(on ? { coverageMatrix: true } : {}) } as typeof mocks.caps;
  };
  const renderAt = (search: string) =>
    render(
      <MemoryRouter initialEntries={[`/analytics${search}`]}>
        <AnalyticsDashboardPage />
        <LocationProbe />
      </MemoryRouter>,
    );

  beforeEach(() => {
    localStorage.clear();
    withMatrix(true);
    mocks.analytics.reset({
      getOutcomeBreakdown: { pairCount: 10, protected: 4, prevented: 2, detected: 1, silent: 3, noConclusive: 0, riskAccepted: 0, windowLabel: '30d' },
      getGroupedPaginatedExecutions: emptyRuns,
      getCoverageMatrix: emptyMatrix,
      getCoverageMatrixHosts: { rows: 'hosts', windowLabel: '30d', tests: [], testCount: 0, hosts: [], hostCount: 0, page: 1, pageSize: 25, truncated: false },
      getDefenseScore: { score: 50, totalExecutions: 0, protectedCount: 0 },
      getUniqueHostnames: 0,
      getUniqueTests: 0,
      getChainDepth: null,
      getPaginatedExecutions: { data: [], pagination: { totalItems: 0 } },
      getErrorRate: { errorRate: 0 },
      getCanonicalTestCount: { count: 0 },
      listAcceptances: { total: 0 },
      getFilterOptions: { tests: [], techniques: [], hostnames: [], categories: [], threatActors: [], tags: [], errorNames: [], errorCodes: [], bundleNames: [] },
    });
    mocks.defender.reset({ getSecureScore: null });
    mocks.crowdstrike.reset({ getZtaScore: null });
  });

  it('opens on the matrix with the tab\'s filters, where the server has it', async () => {
    renderAt('?tab=executions&hostnames=HOST-01');

    await waitFor(() => expect(matrix()).toHaveBeenCalledTimes(1));
    expect(matrix().mock.calls[0][0]).toMatchObject({ hostnames: 'HOST-01', from: expect.any(String) });
    expect(await screen.findByText('No results in this window')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Matrix' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the list alone and never asks for the matrix where the server has none', async () => {
    withMatrix(false);
    renderAt('?tab=executions');

    expect(await screen.findByText('No executions found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Matrix' })).toBeNull();
    expect(matrix()).not.toHaveBeenCalled();
  });

  it('opens a link to one run on the list, and the Matrix button drops the link\'s selection', async () => {
    renderAt('?tab=executions&expanded=some-run');

    expect(await screen.findByText('No executions found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(matrix()).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Matrix' }));

    expect(await screen.findByText('No results in this window')).toBeInTheDocument();
    expect(screen.getByTestId('loc').textContent).not.toContain('expanded');
    expect(screen.getByTestId('loc').textContent).toContain('view=matrix');
  });

  it('opens the Outcome card\'s filter on the list, and the Matrix button removes the filter', async () => {
    renderAt('');
    const silent = await screen.findByText('Silent');

    fireEvent.click(silent.closest('button') ?? silent);

    expect(await screen.findByText(/Outcome: Silent/)).toBeInTheDocument();
    expect(await screen.findByText('No executions found')).toBeInTheDocument();
    expect(matrix()).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Matrix' }));

    expect(await screen.findByText('No results in this window')).toBeInTheDocument();
    expect(screen.queryByText(/Outcome: Silent/)).toBeNull();
  });

  it('reads the matrix again on Refresh', async () => {
    renderAt('?tab=executions');
    await waitFor(() => expect(matrix()).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));

    await waitFor(() => expect(matrix()).toHaveBeenCalledTimes(2));
  });

  it('downloads the list\'s runs only while the list is shown', async () => {
    const list = mocks.analytics.api.getGroupedPaginatedExecutions;
    renderAt('?tab=executions');
    await screen.findByText('No results in this window');
    await new Promise((r) => setTimeout(r, 30));
    expect(list).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(matrix()).toHaveBeenCalledTimes(2));
    expect(list).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Matrix' }));
    await screen.findByText('No results in this window');
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(matrix()).toHaveBeenCalledTimes(4));
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('keeps "view=list" in the address when the list selects its first run as it appears', async () => {
    // The list writes `expanded=` the moment it shows; that must not undo the click that showed it.
    const run = {
      test_uuid: 'a0000000-1234-4abc-8def-000000000001', test_name: 'Solo test', hostname: 'HOST-01', org: 'org-1',
      timestamp: '2026-01-10T09:00:00.000Z', error_code: 101, is_protected: false, techniques: [],
    };
    mocks.analytics.reset({
      getGroupedPaginatedExecutions: {
        groups: [{ groupKey: 'run-1', type: 'standalone', representative: run, members: [run], protectedCount: 0, unprotectedCount: 1, totalCount: 1 }],
        pagination: { page: 1, pageSize: 25, totalGroups: 1, totalDocuments: 1, totalPages: 1, hasNext: false, hasPrevious: false },
      },
      getCoverageMatrix: emptyMatrix,
      getFilterOptions: { tests: [], techniques: [], hostnames: [], categories: [], threatActors: [], tags: [], errorNames: [], errorCodes: [], bundleNames: [] },
      lookupAcceptances: {},
    });
    renderAt('?tab=executions');
    await screen.findByText('No results in this window');

    fireEvent.click(screen.getByRole('button', { name: 'List' }));

    await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('expanded=run-1'));
    expect(screen.getByTestId('loc').textContent).toContain('view=list');
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('leaves the matrix\'s view, rows, pair and run out of the address on another tab', async () => {
    renderAt('?tab=executions&view=matrix&rows=hosts&pairTest=a0000000-1234-4abc-8def-000000000001&pairHost=org-1%7CHOST-01&run=run-2&hostnames=HOST-01');
    await waitFor(() => expect(mocks.analytics.api.getCoverageMatrixHosts).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Dashboard/ }));

    await screen.findByText('Outcome breakdown');
    const address = decodeURIComponent(screen.getByTestId('loc').textContent ?? '');
    for (const param of ['view=', 'rows=', 'pairTest=', 'pairHost=', 'run=']) expect(address).not.toContain(param);
    // The filter bar's own parameters stay: they are the dashboard's too.
    expect(address).toContain('hostnames=HOST-01');
  });

  it('keeps the archive confirmation open when the archive fails, and says why', async () => {
    withMatrix(false);
    const run = {
      test_uuid: 'a0000000-1234-4abc-8def-000000000001', test_name: 'Solo test', hostname: 'HOST-01', org: 'org-1',
      timestamp: '2026-01-10T09:00:00.000Z', error_code: 101, is_protected: false, techniques: [],
    };
    mocks.analytics.reset({
      getGroupedPaginatedExecutions: {
        groups: [{ groupKey: 'run-1', type: 'standalone', representative: run, members: [run], protectedCount: 0, unprotectedCount: 1, totalCount: 1 }],
        pagination: { page: 1, pageSize: 25, totalGroups: 1, totalDocuments: 1, totalPages: 1, hasNext: false, hasPrevious: false },
      },
      getFilterOptions: { tests: [], techniques: [], hostnames: [], categories: [], threatActors: [], tags: [], errorNames: [], errorCodes: [], bundleNames: [] },
      lookupAcceptances: {},
    });
    mocks.analytics.api.archiveExecutions.mockRejectedValue(new Error('index is read-only'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAt('?tab=executions');

    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    expect(await screen.findByRole('heading', { name: 'Archive Executions' })).toBeInTheDocument();
    const confirm = screen.getAllByRole('button', { name: 'Archive' }).at(-1)!;
    fireEvent.click(confirm);

    expect(await screen.findByText('Archive failed: index is read-only')).toBeInTheDocument();
    // Nothing was archived: the question stays, so the user can try again or cancel.
    expect(screen.getByRole('heading', { name: 'Archive Executions' })).toBeInTheDocument();
  });

  it('does not ask for the matrix on the dashboard tab', async () => {
    renderAt('');
    await screen.findByText('Outcome breakdown');

    expect(matrix()).not.toHaveBeenCalled();
  });
});
