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
    defenderFlipsTo: true,
    caps: { outcomeBreakdown: false, loaded: true } as { outcomeBreakdown: boolean; loaded: boolean },
  };
});

vi.mock('../../../services/api/analytics', () => ({ analyticsApi: mocks.analytics.api }));
vi.mock('../../../services/api/defender', () => ({ defenderApi: mocks.defender.api }));
vi.mock('../../../services/api/crowdstrike', () => ({ crowdstrikeApi: mocks.crowdstrike.api }));
vi.mock('../../../services/api/sentineloneAnalytics', () => ({ sentineloneAnalyticsApi: { getTechniqueOverlap: vi.fn(async () => []) } }));
vi.mock('../../../services/api/sophosAnalytics', () => ({ sophosAnalyticsApi: { getTechniqueOverlap: vi.fn(async () => []) } }));
vi.mock('../../../services/api/reports', () => ({ reportsApi: {} }));

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
  'getPaginatedExecutions',
  'getDefenseScoreByHostname',
  'getErrorRate',
  'getErrorRateTrend',
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/analytics']}>
      <AnalyticsDashboardPage />
    </MemoryRouter>,
  );
}

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
        tests: [], techniques: [], hostnames: [], categories: [], severities: [],
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
    expect(mocks.defender.api.getSecureScore).toHaveBeenCalledTimes(1);
    expect(mocks.defender.api.getSecureScoreTrend).toHaveBeenCalledTimes(1);
  });

  it('loads all filter dropdowns with one request', async () => {
    renderPage();
    await waitFor(() => expect(mocks.analytics.api.getFilterOptions).toHaveBeenCalledTimes(1));
    for (const name of [
      'getAvailableTests', 'getAvailableTechniques', 'getAvailableHostnames', 'getAvailableCategories',
      'getAvailableSeverities', 'getAvailableThreatActors', 'getAvailableTags', 'getAvailableErrorNames',
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
    await waitFor(() => expect(mocks.analytics.api.getErrorRate).toHaveBeenCalledTimes(1));
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
        tests: [], techniques: [], hostnames: [], categories: [], severities: [],
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
