import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConsoleIdentityService, normalizeCode, isIdentityColor } from '../consoleIdentity.service.js';

describe('normalizeCode', () => {
  it('trims and uppercases', () => {
    expect(normalizeCode(' acme ')).toBe('ACME');
    expect(normalizeCode('ab')).toBe('AB');
  });
  it('rejects invalid codes', () => {
    for (const bad of ['a', 'ac-me', 'ABCDEFG', '']) expect(normalizeCode(bad)).toBeNull();
  });
});

describe('isIdentityColor', () => {
  it('accepts presets and none only', () => {
    expect(isIdentityColor('violet')).toBe(true);
    expect(isIdentityColor('none')).toBe(true);
    expect(isIdentityColor('red')).toBe(false);
    expect(isIdentityColor(1)).toBe(false);
  });
});

describe('ConsoleIdentityService', () => {
  let dir: string;
  let warn: ReturnType<typeof vi.spyOn>;
  const file = () => path.join(dir, 'console-identity.json');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-identity-'));
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns none when nothing is configured', () => {
    expect(new ConsoleIdentityService(dir, {}).get()).toEqual({ code: null, name: null, color: 'none', source: 'none' });
  });

  it('reads env values', () => {
    const env = { CONSOLE_ORG_CODE: 'acme', CONSOLE_ORG_NAME: 'Acme Financial Group', CONSOLE_ORG_COLOR: 'violet' };
    expect(new ConsoleIdentityService(dir, env).get()).toEqual({
      code: 'ACME', name: 'Acme Financial Group', color: 'violet', source: 'env',
    });
  });

  it('falls back to ORGANIZATION_NAME for the name', () => {
    const env = { CONSOLE_ORG_CODE: 'ACME', ORGANIZATION_NAME: 'Acme Corp' };
    expect(new ConsoleIdentityService(dir, env).get().name).toBe('Acme Corp');
  });

  it('ignores invalid env values', () => {
    expect(new ConsoleIdentityService(dir, { CONSOLE_ORG_COLOR: 'red' }).get().color).toBe('none');
    const id = new ConsoleIdentityService(dir, { CONSOLE_ORG_CODE: 'x' }).get();
    expect(id.code).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('warns about invalid env once, not on every get()', () => {
    const svc = new ConsoleIdentityService(dir, { CONSOLE_ORG_CODE: 'x', CONSOLE_ORG_COLOR: 'red' });
    const after = warn.mock.calls.length;
    svc.get(); svc.get(); svc.get();
    expect(warn.mock.calls.length).toBe(after);
    expect(after).toBe(2);
  });

  it('warns and ignores an env name over 80 chars', () => {
    const id = new ConsoleIdentityService(dir, { CONSOLE_ORG_CODE: 'ACME', CONSOLE_ORG_NAME: 'x'.repeat(81) }).get();
    expect(id.name).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('saved record overrides env entirely', () => {
    const svc = new ConsoleIdentityService(dir, { ORGANIZATION_NAME: 'Acme Corp', CONSOLE_ORG_COLOR: 'violet' });
    svc.save({ code: 'ACME', name: null, color: 'cyan' });
    expect(svc.get()).toEqual({ code: 'ACME', name: null, color: 'cyan', source: 'saved' });
  });

  it('save normalizes and rejects bad codes', () => {
    const svc = new ConsoleIdentityService(dir, {});
    expect(svc.save({ code: ' acme ', name: '  Acme  ', color: 'blue' })).toMatchObject({ code: 'ACME', name: 'Acme' });
    expect(() => svc.save({ code: 'x', name: null, color: 'none' })).toThrow('Invalid code');
  });

  it('writes atomically with no tmp file left', () => {
    new ConsoleIdentityService(dir, {}).save({ code: 'ACME', name: null, color: 'pink' });
    expect(fs.existsSync(file())).toBe(true);
    expect(fs.readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });

  it('reset removes the file and returns env values', () => {
    const svc = new ConsoleIdentityService(dir, { CONSOLE_ORG_CODE: 'ENVC' });
    svc.save({ code: 'ACME', name: null, color: 'pink' });
    expect(svc.reset()).toMatchObject({ code: 'ENVC', source: 'env' });
    expect(fs.existsSync(file())).toBe(false);
  });

  it('reset without a file does not throw', () => {
    expect(() => new ConsoleIdentityService(dir, {}).reset()).not.toThrow();
  });

  it('corrupt file falls back to env and warns', () => {
    fs.writeFileSync(file(), '{nope');
    const id = new ConsoleIdentityService(dir, { CONSOLE_ORG_CODE: 'ENVC' }).get();
    expect(id).toMatchObject({ code: 'ENVC', source: 'env' });
    expect(warn).toHaveBeenCalled();
  });

  it('invalid stored colour is treated as corrupt', () => {
    fs.writeFileSync(file(), JSON.stringify({ code: 'ACME', name: null, color: 'red' }));
    expect(new ConsoleIdentityService(dir, { CONSOLE_ORG_CODE: 'ENVC' }).get()).toMatchObject({ code: 'ENVC', source: 'env' });
  });
});
