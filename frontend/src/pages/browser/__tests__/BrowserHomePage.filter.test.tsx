import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TestMetadata } from '@/types/test';

// jsdom in this Vitest version doesn't always expose localStorage methods;
// BrowserHomePage reads localStorage during initial render, so we install a
// minimal in-memory shim before any module is evaluated.
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    },
  });
});

// Mock APIs used by BrowserHomePage on mount
const getAllTestsMock = vi.hoisted(() => vi.fn());
const getSyncStatusMock = vi.hoisted(() => vi.fn());
const getExecutedTestUuidsMock = vi.hoisted(() => vi.fn());
const getBuiltTestUuidsMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/browser', () => ({
  browserApi: {
    getAllTests: getAllTestsMock,
    getSyncStatus: getSyncStatusMock,
    syncTests: vi.fn(),
    getBuiltTestUuids: getBuiltTestUuidsMock,
  },
}));

vi.mock('@/services/api/analytics', () => ({
  analyticsApi: {
    getExecutedTestUuids: getExecutedTestUuidsMock,
  },
}));

vi.mock('@/hooks/useTestPreferences', () => ({
  useTestPreferences: () => ({
    favorites: new Set<string>(),
    recentTests: [],
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAppRole', () => ({
  useHasPermission: () => false,
}));

vi.mock('@/hooks/useAnalyticsAuth', () => ({
  useAnalyticsAuth: () => ({ configured: false }),
}));

// ExecutionDrawer pulls in toast / auth context — stub it to keep the test tree light.
vi.mock('@/components/browser/execution', () => ({
  ExecutionDrawer: () => null,
}));

import BrowserHomePage from '../BrowserHomePage';

const BUILT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UNBUILT_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeTest(uuid: string, name: string): TestMetadata {
  return {
    uuid,
    name,
    severity: 'medium',
    techniques: [],
    isMultiStage: false,
    stages: [],
    createdDate: '2026-05-01',
    category: 'intel-driven',
  };
}

describe('BrowserHomePage "Has binary" filter', () => {
  beforeEach(() => {
    getAllTestsMock.mockReset();
    getSyncStatusMock.mockReset();
    getExecutedTestUuidsMock.mockReset();
    getBuiltTestUuidsMock.mockReset();
    getSyncStatusMock.mockResolvedValue({
      lastSyncTime: null,
      commitHash: null,
      branch: 'main',
      status: 'never_synced',
    });
    getExecutedTestUuidsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('filters the grid to only tests with a binary when the toggle is on', async () => {
    getAllTestsMock.mockResolvedValue([
      makeTest(BUILT_UUID, 'Built test'),
      makeTest(UNBUILT_UUID, 'Unbuilt test'),
    ]);
    getBuiltTestUuidsMock.mockResolvedValue([BUILT_UUID]);

    render(
      <MemoryRouter initialEntries={['/dashboard?tab=browse']}>
        <BrowserHomePage mode="browse" />
      </MemoryRouter>
    );

    // Both cards visible before the filter is applied
    await screen.findByText('Built test');
    await screen.findByText('Unbuilt test');

    // Flip the "Has binary" toggle on
    const toggle = await screen.findByLabelText('Has binary');
    fireEvent.click(toggle);

    // The test without a binary is filtered out; the built one remains
    await waitFor(() => {
      expect(screen.queryByText('Unbuilt test')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Built test')).toBeInTheDocument();
  });

  it('does not render the toggle when the builds endpoint fails (e.g. serverless)', async () => {
    getAllTestsMock.mockResolvedValue([makeTest(BUILT_UUID, 'Built test')]);
    getBuiltTestUuidsMock.mockRejectedValue(new Error('404 Not Found'));

    render(
      <MemoryRouter initialEntries={['/dashboard?tab=browse']}>
        <BrowserHomePage mode="browse" />
      </MemoryRouter>
    );

    await screen.findByText('Built test');
    // The failing builds fetch must actually have been invoked — this proves
    // we are exercising the rejection path, not just observing initial state.
    await waitFor(() => expect(getBuiltTestUuidsMock).toHaveBeenCalled());
    // The toggle stays absent because the rejection leaves builtUuids null.
    await waitFor(() => {
      expect(screen.queryByLabelText('Has binary')).not.toBeInTheDocument();
    });
  });
});
