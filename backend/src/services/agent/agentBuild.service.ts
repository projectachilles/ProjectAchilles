// Agent build service: Go cross-compilation + osslsigncode signing
// Mirrors patterns from tests/buildService.ts for the agent Go source.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { TestsSettingsService } from '../tests/settings.js';
import type { AgentOS, AgentArch, AgentVersion } from '../../types/agent.js';
import { registerVersion } from './update.service.js';

const execFileAsync = promisify(execFile);

const VERSION_REGEX = /^[\w.\-]+$/;
const BUILD_TIMEOUT = 300_000; // 5 minutes

class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}

/** Run execFileAsync and convert failures into BuildError with stderr context */
async function runBuildCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeout: number },
): Promise<void> {
  try {
    await execFileAsync(cmd, args, opts);
  } catch (err: unknown) {
    const stderr = (err as { stderr?: string }).stderr || '';
    const message = (err as Error).message || 'Build command failed';
    const detail = stderr.trim() || message;
    throw new BuildError(`Command failed: ${cmd} ${args.join(' ')}\n${detail}`);
  }
}

/**
 * Keeps a git-synced agent source current. Satisfied by GitSyncService.
 */
export interface AgentSourceSync {
  /** Clone if missing, otherwise fetch and hard-reset to the tracked branch. */
  sync(): Promise<void>;
  getStatus(): { commitHash: string | null };
}

export class AgentBuildService {
  private settingsService: TestsSettingsService;
  private agentSourcePath: string;
  private sourceSync: AgentSourceSync | undefined;
  // Serializes refresh+copy: concurrent builds must not run git on the same
  // checkout, or copy files out of it while another build is pulling.
  private sourceLock: Promise<unknown> = Promise.resolve();

  /**
   * @param sourceSync When the agent source is a git clone (AGENT_REPO_URL),
   *   refresh it before every build. The clone is made once at server start,
   *   so without this an agent-only merge that did not trigger a redeploy
   *   (Render's buildFilter excludes agent/) was compiled from old code under
   *   a new version number.
   */
  constructor(settingsService: TestsSettingsService, agentSourcePath: string, sourceSync?: AgentSourceSync) {
    this.settingsService = settingsService;
    this.agentSourcePath = agentSourcePath;
    this.sourceSync = sourceSync;
  }

  /**
   * Refresh the source (if git-synced) and copy it to a fresh work dir, under
   * the source lock. Returns the work dir and the commit it was built from.
   */
  private prepareSource(): Promise<{ workDir: string; commit: string | null }> {
    const run = async () => {
      let commit: string | null = null;
      if (this.sourceSync) {
        try {
          await this.sourceSync.sync();
        } catch (err) {
          throw new BuildError(
            `Could not refresh agent source from git, refusing to build possibly stale code: ${(err as Error).message}`,
          );
        }
        commit = this.sourceSync.getStatus().commitHash;
      }

      // Copy to a writable temp directory. The source may be on a read-only
      // mount (Docker `:ro`), and `go mod tidy` needs to write go.mod/go.sum.
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-build-'));
      try {
        fs.cpSync(this.agentSourcePath, workDir, { recursive: true });
      } catch (err) {
        throw new Error(`Failed to copy agent source to temp dir: ${(err as Error).message}`);
      }
      return { workDir, commit };
    };

    const result = this.sourceLock.then(run, run);
    // Keep the chain alive past failures so one bad refresh can't wedge builds.
    this.sourceLock = result.catch(() => undefined);
    return result;
  }

  async buildAndSign(
    version: string,
    targetOs: AgentOS,
    arch: AgentArch,
  ): Promise<AgentVersion> {
    // 1. Validate inputs
    if (!VERSION_REGEX.test(version)) {
      throw new Error('Invalid version string — use alphanumeric, dots, hyphens, underscores');
    }

    // 2. Verify agent source exists
    const goModPath = path.join(this.agentSourcePath, 'go.mod');
    if (!fs.existsSync(goModPath)) {
      throw new Error(`Agent source not found: missing go.mod at ${this.agentSourcePath}`);
    }

    // 3. Refresh (if git-synced) and copy the source to a writable work dir.
    const { workDir: buildWorkDir, commit: sourceCommit } = await this.prepareSource();

    // 4. Prepare output directory
    const binDir = path.join(os.homedir(), '.projectachilles', 'binaries', `${targetOs}-${arch}`);
    fs.mkdirSync(binDir, { recursive: true });

    const ext = targetOs === 'windows' ? '.exe' : '';
    const filename = `achilles-agent-${version}${ext}`;
    const outputPath = path.join(binDir, filename);

    // Use a temp path during build to avoid partial files
    const tmpPath = outputPath + '.tmp';

    // 5. Build environment — persist Go module cache on the data disk so
    //    module downloads survive container redeploys. Build cache (compiled
    //    objects) goes to /tmp to avoid filling the persistent volume — it
    //    can grow to 600 MB+ across cross-compilation targets.
    const modCacheDir = path.join(os.homedir(), '.projectachilles', 'go-cache', 'mod');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GOOS: targetOs,
      GOARCH: arch,
      CGO_ENABLED: '0',
      GOMODCACHE: modCacheDir,
      GOCACHE: '/tmp/go-build-cache',
    };

    try {
      // 6. Download dependencies
      await runBuildCommand('go', ['mod', 'tidy'], {
        cwd: buildWorkDir,
        env,
        timeout: BUILD_TIMEOUT,
      });
      await runBuildCommand('go', ['mod', 'download'], {
        cwd: buildWorkDir,
        env,
        timeout: BUILD_TIMEOUT,
      });

      // 7. Cross-compile
      const ldflags = `-s -w -X main.version=${version}`;
      await runBuildCommand(
        'go',
        ['build', '-ldflags', ldflags, '-o', tmpPath, '.'],
        { cwd: buildWorkDir, env, timeout: BUILD_TIMEOUT },
      );

      // Move temp to final
      fs.renameSync(tmpPath, outputPath);
    } finally {
      // Clean up temp build directory
      fs.rmSync(buildWorkDir, { recursive: true, force: true });
    }

    // 8. Sign Windows binaries if active certificate exists
    let signed = false;
    if (targetOs === 'windows') {
      const activeCert = this.settingsService.getActiveCertPfxPath();
      if (!activeCert) {
        console.warn(`[agent build] ${version} ${targetOs}/${arch} is UNSIGNED — no active certificate configured`);
      }
      if (activeCert) {
        const signedPath = outputPath + '.signed';
        // L1: Pass password via temp file to avoid /proc/PID/cmdline exposure
        const passFile = path.join(binDir, '.tmp-pass');
        try {
          fs.writeFileSync(passFile, activeCert.password, { mode: 0o600 });
          await execFileAsync('osslsigncode', [
            'sign',
            '-pkcs12', activeCert.pfxPath,
            '-readpass', passFile,
            '-in', outputPath,
            '-out', signedPath,
          ], { timeout: 60_000 });

          fs.renameSync(signedPath, outputPath);
          signed = true;
        } catch (err) {
          // Signing failure is deliberately non-fatal here: the build still
          // produced a working binary. But say so loudly — a silently unsigned
          // binary is how an unsigned agent release once shipped unnoticed.
          console.warn(
            `[agent build] ${version} ${targetOs}/${arch} is UNSIGNED — osslsigncode failed: ${err instanceof Error ? err.message : err}`,
          );
          if (fs.existsSync(signedPath)) {
            fs.unlinkSync(signedPath);
          }
        } finally {
          if (fs.existsSync(passFile)) fs.unlinkSync(passFile);
        }
      }
    }

    // 9. Sign darwin binaries with ad-hoc signature via rcodesign
    if (targetOs === 'darwin') {
      try {
        await execFileAsync('rcodesign', [
          'sign',
          '--code-signature-flags', 'adhoc',
          outputPath,
        ], { timeout: 60_000 });
        signed = true;
      } catch {
        // rcodesign not installed or signing failed — continue unsigned
      }
    }

    // 10. Register in the agent versions database
    const result = registerVersion(
      version,
      targetOs,
      arch,
      outputPath,
      `Built from source (${targetOs}/${arch})${sourceCommit ? ` at ${sourceCommit.slice(0, 7)}` : ''}`,
      false, // not mandatory by default
      signed,
    );

    return result;
  }
}
