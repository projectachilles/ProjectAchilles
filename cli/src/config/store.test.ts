/**
 * Tests for setConfigValue's prototype-pollution defenses.
 *
 * The setter walks a dotted property chain into the config object, which is a
 * classic prototype-pollution sink. Three layers of defense apply:
 *   1. Pre-validation: any segment matching `__proto__`/`constructor`/`prototype` throws.
 *   2. Loop-time guard: even if validation was bypassed, the recursive walk skips
 *      unsafe segments via `isUnsafeKey()`.
 *   3. Final-key guard: the leaf assignment re-checks `isUnsafeKey(finalKey)`.
 *
 * Inline string equality (not `Set.has()`) is what CodeQL's
 * js/prototype-pollution-utility query recognises as a sanitiser barrier.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
}));

const { setConfigValue } = await import('./store.js');

describe('setConfigValue prototype-pollution defenses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      active_profile: 'default',
      profiles: { default: { server_url: 'http://localhost:3000' } },
      defaults: { output: 'pretty', page_size: 20 },
    }));
  });

  it('rejects __proto__ as a top-level key', () => {
    expect(() => setConfigValue('__proto__', 'polluted')).toThrow(/Invalid config key/);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('rejects constructor as a top-level key', () => {
    expect(() => setConfigValue('constructor', 'polluted')).toThrow(/Invalid config key/);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('rejects prototype as a top-level key', () => {
    expect(() => setConfigValue('prototype', 'polluted')).toThrow(/Invalid config key/);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('rejects __proto__ nested inside a dotted path', () => {
    expect(() => setConfigValue('foo.__proto__.bar', 'polluted')).toThrow(/Invalid config key/);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('rejects constructor nested inside a dotted path', () => {
    expect(() => setConfigValue('foo.constructor', 'polluted')).toThrow(/Invalid config key/);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('rejects __proto__ as the final segment', () => {
    expect(() => setConfigValue('foo.bar.__proto__', 'polluted')).toThrow(/Invalid config key/);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('does not pollute Object.prototype', () => {
    // Object.prototype should remain pristine after any attack attempt
    try { setConfigValue('__proto__.polluted', 'yes'); } catch { /* expected */ }
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('allows safe nested writes', () => {
    setConfigValue('defaults.output', 'json');
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written.defaults.output).toBe('json');
  });

  it('coerces numeric strings to numbers', () => {
    setConfigValue('defaults.page_size', '50');
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written.defaults.page_size).toBe(50);
  });

  it('keeps non-numeric strings as strings', () => {
    setConfigValue('defaults.output', 'pretty');
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written.defaults.output).toBe('pretty');
  });
});
