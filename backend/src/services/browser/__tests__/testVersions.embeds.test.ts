// The build service's embed dependency list feeding the versions service, on
// real folders and without git: what a test's own build leaves in its folder
// must not change the test's content fingerprint.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BuildService } from '../../tests/buildService.js';
import type { TestsSettingsService } from '../../tests/settings.js';
import { TestVersionsService } from '../testVersions.service.js';
import { deriveStatus } from '../testVersionStatus.js';
import type { BuildVersionStamp } from '../../../types/testVersion.js';

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
      const depsHash = builds.currentDepsHash(UUID);
      write(`${UUID}-T1.exe.gz`, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3]));
      write('generated/x.pem', '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n');
      return {
        ...current.identity,
        deps_hash: depsHash,
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
