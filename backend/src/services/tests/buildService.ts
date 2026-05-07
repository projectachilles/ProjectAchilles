// Build service: Go cross-compilation, build_all.sh execution, osslsigncode signing

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { BuildInfo, BuildMetadata, EmbedDependency, PlatformSettings } from '../../types/tests.js';
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
 *  3. UUID-prefix stage — <uuid>-T1486.exe(.gz) → stage-T1486.go  (or prefix match)
 *  4. Fallback — parse build_all.sh for literal `go build -o <filename>`
 */
function isSourceBuiltBinary(
  filename: string,
  testUuid: string,
  goFileSet: Set<string>,
  buildScript: string | null,
): boolean {
  if (!buildScript) return false;

  // Strip known binary + compression extensions (handles compound like .exe.gz)
  const base = filename
    .replace(/\.(gz|xz|bz2|zip)$/i, '')    // compression suffix first
    .replace(/\.(exe|dll|bin|so|dylib)$/i, ''); // then binary extension

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
  private testSourcePaths: string[];

  constructor(settingsService: TestsSettingsService, testSourcePaths: string[] | string) {
    this.settingsService = settingsService;
    this.testSourcePaths = typeof testSourcePaths === 'string'
      ? [testSourcePaths]
      : testSourcePaths;
  }

  /**
   * Locate the test directory for a UUID across all source paths.
   *
   * Defense in depth: even though every public entry point that calls
   * findTestDir already validates the UUID against UUID_REGEX (which
   * forbids `..`, `/`, `\`, and NUL by construction), we additionally
   * canonicalise the candidate path and verify it stays within the
   * basePath root. This protects against:
   *   1. future regressions where UUID validation is loosened
   *   2. symlink redirection if testSourcePaths ever contains a symlinked dir
   *   3. CodeQL `js/path-injection` flow analysis, which doesn't recognise
   *      regex validation as a sufficient sanitiser and would otherwise
   *      flag every fs.* call downstream of testDir (5 alerts on PR #204).
   */
  private findTestDir(uuid: string): string | null {
    for (const basePath of this.testSourcePaths) {
      const root = path.resolve(basePath);

      const isWithinRoot = (candidate: string): boolean => {
        const resolved = path.resolve(candidate);
        const rel = path.relative(root, resolved);
        // Empty rel means candidate IS the root (not a subpath); the leading
        // `..` test catches escapes (e.g., `../etc`); isAbsolute catches
        // platform-specific absolute relatives (e.g., Windows drive switch).
        return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
      };

      // Try category/<uuid> first
      for (const cat of KNOWN_CATEGORIES) {
        const dir = path.join(basePath, cat, uuid);
        if (isWithinRoot(dir) && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
          return dir;
        }
      }
      // Try flat <uuid>
      const flat = path.join(basePath, uuid);
      if (isWithinRoot(flat) && fs.existsSync(flat) && fs.statSync(flat).isDirectory()) {
        return flat;
      }
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

  /** Extract GOOS from a //go:build or // +build directive in a Go file */
  private detectBuildTagOS(filePath: string): PlatformSettings['os'] | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      // Only scan the first ~20 lines (build tags must appear before package clause)
      const lines = content.split('\n').slice(0, 20);
      const validOS: PlatformSettings['os'][] = ['windows', 'linux', 'darwin'];

      for (const line of lines) {
        const trimmed = line.trim();
        // New-style: //go:build linux
        const newMatch = trimmed.match(/^\/\/go:build\s+(\w+)/);
        if (newMatch && validOS.includes(newMatch[1] as PlatformSettings['os'])) {
          return newMatch[1] as PlatformSettings['os'];
        }
        // Legacy-style: // +build linux
        const legacyMatch = trimmed.match(/^\/\/\s*\+build\s+(\w+)/);
        if (legacyMatch && validOS.includes(legacyMatch[1] as PlatformSettings['os'])) {
          return legacyMatch[1] as PlatformSettings['os'];
        }
      }
    } catch {
      // File read error — fall through
    }
    return null;
  }

  /**
   * Synthesize LOG_DIR/ARTIFACT_DIR if a .go file references LOG_DIR but no
   * file declares it. Returns the injected file path, or null if nothing was
   * needed.
   *
   * Why: tests that ship the shared `test_logger.go` without the platform
   * companion (`test_logger_<os>.go`) reference LOG_DIR but don't declare it,
   * so `go build .` fails with `undefined: LOG_DIR`. Rather than patch every
   * affected test source-side, we synthesize the declaration at build time
   * with the same constants the agent itself uses (C:\F0 on Windows,
   * /tmp/F0 on POSIX) — see f0_library/CLAUDE.md "Cross-Platform Test
   * Development". The caller MUST clean up the returned path in `finally`.
   *
   * Issue #202: mitre-top10 `b8e4c9d2-7f3a-4e1b-8c5d-2a3b4c5d6e02` build
   * failed with `./test_logger.go:1221:30: undefined: LOG_DIR`.
   */
  private injectLogDirIfMissing(testDir: string, targetOs: PlatformSettings['os']): string | null {
    const goFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.go'));

    let referenced = false;
    let declared = false;
    for (const f of goFiles) {
      const content = fs.readFileSync(path.join(testDir, f), 'utf8');
      if (!referenced && /\bLOG_DIR\b/.test(content)) referenced = true;
      // Match `const LOG_DIR` or `var LOG_DIR` at start of a line (allow
      // leading whitespace). Single-line and grouped (parenthesised) decls
      // are both accepted by Go but we only need the simple form here since
      // every existing test uses it.
      if (!declared && /^\s*(const|var)\s+LOG_DIR\b/m.test(content)) declared = true;
      if (referenced && declared) break;
    }

    if (!referenced || declared) return null;

    // Match the agent's platform-specific fallback paths (agent/internal/config).
    const logDir = targetOs === 'windows' ? 'C:\\F0' : '/tmp/F0';
    const artifactDir = targetOs === 'windows'
      ? 'c:\\Users\\fortika-test'
      : targetOs === 'darwin'
        ? '/Users/fortika-test'
        : '/home/fortika-test';

    const injectedPath = path.join(testDir, '_achilles_log_dir.go');
    // Use Go raw strings (backticks) so backslashes in Windows paths are
    // taken literally without escaping. Underscore-prefixed filename keeps
    // `go build` from picking the file up if cleanup is ever skipped — the
    // Go toolchain ignores `_*` and `.*` files by spec.
    const goSource = `// Code generated by ProjectAchilles buildService. DO NOT EDIT.
// Removed automatically after \`go build\`. See injectLogDirIfMissing in
// backend/src/services/tests/buildService.ts and issue #202 for context.
package main

const LOG_DIR = \`${logDir}\`
const ARTIFACT_DIR = \`${artifactDir}\`
`;
    fs.writeFileSync(injectedPath, goSource);
    return injectedPath;
  }

  /** Resolve the target OS for a test: build tags take precedence over global setting */
  private resolveTargetOS(testDir: string, uuid: string): PlatformSettings['os'] {
    // 1. Check the main <uuid>.go file first
    const mainFile = path.join(testDir, `${uuid}.go`);
    if (fs.existsSync(mainFile)) {
      const os = this.detectBuildTagOS(mainFile);
      if (os) return os;
    }

    // 2. Check other .go files in the test directory
    const goFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.go') && f !== `${uuid}.go`);
    for (const goFile of goFiles) {
      const os = this.detectBuildTagOS(path.join(testDir, goFile));
      if (os) return os;
    }

    // 3. Fall back to global platform setting
    return this.settingsService.getPlatformSettings().os;
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

  getDetectedPlatform(uuid: string): PlatformSettings | null {
    const testDir = this.findTestDir(uuid);
    if (!testDir) return null;
    const globalPlatform = this.settingsService.getPlatformSettings();
    return {
      os: this.resolveTargetOS(testDir, uuid),
      arch: globalPlatform.arch,
    };
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

    // 1. Find test directory
    const testDir = this.findTestDir(uuid);
    if (!testDir) {
      throw new Error('Test directory not found');
    }

    // 2. Resolve platform: auto-detect OS from build tags, arch from global setting
    const globalPlatform = this.settingsService.getPlatformSettings();
    const platform: PlatformSettings = {
      os: this.resolveTargetOS(testDir, uuid),
      arch: globalPlatform.arch,
    };

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
      // Determine if the test is in a categorized subdirectory (tests_source/<category>/<uuid>/).
      // Some build_all.sh scripts hardcode TEST_DIR="tests_source/<uuid>" (flat layout) and use
      // ../../ to navigate back to repo root. For categorized tests (3 levels deep instead of 2),
      // we patch the script to fix paths before executing from the repo root.
      const containingSource = this.testSourcePaths.find(sp => testDir.startsWith(sp + path.sep)) || this.testSourcePaths[0];
      const repoRoot = path.dirname(containingSource);
      const relFromTestsSource = path.relative(containingSource, testDir);
      const pathParts = relFromTestsSource.split(path.sep);
      const isCategorized = pathParts.length === 2; // e.g., "intel-driven/<uuid>"

      let patchedScript: string | null = null;
      let buildCwd: string;
      let buildArgs: string[];

      if (isCategorized) {
        const category = pathParts[0];
        const scriptContent = fs.readFileSync(buildAllPath, 'utf-8');
        const needsPatching = scriptContent.includes(`TEST_DIR="tests_source/\${TEST_UUID}"`)
          || scriptContent.includes(`TEST_DIR="tests_source/$TEST_UUID"`);

        if (needsPatching) {
          // Patch the script: fix TEST_DIR and adjust relative paths for 3-level depth
          let patched = scriptContent;
          // 1. Insert category into TEST_DIR
          patched = patched.replace(
            /TEST_DIR="tests_source\//g,
            `TEST_DIR="tests_source/${category}/`,
          );
          // 2. Fix ../../ path references (2-level → 3-level back-navigation)
          //    Negative lookbehind: don't expand paths that are already ../../../
          patched = patched.replace(
            /(?<!\.\.\/)\.\.\/\.\.\//g,
            '../../../',
          );
          // 3. Fix standalone `cd ../..` (no trailing slash) at end of line
          patched = patched.replace(
            /cd \.\.\/\.\.$/gm,
            'cd ../../..',
          );

          patchedScript = path.join(buildDir, '.build-patched.sh');
          fs.writeFileSync(patchedScript, patched, { mode: 0o755 });
          buildCwd = repoRoot;
          buildArgs = [patchedScript];
        } else {
          // Script uses SCRIPT_DIR pattern (self-contained paths) — run from repo root as-is
          buildCwd = repoRoot;
          buildArgs = [path.relative(repoRoot, buildAllPath)];
        }
      } else {
        buildCwd = testDir;
        buildArgs = ['build_all.sh'];
      }

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

      try {
        await runBuildCommand('bash', buildArgs, {
          cwd: buildCwd,
          env,
          timeout: BUILD_TIMEOUT,
        });
      } finally {
        // Clean up patched build script
        if (patchedScript && fs.existsSync(patchedScript)) {
          try { fs.unlinkSync(patchedScript); } catch { /* ignore */ }
        }
        // Clean up inner cert password file
        if (innerPassFile && fs.existsSync(innerPassFile)) {
          fs.unlinkSync(innerPassFile);
        }
      }

      // Locate output binary — check repo-root build dir (build_all.sh output location) too
      const candidates = [
        path.join(repoRoot, 'build', uuid, filename),
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
        // Try to find any file in build/<uuid>/ under repo root or testDir
        for (const base of [repoRoot, testDir]) {
          const buildSubdir = path.join(base, 'build', uuid);
          if (fs.existsSync(buildSubdir)) {
            const files = fs.readdirSync(buildSubdir);
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

      // Synthesize LOG_DIR/ARTIFACT_DIR if the test references LOG_DIR but
      // ships no platform-specific test_logger_<os>.go. See issue #202.
      const injectedLogDirPath = this.injectLogDirIfMissing(testDir, platform.os);

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
        // Clean up the synthesized LOG_DIR file. Cleanup runs even if the
        // build above throws, so the source tree never holds the auto-file.
        if (injectedLogDirPath && fs.existsSync(injectedLogDirPath)) {
          fs.unlinkSync(injectedLogDirPath);
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
