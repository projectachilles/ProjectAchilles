// The build service's embed dependency list feeding the versions service, on
// real folders and without git: what a test's own build leaves in its folder
// must not change the test's content fingerprint.

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BuildService } from '../../tests/buildService.js';
import type { TestsSettingsService } from '../../tests/settings.js';
import { TestVersionsService } from '../testVersions.service.js';
import { deriveStatus } from '../testVersionStatus.js';
import type { BuildVersionStamp } from '../../../types/testVersion.js';

// buildAndSign writes its output under <home>/.projectachilles/builds: keep
// that inside a temp folder, never the real home directory.
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const home = actual.tmpdir() + `/tv-embeds-home-${process.pid}`;
  const overrides = { homedir: () => home };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const UUID = 'e1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('a custom multi-stage test without git', () => {
  let tmp: string;
  let root: string;
  let testDir: string;

  function write(rel: string, content: string | Buffer): void {
    const full = path.join(testDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  function services(): { versions: TestVersionsService; builds: BuildService } {
    const builds = new BuildService({} as unknown as TestsSettingsService, [root]);
    const versions = new TestVersionsService({
      sourceSubdir: 'tests_source',
      listTests: () => [{ uuid: UUID, dir: testDir, provenance: 'custom' }],
      embedDependencyFiles: (uuid) => builds.embedDependencyNames(uuid),
      stateFile: path.join(tmp, 'state.json'),
    });
    return { versions, builds };
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-embeds-'));
    root = path.join(tmp, 'custom');
    testDir = path.join(root, UUID);
    write(`${UUID}.go`, [
      'package main',
      '',
      `//go:embed ${UUID}-T1.exe.gz`,
      'var stage1 []byte',
      '',
      '//go:embed generated',
      'var certs embed.FS',
      '',
    ].join('\n'));
    write('stage-T1.go', 'package main\n');
    write('build_all.sh', [
      '#!/bin/bash',
      'mkdir -p generated',
      'openssl req -x509 -out generated/x.pem',
      `go build -o ${UUID}-T1.exe stage-T1.go && gzip ${UUID}-T1.exe`,
      '',
    ].join('\n'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('has the same fingerprint before and after its build_all.sh leaves the compressed stage and generated/ behind', async () => {
    const before = (await services().versions.synced()).get(UUID)!.fingerprint;

    // What build_all.sh leaves in the folder: a gzip-compressed stage (no
    // executable magic) and a build-created folder with a text file in it.
    write(`${UUID}-T1.exe.gz`, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3]));
    write('generated/x.pem', '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n');

    const after = (await services().versions.synced()).get(UUID)!.fingerprint;
    expect(after).toBe(before);
  });

  describe('an authored file in the folder build_all.sh creates', () => {
    // What buildAndSign stamps, taken the way it takes it: the identity read
    // before the build, the hashes once the build has written its outputs.
    async function buildAndStamp(): Promise<BuildVersionStamp> {
      const { versions, builds } = services();
      const current = (await versions.current(UUID))!;
      write(`${UUID}-T1.exe.gz`, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3]));
      write('generated/x.pem', '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n');
      return {
        ...current.identity,
        deps_hash: builds.currentDepsHash(UUID),
        outputs_hash: builds.currentOutputsHash(UUID),
        modified: current.modified,
        binaries: {},
      };
    }

    async function statusNow(version: BuildVersionStamp) {
      const { versions, builds } = services();
      return deriveStatus({
        build: { exists: true, source: 'built', version },
        synced: (await versions.synced()).get(UUID),
        published: undefined,
        publishedKnown: false,
        hasGit: false,
        currentDepsHash: builds.currentDepsHash(UUID),
        currentOutputsHash: builds.currentOutputsHash(UUID),
      });
    }

    beforeEach(() => {
      write('generated/config.json', '{"stage":"T1"}\n');
    });

    it('is up_to_date right after the build', async () => {
      const version = await buildAndStamp();
      expect(version.outputs_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(await statusNow(version)).toEqual({ status: 'up_to_date' });
    });

    it('editing it gives rebuild_needed / dependency_changed, though the fingerprint is unchanged', async () => {
      const version = await buildAndStamp();
      write('generated/config.json', '{"stage":"T2"}\n');

      expect((await services().versions.synced()).get(UUID)!.fingerprint).toBe(version.fingerprint);
      expect(await statusNow(version)).toEqual({ status: 'rebuild_needed', reason: 'dependency_changed' });
    });
  });

  it('still sees a change to the test source', async () => {
    const before = (await services().versions.synced()).get(UUID)!.fingerprint;
    write('stage-T1.go', 'package main\n// edited\n');
    expect((await services().versions.synced()).get(UUID)!.fingerprint).not.toBe(before);
  });
});

describe('a real build whose build_all.sh produces an embed classed as external', () => {
  const HELPER = 'helper.exe.gz';
  let tmp: string;
  let root: string;
  let testDir: string;

  function write(rel: string, content: string | Buffer): void {
    const full = path.join(testDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  function services(): { versions: TestVersionsService; builds: BuildService } {
    let builds: BuildService;
    const versions = new TestVersionsService({
      sourceSubdir: 'tests_source',
      listTests: () => [{ uuid: UUID, dir: testDir, provenance: 'custom' }],
      embedDependencyFiles: (uuid) => builds.embedDependencyNames(uuid),
      stateFile: path.join(tmp, 'state.json'),
    });
    const settings = {
      getPlatformSettings: () => ({ os: 'linux', arch: 'amd64' }),
      getActiveCertPfxPath: () => null,
    } as unknown as TestsSettingsService;
    builds = new BuildService(settings, [root], versions);
    return { versions, builds };
  }

  /** The row the versions endpoint derives for the test, given matching fingerprints and a successful check. */
  async function statusNow() {
    const { versions, builds } = services();
    const synced = (await versions.synced()).get(UUID);
    return deriveStatus({
      build: { exists: true, source: 'built', version: builds.getBuildInfo(UUID).version },
      synced,
      published: synced,
      publishedKnown: true,
      hasGit: true,
      currentDepsHash: builds.currentDepsHash(UUID),
      currentOutputsHash: builds.currentOutputsHash(UUID),
    });
  }

  // The temp home from the os mock above; the cleanup below removes it, so
  // never run against a real one.
  const fakeHome = (): string => {
    const home = os.homedir();
    expect(path.basename(home)).toMatch(/^tv-embeds-home-/);
    return home;
  };

  beforeEach(() => {
    fakeHome();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-embeds-build-'));
    root = path.join(tmp, 'custom');
    testDir = path.join(root, UUID);
    write(`${UUID}.go`, [
      'package main',
      '',
      `//go:embed ${HELPER}`,
      'var helper []byte',
      '',
    ].join('\n'));
    // Compiles a helper, gzips it into the test folder, and leaves the
    // orchestrator where buildAndSign looks for it. `go` is a shell function
    // standing in for the toolchain: every run writes different bytes, as
    // a signature timestamp or a gzip header would.
    write('build_all.sh', [
      '#!/bin/bash',
      'set -e',
      'go() { printf "helper %s\\n" "$(date +%s%N)" > helper.exe; }',
      'go build -o helper.exe ./helper',
      'gzip -9 -k -f helper.exe',
      'rm -f helper.exe',
      `mkdir -p ../../build/${UUID}`,
      `printf orchestrator > ../../build/${UUID}/${UUID}`,
      '',
    ].join('\n'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(fakeHome(), { recursive: true, force: true });
  });

  it('classes the helper as external', () => {
    const dep = services().builds.getEmbedDependencies(UUID).find(d => d.filename === HELPER);
    expect(dep).toMatchObject({ sourceBuilt: false });
  });

  it('reads up_to_date straight after the build, and again after a rebuild', async () => {
    expect(fs.existsSync(path.join(testDir, HELPER))).toBe(false);

    const info = await services().builds.buildAndSign(UUID);
    expect(await statusNow()).toEqual({ status: 'up_to_date' });
    expect(info.version?.deps_hash).toMatch(/^[0-9a-f]{64}$/);

    const firstHelper = fs.readFileSync(path.join(testDir, HELPER));
    await services().builds.buildAndSign(UUID);
    expect(fs.readFileSync(path.join(testDir, HELPER))).not.toEqual(firstHelper);
    expect(await statusNow()).toEqual({ status: 'up_to_date' });
  });

  it('reads rebuild_needed once the helper is replaced after the build', async () => {
    await services().builds.buildAndSign(UUID);

    write(HELPER, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 9, 9, 9]));

    expect(await statusNow()).toEqual({ status: 'rebuild_needed', reason: 'dependency_changed' });
  });
});
