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
  TreeTooLargeError,
  MAX_IDENTITY_WORK,
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

  it('isBuildInput excludes documentation and detection extensions', () => {
    expect(isBuildInput('docs/README.MD')).toBe(false);
    expect(isBuildInput('stage.go')).toBe(true);
    expect(isBuildInput('go.mod')).toBe(true);
  });

  const DETECTION_NAMES = [
    `${UUID_A}_sigma_rules.yml`,
    `${UUID_A}_dr_rules.yaml`,
    `${UUID_A}_hardening.ps1`,
    `${UUID_A}_hardening_linux.sh`,
    `${UUID_A}_hardening_macos.sh`,
    `${UUID_A}_hardening_linux.ps1`,
  ];

  it.each(DETECTION_NAMES.flatMap(n => [n, `sub/${n}`, `a/b/${n}`]))(
    'isBuildInput is false for the detection and defence file %s',
    (p) => {
      expect(isBuildInput(p)).toBe(false);
    },
  );

  it.each([
    'emergency_restore.ps1',
    'build_all.sh',
    'config.yml',
    'rules.yaml',
    'hardening.ps1',
    `${UUID_A}_hardening.ps1.bak`,
    `${UUID_A}_sigma_rules.yaml`,
    `${UUID_A.toUpperCase()}_SIGMA_RULES.YML`,
    `${UUID_A}_hardening_.sh`,
    'sub/emergency_restore.ps1',
    // The library's files are always <uuid>_<suffix>: other names with the
    // same ending are real scripts or configuration.
    'apply_hardening.ps1',
    'cis_hardening_linux.sh',
    'custom_sigma_rules.yml',
    'x_sigma_rules.yml',
    'x_dr_rules.yaml',
    'sub/apply_hardening.ps1',
    `${UUID_A.toUpperCase()}_sigma_rules.yml`,
    `${UUID_A.toUpperCase()}_hardening.ps1`,
    `${UUID_A}-sigma_rules.yml`,
    `${UUID_A}-hardening.ps1`,
    `${UUID_A}.dr_rules.yaml`,
    `stage_${UUID_A}_hardening.ps1`,
  ])('isBuildInput stays true for %s', (p) => {
    expect(isBuildInput(p)).toBe(true);
  });

  describe('detection and defence files by name', () => {
    const SIGMA = `${REL_A}/${UUID_A}_sigma_rules.yml`;
    const HARDENING = `${REL_A}/${UUID_A}_hardening.ps1`;
    const PAYLOAD = `${REL_A}/payload.ps1`;
    const APPLY = `${REL_A}/apply_hardening.ps1`;
    const entries = () => [
      ...baseEntries(),
      blob(SIGMA, 'h-sigma'),
      blob(HARDENING, 'h-hard'),
      blob(PAYLOAD, 'h-payload'),
      blob(APPLY, 'h-apply'),
    ];

    it.each([SIGMA, HARDENING])('a change to %s keeps fingerprint and source_hash, changes test_tree', (p) => {
      const before = idOf(entries());
      const after = idOf(change(entries(), p, 'changed').map(e =>
        e.path === REL_A ? { ...e, hash: 'tree-a2' } : e));
      expect(after.fingerprint).toBe(before.fingerprint);
      expect(after.source_hash).toBe(before.source_hash);
      expect(after.test_tree).not.toBe(before.test_tree);
    });

    it.each([PAYLOAD, APPLY])('a change to %s changes the fingerprint', (p) => {
      const before = idOf(entries());
      const after = idOf(change(entries(), p, 'changed'));
      expect(after.source_hash).not.toBe(before.source_hash);
      expect(after.fingerprint).not.toBe(before.fingerprint);
    });
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

  it.each([`${UUID_A}_sigma_rules.yml`, `${UUID_A}_dr_rules.yaml`, `${UUID_A}_hardening.ps1`])(
    'a change to %s keeps fingerprint and source_hash',
    (name) => {
      write(name, 'one');
      const before = identityFromDisk(dir, UUID_A);
      write(name, 'two');
      const after = identityFromDisk(dir, UUID_A);
      expect(after.fingerprint).toBe(before.fingerprint);
      expect(after.source_hash).toBe(before.source_hash);
    },
  );

  it('a change to an embedded-style payload.ps1 changes the fingerprint', () => {
    write('payload.ps1', 'one');
    const before = identityFromDisk(dir, UUID_A);
    write('payload.ps1', 'two');
    const after = identityFromDisk(dir, UUID_A);
    expect(after.source_hash).not.toBe(before.source_hash);
    expect(after.fingerprint).not.toBe(before.fingerprint);
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

// ── Cost of reading a published tree ────────────────────────────────────────
// The tree is repository content: its size is not ours to choose.

describe('identitiesFromTree on a large or hostile tree', () => {
  const idN = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

  /** Two categories, a flat test, a test nested in it, shared folders, files that are not build inputs. */
  function sampleTree(): { entries: TreeEntry[]; tests: Array<{ uuid: string; relPath: string }> } {
    const entries: TreeEntry[] = [];
    const tests: Array<{ uuid: string; relPath: string }> = [];
    const tree = (p: string, hash: string) => entries.push({ type: 'tree', hash, path: p });
    for (const [cat, ids] of [['intel-driven', [1, 2]], ['cyber-hygiene', [3]]] as const) {
      entries.push(blob(`tests_source/${cat}/shared/common.go`, `h-shared-${cat}`));
      for (const n of ids) {
        const rel = `tests_source/${cat}/${idN(n)}`;
        tree(rel, `tree-${n}`);
        tests.push({ uuid: idN(n), relPath: rel });
        entries.push(blob(`${rel}/main.go`, `h-main-${n}`));
        entries.push(blob(`${rel}/sub/stage.go`, `h-stage-${n}`));
        entries.push(blob(`${rel}/README.md`, `h-readme-${n}`));
      }
    }
    const flat = `tests_source/${idN(4)}`;
    tree(flat, 'tree-4');
    tests.push({ uuid: idN(4), relPath: flat });
    entries.push(blob(`${flat}/main.go`, 'h-main-4'));
    const nested = `${flat}/${idN(5)}`;
    tests.push({ uuid: idN(5), relPath: nested });
    entries.push(blob(`${nested}/inner.go`, 'h-inner-5'));
    // A folder whose name only starts like test 1's is not test 1.
    entries.push(blob(`tests_source/intel-driven/${idN(1)}x/not-mine.go`, 'h-neighbour'));
    tests.push({ uuid: idN(6), relPath: `tests_source/intel-driven/${idN(6)}` }); // no files
    entries.push(blob('preludeorg-libraries/lib.go', 'h-lib'));
    entries.push(blob('utils/resolve_org.sh', 'h-org'));
    entries.push(blob('utils/codesign/sign.sh', 'h-sign'));
    entries.push(blob('utils/other.sh', 'h-other'));
    return { entries, tests };
  }

  it('gives the fingerprints recorded before the single-pass rewrite (no stored fingerprint changes)', () => {
    const { entries, tests } = sampleTree();

    const got = [...identitiesFromTree(entries, tests, COMMIT)]
      .map(([uuid, id]) => [uuid, id.fingerprint, id.source_hash, id.shared_hash, id.test_tree]);

    // Captured from the previous implementation on this exact tree.
    expect(got).toEqual([
      [idN(1), '4a2bd5a929db1889fe90f7ae937132b3ae82ffe62c809395c07d509c8a62f361', '3756478c5908cbcb2c64de1772a111a6cf133409b0c4263e9b7994534fbe7065', 'a709b8b33196be9a6fe8772ff3693bdd5ed72007622faaf98b25a350864feab9', 'tree-1'],
      [idN(2), '994a1693e96a56b669c246c6c54db8b2798a0e7e8230f2ca6d241311a46206d6', 'd8e8daf252d8da63b89ea9bd4bd9f0ae4775450f35bdb3b6a0197f538cce30eb', 'a709b8b33196be9a6fe8772ff3693bdd5ed72007622faaf98b25a350864feab9', 'tree-2'],
      [idN(3), '8ac7f0990ca34202de79e4d0cbaa0acf1d0766620df1d80285190f51c7d9d93e', 'a64fea4b458e556afdf356e24cc48deeffc33c2f7572cc6ec37a577ab8004a32', '080633964f22c4cc9faed6c18f976380d0db58c1bf629ab39c4728649c6f3905', 'tree-3'],
      [idN(4), 'd4aebc5bf1b6dc9217d040fbe106689739406e797a2d4ce1218131958fbc36c0', '8e167860a4223383c837f9277f55b92ae94232a6ed060efe2e4222d6339243b5', 'b299f449718ef35c04835019cef14e32a9375338885e3e7a4e776a78df9fd577', 'tree-4'],
      [idN(5), '0b6686ff29728ce7613daf4fea925547491b07882d0b2551d2d48942258595b3', 'd8b9000830c40f96db92ff69863b12ebebc915a99313adebdee6b59399239e27', 'b299f449718ef35c04835019cef14e32a9375338885e3e7a4e776a78df9fd577', null],
    ]);
  });

  it('does not depend on the order of the entries or of the tests', () => {
    const { entries, tests } = sampleTree();
    const forward = identitiesFromTree(entries, tests, COMMIT);
    const backward = identitiesFromTree([...entries].reverse(), [...tests].reverse(), COMMIT);

    for (const [uuid, id] of forward) expect(backward.get(uuid)).toEqual(id);
    expect(backward.size).toBe(forward.size);
  });

  /** `tests` test folders in one category, `files` build inputs each. */
  function wideTree(tests: number, files: number) {
    const entries: TreeEntry[] = [blob('preludeorg-libraries/lib.go', 'h-lib')];
    const locations: Array<{ uuid: string; relPath: string }> = [];
    for (let t = 0; t < tests; t++) {
      const rel = `tests_source/intel-driven/${idN(t)}`;
      locations.push({ uuid: idN(t), relPath: rel });
      for (let f = 0; f < files; f++) entries.push(blob(`${rel}/f${f}.go`, `h-${t}-${f}`));
    }
    return { entries, locations };
  }

  it('reads 5,000 tests with 25,000 files without scanning every file once per test', () => {
    const { entries, locations } = wideTree(5000, 5);

    const started = Date.now();
    const ids = identitiesFromTree(entries, locations, COMMIT);
    const elapsed = Date.now() - started;

    expect(ids.size).toBe(5000);
    // One scan of the files per test took about 16 s for this tree; a single
    // pass takes well under a second. The bound leaves room for a slow runner.
    expect(elapsed).toBeLessThan(4000);
  });

  it('charges one unit per file of a test and one scan per set of shared inputs', () => {
    const { entries, locations } = wideTree(10, 5); // 51 files, one category
    const cost = 10 * 5 + 51;

    expect(identitiesFromTree(entries, locations, COMMIT, { maxWork: cost }).size).toBe(10);
    expect(() => identitiesFromTree(entries, locations, COMMIT, { maxWork: cost - 1 }))
      .toThrow(TreeTooLargeError);
  });

  it('stops instead of rescanning the files for every one of many categories', () => {
    // Each test in a category of its own: every one has its own shared-input
    // set, which costs a scan of all the files.
    const entries: TreeEntry[] = [];
    const locations: Array<{ uuid: string; relPath: string }> = [];
    for (let t = 0; t < 3000; t++) {
      const rel = `tests_source/cat-${t}/${idN(t)}`;
      locations.push({ uuid: idN(t), relPath: rel });
      entries.push(blob(`${rel}/main.go`, `h-${t}`));
    }
    for (let f = 0; f < 3000; f++) entries.push(blob(`preludeorg-libraries/f${f}.go`, `h-lib-${f}`));

    const started = Date.now();
    expect(() => identitiesFromTree(entries, locations, COMMIT)).toThrow(TreeTooLargeError);
    expect(Date.now() - started).toBeLessThan(4000);
    // 3,000 categories x 6,000 files is far over the default limit.
    expect(3000 * 6000).toBeGreaterThan(MAX_IDENTITY_WORK);
  });

  it('a file many folders deep belongs to its test, and costs no more than a shallow one', () => {
    const rel = `tests_source/intel-driven/${idN(1)}`;
    const shallow = [blob(`${rel}/main.go`, 'h-main'), blob(`${rel}/a/b/c/d/deep.go`, 'h-deep')];

    const id = identitiesFromTree(shallow, [{ uuid: idN(1), relPath: rel }], COMMIT).get(idN(1))!;
    const withoutDeep = identitiesFromTree([shallow[0]], [{ uuid: idN(1), relPath: rel }], COMMIT).get(idN(1))!;
    expect(id.source_hash).not.toBe(withoutDeep.source_hash);

    // 6,000 files, each 3,000 one-letter folders below the test folder (a
    // 37 MB listing, under the listing limit). A lookup per ancestor folder
    // took about 4 s here and was not counted against the work limit; stopping
    // at the depth of the test folders takes about 50 ms.
    const deepFolder = `${rel}/${'d/'.repeat(3000)}`;
    const deep: TreeEntry[] = [];
    for (let f = 0; f < 6000; f++) deep.push(blob(`${deepFolder}f${f}.go`, `h-${f}`));

    const started = Date.now();
    const ids = identitiesFromTree(deep, [{ uuid: idN(1), relPath: rel }], COMMIT);

    expect(Date.now() - started).toBeLessThan(1500);
    expect(ids.get(idN(1))!.source_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the default limit leaves room for a library a hundred times the current one', () => {
    // Today: about 70 tests, 2,000 files, 5 categories.
    const filesInLibrary = 200_000;
    const categories = 10;
    expect(filesInLibrary + categories * filesInLibrary).toBeLessThan(MAX_IDENTITY_WORK);
  });
});

