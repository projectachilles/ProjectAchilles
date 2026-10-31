import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
    mocks.analytics.reset({
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
