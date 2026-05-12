import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
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

vi.mock('@/services/api/browser', () => ({
  browserApi: {
    getAllTests: getAllTestsMock,
    getSyncStatus: getSyncStatusMock,
    syncTests: vi.fn(),
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

function makeTest(uuid: string, name: string, createdDate: string | undefined): TestMetadata {
  return {
    uuid,
    name,
    severity: 'medium',
    techniques: [],
    isMultiStage: false,
    stages: [],
    createdDate,
    category: 'intel-driven',
  };
}

describe('BrowserHomePage default sort', () => {
  beforeEach(() => {
    getAllTestsMock.mockReset();
    getSyncStatusMock.mockReset();
    getExecutedTestUuidsMock.mockReset();
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

  it('defaults the sort dropdown to "Created" with descending direction', async () => {
    getAllTestsMock.mockResolvedValue([
      makeTest('aaa', 'Alpha test', '2026-01-10'),
      makeTest('bbb', 'Bravo test', '2026-05-01'),
      makeTest('ccc', 'Charlie test', '2026-03-15'),
    ]);

    render(
      <MemoryRouter initialEntries={['/dashboard?tab=browse']}>
        <BrowserHomePage mode="browse" />
      </MemoryRouter>
    );

    // Wait for tests to load
    await waitFor(() => expect(getAllTestsMock).toHaveBeenCalled());
    await screen.findByText('Bravo test');

    // The sort dropdown is the only <select> whose currently-selected value is 'createdDate'
    const sortSelect = screen
      .getAllByRole('combobox')
      .find((el) => (el as HTMLSelectElement).value === 'createdDate') as HTMLSelectElement | undefined;
    expect(sortSelect).toBeDefined();
    expect(sortSelect!.value).toBe('createdDate');
    // Confirm the visible option label is "Created"
    const selectedOption = within(sortSelect!).getByRole('option', { selected: true }) as HTMLOptionElement;
    expect(selectedOption.textContent).toBe('Created');

    // Confirm the direction toggle button title reads "Descending"
    expect(screen.getByTitle('Descending')).toBeInTheDocument();
  });

  it('sorts tests newest-first by createdDate on initial render', async () => {
    getAllTestsMock.mockResolvedValue([
      makeTest('aaa', 'Alpha test', '2026-01-10'),
      makeTest('bbb', 'Bravo test', '2026-05-01'),
      makeTest('ccc', 'Charlie test', '2026-03-15'),
    ]);

    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard?tab=browse']}>
        <BrowserHomePage mode="browse" />
      </MemoryRouter>
    );

    await waitFor(() => expect(getAllTestsMock).toHaveBeenCalled());

    // Wait for all three cards to mount. Each test name appears exactly once in the
    // DOM (TestCard.tsx renders test.name in a single <h3>), so findByText is safe.
    // Avoid asserting via `container.textContent.indexOf` — concatenated text positions
    // are fragile across CI/local rendering timing and any incidental sibling text.
    const bravo = await within(container).findByText('Bravo test');
    const charlie = await within(container).findByText('Charlie test');
    const alpha = await within(container).findByText('Alpha test');

    // Sort the three title nodes by their actual DOM document position.
    const nodesInDomOrder = [alpha, bravo, charlie].slice().sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );

    // Newest-first: Bravo (2026-05-01) → Charlie (2026-03-15) → Alpha (2026-01-10)
    expect(nodesInDomOrder).toEqual([bravo, charlie, alpha]);
  });
});
