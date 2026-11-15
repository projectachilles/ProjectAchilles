import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FileService } from '../fileService.js';

/**
 * Real-filesystem checks for the symlink rules. fileService.test.ts mocks
 * `fs`, so it can't show that a real link is refused; this file can.
 */
describe('FileService.readFileContent on a real filesystem', () => {
  let base: string;
  let root: string;
  let secret: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-fileservice-')));
    root = path.join(base, 'tests_source');
    fs.mkdirSync(path.join(root, 'intel-driven', 'test-1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'intel-driven', 'test-1', 'README.md'), '# Real file');
    secret = path.join(base, 'backend.env');
    fs.writeFileSync(secret, 'ENCRYPTION_SECRET=do-not-leak');
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('reads a regular file inside the root', () => {
    const file = path.join(root, 'intel-driven', 'test-1', 'README.md');
    expect(FileService.readFileContent(file, [root]).content).toBe('# Real file');
  });

  it('refuses a file that is a symlink to a file outside the root', () => {
    const link = path.join(root, 'intel-driven', 'test-1', 'notes.md');
    fs.symlinkSync(secret, link);
    expect(() => FileService.readFileContent(link, [root])).toThrow('Failed to read file');
  });

  it('refuses a file that is a symlink to another file inside the root', () => {
    const link = path.join(root, 'intel-driven', 'test-1', 'alias.md');
    fs.symlinkSync(path.join(root, 'intel-driven', 'test-1', 'README.md'), link);
    expect(() => FileService.readFileContent(link, [root])).toThrow('Failed to read file');
  });

  it('refuses a file reached through a symlinked directory', () => {
    const outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'README.md'), 'outside');
    fs.symlinkSync(outside, path.join(root, 'intel-driven', 'test-2'));
    expect(() => FileService.readFileContent(path.join(root, 'intel-driven', 'test-2', 'README.md'), [root]))
      .toThrow('Failed to read file');
  });

  it('reads through a root that is itself a symlink (operator-configured mount)', () => {
    const linkedRoot = path.join(base, 'library');
    fs.symlinkSync(root, linkedRoot);
    const file = path.join(linkedRoot, 'intel-driven', 'test-1', 'README.md');
    expect(FileService.readFileContent(file, [linkedRoot]).content).toBe('# Real file');
  });

  it('still refuses a symlink below a symlinked root', () => {
    const linkedRoot = path.join(base, 'library');
    fs.symlinkSync(root, linkedRoot);
    fs.symlinkSync(secret, path.join(root, 'intel-driven', 'test-1', 'notes.md'));
    expect(() => FileService.readFileContent(path.join(linkedRoot, 'intel-driven', 'test-1', 'notes.md'), [linkedRoot]))
      .toThrow('Failed to read file');
  });
});
