import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { BuildInfo } from '@/types/test';

const { testsApiMock } = vi.hoisted(() => ({
  testsApiMock: {
    getBuildInfo: vi.fn(),
    getEmbedDependencies: vi.fn(),
    buildTest: vi.fn(),
    waitForBuild: vi.fn(),
    deleteBuild: vi.fn(),
    downloadBuild: vi.fn(),
    uploadEmbedFile: vi.fn(),
    uploadBinary: vi.fn(),
  },
}));

vi.mock('@/services/api/tests', () => ({ testsApi: testsApiMock }));
vi.mock('@vercel/blob/client', () => ({ put: vi.fn() }));
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({
    build: true,
    buildUpload: true,
    certGenerate: true,
    certUpload: true,
    gitSync: true,
    agentBuild: true,
    platform: 'docker',
  }),
}));

const { default: BuildSection } = await import('../BuildSection');

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUNNING = { status: 'running' as const, startedAt: '2026-10-14T00:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  testsApiMock.getEmbedDependencies.mockResolvedValue([]);
});

describe('BuildSection', () => {
  it('follows a build that is still running after a page refresh', async () => {
    testsApiMock.getBuildInfo.mockResolvedValue({ exists: false, job: RUNNING });
    let finish!: (info: BuildInfo) => void;
    testsApiMock.waitForBuild.mockImplementation(() => new Promise<BuildInfo>((resolve) => { finish = resolve; }));

    render(<BuildSection uuid={UUID_A} />);

    expect(await screen.findByText('Building...')).toBeInTheDocument();
    expect(testsApiMock.waitForBuild).toHaveBeenCalledWith(UUID_A, { signal: expect.any(AbortSignal) });

    finish({
      exists: true,
      platform: { os: 'windows', arch: 'amd64' },
      signed: true,
      fileSize: 2048,
      builtAt: '2026-10-14T00:05:00.000Z',
      filename: `${UUID_A}.exe`,
      job: { ...RUNNING, status: 'succeeded' },
    });
    await waitFor(() => expect(screen.queryByText('Building...')).not.toBeInTheDocument());
  });

  it('shows the last build error after a refresh when no binary exists', async () => {
    testsApiMock.getBuildInfo.mockResolvedValue({
      exists: false,
      job: { ...RUNNING, status: 'failed', finishedAt: '2026-10-14T00:01:00.000Z', error: 'go build: undefined: foo' },
    });

    render(<BuildSection uuid={UUID_A} />);

    expect(await screen.findByText('go build: undefined: foo')).toBeInTheDocument();
    expect(testsApiMock.waitForBuild).not.toHaveBeenCalled();
  });

  it('does not follow a finished job', async () => {
    testsApiMock.getBuildInfo.mockResolvedValue({
      exists: true,
      filename: `${UUID_A}.exe`,
      fileSize: 2048,
      builtAt: '2026-10-14T00:05:00.000Z',
      job: { ...RUNNING, status: 'succeeded' },
    });

    render(<BuildSection uuid={UUID_A} />);

    await waitFor(() => expect(testsApiMock.getBuildInfo).toHaveBeenCalled());
    expect(screen.queryByText('Building...')).not.toBeInTheDocument();
    expect(testsApiMock.waitForBuild).not.toHaveBeenCalled();
  });

  it('stops following when the user switches to another test', async () => {
    testsApiMock.getBuildInfo.mockImplementation(async (uuid: string) =>
      uuid === UUID_A ? { exists: false, job: RUNNING } : { exists: false },
    );
    const signals: AbortSignal[] = [];
    testsApiMock.waitForBuild.mockImplementation((_uuid: string, opts: { signal: AbortSignal }) => {
      signals.push(opts.signal);
      return new Promise<BuildInfo>(() => {});
    });

    const { rerender } = render(<BuildSection uuid={UUID_A} />);
    expect(await screen.findByText('Building...')).toBeInTheDocument();

    rerender(<BuildSection uuid={UUID_B} />);

    await waitFor(() => expect(screen.queryByText('Building...')).not.toBeInTheDocument());
    expect(signals[0].aborted).toBe(true);
  });
});

describe('BuildSection with shared build state', () => {
  it('does not fetch build info itself and writes through the passed setter', async () => {
    const setBuildInfo = vi.fn();
    const build = {
      buildInfo: { exists: true, filename: 'x.exe', platform: { os: 'windows', arch: 'amd64' } } as BuildInfo,
      setBuildInfo,
      loading: false,
      download: vi.fn(),
    };
    testsApiMock.deleteBuild.mockResolvedValue(undefined);
    render(<BuildSection uuid={UUID_A} build={build} />);
    await screen.findByText('x.exe');
    expect(testsApiMock.getBuildInfo).not.toHaveBeenCalled();

    const { fireEvent } = await import('@testing-library/react');
    const del = screen.getAllByRole('button').find((b) => /delete|remove|trash/i.test(b.getAttribute('title') ?? b.textContent ?? '') ) ?? screen.getAllByRole('button').at(-1)!;
    fireEvent.click(del);
    await waitFor(() => expect(setBuildInfo).toHaveBeenCalledWith({ exists: false }));
  });
});
