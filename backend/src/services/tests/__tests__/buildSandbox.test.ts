import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'util';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const existsSync = (candidate: import('fs').PathLike) => (
    candidate === '/usr/bin/bwrap' || actual.existsSync(candidate)
  );
  return { ...actual, existsSync, default: { ...actual, existsSync } };
});

const mockExecFileAsync = vi.fn<(
  cmd: string,
  args: string[],
  options: import('child_process').ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>>();
const mockExecFile = vi.fn();
(mockExecFile as unknown as Record<symbol, unknown>)[promisify.custom] = mockExecFileAsync;

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execFile: mockExecFile,
    default: { ...actual, execFile: mockExecFile },
  };
});

const fs = await import('fs');
const os = await import('os');
const path = await import('path');
const { runSandboxedBuildScript } = await import('../buildSandbox.js');

const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
let fixtureRoot: string;
let sourceRoot: string;
let testDir: string;
let destination: string;

function sandboxHostPath(args: string[], option: '--ro-bind' | '--bind', sandboxPath: string): string {
  for (let index = 0; index < args.length - 2; index += 1) {
    if (args[index] === option && args[index + 2] === sandboxPath) return args[index + 1];
  }
  throw new Error(`Missing ${option} for ${sandboxPath}`);
}

function buildOptions() {
  return {
    sourceRoot,
    testDir,
    buildCwd: sourceRoot,
    buildScriptPath: path.join(testDir, 'build_all.sh'),
    buildScriptContent: '#!/bin/bash\necho patched\n',
    target: { os: 'windows' as const, arch: 'amd64' as const },
    artifacts: [{ filename: `${UUID}.exe`, destination, required: true }],
    timeout: 300_000,
  };
}

describe('runSandboxedBuildScript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-sandbox-test-'));
    sourceRoot = path.join(fixtureRoot, 'repo');
    testDir = path.join(sourceRoot, 'tests_source', 'cyber-hygiene', UUID);
    destination = path.join(fixtureRoot, `${UUID}.exe`);
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'build_all.sh'), '#!/bin/bash\necho original\n');
  });

  afterEach(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    delete process.env.ACHILLES_SANDBOX_SECRET_TEST;
  });

  it('uses isolated namespaces and a minimal environment', async () => {
    process.env.ACHILLES_SANDBOX_SECRET_TEST = 'must-not-cross-boundary';
    mockExecFileAsync.mockImplementation(async (command, args, options) => {
      expect(command).toBe('/bin/bash');
      expect(options.env).toEqual({ PATH: '/usr/bin:/bin' });
      expect(options.uid).toBe(process.getuid() === 0 ? 65534 : process.getuid());
      expect(JSON.stringify(options.env)).not.toContain('must-not-cross-boundary');

      const bwrapIndex = args.indexOf('/usr/bin/bwrap');
      expect(bwrapIndex).toBeGreaterThan(0);
      const bwrapArgs = args.slice(bwrapIndex + 1);
      expect(bwrapArgs).toEqual(expect.arrayContaining([
        '--unshare-user',
        '--unshare-pid',
        '--unshare-net',
        '--clearenv',
        '--cap-drop',
        'ALL',
        '--tmpfs',
        '/workspace',
      ]));
      expect(bwrapArgs).not.toContain('F0_SIGN_CERT_PATH');
      expect(bwrapArgs).not.toContain('F0_SIGN_CERT_PASS_FILE');

      const stagedSource = sandboxHostPath(bwrapArgs, '--ro-bind', '/source');
      expect(fs.readFileSync(path.join(
        stagedSource,
        'tests_source',
        'cyber-hygiene',
        UUID,
        'build_all.sh',
      ), 'utf8')).toBe('#!/bin/bash\necho patched\n');

      const stagedOutput = sandboxHostPath(bwrapArgs, '--ro-bind', '/output');
      fs.writeFileSync(path.join(stagedOutput, `${UUID}.exe`), 'sandboxed-binary');
      return { stdout: '', stderr: '' };
    });

    const copied = await runSandboxedBuildScript(buildOptions());

    expect(copied).toEqual(new Set([`${UUID}.exe`]));
    expect(fs.readFileSync(destination, 'utf8')).toBe('sandboxed-binary');
  });

  it('rejects non-regular sandbox output', async () => {
    mockExecFileAsync.mockImplementation(async (_command, args) => {
      const bwrapIndex = args.indexOf('/usr/bin/bwrap');
      const bwrapArgs = args.slice(bwrapIndex + 1);
      const stagedOutput = sandboxHostPath(bwrapArgs, '--ro-bind', '/output');
      const outputPath = path.join(stagedOutput, `${UUID}.exe`);
      fs.unlinkSync(outputPath);
      fs.symlinkSync('/etc/passwd', outputPath);
      return { stdout: '', stderr: '' };
    });

    await expect(runSandboxedBuildScript(buildOptions())).rejects.toThrow(
      `Sandbox produced an invalid artifact: ${UUID}.exe`,
    );
    expect(fs.existsSync(destination)).toBe(false);
  });
});
