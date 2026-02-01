// Build service: Go cross-compilation, build_all.sh execution, osslsigncode signing

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { BuildInfo, BuildMetadata, EmbedDependency } from '../../types/tests.js';
import type { TestsSettingsService } from './settings.js';

const execFileAsync = promisify(execFile);

/** Thrown when a build command fails — carries the stderr output for the user */
export class BuildError extends Error {
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
    // Combine command info with stderr for a useful error message
    const detail = stderr.trim() || message;
    throw new BuildError(`Command failed: ${cmd} ${args.join(' ')} ${detail}`);
  }
}

const SETTINGS_DIR = path.join(os.homedir(), '.projectachilles');
const BUILDS_DIR = path.join(SETTINGS_DIR, 'builds');
const CERTS_DIR = path.join(SETTINGS_DIR, 'certs');
const PFX_PATH = path.join(CERTS_DIR, 'cert.pfx');

const KNOWN_CATEGORIES = ['cyber-hygiene', 'intel-driven', 'mitre-top10', 'phase-aligned'];

const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const BUILD_TIMEOUT = 300_000; // 5 minutes

export class BuildService {
  private settingsService: TestsSettingsService;
  private testsSourcePath: string;

  constructor(settingsService: TestsSettingsService, testsSourcePath: string) {
    this.settingsService = settingsService;
    this.testsSourcePath = testsSourcePath;
  }

  /** Locate the test directory for a UUID within the tests source tree */
  private findTestDir(uuid: string): string | null {
    // Try category/<uuid> first
    for (const cat of KNOWN_CATEGORIES) {
      const dir = path.join(this.testsSourcePath, cat, uuid);
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        return dir;
      }
    }
    // Try flat <uuid>
    const flat = path.join(this.testsSourcePath, uuid);
    if (fs.existsSync(flat) && fs.statSync(flat).isDirectory()) {
      return flat;
    }
    return null;
  }

  private ensureBuildDir(uuid: string): string {
    const dir = path.join(BUILDS_DIR, uuid);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private metaPath(uuid: string): string {
    return path.join(BUILDS_DIR, uuid, 'build-meta.json');
  }

  // ── Public API ────────────────────────────────────────────

  getBuildInfo(uuid: string): BuildInfo {
    const metaFile = this.metaPath(uuid);
    if (!fs.existsSync(metaFile)) {
      return { exists: false };
    }
    try {
      const meta: BuildMetadata = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      const binaryPath = path.join(BUILDS_DIR, uuid, meta.filename);
      if (!fs.existsSync(binaryPath)) {
        return { exists: false };
      }
      return {
        exists: true,
        platform: meta.platform,
        signed: meta.signed,
        fileSize: meta.fileSize,
        builtAt: meta.builtAt,
        filename: meta.filename,
      };
    } catch {
      return { exists: false };
    }
  }

  getBinaryPath(uuid: string): string | null {
    const metaFile = this.metaPath(uuid);
    if (!fs.existsSync(metaFile)) return null;
    try {
      const meta: BuildMetadata = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      const binaryPath = path.join(BUILDS_DIR, uuid, meta.filename);
      return fs.existsSync(binaryPath) ? binaryPath : null;
    } catch {
      return null;
    }
  }

  deleteBuild(uuid: string): void {
    const buildDir = path.join(BUILDS_DIR, uuid);
    if (fs.existsSync(buildDir)) {
      fs.rmSync(buildDir, { recursive: true, force: true });
    }
  }

  getEmbedDependencies(uuid: string): EmbedDependency[] {
    const testDir = this.findTestDir(uuid);
    if (!testDir) return [];

    const deps: EmbedDependency[] = [];
    const goFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.go'));
    const embedRegex = /\/\/go:embed\s+(\S+)/g;

    for (const goFile of goFiles) {
      const content = fs.readFileSync(path.join(testDir, goFile), 'utf8');
      let match;
      while ((match = embedRegex.exec(content)) !== null) {
        const filename = match[1];
        // Skip .go and .ps1 files — those are source that build_all.sh handles
        if (filename.endsWith('.go') || filename.endsWith('.ps1')) continue;
        const exists = fs.existsSync(path.join(testDir, filename));
        deps.push({ filename, sourceFile: goFile, exists });
      }
    }

    return deps;
  }

  saveUploadedFile(uuid: string, filename: string, buffer: Buffer): void {
    const testDir = this.findTestDir(uuid);
    if (!testDir) {
      throw new Error('Test directory not found');
    }

    // Path traversal protection: only allow bare filenames
    const baseName = path.basename(filename);
    if (baseName !== filename || filename.includes('..')) {
      throw new Error('Invalid filename');
    }

    fs.writeFileSync(path.join(testDir, baseName), buffer);
  }

  async buildAndSign(uuid: string): Promise<BuildInfo> {
    if (!UUID_REGEX.test(uuid)) {
      throw new Error('Invalid UUID format');
    }

    // 1. Get platform settings
    const platform = this.settingsService.getPlatformSettings();

    // 2. Find test directory
    const testDir = this.findTestDir(uuid);
    if (!testDir) {
      throw new Error('Test directory not found');
    }

    // 3. Determine output filename
    const filename = platform.os === 'windows' ? `${uuid}.exe` : uuid;

    // 4. Ensure build output directory
    const buildDir = this.ensureBuildDir(uuid);
    const outputPath = path.join(buildDir, filename);

    // 5. Build environment
    const env = {
      ...process.env,
      GOOS: platform.os,
      GOARCH: platform.arch,
      CGO_ENABLED: '0',
    };

    // 6. Build
    const buildAllPath = path.join(testDir, 'build_all.sh');
    const hasBuildScript = fs.existsSync(buildAllPath);

    if (hasBuildScript) {
      // Execute build_all.sh — uses execFile with array args (no shell injection)
      await runBuildCommand('bash', ['build_all.sh'], {
        cwd: testDir,
        env,
        timeout: BUILD_TIMEOUT,
      });

      // Locate output binary
      const candidates = [
        path.join(testDir, 'build', uuid, filename),
        path.join(testDir, filename),
      ];
      let found = false;
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          fs.copyFileSync(candidate, outputPath);
          found = true;
          break;
        }
      }
      if (!found) {
        // Try to find any file in build/<uuid>/
        const buildSubdir = path.join(testDir, 'build', uuid);
        if (fs.existsSync(buildSubdir)) {
          const files = fs.readdirSync(buildSubdir);
          if (files.length > 0) {
            fs.copyFileSync(path.join(buildSubdir, files[0]), outputPath);
            found = true;
          }
        }
      }
      if (!found) {
        throw new Error('build_all.sh completed but output binary not found');
      }
    } else {
      // Standard Go build
      if (fs.existsSync(path.join(testDir, 'go.mod'))) {
        await runBuildCommand('go', ['mod', 'tidy'], { cwd: testDir, env, timeout: BUILD_TIMEOUT });
        await runBuildCommand('go', ['mod', 'download'], { cwd: testDir, env, timeout: BUILD_TIMEOUT });
      }

      const goFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.go'));
      if (goFiles.length === 0) {
        throw new BuildError('No Go source files found in test directory');
      }

      // Use package mode ("go build .") for proper GOOS/GOARCH constraint evaluation.
      // File-list mode ("go build a.go b.go") doesn't resolve cross-platform build tags
      // on transitive dependencies, causing failures for windows-only imports on Linux.
      await runBuildCommand('go', ['build', '-o', outputPath, '.'], {
        cwd: testDir,
        env,
        timeout: BUILD_TIMEOUT,
      });
    }

    // 7. Sign if certificate exists
    let signed = false;
    const password = this.settingsService.getCertificatePassword();
    if (password && fs.existsSync(PFX_PATH)) {
      const signedPath = outputPath + '.signed';
      try {
        await execFileAsync('osslsigncode', [
          'sign',
          '-pkcs12', PFX_PATH,
          '-pass', password,
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

    // 8. Write metadata
    const stats = fs.statSync(outputPath);
    const meta: BuildMetadata = {
      platform: { os: platform.os, arch: platform.arch },
      builtAt: new Date().toISOString(),
      signed,
      fileSize: stats.size,
      filename,
    };
    fs.writeFileSync(this.metaPath(uuid), JSON.stringify(meta, null, 2));

    return {
      exists: true,
      platform: meta.platform,
      signed: meta.signed,
      fileSize: meta.fileSize,
      builtAt: meta.builtAt,
      filename: meta.filename,
    };
  }
}
