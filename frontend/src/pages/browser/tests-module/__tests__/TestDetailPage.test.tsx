import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import TestDetailPage from '../TestDetailPage';
import type { TestDetails, FileContent } from '@/types/test';

vi.mock('@/services/api/browser', () => ({
  browserApi: {
    getTestDetails: vi.fn(),
    getFileContent: vi.fn(),
  },
}));

vi.mock('@/hooks/useTestPreferences', () => ({
  useTestPreferences: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
    trackView: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAppRole', () => ({
  useHasPermission: () => true,
}));

vi.mock('@/components/browser/execution', () => ({
  ExecutionDrawer: () => null,
}));

// FileViewer transitively imports react-syntax-highlighter, which is heavy and
// has its own well-tested rendering. Stub it so the smoke test stays focused.
vi.mock('@/components/browser/FileViewer', () => ({
  default: ({ file }: { file: FileContent }) => (
    <pre data-testid="file-viewer">{file.content}</pre>
  ),
}));

import { browserApi } from '@/services/api/browser';

const fixtureTest: TestDetails = {
  uuid: 'aaaaaaaa-1111-1111-1111-111111111111',
  name: 'Defender Tamper Bypass',
  category: 'cyber-hygiene',
  severity: 'critical',
  techniques: ['T1562', 'T1059'],
  tactics: ['defense-evasion', 'execution'],
  isMultiStage: true,
  stages: [
    {
      stageId: 1,
      technique: 'T1562',
      name: 'Disable Defender',
      fileName: 'stage1-disable.go',
    },
    {
      stageId: 2,
      technique: 'T1059',
      name: 'Run payload',
      fileName: 'stage2-run.go',
    },
  ],
  score: 9.4,
  threatActor: 'AKIRA',
  author: 'James Pichardo',
  description: 'Simulates Defender tamper followed by payload execution.',
  lastModifiedDate: new Date(Date.now() - 600_000).toISOString(),
  files: [
    { name: 'README.md', path: 'README.md', type: 'markdown', size: 1024, category: 'documentation' },
    { name: 'stage1-disable.go', path: 'src/stage1-disable.go', type: 'go', size: 4096, category: 'source' },
    { name: 'detections.kql', path: 'detections.kql', type: 'kql', size: 256, category: 'detection' },
  ],
  hasAttackFlow: false,
  hasKillChain: false,
  hasReadme: true,
  hasInfoCard: false,
  hasSafetyDoc: false,
  hasDetectionFiles: true,
  hasDefenseGuidance: false,
  hasReferences: false,
};

beforeEach(() => {
  vi.mocked(browserApi.getTestDetails).mockResolvedValue(fixtureTest);
  vi.mocked(browserApi.getFileContent).mockResolvedValue({
    name: 'README.md',
    type: 'markdown',
    size: 1024,
    content: '# Defender Tamper Bypass\n\nA test fixture readme.',
  });
});

function renderAt(uuid: string) {
  return render(
    <MemoryRouter initialEntries={[`/browser/test/${uuid}`]}>
      <Routes>
        <Route path="/browser/test/:uuid" element={<TestDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TestDetailPage', () => {
  it('renders the hero strip with test metadata after load', async () => {
    renderAt(fixtureTest.uuid);

    await waitFor(() => {
      expect(screen.getByText('Defender Tamper Bypass')).toBeInTheDocument();
    });
    expect(screen.getAllByText('critical').length).toBeGreaterThan(0);
    expect(screen.getByText('cyber-hygiene')).toBeInTheDocument();
    expect(screen.getByText('9.4')).toBeInTheDocument();
    // Threat actor + author
    expect(screen.getByText('AKIRA')).toBeInTheDocument();
    expect(screen.getByText('James Pichardo')).toBeInTheDocument();
    // Both technique badges from the test fixture appear in the hero strip
    // (and may also appear inside the kill-chain step badges).
    expect(screen.getAllByText('T1562').length).toBeGreaterThan(0);
    expect(screen.getAllByText('T1059').length).toBeGreaterThan(0);
  });

  it('renders the file tree, auto-selects README, and loads its content', async () => {
    renderAt(fixtureTest.uuid);

    // README appears in the tree (and the breadcrumb echoes the active file)
    await waitFor(() => {
      expect(screen.getAllByText('README.md').length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(browserApi.getFileContent).toHaveBeenCalledWith(fixtureTest.uuid, 'README.md');
    });

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer')).toHaveTextContent('Defender Tamper Bypass');
    });
  });

  it('renders the kill-chain stage strip with declared tactics highlighted', async () => {
    renderAt(fixtureTest.uuid);

    await waitFor(() => screen.getByText('Defender Tamper Bypass'));

    // Both declared tactics appear as stage chips with their MITRE short names
    expect(screen.getByRole('tab', { name: /Def. Evasion/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Execution/i })).toBeInTheDocument();

    // The kill-chain detail shows the bucketed steps under the active stage.
    // Stages all bucket under the first declared tactic in the helper, which
    // for this fixture is "defense-evasion".
    expect(screen.getByText('Disable Defender')).toBeInTheDocument();
    expect(screen.getByText('Run payload')).toBeInTheDocument();
  });

  it('falls back to a "test not found" empty state on fetch failure', async () => {
    vi.mocked(browserApi.getTestDetails).mockRejectedValueOnce(new Error('404'));
    renderAt('missing-uuid');

    await waitFor(() => {
      expect(screen.getByText('Test not found')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Back to tests/i })).toBeInTheDocument();
  });
});
