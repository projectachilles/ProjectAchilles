import { describe, it, expect } from 'vitest';
import { safeDownloadName } from '../downloadName.js';

const FALLBACK = 'fallback.bin';
const name = (header: string | null) => safeDownloadName(header, FALLBACK);

describe('safeDownloadName', () => {
  it('keeps the ordinary names the backend sends', () => {
    expect(name('attachment; filename="7659eeba-f315-440e-9882-4aa015d68b27.exe"'))
      .toBe('7659eeba-f315-440e-9882-4aa015d68b27.exe');
    expect(name('attachment; filename=achilles-agent-linux-amd64')).toBe('achilles-agent-linux-amd64');
    expect(name('attachment; filename="test.exe"; size=10')).toBe('test.exe');
  });

  it.each([
    ['an absolute path', 'attachment; filename="/home/me/.bashrc"', '.bashrc'],
    ['a traversal path', 'attachment; filename="../../.ssh/authorized_keys"', 'authorized_keys'],
    ['a Windows path', 'attachment; filename="C:\\Users\\me\\AppData\\run.bat"', 'run.bat'],
  ])('never returns a path for %s', (_label, header, lastSegment) => {
    const result = name(header);
    expect(result).not.toMatch(/[\\/]/);
    // Either the last segment (when it is a plain name) or the fallback.
    expect([lastSegment, FALLBACK]).toContain(result);
  });

  it('falls back for names that are not plain file names', () => {
    expect(name('attachment; filename="/home/me/.bashrc"')).toBe(FALLBACK); // dotfile
    expect(name('attachment; filename=".."')).toBe(FALLBACK);
    expect(name('attachment; filename="a..b"')).toBe(FALLBACK);
    expect(name('attachment; filename="bad\u0007name"')).toBe(FALLBACK);
    expect(name('attachment; filename="dir/"')).toBe(FALLBACK);
  });

  it('falls back when there is no header or no filename', () => {
    expect(name(null)).toBe(FALLBACK);
    expect(name('attachment')).toBe(FALLBACK);
  });
});
