import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readGitHead, readSourceVersion } from '../sourceInfo.js';

// Docker installs build the agent from the server's own checkout, mounted
// read-only, with the repo's .git mounted next to it. These read the commit
// and the source's own version from files only (no git binary, no shell).

const SHA = '0123456789abcdef0123456789abcdef01234567';
const OTHER = 'fedcba9876543210fedcba9876543210fedcba98';
let dir: string;
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srcinfo-')); });

describe('readGitHead', () => {
  it('follows HEAD to a loose branch ref', () => {
    write('HEAD', 'ref: refs/heads/main\n');
    write('refs/heads/main', `${SHA}\n`);
    expect(readGitHead(dir)).toBe(SHA);
  });

  it('falls back to packed-refs when the branch has no loose ref', () => {
    write('HEAD', 'ref: refs/heads/main\n');
    write('packed-refs', `# pack-refs with: peeled fully-peeled sorted\n${OTHER} refs/heads/dev\n${SHA} refs/heads/main\n^${OTHER}\n`);
    expect(readGitHead(dir)).toBe(SHA);
  });

  it('reads a detached HEAD', () => {
    write('HEAD', `${SHA}\n`);
    expect(readGitHead(dir)).toBe(SHA);
  });

  it('is null for a missing or unreadable git dir, or a ref that escapes it', () => {
    expect(readGitHead(path.join(dir, 'absent'))).toBeNull();
    expect(readGitHead(undefined)).toBeNull();
    write('HEAD', 'ref: ../../etc/passwd\n');
    expect(readGitHead(dir)).toBeNull();
    write('HEAD', 'garbage\n');
    expect(readGitHead(dir)).toBeNull();
  });
});

describe('readSourceVersion', () => {
  it("reads the agent's own version from main.go", () => {
    write('main.go', 'package main\n\n// Set via -ldflags\nvar version = "0.7.3"\n');
    expect(readSourceVersion(dir)).toBe('0.7.3');
  });

  it('is null when main.go is missing or has no version line', () => {
    expect(readSourceVersion(dir)).toBeNull();
    write('main.go', 'package main\n');
    expect(readSourceVersion(dir)).toBeNull();
  });
});
