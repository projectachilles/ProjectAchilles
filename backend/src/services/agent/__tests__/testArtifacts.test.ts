import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let home: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = { homedir: () => home };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { resolveTestArtifact, readBuildMeta, getBuildDir, servableBinaryNames } = await import('../testArtifacts.js');

function writeBuild(uuid: string, meta: unknown | null, files: Record<string, string> = {}) {
  const dir = path.join(home, '.projectachilles', 'builds', uuid);
  fs.mkdirSync(dir, { recursive: true });
  if (meta) fs.writeFileSync(path.join(dir, 'build-meta.json'), JSON.stringify(meta));
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), c);
}

describe('resolveTestArtifact', () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-'));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it('resolves a legacy single-binary meta for any OS', () => {
    writeBuild('t1', { filename: 't1.exe' }, { 't1.exe': 'abc' });
    for (const o of ['windows', 'linux', 'darwin'] as const) {
      const r = resolveTestArtifact('t1', o);
      expect(r).toMatchObject({ ok: true, binaryName: 't1.exe', size: 3 });
      expect(r.ok && r.sha256).toHaveLength(64);
    }
  });

  it('resolves per-OS from a binaries map', () => {
    writeBuild('t2', { binaries: { windows: { filename: 'w.exe' }, linux: { filename: 'l' } } }, { 'w.exe': 'w', l: 'll' });
    expect(resolveTestArtifact('t2', 'linux')).toMatchObject({ ok: true, binaryName: 'l', size: 2 });
  });

  it('reports no <os> binary when the map lacks the OS', () => {
    writeBuild('t3', { binaries: { windows: { filename: 'w.exe' } } }, { 'w.exe': 'w' });
    expect(resolveTestArtifact('t3', 'linux')).toMatchObject({ ok: false, reason: 'no linux binary', built: ['windows'] });
  });

  it('reports binary missing on server when the file is absent', () => {
    writeBuild('t4', { filename: 'gone.exe' });
    expect(resolveTestArtifact('t4', 'windows')).toMatchObject({ ok: false, reason: 'binary missing on server', filename: 'gone.exe' });
  });

  it('reports not built when there is no build-meta', () => {
    expect(resolveTestArtifact('nope', 'windows')).toEqual({ ok: false, reason: 'not built' });
  });

  // ── The build folder is the boundary ─────────────────────────────────────

  describe('a test id or file name that leaves the build folder', () => {
    const REAL = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    /** A build record and a file one level above the builds folder. */
    function writeOutside(): void {
      const dir = path.join(home, '.projectachilles', 'outside');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'build-meta.json'), JSON.stringify({ filename: 'secret.bin' }));
      fs.writeFileSync(path.join(dir, 'secret.bin'), 'secret');
    }

    it.each(['../outside', '..', '.', '', 'a/b', 'a\\b', `x/../${REAL}`, '/etc'])(
      'getBuildDir has no folder for %j',
      (id) => {
        expect(getBuildDir(id)).toBeNull();
      },
    );

    it('getBuildDir returns the folder of a plain id', () => {
      expect(getBuildDir(REAL)).toBe(path.join(home, '.projectachilles', 'builds', REAL));
    });

    it('readBuildMeta does not read a record outside the builds folder', () => {
      writeOutside();
      expect(readBuildMeta('../outside')).toBeNull();
    });

    it('resolveTestArtifact reports not built for an id that leaves the builds folder', () => {
      writeOutside();
      writeBuild(REAL, { filename: `${REAL}.exe` }, { [`${REAL}.exe`]: 'bin' });

      expect(resolveTestArtifact('../outside', 'windows')).toEqual({ ok: false, reason: 'not built' });
      // Resolves to the real build, but is not that test's id.
      expect(resolveTestArtifact(`x/../${REAL}`, 'windows')).toEqual({ ok: false, reason: 'not built' });
    });

    it('does not hash a file outside the build folder named by the request', () => {
      writeOutside();
      writeBuild(REAL, { builtAt: '2024-01-01T00:00:00.000Z' }, { [`${REAL}.exe`]: 'bin' });

      const r = resolveTestArtifact(REAL, 'windows', { fallbackFilename: '../../outside/secret.bin' });

      expect(r).toEqual({ ok: false, reason: 'binary missing on server', filename: '../../outside/secret.bin' });
    });

    it('does not hash a file outside the build folder named by the record', () => {
      writeOutside();
      writeBuild(REAL, { filename: '../../outside/secret.bin' });

      expect(resolveTestArtifact(REAL, 'windows')).toMatchObject({ ok: false, reason: 'binary missing on server' });
      expect(resolveTestArtifact(REAL, 'windows', { hash: false })).toMatchObject({ ok: false, reason: 'binary missing on server' });
    });
  });

  describe('servableBinaryNames', () => {
    const ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    it('lists filename, binary_name and every per-OS filename once', () => {
      expect(servableBinaryNames({
        filename: `${ID}.exe`,
        binary_name: 'legacy.exe',
        binaries: { windows: { filename: `${ID}.exe` }, linux: { filename: ID } },
      }, ID).sort()).toEqual([ID, `${ID}.exe`, 'legacy.exe'].sort());
    });

    it('falls back to <uuid> and <uuid>.exe for a record that names no file', () => {
      expect(servableBinaryNames({ builtAt: 'x' }, ID)).toEqual([ID, `${ID}.exe`]);
    });

    it('leaves out names that are not plain file names', () => {
      expect(servableBinaryNames({
        filename: '../x.exe',
        binary_name: '.tmp-pass',
        binaries: { windows: { filename: 'a/b.exe' }, linux: { filename: 7 }, darwin: null },
      }, ID)).toEqual([ID, `${ID}.exe`]);
    });

    it('lists nothing for something that is not a record', () => {
      expect(servableBinaryNames(null, ID)).toEqual([]);
      expect(servableBinaryNames('text', ID)).toEqual([]);
    });
  });
});
