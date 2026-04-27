import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BrowseAllPage from '../BrowseAllPage';
import type { TestMetadata } from '@/types/test';

vi.mock('@/services/api/browser', () => ({
  browserApi: {
    getAllTests: vi.fn(),
    getTestDetails: vi.fn(),
    getTestFiles: vi.fn(),
    getFileContent: vi.fn(),
  },
}));

vi.mock('@/hooks/useTestPreferences', () => ({
  useTestPreferences: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
    favorites: new Set(),
    recentTests: [],
    trackView: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAppRole', () => ({
  useHasPermission: () => true,
}));

// ExecutionDrawer pulls in axios and Clerk-driven hooks; stub it out entirely
// so this smoke test stays focused on the catalog UI.
vi.mock('@/components/browser/execution', () => ({
  ExecutionDrawer: () => null,
}));

import { browserApi } from '@/services/api/browser';

const fixtureTests: TestMetadata[] = [
  {
    uuid: 'aaaaaaaa-1111-1111-1111-111111111111',
    name: 'Defender Tamper Bypass',
    category: 'cyber-hygiene',
    severity: 'critical',
    techniques: ['T1562', 'T1059', 'T1003'],
    isMultiStage: false,
    stages: [],
    score: 9.4,
    lastModifiedDate: new Date(Date.now() - 10 * 60_000).toISOString(),
  },
  {
    uuid: 'bbbbbbbb-2222-2222-2222-222222222222',
    name: 'Volt Typhoon Living-off-the-Land',
    category: 'intel-driven',
    severity: 'high',
    techniques: ['T1059'],
    isMultiStage: true,
    stages: [],
    score: 8.1,
    lastModifiedDate: new Date(Date.now() - 86_400_000).toISOString(),
  },
  {
    uuid: 'cccccccc-3333-3333-3333-333333333333',
    name: 'Quiet recon probe',
    category: 'cyber-hygiene',
    severity: 'low',
    techniques: ['T1018'],
    isMultiStage: false,
    stages: [],
    score: 4.2,
    lastModifiedDate: new Date(Date.now() - 7 * 86_400_000).toISOString(),
  },
];

beforeEach(() => {
  vi.mocked(browserApi.getAllTests).mockResolvedValue(fixtureTests);
});

function renderWithRouter(initialEntries = ['/browser']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <BrowseAllPage />
    </MemoryRouter>
  );
}

describe('BrowseAllPage', () => {
  it('renders the page header and the dense table once the catalog loads', async () => {
    renderWithRouter();

    expect(screen.getByText('Tests')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Defender Tamper Bypass')).toBeInTheDocument();
    });

    expect(screen.getByText('Volt Typhoon Living-off-the-Land')).toBeInTheDocument();
    expect(screen.getByText('Quiet recon probe')).toBeInTheDocument();
    expect(screen.getByText('3 of 3 tests')).toBeInTheDocument();

    // Column headers
    expect(screen.getByRole('columnheader', { name: /^Techniques$/ })).toBeInTheDocument();
  });

  it('filters by severity chip and updates the URL', async () => {
    renderWithRouter();
    await waitFor(() => screen.getByText('Defender Tamper Bypass'));

    const criticalChip = screen.getByRole('button', { name: /critical/i });
    fireEvent.click(criticalChip);

    await waitFor(() => {
      expect(screen.getByText('Defender Tamper Bypass')).toBeInTheDocument();
      expect(screen.queryByText('Quiet recon probe')).not.toBeInTheDocument();
      expect(screen.queryByText('Volt Typhoon Living-off-the-Land')).not.toBeInTheDocument();
    });

    expect(screen.getByText('1 of 3 tests')).toBeInTheDocument();
  });

  it('hydrates filters from the URL on mount', async () => {
    renderWithRouter(['/browser?sev=high&q=volt']);

    await waitFor(() => {
      expect(screen.getByText('Volt Typhoon Living-off-the-Land')).toBeInTheDocument();
    });
    expect(screen.queryByText('Defender Tamper Bypass')).not.toBeInTheDocument();
    expect(screen.queryByText('Quiet recon probe')).not.toBeInTheDocument();

    const search = screen.getByPlaceholderText(/Search by name, UUID/i) as HTMLInputElement;
    expect(search.value).toBe('volt');

    const highChip = screen.getByRole('button', { name: /^high$/i });
    expect(highChip).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the empty state and reset button when no tests match', async () => {
    renderWithRouter(['/browser?q=zzzznomatch']);
    await waitFor(() => {
      expect(screen.getByText('No tests match these filters')).toBeInTheDocument();
    });

    const resetBtns = screen.getAllByRole('button', { name: /reset/i });
    expect(resetBtns.length).toBeGreaterThan(0);
  });

  it('renders a loading state until tests resolve', async () => {
    let resolveTests: (value: TestMetadata[]) => void = () => undefined;
    vi.mocked(browserApi.getAllTests).mockReturnValueOnce(
      new Promise<TestMetadata[]>((r) => {
        resolveTests = r;
      })
    );

    renderWithRouter();
    expect(screen.getByText(/Loading security tests/i)).toBeInTheDocument();

    resolveTests(fixtureTests);
    await waitFor(() => screen.getByText('Defender Tamper Bypass'));
  });
});
