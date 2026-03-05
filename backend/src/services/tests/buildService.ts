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

const KNOWN_CATEGORIES = ['cyber-hygiene', 'intel-driven', 'mitre-top10', 'phase-aligned'];

/**
 * Determine whether an embedded binary is compiled from Go source by build_all.sh.
 * Uses four heuristics in order:
 *  1. Direct match — foo.exe → foo.go
 *  2. Hyphen-to-underscore — validator-defender.exe → validator_defender.go
 *  3. UUID-prefix stage — <uuid>-T1486.exe → stage-T1486.go  (or prefix match)
 *  4. Fallback — parse build_all.sh for literal `go build -o <filename>`
 */
function isSourceBuiltBinary(
  filename: string,
  testUuid: string,
  goFileSet: Set<string>,
  buildScript: string | null,
): boolean {
  if (!buildScript) return false;

  const base = filename.replace(/\.[^.]+$/, ''); // strip extension

  // 1. Direct match: foo.exe → foo.go
  if (goFileSet.has(`${base}.go`)) return true;

  // 2. Hyphen-to-underscore: validator-defender.exe → validator_defender.go
  const underscored = base.replace(/-/g, '_');
  if (underscored !== base && goFileSet.has(`${underscored}.go`)) return true;

  // 3. UUID-prefix stage: <uuid>-suffix.exe → strip UUID, match source
  const uuidPrefix = `${testUuid}-`;
  if (filename.startsWith(uuidPrefix)) {
    const suffix = base.slice(uuidPrefix.length);
    if (goFileSet.has(`${suffix}.go`)) return true;
    if (goFileSet.has(`stage-${suffix}.go`)) return true;
    // Prefix match for numbered stages: <uuid>-stage1.exe → stage1-defense-evasion.go
    for (const goFile of goFileSet) {
      if (goFile.startsWith(`${suffix}-`)) return true;
    }
  }

  // 4. Fallback: parse build_all.sh for literal `go build -o <filename>`
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const buildPattern = new RegExp(`go\\s+build\\b.*-o\\s+(?:["'])?${escaped}(?:["'])?(?:\\s|$)`, 'm');
  if (buildPattern.test(buildScript)) return true;

  return false;
}

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
        source: meta.source,
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
    const goFileSet = new Set(goFiles);
    const embedRegex = /\/\/go:embed\s+(\S+)/g;

    // Read build_all.sh content for source-built detection
    const buildScriptPath = path.join(testDir, 'build_all.sh');
    const buildScript = fs.existsSync(buildScriptPath)
      ? fs.readFileSync(buildScriptPath, 'utf8')
      : null;

    for (const goFile of goFiles) {
      const content = fs.readFileSync(path.join(testDir, goFile), 'utf8');
      let match;
      while ((match = embedRegex.exec(content)) !== null) {
        const filename = match[1];
        // Skip .go and .ps1 files — those are source that build_all.sh handles
        if (filename.endsWith('.go') || filename.endsWith('.ps1')) continue;
        const exists = fs.existsSync(path.join(testDir, filename));
        const sourceBuilt = isSourceBuiltBinary(filename, uuid, goFileSet, buildScript);
        deps.push({ filename, sourceFile: goFile, exists, sourceBuilt });
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

    // M8: Only allow known embed dependency filenames to prevent arbitrary file writes
    const deps = this.getEmbedDependencies(uuid);
    const dep = deps.find(d => d.filename === baseName);
    if (!dep) {
      throw new Error(`Filename '${baseName}' is not a known embed dependency for this test`);
    }

    // Reject uploads for source-built dependencies — these are compiled by build_all.sh
    if (dep.sourceBuilt) {
      throw new Error(`Cannot upload '${baseName}': this binary is built from source by build_all.sh`);
    }

    fs.writeFileSync(path.join(testDir, baseName), buffer);
  }

  uploadBinary(uuid: string, buffer: Buffer): BuildInfo {
    if (!UUID_REGEX.test(uuid)) {
      throw new Error('Invalid UUID format');
    }

    if (!buffer || buffer.length === 0) {
      throw new Error('Empty file');
    }

    // Windows PE header check: first two bytes must be "MZ" (0x4D 0x5A)
    if (buffer.length < 2 || buffer[0] !== 0x4D || buffer[1] !== 0x5A) {
      throw new Error('File does not appear to be a valid Windows executable (missing MZ header)');
    }

    const platform = this.settingsService.getPlatformSettings();
    const filename = platform.os === 'windows'
      ? `${uuid}.exe`
      : uuid;
    const buildDir = this.ensureBuildDir(uuid);
    const outputPath = path.join(buildDir, filename);

    fs.writeFileSync(outputPath, buffer);

    const meta: BuildMetadata = {
      platform: { os: platform.os, arch: platform.arch },
      builtAt: new Date().toISOString(),
      signed: false,
      fileSize: buffer.length,
      filename,
      source: 'uploaded',
    };
    fs.writeFileSync(this.metaPath(uuid), JSON.stringify(meta, null, 2));

    return {
      exists: true,
      platform: meta.platform,
      signed: meta.signed,
      fileSize: meta.fileSize,
      builtAt: meta.builtAt,
      filename: meta.filename,
      source: 'uploaded',
    };
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
    const env: Record<string, string | undefined> = {
      ...process.env,
      GOOS: platform.os,
      GOARCH: platform.arch,
      CGO_ENABLED: '0',
    };

    // 6. Build
    const buildAllPath = path.join(testDir, 'build_all.sh');
    const hasBuildScript = fs.existsSync(buildAllPath);

    if (hasBuildScript) {
      // Pass active signing cert to build_all.sh so it can sign inner binaries
      // (e.g., multi-binary bundles sign validators before embedding)
      let innerPassFile: string | null = null;
      if (platform.os === 'windows') {
        const activeCert = this.settingsService.getActiveCertPfxPath();
        if (activeCert) {
          env.F0_SIGN_CERT_PATH = activeCert.pfxPath;
          innerPassFile = path.join(buildDir, '.tmp-inner-pass');
          fs.writeFileSync(innerPassFile, activeCert.password, { mode: 0o600 });
          env.F0_SIGN_CERT_PASS_FILE = innerPassFile;
        }
      }

      // Pass absolute paths so build scripts can use them regardless of cwd
      env.F0_TEST_DIR = testDir;
      env.F0_BUILD_DIR = buildDir;

      const repoRoot = path.dirname(this.testsSourcePath);

      // Some build_all.sh scripts use hardcoded relative paths:
      //   TEST_DIR="tests_source/<uuid>"  then  cd "${TEST_DIR}"
      // These expect to run from the repo root with a flat tests_source/<uuid>
      // layout, but tests actually live under tests_source/<category>/<uuid>.
      //
      // We can't use symlinks because Go resolves go.mod replace directives
      // via the physical path, breaking ../../../ references.
      //
      // Fix: run a thin wrapper that overrides TEST_DIR and BUILD_DIR so the
      // script's own `cd "${TEST_DIR}"` becomes `cd .` (a no-op) and build
      // output goes to an absolute path. For scripts using SCRIPT_DIR-based
      // absolute paths, these overrides are harmless (the scripts set their
      // own TEST_DIR after).
      const wrapperPath = path.join(buildDir, '.build-wrapper.sh');
      const wrapperContent = [
        '#!/bin/bash',
        '# Auto-generated wrapper — overrides relative paths for categorized layout',
        `export TEST_DIR="."`,
        `export BUILD_DIR="${path.join(testDir, 'build', uuid)}"`,
        `mkdir -p "\${BUILD_DIR}"`,
        `source "${path.join(testDir, 'build_all.sh')}"`,
      ].join('\n');
      fs.writeFileSync(wrapperPath, wrapperContent, { mode: 0o755 });

      try {
        await runBuildCommand('bash', [wrapperPath], {
          cwd: testDir,
          env,
          timeout: BUILD_TIMEOUT,
        });
      } finally {
        // Clean up wrapper
        if (fs.existsSync(wrapperPath)) {
          try { fs.unlinkSync(wrapperPath); } catch { /* best-effort */ }
        }
        // Clean up inner cert password file
        if (innerPassFile && fs.existsSync(innerPassFile)) {
          fs.unlinkSync(innerPassFile);
        }
      }

      // Locate output binary — scripts may output to different locations:
      //   - testDir/build/<uuid>/<file>  (SCRIPT_DIR-based scripts)
      //   - testDir/<file>               (simple scripts)
      //   - repoRoot/build/<uuid>/<file> (repo-root-relative scripts)
      const candidates = [
        path.join(testDir, 'build', uuid, filename),
        path.join(testDir, filename),
        path.join(repoRoot, 'build', uuid, filename),
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
        // Try to find any file in build/<uuid>/ under testDir or repoRoot
        for (const base of [testDir, repoRoot]) {
          const buildSubdir = path.join(base, 'build', uuid);
          if (fs.existsSync(buildSubdir)) {
            const files = fs.readdirSync(buildSubdir).filter(f => !f.startsWith('.'));
            if (files.length > 0) {
              fs.copyFileSync(path.join(buildSubdir, files[0]), outputPath);
              found = true;
              break;
            }
          }
        }
      }
      if (!found) {
        throw new Error('build_all.sh completed but output binary not found');
      }
    } else {
      // Standard Go build
      const goModPath = path.join(testDir, 'go.mod');
      const goSumPath = path.join(testDir, 'go.sum');
      const hadGoMod = fs.existsSync(goModPath);

      const goFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.go'));
      if (goFiles.length === 0) {
        throw new BuildError('No Go source files found in test directory');
      }

      try {
        if (!hadGoMod) {
          // Auto-init a temporary module so "go build ." works in package mode
          await runBuildCommand('go', ['mod', 'init', 'testbuild'], {
            cwd: testDir,
            env,
            timeout: BUILD_TIMEOUT,
          });
        }

        await runBuildCommand('go', ['mod', 'tidy'], { cwd: testDir, env, timeout: BUILD_TIMEOUT });
        await runBuildCommand('go', ['mod', 'download'], { cwd: testDir, env, timeout: BUILD_TIMEOUT });

        // Use package mode ("go build .") for proper GOOS/GOARCH constraint evaluation.
        // File-list mode ("go build a.go b.go") doesn't resolve cross-platform build tags
        // on transitive dependencies, causing failures for windows-only imports on Linux.
        await runBuildCommand('go', ['build', '-o', outputPath, '.'], {
          cwd: testDir,
          env,
          timeout: BUILD_TIMEOUT,
        });
      } finally {
        // Clean up auto-generated module files to avoid dirtying the test source tree
        if (!hadGoMod) {
          if (fs.existsSync(goModPath)) fs.unlinkSync(goModPath);
          if (fs.existsSync(goSumPath)) fs.unlinkSync(goSumPath);
        }
      }
    }

    // 7. Sign binary (Windows via osslsigncode, darwin via rcodesign ad-hoc)
    let signed = false;
    if (platform.os === 'windows') {
      const activeCert = this.settingsService.getActiveCertPfxPath();
      if (activeCert) {
        const signedPath = outputPath + '.signed';
        // L1: Pass password via temp file to avoid /proc/PID/cmdline exposure
        const passFile = path.join(buildDir, '.tmp-pass');
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
        } catch {
          // Signing failed — continue with unsigned binary
          if (fs.existsSync(signedPath)) {
            fs.unlinkSync(signedPath);
          }
        } finally {
          if (fs.existsSync(passFile)) fs.unlinkSync(passFile);
        }
      }
    } else if (platform.os === 'darwin') {
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

    // 8. Write metadata
    const stats = fs.statSync(outputPath);
    const meta: BuildMetadata = {
      platform: { os: platform.os, arch: platform.arch },
      builtAt: new Date().toISOString(),
      signed,
      fileSize: stats.size,
      filename,
      source: 'built',
    };
    fs.writeFileSync(this.metaPath(uuid), JSON.stringify(meta, null, 2));

    return {
      exists: true,
      platform: meta.platform,
      signed: meta.signed,
      fileSize: meta.fileSize,
      builtAt: meta.builtAt,
      filename: meta.filename,
      source: 'built',
    };
  }
}
