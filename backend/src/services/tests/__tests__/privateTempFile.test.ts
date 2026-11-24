import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writePrivateTempFile } from '../privateTempFile.js';

// Real files: the point is where the file is and who can read it.
describe('writePrivateTempFile', () => {
  it('writes the content to a 0600 file in a 0700 directory of its own', () => {
    const secret = writePrivateTempFile('cert-pass');
    try {
      expect(fs.readFileSync(secret.path, 'utf8')).toBe('cert-pass');
      expect(fs.statSync(secret.path).mode & 0o777).toBe(0o600);
      const dir = path.dirname(secret.path);
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      expect(fs.readdirSync(dir)).toEqual([path.basename(secret.path)]);
    } finally {
      secret.remove();
    }
  });

  it('is under the system temp directory, not under the settings directory', () => {
    const secret = writePrivateTempFile('x');
    try {
      const tmp = fs.realpathSync(os.tmpdir());
      expect(fs.realpathSync(secret.path).startsWith(tmp + path.sep)).toBe(true);
      expect(secret.path).not.toContain('.projectachilles');
    } finally {
      secret.remove();
    }
  });

  it('gives every call its own directory', () => {
    const a = writePrivateTempFile('a');
    const b = writePrivateTempFile('b');
    try {
      expect(path.dirname(a.path)).not.toBe(path.dirname(b.path));
    } finally {
      a.remove();
      b.remove();
    }
  });

  it('remove() deletes the file and the directory, and can be called twice', () => {
    const secret = writePrivateTempFile('x');
    const dir = path.dirname(secret.path);

    secret.remove();
    secret.remove();

    expect(fs.existsSync(secret.path)).toBe(false);
    expect(fs.existsSync(dir)).toBe(false);
  });
});
