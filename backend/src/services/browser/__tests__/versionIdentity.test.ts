import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  identitiesFromTree,
  identityFromDisk,
  hashFiles,
  isBuildInput,
  sharedInputPrefixes,
} from '../versionIdentity.js';
import type { TreeEntry } from '../versionIdentity.js';

const UUID_A = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID_B = 'b1b2c3d4-e5f6-7890-abcd-ef1234567890';
const REL_A = `tests_source/intel-driven/${UUID_A}`;
const REL_B = `tests_source/intel-driven/${UUID_B}`;
const COMMIT = { hash: 'c0ffee', date: '2026-11-01T10:00:00+00:00' };

function blob(p: string, hash: string): TreeEntry {
  return { type: 'blob', hash, path: p };
}

function baseEntries(): TreeEntry[] {
  return [
    { type: 'tree', hash: 'tree-a', path: REL_A },
    blob(`${REL_A}/${UUID_A}.go`, 'h-main'),
    blob(`${REL_A}/go.mod`, 'h-mod'),
    blob(`${REL_A}/README.md`, 'h-readme'),
    blob(`${REL_A}/info.html`, 'h-html'),
    blob(`${REL_A}/rules.kql`, 'h-kql'),
    blob(`${REL_A}/x.yara`, 'h-yara'),
    blob(`${REL_A}/x.ndjson`, 'h-nd'),
    blob('preludeorg-libraries/lib.go', 'h-lib'),
    blob('tests_source/intel-driven/shared/common.go', 'h-shared'),
    blob('utils/resolve_org.sh', 'h-org'),
    blob('utils/codesign/sign.sh', 'h-sign'),
    blob('utils/dashboards/board.json', 'h-board'),
  ];
}

function change(entries: TreeEntry[], p: string, hash: string): TreeEntry[] {
  return entries.map(e => (e.path === p ? { ...e, hash } : e));
}

function idOf(entries: TreeEntry[], uuid = UUID_A, relPath = REL_A) {
  const id = identitiesFromTree(entries, [{ uuid, relPath }], COMMIT).get(uuid);
  if (!id) throw new Error('identity missing');
  return id;
}

describe('identitiesFromTree', () => {
  it('same entries give the same fingerprint; fingerprints of two tests with identical files differ', () => {
    expect(idOf(baseEntries()).fingerprint).toBe(idOf(baseEntries()).fingerprint);

    const entries = [
      blob(`${REL_A}/main.go`, 'same'),
      blob(`${REL_B}/main.go`, 'same'),
    ];
    const map = identitiesFromTree(entries, [
      { uuid: UUID_A, relPath: REL_A },
      { uuid: UUID_B, relPath: REL_B },
    ], COMMIT);
    expect(map.get(UUID_A)!.source_hash).toBe(map.get(UUID_B)!.source_hash);
    expect(map.get(UUID_A)!.fingerprint).not.toBe(map.get(UUID_B)!.fingerprint);
  });

  it('fills commit, provenance and test_tree for an upstream test', () => {
    const id = idOf(baseEntries());
    expect(id).toMatchObject({
      test_tree: 'tree-a',
      commit: 'c0ffee',
      commit_date: COMMIT.date,
      provenance: 'upstream',
    });
  });

  it.each([
    `${REL_A}/README.md`,
    `${REL_A}/info.html`,
    `${REL_A}/rules.kql`,
    `${REL_A}/x.yar`,
    `${REL_A}/x.yara`,
    `${REL_A}/x.ndjson`,
  ])('a change to %s keeps fingerprint, changes test_tree', (p) => {
    const before = idOf(baseEntries());
    const entries = change(baseEntries(), p, 'changed').map(e =>
      e.path === REL_A ? { ...e, hash: 'tree-a2' } : e);
    const after = idOf(entries);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.test_tree).not.toBe(before.test_tree);
  });

  it.each([`${REL_A}/${UUID_A}.go`, `${REL_A}/go.mod`])(
    'a change to %s changes source_hash and fingerprint, keeps shared_hash',
    (p) => {
      const before = idOf(baseEntries());
      const after = idOf(change(baseEntries(), p, 'changed'));
      expect(after.source_hash).not.toBe(before.source_hash);
      expect(after.fingerprint).not.toBe(before.fingerprint);
      expect(after.shared_hash).toBe(before.shared_hash);
    },
  );

  it.each([
    'preludeorg-libraries/lib.go',
    'tests_source/intel-driven/shared/common.go',
    'utils/resolve_org.sh',
    'utils/codesign/sign.sh',
  ])('a change under %s changes shared_hash and fingerprint, keeps source_hash', (p) => {
    const before = idOf(baseEntries());
    const after = idOf(change(baseEntries(), p, 'changed'));
    expect(after.shared_hash).not.toBe(before.shared_hash);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.source_hash).toBe(before.source_hash);
  });

  it('a change under utils/dashboards/ changes nothing', () => {
    const before = idOf(baseEntries());
    const after = idOf(change(baseEntries(), 'utils/dashboards/board.json', 'changed'));
    expect(after).toEqual(before);
  });

  it('another category shared/ folder is not a shared input', () => {
    const entries = [...baseEntries(), blob('tests_source/other/shared/x.go', 'h-x')];
    const before = idOf(entries);
    const after = idOf(change(entries, 'tests_source/other/shared/x.go', 'changed'));
    expect(after).toEqual(before);
  });

  it('flat layout tests_source/<uuid> resolves and has no category shared prefix', () => {
    const rel = `tests_source/${UUID_A}`;
    expect(sharedInputPrefixes(rel)).toEqual([
      'preludeorg-libraries/', 'utils/resolve_org.sh', 'utils/codesign/',
    ]);
    const entries = [
      blob(`${rel}/main.go`, 'h1'),
      blob('tests_source/shared/x.go', 'h-shared'),
    ];
    const before = idOf(entries, UUID_A, rel);
    const after = idOf(change(entries, 'tests_source/shared/x.go', 'changed'), UUID_A, rel);
    expect(after).toEqual(before);
  });

  it('a test with no entries at the ref is absent from the map', () => {
    const map = identitiesFromTree(baseEntries(), [{ uuid: UUID_B, relPath: REL_B }], COMMIT);
    expect(map.has(UUID_B)).toBe(false);
  });

  it('isBuildInput excludes documentation and detection extensions only', () => {
    expect(isBuildInput('docs/README.MD')).toBe(false);
    expect(isBuildInput('stage.go')).toBe(true);
    expect(isBuildInput('go.mod')).toBe(true);
  });
});

describe('identityFromDisk', () => {
  let dir: string;

  function write(rel: string, content = 'x') {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ver-identity-'));
    write(`${UUID_A}.go`, 'package main');
    write('go.mod', 'module x');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ignores build/, *.exe|dll|so|dylib|bin, and the generatedFiles list; commit and test_tree are null; provenance custom', () => {
    const before = identityFromDisk(dir, UUID_A);
    write('build/out.txt');
    write(`${UUID_A}.exe`);
    write('a.dll');
    write('a.so');
    write('a.dylib');
    write('a.bin');
    write('gen.txt', 'generated');
    const after = identityFromDisk(dir, UUID_A, ['gen.txt']);
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      commit: null, commit_date: null, test_tree: null, provenance: 'custom',
    });
  });

  it('identityFromDisk is identical before and after files are added under build/', () => {
    const before = identityFromDisk(dir, UUID_A);
    write(`build/${UUID_A}/${UUID_A}`, 'binary');
    write('build/nested/deep/file.go', 'package main');
    expect(identityFromDisk(dir, UUID_A)).toEqual(before);
  });

  it('is identical after a build leaves its generated files behind', () => {
    const before = identityFromDisk(dir, UUID_A);
    write(UUID_A, 'linux orchestrator');
    write(`${UUID_A}-T1486`, 'linux stage binary');
    write('go.sum', 'sum');
    write('achilles_log_dir.go', 'package main');
    expect(identityFromDisk(dir, UUID_A)).toEqual(before);
  });

  it('keeps the same fingerprint for a custom test folder when a build leaves its files behind, given the embed dependency names', () => {
    write('validator.dat', 'uploaded dependency');
    const embedDeps = ['validator.dat'];
    const before = identityFromDisk(dir, UUID_A, embedDeps);

    // What a build leaves behind: output dir, compiled binaries, generated go.sum
    write(`build/${UUID_A}/${UUID_A}.exe`, 'MZ built');
    write(`${UUID_A}.exe`, 'MZ compiled');
    write(UUID_A, 'linux orchestrator');
    write('go.sum', 'sum');
    // The dependency itself changing is tracked by deps_hash, not the fingerprint
    write('validator.dat', 'uploaded dependency, replaced');

    expect(identityFromDisk(dir, UUID_A, embedDeps)).toEqual(before);
  });

  it('ignores extensionless ELF and Mach-O binaries but sees a plain text file', () => {
    const before = identityFromDisk(dir, UUID_A);
    fs.writeFileSync(path.join(dir, 'validator-defender'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2]));
    fs.writeFileSync(path.join(dir, 'helper'), Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 7]));
    fs.writeFileSync(path.join(dir, 'tiny'), Buffer.from([0x4d, 0x5a]));
    expect(identityFromDisk(dir, UUID_A)).toEqual(before);
    write('Makefile', 'all:\n\tgo build');
    expect(identityFromDisk(dir, UUID_A).source_hash).not.toBe(before.source_hash);
  });

  it('excludes files named in generatedFiles (zip, extensionless) and only those', () => {
    const before = identityFromDisk(dir, UUID_A);
    write('payload.zip', 'PK data');
    write('sub/blob', 'text dep');
    expect(identityFromDisk(dir, UUID_A).source_hash).not.toBe(before.source_hash);
    expect(identityFromDisk(dir, UUID_A, ['payload.zip', 'sub/blob'])).toEqual(before);
  });

  it('a generatedFiles entry that is a folder excludes everything under it, and only that', () => {
    const before = identityFromDisk(dir, UUID_A, ['generated']);
    write('generated/x.pem', 'cert');
    write('generated/deep/y.txt', 'text');
    expect(identityFromDisk(dir, UUID_A, ['generated'])).toEqual(before);
    // A sibling whose name only starts with the folder name is still source
    write('generated-notes.txt', 'source');
    expect(identityFromDisk(dir, UUID_A, ['generated']).source_hash).not.toBe(before.source_hash);
  });

  it('a generatedFiles entry with a trailing slash is the same folder; a file entry excludes that file only', () => {
    const before = identityFromDisk(dir, UUID_A, ['generated/']);
    write('generated/x.pem', 'cert');
    expect(identityFromDisk(dir, UUID_A, ['generated/'])).toEqual(before);
    write('other/x.pem', 'cert');
    write('other/y.pem', 'source');
    const withOther = identityFromDisk(dir, UUID_A, ['generated', 'other/x.pem/']);
    expect(withOther.source_hash).not.toBe(before.source_hash); // other/y.pem is source
    fs.rmSync(path.join(dir, 'other', 'y.pem'));
    expect(identityFromDisk(dir, UUID_A, ['generated', 'other/x.pem/'])).toEqual(before);
  });

  it('still sees source changes, including a .go file and go.mod', () => {
    const before = identityFromDisk(dir, UUID_A);
    write(`${UUID_A}.go`, 'package main // edited');
    const edited = identityFromDisk(dir, UUID_A);
    expect(edited.source_hash).not.toBe(before.source_hash);
    expect(edited.fingerprint).not.toBe(before.fingerprint);
    write('go.mod', 'module y');
    expect(identityFromDisk(dir, UUID_A).source_hash).not.toBe(edited.source_hash);
  });

  it('ignores documentation files', () => {
    const before = identityFromDisk(dir, UUID_A);
    write('README.md', 'docs');
    write('rules.kql', 'q');
    expect(identityFromDisk(dir, UUID_A)).toEqual(before);
  });

  describe('hashFiles on what a //go:embed token can name', () => {
    let outside: string;
    beforeEach(() => {
      outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ver-outside-'));
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside content');
    });
    afterEach(() => {
      fs.rmSync(outside, { recursive: true, force: true });
    });
    const nothing = () => hashFiles(dir, ['no-such-file']);

    it('walks a named folder recursively and sees a change deep inside it', () => {
      write('assets/a.txt', 'a');
      write('assets/sub/b.txt', 'b');
      const h = hashFiles(dir, ['assets']);
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(h).not.toBe(nothing());
      expect(hashFiles(dir, ['assets/'])).toBe(h);
      write('assets/sub/b.txt', 'b2');
      expect(hashFiles(dir, ['assets'])).not.toBe(h);
    });

    it('ignores a name that leaves the folder', () => {
      fs.writeFileSync(path.join(path.dirname(dir), 'sibling.txt'), 'x');
      try {
        expect(hashFiles(dir, ['../sibling.txt'])).toBe(nothing());
        expect(hashFiles(dir, [path.join(outside, 'secret.txt')])).toBe(nothing());
      } finally {
        fs.rmSync(path.join(path.dirname(dir), 'sibling.txt'), { force: true });
      }
    });

    it('ignores symlinks, named directly, inside a walked folder, or as a parent folder', () => {
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'link.dat'));
      expect(hashFiles(dir, ['link.dat'])).toBe(nothing());

      write('assets/a.txt', 'a');
      const plain = hashFiles(dir, ['assets']);
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'assets', 'link.txt'));
      fs.symlinkSync(outside, path.join(dir, 'assets', 'linkdir'));
      expect(hashFiles(dir, ['assets'])).toBe(plain);

      fs.symlinkSync(outside, path.join(dir, 'outdir'));
      expect(hashFiles(dir, ['outdir/secret.txt'])).toBe(nothing());
      expect(hashFiles(dir, ['outdir'])).toBe(nothing());
    });

    it.skipIf(process.platform === 'win32')('skips a FIFO instead of blocking on it', () => {
      execFileSync('mkfifo', [path.join(dir, 'pipe.dat')]);
      expect(hashFiles(dir, ['pipe.dat'])).toBe(nothing());
      write('assets/a.txt', 'a');
      const plain = hashFiles(dir, ['assets']);
      execFileSync('mkfifo', [path.join(dir, 'assets', 'pipe')]);
      expect(hashFiles(dir, ['assets'])).toBe(plain);
    });

    it('never throws, and a name that matches nothing contributes nothing', () => {
      write('dep.dat', 'payload');
      const one = hashFiles(dir, ['dep.dat']);
      expect(() => hashFiles(dir, ['dep.dat', 'missing', 'assets-missing/', '', '.'])).not.toThrow();
      expect(hashFiles(dir, ['dep.dat', 'missing'])).toBe(one);
    });
  });

  it('hashFiles returns null for an empty list and a stable hash otherwise', () => {
    expect(hashFiles(dir, [])).toBeNull();
    const h = hashFiles(dir, ['go.mod']);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFiles(dir, ['go.mod'])).toBe(h);
    write('go.mod', 'module z');
    expect(hashFiles(dir, ['go.mod'])).not.toBe(h);
  });
});
