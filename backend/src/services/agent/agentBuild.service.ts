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

export class AgentBuildService {
  private settingsService: TestsSettingsService;
  private agentSourcePath: string;

  constructor(settingsService: TestsSettingsService, agentSourcePath: string) {
    this.settingsService = settingsService;
    this.agentSourcePath = agentSourcePath;
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

    // 3. Prepare output directory
    const binDir = path.join(os.homedir(), '.projectachilles', 'binaries', `${targetOs}-${arch}`);
    fs.mkdirSync(binDir, { recursive: true });

    const ext = targetOs === 'windows' ? '.exe' : '';
    const filename = `achilles-agent-${version}${ext}`;
    const outputPath = path.join(binDir, filename);

    // Use a temp path during build to avoid partial files
    const tmpPath = outputPath + '.tmp';

    // 4. Build environment
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GOOS: targetOs,
      GOARCH: arch,
      CGO_ENABLED: '0',
    };

    // 5. Download dependencies
    if (fs.existsSync(goModPath)) {
      await runBuildCommand('go', ['mod', 'tidy'], {
        cwd: this.agentSourcePath,
        env,
        timeout: BUILD_TIMEOUT,
      });
      await runBuildCommand('go', ['mod', 'download'], {
        cwd: this.agentSourcePath,
        env,
        timeout: BUILD_TIMEOUT,
      });
    }

    // 6. Cross-compile
    const ldflags = `-s -w -X main.version=${version}`;
    await runBuildCommand(
      'go',
      ['build', '-ldflags', ldflags, '-o', tmpPath, '.'],
      { cwd: this.agentSourcePath, env, timeout: BUILD_TIMEOUT },
    );

    // Move temp to final
    fs.renameSync(tmpPath, outputPath);

    // 7. Sign Windows binaries if active certificate exists
    let signed = false;
    if (targetOs === 'windows') {
      const activeCert = this.settingsService.getActiveCertPfxPath();
      if (activeCert) {
        const signedPath = outputPath + '.signed';
        try {
          await execFileAsync('osslsigncode', [
            'sign',
            '-pkcs12', activeCert.pfxPath,
            '-pass', activeCert.password,
            '-in', outputPath,
            '-out', signedPath,
          ], { timeout: 60_000 });

          fs.renameSync(signedPath, outputPath);
          signed = true;
        } catch {
          // Signing failed — continue with unsigned binary
          if (fs.existsSync(signedPath)) {
            fs.unlinkSync(signedPath);
          }
        }
      }
    }

    // 8. Register in the agent versions database
    const result = registerVersion(
      version,
      targetOs,
      arch,
      outputPath,
      `Built from source (${targetOs}/${arch})`,
      false, // not mandatory by default
      signed,
    );

    return result;
  }
}
