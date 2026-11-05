import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { TestDetails, TestFile } from '@/types/test';

const { browser, tests, perms } = vi.hoisted(() => ({
  browser: {
    getTestDetails: vi.fn(),
    getFileContent: vi.fn(),
    getAttackFlow: vi.fn(),
    getKillChain: vi.fn(),
  },
  tests: { getBuildInfo: vi.fn(), downloadBuild: vi.fn() },
  perms: { granted: new Set<string>() },
}));

vi.mock('@/services/api/browser', () => ({ browserApi: browser }));
vi.mock('@/services/api/tests', () => ({ testsApi: tests }));
vi.mock('@/hooks/useAppRole', () => ({
  useHasPermission: (...p: string[]) => p.every((x) => perms.granted.has(x)),
}));
vi.mock('@/hooks/useTestPreferences', () => ({
  useTestPreferences: () => ({ isFavorite: () => false, toggleFavorite: vi.fn(), trackView: vi.fn() }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'dark' }) }));
vi.mock('@/components/layout/ConsoleIdentity', () => ({ IdentityPill: () => null }));
vi.mock('@/components/browser/execution', () => ({
  ExecutionDrawer: ({ open }: { open: boolean }) => (open ? <div data-testid="execution-drawer" /> : null),
}));
vi.mock('@/components/browser/BuildSection', () => ({
  default: ({ uuid }: { uuid: string }) => <div data-testid="build-section">{uuid}</div>,
}));
vi.mock('@/components/browser/FileViewer', () => ({
  default: ({ file, hideTitle }: { file: { name: string; content: string }; hideTitle?: string }) => (
    <div data-testid="file-viewer" data-file={file.name} data-hide-title={hideTitle ?? ''}>{file.content}</div>
  ),
}));

const { default: TestDetailPage } = await import('../TestDetailPage');

const UUID = '7659eeba-f315-440e-9882-4aa015d68b27';

const f = (name: string, category: TestFile['category'], type: TestFile['type'] = 'markdown'): TestFile =>
  ({ name, path: name, type, size: 1, category });

function makeTest(over: Partial<TestDetails> = {}): TestDetails {
  return {
    uuid: UUID,
    name: 'Credential Dump Chain',
    category: 'intel-driven',
    severity: 'high',
    description: 'Dumps LSASS through a five-stage chain.',
    techniques: ['T1003.001'],
    isMultiStage: true,
    stages: [1, 2, 3].map((id) => ({
      stageId: id, technique: `T100${id}`, techniques: [`T100${id}`], name: `Stage ${id} name`, fileName: `stage-T100${id}.go`,
    })),
    files: [
      f('README.md', 'documentation'),
      f(`${UUID}.go`, 'source', 'go'),
      f(`${UUID}_detections.kql`, 'detection', 'kql'),
      f(`${UUID}_rules.yar`, 'detection', 'yara'),
      f(`${UUID}_DEFENSE_GUIDANCE.md`, 'defense'),
      f(`${UUID}_hardening.ps1`, 'defense', 'powershell'),
    ],
    hasAttackFlow: false,
    hasKillChain: false,
    hasReadme: true,
    hasInfoCard: false,
    hasSafetyDoc: false,
    hasDetectionFiles: true,
    hasDefenseGuidance: true,
    hasReferences: false,
    ...over,
  } as TestDetails;
}

function Probe() {
  const loc = useLocation();
  return (
    <>
      <div data-testid="search">{loc.search}</div>
      <div data-testid="state">{JSON.stringify(loc.state ?? null)}</div>
    </>
  );
}

function renderPage(search = '', state: unknown = { backTo: '/tests?category=intel-driven' }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/tests/${UUID}`, search, state }]}>
      <Routes>
        <Route path="/tests/:uuid" element={<><TestDetailPage /><Probe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  perms.granted = new Set(['tests:builds:create', 'endpoints:tasks:create']);
  browser.getFileContent.mockImplementation(async (_u: string, name: string) => ({ name, content: `content of ${name}`, type: 'markdown' }));
  tests.getBuildInfo.mockResolvedValue({ exists: false });
});

describe('TestDetailPage', () => {
  it('opens on Overview and fetches no file', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest());
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Credential Dump Chain' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Dumps LSASS through a five-stage chain.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Stages' })).toBeInTheDocument();
    expect(screen.queryByTestId('file-viewer')).not.toBeInTheDocument();
    expect(browser.getFileContent).not.toHaveBeenCalled();
  });

  it('?tab=defense loads the first defense file and hides the repeated title', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest());
    renderPage('?tab=defense');
    const viewer = await screen.findByTestId('file-viewer');
    expect(viewer).toHaveAttribute('data-file', `${UUID}_DEFENSE_GUIDANCE.md`);
    expect(viewer).toHaveAttribute('data-hide-title', 'Credential Dump Chain');
    expect(browser.getFileContent).toHaveBeenCalledWith(UUID, `${UUID}_DEFENSE_GUIDANCE.md`);
    expect(screen.getByRole('tab', { name: /Defense/ })).toHaveAttribute('aria-selected', 'true');
    // Multi-file tab lists its files by readable name.
    expect(screen.getByRole('button', { name: 'Defense Guide' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hardening (Windows)' })).toBeInTheDocument();
  });

  it('an unknown ?file= falls back to the first file of the tab', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest());
    renderPage('?tab=defense&file=nope.md');
    const viewer = await screen.findByTestId('file-viewer');
    expect(viewer).toHaveAttribute('data-file', `${UUID}_DEFENSE_GUIDANCE.md`);
    expect(browser.getFileContent).not.toHaveBeenCalledWith(UUID, 'nope.md');
  });

  it('picks another file of a multi-file tab through the URL', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest());
    renderPage('?tab=defense');
    await screen.findByTestId('file-viewer');
    fireEvent.click(screen.getByRole('button', { name: 'Hardening (Windows)' }));
    await waitFor(() =>
      expect(screen.getByTestId('file-viewer')).toHaveAttribute('data-file', `${UUID}_hardening.ps1`),
    );
    expect(screen.getByTestId('search').textContent).toBe(`?tab=defense&file=${UUID}_hardening.ps1`);
  });

  it('renders header and Overview summary without a stage chain for a Go-only test', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest({
      isMultiStage: false,
      stages: [],
      files: [f(`${UUID}.go`, 'source', 'go')],
      hasReadme: false,
      hasDetectionFiles: false,
      hasDefenseGuidance: false,
    }));
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Credential Dump Chain' })).toBeInTheDocument();
    expect(screen.getByText('Dumps LSASS through a five-stage chain.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Stages' })).not.toBeInTheDocument();
    expect(screen.queryByText('Ships with')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Source/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /README/ })).not.toBeInTheDocument();
  });

  it('a Ships with chip opens that tab and file, keeping the Back target', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest());
    renderPage();
    await screen.findByText('Ships with');
    const panel = screen.getByText('Ships with').closest('section')!;
    fireEvent.click(within(panel).getByRole('button', { name: 'YARA' }));
    expect(screen.getByTestId('search').textContent).toBe(`?tab=detection&file=${UUID}_rules.yar`);
    expect(await screen.findByTestId('file-viewer')).toHaveAttribute('data-file', `${UUID}_rules.yar`);
    expect(screen.getByRole('tab', { name: /Detection/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('state').textContent).toContain('/tests?category=intel-driven');
    expect(screen.getByRole('link', { name: 'Tests' })).toHaveAttribute('href', '/tests?category=intel-driven');
  });

  it('keeps the header after switching tabs (no compact mode)', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest());
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Credential Dump Chain' });
    fireEvent.click(screen.getByRole('tab', { name: /README/ }));
    await screen.findByTestId('file-viewer');
    expect(screen.getByRole('heading', { level: 1, name: 'Credential Dump Chain' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run on agents/ })).toBeInTheDocument();
    expect(screen.queryByText('Exit')).not.toBeInTheDocument();
    expect(screen.getByTestId('search').textContent).toBe('?tab=readme');
    fireEvent.click(screen.getByRole('tab', { name: /Overview/ }));
    expect(screen.getByTestId('search').textContent).toBe('');
    expect(screen.getByRole('heading', { level: 1, name: 'Credential Dump Chain' })).toBeInTheDocument();
  });

  it('shows the Deploy panel only with build permission and source files', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest());
    const { unmount } = renderPage();
    expect(await screen.findByTestId('build-section')).toHaveTextContent(UUID);
    unmount();

    perms.granted = new Set(['endpoints:tasks:create']);
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Credential Dump Chain' });
    expect(screen.queryByTestId('build-section')).not.toBeInTheDocument();
    expect(screen.queryByText('Deploy')).not.toBeInTheDocument();
  });

  it('shows Download in the header once the shared build state has a build', async () => {
    tests.getBuildInfo.mockResolvedValue({ exists: true, filename: 'x.exe' });
    browser.getTestDetails.mockResolvedValue(makeTest());
    renderPage();
    expect(await screen.findByRole('button', { name: /Download/ })).toBeInTheDocument();
    expect(tests.getBuildInfo).toHaveBeenCalledTimes(1);
  });

  it('opens the execution drawer from Run on agents', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest());
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Run on agents/ }));
    expect(screen.getByTestId('execution-drawer')).toBeInTheDocument();
  });

  it('loads the kill chain into a sandboxed iframe on its tab', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest({ hasKillChain: true }));
    browser.getKillChain.mockResolvedValue('<html><body><p>chain</p></body></html>');
    renderPage('?tab=kill-chain');
    const frame = await screen.findByTitle('Kill Chain Diagram');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(browser.getKillChain).toHaveBeenCalledWith(UUID);
  });

  it('fetches a diagram once across tab switches and reports a failed load', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest({ hasAttackFlow: true }));
    browser.getAttackFlow.mockRejectedValue(new Error('boom'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage('?tab=attack-flow');
    expect(await screen.findByText('The diagram could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Overview/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Attack flow/ }));
    expect(screen.getByText('The diagram could not be loaded.')).toBeInTheDocument();
    expect(browser.getAttackFlow).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });
});
