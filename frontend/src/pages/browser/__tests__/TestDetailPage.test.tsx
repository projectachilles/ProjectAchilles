import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
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
// Keep the suite off the network: no /capabilities call, no fleet fetch.
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ loaded: true, testFleet: false }) }));
vi.mock('@/services/api/analytics', () => ({ analyticsApi: { getTestFleet: vi.fn().mockResolvedValue(null) } }));
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
  default: ({ uuid, build }: { uuid: string; build?: unknown }) => (
    <div data-testid="build-section" data-has-build={build ? 'yes' : 'no'}>{uuid}</div>
  ),
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
      f(`${UUID}_info.md`, 'documentation'),
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
  const nav = useNavigationType();
  return (
    <>
      <div data-testid="nav">{nav}</div>
      <div data-testid="search">{loc.search}</div>
      <div data-testid="key">{loc.key}</div>
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

  it('rewrites an unknown ?file= to the resolved file without a new history entry', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest());
    renderPage('?tab=defense&file=nope.md');
    await screen.findByTestId('file-viewer');
    await waitFor(() =>
      expect(screen.getByTestId('search').textContent).toBe(`?tab=defense&file=${UUID}_DEFENSE_GUIDANCE.md`),
    );
    // Replaced, not pushed; router state (Back target) kept.
    expect(screen.getByTestId('nav').textContent).toBe('REPLACE');
    expect(screen.getByTestId('state').textContent).toContain('/tests?category=intel-driven');
    const key = screen.getByTestId('key').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Defense Guide' }));
    expect(screen.getByTestId('key').textContent).toBe(key);
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
    const section = await screen.findByTestId('build-section');
    expect(section).toHaveTextContent(UUID);
    // The page's own build state is handed down, so the section never fetches its own.
    expect(section).toHaveAttribute('data-has-build', 'yes');
    // useBuildInfo fetches in an effect after the render commits, so the section
    // can be on screen a tick before the call: wait for it rather than assert now.
    await waitFor(() => expect(tests.getBuildInfo).toHaveBeenCalledTimes(1));
    expect(tests.getBuildInfo).toHaveBeenCalledWith(UUID);
    unmount();
    tests.getBuildInfo.mockClear();

    perms.granted = new Set(['endpoints:tasks:create']);
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Credential Dump Chain' });
    expect(screen.queryByTestId('build-section')).not.toBeInTheDocument();
    expect(screen.queryByText('Deploy')).not.toBeInTheDocument();
    // Read-only roles lack tests:builds:read, so the build route is never called.
    expect(tests.getBuildInfo).not.toHaveBeenCalled();
  });

  it('does not fetch build info for a test without source, even for builders', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest({ files: [f('README.md', 'documentation')] }));
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Credential Dump Chain' });
    expect(screen.queryByTestId('build-section')).not.toBeInTheDocument();
    expect(tests.getBuildInfo).not.toHaveBeenCalled();
  });

  it('does not add a history entry when the active tab or file is clicked again', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest());
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Credential Dump Chain' });
    const key0 = screen.getByTestId('key').textContent;
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByTestId('key').textContent).toBe(key0);

    fireEvent.click(screen.getByRole('tab', { name: 'Defense, 2 files' }));
    await screen.findByTestId('file-viewer');
    const key1 = screen.getByTestId('key').textContent;
    expect(key1).not.toBe(key0);
    fireEvent.click(screen.getByRole('tab', { name: 'Defense, 2 files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Defense Guide' }));
    expect(screen.getByTestId('key').textContent).toBe(key1);
    expect(screen.getByTestId('search').textContent).toBe('?tab=defense');

    fireEvent.click(screen.getByRole('button', { name: 'Hardening (Windows)' }));
    const key2 = screen.getByTestId('key').textContent;
    expect(key2).not.toBe(key1);
    fireEvent.click(screen.getByRole('button', { name: 'Hardening (Windows)' }));
    expect(screen.getByTestId('key').textContent).toBe(key2);
  });

  it('names tabs without the count glyph and labels the panel with the active tab', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest());
    renderPage('?tab=detection');
    await screen.findByTestId('file-viewer');
    const detection = screen.getByRole('tab', { name: 'Detection, 2 files' });
    expect(detection).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Info card' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'README' })).toBeInTheDocument();
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', detection.id);
    expect(screen.getByRole('tabpanel', { name: 'Detection, 2 files' })).toBe(panel);
    expect(detection).toHaveAttribute('aria-controls', panel.id);
  });

  it('aligns the header, tab row and tab panel in one container', async () => {
    browser.getTestDetails.mockResolvedValue(makeTest());
    renderPage();
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Credential Dump Chain' });
    const box = ['container', 'mx-auto', 'px-4'];
    expect(h1.closest('.container')).toHaveClass(...box);
    expect(screen.getByRole('tablist')).toHaveClass(...box);
    expect(screen.getByRole('tabpanel')).toHaveClass(...box);
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
