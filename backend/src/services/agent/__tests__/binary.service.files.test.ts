import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Real files in a temp home: the rule under test is about what is in a build
// folder on disk, so the folder is not mocked.
let home: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = { homedir: () => home };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { getBinaryInfo } = await import('../binary.service.js');

const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const OTHER = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

function buildDir(uuid: string): string {
  return path.join(home, '.projectachilles', 'builds', uuid);
}

function writeBuild(uuid: string, meta: unknown | null, files: Record<string, string> = {}): void {
  const dir = buildDir(uuid);
  fs.mkdirSync(dir, { recursive: true });
  if (meta) fs.writeFileSync(path.join(dir, 'build-meta.json'), JSON.stringify(meta));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
}

const notFound = (name: string) => ({ statusCode: 404, message: `Binary not found: ${name}` });

describe('getBinaryInfo (what an agent may download from a build folder)', () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'binsvc-'));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it('serves the binary the build record names, with its hash and size', async () => {
    writeBuild(UUID, { filename: `${UUID}.exe` }, { [`${UUID}.exe`]: 'binary-content' });

    const info = await getBinaryInfo(UUID, `${UUID}.exe`);

    expect(info).toEqual({
      path: path.join(buildDir(UUID), `${UUID}.exe`),
      name: `${UUID}.exe`,
      size: 14,
      sha256: crypto.createHash('sha256').update('binary-content').digest('hex'),
    });
  });

  it('serves every per-OS binary of a cross-platform build', async () => {
    writeBuild(
      UUID,
      { filename: `${UUID}.exe`, binaries: { windows: { filename: `${UUID}.exe` }, linux: { filename: UUID } } },
      { [`${UUID}.exe`]: 'win', [UUID]: 'linux!' },
    );

    await expect(getBinaryInfo(UUID, `${UUID}.exe`)).resolves.toMatchObject({ size: 3 });
    await expect(getBinaryInfo(UUID, UUID)).resolves.toMatchObject({ size: 6, name: UUID });
  });

  it('serves the name an older record stores as binary_name', async () => {
    writeBuild(UUID, { binary_name: 'legacy.exe' }, { 'legacy.exe': 'old' });

    await expect(getBinaryInfo(UUID, 'legacy.exe')).resolves.toMatchObject({ name: 'legacy.exe', size: 3 });
  });

  it('serves <uuid>.exe and <uuid> for a record that names no file', async () => {
    writeBuild(UUID, { builtAt: '2024-01-01T00:00:00.000Z' }, { [`${UUID}.exe`]: 'w', [UUID]: 'l', 'other.exe': 'x' });

    await expect(getBinaryInfo(UUID, `${UUID}.exe`)).resolves.toMatchObject({ size: 1 });
    await expect(getBinaryInfo(UUID, UUID)).resolves.toMatchObject({ size: 1 });
    await expect(getBinaryInfo(UUID, 'other.exe')).rejects.toMatchObject(notFound('other.exe'));
  });

  it.each([
    '.tmp-pass',
    '.tmp-inner-pass',
    '.building',
    'build-meta.json',
    `${UUID}.exe.signed`,
    'validator.dat',
  ])('refuses %s although the file is in the folder', async (name) => {
    writeBuild(UUID, { filename: `${UUID}.exe` }, { [`${UUID}.exe`]: 'bin', [name]: 'secret' });

    await expect(getBinaryInfo(UUID, name)).rejects.toMatchObject(notFound(name));
  });

  it('refuses a name with a folder in it, also when it leads to a listed binary', async () => {
    writeBuild(UUID, { filename: `${UUID}.exe` }, { [`${UUID}.exe`]: 'bin' });
    writeBuild(OTHER, { filename: `${OTHER}.exe` }, { [`${OTHER}.exe`]: 'other' });

    await expect(getBinaryInfo(UUID, `../${OTHER}/${OTHER}.exe`)).rejects.toMatchObject({ statusCode: 404 });
    await expect(getBinaryInfo(UUID, `./${UUID}.exe`)).rejects.toMatchObject({ statusCode: 404 });
    await expect(getBinaryInfo(UUID, path.join(buildDir(UUID), `${UUID}.exe`))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses a test id that is not one folder name', async () => {
    writeBuild(UUID, { filename: `${UUID}.exe` }, { [`${UUID}.exe`]: 'bin' });
    // A build record outside the builds folder must not be read at all.
    fs.mkdirSync(path.join(home, '.projectachilles', 'outside'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.projectachilles', 'outside', 'build-meta.json'),
      JSON.stringify({ filename: 'x.exe' }),
    );
    fs.writeFileSync(path.join(home, '.projectachilles', 'outside', 'x.exe'), 'x');

    await expect(getBinaryInfo(`x/../${UUID}`, `${UUID}.exe`)).rejects.toMatchObject({ statusCode: 404 });
    await expect(getBinaryInfo('../outside', 'x.exe')).rejects.toMatchObject({ statusCode: 404 });
    await expect(getBinaryInfo('..', 'x.exe')).rejects.toMatchObject({ statusCode: 404 });
    await expect(getBinaryInfo('', `${UUID}.exe`)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('does not serve a file when the folder has no build record', async () => {
    writeBuild(UUID, null, { [`${UUID}.exe`]: 'bin' });

    await expect(getBinaryInfo(UUID, `${UUID}.exe`)).rejects.toMatchObject(notFound(`${UUID}.exe`));
  });

  it('does not serve a file when the build record cannot be read', async () => {
    writeBuild(UUID, null, { [`${UUID}.exe`]: 'bin', 'build-meta.json': '{ not json' });

    await expect(getBinaryInfo(UUID, `${UUID}.exe`)).rejects.toMatchObject(notFound(`${UUID}.exe`));
  });

  it('answers 404 when the listed binary is not on disk', async () => {
    writeBuild(UUID, { filename: `${UUID}.exe` });

    await expect(getBinaryInfo(UUID, `${UUID}.exe`)).rejects.toMatchObject(notFound(`${UUID}.exe`));
  });

  it('ignores names in the record that are not plain file names', async () => {
    writeBuild(
      UUID,
      { filename: '../outside.exe', binaries: { windows: { filename: '.tmp-pass' }, linux: { filename: 42 } } },
      { '.tmp-pass': 'secret' },
    );
    fs.writeFileSync(path.join(home, '.projectachilles', 'builds', 'outside.exe'), 'x');

    await expect(getBinaryInfo(UUID, '../outside.exe')).rejects.toMatchObject({ statusCode: 404 });
    await expect(getBinaryInfo(UUID, '.tmp-pass')).rejects.toMatchObject({ statusCode: 404 });
  });
});
