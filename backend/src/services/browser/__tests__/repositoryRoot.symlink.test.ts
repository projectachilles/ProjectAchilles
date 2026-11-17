import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FileService } from '../fileService.js';
import { TestIndexer } from '../testIndexer.js';
import {
  registerRepositoryRoot,
  clearRepositoryRoots,
  checkRepositoryRoot,
  isUsableSourceRoot,
} from '../repositoryRoot.js';
import { initCatalog, getTestMetadata } from '../../agent/test-catalog.service.js';
import { BuildService } from '../../tests/buildService.js';
import type { TestsSettingsService } from '../../tests/settings.js';

/**
 * Real-filesystem checks for the root of a Git-synced library. The root
 * (`<clone>/tests_source`) is repository content, so a repository can make it
 * a link. Operator-set roots may be links; this one may not.
 */
const UUID = '11111111-2222-4333-8444-555555555555';

function writeTest(dir: string, text: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), text);
  fs.writeFileSync(path.join(dir, `${UUID}.go`), 'package main\n');
}

function findBuildDir(roots: string[]): string | null {
  const service = new BuildService({} as TestsSettingsService, roots);
  return (service as unknown as { findTestDir(uuid: string): string | null }).findTestDir(UUID);
}

describe('Git-synced source root on a real filesystem', () => {
  let base: string;
  let clone: string;
  let root: string;
  let outside: string;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-reporoot-')));
    clone = path.join(base, 'f0_library');
    root = path.join(clone, 'tests_source');
    fs.mkdirSync(path.join(clone, '.git'), { recursive: true });

    // A folder outside the clone that looks like a library (the layout build
    // output also has): the link target.
    outside = path.join(base, 'outside');
    writeTest(path.join(outside, 'intel-driven', UUID), '# Outside the clone');

    clearRepositoryRoots();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    clearRepositoryRoots();
    initCatalog([]);
    vi.restoreAllMocks();
    fs.rmSync(base, { recursive: true, force: true });
  });

  describe('a normal clone', () => {
    beforeEach(() => {
      writeTest(path.join(root, 'intel-driven', UUID), '# In the clone');
      registerRepositoryRoot(root, clone);
    });

    it('is indexed, read, catalogued and buildable as before', () => {
      expect(isUsableSourceRoot(root)).toBe(true);

      const indexer = new TestIndexer([{ path: root, provenance: 'upstream' }]);
      expect(indexer.scanAllTests().map(t => t.uuid)).toEqual([UUID]);
      expect(indexer.getTest(UUID)?.uuid).toBe(UUID);

      const file = path.join(root, 'intel-driven', UUID, 'README.md');
      expect(FileService.readFileContent(file, [root]).content).toBe('# In the clone');
      // A root below the registered one (a test folder) works too.
      expect(FileService.readFileContent(file, [path.dirname(file)]).content).toBe('# In the clone');

      initCatalog([{ path: root, provenance: 'upstream' }]);
      expect(getTestMetadata(UUID)).not.toBeNull();

      expect(findBuildDir([root])).toBe(path.join(root, 'intel-driven', UUID));
      expect(warn).not.toHaveBeenCalled();
    });

    it('works when the clone folder itself is an operator symlink', () => {
      const linkedClone = path.join(base, 'library-link');
      fs.symlinkSync(clone, linkedClone);
      const linkedRoot = path.join(linkedClone, 'tests_source');
      clearRepositoryRoots();
      registerRepositoryRoot(linkedRoot, linkedClone);

      const indexer = new TestIndexer([{ path: linkedRoot, provenance: 'upstream' }]);
      expect(indexer.scanAllTests().map(t => t.uuid)).toEqual([UUID]);
      const file = path.join(linkedRoot, 'intel-driven', UUID, 'README.md');
      expect(FileService.readFileContent(file, [linkedRoot]).content).toBe('# In the clone');
    });

    it('refuses reads once the root is swapped for a link after indexing', () => {
      const indexer = new TestIndexer([{ path: root, provenance: 'upstream' }]);
      expect(indexer.scanAllTests()).toHaveLength(1);
      const file = path.join(root, 'intel-driven', UUID, 'README.md');

      fs.renameSync(root, path.join(clone, 'moved'));
      fs.symlinkSync(outside, root);

      expect(() => FileService.readFileContent(file, [root])).toThrow('Failed to read file');
      expect(() => FileService.readFileContent(file, [path.dirname(file)])).toThrow('Failed to read file');
      // What was indexed earlier stays cached until the rescan every sync runs.
      expect(indexer.refresh()).toEqual([]);
      expect(indexer.getTest(UUID)).toBeNull();
    });
  });

  describe('a clone whose tests_source is a link to a folder outside the clone', () => {
    beforeEach(() => {
      fs.symlinkSync(outside, root);
      registerRepositoryRoot(root, clone);
    });

    it('indexes nothing', () => {
      const indexer = new TestIndexer([{ path: root, provenance: 'upstream' }]);
      expect(indexer.scanAllTests()).toEqual([]);
      expect(indexer.getTest(UUID)).toBeNull();
    });

    it('reads nothing', () => {
      const file = path.join(root, 'intel-driven', UUID, 'README.md');
      expect(() => FileService.readFileContent(file, [root])).toThrow('Failed to read file');
      expect(() => FileService.readFileContent(file, [path.dirname(file)])).toThrow('Failed to read file');
    });

    it('catalogues nothing and finds nothing to build', () => {
      initCatalog([{ path: root, provenance: 'upstream' }]);
      expect(getTestMetadata(UUID)).toBeNull();
      expect(findBuildDir([root])).toBeNull();
    });

    it('tells the operator once, in plain words', () => {
      new TestIndexer([{ path: root, provenance: 'upstream' }]).scanAllTests();
      expect(isUsableSourceRoot(root)).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('Test library folder refused');
      expect(String(warn.mock.calls[0][0])).toContain(root);
    });

    it('still serves the other sources', () => {
      const custom = path.join(base, 'custom');
      writeTest(path.join(custom, 'intel-driven', UUID), '# Custom');
      const indexer = new TestIndexer([
        { path: custom, provenance: 'custom' },
        { path: root, provenance: 'upstream' },
      ]);
      const tests = indexer.scanAllTests();
      expect(tests).toHaveLength(1);
      expect(tests[0].source).toBe('custom');
    });
  });

  it('refuses a tests_source that links to another folder inside the clone', () => {
    const inside = path.join(clone, 'other');
    writeTest(path.join(inside, 'intel-driven', UUID), '# Elsewhere in the clone');
    fs.symlinkSync(inside, root);
    registerRepositoryRoot(root, clone);

    expect(checkRepositoryRoot(root)).toEqual({ guarded: true, canonicalRoot: null });
    expect(new TestIndexer([{ path: root, provenance: 'upstream' }]).scanAllTests()).toEqual([]);
    const file = path.join(root, 'intel-driven', UUID, 'README.md');
    expect(() => FileService.readFileContent(file, [root])).toThrow('Failed to read file');
  });

  it('refuses a tests_source that is a file', () => {
    fs.writeFileSync(root, 'not a folder');
    registerRepositoryRoot(root, clone);
    expect(isUsableSourceRoot(root)).toBe(false);
  });

  it('treats a root that does not exist yet (never synced) as unusable, without a warning', () => {
    registerRepositoryRoot(root, clone);
    expect(isUsableSourceRoot(root)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves an operator-set root alone, even when it is a symlink', () => {
    // Registered clone next to it, to show the rule is per root.
    fs.symlinkSync(outside, root);
    registerRepositoryRoot(root, clone);

    const operatorRoot = path.join(base, 'mounted-library');
    fs.symlinkSync(outside, operatorRoot);

    expect(checkRepositoryRoot(operatorRoot)).toEqual({ guarded: false });
    const indexer = new TestIndexer([{ path: operatorRoot, provenance: 'upstream' }]);
    expect(indexer.scanAllTests().map(t => t.uuid)).toEqual([UUID]);
    const file = path.join(operatorRoot, 'intel-driven', UUID, 'README.md');
    expect(FileService.readFileContent(file, [operatorRoot]).content).toBe('# Outside the clone');
    expect(findBuildDir([operatorRoot])).toBe(path.join(operatorRoot, 'intel-driven', UUID));
  });
});
