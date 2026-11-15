// Isolation boundary for repository-controlled build_all.sh scripts.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PlatformSettings } from '../../types/tests.js';
import { describeCommandFailure } from '../shared/commandFailure.js';

const execFileAsync = promisify(execFile);

const BWRAP_PATH = '/usr/bin/bwrap';
const SANDBOX_PATH = '/usr/local/go/bin:/usr/bin:/bin';
const WORKSPACE_BYTES = 1024 * 1024 * 1024;
const TMP_BYTES = 256 * 1024 * 1024;

const RESOURCE_LIMIT_WRAPPER = `
set -e
ulimit -c 0
ulimit -t 300
ulimit -n 256
ulimit -u 256
ulimit -f 262144
ulimit -v 4194304
exec "$@"
`;

const SANDBOX_BUILD_WRAPPER = `
set -euo pipefail
mkdir -p /workspace/repo /tmp/home /tmp/go-build /tmp/go-mod
cp -a -- /source/. /workspace/repo/
build_cwd=$1
build_script=$2
shift 2
cd "$build_cwd"
/bin/bash "$build_script"

# The output directory is read-only and contains only individually mounted,
# bounded artifact files. Truncate each before copying an expected result so
# direct writes by the untrusted script are never accepted.
while (( $# > 0 )); do
  output_name=$1
  candidate_one=$2
  candidate_two=$3
  candidate_three=$4
  fallback_one=$5
  fallback_two=$6
  shift 6
  : > "/output/$output_name"
  copied=false
  for candidate in "$candidate_one" "$candidate_two" "$candidate_three"; do
    if [[ -f "$candidate" && ! -L "$candidate" ]]; then
      cp -- "$candidate" "/output/$output_name"
      copied=true
      break
    fi
  done
  if [[ "$copied" == false ]]; then
    for fallback_dir in "$fallback_one" "$fallback_two"; do
      if [[ -d "$fallback_dir" ]]; then
        for candidate in "$fallback_dir"/*; do
          if [[ -f "$candidate" && ! -L "$candidate" ]]; then
            cp -- "$candidate" "/output/$output_name"
            copied=true
            break
          fi
        done
      fi
      [[ "$copied" == true ]] && break
    done
  fi
done
`;

export interface SandboxedBuildArtifact {
  filename: string;
  destination: string;
  required: boolean;
}

export interface SandboxedBuildOptions {
  sourceRoot: string;
  testDir: string;
  buildCwd: string;
  buildScriptPath: string;
  buildScriptContent: string;
  target: PlatformSettings;
  artifacts: SandboxedBuildArtifact[];
  timeout: number;
  nice?: string;
}

function relativeInside(root: string, candidate: string, label: string): string {
  const relative = path.relative(root, candidate);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must be inside the sandbox source root`);
  }
  return relative;
}

function sandboxIdentity(): { uid: number; gid: number } {
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
  const gid = typeof process.getgid === 'function' ? process.getgid() : -1;
  if (uid < 0 || gid < 0) {
    throw new Error('Sandboxed builds require POSIX user identities');
  }
  // The production container starts as root. Drop before bubblewrap starts so
  // even a namespace or bubblewrap failure never executes repository code with
  // the backend's host identity.
  return uid === 0 ? { uid: 65534, gid: 65534 } : { uid, gid };
}

function chownTree(root: string, uid: number, gid: number): void {
  const stat = fs.lstatSync(root);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      chownTree(path.join(root, entry.name), uid, gid);
    }
  }
  fs.lchownSync(root, uid, gid);
}

function addReadOnlyBind(args: string[], hostPath: string): void {
  if (fs.existsSync(hostPath)) {
    args.push('--ro-bind', hostPath, hostPath);
  }
}

/**
 * Execute an untrusted repository build script in a disposable Linux sandbox.
 * Only validated, expected artifacts are copied back into the trusted build
 * directory. The caller performs any code signing after this function returns.
 */
export async function runSandboxedBuildScript(options: SandboxedBuildOptions): Promise<Set<string>> {
  if (process.platform !== 'linux') {
    throw new Error('Repository build scripts require the Linux build sandbox');
  }
  if (!fs.existsSync(BWRAP_PATH)) {
    throw new Error(`Repository build sandbox is unavailable: ${BWRAP_PATH} is not installed`);
  }

  const sourceRoot = path.resolve(options.sourceRoot);
  const relativeTestDir = relativeInside(sourceRoot, path.resolve(options.testDir), 'Test directory');
  const resolvedBuildCwd = path.resolve(options.buildCwd);
  const relativeBuildCwd = resolvedBuildCwd === sourceRoot
    ? '.'
    : relativeInside(sourceRoot, resolvedBuildCwd, 'Build working directory');
  const relativeBuildScript = relativeInside(
    sourceRoot,
    path.resolve(options.buildScriptPath),
    'Build script',
  );

  for (const artifact of options.artifacts) {
    if (path.basename(artifact.filename) !== artifact.filename) {
      throw new Error(`Invalid build artifact filename: ${artifact.filename}`);
    }
  }

  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-build-'));
  const stagedSource = path.join(runtimeDir, 'source');
  const stagedOutput = path.join(runtimeDir, 'output');

  try {
    fs.cpSync(sourceRoot, stagedSource, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      filter: (source) => {
        const relative = path.relative(sourceRoot, source);
        const first = relative.split(path.sep)[0];
        return first !== '.git' && first !== 'build';
      },
    });
    fs.mkdirSync(stagedOutput, { mode: 0o700 });
    for (const artifact of options.artifacts) {
      fs.writeFileSync(path.join(stagedOutput, artifact.filename), Buffer.alloc(0), { mode: 0o600 });
    }

    // Use the exact script bytes inspected by BuildService. Refuse a staged
    // symlink so this write cannot follow a repository-controlled link.
    const stagedScript = path.join(stagedSource, relativeBuildScript);
    const stagedScriptStat = fs.lstatSync(stagedScript);
    if (!stagedScriptStat.isFile() || stagedScriptStat.isSymbolicLink()) {
      throw new Error('build_all.sh must be a regular file');
    }
    fs.writeFileSync(stagedScript, options.buildScriptContent, { mode: 0o755 });

    const identity = sandboxIdentity();
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      chownTree(runtimeDir, identity.uid, identity.gid);
    }

    const sandboxTestDir = path.posix.join('/workspace/repo', ...relativeTestDir.split(path.sep));
    const sandboxBuildCwd = relativeBuildCwd === '.'
      ? '/workspace/repo'
      : path.posix.join('/workspace/repo', ...relativeBuildCwd.split(path.sep));
    const sandboxBuildScript = path.posix.join('/workspace/repo', ...relativeBuildScript.split(path.sep));

    const bwrapArgs = [
      '--die-with-parent',
      '--new-session',
      '--unshare-user',
      '--unshare-pid',
      '--unshare-net',
      '--unshare-ipc',
      '--unshare-uts',
      '--unshare-cgroup-try',
      '--cap-drop', 'ALL',
      '--clearenv',
    ];

    // Mount only toolchain/runtime files. In particular, the host root, home,
    // backend state, process environment, and signing material are absent.
    for (const hostPath of [
      '/bin',
      '/lib',
      '/lib64',
      '/usr/bin',
      '/usr/lib',
      '/usr/lib64',
      '/usr/share',
      '/usr/local/go',
      '/etc/alternatives',
      '/etc/ld.so.cache',
      '/etc/java',
    ]) {
      addReadOnlyBind(bwrapArgs, hostPath);
    }

    bwrapArgs.push(
      '--proc', '/proc',
      '--dev', '/dev',
      '--ro-bind', stagedSource, '/source',
      '--ro-bind', stagedOutput, '/output',
      '--size', String(WORKSPACE_BYTES),
      '--tmpfs', '/workspace',
      '--size', String(TMP_BYTES),
      '--tmpfs', '/tmp',
      '--setenv', 'PATH', SANDBOX_PATH,
      '--setenv', 'HOME', '/tmp/home',
      '--setenv', 'TMPDIR', '/tmp',
      '--setenv', 'LANG', 'C.UTF-8',
      '--setenv', 'LC_ALL', 'C.UTF-8',
      '--setenv', 'GOOS', options.target.os,
      '--setenv', 'GOARCH', options.target.arch,
      '--setenv', 'CGO_ENABLED', '0',
      '--setenv', 'GOCACHE', '/tmp/go-build',
      '--setenv', 'GOMODCACHE', '/tmp/go-mod',
      '--setenv', 'GOPATH', '/tmp/go',
      '--setenv', 'GOTOOLCHAIN', 'local',
      '--setenv', 'GOPROXY', 'off',
      '--setenv', 'GOSUMDB', 'off',
      '--chdir', '/workspace/repo',
    );

    for (const artifact of options.artifacts) {
      bwrapArgs.push(
        '--bind',
        path.join(stagedOutput, artifact.filename),
        `/output/${artifact.filename}`,
      );
    }

    bwrapArgs.push(
      '/bin/bash', '-c', SANDBOX_BUILD_WRAPPER, 'sandbox-build',
      sandboxBuildCwd,
      sandboxBuildScript,
    );

    for (const artifact of options.artifacts) {
      const sandboxFilename = artifact.filename;
      bwrapArgs.push(
        sandboxFilename,
        path.posix.join('/workspace/repo/build', path.basename(options.testDir), sandboxFilename),
        path.posix.join(sandboxTestDir, 'build', path.basename(options.testDir), sandboxFilename),
        path.posix.join(sandboxTestDir, sandboxFilename),
        artifact.required
          ? path.posix.join('/workspace/repo/build', path.basename(options.testDir))
          : '/nonexistent',
        artifact.required
          ? path.posix.join(sandboxTestDir, 'build', path.basename(options.testDir))
          : '/nonexistent',
      );
    }

    if (options.nice !== undefined && !/^-?\d+$/.test(options.nice)) {
      throw new Error('Invalid build niceness value');
    }
    const sandboxCommand = options.nice === undefined
      ? [BWRAP_PATH, ...bwrapArgs]
      : ['/usr/bin/nice', '-n', options.nice, BWRAP_PATH, ...bwrapArgs];

    try {
      await execFileAsync('/bin/bash', [
        '-c', RESOURCE_LIMIT_WRAPPER, 'sandbox-limits', ...sandboxCommand,
      ], {
        cwd: '/',
        env: { PATH: '/usr/bin:/bin' },
        timeout: options.timeout,
        maxBuffer: 4 * 1024 * 1024,
        uid: identity.uid,
        gid: identity.gid,
      });
    } catch (error) {
      throw new Error(describeCommandFailure('sandboxed build', ['build_all.sh'], error));
    }

    const copied = new Set<string>();
    for (const artifact of options.artifacts) {
      const sandboxOutput = path.join(stagedOutput, artifact.filename);
      if (!fs.existsSync(sandboxOutput)) {
        if (artifact.required) {
          throw new Error('build_all.sh completed but output binary not found');
        }
        continue;
      }
      const stat = fs.lstatSync(sandboxOutput);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`Sandbox produced an invalid artifact: ${artifact.filename}`);
      }
      if (stat.size === 0) {
        if (artifact.required) {
          throw new Error('build_all.sh completed but output binary not found');
        }
        continue;
      }
      fs.copyFileSync(sandboxOutput, artifact.destination);
      copied.add(artifact.filename);
    }
    return copied;
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
}
